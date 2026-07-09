// Shared UUIDv7 generator for permid values.
//
// This is the single swap point for the permid generation strategy: every
// migration script that mints a permid imports `uuidv7` from here instead of
// generating UUIDs inline. To change the strategy later (e.g. move to the
// native PostgreSQL `uuidv7()` function once the DB is on PG18), change it here.
//
// Backed by the `uuid` package's `v7`, which produces RFC 9562 UUIDv7 values
// (time-ordered, with a monotonic counter within the same millisecond).
import { v7 as uuidv7 } from 'uuid';

export { uuidv7 };
