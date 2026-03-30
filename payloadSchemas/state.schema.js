/*
Validation schemas in JSON Schema format. Note that fastify uses ajv (https://ajv.js.org/) for validation, which expects the schemas to be javascript objects rather than raw JSON. Consequently, property names (keys) do not require double quotes.
*/

export const stateSchema = {
    $schema: "https://json-schema.org/draft/2019-09/schema",
    $id: "https://pbdb2.example.com/schemas/state.json",
    title: "State",
    description: "A state payload in the PBDB database",
    type: "object",
    unevaluatedProperties: false, //new with Draft 2019-09
    properties: {
        state: {
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
                            description: "Legacy ID for states migrated from PBot"
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
                    type: "integer"
                    minimum: 1
                }
            }
        }
    }
}
