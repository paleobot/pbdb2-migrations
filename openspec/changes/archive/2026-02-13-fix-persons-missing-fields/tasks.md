## 1. Lookup Setup

- [x] 1.1 Load all `dictionaries.genders` into a name→id map (Male, Female, Other, Anonymous)
- [x] 1.2 Load all `dictionaries.countries` into a case-insensitive `full_name`→id map
- [x] 1.3 Define the country normalization map: `"US"→"United States"`, `"USA"→"United States"`, `"Untied States"→"United States"`, `"England"→"United Kingdom"`, `"The Netherlands"→"Netherlands"`
- [x] 1.4 Define the gender mapping: `'F'→"Female"`, `'M'→"Male"`, `NULL→"Anonymous"`

## 2. Source Query Update

- [x] 2.1 Add `middle`, `email`, `institution`, `country`, `gender` to the MariaDB SELECT query

## 3. Transform Logic Updates

- [x] 3.1 After `mapName()`, override `middle` with the source `row.middle` field when non-empty (trimmed); fall back to the parsed value otherwise
- [x] 3.2 Map `row.email` — trim whitespace, convert empty string to NULL
- [x] 3.3 Map `row.institution` — trim whitespace, convert empty string to NULL
- [x] 3.4 Map `row.gender` to `gender_id` using the genders map; log warning for unexpected values; default to Anonymous
- [x] 3.5 Map `row.country` to `country_id` — apply normalization map first, then case-insensitive lookup in countries map; log warning for unmapped values; default to Unknown

## 4. Upsert Update

- [x] 4.1 Replace hardcoded NULL/defaults for `email`, `institution`, `gender_id`, `country_id` with the mapped values in the INSERT parameters
- [x] 4.2 Add `email`, `institution`, `gender_id`, `country_id`, `middle` to the ON CONFLICT UPDATE SET clause

## 5. Testing

- [x] 5.1 Run the updated migration script and confirm it completes without errors
- [x] 5.2 Verify row count still matches (1,304 rows)
- [x] 5.3 Spot-check: confirm a person with `gender='F'` has `gender_id` = Female's id
- [x] 5.4 Spot-check: confirm a person with `country='United States'` has the correct `country_id`
- [x] 5.5 Spot-check: confirm a person with `country='USA'` or `'Untied States'` maps to "United States"
- [x] 5.6 Spot-check: confirm a person with source `middle` field populated uses that value over parsed middle
- [x] 5.7 Spot-check: confirm `email` and `institution` are carried over
- [x] 5.8 Run the script a second time to confirm idempotency
