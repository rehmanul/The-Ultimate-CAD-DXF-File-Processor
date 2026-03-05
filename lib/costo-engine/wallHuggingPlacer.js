'use strict';

const GeometryHelpers = require('../geometryHelpers');
const { extractSegments, rectHitsWalls } = require('./geometry');

class WallHuggingPlacer {
    constructor(floorPlan = {}, options = {}) {
        this.floorPlan = floorPlan || {};
        this.walls = Array.isArray(floorPlan.walls) ? floorPlan.walls : [];
        this.envelope = Array.isArray(floorPlan.envelope) ? floorPlan.envelope : [];
        this.bounds = this._sanitizeBounds(floorPlan.bounds, this.walls);

        this.snapEpsilon = Number.isFinite(Number(options.snapEpsilon))
            ? Math.max(0.005, Number(options.snapEpsilon))
            : 0.05;
        this.minSegmentLength = Number.isFinite(Number(options.minSegmentLength))
            ? Math.max(0.2, Number(options.minSegmentLength))
            : 0.8;
        this.defaultClearance = Number.isFinite(Number(options.clearance))
            ? Math.max(0.05, Number(options.clearance))
            : 0.5;
        this.defaultDepth = Number.isFinite(Number(options.boxDepth))
            ? Math.max(0.8, Number(options.boxDepth))
            : 2.5;

        this.wallSegments = this._extractWallSegments(this.walls);
        this._perimeterSource = 'none';
    }

    computePerimeterSegments() {
        const perimeterPolygon = this._computePerimeterPolygon();
        if (!Array.isArray(perimeterPolygon) || perimeterPolygon.length < 3) {
            return { perimeterPolygon: [], segments: [], source: 'none' };
        }

        const normalized = this._ensureClockwise(this._sanitizePolygon(perimeterPolygon));
        if (!this._isPolygonValid(normalized)) {
            return { perimeterPolygon: [], segments: [], source: 'none' };
        }

        const segments = [];
        for (let i = 0; i < normalized.length; i++) {
            const p1 = normalized[i];
            const p2 = normalized[(i + 1) % normalized.length];
            const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            if (len < this.minSegmentLength) continue;
            segments.push({
                x1: p1.x,
                y1: p1.y,
                x2: p2.x,
                y2: p2.y,
                length: len,
                index: segments.length
            });
        }

        return {
            perimeterPolygon: normalized,
            segments,
            source: this._perimeterSource || 'unknown'
        };
    }

    computeInsetPerimeter(perimeterPolygon, clearance = this.defaultClearance) {
        const poly = this._ensureClockwise(this._sanitizePolygon(perimeterPolygon));
        if (!this._isPolygonValid(poly)) {
            return {
                polygon: [],
                segments: [],
                clearance: Number(clearance) || this.defaultClearance,
                collapsedVertices: 0
            };
        }

        const requested = Number.isFinite(Number(clearance))
            ? Math.max(0.02, Number(clearance))
            : this.defaultClearance;

        const inset = this._insetPolygon(poly, requested);
        const chosen = this._isPolygonValid(inset)
            ? inset
            : (this._isPolygonValid(this._insetPolygon(poly, requested * 0.5))
                ? this._insetPolygon(poly, requested * 0.5)
                : poly);

        const segments = this._polygonToSegments(chosen);
        const collapsedVertices = Math.max(0, poly.length - chosen.length);

        return {
            polygon: chosen,
            segments,
            clearance: requested,
            collapsedVertices
        };
    }

    placeBoxesAlongPerimeter(boxes, clearance = this.defaultClearance, options = {}) {
        const perimeter = this.computePerimeterSegments();
        if (!perimeter.segments.length) {
            return {
                units: [],
                diagnostics: { placed: 0, skippedNoPerimeter: 1 },
                perimeterPolygon: [],
                insetPerimeter: [],
                perimeterSource: 'none'
            };
        }

        const inset = this.computeInsetPerimeter(perimeter.perimeterPolygon, clearance);
        const insetPolygon = this._isPolygonValid(inset.polygon) ? inset.polygon : perimeter.perimeterPolygon;
        const insetSegments = this._polygonToSegments(insetPolygon).filter((s) => s.length >= this.minSegmentLength);

        const specs = this._normalizeBoxSpecs(boxes, {
            defaultDepth: Number.isFinite(Number(options.depth)) ? Number(options.depth) : this.defaultDepth,
            minWidth: Number.isFinite(Number(options.minWidth)) ? Number(options.minWidth) : 0.8
        });

        if (!specs.length) {
            return {
                units: [],
                diagnostics: { placed: 0, skippedNoSpecs: 1 },
                perimeterPolygon: perimeter.perimeterPolygon,
                insetPerimeter: insetPolygon,
                perimeterSource: perimeter.source
            };
        }

        const gap = Number.isFinite(Number(options.gap)) ? Math.max(0, Number(options.gap)) : 0.02;
        const overlapInset = Number.isFinite(Number(options.overlapInset)) ? Math.max(0, Number(options.overlapInset)) : 0.01;
        const wallClearance = Number.isFinite(Number(options.wallClearance)) ? Math.max(0, Number(options.wallClearance)) : 0;
        const isRectValid = typeof options.isRectValid === 'function' ? options.isRectValid : null;
        const wallSegments = Array.isArray(options.wallSegments) ? options.wallSegments : this.wallSegments;
        const targetCount = Number.isFinite(Number(options.targetCount)) ? Math.max(1, Number(options.targetCount)) : Infinity;
        const preferDensePlacement = options.preferDensePlacement !== false;

        const diagnostics = {
            segmentsVisited: insetSegments.length,
            skippedDiagonalSegments: 0,
            skippedOutsideInset: 0,
            skippedWallCollision: 0,
            skippedInvalid: 0,
            skippedOverlap: 0,
            skippedNoFit: 0,
            placed: 0
        };

        const units = [];
        let cycleIndex = 0;

        for (const segment of insetSegments) {
            if (units.length >= targetCount) break;

            const axis = this._segmentAxis(segment);
            if (axis === 'none') {
                diagnostics.skippedDiagonalSegments += 1;
                continue;
            }

            const tangent = {
                x: (segment.x2 - segment.x1) / Math.max(segment.length, 1e-9),
                y: (segment.y2 - segment.y1) / Math.max(segment.length, 1e-9)
            };
            const inward = { x: tangent.y, y: -tangent.x };
            let cursor = 0;

            while (cursor + 0.75 <= segment.length && units.length < targetCount) {
                const remaining = segment.length - cursor;
                const spec = this._pickSpecForRemaining(specs, remaining, cycleIndex, preferDensePlacement);
                cycleIndex += 1;

                if (!spec) {
                    diagnostics.skippedNoFit += 1;
                    break;
                }

                const rectInfo = this._buildRectOnSegment(segment, axis, tangent, inward, cursor, spec);
                cursor += spec.width + gap;

                if (!rectInfo || !rectInfo.rect || rectInfo.rect.width <= 0 || rectInfo.rect.height <= 0) {
                    diagnostics.skippedInvalid += 1;
                    continue;
                }

                const rect = rectInfo.rect;

                const inside = this._rectInsidePolygon(rect, insetPolygon, 0.06);
                if (!inside) {
                    diagnostics.skippedOutsideInset += 1;
                    continue;
                }

                if (wallSegments.length > 0 && rectHitsWalls(rect.x, rect.y, rect.width, rect.height, wallSegments, wallClearance)) {
                    diagnostics.skippedWallCollision += 1;
                    continue;
                }

                if (units.some((u) => this._rectsOverlap(rect, u, overlapInset))) {
                    diagnostics.skippedOverlap += 1;
                    continue;
                }

                if (isRectValid && !isRectValid(rect, spec, rectInfo)) {
                    diagnostics.skippedInvalid += 1;
                    continue;
                }

                units.push({
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    type: spec.type,
                    preferredWidth: spec.width,
                    preferredDepth: spec.depth,
                    axis,
                    inwardNormal: inward,
                    segmentIndex: segment.index,
                    source: 'wallHugging'
                });
                diagnostics.placed += 1;
            }
        }

        return {
            units,
            diagnostics,
            perimeterPolygon: perimeter.perimeterPolygon,
            insetPerimeter: insetPolygon,
            perimeterSource: perimeter.source
        };
    }

    _computePerimeterPolygon() {
        const envelopePolygon = this._polygonFromEnvelope(this.envelope);
        if (this._isPolygonReliable(envelopePolygon, 'envelope')) {
            this._perimeterSource = 'envelope';
            return envelopePolygon;
        }

        const wallLoop = this._polygonFromWalls(this.wallSegments);
        if (this._isPolygonReliable(wallLoop, 'walls')) {
            this._perimeterSource = 'walls';
            return wallLoop;
        }

        this._perimeterSource = 'boundsFallback';
        return this._boundsPolygon(this.bounds);
    }

    _polygonFromEnvelope(envelope) {
        if (!Array.isArray(envelope) || envelope.length === 0) return [];

        const directPoints = envelope
            .map((p) => this._toPoint(p))
            .filter(Boolean);

        if (directPoints.length >= 3) {
            return this._sanitizePolygon(directPoints);
        }

        const segs = this._extractWallSegments(envelope);
        if (!segs.length) return [];

        const loop = this._extractLargestLoop(segs);
        return this._sanitizePolygon(loop);
    }

    _polygonFromWalls(segments) {
        if (!Array.isArray(segments) || segments.length === 0) return [];

        const fullLoop = this._extractLargestLoop(segments);
        if (this._isPolygonReliable(fullLoop, 'walls')) {
            return this._sanitizePolygon(fullLoop);
        }

        const boundarySegments = this._segmentsNearBounds(segments, this.bounds);
        const boundaryLoop = this._extractLargestLoop(boundarySegments);
        if (this._isPolygonReliable(boundaryLoop, 'walls')) {
            return this._sanitizePolygon(boundaryLoop);
        }

        const points = [];
        for (const seg of segments) {
            points.push({ x: seg.x1, y: seg.y1 });
            points.push({ x: seg.x2, y: seg.y2 });
        }
        const hull = this._convexHull(points);
        if (this._isPolygonReliable(hull, 'walls')) {
            return this._sanitizePolygon(hull);
        }

        return [];
    }

    _isPolygonReliable(polygon, source = 'walls') {
        if (!this._isPolygonValid(polygon)) return false;
        const coverage = this._polygonCoverage(polygon, this.bounds);
        if (!coverage) return false;

        if (source === 'envelope') {
            return coverage.width >= 0.62 && coverage.height >= 0.62;
        }

        // Wall loops often include internal room loops; require broad coverage
        // so we keep only the outer envelope candidate.
        return (
            coverage.area >= 0.42 &&
            coverage.width >= 0.68 &&
            coverage.height >= 0.68
        );
    }

    _polygonCoverage(polygon, bounds) {
        if (!Array.isArray(polygon) || polygon.length < 3) return null;
        const b = bounds || this.bounds;
        if (!b || ![b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite)) return null;

        const bw = Math.max(1e-6, b.maxX - b.minX);
        const bh = Math.max(1e-6, b.maxY - b.minY);
        const bArea = bw * bh;

        const xs = polygon.map((p) => Number(p.x)).filter(Number.isFinite);
        const ys = polygon.map((p) => Number(p.y)).filter(Number.isFinite);
        if (!xs.length || !ys.length) return null;

        const polyArea = Math.abs(this._signedArea(polygon));
        return {
            area: bArea > 1e-6 ? polyArea / bArea : 1,
            width: Math.max(0, (Math.max(...xs) - Math.min(...xs)) / bw),
            height: Math.max(0, (Math.max(...ys) - Math.min(...ys)) / bh)
        };
    }

    _extractLargestLoop(segments) {
        const loops = this._extractLoopsFromSegments(segments);
        if (!loops.length) return [];

        let best = loops[0];
        let bestArea = Math.abs(this._signedArea(best));

        for (let i = 1; i < loops.length; i++) {
            const area = Math.abs(this._signedArea(loops[i]));
            if (area > bestArea) {
                best = loops[i];
                bestArea = area;
            }
        }

        return best;
    }

    _extractLoopsFromSegments(segments) {
        const nodes = new Map();
        const edges = [];

        const registerNode = (x, y) => {
            const key = this._snapKey(x, y, this.snapEpsilon);
            let node = nodes.get(key);
            if (!node) {
                node = { key, x, y, edges: [] };
                nodes.set(key, node);
            } else {
                node.x = (node.x + x) / 2;
                node.y = (node.y + y) / 2;
            }
            return node;
        };

        for (const seg of segments || []) {
            const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
            if (!Number.isFinite(len) || len < this.minSegmentLength * 0.35) continue;

            const a = registerNode(seg.x1, seg.y1);
            const b = registerNode(seg.x2, seg.y2);
            if (a.key === b.key) continue;

            const edge = {
                id: edges.length,
                a: a.key,
                b: b.key,
                used: false,
                length: len
            };
            edges.push(edge);
            a.edges.push(edge.id);
            b.edges.push(edge.id);
        }

        const loops = [];
        const maxSteps = Math.max(64, edges.length * 2);

        for (const edge of edges) {
            if (edge.used) continue;

            const startKey = edge.a;
            let prevKey = edge.a;
            let currKey = edge.b;
            const path = [
                { x: nodes.get(prevKey).x, y: nodes.get(prevKey).y },
                { x: nodes.get(currKey).x, y: nodes.get(currKey).y }
            ];
            edge.used = true;

            let closed = false;
            for (let step = 0; step < maxSteps; step++) {
                const currNode = nodes.get(currKey);
                if (!currNode || !Array.isArray(currNode.edges)) break;

                const nextEdgeId = this._chooseNextEdge(currNode, nodes, edges, prevKey, currKey);
                if (nextEdgeId === null) break;

                const nextEdge = edges[nextEdgeId];
                nextEdge.used = true;
                const nextKey = nextEdge.a === currKey ? nextEdge.b : nextEdge.a;

                if (nextKey === startKey) {
                    closed = true;
                    break;
                }

                path.push({ x: nodes.get(nextKey).x, y: nodes.get(nextKey).y });
                prevKey = currKey;
                currKey = nextKey;
            }

            if (!closed || path.length < 3) continue;

            const cleaned = this._sanitizePolygon(path);
            if (this._isPolygonValid(cleaned)) {
                loops.push(cleaned);
            }
        }

        return loops;
    }

    _chooseNextEdge(currNode, nodes, edges, prevKey, currKey) {
        const incoming = {
            x: currNode.x - nodes.get(prevKey).x,
            y: currNode.y - nodes.get(prevKey).y
        };

        let bestEdgeId = null;
        let bestAngle = Infinity;

        for (const edgeId of currNode.edges) {
            const edge = edges[edgeId];
            if (!edge || edge.used) continue;
            const otherKey = edge.a === currKey ? edge.b : edge.a;
            if (!nodes.has(otherKey)) continue;

            const next = {
                x: nodes.get(otherKey).x - currNode.x,
                y: nodes.get(otherKey).y - currNode.y
            };

            const angle = this._turnAngle(incoming, next);
            if (angle < bestAngle) {
                bestAngle = angle;
                bestEdgeId = edgeId;
            }
        }

        return bestEdgeId;
    }

    _insetPolygon(polygon, distance) {
        const poly = this._ensureClockwise(this._sanitizePolygon(polygon));
        if (!this._isPolygonValid(poly)) return [];

        const dist = Math.max(0.01, Number(distance) || 0);
        const offsetLines = [];

        for (let i = 0; i < poly.length; i++) {
            const p1 = poly[i];
            const p2 = poly[(i + 1) % poly.length];
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const len = Math.hypot(dx, dy);
            if (len < 1e-6) continue;
            const nx = dy / len;
            const ny = -dx / len;
            offsetLines.push({
                p1: { x: p1.x + nx * dist, y: p1.y + ny * dist },
                p2: { x: p2.x + nx * dist, y: p2.y + ny * dist },
                n: { x: nx, y: ny }
            });
        }

        if (offsetLines.length < 3) return [];

        const inset = [];
        for (let i = 0; i < offsetLines.length; i++) {
            const prev = offsetLines[(i - 1 + offsetLines.length) % offsetLines.length];
            const curr = offsetLines[i];
            const intersection = this._lineIntersection(prev.p1, prev.p2, curr.p1, curr.p2);

            if (intersection && Number.isFinite(intersection.x) && Number.isFinite(intersection.y)) {
                inset.push(intersection);
            } else {
                const fallback = {
                    x: (curr.p1.x + prev.p2.x) / 2,
                    y: (curr.p1.y + prev.p2.y) / 2
                };
                inset.push(fallback);
            }
        }

        const cleaned = this._sanitizePolygon(inset);
        if (!this._isPolygonValid(cleaned)) return [];
        if (this._polygonSelfIntersects(cleaned)) return [];
        return cleaned;
    }

    _buildRectOnSegment(segment, axis, tangent, inward, cursor, spec) {
        const start = {
            x: segment.x1 + tangent.x * cursor,
            y: segment.y1 + tangent.y * cursor
        };

        if (axis === 'horizontal') {
            const width = spec.width;
            const depth = spec.depth;
            const x = tangent.x >= 0 ? start.x : start.x - width;
            const y = inward.y >= 0 ? start.y : start.y - depth;
            return { rect: { x, y, width, height: depth }, axis };
        }

        if (axis === 'vertical') {
            const width = spec.depth;
            const height = spec.width;
            const x = inward.x >= 0 ? start.x : start.x - width;
            const y = tangent.y >= 0 ? start.y : start.y - height;
            return { rect: { x, y, width, height }, axis };
        }

        return null;
    }

    _segmentAxis(segment) {
        const dx = Math.abs(segment.x2 - segment.x1);
        const dy = Math.abs(segment.y2 - segment.y1);
        const ratio = 3.0;

        if (dx >= dy * ratio) return 'horizontal';
        if (dy >= dx * ratio) return 'vertical';
        return 'none';
    }

    _pickSpecForRemaining(specs, remaining, cycleIndex, preferDensePlacement = true) {
        if (!Array.isArray(specs) || specs.length === 0 || remaining < 0.75) return null;

        const ordered = specs.slice().sort((a, b) => (
            preferDensePlacement ? (a.width - b.width) : (b.width - a.width)
        ));
        const fit = ordered.find((s) => s.width <= remaining + 1e-6);
        if (fit) return fit;

        return specs[cycleIndex % specs.length];
    }

    _normalizeBoxSpecs(boxes, options = {}) {
        const defaultDepth = Number.isFinite(Number(options.defaultDepth))
            ? Math.max(0.8, Number(options.defaultDepth))
            : this.defaultDepth;
        const minWidth = Number.isFinite(Number(options.minWidth))
            ? Math.max(0.5, Number(options.minWidth))
            : 0.8;

        const specs = [];
        for (const box of Array.isArray(boxes) ? boxes : []) {
            const width = Number(box && box.width);
            if (!Number.isFinite(width) || width < minWidth) continue;
            const depth = Number.isFinite(Number(box.depth)) ? Math.max(0.8, Number(box.depth)) : defaultDepth;
            specs.push({
                type: box.type || 'M',
                width,
                depth,
                area: width * depth
            });
        }

        return specs;
    }

    _rectInsidePolygon(rect, polygon, tolerance = 0.05) {
        if (!rect || !Array.isArray(polygon) || polygon.length < 3) return false;
        const corners = this._rectCorners(rect);
        return corners.every((p) => this._pointInsideOrOnPolygon(p, polygon, tolerance));
    }

    _pointInsideOrOnPolygon(point, polygon, tolerance) {
        if (GeometryHelpers.pointInPolygon(point, polygon)) return true;
        const dist = GeometryHelpers.pointToPolygonDistance(point, polygon);
        return Number.isFinite(dist) && dist <= tolerance;
    }

    _rectCorners(rect) {
        return [
            { x: rect.x, y: rect.y },
            { x: rect.x + rect.width, y: rect.y },
            { x: rect.x + rect.width, y: rect.y + rect.height },
            { x: rect.x, y: rect.y + rect.height }
        ];
    }

    _rectsOverlap(a, b, inset = 0) {
        return a.x < b.x + b.width - inset &&
            a.x + a.width > b.x + inset &&
            a.y < b.y + b.height - inset &&
            a.y + a.height > b.y + inset;
    }

    _polygonSelfIntersects(polygon) {
        if (!Array.isArray(polygon) || polygon.length < 4) return false;

        const n = polygon.length;
        for (let i = 0; i < n; i++) {
            const a1 = polygon[i];
            const a2 = polygon[(i + 1) % n];
            for (let j = i + 1; j < n; j++) {
                const b1 = polygon[j];
                const b2 = polygon[(j + 1) % n];

                const adjacent =
                    i === j ||
                    (i + 1) % n === j ||
                    i === (j + 1) % n;
                if (adjacent) continue;

                if (GeometryHelpers.segmentsIntersect(a1, a2, b1, b2)) {
                    return true;
                }
            }
        }

        return false;
    }

    _polygonToSegments(polygon) {
        const poly = this._sanitizePolygon(polygon);
        const segments = [];
        for (let i = 0; i < poly.length; i++) {
            const p1 = poly[i];
            const p2 = poly[(i + 1) % poly.length];
            const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            if (length < this.minSegmentLength * 0.25) continue;
            segments.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, length, index: i });
        }
        return segments;
    }

    _segmentsNearBounds(segments, bounds) {
        if (!Array.isArray(segments) || !segments.length) return [];
        const maxDim = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
        const threshold = Math.max(0.6, maxDim * 0.08);

        return segments.filter((seg) => {
            const midX = (seg.x1 + seg.x2) / 2;
            const midY = (seg.y1 + seg.y2) / 2;
            const nearL = Math.abs(midX - bounds.minX) <= threshold;
            const nearR = Math.abs(midX - bounds.maxX) <= threshold;
            const nearB = Math.abs(midY - bounds.minY) <= threshold;
            const nearT = Math.abs(midY - bounds.maxY) <= threshold;
            return nearL || nearR || nearB || nearT;
        });
    }

    _extractWallSegments(items) {
        const segments = [];
        for (const item of Array.isArray(items) ? items : []) {
            const segs = extractSegments(item);
            for (const seg of segs) {
                const x1 = Number(seg.x1);
                const y1 = Number(seg.y1);
                const x2 = Number(seg.x2);
                const y2 = Number(seg.y2);
                if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
                if (Math.hypot(x2 - x1, y2 - y1) < 0.08) continue;
                segments.push({ x1, y1, x2, y2 });
            }
        }
        return segments;
    }

    _sanitizeBounds(bounds, walls) {
        if (bounds && [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) {
            if (bounds.maxX > bounds.minX && bounds.maxY > bounds.minY) {
                return {
                    minX: Number(bounds.minX),
                    minY: Number(bounds.minY),
                    maxX: Number(bounds.maxX),
                    maxY: Number(bounds.maxY)
                };
            }
        }

        const points = [];
        for (const wall of walls || []) {
            for (const seg of extractSegments(wall)) {
                points.push({ x: Number(seg.x1), y: Number(seg.y1) });
                points.push({ x: Number(seg.x2), y: Number(seg.y2) });
            }
        }

        if (!points.length) {
            return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        }

        const xs = points.map((p) => p.x).filter(Number.isFinite);
        const ys = points.map((p) => p.y).filter(Number.isFinite);
        if (!xs.length || !ys.length) {
            return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        }

        return {
            minX: Math.min(...xs),
            minY: Math.min(...ys),
            maxX: Math.max(...xs),
            maxY: Math.max(...ys)
        };
    }

    _sanitizePolygon(points) {
        const sanitized = [];

        for (const raw of Array.isArray(points) ? points : []) {
            const point = this._toPoint(raw);
            if (!point) continue;
            const prev = sanitized[sanitized.length - 1];
            if (prev && Math.hypot(prev.x - point.x, prev.y - point.y) < this.snapEpsilon * 0.5) continue;
            sanitized.push(point);
        }

        if (sanitized.length >= 2) {
            const first = sanitized[0];
            const last = sanitized[sanitized.length - 1];
            if (Math.hypot(first.x - last.x, first.y - last.y) < this.snapEpsilon) {
                sanitized.pop();
            }
        }

        if (sanitized.length < 3) return sanitized;

        const noCollinear = [];
        for (let i = 0; i < sanitized.length; i++) {
            const prev = sanitized[(i - 1 + sanitized.length) % sanitized.length];
            const curr = sanitized[i];
            const next = sanitized[(i + 1) % sanitized.length];
            if (!this._isNearlyCollinear(prev, curr, next)) {
                noCollinear.push(curr);
            }
        }

        return noCollinear.length >= 3 ? noCollinear : sanitized;
    }

    _toPoint(value) {
        if (!value) return null;
        if (Array.isArray(value) && value.length >= 2) {
            const x = Number(value[0]);
            const y = Number(value[1]);
            return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
        }
        if (typeof value === 'object') {
            const x = Number(value.x);
            const y = Number(value.y);
            if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };

            if (value.start && value.end) {
                const sx = Number(value.start.x);
                const sy = Number(value.start.y);
                if (Number.isFinite(sx) && Number.isFinite(sy)) {
                    return { x: sx, y: sy };
                }
            }
        }
        return null;
    }

    _isNearlyCollinear(a, b, c) {
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const bcx = c.x - b.x;
        const bcy = c.y - b.y;
        const cross = Math.abs(abx * bcy - aby * bcx);
        const len = Math.hypot(abx, aby) + Math.hypot(bcx, bcy);
        return cross <= Math.max(1e-6, len * 1e-4);
    }

    _lineIntersection(a1, a2, b1, b2) {
        const x1 = a1.x;
        const y1 = a1.y;
        const x2 = a2.x;
        const y2 = a2.y;
        const x3 = b1.x;
        const y3 = b1.y;
        const x4 = b2.x;
        const y4 = b2.y;

        const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        if (Math.abs(denom) < 1e-9) return null;

        const px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denom;
        const py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denom;
        return { x: px, y: py };
    }

    _isPolygonValid(polygon) {
        if (!Array.isArray(polygon) || polygon.length < 3) return false;
        const area = Math.abs(this._signedArea(polygon));
        return Number.isFinite(area) && area > 1e-3;
    }

    _signedArea(polygon) {
        let area = 0;
        for (let i = 0; i < polygon.length; i++) {
            const p1 = polygon[i];
            const p2 = polygon[(i + 1) % polygon.length];
            area += p1.x * p2.y - p2.x * p1.y;
        }
        return area / 2;
    }

    _ensureClockwise(polygon) {
        const poly = this._sanitizePolygon(polygon);
        if (!poly.length) return poly;
        return this._signedArea(poly) > 0 ? poly.slice().reverse() : poly;
    }

    _turnAngle(incoming, outgoing) {
        const inLen = Math.hypot(incoming.x, incoming.y);
        const outLen = Math.hypot(outgoing.x, outgoing.y);
        if (inLen < 1e-9 || outLen < 1e-9) return Math.PI;

        const inX = incoming.x / inLen;
        const inY = incoming.y / inLen;
        const outX = outgoing.x / outLen;
        const outY = outgoing.y / outLen;

        const dot = Math.max(-1, Math.min(1, inX * outX + inY * outY));
        const cross = inX * outY - inY * outX;
        let angle = Math.atan2(cross, dot);
        if (angle < 0) angle += Math.PI * 2;
        return angle;
    }

    _snapKey(x, y, epsilon) {
        const ex = Number.isFinite(epsilon) && epsilon > 0 ? epsilon : 0.05;
        const sx = Math.round(Number(x) / ex) * ex;
        const sy = Math.round(Number(y) / ex) * ex;
        return `${sx.toFixed(4)}:${sy.toFixed(4)}`;
    }

    _boundsPolygon(bounds) {
        const b = bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        return [
            { x: b.minX, y: b.minY },
            { x: b.maxX, y: b.minY },
            { x: b.maxX, y: b.maxY },
            { x: b.minX, y: b.maxY }
        ];
    }

    _convexHull(points) {
        const pts = (points || [])
            .map((p) => this._toPoint(p))
            .filter(Boolean)
            .sort((a, b) => (a.x - b.x) || (a.y - b.y));

        if (pts.length < 3) return [];

        const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
        const lower = [];
        for (const p of pts) {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
                lower.pop();
            }
            lower.push(p);
        }

        const upper = [];
        for (let i = pts.length - 1; i >= 0; i--) {
            const p = pts[i];
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
                upper.pop();
            }
            upper.push(p);
        }

        upper.pop();
        lower.pop();
        return lower.concat(upper);
    }
}

module.exports = WallHuggingPlacer;
