/*
Validation schemas in JSON Schema format. Note that fastify uses ajv (https://ajv.js.org/) for validation, which expects the schemas to be javascript objects rather than raw JSON. Consequently, property names (keys) do not require double quotes.
*/
//TODO: Right now, publication type differentiation and required fields are split off into createSchema. This create/editSchema dichotomy is an artifact of our use of JSON Merge Patch in the upload API.
/*
 * Note: Some enum values (timescale, lithology, environment, intervals, preservationMos)de
 * are dynamically loaded from external APIs or the database and are represented as strings.
 * These will require pre-processing of the schema before it can be used for validation.
 * Ultimately, all enums will load from the dictionaries schema in the postgresql db.
 */

const collectionProperties = {
    name: {
        type: "string",
        description: "Name of the collection"
    },
    akaName: {
        type: "string",
        description: "Alternative name of the collection"
    },
    legacyIDs: {
        type: "object",
        properties: {
            oldpbdbID: {
                type: "string",
                description: "Legacy ID for collections migrated from old PBDB"
            }
            pbotID: {
                type: "string",
                description: "Legacy ID for collections migrated from PBot"
            },
        }
    },
    context :{
        collectionType: {
            type: "string",
            enum: [
                "archaeologic",
                "biostratigraphic",
                "paleoecologic",
                "taphonomic",
                "taxonomic",
                "general faunal/floral"
            ],
            description: "Type of collection"
        },
        collectors: {
            type: "string",
            description: "Names of collectors"
        },
        collectionMethods: {
            type: "array",
            items: {
                type: "string",
                enum: [
                    "bulk","core","salvage","selective quarrying","surface (float)","surface (in situ)","anthill","chemical","mechanical","peel or thin section","smear slide","acetic","hydrochloric","hydroflouric","peroxide","sieve","field collection","survey of museum collection","private collection","observed (not collected)","repository not specified"
                ]
            },
            description: "Methods used for collection"
        },
        dates: {
            type: "string",
        }
        comments: {
            type: "string",
            description: "Notes on collecting"
        },
    },
    ages: {
        type: "object",
        properties: {
            measurements: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        age: {
                            type: "string"
                        },
                        error: {
                            type: "string"
                        },
                        unit: {
                            type: "string",
                            enum: [
                                "Ma","Ka","YBP"
                            ]
                        },
                        method: {
                            type: "string",
                            enum: ["Ar/Ar","astronomical","14C","14C (calibrated)","dendrochronology","ESR","fission track","K-Ar","Lu-Hf","paleomagnetic","Rb-Sr","Sr isotope","U/Pb","U/Th","age-depth","AEO","CONOP","graphic correlation","RASC","seriation","UA","other","unknown"]
                        },
                        measurementType: {
                            type: "string",
                            enum: ["stratigraphy", "fossil"]
                        }
                    }
                }
            },
            intervals: {
                type: "string"
                description: "Placeholder for TBD intervals object"
            }
            comments: {
                type: "string",
                description: "Notes on age"
            }
        },
    },
    location: {
        type: "object",
        properties: {
            administrativeAreas: {
                type: "object",
                properties: {
                    admin0: {
                        type: "string",
                        description: "country"
                        //Country code (ISO 3166-1 alpha-2). From dictionaries.countries.abbreviation. This requires pre-processing of schema before it can be used
                    },
                    admin1: {
                        type: "string",
                        description: "state/province"
                        //State/province code. From dictionaries.states.abbreviation. This requires pre-processing of schema before it can be used
                    },
                    admin2: {
                        type: "string",
                        description: "county, etc."
                    }
                },
                required: ["country"],
                if: {
                    properties: {
                        admin0: {
                            enum: [
                                /*ISO 3166-1 alpha-2 codes for USA, China, Russia, Australia, or Canada. Requires pre-processing of schema.*/
                            ]
                        }
                    }
                },
                then: {
                    required: ["admin1"]
                }
            },
            coordinates: {
                type: "object",
                properties: {
                    //latitude and longitude will not be stored in the jsonb. For incoming data, they will be used to populate the containing record's location column (of type geography). For outgoing data, they will be built on-the-fly from that column. All will be in WGS84 DD. These are defined elsewhere in this schema
                    basis: {
                        type: "string",
                        enum: ["stated in text","based on nearby landmark","based on political unit","estimated from map","unpublished field data"]
                    },
                    altitude: { //This may move out of jsonb and into geography column
                        type: "object",
                        properties: {
                            value: {
                                type: "integer"
                            },
                            unit: {
                                type: "string",
                                enum: ["meters","feet"]
                            }
                        }
                    }
                }
            }
            scale: {
                type: "string",
                enum: [
                    "hand sample",
                    "small collection (<10x10m)",
                    "outcrop (<1x1km)",
                    "local area (<100x100km)",
                    "basin"
                ],
                description: "Scale of geographic resolution"
            },
            comments: {
                type: "string",
                description: "Notes on geographic information"
            },
            repository: {
                type: "object",
                properties: {
                    institution: {
                        type: "string"
                    },
                    catalogNumber: {
                        type: "string"
                    }
                }
            }
        },
        required: ["country", "scale"]
    },
    lithofacies: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        lithology: {
                            type: "string",
                            enum: ["not reported","\"siliciclastic\"","clayston","mudstone","\"shale\"","siltstone","sandstone","gravel","conglomerate","breccia","\"mixed carbonate-siliciclastic\"","marl","lime mudstone","chalk","travertine","wackestone","packstone","grainstone","\"reef rocks\"","floatstone","rudstone","bafflestone","bindstone","framestone","\"limestone\"","dolomite","\"carbonate\"","calcareous ooze","chert","diatomite","silicious ooze","radiolarite","amber","coal","peat","lignite","subbituminous coal","bituminous coal","anthracite","coal ball","tar","evaporite","gypsum","phosphorite","pyrite","ironstone","siderite","phyllite","slate","schist","quartzite","\"volcaniclastic\"","ash","tuff"]
                        },
                        adjectives: {
                            type: "array"
                            items: {
                                type: "string",
                                enum: ["argillaceous","muddy","silty","sandy","conglomeratic","calcareous","cherty/siliceous","carbonaceous","massive","lenticular","tabular","desiccation cracks","current ripples","dunes","hummocky CS","wave ripples","\"cross stratification\"","wavy/flaser/lenticular bedding","planar lamination","tool marks","flute casts","deformed bedding","grading","burrows","bioturbation","paleosol/pedogenic","condensed","firmground","hardground","lag","very fine","fine","medium","coarse","very coarse","bentonitic","concretionary","diatomaceous","dolomitic","ferruginous","glauconitic","gypsiferous","hematitic","micaceous","nodular","pebbly","phosphatic","pyritic","quartzose","rubbly","sideritic","tuffaceous","stromatolitic","volcaniclastic","flat-pebble","intraclastic","oncoidal","ooidal","peloidal","shelly/skeletal","black","brown","gray","green","red","red or brown","white","yellow","blue","thrombolitic"]
                            }
                        },
                        fossils: {
                            type: "boolean"
                        },
                        lithification: {
                            type: "string",
                            enum: ["lithified","poorly lithified","unlithified","metamorphosed"]
                        },
                    },
                    required: ["lithology"]
                }
            }
        }
    }
    stratigraphy: {
        type: "object",
        properties: {
            scale: {
                type: "string",
                enum: ["bed","group of beds","member","formation","group"]
            },
            comments: {
                type: "string",
                description: "Notes on stratigraphy"
            },
            stratonyms: {
                type: "object".
                properties: {
                    supergroup: {
                        type: "string"
                        description: "Stratigraphic supergroup name"
                    }
                    group: {
                        type: "string",
                        description: "Stratigraphic group name"
                    },
                    subgroup: {
                        type: "string",
                        description: "Stratigraphic subgroup name"
                    }
                    formation: {
                        type: "string",
                        description: "Stratigraphic formation name"
                    },
                    member: {
                        type: "string",
                        description: "Stratigraphic member name"
                    },
                    bed: {
                        type: "string",
                        description: "Stratigraphic bed name"
                    },
                }
            }
            measuredSections: {
                type: "object",
                properties: {
                    section: {
                        type: "string"
                    },
                    bed: {
                        type: "string",
                    },
                    unit: {
                        type: "string"
                    },
                    order: {
                        type: "string"
                    }
                }
            },
        }
    },
    environment: {
        //This is a placeholder for TBD environment object
        type: "object",
        properties: {
            name: {
                type: "string",
                enum: [
                    "marine indet.",
                    "terrestrial indet.",
                    "carbonate indet.",
                    "peritidal",
                    "shallow subtidal indet.",
                    "open shallow subtidal",
                    "lagoonal/restricted shallow subtidal",
                    "sand shoal",
                    "reef, buildup or bioherm",
                    "perireef or subreef",
                    "intrashelf/intraplatform reef",
                    "platform/shelf-margin reef",
                    "slope/ramp reef",
                    "basin reef",
                    "deep subtidal ramp",
                    "deep subtidal shelf",
                    "deep subtidal indet.",
                    "offshore ramp",
                    "offshore shelf",
                    "offshore indet.",
                    "slope",
                    "basinal (carbonate)",
                    "basinal (siliceous)",
                    "marginal marine indet.",
                    "paralic indet.",
                    "lagoonal",
                    "coastal indet.",
                    "foreshore",
                    "shoreface",
                    "transition zone/lower shoreface",
                    "offshore",
                    "deltaic indet.",
                    "delta plain",
                    "interdistributary bay",
                    "delta front",
                    "prodelta",
                    "deep-water indet.",
                    "submarine fan",
                    "basinal (siliciclastic)",
                    "fluvial-lacustrine indet.",
                    "fluvial indet.",
                    "\"channel\"",
                    "channel lag",
                    "coarse channel fill",
                    "fine channel fill",
                    "\"floodplain\"",
                    "wet floodplain",
                    "dry floodplain",
                    "levee",
                    "crevasse splay",
                    "lacustrine indet.",
                    "lacustrine - large",
                    "lacustrine - small",
                    "pond",
                    "crater lake",
                    "karst indet.",
                    "fissure fill",
                    "cave",
                    "sinkhole",
                    "eolian indet.",
                    "dune",
                    "interdune",
                    "loess",
                    "fluvial-deltaic indet.",
                    "estuary/bay",
                    "lacustrine deltaic indet.",
                    "lacustrine delta plain",
                    "lacustrine interdistributary bay",
                    "lacustrine delta front",
                    "lacustrine prodelta",
                    "alluvial fan",
                    "glacial",
                    "mire/swamp",
                    "spring",
                    "tar"
                ]
            },
            comments: {
                type: "string",
                description: "Notes on environment"
            },
        }
    }
    preservation: {
        //Placeholder TBD
        type: "object",
        properties: {
            modes: {
                type: "array",
                items: {
                    type: "string",
                    enum: [
                        "body","cast","mold/impression","adpression","trace","concretion","soft parts","recrystallized","permineralized","dissolution traces","charcoalification","coalified","original aragonite","original calcite","original phosphate","original silica","original chitin","original carbon","original sporopollenin","original cellulose","replaced with calcite","replaced with dolomite","replaced with silica","replaced with pyrite","replaced with siderite","replaced with hematite","replaced with limonite","replaced with phosphate","replaced with carbon","replaced with other","amber","anthropogenic","bone collector","coquina","coprolite","midden","shellbed"
                    ]
                },
                description: "List of preservation mode IDs"
            },
            comments: {
                type: "string"
            }
        }
    },
    tectonicSetting: {
        //Placeholder TBD
        type: "string",
        enum: ["rift","passive margin","back-arc basin","cratonic basin","deep ocean basin","forearc basin","foreland basin","intermontane basin","intramontane basin","piggyback basin","pull-apart basin","volcanic basin","impact basin","non-subsiding area"]
    },
    sizeClasses: {
        //Placeholder TBD
        type: "array",
        items: {
            type: "string",
            enum: [
                "> 10 mm",
                "1 - 10 mm",
                "< 1 mm"
            ]
        },
        description: "Size classes of specimens in collection"
    },
};

//completeCollectionProperties contains fields that are built from relationships in the containing db record. (Note: location.adminx values may fit better here.)
const completeCollectionProperties = structuredClone(collectionProperties)

//Reference links reside in the containing db record and a cross-ref table. The references property must be populated on create and will be generated on the fly for get.
completeCollectionProperties.references = {
    type: "array",
    items: {
        type: "object",
        required: ["order"],
        properties: {
            referenceID: {
                type: "string",
                description: "Reference unique identifier"
            },
            order: {
                type: "string",
                description: "Order of the reference"
            }
        }
    },
    minItems: 1,
    description: "List of references for this collection"
}

//latitude and longitude will not be stored in the jsonb. For incoming data, they will be used to populate the containing record's location column (of type geography). For outgoing data, they will be built on-the-fly from that column. All will be in WGS84 DD.
completeCollectionProperties.location.coordinates.properties = {
    ...completeCollectionCoordinates.location.coordinates.properties,
    latitude: {
        type: "number",
        minimum: -90,
        maximum: 90,
        description: "Latitude coordinate"
    },
    longitude: {
        type: "number",
        minimum: -180,
        maximum: 180,
        description: "Longitude coordinate"
    }
}
completeCollectionProperties.location.coordinates.required = [
    ...completeCollectionProperties.location.coordinates.required,
    "latitude", "longitude"
]

completeCollectionProperties.preservationModes.minItems = 1


export const collectionSchema = {
    $schema: "https://json-schema.org/draft/2019-09/schema",
    $id: "https://pbdb2.example.com/schemas/collection.json",
    title: "Collection",
    description: "A collection payload in the PBDB database",
    type: "object",
    properties: {
		type: 'object',
		properties: {
			collection: {
				type: "object",
				properties: completeCollectionProperties,
				unevaluatedProperties: false, //new with Draft 2019-09
                required: [
                    "name",
                    "collectionType",
                    //"timescale",
                    //"maxinterval",
                    //"gpsCoordinateUncertainty",
                    //"country",
                    "lithology",
                    //"preservationModes",
                    "references"
                ],
			},
      	},
		examples: [{
			collection: {
			}
		}],
	},
	response: {
		201: {
			description: "Collection created",
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

export default collectionSchema;
