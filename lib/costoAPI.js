/**
 * COSTO API Integration - V1
 * Main API handler for COSTO V1 specifications
 * Integrates all COSTO components
 */

const CostoLayerStandard = require('./costoLayerStandard');
const CostoBoxCatalog = require('./costoBoxCatalog');
const CostoOptimizationEngine = require('./costoOptimizationEngine');
const CostoComplianceChecker = require('./costoComplianceChecker');
const CostoDeviationReport = require('./costoDeviationReport');
const dxfProcessor = require('./dxfProcessor');
const DxfParser = require('dxf-parser');
const fs = require('fs');

class CostoAPI {
    constructor() {
        this.layerStandard = CostoLayerStandard;
        this.boxCatalog = CostoBoxCatalog;
    }

    /**
     * Process DWG/DXF file with COSTO layer standard
     * @param {string} filePath - Path to DXF/DWG file
     * @param {Object} layerMapping - Optional custom layer mapping
     * @returns {Object} - Processed floor plan
     */
    async processCADFile(filePath, layerMapping = null) {
        console.log('[COSTO API] Processing CAD file with COSTO layer standard...');

        // Read and parse DXF
        const content = fs.readFileSync(filePath, 'utf-8');
        const parser = new DxfParser();
        const dxf = parser.parseSync(content);

        // Apply layer mapping if provided
        if (layerMapping) {
            this.layerStandard.importMapping(layerMapping);
        }

        // Process with COSTO layer interpretation
        const processed = this.processWithCostoLayers(dxf);

        // Validate layer mapping
        const validation = this.layerStandard.validateMapping(
            Object.keys(processed.layerStats || {})
        );

        return {
            ...processed,
            layerValidation: validation,
            costoStandard: true
        };
    }

    /**
     * Process DXF entities with COSTO layer standard
     * Enhanced to handle Test2.dxf layer variations
     */
    processWithCostoLayers(dxf) {
        const entities = dxf.entities || [];
        const floorPlan = {
            envelope: null,
            obstacles: [],
            forbiddenZones: [],
            exits: [],
            fireDoors: [],
            walls: [],
            bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
        };

        const updateBounds = (x, y) => {
            if (!isFinite(x) || !isFinite(y)) return;
            floorPlan.bounds.minX = Math.min(floorPlan.bounds.minX, x);
            floorPlan.bounds.maxX = Math.max(floorPlan.bounds.maxX, x);
            floorPlan.bounds.minY = Math.min(floorPlan.bounds.minY, y);
            floorPlan.bounds.maxY = Math.max(floorPlan.bounds.maxY, y);
        };

        for (const entity of entities) {
            const layerName = entity.layer || '';
            let costoType = this.layerStandard.mapLayer(layerName);

            // Handle double underscore in layer names (ENTREE__SORTIE -> EXITS)
            if (!costoType && (layerName.includes('ENTREE') && layerName.includes('SORTIE'))) {
                costoType = 'EXITS';
            }

            // Handle walls (MUR layer or default for LINE entities)
            if (!costoType && entity.type === 'LINE') {
                // Default LINE entities to WALLS if not mapped
                costoType = 'WALLS';
            }

            if (!costoType) {
                // Try to infer from entity type
                if (entity.type === 'LWPOLYLINE' && entity.closed) {
                    const vertices = (entity.vertices || []).map(v => [v.x, v.y]);
                    vertices.forEach(v => updateBounds(v[0], v[1]));
                    const area = this.calculatePolygonArea(vertices);
                    // Large closed polylines are likely envelope
                    if (area > 500) {
                        floorPlan.envelope = vertices;
                    } else if (area > 10) {
                        // Medium areas might be obstacles
                        floorPlan.obstacles.push({
                            type: 'polygon',
                            polygon: vertices,
                            bounds: this.calculateBounds(vertices)
                        });
                    }
                }
                continue;
            }

            // Process based on COSTO type
            if (costoType === 'ENVELOPE') {
                this.processEnvelope(entity, floorPlan, updateBounds);
            } else if (costoType === 'OBSTACLES') {
                this.processObstacle(entity, floorPlan, updateBounds);
            } else if (costoType === 'FORBIDDEN') {
                this.processForbiddenZone(entity, floorPlan, updateBounds);
            } else if (costoType === 'EXITS') {
                this.processExit(entity, floorPlan, updateBounds);
            } else if (costoType === 'FIRE_DOORS') {
                this.processFireDoor(entity, floorPlan, updateBounds);
            } else if (costoType === 'WALLS') {
                this.processWall(entity, floorPlan, updateBounds);
            }
        }

        // If no envelope found, create from bounds
        if (!floorPlan.envelope && isFinite(floorPlan.bounds.minX)) {
            floorPlan.envelope = [
                [floorPlan.bounds.minX, floorPlan.bounds.minY],
                [floorPlan.bounds.maxX, floorPlan.bounds.minY],
                [floorPlan.bounds.maxX, floorPlan.bounds.maxY],
                [floorPlan.bounds.minX, floorPlan.bounds.maxY]
            ];
        }

        // Normalize bounds
        if (!isFinite(floorPlan.bounds.minX)) {
            floorPlan.bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }

        return floorPlan;
    }

    processEnvelope(entity, floorPlan, updateBounds) {
        if (entity.type === 'LWPOLYLINE' && entity.closed) {
            const vertices = (entity.vertices || []).map(v => [v.x, v.y]);
            vertices.forEach(v => updateBounds(v[0], v[1]));
            floorPlan.envelope = vertices;
        }
    }

    processObstacle(entity, floorPlan, updateBounds) {
        if (entity.type === 'LINE') {
            const start = entity.start || entity.vertices?.[0];
            const end = entity.end || entity.vertices?.[1];
            if (start && end) {
                updateBounds(start.x, start.y);
                updateBounds(end.x, end.y);
                floorPlan.obstacles.push({
                    type: 'line',
                    start: { x: start.x, y: start.y },
                    end: { x: end.x, y: end.y }
                });
            }
        } else if (entity.type === 'LWPOLYLINE') {
            const vertices = (entity.vertices || []).map(v => [v.x, v.y]);
            vertices.forEach(v => updateBounds(v[0], v[1]));
            floorPlan.obstacles.push({
                type: 'polygon',
                polygon: vertices,
                bounds: this.calculateBounds(vertices)
            });
        }
    }

    processForbiddenZone(entity, floorPlan, updateBounds) {
        if (entity.type === 'LWPOLYLINE' && entity.closed) {
            const vertices = (entity.vertices || []).map(v => [v.x, v.y]);
            vertices.forEach(v => updateBounds(v[0], v[1]));
            floorPlan.forbiddenZones.push({
                polygon: vertices,
                bounds: this.calculateBounds(vertices)
            });
        }
    }

    processExit(entity, floorPlan, updateBounds) {
        if (entity.type === 'LINE') {
            const start = entity.start || entity.vertices?.[0];
            const end = entity.end || entity.vertices?.[1];
            if (start && end) {
                updateBounds(start.x, start.y);
                updateBounds(end.x, end.y);
                floorPlan.exits.push({
                    start: { x: start.x, y: start.y },
                    end: { x: end.x, y: end.y },
                    center: {
                        x: (start.x + end.x) / 2,
                        y: (start.y + end.y) / 2
                    }
                });
            }
        }
    }

    calculatePolygonArea(vertices) {
        if (!vertices || vertices.length < 3) return 0;
        let area = 0;
        for (let i = 0; i < vertices.length; i++) {
            const j = (i + 1) % vertices.length;
            area += vertices[i][0] * vertices[j][1];
            area -= vertices[j][0] * vertices[i][1];
        }
        return Math.abs(area / 2);
    }

    processFireDoor(entity, floorPlan, updateBounds) {
        if (entity.type === 'LINE') {
            const start = entity.start || entity.vertices?.[0];
            const end = entity.end || entity.vertices?.[1];
            if (start && end) {
                updateBounds(start.x, start.y);
                updateBounds(end.x, end.y);
                floorPlan.fireDoors.push({
                    start: { x: start.x, y: start.y },
                    end: { x: end.x, y: end.y },
                    center: {
                        x: (start.x + end.x) / 2,
                        y: (start.y + end.y) / 2
                    }
                });
            }
        }
    }

    processWall(entity, floorPlan, updateBounds) {
        if (entity.type === 'LINE') {
            const start = entity.start || entity.vertices?.[0];
            const end = entity.end || entity.vertices?.[1];
            if (start && end) {
                updateBounds(start.x, start.y);
                updateBounds(end.x, end.y);
                floorPlan.walls.push({
                    start: { x: start.x, y: start.y },
                    end: { x: end.x, y: end.y }
                });
            }
        }
    }

    calculateBounds(vertices) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        vertices.forEach(v => {
            minX = Math.min(minX, v[0]);
            minY = Math.min(minY, v[1]);
            maxX = Math.max(maxX, v[0]);
            maxY = Math.max(maxY, v[1]);
        });
        return { minX, minY, maxX, maxY };
    }

    /**
     * Generate optimized layout
     * @param {Object} floorPlan - Processed floor plan
     * @param {Object} unitMix - Unit mix configuration
     * @param {Object} rules - Business rules
     * @param {Object} options - Optimization options
     * @returns {Object} - Optimized solution
     */
    generateLayout(floorPlan, unitMix, rules = {}, options = {}) {
        console.log('[COSTO API] Generating optimized layout...');

        // Initialize optimization engine
        const optimizer = new CostoOptimizationEngine(floorPlan, unitMix, rules);
        
        // Run optimization
        const solution = optimizer.optimize(options);

        // Run compliance checks
        const complianceChecker = new CostoComplianceChecker(floorPlan, rules);
        const compliance = complianceChecker.check(solution);

        // Generate deviation report
        const deviationReport = new CostoDeviationReport(unitMix, solution);
        const deviation = deviationReport.generate();

        return {
            solution,
            compliance,
            deviation,
            metrics: solution.metrics
        };
    }

    /**
     * Get box catalog configuration
     */
    getCatalog() {
        return this.boxCatalog.exportCatalog();
    }

    /**
     * Update box catalog
     */
    updateCatalog(catalog) {
        this.boxCatalog.importCatalog(catalog);
    }

    /**
     * Get layer mapping
     */
    getLayerMapping() {
        return this.layerStandard.exportMapping();
    }

    /**
     * Set layer mapping
     */
    setLayerMapping(mapping) {
        this.layerStandard.importMapping(mapping);
    }
}

module.exports = new CostoAPI();
