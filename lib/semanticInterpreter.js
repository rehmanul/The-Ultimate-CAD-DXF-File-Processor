/**
 * SemanticInterpreter - COSTO V1 Requirement
 * 
 * Interprets floor plan elements semantically:
 * - Usable Envelope (buildable area)
 * - Obstacles (columns, shafts, stairs, etc.)
 * - Forbidden Zones (technical areas, service zones)
 * - Exits (doors, emergency exits)
 * - Circulation zones (corridors that must remain clear)
 */

/**
 * Layer name patterns for semantic interpretation
 */
const LAYER_PATTERNS = {
    // Walls / Envelope
    envelope: [/wall/i, /mur/i, /cloison/i, /envelope/i, /facade/i, /boundary/i],

    // Obstacles (permanent structures)
    obstacles: [/column/i, /poteau/i, /shaft/i, /gaine/i, /stair/i, /escalier/i, /elevator/i, /ascenseur/i, /void/i, /tremie/i],

    // Forbidden zones (areas that cannot be used for placement)
    forbidden: [/forbidden/i, /interdit/i, /exclusion/i, /service/i, /technique/i, /wc/i, /toilet/i, /sanitary/i, /sanitaire/i],

    // Exits and doors
    exits: [/exit/i, /sortie/i, /door/i, /porte/i, /entrance/i, /entree/i, /emergency/i, /urgence/i, /secours/i],

    // Circulation / Corridor areas
    circulation: [/corridor/i, /couloir/i, /circulation/i, /passage/i, /hall/i, /lobby/i]
};

/**
 * DXF color codes commonly used for semantic meaning
 * (AutoCAD ACI colors)
 */
const COLOR_SEMANTICS = {
    1: 'red',      // Often used for: errors, forbidden zones
    2: 'yellow',   // Often used for: warnings, caution zones
    3: 'green',    // Often used for: safe zones, exits
    4: 'cyan',     // Often used for: information
    5: 'blue',     // Often used for: structural elements
    6: 'magenta',  // Often used for: special zones
    7: 'white',    // Default/neutral
    8: 'gray',     // Secondary elements
    256: 'bylayer' // Take color from layer
};

class SemanticInterpreter {
    constructor(options = {}) {
        this.customLayerPatterns = options.layerPatterns || {};
        this.customColorMapping = options.colorMapping || {};

        // Merge custom patterns with defaults
        this.layerPatterns = { ...LAYER_PATTERNS, ...this.customLayerPatterns };
    }

    /**
     * Interpret the semantic meaning of a layer name
     * @param {string} layerName - The DXF layer name
     * @returns {string} Semantic category: 'envelope', 'obstacles', 'forbidden', 'exits', 'circulation', 'unknown'
     */
    interpretLayer(layerName) {
        if (!layerName) return 'unknown';

        const normalizedName = String(layerName).toLowerCase();

        for (const [category, patterns] of Object.entries(this.layerPatterns)) {
            for (const pattern of patterns) {
                if (pattern.test(normalizedName)) {
                    return category;
                }
            }
        }

        return 'unknown';
    }

    /**
     * Interpret semantic data from parsed DXF/DWG entities
     * @param {Object} parsedData - The parsed CAD data { walls, forbiddenZones, entrances, rooms, bounds }
     * @returns {Object} Semantic interpretation with categorized elements
     */
    interpret(parsedData) {
        const result = {
            envelope: {
                bounds: parsedData.bounds || null,
                walls: [],
                perimeter: null,
                usableArea: 0
            },
            obstacles: [],
            forbiddenZones: [],
            exits: [],
            circulation: [],
            unknown: [],
            metadata: {
                interpretedAt: new Date().toISOString(),
                confidenceScore: 0,
                warnings: []
            }
        };

        // Process walls -> envelope
        if (Array.isArray(parsedData.walls)) {
            for (const wall of parsedData.walls) {
                const category = this.interpretLayer(wall.layer);

                if (category === 'obstacles') {
                    result.obstacles.push({
                        ...wall,
                        semanticType: 'structural',
                        source: 'wall-layer-interpretation'
                    });
                } else {
                    result.envelope.walls.push(wall);
                }
            }
        }

        // Process forbidden zones
        if (Array.isArray(parsedData.forbiddenZones)) {
            for (const zone of parsedData.forbiddenZones) {
                const category = this.interpretLayer(zone.layer);

                const enrichedZone = {
                    ...zone,
                    semanticType: category,
                    source: 'dxf-forbidden-zone'
                };

                if (category === 'exits') {
                    result.exits.push(enrichedZone);
                } else if (category === 'obstacles') {
                    result.obstacles.push(enrichedZone);
                } else if (category === 'circulation') {
                    result.circulation.push(enrichedZone);
                } else {
                    result.forbiddenZones.push(enrichedZone);
                }
            }
        }

        // Process entrances -> exits
        if (Array.isArray(parsedData.entrances)) {
            for (const entrance of parsedData.entrances) {
                result.exits.push({
                    ...entrance,
                    semanticType: 'exit',
                    source: 'dxf-entrance'
                });
            }
        }

        // Calculate usable area
        if (result.envelope.bounds) {
            const { width, height } = result.envelope.bounds;
            const totalArea = (width || 0) * (height || 0);

            // Subtract obstacle areas
            let obstacleArea = 0;
            for (const obs of result.obstacles) {
                if (obs.bounds) {
                    const obsW = (obs.bounds.maxX || 0) - (obs.bounds.minX || 0);
                    const obsH = (obs.bounds.maxY || 0) - (obs.bounds.minY || 0);
                    obstacleArea += obsW * obsH;
                } else if (obs.area) {
                    obstacleArea += obs.area;
                }
            }

            // Subtract forbidden zone areas
            let forbiddenArea = 0;
            for (const zone of result.forbiddenZones) {
                if (zone.bounds) {
                    const zW = (zone.bounds.maxX || 0) - (zone.bounds.minX || 0);
                    const zH = (zone.bounds.maxY || 0) - (zone.bounds.minY || 0);
                    forbiddenArea += zW * zH;
                } else if (zone.area) {
                    forbiddenArea += zone.area;
                }
            }

            result.envelope.usableArea = Math.max(0, totalArea - obstacleArea - forbiddenArea);
        }

        // Calculate confidence score
        result.metadata.confidenceScore = this._calculateConfidence(result, parsedData);

        // Add warnings
        if (result.envelope.walls.length === 0) {
            result.metadata.warnings.push('No walls detected in envelope');
        }
        if (result.exits.length === 0) {
            result.metadata.warnings.push('No exits detected - may need manual annotation');
        }
        if (result.envelope.usableArea <= 0) {
            result.metadata.warnings.push('Usable area is zero or negative - check obstacle/forbidden zone calculations');
        }

        return result;
    }

    /**
     * Calculate a confidence score for the interpretation
     * @private
     */
    _calculateConfidence(result, parsedData) {
        let score = 50; // Start at 50%

        // Walls detected = +20
        if (result.envelope.walls.length > 0) score += 20;

        // Exits detected = +15
        if (result.exits.length > 0) score += 15;

        // Obstacles or forbidden zones detected = +10
        if (result.obstacles.length > 0 || result.forbiddenZones.length > 0) score += 10;

        // Valid usable area = +5
        if (result.envelope.usableArea > 0) score += 5;

        // No unknowns = bonus
        if (result.unknown.length === 0) score += 5;

        return Math.min(100, score);
    }

    /**
     * Get a visual summary suitable for reports
     */
    getSummary(interpretation) {
        return {
            envelopeBounds: interpretation.envelope.bounds,
            usableArea: interpretation.envelope.usableArea,
            wallCount: interpretation.envelope.walls.length,
            obstacleCount: interpretation.obstacles.length,
            forbiddenZoneCount: interpretation.forbiddenZones.length,
            exitCount: interpretation.exits.length,
            circulationCount: interpretation.circulation.length,
            confidenceScore: interpretation.metadata.confidenceScore,
            warnings: interpretation.metadata.warnings
        };
    }
}

module.exports = SemanticInterpreter;
