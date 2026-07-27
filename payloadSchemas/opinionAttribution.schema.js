/*
Validation schemas in JSON Schema format. Note that fastify uses ajv (https://ajv.js.org/) for validation, which expects the schemas to be javascript objects rather than raw JSON. Consequently, property names (keys) do not require double quotes.
*/

/*
DRAFT — companion to postgresql/taxa-opinions-draft.sql, which is itself a draft
for discussion and has never been run. Delete this file if the opinion tables'
`attribution` column does not survive review.

This exists because the opinion tables must NOT reuse authoritySchema. That
schema describes an *authority record*: it carries legacyIDs.oldpbdbIDs and
publishedInReference, both meaningless on an opinion, and it sets
unevaluatedProperties: false, so it cannot be borrowed without dragging them in.

Deliberately AUTHORS ONLY — there is no `year` here, even though authoritySchema
has one. The publication year lives in the opinion tables' own `pubyr` integer
column because derive() sorts on it: every input to derive() is a typed,
constrained, indexable column, and everything else is payload. Putting the year
in both places would store one fact twice with nothing enforcing agreement.

Shape follows the authorities migration convention: `citation` preserves the raw
author string as published, `descriptors` holds the family names parsed out of
it (decode-entities -> split on [,;:&] -> trim -> drop empty/"et al.").
*/

export const opinionAttributionSchema = {
    $schema: "https://json-schema.org/draft/2019-09/schema",
    $id: "https://pbdb2.example.com/schemas/opinionAttribution.json",
    title: "Opinion attribution",
    description: "Who a second-hand taxonomic opinion is attributed to, when that differs from the authors of the reference reporting it. Omitted entirely when the reference is itself the source.",
    type: "object",
    unevaluatedProperties: false, //new with Draft 2019-09
    properties: {
        attribution: {
            type: "object",
            unevaluatedProperties: false, //new with Draft 2019-09
            required: [
                "citation"
            ],
            properties: {
                citation: {
                    type: "string",
                    description: "Raw author string as published, preserved uncleaned"
                },
                descriptors: {
                    type: "array",
                    items: {
                        type: "string"
                    },
                    description: "Family names parsed out of citation"
                }
            }
        }
    }
}
