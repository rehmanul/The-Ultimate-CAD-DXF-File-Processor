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
            width = 800,
            height = 600,
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
        const scale = Math.min(width / 600, height / 500);
        const offsetX = 50;
        const offsetY = 100;

        // Draw grid if enabled
        if (showGrid) {
            this.drawGridToPDF(page, width, height, offsetX, offsetY);
        }

        // Draw walls (black lines)
        if (floorPlan.walls) {
            floorPlan.walls.forEach(wall => {
                const sx = Number(wall.start && wall.start.x);
                const sy = Number(wall.start && wall.start.y);
                const ex = Number(wall.end && wall.end.x);
                const ey = Number(wall.end && wall.end.y);
                if (!isFinite(sx) || !isFinite(sy) || !isFinite(ex) || !isFinite(ey)) return;
                page.drawLine({
                    start: { x: offsetX + sx * scale, y: offsetY + sy * scale },
                    end: { x: offsetX + ex * scale, y: offsetY + ey * scale },
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
                    start: { x: offsetX + sx * scale, y: offsetY + sy * scale },
                    end: { x: offsetX + ex * scale, y: offsetY + ey * scale },
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
                    start: { x: offsetX + sx * scale, y: offsetY + sy * scale },
                    end: { x: offsetX + ex * scale, y: offsetY + ey * scale },
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
                        x: offsetX + ix * scale,
                        y: offsetY + iy * scale,
                        width: iwidth * scale,
                        height: iheight * scale,
                        color: color,
                        borderColor: rgb(0, 0, 0),
                        borderWidth: 1
                    });
                } catch (e) {
                    console.error('Failed to draw ilot rectangle', { ilot, ix, iy, iwidth, iheight, scale, offsetX, offsetY, err: e && e.message });
                }

                // Add capacity label if present and numeric
                const labelX = offsetX + (ix + iwidth / 2) * scale - 5;
                const labelY = offsetY + (iy + iheight / 2) * scale - 5;
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
                        x: offsetX + cx * scale,
                        y: offsetY + cy * scale,
                        width: cwidth * scale,
                        height: cheight * scale,
                        color: rgb(1, 1, 0.6),
                        borderColor: rgb(0.8, 0.6, 0),
                        borderWidth: 1
                    });
                } catch (e) {
                    console.error('Failed to draw corridor rectangle', { corridor, cx, cy, cwidth, cheight, scale, offsetX, offsetY, err: e && e.message });
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
        const { width = 1200, height = 900 } = options;

        let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
        svg += `<rect width="${width}" height="${height}" fill="white"/>`;

        const scale = Math.min(width / 600, height / 500);
        const offsetX = 50;
        const offsetY = 50;

        // Draw walls
        if (floorPlan.walls) {
            floorPlan.walls.forEach(wall => {
                svg += `<line x1="${offsetX + wall.start.x * scale}" y1="${offsetY + wall.start.y * scale}" x2="${offsetX + wall.end.x * scale}" y2="${offsetY + wall.end.y * scale}" stroke="black" stroke-width="2"/>`;
            });
        }

        // Draw forbidden zones
        if (floorPlan.forbiddenZones) {
            floorPlan.forbiddenZones.forEach(zone => {
                svg += `<line x1="${offsetX + zone.start.x * scale}" y1="${offsetY + zone.start.y * scale}" x2="${offsetX + zone.end.x * scale}" y2="${offsetY + zone.end.y * scale}" stroke="blue" stroke-width="3"/>`;
            });
        }

        // Draw entrances
        if (floorPlan.entrances) {
            floorPlan.entrances.forEach(entrance => {
                svg += `<line x1="${offsetX + entrance.start.x * scale}" y1="${offsetY + entrance.start.y * scale}" x2="${offsetX + entrance.end.x * scale}" y2="${offsetY + entrance.end.y * scale}" stroke="red" stroke-width="4"/>`;
            });
        }

        // Draw îlots
        if (ilots) {
            ilots.forEach(ilot => {
                const color = this.getIlotColorHex(ilot.type);
                svg += `<rect x="${offsetX + ilot.x * scale}" y="${offsetY + ilot.y * scale}" width="${ilot.width * scale}" height="${ilot.height * scale}" fill="${color}" stroke="black" stroke-width="1"/>`;
                svg += `<text x="${offsetX + (ilot.x + ilot.width / 2) * scale}" y="${offsetY + (ilot.y + ilot.height / 2) * scale + 4}" text-anchor="middle" fill="white" font-size="12">${ilot.capacity}</text>`;
            });
        }

        // Draw corridors
        if (corridors) {
            corridors.forEach(corridor => {
                svg += `<rect x="${offsetX + corridor.x * scale}" y="${offsetY + corridor.y * scale}" width="${corridor.width * scale}" height="${corridor.height * scale}" fill="rgba(255,255,153,0.8)" stroke="#cc9900" stroke-width="1"/>`;
            });
        }

        svg += '</svg>';
        return Buffer.from(svg, 'utf8');
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