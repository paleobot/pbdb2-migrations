// Verification for openspec/changes/derive-clade-attachments, tasks 2.1/2.3:
// reports both the RAW clade-to-clade containment cycles that exist before
// any resolution, and the POST-RESOLUTION state after
// derive_taxa_clades()'s cycle-breaking loop runs (see
// migration_exploration/testing/derive-taxa-clades.sql, task 1.4).
//
// "Raw" state is built here by duplicating derive-taxa-clades.sql's
// pre-loop stages (_dtc_lineage through _dtc_conmeta) plus a single,
// unexclusion-filtered pass of _dtc_assign/_dtc_node -- i.e. exactly what
// the live function's cycle-breaking loop sees on its first iteration,
// before any opinion has been cut. Cycle enumeration then uses the same
// iterative-peeling approach as enumerate-containment-cycles.js (peel to a
// fixed point, walk one cycle out of the survivors, remove it, repeat) --
// the clade graph here is small (~2000 concepts) so the cheaper approach
// isn't required, but it's kept for parity/precedent with the Linnaean-side
// script.
import { readFileSync } from 'fs';
import { pgPlay, closePgPlay } from '../../pg-play-pool.js';

function ms(ns) { return Number(ns) / 1e6; }

async function main() {
  const client = await pgPlay.connect();
  try {
    // deploy the real function (also used for the post-resolution check below)
    const sql = readFileSync(new URL('./derive-taxa-clades.sql', import.meta.url), 'utf8');
    await client.query(sql);

    console.log(`[${new Date().toISOString()}] Building RAW (pre-resolution) clade pipeline...`);
    const t0 = process.hrtime.bigint();

    await client.query(`
      DROP TABLE IF EXISTS _dtc_lineage, _dtc_permid_lineage, _dtc_con_winner, _dtc_con,
        _dtc_conmeta, _dtc_assign, _dtc_node
    `);

    await client.query(`
      CREATE TEMP TABLE _dtc_lineage AS
      SELECT t.original_permid, t.accepted_spelling_permid, t.name,
             t.rank_id AS accepted_rank_id, t.nomenclatural_status_id,
             t.winning_name_opinion_id, t.winning_validity_opinion_id,
             acc_no.evidence AS acc_ev,
             COALESCE(acc_no.publication_year, NULLIF(acc_ref.reference->>'publicationYear','')::int) AS acc_yr,
             t.winning_name_opinion_id AS acc_id,
             COALESCE(orig_no.publication_year, NULLIF(orig_ref.reference->>'publicationYear','')::int, 999999) AS original_yr
      FROM taxa t
      LEFT JOIN name_opinions acc_no ON acc_no.id = t.winning_name_opinion_id
      LEFT JOIN refs acc_ref ON acc_ref.id = acc_no.reference_id
      LEFT JOIN taxa ot ON ot.permid = t.original_permid
      LEFT JOIN name_opinions orig_no ON orig_no.id = ot.winning_name_opinion_id
      LEFT JOIN refs orig_ref ON orig_ref.id = orig_no.reference_id
      WHERE t.permid = t.accepted_spelling_permid AND t.rank_id IN (24, 25)
    `);
    await client.query('CREATE UNIQUE INDEX ON _dtc_lineage(original_permid); ANALYZE _dtc_lineage');

    await client.query(`
      CREATE TEMP TABLE _dtc_permid_lineage AS
      SELECT t.permid, t.original_permid
      FROM taxa t JOIN _dtc_lineage cl ON cl.original_permid = t.original_permid
    `);
    await client.query('CREATE INDEX ON _dtc_permid_lineage(permid); CREATE INDEX ON _dtc_permid_lineage(original_permid); ANALYZE _dtc_permid_lineage');

    await client.query(`
      CREATE TEMP TABLE _dtc_con_winner AS
      WITH cand AS MATERIALIZED (
        SELECT ls.original_permid AS jr, lt.original_permid AS sr, n.evidence,
               COALESCE(n.publication_year, NULLIF(r.reference->>'publicationYear','')::int) AS yr,
               n.id AS opinion_id, n.negates
        FROM name_opinions n
        JOIN _dtc_permid_lineage ls ON ls.permid = n.subject_permid
        JOIN _dtc_permid_lineage lt ON lt.permid = n.target_permid
        LEFT JOIN refs r ON r.id = n.reference_id
        WHERE n.removed IS NOT TRUE AND n.succeeded_by_id IS NULL AND n.edge_class = 'concept'
      ),
      ranked AS MATERIALIZED (
        SELECT jr, sr, negates,
               row_number() OVER (PARTITION BY jr ORDER BY evidence DESC, yr DESC NULLS LAST, opinion_id DESC) AS rn
        FROM cand
      )
      SELECT jr, sr, negates FROM ranked WHERE rn = 1
    `);
    await client.query('CREATE INDEX ON _dtc_con_winner(jr); ANALYZE _dtc_con_winner');

    await client.query(`
      CREATE TEMP TABLE _dtc_con AS
      WITH RECURSIVE
      con_edge AS MATERIALIZED (SELECT jr, sr FROM _dtc_con_winner WHERE negates = false),
      con_undir AS MATERIALIZED (SELECT jr AS a, sr AS b FROM con_edge UNION SELECT sr, jr FROM con_edge),
      reach(src, node) AS (
        SELECT original_permid, original_permid FROM _dtc_lineage
        UNION
        SELECT r.src, u.b FROM reach r JOIN con_undir u ON u.a = r.node
      )
      SELECT src AS lin_rep, min(node::text)::uuid AS con_rep FROM reach GROUP BY src
    `);
    await client.query('CREATE INDEX ON _dtc_con(lin_rep); CREATE INDEX ON _dtc_con(con_rep); ANALYZE _dtc_con');

    await client.query(`
      CREATE TEMP TABLE _dtc_conmeta AS
      WITH con_sources AS MATERIALIZED (SELECT DISTINCT jr FROM _dtc_con_winner WHERE negates = false),
      ranked AS MATERIALIZED (
        SELECT c.con_rep, c.lin_rep,
               row_number() OVER (PARTITION BY c.con_rep ORDER BY
                 (cs.jr IS NULL) DESC, cl.acc_ev DESC, cl.acc_yr DESC NULLS LAST, cl.acc_id DESC,
                 cl.original_yr ASC, cl.original_permid ASC) AS rn
        FROM _dtc_con c
        JOIN _dtc_lineage cl ON cl.original_permid = c.lin_rep
        LEFT JOIN con_sources cs ON cs.jr = c.lin_rep
      )
      SELECT r.con_rep, r.lin_rep AS senior_lin, cl.accepted_spelling_permid AS concept_permid,
             cl.accepted_rank_id AS concept_rank_id, cl.name AS concept_name,
             cl.nomenclatural_status_id, cl.winning_name_opinion_id
      FROM ranked r JOIN _dtc_lineage cl ON cl.original_permid = r.lin_rep
      WHERE r.rn = 1
    `);
    await client.query('CREATE INDEX ON _dtc_conmeta(con_rep); ANALYZE _dtc_conmeta');

    // RAW _dtc_assign/_dtc_node -- identical to derive-taxa-clades.sql's loop
    // body, but with no exclusion filter (this IS what its first iteration sees)
    await client.query(`
      CREATE TEMP TABLE _dtc_assign AS
      WITH cand AS MATERIALIZED (
        SELECT cm.con_rep, a.id AS opinion_id, ccc.con_rep AS containing_con_rep,
               a.evidence, COALESCE(a.publication_year, NULLIF(r.reference->>'publicationYear','')::int) AS yr
        FROM assignment_opinions a
        JOIN _dtc_permid_lineage sl ON sl.permid = a.subject_permid
        JOIN _dtc_con sc ON sc.lin_rep = sl.original_permid
        JOIN _dtc_conmeta cm ON cm.con_rep = sc.con_rep
        JOIN _dtc_lineage cl ON cl.original_permid = sl.original_permid
        JOIN _dtc_permid_lineage ccl ON ccl.permid = a.containing_permid
        JOIN _dtc_con ccc ON ccc.lin_rep = ccl.original_permid
        LEFT JOIN refs r ON r.id = a.reference_id
        WHERE a.removed IS NOT TRUE AND a.succeeded_by_id IS NULL
          AND (sl.original_permid = cm.senior_lin OR cl.accepted_rank_id = cm.concept_rank_id)
          AND ccc.con_rep IS DISTINCT FROM cm.con_rep
      ),
      win AS MATERIALIZED (
        SELECT con_rep, opinion_id, containing_con_rep, evidence, yr,
               row_number() OVER (PARTITION BY con_rep ORDER BY evidence DESC, yr DESC NULLS LAST, opinion_id DESC) AS rn
        FROM cand
      )
      SELECT con_rep, opinion_id AS winning_assignment_opinion_id, containing_con_rep, evidence, yr
      FROM win WHERE rn = 1
    `);
    await client.query('CREATE INDEX ON _dtc_assign(con_rep); ANALYZE _dtc_assign');

    await client.query(`
      CREATE TEMP TABLE _dtc_node AS
      SELECT cm.con_rep, cm.concept_permid, cm.concept_rank_id,
             ccm.concept_permid AS containing_concept_permid,
             a.winning_assignment_opinion_id
      FROM _dtc_conmeta cm
      LEFT JOIN _dtc_assign a ON a.con_rep = cm.con_rep
      LEFT JOIN _dtc_conmeta ccm ON ccm.con_rep = a.containing_con_rep
    `);
    await client.query('CREATE INDEX ON _dtc_node(con_rep); ANALYZE _dtc_node');

    const { rows: countRows } = await client.query('SELECT count(*) FROM _dtc_conmeta');
    console.log(`  Raw pipeline built in ${ms(process.hrtime.bigint() - t0).toFixed(1)} ms. ${countRows[0].count} clade concepts.`);

    // ---- enumerate raw cycles via iterative peeling ----
    await client.query(`
      CREATE TEMP TABLE _cyc_active AS
      SELECT concept_permid, containing_concept_permid FROM _dtc_node WHERE containing_concept_permid IS NOT NULL
    `);
    await client.query('CREATE INDEX ON _cyc_active(concept_permid); ANALYZE _cyc_active');

    async function peelToFixedPoint() {
      let round = 0;
      while (true) {
        round++;
        const { rowCount } = await client.query(`
          DELETE FROM _cyc_active a
          WHERE NOT EXISTS (SELECT 1 FROM _cyc_active b WHERE b.concept_permid = a.containing_concept_permid)
        `);
        if (rowCount === 0) break;
      }
      const { rows } = await client.query('SELECT count(*) FROM _cyc_active');
      return { rounds: round, survivors: Number(rows[0].count) };
    }

    const cycles = [];
    for (let iter = 1; iter <= 20; iter++) {
      const { survivors } = await peelToFixedPoint();
      if (survivors === 0) break;
      const { rows: startRow } = await client.query('SELECT concept_permid FROM _cyc_active LIMIT 1');
      let current = startRow[0].concept_permid;
      const path = [current];
      const seen = new Map([[current, 0]]);
      let next = null;
      while (true) {
        const { rows } = await client.query('SELECT containing_concept_permid FROM _cyc_active WHERE concept_permid = $1', [current]);
        next = rows[0].containing_concept_permid;
        path.push(next);
        if (seen.has(next)) break;
        seen.set(next, path.length - 1);
        current = next;
      }
      const cycleMembers = [...new Set(path.slice(seen.get(next)))];
      cycles.push(cycleMembers);
      await client.query('DELETE FROM _cyc_active WHERE concept_permid = ANY($1::uuid[])', [cycleMembers]);
    }

    console.log('');
    console.log(`=== RAW: ${cycles.length} distinct clade containment cycle(s), ${cycles.flat().length} concepts ===`);
    for (let i = 0; i < cycles.length; i++) {
      const members = cycles[i];
      const { rows } = await client.query(
        'SELECT concept_permid, concept_name FROM _dtc_conmeta WHERE concept_permid = ANY($1::uuid[])',
        [members]
      );
      const byPermid = new Map(rows.map((r) => [r.concept_permid, r.concept_name]));
      console.log(`  Cycle #${i + 1} (${members.length}): ${members.map((m) => byPermid.get(m) ?? m).join(' -> ')}`);
    }

    // ---- post-resolution: call the real (self-resolving) function ----
    console.log('');
    console.log('=== POST-RESOLUTION: calling derive_taxa_clades(NULL) ===');
    const t1 = process.hrtime.bigint();
    const { rows: result } = await client.query('SELECT * FROM derive_taxa_clades(NULL)');
    console.log(`  ${result.length} concept rows in ${ms(process.hrtime.bigint() - t1).toFixed(1)} ms.`);

    const byPermid2 = new Map(result.map((r) => [r.concept_permid, r]));
    let remainingCycles = 0;
    for (const r of result) {
      let cur = r.containing_concept_permid, depth = 0;
      while (cur && depth < 10000) {
        if (cur === r.concept_permid) { remainingCycles++; break; }
        cur = byPermid2.get(cur)?.containing_concept_permid ?? null;
        depth++;
      }
    }
    console.log(`  Remaining genuine cycle members after resolution: ${remainingCycles} (expect 0)`);

    const { rows: cutRows } = await client.query(`
      SELECT eo.opinion_id, a.subject_permid, a.containing_permid
      FROM _dtc_excluded_opinions eo
      JOIN assignment_opinions a ON a.id = eo.opinion_id
      ORDER BY eo.opinion_id
    `);
    console.log(`  Opinions cut to reach resolution: ${cutRows.length}`);
    for (const r of cutRows) console.log(`    opinion_id=${r.opinion_id}`);
  } finally {
    await client.query('DROP TABLE IF EXISTS _cyc_active').catch(() => {});
    client.release();
    await closePgPlay();
  }
}

main().catch((err) => {
  console.error('Enumeration failed:', err);
  process.exitCode = 1;
});
