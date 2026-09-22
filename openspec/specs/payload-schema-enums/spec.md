# payload-schema-enums Specification

## Purpose
Source the enums of payload JSON Schemas from `dictionaries` tables through the `x-enumFrom` annotation and a generic resolver (`payloadSchemas/lib/enums.js`). Defines which vocabularies are table-backed (open vocabularies) and which stay inline (closed sets code depends on), and requires the backing tables to reproduce the pre-dictionary enums exactly.

## Requirements

### Requirement: `x-enumFrom` declares an enum backed by a dictionaries table
A string schema in a payload schema source MAY carry `"x-enumFrom": { "table": <name>, "column": <name> }` in place of a literal `enum`. `table` SHALL name a table in the `dictionaries` postgres schema. The schema is implied and SHALL NOT be written in the annotation. `table` and `column` SHALL each match `/^[a-z_][a-z0-9_]*$/`. An annotation that fails this pattern, carries keys other than `table` and `column`, or appears on the same schema as a literal `enum`, SHALL cause resolution to throw.

#### Scenario: Valid annotation
- **WHEN** a source declares `institutionCode: { type: "string", "x-enumFrom": { table: "institution_codes", column: "code" } }`
- **THEN** the resolver reads `dictionaries.institution_codes.code`

#### Scenario: Schema-qualified or unsafe identifier rejected
- **WHEN** an annotation declares `table: "public.persons"` or `column: "code; DROP TABLE x"`
- **THEN** resolution throws naming the offending annotation, and no query is issued

#### Scenario: Marker and literal enum on the same schema
- **WHEN** a schema carries both `x-enumFrom` and `enum`
- **THEN** resolution throws, because the source of truth would be ambiguous

### Requirement: The resolver fills each marker from its table without mutating the source
`resolveEnums(pg, schema)` SHALL return a deep clone of `schema` in which every schema carrying `x-enumFrom` also carries an `enum` array. The array SHALL hold the non-NULL values of the named column, ordered by the table's `id` ascending, with duplicates removed and the first occurrence kept. The `x-enumFrom` annotation SHALL remain on the resolved schema. The input schema object SHALL NOT be modified. Each distinct `(table, column)` pair SHALL be queried at most once per call, however many times it appears.

#### Scenario: Seed order preserved
- **WHEN** `dictionaries.dating_methods` holds `name` values inserted in the order `'Ar/Ar'`, `'astronomical'`, `'14C'`
- **THEN** the resolved `enum` is `['Ar/Ar', 'astronomical', '14C']`

#### Scenario: Source object untouched
- **WHEN** `resolveEnums` is called twice on the same imported source schema
- **THEN** the imported source still has no `enum` on its annotated schemas, and both results are equal

#### Scenario: Shared table queried once
- **WHEN** a schema references `preservation_modes.name` from two different properties
- **THEN** one query is issued and both properties receive the same `enum`

### Requirement: An empty resolved enum is a hard failure
If any `(table, column)` resolves to zero values, resolution SHALL throw an error naming the table and column, and SHALL NOT return a schema. A missing table or column SHALL likewise throw.

#### Scenario: Empty dictionary
- **WHEN** `dictionaries.lithologies` exists but holds no rows
- **THEN** resolution throws naming `dictionaries.lithologies.name`, before any caller compiles or validates

#### Scenario: Missing table
- **WHEN** an annotation names a table that does not exist in `dictionaries`
- **THEN** resolution throws naming that table

### Requirement: Inline enums are left alone
The resolver SHALL NOT alter any schema that carries a literal `enum` and no `x-enumFrom`.

#### Scenario: Closed set unchanged
- **WHEN** a source declares `unit: { type: "string", enum: ["meters", "feet"] }`
- **THEN** the resolved schema's `unit.enum` is exactly `["meters", "feet"]`

### Requirement: Resolution has a pure core usable without a database
The enum tooling SHALL expose:
- `collectEnumSources(schema)`: returns the distinct `(table, column)` pairs.
- `loadEnums(pg, sources)`: returns a `Map` from pair to values.
- `applyEnums(schema, map)`: returns the resolved clone. It performs no I/O and throws when any collected pair is missing from the map or maps to an empty array.

`resolveEnums` SHALL be the composition of the three.

#### Scenario: Tests resolve from fixtures
- **WHEN** a test calls `applyEnums(source, fixtureMap)` with no database connection
- **THEN** it receives a resolved schema that ajv can compile

#### Scenario: Incomplete fixture map
- **WHEN** `fixtureMap` omits a pair that `collectEnumSources` reports
- **THEN** `applyEnums` throws naming the missing pair

### Requirement: Open vocabularies use `x-enumFrom`; closed sets stay inline
An enum SHALL be sourced from a dictionaries table when it is a vocabulary curators may extend without a code change. It SHALL remain an inline `enum` when it is a closed set that code depends on or that belongs to a placeholder object awaiting redesign. For the collection, specimen and person sources, the assignment SHALL be:

| Entity | Path | Source |
|---|---|---|
| collection | `context.collectionMethods[]` | `collection_methods.name` |
| collection | `location.toponym.administrativeArea.admin0` | `admin0.iso` |
| collection | `location.toponym.administrativeArea.admin1` | `admin1.iso` |
| collection | `location.toponym.maritimeArea` | `maritime.iho_name` |
| collection | `location.coordinates.basis` | `coordinate_bases.name` |
| collection | `location.scale` | `geographic_scales.name` |
| collection | `lithofacies[].lithology` | `lithologies.name` |
| collection | `lithofacies[].adjectives[]` | `lithology_adjectives.name` |
| collection | `ages.measurements[].method` | `dating_methods.name` |
| collection | `paleontology.preservation.modes[]` | `preservation_modes.name` |
| specimen | `identifiers.institutionCode` | `institution_codes.code` |
| specimen | `paleontology.preservationModes[]` | `preservation_modes.name` |
| person | `gender` | `genders.name` |
| person | `role` | `roles.name` |
| person | `countryCode` | `admin0.iso` |

Every other enum on these three sources SHALL remain inline: `altitude.unit`, `lithification`, `stratigraphy.scale`, `ages.measurements[].unit`, `measurementType`, `environment.name`, `environment.tectonicSetting`, `paleontology.sizeClasses[]`, specimen `type`, `coverage`, `side`, `sex`, `measurementSource`. The admin1-required country list is a policy rule, not a vocabulary, and SHALL also remain inline.

The person source carries no inline enum at all once these three are resolved. Its `gender` previously held a
hardcoded four-value array annotated `//TODO: pull from dictionaries.genders`; `role` is a vocabulary curators
extend by inserting a role; and `countryCode` shares `admin0.iso` with collection rather than being resolved
from a separate npm package, so one list of countries backs both entities.

#### Scenario: Open vocabulary is table-backed
- **WHEN** the collection source is inspected at `lithofacies[].lithology`
- **THEN** it carries `x-enumFrom: { table: "lithologies", column: "name" }` and no literal `enum`

#### Scenario: Closed set is inline
- **WHEN** the collection source is inspected at `ages.measurements[].unit`
- **THEN** it carries the literal `enum: ["Ma", "Ka", "YBP"]` and no `x-enumFrom`

#### Scenario: Person gender is table-backed
- **WHEN** the person source is inspected at `gender`
- **THEN** it carries `x-enumFrom: { table: "genders", column: "name" }` and no literal `enum`

#### Scenario: One country vocabulary for two entities
- **WHEN** the person and collection sources are both resolved
- **THEN** person `countryCode` and collection `location.toponym.administrativeArea.admin0` receive the same `enum`, read from `dictionaries.admin0.iso` in one query

### Requirement: New dictionary tables reproduce the legacy enums exactly
`postgresql/create_new.sql` SHALL create, in the `dictionaries` schema:
- `collection_methods`, `coordinate_bases`, `geographic_scales`, `lithologies`, `lithology_adjectives`, `dating_methods`, `preservation_modes`, each with `id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY` and `name text NOT NULL UNIQUE`;
- `institution_codes`, with the same `id` and `code text NOT NULL UNIQUE`.

Each table SHALL be seeded with exactly the values of the inline enum it replaces, in the same order, byte for byte, including embedded double quotes (e.g. `"siliciclastic"`) and existing misspellings (e.g. `hydroflouric`). Before the schema sources are rewritten, the replaced arrays SHALL be snapshotted to `payloadSchemas/tests/fixtures/legacy-enums.json`. A test SHALL assert that each table's `name` or `code` values, ordered by `id`, equal the snapshot.

Two dictionary tables predate this convention and SHALL be renamed to it: `dictionaries.genders.genders`
becomes `name`, and `dictionaries.roles.role` becomes `name`. Neither table's rows, order, or `id` values
change, and neither column is referenced by a foreign key — the foreign keys are to `id`.

`genders` SHALL join the snapshot, because it replaces a real inline enum: it is already seeded
`('Male'),('Female'),('Other'),('Anonymous')`, byte-identical and in the same order as the array it replaces,
so resolution cannot change any validation outcome. `roles` SHALL NOT join the snapshot, because no schema
ever held its values inline and there is no legacy array to reproduce.

#### Scenario: Seed matches snapshot
- **WHEN** the seed-fidelity test runs against a database created from `create_new.sql`
- **THEN** each of the eight tables' ordered values equals its snapshot array

#### Scenario: Seed drift detected
- **WHEN** a seed omits `"reef rocks"` or corrects `hydroflouric` to `hydrofluoric`
- **THEN** the seed-fidelity test fails naming the table and the differing values

#### Scenario: Shared vocabulary seeded once
- **WHEN** `preservation_modes` is seeded
- **THEN** it holds the 37 values that the collection and specimen schemas previously each listed inline, identical in both

#### Scenario: Renamed columns follow the convention
- **WHEN** `dictionaries.genders` and `dictionaries.roles` are inspected after this change
- **THEN** each holds its values in a column named `name`, and no column named `genders` or `role` remains

#### Scenario: Genders seed matches the enum it replaces
- **WHEN** the seed-fidelity test reads `dictionaries.genders.name` ordered by `id`
- **THEN** it equals `["Male", "Female", "Other", "Anonymous"]`, the array the person schema previously held inline

#### Scenario: Roles has no snapshot
- **WHEN** the seed-fidelity test runs
- **THEN** it asserts nothing about `dictionaries.roles`, because its values were never written into a payload schema
