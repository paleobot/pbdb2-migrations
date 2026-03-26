/*
Validation schemas in JSON Schema format. Note that fastify uses ajv (https://ajv.js.org/) for validation, which expects the schemas to be javascript objects rather than raw JSON. Consequently, property names (keys) do not require double quotes.
*/
//TODO: Right now, publication type differentiation and required fields are split off into createSchema. This create/editSchema dichotomy is an artifact of our use of JSON Merge Patch in the upload API.

const journalArticle = 	{
	if: {
		properties: {
			publicationType: { 
				const: "journal article" 
			},
		},
	},
	then: {
		properties: {
			journalTitle: {type: "string"},
			journalVolume: {
				type: "string",
				maxLength: 10
			},
			journalNumber: {
				type: "string",
				maxLength: 10
			},
		},
		required: [
			"journalType", 
			"journalTitle",
			"journalVolume"
		]	
	},
}

const standaloneBook = {
	if: {
		properties: {
			publicationType: {
				const: "standalone book" 
			},
			bookType: {
				type: "string",
				enum: [
					"monograph",
					"compendium",
					"Ph.D. thesis",
					"M.S. thesis",
					"guidebook"
				]
			},
		},
	},
	then: {
		properties: {
			publisher: {
				type: "string",
				maxLength: 255
			},
			publicationCity: {
				type: "string",
				maxLength: 80
			}
		},
		required: [
			"publicationType", 
			"publisher",
			"authors",
			"pages"
		]
	}
}

const serialMonograph = {
	if: {
		properties: {
			publicationType: {
				const: "serial monograph" 
			},
		},
	},
	then: {
		properties: {
			publisher: {
				type: "string",
				maxLength: 255
			},
			publicationCity: {
				type: "string",
				maxLength: 80
			},
			seriesTitle: { 
				type: "string"
			},
			seriesVolume: { 
				type: "string",
				maxLength: 10
			},
		},
		required: [
			"publicationType", 
			"seriesTitle",
			"seriesVolume",
			"publisher",
			"authors",
			"pages"
		]
	}
}


const articleInEditedCollection = {
	if: {
		properties: {
			publicationType: {
				const: "article in edited collection"
			},
		},
	},
	then: {
		properties: {
			bookTitle: {type: "string"},
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
			}
		},
		required: [
			"publicationType", 
			"bookTitle",
			"authors",
			"publisher",
			"editors",
			"pages"
		]
	},
}

const editedCollection = {
	if: {
		properties: {
			publicationType: {
				const: "edited collection"
			}
		}
	},
	then: {
		properties: {
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
			}
		},
		required: [
			"publicationType", 
			"publisher",
			"editors",
			"pages"
		]	
	},
}

const unpublished = {
	if: {
		properties: {
			publicationType: {
				const: "unpublished"
			}
		}
	},
	then: {
		properties: {
			description: {
				type: "string"
			}
		},
		required: [
			"authors",
			"description"
		]	
	},
}

const referenceProperties = {
	publicationType: { 
		description: `
		Fields and requirements are added based on the value of this field. Unfortunately, proper documentation of these is not automatically generated. 
			journal article: 
				authors: {
					type: "array"
					minItems: 1,
					items: {
						surname: {type: "string"},
						givenName: {type: "string"}
					}
				} required
				publicationTitle: {type: "string"}, required
				publicationVolume: {type: "string"}, required
				publicationNumber: {type: "string"}, required
			standalone book:
				bookType: {
					type: "string",
					enum: ["monograph", "compendium","Ph.D. thesis","M.S. thesis","abstract","guidebook"]
				}
				authors: {
					type: "array"
					minItems: 1,
					items: {
						familyName: {type: "string"},
						givenName: {type: "string"}
					}
				} required
				publisher: {type: "string"}, required
				publicationCity: {type: "string}
			contributed article in edited book:
				authors: {
					type: "array"
					minItems: 1,
					items: {
						surname: {type: "string"},
						givenName: {type: "string"}
					}
				} required
				publicationTitle: {type: "string"}, required
				publisher: {type: "string"}, required
				editors: {type: "string"}, required
				publicationCity: {type: "string}
			edited collection:
				publisher: {type: "string"}, required
				editors: {type: "string"}, required
				publicationCity: {type: "string}
			unpublished:
				authors: {
					type: "array"
					minItems: 1,
					items: {
						surname: {type: "string"},
						givenName: {type: "string"}
					}
				} required
				description: {type: "string"} required
		`,
		type: "string",
		enum: ["journal article","standalone book","edited collection","article in edited collection","serial monograph","unpublished","other"]
	},
	legacyIDs: {
		type: "object",
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
		enum: ['Chinese','English','French','German','Italian','Japanese','Portugese','Russian','Spanish','other','unknown'],
		default: "English"
	},
	notes: {type: "string"}
}

export const getSchema = {
	tags:["Reference"],
	hide: true,
	response: {
		501: {
			description: 'Not implemented',
			type: 'object',
			properties: {
				statusCode: {type: "integer"},
				msg: {type: "string"} 
			}
		  },	
	}

}

/*
 * I don't think we're going to need these, but I'm ghosting them here as examples,
 * just in case.
export const patchSchema = {
    body: {
		examples: [{
			reference:{pubyr:"2021" }	
		}],
	},
	response: {
		204: {
			description: 'Reference modified',
			type: 'object',
			properties: {
				statusCode: {type: "integer"},
				msg: {type: "string"},
			}
		},	
	}
}
	
export const editSchema = {
	tags:["Reference"],
	hide: true,
    body: {
		type: 'object',
		properties: {
			reference: {
				type: "object",
				properties: referenceProperties,
				//TODO: Would like to catch these here and generate validation error. Unfortunately, fastify also sets removeAdditional by default, which quietly removes them instead. To change this, would have to move away from fastify-cli (https://github.com/fastify/fastify-cli?tab=readme-ov-file#migrating-out-of-fastify-cli-start)
				//TODO: But wait, there's more. additionalProperties only knows about properties in this direct schema. It does not know about properties in the conditional schemas. This means that if you have property_type "journal article", publicationTitle, publicationVolume, and pub number get removed before the model gets hold of them. This might be rectified in a later version of JSON Schema (https://stackoverflow.com/a/69313287). Look into that. But for now, we can't use additionalProperties and must let the model catch unknown column names.
				//additionalProperties: false,
				unevaluatedProperties: false, //new with Draft 2019-09
			},
			allowDuplicate: {
				type: "boolean",
				default: false
			}
		},
		examples: [{
			reference:{publicationYear:"2021" }	
		}],
	},
	response: {
		204: {
			description: 'Reference modified',
			type: 'object',
			properties: {
				statusCode: {type: "integer"},
				msg: {type: "string"},
			}
		},	
		400: {
			description: "Bad request",
			type: "object",
			properties: {
				statusCode: {type: "integer"},
				msg: {type: "string"},
				links: {type: "array"}
			}
		}	
	}
}
*/

//export const createSchema = {
export const referenceSchema = {
    $schema: "https://json-schema.org/draft/2019-09/schema",
    $id: "https://pbdb2.example.com/schemas/reference.json",
    title: "Reference",
    description: "A reference payload in the PBDB database",
    type: "object",
    properties: {
		reference: {
			type: "object",
			properties: referenceProperties,
			//TODO: Would like to catch these here and generate validation error. Unfortunately, fastify also sets removeAdditional by default, which quietly removes them instead. To change this, would have to move away from fastify-cli (https://github.com/fastify/fastify-cli?tab=readme-ov-file#migrating-out-of-fastify-cli-start)
			//TODO: But wait, there's more. additionalProperties only knows about properties in this direct schema. It does not know about properties in the conditional schemas. This means that if you have property_type "journal article", publicationTitle, publicationVolume, and pub number get removed before the model gets hold of them. This might be rectified in a later version of JSON Schema (https://stackoverflow.com/a/69313287). Look into that. But for now, we can't use additionalProperties and must let the model catch unknown column names.
			//additionalProperties: false,
			unevaluatedProperties: false, //new with Draft 2019-09
			required: [
				"publicationType",
				"title",
				"publicationYear",
			],
			allOf: [
				journalArticle,
				standaloneBook,
				serialMonograph,
				articleInEditedCollection,
				editedCollection,
				unpublished
			],
		},
		allowDuplicate: {
			type: "boolean",
			default: false
		}
	},
	examples: [{
		reference: {
			publicationType: "unpublished",
			title: "The reference title",
			author1init: "D",
			author1last: "Meredith",
			publicationYear: "2024",
			firstPage: "1",
			publicationTitle: "A publication title ",
			publicationVolume:"5"
		}
	}],
	response: {
		201: {
			description: "Reference created",
			type: "object",
			properties: {
				statusCode: {type: "integer"},
				msg: {type: "string"},
			  	collection_no: {type: "integer"}
			}
		},
		400: {
			description: "Bad request",
			type: "object",
			properties: {
				statusCode: {type: "integer"},
				msg: {type: "string"},
				links: {type: "array"}
			}
		}	
	}
}

/*
 * Not sure about this either. Ghosting for now
export const getPropertiesForPubType = (pubType, fastify) => {
	fastify.log.trace("getPropertiesForPubType")
	fastify.log.trace(pubType)
	let allProps = Object.keys(schema.body.properties.reference.properties)
	let reqProps = schema.body.properties.reference.required
	fastify.log.trace(allProps)
	fastify.log.trace(reqProps)

	switch (pubType) {
		case "journal article": 
			allProps = allProps.concat(Object.keys(journalArticle.then.properties))
			reqProps = reqProps.concat(journalArticle.then.required)
			break;
		case "book":
		case "serial monograph":
		case "compendium":
		case "Ph.D. thesis":
		case "M.S. thesis":
		case "guidebook":
			allProps = allProps.concat(Object.keys(book.then.properties))
			reqProps = reqProps.concat(book.then.required)
			break;
		case "book chapter":
			allProps = allProps.concat(Object.keys(chapter.then.properties))
			reqProps = reqProps.concat(chapter.then.required)
			break;
		case "book/book chapter":
			allProps = allProps.concat(Object.keys(editedCollection.then.properties))
			reqProps = reqProps.concat(editedCollection.then.required)
			break;
	}

	return {
		allowedProps: new Set(allProps),
		requiredProps: reqProps
	}
}
*/



