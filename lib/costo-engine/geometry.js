'use strict';

/**
 * Geometry utilities for COSTO engine
 */

/**
 * Extract line segment(s) from various wall formats.
 * Returns an array of segments since polylines produce multiple segments.
 */
function extractSegments(wall) {
    // Format 1: {start: {x,y}, end: {x,y}}
    if (wall.start && wall.end) {
        const x1 = +wall.start.x, y1 = +wall.start.y;
        const x2 = +wall.end.x, y2 = +wall.end.y;
        if (isFinite(x1) && isFinite(y1) && isFinite(x2) && isFinite(y2)) {
            return [{ x1, y1, x2, y2 }];
        }
    }

    // Format 2: {x1, y1, x2, y2}
    if (wall.x1 != null && wall.y1 != null && wall.x2 != null && wall.y2 != null) {
        return [{ x1: +wall.x1, y1: +wall.y1, x2: +wall.x2, y2: +wall.y2 }];
    }

    // Format 3: {startX, startY, endX, endY}
    if (wall.startX != null && wall.endX != null) {
        return [{ x1: +wall.startX, y1: +wall.startY, x2: +wall.endX, y2: +wall.endY }];
    }

    // Format 4: {polygon: [[x,y], ...]} — polyline wall, extract edge segments
    if (wall.polygon && Array.isArray(wall.polygon) && wall.polygon.length >= 2) {
        const segs = [];
        const pts = wall.polygon;
        for (let i = 0; i < pts.length - 1; i++) {
            const p1 = pts[i], p2 = pts[i + 1];
            const x1 = Array.isArray(p1) ? +p1[0] : +p1.x;
            const y1 = Array.isArray(p1) ? +p1[1] : +p1.y;
            const x2 = Array.isArray(p2) ? +p2[0] : +p2.x;
            const y2 = Array.isArray(p2) ? +p2[1] : +p2.y;
            if (isFinite(x1) && isFinite(y1) && isFinite(x2) && isFinite(y2)) {
                segs.push({ x1, y1, x2, y2 });
            }
        }
        return segs;
    }

    // Format 5: {vertices: [{x,y}, ...]} — vertex array
    if (wall.vertices && Array.isArray(wall.vertices) && wall.vertices.length >= 2) {
        const segs = [];
        for (let i = 0; i < wall.vertices.length - 1; i++) {
            const p1 = wall.vertices[i], p2 = wall.vertices[i + 1];
            if (p1 && p2 && isFinite(p1.x) && isFinite(p2.x)) {
                segs.push({ x1: +p1.x, y1: +p1.y, x2: +p2.x, y2: +p2.y });
            }
        }
        return segs;
    }

    return [];
}

/**
 * Legacy single-segment extractor (for backward compat)
 */
function extractSegment(wall) {
    const segs = extractSegments(wall);
    return segs.length > 0 ? segs[0] : null;
}

/**
 * Extract rectangle from various object formats
 */
function extractRect(obj) {
    let x, y, w, h;
    if (obj.bounds) {
        x = obj.bounds.minX; y = obj.bounds.minY;
        w = obj.bounds.maxX - obj.bounds.minX;
        h = obj.bounds.maxY - obj.bounds.minY;
    } else if (obj.polygon && Array.isArray(obj.polygon)) {
        // Polygon-based forbidden zone
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const pt of obj.polygon) {
            const px = Array.isArray(pt) ? pt[0] : pt.x;
            const py = Array.isArray(pt) ? pt[1] : pt.y;
            if (px < minX) minX = px;
            if (py < minY) minY = py;
            if (px > maxX) maxX = px;
            if (py > maxY) maxY = py;
        }
        x = minX; y = minY; w = maxX - minX; h = maxY - minY;
    } else {
        x = obj.x; y = obj.y; w = obj.width; h = obj.height;
    }
    if (x == null || y == null || !w || !h) return null;
    return { x: +x, y: +y, w: +w, h: +h };
}

/**
 * Liang-Barsky line segment vs AABB intersection
 */
function segmentIntersectsRect(x1, y1, x2, y2, left, bottom, right, top) {
    const dx = x2 - x1, dy = y2 - y1;
    const p = [-dx, dx, -dy, dy];
    const q = [x1 - left, right - x1, y1 - bottom, top - y1];
    let tMin = 0, tMax = 1;
    for (let i = 0; i < 4; i++) {
        if (Math.abs(p[i]) < 1e-10) {
            if (q[i] < 0) return false;
        } else {
            const t = q[i] / p[i];
            if (p[i] < 0) { if (t > tMin) tMin = t; }
            else { if (t < tMax) tMax = t; }
            if (tMin > tMax) return false;
        }
    }
    return true;
}

/**
 * Check if a rectangle overlaps any wall segment (with clearance buffer).
 * Uses Liang-Barsky for precise segment-vs-AABB intersection.
 */
function rectHitsWalls(bx, by, bw, bh, wallSegments, clearance) {
    const cl = clearance || 0;
    const left = bx - cl;
    const bottom = by - cl;
    const right = bx + bw + cl;
    const top = by + bh + cl;

    for (const seg of wallSegments) {
        // AABB early reject
        const sMinX = Math.min(seg.x1, seg.x2);
        const sMaxX = Math.max(seg.x1, seg.x2);
        const sMinY = Math.min(seg.y1, seg.y2);
        const sMaxY = Math.max(seg.y1, seg.y2);
        if (sMaxX < left || sMinX > right || sMaxY < bottom || sMinY > top) continue;

        // Liang-Barsky intersection
        if (segmentIntersectsRect(seg.x1, seg.y1, seg.x2, seg.y2, left, bottom, right, top)) {
            return true;
        }
    }
    return false;
}

/**
 * Check if a rectangle overlaps any obstacle rectangle
 */
function rectHitsRects(bx, by, bw, bh, rects) {
    for (const r of rects) {
        if (bx < r.x + r.w && bx + bw > r.x && by < r.y + r.h && by + bh > r.y) return true;
    }
    return false;
}

module.exports = {
    extractSegment,
    extractSegments,
    extractRect,
    segmentIntersectsRect,
    rectHitsWalls,
    rectHitsRects
};
