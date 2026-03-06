'use strict';

const AdvancedCorridorNetworkGenerator = require('./advancedCorridorNetworkGenerator');

/**
 * ProfessionalGridLayoutEngine v3.0 — CLIPPED BAY GRID
 *
 * Strategy:
 *  1. Compute a PERFECT uniform grid across the entire plan bounding box.
 *     - Fixed box width (~1.5m), fixed box depth (~2.5m), fixed corridor width (~1.2m)
 *     - Every row has the EXACT same X-column positions → perfect alignment
 *     - Rows alternate: [BoxRow] [Corridor] [BoxRow] [Corridor] ...
 *  2. For each grid cell, test if it is INSIDE the floor plan polygon.
 *     - Uses point-in-polygon ray casting on the building outline.
 *     - Cells outside the building are silently dropped.
 *  3. Skip any cell that overlaps a forbidden zone.
 *  4. Build connected corridors:
 *     - Horizontal aisle between every pair of facing box rows
 *     - Vertical spine corridors at regular column intervals
 *     - Together they form a fully connected grid network (move in all directions)
 */

// ─────────────────────────────────────────────────
//  Helper: point-in-polygon (ray casting)
// ─────────────────────────────────────────────────
function pointInPolygon(px, py, polygon) {
    if (!polygon || polygon.length < 3) return true; // no polygon = whole bounds
    let inside = false;
    const n = polygon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        const intersect = ((yi > py) !== (yj > py)) &&
            (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// ─────────────────────────────────────────────────
//  Helper: extract building polygon from walls/envelope
// ─────────────────────────────────────────────────
function extractBuildingPolygon(floorPlan) {
    // ALWAYS use bounding box as the building polygon.
    // Complex polygon extraction caused both false rejections (empty spaces)
    // and false acceptances (collisions) due to concave shapes.
    // Wall line-segment collision handles the actual obstacle avoidance.
    const b = floorPlan.bounds || {};
    return [
        { x: b.minX || 0, y: b.minY || 0 },
        { x: b.maxX || 100, y: b.minY || 0 },
        { x: b.maxX || 100, y: b.maxY || 100 },
        { x: b.minX || 0, y: b.maxY || 100 }
    ];
}

// ─────────────────────────────────────────────────
//  Build a closed polygon by chaining line segments
// ─────────────────────────────────────────────────
function buildPolygonFromSegments(segs) {
    if (segs.length === 0) return null;

    // Build a sorted list of unique vertices by chaining segments
    const pts = [];
    const tol = 0.5;
    const used = new Array(segs.length).fill(false);

    let cur = { x: segs[0].x1, y: segs[0].y1 };
    pts.push({ ...cur });
    used[0] = true;
    cur = { x: segs[0].x2, y: segs[0].y2 };

    for (let iter = 0; iter < segs.length * 2; iter++) {
        let found = false;
        for (let i = 0; i < segs.length; i++) {
            if (used[i]) continue;
            const s = segs[i];
            if (Math.hypot(s.x1 - cur.x, s.y1 - cur.y) < tol) {
                pts.push({ x: cur.x, y: cur.y });
                cur = { x: s.x2, y: s.y2 };
                used[i] = true;
                found = true;
                break;
            }
            if (Math.hypot(s.x2 - cur.x, s.y2 - cur.y) < tol) {
                pts.push({ x: cur.x, y: cur.y });
                cur = { x: s.x1, y: s.y1 };
                used[i] = true;
                found = true;
                break;
            }
        }
        if (!found) break;
    }

    if (pts.length < 3) return null;
    return pts;
}

// ─────────────────────────────────────────────────
//  Helper: check if a box rect is INSIDE the building polygon
//  Tests all 4 corners + center point
// ─────────────────────────────────────────────────
function boxFullyInsidePolygon(bx, by, bw, bh, polygon) {
    if (!polygon || polygon.length < 3) return true;
    // Simple bounds check (polygon is always the bounding box now)
    const cx = bx + bw / 2;
    const cy = by + bh / 2;
    return pointInPolygon(cx, cy, polygon);
}

// ─────────────────────────────────────────────────
//  Helper: check rect overlaps forbidden zone
// ─────────────────────────────────────────────────
function overlapsRect(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax + 0.02 < bx + bw && ax + aw - 0.02 > bx &&
        ay + 0.02 < by + bh && ay + ah - 0.02 > by;
}

// ─────────────────────────────────────────────────
//  Zigzag radiator helper
// ─────────────────────────────────────────────────
function zigzag(x1, y1, x2, y2, nx, ny, offset, amplitude, wavelength) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 0.1 || wavelength < 0.05) return [];
    const tx = dx / len, ty = dy / len;
    const steps = Math.max(4, Math.ceil(len / wavelength) * 2);
    const pts = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const bx = x1 + tx * len * t + nx * offset;
        const by = y1 + ty * len * t + ny * offset;
        const side = (i % 2 === 0) ? 1 : -1;
        pts.push({ x: bx + nx * amplitude * side, y: by + ny * amplitude * side });
    }
    return pts;
}

// ─────────────────────────────────────────────────
//  Main Engine
// ─────────────────────────────────────────────────
class ProfessionalGridLayoutEngine {
    constructor(floorPlan, options = {}) {
        const b = floorPlan.bounds || {};
        this.bounds = {
            minX: Number.isFinite(+b.minX) ? +b.minX : 0,
            minY: Number.isFinite(+b.minY) ? +b.minY : 0,
            maxX: Number.isFinite(+b.maxX) ? +b.maxX : 100,
            maxY: Number.isFinite(+b.maxY) ? +b.maxY : 100,
        };
        this.forbiddenZones = floorPlan.forbiddenZones || [];
        this.entrances = floorPlan.entrances || [];
        this.entranceClearance = Math.max(0.2, +(options.entranceClearance ?? 1.5));

        // Layout parameters — optimized for maximum density
        this.corridorWidth = Math.max(0.80, +(options.corridorWidth ?? 1.00));
        this.boxDepth = Math.max(1.50, +(options.boxDepth ?? 2.20));
        this.boxSpacing = Math.max(0.00, +(options.boxSpacing ?? 0.02));
        this.minBoxWidth = Math.max(0.50, +(options.minBoxWidth ?? 0.80));

        this.planW = this.bounds.maxX - this.bounds.minX;
        this.planH = this.bounds.maxY - this.bounds.minY;

        // Keep normalized entrance rectangles for diagnostics.
        // NOTE: these are NOT yet enforced as placement blockers in this engine.
        this.entranceRects = this.entrances
            .map((ent) => this._extractEntranceRect(ent))
            .filter(Boolean);

        // Radiator geometry
        this.radiatorAmplitude = 0.12;
        this.radiatorWavelength = 0.38;
        this.radiatorOffset = 0.18;

        // Extract building polygon for clipping
        this.buildingPolygon = extractBuildingPolygon(floorPlan);
        console.log(`[BayGrid] Building polygon: ${this.buildingPolygon.length} pts`);
        console.log(
            `[BayGrid] Entrances: ${this.entrances.length}, entrance rects: ${this.entranceRects.length}, ` +
            `entranceClearance=${this.entranceClearance.toFixed(2)}m`
        );
        if (this.entranceRects.length > 0) {
            console.log('[BayGrid][EntranceDiag] entrance rect samples:', this.entranceRects.slice(0, 5));
        }

        // Forbidden zone rects — handle x/y/width/height, bounds, AND polygon formats
        this.fzRects = this.forbiddenZones.map(fz => {
            if (!fz) return null;
            if (Number.isFinite(+fz.x) && Number.isFinite(+fz.width))
                return { x: +fz.x, y: +fz.y, w: +fz.width, h: +fz.height };
            if (fz.bounds && Number.isFinite(+fz.bounds.minX))
                return {
                    x: +fz.bounds.minX, y: +fz.bounds.minY,
                    w: +fz.bounds.maxX - +fz.bounds.minX,
                    h: +fz.bounds.maxY - +fz.bounds.minY
                };
            // Handle polygon format: compute bounding box
            if (Array.isArray(fz.polygon) && fz.polygon.length >= 3) {
                const pts = fz.polygon.map(p => ({
                    x: Array.isArray(p) ? +p[0] : +p.x,
                    y: Array.isArray(p) ? +p[1] : +p.y
                })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
                if (pts.length >= 3) {
                    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
                    return {
                        x: Math.min(...xs), y: Math.min(...ys),
                        w: Math.max(...xs) - Math.min(...xs),
                        h: Math.max(...ys) - Math.min(...ys)
                    };
                }
            }
            return null;
        }).filter(Boolean);
        console.log(`[BayGrid] Forbidden zone rects: ${this.fzRects.length}`);

        // ── WALL POLYGON → THICK OBSTACLE CONVERSION ────────────────────
        // DXF walls have polygons (thick outlines). Convert to bounding-box
        // obstacles so boxes cannot be placed inside stairwells, elevators,
        // or any thick wall structure.
        const walls = floorPlan.walls || [];
        let wallObstacleCount = 0;
        for (const w of walls) {
            if (!w.polygon || !Array.isArray(w.polygon) || w.polygon.length < 3) continue;
            const pts = w.polygon.map(p => ({
                x: Array.isArray(p) ? +p[0] : +p.x,
                y: Array.isArray(p) ? +p[1] : +p.y
            })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
            if (pts.length < 3) continue;

            const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
            const rect = {
                x: Math.min(...xs), y: Math.min(...ys),
                w: Math.max(...xs) - Math.min(...xs),
                h: Math.max(...ys) - Math.min(...ys)
            };
            // Only add if it has meaningful area (thick wall, not a thin line)
            if (rect.w > 0.3 && rect.h > 0.3) {
                this.fzRects.push(rect);
                wallObstacleCount++;
            }
        }
        console.log(`[BayGrid] Wall polygon obstacles added: ${wallObstacleCount}`);

        // Extract wall segments for collision checking.
        // Store ALL segments (including perimeter) for enclosure detection.
        this.wallSegs = [];
        this.allWallSegs = []; // includes perimeter — used for enclosure detection
        const perimTol = 0.5;
        let perimSkipped = 0;

        for (const w of walls) {
            const segs = [];
            if (w.start && w.end) {
                const s = { x1: +w.start.x, y1: +w.start.y, x2: +w.end.x, y2: +w.end.y };
                s.len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
                if (s.len > 0.3) segs.push(s);
            } else if (w.polygon && Array.isArray(w.polygon)) {
                const pts = w.polygon.map(p => ({
                    x: Array.isArray(p) ? +p[0] : +p.x,
                    y: Array.isArray(p) ? +p[1] : +p.y
                }));
                for (let i = 0; i < pts.length - 1; i++) {
                    const s = { x1: pts[i].x, y1: pts[i].y, x2: pts[i + 1].x, y2: pts[i + 1].y };
                    s.len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
                    if (s.len > 0.3) segs.push(s);
                }
            }

            for (const s of segs) {
                this.allWallSegs.push(s); // store ALL for enclosure detection

                // Skip segments on the perimeter (both endpoints near same bbox edge)
                const nearL = Math.abs(s.x1 - b.minX) < perimTol && Math.abs(s.x2 - b.minX) < perimTol;
                const nearR = Math.abs(s.x1 - b.maxX) < perimTol && Math.abs(s.x2 - b.maxX) < perimTol;
                const nearB = Math.abs(s.y1 - b.minY) < perimTol && Math.abs(s.y2 - b.minY) < perimTol;
                const nearT = Math.abs(s.y1 - b.maxY) < perimTol && Math.abs(s.y2 - b.maxY) < perimTol;
                if (nearL || nearR || nearB || nearT) {
                    perimSkipped++;
                } else {
                    this.wallSegs.push(s);
                }
            }
        }
        // ── THICK WALL PAIR DETECTION ────────────────────────────────────
        // DXF thick walls are drawn as two parallel line segments (inner + outer face).
        // Detect these pairs and create obstacle rects so boxes can't be placed
        // inside wall bodies or in narrow gaps at wall openings.
        let thickWallCount = 0;
        const pairTol = 0.25; // max distance between parallel wall faces (typical wall 0.10-0.20m)
        const wallBuffer = 0.05; // small buffer around thick wall bodies
        const internalSegs = this.wallSegs;
        for (let i = 0; i < internalSegs.length; i++) {
            const a = internalSegs[i];
            if (a.len < 2.0) continue; // only major structural walls (skip short partitions)
            const aHoriz = Math.abs(a.y1 - a.y2) < 0.3;
            const aVert = Math.abs(a.x1 - a.x2) < 0.3;
            if (!aHoriz && !aVert) continue; // only axis-aligned

            for (let j = i + 1; j < internalSegs.length; j++) {
                const bb = internalSegs[j];
                if (bb.len < 2.0) continue;

                if (aHoriz) {
                    // Both horizontal, close in Y, overlapping in X
                    const bHoriz = Math.abs(bb.y1 - bb.y2) < 0.3;
                    if (!bHoriz) continue;
                    const gap = Math.abs(a.y1 - bb.y1);
                    if (gap < 0.05 || gap > pairTol) continue; // too close (same line) or too far

                    // Check X overlap
                    const aMinX = Math.min(a.x1, a.x2), aMaxX = Math.max(a.x1, a.x2);
                    const bMinX = Math.min(bb.x1, bb.x2), bMaxX = Math.max(bb.x1, bb.x2);
                    const overlapLeft = Math.max(aMinX, bMinX);
                    const overlapRight = Math.min(aMaxX, bMaxX);
                    if (overlapRight - overlapLeft < 0.5) continue; // minimal overlap

                    const yMin = Math.min(a.y1, bb.y1) - wallBuffer;
                    const yMax = Math.max(a.y1, bb.y1) + wallBuffer;
                    const rect = {
                        x: overlapLeft - wallBuffer, y: yMin,
                        w: (overlapRight - overlapLeft) + 2 * wallBuffer,
                        h: yMax - yMin, type: 'thick_wall'
                    };
                    if (rect.w > 0.2 && rect.h > 0.2) {
                        this.fzRects.push(rect);
                        thickWallCount++;
                    }
                } else if (aVert) {
                    // Both vertical, close in X, overlapping in Y
                    const bVert = Math.abs(bb.x1 - bb.x2) < 0.3;
                    if (!bVert) continue;
                    const gap = Math.abs(a.x1 - bb.x1);
                    if (gap < 0.05 || gap > pairTol) continue;

                    const aMinY = Math.min(a.y1, a.y2), aMaxY = Math.max(a.y1, a.y2);
                    const bMinY = Math.min(bb.y1, bb.y2), bMaxY = Math.max(bb.y1, bb.y2);
                    const overlapBot = Math.max(aMinY, bMinY);
                    const overlapTop = Math.min(aMaxY, bMaxY);
                    if (overlapTop - overlapBot < 0.5) continue;

                    const xMin = Math.min(a.x1, bb.x1) - wallBuffer;
                    const xMax = Math.max(a.x1, bb.x1) + wallBuffer;
                    const rect = {
                        x: xMin, y: overlapBot - wallBuffer,
                        w: xMax - xMin,
                        h: (overlapTop - overlapBot) + 2 * wallBuffer, type: 'thick_wall'
                    };
                    if (rect.w > 0.2 && rect.h > 0.2) {
                        this.fzRects.push(rect);
                        thickWallCount++;
                    }
                }
            }
        }
        console.log(`[BayGrid] Thick wall pairs detected (raw): ${thickWallCount}`);
        // Deduplicate FZ rects — wall segment pairs can produce near-identical rects
        const dedupTol = 0.3;
        const uniqueFz = [];
        for (const fz of this.fzRects) {
            const dup = uniqueFz.some(u =>
                Math.abs(u.x - fz.x) < dedupTol && Math.abs(u.y - fz.y) < dedupTol &&
                Math.abs(u.w - fz.w) < dedupTol && Math.abs(u.h - fz.h) < dedupTol);
            if (!dup) uniqueFz.push(fz);
        }
        this.fzRects = uniqueFz;

        // ── WALL CORNER JUNCTION DETECTION ───────────────────────────────
        // When a vertical thick wall meets a horizontal thick wall at a corner,
        // the gap between them can let boxes through. Fill L-shaped corners.
        let junctionCount = 0;
        const twRects = this.fzRects.filter(f => f.type === 'thick_wall');
        const vertWalls = twRects.filter(f => f.h > f.w * 2); // tall = vertical
        const horizWalls = twRects.filter(f => f.w > f.h * 2); // wide = horizontal
        const jTol = 1.0; // how close endpoints must be to form a junction

        for (const v of vertWalls) {
            const vTop = v.y + v.h;
            const vBot = v.y;
            const vx = v.x + v.w / 2;

            for (const h of horizWalls) {
                const hLeft = h.x;
                const hRight = h.x + h.w;
                const hy = h.y + h.h / 2;

                // Check if vertical wall's top/bottom meets horizontal wall's left/right
                // Case 1: V-top meets H (corner at top of vertical wall)
                if (Math.abs(vTop - hy) < jTol && Math.abs(vx - hLeft) < jTol) {
                    const jx = Math.min(vx, hLeft) - 0.5;
                    const jy = Math.min(vTop, hy) - 0.5;
                    this.fzRects.push({
                        x: jx, y: jy, w: Math.abs(vx - hLeft) + 1.0, h: Math.abs(vTop - hy) + 1.0,
                        type: 'wall_junction'
                    });
                    junctionCount++;
                }
                // Case 2: V-bottom meets H
                if (Math.abs(vBot - hy) < jTol && Math.abs(vx - hLeft) < jTol) {
                    const jx = Math.min(vx, hLeft) - 0.5;
                    const jy = Math.min(vBot, hy) - 0.5;
                    this.fzRects.push({
                        x: jx, y: jy, w: Math.abs(vx - hLeft) + 1.0, h: Math.abs(vBot - hy) + 1.0,
                        type: 'wall_junction'
                    });
                    junctionCount++;
                }
                // Case 3: V-top meets H-right
                if (Math.abs(vTop - hy) < jTol && Math.abs(vx - hRight) < jTol) {
                    const jx = Math.min(vx, hRight) - 0.5;
                    const jy = Math.min(vTop, hy) - 0.5;
                    this.fzRects.push({
                        x: jx, y: jy, w: Math.abs(vx - hRight) + 1.0, h: Math.abs(vTop - hy) + 1.0,
                        type: 'wall_junction'
                    });
                    junctionCount++;
                }
                // Case 4: V-bottom meets H-right
                if (Math.abs(vBot - hy) < jTol && Math.abs(vx - hRight) < jTol) {
                    const jx = Math.min(vx, hRight) - 0.5;
                    const jy = Math.min(vBot, hy) - 0.5;
                    this.fzRects.push({
                        x: jx, y: jy, w: Math.abs(vx - hRight) + 1.0, h: Math.abs(vBot - hy) + 1.0,
                        type: 'wall_junction'
                    });
                    junctionCount++;
                }
            }
        }
        if (junctionCount > 0) console.log(`[BayGrid] Wall corner junctions: ${junctionCount}`);
        console.log(`[BayGrid] ${this.fzRects.length} FZ (after dedup), ${this.wallSegs.length} internal walls, ${perimSkipped} perimeter walls skipped, ${this.allWallSegs.length} total wall segs`);
    }

    _extractEntranceRect(entrance) {
        if (!entrance) return null;

        // Segment-based entrance (common from CAD parser)
        if (entrance.start && entrance.end) {
            const x1 = Number(entrance.start.x);
            const y1 = Number(entrance.start.y);
            const x2 = Number(entrance.end.x);
            const y2 = Number(entrance.end.y);
            if ([x1, y1, x2, y2].every(Number.isFinite)) {
                const minX = Math.min(x1, x2);
                const maxX = Math.max(x1, x2);
                const minY = Math.min(y1, y2);
                const maxY = Math.max(y1, y2);
                const minThickness = 0.10;
                return {
                    x: minX,
                    y: minY,
                    w: Math.max(minThickness, maxX - minX),
                    h: Math.max(minThickness, maxY - minY)
                };
            }
        }

        // Point-like entrance
        if (Number.isFinite(+entrance.x) && Number.isFinite(+entrance.y)) {
            const width = Number.isFinite(+entrance.width) ? +entrance.width : 0.10;
            const height = Number.isFinite(+entrance.height) ? +entrance.height : 0.10;
            return {
                x: +entrance.x,
                y: +entrance.y,
                w: Math.max(0.10, width),
                h: Math.max(0.10, height)
            };
        }

        // Bounds-based entrance
        if (entrance.bounds && Number.isFinite(+entrance.bounds.minX) && Number.isFinite(+entrance.bounds.maxX) &&
            Number.isFinite(+entrance.bounds.minY) && Number.isFinite(+entrance.bounds.maxY)) {
            const minX = +entrance.bounds.minX;
            const minY = +entrance.bounds.minY;
            const maxX = +entrance.bounds.maxX;
            const maxY = +entrance.bounds.maxY;
            return {
                x: minX,
                y: minY,
                w: Math.max(0.10, maxX - minX),
                h: Math.max(0.10, maxY - minY)
            };
        }

        // Polygon-based entrance
        if (Array.isArray(entrance.polygon) && entrance.polygon.length >= 2) {
            const pts = entrance.polygon.map((p) => ({
                x: Array.isArray(p) ? +p[0] : +p.x,
                y: Array.isArray(p) ? +p[1] : +p.y
            })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
            if (pts.length >= 2) {
                const xs = pts.map((p) => p.x);
                const ys = pts.map((p) => p.y);
                const minX = Math.min(...xs);
                const minY = Math.min(...ys);
                const maxX = Math.max(...xs);
                const maxY = Math.max(...ys);
                return {
                    x: minX,
                    y: minY,
                    w: Math.max(0.10, maxX - minX),
                    h: Math.max(0.10, maxY - minY)
                };
            }
        }

        return null;
    }

    _boxOverlapsEntranceClearance(bx, by, bw, bh, clearance = this.entranceClearance) {
        if (!Array.isArray(this.entranceRects) || this.entranceRects.length === 0) return false;
        const pad = Math.max(0, Number(clearance) || 0);
        for (const ent of this.entranceRects) {
            if (!ent) continue;
            if (overlapsRect(
                bx, by, bw, bh,
                ent.x - pad,
                ent.y - pad,
                ent.w + 2 * pad,
                ent.h + 2 * pad
            )) {
                return true;
            }
        }
        return false;
    }

    // Check if a box rectangle intersects any wall segment
    _boxHitsWall(bx, by, bw, bh) {
        const inset = 0.05; // tight inset — only reject if wall line truly crosses box interior
        const rx = bx + inset, ry = by + inset;
        const rw = bw - 2 * inset, rh = bh - 2 * inset;
        for (const seg of this.wallSegs) {
            if (this._segIntersectsRect(seg.x1, seg.y1, seg.x2, seg.y2, rx, ry, rw, rh)) {
                return true;
            }
        }
        return false;
    }

    // Line segment vs axis-aligned rect intersection
    _segIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh) {
        // Check if segment endpoints are inside rect
        const inside = (px, py) => px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
        if (inside(x1, y1) || inside(x2, y2)) return true;

        // Check segment against 4 rect edges
        const edges = [
            [rx, ry, rx + rw, ry],           // bottom
            [rx + rw, ry, rx + rw, ry + rh], // right
            [rx + rw, ry + rh, rx, ry + rh], // top
            [rx, ry + rh, rx, ry]             // left
        ];
        for (const [ex1, ey1, ex2, ey2] of edges) {
            if (this._segSegIntersect(x1, y1, x2, y2, ex1, ey1, ex2, ey2)) return true;
        }
        return false;
    }

    // Test two line segments for intersection
    _segSegIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
        const denom = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
        if (Math.abs(denom) < 1e-10) return false;
        const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denom;
        const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denom;
        return t >= 0 && t <= 1 && u >= 0 && u <= 1;
    }

    generate(config = {}) {
        const b = this.bounds;
        const targetCount = config.targetCount ? Math.max(1, Math.floor(+config.targetCount)) : null;

        // ── STEP 1: Compute global box width ──────────────────────────────
        // Target ~1.05m per box for maximum density (290+ boxes).
        const targetW = 1.05;
        const step = targetW + this.boxSpacing;
        const numCols = Math.max(1, Math.floor((this.planW + 1e-6) / step));
        const bw = (this.planW - (numCols - 1) * this.boxSpacing) / numCols;
        console.log(`[BayGrid] ${numCols} columns × ${bw.toFixed(3)}m wide`);

        // Pre-compute global X positions (same for every row)
        const xPositions = [];
        for (let col = 0; col < numCols; col++) {
            xPositions.push(b.minX + col * (bw + this.boxSpacing));
        }

        // ── STEP 2: Compute row band positions ───────────────────────────
        // Strip height = boxDepth + corridorWidth + boxDepth
        const stripH = this.boxDepth + this.corridorWidth + this.boxDepth;
        const numStrips = Math.max(1, Math.floor((this.planH + 1e-6) / stripH));
        const exactStripH = this.planH / numStrips;

        // ── STEP 2b: Detect enclosed wall rooms as forbidden zones ──────
        // Find wall segments that form small enclosed areas (stairwells, elevators)
        const wallThick = 0.15;
        const wallRects = this.wallSegs.map(seg => {
            const x1 = Math.min(seg.x1, seg.x2), x2 = Math.max(seg.x1, seg.x2);
            const y1 = Math.min(seg.y1, seg.y2), y2 = Math.max(seg.y1, seg.y2);
            return {
                x: x1 - wallThick / 2, y: y1 - wallThick / 2,
                w: (x2 - x1) + wallThick, h: (y2 - y1) + wallThick,
                seg
            };
        });

        // Cluster nearby wall segments and find enclosed rectangles
        const detectEnclosedRooms = () => {
            const enclosures = [];
            const segs = this.wallSegs;
            const tol = 0.6;

            // Find groups of 4+ walls forming a rectangle:
            // Look for any pair of roughly-horizontal walls with similar X-range
            // connected by roughly-vertical walls
            const horiz = segs.filter(s => Math.abs(s.y1 - s.y2) < tol && s.len > 0.5);
            const vert = segs.filter(s => Math.abs(s.x1 - s.x2) < tol && s.len > 0.5);

            for (const h1 of horiz) {
                for (const h2 of horiz) {
                    if (h1 === h2) continue;
                    const hLeft = Math.max(Math.min(h1.x1, h1.x2), Math.min(h2.x1, h2.x2));
                    const hRight = Math.min(Math.max(h1.x1, h1.x2), Math.max(h2.x1, h2.x2));
                    if (hRight - hLeft < 1.0) continue; // too narrow overlap

                    const yTop = Math.max(h1.y1, h2.y1);
                    const yBot = Math.min(h1.y1, h2.y1);
                    const height = yTop - yBot;
                    if (height < 1.0 || height > 8) continue; // only small enclosures (stairwells, elevators)

                    // Check if vertical walls close the left and right sides
                    const hasLeft = vert.some(v => {
                        const vx = (v.x1 + v.x2) / 2;
                        const vMin = Math.min(v.y1, v.y2), vMax = Math.max(v.y1, v.y2);
                        return Math.abs(vx - hLeft) < tol && vMin <= yBot + tol && vMax >= yTop - tol;
                    });
                    const hasRight = vert.some(v => {
                        const vx = (v.x1 + v.x2) / 2;
                        const vMin = Math.min(v.y1, v.y2), vMax = Math.max(v.y1, v.y2);
                        return Math.abs(vx - hRight) < tol && vMin <= yBot + tol && vMax >= yTop - tol;
                    });

                    if (hasLeft && hasRight) {
                        const encW = hRight - hLeft;
                        const area = encW * height;
                        const aspect = Math.max(encW, height) / Math.min(encW, height);
                        // Catch stairwells/elevators up to 20 sqm, but reject elongated corridors (aspect > 3.5)
                        if (area > 1.0 && area < 20 && aspect < 3.5) {
                            // Check not already found
                            const dup = enclosures.some(e =>
                                Math.abs(e.x - hLeft) < tol && Math.abs(e.y - yBot) < tol);
                            if (!dup) {
                                enclosures.push({
                                    x: hLeft, y: yBot,
                                    w: encW, h: height,
                                    area, type: 'enclosure'
                                });
                            }
                        }
                    }
                }
            }
            return enclosures;
        };

        const detectedFZ = detectEnclosedRooms();
        for (const enc of detectedFZ) {
            this.fzRects.push(enc);
        }
        console.log(`[BayGrid] Detected ${detectedFZ.length} enclosed rooms as forbidden zones`);

        // ── STEP 3: Build COMPLETE PATHWAY NETWORK ─────────────────────
        // Reference: perimeter path + horizontal aisles + vertical connectors
        // at every wall boundary → serpentine routing reaching every box island.
        const rawCorridors = [];
        const corridors = [];
        const rowBands = [];
        const cw = this.corridorWidth;

        // 3a. Horizontal aisle corridors (between each pair of box rows in a strip)
        for (let s = 0; s < numStrips; s++) {
            const bandY0 = b.minY + s * exactStripH;
            const row0Y = bandY0;
            const aisleY = bandY0 + this.boxDepth;
            const row1Y = aisleY + this.corridorWidth;

            rowBands.push({ row0Y, aisleY, row1Y });

            rawCorridors.push({
                id: `aisle_${s} `, type: 'ACCESS', direction: 'horizontal',
                x: b.minX, y: aisleY, width: this.planW, height: cw
            });
        }

        // 3a-bis. Inter-strip corridors (between bottom of strip N and top of strip N+1)
        for (let s = 0; s < numStrips - 1; s++) {
            const strip0Bottom = rowBands[s].row1Y + this.boxDepth;
            const strip1Top = rowBands[s + 1].row0Y;
            const gapH = strip1Top - strip0Bottom;
            if (gapH > 0.1) {
                rawCorridors.push({
                    id: `interstrip_${s} `, type: 'ACCESS', direction: 'horizontal',
                    x: b.minX, y: strip0Bottom, width: this.planW, height: gapH
                });
            }
        }

        // 3b. Perimeter corridors — only LEFT and RIGHT for serpentine turns
        rawCorridors.push({
            id: 'perim_left', type: 'PERIMETER', direction: 'vertical',
            x: b.minX, y: b.minY, width: cw, height: this.planH,
            isSpine: true
        });
        rawCorridors.push({
            id: 'perim_right', type: 'PERIMETER', direction: 'vertical',
            x: b.maxX - cw, y: b.minY, width: cw, height: this.planH,
            isSpine: true
        });

        // 3c. Vertical spine corridors — every 5 columns for max density
        const spineEvery = 5;
        for (let col = spineEvery; col < numCols; col += spineEvery) {
            const sx = b.minX + col * (bw + this.boxSpacing) - cw / 2;
            rawCorridors.push({
                id: `spine_${col} `, type: 'SPINE', direction: 'vertical',
                x: sx, y: b.minY, width: cw, height: this.planH,
                isSpine: true
            });
        }

        // 3d. Smart vertical connectors at EVERY wall X-boundary
        // Find unique X positions where internal walls exist and add vertical
        // connectors there — this bridges divided sections across walls.
        const wallXPositions = new Set();
        for (const seg of this.wallSegs) {
            // Only care about roughly-vertical wall segments (they divide spaces horizontally)
            if (Math.abs(seg.x1 - seg.x2) < 0.5 && seg.len > 1.0) {
                const wx = Math.round(((seg.x1 + seg.x2) / 2) * 10) / 10;
                wallXPositions.add(wx);
            }
        }
        // Also add vertical connectors at forbidden zone edges
        for (const fz of this.fzRects) {
            wallXPositions.add(Math.round((fz.x - cw) * 10) / 10);
            wallXPositions.add(Math.round((fz.x + fz.w) * 10) / 10);
        }

        let wallConnectors = 0;
        for (const wx of wallXPositions) {
            // Skip if too close to existing spine or perimeter
            const tooClose = rawCorridors.some(c =>
                c.direction === 'vertical' && Math.abs(c.x - wx) < cw * 2);
            if (tooClose) continue;
            if (wx < b.minX + cw || wx > b.maxX - cw * 2) continue;

            rawCorridors.push({
                id: `wall_conn_${wallConnectors} `, type: 'SPINE', direction: 'vertical',
                x: wx, y: b.minY, width: cw, height: this.planH,
                isSpine: true
            });
            wallConnectors++;
        }

        console.log(`[BayGrid] Pathway network: ${rowBands.length} aisles, 4 perimeter, ` +
            `${Math.ceil((numCols - 1) / spineEvery)} spines, ${wallConnectors} wall connectors`);

        // Split corridors ONLY at forbidden zones and MAJOR structural walls
        // (walls thick enough to actually block physical passage, not thin partition lines)
        const structuralWalls = wallRects.filter(r => {
            // Only walls that are substantial enough to block a corridor
            // A wall must be at least 1.5m in its blocking dimension
            return Math.min(r.w, r.h) > 0.3 && Math.max(r.w, r.h) > 1.5;
        });

        const splitCorridorAtWalls = (corr) => {
            const segments = [];
            const obstacles = [...this.fzRects, ...structuralWalls.map(r => ({
                x: r.x, y: r.y, w: r.w, h: r.h
            }))];

            if (corr.direction === 'horizontal') {
                // Collect all X-ranges where walls/obstacles block this corridor
                const blocks = [];
                for (const ob of obstacles) {
                    if (overlapsRect(corr.x, corr.y, corr.width, corr.height,
                        ob.x, ob.y, ob.w, ob.h)) {
                        blocks.push({
                            left: Math.max(ob.x, corr.x),
                            right: Math.min(ob.x + ob.w, corr.x + corr.width)
                        });
                    }
                }

                // Sort blocks by left edge
                blocks.sort((a, b) => a.left - b.left);

                // Create segments between blocks
                let curX = corr.x;
                for (const block of blocks) {
                    if (block.left > curX + 0.5) {
                        segments.push({
                            ...corr, x: curX, width: block.left - curX,
                            id: corr.id + `_seg${segments.length} `
                        });
                    }
                    curX = Math.max(curX, block.right);
                }
                // Final segment after last block
                const endX = corr.x + corr.width;
                if (endX > curX + 0.5) {
                    segments.push({
                        ...corr, x: curX, width: endX - curX,
                        id: corr.id + `_seg${segments.length} `
                    });
                }
            } else {
                // Vertical corridor — split by Y
                const blocks = [];
                for (const ob of obstacles) {
                    if (overlapsRect(corr.x, corr.y, corr.width, corr.height,
                        ob.x, ob.y, ob.w, ob.h)) {
                        blocks.push({
                            top: Math.max(ob.y, corr.y),
                            bottom: Math.min(ob.y + ob.h, corr.y + corr.height)
                        });
                    }
                }
                blocks.sort((a, b) => a.top - b.top);

                let curY = corr.y;
                for (const block of blocks) {
                    if (block.top > curY + 0.5) {
                        segments.push({
                            ...corr, y: curY, height: block.top - curY,
                            id: corr.id + `_seg${segments.length} `
                        });
                    }
                    curY = Math.max(curY, block.bottom);
                }
                const endY = corr.y + corr.height;
                if (endY > curY + 0.5) {
                    segments.push({
                        ...corr, y: curY, height: endY - curY,
                        id: corr.id + `_seg${segments.length} `
                    });
                }
            }

            return segments.length > 0 ? segments : [corr]; // fallback to original if no walls
        };

        let wallBlockedCount = 0;
        for (const corr of rawCorridors) {
            const segs = splitCorridorAtWalls(corr);
            wallBlockedCount += (segs.length > 1) ? segs.length - 1 : 0;
            corridors.push(...segs);
        }
        console.log(`[BayGrid] Corridors: ${rawCorridors.length} raw → ${corridors.length} segments(${wallBlockedCount} wall splits)`);

        // ── STEP 3b: Build corridor connectivity graph ───────────────────
        // A corridor segment is "connected" if it overlaps with another
        // connected segment (horizontal ↔ vertical intersection).
        // Start: all vertical spines are connected (they run full height).
        const isConnected = new Array(corridors.length).fill(false);

        // Mark all vertical spines as connected (main access)
        corridors.forEach((c, i) => {
            if (c.isSpine || c.type === 'SPINE') isConnected[i] = true;
        });

        // Also mark the first and last horizontal aisle as connected
        // (they form the building perimeter access)
        corridors.forEach((c, i) => {
            if (c.direction === 'horizontal') {
                const nearBottom = Math.abs(c.y - b.minY) < exactStripH;
                const nearTop = Math.abs((c.y + c.height) - b.maxY) < exactStripH;
                if (nearBottom || nearTop) isConnected[i] = true;
            }
        });

        // Iteratively connect segments that overlap with connected segments
        const rectsOverlap = (a, c) =>
            a.x < c.x + c.width && a.x + a.width > c.x &&
            a.y < c.y + c.height && a.y + a.height > c.y;

        for (let iter = 0; iter < 10; iter++) {
            let changed = false;
            for (let i = 0; i < corridors.length; i++) {
                if (isConnected[i]) continue;
                for (let j = 0; j < corridors.length; j++) {
                    if (!isConnected[j]) continue;
                    if (i === j) continue;
                    if (rectsOverlap(corridors[i], corridors[j])) {
                        isConnected[i] = true;
                        changed = true;
                        break;
                    }
                }
            }
            if (!changed) break;
        }

        const connectedCorridors = corridors.filter((_, i) => isConnected[i]);
        const disconnected = corridors.length - connectedCorridors.length;
        console.log(`[BayGrid] Connected corridors: ${connectedCorridors.length}, Disconnected: ${disconnected} `);

        // ── STEP 4: Accessibility-verified box placement ─────────────────
        // Only place boxes where a CONNECTED corridor covers their facing edge.
        const units = [];
        const minW = this.minBoxWidth * 0.4;
        const spacing = this.boxSpacing || 0.05;

        // Combine forbidden zones into obstacle list for jump-over
        const obstacles = this.fzRects.map(r => ({
            x: r.x, y: r.y, w: r.w, h: r.h,
            rightEdge: r.x + r.w + spacing
        }));

        // Check if a box overlaps any corridor (connected or not)
        const hitsCorridor = (bx, by, w, bh) =>
            corridors.some(c => overlapsRect(bx, by, w, bh, c.x, c.y, c.width, c.height));

        // Check if a box's corridor-facing edge is covered by a CONNECTED corridor
        const hasCorridorAccess = (bx, boxW, boxY, boxH, aisleY) => {
            // Option 1: horizontal corridor covering the box's X-range at aisleY
            for (const c of connectedCorridors) {
                if (c.direction !== 'horizontal') continue;
                if (Math.abs(c.y - aisleY) > 0.5) continue;
                if (c.x <= bx + 0.1 && c.x + c.width >= bx + boxW - 0.1) {
                    return true;
                }
            }
            // Option 2: vertical corridor touching the box's left or right edge
            for (const c of connectedCorridors) {
                if (c.direction !== 'vertical') continue;
                // Check Y overlap with box
                if (c.y > boxY + boxH || c.y + c.height < boxY) continue;
                // Check X adjacency (corridor touches box edge)
                const touchesLeft = Math.abs(c.x + c.width - bx) < 0.3;
                const touchesRight = Math.abs(c.x - (bx + boxW)) < 0.3;
                if (touchesLeft || touchesRight) return true;
            }
            return false;
        };

        const findBlockingObstacle = (bx, by, w, bh) => {
            for (const ob of obstacles) {
                if (overlapsRect(bx, by, w, bh, ob.x, ob.y, ob.w, ob.h)) {
                    return ob;
                }
            }
            return null;
        };

        const entranceDiag = {
            candidatesNearEntrance: 0,
            placedNearEntrance: 0,
            skippedByEntrance: 0,
            candidateSamples: [],
            placedSamples: [],
            skippedSamples: []
        };
        const recordEntranceSample = (bucket, sample) => {
            if (!sample || !Array.isArray(bucket)) return;
            if (bucket.length < 8) bucket.push(sample);
        };

        let placed = 0, resized = 0, jumped = 0, noAccess = 0;

        const placeRow = (rowY, rowH, corridorFace, rowLabel, aisleY) => {
            let x = b.minX;

            while (x + minW < b.maxX) {
                if (targetCount && units.length >= targetCount) break;

                let boxW = Math.min(bw, b.maxX - x);
                if (boxW < minW) break;

                if (this._boxOverlapsEntranceClearance(x, rowY, boxW, rowH)) {
                    entranceDiag.candidatesNearEntrance++;
                    recordEntranceSample(entranceDiag.candidateSamples, {
                        x: +x.toFixed(3),
                        y: +rowY.toFixed(3),
                        width: +boxW.toFixed(3),
                        height: +rowH.toFixed(3),
                        row: rowLabel,
                        phase: 'candidate'
                    });
                }

                // If overlaps a corridor, try to fill the gap BEFORE the corridor with a trimmed box
                if (hitsCorridor(x, rowY, boxW, rowH)) {
                    let jumpedPast = false;
                    for (const c of corridors) {
                        if (!overlapsRect(x, rowY, boxW, rowH, c.x, c.y, c.width, c.height)) continue;

                        if (c.direction === 'vertical') {
                            // ★ GAP FILL: Place a trimmed box in the space BEFORE the corridor
                            const gapBeforeCorridor = c.x - x;
                            if (gapBeforeCorridor >= minW) {
                                const trimW = +gapBeforeCorridor.toFixed(4);
                                if (!hitsCorridor(x, rowY, trimW, rowH) &&
                                    !findBlockingObstacle(x, rowY, trimW, rowH) &&
                                    boxFullyInsidePolygon(x, rowY, trimW, rowH, this.buildingPolygon) &&
                                    hasCorridorAccess(x, trimW, rowY, rowH, aisleY)) {
                                    const nearEntrance = this._boxOverlapsEntranceClearance(x, rowY, trimW, rowH);
                                    if (nearEntrance) {
                                        entranceDiag.skippedByEntrance++;
                                        recordEntranceSample(entranceDiag.skippedSamples, {
                                            x: +x.toFixed(3),
                                            y: +rowY.toFixed(3),
                                            width: +trimW.toFixed(3),
                                            height: +rowH.toFixed(3),
                                            row: rowLabel,
                                            phase: 'trim_before_corridor'
                                        });
                                    } else {
                                        units.push({
                                            x: +x.toFixed(4), y: rowY, width: trimW, height: rowH,
                                            area: +(trimW * rowH).toFixed(2),
                                            type: 'M', label: (trimW * rowH).toFixed(1) + 'm²',
                                            partitionType: 'toleGrise', corridorFace, row: rowLabel
                                        });
                                        placed++; resized++;
                                    }
                                }
                            }
                            x = c.x + c.width + spacing;
                            jumpedPast = true;
                        } else {
                            x += boxW + spacing;
                            jumpedPast = true;
                        }
                        break;
                    }
                    if (!jumpedPast) x += spacing;
                    continue;
                }

                // Check inside building polygon
                if (!boxFullyInsidePolygon(x, rowY, boxW, rowH, this.buildingPolygon)) {
                    x += spacing;
                    continue;
                }

                // Check for obstacle collision — if hit, JUMP OVER
                const blocker = findBlockingObstacle(x, rowY, boxW, rowH);
                if (blocker) {
                    const gapBefore = blocker.x !== undefined ? blocker.x - x : 0;
                    if (gapBefore >= minW) {
                        const trimmedW = +gapBefore.toFixed(4);
                        if (!hitsCorridor(x, rowY, trimmedW, rowH) &&
                            !findBlockingObstacle(x, rowY, trimmedW, rowH) &&
                            boxFullyInsidePolygon(x, rowY, trimmedW, rowH, this.buildingPolygon) &&
                            hasCorridorAccess(x, trimmedW, rowY, rowH, aisleY)) {
                            const nearEntrance = this._boxOverlapsEntranceClearance(x, rowY, trimmedW, rowH);
                            if (nearEntrance) {
                                entranceDiag.skippedByEntrance++;
                                recordEntranceSample(entranceDiag.skippedSamples, {
                                    x: +x.toFixed(3),
                                    y: +rowY.toFixed(3),
                                    width: +trimmedW.toFixed(3),
                                    height: +rowH.toFixed(3),
                                    row: rowLabel,
                                    phase: 'trim_before_obstacle'
                                });
                            } else {
                                units.push({
                                    x: +x.toFixed(4), y: rowY, width: trimmedW, height: rowH,
                                    area: +(trimmedW * rowH).toFixed(2),
                                    type: 'M', label: (trimmedW * rowH).toFixed(1) + 'm²',
                                    partitionType: 'toleGrise', corridorFace, row: rowLabel
                                });
                                placed++; resized++;
                            }
                        }
                    }
                    x = blocker.rightEdge;
                    jumped++;
                    continue;
                }

                // ★ ACCESSIBILITY CHECK: verify this box has corridor access
                if (!hasCorridorAccess(x, boxW, rowY, rowH, aisleY)) {
                    noAccess++;
                    x += boxW + spacing;
                    continue; // skip — no corridor reaches this box
                }

                // All checks passed — place the box!
                const nearEntrance = this._boxOverlapsEntranceClearance(x, rowY, boxW, rowH);
                if (nearEntrance) {
                    entranceDiag.skippedByEntrance++;
                    recordEntranceSample(entranceDiag.skippedSamples, {
                        x: +x.toFixed(3),
                        y: +rowY.toFixed(3),
                        width: +boxW.toFixed(3),
                        height: +rowH.toFixed(3),
                        row: rowLabel,
                        phase: 'direct'
                    });
                    x += boxW + spacing;
                    continue;
                }
                units.push({
                    x: +x.toFixed(4), y: rowY, width: +boxW.toFixed(4), height: rowH,
                    area: +(boxW * rowH).toFixed(2),
                    type: 'M', label: (boxW * rowH).toFixed(1) + 'm²',
                    partitionType: 'toleGrise', corridorFace, row: rowLabel
                });
                placed++;
                x += boxW + spacing;
            }
        };

        for (const { row0Y, aisleY, row1Y } of rowBands) {
            const row0H = Math.min(this.boxDepth, b.maxY - row0Y);
            if (row0H >= minW) {
                placeRow(row0Y, row0H, 'top', 'bottom', aisleY);
            }

            const row1H = Math.min(this.boxDepth, b.maxY - row1Y);
            if (row1H >= minW && row1Y < b.maxY) {
                placeRow(row1Y, row1H, 'bottom', 'top', aisleY);
            }
        }

        console.log(`[BayGrid] Placed: ${placed}, Resized: ${resized}, Jumped: ${jumped}, No - access skipped: ${noAccess} `);
        const unitsNearEntrance = units.filter((u) =>
            this._boxOverlapsEntranceClearance(u.x, u.y, u.width, u.height)
        );
        console.log(
            `[BayGrid][EntranceDiag] candidatesNearEntrance=${entranceDiag.candidatesNearEntrance}, ` +
            `placedNearEntrance=${entranceDiag.placedNearEntrance}, skippedByEntrance=${entranceDiag.skippedByEntrance}, ` +
            `unitsNearEntrance=${unitsNearEntrance.length}`
        );
        if (entranceDiag.candidateSamples.length > 0) {
            console.log('[BayGrid][EntranceDiag] candidate samples:', entranceDiag.candidateSamples);
        }
        if (entranceDiag.placedSamples.length > 0) {
            console.log('[BayGrid][EntranceDiag] placed samples:', entranceDiag.placedSamples);
        }
        if (entranceDiag.skippedSamples.length > 0) {
            console.log('[BayGrid][EntranceDiag] skipped samples:', entranceDiag.skippedSamples);
        }
        if (unitsNearEntrance.length > 0) {
            console.log(
                '[BayGrid][EntranceDiag] units near entrances (first 10):',
                unitsNearEntrance.slice(0, 10).map((u) => ({
                    id: u.id,
                    x: +u.x.toFixed(3),
                    y: +u.y.toFixed(3),
                    width: +u.width.toFixed(3),
                    height: +u.height.toFixed(3)
                }))
            );
        }

        // ── STEP 4b: Aggressive collision clipping (trims boxes, NEVER removes) ──
        let clipped = 0;
        const allClipObstacles = [
            ...wallRects.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
            ...this.fzRects.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h }))
        ];

        for (const u of units) {
            for (const ob of allClipObstacles) {
                if (!overlapsRect(u.x, u.y, u.width, u.height, ob.x, ob.y, ob.w, ob.h)) continue;

                const isWide = ob.w > ob.h;
                const maxClipFrac = 0.50;  // Clip up to 50% of box dimension

                if (isWide) {
                    const overFromBottom = (ob.y + ob.h) - u.y;
                    const overFromTop = (u.y + u.height) - ob.y;
                    if (overFromBottom > 0 && overFromBottom < u.height * maxClipFrac) {
                        const origTop = u.y + u.height;
                        u.y = +(ob.y + ob.h).toFixed(4);
                        u.height = +(origTop - u.y).toFixed(4);
                        clipped++;
                    } else if (overFromTop > 0 && overFromTop < u.height * maxClipFrac) {
                        u.height = +(ob.y - u.y).toFixed(4);
                        clipped++;
                    }
                } else {
                    const overFromLeft = (ob.x + ob.w) - u.x;
                    const overFromRight = (u.x + u.width) - ob.x;
                    if (overFromLeft > 0 && overFromLeft < u.width * maxClipFrac) {
                        const origRight = u.x + u.width;
                        u.x = +(ob.x + ob.w).toFixed(4);
                        u.width = +(origRight - u.x).toFixed(4);
                        clipped++;
                    } else if (overFromRight > 0 && overFromRight < u.width * maxClipFrac) {
                        u.width = +(ob.x - u.x).toFixed(4);
                        clipped++;
                    }
                }
            }
            u.area = +(u.width * u.height).toFixed(2);
            u.label = u.area.toFixed(1) + 'm²';
        }

        // ── STEP 4c: Clip boxes that overlap actual wall line segments ──
        // For each box, if a wall segment crosses through it, trim the box
        // on the side where the wall cuts in (user request: "cut those areas")
        let wallClipped = 0;
        for (const u of units) {
            if (this._boxHitsWall(u.x, u.y, u.width, u.height)) {
                // Find which wall segment clips this box and trim accordingly
                for (const seg of this.wallSegs) {
                    if (!this._segIntersectsRect(seg.x1, seg.y1, seg.x2, seg.y2,
                        u.x + 0.02, u.y + 0.02, u.width - 0.04, u.height - 0.04)) continue;

                    const wallIsHorizontal = Math.abs(seg.y1 - seg.y2) < Math.abs(seg.x1 - seg.x2);
                    const maxTrim = wallIsHorizontal ? u.height * 0.50 : u.width * 0.50;

                    if (wallIsHorizontal) {
                        const wallY = (seg.y1 + seg.y2) / 2;
                        const distFromTop = (u.y + u.height) - wallY;
                        const distFromBottom = wallY - u.y;
                        if (distFromTop > 0 && distFromTop < maxTrim) {
                            u.height = +(wallY - u.y - 0.02).toFixed(4);
                            wallClipped++;
                        } else if (distFromBottom > 0 && distFromBottom < maxTrim) {
                            const origTop = u.y + u.height;
                            u.y = +(wallY + 0.02).toFixed(4);
                            u.height = +(origTop - u.y).toFixed(4);
                            wallClipped++;
                        }
                    } else {
                        const wallX = (seg.x1 + seg.x2) / 2;
                        const distFromRight = (u.x + u.width) - wallX;
                        const distFromLeft = wallX - u.x;
                        if (distFromRight > 0 && distFromRight < maxTrim) {
                            u.width = +(wallX - u.x - 0.02).toFixed(4);
                            wallClipped++;
                        } else if (distFromLeft > 0 && distFromLeft < maxTrim) {
                            const origRight = u.x + u.width;
                            u.x = +(wallX + 0.02).toFixed(4);
                            u.width = +(origRight - u.x).toFixed(4);
                            wallClipped++;
                        }
                    }
                }
                u.area = +(u.width * u.height).toFixed(2);
                u.label = u.area.toFixed(1) + 'm²';
            }
        }

        // Remove any boxes that got clipped to invalid dimensions
        const validUnits = units.filter(u => u.width > 0.3 && u.height > 0.3);
        const removed = units.length - validUnits.length;
        units.length = 0;
        units.push(...validUnits);

        // ── STEP 4d: Remove boxes inside wall obstacles or enclosed rooms ──
        // Check 1: Remove boxes that overlap any wall polygon obstacle (fzRects)
        //          For thick_wall rects: use box-edge overlap (stricter)
        //          For other FZ rects: use center-point check (more lenient)
        let wallOverlapRemoved = 0;
        const afterWallCheck = units.filter(u => {
            const cx = u.x + u.width / 2;
            const cy = u.y + u.height / 2;
            const ux2 = u.x + u.width;
            const uy2 = u.y + u.height;
            for (const fz of this.fzRects) {
                // Check if box center is inside any forbidden zone (with small buffer for thick walls)
                const buf = fz.type === 'thick_wall' ? 0.15 : 0;
                if (cx >= fz.x - buf && cx <= fz.x + fz.w + buf &&
                    cy >= fz.y - buf && cy <= fz.y + fz.h + buf) {
                    wallOverlapRemoved++;
                    return false;
                }
            }
            // Check if box body crosses any internal wall segment
            if (this._boxHitsWall(u.x, u.y, u.width, u.height)) {
                wallOverlapRemoved++;
                return false;
            }
            return true;
        });
        units.length = 0;
        units.push(...afterWallCheck);

        // Check 2: Ray-cast enclosure — remove boxes enclosed by walls on all 4 sides
        const maxRayDist = 4.5; // catch stairwell/elevator-sized enclosed spaces
        const allSegs = this.allWallSegs || this.wallSegs;
        const rayHitsWall = (ox, oy, dx, dy) => {
            for (const seg of allSegs) {
                const ex = ox + dx * maxRayDist;
                const ey = oy + dy * maxRayDist;
                if (this._segSegIntersect(ox, oy, ex, ey, seg.x1, seg.y1, seg.x2, seg.y2)) {
                    return true;
                }
            }
            return false;
        };

        let enclosedRemoved = 0;
        const afterEnclosure = units.filter(u => {
            const cx = u.x + u.width / 2;
            const cy = u.y + u.height / 2;
            // Check 4 cardinal directions
            const hitLeft = rayHitsWall(cx, cy, -1, 0);
            const hitRight = rayHitsWall(cx, cy, 1, 0);
            const hitUp = rayHitsWall(cx, cy, 0, 1);
            const hitDown = rayHitsWall(cx, cy, 0, -1);
            if (hitLeft && hitRight && hitUp && hitDown) {
                enclosedRemoved++;
                return false; // box is enclosed by walls on all 4 sides
            }
            return true;
        });
        units.length = 0;
        units.push(...afterEnclosure);

        // Check 3: Remove any box inside entrance clearance zones
        let entranceOverlapRemoved = 0;
        const afterEntranceClearance = units.filter((u) => {
            if (this._boxOverlapsEntranceClearance(u.x, u.y, u.width, u.height)) {
                entranceOverlapRemoved++;
                return false;
            }
            return true;
        });
        units.length = 0;
        units.push(...afterEntranceClearance);

        const finalNearEntrance = units.filter((u) =>
            this._boxOverlapsEntranceClearance(u.x, u.y, u.width, u.height)
        ).length;

        console.log(
            `[BayGrid] Post - process: ${clipped} obstacle - clipped, ${wallClipped} wall - clipped, ` +
            `${removed} invalid - removed, ${enclosedRemoved} enclosed - removed, ` +
            `${entranceOverlapRemoved} entrance - removed, finalNearEntrance=${finalNearEntrance}`
        );

        // ── STEP 5: Assign IDs ───────────────────────────────────────────
        units.forEach((u, i) => {
            u.id = `unit_${i + 1} `;
            u.displayNumber = i + 1;
            u.dimensionLabel = u.width.toFixed(2);
        });
        corridors.forEach((c, i) => { c.id = `corridor_${i} `; });

        // ── STEP 5b: Filter corridors that cross forbidden zones ─────────
        const filteredCorridors = corridors.filter(c => {
            // Check if corridor rectangle overlaps any forbidden zone
            for (const fz of this.fzRects) {
                if (overlapsRect(c.x, c.y, c.width, c.height, fz.x, fz.y, fz.w, fz.h)) {
                    return false; // corridor crosses forbidden zone, remove it
                }
            }
            return true;
        });

        // ── STEP 5c: A* Pathfinding for smart circulation routes ────────
        // Build a walkability grid and generate intelligent paths that
        // route around walls and forbidden zones (based on Google A* suggestion).
        const gridRes = 0.5; // 0.5m per grid cell for precision
        const gridCols = Math.ceil(this.planW / gridRes);
        const gridRows = Math.ceil(this.planH / gridRes);

        // Build walkability grid: 0 = walkable, 1 = blocked
        const walkGrid = Array(gridRows).fill(null).map(() => Array(gridCols).fill(0));

        // Mark walls as blocked
        for (const seg of this.wallSegs) {
            const x1 = Math.min(seg.x1, seg.x2), x2 = Math.max(seg.x1, seg.x2);
            const y1 = Math.min(seg.y1, seg.y2), y2 = Math.max(seg.y1, seg.y2);
            const pad = 0.1;
            for (let r = Math.max(0, Math.floor((y1 - b.minY - pad) / gridRes));
                r <= Math.min(gridRows - 1, Math.ceil((y2 - b.minY + pad) / gridRes)); r++) {
                for (let c = Math.max(0, Math.floor((x1 - b.minX - pad) / gridRes));
                    c <= Math.min(gridCols - 1, Math.ceil((x2 - b.minX + pad) / gridRes)); c++) {
                    walkGrid[r][c] = 1;
                }
            }
        }

        // Mark forbidden zones as blocked
        for (const fz of this.fzRects) {
            for (let r = Math.max(0, Math.floor((fz.y - b.minY) / gridRes));
                r <= Math.min(gridRows - 1, Math.ceil((fz.y + fz.h - b.minY) / gridRes)); r++) {
                for (let c = Math.max(0, Math.floor((fz.x - b.minX) / gridRes));
                    c <= Math.min(gridCols - 1, Math.ceil((fz.x + fz.w - b.minX) / gridRes)); c++) {
                    walkGrid[r][c] = 1;
                }
            }
        }

        // A* pathfinding on the grid
        const astarFind = (startX, startY, endX, endY) => {
            const sr = Math.round((startY - b.minY) / gridRes);
            const sc = Math.round((startX - b.minX) / gridRes);
            const er = Math.round((endY - b.minY) / gridRes);
            const ec = Math.round((endX - b.minX) / gridRes);

            if (sr < 0 || sr >= gridRows || sc < 0 || sc >= gridCols) return null;
            if (er < 0 || er >= gridRows || ec < 0 || ec >= gridCols) return null;

            const key = (r, c) => r * gridCols + c;
            const h = (r, c) => Math.abs(r - er) + Math.abs(c - ec);
            const openSet = [{ r: sr, c: sc }];
            const cameFrom = new Map();
            const gScore = new Map();
            const fScore = new Map();
            const closed = new Set();

            gScore.set(key(sr, sc), 0);
            fScore.set(key(sr, sc), h(sr, sc));

            const dirs = [{ dr: 0, dc: 1 }, { dr: 0, dc: -1 }, { dr: 1, dc: 0 }, { dr: -1, dc: 0 }];
            let iterations = 0;
            const maxIter = gridRows * gridCols * 0.3; // limit to prevent long searches

            while (openSet.length > 0 && iterations++ < maxIter) {
                // Find node with lowest fScore
                let bestIdx = 0;
                for (let i = 1; i < openSet.length; i++) {
                    if ((fScore.get(key(openSet[i].r, openSet[i].c)) || Infinity) <
                        (fScore.get(key(openSet[bestIdx].r, openSet[bestIdx].c)) || Infinity)) {
                        bestIdx = i;
                    }
                }
                const current = openSet[bestIdx];

                if (current.r === er && current.c === ec) {
                    // Reconstruct path
                    const path = [];
                    let node = current;
                    while (node) {
                        path.unshift({
                            x: +(b.minX + node.c * gridRes).toFixed(3),
                            y: +(b.minY + node.r * gridRes).toFixed(3)
                        });
                        node = cameFrom.get(key(node.r, node.c));
                    }
                    return path;
                }

                openSet.splice(bestIdx, 1);
                closed.add(key(current.r, current.c));

                for (const { dr, dc } of dirs) {
                    const nr = current.r + dr, nc = current.c + dc;
                    if (nr < 0 || nr >= gridRows || nc < 0 || nc >= gridCols) continue;
                    if (walkGrid[nr][nc] === 1) continue;
                    if (closed.has(key(nr, nc))) continue;

                    const tentG = (gScore.get(key(current.r, current.c)) || 0) + 1;
                    if (tentG < (gScore.get(key(nr, nc)) || Infinity)) {
                        cameFrom.set(key(nr, nc), current);
                        gScore.set(key(nr, nc), tentG);
                        fScore.set(key(nr, nc), tentG + h(nr, nc));
                        if (!openSet.find(n => n.r === nr && n.c === nc)) {
                            openSet.push({ r: nr, c: nc });
                        }
                    }
                }
            }
            return null; // no path found
        };

        // Simplify A* paths: remove collinear intermediate points
        const simplifyPath = (path) => {
            if (!path || path.length <= 2) return path;
            const result = [path[0]];
            for (let i = 1; i < path.length - 1; i++) {
                const prev = result[result.length - 1];
                const next = path[i + 1];
                const cur = path[i];
                // Keep point only if direction changes
                const sameX = Math.abs(prev.x - cur.x) < 0.01 && Math.abs(cur.x - next.x) < 0.01;
                const sameY = Math.abs(prev.y - cur.y) < 0.01 && Math.abs(cur.y - next.y) < 0.01;
                if (!sameX && !sameY) result.push(cur); // direction change = keep
                else if (!sameX && sameX !== (Math.abs(prev.x - cur.x) < 0.01)) result.push(cur);
                else if (!sameY && sameY !== (Math.abs(prev.y - cur.y) < 0.01)) result.push(cur);
            }
            result.push(path[path.length - 1]);
            return result;
        };

        // ── STEP 7: Apply corridor accessibility fix FIRST ───────────────
        // Use the connectivity detection and gap bridging from AdvancedCorridorNetworkGenerator
        // but keep the grid-based corridors from ProfessionalGridLayoutEngine
        console.log('[BayGrid] Applying corridor accessibility fix...');

        // Import the connectivity detection methods
        const AdvancedCorridorNetworkGenerator = require('./advancedCorridorNetworkGenerator');
        const floorPlanForCorridors = {
            bounds: this.bounds,
            walls: [], // ProfessionalGridLayoutEngine already handles wall collision
            forbiddenZones: this.forbiddenZones,
            entrances: this.entrances
        };

        const corridorGenerator = new AdvancedCorridorNetworkGenerator(
            floorPlanForCorridors,
            units, // Use the placed units as îlots
            {
                corridorWidth: this.corridorWidth,
                margin: 0.2,
                minCorridorLength: 2.0
            }
        );

        // Apply connectivity validation and gap bridging to the existing grid corridors
        const enhancedCorridors = corridorGenerator.validateAndBridgeConnectivity(filteredCorridors);
        console.log(`[BayGrid] Corridor fix: ${filteredCorridors.length} original → ${enhancedCorridors.length} enhanced(with connectivity)`);

        // ── STEP 8: Smart circulation paths via A* ───────────────────────
        // Generate actual routed paths along corridor centerlines using A*.
        // IMPORTANT: Use enhancedCorridors (with connectivity fix) not filteredCorridors
        const circulationPaths = [];

        // For each corridor, create a centerline path
        for (const c of enhancedCorridors) {
            const cx = c.x + c.width / 2;
            const cy = c.y + c.height / 2;

            if (c.direction === 'horizontal') {
                // Horizontal corridor: find complete path from left to right edge
                const path = astarFind(c.x + 0.2, cy, c.x + c.width - 0.2, cy);
                if (path) {
                    circulationPaths.push({
                        type: c.type || 'ACCESS',
                        direction: 'horizontal',
                        points: simplifyPath(path)
                    });
                } else {
                    // Fallback: straight centerline
                    circulationPaths.push({
                        type: c.type || 'ACCESS',
                        direction: 'horizontal',
                        points: [
                            { x: c.x, y: cy },
                            { x: c.x + c.width, y: cy }
                        ]
                    });
                }
            } else {
                // Vertical corridor: find path from top to bottom
                const path = astarFind(cx, c.y + 0.2, cx, c.y + c.height - 0.2);
                if (path) {
                    circulationPaths.push({
                        type: c.type || 'SPINE',
                        direction: 'vertical',
                        points: simplifyPath(path)
                    });
                } else {
                    circulationPaths.push({
                        type: c.type || 'SPINE',
                        direction: 'vertical',
                        points: [
                            { x: cx, y: c.y },
                            { x: cx, y: c.y + c.height }
                        ]
                    });
                }
            }
        }

        console.log(`[BayGrid] Smart circulation: ${circulationPaths.length} routed paths(from ${enhancedCorridors.length} enhanced corridors)`);

        // ── STEP 9: Generate radiators (red wavy lines) ───────────────────
        const radiators = this._generateRadiators(units);

        // ── STEP 10: Floor plan outline ───────────────────────────────────
        const floorPlanOutline = this.buildingPolygon && this.buildingPolygon.length >= 3
            ? this.buildingPolygon.map(p => ({ x: p.x, y: p.y }))
            : [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY },
            { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }];

        return {
            units,
            corridors: enhancedCorridors, // Use enhanced corridors with connectivity fix
            radiators,
            circulationPaths, // Generated from enhancedCorridors
            floorPlanOutline,
            layoutMode: 'professional'
        };
    }

    _generateRadiators(units) {
        const radiators = [];
        for (const u of units) {
            const face = u.corridorFace || 'top';
            if (face === 'top') {
                const y = u.y + u.height;
                const pts = zigzag(u.x, y, u.x + u.width, y,
                    0, 1, this.radiatorOffset, this.radiatorAmplitude, this.radiatorWavelength);
                if (pts.length >= 2) radiators.push({ points: pts, unitId: u.id });
            } else {
                const y = u.y;
                const pts = zigzag(u.x, y, u.x + u.width, y,
                    0, -1, -this.radiatorOffset, this.radiatorAmplitude, this.radiatorWavelength);
                if (pts.length >= 2) radiators.push({ points: pts, unitId: u.id });
            }
        }
        return radiators;
    }
}

module.exports = ProfessionalGridLayoutEngine;
