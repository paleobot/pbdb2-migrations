/*
 * Annotated source for the schema payload: a PBot morphological schema, the root
 * of a character/state tree. Every schema used anywhere (jsonb at rest, create
 * body, PATCH guard, response) is derived from this one object; see
 * payloadSchemas/lib/variants.js and payloadSchemas/DESIGN_NOTES.md. Annotations
 * are described in collection.schema.js.
 *
 * The jsonb keys are the ones src/pbot-schemas-migration writes, so none is
 * renamed.
 *
 * `references` are the schema's citations as reference permids: the first is
 * schemas.reference_id, the rest are additional_schema_refs rows, as on
 * collection (the referenceList codec). Required in the base, which costs `db`
 * nothing and lets `out` guarantee it, since the column is NOT NULL.
 *
 * `year` is loose at rest and four digits on create, as on authority.
 *
 * The characters and states under a schema are their own tables and are not part
 * of this payload. Whether the API creates a whole tree in one call is not
 * decided; the sketch for that option is kept in a comment at the end of this
 * file. authorizer_person_id and enterer_person_id are provenance and get no field.
 */

const schemaProperties = {
	permid: {
		type: "string",
		readOnly: true,
		"x-storage": { column: "permid" },
		description: "Permanent identifier, constant across versions"
	},
	legacyIDs: {
		type: "object",
		readOnly: true,
		properties: {
			pbotID: {
				type: "string",
				description: "Legacy ID for schemas migrated from PBot"
			}
		}
	},
	references: {
		type: "array",
		items: {
			type: "object",
			required: ["referenceID", "order"],
			properties: {
				referenceID: {
					type: "string",
					description: "permid of the cited reference"
				},
				order: {
					type: "string",
					description: "Order of the reference"
				}
			}
		},
		minItems: 1,
		"x-storage": { table: "additional_schema_refs", codec: "referenceList" },
		description: "List of references for this schema"
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
				familyName: {type: "string"},
				givenName: {type: "string"},
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
			"x-enumFrom": { table: "parts_preserved", column: "name" }
		}
	},
	notableFeatures: {
		type: "array",
		items: {
			type: "string",
			"x-enumFrom": { table: "notable_features", column: "name" }
		}
	}
};

export const schemaSource = {
	$schema: "https://json-schema.org/draft/2019-09/schema",
	$id: "https://pbdb2.example.com/schemas/schema.json",
	title: "Schema",
	description: "A schema payload in the PBDB database",
	type: "object",
	properties: schemaProperties,
	required: ["title", "year", "references"],
	"x-create": {
		properties: {
			year: { type: "string", pattern: "^[0-9]{4}$" }
		}
	},
	unevaluatedProperties: false,
};

export default schemaSource;

/*
 * Sketch, not part of the payload: the option in which one API call creates a
 * schema with its whole character/state tree. It would add schemaDefinition to
 * the create body and needs $defs/$ref support in deriveVariant, which does not
 * exist yet. Separate schema, character and state routes would need neither.
 * Its state rule "name = quantity requires value" predates states.quantitative,
 * and a measured value belongs to an observation of a state, not to the state.
 *
 * $defs: {
 *     state: {
 *         type: "object",
 *         properties: {
 *             legacyIDs: {
 *                 type: "object",
 *                 properties: {
 *                     pbotID: {
 *                         type: "string",
 *                         description: "Legacy ID for states migrated from PBot"
 *                     },
 *                 }
 *             },
 *             name: {
 *                 type: "string"
 *             },
 *             definition: {
 *                 type: "string"
 *             },
 *             order: {
 *                 type: "integer",
 *                 minimum: 1
 *             },
 *             states: {
 *                 type: "array",
 *                 items: {
 *                     $ref: "#/$defs/state"
 *                 }
 *             }
 *         },
 *         // quantitative conditional
 *         if: {
 *             required: ["name"],
 *             properties: {
 *                 name: {
 *                     const: "quantity"
 *                 }
 *             }
 *         },
 *         then: {
 *             properties: {
 *                 value: {
 *                     type: "string"
 *                 }
 *             },
 *             required: ["value"]
 *         }
 *     },
 *
 *     character: {
 *         type: "object",
 *         properties: {
 *             legacyIDs: {
 *                 type: "object",
 *                 properties: {
 *                     pbotID: {
 *                         type: "string",
 *                         description: "Legacy ID for characters migrated from PBot"
 *                     },
 *                 }
 *             },
 *             name: {
 *                 type: "string"
 *             },
 *             definition: {
 *                 type: "string"
 *             },
 *             order: {
 *                 type: "integer",
 *                 minimum: 1
 *             },
 *             states: {
 *                 type: "array",
 *                 items: {
 *                     $ref: "#/$defs/state"
 *                 }
 *             },
 *             characters: {
 *                 type: "array",
 *                 items: {
 *                     $ref: "#/$defs/character"
 *                 }
 *             }
 *         }
 *     }
 * },
 *
 * schemaDefinition: {
 *     //$ref: "https://pbdb2.example.com/schemas/schemaDefinition.json"
 *     type: "object",
 *     properties: {
 *         characters: {
 *             type: "array",
 *             items: { $ref: "#/$defs/character" }
 *         }
 *     }
 * }
 */
