/**
 * LayerZoneDetector - Simple layer-based zone extraction from DXF
 * 
 * Replaces complex RoomDetector with direct layer parsing:
 * - MUR layer → wall boundaries / storage zones
 * - NO_ENTREE layer → forbidden zones (stairs, columns, etc.)
 * - ENTREE__SORTIE layer → entrances
 * 
 * This is reliable because it uses the CAD designer's own layer organization.
 */

class LayerZoneDetector {
    constructor() {
        // French layer names (from analyzed DXF samples)
        this.wallLayerNames = ['MUR', 'WALLS', 'WALL', 'MURS'];
        this.forbiddenLayerNames = ['NO_ENTREE', 'NO_ENTRY', 'FORBIDDEN', 'INTERDIT', 'ESCALIER', 'STAIRS'];
        this.entranceLayerNames = ['ENTREE__SORTIE', 'ENTREE', 'ENTRANCE', 'ENTRY', 'SORTIE', 'EXIT'];
    }

    /**
     * Extract zones from DXF entities organized by layer
     * @param {Array} entities - DXF entities with layer property
     * @param {Object} bounds - Floor bounds {minX, minY, maxX, maxY}
     * @returns {Object} { zones: [], forbiddenZones: [], entrances: [] }
     */
    detectZones(entities, bounds) {
        console.log(`[LayerZoneDetector] Processing ${entities.length} entities`);

        if (!entities || entities.length === 0) {
            console.log('[LayerZoneDetector] No entities, returning bounds as zone');
            return this._createBoundsResult(bounds);
        }

        // Group entities by layer
        const byLayer = this._groupByLayer(entities);
        console.log(`[LayerZoneDetector] Found layers: ${Object.keys(byLayer).join(', ')}`);

        // Extract storage zones from wall layers
        const zones = this._extractStorageZones(byLayer, bounds);
        console.log(`[LayerZoneDetector] Extracted ${zones.length} storage zones`);

        // Extract forbidden zones
        const forbiddenZones = this._extractForbiddenZones(byLayer);
        console.log(`[LayerZoneDetector] Extracted ${forbiddenZones.length} forbidden zones`);

        // Extract entrances
        const entrances = this._extractEntrances(byLayer);
        console.log(`[LayerZoneDetector] Extracted ${entrances.length} entrances`);

        // If no zones found, use bounds
        if (zones.length === 0) {
            console.log('[LayerZoneDetector] No zones from layers, using bounds');
            return {
                zones: [this._boundsToZone(bounds, 'bounds_zone')],
                forbiddenZones,
                entrances
            };
        }

        return { zones, forbiddenZones, entrances };
    }

    _groupByLayer(entities) {
        const byLayer = {};
        entities.forEach(entity => {
            const layer = (entity.layer || '0').toUpperCase();
            if (!byLayer[layer]) byLayer[layer] = [];
            byLayer[layer].push(entity);
        });
        return byLayer;
    }

    _extractStorageZones(byLayer, bounds) {
        const zones = [];

        // Look for wall layer
        let wallLayer = null;
        for (const name of this.wallLayerNames) {
            if (byLayer[name]) {
                wallLayer = byLayer[name];
                console.log(`[LayerZoneDetector] Found wall layer: ${name}`);
                break;
            }
        }

        if (!wallLayer) {
            console.log('[LayerZoneDetector] No wall layer found');
            return zones;
        }

        // Find closed polylines - these define room boundaries
        const closedPolys = wallLayer.filter(e =>
            (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') &&
            e.shape === true &&
            e.vertices &&
            e.vertices.length >= 3
        );

        console.log(`[LayerZoneDetector] Found ${closedPolys.length} closed polylines on wall layer`);

        // Calculate areas and sort by size (largest first)
        const polysWithArea = closedPolys.map(poly => {
            const vertices = poly.vertices.map(v => [v.x, v.y]);
            const area = this._calculateArea(vertices);
            const polyBounds = this._calculateBounds(vertices);
            return { poly, vertices, area, bounds: polyBounds };
        }).filter(p => p.area >= 10); // Minimum 10m² for storage zone

        polysWithArea.sort((a, b) => b.area - a.area);

        // Create zones from largest closed polylines
        polysWithArea.forEach((p, idx) => {
            zones.push({
                id: `layer_zone_${idx}`,
                name: `Storage Zone ${idx + 1}`,
                area: p.area,
                bounds: p.bounds,
                polygon: p.vertices,
                type: idx === 0 ? 'primary' : 'secondary'
            });
        });

        // If no closed polylines, try to find outer boundary from lines
        if (zones.length === 0 && bounds) {
            console.log('[LayerZoneDetector] No closed polylines, deriving from bounds');
            zones.push(this._boundsToZone(bounds, 'derived_zone'));
        }

        return zones;
    }

    _extractForbiddenZones(byLayer) {
        const forbidden = [];

        for (const name of this.forbiddenLayerNames) {
            const layer = byLayer[name];
            if (!layer) continue;

            console.log(`[LayerZoneDetector] Processing forbidden layer: ${name}`);

            layer.forEach((entity, idx) => {
                if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
                    if (entity.vertices && entity.vertices.length >= 3) {
                        const vertices = entity.vertices.map(v => [v.x, v.y]);
                        const bounds = this._calculateBounds(vertices);
                        forbidden.push({
                            id: `forbidden_${name}_${idx}`,
                            x: bounds.minX,
                            y: bounds.minY,
                            width: bounds.maxX - bounds.minX,
                            height: bounds.maxY - bounds.minY,
                            polygon: vertices,
                            layer: name
                        });
                    }
                } else if (entity.type === 'CIRCLE') {
                    // Approximate circle as square
                    const r = entity.radius || 1;
                    const cx = entity.center?.x || 0;
                    const cy = entity.center?.y || 0;
                    forbidden.push({
                        id: `forbidden_${name}_${idx}`,
                        x: cx - r,
                        y: cy - r,
                        width: r * 2,
                        height: r * 2,
                        layer: name
                    });
                }
            });
        }

        return forbidden;
    }

    _extractEntrances(byLayer) {
        const entrances = [];

        for (const name of this.entranceLayerNames) {
            const layer = byLayer[name];
            if (!layer) continue;

            console.log(`[LayerZoneDetector] Processing entrance layer: ${name}`);

            layer.forEach((entity, idx) => {
                if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
                    if (entity.vertices && entity.vertices.length >= 2) {
                        const vertices = entity.vertices.map(v => ({ x: v.x, y: v.y }));
                        const center = {
                            x: vertices.reduce((s, v) => s + v.x, 0) / vertices.length,
                            y: vertices.reduce((s, v) => s + v.y, 0) / vertices.length
                        };
                        entrances.push({
                            id: `entrance_${idx}`,
                            start: vertices[0],
                            end: vertices[vertices.length - 1],
                            center,
                            layer: name
                        });
                    }
                } else if (entity.type === 'LINE') {
                    entrances.push({
                        id: `entrance_${idx}`,
                        start: { x: entity.start?.x || 0, y: entity.start?.y || 0 },
                        end: { x: entity.end?.x || 0, y: entity.end?.y || 0 },
                        center: {
                            x: ((entity.start?.x || 0) + (entity.end?.x || 0)) / 2,
                            y: ((entity.start?.y || 0) + (entity.end?.y || 0)) / 2
                        },
                        layer: name
                    });
                }
            });
        }

        return entrances;
    }

    _calculateArea(vertices) {
        if (!vertices || vertices.length < 3) return 0;
        let area = 0;
        for (let i = 0; i < vertices.length; i++) {
            const j = (i + 1) % vertices.length;
            area += vertices[i][0] * vertices[j][1];
            area -= vertices[j][0] * vertices[i][1];
        }
        return Math.abs(area / 2);
    }

    _calculateBounds(vertices) {
        if (!vertices || vertices.length === 0) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        vertices.forEach(v => {
            const x = Array.isArray(v) ? v[0] : v.x;
            const y = Array.isArray(v) ? v[1] : v.y;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        });
        return { minX, minY, maxX, maxY };
    }

    _boundsToZone(bounds, id) {
        const { minX, minY, maxX, maxY } = bounds;
        return {
            id,
            name: 'Main Zone',
            area: (maxX - minX) * (maxY - minY),
            bounds: { minX, minY, maxX, maxY },
            polygon: [
                [minX, minY],
                [maxX, minY],
                [maxX, maxY],
                [minX, maxY]
            ],
            type: 'bounds'
        };
    }

    _createBoundsResult(bounds) {
        return {
            zones: bounds ? [this._boundsToZone(bounds, 'bounds_zone')] : [],
            forbiddenZones: [],
            entrances: []
        };
    }
}

module.exports = new LayerZoneDetector();
