// Canvas functionality disabled for Windows compatibility
// const { createCanvas } = require('canvas');
const fs = require('fs');
const { PDFDocument, rgb } = require('pdf-lib');

class ExportManager {
    constructor() {
        this.canvas = null;
        this.ctx = null;
    }

    async exportToPDF(floorPlan, ilots, corridors, options = {}) {
        const {
            width = 3840,  // 4K width
            height = 2160, // 4K height
            title = 'FloorPlan Pro Layout',
            showGrid = true,
            showDimensions = true
        } = options;

        // Create PDF document
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([width, height]);

        // Draw floor plan elements
        this.drawFloorPlanToPDF(page, floorPlan, ilots, corridors, { width, height, showGrid, showDimensions });

        // Add title and metadata
        page.drawText(title, {
            x: 50,
            y: height - 50,
            size: 20,
            color: rgb(0, 0, 0)
        });

        // Add legend
        this.addLegendToPDF(page, width, height);

        // Add statistics
        this.addStatisticsToPDF(page, floorPlan, ilots, corridors, width, height);

        const pdfBytes = await pdfDoc.save();
        return pdfBytes;
    }

    drawFloorPlanToPDF(page, floorPlan, ilots, corridors, options) {
        const { width, height, showGrid } = options;

        // Calculate scale based on actual floor plan bounds
        const bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const planWidth = (bounds.maxX - bounds.minX) || 100;
        const planHeight = (bounds.maxY - bounds.minY) || 100;

        // Leave margins: 50px left, 100px top, 50px right, 150px bottom for stats
        const drawWidth = width - 100;
        const drawHeight = height - 250;
        const scale = Math.min(drawWidth / planWidth, drawHeight / planHeight);

        const offsetX = 50;
        const offsetY = height - 150; // Start from bottom (PDF Y is inverted)

        // Draw grid if enabled
        if (showGrid) {
            this.drawGridToPDF(page, width, height, offsetX, offsetY - drawHeight);
        }

        // Coordinate transformation helper - adjusts for bounds origin
        const tx = (x) => offsetX + (x - bounds.minX) * scale;
        const ty = (y) => offsetY - (y - bounds.minY) * scale; // PDF Y is inverted

        // Draw walls (black lines)
        if (floorPlan.walls) {
            floorPlan.walls.forEach(wall => {
                const sx = Number(wall.start && wall.start.x);
                const sy = Number(wall.start && wall.start.y);
                const ex = Number(wall.end && wall.end.x);
                const ey = Number(wall.end && wall.end.y);
                if (!isFinite(sx) || !isFinite(sy) || !isFinite(ex) || !isFinite(ey)) return;
                page.drawLine({
                    start: { x: tx(sx), y: ty(sy) },
                    end: { x: tx(ex), y: ty(ey) },
                    thickness: 2,
                    color: rgb(0, 0, 0)
                });
            });
        }

        // Draw forbidden zones (blue)
        if (floorPlan.forbiddenZones) {
            floorPlan.forbiddenZones.forEach(zone => {
                const sx = Number(zone.start && zone.start.x);
                const sy = Number(zone.start && zone.start.y);
                const ex = Number(zone.end && zone.end.x);
                const ey = Number(zone.end && zone.end.y);
                if (!isFinite(sx) || !isFinite(sy) || !isFinite(ex) || !isFinite(ey)) return;
                page.drawLine({
                    start: { x: tx(sx), y: ty(sy) },
                    end: { x: tx(ex), y: ty(ey) },
                    thickness: 3,
                    color: rgb(0, 0, 1)
                });
            });
        }

        // Draw entrances (red)
        if (floorPlan.entrances) {
            floorPlan.entrances.forEach(entrance => {
                const sx = Number(entrance.start && entrance.start.x);
                const sy = Number(entrance.start && entrance.start.y);
                const ex = Number(entrance.end && entrance.end.x);
                const ey = Number(entrance.end && entrance.end.y);
                if (!isFinite(sx) || !isFinite(sy) || !isFinite(ex) || !isFinite(ey)) return;
                page.drawLine({
                    start: { x: tx(sx), y: ty(sy) },
                    end: { x: tx(ex), y: ty(ey) },
                    thickness: 4,
                    color: rgb(1, 0, 0)
                });
            });
        }

        // Draw îlots (green/gray boxes)
        if (ilots) {
            ilots.forEach(ilot => {
                const ix = Number(ilot.x);
                const iy = Number(ilot.y);
                const iwidth = Number(ilot.width);
                const iheight = Number(ilot.height);
                if (![ix, iy, iwidth, iheight].every(n => isFinite(Number(n)))) {
                    console.warn('Skipping invalid ilot in PDF draw', ilot);
                    return;
                }
                const color = this.getIlotColor(ilot.type);
                try {
                    page.drawRectangle({
                        x: tx(ix),
                        y: ty(iy + iheight), // PDF Y from bottom, so use top-left corner
                        width: iwidth * scale,
                        height: iheight * scale,
                        color: color,
                        borderColor: rgb(0, 0, 0),
                        borderWidth: 1
                    });
                } catch (e) {
                    console.error('Failed to draw ilot rectangle', { ilot, err: e && e.message });
                }

                // Add capacity label if present and numeric
                const labelX = tx(ix + iwidth / 2) - 5;
                const labelY = ty(iy + iheight / 2) - 5;
                const cap = ilot && (typeof ilot.capacity !== 'undefined' ? ilot.capacity : null);
                if (cap !== null && cap !== undefined && isFinite(Number(cap)) && isFinite(labelX) && isFinite(labelY)) {
                    try {
                        page.drawText(String(cap), {
                            x: labelX,
                            y: labelY,
                            size: 10,
                            color: rgb(1, 1, 1)
                        });
                    } catch (e) {
                        // Non-fatal: skip drawing label
                    }
                }
            });
        }

        // Draw corridors (yellow)
        if (corridors) {
            corridors.forEach(corridor => {
                // Corridor may be returned as a polygon/path or as x/y/width/height. Handle both.
                let cx, cy, cwidth, cheight;
                if (typeof corridor.x === 'number' && typeof corridor.y === 'number' && typeof corridor.width === 'number' && typeof corridor.height === 'number') {
                    cx = corridor.x; cy = corridor.y; cwidth = corridor.width; cheight = corridor.height;
                } else if (corridor.polygon && Array.isArray(corridor.polygon) && corridor.polygon.length) {
                    // compute bbox of polygon
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    corridor.polygon.forEach(pt => {
                        if (pt[0] < minX) minX = pt[0];
                        if (pt[1] < minY) minY = pt[1];
                        if (pt[0] > maxX) maxX = pt[0];
                        if (pt[1] > maxY) maxY = pt[1];
                    });
                    cx = minX; cy = minY; cwidth = maxX - minX; cheight = maxY - minY;
                } else if (corridor.path && Array.isArray(corridor.path) && corridor.path.length) {
                    // compute bbox of path
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    corridor.path.forEach(pt => {
                        if (pt[0] < minX) minX = pt[0];
                        if (pt[1] < minY) minY = pt[1];
                        if (pt[0] > maxX) maxX = pt[0];
                        if (pt[1] > maxY) maxY = pt[1];
                    });
                    const pad = (corridor.width || 1) / 2;
                    cx = minX - pad; cy = minY - pad; cwidth = (maxX - minX) + pad * 2; cheight = (maxY - minY) + pad * 2;
                } else {
                    // Unknown corridor format — skip drawing
                    return;
                }

                // Validate numbers
                if (![cx, cy, cwidth, cheight].every(n => isFinite(Number(n)))) {
                    console.warn('Skipping corridor with invalid numeric bbox', { corridor, cx, cy, cwidth, cheight });
                    return;
                }

                try {
                    page.drawRectangle({
                        x: tx(cx),
                        y: ty(cy + cheight), // PDF Y from bottom
                        width: cwidth * scale,
                        height: cheight * scale,
                        color: rgb(1, 1, 0.6),
                        borderColor: rgb(0.8, 0.6, 0),
                        borderWidth: 1
                    });
                } catch (e) {
                    console.error('Failed to draw corridor rectangle', { corridor, err: e && e.message });
                }
            });
        }
    }

    drawGridToPDF(page, width, height, offsetX, offsetY) {
        const gridSize = 20;

        // Vertical lines
        for (let x = offsetX; x < width - 50; x += gridSize) {
            page.drawLine({
                start: { x, y: offsetY },
                end: { x, y: height - 100 },
                thickness: 0.5,
                color: rgb(0.9, 0.9, 0.9)
            });
        }

        // Horizontal lines
        for (let y = offsetY; y < height - 100; y += gridSize) {
            page.drawLine({
                start: { x: offsetX, y },
                end: { x: width - 50, y },
                thickness: 0.5,
                color: rgb(0.9, 0.9, 0.9)
            });
        }
    }

    addLegendToPDF(page, width, height) {
        const legendX = width - 200;
        const legendY = height - 100;

        page.drawText('Legend:', {
            x: legendX,
            y: legendY,
            size: 14,
            color: rgb(0, 0, 0)
        });

        const legendItems = [
            { color: rgb(0, 0, 0), text: 'Walls', y: legendY - 20 },
            { color: rgb(0, 0, 1), text: 'Forbidden Zones', y: legendY - 35 },
            { color: rgb(1, 0, 0), text: 'Entrances/Exits', y: legendY - 50 },
            { color: rgb(0, 0.8, 0), text: 'Îlots', y: legendY - 65 },
            { color: rgb(1, 1, 0.6), text: 'Corridors', y: legendY - 80 }
        ];

        legendItems.forEach(item => {
            page.drawRectangle({
                x: legendX,
                y: item.y - 2,
                width: 15,
                height: 10,
                color: item.color
            });

            page.drawText(item.text, {
                x: legendX + 20,
                y: item.y,
                size: 10,
                color: rgb(0, 0, 0)
            });
        });
    }

    addStatisticsToPDF(page, floorPlan, ilots, corridors, width, height) {
        const statsX = 50;
        const statsY = 80;

        const totalRooms = floorPlan.rooms ? floorPlan.rooms.length : 0;
        const totalIlots = ilots ? ilots.length : 0;
        const totalCorridors = corridors ? corridors.length : 0;
        const totalArea = floorPlan.totalArea || 0;
        const ilotArea = ilots ? ilots.reduce((sum, ilot) => sum + ilot.area, 0) : 0;
        const corridorArea = corridors ? corridors.reduce((sum, corridor) => sum + corridor.area, 0) : 0;

        const stats = [
            `Total Rooms: ${totalRooms}`,
            `Total Îlots: ${totalIlots}`,
            `Total Corridors: ${totalCorridors}`,
            `Floor Area: ${totalArea.toFixed(1)} m²`,
            `Îlot Area: ${ilotArea.toFixed(1)} m²`,
            `Corridor Area: ${corridorArea.toFixed(1)} m²`,
            `Space Efficiency: ${((ilotArea / totalArea) * 100).toFixed(1)}%`
        ];

        stats.forEach((stat, index) => {
            page.drawText(stat, {
                x: statsX,
                y: statsY - (index * 12),
                size: 10,
                color: rgb(0, 0, 0)
            });
        });
    }

    getIlotColor(type) {
        const colors = {
            'Individual': rgb(0.6, 0.8, 0.6),
            'Small Team': rgb(0.4, 0.7, 0.4),
            'Team': rgb(0.2, 0.6, 0.2),
            'Large Team': rgb(0.1, 0.5, 0.1),
            'Work': rgb(0.4, 0.7, 0.4),
            'Meeting': rgb(0.4, 0.4, 0.8),
            'Social': rgb(0.8, 0.4, 0.8),
            'Break': rgb(0.8, 0.6, 0.2)
        };

        return colors[type] || rgb(0.5, 0.5, 0.5);
    }

    async exportToImage(floorPlan, ilots, corridors, options = {}) {
        // Image export temporarily disabled for Windows compatibility
        // Will use SVG export instead
        return this.exportToSVG(floorPlan, ilots, corridors, options);
    }

    async exportToSVG(floorPlan, ilots, corridors, options = {}) {
        const { width = 3840, height = 2160 } = options; // 4K resolution

        // Calculate scale based on actual floor plan bounds
        const bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const planWidth = (bounds.maxX - bounds.minX) || 100;
        const planHeight = (bounds.maxY - bounds.minY) || 100;

        // Leave margins
        const margin = 50;
        const drawWidth = width - margin * 2;
        const drawHeight = height - margin * 2;
        const scale = Math.min(drawWidth / planWidth, drawHeight / planHeight);

        // Coordinate transformations (SVG Y increases downward)
        const tx = (x) => margin + (x - bounds.minX) * scale;
        const ty = (y) => margin + (bounds.maxY - y) * scale; // Flip Y axis

        let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
        svg += `<rect width="${width}" height="${height}" fill="white"/>`;

        // Draw walls
        if (floorPlan.walls) {
            floorPlan.walls.forEach(wall => {
                if (wall.start && wall.end) {
                    svg += `<line x1="${tx(wall.start.x)}" y1="${ty(wall.start.y)}" x2="${tx(wall.end.x)}" y2="${ty(wall.end.y)}" stroke="black" stroke-width="2"/>`;
                }
            });
        }

        // Draw forbidden zones
        if (floorPlan.forbiddenZones) {
            floorPlan.forbiddenZones.forEach(zone => {
                if (zone.start && zone.end) {
                    svg += `<line x1="${tx(zone.start.x)}" y1="${ty(zone.start.y)}" x2="${tx(zone.end.x)}" y2="${ty(zone.end.y)}" stroke="blue" stroke-width="3"/>`;
                }
            });
        }

        // Draw entrances
        if (floorPlan.entrances) {
            floorPlan.entrances.forEach(entrance => {
                if (entrance.start && entrance.end) {
                    svg += `<line x1="${tx(entrance.start.x)}" y1="${ty(entrance.start.y)}" x2="${tx(entrance.end.x)}" y2="${ty(entrance.end.y)}" stroke="red" stroke-width="4"/>`;
                }
            });
        }

        // Draw îlots
        if (ilots) {
            ilots.forEach(ilot => {
                const color = this.getIlotColorHex(ilot.type);
                const x = tx(ilot.x);
                const y = ty(ilot.y + ilot.height); // Top-left in SVG coords
                const w = ilot.width * scale;
                const h = ilot.height * scale;
                svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}" stroke="black" stroke-width="1"/>`;
                svg += `<text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle" fill="white" font-size="10">${ilot.capacity || ''}</text>`;
            });
        }

        // Draw corridors
        if (corridors) {
            corridors.forEach(corridor => {
                if (corridor.x !== undefined && corridor.width !== undefined) {
                    const x = tx(corridor.x);
                    const y = ty(corridor.y + corridor.height);
                    const w = corridor.width * scale;
                    const h = corridor.height * scale;
                    svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(255,255,153,0.8)" stroke="#cc9900" stroke-width="1"/>`;
                }
            });
        }

        svg += '</svg>';
        return Buffer.from(svg, 'utf8');
    }

    /**
     * COSTO V1: Export to Interactive SVG with hover tooltips and click handlers
     */
    async exportToInteractiveSVG(floorPlan, ilots, corridors, options = {}) {
        const { width = 3840, height = 2160, showLabels = true, showTooltips = true } = options; // 4K
        const bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const planWidth = bounds.maxX - bounds.minX || 100;
        const planHeight = bounds.maxY - bounds.minY || 100;

        const scale = Math.min((width - 100) / planWidth, (height - 150) / planHeight);
        const offsetX = 50;
        const offsetY = 50;

        let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
<style>
    .ilot { cursor: pointer; transition: all 0.2s ease; }
    .ilot:hover { filter: brightness(1.2); stroke-width: 3; }
    .wall { stroke: #333; stroke-width: 2; }
    .forbidden { fill: rgba(255,0,0,0.2); stroke: #ff0000; stroke-width: 1; stroke-dasharray: 5,3; }
    .entrance { stroke: #00cc00; stroke-width: 4; }
    .corridor { fill: rgba(255,255,153,0.6); stroke: #cc9900; stroke-width: 1; }
    .label { font-family: Arial, sans-serif; font-size: 10px; fill: #333; pointer-events: none; }
    .title { font-family: Arial, sans-serif; font-size: 16px; font-weight: bold; fill: #333; }
    .stats { font-family: monospace; font-size: 11px; fill: #666; }
    .tooltip { font-family: Arial, sans-serif; font-size: 12px; fill: white; }
    .tooltip-bg { fill: rgba(0,0,0,0.8); rx: 4; }
</style>
<defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="2" dy="2" stdDeviation="2" flood-opacity="0.3"/>
    </filter>
</defs>

<!-- Background -->
<rect width="${width}" height="${height}" fill="#f8f9fa"/>
<rect x="40" y="40" width="${width - 80}" height="${height - 120}" fill="white" stroke="#ddd" filter="url(#shadow)"/>

<!-- Title -->
<text x="${width / 2}" y="25" text-anchor="middle" class="title">Floor Plan - COSTO V1 Export</text>
`;

        // Draw walls
        if (Array.isArray(floorPlan.walls)) {
            svg += `<!-- Walls -->\n<g id="walls">`;
            floorPlan.walls.forEach((wall, idx) => {
                if (wall.start && wall.end) {
                    svg += `<line class="wall" x1="${offsetX + (wall.start.x - bounds.minX) * scale}" y1="${offsetY + (wall.start.y - bounds.minY) * scale}" x2="${offsetX + (wall.end.x - bounds.minX) * scale}" y2="${offsetY + (wall.end.y - bounds.minY) * scale}" data-id="wall-${idx}"/>`;
                }
            });
            svg += `</g>\n`;
        }

        // Draw forbidden zones
        if (Array.isArray(floorPlan.forbiddenZones)) {
            svg += `<!-- Forbidden Zones -->\n<g id="forbidden-zones">`;
            floorPlan.forbiddenZones.forEach((zone, idx) => {
                if (zone.polygon) {
                    const points = zone.polygon.map(p => `${offsetX + (p.x - bounds.minX) * scale},${offsetY + (p.y - bounds.minY) * scale}`).join(' ');
                    svg += `<polygon class="forbidden" points="${points}" data-id="forbidden-${idx}"><title>Forbidden Zone ${idx + 1}</title></polygon>`;
                } else if (zone.start && zone.end) {
                    svg += `<line class="forbidden" x1="${offsetX + (zone.start.x - bounds.minX) * scale}" y1="${offsetY + (zone.start.y - bounds.minY) * scale}" x2="${offsetX + (zone.end.x - bounds.minX) * scale}" y2="${offsetY + (zone.end.y - bounds.minY) * scale}" data-id="forbidden-${idx}"/>`;
                }
            });
            svg += `</g>\n`;
        }

        // Draw corridors
        if (Array.isArray(corridors)) {
            svg += `<!-- Corridors -->\n<g id="corridors">`;
            corridors.forEach((corridor, idx) => {
                svg += `<rect class="corridor" x="${offsetX + (corridor.x - bounds.minX) * scale}" y="${offsetY + (corridor.y - bounds.minY) * scale}" width="${corridor.width * scale}" height="${corridor.height * scale}" data-id="corridor-${idx}"><title>Corridor ${idx + 1}: ${(corridor.width * corridor.height).toFixed(1)} m²</title></rect>`;
            });
            svg += `</g>\n`;
        }

        // Draw ilots with interactivity
        if (Array.isArray(ilots)) {
            svg += `<!-- Ilots -->\n<g id="ilots">`;
            ilots.forEach((ilot, idx) => {
                const color = this.getIlotColorHex(ilot.sizeCategory || ilot.type);
                const x = offsetX + ((ilot.x || 0) - bounds.minX) * scale;
                const y = offsetY + ((ilot.y || 0) - bounds.minY) * scale;
                const w = (ilot.width || 3) * scale;
                const h = (ilot.height || 2.5) * scale;
                const area = (ilot.area || ilot.width * ilot.height).toFixed(2);
                const category = ilot.sizeCategory || ilot.label || 'Unit';

                svg += `<g class="ilot" data-id="${ilot.id || `ilot-${idx}`}" data-area="${area}" data-category="${category}" onclick="alert('Ilot: ${ilot.id || idx}\\nArea: ${area} m²\\nCategory: ${category}')">`;
                svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}" stroke="#333" rx="2"/>`;
                if (showLabels) {
                    svg += `<text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle" class="tooltip" font-size="10">${category}</text>`;
                }
                if (showTooltips) {
                    svg += `<title>${category} Unit\\nArea: ${area} m²\\nCapacity: ${ilot.capacity || 'N/A'}</title>`;
                }
                svg += `</g>`;
            });
            svg += `</g>\n`;
        }

        // Draw entrances
        if (Array.isArray(floorPlan.entrances)) {
            svg += `<!-- Entrances -->\n<g id="entrances">`;
            floorPlan.entrances.forEach((entrance, idx) => {
                if (entrance.start && entrance.end) {
                    svg += `<line class="entrance" x1="${offsetX + (entrance.start.x - bounds.minX) * scale}" y1="${offsetY + (entrance.start.y - bounds.minY) * scale}" x2="${offsetX + (entrance.end.x - bounds.minX) * scale}" y2="${offsetY + (entrance.end.y - bounds.minY) * scale}" data-id="entrance-${idx}"><title>Entrance/Exit ${idx + 1}</title></line>`;
                }
            });
            svg += `</g>\n`;
        }

        // Statistics bar
        const totalIlots = ilots?.length || 0;
        const totalArea = ilots?.reduce((sum, i) => sum + (i.area || 0), 0).toFixed(1) || 0;
        const totalCorridors = corridors?.length || 0;

        svg += `
<!-- Statistics Bar -->
<rect x="40" y="${height - 60}" width="${width - 80}" height="50" fill="#333" rx="4"/>
<text x="60" y="${height - 30}" class="stats" fill="white">Ilots: ${totalIlots} | Total Area: ${totalArea} m² | Corridors: ${totalCorridors} | Walls: ${floorPlan.walls?.length || 0}</text>
`;

        svg += `</svg>`;
        return Buffer.from(svg, 'utf8');
    }

    /**
     * COSTO V1: Export to Annotated DXF format
     * Includes ilots, corridors, and semantic annotations as DXF entities
     */
    async exportToAnnotatedDXF(floorPlan, ilots, corridors, options = {}) {
        const { includeOriginal = true, annotationLayerPrefix = 'COSTO_' } = options;
        const bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };

        let dxf = `0
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
0
SECTION
2
TABLES
0
TABLE
2
LAYER
70
10
`;

        // Define layers
        const layers = [
            { name: `${annotationLayerPrefix}WALLS`, color: 7 },
            { name: `${annotationLayerPrefix}ILOTS_S`, color: 3 },
            { name: `${annotationLayerPrefix}ILOTS_M`, color: 4 },
            { name: `${annotationLayerPrefix}ILOTS_L`, color: 5 },
            { name: `${annotationLayerPrefix}ILOTS_XL`, color: 6 },
            { name: `${annotationLayerPrefix}CORRIDORS`, color: 2 },
            { name: `${annotationLayerPrefix}FORBIDDEN`, color: 1 },
            { name: `${annotationLayerPrefix}ENTRANCES`, color: 3 },
            { name: `${annotationLayerPrefix}ANNOTATIONS`, color: 7 }
        ];

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
        });

        dxf += `0
ENDTAB
0
ENDSEC
0
SECTION
2
ENTITIES
`;

        // Export original walls if requested
        if (includeOriginal && Array.isArray(floorPlan.walls)) {
            floorPlan.walls.forEach(wall => {
                if (wall.start && wall.end) {
                    dxf += `0
LINE
8
${annotationLayerPrefix}WALLS
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

        // Export forbidden zones
        if (Array.isArray(floorPlan.forbiddenZones)) {
            floorPlan.forbiddenZones.forEach(zone => {
                if (zone.start && zone.end) {
                    dxf += `0
LINE
8
${annotationLayerPrefix}FORBIDDEN
62
1
10
${zone.start.x.toFixed(4)}
20
${zone.start.y.toFixed(4)}
11
${zone.end.x.toFixed(4)}
21
${zone.end.y.toFixed(4)}
`;
                }
            });
        }

        // Export entrances
        if (Array.isArray(floorPlan.entrances)) {
            floorPlan.entrances.forEach(entrance => {
                if (entrance.start && entrance.end) {
                    dxf += `0
LINE
8
${annotationLayerPrefix}ENTRANCES
62
3
10
${entrance.start.x.toFixed(4)}
20
${entrance.start.y.toFixed(4)}
11
${entrance.end.x.toFixed(4)}
21
${entrance.end.y.toFixed(4)}
`;
                }
            });
        }

        // Export ilots as rectangles (LWPOLYLINE)
        if (Array.isArray(ilots)) {
            ilots.forEach((ilot, idx) => {
                const x = ilot.x || 0;
                const y = ilot.y || 0;
                const w = ilot.width || 3;
                const h = ilot.height || 2.5;
                const category = ilot.sizeCategory || 'M';
                const layerName = `${annotationLayerPrefix}ILOTS_${category}`;

                // Draw rectangle as closed polyline
                dxf += `0
LWPOLYLINE
8
${layerName}
90
4
70
1
10
${x.toFixed(4)}
20
${y.toFixed(4)}
10
${(x + w).toFixed(4)}
20
${y.toFixed(4)}
10
${(x + w).toFixed(4)}
20
${(y + h).toFixed(4)}
10
${x.toFixed(4)}
20
${(y + h).toFixed(4)}
`;

                // Add text annotation for ilot ID
                const textX = x + w / 2;
                const textY = y + h / 2;
                dxf += `0
TEXT
8
${annotationLayerPrefix}ANNOTATIONS
10
${textX.toFixed(4)}
20
${textY.toFixed(4)}
40
0.3
1
${ilot.id || `U${idx + 1}`}
`;
            });
        }

        // Export corridors
        if (Array.isArray(corridors)) {
            corridors.forEach((corridor, idx) => {
                const x = corridor.x || 0;
                const y = corridor.y || 0;
                const w = corridor.width || 1.2;
                const h = corridor.height || 1;

                dxf += `0
LWPOLYLINE
8
${annotationLayerPrefix}CORRIDORS
90
4
70
1
10
${x.toFixed(4)}
20
${y.toFixed(4)}
10
${(x + w).toFixed(4)}
20
${y.toFixed(4)}
10
${(x + w).toFixed(4)}
20
${(y + h).toFixed(4)}
10
${x.toFixed(4)}
20
${(y + h).toFixed(4)}
`;
            });
        }

        dxf += `0
ENDSEC
0
EOF
`;

        return Buffer.from(dxf, 'utf8');
    }

    drawFloorPlanToCanvas(floorPlan, ilots, corridors, options) {
        const { width, height } = options;
        const scale = Math.min(width / 600, height / 500);
        const offsetX = 50;
        const offsetY = 50;

        // Draw walls
        if (floorPlan.walls) {
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 2;

            floorPlan.walls.forEach(wall => {
                this.ctx.beginPath();
                this.ctx.moveTo(offsetX + wall.start.x * scale, offsetY + wall.start.y * scale);
                this.ctx.lineTo(offsetX + wall.end.x * scale, offsetY + wall.end.y * scale);
                this.ctx.stroke();
            });
        }

        // Draw forbidden zones
        if (floorPlan.forbiddenZones) {
            this.ctx.strokeStyle = '#0000ff';
            this.ctx.lineWidth = 3;

            floorPlan.forbiddenZones.forEach(zone => {
                this.ctx.beginPath();
                this.ctx.moveTo(offsetX + zone.start.x * scale, offsetY + zone.start.y * scale);
                this.ctx.lineTo(offsetX + zone.end.x * scale, offsetY + zone.end.y * scale);
                this.ctx.stroke();
            });
        }

        // Draw entrances
        if (floorPlan.entrances) {
            this.ctx.strokeStyle = '#ff0000';
            this.ctx.lineWidth = 4;

            floorPlan.entrances.forEach(entrance => {
                this.ctx.beginPath();
                this.ctx.moveTo(offsetX + entrance.start.x * scale, offsetY + entrance.start.y * scale);
                this.ctx.lineTo(offsetX + entrance.end.x * scale, offsetY + entrance.end.y * scale);
                this.ctx.stroke();
            });
        }

        // Draw îlots
        if (ilots) {
            ilots.forEach(ilot => {
                const color = this.getIlotColorHex(ilot.type);
                this.ctx.fillStyle = color;
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = 1;

                this.ctx.fillRect(
                    offsetX + ilot.x * scale,
                    offsetY + ilot.y * scale,
                    ilot.width * scale,
                    ilot.height * scale
                );

                this.ctx.strokeRect(
                    offsetX + ilot.x * scale,
                    offsetY + ilot.y * scale,
                    ilot.width * scale,
                    ilot.height * scale
                );

                // Add capacity label if present
                const cap = ilot && (typeof ilot.capacity !== 'undefined' ? ilot.capacity : null);
                if (cap !== null && cap !== undefined) {
                    try {
                        this.ctx.fillStyle = '#ffffff';
                        this.ctx.font = '12px Arial';
                        this.ctx.textAlign = 'center';
                        this.ctx.fillText(
                            String(cap),
                            offsetX + (ilot.x + ilot.width / 2) * scale,
                            offsetY + (ilot.y + ilot.height / 2) * scale + 4
                        );
                    } catch (e) {
                        // ignore canvas text errors
                    }
                }
            });
        }

        // Draw corridors
        if (corridors) {
            corridors.forEach(corridor => {
                this.ctx.fillStyle = 'rgba(255, 255, 153, 0.8)';
                this.ctx.strokeStyle = '#cc9900';
                this.ctx.lineWidth = 1;

                this.ctx.fillRect(
                    offsetX + corridor.x * scale,
                    offsetY + corridor.y * scale,
                    corridor.width * scale,
                    corridor.height * scale
                );

                this.ctx.strokeRect(
                    offsetX + corridor.x * scale,
                    offsetY + corridor.y * scale,
                    corridor.width * scale,
                    corridor.height * scale
                );
            });
        }
    }

    getIlotColorHex(type) {
        const colors = {
            'Individual': '#99cc99',
            'Small Team': '#66b366',
            'Team': '#339933',
            'Large Team': '#1a7a1a',
            'Work': '#66b366',
            'Meeting': '#6666cc',
            'Social': '#cc66cc',
            'Break': '#cc9933'
        };

        return colors[type] || '#808080';
    }

    async saveToFile(data, filename, format = 'pdf') {
        const filepath = `exports/${filename}.${format}`;

        // Ensure exports directory exists
        if (!fs.existsSync('exports')) {
            fs.mkdirSync('exports');
        }

        fs.writeFileSync(filepath, data);
        return filepath;
    }
}

module.exports = ExportManager;