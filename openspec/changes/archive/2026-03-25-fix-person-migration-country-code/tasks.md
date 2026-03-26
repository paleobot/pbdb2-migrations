## 1. Remove `dictionaries.countries` dependency

- [x] 1.1 Remove the INSERT INTO `dictionaries.countries` for "Unknown" country (lines 94-98)
- [x] 1.2 Remove the SELECT query for `unknownCountryId` (lines 99-103)
- [x] 1.3 Remove the SELECT query that loads `allCountryRows` into `countryMap` (lines 120-124)

## 2. Add `@countrystatecity/countries` package lookup

- [x] 2.1 Add `import { getCountries } from '@countrystatecity/countries'` at top of file
- [x] 2.2 Call `await getCountries()` at startup and build a case-insensitive `name → iso2` lookup map

## 3. Update country normalization map

- [x] 3.1 Remove `'russia': 'Russian Federation'` entry (direct match in package as "Russia")
- [x] 3.2 Remove `'venezuela': 'Venezuela, Bolivarian Republic of'` entry (direct match in package as "Venezuela")
- [x] 3.3 Retain remaining entries: US, USA, Untied States → United States; England → United Kingdom; The Netherlands → Netherlands

## 4. Update country mapping logic

- [x] 4.1 Replace `countryId` logic (lines 176-186) to resolve through the package lookup map, producing an ISO code string or `NULL`
- [x] 4.2 Change default from `unknownCountryId` to `null` for unmapped/empty countries
- [x] 4.3 Preserve warning log for unmapped country values (include `person_no` and original value)

## 5. Update INSERT/UPSERT statement

- [x] 5.1 Change column name from `country_id` to `country_code` in INSERT and ON CONFLICT clauses
- [x] 5.2 Change parameter value from `countryId` (integer) to `countryCode` (string/null)

## 6. Verify

- [x] 6.1 Run `migrate-persons.js` against local databases and confirm no errors
- [x] 6.2 Verify row count matches source (existing verification logic)
- [x] 6.3 Spot-check country_code values: confirm known countries (e.g., "Germany" → "DE", "USA" → "US") and NULL for unmapped
