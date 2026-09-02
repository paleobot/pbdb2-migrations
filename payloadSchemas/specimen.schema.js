/*
Validation schemas in JSON Schema format. Note that fastify uses ajv (https://ajv.js.org/) for validation, which expects the schemas to be javascript objects rather than raw JSON. Consequently, property names (keys) do not require double quotes.
*/
//TODO: Right now, publication type differentiation and required fields are split off into createSchema. This create/editSchema dichotomy is an artifact of our use of JSON Merge Patch in the upload API.

const full = 	{
	if: {
		properties: {
			provenance: {
				const: "full"
			},
		},
	},
	then: {
		properties: {
			specimenNumber: {
				type: "object",
				properties: {
					institutionCode: {type: "string"},
					catalogNumber: {type: "string"},
					GBIF: {type: "string"}
				}
           },
		},
		required: [
			"specimenNumber"
		]	
	},
}

const museumOnly = {
	if: {
		properties: {
			provenance: {
				const: "museum only"
			},
		},
	},
	then: {
		properties: {
			specimenNumber: {
				type: "object",
				properties: {
					institutionCode: {type: "string"},
					catalogNumber: {type: "string"},
					GBIF: {type: "string"}
				}
           },
		},
		required: [
			"specimenNumber"
		]
	}
}

const collectionOnly = {
	if: {
		properties: {
			provenance: {
				const: "collection onlhy"
			},
		},
	},
	then: {
		properties: {
		},
		required: [
		]
	}
}


const referenceOnly = {
	if: {
		properties: {
			provenance: {
				const: "reference only"
			},
		},
	},
	then: {
		properties: {
			reference: {
				type: "object",
				properties: {
					originalName : {type: "string"},
					"figure" : {type: "string"},
					"pages" : {type: "string"}
				}
			}
		},
		required: [
			"reference"
		]
	},
}

const specimenProperties = {
	provenance: {
		type: "string",
		enum: ["full", "museum only","collection only", "reference only" ]
	},
	name: {type: "string"}
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
	paleontology : {
		type: "object",
		properties: {
			preservationModes: {
				type: "string",
				enum: [/*TBD???*/],
			}
		}
	},
	notes: {type: "string"},
}

export const getSchema = {
	tags:["Specimen"],
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
export const specimenSchema = {
    $schema: "https://json-schema.org/draft/2019-09/schema",
    $id: "https://pbdb2.example.com/schemas/reference.json",
    title: "Specimen",
    description: "A specimen payload in the PBDB database",
    type: "object",
    properties: {
		specimen: {
			type: "object",
			properties: specimenProperties,
			//TODO: Would like to catch these here and generate validation error. Unfortunately, fastify also sets removeAdditional by default, which quietly removes them instead. To change this, would have to move away from fastify-cli (https://github.com/fastify/fastify-cli?tab=readme-ov-file#migrating-out-of-fastify-cli-start)
			//TODO: But wait, there's more. additionalProperties only knows about properties in this direct schema. It does not know about properties in the conditional schemas. This means that if you have property_type "journal article", publicationTitle, publicationVolume, and pub number get removed before the model gets hold of them. This might be rectified in a later version of JSON Schema (https://stackoverflow.com/a/69313287). Look into that. But for now, we can't use additionalProperties and must let the model catch unknown column names.
			//additionalProperties: false,
			unevaluatedProperties: false, //new with Draft 2019-09
			required: [
				"provenance",
				"name",
				"paleontology",
			],
			allOf: [
				full,
				museumOnly,
				collectionOnly,
				referenceOnly,
			],
		},
		allowDuplicate: {
			type: "boolean",
			default: false
		}
	},
	examples: [{
		specimen: {
			provenance: "full",
			name: "The specimen name",
			specimenNumber: {
				institutionCode : "DMNH",
				catalogNumber : "EPI.77201",
				GBIF : "6493039454"
			},
			legacyIDs: {
				"oldpbdbID": "142207"
			},
			paleontology : {
					preservationModes: ["Adpression/compression"],
			},
			notes: "Acquired via private donation in 1994; no field collecting data available. Locality below entered manually from donor correspondence, not linked to a formal collections record."
		}
	}],
	response: {
		201: {
			description: "Specimen created",
			type: "object",
			properties: {
				statusCode: {type: "integer"},
				msg: {type: "string"},
			  	permid: {type: "integer"}
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



