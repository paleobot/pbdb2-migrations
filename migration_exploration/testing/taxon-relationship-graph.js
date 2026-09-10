// A small local web app for visualizing one taxon's relationships to other taxa,
// straight from the Layer 1 opinion tables (name_opinions, assignment_opinions) --
// not from derive_linnaean()/derive_taxa_clades()'s resolved output. The point is to
// see the raw opinion graph a curator actually entered, not the single "winning"
// answer derive() computes from it.
//
// Usage:
//   node migration_exploration/testing/taxon-relationship-graph.js [port]
//   (defaults to port 4500) then open http://localhost:<port> and search for a taxon.
//
// Three edge types, drawn as three separate curves (never stacked) between any given
// pair of taxa:
//   type 1 -- name_opinions rows with edge_class = 'name'     (spelling/rename edges)
//   type 2 -- name_opinions rows with edge_class = 'concept'  (synonymy edges)
//   type 3 -- assignment_opinions rows                        (containment edges)
// Edge thickness scales with how many current opinions assert that exact directed
// edge. Only current opinions are shown (removed IS NOT TRUE AND succeeded_by_id IS
// NULL) -- a corrected data-entry duplicate isn't a second, independent claim.
import express from 'express';
import { pgPlay } from '../../pg-play-pool.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPE_ORDER = { name: 0, concept: 1, assignment: 2 };
const TYPE_LABEL = {
  name: 'spelling',
  concept: 'synonymy',
  assignment: 'hierarchy',
};
const TYPE_COLOR = { name: '#2f6f4f', concept: '#a0522d', assignment: '#2b5f8a' };

// ---------------------------------------------------------------------------
// Query / graph-building logic -- unchanged from the CLI version, just now called
// once per request instead of once per process.
// ---------------------------------------------------------------------------

async function resolveSeeds(client, input) {
  const sql = `
    SELECT n.subject_permid AS permid, n.new_name AS name, t.taxonomy_rank AS rank
    FROM name_opinions n
    LEFT JOIN dictionaries.taxonomy_ranks t ON t.id = n.rank_id
    WHERE n.edge_class = 'root' AND n.removed IS NOT TRUE AND n.succeeded_by_id IS NULL
      AND ${UUID_RE.test(input) ? 'n.subject_permid = $1::uuid' : 'lower(n.new_name) = lower($1)'}
  `;
  const { rows } = await client.query(sql, [input]);
  return rows;
}

async function neighborsOf(client, frontier) {
  const [{ rows: nameRows }, { rows: assignRows }] = await Promise.all([
    client.query(
      `SELECT subject_permid, target_permid AS other
       FROM name_opinions
       WHERE edge_class IN ('name','concept') AND removed IS NOT TRUE AND succeeded_by_id IS NULL
         AND (subject_permid = ANY($1) OR target_permid = ANY($1))`,
      [frontier],
    ),
    client.query(
      `SELECT subject_permid, containing_permid AS other
       FROM assignment_opinions
       WHERE removed IS NOT TRUE AND succeeded_by_id IS NULL AND containing_permid IS NOT NULL
         AND (subject_permid = ANY($1) OR containing_permid = ANY($1))`,
      [frontier],
    ),
  ]);
  const found = new Set();
  for (const r of [...nameRows, ...assignRows]) {
    found.add(r.subject_permid);
    if (r.other) found.add(r.other);
  }
  return found;
}

async function inducedEdges(client, permids) {
  const [{ rows: nameEdges }, { rows: assignEdges }] = await Promise.all([
    client.query(
      `SELECT n.id, n.edge_class AS type, n.subject_permid AS a, n.target_permid AS b,
              n.evidence, COALESCE(n.publication_year, (r.reference->>'publicationYear')::int) AS pubyr
       FROM name_opinions n
       LEFT JOIN refs r ON r.id = n.reference_id
       WHERE n.edge_class IN ('name','concept') AND n.removed IS NOT TRUE AND n.succeeded_by_id IS NULL
         AND n.subject_permid = ANY($1) AND n.target_permid = ANY($1)`,
      [permids],
    ),
    client.query(
      `SELECT a.id, 'assignment' AS type, a.subject_permid AS a, a.containing_permid AS b,
              a.evidence, COALESCE(a.publication_year, (r.reference->>'publicationYear')::int) AS pubyr
       FROM assignment_opinions a
       LEFT JOIN refs r ON r.id = a.reference_id
       WHERE a.removed IS NOT TRUE AND a.succeeded_by_id IS NULL AND a.containing_permid IS NOT NULL
         AND a.subject_permid = ANY($1) AND a.containing_permid = ANY($1)`,
      [permids],
    ),
  ]);
  return [...nameEdges, ...assignEdges];
}

async function namesOf(client, permids) {
  const { rows } = await client.query(
    `SELECT n.subject_permid AS permid, n.new_name AS name, t.taxonomy_rank AS rank
     FROM name_opinions n
     LEFT JOIN dictionaries.taxonomy_ranks t ON t.id = n.rank_id
     WHERE n.edge_class = 'root' AND n.subject_permid = ANY($1)`,
    [permids],
  );
  return rows;
}

// Facts from the derived ledger (taxa) rather than recomputed here -- taxa is the
// single unified hierarchy (Linnaean + clade, no more rank-boundary split) and
// already resolved this exact evidence/pubyr/id contest.
//
// Two different SHAPES of "winning" live here, and they matter:
//   - winning_assignment_opinion_id is genuinely an EDGE fact: which specific
//     assignment_opinions row currently sets a concept's container. Pooled across
//     a whole concept's synonyms, but every permid in that concept carries the same
//     value, so comparing a raw opinion's own id against its subject's copy is a
//     correct way to mark that edge "winning" wherever it's drawn.
//   - accepted_spelling_permid / concept_permid are NODE facts, not edge facts:
//     "is THIS permid the one that won its lineage's spelling contest / its
//     concept's senior-name contest." winning_name_opinion_id is a per-PERMID
//     value (each permid's own single best-ranked name_opinions row) -- it does
//     NOT tell you which of two spelling variants is the accepted one, only which
//     opinion best explains each one's own placement. Marking an edge "winning"
//     from that column looked the same regardless of which side of a spelling
//     pair you searched from, which is exactly the bug this was fixed for
//     (Aetobatis/Aetobatus: same thick green edge either way, no way to tell
//     which one actually won). The real answer is per-node: does this permid's
//     own permid equal its accepted_spelling_permid / concept_permid.
async function taxaFactsOf(client, permids) {
  const { rows } = await client.query(
    `SELECT permid, winning_name_opinion_id, winning_assignment_opinion_id,
            accepted_spelling_permid, concept_permid
     FROM taxa WHERE permid = ANY($1)`,
    [permids],
  );
  const byPermid = new Map();
  for (const r of rows) byPermid.set(r.permid, r);
  return byPermid;
}

// Group raw opinion rows into one drawable edge per (type, direction) pair, with a
// lane offset assigned per unordered node pair so that no two edges between the same
// two taxa -- whatever their type or direction -- are ever drawn on top of each other.
function buildDrawableEdges(rawEdges, winners) {
  const isWinning = (e) => {
    const w = winners.get(e.a);
    if (!w) return false;
    return e.type === 'assignment'
      ? String(w.winning_assignment_opinion_id) === String(e.id)
      : String(w.winning_name_opinion_id) === String(e.id);
  };

  const byDirectedKey = new Map(); // `${type}|${a}|${b}` -> {type, a, b, opinions: []}
  for (const e of rawEdges) {
    const key = `${e.type}|${e.a}|${e.b}`;
    if (!byDirectedKey.has(key)) byDirectedKey.set(key, { type: e.type, a: e.a, b: e.b, opinions: [] });
    byDirectedKey.get(key).opinions.push({ id: e.id, evidence: e.evidence, pubyr: e.pubyr, isWinning: isWinning(e) });
  }

  const byPair = new Map(); // `${min}|${max}` -> [directed edge groups]
  for (const edge of byDirectedKey.values()) {
    const pairKey = [edge.a, edge.b].sort().join('|');
    if (!byPair.has(pairKey)) byPair.set(pairKey, []);
    byPair.get(pairKey).push(edge);
  }

  const LANE_SPACING = 28;
  const drawable = [];
  for (const group of byPair.values()) {
    group.sort((x, y) => (TYPE_ORDER[x.type] - TYPE_ORDER[y.type]) || x.a.localeCompare(y.a));
    const n = group.length;
    group.forEach((edge, i) => {
      const offset = (i - (n - 1) / 2) * LANE_SPACING;
      drawable.push({
        type: edge.type,
        source: edge.a,
        target: edge.b,
        count: edge.opinions.length,
        opinionIds: edge.opinions.map((o) => o.id),
        isWinning: edge.opinions.some((o) => o.isWinning),
        offset,
      });
    });
  }
  return drawable;
}

async function buildGraph(client, input, depth) {
  const seeds = await resolveSeeds(client, input);
  if (seeds.length === 0) return null;
  const seedPermids = seeds.map((s) => s.permid);

  let visited = new Set(seedPermids);
  let frontier = new Set(seedPermids);
  for (let hop = 0; hop < depth && frontier.size > 0; hop++) {
    const found = await neighborsOf(client, [...frontier]);
    const next = new Set();
    for (const p of found) if (!visited.has(p)) next.add(p);
    for (const p of next) visited.add(p);
    frontier = next;
  }

  const visitedArr = [...visited];
  const [rawEdges, nameRows, facts] = await Promise.all([
    inducedEdges(client, visitedArr),
    namesOf(client, visitedArr),
    taxaFactsOf(client, visitedArr),
  ]);

  const edges = buildDrawableEdges(rawEdges, facts);

  // Only ring a node for "accepted spelling" / "senior name" when this graph is
  // actually showing a spelling/synonymy edge touching it -- otherwise the ring
  // asserts a relationship (e.g. "accepted over this specific correction") that
  // isn't visible anywhere in the current view, which reads as unexplained.
  const nameTouched = new Set();
  const conceptTouched = new Set();
  for (const e of edges) {
    const set = e.type === 'name' ? nameTouched : e.type === 'concept' ? conceptTouched : null;
    if (set) { set.add(e.source); set.add(e.target); }
  }

  return {
    seedPermids,
    seedNames: seeds.map((s) => s.name),
    nodes: nameRows.map((r) => {
      const f = facts.get(r.permid);
      return {
        id: r.permid,
        name: r.name,
        rank: r.rank,
        isAcceptedSpelling: !!f && f.accepted_spelling_permid === r.permid && nameTouched.has(r.permid),
        isSeniorConcept: !!f && f.concept_permid === r.permid && conceptTouched.has(r.permid),
      };
    }),
    edges,
  };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const app = express();

app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const client = await pgPlay.connect();
  try {
    const { rows } = await client.query(
      `SELECT DISTINCT n.new_name AS name, t.taxonomy_rank AS rank
       FROM name_opinions n
       LEFT JOIN dictionaries.taxonomy_ranks t ON t.id = n.rank_id
       WHERE n.edge_class = 'root' AND n.removed IS NOT TRUE AND n.succeeded_by_id IS NULL
         AND n.new_name ILIKE '%' || $1 || '%'
       ORDER BY n.new_name
       LIMIT 20`,
      [q],
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  } finally {
    client.release();
  }
});

app.get('/api/graph', async (req, res) => {
  const input = (req.query.taxon || '').trim();
  const depth = Math.max(1, Math.min(5, parseInt(req.query.depth, 10) || 1));
  if (!input) return res.status(400).json({ error: 'taxon is required' });
  const client = await pgPlay.connect();
  try {
    const graph = await buildGraph(client, input, depth);
    if (!graph) return res.status(404).json({ error: `No taxon found matching "${input}"` });
    res.json({ ...graph, depth });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  } finally {
    client.release();
  }
});

app.get('/', (req, res) => {
  res.type('html').send(renderPage());
});

function renderPage() {
  return `<!doctype html>
<title>Taxon relationship graph</title>
<meta charset="utf-8">
<style>
  body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #fafaf7; color: #222; font-size: 18px; }
  header { padding: 12px 20px; border-bottom: 1px solid #ddd; background: #fff; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  header h1 { margin: 0; font-size: 1.3rem; white-space: nowrap; }
  #search-wrap { position: relative; }
  #search { font-size: 1.1rem; padding: 6px 10px; width: 280px; border: 1px solid #bbb; border-radius: 4px; }
  #depth { font-size: 1.05rem; padding: 6px 8px; width: 56px; border: 1px solid #bbb; border-radius: 4px; }
  #suggestions { position: absolute; top: 100%; left: 0; width: 280px; background: #fff; border: 1px solid #bbb; border-top: none; max-height: 240px; overflow-y: auto; z-index: 10; }
  #suggestions div { padding: 6px 10px; cursor: pointer; font-size: 1.05rem; }
  #suggestions div:hover { background: #eef2f5; }
  #status { font-size: 1rem; color: #666; }
  #legend { display: flex; gap: 18px; padding: 6px 20px; font-size: 1rem; background: #fff; border-bottom: 1px solid #ddd; flex-wrap: wrap; }
  #legend span { display: inline-flex; align-items: center; gap: 6px; }
  #legend .swatch { width: 22px; height: 3px; display: inline-block; }
  #graph { width: 100vw; height: calc(100vh - 84px); display: block; }
  #legend svg { vertical-align: middle; }
  .node circle { stroke: #fff; stroke-width: 1.5px; cursor: grab; }
  .node.seed circle { stroke: #222; stroke-width: 2.5px; }
  .node text { font-size: 14px; pointer-events: none; }
  .node text .sciname { font-style: italic; }
  .link { fill: none; }
  .link:hover { opacity: 0.6; }
  #empty { padding: 60px 20px; text-align: center; color: #888; font-size: 1.1rem; }
</style>
<header>
  <h1>Relationship graph</h1>
  <div id="search-wrap">
    <input id="search" type="text" placeholder="Search a taxon name or permid…" autocomplete="off">
    <div id="suggestions"></div>
  </div>
  <label style="font-size:0.85rem; color:#555;">depth <input id="depth" type="number" min="1" max="5" value="1"></label>
  <span id="status"></span>
</header>
<div id="legend">
  <span><span class="swatch" style="background:${TYPE_COLOR.name}"></span>${TYPE_LABEL.name}</span>
  <span><span class="swatch" style="background:${TYPE_COLOR.concept}"></span>${TYPE_LABEL.concept}</span>
  <span><span class="swatch" style="background:${TYPE_COLOR.assignment}"></span>${TYPE_LABEL.assignment}</span>
  <span>line thickness = number of current opinions asserting that edge</span>
  <span><svg width="22" height="3"><line x1="0" y1="1.5" x2="22" y2="1.5" stroke="${TYPE_COLOR.assignment}" stroke-width="2"></line></svg> accepted parent</span>
  <span><svg width="22" height="3"><line x1="0" y1="1.5" x2="22" y2="1.5" stroke="${TYPE_COLOR.assignment}" stroke-width="2" stroke-dasharray="5,4"></line></svg> not accepted</span>
  <span><svg width="18" height="18"><circle cx="9" cy="9" r="7" fill="none" stroke="${TYPE_COLOR.name}" stroke-width="2.5"></circle></svg> accepted spelling</span>
  <span><svg width="18" height="18"><circle cx="9" cy="9" r="7" fill="none" stroke="${TYPE_COLOR.concept}" stroke-width="2.5"></circle></svg> senior name (synonymy)</span>
</div>
<div id="empty">Search for a taxon above to see its relationship graph.</div>
<svg id="graph" style="display:none"></svg>
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
<script>
const TYPE_COLOR = ${JSON.stringify(TYPE_COLOR)};
function isSciName(rank) { return rank === 'genus' || rank === 'species'; }
const searchInput = document.getElementById('search');
const depthInput = document.getElementById('depth');
const suggestionsEl = document.getElementById('suggestions');
const statusEl = document.getElementById('status');
const emptyEl = document.getElementById('empty');
const svg = d3.select('#graph');
let simulation = null;

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const fetchSuggestions = debounce(async (q) => {
  if (q.trim().length < 2) { suggestionsEl.innerHTML = ''; return; }
  const res = await fetch('/api/search?q=' + encodeURIComponent(q));
  const rows = await res.json();
  suggestionsEl.innerHTML = '';
  for (const r of rows) {
    const div = document.createElement('div');
    const nameEl = document.createElement('span');
    nameEl.textContent = r.name;
    if (isSciName(r.rank)) nameEl.style.fontStyle = 'italic';
    div.appendChild(nameEl);
    if (r.rank) div.appendChild(document.createTextNode(' (' + r.rank + ')'));
    div.onclick = () => { searchInput.value = r.name; suggestionsEl.innerHTML = ''; loadGraph(r.name); };
    suggestionsEl.appendChild(div);
  }
}, 200);

searchInput.addEventListener('input', () => fetchSuggestions(searchInput.value));
searchInput.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && searchInput.value.trim()) {
    suggestionsEl.innerHTML = '';
    loadGraph(searchInput.value.trim());
  }
});
document.addEventListener('click', (ev) => {
  if (!ev.target.closest('#search-wrap')) suggestionsEl.innerHTML = '';
});

async function loadGraph(taxon) {
  statusEl.textContent = 'Loading…';
  const depth = Math.max(1, Math.min(5, parseInt(depthInput.value, 10) || 1));
  const res = await fetch('/api/graph?taxon=' + encodeURIComponent(taxon) + '&depth=' + depth);
  const data = await res.json();
  if (!res.ok) { statusEl.textContent = data.error || 'Error'; return; }
  render(data);
}

function arrowSize(count) { return Math.min(8 + count * 1.1, 15); }

function render(DATA) {
  emptyEl.style.display = 'none';
  svg.style('display', 'block');
  svg.selectAll('*').remove();
  if (simulation) simulation.stop();

  statusEl.textContent = DATA.nodes.length + ' taxa, ' + DATA.edges.length + ' edges, depth ' + DATA.depth +
    (DATA.nodes.length > 150 ? ' — that\\'s a lot to render legibly, consider a shallower depth' : '');

  const width = window.innerWidth, height = window.innerHeight - 84;
  const g = svg.append('g');
  svg.call(d3.zoom().scaleExtent([0.2, 4]).on('zoom', (ev) => g.attr('transform', ev.transform)));

  const defs = svg.append('defs');
  // One marker per (type, count) combo actually present, sized gently by count --
  // markerUnits=userSpaceOnUse decouples marker size from the line's stroke-width,
  // which otherwise compounds fast (SVG markers scale with stroke-width by default).
  const combos = new Map();
  for (const e of DATA.edges) combos.set(e.type + '-' + e.count, e);
  for (const e of combos.values()) {
    const size = arrowSize(e.count);
    defs.append('marker')
      .attr('id', 'arrow-' + e.type + '-' + e.count)
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 9)
      .attr('refY', 0)
      .attr('markerWidth', size)
      .attr('markerHeight', size)
      .attr('markerUnits', 'userSpaceOnUse')
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', TYPE_COLOR[e.type]);
  }

  const links = DATA.edges.map((e) => ({ ...e }));

  simulation = d3.forceSimulation(DATA.nodes)
    .force('link', d3.forceLink(links).id((d) => d.id).distance(140).strength(0.5))
    .force('charge', d3.forceManyBody().strength(-420))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collide', d3.forceCollide(38));

  const linkPath = g.append('g').selectAll('path')
    .data(links).join('path')
    .attr('class', 'link')
    .attr('stroke', (d) => TYPE_COLOR[d.type])
    .attr('stroke-width', (d) => Math.min(2 + d.count * 1.6, 14))
    // Solid/dashed only means something for hierarchy (assignment) edges -- that's
    // a genuine edge-level fact (which specific opinion currently sets the
    // container). For spelling/synonymy it isn't: a permid's own top-ranked claim
    // can point along a losing edge just as easily as a winning one (see the node
    // rings below for the real answer to "which one won").
    .attr('stroke-dasharray', (d) => (d.type === 'assignment' && !d.isWinning ? '5,4' : null))
    .attr('stroke-opacity', (d) => (d.type === 'assignment' && !d.isWinning ? 0.55 : 1))
    .attr('marker-end', (d) => 'url(#arrow-' + d.type + '-' + d.count + ')');
  linkPath.append('title')
    .text((d) => d.type + ' · ' + d.count + ' opinion' + (d.count === 1 ? '' : 's') +
      ' (id' + (d.count === 1 ? '' : 's') + ' ' + d.opinionIds.join(', ') + ')' +
      (d.type === 'assignment' ? (d.isWinning ? ' — accepted parent' : ' — not accepted') : ''));

  const node = g.append('g').selectAll('g')
    .data(DATA.nodes).join('g')
    .attr('class', (d) => 'node' + (DATA.seedPermids.includes(d.id) ? ' seed' : ''))
    .call(d3.drag()
      .on('start', (ev, d) => { if (!ev.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
      .on('end', (ev, d) => { if (!ev.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }));

  const baseR = (d) => (DATA.seedPermids.includes(d.id) ? 14 : 9);
  // Rings mark the two real winners: this permid IS its lineage's accepted spelling
  // (green ring, matching the "spelling" edge color) and/or IS its concept's senior
  // name (orange ring, matching "synonymy"). Drawn before the solid node circle so
  // the fill covers their inner edge, leaving a clean halo -- unlike edge styling,
  // this is unambiguous regardless of which node you searched from.
  // .style() (inline style), not .attr() -- the .node circle { stroke: #fff }
  // rule below (for the main node circle's white outline) otherwise wins over an
  // attribute-set stroke regardless of color, since a stylesheet rule always beats
  // a presentation attribute in the cascade. Inline style wins over both.
  node.filter((d) => d.isAcceptedSpelling).append('circle')
    .attr('r', (d) => baseR(d) + 4).attr('fill', 'none')
    .style('stroke', TYPE_COLOR.name).style('stroke-width', '2.5px');
  node.filter((d) => d.isSeniorConcept).append('circle')
    .attr('r', (d) => baseR(d) + (d.isAcceptedSpelling ? 8 : 4)).attr('fill', 'none')
    .style('stroke', TYPE_COLOR.concept).style('stroke-width', '2.5px');

  node.append('circle')
    .attr('r', (d) => (DATA.seedPermids.includes(d.id) ? 14 : 9))
    .attr('fill', (d) => (DATA.seedPermids.includes(d.id) ? '#c76b3d' : '#5c7fa6'));
  const label = node.append('text').attr('x', 12).attr('y', 4);
  label.append('tspan')
    .attr('font-style', (d) => (isSciName(d.rank) ? 'italic' : 'normal'))
    .text((d) => d.name);
  label.filter((d) => d.rank).append('tspan').text((d) => ' (' + d.rank + ')');
  node.append('title').text((d) => d.name + (d.rank ? ' — ' + d.rank : '') +
    (d.isAcceptedSpelling ? '\\n✓ accepted spelling' : '') +
    (d.isSeniorConcept ? '\\n✓ senior name (synonymy)' : '') +
    '\\n' + d.id);

  simulation.on('tick', () => {
    linkPath.attr('d', (d) => {
      const sx = d.source.x, sy = d.source.y, tx = d.target.x, ty = d.target.y;
      const mx = (sx + tx) / 2, my = (sy + ty) / 2;
      const dx = tx - sx, dy = ty - sy;
      const len = Math.hypot(dx, dy) || 1;
      const px = -dy / len, py = dx / len;
      const cx = mx + px * d.offset, cy = my + py * d.offset;
      return 'M' + sx + ',' + sy + ' Q' + cx + ',' + cy + ' ' + tx + ',' + ty;
    });
    node.attr('transform', (d) => 'translate(' + d.x + ',' + d.y + ')');
  });
}
</script>
`;
}

const port = parseInt(process.argv[2], 10) || 4500;
const server = app.listen(port, () => {
  console.log(`Taxon relationship graph running at http://localhost:${port}`);
});

process.on('SIGINT', () => {
  server.close(() => pgPlay.end().then(() => process.exit(0)));
});
