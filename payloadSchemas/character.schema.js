/*
Validation schemas in JSON Schema format. Note that fastify uses ajv (https://ajv.js.org/) for validation, which expects the schemas to be javascript objects rather than raw JSON. Consequently, property names (keys) do not require double quotes.
*/

export const characterSchema = {
    $schema: "https://json-schema.org/draft/2019-09/schema",
    $id: "https://pbdb2.example.com/schemas/character.json",
    title: "Character",
    description: "A character payload in the PBDB database",
    type: "object",
    unevaluatedProperties: false, //new with Draft 2019-09
    properties: {
        character: {
            type: "object",
            unevaluatedProperties: false, //new with Draft 2019-09
            required: [
                "name",
                "definition",
                //"schemaDefinition"
            ],
            properties: {
                legacyIDs: {
                    type: "object",
                    properties: {
                        pbotID: {
                            type: "string",
                            description: "Legacy ID for characters migrated from PBot"
                        },
                    }
                },
                name: {
                    type: "string"
                },
                definition: {
                    type: "string"
                },
                order: {
                    type: "integer",
                    minimum: 1
                }
            }
        }
    }
}
