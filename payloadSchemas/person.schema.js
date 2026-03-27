/*
Validation schemas in JSON Schema format. Note that fastify uses ajv (https://ajv.js.org/) for validation, which expects the schemas to be javascript objects rather than raw JSON. Consequently, property names (keys) do not require double quotes.
*/

export const personSchema = {
    $schema: "https://json-schema.org/draft/2019-09/schema",
    $id: "https://pbdb2.example.com/schemas/person.json",

    title: "Person",
    description: "A person payload in the PBDB database",
    type: "object",
    unevaluatedProperties: false, //new with Draft 2019-09
    properties: {
        person: {
            type: "object",
            unevaluatedProperties: false, //new with Draft 2019-09
            required: [
                "familyName",
                "givenName",
                "gender"
            ],
            properties: {
                legacyIDs: {
                    type: "object",
                    properties: {
                        oldpbdbID: {
                            type: "string",
                            description: "Legacy ID for persons migrated from old PBDB"
                        },
                        pbotID: {
                            type: "string",
                            description: "Legacy ID for persons migrated from PBot"
                        }
                    }
                },
                givenName: {
                    type: "string",
                },
                familyName: {
                    type: "string",
                },
                middle: {
                    type: "string",
                },
                email: {
                    type: "string",
                },
                orcid: {
                    type: "string",
                },
                countryCode: {
                    type: "string",
                },
                institution: {
                    type: "string",
                },
                gender: {
                    type: "string",
                    enum: [ //TODO: pull from dictionaries.genders
                        "Male", "Female", "Other", "Anonymous"
                    ]
                },
            }
        }
    }
};


