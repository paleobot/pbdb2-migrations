/*
 * Annotated source for the reference payload. Every schema used anywhere (jsonb at
 * rest, create body, PATCH guard, response) is derived from this one object; see
 * payloadSchemas/lib/variants.js and payloadSchemas/DESIGN_NOTES.md. Annotations
 * are described in collection.schema.js.
 *
 * Publication types are defined once, in PUBLICATION_TYPES, beside the rules that
 * branch on them: the enum, the fields each type allows and the fields each type
 * requires on create are all generated from it. They are a closed set code depends
 * on, so no dictionaries table backs them.
 *
 * Every field is declared at the top level and the per-type rules live in x-create
 * only. So the db variant accepts any declared field on any type (legacy refs carry
 * fields their type would not allow today, and are history), while a create body
 * with a field its type does not allow fails with a propertyNames error naming it.
 *
 * authorizer_person_id and enterer_person_id get no payload field: they are
 * provenance, as on collection, which exposes neither.
 */

const fieldSchemas = {
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
				description: "Legacy ID for references migrated from old PBDB"
			},
			pbotID: {
				type: "string",
				description: "Legacy ID for references migrated from PBot"
			},
		}
	},
	title: {type: "string"},
	authors: {
		type: "array",
		minItems: 1,
		items: {
			type: "object",
			properties: {
				familyName: {type: "string"},
				givenName: {type: "string"}
			}
		}
	},
	publicationYear: {
		type: "string",
		maxLength: 4
	},
	pages: {
		type: "object",
		properties: {
			first: {
				type: "integer",
				minimum: 1
			},
			last: {
				type: "integer",
				minimum: 1
			}
		},
		required: ["first", "last"]
	},
	doi: {
		type: "string",
		maxLength: 80
	},
	language: {
		type: "string",
		"x-enumFrom": { table: "languages", column: "name" },
		default: "English"
	},
	comments: {type: "string"},
	journalTitle: {type: "string"},
	journalVolume: {
		type: "string",
		maxLength: 10
	},
	journalNumber: {
		type: "string",
		maxLength: 10
	},
	bookType: {
		type: "string",
		"x-enumFrom": { table: "book_types", column: "name" }
	},
	bookTitle: {type: "string"},
	seriesTitle: {type: "string"},
	seriesVolume: {
		type: "string",
		maxLength: 10
	},
	publisher: {
		type: "string",
		maxLength: 255
	},
	editors: {
		type: "string",
		maxLength: 255
	},
	publicationCity: {
		type: "string",
		maxLength: 80
	},
	description: {type: "string"},
};

// Fields every type may carry. publicationType itself is added below.
export const SHARED_FIELDS = [
	"permid", "legacyIDs", "publicationType", "title", "authors", "publicationYear", "pages", "doi", "language", "comments",
];

// `fields`: what the type allows beyond SHARED_FIELDS. `required`: what a create
// body of that type must carry. `other` is the catch-all, so it allows every
// declared field rather than a list that would need an edit per new field.
export const PUBLICATION_TYPES = {
	"journal article": {
		fields: ["journalTitle", "journalVolume", "journalNumber"],
		required: ["journalTitle", "journalVolume"],
	},
	"standalone book": {
		fields: ["bookType", "publisher", "publicationCity"],
		required: ["publisher", "authors", "pages"],
	},
	"edited collection": {
		fields: ["publisher", "editors", "publicationCity"],
		required: ["publisher", "editors", "pages"],
	},
	"article in edited collection": {
		fields: ["bookTitle", "publisher", "editors", "publicationCity"],
		required: ["bookTitle", "authors", "publisher", "editors", "pages"],
	},
	"serial monograph": {
		// editors: an edited volume inside a series (e.g. NMMNH Bulletins) is real.
		fields: ["publisher", "publicationCity", "seriesTitle", "seriesVolume", "editors"],
		required: ["seriesTitle", "seriesVolume", "publisher", "authors", "pages"],
	},
	"unpublished": {
		fields: ["description"],
		required: ["authors", "description"],
	},
	"other": {
		unrestricted: true,
		required: [],
	},
};

// One conditional per type. The `required` inside the `if` matters: without it an
// object with no publicationType would satisfy every `if` at once.
const typeRule = ([type, { fields, required, unrestricted }]) => {
	const then = {};
	if (required.length) then.required = required;
	if (!unrestricted) then.propertyNames = { enum: [...SHARED_FIELDS, ...fields] };
	return {
		if: { properties: { publicationType: { const: type } }, required: ["publicationType"] },
		then,
	};
};

export const referenceSource = {
	$schema: "https://json-schema.org/draft/2019-09/schema",
	$id: "https://pbdb2.example.com/schemas/reference.json",
	title: "Reference",
	description: "A reference payload in the PBDB database",
	type: "object",
	properties: {
		publicationType: {
			type: "string",
			enum: Object.keys(PUBLICATION_TYPES),
		},
		...fieldSchemas,
	},
	required: ["publicationType", "publicationYear"],
	// title is required on create only: 541 migrated PBDB refs have none, because
	// the legacy records they came from had none.
	"x-create": {
		required: ["title"],
		allOf: Object.entries(PUBLICATION_TYPES).map(typeRule),
	},
	unevaluatedProperties: false,
};

export default referenceSource;
