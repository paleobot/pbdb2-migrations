// Regression check for the is_senior cycle-cut tiebreak added to derive_taxa()
// and derive_taxa_clades() (see postgresql/create_new.sql and
// openspec/changes/derive-clade-attachments/specs/taxa-clades/spec.md,
// "Cycle-breaking cuts are logged to a permanent audit table" /
// "An evidence/pubyr tie between a pooled and a senior-lineage candidate cuts
// the pooled one").
//
// Case: Ornithopoda/Clypeodonta. Every direct opinion on this pair agrees
// Clypeodonta belongs under Ornithopoda, matching Classic's live
// classification (Clypeodonta -> Ornithopoda -> Cerapoda). Before this fix,
// derive_taxa_clades()'s cycle-breaking loop resolved a genuine 2-node cycle
// (Ornithopoda <-> Clypeodonta) by cutting opinion 606523 -- Clypeodonta's
// own direct, correct opinion -- because it tied on evidence/pubyr with
// opinion 923499 (Iguanodontia's opinion, only in the mix because Iguanodontia
// was pooled into Ornithopoda's concept by an unrelated, unevidenced synonymy
// opinion) and lost on the arbitrary last-resort opinion_id tiebreak. The fix
// prefers cutting the pooled candidate (923499) over the senior-lineage one
// (606523) on such a tie.
//
// This script re-runs the full rebuild and checks two things: (1) the
// Ornithopoda/Clypeodonta case now resolves to match Classic, and (2) the
// other 4 known clade cycles (Procolophonomorpha/Cotylosauria,
// Tapiromorpha/Ceratomorpha, Ziphosuchia/Notosuchia+Mesoeucrocodylia,
// Eoichthyosauria/Ichthyopterygia -- see
// openspec/changes/derive-clade-attachments/tasks.md) still cut the exact
// same opinions as before this fix -- i.e. is_senior only changed the one
// case it was written for.
import { pgPlay, closePgPlay } from '../../pg-play-pool.js';

// The full cut set observed before this fix (18 opinions across 5 cycles),
// captured while investigating the Ornithopoda/Clypeodonta case.
const EXPECTED_CUTS_BEFORE_FIX = [
  925283, 925203, 185218, // Procolophonomorpha/Cotylosauria
  908907, // Tapiromorpha/Ceratomorpha
  381310, 375254, 340321, 277409, 331339, 252291, 72809, 144540, // Ziphosuchia/Notosuchia+Mesoeucrocodylia
  496915, 223104, 593692, 348007, 527571, // Eoichthyosauria/Ichthyopterygia
  606523, // Ornithopoda/Clypeodonta -- SHOULD NOT be cut after the fix
];
const EXPECTED_CUT_AFTER_FIX = 923499; // Iguanodontia's pooled opinion, not Clypeodonta's own

async function main() {
  const client = await pgPlay.connect();
  try {
    console.log(`[${new Date().toISOString()}] Rebuilding taxa + taxa_clades...`);
    await client.query('SELECT rebuild_taxa()');
    await client.query('SELECT rebuild_taxa_clades()');

    console.log('Checking invariants...');
    await client.query('SELECT assert_taxa_invariant()');
    await client.query('SELECT assert_taxa_clades_invariant()');
    console.log('  OK: taxa/taxa_clades match a fresh derive_*(NULL).');

    console.log('Checking Ornithopoda/Clypeodonta...');
    const { rows: oc } = await client.query(`
      SELECT DISTINCT name, concept_permid, containing_concept_permid
      FROM taxa_clades WHERE name IN ('Ornithopoda', 'Clypeodonta')
    `);
    const ornithopoda = oc.find((r) => r.name === 'Ornithopoda');
    const clypeodonta = oc.find((r) => r.name === 'Clypeodonta');
    const clypeodontaUnderOrnithopoda = clypeodonta.containing_concept_permid === ornithopoda.concept_permid;
    const ornithopodaNotUnderClypeodonta = ornithopoda.containing_concept_permid !== clypeodonta.concept_permid;
    console.log(`  Clypeodonta contained by Ornithopoda: ${clypeodontaUnderOrnithopoda} (expect true)`);
    console.log(`  Ornithopoda NOT contained by Clypeodonta: ${ornithopodaNotUnderClypeodonta} (expect true)`);

    const { rows: cerapodaCheck } = await client.query(
      'SELECT name FROM taxa_clades WHERE concept_permid = $1 LIMIT 1',
      [ornithopoda.containing_concept_permid],
    );
    const ornithopodaUnderCerapoda = cerapodaCheck[0]?.name === 'Cerapoda';
    console.log(`  Ornithopoda contained by Cerapoda: ${ornithopodaUnderCerapoda} (expect true, matches Classic)`);

    console.log('Checking cycle_cuts audit log against the pre-fix baseline...');
    const { rows: cuts } = await client.query(
      `SELECT cut_opinion_id FROM cycle_cuts WHERE source = 'taxa_clades' ORDER BY cut_opinion_id`,
    );
    const cutIds = cuts.map((r) => Number(r.cut_opinion_id));
    const missing606523 = !cutIds.includes(606523);
    const has923499 = cutIds.includes(EXPECTED_CUT_AFTER_FIX);
    const expectedUnchanged = EXPECTED_CUTS_BEFORE_FIX.filter((id) => id !== 606523);
    const unchangedCutsSurvive = expectedUnchanged.every((id) => cutIds.includes(id));
    const noUnexpectedNewCuts = cutIds
      .filter((id) => id !== EXPECTED_CUT_AFTER_FIX)
      .every((id) => expectedUnchanged.includes(id));
    console.log(`  606523 (Clypeodonta's own opinion) no longer cut: ${missing606523} (expect true)`);
    console.log(`  923499 (Iguanodontia's pooled opinion) now cut instead: ${has923499} (expect true)`);
    console.log(`  All ${expectedUnchanged.length} other pre-fix cuts still present (no regression): ${unchangedCutsSurvive} (expect true)`);
    console.log(`  No unexpected new cuts introduced: ${noUnexpectedNewCuts} (expect true)`);
    console.log(`  Total cuts: ${cutIds.length} (expect ${EXPECTED_CUTS_BEFORE_FIX.length})`);

    const ok =
      clypeodontaUnderOrnithopoda &&
      ornithopodaNotUnderClypeodonta &&
      ornithopodaUnderCerapoda &&
      missing606523 &&
      has923499 &&
      unchangedCutsSurvive &&
      noUnexpectedNewCuts &&
      cutIds.length === EXPECTED_CUTS_BEFORE_FIX.length;

    console.log('');
    console.log(ok ? 'PASS' : 'FAIL');
    if (!ok) process.exitCode = 1;
  } finally {
    client.release();
    await closePgPlay();
  }
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exitCode = 1;
});
