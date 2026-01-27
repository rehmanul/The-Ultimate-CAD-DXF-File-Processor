const DxfParser = require('dxf-parser');
const cadEntityClassifier = require('./cadEntityClassifier');
const { normalizeLayerName } = require('./layerNormalization');

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
            const layer = normalizeLayerName(entity.layer);
            // Use proper color mapping: DXF colors are indexed, convert to RGB
            let color = entity.color || entity.colorIndex || 0;

            // Convert DXF color index to RGB if it's an index
            if (typeof color === 'number' && color >= 0 && color <= 255) {
                // DXF color index to RGB mapping - prioritize layer-based assignment
                const dxfColors = {
                    0: 0x000000, // Black (default)
                    1: 0xFF0000, // Red (entrances)
                    2: 0xFFFF00, // Yellow
                    3: 0x00FF00, // Green
                    4: 0x00FFFF, // Cyan
                    5: 0x0000FF, // Blue (forbidden zones)
                    6: 0xFF00FF, // Magenta
                    7: 0xFFFFFF, // White
                    // Handle RGB values that come through as numbers
                    16711680: 0xFF0000, // Red (already RGB)
                    255: 0x0000FF      // Blue (already RGB)
                };

                // Always assign based on layer first, regardless of color index
                if (layer === 'ENTREE_SORTIE' || layer === 'DOORS') {
                    color = 0xFF0000; // Red for entrances
                } else if (layer === 'NO_ENTREE' || layer === 'STAIRS' || layer === 'CABINETRY' ||
                    layer === 'LIGHTING' || layer === 'POWER' || layer === 'APPLIANCES') {
                    color = 0x0000FF; // Blue for forbidden zones
                } else if (layer === 'MUR' || layer === 'WALLS') {
                    color = 0x000000; // Black for walls
                } else {
                    // Use color index mapping only if layer doesn't match known patterns
                    color = dxfColors[color] || 0x000000;
                }
            }

            // Track layer statistics
            if (!layerStats[layer]) layerStats[layer] = { count: 0, colors: new Set() };
            layerStats[layer].count++;
            layerStats[layer].colors.add(color);

            if (entity.type === 'LINE') {
                const start = entity.vertices ? entity.vertices[0] : entity.start;
                const end = entity.vertices ? entity.vertices[1] : entity.end;

                if (!start || !end) continue;

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

                // Classify using deterministic rules
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
                if (vertices.length < 2) continue;

                const polygon = vertices.map(v => [v.x, v.y]);
                vertices.forEach(v => updateBounds(v.x, v.y));

                // Check if this is a closed polyline with 4+ vertices (potential room/storage unit)
                const isClosed = entity.shape === true || entity.closed === true;
                const isRoomCandidate = isClosed && vertices.length >= 4;

                // Enhanced classification using CAD entity classifier
                const entityData = {
                    layer: layer,
                    color: color,
                    polygon: polygon
                };

                const classification = cadEntityClassifier.classifyEntity(entityData);

                // Classify using deterministic rules
                if (classification.type === 'entrance') {
                    const segments = [];
                    for (let i = 0; i < vertices.length - 1; i++) {
                        const start = vertices[i];
                        const end = vertices[i + 1];
                        if (!start || !end) continue;
                        segments.push({
                            start: { x: start.x, y: start.y },
                            end: { x: end.x, y: end.y },
                            layer,
                            color
                        });
                    }
                    if (isClosed && vertices.length > 2) {
                        const start = vertices[vertices.length - 1];
                        const end = vertices[0];
                        segments.push({
                            start: { x: start.x, y: start.y },
                            end: { x: end.x, y: end.y },
                            layer,
                            color
                        });
                    }
                    if (segments.length) {
                        let best = segments[0];
                        let bestLen = 0;
                        segments.forEach((seg) => {
                            const dx = seg.end.x - seg.start.x;
                            const dy = seg.end.y - seg.start.y;
                            const len = Math.hypot(dx, dy);
                            if (len > bestLen) {
                                bestLen = len;
                                best = seg;
                            }
                        });
                        entrances.push(best);
                    } else if (vertices.length >= 2) {
                        entrances.push({
                            start: { x: vertices[0].x, y: vertices[0].y },
                            end: { x: vertices[1].x, y: vertices[1].y },
                            layer,
                            color
                        });
                    }
                } else if (classification.type === 'forbidden') {
                    forbiddenZones.push({ polygon, layer, color });
                } else if (isRoomCandidate) {
                    // Closed polylines with 4+ vertices are storage units/rooms
                    const bounds = this.getPolygonBounds(vertices);
                    const area = this.calculatePolygonArea(vertices);

                    // Filter out tiny artifacts (< 0.25 m²) and very large boundaries (> 100 m²)
                    if (area > 0.25 && area < 100) {
                        rooms.push({
                            id: `room_${rooms.length + 1}`,
                            name: `Room ${rooms.length + 1}`,
                            polygon: polygon,
                            bounds: bounds,
                            area: area,
                            type: area < 5 ? 'storage' : area < 20 ? 'office' : 'hall',
                            layer: layer,
                            center: {
                                x: (bounds.minX + bounds.maxX) / 2,
                                y: (bounds.minY + bounds.maxY) / 2
                            }
                        });
                    } else {
                        // Add as wall if too small or too large
                        walls.push({ polygon, layer, color });
                    }
                } else {
                    walls.push({ polygon, layer, color });
                }
            }
        }

        if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY) ||
            !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.maxY)) {
            bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }

        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;

        // Log layer statistics
        console.log('[DXF Processor] Layer statistics:');
        Object.entries(layerStats).forEach(([layer, stats]) => {
            console.log(`  ${layer}: ${stats.count} entities, colors: ${Array.from(stats.colors).join(', ')}`);
        });
        console.log(`[DXF Processor] Results: ${walls.length} walls, ${entrances.length} entrances, ${forbiddenZones.length} forbidden zones, ${rooms.length} rooms`);

        const inferredData = this.applyIntelligentDetection();

        return {
            walls,
            forbiddenZones,
            entrances,
            rooms,
            bounds: {
                minX: bounds.minX,
                minY: bounds.minY,
                maxX: bounds.maxX,
                maxY: bounds.maxY,
                width,
                height,
                area: width * height
            },
            inferredData // Include inference metadata
        };
    }

    /**
     * Apply ML-powered intelligent detection for missing elements
     */
    applyIntelligentDetection() {
        return {
            hasInferences: false,
            inferredEntrances: 0,
            inferredForbiddenZones: 0,
            confidence: {}
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
