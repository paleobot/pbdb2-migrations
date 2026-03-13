/*
Validation schemas in JSON Schema format. Note that fastify uses ajv (https://ajv.js.org/) for validation, which expects the schemas to be javascript objects rather than raw JSON. Consequently, property names (keys) do not require double quotes.
*/

export const schemaSchema = {
    $schema: "https://json-schema.org/draft/2019-09/schema",
    $id: "https://pbdb2.example.com/schemas/schema.json",
    $defs: {
        state: {
            type: "object",
            properties: {
                name: {
                    type: "string"
                },
                definition: {
                    type: "string"
                },
                order: {
                    type: "integer",
                    minimum: 1
                },
                states: {
                    type: "array",
                    items: {
                        $ref: "#/$defs/state"
                    }
                }
            },
            // quantitative conditional
            if: {
                properties: {
                    name: {
                        const: "quantity"
                    }
                }
            },
            then: {
                properties: {
                    value: {
                        type: "string"
                    }
                },
                required: ["value"]
            }
        },

        character: {
            type: "object",
            properties: {
                name: {
                    type: "string"
                },
                definition: {
                    type: "string"
                },
                order: {
                    type: "integer",
                    minimum: 1
                },
                states: {
                    type: "array",
                    items: {
                        $ref: "#/$defs/state"
                    }
                },
                characters: {
                    type: "array",
                    items: {
                        $ref: "#/$defs/character"
                    }
                }
            }
        }
    },

    title: "Schema",
    description: "A schema payload in the PBDB database",
    type: "object",
    unevaluatedProperties: false, //new with Draft 2019-09
    required: [
        "title",
        "year",
        "schemaDefinition"
    ],
    properties: {
        legacyIDs: {
            type: "object",
            properties: {
                pbotID: {
                    type: "string",
                    description: "Legacy ID for schemas migrated from PBot"
                },
            }
        },
        title: {
            type: "string",
            description: "Name of the schema"
        },
        year: {
            type: "string",
            maxLength: 4
        },
        purpose: {
            type: "string",
            description: "Purpose of the schema"
        },
        authors: {
            type: "array",
            minItems: 1,
            items: {
                type: "object",
                properties: {
                    familyName: {
                        type: "string",
                    },
                    givenName: {
                        type: "string",
                    },
                    order: {
                        type: "integer",
                        minimum: 1
                    }
                }
            }
        },
        acknowledgments: {
            type: "string",
            description: "Acknowledgments for schema"
        },
        partsPreserved: {
            type: "array",
            items: {
                type: "string",
                enum: [ //TODO: pull from dictionaries.parts_perserved
                    "root",
                    "shoot/axis/wood",
                    "leaf",
                    "pollen/spore",
                    "inflorescence/flower",
                    "infructescence/fruit",
                    "ovuliferous (seed) cone",
                    "staminate (pollen) cone",
                    "seed",
                    "cuticle",
                    "other",
                    "unknown"
                ]
            }
        },
        notableFeatures: {
            type: "array",
            items: {
                type: "string",
                enum: [ //TODO: pull from dictionaries.notable_features
                    "cuticle/epidermal features",
                    "wood anatomy (secondary growth)",
                    "internal anatomy",
                    "trace fossils (e.g., insect damage)"
                ]
            }
        },
        schemaDefinition: {
            //$ref: "https://pbdb2.example.com/schemas/schemaDefinition.json"
            type: "object",
            properties: {
                characters: {
                    type: "array",
                    items: { $ref: "#/$defs/character" }
                }
            }
        }
    }
};


