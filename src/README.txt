To run full migration on clean db:
    cd ~/repos/pbdb2-migrations
    dropdb   -h localhost -U postgres pbdb
    createdb -h localhost -U postgres pbdb
    node src/run-migrations.js --createdb

Run order (src/run-migrations.js; the authoritative statement is the run-order
table in openspec/specs/migration-runner/spec.md):

     1  persons             src/persons-migration/migrate-persons.js
     2  pbot-persons        src/pbot-persons-migration/migrate-pbot-persons.js
     3  refs                src/refs-migration/migrate-refs.js
     4  pbot-refs           src/pbot-refs-migration/migrate-pbot-refs.js
     5  pbot-schemas        src/pbot-schemas-migration/migrate-pbot-schemas.js
     6  authorities         src/authorities-migration/migrate-authorities.js
     7  authority-opinions  src/authority-opinions-migration/migrate-authority-opinions.js
     8  opinions            src/opinions-migration/migrate-opinions.js
     9  collections         src/collections-migration/migrate-collections.js
    10  specimens           src/specimens-migration/migrate-specimens.js

After the last selected step, the runner audits stored payloads
(src/audit-payloads.js) for the audited entities those steps wrote: collections
and/or specimens. A run whose steps write neither (e.g. --only persons) skips
the audit. To audit the whole database outside a run:
    node src/audit-payloads.js                 # every row vs. the db schema
    node src/audit-payloads.js --round-trip    # plus merge/split round trip
The latest report is written to src/audit-payloads.log.

To run one step, or to resume from one:
    node src/run-migrations.js --only specimens
    node src/run-migrations.js --from collections
    node src/run-migrations.js --list

The specimens step migrates classic `specimens` only (167,150 rows). Occurrences
and measurements are separate, later migrations; `oldpbdb_occurrence_no` is the
join key they will attach to. Most specimens carry no taxon of their own, so
`name_opinions_permid` is NULL on 144,690 rows by design — see
openspec/specs/specimen-migration/spec.md and design.md D1.
