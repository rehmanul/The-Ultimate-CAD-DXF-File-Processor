/**
 * LayerZoneDetector - Robust layer-based zone extraction from DXF
 * 
 * Uses planar graph extraction to find closed rooms (cycles) from wall lines.
 * Replaces simple chaining with robust geometry graph to handle T-junctions
 * and shared walls correctly.
 * 
 * Includes container filtration to remove "outer shell" zones.
 * Includes RASTER (Grid) fallback for files with poor connectivity.
 * 
 * Integrated with CostoLayerStandard for standardized COSTO layer conventions.
 */

const GeometryHelpers = require('./GeometryHelpers');
const SpatialGrid = require('./spatialGrid');
const costoLayerStandard = require('./costoLayerStandard');

class LayerZoneDetector {
    constructor() {
        // Use CostoLayerStandard for layer detection - includes all COSTO layer aliases
        const wallConfig = costoLayerStandard.getLayerConfig('WALLS');
        const forbiddenConfig = costoLayerStandard.getLayerConfig('FORBIDDEN');
        const exitsConfig = costoLayerStandard.getLayerConfig('EXITS');
        const obstaclesConfig = costoLayerStandard.getLayerConfig('OBSTACLES');

        // Merge standard COSTO layers with additional aliases for compatibility
        this.wallLayerNames = [...(wallConfig?.names || []), 'MUR', 'WALLS', 'WALL', 'MURS'];
        this.forbiddenLayerNames = [
            ...(forbiddenConfig?.names || []),
            ...(obstaclesConfig?.names || []),
            'NO_ENTREE', 'NO_ENTRY', 'FORBIDDEN', 'INTERDIT', 'ESCALIER', 'STAIRS'
        ];
        this.entranceLayerNames = [
            ...(exitsConfig?.names || []),
            'ENTREE__SORTIE', 'ENTREE', 'ENTRANCE', 'ENTRY', 'SORTIE', 'EXIT'
        ];

        // CostoLayerStandard reference for layer mapping
        this.layerStandard = costoLayerStandard;
    }

    detectZones(entities, bounds) {
        console.log(`[LayerZoneDetector] Processing ${entities.length} entities`);

        if (!entities || entities.length === 0) {
            return this._createBoundsResult(bounds);
        }

        const byLayer = this._groupByLayer(entities);
        console.log(`[LayerZoneDetector] Found layers: ${Object.keys(byLayer).join(', ')}`);

        // Extract zones using robust graph cycle detection
        const zones = this._extractStorageZones(byLayer, bounds);
        console.log(`[LayerZoneDetector] Extracted ${zones.length} storage zones`);

        const forbiddenZones = this._extractForbiddenZones(byLayer);
        const entrances = this._extractEntrances(byLayer);

        if (zones.length === 0) {
            console.log('[LayerZoneDetector] No zones found, using bounds fallback');
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
        let wallEntities = [];
        for (const name of this.wallLayerNames) {
            if (byLayer[name]) {
                wallEntities = wallEntities.concat(byLayer[name]);
            }
        }

        if (wallEntities.length === 0) return [];

        console.log(`[LayerZoneDetector] Processing ${wallEntities.length} wall entities`);

        // 1. Try to find explicitly closed polylines first (fast, accurate)
        const zones = [];
        const closedPolys = wallEntities.filter(e =>
            (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') &&
            (e.shape === true || e.closed === true) &&
            e.vertices && e.vertices.length >= 3
        );

        if (closedPolys.length > 0) {
            console.log(`[LayerZoneDetector] Found ${closedPolys.length} explicitly closed polylines`);
            closedPolys.forEach((p, idx) => {
                const vertices = p.vertices.map(v => [v.x, v.y]);
                const area = GeometryHelpers.polygonArea(vertices);
                if (area >= 5) {
                    zones.push({
                        id: `layer_poly_${idx}`,
                        name: `Zone ${idx + 1}`,
                        area,
                        bounds: GeometryHelpers.calculateBounds(vertices),
                        polygon: vertices,
                        type: 'poly'
                    });
                }
            });
        }

        // 2. Main Logic: Graph Cycle Extraction
        // We ALWAYS run graph extraction fallback if explicit polys might be incomplete.
        let candidates = [];

        console.log('[LayerZoneDetector] Running Graph Cycle Extraction...');
        const graphZones = this._extractGraphCycles(wallEntities, bounds);
        console.log(`[LayerZoneDetector] Graph extraction found ${graphZones.length} zones`);

        if (graphZones.length >= 2) {
            // If we found multiple rooms via graph, trust it.
            candidates = graphZones;
        } else {
            // 3. Last Resort: Raster (Flood Fill) Extraction
            // If graph collapsed to <2 zones (likely just outer shell due to gaps),
            // try Raster which is insensitive to gaps (due to wall thickness).
            console.log('[LayerZoneDetector] Graph detection found < 2 zones. Trying Raster/Grid detection (Robust Mode)...');
            const rasterZones = this._detectZonesViaRaster(wallEntities, bounds);
            console.log(`[LayerZoneDetector] Raster detection found ${rasterZones.length} zones`);

            if (rasterZones.length > graphZones.length) {
                candidates = rasterZones;
            } else {
                candidates = graphZones;
            }
        }

        // Merge with explicit zones (deduplicate if needed, simple concat for now)
        const allZones = [...zones, ...candidates];

        // Filter out container zones (remove outer shells)
        // Only if we have multiple zones, otherwise we keep the one we have.
        const filtered = allZones.length > 1 ? this._filterContainerZones(allZones) : allZones;

        // Final cleanup
        filtered.sort((a, b) => b.area - a.area);

        // Deduplicate overlapping similar zones
        return this._deduplicateZones(filtered);
    }

    _extractGraphCycles(wallEntities, bounds) {
        // Safe defaults
        const snapTolerance = 0.1;
        const gapTolerance = 0.15;
        const minArea = 5.0;

        // 1. Convert to segments
        let segments = this._segmentize(wallEntities);
        if (segments.length === 0) return [];

        // 2. Prepare Graph (Snap & Split)
        segments = this._prepareSegmentsForGraph(segments, snapTolerance, gapTolerance);

        // 3. Build Adjacency Graph
        const precision = 3;
        const graph = this._buildPlanarGraph(segments, precision);

        // 4. Extract Faces (Cycles)
        const cycles = this._extractFaces(graph, segments.length);

        // 5. Convert to Zones
        let zones = [];
        cycles.forEach((poly, idx) => {
            const area = GeometryHelpers.polygonArea(poly);
            if (area >= minArea) {
                zones.push({
                    id: `graph_zone_${idx}`,
                    name: `Room ${idx + 1}`,
                    area,
                    bounds: GeometryHelpers.calculateBounds(poly),
                    polygon: poly,
                    type: 'graph_cycle'
                });
            }
        });

        return zones;
    }

    _detectZonesViaRaster(wallEntities, bounds) {
        // 1. Setup Grid
        const cellSize = 0.2; // 20cm grid for robustness
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;

        if (width <= 0 || height <= 0) return [];

        const cols = Math.ceil(width / cellSize) + 4; // padding
        const rows = Math.ceil(height / cellSize) + 4;

        const grid = new Int8Array(cols * rows).fill(0); // 0: Open, 1: Wall, 2: Visited
        const idx = (c, r) => r * cols + c;

        // 2. Rasterize Walls
        const wallThickness = 0.25; // Fat walls to close gaps/doors
        const segments = this._segmentize(wallEntities); // Reuse segmentize

        segments.forEach(seg => {
            this._rasterizeSegment(grid, cols, rows, bounds, cellSize, seg.start, seg.end, wallThickness);
        });

        // 3. Flood Fill to find rooms
        const zones = [];
        for (let r = 1; r < rows - 1; r++) {
            for (let c = 1; c < cols - 1; c++) {
                if (grid[idx(c, r)] === 0) {
                    const roomCells = this._floodFill(grid, cols, rows, c, r, 2);
                    if (roomCells.length > 0) { // Found a room
                        // Calculate stats
                        const bbox = this._cellsBounds(roomCells, bounds, cellSize);
                        const area = roomCells.length * (cellSize * cellSize);

                        if (area >= 5.0) { // Min 5m²
                            // Create simple BBox polygon
                            const polygon = [
                                [bbox.minX, bbox.minY],
                                [bbox.maxX, bbox.minY],
                                [bbox.maxX, bbox.maxY],
                                [bbox.minX, bbox.maxY]
                            ];

                            zones.push({
                                id: `raster_zone_${zones.length}`,
                                name: `Room ${zones.length + 1}`,
                                area,
                                bounds: bbox,
                                polygon: polygon,
                                type: 'raster'
                            });
                        }
                    }
                }
            }
        }
        return zones;
    }

    _rasterizeSegment(grid, cols, rows, bounds, cellSize, start, end, thickness) {
        const minX = Math.min(start.x, end.x) - thickness;
        const maxX = Math.max(start.x, end.x) + thickness;
        const minY = Math.min(start.y, end.y) - thickness;
        const maxY = Math.max(start.y, end.y) + thickness;

        const c1 = Math.max(0, Math.floor((minX - bounds.minX) / cellSize));
        const c2 = Math.min(cols - 1, Math.ceil((maxX - bounds.minX) / cellSize));
        const r1 = Math.max(0, Math.floor((minY - bounds.minY) / cellSize));
        const r2 = Math.min(rows - 1, Math.ceil((maxY - bounds.minY) / cellSize));

        for (let r = r1; r <= r2; r++) {
            for (let c = c1; c <= c2; c++) {
                const cx = bounds.minX + (c + 0.5) * cellSize;
                const cy = bounds.minY + (r + 0.5) * cellSize;
                const dist = GeometryHelpers.pointToSegmentDistance({ x: cx, y: cy }, start, end);
                if (dist <= thickness / 2) {
                    grid[r * cols + c] = 1; // Wall
                }
            }
        }
    }

    _floodFill(grid, cols, rows, startC, startR, fillVal) {
        const queue = [startC, startR];
        const cells = [];
        const startIdx = startR * cols + startC;

        if (grid[startIdx] !== 0) return [];
        grid[startIdx] = fillVal;
        cells.push([startC, startR]);

        let head = 0;
        while (head < queue.length) {
            const c = queue[head++];
            const r = queue[head++];

            // Neighbors 4-way
            const neighbors = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]];
            for (const [nc, nr] of neighbors) {
                if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
                    const idx = nr * cols + nc;
                    if (grid[idx] === 0) {
                        grid[idx] = fillVal;
                        cells.push([nc, nr]);
                        queue.push(nc, nr);
                    }
                }
            }
        }
        return cells;
    }

    _cellsBounds(cells, bounds, cellSize) {
        let cMin = Infinity, cMax = -Infinity, rMin = Infinity, rMax = -Infinity;
        cells.forEach(([c, r]) => {
            if (c < cMin) cMin = c;
            if (c > cMax) cMax = c;
            if (r < rMin) rMin = r;
            if (r > rMax) rMax = r;
        });
        return {
            minX: bounds.minX + cMin * cellSize,
            maxX: bounds.minX + (cMax + 1) * cellSize,
            minY: bounds.minY + rMin * cellSize,
            maxY: bounds.minY + (rMax + 1) * cellSize
        };
    }

    _deduplicateZones(zones) {
        const unique = [];
        zones.forEach(z => {
            const dup = unique.find(u => {
                const areaDiff = Math.abs(u.area - z.area);
                const dist = Math.hypot(u.bounds.minX - z.bounds.minX, u.bounds.minY - z.bounds.minY);
                return areaDiff < 5.0 && dist < 1.0;
            });
            if (!dup) unique.push(z);
        });
        return unique;
    }

    _filterContainerZones(zones) {
        if (zones.length <= 1) return zones;
        const containers = new Set();
        const sorted = [...zones].sort((a, b) => a.area - b.area);

        for (let i = 0; i < sorted.length; i++) {
            const inner = sorted[i];
            const innerCentroid = GeometryHelpers.polygonCentroid(inner.polygon);
            if (!innerCentroid) continue;

            for (let j = i + 1; j < sorted.length; j++) {
                const outer = sorted[j];
                if (outer.area < inner.area + 1.0) continue;
                if (GeometryHelpers.pointInPolygon(innerCentroid, outer.polygon)) {
                    containers.add(outer.id);
                }
            }
        }

        const filtered = zones.filter(z => !containers.has(z.id));
        console.log(`[LayerZoneDetector] Filtered ${containers.size} container zones. Kept ${filtered.length} leaf zones.`);
        return filtered;
    }

    _segmentize(entities) {
        const segments = [];
        entities.forEach((e, idx) => {
            if (e.type === 'LINE') {
                const start = e.start || (e.vertices ? e.vertices[0] : null);
                const end = e.end || (e.vertices ? e.vertices[1] : null);
                if (start && end) {
                    segments.push({
                        start: { x: Number(start.x), y: Number(start.y) },
                        end: { x: Number(end.x), y: Number(end.y) },
                        id: idx
                    });
                }
            } else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
                if (e.vertices && e.vertices.length > 1) {
                    for (let i = 0; i < e.vertices.length - 1; i++) {
                        segments.push({
                            start: { x: Number(e.vertices[i].x), y: Number(e.vertices[i].y) },
                            end: { x: Number(e.vertices[i + 1].x), y: Number(e.vertices[i + 1].y) },
                            id: idx
                        });
                    }
                    if (e.shape || e.closed) {
                        segments.push({
                            start: { x: Number(e.vertices[e.vertices.length - 1].x), y: Number(e.vertices[e.vertices.length - 1].y) },
                            end: { x: Number(e.vertices[0].x), y: Number(e.vertices[0].y) },
                            id: idx
                        });
                    }
                }
            }
        });
        return segments;
    }

    _prepareSegmentsForGraph(segments, snapTolerance, gapTolerance) {
        const snapped = this._snapEndpoints(segments, snapTolerance);
        const splitMap = this._collectIntersections(snapped, gapTolerance);
        const result = this._splitSegments(snapped, splitMap, snapTolerance);
        return result;
    }

    _snapEndpoints(segments, tolerance) {
        const grid = new Map();
        const cellSize = tolerance;
        const key = (x, y) => `${Math.round(x / cellSize)}_${Math.round(y / cellSize)}`;

        segments.forEach(seg => {
            [seg.start, seg.end].forEach(pt => {
                const k = key(pt.x, pt.y);
                if (!grid.has(k)) grid.set(k, []);
                grid.get(k).push(pt);
            });
        });

        grid.forEach(points => {
            if (points.length < 2) return;
            const anchor = points[0];
            for (let i = 1; i < points.length; i++) {
                points[i].x = anchor.x;
                points[i].y = anchor.y;
            }
        });

        return segments;
    }

    _collectIntersections(segments, tolerance) {
        const splitMap = new Map();
        for (let i = 0; i < segments.length; i++) {
            for (let j = i + 1; j < segments.length; j++) {
                const s1 = segments[i];
                const s2 = segments[j];
                const pt = GeometryHelpers.segmentIntersectionPoint(s1.start, s1.end, s2.start, s2.end);

                if (pt) {
                    this._addSplit(splitMap, i, pt);
                    this._addSplit(splitMap, j, pt);
                } else {
                    const checkOn = (p, seg, idx) => {
                        const dist = GeometryHelpers.pointToSegmentDistance(p, seg.start, seg.end);
                        if (dist < tolerance) {
                            const d1 = Math.hypot(p.x - seg.start.x, p.y - seg.start.y);
                            const d2 = Math.hypot(p.x - seg.end.x, p.y - seg.end.y);
                            if (d1 > tolerance && d2 > tolerance) {
                                this._addSplit(splitMap, idx, p);
                            }
                        }
                    };
                    checkOn(s1.start, s2, j);
                    checkOn(s1.end, s2, j);
                    checkOn(s2.start, s1, i);
                    checkOn(s2.end, s1, i);
                }
            }
        }
        return splitMap;
    }

    _addSplit(map, idx, pt) {
        if (!map.has(idx)) map.set(idx, []);
        map.get(idx).push(pt);
    }

    _splitSegments(segments, splitMap, tolerance) {
        const params = [];
        segments.forEach((seg, idx) => {
            if (!splitMap.has(idx)) {
                params.push(seg);
                return;
            }

            const points = splitMap.get(idx);
            const dx = seg.end.x - seg.start.x;
            const dy = seg.end.y - seg.start.y;
            const lenSq = dx * dx + dy * dy;

            if (lenSq < 1e-6) return;

            const splits = points.map(p => {
                const t = ((p.x - seg.start.x) * dx + (p.y - seg.start.y) * dy) / lenSq;
                return { t, x: p.x, y: p.y };
            }).filter(s => s.t > 0.01 && s.t < 0.99)
                .sort((a, b) => a.t - b.t);

            const unique = [];
            if (splits.length > 0) {
                unique.push(splits[0]);
                for (let i = 1; i < splits.length; i++) {
                    if (splits[i].t - splits[i - 1].t > 0.01) unique.push(splits[i]);
                }
            }

            let curr = seg.start;
            unique.forEach(s => {
                params.push({
                    start: { x: curr.x, y: curr.y },
                    end: { x: s.x, y: s.y }
                });
                curr = { x: s.x, y: s.y };
            });
            params.push({
                start: { x: curr.x, y: curr.y },
                end: { x: seg.end.x, y: seg.end.y }
            });
        });
        return params;
    }

    _buildPlanarGraph(segments, precision) {
        const adjacency = new Map();
        const ptKey = (p) => `${p.x.toFixed(precision)},${p.y.toFixed(precision)}`;

        segments.forEach(seg => {
            const u = ptKey(seg.start);
            const v = ptKey(seg.end);
            if (u === v) return;

            if (!adjacency.has(u)) adjacency.set(u, { p: seg.start, neighbors: [] });
            if (!adjacency.has(v)) adjacency.set(v, { p: seg.end, neighbors: [] });

            const uNode = adjacency.get(u);
            const vNode = adjacency.get(v);

            const angUV = Math.atan2(seg.end.y - seg.start.y, seg.end.x - seg.start.x);
            const angVU = Math.atan2(seg.start.y - seg.end.y, seg.start.x - seg.end.x);

            uNode.neighbors.push({ key: v, angle: angUV });
            vNode.neighbors.push({ key: u, angle: angVU });
        });

        adjacency.forEach(node => {
            node.neighbors.sort((a, b) => a.angle - b.angle);
        });

        return adjacency;
    }

    _extractFaces(graph, maxSegments) {
        const faces = [];
        const visited = new Set();

        for (const [uKey, uNode] of graph.entries()) {
            for (const neighbor of uNode.neighbors) {
                const edgeKey = `${uKey}|${neighbor.key}`;
                if (visited.has(edgeKey)) continue;

                const path = this._walkFace(graph, uKey, neighbor.key, visited);
                if (path && path.length >= 3) {
                    faces.push(path);
                }
            }
        }
        return faces;
    }

    _walkFace(graph, startKey, nextKey, visited) {
        const path = [];
        let curr = startKey;
        let next = nextKey;
        const startEdge = `${curr}|${next}`;

        let steps = 0;
        const maxSteps = 1000;

        while (steps < maxSteps) {
            visited.add(`${curr}|${next}`);

            const uNode = graph.get(curr);
            path.push([uNode.p.x, uNode.p.y]);

            if (next === startKey) {
                return path;
            }

            const vNode = graph.get(next);
            if (!vNode || vNode.neighbors.length === 0) return null;

            const entryIdx = vNode.neighbors.findIndex(n => n.key === curr);
            if (entryIdx === -1) return null;

            const nextIdx = (entryIdx - 1 + vNode.neighbors.length) % vNode.neighbors.length;
            const nextNeighbor = vNode.neighbors[nextIdx];

            curr = next;
            next = nextNeighbor.key;
            steps++;

            if (visited.has(`${curr}|${next}`) && `${curr}|${next}` !== startEdge) {
                return null;
            }
        }
        return null;
    }

    _extractForbiddenZones(byLayer) {
        const forbidden = [];
        for (const name of this.forbiddenLayerNames) {
            const layer = byLayer[name];
            if (!layer) continue;
            layer.forEach((entity, idx) => {
                if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
                    if (entity.vertices && entity.vertices.length >= 3) {
                        const vertices = entity.vertices.map(v => [v.x, v.y]);
                        const bounds = GeometryHelpers.calculateBounds(vertices);
                        forbidden.push({
                            id: `forbidden_${name}_${idx}`,
                            x: bounds.minX, y: bounds.minY,
                            width: bounds.width, height: bounds.height,
                            polygon: vertices, layer: name
                        });
                    }
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
            layer.forEach((entity, idx) => {
                if (entity.type === 'LINE') {
                    const start = entity.start || (entity.vertices && entity.vertices[0]);
                    const end = entity.end || (entity.vertices && entity.vertices[1]);
                    if (!start || !end) return;
                    const sx = Number(start.x);
                    const sy = Number(start.y);
                    const ex = Number(end.x);
                    const ey = Number(end.y);
                    if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) {
                        return;
                    }
                    const center = { x: (sx + ex) / 2, y: (sy + ey) / 2 };
                    entrances.push({
                        id: `entrance_${idx}`, center, layer: name
                    });
                }
            });
        }
        return entrances;
    }

    _boundsToZone(bounds, id) {
        const { minX, minY, maxX, maxY } = bounds;
        return {
            id,
            name: 'Main Zone',
            area: (maxX - minX) * (maxY - minY),
            bounds,
            polygon: [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]],
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
