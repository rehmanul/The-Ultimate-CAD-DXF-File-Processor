const GeometryHelpers = require('./geometryHelpers');
const SpatialGrid = require('./spatialGrid');

class RoomDetector {
    constructor() {
        this.mlProcessor = null;
        this.initializeML();
    }

    async initializeML() {
        // PRODUCTION CONFIGURATION: Force geometric mode for stability in current environment
        // The ML processor native bindings are unstable in this environment.
        console.warn('ML processor disabled by configuration (Production Stability Mode). Using geometric engine.');
        this.mlProcessor = null;
    }

    detectRooms(walls, entrances, forbiddenZones, bounds, options = {}) {
        console.log(`[RoomDetector] Starting detection with ${walls ? walls.length : 0} walls`);
        if (!walls || walls.length === 0) return [];

        const detectionOptions = options && typeof options === 'object' ? options : {};
        const snapTolerance = Number.isFinite(detectionOptions.snapTolerance) ? detectionOptions.snapTolerance : 0.1;
        const minRoomArea = Number.isFinite(detectionOptions.minRoomArea) ? detectionOptions.minRoomArea : 0.5;
        const boundsWidth = bounds ? Number(bounds.maxX) - Number(bounds.minX) : NaN;
        const boundsHeight = bounds ? Number(bounds.maxY) - Number(bounds.minY) : NaN;
        const derivedGap = Number.isFinite(boundsWidth) && Number.isFinite(boundsHeight)
            ? Math.min(boundsWidth, boundsHeight) * 0.003
            : snapTolerance * 6;
        // Increased gap tolerance to handle 0.03-0.1m gaps better
        const gapTolerance = Number.isFinite(detectionOptions.gapTolerance)
            ? detectionOptions.gapTolerance
            : Math.max(0.1, Math.min(0.2, derivedGap));

        // Graph-based closed polygon detection
        console.log('[RoomDetector] Extracting room cycles from wall graph...');
        let rooms = [];
        let closedPolygons = [];
        let outerBoundary = null;
        try {
            const closedResult = this.findClosedPolygonsWithOuter(walls, { bounds, snapTolerance, gapTolerance, minRoomArea });
            closedPolygons = closedResult.polygons;
            outerBoundary = closedResult.outer;
            console.log(`[RoomDetector] Found ${closedPolygons.length} closed polygons`);
        } catch (e) {
            console.error('[RoomDetector] Closed polygon detection failed:', e.message);
        }
        let rasterPolygons = [];
        try {
            rasterPolygons = this._detectRoomsByRaster(walls, forbiddenZones, bounds, {
                snapTolerance,
                gapTolerance,
                minRoomArea,
                entrances,
                gridSize: detectionOptions.gridSize,
                wallThickness: detectionOptions.wallThickness,
                maxGridCells: detectionOptions.maxGridCells
            });
            if (rasterPolygons.length) {
                console.log(`[RoomDetector] Raster extraction produced ${rasterPolygons.length} polygons`);
            }
        } catch (e) {
            console.error('[RoomDetector] Raster room extraction failed:', e.message);
        }

        const mergedPolygons = this._mergePolygonSets(rasterPolygons, closedPolygons, snapTolerance);
        const uniquePolygons = this._normalizeRoomPolygons(mergedPolygons, snapTolerance, minRoomArea);
        const polygonsToUse = uniquePolygons;
        if (!polygonsToUse.length) {
            console.warn('[RoomDetector] No closed polygons detected after merge.');
        }

        polygonsToUse.forEach((polygon, index) => {
            const area = this.calculatePolygonArea(polygon);
            const center = this.calculateCentroid(polygon);
            const roomBounds = this.getPolygonBounds(polygon);
            const type = this.classifyRoomType(polygon, area, center, entrances, forbiddenZones);

            if (area > 0.5) { // Minimum 0.5 m² for advanced detection
                rooms.push({
                    id: `room_${index}`,
                    name: `Room ${index + 1}`,
                    area: area,
                    type: type,
                    subtype: this.getRoomSubtype(type, area, roomBounds),
                    bounds: roomBounds,
                    center: center,
                    polygon: polygon,
                    adjacency: this.getAdjacentElements(polygon, entrances, forbiddenZones)
                });
            }
        });

        // Sort by area descending for prioritization
        rooms.sort((a, b) => b.area - a.area);

        return rooms;
    }

    normalizePoint(point) {
        if (!point) return [0, 0];
        if (Array.isArray(point) && point.length >= 2) {
            const x = Number(point[0]);
            const y = Number(point[1]);
            return [
                Number.isFinite(x) ? x : 0,
                Number.isFinite(y) ? y : 0
            ];
        }
        const x = Number(point.x);
        const y = Number(point.y);
        return [
            Number.isFinite(x) ? x : 0,
            Number.isFinite(y) ? y : 0
        ];
    }

    pointKey(point, precision = 2) {
        const [x, y] = this.normalizePoint(point);
        return `${x.toFixed(precision)},${y.toFixed(precision)}`;
    }

    findClosedPolygons(walls, options = {}) {
        const result = this.findClosedPolygonsWithOuter(walls, options);
        return result.polygons;
    }

    findClosedPolygonsWithOuter(walls, options = {}) {
        // Use larger snap tolerance for better gap healing (0.1m default)
        const snapTolerance = Number.isFinite(options.snapTolerance) ? options.snapTolerance : 0.1;
        // Gap tolerance should be at least snapTolerance to close micro-gaps
        const gapTolerance = Number.isFinite(options.gapTolerance) 
            ? options.gapTolerance 
            : Math.max(snapTolerance, 0.1);
        const minRoomArea = Number.isFinite(options.minRoomArea) ? options.minRoomArea : 0.5;

        const segments = this._collectWallSegments(walls);
        if (!segments.length) {
            console.log('[RoomDetector] No wall segments available for graph extraction');
            return { polygons: [], outer: null };
        }

        const preparedSegments = this._prepareSegmentsForGraph(segments, snapTolerance, gapTolerance);
        if (!preparedSegments.length) {
            console.log('[RoomDetector] No valid segments after gap healing');
            return { polygons: [], outer: null };
        }

        const precision = this._precisionFromTolerance(snapTolerance);
        const graph = this._buildPlanarGraph(preparedSegments, precision);
        const faces = this._extractFaces(graph, preparedSegments.length);
        return this._filterFacesWithOuter(faces, {
            minArea: minRoomArea,
            precision
        });
    }

    _precisionFromTolerance(tolerance) {
        if (!Number.isFinite(tolerance) || tolerance <= 0) return 4;
        const magnitude = Math.ceil(-Math.log10(tolerance));
        return Math.max(3, magnitude + 1);
    }

    _collectWallSegments(walls) {
        const segments = [];
        if (!Array.isArray(walls)) return segments;

        walls.forEach((wall, idx) => {
            if (!wall) return;

            if (wall.start && wall.end) {
                const start = { x: Number(wall.start.x), y: Number(wall.start.y) };
                const end = { x: Number(wall.end.x), y: Number(wall.end.y) };
                if (!Number.isFinite(start.x) || !Number.isFinite(start.y) ||
                    !Number.isFinite(end.x) || !Number.isFinite(end.y)) {
                    return;
                }
                segments.push({ start, end, source: idx });
            }

            if (Array.isArray(wall.polygon) && wall.polygon.length >= 2) {
                const points = wall.polygon
                    .map(pt => this.normalizePoint(pt))
                    .filter(pt => Number.isFinite(pt[0]) && Number.isFinite(pt[1]))
                    .map(pt => ({ x: pt[0], y: pt[1] }));

                if (points.length < 2) return;
                for (let i = 0; i < points.length - 1; i++) {
                    segments.push({ start: points[i], end: points[i + 1], source: idx });
                }
                const first = points[0];
                const last = points[points.length - 1];
                if (points.length > 2 && !this._pointsClose(first, last, 1e-6)) {
                    segments.push({ start: last, end: first, source: idx });
                }
            }
        });

        return segments;
    }

    _prepareSegmentsForGraph(segments, snapTolerance, gapTolerance) {
        const snapperState = {
            xSnapper: this._createScalarSnapper(snapTolerance),
            ySnapper: this._createScalarSnapper(snapTolerance),
            axisTolerance: Math.max(snapTolerance, 1e-6)
        };
        const gapTol = Number.isFinite(gapTolerance) ? gapTolerance : snapTolerance;
        const gapSnapper = this._createSnapper(gapTol);
        const endpointSnapper = gapSnapper;

        let snapped = this._snapSegments(segments, snapTolerance, snapperState, endpointSnapper);
        const gapResult = this._snapEndpointsToSegments(snapped, gapTol, gapSnapper);
        snapped = this._snapSegments(gapResult.segments, snapTolerance, snapperState, endpointSnapper);
        const axisSplits = this._collectAxisAlignedIntersections(snapped, gapTol, gapSnapper);
        const extraSplits = this._mergeSplitMaps(gapResult.extraSplits, axisSplits);
        const splitMap = this._collectSegmentIntersections(snapped, gapTol, extraSplits, gapSnapper);
        const precision = this._precisionFromTolerance(snapTolerance);
        return this._splitSegments(snapped, splitMap, snapTolerance, precision);
    }

    _createSnapper(tolerance) {
        if (!Number.isFinite(tolerance) || tolerance <= 0) {
            return {
                snap: (point) => ({
                    x: Number(point.x),
                    y: Number(point.y)
                })
            };
        }

        const cellSize = tolerance;
        const cells = new Map();
        const neighbors = [-1, 0, 1];
        const toleranceSq = tolerance * tolerance;

        const cellKey = (x, y) => `${Math.floor(x / cellSize)}_${Math.floor(y / cellSize)}`;

        return {
            snap: (point) => {
                const x = Number(point.x);
                const y = Number(point.y);
                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                    return { x: 0, y: 0 };
                }

                const cx = Math.floor(x / cellSize);
                const cy = Math.floor(y / cellSize);

                for (const dx of neighbors) {
                    for (const dy of neighbors) {
                        const key = `${cx + dx}_${cy + dy}`;
                        const bucket = cells.get(key);
                        if (!bucket) continue;
                        for (const anchor of bucket) {
                            const dxp = anchor.x - x;
                            const dyp = anchor.y - y;
                            if ((dxp * dxp + dyp * dyp) <= toleranceSq) {
                                return anchor;
                            }
                        }
                    }
                }

                const anchor = { x, y };
                const key = cellKey(x, y);
                if (!cells.has(key)) cells.set(key, []);
                cells.get(key).push(anchor);
                return anchor;
            }
        };
    }

    _createScalarSnapper(tolerance) {
        if (!Number.isFinite(tolerance) || tolerance <= 0) {
            return { snap: (value) => Number(value) };
        }

        const cellSize = tolerance;
        const buckets = new Map();

        return {
            snap: (value) => {
                const num = Number(value);
                if (!Number.isFinite(num)) return 0;
                const key = Math.floor(num / cellSize);
                for (let k = key - 1; k <= key + 1; k++) {
                    const bucket = buckets.get(k);
                    if (!bucket) continue;
                    for (const anchor of bucket) {
                        if (Math.abs(anchor - num) <= tolerance) {
                            return anchor;
                        }
                    }
                }

                const anchor = num;
                if (!buckets.has(key)) buckets.set(key, []);
                buckets.get(key).push(anchor);
                return anchor;
            }
        };
    }

    _snapSegments(segments, snapTolerance, snapperState = null, endpointSnapper = null) {
        const snapped = [];
        const tolerance = Number.isFinite(snapTolerance) ? snapTolerance : 0;
        const xSnapper = snapperState && snapperState.xSnapper ? snapperState.xSnapper : this._createScalarSnapper(tolerance);
        const ySnapper = snapperState && snapperState.ySnapper ? snapperState.ySnapper : this._createScalarSnapper(tolerance);
        const axisTolerance = Number.isFinite(snapperState && snapperState.axisTolerance)
            ? snapperState.axisTolerance
            : Math.max(tolerance, 1e-6);
        const pointSnapper = endpointSnapper && typeof endpointSnapper.snap === 'function' ? endpointSnapper : null;

        for (const seg of segments) {
            const rawDx = seg.end.x - seg.start.x;
            const rawDy = seg.end.y - seg.start.y;
            const start = { x: xSnapper.snap(seg.start.x), y: ySnapper.snap(seg.start.y) };
            const end = { x: xSnapper.snap(seg.end.x), y: ySnapper.snap(seg.end.y) };

            const absDx = Math.abs(rawDx);
            const absDy = Math.abs(rawDy);
            const isVertical = absDx <= axisTolerance && absDy > axisTolerance;
            const isHorizontal = absDy <= axisTolerance && absDx > axisTolerance;

            if (isVertical) {
                const x = xSnapper.snap((start.x + end.x) / 2);
                start.x = x;
                end.x = x;
            } else if (isHorizontal) {
                const y = ySnapper.snap((start.y + end.y) / 2);
                start.y = y;
                end.y = y;
            }

            if (pointSnapper) {
                const snappedStart = pointSnapper.snap(start);
                const snappedEnd = pointSnapper.snap(end);
                start.x = snappedStart.x;
                start.y = snappedStart.y;
                end.x = snappedEnd.x;
                end.y = snappedEnd.y;
            }

            if (this._pointsClose(start, end, 1e-8)) {
                continue;
            }
            snapped.push({
                start: { x: start.x, y: start.y },
                end: { x: end.x, y: end.y },
                source: seg.source
            });
        }
        return snapped;
    }

    _snapEndpointsToSegments(segments, gapTolerance, snapper) {
        const updated = segments.map(seg => ({
            start: { x: seg.start.x, y: seg.start.y },
            end: { x: seg.end.x, y: seg.end.y },
            source: seg.source
        }));

        const extraSplits = new Map();
        const grid = this._buildSegmentGrid(segments, Math.max(1, gapTolerance * 10));
        if (!grid) return { segments: updated, extraSplits };

        const snapDistanceSq = gapTolerance * gapTolerance;

        updated.forEach((seg, idx) => {
            const endpoints = [
                { key: 'start', point: seg.start },
                { key: 'end', point: seg.end }
            ];

            endpoints.forEach((entry) => {
                const pt = entry.point;
                const rect = {
                    x1: pt.x - gapTolerance,
                    y1: pt.y - gapTolerance,
                    x2: pt.x + gapTolerance,
                    y2: pt.y + gapTolerance
                };

                const candidates = grid.queryRect(rect);
                let best = null;

                candidates.forEach((candidate) => {
                    if (candidate.index === idx) return;
                    const projection = this._projectPointToSegment(pt, candidate.segment);
                    if (!projection) return;
                    if (projection.distanceSq > snapDistanceSq) return;
                    if (!best || projection.distanceSq < best.distanceSq) {
                        best = { projection, segmentIndex: candidate.index };
                    }
                });

                if (best) {
                    const candidateSeg = segments[best.segmentIndex];
                    if (!candidateSeg) return;
                    const segDir = {
                        x: seg.end.x - seg.start.x,
                        y: seg.end.y - seg.start.y
                    };
                    const candDir = {
                        x: candidateSeg.end.x - candidateSeg.start.x,
                        y: candidateSeg.end.y - candidateSeg.start.y
                    };
                    const segLen = Math.hypot(segDir.x, segDir.y);
                    const candLen = Math.hypot(candDir.x, candDir.y);
                    const dot = segDir.x * candDir.x + segDir.y * candDir.y;
                    const absCos = (segLen > 0 && candLen > 0) ? Math.abs(dot / (segLen * candLen)) : 1;
                    const isParallel = absCos > 0.95;
                    const isPerpendicular = absCos < 0.2;
                    if (isParallel) {
                        const nearEndpoint = best.projection.t < 0.1 || best.projection.t > 0.9;
                        if (!nearEndpoint) return;
                    } else if (!isPerpendicular) {
                        return;
                    }

                    const snappedPoint = snapper.snap(best.projection.point);
                    entry.point.x = snappedPoint.x;
                    entry.point.y = snappedPoint.y;
                    this._addSplitPoint(extraSplits, best.segmentIndex, snappedPoint);
                }
            });
        });

        return { segments: updated, extraSplits };
    }

    _buildSegmentGrid(segments, cellSize) {
        if (!segments.length) return null;
        const bounds = this._computeBoundsFromSegments(segments);
        const grid = new SpatialGrid(bounds, cellSize);

        segments.forEach((seg, idx) => {
            const minX = Math.min(seg.start.x, seg.end.x);
            const minY = Math.min(seg.start.y, seg.end.y);
            const maxX = Math.max(seg.start.x, seg.end.x);
            const maxY = Math.max(seg.start.y, seg.end.y);
            const item = {
                x: minX,
                y: minY,
                width: Math.max(0.0001, maxX - minX),
                height: Math.max(0.0001, maxY - minY),
                index: idx,
                segment: seg
            };
            grid.insert(item);
        });

        return grid;
    }

    _computeBoundsFromSegments(segments) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        segments.forEach((seg) => {
            minX = Math.min(minX, seg.start.x, seg.end.x);
            minY = Math.min(minY, seg.start.y, seg.end.y);
            maxX = Math.max(maxX, seg.start.x, seg.end.x);
            maxY = Math.max(maxY, seg.start.y, seg.end.y);
        });

        if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
            return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        }

        return { minX, minY, maxX, maxY };
    }

    _projectPointToSegment(point, segment) {
        const px = point.x;
        const py = point.y;
        const x1 = segment.start.x;
        const y1 = segment.start.y;
        const x2 = segment.end.x;
        const y2 = segment.end.y;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;

        if (lenSq === 0) return null;

        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));

        const projX = x1 + t * dx;
        const projY = y1 + t * dy;
        const distSq = (projX - px) * (projX - px) + (projY - py) * (projY - py);

        return {
            point: { x: projX, y: projY },
            t,
            distanceSq: distSq
        };
    }

    _collectSegmentIntersections(segments, gapTolerance, extraSplits, snapper) {
        const splitMap = new Map();
        if (extraSplits) {
            for (const [idx, points] of extraSplits.entries()) {
                points.forEach(point => this._addSplitPoint(splitMap, idx, point));
            }
        }

        segments.forEach((seg, idx) => {
            this._addSplitPoint(splitMap, idx, snapper.snap(seg.start));
            this._addSplitPoint(splitMap, idx, snapper.snap(seg.end));
        });

        const grid = this._buildSegmentGrid(segments, Math.max(1, gapTolerance * 10));
        if (!grid) return splitMap;

        segments.forEach((seg, idx) => {
            const minX = Math.min(seg.start.x, seg.end.x) - gapTolerance;
            const minY = Math.min(seg.start.y, seg.end.y) - gapTolerance;
            const maxX = Math.max(seg.start.x, seg.end.x) + gapTolerance;
            const maxY = Math.max(seg.start.y, seg.end.y) + gapTolerance;

            const candidates = grid.queryRect({
                x1: minX,
                y1: minY,
                x2: maxX,
                y2: maxY
            });

            candidates.forEach((candidate) => {
                if (candidate.index <= idx) return;

                const points = this._segmentIntersectionPoints(seg, candidate.segment, gapTolerance);
                points.forEach((point) => {
                    const snappedPoint = snapper.snap(point);
                    this._addSplitPoint(splitMap, idx, snappedPoint);
                    this._addSplitPoint(splitMap, candidate.index, snappedPoint);
                });
            });
        });

        return splitMap;
    }

    _segmentIntersectionPoints(segA, segB, tolerance) {
        const points = [];
        const intersection = GeometryHelpers.segmentIntersectionPoint(segA.start, segA.end, segB.start, segB.end);
        if (intersection) {
            points.push(intersection);
            return points;
        }

        const ax = segA.end.x - segA.start.x;
        const ay = segA.end.y - segA.start.y;
        const bx = segB.end.x - segB.start.x;
        const by = segB.end.y - segB.start.y;
        const cross = ax * by - ay * bx;
        const epsilon = 1e-10;

        if (Math.abs(cross) > epsilon) {
            return points;
        }

        const distance = GeometryHelpers.pointToSegmentDistance(segB.start, segA.start, segA.end);
        if (distance > tolerance) {
            return points;
        }

        const endpoints = [
            segA.start,
            segA.end,
            segB.start,
            segB.end
        ];

        endpoints.forEach((pt) => {
            if (this._pointOnSegment(pt, segA, tolerance) && this._pointOnSegment(pt, segB, tolerance)) {
                points.push({ x: pt.x, y: pt.y });
            }
        });

        return points;
    }

    _pointOnSegment(point, segment, tolerance) {
        const minX = Math.min(segment.start.x, segment.end.x) - tolerance;
        const maxX = Math.max(segment.start.x, segment.end.x) + tolerance;
        const minY = Math.min(segment.start.y, segment.end.y) - tolerance;
        const maxY = Math.max(segment.start.y, segment.end.y) + tolerance;
        if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) {
            return false;
        }
        const dist = GeometryHelpers.pointToSegmentDistance(point, segment.start, segment.end);
        return dist <= tolerance;
    }

    _addSplitPoint(map, index, point) {
        if (!map.has(index)) map.set(index, []);
        map.get(index).push({ x: point.x, y: point.y });
    }

    _mergeSplitMaps(...maps) {
        const merged = new Map();
        maps.forEach((map) => {
            if (!map) return;
            for (const [index, points] of map.entries()) {
                points.forEach((point) => this._addSplitPoint(merged, index, point));
            }
        });
        return merged;
    }

    _collectAxisAlignedIntersections(segments, gapTolerance, snapper) {
        const splitMap = new Map();
        const tolerance = Number.isFinite(gapTolerance) ? gapTolerance : 0.1;
        const axisTolerance = Math.max(tolerance, 1e-6);
        const verticals = [];
        const horizontals = [];

        segments.forEach((seg, idx) => {
            const dx = seg.end.x - seg.start.x;
            const dy = seg.end.y - seg.start.y;
            if (Math.abs(dx) <= axisTolerance && Math.abs(dy) > axisTolerance) {
                verticals.push({
                    index: idx,
                    x: seg.start.x,
                    minY: Math.min(seg.start.y, seg.end.y),
                    maxY: Math.max(seg.start.y, seg.end.y)
                });
            } else if (Math.abs(dy) <= axisTolerance && Math.abs(dx) > axisTolerance) {
                horizontals.push({
                    index: idx,
                    y: seg.start.y,
                    minX: Math.min(seg.start.x, seg.end.x),
                    maxX: Math.max(seg.start.x, seg.end.x)
                });
            }
        });

        verticals.forEach((vert) => {
            horizontals.forEach((horiz) => {
                const x = vert.x;
                const y = horiz.y;
                if (x < horiz.minX - tolerance || x > horiz.maxX + tolerance) return;
                if (y < vert.minY - tolerance || y > vert.maxY + tolerance) return;
                const snapped = snapper.snap({ x, y });
                this._addSplitPoint(splitMap, vert.index, snapped);
                this._addSplitPoint(splitMap, horiz.index, snapped);
            });
        });

        return splitMap;
    }

    _splitSegments(segments, splitMap, snapTolerance, precision) {
        const newSegments = [];
        const minLength = Math.max(0.001, snapTolerance * 0.1);
        const seen = new Set();

        segments.forEach((seg, idx) => {
            const points = splitMap.get(idx) || [];
            const uniquePoints = this._uniquePoints(points, precision);
            if (uniquePoints.length < 2) return;

            const dx = seg.end.x - seg.start.x;
            const dy = seg.end.y - seg.start.y;
            const lenSq = dx * dx + dy * dy;
            if (lenSq === 0) return;

            const sorted = uniquePoints
                .map((pt) => ({
                    point: pt,
                    t: ((pt.x - seg.start.x) * dx + (pt.y - seg.start.y) * dy) / lenSq
                }))
                .sort((a, b) => a.t - b.t);

            for (let i = 0; i < sorted.length - 1; i++) {
                const p1 = sorted[i].point;
                const p2 = sorted[i + 1].point;
                const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                if (length < minLength) continue;

                const segmentKey = this._segmentKey({ start: p1, end: p2 }, precision);
                if (seen.has(segmentKey)) continue;
                seen.add(segmentKey);
                newSegments.push({ start: p1, end: p2 });
            }
        });

        return newSegments;
    }

    _uniquePoints(points, precision) {
        const unique = new Map();
        points.forEach((point) => {
            const key = this.pointKey(point, precision);
            if (!unique.has(key)) unique.set(key, point);
        });
        return Array.from(unique.values());
    }

    _segmentKey(segment, precision) {
        const a = this.pointKey(segment.start, precision);
        const b = this.pointKey(segment.end, precision);
        return a < b ? `${a}|${b}` : `${b}|${a}`;
    }

    _pointsClose(p1, p2, epsilon = 1e-6) {
        return Math.abs(p1.x - p2.x) < epsilon && Math.abs(p1.y - p2.y) < epsilon;
    }

    _buildPlanarGraph(segments, precision) {
        const adjacency = new Map();
        const addNode = (point) => {
            const key = this.pointKey(point, precision);
            if (!adjacency.has(key)) {
                adjacency.set(key, { point: [point.x, point.y], neighbors: [] });
            }
            return key;
        };

        segments.forEach((seg) => {
            const uKey = addNode(seg.start);
            const vKey = addNode(seg.end);
            if (uKey === vKey) return;

            const uNode = adjacency.get(uKey);
            const vNode = adjacency.get(vKey);
            const angleUV = Math.atan2(vNode.point[1] - uNode.point[1], vNode.point[0] - uNode.point[0]);
            const angleVU = Math.atan2(uNode.point[1] - vNode.point[1], uNode.point[0] - vNode.point[0]);

            uNode.neighbors.push({ key: vKey, angle: angleUV });
            vNode.neighbors.push({ key: uKey, angle: angleVU });
        });

        adjacency.forEach((node) => {
            node.neighbors.sort((a, b) => a.angle - b.angle);
        });

        return adjacency;
    }

    _extractFaces(graph, maxSegments) {
        const faces = [];
        const visited = new Set();
        // Increase max steps for complex floor plans with many cycles
        const maxSteps = Math.max(2000, maxSegments * 6);

        for (const [uKey, uNode] of graph.entries()) {
            for (const neighbor of uNode.neighbors) {
                const edgeKey = `${uKey}|${neighbor.key}`;
                if (visited.has(edgeKey)) continue;

                const polygon = this._walkFace(graph, uKey, neighbor.key, visited, maxSteps);
                if (polygon && polygon.length >= 3) {
                    // Filter out degenerate polygons (too small or self-intersecting)
                    const area = Math.abs(this._calculateSignedArea(polygon));
                    if (area > 0.1) { // Minimum 0.1 m²
                        faces.push(polygon);
                    }
                }
            }
        }

        console.log(`[RoomDetector] Extracted ${faces.length} faces from graph`);
        return faces;
    }

    _walkFace(graph, startKey, nextKey, visited, maxSteps) {
        const polygon = [];
        let currentKey = startKey;
        let followingKey = nextKey;
        let steps = 0;
        const pathEdges = [];

        while (steps < maxSteps) {
            const currentNode = graph.get(currentKey);
            if (!currentNode) return null;
            polygon.push(currentNode.point);

            const edgeKey = `${currentKey}|${followingKey}`;
            pathEdges.push(edgeKey);

            const nextNode = graph.get(followingKey);
            if (!nextNode || nextNode.neighbors.length === 0) return null;

            const neighborIndex = nextNode.neighbors.findIndex((n) => n.key === currentKey);
            if (neighborIndex === -1) return null;

            const nextIndex = (neighborIndex - 1 + nextNode.neighbors.length) % nextNode.neighbors.length;
            const nextNeighbor = nextNode.neighbors[nextIndex];

            currentKey = followingKey;
            followingKey = nextNeighbor.key;

            if (currentKey === startKey && followingKey === nextKey) {
                pathEdges.forEach(edge => visited.add(edge));
                break;
            }

            steps++;
        }

        if (steps >= maxSteps) return null;
        return polygon;
    }

    _filterFaces(faces, { minArea, precision }) {
        const filtered = [];
        faces.forEach((poly) => {
            if (!poly || poly.length < 3) return;
            const signed = this._calculateSignedArea(poly);
            const area = Math.abs(signed);
            if (area < minArea) return;
            if (!this.isValidPolygon(poly)) return;
            filtered.push({ polygon: poly, area, signed });
        });

        if (!filtered.length) return [];

        let outer = filtered[0];
        filtered.forEach((face) => {
            if (face.area > outer.area) outer = face;
        });

        const keepSign = outer.signed === 0 ? 0 : -Math.sign(outer.signed);
        const unique = new Map();

        filtered.forEach((face) => {
            if (keepSign !== 0 && Math.sign(face.signed) !== keepSign) return;
            const key = this._polygonKey(face.polygon, precision);
            if (!unique.has(key)) unique.set(key, face.polygon);
        });

        if (unique.size === 0) {
            filtered.forEach((face) => {
                if (face === outer) return;
                const key = this._polygonKey(face.polygon, precision);
                if (!unique.has(key)) unique.set(key, face.polygon);
            });
        }

        return Array.from(unique.values());
    }

    _filterFacesWithOuter(faces, { minArea, precision }) {
        const filtered = [];
        faces.forEach((poly) => {
            if (!poly || poly.length < 3) return;
            const signed = this._calculateSignedArea(poly);
            const area = Math.abs(signed);
            if (area < minArea) return;
            if (!this.isValidPolygon(poly)) return;
            filtered.push({ polygon: poly, area, signed });
        });

        if (!filtered.length) return { polygons: [], outer: null };

        let outer = filtered[0];
        filtered.forEach((face) => {
            if (face.area > outer.area) outer = face;
        });

        const unique = new Map();
        filtered.forEach((face) => {
            if (face === outer) return;
            const key = this._polygonKey(face.polygon, precision);
            if (!unique.has(key)) unique.set(key, face.polygon);
        });

        return { polygons: Array.from(unique.values()), outer: outer.polygon };
    }

    _mergePolygonSets(primary, secondary, snapTolerance) {
        const merged = [];
        const base = Array.isArray(primary) ? primary : [];
        const extra = Array.isArray(secondary) ? secondary : [];
        const tolerance = Number.isFinite(snapTolerance) ? snapTolerance : 0.1;

        base.forEach((poly) => {
            if (Array.isArray(poly) && poly.length >= 3) {
                merged.push(poly);
            }
        });

        extra.forEach((poly) => {
            if (!Array.isArray(poly) || poly.length < 3) return;
            if (this._polygonSimilar(poly, merged, tolerance)) return;
            merged.push(poly);
        });

        return merged;
    }

    _polygonSimilar(candidate, polygons, tolerance) {
        const area = Math.abs(this._calculateSignedArea(candidate));
        if (!Number.isFinite(area) || area <= 0) return false;
        const center = this.calculateCentroid(candidate) || { x: 0, y: 0 };
        const maxDistance = Math.max(tolerance * 4, 0.2);

        for (const poly of polygons) {
            const otherArea = Math.abs(this._calculateSignedArea(poly));
            if (!Number.isFinite(otherArea) || otherArea <= 0) continue;
            const areaDelta = Math.abs(otherArea - area) / Math.max(otherArea, area);
            if (areaDelta > 0.2) continue;

            const otherCenter = this.calculateCentroid(poly) || { x: 0, y: 0 };
            const dist = Math.hypot(otherCenter.x - center.x, otherCenter.y - center.y);
            if (dist <= maxDistance) {
                return true;
            }
        }

        return false;
    }

    _normalizeRoomPolygons(polygons, snapTolerance, minRoomArea) {
        const normalized = [];
        const tolerance = Number.isFinite(snapTolerance) ? snapTolerance : 0.1;
        const minArea = Number.isFinite(minRoomArea) ? minRoomArea : 0.5;
        const precision = this._precisionFromTolerance(tolerance);
        const unique = new Map();

        (polygons || []).forEach((polygon) => {
            const cleaned = this._cleanPolygon(polygon, tolerance * 0.5);
            if (!cleaned || cleaned.length < 3) return;
            const simplified = this.simplifyPolygon(cleaned, tolerance * 0.5);
            const finalPoly = this._cleanPolygon(simplified, tolerance * 0.5);
            if (!finalPoly || finalPoly.length < 3) return;
            const area = Math.abs(this._calculateSignedArea(finalPoly));
            if (!Number.isFinite(area) || area < minArea) return;
            const key = this._polygonKey(finalPoly, precision);
            if (!unique.has(key)) unique.set(key, finalPoly);
        });

        unique.forEach((poly) => normalized.push(poly));
        return normalized;
    }

    _buildBoundsEnvelope(bounds) {
        if (!bounds) return null;
        const minX = Number(bounds.minX);
        const minY = Number(bounds.minY);
        const maxX = Number(bounds.maxX);
        const maxY = Number(bounds.maxY);
        if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
        if (maxX <= minX || maxY <= minY) return null;
        return [
            { x: minX, y: minY },
            { x: maxX, y: minY },
            { x: maxX, y: maxY },
            { x: minX, y: maxY }
        ];
    }

    _cleanPolygon(polygon, epsilon) {
        if (!Array.isArray(polygon)) return null;
        const tol = Number.isFinite(epsilon) ? epsilon : 0;
        const cleaned = [];

        polygon.forEach((pt) => {
            const x = Array.isArray(pt) ? Number(pt[0]) : Number(pt.x);
            const y = Array.isArray(pt) ? Number(pt[1]) : Number(pt.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            if (cleaned.length) {
                const prev = cleaned[cleaned.length - 1];
                if (Math.hypot(prev[0] - x, prev[1] - y) <= tol) return;
            }
            cleaned.push([x, y]);
        });

        if (cleaned.length > 1) {
            const first = cleaned[0];
            const last = cleaned[cleaned.length - 1];
            if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= tol) {
                cleaned.pop();
            }
        }

        if (cleaned.length < 3) return cleaned;

        const filtered = [];
        for (let i = 0; i < cleaned.length; i++) {
            const prev = cleaned[(i - 1 + cleaned.length) % cleaned.length];
            const curr = cleaned[i];
            const next = cleaned[(i + 1) % cleaned.length];
            const cross = (curr[0] - prev[0]) * (next[1] - curr[1]) - (curr[1] - prev[1]) * (next[0] - curr[0]);
            if (Math.abs(cross) <= tol * tol) continue;
            filtered.push(curr);
        }

        return filtered.length >= 3 ? filtered : cleaned;
    }

    _detectRoomsByRaster(walls, forbiddenZones, bounds, options = {}) {
        if (!bounds || !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.maxY)) {
            return [];
        }

        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;
        if (!(width > 0) || !(height > 0)) return [];

        let gridSize = Number.isFinite(options.gridSize) ? Number(options.gridSize) : 0.2;
        const maxGridCells = Number.isFinite(options.maxGridCells) ? Number(options.maxGridCells) : 250000;
        const totalCells = Math.ceil(width / gridSize) * Math.ceil(height / gridSize);
        if (totalCells > maxGridCells) {
            gridSize = Math.sqrt((width * height) / maxGridCells);
        }

        const cols = Math.max(1, Math.ceil(width / gridSize));
        const rows = Math.max(1, Math.ceil(height / gridSize));
        const minRoomArea = Number.isFinite(options.minRoomArea) ? options.minRoomArea : 0.5;

        const grid = new Uint8Array(rows * cols);
        const snapTolerance = Number.isFinite(options.snapTolerance) ? Number(options.snapTolerance) : 0.1;
        const gapTolerance = Number.isFinite(options.gapTolerance) ? Number(options.gapTolerance) : snapTolerance;
        // Increase wall thickness to close micro-gaps during rasterization
        const wallThickness = Number.isFinite(options.wallThickness)
            ? Number(options.wallThickness)
            : Math.max(0.1, Math.max(gapTolerance * 1.5, gridSize * 0.8));
        const wallSegments = this._collectWallSegments(walls);
        const extraSegments = [];

        if (Array.isArray(forbiddenZones) && forbiddenZones.length) {
            extraSegments.push(...this._collectWallSegments(forbiddenZones));
        }
        if (Array.isArray(options.entrances) && options.entrances.length) {
            extraSegments.push(...this._collectWallSegments(options.entrances));
        }

        const allSegments = wallSegments.concat(extraSegments);
        if (!allSegments.length) return [];

        const snapper = this._createSnapper(gapTolerance);
        const snapperState = {
            xSnapper: this._createScalarSnapper(snapTolerance),
            ySnapper: this._createScalarSnapper(snapTolerance)
        };
        let snapped = this._snapSegments(allSegments, snapTolerance, snapperState, snapper);
        const gapResult = this._snapEndpointsToSegments(snapped, gapTolerance, snapper);
        snapped = this._snapSegments(gapResult.segments, snapTolerance, snapperState, snapper);

        snapped.forEach((seg) => {
            this._rasterizeSegment(grid, rows, cols, bounds.minX, bounds.minY, gridSize, wallThickness, seg.start, seg.end);
        });

        const outside = new Uint8Array(rows * cols);
        const queue = [];
        const enqueue = (row, col) => {
            if (row < 0 || row >= rows || col < 0 || col >= cols) return;
            const idx = row * cols + col;
            if (grid[idx] !== 0 || outside[idx] === 1) return;
            outside[idx] = 1;
            queue.push(idx);
        };

        for (let col = 0; col < cols; col++) {
            enqueue(0, col);
            enqueue(rows - 1, col);
        }
        for (let row = 0; row < rows; row++) {
            enqueue(row, 0);
            enqueue(row, cols - 1);
        }

        let head = 0;
        while (head < queue.length) {
            const idx = queue[head++];
            const row = Math.floor(idx / cols);
            const col = idx % cols;
            enqueue(row - 1, col);
            enqueue(row + 1, col);
            enqueue(row, col - 1);
            enqueue(row, col + 1);
        }

        const visited = new Uint8Array(rows * cols);
        const regionMask = new Uint8Array(rows * cols);
        const cellArea = gridSize * gridSize;
        const polygons = [];

        for (let idx = 0; idx < grid.length; idx++) {
            if (grid[idx] !== 0 || outside[idx] === 1 || visited[idx] === 1) {
                continue;
            }

            const regionCells = [];
            queue.length = 0;
            head = 0;
            queue.push(idx);
            visited[idx] = 1;
            regionMask[idx] = 1;

            while (head < queue.length) {
                const current = queue[head++];
                regionCells.push(current);
                const row = Math.floor(current / cols);
                const col = current % cols;
                const neighbors = [
                    [row - 1, col],
                    [row + 1, col],
                    [row, col - 1],
                    [row, col + 1]
                ];
                neighbors.forEach(([nr, nc]) => {
                    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return;
                    const nIdx = nr * cols + nc;
                    if (grid[nIdx] !== 0 || outside[nIdx] === 1 || visited[nIdx] === 1) return;
                    visited[nIdx] = 1;
                    regionMask[nIdx] = 1;
                    queue.push(nIdx);
                });
            }

            const regionArea = regionCells.length * cellArea;
            if (!Number.isFinite(regionArea) || regionArea < minRoomArea) {
                regionCells.forEach(cell => { regionMask[cell] = 0; });
                continue;
            }

            const polygon = this._traceRegionBoundary(regionMask, regionCells, rows, cols, bounds.minX, bounds.minY, gridSize);
            if (polygon && polygon.length >= 3) {
                polygons.push(polygon);
            }

            regionCells.forEach(cell => { regionMask[cell] = 0; });
        }

        return polygons;
    }

    _rasterizeSegment(grid, rows, cols, originX, originY, cellSize, thickness, start, end) {
        const x1 = Number(start.x);
        const y1 = Number(start.y);
        const x2 = Number(end.x);
        const y2 = Number(end.y);
        if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
            return;
        }

        const minX = Math.min(x1, x2) - thickness;
        const maxX = Math.max(x1, x2) + thickness;
        const minY = Math.min(y1, y2) - thickness;
        const maxY = Math.max(y1, y2) + thickness;

        const minCol = Math.max(0, Math.floor((minX - originX) / cellSize));
        const maxCol = Math.min(cols - 1, Math.floor((maxX - originX) / cellSize));
        const minRow = Math.max(0, Math.floor((minY - originY) / cellSize));
        const maxRow = Math.min(rows - 1, Math.floor((maxY - originY) / cellSize));

        for (let row = minRow; row <= maxRow; row++) {
            const cy = originY + (row + 0.5) * cellSize;
            for (let col = minCol; col <= maxCol; col++) {
                const cx = originX + (col + 0.5) * cellSize;
                const dist = GeometryHelpers.pointToSegmentDistance({ x: cx, y: cy }, { x: x1, y: y1 }, { x: x2, y: y2 });
                if (dist <= thickness) {
                    grid[row * cols + col] = 1;
                }
            }
        }
    }

    _traceRegionBoundary(regionMask, regionCells, rows, cols, originX, originY, cellSize) {
        const edges = new Map();
        const addEdge = (sx, sy, ex, ey) => {
            const startKey = `${sx},${sy}`;
            const endKey = `${ex},${ey}`;
            if (!edges.has(startKey)) edges.set(startKey, []);
            edges.get(startKey).push(endKey);
        };

        regionCells.forEach((cell) => {
            const row = Math.floor(cell / cols);
            const col = cell % cols;
            const x0 = col;
            const x1 = col + 1;
            const y0 = row;
            const y1 = row + 1;

            if (row + 1 >= rows || regionMask[(row + 1) * cols + col] === 0) {
                addEdge(x0, y1, x1, y1);
            }
            if (col + 1 >= cols || regionMask[row * cols + (col + 1)] === 0) {
                addEdge(x1, y1, x1, y0);
            }
            if (row - 1 < 0 || regionMask[(row - 1) * cols + col] === 0) {
                addEdge(x1, y0, x0, y0);
            }
            if (col - 1 < 0 || regionMask[row * cols + (col - 1)] === 0) {
                addEdge(x0, y0, x0, y1);
            }
        });

        const used = new Set();
        const loops = [];
        const maxSteps = regionCells.length * 8 + 50;

        for (const [startKey, endList] of edges.entries()) {
            for (const endKey of endList) {
                const edgeKey = `${startKey}|${endKey}`;
                if (used.has(edgeKey)) continue;

                const loop = [];
                let currentKey = startKey;
                let nextKey = endKey;
                let steps = 0;

                while (steps < maxSteps) {
                    const [sx, sy] = currentKey.split(',').map(Number);
                    loop.push([sx, sy]);
                    used.add(`${currentKey}|${nextKey}`);

                    const nextEdges = edges.get(nextKey);
                    if (!nextEdges || nextEdges.length === 0) break;

                    let found = null;
                    for (const candidate of nextEdges) {
                        const candidateKey = `${nextKey}|${candidate}`;
                        if (!used.has(candidateKey)) {
                            found = candidate;
                            break;
                        }
                    }

                    if (!found) break;

                    currentKey = nextKey;
                    nextKey = found;

                    if (currentKey === startKey && nextKey === endKey) {
                        break;
                    }

                    steps++;
                }

                if (loop.length >= 3) {
                    loops.push(loop);
                }
            }
        }

        if (!loops.length) return null;

        let bestLoop = null;
        let bestArea = 0;

        loops.forEach((loop) => {
            const simplified = this._simplifyGridLoop(loop);
            if (simplified.length < 3) return;
            const world = simplified.map(pt => [originX + pt[0] * cellSize, originY + pt[1] * cellSize]);
            const area = Math.abs(this._calculateSignedArea(world));
            if (area > bestArea) {
                bestArea = area;
                bestLoop = simplified;
            }
        });

        if (!bestLoop) return null;

        const simplified = this._simplifyGridLoop(bestLoop);
        const world = simplified.map(pt => [originX + pt[0] * cellSize, originY + pt[1] * cellSize]);
        return world;
    }

    _simplifyGridLoop(points) {
        if (!Array.isArray(points) || points.length < 3) return points;
        const result = [];
        const total = points.length;

        for (let i = 0; i < total; i++) {
            const prev = points[(i - 1 + total) % total];
            const curr = points[i];
            const next = points[(i + 1) % total];
            const dx1 = curr[0] - prev[0];
            const dy1 = curr[1] - prev[1];
            const dx2 = next[0] - curr[0];
            const dy2 = next[1] - curr[1];
            const cross = dx1 * dy2 - dy1 * dx2;
            if (cross === 0) {
                continue;
            }
            result.push(curr);
        }

        return result.length >= 3 ? result : points;
    }

    _calculateSignedArea(polygon) {
        if (!polygon || polygon.length < 3) return 0;
        let area = 0;
        for (let i = 0; i < polygon.length; i++) {
            const j = (i + 1) % polygon.length;
            area += polygon[i][0] * polygon[j][1];
            area -= polygon[j][0] * polygon[i][1];
        }
        return area / 2;
    }

    _polygonKey(polygon, precision) {
        const rounded = polygon.map((pt) => ([
            Number(pt[0].toFixed(precision)),
            Number(pt[1].toFixed(precision))
        ]));

        const forwardIdx = this._minPointIndex(rounded);
        const forward = this._rotateArray(rounded, forwardIdx);

        const reversed = [...rounded].reverse();
        const reverseIdx = this._minPointIndex(reversed);
        const reverseSeq = this._rotateArray(reversed, reverseIdx);

        const forwardKey = forward.map(pt => `${pt[0]},${pt[1]}`).join('|');
        const reverseKey = reverseSeq.map(pt => `${pt[0]},${pt[1]}`).join('|');

        return forwardKey < reverseKey ? forwardKey : reverseKey;
    }

    _minPointIndex(points) {
        let minIdx = 0;
        for (let i = 1; i < points.length; i++) {
            if (points[i][0] < points[minIdx][0] ||
                (points[i][0] === points[minIdx][0] && points[i][1] < points[minIdx][1])) {
                minIdx = i;
            }
        }
        return minIdx;
    }

    _rotateArray(arr, index) {
        return arr.slice(index).concat(arr.slice(0, index));
    }

    _buildGraph(walls) {
        const adjacency = new Map(); // key: pointKey -> { point: [x,y], neighbors: [{point, angle, wallIdx}] }
        const tolerance = 0.1; // 10cm snap

        const getOrAddNode = (p) => {
            const key = this.pointKey(p);
            if (!adjacency.has(key)) {
                adjacency.set(key, { point: this.normalizePoint(p), neighbors: [] });
            }
            return key;
        };

        walls.forEach((wall, idx) => {
            if (!wall || !wall.start || !wall.end) return;
            const uKey = getOrAddNode(wall.start);
            const vKey = getOrAddNode(wall.end);

            if (uKey === vKey) return; // ignore zero-length

            const uNode = adjacency.get(uKey);
            const vNode = adjacency.get(vKey);

            // Add directed edges
            const angleUV = Math.atan2(vNode.point[1] - uNode.point[1], vNode.point[0] - uNode.point[0]);
            const angleVU = Math.atan2(uNode.point[1] - vNode.point[1], uNode.point[0] - vNode.point[0]);

            uNode.neighbors.push({ key: vKey, angle: angleUV, wallIdx: idx });
            vNode.neighbors.push({ key: uKey, angle: angleVU, wallIdx: idx });
        });

        // Sort neighbors by angle for "turn left" lookup
        for (const node of adjacency.values()) {
            node.neighbors.sort((a, b) => a.angle - b.angle);
        }

        return adjacency;
    }

    _findCyclesLeft(graph) {
        const cycles = [];
        const visitedEdges = new Set(); // set of "uKey|vKey"

        // Debug: Graph statistics
        let totalEdges = 0;
        for (const node of graph.values()) {
            totalEdges += node.neighbors.length;
        }
        console.log(`[GraphCycle] Graph: ${graph.size} nodes, ${totalEdges / 2} edges`);

        let attemptCount = 0;
        let closedCount = 0;
        let breakReasons = { noNode: 0, deadEnd: 0, badAngle: 0, visitedEdge: 0, maxSteps: 0 };

        for (const [uKey, uNode] of graph.entries()) {
            for (const neighbor of uNode.neighbors) {
                const vKey = neighbor.key;
                const edgeKey = `${uKey}|${vKey}`;

                if (visitedEdges.has(edgeKey)) continue;
                attemptCount++;

                // Trace a cycle
                const path = [uNode.point];
                let currKey = vKey;
                let prevKey = uKey;
                let startKey = uKey;

                // Track this traversal
                const currentTraversalEdges = new Set();
                currentTraversalEdges.add(edgeKey);

                let steps = 0;
                let closed = false;

                while (steps < 2000) { // Safety break
                    const currNodeCheck = graph.get(currKey);
                    if (!currNodeCheck) {
                        breakReasons.noNode++;
                        break;
                    }

                    path.push(currNodeCheck.point);

                    if (currKey === startKey && path.length > 2) {
                        closed = true;
                        break;
                    }

                    // Find next edge: "most left" relative to entry angle (prev -> curr)
                    const currNode = graph.get(currKey);
                    if (!currNode || currNode.neighbors.length === 0) {
                        breakReasons.deadEnd++;
                        break;
                    }

                    // Entry angle (prev -> curr)
                    const prevNode = graph.get(prevKey);
                    if (!prevNode) {
                        breakReasons.noNode++;
                        break;
                    }

                    // The incoming edge is curr -> prev, find its angle
                    const backAngle = Math.atan2(prevNode.point[1] - currNode.point[1], prevNode.point[0] - currNode.point[0]);

                    // Find index of edge pointing to prev using minimum angle difference
                    let entryIdx = -1;
                    let minDiff = Infinity;

                    for (let i = 0; i < currNode.neighbors.length; i++) {
                        const n = currNode.neighbors[i];
                        // Angle diff (handle wraparound)
                        let diff = Math.abs(n.angle - backAngle);
                        if (diff > Math.PI) diff = 2 * Math.PI - diff;
                        if (diff < minDiff) {
                            minDiff = diff;
                            entryIdx = i;
                        }
                    }

                    if (entryIdx === -1 || minDiff > 0.2) {
                        // No valid back-edge found (tolerance ~11 degrees)
                        breakReasons.badAngle++;
                        break;
                    }

                    // Next neighbor in sorted list (CCW) is the "left-most" turn
                    // (Ensure modulo wrap)
                    const nextIdx = (entryIdx + 1) % currNode.neighbors.length;
                    const nextNeighbor = currNode.neighbors[nextIdx];

                    // Key for next step
                    const nextEdgeKey = `${currKey}|${nextNeighbor.key}`;

                    if (visitedEdges.has(nextEdgeKey)) {
                        // We hit an edge already fully processed in a previous cycle?
                        breakReasons.visitedEdge++;
                        break;
                    }

                    currentTraversalEdges.add(nextEdgeKey);
                    prevKey = currKey;
                    currKey = nextNeighbor.key;
                    steps++;

                    if (steps >= 2000) {
                        breakReasons.maxSteps++;
                    }
                }

                if (closed) {
                    closedCount++;
                    // Mark edges as visited so we don't trace this face again
                    for (const k of currentTraversalEdges) visitedEdges.add(k);

                    // Log path length before and after pop
                    const beforePop = path.length;
                    // Don't pop the last point if cycle closed correctly - path should already have unique points
                    // Actually, the issue is: we're adding currKey.point THEN checking if we closed
                    // So path already has start point duplicated at end
                    // path.pop(); // Remove duplicate closing point - but only if really duplicated

                    // Check if last point equals first point - only pop if duplicate
                    const first = path[0];
                    const last = path[path.length - 1];
                    if (first && last && Math.abs(first[0] - last[0]) < 0.01 && Math.abs(first[1] - last[1]) < 0.01) {
                        path.pop();
                    }

                    if (closedCount <= 5) {
                        console.log(`[GraphCycle] Cycle ${closedCount}: beforePop=${beforePop}, afterPop=${path.length}`);
                    }

                    if (path.length >= 3) {
                        cycles.push(path);
                    }
                } else {
                    // If not closed (dead end), mark the initial edge as visited to avoid re-trying
                    visitedEdges.add(edgeKey);
                }
            }
        }

        console.log(`[GraphCycle] Attempts: ${attemptCount}, Closed: ${closedCount}, Cycles: ${cycles.length}`);
        console.log(`[GraphCycle] Break reasons:`, breakReasons);

        return cycles;
    }

    segmentOpenAreas(walls, entrances, forbiddenZones, bounds) {
        // Use graph-based segmentation for open areas
        const graph = this.buildWallGraph(walls);
        const voronoiRegions = this.generateVoronoiRegions(graph, bounds);

        // Filter regions that form valid rooms (avoid entrances/forbidden)
        return voronoiRegions.filter(region => {
            const area = this.calculatePolygonArea(region);
            const intersectsEntrance = entrances.some(e => this.polygonsIntersect(region, e.polygon || [e.start, e.end]));
            const intersectsForbidden = forbiddenZones.some(z => this.polygonsIntersect(region, z.polygon));
            return area > 1 && !intersectsEntrance && !intersectsForbidden;
        });
    }

    buildWallGraph(walls) {
        const nodes = new Map();
        const edges = [];

        const addNode = (rawPoint) => {
            const normalized = this.normalizePoint(rawPoint);
            const key = this.pointKey(normalized);
            if (!nodes.has(key)) {
                // store a fresh copy to avoid accidental mutation downstream
                nodes.set(key, [normalized[0], normalized[1]]);
            }
            return nodes.get(key);
        };

        const addEdge = (startPoint, endPoint, wallIndex) => {
            const from = addNode(startPoint);
            const to = addNode(endPoint);
            edges.push({ from, to, wallIndex });
        };

        walls.forEach((wall, index) => {
            if (
                !wall ||
                !wall.start || !wall.end ||
                !Number.isFinite(wall.start.x) ||
                !Number.isFinite(wall.start.y) ||
                !Number.isFinite(wall.end.x) ||
                !Number.isFinite(wall.end.y)
            ) {
                return;
            }
            if (wall.start && wall.end) {
                addEdge(wall.start, wall.end, index);
            } else if (Array.isArray(wall.polygon) && wall.polygon.length >= 2) {
                for (let i = 0; i < wall.polygon.length - 1; i++) {
                    addEdge(wall.polygon[i], wall.polygon[i + 1], index);
                }
                if (wall.polygon.length > 2) {
                    addEdge(wall.polygon[wall.polygon.length - 1], wall.polygon[0], index);
                }
            }
        });

        const nodeList = Array.from(nodes.values());
        const hull = this.computeConcaveHull(nodeList);
        return { nodes: nodeList, edges, hull };
    }

    generateVoronoiRegions(graph, bounds) {
        // Simplified Voronoi-like partitioning using Delaunay triangulation
        const points = graph.nodes;
        const triangles = this.delaunayTriangulate(points);

        // Merge adjacent triangles into regions
        const regions = this.mergeTrianglesIntoRegions(triangles, graph.edges, bounds);
        return regions.map(region => this.convexHull(region)); // Ensure convex rooms
    }

    delaunayTriangulate(points) {
        // Incremental Delaunay triangulation
        if (points.length < 3) return [];

        const triangles = [];
        const superTriangle = this.createSuperTriangle(points);
        triangles.push(superTriangle);

        for (const point of points) {
            const badTriangles = [];
            const edges = [];

            // Find triangles that contain the point
            for (const triangle of triangles) {
                if (this.pointInTriangle(point, triangle)) {
                    badTriangles.push(triangle);
                }
            }

            // Find boundary edges
            for (const triangle of badTriangles) {
                for (let i = 0; i < 3; i++) {
                    const edge = [triangle[i], triangle[(i + 1) % 3]];
                    let shared = false;
                    for (const other of badTriangles) {
                        if (other !== triangle && this.edgesEqual(edge, [other[0], other[1]]) ||
                            this.edgesEqual(edge, [other[1], other[2]]) ||
                            this.edgesEqual(edge, [other[2], other[0]])) {
                            shared = true;
                            break;
                        }
                    }
                    if (!shared) edges.push(edge);
                }
            }

            // Remove bad triangles
            for (const triangle of badTriangles) {
                const index = triangles.indexOf(triangle);
                if (index > -1) triangles.splice(index, 1);
            }

            // Add new triangles
            for (const edge of edges) {
                triangles.push([edge[0], edge[1], point]);
            }
        }

        // Remove triangles with super triangle vertices
        return triangles.filter(triangle =>
            !triangle.some(vertex => superTriangle.some(superVertex =>
                vertex[0] === superVertex[0] && vertex[1] === superVertex[1]
            ))
        );
    }

    createSuperTriangle(points) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of points) {
            minX = Math.min(minX, p[0]);
            minY = Math.min(minY, p[1]);
            maxX = Math.max(maxX, p[0]);
            maxY = Math.max(maxY, p[1]);
        }

        const dx = maxX - minX;
        const dy = maxY - minY;
        const deltaMax = Math.max(dx, dy);
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;

        return [
            [midX - 20 * deltaMax, midY - deltaMax],
            [midX, midY + 20 * deltaMax],
            [midX + 20 * deltaMax, midY - deltaMax]
        ];
    }

    pointInTriangle(point, triangle) {
        const [p1, p2, p3] = triangle;
        const area = this.calculatePolygonArea([p1, p2, p3]);
        const area1 = this.calculatePolygonArea([point, p2, p3]);
        const area2 = this.calculatePolygonArea([p1, point, p3]);
        const area3 = this.calculatePolygonArea([p1, p2, point]);
        return Math.abs(area - (area1 + area2 + area3)) < 1e-6;
    }

    edgesEqual(edge1, edge2) {
        return (edge1[0][0] === edge2[0][0] && edge1[0][1] === edge2[0][1] &&
            edge1[1][0] === edge2[1][0] && edge1[1][1] === edge2[1][1]) ||
            (edge1[0][0] === edge2[1][0] && edge1[0][1] === edge2[1][1] &&
                edge1[1][0] === edge2[0][0] && edge1[1][1] === edge2[0][1]);
    }

    mergeTrianglesIntoRegions(triangles, wallEdges, bounds) {
        // Union-find to merge triangles into regions based on shared edges not in walls
        const parent = new Map();
        const find = (x) => parent.get(x) === x ? x : parent.set(x, find(parent.get(x)));
        const union = (x, y) => parent.set(find(x), find(y));

        // Initialize each triangle as its own region
        triangles.forEach((triangle, i) => parent.set(i, i));

        // Merge triangles that share edges not present in wall edges
        for (let i = 0; i < triangles.length; i++) {
            for (let j = i + 1; j < triangles.length; j++) {
                if (this.trianglesShareNonWallEdge(triangles[i], triangles[j], wallEdges)) {
                    union(i, j);
                }
            }
        }

        // Group triangles by their root parent
        const regions = new Map();
        triangles.forEach((triangle, i) => {
            const root = find(i);
            if (!regions.has(root)) regions.set(root, []);
            regions.get(root).push(triangle);
        });

        // Convert groups to polygon regions
        return Array.from(regions.values()).map(group => {
            // Merge triangle polygons into a single polygon
            return this.mergeTrianglePolygons(group);
        });
    }

    trianglesShareNonWallEdge(triangle1, triangle2, wallEdges) {
        const edges1 = this.getTriangleEdges(triangle1);
        const edges2 = this.getTriangleEdges(triangle2);

        for (const edge1 of edges1) {
            for (const edge2 of edges2) {
                if (this.edgesEqual(edge1, edge2)) {
                    // Check if this edge is in wall edges
                    const isWallEdge = wallEdges.some(wallEdge =>
                        this.edgesEqual(edge1, [wallEdge.from, wallEdge.to])
                    );
                    if (!isWallEdge) return true;
                }
            }
        }
        return false;
    }

    getTriangleEdges(triangle) {
        const edges = [];
        for (let i = 0; i < 3; i++) {
            edges.push([triangle[i], triangle[(i + 1) % 3]]);
        }
        return edges;
    }

    mergeTrianglePolygons(triangles) {
        // Simple merge: combine all points and compute convex hull
        const allPoints = [];
        triangles.forEach(triangle => allPoints.push(...triangle));
        return this.convexHull(allPoints);
    }

    computeConcaveHull(points, alpha = 1) {
        if (!points || points.length === 0) return [];

        const uniquePoints = [];
        const seen = new Set();
        for (const pt of points) {
            const key = this.pointKey(pt);
            if (!seen.has(key)) {
                seen.add(key);
                uniquePoints.push(this.normalizePoint(pt));
            }
        }

        if (uniquePoints.length <= 3) {
            return uniquePoints;
        }

        const triangles = this.delaunayTriangulate(uniquePoints);

        // Filter triangles based on circumradius
        const validTriangles = triangles.filter(triangle => {
            const circumradius = this.getCircumradius(triangle);
            return circumradius <= alpha;
        });

        // Extract boundary edges
        const edgeCount = new Map();
        validTriangles.forEach(triangle => {
            const edges = this.getTriangleEdges(triangle);
            edges.forEach(edge => {
                const key = this.edgeKey(edge);
                edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
            });
        });

        // Boundary edges appear only once
        const boundaryEdges = [];
        edgeCount.forEach((count, key) => {
            if (count === 1) boundaryEdges.push(this.parseEdgeKey(key));
        });

        // Reconstruct polygon from boundary edges
        return this.reconstructPolygon(boundaryEdges);
    }

    getCircumradius(triangle) {
        const [p1, p2, p3] = triangle;
        const a = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        const b = Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
        const c = Math.hypot(p1[0] - p3[0], p1[1] - p3[1]);
        const s = (a + b + c) / 2;
        const area = Math.sqrt(Math.max(s * (s - a) * (s - b) * (s - c), 0));
        if (!Number.isFinite(area) || area === 0) {
            return Infinity;
        }
        return (a * b * c) / (4 * area);
    }

    edgeKey(edge) {
        const [p1, p2] = edge;
        return `${Math.min(p1[0], p2[0])},${Math.min(p1[1], p2[1])}-${Math.max(p1[0], p2[0])},${Math.max(p1[1], p2[1])}`;
    }

    parseEdgeKey(key) {
        const [p1Str, p2Str] = key.split('-');
        const p1 = p1Str.split(',').map(Number);
        const p2 = p2Str.split(',').map(Number);
        return [p1, p2];
    }

    reconstructPolygon(edges) {
        if (edges.length === 0) return [];

        const polygon = [edges[0][0], edges[0][1]];
        edges.splice(0, 1);

        while (edges.length > 0) {
            const lastPoint = polygon[polygon.length - 1];
            let found = false;
            for (let i = 0; i < edges.length; i++) {
                const edge = edges[i];
                if (this.pointsEqual(lastPoint, edge[0])) {
                    polygon.push(edge[1]);
                    edges.splice(i, 1);
                    found = true;
                    break;
                } else if (this.pointsEqual(lastPoint, edge[1])) {
                    polygon.push(edge[0]);
                    edges.splice(i, 1);
                    found = true;
                    break;
                }
            }
            if (!found) break; // Cannot continue
        }

        return polygon;
    }

    pointsEqual(p1, p2, epsilon = 1e-6) {
        return Math.abs(p1[0] - p2[0]) < epsilon && Math.abs(p1[1] - p2[1]) < epsilon;
    }

    simplifyPolygon(polygon, epsilon = 0.1) {
        if (polygon.length <= 2) return polygon;
        return this.douglasPeucker(polygon, epsilon);
    }

    douglasPeucker(points, epsilon) {
        if (points.length <= 2) return points;

        let maxDist = 0;
        let index = 0;
        const end = points.length - 1;

        for (let i = 1; i < end; i++) {
            const dist = this.perpendicularDistance(points[i], points[0], points[end]);
            if (dist > maxDist) {
                index = i;
                maxDist = dist;
            }
        }

        if (maxDist > epsilon) {
            const left = this.douglasPeucker(points.slice(0, index + 1), epsilon);
            const right = this.douglasPeucker(points.slice(index), epsilon);
            return left.slice(0, -1).concat(right);
        } else {
            return [points[0], points[end]];
        }
    }

    perpendicularDistance(point, lineStart, lineEnd) {
        const dx = lineEnd[0] - lineStart[0];
        const dy = lineEnd[1] - lineStart[1];
        const mag = Math.sqrt(dx * dx + dy * dy);
        if (mag > 0) {
            const dx1 = point[0] - lineStart[0];
            const dy1 = point[1] - lineStart[1];
            const cross = dx1 * dy - dy1 * dx;
            return Math.abs(cross) / mag;
        }
        return 0;
    }

    isValidPolygon(polygon) {
        // Check no self-intersections, clockwise/counter-clockwise
        const area = this.calculatePolygonArea(polygon);
        return area > 0 && !this.hasSelfIntersections(polygon);
    }

    hasSelfIntersections(polygon) {
        // Check for line segment intersections
        const n = polygon.length;
        for (let i = 0; i < n; i++) {
            for (let j = i + 2; j < n; j++) {
                if ((i === j) || ((i + 1) % n === j) || (i === (j + 1) % n)) {
                    continue; // Adjacent segments share a vertex; skip
                }
                if (this.segmentsIntersect(polygon[i], polygon[(i + 1) % n], polygon[j], polygon[(j + 1) % n])) {
                    return true;
                }
            }
        }
        return false;
    }

    segmentsIntersect(p1, p2, p3, p4) {
        // Standard line segment intersection check
        const denom = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
        if (denom === 0) return false;

        const t = ((p1[0] - p3[0]) * (p3[1] - p4[1]) - (p1[1] - p3[1]) * (p3[0] - p4[0])) / denom;
        const u = -((p1[0] - p2[0]) * (p1[1] - p3[1]) - (p1[1] - p2[1]) * (p1[0] - p3[0])) / denom;

        return t >= 0 && t <= 1 && u >= 0 && u <= 1;
    }

    polygonsIntersect(poly1, poly2) {
        // Check if any edges intersect or one is inside the other
        for (let i = 0; i < poly1.length; i++) {
            for (let j = 0; j < poly2.length; j++) {
                if (this.segmentsIntersect(poly1[i], poly1[(i + 1) % poly1.length], poly2[j], poly2[(j + 1) % poly2.length])) {
                    return true;
                }
            }
        }
        // Point-in-polygon check for containment
        return poly2.some(pt => this.pointInPolygon(pt, poly1));
    }

    pointInPolygon(point, polygon) {
        // Ray casting algorithm
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            if ((polygon[i][1] > point[1]) !== (polygon[j][1] > point[1]) &&
                (point[0] < (polygon[j][0] - polygon[i][0]) * (point[1] - polygon[i][1]) / (polygon[j][1] - polygon[i][1]) + polygon[i][0])) {
                inside = !inside;
            }
        }
        return inside;
    }

    deduplicatePolygons(polygons) {
        // Remove overlapping/duplicate polygons using Jaccard similarity > 0.8
        const unique = [];
        for (let poly of polygons) {
            const isDuplicate = unique.some(existing => {
                const intersection = this.polygonIntersection(poly, existing);
                const union = this.polygonUnion(poly, existing);
                return intersection / union > 0.8;
            });
            if (!isDuplicate) unique.push(poly);
        }
        return unique;
    }

    polygonIntersection(poly1, poly2) {
        // Sutherland-Hodgman clipping algorithm
        if (!poly1 || !poly2 || poly1.length < 3 || poly2.length < 3) return 0;

        let output = poly1.slice();
        const subject = poly2;

        for (let i = 0; i < subject.length; i++) {
            const clipEdge = [subject[i], subject[(i + 1) % subject.length]];
            const input = output.slice();
            output = [];

            for (let j = 0; j < input.length; j++) {
                const current = input[j];
                const prev = input[(j - 1 + input.length) % input.length];

                if (this.isInside(current, clipEdge)) {
                    if (!this.isInside(prev, clipEdge)) {
                        output.push(this.computeIntersection(prev, current, clipEdge));
                    }
                    output.push(current);
                } else if (this.isInside(prev, clipEdge)) {
                    output.push(this.computeIntersection(prev, current, clipEdge));
                }
            }
        }

        return this.calculatePolygonArea(output);
    }

    isInside(point, edge) {
        const [p1, p2] = edge;
        return (p2[0] - p1[0]) * (point[1] - p1[1]) > (p2[1] - p1[1]) * (point[0] - p1[0]);
    }

    computeIntersection(p1, p2, edge) {
        const [e1, e2] = edge;
        const dx1 = p2[0] - p1[0];
        const dy1 = p2[1] - p1[1];
        const dx2 = e2[0] - e1[0];
        const dy2 = e2[1] - e1[1];

        const denom = dx1 * dy2 - dy1 * dx2;
        if (Math.abs(denom) < 1e-10) return p1; // parallel lines

        const t = ((e1[0] - p1[0]) * dy2 - (e1[1] - p1[1]) * dx2) / denom;
        return [
            p1[0] + t * dx1,
            p1[1] + t * dy1
        ];
    }

    polygonUnion(poly1, poly2) {
        // Union area
        return this.calculatePolygonArea(poly1) + this.calculatePolygonArea(poly2); // Simplified
    }

    classifyRoomType(polygon, area, center, entrances, forbiddenZones) {
        // Rule-based classification
        if (area < 5) return 'utility'; // Closet, bathroom
        if (area < 20) return 'office'; // Single/double desk
        if (area < 50) return 'meeting'; // Conference
        if (this.isNearEntrances(center, entrances, 5)) return 'entry';
        if (this.isNearForbidden(center, forbiddenZones, 10)) return 'circulation';
        return 'hall'; // Large open space
    }

    getRoomSubtype(type, area, bounds) {
        const aspect = (bounds.maxX - bounds.minX) / (bounds.maxY - bounds.minY);
        if (aspect > 2 || aspect < 0.5) return 'elongated';
        if (this.isRectangular(bounds)) return 'rectangular';
        return 'irregular';
    }

    isNearEntrances(center, entrances, threshold) {
        return entrances.some(e => {
            const dist = Math.sqrt(Math.pow(center.x - e.center?.x || e.start.x, 2) + Math.pow(center.y - e.center?.y || e.start.y, 2));
            return dist < threshold;
        });
    }

    isNearForbidden(center, forbiddenZones, threshold) {
        return forbiddenZones.some(z => {
            const dist = Math.sqrt(Math.pow(center.x - z.center.x, 2) + Math.pow(center.y - z.center.y, 2));
            return dist < threshold;
        });
    }

    isRectangular(bounds) {
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;
        const diagonal = Math.sqrt(width * width + height * height);
        const sides = 2 * (width + height);
        return Math.abs(sides - 4 * diagonal / Math.sqrt(2)) < 1; // Approx rectangle
    }

    getAdjacentElements(polygon, entrances, forbiddenZones) {
        const adj = { entrances: [], forbidden: [] };
        entrances.forEach((e, idx) => {
            if (this.polygonsIntersect(polygon, e.polygon || [e.start, e.end])) {
                adj.entrances.push(idx);
            }
        });
        forbiddenZones.forEach((z, idx) => {
            if (this.polygonsIntersect(polygon, z.polygon)) {
                adj.forbidden.push(idx);
            }
        });
        return adj;
    }

    convexHull(points) {
        // Andrew's monotone chain
        if (points.length < 3) return points;

        points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

        const lower = [];
        for (let pt of points) {
            while (lower.length >= 2 && this.cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) {
                lower.pop();
            }
            lower.push(pt);
        }

        const upper = [];
        for (let i = points.length - 1; i >= 0; i--) {
            const pt = points[i];
            while (upper.length >= 2 && this.cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) {
                upper.pop();
            }
            upper.push(pt);
        }

        upper.pop();
        lower.pop();
        return [...lower, ...upper];
    }

    cross(o, a, b) {
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    }

    tracePolygon(segments, startIndex, used, maxSteps = 200) {
        const polygon = [];
        const tolerance = 0.05; // Tighter tolerance for advanced

        let currentIndex = startIndex;
        let currentPoint = { ...segments[startIndex].start };
        polygon.push([currentPoint.x, currentPoint.y]);

        used.add(currentIndex);
        currentPoint = { ...segments[currentIndex].end };

        let steps = 0;
        while (steps < maxSteps) {
            polygon.push([currentPoint.x, currentPoint.y]);

            // Check closure with tolerance
            const firstPoint = polygon[0];
            const dist = Math.hypot(currentPoint.x - firstPoint[0], currentPoint.y - firstPoint[1]);

            if (dist < tolerance && polygon.length >= 3) {
                // Ensure no duplicates and drop closing duplicate
                const cleaned = polygon.filter((pt, i) => i === 0 || Math.hypot(pt[0] - polygon[i - 1][0], pt[1] - polygon[i - 1][1]) > tolerance);
                if (cleaned.length > 2 && this.pointsEqual(cleaned[0], cleaned[cleaned.length - 1])) {
                    cleaned.pop();
                }
                return cleaned;
            }

            // Find best next segment (closest start or end)
            let nextIndex = -1;
            let minDist = Infinity;
            let chosenDStart = Infinity;
            let chosenDEnd = Infinity;

            for (let i = 0; i < segments.length; i++) {
                if (used.has(i)) continue;

                // Distance to start
                let dStart = Math.hypot(segments[i].start.x - currentPoint.x, segments[i].start.y - currentPoint.y);
                // Distance to end (for bidirectional tracing)
                let dEnd = Math.hypot(segments[i].end.x - currentPoint.x, segments[i].end.y - currentPoint.y);

                const d = Math.min(dStart, dEnd);
                if (d < minDist && d < tolerance * 2) {
                    minDist = d;
                    nextIndex = i;
                    chosenDStart = dStart;
                    chosenDEnd = dEnd;
                }
            }

            if (nextIndex === -1) break;

            used.add(nextIndex);
            // Choose the closer endpoint as next current
            const seg = segments[nextIndex];
            if (chosenDStart <= chosenDEnd) {
                currentPoint = { ...seg.end };
            } else {
                currentPoint = { ...seg.start };
            }
            steps++;
        }

        return null;
    }

    calculatePolygonArea(polygon) {
        if (!polygon || polygon.length < 3) return 0;

        let area = 0;
        for (let i = 0; i < polygon.length; i++) {
            const j = (i + 1) % polygon.length;
            area += polygon[i][0] * polygon[j][1];
            area -= polygon[j][0] * polygon[i][1];
        }

        return Math.abs(area / 2);
    }

    calculateCentroid(polygon) {
        if (!polygon || polygon.length === 0) return { x: 0, y: 0 };

        // Weighted centroid using area
        let sumX = 0, sumY = 0, totalArea = 0;
        for (let i = 0; i < polygon.length; i++) {
            const j = (i + 1) % polygon.length;
            const factor = (polygon[i][0] * polygon[j][1] - polygon[j][0] * polygon[i][1]);
            sumX += (polygon[i][0] + polygon[j][0]) * factor;
            sumY += (polygon[i][1] + polygon[j][1]) * factor;
            totalArea += factor;
        }

        return {
            x: sumX / (6 * totalArea),
            y: sumY / (6 * totalArea)
        };
    }

    getPolygonBounds(polygon) {
        if (!polygon || polygon.length === 0) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        polygon.forEach(pt => {
            minX = Math.min(minX, pt[0]);
            minY = Math.min(minY, pt[1]);
            maxX = Math.max(maxX, pt[0]);
            maxY = Math.max(maxY, pt[1]);
        });

        return { minX, minY, maxX, maxY };
    }
}

module.exports = new RoomDetector();
