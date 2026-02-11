/**
 * COSTO Layer Standard - V1
 * Defines standard layer names and mapping for DWG/DXF import
 * Based on COSTO V1 specifications
 */

class CostoLayerStandard {
    constructor() {
        // COSTO Standard Layer Names
        this.standardLayers = {
            // Usable envelope/perimeter (closed polyline)
            ENVELOPE: {
                names: ['ENVELOPE', 'PERIMETER', 'BOUNDARY', 'USABLE_AREA', 'FLOOR_PLAN'],
                color: 7, // White
                linetype: 'CONTINUOUS',
                description: 'Usable envelope/perimeter of the floor'
            },
            
            // Obstacles (columns, ducts, technical rooms)
            OBSTACLES: {
                names: ['OBSTACLES', 'COLUMNS', 'DUCTS', 'TECHNICAL_ROOMS', 'OBSTACLE'],
                color: 1, // Red
                linetype: 'CONTINUOUS',
                description: 'Columns, ducts, technical rooms'
            },
            
            // Prohibited areas (smoke extraction, shafts, voids)
            FORBIDDEN: {
                names: ['FORBIDDEN', 'NO_ENTREE', 'PROHIBITED', 'SMOKE_EXTRACTION', 'SHAFTS', 'VOIDS', 'RESTRICTED'],
                color: 1, // Red
                linetype: 'DASHED',
                description: 'Prohibited areas (smoke extraction, shafts, voids)'
            },
            
            // Exits/stairs/freight elevators
            EXITS: {
                names: ['EXITS', 'ENTREE_SORTIE', 'ENTREE__SORTIE', 'ENTREE-SORTIE', 'STAIRS', 'ELEVATORS', 'FREIGHT_ELEVATORS', 'DOORS', 'EXIT'],
                color: 3, // Green
                linetype: 'CONTINUOUS',
                description: 'Exits, stairs, freight elevators'
            },
            
            // Fire doors/access control
            FIRE_DOORS: {
                names: ['FIRE_DOORS', 'FIRE_DOOR', 'ACCESS_CONTROL', 'SECURITY_DOORS'],
                color: 2, // Yellow
                linetype: 'DASHED',
                description: 'Fire doors and access control points'
            },
            
            // Walls (structural)
            WALLS: {
                names: ['WALLS', 'MUR', 'STRUCTURE', 'STRUCTURAL_WALLS'],
                color: 0, // Black
                linetype: 'CONTINUOUS',
                description: 'Structural walls'
            },
            
            // Generated boxes (output) - Tole Grise (grey sheet metal partitions)
            BOXES: {
                names: ['BOXES', 'STORAGE_UNITS', 'ILOTS', 'UNITS'],
                color: 5, // Blue
                linetype: 'CONTINUOUS',
                description: 'Generated storage boxes/units (Tole Grise partitions)'
            },

            // Tole Blanche - White sheet metal partitions (structural dividers)
            TOLE_BLANCHE: {
                names: ['TOLE_BLANCHE', 'TOLE BLANCHE', 'WHITE_PARTITION'],
                color: 0, // Black (thin lines)
                linetype: 'CONTINUOUS',
                description: 'White sheet metal partitions between sections'
            },

            // Tole Grise - Grey sheet metal partitions (box dividers)
            TOLE_GRISE: {
                names: ['TOLE_GRISE', 'TOLE GRISE', 'GREY_PARTITION'],
                color: 5, // Blue
                linetype: 'CONTINUOUS',
                description: 'Grey sheet metal partitions between storage boxes'
            },

            // Corridors / Circulation paths (output)
            CORRIDORS: {
                names: ['CORRIDORS', 'CIRCULATION', 'ACCESS', 'PATHS', 'LIGNE_CIRCULATION'],
                color: 4, // Cyan / light blue
                linetype: 'DASHED',
                description: 'Circulation corridors (light-blue dashed lines)'
            },

            // Main arteries (wider corridors)
            MAIN_ARTERIES: {
                names: ['MAIN_ARTERIES', 'ARTERY', 'MAIN_CORRIDOR'],
                color: 4, // Cyan
                linetype: 'DASHED',
                description: 'Main artery corridors'
            },

            // Radiators (perimeter heating)
            RADIATORS: {
                names: ['RADIATORS', 'RADIATEUR', 'HEATING', 'CHAUFFAGE'],
                color: 1, // Red
                linetype: 'CONTINUOUS',
                description: 'Perimeter radiators (red zigzag along walls)'
            },

            // Dimensions (output)
            DIMENSIONS: {
                names: ['DIMENSIONS', 'DIM', 'MEASUREMENTS'],
                color: 6, // Magenta
                linetype: 'CONTINUOUS',
                description: 'Dimension lines and text'
            },
            
            // Text/Annotations (output)
            TEXT: {
                names: ['TEXT', 'ANNOTATIONS', 'LABELS', 'NOTES'],
                color: 7, // White
                linetype: 'CONTINUOUS',
                description: 'Text annotations and labels'
            }
        };
        
        // Layer mapping cache (user-defined mappings)
        this.layerMapping = new Map();
    }

    /**
     * Map a layer name to COSTO standard type
     * @param {string} layerName - Original layer name from DWG
     * @returns {string|null} - COSTO standard type or null if not mappable
     */
    mapLayer(layerName) {
        if (!layerName) return null;
        
        const normalized = layerName.toUpperCase().trim();
        
        // Check cache first
        if (this.layerMapping.has(normalized)) {
            return this.layerMapping.get(normalized);
        }
        
        // Check against standard layer names
        for (const [type, config] of Object.entries(this.standardLayers)) {
            if (config.names.some(name => normalized === name || normalized.includes(name))) {
                this.layerMapping.set(normalized, type);
                return type;
            }
        }
        
        return null;
    }

    /**
     * Set custom layer mapping
     * @param {string} layerName - Original layer name
     * @param {string} costoType - COSTO standard type
     */
    setMapping(layerName, costoType) {
        if (!layerName || !costoType) return;
        const normalized = layerName.toUpperCase().trim();
        if (this.standardLayers[costoType]) {
            this.layerMapping.set(normalized, costoType);
        }
    }

    /**
     * Get layer configuration
     * @param {string} costoType - COSTO standard type
     * @returns {Object|null} - Layer configuration
     */
    getLayerConfig(costoType) {
        return this.standardLayers[costoType] || null;
    }

    /**
     * Get all standard layer types
     * @returns {Array<string>} - Array of standard type names
     */
    getStandardTypes() {
        return Object.keys(this.standardLayers);
    }

    /**
     * Export layer mapping for project save
     * @returns {Object} - Serializable mapping object
     */
    exportMapping() {
        return Object.fromEntries(this.layerMapping);
    }

    /**
     * Import layer mapping from project
     * @param {Object} mapping - Mapping object
     */
    importMapping(mapping) {
        if (!mapping || typeof mapping !== 'object') return;
        this.layerMapping.clear();
        for (const [layerName, costoType] of Object.entries(mapping)) {
            this.setMapping(layerName, costoType);
        }
    }

    /**
     * Validate layer mapping completeness
     * @param {Array<string>} dwgLayers - Layers found in DWG file
     * @returns {Object} - Validation result with missing mappings
     */
    validateMapping(dwgLayers) {
        const unmapped = [];
        const mapped = [];
        
        for (const layerName of dwgLayers) {
            const mappedType = this.mapLayer(layerName);
            if (mappedType) {
                mapped.push({ layer: layerName, type: mappedType });
            } else {
                unmapped.push(layerName);
            }
        }
        
        return {
            mapped,
            unmapped,
            complete: unmapped.length === 0,
            requiredTypes: ['ENVELOPE', 'OBSTACLES', 'EXITS'] // Minimum required
        };
    }
}

module.exports = new CostoLayerStandard();
