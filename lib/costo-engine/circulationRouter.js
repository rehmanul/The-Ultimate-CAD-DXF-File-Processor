'use strict';

const { extractSegments, rectHitsWalls } = require('./geometry');

/**
 * CirculationRouter v2 - Generates the main circulation path (blue route).
 * 
 * Strategy: Build a connected route that:
 * 1. Runs a main SPINE perpendicular to box strips, through corridor centers
 * 2. At each corridor group, extends BRANCHES along the full corridor length
 * 3. Connects to entrances with L-shaped paths
 * 
 * The result is a blue ribbon network visible in the 3D viewer.
 */
class CirculationRouter {
    constructor(floorPlan, options) {
        this.bounds = floorPlan.bounds;
        this.entrances = floorPlan.entrances || [];
        this.forbiddenZones = floorPlan.forbiddenZones || [];
        this.options = options;

        this.allWalls = [];
        // Include BOTH internal walls AND envelope (perimeter) walls
        const wallSources = [
            ...(floorPlan.walls || []),
            ...(floorPlan.envelope || []).map(e => ({ start: e.start, end: e.end }))
        ];
        for (const wall of wallSources) {
            const segs = extractSegments(wall);
            for (const seg of segs) {
                const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
                if (len >= 0.3) this.allWalls.push(seg);
            }
        }
        console.log(`[CirculationRouter] Loaded ${this.allWalls.length} wall segments for crossing checks`);
    }

    /**
     * Generate the main circulation route through the corridors.
     */
    generateRoute(corridors, units) {
        if (!corridors || corridors.length === 0) return [];

        // Add box/unit edges as virtual walls so paths can't cross through boxes
        if (units && units.length > 0) {
            const boxWallsBefore = this.allWalls.length;
            for (const u of units) {
                const x = u.x, y = u.y, w = u.width, h = u.height;
                if (x == null || y == null || w == null || h == null) continue;
                // Add all 4 edges of the box as wall segments
                this.allWalls.push(
                    { x1: x, y1: y, x2: x + w, y2: y },           // bottom
                    { x1: x + w, y1: y, x2: x + w, y2: y + h },   // right
                    { x1: x + w, y1: y + h, x2: x, y2: y + h },   // top
                    { x1: x, y1: y + h, x2: x, y2: y }            // left
                );
            }
            console.log(`[CircRoute] Added ${this.allWalls.length - boxWallsBefore} box edge segments (${units.length} units)`);
        }

        const cw = this.options.corridorWidth || 1.2;

        // Determine strip orientation from corridors
        const vertCount = corridors.filter(c => c.direction === 'vertical').length;
        const horizCount = corridors.filter(c => c.direction === 'horizontal').length;
        const stripsH = vertCount >= horizCount;
        // stripsH = true means strips are horizontal (boxes go left-right),
        // corridors are vertical (between strips), spine runs horizontally

        // Group corridors by their strip position
        const groups = this._groupCorridors(corridors, stripsH);
        const groupKeys = [...groups.keys()].sort((a, b) => a - b);

        if (groupKeys.length === 0) return [];

        const segments = [];

        // Find a good Y (or X) for the main spine — use median corridor midpoint
        const midpoints = [];
        for (const [, corrs] of groups) {
            for (const c of corrs) {
                midpoints.push(stripsH ? c.y + c.height / 2 : c.x + c.width / 2);
            }
        }
        midpoints.sort((a, b) => a - b);
        const spineSecondary = midpoints[Math.floor(midpoints.length / 2)];

        // ── SPINE: horizontal line connecting all corridor groups ──
        // Run through the center of each corridor group
        // IMPORTANT: check wall crossings for each spine segment
        for (let i = 0; i < groupKeys.length - 1; i++) {
            const from = groupKeys[i] + cw / 2;
            const to = groupKeys[i + 1] + cw / 2;
            const p1 = stripsH
                ? { x: from, y: spineSecondary }
                : { x: spineSecondary, y: from };
            const p2 = stripsH
                ? { x: to, y: spineSecondary }
                : { x: spineSecondary, y: to };

            if (!this._segmentCrossesWall(p1, p2)) {
                // Direct spine link is clear
                segments.push({
                    type: 'SPINE',
                    style: 'solid_blue',
                    path: [p1, p2]
                });
            } else {
                console.log(`[CircRoute] ⚠ SPINE blocked by wall: (${p1.x.toFixed(1)},${p1.y.toFixed(1)}) → (${p2.x.toFixed(1)},${p2.y.toFixed(1)})`);
                // Direct spine crosses a wall — try L-shaped dogleg routes
                // Strategy: route through the nearest corridor endpoints
                const fromCorrs = groups.get(groupKeys[i]) || [];
                const toCorrs = groups.get(groupKeys[i + 1]) || [];

                // Find the closest pair of corridor endpoints between the two groups
                let bestMid = null, bestDist = Infinity;
                for (const fc of fromCorrs) {
                    const fEnd = stripsH ? fc.y + fc.height : fc.x + fc.width;
                    const fStart = stripsH ? fc.y : fc.x;
                    for (const tc of toCorrs) {
                        const tEnd = stripsH ? tc.y + tc.height : tc.x + tc.width;
                        const tStart = stripsH ? tc.y : tc.x;
                        // Try routing through each endpoint pair
                        for (const fSec of [fStart, fEnd, (fStart + fEnd) / 2]) {
                            for (const tSec of [tStart, tEnd, (tStart + tEnd) / 2]) {
                                const mid = (fSec + tSec) / 2;
                                const leg1p1 = stripsH ? { x: from, y: mid } : { x: mid, y: from };
                                const leg1p2 = stripsH ? { x: to, y: mid } : { x: mid, y: to };
                                if (!this._segmentCrossesWall(p1, leg1p1) &&
                                    !this._segmentCrossesWall(leg1p1, leg1p2) &&
                                    !this._segmentCrossesWall(leg1p2, p2)) {
                                    const d = Math.abs(mid - (stripsH ? spineSecondary : spineSecondary));
                                    if (d < bestDist) {
                                        bestDist = d;
                                        bestMid = mid;
                                    }
                                }
                            }
                        }
                    }
                }

                if (bestMid !== null) {
                    // L-shaped detour that doesn't cross walls
                    const m1 = stripsH ? { x: from, y: bestMid } : { x: bestMid, y: from };
                    const m2 = stripsH ? { x: to, y: bestMid } : { x: bestMid, y: to };
                    if (Math.hypot(p1.x - m1.x, p1.y - m1.y) > 0.1) {
                        segments.push({ type: 'SPINE', style: 'solid_blue', path: [p1, m1] });
                    }
                    segments.push({ type: 'SPINE', style: 'solid_blue', path: [m1, m2] });
                    if (Math.hypot(m2.x - p2.x, m2.y - p2.y) > 0.1) {
                        segments.push({ type: 'SPINE', style: 'solid_blue', path: [m2, p2] });
                    }
                }
                // else: skip this spine link entirely — no wall-free route found
            }
        }

        // ── BRANCHES: at each corridor group, run along the full corridor length ──
        for (const [pos, corrs] of groups) {
            const center = pos + cw / 2;
            corrs.sort((a, b) => (stripsH ? a.y : a.x) - (stripsH ? b.y : b.x));

            // Instead of one long branch, connect consecutive corridors
            // This avoids branches crossing walls between non-contiguous corridors
            for (let i = 0; i < corrs.length; i++) {
                const c = corrs[i];
                const cStart = stripsH ? c.y : c.x;
                const cEnd = stripsH ? c.y + c.height : c.x + c.width;

                // Branch along this corridor's length
                if (cEnd - cStart > 0.5) {
                    const brP1 = stripsH
                        ? { x: center, y: cStart } : { x: cStart, y: center };
                    const brP2 = stripsH
                        ? { x: center, y: cEnd } : { x: cEnd, y: center };
                    // Check if this branch itself crosses a wall
                    if (!this._segmentCrossesWall(brP1, brP2)) {
                        segments.push({
                            type: 'BRANCH',
                            style: 'solid_blue',
                            path: [brP1, brP2]
                        });
                    } else {
                        console.log(`[CircRoute] ⚠ BRANCH crosses wall: (${brP1.x.toFixed(1)},${brP1.y.toFixed(1)}) → (${brP2.x.toFixed(1)},${brP2.y.toFixed(1)})`);
                    }
                }

                // Connect to next corridor if gap is small (no wall between)
                if (i < corrs.length - 1) {
                    const next = corrs[i + 1];
                    const nextStart = stripsH ? next.y : next.x;
                    const gap = nextStart - cEnd;
                    if (gap > 0 && gap < 3.0) {
                        // Check if this connector crosses a wall
                        const p1 = stripsH ? { x: center, y: cEnd } : { x: cEnd, y: center };
                        const p2 = stripsH ? { x: center, y: nextStart } : { x: nextStart, y: center };
                        if (!this._segmentCrossesWall(p1, p2)) {
                            segments.push({
                                type: 'BRANCH',
                                style: 'solid_blue',
                                path: [p1, p2]
                            });
                        }
                    }
                }
            }

            // Connect branch to spine if spine is outside corridor range
            let secMin = Infinity, secMax = -Infinity;
            for (const c of corrs) {
                const s = stripsH ? c.y : c.x;
                const e = stripsH ? c.y + c.height : c.x + c.width;
                if (s < secMin) secMin = s;
                if (e > secMax) secMax = e;
            }
            if (secMin > spineSecondary + 0.5 || secMax < spineSecondary - 0.5) {
                const connectTo = secMin > spineSecondary ? secMin : secMax;
                const p1 = stripsH
                    ? { x: center, y: spineSecondary }
                    : { x: spineSecondary, y: center };
                const p2 = stripsH
                    ? { x: center, y: connectTo }
                    : { x: connectTo, y: center };
                if (!this._segmentCrossesWall(p1, p2)) {
                    segments.push({
                        type: 'BRANCH',
                        style: 'solid_blue',
                        path: [p1, p2]
                    });
                }
            }
        }

        // ── ENTRANCE CONNECTIONS ──
        // Connect entrances to the nearest route point, but only if the
        // connection path doesn't cross walls
        const entrancePoints = this._getEntrancePoints();
        for (const ent of entrancePoints) {
            // Find nearest point on any segment
            let bestDist = Infinity, bestPt = null;
            for (const seg of segments) {
                for (const pt of seg.path) {
                    const d = Math.hypot(pt.x - ent.x, pt.y - ent.y);
                    if (d < bestDist) { bestDist = d; bestPt = pt; }
                }
            }
            if (bestPt && bestDist > 0.5 && bestDist < 25) {
                // L-shaped connection — check both legs don't cross walls
                const midPt = { x: bestPt.x, y: ent.y };
                const leg1Clear = !this._segmentCrossesWall(ent, midPt);
                const leg2Clear = !this._segmentCrossesWall(midPt, bestPt);

                if (leg1Clear && leg2Clear) {
                    segments.push({
                        type: 'ENTRANCE_CONNECTION',
                        style: 'solid_blue',
                        path: [ent, midPt, bestPt]
                    });
                } else {
                    // Try the other L-shape (vertical first, then horizontal)
                    const midPt2 = { x: ent.x, y: bestPt.y };
                    const leg1b = !this._segmentCrossesWall(ent, midPt2);
                    const leg2b = !this._segmentCrossesWall(midPt2, bestPt);
                    if (leg1b && leg2b) {
                        segments.push({
                            type: 'ENTRANCE_CONNECTION',
                            style: 'solid_blue',
                            path: [ent, midPt2, bestPt]
                        });
                    }
                    // If both L-shapes cross walls, skip this entrance connection
                }
            }
        }

        console.log(`[CirculationRouter] Route: ${segments.filter(s => s.type === 'SPINE').length} spine, ` +
            `${segments.filter(s => s.type === 'BRANCH').length} branches, ` +
            `${segments.filter(s => s.type === 'ENTRANCE_CONNECTION').length} entrance connections`);

        // Clean up: remove degenerate segments (zero-length or duplicate points)
        const cleaned = segments.filter(seg => {
            const path = seg.path;
            if (!path || path.length < 2) return false;
            // Remove duplicate consecutive points
            const unique = [path[0]];
            for (let i = 1; i < path.length; i++) {
                const prev = unique[unique.length - 1];
                if (Math.hypot(path[i].x - prev.x, path[i].y - prev.y) > 0.1) {
                    unique.push(path[i]);
                }
            }
            seg.path = unique;
            return unique.length >= 2;
        });

        return cleaned;
    }

    _groupCorridors(corridors, stripsH) {
        const groups = new Map();
        const tolerance = 0.5;
        for (const c of corridors) {
            const key = stripsH ? c.x : c.y;
            let found = false;
            for (const [gKey, gCorrs] of groups) {
                if (Math.abs(gKey - key) < tolerance) {
                    gCorrs.push(c);
                    found = true;
                    break;
                }
            }
            if (!found) groups.set(key, [c]);
        }
        return groups;
    }

    _getEntrancePoints() {
        const points = [];
        for (const ent of this.entrances) {
            if (ent.start && ent.end) {
                points.push({
                    x: (ent.start.x + ent.end.x) / 2,
                    y: (ent.start.y + ent.end.y) / 2
                });
            } else if (ent.x != null && ent.y != null) {
                points.push({ x: ent.x, y: ent.y });
            }
        }
        return points;
    }

    /**
     * Check if a line segment from p1 to p2 crosses any wall.
     * Uses proper segment-segment intersection (cross product method)
     * with a small buffer to avoid touching-but-not-crossing false positives.
     */
    _segmentCrossesWall(p1, p2) {
        const ax = p1.x, ay = p1.y, bx = p2.x, by = p2.y;
        const dLen = Math.hypot(bx - ax, by - ay);
        if (dLen < 0.1) return false;

        // Shrink the test segment slightly (5cm inward from each end)
        // to avoid false positives at wall endpoints
        const shrink = 0.05 / dLen;
        const sax = ax + (bx - ax) * shrink;
        const say = ay + (by - ay) * shrink;
        const sbx = bx - (bx - ax) * shrink;
        const sby = by - (by - ay) * shrink;

        for (const wall of this.allWalls) {
            // AABB early reject
            const wMinX = Math.min(wall.x1, wall.x2);
            const wMaxX = Math.max(wall.x1, wall.x2);
            const wMinY = Math.min(wall.y1, wall.y2);
            const wMaxY = Math.max(wall.y1, wall.y2);
            const sMinX = Math.min(sax, sbx);
            const sMaxX = Math.max(sax, sbx);
            const sMinY = Math.min(say, sby);
            const sMaxY = Math.max(say, sby);
            if (wMaxX < sMinX || wMinX > sMaxX || wMaxY < sMinY || wMinY > sMaxY) continue;

            // Cross product segment-segment intersection test
            if (this._segSegIntersect(sax, say, sbx, sby, wall.x1, wall.y1, wall.x2, wall.y2)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Proper segment-segment intersection using cross products.
     * Returns true if segments (ax,ay)-(bx,by) and (cx,cy)-(dx,dy) properly intersect.
     */
    _segSegIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
        const cross = (ux, uy, vx, vy) => ux * vy - uy * vx;
        const rx = bx - ax, ry = by - ay;
        const sx = dx - cx, sy = dy - cy;
        const denom = cross(rx, ry, sx, sy);
        if (Math.abs(denom) < 1e-10) return false; // parallel
        const t = cross(cx - ax, cy - ay, sx, sy) / denom;
        const u = cross(cx - ax, cy - ay, rx, ry) / denom;
        return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
    }
}

module.exports = CirculationRouter;
