/*
 * Annotated source for the character payload: a node in a PBot schema's
 * character tree. Every schema used anywhere (jsonb at rest, create body, PATCH
 * guard, response) is derived from this one object; see
 * payloadSchemas/lib/variants.js and payloadSchemas/DESIGN_NOTES.md. Annotations
 * are described in collection.schema.js.
 *
 * `definition` is optional: most PBot characters have none, and a character
 * without one omits the key rather than storing null. `name` is a required
 * string at rest and non-empty on create.
 *
 * The parent (characters.parent_schema_id or parent_character_id) and sibling
 * order (sort_order) are columns only. Whether they become fields depends on how
 * the API exposes the tree: separate routes need them in the body, a one-call
 * tree implies them by nesting (see the sketch at the end of schema.schema.js).
 * authorizer_person_id and enterer_person_id are provenance and get no field.
 */

const characterProperties = {
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
				description: "Legacy ID for characters migrated from PBot"
			}
		}
	},
	name: {type: "string"},
	definition: {type: "string"}
};

export const characterSource = {
	$schema: "https://json-schema.org/draft/2019-09/schema",
	$id: "https://pbdb2.example.com/schemas/character.json",
	title: "Character",
	description: "A character payload in the PBDB database",
	type: "object",
	properties: characterProperties,
	required: ["name"],
	"x-create": {
		properties: {
			name: { type: "string", minLength: 1 }
		}
	},
	unevaluatedProperties: false,
};

export default characterSource;
