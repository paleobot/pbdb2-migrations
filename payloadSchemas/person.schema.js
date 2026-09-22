/*
 * Annotated source for the person payload. Every schema used anywhere (jsonb at
 * rest, create body, PATCH guard, response) is derived from this one object; see
 * payloadSchemas/lib/variants.js and payloadSchemas/DESIGN_NOTES.md. Annotations
 * are described in collection.schema.js.
 *
 * persons is the first converted entity whose non-jsonb columns are part of the
 * entity as the API sees it rather than plumbing. role and authorizer are not
 * one-to-one with their column: this project exposes permids and not internal
 * ids, so `role` carries the role's name and `authorizer` a person's permid, and
 * each needs a lookup that the roleName / personPermid codecs perform against a
 * codec context (payloadSchemas/lib/storage.js).
 *
 * readOnly here means server-assigned, not privilege-gated. role, authorizer and
 * active are settable by an authorized caller, and which callers those are is a
 * route concern JSON Schema cannot express; marking them readOnly would make them
 * unsettable by anyone, because in-create removes them and patch-guard rejects
 * them. So patch-guard blocks exactly permid, legacyIDs and totalHours.
 *
 * persons.password and persons.created_at get no payload field: credentials are a
 * separate flow, and created_at stays out of the payload as it does on collection
 * and specimen.
 */

const personProperties = {
	permid: {
		type: "string",
		readOnly: true,
		"x-storage": { column: "permid" },
		description: "Permanent identifier, minted by the server"
	},
	legacyIDs: {
		type: "object",
		readOnly: true,
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
	givenName: {type: "string"},
	familyName: {type: "string"},
	middle: {type: "string"},
	email: {type: "string"},
	orcid: {
		type: "string",
		pattern: "^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$",
		description: "ORCID iD, bare (the https://orcid.org/ prefix is stripped on migration)"
	},
	countryCode: {
		// The same vocabulary collection resolves its admin0 against, so one list
		// of countries backs both entities.
		type: "string",
		"x-enumFrom": { table: "admin0", column: "iso" }
	},
	institution: {type: "string"},
	gender: {
		type: "string",
		"x-enumFrom": { table: "genders", column: "name" }
	},
	role: {
		// The role's name, never its id; dictionaries.roles has no permid, and a
		// bare role_id would mean nothing to a client without a roles route.
		type: "string",
		"x-enumFrom": { table: "roles", column: "name" },
		"x-storage": { column: "role_id", codec: "roleName" }
	},
	authorizer: {
		type: "string",
		"x-storage": { column: "authorizer_person_id", codec: "personPermid" },
		description: "permid of the person who authorizes this one"
	},
	active: {
		type: "boolean",
		"x-storage": { column: "active" }
	},
	totalHours: {
		type: "number",
		readOnly: true,
		"x-storage": { column: "total_hours" },
		description: "Accumulated by the server; not client-settable"
	}
};

export const personSource = {
	$schema: "https://json-schema.org/draft/2019-09/schema",
	$id: "https://pbdb2.example.com/schemas/person.json",
	title: "Person",
	description: "A person payload in the PBDB database",
	type: "object",
	properties: personProperties,
	required: ["familyName", "givenName", "gender"],
	// role and authorizer back NOT NULL columns but are not required here: the
	// route supplies the authenticated caller's authorizer and the 'Person'
	// default rather than making every client spell them out.
	"x-create": { required: ["email"] },
	unevaluatedProperties: false,
};

export default personSource;
