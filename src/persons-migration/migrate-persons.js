import { mariadb, pg, closeAll } from '../lib/db.js';
import { getCountries } from '@countrystatecity/countries';

/**
 * Derive middle name by comparing the display name against first/last.
 * Returns { givenName, familyName, middle }.
 */
function mapName(row) {
  let givenName = row.first_name?.trim() || '';
  let familyName = row.last_name?.trim() || '';
  let middle = null;

  const displayName = row.name?.trim() || '';
  const reversedName = row.reversed_name?.trim() || '';

  // If structured fields are populated, use them and try to extract middle from display name
  if (givenName && familyName) {
    if (displayName) {
      // Display name is typically "First Middle Last" — extract tokens between first and last
      const tokens = displayName.split(/\s+/);
      const firstIdx = tokens.findIndex(
        (t) => t.toLowerCase() === givenName.split(/\s+/)[0].toLowerCase()
      );
      const lastIdx = tokens.findLastIndex(
        (t) => t.toLowerCase() === familyName.split(/\s+/).slice(-1)[0].toLowerCase()
      );

      if (firstIdx !== -1 && lastIdx !== -1 && lastIdx > firstIdx + 1) {
        middle = tokens.slice(firstIdx + 1, lastIdx).join(' ') || null;
      }
    }
    return { givenName, familyName, middle };
  }

  // Fallback: parse reversed_name ("Last, First Middle")
  if (reversedName && reversedName.includes(',')) {
    const [lastPart, ...rest] = reversedName.split(',');
    familyName = lastPart.trim();
    const firstTokens = rest.join(',').trim().split(/\s+/);
    if (firstTokens.length > 0) {
      givenName = firstTokens[0];
      if (firstTokens.length > 1) {
        middle = firstTokens.slice(1).join(' ') || null;
      }
    }
    return { givenName, familyName, middle };
  }

  // Fallback: parse display name ("First Middle Last")
  if (displayName) {
    const tokens = displayName.split(/\s+/);
    if (tokens.length === 1) {
      givenName = tokens[0];
      familyName = '';
    } else if (tokens.length === 2) {
      givenName = tokens[0];
      familyName = tokens[1];
    } else {
      givenName = tokens[0];
      familyName = tokens[tokens.length - 1];
      middle = tokens.slice(1, -1).join(' ') || null;
    }
    return { givenName, familyName, middle };
  }

  // Nothing usable — log warning
  console.warn(
    `  WARNING: person_no=${row.person_no} has no usable name fields (name='${displayName}', reversed_name='${reversedName}', first_name='${row.first_name}', last_name='${row.last_name}')`
  );
  return { givenName: givenName || '', familyName: familyName || '', middle: null };
}

/**
 * Map legacy role SET + booleans to a single role_id.
 * Priority: Superadmin(1) > Admin(2) > Authorizer(3) > Enterer(4) > Student(5) > Person(6)
 */
function mapRole(row) {
  const roleSet = (row.role || '').toLowerCase();

  if (row.superuser === 1) return 1; // Superadmin
  if (roleSet.includes('officer')) return 2; // Admin
  if (row.is_authorizer === 1) return 3; // Authorizer
  if (roleSet.includes('technician')) return 4; // Enterer
  if (roleSet.includes('student')) return 5; // Student
  return 6; // Person
}

async function main() {
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] Starting person migration...`);

  // --- Dictionary lookups ---

  // Build case-insensitive country name → ISO alpha-2 code map
  const countries = await getCountries();
  const countryCodeMap = new Map(countries.map((c) => [c.name.toLowerCase(), c.iso2]));
  console.log(`  Loaded ${countries.length} countries from @countrystatecity/countries`);

  // Gender mapping: source enum → JSONB string value
  const GENDER_SOURCE_MAP = { 'F': 'Female', 'M': 'Male' };

  // Country normalization map for known variants
  const COUNTRY_NORMALIZE = {
    'us': 'United States',
    'usa': 'United States',
    'untied states': 'United States',
    'england': 'United Kingdom',
    'the netherlands': 'Netherlands',
  };

  // Load roles for verification logging
  const { rows: roleRows } = await pg.query(
    `SELECT id, role FROM dictionaries.roles ORDER BY id`
  );
  const roleMap = Object.fromEntries(roleRows.map((r) => [r.id, r.role]));
  console.log(`  Loaded ${roleRows.length} roles: ${JSON.stringify(roleMap)}`);

  // --- Read source data ---

  const [sourceRows] = await mariadb.query(
    `SELECT person_no, name, reversed_name, first_name, last_name,
            middle, email, institution, country, gender,
            role, is_authorizer, active, heir_no, superuser
     FROM person`
  );
  console.log(`  Read ${sourceRows.length} rows from MariaDB person table`);

  // --- Transform and upsert ---

  let upsertCount = 0;
  for (const row of sourceRows) {
    const { givenName, familyName, middle: parsedMiddle } = mapName(row);
    const middle = (row.middle && row.middle.trim()) || parsedMiddle;
    const roleId = mapRole(row);
    const isActive = row.active === 1;
    const id = row.person_no;

    // Map email and institution (trim, empty → null)
    const email = row.email?.trim() || null;
    const institution = row.institution?.trim() || null;

    // Map gender to string value for JSONB
    const gender = GENDER_SOURCE_MAP[row.gender] || 'Anonymous';
    if (row.gender && !GENDER_SOURCE_MAP[row.gender]) {
      console.warn(`  WARNING: person_no=${id} unexpected gender value '${row.gender}', defaulting to Anonymous`);
    }

    // Map country to ISO alpha-2 code
    let countryCode = null;
    if (row.country && row.country.trim()) {
      const rawCountry = row.country.trim();
      const normalized = COUNTRY_NORMALIZE[rawCountry.toLowerCase()] || rawCountry;
      countryCode = countryCodeMap.get(normalized.toLowerCase()) || null;
      if (!countryCode) {
        console.warn(`  WARNING: person_no=${id} unmapped country '${rawCountry}'`);
      }
    }

    // Build person JSONB object
    const personJsonb = {
      givenName,
      familyName,
      gender,
      legacyIDs: { oldpbdbID: String(id) },
    };
    if (middle) personJsonb.middle = middle;
    if (email) personJsonb.email = email;
    if (countryCode) personJsonb.countryCode = countryCode;
    if (institution) personJsonb.institution = institution;

    console.log(
      `  person_no=${id}: role SET='${row.role}' is_authorizer=${row.is_authorizer} superuser=${row.superuser} → role_id=${roleId} (${roleMap[roleId]})`
    );

    await pg.query(
      `INSERT INTO persons (id, password, role_id, person, authorizer_person_id, active, total_hours)
       VALUES ($1, NULL, $2, $3, $4, $5, NULL)
       ON CONFLICT (id) DO UPDATE SET
         role_id = EXCLUDED.role_id,
         authorizer_person_id = EXCLUDED.authorizer_person_id,
         person = EXCLUDED.person,
         active = EXCLUDED.active`,
      [
        id,                  // $1  id
        roleId,              // $2  role_id
        personJsonb,         // $3  person (JSONB)
        id,                  // $4  authorizer_person_id (self-reference)
        isActive,            // $5  active
      ]
    );
    upsertCount++;
  }

  console.log(`  Upserted ${upsertCount} rows into persons`);

  // --- Reset identity sequence ---

  await pg.query(
    `SELECT setval(pg_get_serial_sequence('persons', 'id'), (SELECT MAX(id) FROM persons))`
  );
  console.log('  Identity sequence reset');

  // --- Row count verification ---

  const { rows: countResult } = await pg.query(`SELECT COUNT(*)::int AS count FROM persons`);
  const pgCount = countResult[0].count;

  if (pgCount === sourceRows.length) {
    console.log(`  Verification PASSED: ${pgCount} rows in PostgreSQL matches ${sourceRows.length} source rows`);
  } else {
    console.warn(
      `  Verification WARNING: PostgreSQL has ${pgCount} rows but source had ${sourceRows.length} rows`
    );
  }

  const endTime = new Date();
  const elapsed = ((endTime - startTime) / 1000).toFixed(1);
  console.log(`[${endTime.toISOString()}] Person migration complete in ${elapsed}s`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exitCode = 1;
}).finally(() => closeAll());
