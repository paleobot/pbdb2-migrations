/*
 * Annotated source for the specimen payload. Every schema used anywhere (jsonb
 * at rest, create body, PATCH guard, response) is derived from this one object;
 * see payloadSchemas/lib/variants.js and payloadSchemas/DESIGN_NOTES.md.
 * Annotations are described in collection.schema.js.
 *
 * The specimen's other column links (reference_id, collection_id,
 * name_opinions_permid) get API fields when the API is designed.
 */

const specimenProperties = {
	permid: {
		type: "string",
		readOnly: true,
		"x-storage": { column: "permid" },
		description: "Permanent identifier, constant across versions"
	},
	name: {type: "string"},
	type: {
		// Nomenclatural type status: a closed set that rules will depend on.
		type: "string",
		enum: ['holotype','paratype','some paratypes']
	},
	legacyIDs: {
		type: "object",
		readOnly: true,
		properties: {
			oldpbdbID: {
				type: "string",
				description: "Legacy ID for specimens migrated from old PBDB"
			},
			pbotID: {
				type: "string",
				description: "Legacy ID for specimens migrated from PBot"
			},
		}
	},
	identifiers: {
		type: "object",
		properties: {
			institutionCode: {
				type: "string",
				"x-enumFrom": { table: "institution_codes", column: "code" }
			},
			catalogNumber: {type: "string"},
			GBIF: {type: "string"}
		}
	},
	paleontology : {
		type: "object",
		properties: {
			preservationModes: {
				type: "array",
				items: {
					type: "string",
					"x-enumFrom": { table: "preservation_modes", column: "name" }
				},
 			},
			numberMeasured:	{type: "number"},
			coverage: {
				type: "string",
				enum: ["all", "some"]
			},
			side: {
				type: "string",
				enum: ['left','right','left?','right?','upper','lower','upper left','upper right','lower left','lower right','dorsal','ventral','both']
			},
			sex: {
				type: "string",
				enum: ["female", "male", "both"]
			},
			part: {type: "string"},
			measurementSource: {
				type: "string",
				enum: ['text','table','picture','graph','direct']
			},
			magnification: {type: "string"}
		}
	},
	notes: {type: "string"},
}

export const specimenSource = {
	$schema: "https://json-schema.org/draft/2019-09/schema",
	$id: "https://pbdb2.example.com/schemas/specimen.json",
	title: "Specimen",
	description: "A specimen payload in the PBDB database",
	type: "object",
	properties: specimenProperties,
	required: ["name"],
	unevaluatedProperties: false,
};

export default specimenSource;
