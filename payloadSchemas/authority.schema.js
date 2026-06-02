/*
Validation schemas in JSON Schema format. Note that fastify uses ajv (https://ajv.js.org/) for validation, which expects the schemas to be javascript objects rather than raw JSON. Consequently, property names (keys) do not require double quotes.
*/

export const authoritySchema = {
    $schema: "https://json-schema.org/draft/2019-09/schema",
    $id: "https://pbdb2.example.com/schemas/authority.json",
    title: "Authority",
    description: "An authority payload in the PBDB database",
    type: "object",
    unevaluatedProperties: false, //new with Draft 2019-09
    properties: {
        authority: {
            type: "object",
            properties: {
                legacyIDs: {
                    type: "object",
                    properties: {
                        oldpbdbIDs: {
                            type: "array",
                            items: { type:"string" },
                            description: "Legacy IDs for authorities migrated from old PBDB"
                        }
                    }
                },
                citation: {
                    type: "string"
                },
                descriptors: {
                    type: "array",
                    items: {
                        type: "string"
                    }
                },
                year: {
                    type: "string",
                    maxLength: 4
                },
                publishedInReference: {
                    type: "boolean"
                }
            },
            unevaluatedProperties: false, //new with Draft 2019-09
            required: [
                "publishedInReference", "citation"
            ],
        }
    }
}
