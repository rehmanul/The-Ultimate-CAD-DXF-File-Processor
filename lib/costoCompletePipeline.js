/**
 * COSTO Complete Pipeline
 * Integrates all components to match reference output (Image 1)
 * - Enhanced corridor network generation
 * - Radiator generation
 * - Professional PDF export with legend and title block
 */

const ProductionCorridorGenerator = require('./productionCorridorGenerator');
const AdvancedCorridorNetworkGenerator = require('./advancedCorridorNetworkGenerator');
const RadiatorGenerator = require('./radiatorGenerator');
const costoExports = require('./costoExports'); // Singleton instance

class CostoCompletePipeline {
    constructor(options = {}) {
        this.options = {
            corridorWidth: 1.2,
            useAdvancedCorridors: true,
            generateRadiators: true,
            ...options
        };
    }

    /**
     * Process complete COSTO layout with all visual elements
     * @param {Object} floorPlan - Floor plan data
     * @param {Array} boxes - Storage boxes/îlots
     * @param {Object} options - Processing options
     * @returns {Object} Complete solution with corridors, radiators, and export data
     */
    async processComplete(floorPlan, boxes, options = {}) {
        console.log('[COSTO Pipeline] Starting complete processing...');

        const solution = {
            boxes: boxes || [],
            corridors: [],
            radiators: [],
            metadata: {
                processedAt: new Date().toISOString(),
                version: '1.0',
                ...options.metadata
            }
        };

        // Step 1: Generate corridor network
        console.log('[COSTO Pipeline] Generating corridor network...');
        solution.corridors = this.generateCorridors(floorPlan, boxes);
        console.log(`[COSTO Pipeline] Generated ${solution.corridors.length} corridor segments`);

        // Step 2: Generate radiators
        if (this.options.generateRadiators) {
            console.log('[COSTO Pipeline] Generating radiators...');
            solution.radiators = this.generateRadiators(floorPlan);
            console.log(`[COSTO Pipeline] Generated ${solution.radiators.length} radiator paths`);
        }

        // Step 3: Calculate metrics
        solution.metrics = this.calculateMetrics(solution, floorPlan);

        console.log('[COSTO Pipeline] Processing complete');
        return solution;
    }

    /**
     * Generate corridor network using advanced or basic generator
     * @param {Object} floorPlan - Floor plan data
     * @param {Array} boxes - Storage boxes
     * @returns {Array} Corridor segments
     */
    generateCorridors(floorPlan, boxes) {
        if (this.options.useAdvancedCorridors) {
            const generator = new AdvancedCorridorNetworkGenerator(floorPlan, boxes, {
                corridorWidth: this.options.corridorWidth,
                margin: 0.2,
                minCorridorLength: 2.0
            });
            return generator.generateNetwork();
        } else {
            const generator = new ProductionCorridorGenerator(floorPlan, boxes, {
                corridorWidth: this.options.corridorWidth,
                margin: 0.2
            });
            return generator.generateCorridors();
        }
    }

    /**
     * Generate radiator paths along perimeter walls
     * @param {Object} floorPlan - Floor plan data
     * @returns {Array} Radiator paths
     */
    generateRadiators(floorPlan) {
        const generator = new RadiatorGenerator(floorPlan, {
            zigzagAmplitude: 0.15,
            zigzagFrequency: 0.5,
            wallOffset: 0.3
        });
        return generator.generateRadiators();
    }

    /**
     * Calculate solution metrics
     * @param {Object} solution - Solution with boxes, corridors, radiators
     * @param {Object} floorPlan - Floor plan data
     * @returns {Object} Metrics object
     */
    calculateMetrics(solution, floorPlan) {
        const boxes = solution.boxes || [];
        const corridors = solution.corridors || [];
        const radiators = solution.radiators || [];

        const totalBoxArea = boxes.reduce((sum, box) => {
            return sum + (box.area || box.width * box.height);
        }, 0);

        const totalCorridorArea = corridors.reduce((sum, corridor) => {
            return sum + (corridor.area || corridor.width * corridor.height);
        }, 0);

        const totalRadiatorLength = radiators.reduce((sum, radiator) => {
            return sum + (radiator.length || 0);
        }, 0);

        const bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const totalFloorArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);

        return {
            totalBoxes: boxes.length,
            totalBoxArea: totalBoxArea,
            totalCorridors: corridors.length,
            totalCorridorArea: totalCorridorArea,
            totalRadiators: radiators.length,
            totalRadiatorLength: totalRadiatorLength,
            totalFloorArea: totalFloorArea,
            yieldRatio: totalFloorArea > 0 ? totalBoxArea / totalFloorArea : 0,
            circulationRatio: totalFloorArea > 0 ? totalCorridorArea / totalFloorArea : 0
        };
    }

    /**
     * Export solution to PDF matching reference output
     * @param {Object} solution - Complete solution
     * @param {Object} floorPlan - Floor plan data
     * @param {Object} options - Export options
     * @returns {Promise<Uint8Array>} PDF bytes
     */
    async exportToPDF(solution, floorPlan, options = {}) {
        const exportOptions = {
            pageSize: 'A1',
            title: 'COSTO V1 - Storage Layout',
            showLegend: true,
            showTitleBlock: true,
            includeRadiators: true,
            includeCorridors: true,
            showBoxNumbers: false,
            showDimensions: false,
            scale: '1:200',
            companyName: 'COSTO',
            companyAddress: '5 chemin de la dune 95700 Roissy FRANCE',
            version: solution.metadata?.version || '1.0',
            versionId: solution.metadata?.versionId || null,
            pageNumber: 3,
            ...options
        };

        return await costoExports.exportToPDF(solution, floorPlan, solution.metrics, exportOptions);
    }

    /**
     * Export solution to DXF/DWG format
     * @param {Object} solution - Complete solution
     * @param {Object} floorPlan - Floor plan data
     * @param {Object} options - Export options
     * @returns {string} DXF content
     */
    exportToDXF(solution, floorPlan, options = {}) {
        const exportOptions = {
            includeOriginal: true,
            separateLayers: true,
            includeRadiators: true,
            includeCorridors: true,
            ...options
        };

        return costoExports.exportToDWG(solution, floorPlan, exportOptions);
    }

    /**
     * Export solution to interactive SVG
     * @param {Object} solution - Complete solution
     * @param {Object} floorPlan - Floor plan data
     * @param {Object} options - Export options
     * @returns {string} SVG content
     */
    exportToSVG(solution, floorPlan, options = {}) {
        const exportOptions = {
            width: 2400,
            height: 1600,
            interactive: true,
            showGrid: false,
            ...options
        };

        return costoExports.exportToInteractiveSVG(solution, floorPlan, exportOptions);
    }
}

module.exports = CostoCompletePipeline;
