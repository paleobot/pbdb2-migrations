/*
 * Annotated source for the authority payload. Every schema used anywhere (jsonb at
 * rest, create body, PATCH guard, response) is derived from this one object; see
 * payloadSchemas/lib/variants.js and payloadSchemas/DESIGN_NOTES.md. Annotations
 * are described in collection.schema.js.
 *
 * The jsonb keys are the ones src/authorities-migration writes and
 * src/authority-opinions-migration reads by name, so none is renamed.
 * legacyIDs.oldpbdbIDs is plural, unlike every other entity's: dedup merges several
 * taxon_nos into one authority.
 *
 * `reference` is the permid of authorities.reference_id, resolved by the
 * referencePermid codec against lineage heads of refs. It is required in the base,
 * which costs `db` nothing (x-storage properties are pruned from it) and lets `out`
 * guarantee it, since the column is NOT NULL.
 *
 * `year` is loose at rest, where 1,299 migrated scenario ④ authorities carry the
 * sentinel "0" and 898 carry none, and four digits on create. The sentinel citation
 * "authority unknown" stays enterable; such an authority omits year.
 *
 * Not settled here: when publishedInReference is true, citation, descriptors and
 * year were copied from the reference at migration and go stale if it is edited.
 * authorizer_person_id and enterer_person_id are provenance and get no field, as on
 * collection and reference.
 */

const authorityProperties = {
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
			oldpbdbIDs: {
				type: "array",
				items: { type: "string" },
				description: "Legacy IDs for authorities migrated from old PBDB"
			}
		}
	},
	reference: {
		type: "string",
		"x-storage": { column: "reference_id", codec: "referencePermid" },
		description: "permid of the reference this authority is recorded from"
	},
	citation: {type: "string"},
	descriptors: {
		type: "array",
		items: { type: "string" }
	},
	year: {
		type: "string",
		maxLength: 4
	},
	publishedInReference: {type: "boolean"}
};

export const authoritySource = {
	$schema: "https://json-schema.org/draft/2019-09/schema",
	$id: "https://pbdb2.example.com/schemas/authority.json",
	title: "Authority",
	description: "An authority payload in the PBDB database",
	type: "object",
	properties: authorityProperties,
	required: ["citation", "publishedInReference", "reference"],
	"x-create": {
		properties: {
			year: { type: "string", pattern: "^[0-9]{4}$" }
		}
	},
	unevaluatedProperties: false,
};

export default authoritySource;
