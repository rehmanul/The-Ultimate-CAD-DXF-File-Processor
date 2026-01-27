/**
 * COSTO Export System - V1
 * Comprehensive export functionality for COSTO V1 specifications
 * Includes: DWG, PDF, SVG, Excel/CSV, and Reports
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const XLSX = require('xlsx');
const CostoLayerStandard = require('./costoLayerStandard');

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
            { name: 'BOXES', color: 3 },
            { name: 'BOXES_S', color: 3 },
            { name: 'BOXES_M', color: 4 },
            { name: 'BOXES_L', color: 5 },
            { name: 'BOXES_XL', color: 6 },
            { name: 'CORRIDORS', color: 4 },
            { name: 'DIMENSIONS', color: 5 },
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

        // Add text label
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
${box.id || ''}
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

        // Metadata (top right)
        const metadata = [
            `Date: ${new Date().toLocaleDateString('fr-FR')}`,
            `Version: ${options.version || '1.0'}`,
            `Scale: ${options.scale || '1:200'}`
        ];

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
        
        // Draw walls (Tôle Blanche - thin black lines)
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
                        color: rgb(0, 0, 0)
                    });
                }
            });
        }

        // Draw forbidden zones (if polygon)
        if (floorPlan.forbiddenZones) {
            floorPlan.forbiddenZones.forEach(zone => {
                if (zone.polygon && zone.polygon.length >= 3) {
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

        // Draw boxes (Tôle Grise - blue lines, thicker) - like reference
        const boxes = solution.boxes || [];
        boxes.forEach(box => {
            const x = offsetX + box.x * scale;
            const y = offsetY + box.y * scale;
            const w = box.width * scale;
            const h = box.height * scale;

            // Draw box outline (blue, thicker - like "Tôle Grise")
            page.drawRectangle({
                x,
                y,
                width: w,
                height: h,
                borderColor: rgb(0, 0, 1),
                borderWidth: 2.0 // Thicker like reference
            });

            // Only label some boxes to avoid clutter (every 10th box)
            if (boxes.indexOf(box) % 10 === 0 && box.id) {
                const idText = box.id.replace(/^[A-Z_]+/, ''); // Simplify ID
                page.drawText(idText, {
                    x: x + w / 2 - 5,
                    y: y + h / 2 - 3,
                    size: 5,
                    font,
                    color: rgb(0, 0, 0)
                });
            }
        });

        // Draw corridors (red dashed lines - "ligne circulation")
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

                    // Draw dashed line (like reference)
                    const dx = x2 - x1;
                    const dy = y2 - y1;
                    const length = Math.hypot(dx, dy);
                    const dashLength = 3;
                    const gapLength = 2;
                    const dashCount = Math.floor(length / (dashLength + gapLength));
                    
                    for (let j = 0; j < dashCount; j++) {
                        const t1 = j * (dashLength + gapLength) / length;
                        const t2 = (j * (dashLength + gapLength) + dashLength) / length;
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
                            color: rgb(1, 0, 0) // Red like reference
                        });
                    }
                }
            } else if (corridor.x !== undefined && corridor.y !== undefined) {
                // Rectangle-based corridor
                const x = offsetX + corridor.x * scale;
                const y = offsetY + corridor.y * scale;
                const w = (corridor.width || 1.5) * scale;
                const h = (corridor.height || 1.5) * scale;
                
                // Draw corridor centerline as dashed
                const isHorizontal = w > h;
                if (isHorizontal) {
                    const centerY = y + h / 2;
                    const dashCount = Math.floor(w / 5);
                    for (let j = 0; j < dashCount; j += 2) {
                        page.drawLine({
                            start: { x: x + j * 5, y: centerY },
                            end: { x: x + Math.min((j + 1) * 5, w), y: centerY },
                            thickness: 1,
                            color: rgb(1, 0, 0)
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
                            color: rgb(1, 0, 0)
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
        if (options.scale) {
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
        // Note: pdf-lib doesn't support rotation directly, so we'll draw it horizontally
        // For true vertical text, would need to use transformation matrices
        const text = `${floorLabel} ${scaleText}`;
        page.drawText(text, {
            x: x - 120,
            y: y,
            size: 9,
            font,
            color: rgb(0, 0, 0)
        });
        
        // Also draw "SURFACES DES BOX" annotation
        page.drawText('SURFACES DES BOX', {
            x: x - 140,
            y: y + 20,
            size: 8,
            font,
            color: rgb(0, 0, 0)
        });
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

        // Legend items matching reference style
        const legendItems = [
            { 
                label: 'Tôle Blanche', 
                description: 'White Sheet/Metal',
                lineStyle: 'solid',
                color: rgb(0, 0, 0),
                thickness: 1
            },
            { 
                label: 'Tôle Grise', 
                description: 'Grey Sheet/Metal (Boxes)',
                lineStyle: 'solid',
                color: rgb(0, 0, 1),
                thickness: 2
            },
            { 
                label: 'Ligne circulation', 
                description: 'Circulation Line',
                lineStyle: 'dashed',
                color: rgb(1, 0, 0),
                thickness: 1
            },
            { 
                label: 'Radiateur', 
                description: 'Radiator/Utilities',
                lineStyle: 'dashed',
                color: rgb(0.5, 0.8, 1),
                thickness: 1
            }
        ];

        let currentY = y + height - 50;
        legendItems.forEach((item, i) => {
            // Draw line sample
            if (item.lineStyle === 'solid') {
                page.drawLine({
                    start: { x, y: currentY },
                    end: { x: x + 30, y: currentY },
                    thickness: item.thickness,
                    color: item.color
                });
            } else {
                // Dashed line (simplified - draw multiple segments)
                for (let j = 0; j < 6; j++) {
                    page.drawLine({
                        start: { x: x + j * 5, y: currentY },
                        end: { x: x + j * 5 + 3, y: currentY },
                        thickness: item.thickness,
                        color: item.color
                    });
                }
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
}

module.exports = new CostoExports();
