'use strict';

const { extractSegments, extractRect, rectHitsWalls, rectHitsRects } = require('./geometry');

/**
 * BoxPlacer v4 - Wall-anchored COSTO placement
 * 
 * Key rules:
 * 1. Boxes touch perimeter walls (flush, no margin on the wall side)
 * 2. Corridors (1.2m) run BETWEEN back-to-back box rows only
 * 3. Corridors NEVER touch/cross walls
 * 4. First row flush against wall A, last row flush against wall B
 * 5. Boxes fill wall-to-wall in the secondary axis
 */
class BoxPlacer {
    constructor(floorPlan, options) {
        this.bounds = floorPlan.bounds;
        this.options = options;
        this.maximizeFill = options.maximizeFill === true;
        this.rowGapClearance = Number.isFinite(options.rowGapClearance)
            ? Math.max(0.02, Number(options.rowGapClearance))
            : (this.maximizeFill ? 0.05 : 0.08);
        this.corridorGapClearance = Number.isFinite(options.corridorGapClearance)
            ? Math.max(0.01, Number(options.corridorGapClearance))
            : (this.maximizeFill ? 0.03 : 0.05);
        this.corridorInset = Number.isFinite(options.corridorInset)
            ? Math.max(0, Number(options.corridorInset))
            : (this.maximizeFill ? 0.03 : 0.08);
        this.minGapLength = Number.isFinite(options.minGapLength)
            ? Math.max(0.4, Number(options.minGapLength))
            : (this.maximizeFill ? 0.6 : 0.8);
        this.crossFillMinSpan = Number.isFinite(options.crossFillMinSpan)
            ? Math.max(2, Math.floor(Number(options.crossFillMinSpan)))
            : (this.maximizeFill ? 2 : 3);
        this.crossFillMinArea = Number.isFinite(options.crossFillMinArea)
            ? Math.max(4, Number(options.crossFillMinArea))
            : (this.maximizeFill ? 4 : 9);
        this.enableCrossFill = options.crossFill !== false; // enabled by default; set crossFill:false to disable

        // Extract wall segments.
        // - allWalls: layout guidance (skip tiny fragments)
        // - collisionWalls: fine-grain collision validation (keep short fragments)
        this.allWalls = [];
        this.collisionWalls = [];
        for (const wall of (floorPlan.walls || [])) {
            const segs = extractSegments(wall);
            for (const seg of segs) {
                const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
                seg.len = len;
                if (len >= 0.05) this.collisionWalls.push(seg);
                if (len >= 0.3) this.allWalls.push(seg);
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
        const placementBounds = this._normalizePlacementBounds(rooms);
        if (!placementBounds.length) {
            placementBounds.push({ ...this.bounds, source: 'fallback-bounds' });
        }

        const merged = { units: [], corridors: [] };
        const unitInset = this.maximizeFill ? 0.005 : 0.01;
        const corridorInset = this.maximizeFill ? 0.005 : 0.015;

        const rectsOverlap = (a, b, inset = 0) => (
            a.x < b.x + b.width - inset &&
            a.x + a.width > b.x + inset &&
            a.y < b.y + b.height - inset &&
            a.y + a.height > b.y + inset
        );

        for (const zoneBounds of placementBounds) {
            const resultH = this._placeStrips('horizontal', distribution, zoneBounds);
            const resultV = this._placeStrips('vertical', distribution, zoneBounds);
            let best = resultH.units.length >= resultV.units.length ? resultH : resultV;
            const orient = best === resultH ? 'horizontal' : 'vertical';

            if (this.enableCrossFill) {
                best = this._crossFill(best, orient, distribution, zoneBounds);
            }

            for (const unit of (best.units || [])) {
                const overlapsUnit = merged.units.some((u) => rectsOverlap(unit, u, unitInset));
                const overlapsCorridor = merged.corridors.some((c) => rectsOverlap(unit, c, unitInset));
                if (!overlapsUnit && !overlapsCorridor) merged.units.push(unit);
            }

            for (const corridor of (best.corridors || [])) {
                const overlapsUnit = merged.units.some((u) => rectsOverlap(corridor, u, corridorInset));
                const overlapsCorridor = merged.corridors.some((c) => rectsOverlap(corridor, c, corridorInset));
                if (!overlapsUnit && !overlapsCorridor) merged.corridors.push(corridor);
            }
        }

        const sanitized = this._sanitizePlacement(merged.units, merged.corridors);
        const best = { units: sanitized.units, corridors: sanitized.corridors };
        if (sanitized.removedUnits > 0 || sanitized.removedCorridors > 0) {
            console.warn(
                `[BoxPlacer] Sanitized overlaps: removed ${sanitized.removedUnits} units, ` +
                `${sanitized.removedCorridors} corridors`
            );
        }

        best.units.forEach((u, idx) => {
            const ww = Math.round(Math.max(u.width, u.height) * 100) / 100;
            u.id = `unit_${idx + 1}`;
            u.label = `${ww.toFixed(2)}`;
            u.sublabel = `${u.area.toFixed(1)}m²`;
        });
        best.corridors.forEach((c, idx) => {
            c.id = `corridor_${idx}`;
        });

        return best;
    }

    _normalizePlacementBounds(rooms) {
        const out = [];
        const seen = new Set();
        const minArea = this.maximizeFill ? 6 : 8;
        const minSide = this.maximizeFill ? 1.6 : 1.8;
        const inset = this.maximizeFill ? 0.04 : 0.08;

        const addBounds = (minX, minY, maxX, maxY, source = 'room') => {
            if (![minX, minY, maxX, maxY].every(Number.isFinite)) return;
            if (maxX <= minX || maxY <= minY) return;

            const x1 = Math.max(this.bounds.minX, minX + inset);
            const y1 = Math.max(this.bounds.minY, minY + inset);
            const x2 = Math.min(this.bounds.maxX, maxX - inset);
            const y2 = Math.min(this.bounds.maxY, maxY - inset);
            const w = x2 - x1;
            const h = y2 - y1;
            const area = w * h;
            if (w < minSide || h < minSide || area < minArea) return;

            const key = [
                Math.round(x1 * 20),
                Math.round(y1 * 20),
                Math.round(x2 * 20),
                Math.round(y2 * 20)
            ].join('|');
            if (seen.has(key)) return;
            seen.add(key);

            out.push({ minX: x1, minY: y1, maxX: x2, maxY: y2, area, source });
        };

        (Array.isArray(rooms) ? rooms : []).forEach((room) => {
            if (!room) return;
            if (
                room.bounds &&
                Number.isFinite(room.bounds.minX) &&
                Number.isFinite(room.bounds.minY) &&
                Number.isFinite(room.bounds.maxX) &&
                Number.isFinite(room.bounds.maxY)
            ) {
                addBounds(room.bounds.minX, room.bounds.minY, room.bounds.maxX, room.bounds.maxY, 'room-bounds');
                return;
            }
            if (
                Number.isFinite(room.x) &&
                Number.isFinite(room.y) &&
                Number.isFinite(room.width) &&
                Number.isFinite(room.height)
            ) {
                addBounds(room.x, room.y, room.x + room.width, room.y + room.height, 'room-rect');
                return;
            }
            if (Array.isArray(room.polygon) && room.polygon.length >= 3) {
                let minX = Infinity;
                let minY = Infinity;
                let maxX = -Infinity;
                let maxY = -Infinity;
                room.polygon.forEach((pt) => {
                    const x = Number(Array.isArray(pt) ? pt[0] : pt && pt.x);
                    const y = Number(Array.isArray(pt) ? pt[1] : pt && pt.y);
                    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                });
                addBounds(minX, minY, maxX, maxY, 'room-polygon');
            }
        });

        out.sort((a, b) => b.area - a.area);
        return out;
    }
    _selectOrientation() {
        const b = this.bounds;
        const w = b.maxX - b.minX;
        const h = b.maxY - b.minY;
        return w >= h ? 'horizontal' : 'vertical';
    }

    /**
     * Place strips â€” WALL-ANCHORED layout.
     * 
     * Pattern: Wall â†’ Row â†’ Corridor â†’ Row â†’ Corridor â†’ ... â†’ Row â†’ Wall
     * 
     * CRITICAL RULES:
     * 1. First row flush against wall A (perimeter)
     * 2. Last row flush against wall B (perimeter)
     * 3. Corridors ONLY between box rows, NEVER against walls
     * 4. Boxes fill wall-to-wall in the secondary axis
     */
    _placeStrips(orientation, distribution, customBounds = null) {
        const b = customBounds || this.bounds;
        const cw = this.options.corridorWidth;
        const bd = this.options.boxDepth;
        const isH = orientation === 'horizontal';

        const pStart = isH ? b.minX : b.minY;
        const pEnd = isH ? b.maxX : b.maxY;
        const sStart = isH ? b.minY : b.minX;
        const sEnd = isH ? b.maxY : b.maxX;
        const pSpan = pEnd - pStart;

        // Minimum: 2 rows + 1 corridor
        if (pSpan < bd + cw + bd) return { units: [], corridors: [] };

        // Build row/corridor positions anchored from wall A inward
        const rowPositions = [];
        const corridorPositions = [];
        let cursor = pStart;

        // First row: flush against wall A
        rowPositions.push({ p: cursor, depth: bd, partition: 'toleGrise', side: 'left' });
        cursor += bd;

        // Fill with corridor+row pairs
        while (cursor + cw + bd <= pEnd + 0.01) {
            corridorPositions.push({ p: cursor, width: cw });
            cursor += cw;

            const partIdx = rowPositions.length;
            rowPositions.push({
                p: cursor, depth: bd,
                partition: partIdx % 2 === 0 ? 'toleGrise' : 'toleBlanche',
                side: partIdx % 2 === 0 ? 'left' : 'right'
            });
            cursor += bd;
        }

        // If leftover space can fit a partial row flush against wall B
        const leftover = pEnd - cursor;
        if (leftover >= bd * 0.5) {
            if (leftover >= cw + bd * 0.5) {
                corridorPositions.push({ p: cursor, width: cw });
                cursor += cw;
                rowPositions.push({ p: cursor, depth: Math.min(bd, pEnd - cursor), partition: 'toleGrise', side: 'left' });
            } else {
                rowPositions.push({ p: cursor, depth: leftover, partition: 'toleGrise', side: 'left' });
            }
        }

        const sizes = this._buildCatalog(distribution);
        const sizesByWidthDesc = [...new Set(sizes.map(s => s.width))]
            .sort((a, b) => b - a)
            .map(w => sizes.find(s => s.width === w));
        let sizeIdx = 0, unitId = 1;
        const allUnits = [], allCorridors = [];

        // Place boxes in each row
        for (const row of rowPositions) {
            if (row.depth < 0.5) continue;
            const r = this._fillRow(row.p, row.depth, sStart, sEnd, isH, sizes, sizesByWidthDesc, sizeIdx, unitId, row.partition, row.side);
            allUnits.push(...r.units);
            sizeIdx = r.sizeIdx;
            unitId = r.unitId;
        }

        // Place corridors
        for (const corr of corridorPositions) {
            const beforeUnits = allUnits.filter(u => {
                const uP = isH ? u.x : u.y;
                const uD = isH ? u.width : u.height;
                return Math.abs((uP + uD) - corr.p) < 0.3;
            });
            const afterUnits = allUnits.filter(u => {
                const uP = isH ? u.x : u.y;
                return Math.abs(uP - (corr.p + corr.width)) < 0.3;
            });

            if (beforeUnits.length > 0 || afterUnits.length > 0) {
                this._addCorridorSegments(corr.p, corr.width, beforeUnits, afterUnits, isH, allCorridors);
            }
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
            console.log(`[BoxPlacer] âœ“ All ${allCorridors.length} corridors are wall-free`);
        }

        console.log(`[BoxPlacer] Wall-anchored: ${rowPositions.length} rows, ${corridorPositions.length} corridors, ${allUnits.length} units`);
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
        const gaps = this._findGaps(corrP, cw, secMin, secMax, isH, this.corridorGapClearance);
        for (const gap of gaps) {
            // Inset corridor ends by 0.08m so they don't visually touch walls
            const inset = this.corridorInset;
            const gStart = gap.start + inset;
            const gEnd = gap.end - inset;
            const len = gEnd - gStart;
            if (len < this.minGapLength) continue; // Skip tiny fragments

            const cx = isH ? corrP : gStart;
            const cy = isH ? gStart : corrP;
            const cWidth = isH ? cw : len;
            const cHeight = isH ? len : cw;

            // Final safety check: verify this corridor rect doesn't hit any wall
            if (rectHitsWalls(cx, cy, cWidth, cHeight, this.allWalls, 0)) {
                continue; // Skip â€” wall runs through this corridor segment
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
    _crossFill(result, mainDir, distribution, zoneBounds = null) {
        const b = zoneBounds || this.bounds;
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
                if (w >= this.crossFillMinSpan && h >= this.crossFillMinSpan && count >= this.crossFillMinArea) {
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
            if (zone.area < (this.maximizeFill ? 4 : 6)) continue;
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
     * Final production safety pass:
     * - keep only valid corridors (in-bounds, wall-safe)
     * - keep only units that do not overlap walls/obstacles/corridors/other units
     */
    _sanitizePlacement(units, corridors) {
        const b = this.bounds;
        const cTol = 0.001;
        const cleanCorridors = [];
        const corridorSeen = new Set();

        const corridorKey = (c) => [
            Math.round(c.x * 100),
            Math.round(c.y * 100),
            Math.round(c.width * 100),
            Math.round(c.height * 100)
        ].join('|');

        for (const c of (corridors || [])) {
            if (!c || ![c.x, c.y, c.width, c.height].every(Number.isFinite)) continue;
            if (c.width <= cTol || c.height <= cTol) continue;
            if (c.x < b.minX - 0.01 || c.y < b.minY - 0.01) continue;
            if (c.x + c.width > b.maxX + 0.01 || c.y + c.height > b.maxY + 0.01) continue;
            if (rectHitsWalls(c.x, c.y, c.width, c.height, this.collisionWalls, 0)) continue;
            if (rectHitsRects(c.x, c.y, c.width, c.height, this.obstacleRects)) continue;
            const key = corridorKey(c);
            if (corridorSeen.has(key)) continue;
            corridorSeen.add(key);
            cleanCorridors.push(c);
        }

        const cleanUnits = [];
        const unitGap = this.maximizeFill ? 0.005 : 0.01;
        const interiorInset = this.maximizeFill ? 0.02 : 0.03;

        const overlapsWithUnits = (u) => {
            for (const ex of cleanUnits) {
                if (
                    u.x < ex.x + ex.width - unitGap &&
                    u.x + u.width > ex.x + unitGap &&
                    u.y < ex.y + ex.height - unitGap &&
                    u.y + u.height > ex.y + unitGap
                ) {
                    return true;
                }
            }
            return false;
        };

        const overlapsWithCorridors = (u) => {
            for (const c of cleanCorridors) {
                if (
                    u.x < c.x + c.width - unitGap &&
                    u.x + u.width > c.x + unitGap &&
                    u.y < c.y + c.height - unitGap &&
                    u.y + u.height > c.y + unitGap
                ) {
                    return true;
                }
            }
            return false;
        };

        for (const u of (units || [])) {
            if (!u || ![u.x, u.y, u.width, u.height].every(Number.isFinite)) continue;
            if (u.width <= 0.05 || u.height <= 0.05) continue;
            if (u.x < b.minX - 0.01 || u.y < b.minY - 0.01) continue;
            if (u.x + u.width > b.maxX + 0.01 || u.y + u.height > b.maxY + 0.01) continue;

            // Check wall crossing on an inset rectangle so perimeter-touching remains allowed.
            const ix = u.x + interiorInset;
            const iy = u.y + interiorInset;
            const iw = u.width - interiorInset * 2;
            const ih = u.height - interiorInset * 2;
            if (iw <= 0.05 || ih <= 0.05) continue;
            if (rectHitsWalls(ix, iy, iw, ih, this.collisionWalls, 0)) continue;
            if (rectHitsRects(ix, iy, iw, ih, this.obstacleRects)) continue;
            if (overlapsWithCorridors(u)) continue;
            if (overlapsWithUnits(u)) continue;

            cleanUnits.push(u);
        }

        return {
            units: cleanUnits,
            corridors: cleanCorridors,
            removedUnits: Math.max(0, (units || []).length - cleanUnits.length),
            removedCorridors: Math.max(0, (corridors || []).length - cleanCorridors.length)
        };
    }

    /**
     * Fill a single row with boxes in wall-free gaps.
     * Boxes are placed flush â€” no clearance from perimeter walls.
     * Only internal walls that cross THROUGH the row create gaps.
     */
    _fillRow(rowP, rowDepth, sStart, sEnd, isH, sizes, sizesByWidthDesc, sizeIdx, unitId, partitionType, row) {
        const spacing = this.options.boxSpacing;
        const units = [];
        // Use small clearance only for internal wall crossings
        const gaps = this._findGaps(rowP, rowDepth, sStart, sEnd, isH, this.rowGapClearance);
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
            const priSpan = wPriMax - wPriMin;

            if (priSpan < 0.05) {
                // Thin or zero-width wall (a line)
                const wallPos = (wPriMin + wPriMax) / 2;
                // Skip if it's on the perimeter edge (boxes touch perimeter walls)
                if (wallPos <= rowMin + 0.05 || wallPos >= rowMax - 0.05) continue;
                // It's inside the row band â€” block its secondary range
                crossings.push({ start: wSecMin - cl, end: wSecMax + cl });
            } else {
                // Thick wall â€” check overlap with row band
                const overlapMin = Math.max(wPriMin, rowMin);
                const overlapMax = Math.min(wPriMax, rowMax);
                const overlap = overlapMax - overlapMin;

                if (overlap < 0.02) continue; // No real overlap

                // If the wall is thin (<0.25m) and sits right at the row edge,
                // it's a perimeter wall â€” boxes should touch it, don't block
                if (priSpan < 0.25) {
                    const wallCenter = (wPriMin + wPriMax) / 2;
                    const atStartEdge = Math.abs(wallCenter - rowMin) < 0.2;
                    const atEndEdge = Math.abs(wallCenter - rowMax) < 0.2;
                    if (atStartEdge || atEndEdge) continue;
                }

                // This wall crosses through the row â€” block its secondary range
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
        let gapCursor = sStart;
        for (const block of merged) {
            if (block.start > gapCursor + 0.5) {
                gaps.push({ start: gapCursor, end: block.start });
            }
            gapCursor = Math.max(gapCursor, block.end);
        }
        if (gapCursor < sEnd - 0.5) {
            gaps.push({ start: gapCursor, end: sEnd });
        }

        return gaps.filter(g => (g.end - g.start) >= this.minGapLength);
    }

    _makeUnit(id, x, y, w, h, type, partitionType, row) {
        return {
            id: `unit_${id}`, x, y, width: w, height: h,
            area: Math.round(w * h * 100) / 100,
            type, label: `${(w * h).toFixed(1)}mÂ²`,
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

