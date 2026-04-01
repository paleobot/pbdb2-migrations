# Schema API Response Format: JSON Object vs JSON Schema

## Context

The `/schema/:permid` endpoint returns a schema with its character/state tree. Schemas serve as pallets for defining descriptions of specimens and taxa. A typical client use case is fetching a schema to build a form — characters become form fields, states become allowed values, and the tree structure (characters containing sub-characters, states containing sub-states) maps to nested form sections.

The question: would returning a JSON Schema be more useful than the current domain-native JSON object?

## Current Response Format

The endpoint returns a plain JSON object with the full domain model:

- Schema metadata (title, year, purpose, authors, references, etc.)
- Characters as a nested tree, each with name, definition, order, and pbotID
- States nested under their parent characters (or parent states), each with name, definition, order, and pbotID

## Arguments For JSON Schema

- **Direct form generation** — Libraries like `react-jsonschema-form`, `ajv`, and others can take a JSON Schema and render a form automatically. Characters map to `properties`, states map to `enum` values, sub-characters become nested `object` properties, and `definition` fields map naturally to `description`. The client wouldn't need custom tree-walking logic.
- **Built-in validation** — The same JSON Schema that generates the form can validate the submitted description. You get form generation and input validation from a single artifact.
- **Standard contract** — JSON Schema is a well-known spec. Any client in any language can consume it without understanding the domain model. Interoperability comes for free.
- **Quantitative states** — The `quantitative` flag on states maps cleanly to `type: "number"` vs `type: "string"` with `enum`, giving type-aware form inputs without custom logic.

## Arguments Against JSON Schema

- **Lossy transformation** — JSON Schema has no native concept of `order`, `pbotID`, `definition` (as distinct from `description`), or provenance metadata. These would need to go into `x-` extension fields or be lost. The current response preserves the full domain model.
- **Nested states are awkward** — States can contain sub-states (multi-level), which doesn't map cleanly to JSON Schema's `enum`. You'd need `oneOf` with nested objects, which gets complex and makes form libraries struggle.
- **Two consumers, two needs** — A form builder wants JSON Schema, but other consumers (visualization, export, diffing between schema versions) want the raw tree. Returning only JSON Schema forces those consumers to reverse-engineer the domain model. You might end up needing both endpoints.
- **Coupling** — Returning JSON Schema couples the API to the JSON Schema spec version and the assumptions of whatever form library the client uses. Changes to character/state structure require updating the transformation logic rather than just passing through the data.

## Middle Path

Return the current domain-native JSON (lossless and general-purpose) and have the client — or a thin utility — transform it into JSON Schema at the point of use. Alternatively, offer both via content negotiation (`Accept: application/schema+json` vs `application/json`).
