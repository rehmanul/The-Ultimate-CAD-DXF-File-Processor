'use strict';

const { extractSegments, extractRect, segmentIntersectsRect, rectHitsWalls } = require('./geometry');

/**
 * BoxPlacer v3 - COSTO reference-accurate placement
 * 
 * Key rules from reference plan:
 * 1. Boxes touch perimeter walls (flush, no margin on the wall side)
 * 2. Corridors (1.2m) run BETWEEN back-to-back box rows only
 * 3. Corridors NEVER touch/cross walls
 * 4. Strips = row1(boxes) + corridor(1.2m) + row2(boxes)
 * 5. Boxes fill wall-to-wall in the secondary axis
 */
class BoxPlacer {
    constructor(floorPlan, options) {
        this.bounds = floorPlan.bounds;
        this.options = options;

        // Extract ALL wall segments (skip tiny fragments < 0.3m)
        this.allWalls = [];
        for (const wall of (floorPlan.walls || [])) {
            const segs = extractSegments(wall);
            for (const seg of segs) {
                const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
                if (len < 0.3) continue;
                seg.len = len;
                this.allWalls.push(seg);
            }
        }

        // Pre-process obstacle rects from forbidden zones + entrances
        this.obstacleRects = [];
        for (const fz of (floorPlan.forbiddenZones || [])) {
            const r = extractRect(fz);
            if (r) this.obstacleRects.push(r);
        }
        for (const ent of (floorPlan.entrances || [])) {
            const segs = extractSegments(ent);
            if (segs.length > 0) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const s of segs) {
                    minX = Math.min(minX, s.x1, s.x2);
                    minY = Math.min(minY, s.y1, s.y2);
                    maxX = Math.max(maxX, s.x1, s.x2);
                    maxY = Math.max(maxY, s.y1, s.y2);
                }
                // Entrance clearance zone (doors need approach space)
                this.obstacleRects.push({
                    x: minX - 0.5, y: minY - 0.5,
                    w: maxX - minX + 1.0, h: maxY - minY + 1.0
                });
            }
        }

        console.log(`[BoxPlacer] ${this.allWalls.length} walls, ${this.obstacleRects.length} obstacles`);
    }

    placeInRooms(rooms, distribution) {
        const resultH = this._placeStrips('horizontal', distribution);
        const resultV = this._placeStrips('vertical', distribution);
        const best = resultH.units.length >= resultV.units.length ? resultH : resultV;
        const bestDir = best === resultH ? 'horizontal' : 'vertical';
        console.log(`[BoxPlacer] H:${resultH.units.length} vs V:${resultV.units.length} -> using ${bestDir}`);

        // Cross-fill pass
        const crossFilled = this._crossFill(best, bestDir, distribution);
        if (crossFilled.units.length > best.units.length) {
            console.log(`[BoxPlacer] Cross-fill added ${crossFilled.units.length - best.units.length} units`);
        }

        // Post-processing: remove any box that intersects a wall OR extends outside bounds
        const b = this.bounds;
        const tolerance = 0.01;
        const beforeCount = crossFilled.units.length;
        crossFilled.units = crossFilled.units.filter(u => {
            // Reject boxes outside floor plan boundaries
            if (u.x < b.minX - tolerance || u.y < b.minY - tolerance ||
                u.x + u.width > b.maxX + tolerance || u.y + u.height > b.maxY + tolerance) {
                return false;
            }
            return !rectHitsWalls(u.x, u.y, u.width, u.height, this.allWalls, 0);
        });
        const removed = beforeCount - crossFilled.units.length;
        if (removed > 0) {
            console.log(`[BoxPlacer] Post-filter removed ${removed} wall-intersecting or out-of-bounds boxes (${crossFilled.units.length} remain)`);
        } else {
            console.log(`[BoxPlacer] ✓ All ${crossFilled.units.length} boxes are wall-free and within bounds`);
        }

        // Clamp corridor rectangles to floor bounds
        crossFilled.corridors = crossFilled.corridors.filter(c => {
            const cx1 = Math.max(c.x, b.minX);
            const cy1 = Math.max(c.y, b.minY);
            const cx2 = Math.min(c.x + c.width, b.maxX);
            const cy2 = Math.min(c.y + c.height, b.maxY);
            if (cx2 - cx1 < 0.3 || cy2 - cy1 < 0.3) return false;
            c.x = cx1; c.y = cy1;
            c.width = cx2 - cx1; c.height = cy2 - cy1;
            return true;
        });

        return crossFilled;
    }

    /**
     * Place strips across the floor plan.
     * 
     * For horizontal orientation: strips run left-to-right (primary=X),
     * boxes stack top-to-bottom within each strip (secondary=Y).
     * 
     * CRITICAL: perimeterMargin=0 so boxes touch outer walls.
     * wallClearance only applies to INTERNAL walls crossing through rows.
     */
    _placeStrips(orientation, distribution) {
        const b = this.bounds;
        const cw = this.options.corridorWidth;
        const bd = this.options.boxDepth;
        const spacing = this.options.boxSpacing;
        const isH = orientation === 'horizontal';

        // NO perimeter margin — boxes touch outer walls (like reference)
        const pStart = isH ? b.minX : b.minY;
        const pEnd = isH ? b.maxX : b.maxY;
        const sStart = isH ? b.minY : b.minX;
        const sEnd = isH ? b.maxY : b.maxX;
        const pSpan = pEnd - pStart;

        const stripWidth = bd + cw + bd; // back-to-back with corridor
        const numStrips = Math.floor(pSpan / stripWidth);
        if (numStrips < 1) return { units: [], corridors: [] };

        // Center strips to distribute leftover evenly on both edges
        const totalStripsWidth = numStrips * stripWidth;
        const leftover = pSpan - totalStripsWidth;
        const startOffset = leftover / 2;

        const sizes = this._buildCatalog(distribution);
        const sizesByWidthDesc = [...new Set(sizes.map(s => s.width))]
            .sort((a, b) => b - a)
            .map(w => sizes.find(s => s.width === w));
        let sizeIdx = 0, unitId = 1;
        const allUnits = [], allCorridors = [];

        // Place main strips
        for (let s = 0; s < numStrips; s++) {
            const stripP = pStart + startOffset + s * stripWidth;
            const row1P = stripP;
            const corrP = stripP + bd;
            const row2P = stripP + bd + cw;

            // Row 1: boxes (door opens toward corridor)
            const r1 = this._fillRow(row1P, bd, sStart, sEnd, isH, sizes, sizesByWidthDesc, sizeIdx, unitId, 'toleGrise', 'left');
            allUnits.push(...r1.units); sizeIdx = r1.sizeIdx; unitId = r1.unitId;

            // Row 2: boxes (door opens toward corridor)
            const r2 = this._fillRow(row2P, bd, sStart, sEnd, isH, sizes, sizesByWidthDesc, sizeIdx, unitId, 'toleBlanche', 'right');
            allUnits.push(...r2.units); sizeIdx = r2.sizeIdx; unitId = r2.unitId;

            // Corridor: only spans where BOTH rows have boxes, and must not cross walls
            if (r1.units.length > 0 || r2.units.length > 0) {
                this._addCorridorSegments(corrP, cw, r1.units, r2.units, isH, allCorridors);
            }
        }

        // Fill edge space (leftover on both sides) with single rows flush to walls
        if (startOffset >= bd * 0.6) {
            // Left/top edge: single row flush against the wall
            const edgeR = this._fillRow(pStart, Math.min(bd, startOffset), sStart, sEnd, isH, sizes, sizesByWidthDesc, sizeIdx, unitId, 'toleGrise', 'left');
            allUnits.push(...edgeR.units); sizeIdx = edgeR.sizeIdx; unitId = edgeR.unitId;
        }
        const rightEdgeStart = pStart + startOffset + numStrips * stripWidth;
        const rightEdgeSpace = pEnd - rightEdgeStart;
        if (rightEdgeSpace >= bd * 0.6) {
            const edgeR = this._fillRow(rightEdgeStart, Math.min(bd, rightEdgeSpace), sStart, sEnd, isH, sizes, sizesByWidthDesc, sizeIdx, unitId, 'toleBlanche', 'right');
            allUnits.push(...edgeR.units); sizeIdx = edgeR.sizeIdx; unitId = edgeR.unitId;
        }

        // Verify corridors don't cross walls
        let wallViolations = 0;
        for (const c of allCorridors) {
            if (rectHitsWalls(c.x, c.y, c.width, c.height, this.allWalls, 0)) {
                wallViolations++;
            }
        }
        if (wallViolations > 0) {
            console.warn(`[BoxPlacer] WARNING: ${wallViolations}/${allCorridors.length} corridors touch walls`);
        } else {
            console.log(`[BoxPlacer] ✓ All ${allCorridors.length} corridors are wall-free`);
        }

        return { units: allUnits, corridors: allCorridors };
    }

    /**
     * Add corridor segments between two box rows.
     * Corridors only span where boxes actually exist, and are split at walls.
     * Small inset (0.05m) on each end so corridors don't visually touch walls.
     */
    _addCorridorSegments(corrP, cw, row1Units, row2Units, isH, allCorridors) {
        // Find the secondary-axis extent covered by boxes in either row
        let secMin = Infinity, secMax = -Infinity;
        for (const u of [...row1Units, ...row2Units]) {
            const uStart = isH ? u.y : u.x;
            const uEnd = isH ? u.y + u.height : u.x + u.width;
            if (uStart < secMin) secMin = uStart;
            if (uEnd > secMax) secMax = uEnd;
        }
        if (secMin >= secMax) return;

        // Split corridor at walls to ensure no wall crossings
        const gaps = this._findGaps(corrP, cw, secMin, secMax, isH, 0.05);
        for (const gap of gaps) {
            // Inset corridor ends by 0.08m so they don't visually touch walls
            const inset = 0.08;
            const gStart = gap.start + inset;
            const gEnd = gap.end - inset;
            const len = gEnd - gStart;
            if (len < 0.8) continue; // Skip tiny fragments

            const cx = isH ? corrP : gStart;
            const cy = isH ? gStart : corrP;
            const cWidth = isH ? cw : len;
            const cHeight = isH ? len : cw;

            // Final safety check: verify this corridor rect doesn't hit any wall
            if (rectHitsWalls(cx, cy, cWidth, cHeight, this.allWalls, 0)) {
                continue; // Skip — wall runs through this corridor segment
            }

            allCorridors.push({
                id: `corridor_${allCorridors.length}`,
                type: 'ACCESS',
                direction: isH ? 'vertical' : 'horizontal',
                x: cx, y: cy, width: cWidth, height: cHeight
            });
        }
    }

    /**
     * Cross-fill: find large empty zones and fill with perpendicular rows.
     */
    _crossFill(result, mainDir, distribution) {
        const b = this.bounds;
        const bd = this.options.boxDepth;
        const spacing = this.options.boxSpacing;
        const crossDir = mainDir === 'horizontal' ? 'vertical' : 'horizontal';
        const isH = crossDir === 'horizontal';

        const sizes = this._buildCatalog(distribution);
        const sizesByWidthDesc = [...new Set(sizes.map(s => s.width))]
            .sort((a, b) => b - a)
            .map(w => sizes.find(s => s.width === w));

        // Build 1m occupancy grid
        const cellSize = 1.0;
        const cols = Math.ceil((b.maxX - b.minX) / cellSize);
        const rows = Math.ceil((b.maxY - b.minY) / cellSize);
        const occupied = Array.from({ length: rows }, () => new Uint8Array(cols));

        for (const u of result.units) {
            const c1 = Math.floor((u.x - b.minX) / cellSize);
            const r1 = Math.floor((u.y - b.minY) / cellSize);
            const c2 = Math.ceil((u.x + u.width - b.minX) / cellSize);
            const r2 = Math.ceil((u.y + u.height - b.minY) / cellSize);
            for (let r = Math.max(0, r1); r < Math.min(rows, r2); r++)
                for (let c = Math.max(0, c1); c < Math.min(cols, c2); c++)
                    occupied[r][c] = 1;
        }
        for (const c of result.corridors) {
            const c1 = Math.floor((c.x - b.minX) / cellSize);
            const r1 = Math.floor((c.y - b.minY) / cellSize);
            const c2 = Math.ceil((c.x + c.width - b.minX) / cellSize);
            const r2 = Math.ceil((c.y + c.height - b.minY) / cellSize);
            for (let r = Math.max(0, r1); r < Math.min(rows, r2); r++)
                for (let cc = Math.max(0, c1); cc < Math.min(cols, c2); cc++)
                    occupied[r][cc] = 1;
        }

        // Flood-fill to find empty zones >= 3m x 3m
        const visited = Array.from({ length: rows }, () => new Uint8Array(cols));
        const emptyZones = [];

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (occupied[r][c] || visited[r][c]) continue;
                let minR = r, maxR = r, minC = c, maxC = c, count = 0;
                const queue = [[r, c]];
                visited[r][c] = 1;
                while (queue.length > 0) {
                    const [cr, cc] = queue.shift();
                    count++;
                    if (cr < minR) minR = cr; if (cr > maxR) maxR = cr;
                    if (cc < minC) minC = cc; if (cc > maxC) maxC = cc;
                    for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                        const nr = cr + dr, nc = cc + dc;
                        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !occupied[nr][nc] && !visited[nr][nc]) {
                            visited[nr][nc] = 1;
                            queue.push([nr, nc]);
                        }
                    }
                }
                const w = maxC - minC + 1, h = maxR - minR + 1;
                if (w >= 3 && h >= 3 && count >= 9) {
                    emptyZones.push({
                        minX: b.minX + minC * cellSize,
                        minY: b.minY + minR * cellSize,
                        maxX: b.minX + (maxC + 1) * cellSize,
                        maxY: b.minY + (maxR + 1) * cellSize,
                        area: count * cellSize * cellSize
                    });
                }
            }
        }

        if (emptyZones.length === 0) return result;
        emptyZones.sort((a, b) => b.area - a.area);

        const newUnits = [...result.units];
        const newCorridors = [...result.corridors];
        let sizeIdx = 0, unitId = newUnits.length + 1;

        for (const zone of emptyZones) {
            if (zone.area < 6) continue;
            const pS = (isH ? zone.minX : zone.minY) + 0.1;
            const pE = (isH ? zone.maxX : zone.maxY) - 0.1;
            const sS = (isH ? zone.minY : zone.minX) + 0.1;
            const sE = (isH ? zone.maxY : zone.maxX) - 0.1;
            if (pE - pS < bd) continue;

            let cursor = pS;
            while (cursor + bd <= pE) {
                const rr = this._fillRow(cursor, bd, sS, sE, isH, sizes, sizesByWidthDesc, sizeIdx, unitId, 'toleGrise', 'left');
                const valid = rr.units.filter(nu => {
                    // Check bounds
                    if (nu.x < b.minX || nu.y < b.minY ||
                        nu.x + nu.width > b.maxX + 0.01 || nu.y + nu.height > b.maxY + 0.01) return false;
                    // Check overlap with existing units
                    for (const eu of newUnits) {
                        if (nu.x < eu.x + eu.width && nu.x + nu.width > eu.x &&
                            nu.y < eu.y + eu.height && nu.y + nu.height > eu.y) return false;
                    }
                    return true;
                });
                newUnits.push(...valid);
                sizeIdx = rr.sizeIdx; unitId = rr.unitId;
                cursor += bd + spacing;
            }
        }

        return { units: newUnits, corridors: newCorridors };
    }

    /**
     * Fill a single row with boxes in wall-free gaps.
     * Boxes are placed flush — no clearance from perimeter walls.
     * Only internal walls that cross THROUGH the row create gaps.
     */
    _fillRow(rowP, rowDepth, sStart, sEnd, isH, sizes, sizesByWidthDesc, sizeIdx, unitId, partitionType, row) {
        const spacing = this.options.boxSpacing;
        const units = [];
        // Use small clearance only for internal wall crossings
        const gaps = this._findGaps(rowP, rowDepth, sStart, sEnd, isH, 0.08);
        for (const gap of gaps) {
            let cursor = gap.start;
            while (true) {
                const remaining = gap.end - cursor;
                if (remaining < 1.0) break;

                let size = sizes[sizeIdx % sizes.length];
                if (size.width <= remaining) {
                    sizeIdx++;
                } else {
                    size = sizesByWidthDesc.find(s => s.width <= remaining) || null;
                    if (!size) break;
                }

                const boxLen = size.width;
                const bx = isH ? rowP : cursor;
                const by = isH ? cursor : rowP;
                const bw = isH ? rowDepth : boxLen;
                const bh = isH ? boxLen : rowDepth;

                // Boundary check: skip boxes that extend outside floor plan
                const bb = this.bounds;
                if (bx >= bb.minX - 0.01 && by >= bb.minY - 0.01 &&
                    bx + bw <= bb.maxX + 0.01 && by + bh <= bb.maxY + 0.01) {
                    units.push(this._makeUnit(unitId++, bx, by, bw, bh, size.type, partitionType, row));
                }
                cursor += boxLen + spacing;
            }
        }
        return { units, sizeIdx, unitId };
    }

    /**
     * Find wall-free gaps along a row band.
     * Only walls that actually CROSS through the row band create blocked zones.
     * Perimeter walls running along the edge do NOT block (boxes touch them).
     */
    _findGaps(rowP, rowDepth, sStart, sEnd, isH, cl) {
        const crossings = [];
        const rowMin = rowP;
        const rowMax = rowP + rowDepth;

        for (const seg of this.allWalls) {
            const wPri1 = isH ? seg.x1 : seg.y1;
            const wPri2 = isH ? seg.x2 : seg.y2;
            const wSec1 = isH ? seg.y1 : seg.x1;
            const wSec2 = isH ? seg.y2 : seg.x2;

            const wPriMin = Math.min(wPri1, wPri2);
            const wPriMax = Math.max(wPri1, wPri2);
            const wSecMin = Math.min(wSec1, wSec2);
            const wSecMax = Math.max(wSec1, wSec2);

            // Wall must be within secondary range
            if (wSecMax < sStart || wSecMin > sEnd) continue;

            // Check if wall is inside the row band in primary axis
            // For thin/zero-width walls (like vertical lines), check containment
            const priSpan = wPriMax - wPriMin;

            if (priSpan < 0.05) {
                // Thin or zero-width wall (a line) — check if it's inside the row band
                const wallPos = (wPriMin + wPriMax) / 2;
                // Skip if it's on the perimeter edge (boxes touch perimeter walls)
                if (wallPos <= rowMin + 0.05 || wallPos >= rowMax - 0.05) continue;
                // It's inside the row band — block its secondary range
                crossings.push({ start: wSecMin - cl, end: wSecMax + cl });
            } else {
                // Thick wall — check overlap with row band
                const overlapMin = Math.max(wPriMin, rowMin);
                const overlapMax = Math.min(wPriMax, rowMax);
                const overlap = overlapMax - overlapMin;

                if (overlap < 0.02) continue; // No real overlap

                // If the wall is thin (< 0.25m) and sits right at the row edge,
                // it's a perimeter wall — boxes should touch it, don't block
                if (priSpan < 0.25) {
                    const wallCenter = (wPriMin + wPriMax) / 2;
                    const atStartEdge = Math.abs(wallCenter - rowMin) < 0.2;
                    const atEndEdge = Math.abs(wallCenter - rowMax) < 0.2;
                    if (atStartEdge || atEndEdge) continue;
                }

                // This wall crosses through the row — block its secondary range
                crossings.push({ start: wSecMin - cl, end: wSecMax + cl });
            }
        }

        // Obstacles always block
        for (const r of this.obstacleRects) {
            const oPriMin = isH ? r.x : r.y;
            const oPriMax = isH ? r.x + r.w : r.y + r.h;
            const oSecMin = isH ? r.y : r.x;
            const oSecMax = isH ? r.y + r.h : r.x + r.w;

            if (oPriMax < rowMin || oPriMin > rowMax) continue;
            if (oSecMax < sStart || oSecMin > sEnd) continue;

            crossings.push({ start: oSecMin - cl, end: oSecMax + cl });
        }

        if (crossings.length === 0) {
            return [{ start: sStart, end: sEnd }];
        }

        crossings.sort((a, b) => a.start - b.start);
        const merged = [{ ...crossings[0] }];
        for (let i = 1; i < crossings.length; i++) {
            const last = merged[merged.length - 1];
            if (crossings[i].start <= last.end + 0.1) {
                last.end = Math.max(last.end, crossings[i].end);
            } else {
                merged.push({ ...crossings[i] });
            }
        }

        const gaps = [];
        let cursor = sStart;
        for (const block of merged) {
            if (block.start > cursor + 0.5) {
                gaps.push({ start: cursor, end: block.start });
            }
            cursor = Math.max(cursor, block.end);
        }
        if (cursor < sEnd - 0.5) {
            gaps.push({ start: cursor, end: sEnd });
        }

        return gaps.filter(g => (g.end - g.start) >= 0.8);
    }

    _makeUnit(id, x, y, w, h, type, partitionType, row) {
        return {
            id: `unit_${id}`, x, y, width: w, height: h,
            area: Math.round(w * h * 100) / 100,
            type, label: `${(w * h).toFixed(1)}m²`,
            partitionType, row
        };
    }

    _buildCatalog(distribution) {
        const catalog = [
            { type: 'S', width: 1.0 },
            { type: 'S', width: 1.2 },
            { type: 'S', width: 1.4 },
            { type: 'M', width: 1.6 },
            { type: 'M', width: 2.0 },
            { type: 'L', width: 2.2 },
            { type: 'L', width: 2.5 },
            { type: 'XL', width: 3.0 },
            { type: 'XL', width: 3.5 }
        ];
        const sizes = [];
        const total = Object.values(distribution).reduce((s, v) => s + v, 0) || 100;
        for (const item of catalog) {
            const pct = (distribution[item.type] || 0) / total;
            const count = Math.max(1, Math.round(pct * 10));
            for (let i = 0; i < count; i++) sizes.push(item);
        }
        for (let i = sizes.length - 1; i > 0; i--) {
            const j = Math.floor(((i * 7 + 3) % (i + 1)));
            [sizes[i], sizes[j]] = [sizes[j], sizes[i]];
        }
        return sizes.length > 0 ? sizes : [{ type: 'M', width: 2.0 }];
    }
}

module.exports = BoxPlacer;
