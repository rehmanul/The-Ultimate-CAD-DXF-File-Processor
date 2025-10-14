const RealAPSProcessor = require('./realAPSProcessor');
const ProfessionalIlotPlacer = require('./professionalIlotPlacer');
const ProfessionalCorridorGenerator = require('./professionalCorridorGenerator');
const ExportManager = require('./exportManager');

class FloorPlanProcessor {
    constructor(clientId, clientSecret) {
        this.apsProcessor = new RealAPSProcessor(clientId, clientSecret);
        this.exportManager = new ExportManager();
    }

    /**
     * Runs the full floor plan processing pipeline:
     * - Extract geometry from APS API
     * - Generate ilots based on distribution and total count
     * - Generate corridors with configurable width
     * - Export results to PDF or SVG
     * 
     * @param {string} urn - Autodesk APS URN of the design file
     * @param {Object} ilotDistribution - User-defined distribution of ilot sizes, e.g. { "0-1": 10, "1-3": 25, "3-5": 30, "5-10": 35 }
     * @param {number} totalIlots - Total number of ilots to generate
     * @param {number} corridorWidth - Width of corridors to generate
     * @param {string} exportFormat - 'pdf' or 'svg'
     * @returns {Promise<Buffer>} - Exported file data buffer
     */
    async processFloorPlan(urn, ilotDistribution, totalIlots = 100, corridorWidth = 1.2, exportFormat = 'pdf') {
        // Step 1: Extract geometry from APS
        const floorPlan = await this.apsProcessor.extractGeometry(urn);

        // Step 2: Generate ilots
        const ilotPlacer = new ProfessionalIlotPlacer(floorPlan);
        const ilots = ilotPlacer.generateIlots(ilotDistribution, totalIlots);

        // Step 3: Generate corridors
        const corridorGenerator = new ProfessionalCorridorGenerator(floorPlan, ilots);
        const corridors = corridorGenerator.generateCorridors(corridorWidth);

        // Step 4: Export results
        let exportedData;
        if (exportFormat === 'pdf') {
            exportedData = await this.exportManager.exportToPDF(floorPlan, ilots, corridors);
        } else if (exportFormat === 'svg') {
            exportedData = await this.exportManager.exportToSVG(floorPlan, ilots, corridors);
        } else {
            throw new Error(`Unsupported export format: ${exportFormat}`);
        }

        return exportedData;
    }
}

module.exports = FloorPlanProcessor;
