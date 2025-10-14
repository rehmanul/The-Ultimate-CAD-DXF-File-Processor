const DxfParser = require('dxf-parser');

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
        
        entities.forEach(entity => {
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
                    if (layer === 'ENTREE__SORTIE') {
                        color = 0xFF0000; // Red for entrances
                    } else if (layer === 'NO_ENTREE') {
                        color = 0x0000FF; // Blue for forbidden zones
                    } else if (layer === 'MUR') {
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

                // Classify based on layer
                if (layer === 'MUR') {
                    walls.push(line);
                } else if (layer === 'ENTREE__SORTIE') {
                    entrances.push(line);
                } else if (layer === 'NO_ENTREE') {
                    forbiddenZones.push(line);
                } else {
                    // Default to walls for unknown layers
                    walls.push(line);
                }
            }
            
            if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
                const vertices = entity.vertices || [];
                if (vertices.length < 2) return;

                const polygon = vertices.map(v => [v.x, v.y]);
                vertices.forEach(v => updateBounds(v.x, v.y));

                // Classify based on layer
                if (layer === 'MUR') {
                    walls.push({ polygon, layer, color });
                } else if (layer === 'ENTREE__SORTIE') {
                    entrances.push({ polygon, layer, color });
                } else if (layer === 'NO_ENTREE') {
                    forbiddenZones.push({ polygon, layer, color });
                } else {
                    // Default to walls for unknown layers
                    walls.push({ polygon, layer, color });
                }
            }
        });
        
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
}

module.exports = new DXFProcessor();
