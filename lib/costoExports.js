/**
 * COSTO Export System - V1
 * Comprehensive export functionality for COSTO V1 specifications
 * Includes: DWG, PDF, SVG, Excel/CSV, and Reports
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, StandardFonts, degrees } = require('pdf-lib');
const XLSX = require('xlsx');
const CostoLayerStandard = require('./costoLayerStandard');
const UnitSizeCalculator = require('./unitSizeCalculator');

class CostoExports {
    constructor() {
        this.layerStandard = CostoLayerStandard;
    }

    /**
     * Export to annotated DWG with proper layer separation
     * @param {Object} solution - Solution with boxes and corridors
     * @param {Object} floorPlan - Original floor plan
     * @param {Object} options - Export options
     * @returns {string} - DXF/DWG content
     */
    exportToDWG(solution, floorPlan, options = {}) {
        // Validate inputs
        if (!solution || typeof solution !== 'object') {
            throw new Error('Solution object is required');
        }
        if (!floorPlan || typeof floorPlan !== 'object') {
            throw new Error('Floor plan object is required');
        }

        const { includeOriginal = true, separateLayers = true } = options;
        const boxes = solution.boxes || [];
        const corridors = solution.corridors || [];

        let dxf = this.generateDXFHeader();

        // Define layers according to COSTO standard
        const layers = this.defineCOSTOLayers();
        dxf += this.generateDXFLayers(layers);

        // Start entities section
        dxf += `0
SECTION
2
ENTITIES
`;

        // Export original floor plan elements
        if (includeOriginal) {
            dxf += this.exportFloorPlanToDXF(floorPlan);
        }

        // Export boxes on separate layers by type
        if (separateLayers) {
            boxes.forEach(box => {
                const layerName = this.getBoxLayerName(box.type);
                dxf += this.exportBoxToDXF(box, layerName);
            });
        } else {
            boxes.forEach(box => {
                dxf += this.exportBoxToDXF(box, 'BOXES');
            });
        }

        // Export corridors
        corridors.forEach(corridor => {
            dxf += this.exportCorridorToDXF(corridor, 'CORRIDORS');
        });

        // Export radiators (RED ZIGZAG polylines along perimeter walls)
        const radiators = solution.radiators || [];
        radiators.forEach(radiator => {
            dxf += this.exportRadiatorToDXF(radiator, 'RADIATORS');
        });

        // Export dimensions
        dxf += this.exportDimensionsToDXF(boxes);

        // Export text annotations
        dxf += this.exportAnnotationsToDXF(boxes, solution);

        // Close entities and file
        dxf += `0
ENDSEC
0
EOF
`;

        return dxf;
    }

    /**
     * Export to PDF with title block and legend
     * @param {Object} solution - Solution with boxes and corridors
     * @param {Object} floorPlan - Original floor plan
     * @param {Object} metrics - Solution metrics
     * @param {Object} options - Export options
     * @returns {Promise<Uint8Array>} - PDF bytes
     */
    async exportToPDF(solution, floorPlan, metrics, options = {}) {
        // Validate inputs
        if (!solution || typeof solution !== 'object') {
            throw new Error('Solution object is required');
        }
        if (!floorPlan || typeof floorPlan !== 'object') {
            throw new Error('Floor plan object is required');
        }

        // Ensure solution has required structure
        if (!solution.boxes) solution.boxes = [];
        if (!solution.corridors) solution.corridors = [];

        // Ensure floorPlan has required structure
        if (!floorPlan.bounds) {
            floorPlan.bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        }

        const {
            pageSize = 'A1', // A3 or A1
            title = 'COSTO V1 - Storage Layout',
            showLegend = true,
            showTitleBlock = true,
            multiFloor = false // Support multiple floors on one page
        } = options;

        const pdfDoc = await PDFDocument.create();
        const pageSizes = {
            A3: [841.89, 1190.55], // mm in points (1mm = 2.83465 points)
            A1: [1683.78, 2383.94]
        };
        const [width, height] = pageSizes[pageSize] || pageSizes.A1;

        const page = pdfDoc.addPage([width, height]);

        // Draw green border (like reference)
        page.drawRectangle({
            x: 5,
            y: 5,
            width: width - 10,
            height: height - 10,
            borderColor: rgb(0, 0.5, 0),
            borderWidth: 3
        });

        // Calculate scale and offset
        const bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const planWidth = bounds.maxX - bounds.minX;
        const planHeight = bounds.maxY - bounds.minY;
        const margin = 60;
        const titleBlockHeight = showTitleBlock ? 100 : 0;
        const legendWidth = showLegend ? 180 : 0;

        // Support two floor plans side by side (like reference)
        if (multiFloor && options.floorPlans && options.floorPlans.length === 2) {
            const availableWidth = (width - margin * 3 - legendWidth) / 2;
            const availableHeight = height - margin * 2 - titleBlockHeight;

            // Draw first floor plan (upper)
            const scale1 = Math.min(availableWidth / planWidth, availableHeight / planHeight) * 0.85;
            const offsetX1 = margin;
            const offsetY1 = margin + titleBlockHeight + availableHeight / 2;

            await this.drawFloorPlanToPDF(page, options.floorPlans[0], options.solutions[0], scale1, offsetX1, offsetY1, {
                ...options,
                floorLabel: 'PLAN ETAGE 01',
                scale: options.scale || '1:200'
            });

            // Draw second floor plan (lower)
            const scale2 = scale1;
            const offsetX2 = margin;
            const offsetY2 = margin + titleBlockHeight;

            await this.drawFloorPlanToPDF(page, options.floorPlans[1], options.solutions[1], scale2, offsetX2, offsetY2, {
                ...options,
                floorLabel: 'PLAN ETAGE 02',
                scale: options.scale || '1:200'
            });
        } else {
            // Single floor plan
            const availableWidth = width - margin * 2 - legendWidth;
            const availableHeight = height - margin * 2 - titleBlockHeight;

            const scale = Math.min(availableWidth / planWidth, availableHeight / planHeight) * 0.9;
            const offsetX = margin;
            const offsetY = margin + titleBlockHeight;

            // Draw floor plan
            await this.drawFloorPlanToPDF(page, floorPlan, solution, scale, offsetX, offsetY, options);
        }

        // Draw title block
        if (showTitleBlock) {
            await this.drawTitleBlock(page, width, height, title, metrics, options);
        }

        // Draw legend
        if (showLegend) {
            await this.drawLegend(page, width - legendWidth, margin, legendWidth, height - margin * 2 - titleBlockHeight, options);
        }

        // Draw statistics
        await this.drawStatistics(page, width, height, metrics, margin, margin + 20);

        return await pdfDoc.save();
    }

    /**
     * Export to interactive SVG with hover/click datasheets
     * @param {Object} solution - Solution with boxes and corridors
     * @param {Object} floorPlan - Original floor plan
     * @param {Object} options - Export options
     * @returns {string} - SVG content
     */
    exportToInteractiveSVG(solution, floorPlan, options = {}) {
        const {
            width = 1200,
            height = 800,
            interactive = true,
            showGrid = true
        } = options;

        const bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const planWidth = bounds.maxX - bounds.minX;
        const planHeight = bounds.maxY - bounds.minY;
        const scale = Math.min(width / planWidth, height / planHeight) * 0.9;
        const offsetX = (width - planWidth * scale) / 2;
        const offsetY = (height - planHeight * scale) / 2;

        let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      .box { fill: #10b981; stroke: #059669; stroke-width: 0.5; }
      .box:hover { fill: #34d399; stroke-width: 1; }
      .corridor { fill: #e5e7eb; stroke: #9ca3af; stroke-width: 0.3; }
      .wall { stroke: #000000; stroke-width: 1; fill: none; }
      .forbidden { fill: #fee2e2; stroke: #ef4444; stroke-width: 0.5; opacity: 0.5; }
      .exit { stroke: #ef4444; stroke-width: 2; fill: none; }
      .datasheet { display: none; position: absolute; background: white; border: 1px solid #ccc; padding: 10px; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
      .box:hover + .datasheet, .box:active + .datasheet { display: block; }
    </style>
  </defs>
`;

        // Draw grid
        if (showGrid) {
            svg += this.drawSVGGrid(width, height, scale);
        }

        // Draw floor plan elements
        svg += this.drawFloorPlanToSVG(floorPlan, scale, offsetX, offsetY);

        // Draw boxes with interactive elements
        const boxes = solution.boxes || [];
        boxes.forEach((box, index) => {
            svg += this.drawBoxToSVG(box, scale, offsetX, offsetY, index, interactive);
        });

        // Draw corridors
        const corridors = solution.corridors || [];
        corridors.forEach(corridor => {
            svg += this.drawCorridorToSVG(corridor, scale, offsetX, offsetY);
        });

        // Add JavaScript for interactivity
        if (interactive) {
            svg += this.addSVGInteractivity();
        }

        svg += `</svg>`;
        return svg;
    }

    /**
     * Export to Excel/CSV - Box list, consolidated by type, discrepancies
     * @param {Object} solution - Solution with boxes
     * @param {Object} unitMix - Unit mix configuration
     * @param {Object} deviation - Deviation report
     * @param {Object} options - Export options
     * @returns {Object} - Excel workbook buffer
     */
    exportToExcel(solution, unitMix, deviation, options = {}) {
        const workbook = XLSX.utils.book_new();

        // Sheet 1: Box List
        const boxList = this.generateBoxList(solution.boxes || []);
        const ws1 = XLSX.utils.json_to_sheet(boxList);
        XLSX.utils.book_append_sheet(workbook, ws1, 'Box List');

        // Sheet 2: Consolidated by Type
        const consolidated = this.generateConsolidatedByType(solution.boxes || []);
        const ws2 = XLSX.utils.json_to_sheet(consolidated);
        XLSX.utils.book_append_sheet(workbook, ws2, 'By Type');

        // Sheet 3: Discrepancies
        if (deviation && deviation.typologies) {
            const discrepancies = deviation.typologies.map(t => ({
                Typology: t.typology,
                'Target Area (m²)': t.targetArea,
                'Actual Area (m²)': t.actualArea,
                'Deviation (m²)': t.deviation,
                'Deviation (%)': t.deviationPct,
                'Within Tolerance': t.withinTolerance ? 'Yes' : 'No',
                'Missing (m²)': t.missing,
                'Excess (m²)': t.excess,
                'Status': t.status,
                'Priority': t.priority
            }));
            const ws3 = XLSX.utils.json_to_sheet(discrepancies);
            XLSX.utils.book_append_sheet(workbook, ws3, 'Discrepancies');
        }

        // Sheet 4: Summary
        const summary = this.generateSummary(solution, unitMix, deviation);
        const ws4 = XLSX.utils.json_to_sheet(summary);
        XLSX.utils.book_append_sheet(workbook, ws4, 'Summary');

        return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    }

    /**
     * Export to CSV
     * @param {Object} solution - Solution with boxes
     * @param {Object} options - Export options
     * @returns {string} - CSV content
     */
    exportToCSV(solution, options = {}) {
        const boxes = solution.boxes || [];
        const headers = ['ID', 'Type', 'Zone', 'Row', 'X', 'Y', 'Width', 'Height', 'Area (m²)', 'Door Width'];

        let csv = headers.join(',') + '\n';

        boxes.forEach(box => {
            const row = [
                box.id || '',
                box.type || '',
                box.zone || '',
                box.row || '',
                box.x || 0,
                box.y || 0,
                box.width || 0,
                box.height || 0,
                box.area || (box.width * box.height) || 0,
                box.doorWidth || ''
            ];
            csv += row.join(',') + '\n';
        });

        return csv;
    }

    /**
     * Generate PDF report (assumptions, KPIs, compliance rate)
     * @param {Object} solution - Solution
     * @param {Object} metrics - Solution metrics
     * @param {Object} compliance - Compliance report
     * @param {Object} deviation - Deviation report
     * @param {Object} options - Export options
     * @returns {Promise<Uint8Array>} - PDF bytes
     */
    async exportReportPDF(solution, metrics, compliance, deviation, options = {}) {
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([595, 842]); // A4

        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        let y = 800;

        // Title
        page.drawText('COSTO V1 - Compliance Report', {
            x: 50,
            y,
            size: 20,
            font: boldFont
        });
        y -= 40;

        // Assumptions
        page.drawText('Assumptions', {
            x: 50,
            y,
            size: 14,
            font: boldFont
        });
        y -= 20;

        const assumptions = options.assumptions || [];
        assumptions.forEach(assumption => {
            page.drawText(`• ${assumption}`, {
                x: 60,
                y,
                size: 10,
                font
            });
            y -= 15;
        });

        y -= 20;

        // KPIs
        page.drawText('Key Performance Indicators', {
            x: 50,
            y,
            size: 14,
            font: boldFont
        });
        y -= 20;

        const kpis = [
            `Unit Mix Compliance: ${(deviation?.summary?.complianceRate || 0).toFixed(1)}%`,
            `Leasable Area: ${(metrics?.totalArea || 0).toFixed(2)} m²`,
            `Usable Area: ${(metrics?.usableArea || 0).toFixed(2)} m²`,
            `Yield: ${((metrics?.yieldRatio || 0) * 100).toFixed(1)}%`,
            `Total Boxes: ${(solution.boxes || []).length}`,
            `Partition Length: ${this.estimatePartitionLength(solution.boxes || []).toFixed(2)} m`
        ];

        kpis.forEach(kpi => {
            page.drawText(kpi, {
                x: 60,
                y,
                size: 10,
                font
            });
            y -= 15;
        });

        y -= 20;

        // Compliance Status
        page.drawText('Compliance Status', {
            x: 50,
            y,
            size: 14,
            font: boldFont
        });
        y -= 20;

        if (compliance) {
            page.drawText(`Overall: ${compliance.passed ? 'PASSED' : 'FAILED'}`, {
                x: 60,
                y,
                size: 10,
                font: compliance.passed ? font : boldFont,
                color: compliance.passed ? rgb(0, 0.5, 0) : rgb(1, 0, 0)
            });
            y -= 15;

            page.drawText(`Violations: ${compliance.violations?.length || 0}`, {
                x: 60,
                y,
                size: 10,
                font
            });
            y -= 15;
        }

        // Deviation Details
        if (deviation && deviation.typologies) {
            y -= 20;
            page.drawText('Typology Deviations', {
                x: 50,
                y,
                size: 14,
                font: boldFont
            });
            y -= 20;

            deviation.typologies.slice(0, 10).forEach(typo => {
                const status = typo.withinTolerance ? 'OK' : 'X';
                page.drawText(`${status} ${typo.typology}: ${typo.deviation.toFixed(2)} m² (${typo.deviationPct.toFixed(1)}%)`, {
                    x: 60,
                    y,
                    size: 9,
                    font
                });
                y -= 12;
            });
        }

        return await pdfDoc.save();
    }

    // Helper methods

    generateDXFHeader() {
        return `0
SECTION
2
HEADER
9
$INSUNITS
70
6
9
$ACADVER
1
AC1024
0
ENDSEC
`;
    }

    defineCOSTOLayers() {
        return [
            { name: 'ENVELOPE', color: 7 },
            { name: 'OBSTACLES', color: 1 },
            { name: 'FORBIDDEN', color: 1, linetype: 'DASHED' },
            { name: 'EXITS', color: 3 },
            { name: 'FIRE_DOORS', color: 2, linetype: 'DASHED' },
            { name: 'WALLS', color: 0 },
            { name: 'TOLE_BLANCHE', color: 0 },
            { name: 'TOLE_GRISE', color: 5 },
            { name: 'BOXES', color: 5 },
            { name: 'BOXES_S', color: 5 },
            { name: 'BOXES_M', color: 4 },
            { name: 'BOXES_L', color: 140 },
            { name: 'BOXES_XL', color: 6 },
            { name: 'CORRIDORS', color: 4, linetype: 'DASHED' },
            { name: 'MAIN_ARTERIES', color: 4, linetype: 'DASHED' },
            { name: 'RADIATORS', color: 1 },
            { name: 'DIMENSIONS', color: 6 },
            { name: 'TEXT', color: 7 }
        ];
    }

    generateDXFLayers(layers) {
        let dxf = `0
SECTION
2
TABLES
0
TABLE
2
LAYER
70
${layers.length}
`;

        layers.forEach(layer => {
            dxf += `0
LAYER
2
${layer.name}
70
0
62
${layer.color}
`;
            if (layer.linetype) {
                dxf += `6
${layer.linetype}
`;
            }
        });

        dxf += `0
ENDTAB
0
ENDSEC
`;
        return dxf;
    }

    exportFloorPlanToDXF(floorPlan) {
        let dxf = '';

        // Walls
        if (floorPlan.walls) {
            floorPlan.walls.forEach(wall => {
                if (wall.start && wall.end) {
                    dxf += `0
LINE
8
WALLS
10
${wall.start.x.toFixed(4)}
20
${wall.start.y.toFixed(4)}
11
${wall.end.x.toFixed(4)}
21
${wall.end.y.toFixed(4)}
`;
                }
            });
        }

        // Forbidden zones
        if (floorPlan.forbiddenZones) {
            floorPlan.forbiddenZones.forEach(zone => {
                if (zone.polygon) {
                    dxf += this.exportPolygonToDXF(zone.polygon, 'FORBIDDEN');
                }
            });
        }

        // Exits
        if (floorPlan.exits) {
            floorPlan.exits.forEach(exit => {
                if (exit.start && exit.end) {
                    dxf += `0
LINE
8
EXITS
10
${exit.start.x.toFixed(4)}
20
${exit.start.y.toFixed(4)}
11
${exit.end.x.toFixed(4)}
21
${exit.end.y.toFixed(4)}
`;
                }
            });
        }

        return dxf;
    }

    exportBoxToDXF(box, layerName) {
        const points = [
            [box.x, box.y],
            [box.x + box.width, box.y],
            [box.x + box.width, box.y + box.height],
            [box.x, box.y + box.height],
            [box.x, box.y] // Close
        ];

        let dxf = `0
LWPOLYLINE
8
${layerName}
62
3
70
1
90
${points.length}
`;

        points.forEach(pt => {
            dxf += `10
${pt[0].toFixed(4)}
20
${pt[1].toFixed(4)}
`;
        });

        // Add unit size label (matching reference style)
        const area = box.area || (box.width * box.height);
        // Use pre-calculated unitSize if available, otherwise calculate
        const unitSize = box.unitSize || this.calculateUnitSizeLabel(area);

        dxf += `0
TEXT
8
TEXT
10
${(box.x + box.width / 2).toFixed(4)}
20
${(box.y + box.height / 2).toFixed(4)}
40
0.5
1
${unitSize}
`;

        return dxf;
    }

    exportCorridorToDXF(corridor, layerName) {
        if (!corridor.corners || corridor.corners.length < 2) return '';

        let dxf = `0
LWPOLYLINE
8
${layerName}
62
4
70
1
90
${corridor.corners.length}
`;

        corridor.corners.forEach(corner => {
            const x = Array.isArray(corner) ? corner[0] : corner.x;
            const y = Array.isArray(corner) ? corner[1] : corner.y;
            dxf += `10
${x.toFixed(4)}
20
${y.toFixed(4)}
`;
        });

        return dxf;
    }

    /**
     * Export radiator as RED ZIGZAG polyline to DXF
     * Matches COSTO reference output exactly
     * @param {Object} radiator - Radiator with path array
     * @param {string} layerName - Layer name (typically 'RADIATORS')
     * @returns {string} - DXF entity string
     */
    exportRadiatorToDXF(radiator, layerName) {
        if (!radiator.path || radiator.path.length < 2) return '';

        let dxf = `0
LWPOLYLINE
8
${layerName}
62
1
70
0
90
${radiator.path.length}
`;

        radiator.path.forEach(pt => {
            const x = Array.isArray(pt) ? pt[0] : pt.x;
            const y = Array.isArray(pt) ? pt[1] : pt.y;
            dxf += `10
${x.toFixed(4)}
20
${y.toFixed(4)}
`;
        });

        return dxf;
    }

    exportPolygonToDXF(polygon, layerName) {
        if (!polygon || polygon.length < 3) return '';

        let dxf = `0
LWPOLYLINE
8
${layerName}
62
1
70
1
90
${polygon.length}
`;

        polygon.forEach(pt => {
            const x = Array.isArray(pt) ? pt[0] : pt.x;
            const y = Array.isArray(pt) ? pt[1] : pt.y;
            dxf += `10
${x.toFixed(4)}
20
${y.toFixed(4)}
`;
        });

        return dxf;
    }

    exportDimensionsToDXF(boxes) {
        // Simplified dimension export
        let dxf = '';
        boxes.slice(0, 10).forEach(box => { // Limit to first 10 for performance
            // Width dimension
            dxf += `0
LINE
8
DIMENSIONS
10
${box.x.toFixed(4)}
20
${(box.y - 0.5).toFixed(4)}
11
${(box.x + box.width).toFixed(4)}
21
${(box.y - 0.5).toFixed(4)}
`;
        });
        return dxf;
    }

    exportAnnotationsToDXF(boxes, solution) {
        let dxf = '';
        boxes.forEach(box => {
            // Area annotation
            dxf += `0
TEXT
8
TEXT
10
${(box.x + box.width / 2).toFixed(4)}
20
${(box.y + box.height / 2 + 0.3).toFixed(4)}
40
0.3
1
${(box.area || box.width * box.height).toFixed(2)}m²
`;
        });
        return dxf;
    }

    getBoxLayerName(type) {
        const typeMap = {
            'S': 'BOXES_S',
            'M': 'BOXES_M',
            'L': 'BOXES_L',
            'XL': 'BOXES_XL'
        };
        return typeMap[type] || 'BOXES';
    }

    async drawTitleBlock(page, width, height, title, metrics, options) {
        const font = await page.doc.embedFont(StandardFonts.Helvetica);
        const boldFont = await page.doc.embedFont(StandardFonts.HelveticaBold);

        // Title block background (green border like reference)
        page.drawRectangle({
            x: 0,
            y: height - 100,
            width: width,
            height: 100,
            borderColor: rgb(0, 0.5, 0),
            borderWidth: 3
        });

        // Title
        page.drawText(title, {
            x: 50,
            y: height - 40,
            size: 20,
            font: boldFont
        });

        // Company name and address (bottom right like reference)
        if (options.companyName) {
            page.drawText(`-${options.companyName}-`, {
                x: width - 250,
                y: 30,
                size: 12,
                font: boldFont
            });
        }
        if (options.companyAddress) {
            page.drawText(options.companyAddress, {
                x: width - 250,
                y: 15,
                size: 9,
                font
            });
        }

        // Metadata (top right) - traceability: version + versionId
        const metadata = [
            `Date: ${new Date().toLocaleDateString('fr-FR')}`,
            `Version: ${options.version || '1.0'}`,
            options.versionId ? `ID: ${options.versionId}` : null,
            `Scale: ${options.scale || '1:200'}`
        ].filter(Boolean);

        metadata.forEach((text, i) => {
            page.drawText(text, {
                x: width - 200,
                y: height - 40 - i * 15,
                size: 10,
                font
            });
        });

        // Page number (top left like reference)
        if (options.pageNumber) {
            page.drawText(String(options.pageNumber), {
                x: 20,
                y: height - 30,
                size: 14,
                font: boldFont
            });
        }
    }

    async drawFloorPlanToPDF(page, floorPlan, solution, scale, offsetX, offsetY, options = {}) {
        const font = await page.doc.embedFont(StandardFonts.Helvetica);

        // Draw walls (Tôle Blanche - thin gray lines)
        if (floorPlan.walls) {
            floorPlan.walls.forEach(wall => {
                if (wall.start && wall.end) {
                    page.drawLine({
                        start: {
                            x: offsetX + wall.start.x * scale,
                            y: offsetY + wall.start.y * scale
                        },
                        end: {
                            x: offsetX + wall.end.x * scale,
                            y: offsetY + wall.end.y * scale
                        },
                        thickness: 0.5,
                        color: rgb(0.42, 0.45, 0.5)
                    });
                }
            });
        }

        // Draw forbidden zones (if polygon) and detect spiral stairs
        if (floorPlan.forbiddenZones) {
            floorPlan.forbiddenZones.forEach(zone => {
                // Check if this is a spiral stair (circular with radius > 1.5m)
                if (zone.type === 'spiral_stair' || (zone.center && zone.radius && zone.radius > 1.5)) {
                    this.drawSpiralStair(page, zone.center, zone.radius, scale, offsetX, offsetY);
                } else if (zone.polygon && zone.polygon.length >= 3) {
                    const points = zone.polygon.map(pt => ({
                        x: offsetX + (Array.isArray(pt) ? pt[0] : pt.x) * scale,
                        y: offsetY + (Array.isArray(pt) ? pt[1] : pt.y) * scale
                    }));
                    // Draw polygon as closed path using lines
                    if (points.length >= 3) {
                        // Draw outline
                        for (let i = 0; i < points.length; i++) {
                            const p1 = points[i];
                            const p2 = points[(i + 1) % points.length];
                            page.drawLine({
                                start: p1,
                                end: p2,
                                thickness: 0.5,
                                color: rgb(1, 0, 0)
                            });
                        }
                        // Fill with semi-transparent rectangle approximation (simplified)
                        if (points.length === 4) {
                            const minX = Math.min(...points.map(p => p.x));
                            const minY = Math.min(...points.map(p => p.y));
                            const maxX = Math.max(...points.map(p => p.x));
                            const maxY = Math.max(...points.map(p => p.y));
                            page.drawRectangle({
                                x: minX,
                                y: minY,
                                width: maxX - minX,
                                height: maxY - minY,
                                color: rgb(1, 0.9, 0.9),
                                opacity: 0.3
                            });
                        }
                    }
                }
            });
        }

        // Draw exits (red lines)
        if (floorPlan.exits) {
            floorPlan.exits.forEach(exit => {
                if (exit.start && exit.end) {
                    page.drawLine({
                        start: {
                            x: offsetX + exit.start.x * scale,
                            y: offsetY + exit.start.y * scale
                        },
                        end: {
                            x: offsetX + exit.end.x * scale,
                            y: offsetY + exit.end.y * scale
                        },
                        thickness: 2,
                        color: rgb(1, 0, 0)
                    });
                }
            });
        }

        // Draw boxes with INTELLIGENT PARTITION TYPES (Tôle Grise vs Tôle Blanche)
        const boxes = solution.boxes || [];

        // PIXEL-PERFECT COLOR CALIBRATION (matching reference output exactly)
        const COLORS = {
            toleGrise: rgb(0, 0.2, 0.8),      // Blue partitions (internal)
            toleBlanche: rgb(0.42, 0.45, 0.5), // Gray walls (structural)
            radiator: rgb(0.85, 0, 0.08),      // Red radiators
            circulation: rgb(0.4, 0.7, 0.95),  // Light blue corridors
            dimension: rgb(0.3, 0.3, 0.3),     // Dark gray dimensions
            text: rgb(0, 0, 0)                 // Black text
        };

        boxes.forEach(box => {
            const x = offsetX + box.x * scale;
            const y = offsetY + box.y * scale;
            const w = box.width * scale;
            const h = box.height * scale;

            // INTELLIGENT PARTITION RENDERING
            // Draw each edge with correct partition type
            const partitions = box.partitions || {
                top: 'tole_grise',
                bottom: 'tole_grise',
                left: 'tole_grise',
                right: 'tole_grise'
            };

            // Top edge
            const topColor = partitions.top === 'tole_blanche' ? COLORS.toleBlanche : COLORS.toleGrise;
            const topWidth = partitions.top === 'tole_blanche' ? 0.5 : 2.0;
            page.drawLine({
                start: { x: x, y: y + h },
                end: { x: x + w, y: y + h },
                thickness: topWidth,
                color: topColor
            });

            // Bottom edge
            const bottomColor = partitions.bottom === 'tole_blanche' ? COLORS.toleBlanche : COLORS.toleGrise;
            const bottomWidth = partitions.bottom === 'tole_blanche' ? 0.5 : 2.0;
            page.drawLine({
                start: { x: x, y: y },
                end: { x: x + w, y: y },
                thickness: bottomWidth,
                color: bottomColor
            });

            // Left edge
            const leftColor = partitions.left === 'tole_blanche' ? COLORS.toleBlanche : COLORS.toleGrise;
            const leftWidth = partitions.left === 'tole_blanche' ? 0.5 : 2.0;
            page.drawLine({
                start: { x: x, y: y },
                end: { x: x, y: y + h },
                thickness: leftWidth,
                color: leftColor
            });

            // Right edge
            const rightColor = partitions.right === 'tole_blanche' ? COLORS.toleBlanche : COLORS.toleGrise;
            const rightWidth = partitions.right === 'tole_blanche' ? 0.5 : 2.0;
            page.drawLine({
                start: { x: x + w, y: y },
                end: { x: x + w, y: y + h },
                thickness: rightWidth,
                color: rightColor
            });

            // Draw door symbol on entrance side
            if (box.doorSide && box.doorWidth) {
                this.drawDoorSymbol(page, box, x, y, w, h, scale);
            }

            // Draw box numbering (if enabled and box has ID)
            if (options.showBoxNumbers && box.id) {
                const fontSize = Math.min(w / 8, h / 8, 6); // Scale font to box size
                const idText = box.id.replace(/^[A-Z_]+/, ''); // Simplify ID (remove prefix)

                page.drawText(idText, {
                    x: x + w / 2 - idText.length * fontSize / 3,
                    y: y + h / 2 - fontSize / 2,
                    size: Math.max(fontSize, 4),
                    font,
                    color: COLORS.text,
                    opacity: 0.7
                });
            } else if (boxes.indexOf(box) % 10 === 0 && box.id && !options.showBoxNumbers) {
                // Only label some boxes to avoid clutter (every 10th box) if numbering disabled
                const idText = box.id.replace(/^[A-Z_]+/, ''); // Simplify ID
                page.drawText(idText, {
                    x: x + w / 2 - 5,
                    y: y + h / 2 - 3,
                    size: 5,
                    font,
                    color: COLORS.text
                });
            }

            // REALISTIC DIMENSION ANNOTATIONS (if enabled)
            if (options.showDimensions && boxes.indexOf(box) % 5 === 0) {
                // Add dimension lines for selected boxes
                this.drawDimensionLine(page, x, y + h + 2, x + w, y + h + 2,
                    `${box.width.toFixed(2)}m`, font, COLORS.dimension, scale);
            }
        });

        // Draw radiators (RED ZIGZAG polylines along perimeter - matching reference)
        const radiators = solution.radiators || [];
        radiators.forEach(radiator => {
            if (radiator.path && radiator.path.length >= 2) {
                // Draw zigzag polyline for radiator
                for (let i = 0; i < radiator.path.length - 1; i++) {
                    const p1 = radiator.path[i];
                    const p2 = radiator.path[i + 1];
                    const x1 = offsetX + (Array.isArray(p1) ? p1[0] : p1.x) * scale;
                    const y1 = offsetY + (Array.isArray(p1) ? p1[1] : p1.y) * scale;
                    const x2 = offsetX + (Array.isArray(p2) ? p2[0] : p2.x) * scale;
                    const y2 = offsetY + (Array.isArray(p2) ? p2[1] : p2.y) * scale;

                    page.drawLine({
                        start: { x: x1, y: y1 },
                        end: { x: x2, y: y2 },
                        thickness: 1.2,
                        color: COLORS.radiator // Use calibrated color
                    });
                }
            }
        });

        // Draw corridors (light-blue dashed lines - "ligne circulation")
        const corridors = solution.corridors || [];
        corridors.forEach(corridor => {
            // Handle both corner-based and rectangle-based corridors
            if (corridor.corners && corridor.corners.length >= 2) {
                for (let i = 0; i < corridor.corners.length - 1; i++) {
                    const p1 = corridor.corners[i];
                    const p2 = corridor.corners[i + 1];
                    const x1 = offsetX + (Array.isArray(p1) ? p1[0] : p1.x) * scale;
                    const y1 = offsetY + (Array.isArray(p1) ? p1[1] : p1.y) * scale;
                    const x2 = offsetX + (Array.isArray(p2) ? p2[0] : p2.x) * scale;
                    const y2 = offsetY + (Array.isArray(p2) ? p2[1] : p2.y) * scale;

                    // Draw dashed line (light-blue matching reference circulation)
                    const dx = x2 - x1;
                    const dy = y2 - y1;
                    const length = Math.hypot(dx, dy);
                    const dashLength = 3;
                    const gapLength = 2;
                    const dashCount = Math.floor(length / (dashLength + gapLength));

                    for (let j = 0; j < dashCount; j++) {
                        const t1 = j * (dashLength + gapLength) / length;
                        const t2 = (j * (dashLength + gapLength) + dashLength) / length;
                        const CIRC_BLUE = COLORS.circulation; // Define locally for this scope
                        page.drawLine({
                            start: {
                                x: x1 + dx * Math.min(t1, 1),
                                y: y1 + dy * Math.min(t1, 1)
                            },
                            end: {
                                x: x1 + dx * Math.min(t2, 1),
                                y: y1 + dy * Math.min(t2, 1)
                            },
                            thickness: 1,
                            color: CIRC_BLUE
                        });
                    }
                }
            } else if (corridor.x !== undefined && corridor.y !== undefined) {
                // Rectangle-based corridor
                const x = offsetX + corridor.x * scale;
                const y = offsetY + corridor.y * scale;
                const w = (corridor.width || 1.5) * scale;
                const h = (corridor.height || 1.5) * scale;

                // Draw corridor centerline as dashed light-blue
                const isHorizontal = w > h;
                if (isHorizontal) {
                    const centerY = y + h / 2;
                    const dashCount = Math.floor(w / 5);
                    for (let j = 0; j < dashCount; j += 2) {
                        page.drawLine({
                            start: { x: x + j * 5, y: centerY },
                            end: { x: x + Math.min((j + 1) * 5, w), y: centerY },
                            thickness: 1,
                            color: COLORS.circulation
                        });
                    }
                } else {
                    const centerX = x + w / 2;
                    const dashCount = Math.floor(h / 5);
                    for (let j = 0; j < dashCount; j += 2) {
                        page.drawLine({
                            start: { x: centerX, y: y + j * 5 },
                            end: { x: centerX, y: y + Math.min((j + 1) * 5, h) },
                            thickness: 1,
                            color: COLORS.circulation
                        });
                    }
                }
            }
        });

        // Draw area annotations (SP: XXX.XX m²)
        if (options.includeAreaAnnotations && options.surfaceAreas) {
            this.drawAreaAnnotations(page, floorPlan, options.surfaceAreas, scale, offsetX, offsetY, font);
        }

        // Draw scale annotation (vertical text like reference)
        if (options.scale && options.floorLabel) {
            this.drawScaleAnnotation(page, offsetX - 30, offsetY, options.scale, font, options.floorLabel);
        }

        // Draw "SURFACES DES BOX" annotation (left side, vertical)
        if (options.floorLabel) {
            page.drawText('SURFACES DES BOX', {
                x: offsetX - 100,
                y: offsetY + 50,
                size: 9,
                font,
                color: rgb(0, 0, 0)
            });
        }
    }

    drawAreaAnnotations(page, floorPlan, surfaceAreas, scale, offsetX, offsetY, font) {
        // Draw area annotations for each zone
        Object.entries(surfaceAreas).forEach(([zone, data]) => {
            // Find zone center (simplified)
            const zoneBoxes = data.boxes || [];
            if (zoneBoxes.length > 0) {
                const centerX = zoneBoxes.reduce((sum, b) => sum + (b.x + b.width / 2), 0) / zoneBoxes.length;
                const centerY = zoneBoxes.reduce((sum, b) => sum + (b.y + b.height / 2), 0) / zoneBoxes.length;

                const x = offsetX + centerX * scale;
                const y = offsetY + centerY * scale;

                page.drawText(`SP : ${data.totalArea.toFixed(2)}m²`, {
                    x: x - 40,
                    y: y,
                    size: 8,
                    font,
                    color: rgb(0, 0, 0)
                });
            }
        });
    }

    drawScaleAnnotation(page, x, y, scaleText, font, floorLabel = 'PLAN ETAGE 01') {
        // Draw vertical text annotation (like reference)
        const text = `${floorLabel} ${scaleText}`;
        page.drawText(text, {
            x: x - 80,
            y: y,
            size: 10,
            font,
            color: rgb(0, 0, 0),
            rotate: degrees(90)
        });

        // Also draw "SURFACES DES BOX" annotation
        page.drawText('SURFACES DES BOX', {
            x: x - 100,
            y: y + 40,
            size: 9,
            font,
            color: rgb(0, 0, 0),
            rotate: degrees(90)
        });
    }

    drawLeftVerticalLabels(page, { labels = [], scaleText = '1:100', margin = 60, height = 0, titleBlockHeight = 0, availableHeight = 0 }) {
        const fontSize = 12;
        const baseX = margin - 30;
        if (labels.length >= 1) {
            const topCenterY = margin + titleBlockHeight + availableHeight * 0.75;
            const text = `${labels[0]} ${scaleText}`;
            page.drawText(text, {
                x: baseX,
                y: topCenterY,
                size: fontSize,
                color: rgb(0, 0, 0),
                rotate: degrees(90)
            });
        }
        if (labels.length >= 2) {
            const bottomCenterY = margin + titleBlockHeight + availableHeight * 0.25;
            const text = `${labels[1]} ${scaleText}`;
            page.drawText(text, {
                x: baseX,
                y: bottomCenterY,
                size: fontSize,
                color: rgb(0, 0, 0),
                rotate: degrees(90)
            });
        }
        // Surfaces label centered between floors
        if (availableHeight) {
            const midY = margin + titleBlockHeight + availableHeight * 0.5;
            page.drawText('SURFACES DES BOX', {
                x: baseX - 20,
                y: midY,
                size: 11,
                color: rgb(0, 0, 0),
                rotate: degrees(90)
            });
        }
    }

    async drawReferenceLegend(page, x, y, width, height, options = {}) {
        const font = await page.doc.embedFont(StandardFonts.Helvetica);
        const boldFont = await page.doc.embedFont(StandardFonts.HelveticaBold);
        const centerX = x + width / 2;
        const startY = y + height * 0.7;

        const lineItems = [
            { label: 'Tole Blanche', color: rgb(0.42, 0.45, 0.5), thickness: 1, style: 'solid' },
            { label: 'Tole Grise', color: rgb(0, 0, 1), thickness: 2, style: 'solid' },
            { label: 'ligne circulation', color: rgb(0.4, 0.7, 0.95), thickness: 1, style: 'dashed' },
            { label: 'Radiateur', color: rgb(0.85, 0, 0.08), thickness: 1, style: 'zigzag' }
        ];

        let currentY = startY;
        lineItems.forEach((item) => {
            const lineStartX = centerX - 60;
            const lineEndX = centerX + 60;

            if (item.style === 'zigzag') {
                // Draw radiator zigzag sample (red zigzag line)
                const zigPts = [];
                const zigLen = lineEndX - lineStartX;
                const zigStep = 8;
                const zigAmp = 4;
                for (let zi = 0; zi <= Math.floor(zigLen / zigStep); zi++) {
                    zigPts.push({
                        x: lineStartX + zi * zigStep,
                        y: currentY + ((zi % 2 === 0) ? zigAmp : -zigAmp)
                    });
                }
                for (let zi = 0; zi < zigPts.length - 1; zi++) {
                    page.drawLine({
                        start: zigPts[zi], end: zigPts[zi + 1],
                        thickness: item.thickness, color: item.color
                    });
                }
            } else if (item.style === 'dashed') {
                // Draw dashed line sample (light-blue dashed)
                const dashLen = 8, gapLen = 5;
                for (let di = 0; di < 8; di++) {
                    page.drawLine({
                        start: { x: lineStartX + di * (dashLen + gapLen), y: currentY },
                        end: { x: lineStartX + di * (dashLen + gapLen) + dashLen, y: currentY },
                        thickness: item.thickness, color: item.color
                    });
                }
            } else {
                // Solid line sample
                page.drawLine({
                    start: { x: lineStartX, y: currentY },
                    end: { x: lineEndX, y: currentY },
                    thickness: item.thickness, color: item.color
                });
            }

            page.drawText(item.label, {
                x: centerX + 70,
                y: currentY - 10,
                size: 11,
                font: boldFont,
                color: rgb(0, 0, 0),
                rotate: degrees(90)
            });

            currentY -= 70;
        });

        if (options.includeCompass) {
            await this.drawCompassRose(page, x + width - 40, y + height - 80, 40);
        }
    }

    async drawLegend(page, x, y, width, height, options = {}) {
        const font = await page.doc.embedFont(StandardFonts.Helvetica);
        const boldFont = await page.doc.embedFont(StandardFonts.HelveticaBold);

        // Legend title
        page.drawText('LÉGENDE', {
            x,
            y: y + height - 20,
            size: 12,
            font: boldFont
        });

        // Legend items matching COSTO reference exactly
        const legendItems = [
            {
                label: 'Tôle Blanche',
                description: 'White Sheet Metal (Walls)',
                lineStyle: 'solid',
                color: rgb(0.42, 0.45, 0.5),
                thickness: 1
            },
            {
                label: 'Tôle Grise',
                description: 'Grey Sheet Metal (Box Partitions)',
                lineStyle: 'solid',
                color: rgb(0, 0, 1),
                thickness: 2
            },
            {
                label: 'Ligne circulation',
                description: 'Circulation Path (Corridor)',
                lineStyle: 'dashed',
                color: rgb(0.4, 0.7, 0.95),
                thickness: 1
            },
            {
                label: 'Radiateur',
                description: 'Perimeter Radiator (Heating)',
                lineStyle: 'zigzag',
                color: rgb(0.85, 0, 0.08),
                thickness: 1
            }
        ];

        let currentY = y + height - 50;
        legendItems.forEach((item) => {
            // Draw line sample based on style
            if (item.lineStyle === 'zigzag') {
                // Zigzag sample for radiators
                const zigStep = 4, zigAmp = 3;
                for (let zi = 0; zi < 7; zi++) {
                    page.drawLine({
                        start: { x: x + zi * zigStep, y: currentY + ((zi % 2 === 0) ? zigAmp : -zigAmp) },
                        end: { x: x + (zi + 1) * zigStep, y: currentY + (((zi + 1) % 2 === 0) ? zigAmp : -zigAmp) },
                        thickness: item.thickness,
                        color: item.color
                    });
                }
            } else if (item.lineStyle === 'dashed') {
                // Dashed line sample for circulation
                for (let j = 0; j < 5; j++) {
                    page.drawLine({
                        start: { x: x + j * 6, y: currentY },
                        end: { x: x + j * 6 + 4, y: currentY },
                        thickness: item.thickness,
                        color: item.color
                    });
                }
            } else {
                // Solid line sample
                page.drawLine({
                    start: { x, y: currentY },
                    end: { x: x + 30, y: currentY },
                    thickness: item.thickness,
                    color: item.color
                });
            }

            // Label
            page.drawText(item.label, {
                x: x + 35,
                y: currentY - 5,
                size: 9,
                font: boldFont
            });
            page.drawText(item.description, {
                x: x + 35,
                y: currentY - 15,
                size: 8,
                font
            });

            currentY -= 35;
        });

        // Compass rose (if requested)
        if (options.includeCompass) {
            currentY -= 20;
            await this.drawCompassRose(page, x + 20, currentY, 30);
        }
    }

    /**
     * Draw spiral stair graphic matching reference output
     * @param {Object} page - PDF page
     * @param {Object} center - Stair center {x, y}
     * @param {number} radius - Stair radius in meters
     * @param {number} scale - Drawing scale
     * @param {number} offsetX - X offset
     * @param {number} offsetY - Y offset
     */
    /**
     * Draw door symbol on box entrance
     * @param {Object} page - PDF page
     * @param {Object} box - Box object with doorSide and doorWidth
     * @param {number} x - Box x position on page
     * @param {number} y - Box y position on page
     * @param {number} w - Box width on page
     * @param {number} h - Box height on page
     * @param {number} scale - Drawing scale
     */
    drawDoorSymbol(page, box, x, y, w, h, scale) {
        const doorWidth = (box.doorWidth || 0.8) * scale; // Default 0.8m door
        const doorSide = box.doorSide || 'front'; // front, back, left, right

        // Door opening arc (quarter circle)
        const arcPoints = 12;
        const doorColor = rgb(0.3, 0.3, 0.3);

        let doorX, doorY, arcStartAngle;

        switch (doorSide) {
            case 'front': // Bottom edge
                doorX = x + (w - doorWidth) / 2;
                doorY = y;
                arcStartAngle = 0;
                // Draw door opening arc
                for (let i = 0; i < arcPoints; i++) {
                    const angle1 = arcStartAngle + (i / arcPoints) * Math.PI / 2;
                    const angle2 = arcStartAngle + ((i + 1) / arcPoints) * Math.PI / 2;
                    page.drawLine({
                        start: { x: doorX, y: doorY + doorWidth * Math.sin(angle1) },
                        end: { x: doorX + doorWidth * Math.cos(angle1), y: doorY + doorWidth * Math.sin(angle1) },
                        thickness: 0.5,
                        color: doorColor
                    });
                }
                break;
            case 'back': // Top edge
                doorX = x + (w - doorWidth) / 2;
                doorY = y + h;
                arcStartAngle = Math.PI;
                break;
            case 'left': // Left edge
                doorX = x;
                doorY = y + (h - doorWidth) / 2;
                arcStartAngle = Math.PI / 2;
                break;
            case 'right': // Right edge
                doorX = x + w;
                doorY = y + (h - doorWidth) / 2;
                arcStartAngle = -Math.PI / 2;
                break;
        }

        // Draw door gap (small opening in box outline)
        const gapColor = rgb(1, 1, 1); // White to "erase" box outline
        if (doorSide === 'front' || doorSide === 'back') {
            page.drawLine({
                start: { x: doorX, y: doorY },
                end: { x: doorX + doorWidth, y: doorY },
                thickness: 3,
                color: gapColor
            });
        } else {
            page.drawLine({
                start: { x: doorX, y: doorY },
                end: { x: doorX, y: doorY + doorWidth },
                thickness: 3,
                color: gapColor
            });
        }
    }

    /**
     * REALISTIC DIMENSION LINE
     * Draws dimension line with arrows and measurement text
     */
    drawDimensionLine(page, x1, y1, x2, y2, label, font, color, scale) {
        const arrowSize = 3;

        // Main dimension line
        page.drawLine({
            start: { x: x1, y: y1 },
            end: { x: x2, y: y2 },
            thickness: 0.5,
            color: color
        });

        // Arrow at start
        const angle = Math.atan2(y2 - y1, x2 - x1);
        page.drawLine({
            start: { x: x1, y: y1 },
            end: { x: x1 + arrowSize * Math.cos(angle + 2.7), y: y1 + arrowSize * Math.sin(angle + 2.7) },
            thickness: 0.5,
            color: color
        });
        page.drawLine({
            start: { x: x1, y: y1 },
            end: { x: x1 + arrowSize * Math.cos(angle - 2.7), y: y1 + arrowSize * Math.sin(angle - 2.7) },
            thickness: 0.5,
            color: color
        });

        // Arrow at end
        page.drawLine({
            start: { x: x2, y: y2 },
            end: { x: x2 - arrowSize * Math.cos(angle + 2.7), y: y2 - arrowSize * Math.sin(angle + 2.7) },
            thickness: 0.5,
            color: color
        });
        page.drawLine({
            start: { x: x2, y: y2 },
            end: { x: x2 - arrowSize * Math.cos(angle - 2.7), y: y2 - arrowSize * Math.sin(angle - 2.7) },
            thickness: 0.5,
            color: color
        });

        // Dimension text
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        page.drawText(label, {
            x: midX - label.length * 2,
            y: midY + 2,
            size: 6,
            font: font,
            color: color
        });
    }

    drawSpiralStair(page, center, radius, scale, offsetX, offsetY) {
        const cx = offsetX + center.x * scale;
        const cy = offsetY + center.y * scale;
        const r = radius * scale;

        // Draw outer circle (stair boundary)
        const circlePoints = 36; // Number of segments for circle
        for (let i = 0; i < circlePoints; i++) {
            const angle1 = (i / circlePoints) * 2 * Math.PI;
            const angle2 = ((i + 1) / circlePoints) * 2 * Math.PI;
            page.drawLine({
                start: {
                    x: cx + r * Math.cos(angle1),
                    y: cy + r * Math.sin(angle1)
                },
                end: {
                    x: cx + r * Math.cos(angle2),
                    y: cy + r * Math.sin(angle2)
                },
                thickness: 1,
                color: rgb(0.3, 0.3, 0.3)
            });
        }

        // Draw spiral steps (radiating lines)
        const stepCount = 12; // Number of steps visible
        for (let i = 0; i < stepCount; i++) {
            const angle = (i / stepCount) * 2 * Math.PI;
            const innerRadius = r * 0.3; // Inner void radius
            page.drawLine({
                start: {
                    x: cx + innerRadius * Math.cos(angle),
                    y: cy + innerRadius * Math.sin(angle)
                },
                end: {
                    x: cx + r * Math.cos(angle),
                    y: cy + r * Math.sin(angle)
                },
                thickness: 0.5,
                color: rgb(0.5, 0.5, 0.5)
            });
        }

        // Draw inner circle (central void)
        const innerRadius = r * 0.3;
        for (let i = 0; i < circlePoints; i++) {
            const angle1 = (i / circlePoints) * 2 * Math.PI;
            const angle2 = ((i + 1) / circlePoints) * 2 * Math.PI;
            page.drawLine({
                start: {
                    x: cx + innerRadius * Math.cos(angle1),
                    y: cy + innerRadius * Math.sin(angle1)
                },
                end: {
                    x: cx + innerRadius * Math.cos(angle2),
                    y: cy + innerRadius * Math.sin(angle2)
                },
                thickness: 1,
                color: rgb(0.3, 0.3, 0.3)
            });
        }
    }

    async drawCompassRose(page, centerX, centerY, size) {
        const font = await page.doc.embedFont(StandardFonts.Helvetica);

        // Draw N arrow (vertical line)
        page.drawLine({
            start: { x: centerX, y: centerY },
            end: { x: centerX, y: centerY + size },
            thickness: 2,
            color: rgb(0, 0, 0)
        });

        // Draw arrowhead (triangle using lines)
        const arrowSize = 5;
        page.drawLine({
            start: { x: centerX, y: centerY + size },
            end: { x: centerX - arrowSize, y: centerY + size - arrowSize },
            thickness: 2,
            color: rgb(0, 0, 0)
        });
        page.drawLine({
            start: { x: centerX, y: centerY + size },
            end: { x: centerX + arrowSize, y: centerY + size - arrowSize },
            thickness: 2,
            color: rgb(0, 0, 0)
        });
        page.drawLine({
            start: { x: centerX - arrowSize, y: centerY + size - arrowSize },
            end: { x: centerX + arrowSize, y: centerY + size - arrowSize },
            thickness: 2,
            color: rgb(0, 0, 0)
        });

        // N label
        page.drawText('N', {
            x: centerX - 3,
            y: centerY + size + 5,
            size: 10,
            font
        });
    }

    async drawStatistics(page, width, height, metrics, x, y) {
        const font = await page.doc.embedFont(StandardFonts.Helvetica);

        const stats = [
            `Total Area: ${(metrics?.totalArea || 0).toFixed(2)} m²`,
            `Yield: ${((metrics?.yieldRatio || 0) * 100).toFixed(1)}%`,
            `Compliance: ${(metrics?.unitMixCompliance || 0) * 100}%`
        ];

        stats.forEach((stat, i) => {
            page.drawText(stat, {
                x,
                y: y - i * 15,
                size: 10,
                font
            });
        });
    }

    drawSVGGrid(width, height, scale) {
        let svg = '<g id="grid">';
        const gridSize = 1; // 1m grid
        for (let x = 0; x < width; x += gridSize * scale) {
            svg += `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#e5e7eb" stroke-width="0.5"/>`;
        }
        for (let y = 0; y < height; y += gridSize * scale) {
            svg += `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#e5e7eb" stroke-width="0.5"/>`;
        }
        svg += '</g>';
        return svg;
    }

    drawFloorPlanToSVG(floorPlan, scale, offsetX, offsetY) {
        let svg = '<g id="floorplan">';

        // Walls
        if (floorPlan.walls) {
            floorPlan.walls.forEach(wall => {
                if (wall.start && wall.end) {
                    svg += `<line x1="${offsetX + wall.start.x * scale}" y1="${offsetY + wall.start.y * scale}" ` +
                        `x2="${offsetX + wall.end.x * scale}" y2="${offsetY + wall.end.y * scale}" class="wall"/>`;
                }
            });
        }

        svg += '</g>';
        return svg;
    }

    drawBoxToSVG(box, scale, offsetX, offsetY, index, interactive) {
        const x = offsetX + box.x * scale;
        const y = offsetY + box.y * scale;
        const w = box.width * scale;
        const h = box.height * scale;

        let svg = `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="box" `;
        if (interactive) {
            svg += `id="box-${index}" data-box-id="${box.id}" data-box-type="${box.type}" `;
            svg += `data-box-area="${box.area || box.width * box.height}" `;
            svg += `onmouseover="showDatasheet(event, ${index})" `;
            svg += `onmouseout="hideDatasheet(${index})" `;
        }
        svg += '/>';

        if (interactive) {
            svg += `<g class="datasheet" id="datasheet-${index}">`;
            svg += `<rect x="${x + w + 5}" y="${y}" width="150" height="100" fill="white" stroke="#ccc"/>`;
            svg += `<text x="${x + w + 10}" y="${y + 15}" font-size="10">ID: ${box.id}</text>`;
            svg += `<text x="${x + w + 10}" y="${y + 30}" font-size="10">Type: ${box.type}</text>`;
            svg += `<text x="${x + w + 10}" y="${y + 45}" font-size="10">Area: ${(box.area || box.width * box.height).toFixed(2)} m²</text>`;
            svg += `<text x="${x + w + 10}" y="${y + 60}" font-size="10">Zone: ${box.zone || ''}</text>`;
            svg += `<text x="${x + w + 10}" y="${y + 75}" font-size="10">Row: ${box.row || ''}</text>`;
            svg += '</g>';
        }

        return svg;
    }

    drawCorridorToSVG(corridor, scale, offsetX, offsetY) {
        if (!corridor.corners || corridor.corners.length < 2) return '';

        let points = '';
        corridor.corners.forEach(corner => {
            const x = (Array.isArray(corner) ? corner[0] : corner.x) * scale + offsetX;
            const y = (Array.isArray(corner) ? corner[1] : corner.y) * scale + offsetY;
            points += `${x},${y} `;
        });

        return `<polygon points="${points}" class="corridor"/>`;
    }

    addSVGInteractivity() {
        return `
  <script>
    function showDatasheet(event, index) {
      const datasheet = document.getElementById('datasheet-' + index);
      if (datasheet) {
        datasheet.style.display = 'block';
        const box = document.getElementById('box-' + index);
        if (box) {
          const rect = box.getBoundingClientRect();
          const svg = box.ownerSVGElement;
          const svgRect = svg.getBoundingClientRect();
          datasheet.setAttribute('transform', 'translate(' + (rect.right - svgRect.left + 5) + ',' + (rect.top - svgRect.top) + ')');
        }
      }
    }
    function hideDatasheet(index) {
      const datasheet = document.getElementById('datasheet-' + index);
      if (datasheet) datasheet.style.display = 'none';
    }
  </script>
`;
    }

    generateBoxList(boxes) {
        return boxes.map(box => ({
            'ID': box.id || '',
            'Type': box.type || '',
            'Zone': box.zone || '',
            'Row': box.row || 0,
            'X (m)': box.x || 0,
            'Y (m)': box.y || 0,
            'Width (m)': box.width || 0,
            'Height (m)': box.height || 0,
            'Area (m²)': box.area || (box.width * box.height) || 0,
            'Door Width (m)': box.doorWidth || ''
        }));
    }

    generateConsolidatedByType(boxes) {
        const byType = {};
        boxes.forEach(box => {
            const type = box.type || 'Unknown';
            if (!byType[type]) {
                byType[type] = {
                    Type: type,
                    Count: 0,
                    'Total Area (m²)': 0,
                    'Average Area (m²)': 0,
                    'Min Area (m²)': Infinity,
                    'Max Area (m²)': 0
                };
            }
            const area = box.area || (box.width * box.height) || 0;
            byType[type].Count++;
            byType[type]['Total Area (m²)'] += area;
            byType[type]['Min Area (m²)'] = Math.min(byType[type]['Min Area (m²)'], area);
            byType[type]['Max Area (m²)'] = Math.max(byType[type]['Max Area (m²)'], area);
        });

        Object.values(byType).forEach(type => {
            type['Average Area (m²)'] = type['Total Area (m²)'] / type.Count;
            if (!isFinite(type['Min Area (m²)'])) type['Min Area (m²)'] = 0;
        });

        return Object.values(byType);
    }

    generateSummary(solution, unitMix, deviation) {
        return [
            { Metric: 'Total Boxes', Value: (solution.boxes || []).length },
            { Metric: 'Total Area (m²)', Value: (solution.boxes || []).reduce((sum, b) => sum + (b.area || b.width * b.height || 0), 0) },
            { Metric: 'Compliance Rate (%)', Value: deviation?.summary?.complianceRate || 0 },
            { Metric: 'Lost Area (m²)', Value: deviation?.summary?.lostArea || 0 },
            { Metric: 'Status', Value: deviation?.summary?.overallStatus || 'unknown' }
        ];
    }

    estimatePartitionLength(boxes) {
        // Estimate: perimeter of all boxes (simplified)
        return boxes.reduce((sum, box) => {
            return sum + 2 * (box.width + box.height);
        }, 0);
    }

    /**
     * Calculate unit size label from area (uses shared calculator for consistency)
     * @param {number} area - Area in m²
     * @returns {number} - Unit size label
     */
    calculateUnitSizeLabel(area) {
        return UnitSizeCalculator.calculateUnitSizeLabel(area);
    }

    /**
     * Get unit group from size label (uses shared calculator for consistency)
     * @param {number|string} sizeLabel - Unit size label
     * @returns {string} - Group identifier
     */
    getUnitGroup(sizeLabel) {
        return UnitSizeCalculator.getUnitGroup(sizeLabel);
    }

    /**
     * Enhanced PDF export matching reference architectural floor plan
     * Includes unit size labels, comprehensive legend, dimensions, and annotations
     * @param {Object} solution - Solution with boxes and corridors
     * @param {Object} floorPlan - Original floor plan
     * @param {Object} metrics - Solution metrics
     * @param {Object} options - Export options
     * @returns {Promise<Uint8Array>} - PDF bytes
     */
    async exportToReferencePDF(solution, floorPlan, metrics, options = {}) {
        // Validate inputs
        if (!solution || typeof solution !== 'object') {
            throw new Error('Solution object is required');
        }
        if (!floorPlan || typeof floorPlan !== 'object') {
            throw new Error('Floor plan object is required');
        }

        // Ensure solution has required structure
        if (!solution.boxes) solution.boxes = [];
        if (!solution.corridors) solution.corridors = [];

        // Ensure floorPlan has required structure
        if (!floorPlan.bounds) {
            floorPlan.bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        }
        if (!floorPlan.walls) floorPlan.walls = [];
        if (!floorPlan.rooms) floorPlan.rooms = [];
        if (!floorPlan.doors) floorPlan.doors = [];
        if (!floorPlan.envelope) floorPlan.envelope = [];

        const {
            pageSize = 'A1',
            title = 'COSTO V1 - Storage Layout',
            showLegend = true,
            showTitleBlock = true,
            scale = '1:100',
            drawingNumber = '[01]',
            sheetNumber = '3',
            documentId = '',
            companyName = 'COSTO',
            companyAddress = '5 chemin de la dime 95700 Roissy FRANCE',
            legendMode = 'reference',
            includeCompass = true,
            showScaleInfo = false,
            showDimensions = true,
            showUnitLabels = true,
            showAreas = true,
            showDoors = true,
            specializedAreas = [], // [{type: 'LOADING_BAY', polygon: [...], label: 'LOADING BAY'}]
            multiFloor = false,
            floorPlans = null,
            solutions = null,
            floorLabels = null,
            useRowZigzags = true
        } = options;

        const pdfDoc = await PDFDocument.create();
        const pageSizes = {
            A3: [841.89, 1190.55],
            A1: [1683.78, 2383.94]
        };
        const [width, height] = pageSizes[pageSize] || pageSizes.A1;
        const page = pdfDoc.addPage([width, height]);

        // Calculate layout parameters FIRST (fix variable order issue)
        const bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const planWidth = bounds.maxX - bounds.minX;
        const planHeight = bounds.maxY - bounds.minY;
        const margin = 60;
        const titleBlockHeight = showTitleBlock ? 100 : 0;
        const legendWidth = showLegend ? 200 : 0;

        // Draw green border (matching reference style) - ALWAYS with color
        page.drawRectangle({
            x: 5,
            y: 5,
            width: width - 10,
            height: height - 10,
            borderColor: rgb(0, 0.5, 0), // Green border
            borderWidth: 3
        });

        // Draw sheet number box (top-left) like reference
        if (sheetNumber) {
            const boxSize = 36;
            const boxX = 18;
            const boxY = height - boxSize - 18;
            page.drawRectangle({
                x: boxX,
                y: boxY,
                width: boxSize,
                height: boxSize,
                borderColor: rgb(0, 0.5, 0),
                borderWidth: 2
            });
            page.drawText(String(sheetNumber), {
                x: boxX + 12,
                y: boxY + 8,
                size: 16,
                color: rgb(0, 0.5, 0)
            });
        }

        // White background for drawing area
        page.drawRectangle({
            x: margin,
            y: margin + titleBlockHeight,
            width: width - margin * 2 - legendWidth,
            height: height - margin * 2 - titleBlockHeight,
            color: rgb(1, 1, 1) // White background
        });

        const availableWidth = width - margin * 2 - legendWidth;
        const availableHeight = height - margin * 2 - titleBlockHeight;
        const offsetX = margin;
        const offsetY = margin + titleBlockHeight;

        const canMultiFloor = multiFloor &&
            Array.isArray(floorPlans) &&
            floorPlans.length >= 2 &&
            Array.isArray(solutions) &&
            solutions.length >= 2;

        if (canMultiFloor) {
            const fp1 = floorPlans[0];
            const fp2 = floorPlans[1];
            const sol1 = solutions[0];
            const sol2 = solutions[1];

            const b1 = fp1.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
            const b2 = fp2.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
            const maxPlanWidth = Math.max(b1.maxX - b1.minX, b2.maxX - b2.minX);
            const maxPlanHeight = Math.max(b1.maxY - b1.minY, b2.maxY - b2.minY);
            const floorHeight = availableHeight / 2;
            const scaleFactor = Math.min(availableWidth / maxPlanWidth, floorHeight / maxPlanHeight) * 0.9;

            const topOffsetY = offsetY + floorHeight;
            const bottomOffsetY = offsetY;

            const label1 = (Array.isArray(floorLabels) && floorLabels[0]) ? floorLabels[0] : 'PLAN ETAGE 01';
            const label2 = (Array.isArray(floorLabels) && floorLabels[1]) ? floorLabels[1] : 'PLAN ETAGE 02';

            await this.drawEnhancedFloorPlanToPDF(page, fp1, sol1, scaleFactor, offsetX, topOffsetY, {
                ...options,
                showDimensions,
                showUnitLabels,
                specializedAreas,
                scale,
                floorLabel: label1
            });

            await this.drawEnhancedFloorPlanToPDF(page, fp2, sol2, scaleFactor, offsetX, bottomOffsetY, {
                ...options,
                showDimensions,
                showUnitLabels,
                specializedAreas,
                scale,
                floorLabel: label2
            });

            // Left margin vertical labels like reference
            this.drawLeftVerticalLabels(page, {
                labels: [label1, label2],
                scaleText: scale,
                margin,
                height,
                titleBlockHeight,
                availableHeight
            });
        } else {
            const scaleFactor = Math.min(availableWidth / planWidth, availableHeight / planHeight) * 0.9;

            // Draw floor plan with enhanced features
            await this.drawEnhancedFloorPlanToPDF(page, floorPlan, solution, scaleFactor, offsetX, offsetY, {
                ...options,
                showDimensions,
                showUnitLabels,
                specializedAreas,
                scale
            });
        }

        // Draw title block
        if (showTitleBlock) {
            await this.drawEnhancedTitleBlock(page, width, height, title, metrics, {
                ...options,
                scale,
                drawingNumber,
                companyName,
                companyAddress,
                documentId
            });
        }

        // Draw legend (reference-style by default)
        if (showLegend) {
            if (legendMode === 'reference') {
                await this.drawReferenceLegend(page, width - legendWidth, margin, legendWidth, height - margin * 2 - titleBlockHeight, {
                    includeCompass
                });
            } else {
                await this.drawComprehensiveLegend(page, width - legendWidth, margin, legendWidth, height - margin * 2 - titleBlockHeight, solution, floorPlan, options);
            }
        }

        // Draw scale annotation (bottom left)
        if (showScaleInfo) {
            await this.drawScaleInfo(page, margin, margin + 20, scale, drawingNumber, pageSize);
        }

        return await pdfDoc.save();
    }

    /**
     * Reference-style SVG export (vector) matching architectural reference visuals.
     * @param {Object} solution - Solution with boxes and corridors
     * @param {Object} floorPlan - Original floor plan
     * @param {Object} metrics - Solution metrics
     * @param {Object} options - Export options
     * @returns {Buffer} - SVG buffer
     */
    exportToReferenceSVG(solution, floorPlan, metrics, options = {}) {
        if (!solution || typeof solution !== 'object') {
            throw new Error('Solution object is required');
        }
        if (!floorPlan || typeof floorPlan !== 'object') {
            throw new Error('Floor plan object is required');
        }

        if (!solution.boxes) solution.boxes = [];
        if (!solution.corridors) solution.corridors = [];
        if (!floorPlan.bounds) {
            floorPlan.bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        }
        if (!floorPlan.walls) floorPlan.walls = [];
        if (!floorPlan.envelope) floorPlan.envelope = [];
        if (!floorPlan.exits) floorPlan.exits = [];
        if (!floorPlan.entrances) floorPlan.entrances = [];

        const {
            pageSize = 'A1',
            title = 'COSTO V1 - Storage Layout',
            showLegend = true,
            showTitleBlock = true,
            scale = '1:100',
            drawingNumber = '[01]',
            showUnitLabels = true,
            companyName = '',
            companyAddress = '',
            multiFloor = false,
            floorPlans = null,
            solutions = null,
            useRowZigzags = true
        } = options;

        const pageSizes = {
            A3: [841.89, 1190.55],
            A1: [1683.78, 2383.94]
        };
        const [width, height] = pageSizes[pageSize] || pageSizes.A1;

        const margin = 60;
        const titleBlockHeight = showTitleBlock ? 100 : 0;
        const legendWidth = showLegend ? 200 : 0;
        const availableWidth = width - margin * 2 - legendWidth;
        const availableHeight = height - margin * 2 - titleBlockHeight;
        const offsetX = margin;
        const offsetY = margin + titleBlockHeight;

        const svg = [];
        svg.push(`<?xml version="1.0" encoding="UTF-8"?>`);
        svg.push(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`);
        svg.push(`<rect width="${width}" height="${height}" fill="white"/>`);

        // Green border
        svg.push(`<rect x="5" y="5" width="${width - 10}" height="${height - 10}" fill="none" stroke="#008000" stroke-width="3"/>`);

        // Title block
        if (showTitleBlock) {
            svg.push(`<rect x="0" y="${height - 100}" width="${width}" height="100" fill="none" stroke="#008000" stroke-width="3"/>`);
            svg.push(`<text x="50" y="${height - 40}" font-family="Helvetica" font-size="20" font-weight="bold">${title}</text>`);
            svg.push(`<text x="${width - 200}" y="${height - 40}" font-family="Helvetica" font-size="10">Date: ${new Date().toLocaleDateString('fr-FR')}</text>`);
            svg.push(`<text x="${width - 200}" y="${height - 25}" font-family="Helvetica" font-size="10">Scale: ${scale}</text>`);
            if (companyName) {
                svg.push(`<text x="${width - 250}" y="30" font-family="Helvetica" font-size="12" font-weight="bold">-${companyName}-</text>`);
            }
            if (companyAddress) {
                svg.push(`<text x="${width - 250}" y="45" font-family="Helvetica" font-size="9">${companyAddress}</text>`);
            }
        }

        // Drawing area background
        svg.push(`<rect x="${margin}" y="${margin + titleBlockHeight}" width="${width - margin * 2 - legendWidth}" height="${height - margin * 2 - titleBlockHeight}" fill="white"/>`);

        const canMultiFloor = multiFloor &&
            Array.isArray(floorPlans) &&
            floorPlans.length >= 2 &&
            Array.isArray(solutions) &&
            solutions.length >= 2;

        let scaleFactor = 1;
        if (canMultiFloor) {
            const b1 = floorPlans[0].bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
            const b2 = floorPlans[1].bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
            const maxPlanWidth = Math.max(b1.maxX - b1.minX, b2.maxX - b2.minX);
            const maxPlanHeight = Math.max(b1.maxY - b1.minY, b2.maxY - b2.minY);
            const floorHeight = availableHeight / 2;
            scaleFactor = Math.min(availableWidth / maxPlanWidth, floorHeight / maxPlanHeight) * 0.9;
        } else {
            const bounds = floorPlan.bounds;
            const planWidth = bounds.maxX - bounds.minX;
            const planHeight = bounds.maxY - bounds.minY;
            scaleFactor = Math.min(availableWidth / planWidth, availableHeight / planHeight) * 0.9;
        }

        const drawZigzag = (points, strokeWidth = 1) => {
            if (!points || points.length < 2) return;
            const line = points.map(pt => `${pt.x} ${pt.y}`).join(' ');
            svg.push(`<polyline points="${line}" fill="none" stroke="#ff0000" stroke-width="${strokeWidth}"/>`);
        };

        const renderFloor = (fp, sol, drawOffsetY, floorLabel) => {
            const bounds = fp.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
            const tx = (x) => offsetX + (x - bounds.minX) * scaleFactor;
            const ty = (y) => drawOffsetY + (bounds.maxY - y) * scaleFactor;

            // Walls
            (fp.walls || []).forEach((wall) => {
                if (!wall.start || !wall.end) return;
                svg.push(`<line x1="${tx(wall.start.x)}" y1="${ty(wall.start.y)}" x2="${tx(wall.end.x)}" y2="${ty(wall.end.y)}" stroke="#000000" stroke-width="0.5"/>`);
            });

            // Envelope
            if (Array.isArray(fp.envelope) && fp.envelope.length >= 2) {
                if (fp.envelope[0].start && fp.envelope[0].end) {
                    fp.envelope.forEach((line) => {
                        if (!line.start || !line.end) return;
                        svg.push(`<line x1="${tx(line.start.x)}" y1="${ty(line.start.y)}" x2="${tx(line.end.x)}" y2="${ty(line.end.y)}" stroke="#00ff00" stroke-width="3"/>`);
                    });
                } else {
                    const points = fp.envelope.map(pt => `${tx(pt[0] ?? pt.x)} ${ty(pt[1] ?? pt.y)}`).join(' ');
                    svg.push(`<polyline points="${points}" fill="none" stroke="#00ff00" stroke-width="3"/>`);
                }
            }

            // Entrances/Exits
            (fp.entrances || []).forEach((ent) => {
                if (!ent.start || !ent.end) return;
                svg.push(`<line x1="${tx(ent.start.x)}" y1="${ty(ent.start.y)}" x2="${tx(ent.end.x)}" y2="${ty(ent.end.y)}" stroke="#00aa00" stroke-width="2"/>`);
            });
            (fp.exits || []).forEach((exit) => {
                if (!exit.start || !exit.end) return;
                svg.push(`<line x1="${tx(exit.start.x)}" y1="${ty(exit.start.y)}" x2="${tx(exit.end.x)}" y2="${ty(exit.end.y)}" stroke="#00aa00" stroke-width="2"/>`);
            });

            // Boxes
            (sol.boxes || []).forEach((box) => {
                const x = tx(box.x);
                const y = ty(box.y + box.height);
                const w = box.width * scaleFactor;
                const h = box.height * scaleFactor;
                svg.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#0000ff" stroke-width="2"/>`);
                if (showUnitLabels) {
                    const area = box.area || (box.width * box.height);
                    const label = this.calculateUnitSizeLabel(area);
                    svg.push(`<text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" font-family="Helvetica" font-size="8" fill="#000000">${label}</text>`);
                }
            });

            // Corridors (red zigzag)
            const rowZigzags = [];
            if (useRowZigzags && Array.isArray(sol.boxes) && sol.boxes.length > 0) {
                const heights = sol.boxes.map(b => b.height).filter(h => Number.isFinite(h) && h > 0).sort((a, b) => a - b);
                const medianHeight = heights.length ? heights[Math.floor(heights.length / 2)] : 1.2;
                const rowTolerance = Math.max(0.6, medianHeight * 0.6);
                const rows = new Map();

                sol.boxes.forEach((box) => {
                    const centerY = box.y + box.height / 2;
                    const key = Math.round(centerY / rowTolerance) * rowTolerance;
                    if (!rows.has(key)) rows.set(key, []);
                    rows.get(key).push(box);
                });

                Array.from(rows.values()).forEach((rowBoxes) => {
                    if (rowBoxes.length < 3) return;
                    const minX = Math.min(...rowBoxes.map(b => b.x));
                    const maxX = Math.max(...rowBoxes.map(b => b.x + b.width));
                    const centerY = rowBoxes.reduce((sum, b) => sum + (b.y + b.height / 2), 0) / rowBoxes.length;
                    const amplitude = Math.max(0.12, Math.min(0.35, medianHeight * 0.18));
                    const frequency = Math.max(0.45, (maxX - minX) / 50);
                    const points = [];
                    let peak = true;
                    for (let px = minX; px <= maxX; px += frequency) {
                        const offset = peak ? amplitude : -amplitude;
                        points.push({ x: tx(px), y: ty(centerY + offset) });
                        peak = !peak;
                    }
                    rowZigzags.push(points);
                });
            }

            if (useRowZigzags && rowZigzags.length > 0) {
                rowZigzags.forEach(points => drawZigzag(points, 1));
            } else {
                (sol.corridors || []).forEach((corridor) => {
                    let x = corridor.x;
                    let y = corridor.y;
                    let w = corridor.width;
                    let h = corridor.height;

                    if ((!Number.isFinite(x) || !Number.isFinite(y)) && Array.isArray(corridor.corners)) {
                        const xs = corridor.corners.map(pt => Array.isArray(pt) ? pt[0] : pt.x).filter(Number.isFinite);
                        const ys = corridor.corners.map(pt => Array.isArray(pt) ? pt[1] : pt.y).filter(Number.isFinite);
                        if (xs.length && ys.length) {
                            x = Math.min(...xs);
                            y = Math.min(...ys);
                            w = Math.max(...xs) - x;
                            h = Math.max(...ys) - y;
                        }
                    }

                    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
                    w = Number.isFinite(w) ? w : 1.2;
                    h = Number.isFinite(h) ? h : 1.2;

                    const isHorizontal = w >= h;
                    const amplitude = Math.max(0.15, Math.min(0.5, (isHorizontal ? h : w) * 0.35));
                    const frequency = Math.max(0.6, (isHorizontal ? w : h) / 20);
                    const zigzagPoints = [];

                    if (isHorizontal) {
                        const startX = x;
                        const endX = x + w;
                        const centerY = y + h / 2;
                        let peak = true;
                        for (let px = startX; px <= endX; px += frequency) {
                            const offset = peak ? amplitude : -amplitude;
                            zigzagPoints.push({ x: tx(px), y: ty(centerY + offset) });
                            peak = !peak;
                        }
                    } else {
                        const startY = y;
                        const endY = y + h;
                        const centerX = x + w / 2;
                        let peak = true;
                        for (let py = startY; py <= endY; py += frequency) {
                            const offset = peak ? amplitude : -amplitude;
                            zigzagPoints.push({ x: tx(centerX + offset), y: ty(py) });
                            peak = !peak;
                        }
                    }

                    drawZigzag(zigzagPoints, 1);
                });
            }

            if (floorLabel) {
                svg.push(`<text x="${offsetX - 40}" y="${drawOffsetY + 20}" font-family="Helvetica" font-size="10">${floorLabel} ${scale}</text>`);
                svg.push(`<text x="${offsetX - 40}" y="${drawOffsetY + 35}" font-family="Helvetica" font-size="9">SURFACES DES BOX</text>`);
            }
        };

        if (canMultiFloor) {
            const floorHeight = availableHeight / 2;
            renderFloor(floorPlans[0], solutions[0], offsetY + floorHeight, 'PLAN ETAGE 01');
            renderFloor(floorPlans[1], solutions[1], offsetY, 'PLAN ETAGE 02');
        } else {
            renderFloor(floorPlan, solution, offsetY, options.floorLabel || 'PLAN ETAGE 01');
        }

        // Legend
        if (showLegend) {
            const legendX = width - legendWidth + 10;
            const legendY = margin;
            svg.push(`<rect x="${legendX - 5}" y="${legendY}" width="${legendWidth - 20}" height="${height - margin * 2 - titleBlockHeight}" fill="none" stroke="#cccccc" stroke-width="1"/>`);
            svg.push(`<text x="${legendX}" y="${legendY + 20}" font-family="Helvetica" font-size="12" font-weight="bold">LEGENDE</text>`);
            svg.push(`<line x1="${legendX}" y1="${legendY + 40}" x2="${legendX + 30}" y2="${legendY + 40}" stroke="#000000" stroke-width="1"/>`);
            svg.push(`<text x="${legendX + 35}" y="${legendY + 44}" font-family="Helvetica" font-size="8">Tole Blanche</text>`);
            svg.push(`<line x1="${legendX}" y1="${legendY + 60}" x2="${legendX + 30}" y2="${legendY + 60}" stroke="#0000ff" stroke-width="2"/>`);
            svg.push(`<text x="${legendX + 35}" y="${legendY + 64}" font-family="Helvetica" font-size="8">Tole Grise</text>`);
            svg.push(`<line x1="${legendX}" y1="${legendY + 80}" x2="${legendX + 30}" y2="${legendY + 80}" stroke="#ff0000" stroke-width="1" stroke-dasharray="4 3"/>`);
            svg.push(`<text x="${legendX + 35}" y="${legendY + 84}" font-family="Helvetica" font-size="8">Ligne circulation</text>`);

            const sizeMap = {};
            solution.boxes.forEach((box) => {
                const area = box.area || (box.width * box.height);
                const sizeLabel = this.calculateUnitSizeLabel(area);
                sizeMap[sizeLabel] = (sizeMap[sizeLabel] || 0) + 1;
            });
            const sizes = Object.keys(sizeMap).map(k => Number(k)).sort((a, b) => a - b);
            let yCursor = legendY + 110;
            sizes.forEach((size) => {
                svg.push(`<text x="${legendX}" y="${yCursor}" font-family="Helvetica" font-size="8">Unit ${size}: ${sizeMap[size]}</text>`);
                yCursor += 12;
            });
        }

        // Scale info
        svg.push(`<text x="${margin}" y="${margin + 20}" font-family="Helvetica" font-size="10">${drawingNumber} ${scale} on ${pageSize}</text>`);

        svg.push(`</svg>`);
        return Buffer.from(svg.join('\n'), 'utf8');
    }

    /**
     * Draw enhanced floor plan matching reference style
     * Advanced rendering with proper colors, dimensions, and annotations
     */
    async drawEnhancedFloorPlanToPDF(page, floorPlan, solution, scale, offsetX, offsetY, options = {}) {
        // Embed fonts FIRST to ensure they're available
        const font = await page.doc.embedFont(StandardFonts.Helvetica);
        const boldFont = await page.doc.embedFont(StandardFonts.HelveticaBold);
        const useRowZigzags = options.useRowZigzags !== false;

        // Define color constants to ensure colors are always applied
        const COLORS = {
            BLACK: rgb(0, 0, 0),
            WHITE: rgb(1, 1, 1),
            RED: rgb(1, 0, 0),
            GREEN: rgb(0, 0.8, 0),
            BLUE: rgb(0, 0, 1),
            YELLOW: rgb(1, 1, 0),
            MAGENTA: rgb(0.8, 0, 0.8),
            CYAN: rgb(0, 0.8, 0.8),
            LIGHT_BLUE: rgb(0.7, 0.9, 1),
            DARK_GREEN: rgb(0, 0.5, 0)
        };

        const bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const baseOffsetX = offsetX;
        const baseOffsetY = offsetY;
        offsetX = offsetX - (bounds.minX || 0) * scale;
        offsetY = offsetY - (bounds.minY || 0) * scale;

        // Draw walls as THICK FILLED dark rectangles (matching reference architectural style)
        // Reference shows walls as solid dark gray/charcoal rectangles, not thin lines
        const WALL_COLOR = rgb(0.25, 0.25, 0.28);   // Dark charcoal (matches reference)
        const WALL_THICKNESS = 6;  // Wall thickness in PDF points (thick like reference)
        if (floorPlan.walls && Array.isArray(floorPlan.walls)) {
            floorPlan.walls.forEach(wall => {
                if (wall.start && wall.end) {
                    const x1 = offsetX + wall.start.x * scale;
                    const y1 = offsetY + wall.start.y * scale;
                    const x2 = offsetX + wall.end.x * scale;
                    const y2 = offsetY + wall.end.y * scale;
                    const wallThick = (wall.thickness || 0.15) * scale;
                    const t = Math.max(WALL_THICKNESS, wallThick);

                    // Determine if wall is mostly horizontal or vertical
                    const dx = Math.abs(x2 - x1);
                    const dy = Math.abs(y2 - y1);

                    if (dx >= dy) {
                        // Horizontal wall → draw as filled rectangle
                        page.drawRectangle({
                            x: Math.min(x1, x2),
                            y: Math.min(y1, y2) - t / 2,
                            width: Math.abs(x2 - x1) || t,
                            height: t,
                            color: WALL_COLOR
                        });
                    } else {
                        // Vertical wall → draw as filled rectangle
                        page.drawRectangle({
                            x: Math.min(x1, x2) - t / 2,
                            y: Math.min(y1, y2),
                            width: t,
                            height: Math.abs(y2 - y1) || t,
                            color: WALL_COLOR
                        });
                    }
                }
            });
        }

        // Draw external envelope as THICK DARK WALLS (matching reference)
        // Reference: envelope = thick dark gray/black walls forming the building outline
        const ENVELOPE_COLOR = rgb(0.18, 0.18, 0.22); // Dark charcoal for envelope
        const ENVELOPE_THICKNESS = 8; // Thicker than interior walls
        const DIM_TEXT_COLOR = rgb(0.3, 0.3, 0.35); // Dark gray for all dimension text

        const drawEnvelopeSegment = (x1, y1, x2, y2, length) => {
            const dx = Math.abs(x2 - x1);
            const dy = Math.abs(y2 - y1);
            const t = ENVELOPE_THICKNESS;

            if (dx >= dy) {
                page.drawRectangle({
                    x: Math.min(x1, x2),
                    y: Math.min(y1, y2) - t / 2,
                    width: Math.abs(x2 - x1) || t,
                    height: t,
                    color: ENVELOPE_COLOR
                });
            } else {
                page.drawRectangle({
                    x: Math.min(x1, x2) - t / 2,
                    y: Math.min(y1, y2),
                    width: t,
                    height: Math.abs(y2 - y1) || t,
                    color: ENVELOPE_COLOR
                });
            }

            // Envelope dimension annotations (subtle dark gray)
            if (length && length > 0.5) {
                const midX = (x1 + x2) / 2;
                const midY = (y1 + y2) / 2;
                const dimText = `${length.toFixed(2)}m`;
                const offset = (dx >= dy) ? -12 : 10;
                page.drawText(dimText, {
                    x: midX - (dx >= dy ? 15 : -10),
                    y: midY + (dx >= dy ? offset : -5),
                    size: 5,
                    font,
                    color: DIM_TEXT_COLOR
                });
            }
        };

        if (floorPlan.envelope && Array.isArray(floorPlan.envelope) && floorPlan.envelope.length > 0) {
            if (floorPlan.envelope[0].start && floorPlan.envelope[0].end) {
                floorPlan.envelope.forEach(line => {
                    if (line.start && line.end) {
                        const x1 = offsetX + line.start.x * scale;
                        const y1 = offsetY + line.start.y * scale;
                        const x2 = offsetX + line.end.x * scale;
                        const y2 = offsetY + line.end.y * scale;
                        const length = Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
                        drawEnvelopeSegment(x1, y1, x2, y2, length);
                    }
                });
            } else {
                for (let i = 0; i < floorPlan.envelope.length; i++) {
                    const p1 = floorPlan.envelope[i];
                    const p2 = floorPlan.envelope[(i + 1) % floorPlan.envelope.length];
                    const x1 = offsetX + (Array.isArray(p1) ? p1[0] : p1.x) * scale;
                    const y1 = offsetY + (Array.isArray(p1) ? p1[1] : p1.y) * scale;
                    const x2 = offsetX + (Array.isArray(p2) ? p2[0] : p2.x) * scale;
                    const y2 = offsetY + (Array.isArray(p2) ? p2[1] : p2.y) * scale;
                    drawEnvelopeSegment(x1, y1, x2, y2, null);
                }
            }
        } else if (floorPlan.bounds) {
            const { minX, minY, maxX, maxY } = floorPlan.bounds;
            if ([minX, minY, maxX, maxY].every(v => typeof v === 'number') &&
                maxX > minX && maxY > minY) {
                const corners = [
                    [minX, minY, maxX, minY],
                    [maxX, minY, maxX, maxY],
                    [maxX, maxY, minX, maxY],
                    [minX, maxY, minX, minY]
                ];
                corners.forEach(([sx, sy, ex, ey]) => {
                    drawEnvelopeSegment(
                        offsetX + sx * scale, offsetY + sy * scale,
                        offsetX + ex * scale, offsetY + ey * scale,
                        null
                    );
                });
            }
        }

        // Draw staircases as part of wall structure (dark filled, same as walls)
        // Reference: staircases are drawn as thick dark outlines, NOT colored overlays
        if (floorPlan.staircases) {
            floorPlan.staircases.forEach(staircase => {
                if (staircase.polygon && staircase.polygon.length >= 3) {
                    const points = staircase.polygon.map(pt => ({
                        x: offsetX + (Array.isArray(pt) ? pt[0] : pt.x) * scale,
                        y: offsetY + (Array.isArray(pt) ? pt[1] : pt.y) * scale
                    }));

                    // Draw outline in wall color (matching reference - no bright colors)
                    for (let i = 0; i < points.length; i++) {
                        const p1 = points[i];
                        const p2 = points[(i + 1) % points.length];
                        page.drawLine({
                            start: p1, end: p2,
                            thickness: WALL_THICKNESS,
                            color: WALL_COLOR
                        });
                    }
                }
            });
        }

        // Draw room numbers (use actual extracted numbers from DXF, 1-26 like reference)
        if (floorPlan.rooms && Array.isArray(floorPlan.rooms)) {
            floorPlan.rooms.forEach((room) => {
                // Use extracted room number if available, otherwise use index+1
                const roomNumber = room.number || room.id?.replace('room_', '') ||
                    (floorPlan.rooms.indexOf(room) + 1);

                if (roomNumber <= 26) { // Reference shows up to 26
                    // Use labelPosition if available (from TEXT entity extraction), otherwise center
                    const labelX = room.labelPosition?.x || room.center?.x || room.centroid?.x ||
                        (room.bounds ? (room.bounds.minX + room.bounds.maxX) / 2 : 0);
                    const labelY = room.labelPosition?.y || room.center?.y || room.centroid?.y ||
                        (room.bounds ? (room.bounds.minY + room.bounds.maxY) / 2 : 0);

                    if (labelX && labelY) {
                        page.drawText(String(roomNumber), {
                            x: offsetX + labelX * scale - 5,
                            y: offsetY + labelY * scale - 5,
                            size: 10,
                            font: boldFont,
                            color: COLORS.BLACK
                        });
                    }
                }
            });
        }

        // Draw RM-xxx labels as wall-colored outlines (no bright colors)
        if (floorPlan.specialRooms && Array.isArray(floorPlan.specialRooms)) {
            floorPlan.specialRooms.forEach(room => {
                if (room.label && room.label.match(/^RM-\d+$/) && room.polygon && room.polygon.length >= 3) {
                    const points = room.polygon.map(pt => ({
                        x: offsetX + (Array.isArray(pt) ? pt[0] : pt.x) * scale,
                        y: offsetY + (Array.isArray(pt) ? pt[1] : pt.y) * scale
                    }));
                    for (let i = 0; i < points.length; i++) {
                        const p1 = points[i];
                        const p2 = points[(i + 1) % points.length];
                        page.drawLine({ start: p1, end: p2, thickness: WALL_THICKNESS, color: WALL_COLOR });
                    }
                }
            });
        }

        // Draw specialized areas as wall-colored outlines  
        if (options.specializedAreas && Array.isArray(options.specializedAreas)) {
            options.specializedAreas.forEach(area => {
                if (area.polygon && area.polygon.length >= 3) {
                    const points = area.polygon.map(pt => ({
                        x: offsetX + (Array.isArray(pt) ? pt[0] : pt.x) * scale,
                        y: offsetY + (Array.isArray(pt) ? pt[1] : pt.y) * scale
                    }));
                    for (let i = 0; i < points.length; i++) {
                        const p1 = points[i];
                        const p2 = points[(i + 1) % points.length];
                        page.drawLine({ start: p1, end: p2, thickness: WALL_THICKNESS, color: WALL_COLOR });
                    }
                }
            });
        }

        // Draw forbidden zones as subtle thin dark gray outlines (no bright blue)
        if (floorPlan.forbiddenZones) {
            floorPlan.forbiddenZones.forEach(zone => {
                if (zone.polygon && zone.polygon.length >= 3) {
                    const points = zone.polygon.map(pt => ({
                        x: offsetX + (Array.isArray(pt) ? pt[0] : pt.x) * scale,
                        y: offsetY + (Array.isArray(pt) ? pt[1] : pt.y) * scale
                    }));
                    for (let i = 0; i < points.length; i++) {
                        const p1 = points[i];
                        const p2 = points[(i + 1) % points.length];
                        page.drawLine({ start: p1, end: p2, thickness: 0.5, color: WALL_COLOR });
                    }
                }
            });
        }

        // Draw entrances/exits as wall-colored gaps (no bright red/yellow)
        // In the reference, entrances are just openings in walls, not colored lines
        if (floorPlan.entrances) {
            floorPlan.entrances.forEach(entrance => {
                if (entrance.start && entrance.end && entrance.label) {
                    const midX = (entrance.start.x + entrance.end.x) / 2;
                    const midY = (entrance.start.y + entrance.end.y) / 2;
                    page.drawText(entrance.label || '', {
                        x: offsetX + midX * scale - 10,
                        y: offsetY + midY * scale - 3,
                        size: 5,
                        font,
                        color: DIM_TEXT_COLOR
                    });
                }
            });
        }

        // Draw exits as simple labels (no colored arrows)
        if (floorPlan.exits) {
            floorPlan.exits.forEach(exit => {
                if (exit.start && exit.end) {
                    const midX = (exit.start.x + exit.end.x) / 2;
                    const midY = (exit.start.y + exit.end.y) / 2;
                    page.drawText('EXIT', {
                        x: offsetX + midX * scale - 8,
                        y: offsetY + midY * scale - 3,
                        size: 5,
                        font,
                        color: DIM_TEXT_COLOR
                    });
                }
            });
        }

        // Draw boxes with unit size labels (matching COSTO reference architectural style)
        // Reference: thin black outlines, white fill, small labels, dark gray dimensions
        const boxes = solution.boxes || [];
        const BOX_OUTLINE = rgb(0.15, 0.15, 0.15); // Near-black, thin
        const DIM_COLOR = rgb(0.3, 0.3, 0.35);     // Dark gray for dimensions
        boxes.forEach(box => {
            const x = offsetX + box.x * scale;
            const y = offsetY + box.y * scale;
            const w = box.width * scale;
            const h = box.height * scale;
            const area = box.area || (box.width * box.height);

            // White fill first (reference shows white-filled boxes)
            page.drawRectangle({
                x, y, width: w, height: h,
                color: COLORS.WHITE
            });

            // Thin black outline (reference style - NOT thick blue)
            page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.8, color: BOX_OUTLINE });
            page.drawLine({ start: { x: x + w, y }, end: { x: x + w, y: y + h }, thickness: 0.8, color: BOX_OUTLINE });
            page.drawLine({ start: { x: x + w, y: y + h }, end: { x, y: y + h }, thickness: 0.8, color: BOX_OUTLINE });
            page.drawLine({ start: { x, y: y + h }, end: { x, y }, thickness: 0.8, color: BOX_OUTLINE });

            // Box number (ID) - centered, modest size like reference
            if (options.showBoxNumbers !== false && box.id) {
                const boxNumber = box.displayNumber || box.id;
                const numText = String(boxNumber);
                const numFontSize = Math.max(7, Math.min(11, w * 0.14));
                const numTextWidth = numText.length * numFontSize * 0.55;

                page.drawText(numText, {
                    x: x + w / 2 - numTextWidth / 2,
                    y: y + h / 2 + 2,
                    size: numFontSize,
                    font: boldFont,
                    color: COLORS.BLACK
                });
            }

            // Unit size label (small, below the box number)
            if (options.showUnitLabels) {
                const unitSize = box.unitSize || this.calculateUnitSizeLabel(area);
                const labelText = String(unitSize);
                const fontSize = Math.max(5, Math.min(8, w * 0.10));
                const textWidth = labelText.length * fontSize * 0.55;

                page.drawText(labelText, {
                    x: x + w / 2 - textWidth / 2,
                    y: y + h / 2 - fontSize - 2,
                    size: fontSize,
                    font,
                    color: DIM_COLOR
                });
            }

            // Dimensions (dark gray, small, clean like reference)
            if (options.showDimensions && box.width && box.height) {
                // Width dimension below box
                const dimY = y - 6;
                const dimFontSize = 5;

                page.drawLine({ start: { x, y: dimY }, end: { x: x + w, y: dimY }, thickness: 0.3, color: DIM_COLOR });
                page.drawLine({ start: { x, y: dimY - 1.5 }, end: { x, y: dimY + 1.5 }, thickness: 0.3, color: DIM_COLOR });
                page.drawLine({ start: { x: x + w, y: dimY - 1.5 }, end: { x: x + w, y: dimY + 1.5 }, thickness: 0.3, color: DIM_COLOR });

                const dimText = `${(box.width).toFixed(2)}m`;
                page.drawText(dimText, {
                    x: x + w / 2 - dimText.length * dimFontSize * 0.25,
                    y: dimY - 7,
                    size: dimFontSize,
                    font,
                    color: DIM_COLOR
                });

                // Area above box (small, subtle)
                const areaText = `${area.toFixed(2)} m²`;
                page.drawText(areaText, {
                    x: x + 1,
                    y: y + h + 3,
                    size: dimFontSize,
                    font,
                    color: DIM_COLOR
                });
            }
        });

        // ── RADIATORS: Small individual angled symbols along walls ─────
        // Reference: "Radiateur" = small discrete angled red rectangle symbols
        // placed at intervals along wall segments, with dimension labels like "100×300"
        const RADIATOR_RED = rgb(0.85, 0.15, 0.2);
        const RAD_LABEL_SIZE = 3.5;

        // Helper: draw one radiator symbol (small angled rectangle with label)
        const drawRadiatorSymbol = (cx, cy, angle, labelText) => {
            // Symbol size: small tilted rectangle (like reference)
            const symW = 8;   // Width of radiator symbol in PDF points
            const symH = 4;   // Height
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            // Four corners of the tilted rectangle
            const hw = symW / 2, hh = symH / 2;
            const corners = [
                { x: cx + cos * (-hw) - sin * (-hh), y: cy + sin * (-hw) + cos * (-hh) },
                { x: cx + cos * (hw) - sin * (-hh), y: cy + sin * (hw) + cos * (-hh) },
                { x: cx + cos * (hw) - sin * (hh), y: cy + sin * (hw) + cos * (hh) },
                { x: cx + cos * (-hw) - sin * (hh), y: cy + sin * (-hw) + cos * (hh) }
            ];

            // Draw red filled rectangle
            for (let i = 0; i < 4; i++) {
                page.drawLine({
                    start: corners[i],
                    end: corners[(i + 1) % 4],
                    thickness: 1.2,
                    color: RADIATOR_RED
                });
            }
            // Draw X inside (reference style)
            page.drawLine({ start: corners[0], end: corners[2], thickness: 0.5, color: RADIATOR_RED });
            page.drawLine({ start: corners[1], end: corners[3], thickness: 0.5, color: RADIATOR_RED });

            // Dimension label above symbol
            if (labelText) {
                page.drawText(labelText, {
                    x: cx - labelText.length * RAD_LABEL_SIZE * 0.25,
                    y: cy + symH + 1,
                    size: RAD_LABEL_SIZE,
                    font,
                    color: RADIATOR_RED
                });
            }
        };

        // Place radiator symbols along wall segments at intervals
        const radiatorData = solution.radiators || [];
        const RAD_SPACING = 3.5; // meters between radiator symbols
        const RAD_LABEL = '100×300';

        if (radiatorData.length > 0) {
            // Use provided radiator data - extract wall segments and place symbols
            radiatorData.forEach(radiator => {
                const rPath = radiator.path || [];
                if (rPath.length < 2) return;
                // Get the overall direction of this radiator run
                const sx = rPath[0].x, sy = rPath[0].y;
                const ex = rPath[rPath.length - 1].x, ey = rPath[rPath.length - 1].y;
                const runLen = Math.hypot(ex - sx, ey - sy);
                if (runLen < 0.5) return;
                const angle = Math.atan2(ey - sy, ex - sx) + Math.PI / 4; // Diagonal tilt

                // Place symbols at regular intervals along the run
                const numSymbols = Math.max(1, Math.floor(runLen / RAD_SPACING));
                for (let i = 0; i < numSymbols; i++) {
                    const t = (i + 0.5) / numSymbols;
                    const px = sx + (ex - sx) * t;
                    const py = sy + (ey - sy) * t;
                    drawRadiatorSymbol(
                        offsetX + px * scale,
                        offsetY + py * scale,
                        angle,
                        RAD_LABEL
                    );
                }
            });
        } else {
            // Fallback: place radiator symbols along perimeter walls
            const perimeterEdges = [];
            if (floorPlan.walls && Array.isArray(floorPlan.walls)) {
                // Use actual walls for radiator placement
                floorPlan.walls.forEach(wall => {
                    if (wall.start && wall.end) {
                        const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
                        if (len > 2) { // Only place on longer walls
                            perimeterEdges.push({
                                x1: wall.start.x, y1: wall.start.y,
                                x2: wall.end.x, y2: wall.end.y
                            });
                        }
                    }
                });
            }
            if (perimeterEdges.length === 0) {
                // Use bounds as fallback
                perimeterEdges.push(
                    { x1: bounds.minX, y1: bounds.minY, x2: bounds.maxX, y2: bounds.minY },
                    { x1: bounds.maxX, y1: bounds.minY, x2: bounds.maxX, y2: bounds.maxY },
                    { x1: bounds.maxX, y1: bounds.maxY, x2: bounds.minX, y2: bounds.maxY },
                    { x1: bounds.minX, y1: bounds.maxY, x2: bounds.minX, y2: bounds.minY }
                );
            }

            const floorCX = (bounds.minX + bounds.maxX) / 2;
            const floorCY = (bounds.minY + bounds.maxY) / 2;

            perimeterEdges.forEach(edge => {
                const edx = edge.x2 - edge.x1;
                const edy = edge.y2 - edge.y1;
                const elen = Math.hypot(edx, edy);
                if (elen < 2) return;

                const angle = Math.atan2(edy, edx) + Math.PI / 4; // Diagonal tilt
                // Offset slightly inward from wall
                const en1x = -edy / elen, en1y = edx / elen;
                const emidX = (edge.x1 + edge.x2) / 2;
                const emidY = (edge.y1 + edge.y2) / 2;
                const edot = en1x * (floorCX - emidX) + en1y * (floorCY - emidY);
                const inwardX = (edot >= 0 ? en1x : -en1x) * 0.3;
                const inwardY = (edot >= 0 ? en1y : -en1y) * 0.3;

                const numSymbols = Math.max(1, Math.floor(elen / RAD_SPACING));
                for (let i = 0; i < numSymbols; i++) {
                    const t = (i + 0.5) / numSymbols;
                    const px = edge.x1 + edx * t + inwardX;
                    const py = edge.y1 + edy * t + inwardY;
                    drawRadiatorSymbol(
                        offsetX + px * scale,
                        offsetY + py * scale,
                        angle,
                        RAD_LABEL
                    );
                }
            });
        }

        // ── CIRCULATION PATHS: Light-blue dashed center-lines ───────
        // Reference: "ligne circulation" = light-blue dashed lines through corridors
        const CIRCULATION_BLUE = rgb(0.4, 0.7, 0.95);
        const circulationData = solution.circulationPaths || [];

        const _drawDashedLine = (p1, p2, thickness, color) => {
            const ddx = p2.x - p1.x;
            const ddy = p2.y - p1.y;
            const dlen = Math.hypot(ddx, ddy);
            if (dlen < 1) { page.drawLine({ start: p1, end: p2, thickness, color }); return; }
            const dashL = 4, gapL = 3;
            const nd = Math.max(1, Math.floor(dlen / (dashL + gapL)));
            for (let di = 0; di < nd; di++) {
                const t1 = di * (dashL + gapL) / dlen;
                const t2 = Math.min((di * (dashL + gapL) + dashL) / dlen, 1);
                page.drawLine({
                    start: { x: p1.x + ddx * t1, y: p1.y + ddy * t1 },
                    end: { x: p1.x + ddx * t2, y: p1.y + ddy * t2 },
                    thickness, color
                });
            }
        };

        if (circulationData.length > 0) {
            circulationData.forEach(cp => {
                const cpPath = cp.path || [];
                for (let ci = 0; ci < cpPath.length - 1; ci++) {
                    _drawDashedLine(
                        { x: offsetX + cpPath[ci].x * scale, y: offsetY + cpPath[ci].y * scale },
                        { x: offsetX + cpPath[ci + 1].x * scale, y: offsetY + cpPath[ci + 1].y * scale },
                        cp.type === 'mainArtery' ? 1.2 : 0.8,
                        CIRCULATION_BLUE
                    );
                }
            });
        } else {
            // Fallback: derive dashed center-lines from corridor rectangles
            const corridors = solution.corridors || [];
            corridors.forEach(corridor => {
                let cx = corridor.x, cy = corridor.y;
                let cw = corridor.width, ch = corridor.height;
                if ((!Number.isFinite(cx) || !Number.isFinite(cy)) && Array.isArray(corridor.corners)) {
                    const cxs = corridor.corners.map(pt => Array.isArray(pt) ? pt[0] : pt.x).filter(Number.isFinite);
                    const cys = corridor.corners.map(pt => Array.isArray(pt) ? pt[1] : pt.y).filter(Number.isFinite);
                    if (cxs.length && cys.length) {
                        cx = Math.min(...cxs); cy = Math.min(...cys);
                        cw = Math.max(...cxs) - cx; ch = Math.max(...cys) - cy;
                    }
                }
                if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
                cw = Number.isFinite(cw) ? cw : 1.2;
                ch = Number.isFinite(ch) ? ch : 1.2;
                const isHz = cw >= ch;
                const sx1 = offsetX + cx * scale;
                const sy1 = offsetY + cy * scale;
                const sx2 = offsetX + (cx + cw) * scale;
                const sy2 = offsetY + (cy + ch) * scale;
                let sp, ep;
                if (isHz) {
                    const mid = (sy1 + sy2) / 2;
                    sp = { x: sx1, y: mid }; ep = { x: sx2, y: mid };
                } else {
                    const mid = (sx1 + sx2) / 2;
                    sp = { x: mid, y: sy1 }; ep = { x: mid, y: sy2 };
                }
                _drawDashedLine(sp, ep, 0.8, CIRCULATION_BLUE);
            });
        }

        // Draw total area annotations for zones (like reference "SP: XXX.XX m²")
        if (solution.zones && Array.isArray(solution.zones)) {
            solution.zones.forEach(zone => {
                if (zone.boxes && zone.boxes.length > 0) {
                    const totalArea = zone.boxes.reduce((sum, b) => sum + (b.area || b.width * b.height), 0);
                    const centerX = zone.boxes.reduce((sum, b) => sum + (b.x + b.width / 2), 0) / zone.boxes.length;
                    const centerY = zone.boxes.reduce((sum, b) => sum + (b.y + b.height / 2), 0) / zone.boxes.length;

                    const areaText = `SP: ${totalArea.toFixed(2)}m²`;

                    // Background for area text
                    page.drawRectangle({
                        x: offsetX + centerX * scale - 45,
                        y: offsetY + centerY * scale - 6,
                        width: 70,
                        height: 12,
                        color: COLORS.WHITE,
                        borderColor: COLORS.BLACK,
                        borderWidth: 0.5
                    });

                    page.drawText(areaText, {
                        x: offsetX + centerX * scale - 40,
                        y: offsetY + centerY * scale - 3,
                        size: 8,
                        font: boldFont,
                        color: COLORS.BLACK
                    });
                }
            });
        }

        // Draw section dimensions (like "23m", "39m" in reference)
        if (options.showSectionDimensions && floorPlan.sections) {
            floorPlan.sections.forEach(section => {
                if (section.start && section.end && section.label) {
                    const x1 = offsetX + section.start.x * scale;
                    const y1 = offsetY + section.start.y * scale;
                    const x2 = offsetX + section.end.x * scale;
                    const y2 = offsetY + section.end.y * scale;

                    // Dimension line (magenta like reference)
                    page.drawLine({
                        start: { x: x1, y: y1 },
                        end: { x: x2, y: y2 },
                        thickness: 0.5,
                        color: COLORS.MAGENTA
                    });

                    // Label
                    const midX = (x1 + x2) / 2;
                    const midY = (y1 + y2) / 2;
                    page.drawText(section.label, {
                        x: midX - 15,
                        y: midY - 8,
                        size: 7,
                        font: boldFont,
                        color: COLORS.MAGENTA
                    });
                }
            });
        }

        // Draw yellow annotation lines (like "ZINC Line to exit window" in reference)
        if (floorPlan.annotations && Array.isArray(floorPlan.annotations)) {
            floorPlan.annotations.forEach(annotation => {
                if (annotation.type === 'yellow' && annotation.start && annotation.end) {
                    page.drawLine({
                        start: {
                            x: offsetX + annotation.start.x * scale,
                            y: offsetY + annotation.start.y * scale
                        },
                        end: {
                            x: offsetX + annotation.end.x * scale,
                            y: offsetY + annotation.end.y * scale
                        },
                        thickness: 1.5,
                        color: COLORS.YELLOW
                    });

                    // Draw annotation text
                    if (annotation.text) {
                        const midX = (annotation.start.x + annotation.end.x) / 2;
                        const midY = (annotation.start.y + annotation.end.y) / 2;
                        page.drawText(annotation.text, {
                            x: offsetX + midX * scale - 40,
                            y: offsetY + midY * scale - 8,
                            size: 7,
                            font,
                            color: COLORS.YELLOW
                        });
                    }
                }
            });
        }

        // Draw yellow annotation boxes (like "Zero Line to exit area", "ROOF THROUGH..." in reference)
        if (floorPlan.annotations && Array.isArray(floorPlan.annotations)) {
            floorPlan.annotations.forEach(annotation => {
                if (annotation.type === 'yellow-box' && annotation.text && annotation.position) {
                    const x = offsetX + annotation.position.x * scale;
                    const y = offsetY + annotation.position.y * scale;
                    const textWidth = annotation.text.length * 4;
                    const textHeight = 12;

                    // Yellow background box
                    page.drawRectangle({
                        x: x - textWidth / 2 - 5,
                        y: y - textHeight / 2 - 3,
                        width: textWidth + 10,
                        height: textHeight + 6,
                        color: COLORS.YELLOW,
                        opacity: 0.8
                    });

                    // Black border
                    page.drawRectangle({
                        x: x - textWidth / 2 - 5,
                        y: y - textHeight / 2 - 3,
                        width: textWidth + 10,
                        height: textHeight + 6,
                        borderColor: COLORS.BLACK,
                        borderWidth: 0.5
                    });

                    // Text
                    page.drawText(annotation.text, {
                        x: x - textWidth / 2,
                        y: y - 4,
                        size: 7,
                        font: boldFont,
                        color: COLORS.BLACK
                    });
                }
            });
        }

        // Draw green filled areas (like Ex50 in reference)
        if (floorPlan.greenZones && Array.isArray(floorPlan.greenZones)) {
            floorPlan.greenZones.forEach(zone => {
                if (zone.polygon && zone.polygon.length >= 3) {
                    const points = zone.polygon.map(pt => ({
                        x: offsetX + (Array.isArray(pt) ? pt[0] : pt.x) * scale,
                        y: offsetY + (Array.isArray(pt) ? pt[1] : pt.y) * scale
                    }));

                    if (points.length === 4) {
                        const minX = Math.min(...points.map(p => p.x));
                        const minY = Math.min(...points.map(p => p.y));
                        const maxX = Math.max(...points.map(p => p.x));
                        const maxY = Math.max(...points.map(p => p.y));

                        page.drawRectangle({
                            x: minX,
                            y: minY,
                            width: maxX - minX,
                            height: maxY - minY,
                            color: rgb(0, 1, 0), // Bright green fill
                            opacity: 0.3
                        });
                    }

                    // Draw label if available
                    if (zone.label) {
                        const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
                        const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
                        page.drawText(zone.label, {
                            x: centerX - 15,
                            y: centerY - 5,
                            size: 8,
                            font: boldFont,
                            color: COLORS.BLACK
                        });
                    }
                }
            });
        }

        // Draw magenta dashed line for EXIT AREA (like reference)
        if (floorPlan.exitArea && floorPlan.exitArea.polyline) {
            const exitPoints = floorPlan.exitArea.polyline.map(pt => ({
                x: offsetX + (Array.isArray(pt) ? pt[0] : pt.x) * scale,
                y: offsetY + (Array.isArray(pt) ? pt[1] : pt.y) * scale
            }));

            // Draw dashed line (magenta)
            for (let i = 0; i < exitPoints.length - 1; i++) {
                const p1 = exitPoints[i];
                const p2 = exitPoints[i + 1];

                // Simple dashed line approximation
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const dist = Math.hypot(dx, dy);
                const dashLength = 5;
                const gapLength = 3;
                const segments = Math.floor(dist / (dashLength + gapLength));

                for (let j = 0; j < segments; j++) {
                    const t1 = (j * (dashLength + gapLength)) / dist;
                    const t2 = ((j * (dashLength + gapLength)) + dashLength) / dist;
                    if (t2 > 1) break;

                    const x1 = p1.x + dx * t1;
                    const y1 = p1.y + dy * t1;
                    const x2 = p1.x + dx * Math.min(t2, 1);
                    const y2 = p1.y + dy * Math.min(t2, 1);

                    page.drawLine({
                        start: { x: x1, y: y1 },
                        end: { x: x2, y: y2 },
                        thickness: 1.5,
                        color: COLORS.MAGENTA
                    });
                }
            }

            // Draw EXIT AREA label
            if (exitPoints.length > 0) {
                const midX = exitPoints.reduce((sum, p) => sum + p.x, 0) / exitPoints.length;
                const midY = exitPoints.reduce((sum, p) => sum + p.y, 0) / exitPoints.length;
                page.drawText('EXIT AREA', {
                    x: midX - 30,
                    y: midY - 8,
                    size: 8,
                    font: boldFont,
                    color: COLORS.MAGENTA
                });
            }
        }

        // Draw functional area labels (LOADING BAY, MAIN ACCESS, EXIT DOOR)
        if (floorPlan.functionalAreas && Array.isArray(floorPlan.functionalAreas)) {
            floorPlan.functionalAreas.forEach(area => {
                if (area.label && area.position) {
                    const x = offsetX + area.position.x * scale;
                    const y = offsetY + area.position.y * scale;

                    // Background for label
                    const textWidth = area.label.length * 4;
                    page.drawRectangle({
                        x: x - textWidth / 2 - 3,
                        y: y - 8,
                        width: textWidth + 6,
                        height: 14,
                        color: COLORS.WHITE,
                        borderColor: COLORS.BLACK,
                        borderWidth: 0.5
                    });

                    page.drawText(area.label, {
                        x: x - textWidth / 2,
                        y: y - 5,
                        size: 8,
                        font: boldFont,
                        color: COLORS.BLACK
                    });
                }
            });
        }

        // Draw dimension markers (like "1.5m", "10m" in reference)
        if (floorPlan.dimensions && Array.isArray(floorPlan.dimensions)) {
            floorPlan.dimensions.forEach(dim => {
                if (dim.start && dim.end && dim.value) {
                    const x1 = offsetX + dim.start.x * scale;
                    const y1 = offsetY + dim.start.y * scale;
                    const x2 = offsetX + dim.end.x * scale;
                    const y2 = offsetY + dim.end.y * scale;

                    // Dimension line
                    page.drawLine({
                        start: { x: x1, y: y1 },
                        end: { x: x2, y: y2 },
                        thickness: 0.5,
                        color: COLORS.MAGENTA
                    });

                    // Dimension value
                    const midX = (x1 + x2) / 2;
                    const midY = (y1 + y2) / 2;
                    const dimText = `${dim.value}${dim.unit || 'm'}`;
                    page.drawText(dimText, {
                        x: midX - 10,
                        y: midY - 8,
                        size: 7,
                        font,
                        color: COLORS.MAGENTA
                    });
                }
            });
        }
    }

    /**
     * Draw comprehensive legend with Unit/Group/Size columns
     */
    async drawComprehensiveLegend(page, x, y, width, height, solution, floorPlan, options = {}) {
        const font = await page.doc.embedFont(StandardFonts.Helvetica);
        const boldFont = await page.doc.embedFont(StandardFonts.HelveticaBold);

        // Legend title
        page.drawText('LÉGENDE', {
            x: x + 10,
            y: y + height - 20,
            size: 14,
            font: boldFont
        });

        // Build room list from floorPlan.rooms (matching reference: RM No., DESCRIPTION, AREA)
        const rooms = floorPlan && Array.isArray(floorPlan.rooms) ? floorPlan.rooms : [];
        const roomList = rooms.slice(0, 26).map((room, idx) => ({
            rmNo: String(room.number || (idx + 1)).padStart(2, '0'),
            description: room.type || room.description || 'Office',
            area: ((room.area || 0) * 10.764).toFixed(1) // Convert m² to sq.ft.
        }));

        // If no rooms, use boxes to generate room list
        const boxes = solution.boxes || [];
        const unitSizeMap = {};
        boxes.forEach((box) => {
            const area = box.area || (box.width * box.height) || 0;
            if (!area) return;
            const sizeLabel = this.calculateUnitSizeLabel(area);
            unitSizeMap[sizeLabel] = (unitSizeMap[sizeLabel] || 0) + 1;
        });
        const unitSizes = Object.entries(unitSizeMap)
            .map(([size, count]) => ({ size: Number(size), count }))
            .sort((a, b) => a.size - b.size);
        if (roomList.length === 0 && boxes.length > 0) {
            // Group boxes by area and create room entries
            const boxGroups = {};
            boxes.forEach(box => {
                const area = box.area || (box.width * box.height);
                const areaKey = Math.floor(area);
                if (!boxGroups[areaKey]) {
                    boxGroups[areaKey] = { count: 0, totalArea: 0 };
                }
                boxGroups[areaKey].count++;
                boxGroups[areaKey].totalArea += area;
            });

            Object.entries(boxGroups).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])).slice(0, 26).forEach(([areaKey, data], idx) => {
                roomList.push({
                    rmNo: String(idx + 1).padStart(2, '0'),
                    description: 'Unit',
                    area: (data.totalArea * 10.764).toFixed(1)
                });
            });
        }

        // Draw table header (matching reference: RM No., DESCRIPTION, AREA (SQ.FT.))
        let currentY = y + height - 50;

        // Draw header background
        page.drawRectangle({
            x: x + 5,
            y: currentY - 5,
            width: width - 10,
            height: 20,
            color: rgb(0.95, 0.95, 0.95) // Light gray background
        });

        // Reference shows: RM No., DESCRIPTION, AREA (SQ.FT.) columns
        page.drawText('RM No.', {
            x: x + 10,
            y: currentY,
            size: 9,
            font: boldFont,
            color: rgb(0, 0, 0)
        });
        page.drawText('DESCRIPTION', {
            x: x + 60,
            y: currentY,
            size: 9,
            font: boldFont,
            color: rgb(0, 0, 0)
        });
        page.drawText('AREA (SQ.FT.)', {
            x: x + 140,
            y: currentY,
            size: 9,
            font: boldFont,
            color: rgb(0, 0, 0)
        });

        currentY -= 25;

        // Draw room rows (matching reference: RM No., DESCRIPTION, AREA (SQ.FT.))
        // Use actual rooms from floorPlan if available (rooms already declared above), otherwise use unit sizes
        const roomRows = rooms.length > 0 ? rooms.slice(0, 26).map((room, idx) => ({
            rmNo: String(room.number || (idx + 1)).padStart(2, '0'),
            description: room.type || room.description || 'Office',
            area: (room.area || 0) * 10.764 // Convert m² to sq.ft.
        })) : unitSizes.slice(0, 26).map(unit => ({
            rmNo: String(Math.floor(unit.size)).padStart(2, '0'),
            description: 'Unit',
            area: (unit.size * unit.count * 10.764).toFixed(1) // Convert to sq.ft.
        }));

        const maxRows = Math.floor((currentY - y) / 18);
        roomRows.slice(0, maxRows).forEach((row, index) => {
            // Alternate row background for readability
            if (index % 2 === 0) {
                page.drawRectangle({
                    x: x + 5,
                    y: currentY - 3,
                    width: width - 10,
                    height: 18,
                    color: rgb(0.98, 0.98, 0.98) // Very light gray
                });
            }

            // RM No.: Room number (01-26)
            page.drawText(row.rmNo, {
                x: x + 10,
                y: currentY,
                size: 8,
                font,
                color: rgb(0, 0, 0)
            });

            // DESCRIPTION: Room type/description
            page.drawText(row.description, {
                x: x + 60,
                y: currentY,
                size: 8,
                font,
                color: rgb(0, 0, 0)
            });

            // AREA (SQ.FT.): Area in square feet
            const areaText = typeof row.area === 'number' ? row.area.toFixed(1) : String(row.area);
            page.drawText(areaText, {
                x: x + 140,
                y: currentY,
                size: 8,
                font,
                color: rgb(0, 0, 0)
            });

            currentY -= 18;
        });

        // Draw line style legend below table
        currentY -= 30;
        const lineStyles = [
            { label: 'Tôle Blanche', color: rgb(0.42, 0.45, 0.5), style: 'solid', thickness: 1 },
            { label: 'Tôle Grise', color: rgb(0, 0, 1), style: 'solid', thickness: 2 },
            { label: 'Ligne circulation', color: rgb(0.4, 0.7, 0.95), style: 'dashed', thickness: 1 },
            { label: 'Radiateur', color: rgb(0.85, 0, 0.08), style: 'zigzag', thickness: 1 }
        ];

        lineStyles.forEach(item => {
            // Draw line sample
            if (item.style === 'zigzag') {
                // Radiator zigzag sample
                const zigStep = 3, zigAmp = 2;
                for (let z = 0; z < 8; z++) {
                    page.drawLine({
                        start: { x: x + 10 + z * zigStep, y: currentY + ((z % 2 === 0) ? zigAmp : -zigAmp) },
                        end: { x: x + 10 + (z + 1) * zigStep, y: currentY + (((z + 1) % 2 === 0) ? zigAmp : -zigAmp) },
                        thickness: item.thickness,
                        color: item.color
                    });
                }
            } else if (item.style === 'dashed') {
                for (let j = 0; j < 6; j++) {
                    page.drawLine({
                        start: { x: x + 10 + j * 5, y: currentY },
                        end: { x: x + 10 + j * 5 + 3, y: currentY },
                        thickness: item.thickness,
                        color: item.color
                    });
                }
            } else {
                page.drawLine({
                    start: { x: x + 10, y: currentY },
                    end: { x: x + 40, y: currentY },
                    thickness: item.thickness,
                    color: item.color
                });
            }

            page.drawText(item.label, {
                x: x + 45,
                y: currentY - 5,
                size: 8,
                font
            });

            currentY -= 20;
        });
    }

    /**
     * Draw enhanced title block
     */
    async drawEnhancedTitleBlock(page, width, height, title, metrics, options = {}) {
        const font = await page.doc.embedFont(StandardFonts.Helvetica);
        const boldFont = await page.doc.embedFont(StandardFonts.HelveticaBold);

        const blockWidth = 260;
        const blockHeight = 70;
        const margin = 20;
        const x = margin;
        const y = margin;

        page.drawRectangle({
            x,
            y,
            width: blockWidth,
            height: blockHeight,
            borderColor: rgb(0, 0.5, 0),
            borderWidth: 2
        });

        page.drawText(options.companyName || 'COSTO', {
            x: x + 10,
            y: y + blockHeight - 20,
            size: 12,
            font: boldFont
        });

        const address = options.companyAddress || '5 chemin de la dime 95700 Roissy FRANCE';
        page.drawText(address, {
            x: x + 10,
            y: y + blockHeight - 35,
            size: 8,
            font
        });

        // Optional document ID box (vertical) like reference
        if (options.documentId) {
            const docBoxWidth = 35;
            const docBoxHeight = blockHeight;
            const docX = x + blockWidth + 5;
            const docY = y;
            page.drawRectangle({
                x: docX,
                y: docY,
                width: docBoxWidth,
                height: docBoxHeight,
                borderColor: rgb(0, 0.5, 0),
                borderWidth: 2
            });
            page.drawText(String(options.documentId), {
                x: docX + 10,
                y: docY + 10,
                size: 7,
                font,
                rotate: degrees(90)
            });
        }

        page.drawText(`Date: ${new Date().toLocaleDateString('fr-FR')}`, {
            x: x + 10,
            y: y + 12,
            size: 8,
            font
        });

        if (options.drawingNumber) {
            page.drawText(options.drawingNumber, {
                x: x + blockWidth - 40,
                y: y + 12,
                size: 9,
                font: boldFont
            });
        }
    }

    /**
     * Draw scale information (bottom left)
     */
    async drawScaleInfo(page, x, y, scale, drawingNumber, pageSize) {
        const font = await page.doc.embedFont(StandardFonts.Helvetica);
        const prefix = drawingNumber ? `${drawingNumber} ` : '';
        const scaleText = `${prefix}${scale} on ${pageSize}`;
        page.drawText(scaleText, {
            x,
            y,
            size: 9,
            font,
            color: rgb(0, 0, 0)
        });
    }
}

module.exports = new CostoExports();
