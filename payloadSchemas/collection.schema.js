/*
 * Annotated source for the collection payload. Every schema used anywhere
 * (jsonb at rest, create body, PATCH guard, response) is derived from this one
 * object; see payloadSchemas/lib/variants.js and payloadSchemas/DESIGN_NOTES.md.
 *
 *   x-enumFrom  enum values come from a dictionaries table (resolved by
 *               payloadSchemas/lib/enums.js). Open vocabularies only; closed
 *               sets that code depends on stay inline.
 *   x-storage   not stored in the collection jsonb (a column or child table).
 *   readOnly    server-assigned; root properties only.
 *   x-create    extra rules applied only to a create body.
 *
 * Objects marked "placeholder" (ages.intervals, environment, paleontology) await
 * redesign in the combined intervals/environment pass; their enums stay inline
 * except preservation modes, shared with specimens.
 */

const collectionProperties = {
    permid: {
        type: "string",
        readOnly: true,
        "x-storage": { column: "permid" },
        description: "Permanent identifier, constant across versions"
    },
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
        readOnly: true,
        properties: {
            oldpbdbID: {
                type: "string",
                description: "Legacy ID for collections migrated from old PBDB"
            },
            pbotID: {
                type: "string",
                description: "Legacy ID for collections migrated from PBot"
            },
        }
    },
    context : {
        type: "object",
        properties: {
            collectors: {
                type: "string",
                description: "Names of collectors"
            },
            collectionMethods: {
                type: "array",
                items: {
                    type: "string",
                    "x-enumFrom": { table: "collection_methods", column: "name" }
                },
                description: "Methods used for collection"
            },
            dates: {
                type: "string",
            },
            comments: {
                type: "string",
                description: "Notes on collecting"
            },
        },
    },
    location: {
        type: "object",
        properties: {
            toponym: {
                type: "object",
                properties: {
                    administrativeArea: {
                        type: "object",
                        properties: {
                            admin0: {
                                type: "string",
                                "x-enumFrom": { table: "admin0", column: "iso" },
                                description: "country (ISO 3166-1 alpha-2)"
                            },
                            admin1: {
                                type: "string",
                                "x-enumFrom": { table: "admin1", column: "iso" },
                                description: "state/province (ISO 3166-2)"
                            },
                            admin2: {
                                type: "string",
                                description: "county, etc."
                            }
                        },
                        required: ["admin0"],
                        // Create-time policy, not a vocabulary: these countries require a state/province.
                        "x-create": {
                            if: {
                                required: ["admin0"],
                                properties: { admin0: { enum: ["US", "CN", "RU", "AU", "CA"] } }
                            },
                            then: { required: ["admin1"] }
                        }
                    },
                    maritimeArea: {
                        type: "string",
                        "x-enumFrom": { table: "maritime", column: "iho_name" }
                    }
                },
                anyOf: [
                    {required: ["administrativeArea"]},
                    {required: ["maritimeArea"]}
                ]
            },
            coordinates: {
                type: "object",
                properties: {
                    // latitude/longitude live in the collections.location geography column
                    // (WGS84 decimal degrees), not in the jsonb.
                    latitude: {
                        type: "number",
                        minimum: -90,
                        maximum: 90,
                        "x-storage": { column: "location", codec: "wgs84Point" },
                        description: "Latitude coordinate"
                    },
                    longitude: {
                        type: "number",
                        minimum: -180,
                        maximum: 180,
                        "x-storage": { column: "location", codec: "wgs84Point" },
                        description: "Longitude coordinate"
                    },
                    basis: {
                        type: "string",
                        "x-enumFrom": { table: "coordinate_bases", column: "name" }
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
                },
                "x-create": { required: ["latitude", "longitude"] }
            },
            scale: {
                type: "string",
                "x-enumFrom": { table: "geographic_scales", column: "name" },
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
        required: ["scale"]
    },
    lithofacies: {
        type: "array",
        items: {
            type: "object",
            properties: {
                lithology: {
                    type: "string",
                    "x-enumFrom": { table: "lithologies", column: "name" }
                },
                adjectives: {
                    type: "array",
                    items: {
                        type: "string",
                        "x-enumFrom": { table: "lithology_adjectives", column: "name" }
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
    },
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
                type: "object",
                properties: {
                    supergroup: {
                        type: "string",
                        description: "Stratigraphic supergroup name"
                    },
                    group: {
                        type: "string",
                        description: "Stratigraphic group name"
                    },
                    subgroup: {
                        type: "string",
                        description: "Stratigraphic subgroup name"
                    },
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
            },
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
                            "x-enumFrom": { table: "dating_methods", column: "name" }
                        },
                        measurementType: {
                            type: "string",
                            enum: ["direct", "max", "min"]
                        }
                    },
                    required: ["age", "unit", "measurementType"],
                    "x-create": { required: ["error", "method"] }
                }
            },
            intervals: {
                //Placeholder for TBD intervals
                type: "string",
                description: "Placeholder for TBD intervals object"
            },
            comments: {
                type: "string",
                description: "Notes on age"
            }
        },
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
            tectonicSetting: {
                type: "string",
                enum: ["rift","passive margin","back-arc basin","cratonic basin","deep ocean basin","forearc basin","foreland basin","intermontane basin","intramontane basin","piggyback basin","pull-apart basin","volcanic basin","impact basin","non-subsiding area"]
            },
            comments: {
                type: "string",
                description: "Notes on environment"
            },
        }
    },
    paleontology: {
        //This is a placeholder for TBD paleontology object
        type: "object",
        properties: {
            preservation: {
                type: "object",
                properties: {
                    modes: {
                        type: "array",
                        items: {
                            type: "string",
                            "x-enumFrom": { table: "preservation_modes", column: "name" }
                        },
                    },
                    comments: {
                        type: "string"
                    }
                }
            },
            sizeClasses: {
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
        }
    }
};

// references: the primary reference is collections.reference_id; the rest are
// additional_collection_refs rows (order normalized; see payloadSchemas/lib/codecs.js).
collectionProperties.references = {
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
    "x-storage": { table: "additional_collection_refs", codec: "referenceList" },
    description: "List of references for this collection"
};

export const collectionSource = {
    $schema: "https://json-schema.org/draft/2019-09/schema",
    $id: "https://pbdb2.example.com/schemas/collection.json",
    title: "Collection",
    description: "A collection payload in the PBDB database",
    type: "object",
    properties: collectionProperties,
    required: ["name"],
    "x-create": { required: ["context", "references"] },
    unevaluatedProperties: false,
};

export default collectionSource;
