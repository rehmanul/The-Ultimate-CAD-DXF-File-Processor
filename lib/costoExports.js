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

    _isFinitePoint(x, y) {
        return Number.isFinite(x) && Number.isFinite(y);
    }

    _sanitizeBounds(bounds) {
        const fallback = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        if (!bounds || typeof bounds !== 'object') return fallback;
        const minX = Number(bounds.minX);
        const minY = Number(bounds.minY);
        const maxX = Number(bounds.maxX);
        const maxY = Number(bounds.maxY);
        if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) {
            return fallback;
        }
        return { minX, minY, maxX, maxY };
    }

    _collectGeometryPoints(floorPlan, solution) {
        const points = [];
        const pushPoint = (x, y) => {
            if (this._isFinitePoint(x, y)) points.push({ x, y });
        };
        const pushPath = (path) => {
            if (!Array.isArray(path)) return;
            path.forEach((pt) => {
                if (!pt) return;
                const x = Number(Array.isArray(pt) ? pt[0] : pt.x);
                const y = Number(Array.isArray(pt) ? pt[1] : pt.y);
                pushPoint(x, y);
            });
        };

        (floorPlan && Array.isArray(floorPlan.walls) ? floorPlan.walls : []).forEach((w) => {
            if (w && w.start && w.end) {
                pushPoint(Number(w.start.x), Number(w.start.y));
                pushPoint(Number(w.end.x), Number(w.end.y));
            } else if (Array.isArray(w && w.polygon)) {
                pushPath(w.polygon);
            }
        });

        (floorPlan && Array.isArray(floorPlan.envelope) ? floorPlan.envelope : []).forEach((line) => {
            if (line && line.start && line.end) {
                pushPoint(Number(line.start.x), Number(line.start.y));
                pushPoint(Number(line.end.x), Number(line.end.y));
            } else if (Array.isArray(line)) {
                pushPath(line);
            } else if (line && (line.x !== undefined || line[0] !== undefined)) {
                const x = Number(Array.isArray(line) ? line[0] : line.x);
                const y = Number(Array.isArray(line) ? line[1] : line.y);
                pushPoint(x, y);
            }
        });

        const boxes = solution && Array.isArray(solution.boxes) ? solution.boxes : [];
        boxes.forEach((box) => {
            const x = Number(box && box.x);
            const y = Number(box && box.y);
            const w = Number(box && box.width);
            const h = Number(box && box.height);
            if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) {
                pushPoint(x, y);
                pushPoint(x + w, y + h);
            }
        });

        const corridors = solution && Array.isArray(solution.corridors) ? solution.corridors : [];
        corridors.forEach((corridor) => {
            const x = Number(corridor && corridor.x);
            const y = Number(corridor && corridor.y);
            const w = Number(corridor && corridor.width);
            const h = Number(corridor && corridor.height);
            if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) {
                pushPoint(x, y);
                pushPoint(x + w, y + h);
            }
        });

        return points;
    }

    _computeEffectiveBounds(floorPlan, solution, options = {}) {
        const fallback = this._sanitizeBounds(floorPlan && floorPlan.bounds);
        const points = this._collectGeometryPoints(floorPlan, solution);
        if (points.length < 8) return fallback;

        const xs = points.map((p) => p.x).sort((a, b) => a - b);
        const ys = points.map((p) => p.y).sort((a, b) => a - b);
        const trimRatioRaw = Number(options.boundsTrimRatio);
        const trimRatio = Number.isFinite(trimRatioRaw) ? Math.max(0, Math.min(0.03, trimRatioRaw)) : 0.01;
        const low = Math.floor(xs.length * trimRatio);
        const high = Math.max(low + 1, Math.ceil(xs.length * (1 - trimRatio)) - 1);

        let minX = xs[Math.min(low, xs.length - 1)];
        let maxX = xs[Math.min(high, xs.length - 1)];
        let minY = ys[Math.min(low, ys.length - 1)];
        let maxY = ys[Math.min(high, ys.length - 1)];

        if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) {
            return fallback;
        }

        const width = maxX - minX;
        const height = maxY - minY;
        const padRatioRaw = Number(options.boundsPadRatio);
        const padRatio = Number.isFinite(padRatioRaw) ? Math.max(0, Math.min(0.08, padRatioRaw)) : 0.012;
        const padX = Math.max(0.03, width * padRatio);
        const padY = Math.max(0.03, height * padRatio);
        minX -= padX;
        maxX += padX;
        minY -= padY;
        maxY += padY;

        const fallbackWidth = fallback.maxX - fallback.minX;
        const fallbackHeight = fallback.maxY - fallback.minY;
        if (fallbackWidth > 0 && fallbackHeight > 0) {
            const minCoverageRaw = Number(options.minBoundsCoverage);
            const minCoverage = Number.isFinite(minCoverageRaw) ? Math.max(0.12, Math.min(1, minCoverageRaw)) : 0.22;
            const widthCoverage = (maxX - minX) / fallbackWidth;
            const heightCoverage = (maxY - minY) / fallbackHeight;
            if (widthCoverage < minCoverage || heightCoverage < minCoverage) {
                const fallbackDiag = Math.hypot(fallbackWidth, fallbackHeight);
                const computedDiag = Math.hypot(maxX - minX, maxY - minY);
                // If fallback bounds are a massive outlier envelope, keep effective bounds.
                if (!Number.isFinite(fallbackDiag) || !Number.isFinite(computedDiag) || fallbackDiag <= computedDiag * 1.6) {
                    return fallback;
                }
            }
        }

        return { minX, minY, maxX, maxY };
    }

    _resolveReferencePageSize(pageSize, orientation, planWidth, planHeight, margin, legendWidth, titleBlockHeight, multiFloor = false) {
        const pageSizes = {
            A3: [841.89, 1190.55],
            A1: [1683.78, 2383.94]
        };
        const raw = pageSizes[pageSize] || pageSizes.A1;
        const portrait = [Math.min(raw[0], raw[1]), Math.max(raw[0], raw[1])];
        const landscape = [Math.max(raw[0], raw[1]), Math.min(raw[0], raw[1])];
        const option = String(orientation || 'auto').toLowerCase();

        if (option === 'portrait') return portrait;
        if (option === 'landscape') return landscape;

        const score = (dims) => {
            const pageWidth = dims[0];
            const pageHeight = dims[1];
            const drawWidth = Math.max(1, pageWidth - margin * 2 - legendWidth);
            const drawHeight = Math.max(1, pageHeight - margin * 2 - titleBlockHeight);
            // For multi-floor side-by-side, split width (not height)
            const effectiveDrawWidth = multiFloor ? (drawWidth * 0.62) : drawWidth;
            const scale = Math.min(effectiveDrawWidth / Math.max(planWidth, 1e-6), drawHeight / Math.max(planHeight, 1e-6));
            const scaledW = planWidth * scale;
            const scaledH = planHeight * scale;
            return (scaledW * scaledH) / (effectiveDrawWidth * drawHeight);
        };

        return score(landscape) >= score(portrait) ? landscape : portrait;
    }

    _getReferenceExportTuning(options = {}) {
        const fitRaw = Number(options.fitFactor);
        const fitFactor = Number.isFinite(fitRaw)
            ? Math.max(0.85, Math.min(1.02, fitRaw))
            : 0.995;

        const padRaw = Number(options.boundsPadRatio);
        const boundsPadRatio = Number.isFinite(padRaw)
            ? Math.max(0, Math.min(0.08, padRaw))
            : 0.006;

        const trimRaw = Number(options.boundsTrimRatio);
        const boundsTrimRatio = Number.isFinite(trimRaw)
            ? Math.max(0, Math.min(0.03, trimRaw))
            : 0.008;

        const coverageRaw = Number(options.minBoundsCoverage);
        const minBoundsCoverage = Number.isFinite(coverageRaw)
            ? Math.max(0.12, Math.min(1, coverageRaw))
            : 0.18;

        return {
            fitFactor,
            boundsPadRatio,
            boundsTrimRatio,
            minBoundsCoverage
        };
    }

    _isLikelySyntheticEnvelope(floorPlan) {
        const envelope = Array.isArray(floorPlan && floorPlan.envelope) ? floorPlan.envelope : [];
        const bounds = this._sanitizeBounds(floorPlan && floorPlan.bounds);
        if (envelope.length < 4 || envelope.length > 8) return false;

        const tol = 0.2;
        const onBound = (v, target) => Math.abs(Number(v) - Number(target)) <= tol;
        let aligned = 0;
        envelope.forEach((line) => {
            if (!line || !line.start || !line.end) return;
            const x1 = Number(line.start.x);
            const y1 = Number(line.start.y);
            const x2 = Number(line.end.x);
            const y2 = Number(line.end.y);
            if (![x1, y1, x2, y2].every(Number.isFinite)) return;
            const onLeft = onBound(x1, bounds.minX) && onBound(x2, bounds.minX);
            const onRight = onBound(x1, bounds.maxX) && onBound(x2, bounds.maxX);
            const onBottom = onBound(y1, bounds.minY) && onBound(y2, bounds.minY);
            const onTop = onBound(y1, bounds.maxY) && onBound(y2, bounds.maxY);
            if (onLeft || onRight || onBottom || onTop) aligned += 1;
        });
        return aligned >= 4;
    }

    _shouldRenderEnvelope(floorPlan) {
        const envelope = Array.isArray(floorPlan && floorPlan.envelope) ? floorPlan.envelope : [];
        if (!envelope.length) return false;
        if (this._isLikelySyntheticEnvelope(floorPlan)) return false;

        const walls = Array.isArray(floorPlan && floorPlan.walls) ? floorPlan.walls : [];
        if (!walls.length) return true;

        const wallPts = [];
        walls.forEach((wall) => {
            if (!wall) return;
            if (wall.start && wall.end) {
                wallPts.push({ x: Number(wall.start.x), y: Number(wall.start.y) });
                wallPts.push({ x: Number(wall.end.x), y: Number(wall.end.y) });
            } else if (Array.isArray(wall.polygon) && wall.polygon.length >= 2) {
                for (let i = 0; i < wall.polygon.length - 1; i++) {
                    const p1 = wall.polygon[i];
                    const p2 = wall.polygon[i + 1];
                    const x1 = Number(Array.isArray(p1) ? p1[0] : p1 && p1.x);
                    const y1 = Number(Array.isArray(p1) ? p1[1] : p1 && p1.y);
                    const x2 = Number(Array.isArray(p2) ? p2[0] : p2 && p2.x);
                    const y2 = Number(Array.isArray(p2) ? p2[1] : p2 && p2.y);
                    if ([x1, y1, x2, y2].every(Number.isFinite)) {
                        wallPts.push({ x: x1, y: y1 });
                        wallPts.push({ x: x2, y: y2 });
                    }
                }
            }
        });
        if (!wallPts.length) return false;

        const tol = 0.28;
        let connectedEndpoints = 0;
        let endpointCount = 0;
        envelope.forEach((seg) => {
            [seg && seg.start, seg && seg.end].forEach((pt) => {
                if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return;
                endpointCount += 1;
                const hit = wallPts.some((wpt) => Math.hypot(wpt.x - pt.x, wpt.y - pt.y) <= tol);
                if (hit) connectedEndpoints += 1;
            });
        });
        if (endpointCount === 0) return false;
        const minConnected = Math.max(6, Math.ceil(endpointCount * 0.45));
        return connectedEndpoints >= minConnected;
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

        // Radiators: skip in this function (handled by drawEnhancedFloorPlanToPDF with discrete symbols)

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

    async drawLeftVerticalLabels(page, { labels = [], scaleText = '1:100', margin = 60, height = 0, titleBlockHeight = 0, availableHeight = 0 }) {
        const serif = await page.doc.embedFont(StandardFonts.TimesRoman);
        const fontSize = 11;
        const baseX = margin - 32;
        if (labels.length >= 1) {
            const topCenterY = margin + titleBlockHeight + availableHeight * 0.75;
            const text = `${labels[0]} ${scaleText}`;
            page.drawText(text, {
                x: baseX,
                y: topCenterY,
                size: fontSize,
                color: rgb(0, 0, 0),
                font: serif,
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
                font: serif,
                rotate: degrees(90)
            });
        }
        // Surfaces label centered between floors
        if (availableHeight) {
            const midY = margin + titleBlockHeight + availableHeight * 0.5;
            page.drawText('SURFACES DES BOX', {
                x: baseX - 20,
                y: midY,
                size: 10.5,
                color: rgb(0, 0, 0),
                font: serif,
                rotate: degrees(90)
            });
        }
    }

    async drawReferenceLegend(page, x, y, width, height, options = {}) {
        const labelFont = await page.doc.embedFont(StandardFonts.TimesRomanItalic);
        const panelPad = 14;
        const sampleStartX = x + panelPad;
        const sampleEndX = Math.min(x + width * 0.44, sampleStartX + 72);
        const textX = sampleEndX + 10;
        const maxTextRight = x + width - panelPad;
        const rowStep = 24;
        const startY = y + height - (options.includeCompass ? 118 : 64);

        const lineItems = [
            { label: 'Tole Blanche', color: rgb(0.42, 0.45, 0.5), thickness: 1, style: 'solid' },
            { label: 'Tole Grise', color: rgb(0, 0, 1), thickness: 2, style: 'solid' },
            { label: 'ligne circulation', color: rgb(0.4, 0.7, 0.95), thickness: 1, style: 'dashed' },
            { label: 'Radiateur', color: rgb(0.85, 0, 0.08), thickness: 1, style: 'zigzag' }
        ];

        let currentY = startY;
        lineItems.forEach((item) => {
            if (item.style === 'zigzag') {
                const zigPts = [];
                const zigLen = sampleEndX - sampleStartX;
                const zigStep = 8;
                const zigAmp = 3.5;
                for (let zi = 0; zi <= Math.floor(zigLen / zigStep); zi++) {
                    zigPts.push({
                        x: sampleStartX + zi * zigStep,
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
                const dashLen = 7;
                const gapLen = 4;
                const dashCount = Math.max(3, Math.floor((sampleEndX - sampleStartX) / (dashLen + gapLen)));
                for (let di = 0; di < dashCount; di++) {
                    page.drawLine({
                        start: { x: sampleStartX + di * (dashLen + gapLen), y: currentY },
                        end: { x: sampleStartX + di * (dashLen + gapLen) + dashLen, y: currentY },
                        thickness: item.thickness, color: item.color
                    });
                }
            } else {
                page.drawLine({
                    start: { x: sampleStartX, y: currentY },
                    end: { x: sampleEndX, y: currentY },
                    thickness: item.thickness, color: item.color
                });
            }

            let labelSize = 10.5;
            while (labelSize > 8) {
                const textWidth = labelFont.widthOfTextAtSize(item.label, labelSize);
                if (textX + textWidth <= maxTextRight) break;
                labelSize -= 0.5;
            }
            page.drawText(item.label, {
                x: textX,
                y: currentY - 6.5,
                size: labelSize,
                font: labelFont,
                color: rgb(0, 0, 0)
            });

            currentY -= rowStep;
        });

        if (options.includeCompass) {
            // Compass at the left of the legend area (matching reference top-left placement)
            await this.drawCompassRose(page, x - 42, y + height - 50, 38);
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
        const boldFont = await page.doc.embedFont(StandardFonts.HelveticaBold);
        const r = size * 0.45; // Radius of the star
        const armLen = size * 0.55; // Length of cardinal arms
        const diagLen = size * 0.28; // Length of diagonal arms
        const lineColor = rgb(0, 0, 0);
        const fillColor = rgb(0.15, 0.15, 0.15);

        // Draw circle outline
        const circleSteps = 36;
        for (let i = 0; i < circleSteps; i++) {
            const a1 = (i / circleSteps) * Math.PI * 2;
            const a2 = ((i + 1) / circleSteps) * Math.PI * 2;
            page.drawLine({
                start: { x: centerX + Math.cos(a1) * r, y: centerY + Math.sin(a1) * r },
                end: { x: centerX + Math.cos(a2) * r, y: centerY + Math.sin(a2) * r },
                thickness: 0.8,
                color: lineColor
            });
        }

        // Draw 8-point star (4 cardinal + 4 diagonal)
        const directions = [
            { angle: Math.PI / 2, len: armLen },    // N (up)
            { angle: -Math.PI / 2, len: armLen },   // S (down)
            { angle: 0, len: armLen },               // E (right)
            { angle: Math.PI, len: armLen },          // O/W (left)
            { angle: Math.PI / 4, len: diagLen },    // NE
            { angle: 3 * Math.PI / 4, len: diagLen },// NW
            { angle: -Math.PI / 4, len: diagLen },   // SE
            { angle: -3 * Math.PI / 4, len: diagLen } // SW
        ];

        // Draw star arms as triangular points
        directions.forEach(({ angle, len }) => {
            const tipX = centerX + Math.cos(angle) * len;
            const tipY = centerY + Math.sin(angle) * len;
            const perpAngle = angle + Math.PI / 2;
            const halfBase = len * 0.15;

            // Left side of triangle
            page.drawLine({
                start: { x: centerX + Math.cos(perpAngle) * halfBase, y: centerY + Math.sin(perpAngle) * halfBase },
                end: { x: tipX, y: tipY },
                thickness: 1.2,
                color: fillColor
            });
            // Right side of triangle
            page.drawLine({
                start: { x: centerX - Math.cos(perpAngle) * halfBase, y: centerY - Math.sin(perpAngle) * halfBase },
                end: { x: tipX, y: tipY },
                thickness: 1.2,
                color: fillColor
            });
        });

        // Draw cross lines through center
        page.drawLine({
            start: { x: centerX, y: centerY - armLen },
            end: { x: centerX, y: centerY + armLen },
            thickness: 0.6, color: lineColor
        });
        page.drawLine({
            start: { x: centerX - armLen, y: centerY },
            end: { x: centerX + armLen, y: centerY },
            thickness: 0.6, color: lineColor
        });

        // Cardinal direction labels: N (top), S (bottom), E (right), O (left - French for West)
        const labelOffset = armLen + 8;
        page.drawText('N', {
            x: centerX - 4, y: centerY + labelOffset,
            size: 10, font: boldFont, color: lineColor
        });
        page.drawText('S', {
            x: centerX - 3, y: centerY - labelOffset - 10,
            size: 9, font, color: lineColor
        });
        page.drawText('E', {
            x: centerX + labelOffset, y: centerY - 4,
            size: 9, font, color: lineColor
        });
        page.drawText('O', {
            x: centerX - labelOffset - 10, y: centerY - 4,
            size: 9, font, color: lineColor
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
            useRowZigzags = false,
            orientation = 'auto',
            fitFactor = undefined
        } = options;
        const margin = 60;
        const titleBlockHeight = showTitleBlock ? 100 : 0;
        const tuning = this._getReferenceExportTuning({
            ...options,
            fitFactor
        });
        const fitScaleFactor = tuning.fitFactor;

        const renderFloorPlan = {
            ...floorPlan,
            bounds: this._computeEffectiveBounds(floorPlan, solution, {
                ...options,
                boundsPadRatio: tuning.boundsPadRatio,
                boundsTrimRatio: tuning.boundsTrimRatio,
                minBoundsCoverage: tuning.minBoundsCoverage
            })
        };

        const canMultiFloor = multiFloor &&
            Array.isArray(floorPlans) &&
            floorPlans.length >= 2 &&
            Array.isArray(solutions) &&
            solutions.length >= 2;

        // For multi-floor side-by-side layout, legend is drawn as a top-left
        // overlay so it does not consume available width
        let legendWidth = canMultiFloor ? 0 : (showLegend ? 200 : 0);

        const renderFloorPlans = [];
        const renderSolutions = [];
        if (canMultiFloor) {
            for (let i = 0; i < 2; i++) {
                const fp = floorPlans[i] || floorPlan;
                const sol = solutions[i] || solution;
                renderFloorPlans.push({
                    ...fp,
                    bounds: this._computeEffectiveBounds(fp, sol, {
                        ...options,
                        boundsPadRatio: tuning.boundsPadRatio,
                        boundsTrimRatio: tuning.boundsTrimRatio,
                        minBoundsCoverage: tuning.minBoundsCoverage
                    })
                });
                renderSolutions.push(sol);
            }
        }

        const primaryBounds = renderFloorPlan.bounds || this._sanitizeBounds(floorPlan.bounds);
        const planWidth = Math.max(1e-6, primaryBounds.maxX - primaryBounds.minX);
        const planHeight = Math.max(1e-6, primaryBounds.maxY - primaryBounds.minY);
        let maxPlanWidth = planWidth;
        let maxPlanHeight = planHeight;
        if (canMultiFloor) {
            renderFloorPlans.forEach((fp) => {
                const b = fp.bounds || this._sanitizeBounds(fp.bounds);
                maxPlanWidth = Math.max(maxPlanWidth, Math.max(1e-6, b.maxX - b.minX));
                maxPlanHeight = Math.max(maxPlanHeight, Math.max(1e-6, b.maxY - b.minY));
            });
        }

        const [width, height] = this._resolveReferencePageSize(
            pageSize,
            canMultiFloor ? 'landscape' : orientation,
            maxPlanWidth,
            maxPlanHeight,
            margin,
            legendWidth,
            titleBlockHeight,
            canMultiFloor
        );

        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([width, height]);

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
        const offsetY = margin;

        if (canMultiFloor) {
            // ── SIDE-BY-SIDE LAYOUT (matching reference) ──────────────
            // Floor 1 (PLAN ETAGE 01) on the LEFT (~62%)
            // Floor 2 (PLAN ETAGE 02) on the RIGHT (~35%), upper portion
            const fp1 = renderFloorPlans[0];
            const fp2 = renderFloorPlans[1];
            const sol1 = renderSolutions[0];
            const sol2 = renderSolutions[1];

            const b1 = fp1.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
            const b2 = fp2.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
            const w1 = Math.max(1e-6, b1.maxX - b1.minX);
            const h1 = Math.max(1e-6, b1.maxY - b1.minY);
            const w2 = Math.max(1e-6, b2.maxX - b2.minX);
            const h2 = Math.max(1e-6, b2.maxY - b2.minY);

            const gapX = 30; // Horizontal gap between the two floor plans
            const floor1Ratio = 0.62;
            const floor1AvailW = availableWidth * floor1Ratio - gapX / 2;
            const floor2AvailW = availableWidth * (1 - floor1Ratio) - gapX / 2;

            // Independent scale per floor so each fills its allocated space
            const scale1 = Math.min(floor1AvailW / w1, availableHeight / h1) * fitScaleFactor;
            const scale2 = Math.min(floor2AvailW / w2, availableHeight / h2) * fitScaleFactor;

            const renderedW1 = w1 * scale1;
            const renderedH1 = h1 * scale1;
            const renderedW2 = w2 * scale2;
            const renderedH2 = h2 * scale2;

            // Floor 1: left side, vertically centered in drawing area
            const f1OffsetX = offsetX;
            const f1OffsetY = offsetY + titleBlockHeight + Math.max(0, (availableHeight - renderedH1) / 2);

            // Floor 2: right side, positioned in upper portion of drawing area
            const f2OffsetX = offsetX + floor1AvailW + gapX;
            const f2OffsetY = offsetY + titleBlockHeight + Math.max(0, availableHeight - renderedH2 - 20);

            const label1 = (Array.isArray(floorLabels) && floorLabels[0]) ? floorLabels[0] : 'PLAN ETAGE 01';
            const label2 = (Array.isArray(floorLabels) && floorLabels[1]) ? floorLabels[1] : 'PLAN ETAGE 02';

            await this.drawEnhancedFloorPlanToPDF(page, fp1, sol1, scale1, f1OffsetX, f1OffsetY, {
                ...options,
                showDimensions,
                showUnitLabels,
                specializedAreas,
                scale,
                floorLabel: label1
            });

            await this.drawEnhancedFloorPlanToPDF(page, fp2, sol2, scale2, f2OffsetX, f2OffsetY, {
                ...options,
                showDimensions,
                showUnitLabels,
                specializedAreas,
                scale,
                floorLabel: label2
            });

            // Draw "PLAN ETAGE 02  1-200" label above floor 2
            const serif = await pdfDoc.embedFont(StandardFonts.TimesRoman);
            const scaleLabel = scale || '1-200';
            page.drawText(`${label2}  ${scaleLabel}`, {
                x: f2OffsetX + renderedW2 * 0.15,
                y: f2OffsetY + renderedH2 + 18,
                size: 16,
                font: serif,
                color: rgb(0, 0, 0)
            });

            // Draw "SP : XXX.XXm²" area summary label for floor 2 zone
            const totalF2Area = (sol2.boxes || []).reduce((s, b) => s + (b.area || b.width * b.height || 0), 0);
            if (totalF2Area > 0) {
                const spFont = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
                page.drawText(`SP :  ${totalF2Area.toFixed(2)}m\u00B2`, {
                    x: f2OffsetX + renderedW2 * 0.25,
                    y: f2OffsetY + renderedH2 * 0.45,
                    size: 14,
                    font: spFont,
                    color: rgb(0, 0, 0.7)
                });
            }
        } else {
            const scaleFactor = Math.min(availableWidth / planWidth, availableHeight / planHeight) * fitScaleFactor;
            const centeredOffsetX = offsetX + Math.max(0, (availableWidth - planWidth * scaleFactor) / 2);
            const centeredOffsetY = offsetY + Math.max(0, (availableHeight - planHeight * scaleFactor) / 2);

            // Draw floor plan with enhanced features
            await this.drawEnhancedFloorPlanToPDF(page, renderFloorPlan, solution, scaleFactor, centeredOffsetX, centeredOffsetY, {
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
                documentId,
                floorLabels: Array.isArray(floorLabels) ? floorLabels : null
            });
        }

        // Draw legend (reference-style by default)
        if (showLegend) {
            if (canMultiFloor) {
                // Multi-floor: legend + compass at top-left as overlay (matching reference)
                const legendOverlayW = 280;
                const legendOverlayH = 160;
                const legendOverlayX = margin + 70; // Right of compass area
                const legendOverlayY = height - margin - legendOverlayH - 10;
                await this.drawReferenceLegend(page, legendOverlayX, legendOverlayY, legendOverlayW, legendOverlayH, {
                    includeCompass
                });
            } else if (legendMode === 'reference') {
                const refLegendWidth = showLegend ? 200 : 0;
                await this.drawReferenceLegend(page, width - refLegendWidth, margin, refLegendWidth, height - margin * 2 - titleBlockHeight, {
                    includeCompass
                });
            } else {
                const refLegendWidth = showLegend ? 200 : 0;
                await this.drawComprehensiveLegend(page, width - refLegendWidth, margin, refLegendWidth, height - margin * 2 - titleBlockHeight, solution, floorPlan, options);
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
            useRowZigzags = false,
            orientation = 'auto',
            fitFactor = undefined
        } = options;

        const margin = 60;
        const titleBlockHeight = showTitleBlock ? 100 : 0;
        const tuning = this._getReferenceExportTuning({
            ...options,
            fitFactor
        });
        const fitScaleFactor = tuning.fitFactor;

        const renderFloorPlan = {
            ...floorPlan,
            bounds: this._computeEffectiveBounds(floorPlan, solution, {
                ...options,
                boundsPadRatio: tuning.boundsPadRatio,
                boundsTrimRatio: tuning.boundsTrimRatio,
                minBoundsCoverage: tuning.minBoundsCoverage
            })
        };

        const canMultiFloor = multiFloor &&
            Array.isArray(floorPlans) &&
            floorPlans.length >= 2 &&
            Array.isArray(solutions) &&
            solutions.length >= 2;

        // For multi-floor side-by-side, legend is overlay (no width consumed)
        const legendWidth = canMultiFloor ? 0 : (showLegend ? 200 : 0);

        const renderFloorPlans = [];
        const renderSolutions = [];
        if (canMultiFloor) {
            for (let i = 0; i < 2; i++) {
                const fp = floorPlans[i] || floorPlan;
                const sol = solutions[i] || solution;
                renderFloorPlans.push({
                    ...fp,
                    bounds: this._computeEffectiveBounds(fp, sol, {
                        ...options,
                        boundsPadRatio: tuning.boundsPadRatio,
                        boundsTrimRatio: tuning.boundsTrimRatio,
                        minBoundsCoverage: tuning.minBoundsCoverage
                    })
                });
                renderSolutions.push(sol);
            }
        }

        const primaryBounds = renderFloorPlan.bounds || this._sanitizeBounds(floorPlan.bounds);
        let maxPlanWidth = Math.max(1e-6, primaryBounds.maxX - primaryBounds.minX);
        let maxPlanHeight = Math.max(1e-6, primaryBounds.maxY - primaryBounds.minY);
        if (canMultiFloor) {
            renderFloorPlans.forEach((fp) => {
                const b = fp.bounds || this._sanitizeBounds(fp.bounds);
                maxPlanWidth = Math.max(maxPlanWidth, Math.max(1e-6, b.maxX - b.minX));
                maxPlanHeight = Math.max(maxPlanHeight, Math.max(1e-6, b.maxY - b.minY));
            });
        }

        const [width, height] = this._resolveReferencePageSize(
            pageSize,
            canMultiFloor ? 'landscape' : orientation,
            maxPlanWidth,
            maxPlanHeight,
            margin,
            legendWidth,
            titleBlockHeight,
            canMultiFloor
        );

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

        // Footer/title strip (reference-like bottom band)
        if (showTitleBlock) {
            const footerY = height - titleBlockHeight;
            const leftBoxW = 36;
            const rightBlockW = 300;
            const leftLabelW = Math.max(160, Math.round((width - rightBlockW - leftBoxW) * 0.42));
            const centerLabelW = width - 10 - leftBoxW - rightBlockW - leftLabelW;
            const leftX = 5;
            const leftLabelX = leftX + leftBoxW;
            const centerLabelX = leftLabelX + leftLabelW;
            const rightBlockX = centerLabelX + centerLabelW;
            const floorLabel1 = (Array.isArray(options.floorLabels) && options.floorLabels[0]) ? options.floorLabels[0] : 'PLAN ETAGE 01';
            const floorLabel2 = (Array.isArray(options.floorLabels) && options.floorLabels[1]) ? options.floorLabels[1] : 'PLAN ETAGE 02';

            svg.push(`<rect x="5" y="${footerY}" width="${width - 10}" height="${titleBlockHeight - 10}" fill="white" stroke="#008000" stroke-width="2"/>`);
            svg.push(`<line x1="${leftLabelX}" y1="${footerY}" x2="${leftLabelX}" y2="${footerY + titleBlockHeight - 10}" stroke="#008000" stroke-width="1"/>`);
            svg.push(`<line x1="${centerLabelX}" y1="${footerY}" x2="${centerLabelX}" y2="${footerY + titleBlockHeight - 10}" stroke="#008000" stroke-width="1"/>`);
            svg.push(`<line x1="${rightBlockX}" y1="${footerY}" x2="${rightBlockX}" y2="${footerY + titleBlockHeight - 10}" stroke="#008000" stroke-width="1"/>`);
            svg.push(`<text x="${leftX + 10}" y="${footerY + 22}" font-family="Times New Roman, serif" font-size="13" font-weight="bold" fill="#008000">${options.sheetNumber || '3'}</text>`);
            svg.push(`<text x="${leftLabelX + 10}" y="${footerY + 26}" font-family="Times New Roman, serif" font-size="14">${floorLabel1} ${scale}</text>`);
            svg.push(`<text x="${centerLabelX + 10}" y="${footerY + 26}" font-family="Times New Roman, serif" font-size="14">${floorLabel2} ${scale}</text>`);
            svg.push(`<text x="${leftLabelX + leftLabelW + 16}" y="${footerY + titleBlockHeight - 22}" font-family="Times New Roman, serif" font-size="16">SURFACES DES BOX</text>`);
            svg.push(`<text x="${rightBlockX + 105}" y="${footerY + 26}" font-family="Times New Roman, serif" font-size="16">-${companyName || 'COSTO'}-</text>`);
            if (companyAddress) {
                svg.push(`<text x="${rightBlockX + 30}" y="${footerY + 48}" font-family="Times New Roman, serif" font-size="10">${companyAddress}</text>`);
            }
            svg.push(`<text x="${rightBlockX + 30}" y="${footerY + titleBlockHeight - 20}" font-family="Helvetica" font-size="8">Date: ${new Date().toLocaleDateString('fr-FR')}</text>`);
        }

        // Drawing area background
        svg.push(`<rect x="${margin}" y="${margin}" width="${width - margin * 2 - legendWidth}" height="${height - margin * 2 - titleBlockHeight}" fill="white"/>`);

        let scaleFactor = 1;
        let svgScale1 = 1, svgScale2 = 1;
        if (canMultiFloor) {
            // Side-by-side layout (matching reference)
            const b1 = renderFloorPlans[0].bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
            const b2 = renderFloorPlans[1].bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
            const w1 = Math.max(1e-6, b1.maxX - b1.minX);
            const h1 = Math.max(1e-6, b1.maxY - b1.minY);
            const w2 = Math.max(1e-6, b2.maxX - b2.minX);
            const h2 = Math.max(1e-6, b2.maxY - b2.minY);
            const gapX = 30;
            const floor1Ratio = 0.62;
            const floor1AvailW = availableWidth * floor1Ratio - gapX / 2;
            const floor2AvailW = availableWidth * (1 - floor1Ratio) - gapX / 2;
            svgScale1 = Math.min(floor1AvailW / w1, availableHeight / h1) * fitScaleFactor;
            svgScale2 = Math.min(floor2AvailW / w2, availableHeight / h2) * fitScaleFactor;
            scaleFactor = svgScale1; // Default for shared helpers
        } else {
            const bounds = renderFloorPlan.bounds;
            const planWidth = bounds.maxX - bounds.minX;
            const planHeight = bounds.maxY - bounds.minY;
            scaleFactor = Math.min(availableWidth / planWidth, availableHeight / planHeight) * fitScaleFactor;
        }

        // Draw corridors as clean blue dashed lines (NO zigzag — matching reference "ligne circulation")
        const drawTrafficArrow = (cx, cy, angle, size = 6) => {
            const halfLength = size * 0.5;
            const halfWidth = size * 0.22;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const p1x = cx - halfLength * cos - (-halfWidth) * sin;
            const p1y = cy - halfLength * sin + (-halfWidth) * cos;
            const p2x = cx - halfLength * cos - (halfWidth) * sin;
            const p2y = cy - halfLength * sin + (halfWidth) * cos;
            const p3x = cx + halfLength * cos;
            const p3y = cy + halfLength * sin;
            svg.push(`<polygon points="${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y}" fill="#84c88d" opacity="0.92"/>`);
        };

        const drawCorridorLine = (x1, y1, x2, y2) => {
            svg.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#87b6ee" stroke-width="0.9" stroke-dasharray="4,2" opacity="0.88"/>`);
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.hypot(dx, dy);
            if (!Number.isFinite(len) || len < 6) return;
            const angle = Math.atan2(dy, dx);
            const spacing = Math.max(18, Math.min(50, len / 5));
            const count = Math.max(1, Math.floor(len / spacing));
            for (let i = 0; i < count; i++) {
                const t = count === 1 ? 0.5 : ((i + 0.5) / count);
                const cx = x1 + dx * t;
                const cy = y1 + dy * t;
                drawTrafficArrow(cx, cy, angle, Math.max(4.8, Math.min(8.2, spacing * 0.34)));
            }
        };

        // Draw radiator symbols as small discrete red rectangles (matching reference "Radiateur")
        const drawRadiatorSymbol = (cx, cy, angle, label) => {
            const symW = 6, symH = 3;
            const cos = Math.cos(angle + Math.PI / 4);
            const sin = Math.sin(angle + Math.PI / 4);
            const hw = symW / 2, hh = symH / 2;
            const corners = [
                { x: cx + cos * (-hw) - sin * (-hh), y: cy + sin * (-hw) + cos * (-hh) },
                { x: cx + cos * (hw) - sin * (-hh), y: cy + sin * (hw) + cos * (-hh) },
                { x: cx + cos * (hw) - sin * (hh), y: cy + sin * (hw) + cos * (hh) },
                { x: cx + cos * (-hw) - sin * (hh), y: cy + sin * (-hw) + cos * (hh) }
            ];
            const pts = corners.map(p => `${p.x},${p.y}`).join(' ');
            svg.push(`<polygon points="${pts}" fill="none" stroke="#cc2233" stroke-width="0.8"/>`);
            // X inside
            svg.push(`<line x1="${corners[0].x}" y1="${corners[0].y}" x2="${corners[2].x}" y2="${corners[2].y}" stroke="#cc2233" stroke-width="0.4"/>`);
            svg.push(`<line x1="${corners[1].x}" y1="${corners[1].y}" x2="${corners[3].x}" y2="${corners[3].y}" stroke="#cc2233" stroke-width="0.4"/>`);
            if (label) {
                svg.push(`<text x="${cx}" y="${cy - symH - 1}" text-anchor="middle" font-family="Helvetica" font-size="3" fill="#cc2233">${label}</text>`);
            }
        };

        const renderFloor = (fp, sol, drawOffsetX, drawOffsetY, floorLabel) => {
            const bounds = fp.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
            const tx = (x) => drawOffsetX + (x - bounds.minX) * scaleFactor;
            const ty = (y) => drawOffsetY + (bounds.maxY - y) * scaleFactor;

            // Coverage rectangle around effective plan bounds.
            const coverW = (bounds.maxX - bounds.minX) * scaleFactor;
            const coverH = (bounds.maxY - bounds.minY) * scaleFactor;
            if (Number.isFinite(coverW) && Number.isFinite(coverH) && coverW > 1 && coverH > 1) {
                svg.push(`<rect x="${tx(bounds.minX)}" y="${ty(bounds.maxY)}" width="${coverW}" height="${coverH}" fill="none" stroke="#2f2f32" stroke-width="0.9"/>`);
            }

            // Walls
            (fp.walls || []).forEach((wall) => {
                if (!wall.start || !wall.end) return;
                svg.push(`<line x1="${tx(wall.start.x)}" y1="${ty(wall.start.y)}" x2="${tx(wall.end.x)}" y2="${ty(wall.end.y)}" stroke="#000000" stroke-width="0.5"/>`);
            });

            // Envelope (only source-authentic, connected envelope)
            if (this._shouldRenderEnvelope(fp) && Array.isArray(fp.envelope) && fp.envelope.length >= 2) {
                if (fp.envelope[0].start && fp.envelope[0].end) {
                    fp.envelope.forEach((line) => {
                        if (!line.start || !line.end) return;
                        svg.push(`<line x1="${tx(line.start.x)}" y1="${ty(line.start.y)}" x2="${tx(line.end.x)}" y2="${ty(line.end.y)}" stroke="#2f2f32" stroke-width="1.3"/>`);
                    });
                } else {
                    const points = fp.envelope.map(pt => `${tx(pt[0] ?? pt.x)} ${ty(pt[1] ?? pt.y)}`).join(' ');
                    svg.push(`<polyline points="${points}" fill="none" stroke="#2f2f32" stroke-width="1.3"/>`);
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

            // Corridors — clean blue dashed lines (NO zigzag)
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

                // Draw corridor as blue dashed centerline
                const isHorizontal = w >= h;
                if (isHorizontal) {
                    const cy = y + h / 2;
                    drawCorridorLine(tx(x), ty(cy), tx(x + w), ty(cy));
                } else {
                    const cx = x + w / 2;
                    drawCorridorLine(tx(cx), ty(y), tx(cx), ty(y + h));
                }
            });

            // Radiators — small discrete symbols (NO zigzag)
            (sol.radiators || []).forEach((radiator) => {
                if (radiator.positions && radiator.positions.length > 0) {
                    // New format: use positions directly
                    radiator.positions.forEach(pos => {
                        drawRadiatorSymbol(tx(pos.x), ty(pos.y), radiator.wallAngle || 0, radiator.label || '100×300');
                    });
                } else if (radiator.path && radiator.path.length >= 2) {
                    // Backwards-compatible: use start/end of path
                    const p0 = radiator.path[0];
                    const pN = radiator.path[radiator.path.length - 1];
                    const sx = Array.isArray(p0) ? p0[0] : p0.x;
                    const sy = Array.isArray(p0) ? p0[1] : p0.y;
                    const ex = Array.isArray(pN) ? pN[0] : pN.x;
                    const ey = Array.isArray(pN) ? pN[1] : pN.y;
                    const wallLen = Math.hypot(ex - sx, ey - sy);
                    if (wallLen < 2) return;
                    const angle = Math.atan2(ey - sy, ex - sx);
                    const n = Math.max(1, Math.floor(wallLen / 3));
                    for (let i = 0; i < n; i++) {
                        const t = (i + 0.5) / n;
                        drawRadiatorSymbol(tx(sx + (ex - sx) * t), ty(sy + (ey - sy) * t), angle, '100×300');
                    }
                }
            });

            if (floorLabel) {
                svg.push(`<text x="${drawOffsetX - 40}" y="${drawOffsetY + 20}" font-family="Helvetica" font-size="10">${floorLabel} ${scale}</text>`);
                svg.push(`<text x="${drawOffsetX - 40}" y="${drawOffsetY + 35}" font-family="Helvetica" font-size="9">SURFACES DES BOX</text>`);
            }
        };

        if (canMultiFloor) {
            // Side-by-side layout (matching reference)
            const gapX = 30;
            const floor1Ratio = 0.62;
            const floor1AvailW = availableWidth * floor1Ratio - gapX / 2;
            const b1 = renderFloorPlans[0].bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
            const b2 = renderFloorPlans[1].bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
            const renderedW1 = (b1.maxX - b1.minX) * svgScale1;
            const renderedH1 = (b1.maxY - b1.minY) * svgScale1;
            const renderedW2 = (b2.maxX - b2.minX) * svgScale2;
            const renderedH2 = (b2.maxY - b2.minY) * svgScale2;

            // Floor 1: left side, vertically centered
            const leftOffsetX = offsetX;
            const leftOffsetY = offsetY + Math.max(0, (availableHeight - renderedH1) / 2);
            // Floor 2: right side, upper portion
            const rightOffsetX = offsetX + floor1AvailW + gapX;
            const rightOffsetY = offsetY + 20;

            // Temporarily set scaleFactor for each floor render
            scaleFactor = svgScale1;
            renderFloor(renderFloorPlans[0], renderSolutions[0], leftOffsetX, leftOffsetY, 'PLAN ETAGE 01');
            scaleFactor = svgScale2;
            renderFloor(renderFloorPlans[1], renderSolutions[1], rightOffsetX, rightOffsetY, 'PLAN ETAGE 02');
            scaleFactor = svgScale1; // Restore
        } else {
            const bounds = renderFloorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
            const centeredOffsetX = offsetX + Math.max(0, (availableWidth - (bounds.maxX - bounds.minX) * scaleFactor) / 2);
            const centeredOffsetY = offsetY + Math.max(0, (availableHeight - (bounds.maxY - bounds.minY) * scaleFactor) / 2);
            renderFloor(renderFloorPlan, solution, centeredOffsetX, centeredOffsetY, options.floorLabel || 'PLAN ETAGE 01');
        }

        // Legend
        if (showLegend) {
            const legendX = width - legendWidth + 10;
            const legendY = margin;
            const panelWidth = legendWidth - 24;
            svg.push(`<rect x="${legendX - 5}" y="${legendY}" width="${panelWidth}" height="${height - margin * 2 - titleBlockHeight}" fill="none" stroke="#cccccc" stroke-width="1"/>`);
            svg.push(`<text x="${legendX}" y="${legendY + 20}" font-family="Helvetica" font-size="12" font-weight="bold">LEGENDE</text>`);
            const sampleStartX = legendX;
            const sampleEndX = legendX + 46;
            const labelX = sampleEndX + 8;
            svg.push(`<line x1="${sampleStartX}" y1="${legendY + 40}" x2="${sampleEndX}" y2="${legendY + 40}" stroke="#000000" stroke-width="1"/>`);
            svg.push(`<text x="${labelX}" y="${legendY + 44}" font-family="Helvetica" font-size="8">Tole Blanche</text>`);
            svg.push(`<line x1="${sampleStartX}" y1="${legendY + 60}" x2="${sampleEndX}" y2="${legendY + 60}" stroke="#0000ff" stroke-width="2"/>`);
            svg.push(`<text x="${labelX}" y="${legendY + 64}" font-family="Helvetica" font-size="8">Tole Grise</text>`);
            svg.push(`<line x1="${sampleStartX}" y1="${legendY + 80}" x2="${sampleEndX}" y2="${legendY + 80}" stroke="#88c694" stroke-width="1"/>`);
            svg.push(`<text x="${labelX}" y="${legendY + 84}" font-family="Helvetica" font-size="8">Ligne circulation</text>`);

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
        const useRowZigzags = options.useRowZigzags === true;

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
            DARK_GREEN: rgb(0, 0.5, 0),
            // Partition types matching reference legend
            TOLE_GRISE: rgb(0, 0.2, 0.8),        // Blue partition walls ("Tole Grise")
            TOLE_BLANCHE: rgb(0.42, 0.45, 0.5),   // Gray structural walls ("Tole Blanche")
            CIRCULATION: rgb(0.4, 0.7, 0.95),      // Light blue dashed ("ligne circulation")
            DOOR_GREEN: rgb(0.2, 0.65, 0.2)        // Small green door chevrons
        };

        const bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const baseOffsetX = offsetX;
        const baseOffsetY = offsetY;
        offsetX = offsetX - (bounds.minX || 0) * scale;
        offsetY = offsetY - (bounds.minY || 0) * scale;

        // Draw an explicit outer coverage rectangle around the rendered plan area.
        const coverageWidth = (bounds.maxX - bounds.minX) * scale;
        const coverageHeight = (bounds.maxY - bounds.minY) * scale;
        if (Number.isFinite(coverageWidth) && Number.isFinite(coverageHeight) && coverageWidth > 1 && coverageHeight > 1) {
            page.drawRectangle({
                x: baseOffsetX,
                y: baseOffsetY,
                width: coverageWidth,
                height: coverageHeight,
                borderColor: rgb(0.18, 0.18, 0.2),
                borderWidth: Math.max(0.45, Math.min(1.1, scale * 0.03))
            });
        }

        // Draw walls as thin dark lines (matching reference 'Tôle Blanche' style)
        // Reference shows walls as thin gray/dark lines, NOT thick filled rectangles
        const WALL_COLOR = rgb(0.2, 0.2, 0.22);   // Dark charcoal
        const wallLineWidth = Number(options.wallLineWidth);
        const WALL_THICKNESS = Number.isFinite(wallLineWidth)
            ? Math.max(0.2, Math.min(2.2, wallLineWidth))
            : Math.max(0.45, Math.min(1.0, scale * 0.03));  // Thin line like reference
        if (floorPlan.walls && Array.isArray(floorPlan.walls)) {
            floorPlan.walls.forEach(wall => {
                if (wall.start && wall.end) {
                    const x1 = offsetX + wall.start.x * scale;
                    const y1 = offsetY + wall.start.y * scale;
                    const x2 = offsetX + wall.end.x * scale;
                    const y2 = offsetY + wall.end.y * scale;

                    // Draw as thin line (matching reference style)
                    page.drawLine({
                        start: { x: x1, y: y1 },
                        end: { x: x2, y: y2 },
                        thickness: WALL_THICKNESS,
                        color: WALL_COLOR
                    });
                }
            });
        }

        // Draw external envelope as medium-weight dark lines (building outline)
        // Reference: envelope is a darker, slightly thicker outline than interior walls
        const ENVELOPE_COLOR = rgb(0.15, 0.15, 0.18); // Dark charcoal for envelope
        const ENVELOPE_THICKNESS = Math.max(WALL_THICKNESS + 0.35, Math.min(1.8, WALL_THICKNESS * 1.9)); // Medium thickness for envelope
        const DIM_TEXT_COLOR = rgb(0.3, 0.3, 0.35); // Dark gray for all dimension text

        const drawEnvelopeSegment = (x1, y1, x2, y2, length) => {
            const dx = Math.abs(x2 - x1);
            const dy = Math.abs(y2 - y1);

            // Draw envelope as a thicker line (building outline)
            page.drawLine({
                start: { x: x1, y: y1 },
                end: { x: x2, y: y2 },
                thickness: ENVELOPE_THICKNESS,
                color: ENVELOPE_COLOR
            });

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

        if (this._shouldRenderEnvelope(floorPlan) && Array.isArray(floorPlan.envelope) && floorPlan.envelope.length > 0) {
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

        // Draw boxes with partition-type coloring (matching COSTO reference)
        // Reference: blue (Tôle Grise) partition walls, red door markers, red area text
        const boxes = solution.boxes || [];
        const DIM_COLOR = rgb(0.3, 0.3, 0.35);   // Dark gray for dimensions (matching reference)
        boxes.forEach(box => {
            const x = offsetX + box.x * scale;
            const y = offsetY + box.y * scale;
            const w = box.width * scale;
            const h = box.height * scale;
            const area = box.area || (box.width * box.height);

            // White fill first
            page.drawRectangle({
                x, y, width: w, height: h,
                color: COLORS.WHITE
            });

            // Partition-type coloring: blue Tôle Grise / gray Tôle Blanche per edge
            const partitions = box.partitions || {
                top: 'tole_grise', bottom: 'tole_grise',
                left: 'tole_grise', right: 'tole_grise'
            };
            const getEdgeColor = (type) => type === 'tole_blanche' ? COLORS.TOLE_BLANCHE : COLORS.TOLE_GRISE;
            const getEdgeWidth = (type) => type === 'tole_blanche' ? 0.65 : 1.15;

            // Bottom edge
            page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: getEdgeWidth(partitions.bottom), color: getEdgeColor(partitions.bottom) });
            // Right edge
            page.drawLine({ start: { x: x + w, y }, end: { x: x + w, y: y + h }, thickness: getEdgeWidth(partitions.right), color: getEdgeColor(partitions.right) });
            // Top edge
            page.drawLine({ start: { x: x + w, y: y + h }, end: { x, y: y + h }, thickness: getEdgeWidth(partitions.top), color: getEdgeColor(partitions.top) });
            // Left edge
            page.drawLine({ start: { x, y: y + h }, end: { x, y }, thickness: getEdgeWidth(partitions.left), color: getEdgeColor(partitions.left) });

            // Small green chevron arrow on corridor-facing side (matching reference)
            // Reference shows tiny green directional arrows/chevrons at door openings
            const doorSide = box.doorSide || box.facing || null;
            if (doorSide) {
                const chevronSize = Math.min(w, h) * 0.18; // Small relative to box
                const doorColor = COLORS.DOOR_GREEN;
                const chevronThickness = 1.0;
                const cx = x + w / 2; // box center x
                const cy = y + h / 2; // box center y
                switch (doorSide) {
                    case 'front': case 'bottom': {
                        // Chevron pointing down (into corridor below)
                        const tipY = y - chevronSize * 0.3;
                        page.drawLine({ start: { x: cx - chevronSize * 0.5, y: y }, end: { x: cx, y: tipY }, thickness: chevronThickness, color: doorColor });
                        page.drawLine({ start: { x: cx + chevronSize * 0.5, y: y }, end: { x: cx, y: tipY }, thickness: chevronThickness, color: doorColor });
                        break;
                    }
                    case 'back': case 'top': {
                        // Chevron pointing up (into corridor above)
                        const tipY = y + h + chevronSize * 0.3;
                        page.drawLine({ start: { x: cx - chevronSize * 0.5, y: y + h }, end: { x: cx, y: tipY }, thickness: chevronThickness, color: doorColor });
                        page.drawLine({ start: { x: cx + chevronSize * 0.5, y: y + h }, end: { x: cx, y: tipY }, thickness: chevronThickness, color: doorColor });
                        break;
                    }
                    case 'left': {
                        // Chevron pointing left (into corridor on left)
                        const tipX = x - chevronSize * 0.3;
                        page.drawLine({ start: { x: x, y: cy - chevronSize * 0.5 }, end: { x: tipX, y: cy }, thickness: chevronThickness, color: doorColor });
                        page.drawLine({ start: { x: x, y: cy + chevronSize * 0.5 }, end: { x: tipX, y: cy }, thickness: chevronThickness, color: doorColor });
                        break;
                    }
                    case 'right': {
                        // Chevron pointing right (into corridor on right)
                        const tipX = x + w + chevronSize * 0.3;
                        page.drawLine({ start: { x: x + w, y: cy - chevronSize * 0.5 }, end: { x: tipX, y: cy }, thickness: chevronThickness, color: doorColor });
                        page.drawLine({ start: { x: x + w, y: cy + chevronSize * 0.5 }, end: { x: tipX, y: cy }, thickness: chevronThickness, color: doorColor });
                        break;
                    }
                }
            }

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

            // Unit size / area label (small, below the box number)
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

            // Area dimensions (dark gray, matching reference)
            if (options.showDimensions && box.width && box.height) {
                const dimFontSize = 5;

                // Area text above box in red
                const areaText = `${area.toFixed(2)}m²`;
                page.drawText(areaText, {
                    x: x + 1,
                    y: y + h + 3,
                    size: dimFontSize,
                    font,
                    color: DIM_COLOR
                });
            }
        });

        // ══════════════════════════════════════════════════════════════
        // RADIATORS: Continuous red zigzag/wavy polylines (reference style)
        // The reference shows RED CONTINUOUS WAVY LINES along the outer
        // perimeter of every box row, NOT discrete symbols.
        // ══════════════════════════════════════════════════════════════
        const RADIATOR_RED = rgb(0.85, 0.08, 0.12);
        const RAD_LINE_THICKNESS = 1.5;  // Slightly bold for visibility
        const RAD_LABEL_SIZE = 3.5;

        // Helper: draw a continuous zigzag polyline in the given color
        const drawRadiatorPolyline = (pathPts, thickness, color) => {
            if (!Array.isArray(pathPts) || pathPts.length < 2) return;
            for (let pi = 0; pi < pathPts.length - 1; pi++) {
                const p1 = pathPts[pi];
                const p2 = pathPts[pi + 1];
                const x1 = Number(Array.isArray(p1) ? p1[0] : p1.x);
                const y1 = Number(Array.isArray(p1) ? p1[1] : p1.y);
                const x2 = Number(Array.isArray(p2) ? p2[0] : p2.x);
                const y2 = Number(Array.isArray(p2) ? p2[1] : p2.y);
                if (!Number.isFinite(x1) || !Number.isFinite(y1) ||
                    !Number.isFinite(x2) || !Number.isFinite(y2)) continue;
                page.drawLine({
                    start: { x: offsetX + x1 * scale, y: offsetY + y1 * scale },
                    end:   { x: offsetX + x2 * scale, y: offsetY + y2 * scale },
                    thickness, color
                });
            }
        };

        // Helper: generate inline zigzag path between two points
        const makeZigzagPath = (sx, sy, ex, ey) => {
            const len = Math.hypot(ex - sx, ey - sy);
            if (len < 0.5) return [];
            const dx = (ex - sx) / len, dy = (ey - sy) / len;
            const nx = -dy, ny = dx;  // perpendicular
            const amp = 0.18;          // 18cm amplitude
            const freq = 4.0;          // waves per metre
            const numWaves = Math.max(2, Math.ceil(len * freq));
            const totalPts = numWaves * 2 + 1;
            const pts = [];
            for (let i = 0; i <= totalPts; i++) {
                const t = i / totalPts;
                const side = (i % 2 === 0) ? 1 : -1;
                pts.push({
                    x: sx + dx * len * t + nx * amp * side,
                    y: sy + dy * len * t + ny * amp * side
                });
            }
            return pts;
        };

        const includePerimeterRadiators = options.includePerimeterRadiators === true;
        const allowRadiatorFallback = options.allowRadiatorFallback === true;
        const radiatorData = Array.isArray(solution.radiators) ? solution.radiators : [];
        const isPerimeterSegment = (segment) => {
            if (!segment || !segment.start || !segment.end) return false;
            const x1 = Number(segment.start.x);
            const y1 = Number(segment.start.y);
            const x2 = Number(segment.end.x);
            const y2 = Number(segment.end.y);
            if (![x1, y1, x2, y2].every(Number.isFinite)) return false;
            const tol = 0.55;
            const onLeft = Math.abs(x1 - bounds.minX) <= tol && Math.abs(x2 - bounds.minX) <= tol;
            const onRight = Math.abs(x1 - bounds.maxX) <= tol && Math.abs(x2 - bounds.maxX) <= tol;
            const onBottom = Math.abs(y1 - bounds.minY) <= tol && Math.abs(y2 - bounds.minY) <= tol;
            const onTop = Math.abs(y1 - bounds.maxY) <= tol && Math.abs(y2 - bounds.maxY) <= tol;
            return onLeft || onRight || onBottom || onTop;
        };

        if (useRowZigzags && radiatorData.length > 0) {
            // Use engine-generated radiator data with wavy path
            radiatorData.forEach(radiator => {
                if (!radiator || typeof radiator !== 'object') return;
                if (!includePerimeterRadiators && isPerimeterSegment(radiator.wallSegment)) return;
                const rPath = radiator.path || [];
                if (rPath.length >= 2) {
                    // Check if this is already a full wavy path (many points)
                    // or just a 2-point start/end
                    if (rPath.length > 4) {
                        // Full wavy path — draw directly
                        drawRadiatorPolyline(rPath, RAD_LINE_THICKNESS, RADIATOR_RED);
                    } else {
                        // 2-point segment — generate zigzag inline
                        const p0 = rPath[0], pN = rPath[rPath.length - 1];
                        const sx = Number(Array.isArray(p0) ? p0[0] : p0.x);
                        const sy = Number(Array.isArray(p0) ? p0[1] : p0.y);
                        const ex = Number(Array.isArray(pN) ? pN[0] : pN.x);
                        const ey = Number(Array.isArray(pN) ? pN[1] : pN.y);
                        const zigPath = makeZigzagPath(sx, sy, ex, ey);
                        drawRadiatorPolyline(zigPath, RAD_LINE_THICKNESS, RADIATOR_RED);
                    }
                    // Optional: small dimension label at midpoint
                    if (rPath.length >= 2 && radiator.label) {
                        const mid = rPath[Math.floor(rPath.length / 2)];
                        const mx = Number(Array.isArray(mid) ? mid[0] : mid.x);
                        const my = Number(Array.isArray(mid) ? mid[1] : mid.y);
                        if (Number.isFinite(mx) && Number.isFinite(my)) {
                            page.drawText(radiator.label, {
                                x: offsetX + mx * scale - 8,
                                y: offsetY + my * scale + 3,
                                size: RAD_LABEL_SIZE,
                                font,
                                color: RADIATOR_RED
                            });
                        }
                    }
                }
            });
        } else if (useRowZigzags && allowRadiatorFallback) {
            // Fallback: generate zigzag paths along perimeter walls
            if (floorPlan.walls && Array.isArray(floorPlan.walls)) {
                const floorCX = (bounds.minX + bounds.maxX) / 2;
                const floorCY = (bounds.minY + bounds.maxY) / 2;
                const tol = 1.2; // metres from boundary
                floorPlan.walls.forEach(wall => {
                    if (!wall.start || !wall.end) return;
                    const len = Math.hypot(
                        wall.end.x - wall.start.x,
                        wall.end.y - wall.start.y
                    );
                    if (len < 1.5) return;
                    // Only perimeter walls
                    const onPerim =
                        Math.abs(wall.start.x - bounds.minX) < tol ||
                        Math.abs(wall.start.x - bounds.maxX) < tol ||
                        Math.abs(wall.start.y - bounds.minY) < tol ||
                        Math.abs(wall.start.y - bounds.maxY) < tol;
                    if (!onPerim) return;
                    // Offset slightly inward
                    const dx = (wall.end.x - wall.start.x) / len;
                    const dy = (wall.end.y - wall.start.y) / len;
                    const nx = -dy, ny = dx;
                    const dot = nx * (floorCX - wall.start.x) + ny * (floorCY - wall.start.y);
                    const off = 0.15 * (dot >= 0 ? 1 : -1);
                    const zigPath = makeZigzagPath(
                        wall.start.x + nx * off, wall.start.y + ny * off,
                        wall.end.x   + nx * off, wall.end.y   + ny * off
                    );
                    drawRadiatorPolyline(zigPath, RAD_LINE_THICKNESS, RADIATOR_RED);
                });
            }
        }
        // ── CIRCULATION PATHS: Light-blue dashed center-lines ───────
        // Reference legend: "ligne circulation" = light-blue dashed lines through corridors
        const CIRCULATION_COLOR = COLORS.CIRCULATION;
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
                        CIRCULATION_COLOR
                    );
                }
            });
        } else {
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
                _drawDashedLine(sp, ep, 0.8, CIRCULATION_COLOR);
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
        const serif = await page.doc.embedFont(StandardFonts.TimesRoman);
        const footerY = 12;
        const footerH = 90;
        const stroke = rgb(0, 0.5, 0);

        // Outer footer band (reference-like full-width strip)
        page.drawRectangle({
            x: 5,
            y: footerY,
            width: width - 10,
            height: footerH,
            borderColor: stroke,
            borderWidth: 2
        });

        const leftBoxW = 36;
        const rightBlockW = 300;
        const leftLabelW = Math.max(160, Math.round((width - rightBlockW - leftBoxW) * 0.42));
        const centerLabelW = width - 10 - leftBoxW - rightBlockW - leftLabelW;

        const leftX = 5;
        const leftLabelX = leftX + leftBoxW;
        const centerLabelX = leftLabelX + leftLabelW;
        const rightBlockX = centerLabelX + centerLabelW;

        page.drawLine({ start: { x: leftLabelX, y: footerY }, end: { x: leftLabelX, y: footerY + footerH }, thickness: 1, color: stroke });
        page.drawLine({ start: { x: centerLabelX, y: footerY }, end: { x: centerLabelX, y: footerY + footerH }, thickness: 1, color: stroke });
        page.drawLine({ start: { x: rightBlockX, y: footerY }, end: { x: rightBlockX, y: footerY + footerH }, thickness: 1, color: stroke });

        const label1 = (Array.isArray(options.floorLabels) && options.floorLabels[0]) || 'PLAN ETAGE 01';
        const label2 = (Array.isArray(options.floorLabels) && options.floorLabels[1]) || 'PLAN ETAGE 02';
        const scaleText = options.scale || '1:200';

        page.drawText(String(options.sheetNumber || '3'), {
            x: leftX + 10,
            y: footerY + footerH - 22,
            size: 13,
            font: boldFont,
            color: stroke
        });

        page.drawText(`${label1} ${scaleText}`, {
            x: leftLabelX + 10,
            y: footerY + footerH - 28,
            size: 14,
            font: serif,
            color: rgb(0, 0, 0)
        });

        page.drawText(`${label2} ${scaleText}`, {
            x: centerLabelX + 10,
            y: footerY + footerH - 28,
            size: 14,
            font: serif,
            color: rgb(0, 0, 0)
        });

        page.drawText('SURFACES DES BOX', {
            x: leftLabelX + leftLabelW + 18,
            y: footerY + 24,
            size: 16,
            font: serif,
            color: rgb(0, 0, 0)
        });

        // Right metadata block
        const address = options.companyAddress || '5 chemin de la dime 95700 Roissy FRANCE';
        page.drawText(`-${options.companyName || 'COSTO'}-`, {
            x: rightBlockX + 110,
            y: footerY + footerH - 28,
            size: 16,
            font: serif,
            color: rgb(0, 0, 0)
        });
        page.drawText(address, {
            x: rightBlockX + 32,
            y: footerY + 38,
            size: 10,
            font: serif,
            color: rgb(0, 0, 0)
        });

        page.drawText(`Date: ${new Date().toLocaleDateString('fr-FR')}`, {
            x: rightBlockX + 32,
            y: footerY + 22,
            size: 8,
            font,
            color: rgb(0, 0, 0)
        });

        if (options.documentId) {
            const docBoxW = 52;
            page.drawRectangle({
                x: width - 5 - docBoxW,
                y: footerY,
                width: docBoxW,
                height: footerH,
                borderColor: stroke,
                borderWidth: 1
            });
            page.drawText(String(options.documentId), {
                x: width - 5 - docBoxW + 20,
                y: footerY + 12,
                size: 7,
                font,
                color: rgb(0, 0, 0),
                rotate: degrees(90)
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
