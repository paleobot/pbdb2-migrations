import { pgPlay, closePgPlay } from '../../pg-play-pool.js';

async function main() {
  const client = await pgPlay.connect();
  try {
    const { rows: roots } = await client.query(`
      SELECT subject_permid, new_name FROM name_opinions
      WHERE edge_class='root' AND new_name IN ('Hyriidae','Hyriinae')
    `);
    console.log('Permids:', roots);
    const permids = roots.map(r => r.subject_permid);

    const { rows } = await client.query(`
      SELECT a.id, a.evidence, a.publication_year, r.reference->>'publicationYear' AS ref_year,
             a.questioned, a.removed, a.succeeded_by_id, a.preceded_by_id,
             ns.new_name AS subject_name, nc.new_name AS containing_name
      FROM assignment_opinions a
      LEFT JOIN refs r ON r.id = a.reference_id
      LEFT JOIN name_opinions ns ON ns.subject_permid = a.subject_permid AND ns.edge_class='root'
      LEFT JOIN name_opinions nc ON nc.subject_permid = a.containing_permid AND nc.edge_class='root'
      WHERE a.subject_permid = ANY($1) OR a.containing_permid = ANY($1)
      ORDER BY a.id
    `, [permids]);
    console.log('=== assignment_opinions rows involving Hyriidae or Hyriinae ===');
    for (const r of rows) console.log(r);
    console.log('Total:', rows.length);
  } finally {
    client.release();
    await closePgPlay();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
