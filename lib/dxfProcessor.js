const DxfParser = require('dxf-parser');
const cadEntityClassifier = require('./cadEntityClassifier');

class DXFProcessor {
    processParsedDXF(dxf) {
        const walls = [];
        const forbiddenZones = [];
        const entrances = [];
        const rooms = [];
        let bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        const layerStats = {};

        const updateBounds = (x, y) => {
            if (!isFinite(x) || !isFinite(y)) return;
            bounds.minX = Math.min(bounds.minX, x);
            bounds.maxX = Math.max(bounds.maxX, x);
            bounds.minY = Math.min(bounds.minY, y);
            bounds.maxY = Math.max(bounds.maxY, y);
        };

        const entities = dxf.entities || [];
        console.log(`[DXF Processor] Processing ${entities.length} entities`);

        for (const entity of entities) {
            const layer = (entity.layer || '').toUpperCase();
            // Use proper color mapping: DXF colors are indexed, convert to RGB
            let color = entity.color || entity.colorIndex || 0;

            // Convert DXF color index to RGB if it's an index
            if (typeof color === 'number' && color >= 0 && color <= 255) {
                // DXF color index to RGB mapping - use layer-based defaults if color is 0
                const dxfColors = {
                    0: 0x000000, // Black (default)
                    1: 0xFF0000, // Red (entrances)
                    2: 0xFFFF00, // Yellow
                    3: 0x00FF00, // Green
                    4: 0x00FFFF, // Cyan
                    5: 0x0000FF, // Blue (forbidden zones)
                    6: 0xFF00FF, // Magenta
                    7: 0xFFFFFF, // White
                    // Add more standard DXF colors as needed
                    16711680: 0xFF0000, // Red (already RGB)
                    255: 0x0000FF      // Blue (already RGB)
                };

                // If color is 0 (default), assign based on layer
                if (color === 0) {
                    if (layer === 'ENTREE__SORTIE' || layer === 'DOORS') {
                        color = 0xFF0000; // Red for entrances
                    } else if (layer === 'NO_ENTREE' || layer === 'STAIRS' || layer === 'CABINETRY' ||
                        layer === 'LIGHTING' || layer === 'POWER' || layer === 'APPLIANCES') {
                        color = 0x0000FF; // Blue for forbidden zones
                    } else if (layer === 'MUR' || layer === 'WALLS') {
                        color = 0x000000; // Black for walls
                    } else {
                        color = dxfColors[color] || 0x000000;
                    }
                } else {
                    color = dxfColors[color] || color;
                }
            }

            // Track layer statistics
            if (!layerStats[layer]) layerStats[layer] = { count: 0, colors: new Set() };
            layerStats[layer].count++;
            layerStats[layer].colors.add(color);

            if (entity.type === 'LINE') {
                const start = entity.vertices ? entity.vertices[0] : entity.start;
                const end = entity.vertices ? entity.vertices[1] : entity.end;

                if (!start || !end) return;

                updateBounds(start.x, start.y);
                updateBounds(end.x, end.y);

                const line = {
                    start: { x: start.x, y: start.y },
                    end: { x: end.x, y: end.y },
                    layer,
                    color
                };

                // Enhanced classification using CAD entity classifier
                const entityData = {
                    layer: layer,
                    color: color,
                    start: start,
                    end: end
                };

                const classification = cadEntityClassifier.classifyEntity(entityData);

                // Classify based on ML result or fallback rules
                if (classification.type === 'entrance') {
                    entrances.push(line);
                } else if (classification.type === 'forbidden') {
                    forbiddenZones.push(line);
                } else {
                    walls.push(line);
                }
            }

            if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
                const vertices = entity.vertices || [];
                if (vertices.length < 2) return;

                const polygon = vertices.map(v => [v.x, v.y]);
                vertices.forEach(v => updateBounds(v.x, v.y));

                // Enhanced classification using CAD entity classifier
                const entityData = {
                    layer: layer,
                    color: color,
                    polygon: polygon
                };

                const classification = cadEntityClassifier.classifyEntity(entityData);

                // Classify based on ML result or fallback rules
                if (classification.type === 'entrance') {
                    entrances.push({ polygon, layer, color });
                } else if (classification.type === 'forbidden') {
                    forbiddenZones.push({ polygon, layer, color });
                } else {
                    walls.push({ polygon, layer, color });
                }
            }
        }

        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;

        // Log layer statistics
        console.log('[DXF Processor] Layer statistics:');
        Object.entries(layerStats).forEach(([layer, stats]) => {
            console.log(`  ${layer}: ${stats.count} entities, colors: ${Array.from(stats.colors).join(', ')}`);
        });
        console.log(`[DXF Processor] Results: ${walls.length} walls, ${entrances.length} entrances, ${forbiddenZones.length} forbidden zones`);

        return {
            walls,
            forbiddenZones,
            entrances,
            rooms,
            bounds: {
                minX: 0,
                minY: 0,
                maxX: width,
                maxY: height,
                width,
                height,
                area: width * height
            }
        };
    }

    // Helper methods for polygon calculations
    getPolygonBounds(vertices) {
        if (!vertices || vertices.length === 0) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        vertices.forEach(v => {
            minX = Math.min(minX, v.x);
            minY = Math.min(minY, v.y);
            maxX = Math.max(maxX, v.x);
            maxY = Math.max(maxY, v.y);
        });

        return { minX, minY, maxX, maxY };
    }

    calculatePolygonArea(vertices) {
        if (!vertices || vertices.length < 3) return 0;

        let area = 0;
        for (let i = 0; i < vertices.length; i++) {
            const j = (i + 1) % vertices.length;
            area += vertices[i].x * vertices[j].y;
            area -= vertices[j].x * vertices[i].y;
        }

        return Math.abs(area / 2);
    }

    calculatePolygonPerimeter(vertices) {
        if (!vertices || vertices.length < 2) return 0;

        let perimeter = 0;
        for (let i = 0; i < vertices.length; i++) {
            const j = (i + 1) % vertices.length;
            perimeter += Math.hypot(vertices[j].x - vertices[i].x, vertices[j].y - vertices[i].y);
        }

        return perimeter;
    }
}

module.exports = new DXFProcessor();
