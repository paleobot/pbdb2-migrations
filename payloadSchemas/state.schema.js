/*
 * Annotated source for the state payload: a node under a character (or another
 * state) in a PBot schema's tree. Every schema used anywhere (jsonb at rest,
 * create body, PATCH guard, response) is derived from this one object; see
 * payloadSchemas/lib/variants.js and payloadSchemas/DESIGN_NOTES.md. Annotations
 * are described in collection.schema.js.
 *
 * `definition` and `name` are as on character.schema.js.
 *
 * `quantitative` is states.quantitative, set by the client and not readOnly:
 * any state may be quantitative, whatever its name. It is optional; the column
 * defaults to false. PBot marked quantitative states by the name "quantity", and
 * the PBot migration still derives the flag that way. A quantitative state's
 * measured value is not part of the state: it belongs to an observation of it
 * (in PBot, a property of a Description's CharacterInstance link to the state).
 *
 * The parent (states.parent_character_id or parent_state_id) and sibling order
 * (sort_order) are columns only, as on character. authorizer_person_id and
 * enterer_person_id are provenance and get no field.
 */

const stateProperties = {
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
				description: "Legacy ID for states migrated from PBot"
			}
		}
	},
	name: {type: "string"},
	definition: {type: "string"},
	quantitative: {
		type: "boolean",
		"x-storage": { column: "quantitative" },
		description: "Whether an observation of this state records a measured value"
	}
};

export const stateSource = {
	$schema: "https://json-schema.org/draft/2019-09/schema",
	$id: "https://pbdb2.example.com/schemas/state.json",
	title: "State",
	description: "A state payload in the PBDB database",
	type: "object",
	properties: stateProperties,
	required: ["name"],
	"x-create": {
		properties: {
			name: { type: "string", minLength: 1 }
		}
	},
	unevaluatedProperties: false,
};

export default stateSource;
