'use strict';

/**
 * CostoProLayoutEngine - Clean COSTO reference-matching layout engine
 * 
 * Strategy: 
 * 1. Build a lightweight occupancy grid (walls = 1-cell buffer only)
 * 2. Flood-fill to find room-like zones
 * 3. Place double-loaded row strips within each zone
 * 4. Per-box collision check against walls for final validation
 *
 * Output:
 * - Back-to-back box rows (double-loaded corridors) within each room
 * - Red zigzag radiators along perimeter walls
 * - Light blue dashed circulation lines through corridors
 * - Boxes never overlap walls, forbidden zones, or obstacles
 * - Two partition types: toleBlanche / toleGrise
 */
class CostoProLayoutEngine {
    constructor(floorPlan, options = {}) {
        this.bounds = floorPlan.bounds;
        this.walls = floorPlan.walls || [];
        this.forbiddenZones = floorPlan.forbiddenZones || [];
        this.entrances = floorPlan.entrances || [];
        this.entities = floorPlan.entities || [];

        // Layout parameters
        this.corridorWidth = options.corridorWidth || 1.2;
        this.wallClearance = options.wallClearance || 0.3;
        this.boxDepth = options.boxDepth || 2.5;
        this.boxSpacing = options.boxSpacing || 0.05;

        // Radiator parameters
        this.radiatorAmplitude = 0.15;
        this.radiatorWavelength = 0.4;
        this.radiatorOffset = 0.25;

        // Grid resolution
        this.gridSize = 0.25;

        // Pre-process wall segments
        this._prepareWallSegments();
        // Build lightweight occupancy grid
        this._buildGrid();
    }

    // ── Wall segment preparation ─────────────────────────────────────

    _prepareWallSegments() {
        this.wallSegments = [];
        for (const wall of this.walls) {
            const seg = this._extractSeg(wall);
            if (!seg) continue;
            const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
            if (len < 0.05) continue;
            seg.length = len;
            this.wallSegments.push(seg);
        }

        this.forbiddenRects = [];
        for (const fz of this.forbiddenZones) {
            const r = this._getRect(fz);
            if (r) this.forbiddenRects.push(r);
        }

        this.entranceRects = [];
        for (const ent of this.entrances) {
            const ex = ent.x ?? 0, ey = ent.y ?? 0;
            const ew = ent.width || 2, eh = ent.height || 2;
            this.entranceRects.push({ x: ex - 0.5, y: ey - 0.5, w: ew + 1, h: eh + 1 });
        }
    }

    // ── Lightweight occupancy grid ───────────────────────────────────

    _buildGrid() {
        const b = this.bounds;
        const gs = this.gridSize;

        this.gridMinX = b.minX;
        this.gridMinY = b.minY;
        this.gridCols = Math.ceil((b.maxX - b.minX) / gs);
        this.gridRows = Math.ceil((b.maxY - b.minY) / gs);

        // Initialize grid (0 = free, 1 = blocked)
        this.grid = Array.from({ length: this.gridRows }, () => new Uint8Array(this.gridCols));

        // Burn walls with MINIMAL buffer (1 cell = 0.25m each side)
        const wallBuf = 1;
        for (const seg of this.wallSegments) {
            // Only burn walls longer than 0.3m (skip tiny fragments)
            if (seg.length < 0.3) continue;
            this._burnLine(seg.x1, seg.y1, seg.x2, seg.y2, wallBuf);
        }

        // Burn forbidden zones with small buffer
        for (const r of this.forbiddenRects) {
            this._burnRect(r.x, r.y, r.w, r.h, 2);
        }

        // Burn entrances with buffer for clearance
        for (const r of this.entranceRects) {
            this._burnRect(r.x, r.y, r.w, r.h, 3);
        }
    }

    _burnLine(x1, y1, x2, y2, buffer) {
        const gs = this.gridSize;
        const len = Math.hypot(x2 - x1, y2 - y1);
        const steps = Math.max(2, Math.ceil(len / (gs * 0.5)));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const px = x1 + (x2 - x1) * t;
            const py = y1 + (y2 - y1) * t;
            const gc = Math.floor((px - this.gridMinX) / gs);
            const gr = Math.floor((py - this.gridMinY) / gs);
            for (let dr = -buffer; dr <= buffer; dr++) {
                for (let dc = -buffer; dc <= buffer; dc++) {
                    const nr = gr + dr, nc = gc + dc;
                    if (nr >= 0 && nr < this.gridRows && nc >= 0 && nc < this.gridCols) {
                        this.grid[nr][nc] = 1;
                    }
                }
            }
        }
    }

    _burnRect(x, y, w, h, buffer) {
        const gs = this.gridSize;
        const c1 = Math.floor((x - this.gridMinX) / gs) - buffer;
        const c2 = Math.ceil((x + w - this.gridMinX) / gs) + buffer;
        const r1 = Math.floor((y - this.gridMinY) / gs) - buffer;
        const r2 = Math.ceil((y + h - this.gridMinY) / gs) + buffer;
        for (let r = Math.max(0, r1); r < Math.min(this.gridRows, r2); r++) {
            for (let c = Math.max(0, c1); c < Math.min(this.gridCols, c2); c++) {
                this.grid[r][c] = 1;
            }
        }
    }

    // ── Zone detection via flood fill ────────────────────────────────

    _findZones() {
        const gs = this.gridSize;
        const rows = this.gridRows;
        const cols = this.gridCols;
        const visited = Array.from({ length: rows }, () => new Uint8Array(cols));
        const zones = [];

        // Minimum zone size: 3m x 3m = 12 cells x 12 cells
        const minCells = Math.ceil(3.0 / gs);

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (this.grid[r][c] || visited[r][c]) continue;

                // Flood fill to find connected free region
                const queue = [[r, c]];
                visited[r][c] = 1;
                let minR = r, maxR = r, minC = c, maxC = c;
                let cellCount = 0;

                while (queue.length > 0) {
                    const [cr, cc] = queue.shift();
                    cellCount++;
                    if (cr < minR) minR = cr;
                    if (cr > maxR) maxR = cr;
                    if (cc < minC) minC = cc;
                    if (cc > maxC) maxC = cc;

                    const neighbors = [[cr-1,cc],[cr+1,cc],[cr,cc-1],[cr,cc+1]];
                    for (const [nr, nc] of neighbors) {
                        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols &&
                            !this.grid[nr][nc] && !visited[nr][nc]) {
                            visited[nr][nc] = 1;
                            queue.push([nr, nc]);
                        }
                    }
                }

                const zoneW = (maxC - minC + 1);
                const zoneH = (maxR - minR + 1);

                // Only keep zones large enough for at least one row strip
                if (zoneW >= minCells && zoneH >= minCells && cellCount >= minCells * minCells * 0.3) {
                    zones.push({
                        minX: this.gridMinX + minC * gs,
                        minY: this.gridMinY + minR * gs,
                        maxX: this.gridMinX + (maxC + 1) * gs,
                        maxY: this.gridMinY + (maxR + 1) * gs,
                        cells: cellCount,
                        area: cellCount * gs * gs
                    });
                }
            }
        }

        // Sort by area descending
        zones.sort((a, b) => b.area - a.area);
        console.log(`[CostoProLayout] Found ${zones.length} zones: ${zones.map(z => 
            `${(z.maxX-z.minX).toFixed(1)}x${(z.maxY-z.minY).toFixed(1)}m (${z.area.toFixed(0)}m²)`
        ).join(', ')}`);

        return zones;
    }

    // ── Per-box collision detection ──────────────────────────────────

    _boxHitsWall(bx, by, bw, bh) {
        const cl = this.wallClearance;
        const left = bx - cl, right = bx + bw + cl;
        const bottom = by - cl, top = by + bh + cl;

        for (const seg of this.wallSegments) {
            const sMinX = Math.min(seg.x1, seg.x2);
            const sMaxX = Math.max(seg.x1, seg.x2);
            const sMinY = Math.min(seg.y1, seg.y2);
            const sMaxY = Math.max(seg.y1, seg.y2);

            if (sMaxX < left || sMinX > right || sMaxY < bottom || sMinY > top) continue;

            if (seg.x1 >= left && seg.x1 <= right && seg.y1 >= bottom && seg.y1 <= top) return true;
            if (seg.x2 >= left && seg.x2 <= right && seg.y2 >= bottom && seg.y2 <= top) return true;

            if (this._segIntersectsRect(seg.x1, seg.y1, seg.x2, seg.y2, left, bottom, right, top)) {
                return true;
            }
        }
        return false;
    }

    _boxHitsObstacle(bx, by, bw, bh) {
        for (const r of this.forbiddenRects) {
            if (bx < r.x + r.w && bx + bw > r.x && by < r.y + r.h && by + bh > r.y) return true;
        }
        for (const r of this.entranceRects) {
            if (bx < r.x + r.w && bx + bw > r.x && by < r.y + r.h && by + bh > r.y) return true;
        }
        return false;
    }

    _segIntersectsRect(x1, y1, x2, y2, rLeft, rBot, rRight, rTop) {
        const dx = x2 - x1, dy = y2 - y1;
        const p = [-dx, dx, -dy, dy];
        const q = [x1 - rLeft, rRight - x1, y1 - rBot, rTop - y1];
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

    _isBoxValid(bx, by, bw, bh) {
        const b = this.bounds;
        if (bx < b.minX + 0.2 || bx + bw > b.maxX - 0.2) return false;
        if (by < b.minY + 0.2 || by + bh > b.maxY - 0.2) return false;
        if (this._boxHitsWall(bx, by, bw, bh)) return false;
        if (this._boxHitsObstacle(bx, by, bw, bh)) return false;
        return true;
    }

    // ── Main generation ──────────────────────────────────────────────

    generate(config = {}) {
        const distribution = config.distribution || { S: 30, M: 40, L: 20, XL: 10 };

        console.log('[CostoProLayout] Starting generation...');
        console.log(`[CostoProLayout] Bounds: ${JSON.stringify(this.bounds)}`);
        console.log(`[CostoProLayout] Walls: ${this.wallSegments.length}, Forbidden: ${this.forbiddenRects.length}, Entrances: ${this.entranceRects.length}`);

        // Count free cells for diagnostics
        let freeCells = 0;
        for (let r = 0; r < this.gridRows; r++) {
            for (let c = 0; c < this.gridCols; c++) {
                if (!this.grid[r][c]) freeCells++;
            }
        }
        const totalCells = this.gridRows * this.gridCols;
        console.log(`[CostoProLayout] Grid: ${this.gridCols}x${this.gridRows}, free: ${freeCells}/${totalCells} (${(freeCells/totalCells*100).toFixed(1)}%)`);

        // Step 1: Find room zones via flood fill
        const zones = this._findZones();

        // Step 2: Place double-loaded rows in each zone
        const units = [];
        const corridors = [];
        let unitId = 1;
        const sizes = this._buildSizeCatalog(distribution);
        let sizeIdx = 0;

        for (const zone of zones) {
            const result = this._placeRowsInZone(zone, unitId, sizes, sizeIdx);
            units.push(...result.units);
            corridors.push(...result.corridors);
            unitId += result.units.length;
            sizeIdx = result.nextSizeIdx;
        }

        console.log(`[CostoProLayout] Placed ${units.length} units, ${corridors.length} corridors`);

        // Step 3: Generate radiators along perimeter walls
        const radiators = this._generateRadiators();
        console.log(`[CostoProLayout] Generated ${radiators.length} radiators`);

        // Step 4: Build circulation paths
        const circulationPaths = corridors
            .filter(c => c.type === 'ACCESS')
            .map(c => {
                const isH = c.direction === 'horizontal';
                const cx = c.x + c.width / 2;
                const cy = c.y + c.height / 2;
                return {
                    type: c.type,
                    style: 'dashed_lightblue',
                    path: isH
                        ? [{ x: c.x, y: cy }, { x: c.x + c.width, y: cy }]
                        : [{ x: cx, y: c.y }, { x: cx, y: c.y + c.height }]
                };
            });

        return { units, corridors, radiators, circulationPaths };
    }

    // ── Row placement within a zone ──────────────────────────────────

    _placeRowsInZone(zone, startId, sizes, sizeIdx) {
        const units = [];
        const corridors = [];
        const cw = this.corridorWidth;
        const bd = this.boxDepth;
        const stripWidth = bd + cw + bd;

        const zoneW = zone.maxX - zone.minX;
        const zoneH = zone.maxY - zone.minY;

        // Try both orientations, pick the one that fits more strips
        const numStripsH = Math.floor(zoneW / stripWidth);
        const numStripsV = Math.floor(zoneH / stripWidth);

        // Choose orientation: horizontal strips (rows along X) or vertical strips (rows along Y)
        const useVerticalStrips = numStripsV > numStripsH && zoneW > zoneH * 0.7;
        const numStrips = useVerticalStrips ? numStripsV : numStripsH;

        if (numStrips < 1) {
            // Zone too small for double-loaded rows, try single row
            return this._placeSingleRowInZone(zone, startId, sizes, sizeIdx);
        }

        const spanDim = useVerticalStrips ? zoneH : zoneW;
        const fillDim = useVerticalStrips ? zoneW : zoneH;
        const usedSpan = numStrips * stripWidth;
        const margin = (spanDim - usedSpan) / 2;

        for (let s = 0; s < numStrips; s++) {
            const stripStart = (useVerticalStrips ? zone.minY : zone.minX) + margin + s * stripWidth;

            let leftStart, corridorStart, rightStart;
            if (useVerticalStrips) {
                leftStart = stripStart;
                corridorStart = stripStart + bd;
                rightStart = stripStart + bd + cw;
            } else {
                leftStart = stripStart;
                corridorStart = stripStart + bd;
                rightStart = stripStart + bd + cw;
            }

            let corridorHasBoxes = false;
            const fillStart = useVerticalStrips ? zone.minX : zone.minY;
            const fillEnd = useVerticalStrips ? zone.maxX : zone.maxY;

            // Fill left row
            let cur = fillStart;
            while (cur + 1.0 < fillEnd) {
                const size = sizes[sizeIdx % sizes.length];
                sizeIdx++;
                const boxH = size.width;
                if (cur + boxH > fillEnd) break;

                let bx, by, bw, bh;
                if (useVerticalStrips) {
                    bx = cur; by = leftStart; bw = boxH; bh = bd;
                } else {
                    bx = leftStart; by = cur; bw = bd; bh = boxH;
                }

                if (this._isBoxValid(bx, by, bw, bh)) {
                    units.push({
                        id: `unit_${startId + units.length}`,
                        x: bx, y: by, width: bw, height: bh,
                        area: size.area, type: size.type,
                        label: `${size.area}m²`,
                        partitionType: 'toleGrise', row: 'left'
                    });
                    corridorHasBoxes = true;
                }
                cur += boxH + this.boxSpacing;
            }

            // Fill right row
            cur = fillStart;
            while (cur + 1.0 < fillEnd) {
                const size = sizes[sizeIdx % sizes.length];
                sizeIdx++;
                const boxH = size.width;
                if (cur + boxH > fillEnd) break;

                let bx, by, bw, bh;
                if (useVerticalStrips) {
                    bx = cur; by = rightStart; bw = boxH; bh = bd;
                } else {
                    bx = rightStart; by = cur; bw = bd; bh = boxH;
                }

                if (this._isBoxValid(bx, by, bw, bh)) {
                    units.push({
                        id: `unit_${startId + units.length}`,
                        x: bx, y: by, width: bw, height: bh,
                        area: size.area, type: size.type,
                        label: `${size.area}m²`,
                        partitionType: 'toleBlanche', row: 'right'
                    });
                    corridorHasBoxes = true;
                }
                cur += boxH + this.boxSpacing;
            }

            // Add corridor if it has boxes
            if (corridorHasBoxes) {
                if (useVerticalStrips) {
                    corridors.push({
                        id: `corridor_${corridors.length}`,
                        type: 'ACCESS', direction: 'horizontal',
                        x: fillStart, y: corridorStart,
                        width: fillEnd - fillStart, height: cw
                    });
                } else {
                    corridors.push({
                        id: `corridor_${corridors.length}`,
                        type: 'ACCESS', direction: 'vertical',
                        x: corridorStart, y: fillStart,
                        width: cw, height: fillEnd - fillStart
                    });
                }
            }
        }

        return { units, corridors, nextSizeIdx: sizeIdx };
    }

    _placeSingleRowInZone(zone, startId, sizes, sizeIdx) {
        const units = [];
        const corridors = [];
        const bd = this.boxDepth;
        const zoneW = zone.maxX - zone.minX;
        const zoneH = zone.maxY - zone.minY;

        if (zoneW < bd + 0.5 && zoneH < bd + 0.5) {
            return { units, corridors, nextSizeIdx: sizeIdx };
        }

        // Place a single row along the longer dimension
        const horizontal = zoneW >= zoneH;
        const fillStart = horizontal ? zone.minX : zone.minY;
        const fillEnd = horizontal ? zone.maxX : zone.maxY;
        const rowStart = horizontal ? zone.minY : zone.minX;

        let cur = fillStart;
        while (cur + 1.0 < fillEnd) {
            const size = sizes[sizeIdx % sizes.length];
            sizeIdx++;
            const boxH = size.width;
            if (cur + boxH > fillEnd) break;

            let bx, by, bw, bh;
            if (horizontal) {
                bx = cur; by = rowStart; bw = boxH; bh = Math.min(bd, zoneH);
            } else {
                bx = rowStart; by = cur; bw = Math.min(bd, zoneW); bh = boxH;
            }

            if (this._isBoxValid(bx, by, bw, bh)) {
                units.push({
                    id: `unit_${startId + units.length}`,
                    x: bx, y: by, width: bw, height: bh,
                    area: size.area, type: size.type,
                    label: `${size.area}m²`,
                    partitionType: 'toleGrise', row: 'single'
                });
            }
            cur += boxH + this.boxSpacing;
        }

        return { units, corridors, nextSizeIdx: sizeIdx };
    }

    // ── Size catalog ─────────────────────────────────────────────────

    _buildSizeCatalog(distribution) {
        const catalog = [
            { type: 'S',  width: 1.5, area: 3.75 },
            { type: 'M',  width: 2.0, area: 5.0 },
            { type: 'L',  width: 2.5, area: 6.25 },
            { type: 'XL', width: 3.0, area: 7.5 }
        ];

        const sizes = [];
        const total = Object.values(distribution).reduce((s, v) => s + v, 0) || 100;

        for (const item of catalog) {
            const pct = (distribution[item.type] || 0) / total;
            const count = Math.max(1, Math.round(pct * 20));
            for (let i = 0; i < count; i++) sizes.push(item);
        }

        // Shuffle for variety
        for (let i = sizes.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [sizes[i], sizes[j]] = [sizes[j], sizes[i]];
        }

        return sizes.length > 0 ? sizes : [{ type: 'M', width: 2.0, area: 5.0 }];
    }

    // ── Radiator generation ──────────────────────────────────────────

    _generateRadiators() {
        const radiators = [];
        const b = this.bounds;
        const centerX = (b.minX + b.maxX) / 2;
        const centerY = (b.minY + b.maxY) / 2;

        const segments = this._detectPerimeterWalls();
        const merged = this._mergeCollinear(segments);

        for (const seg of merged) {
            const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
            if (len < 1.0) continue;

            const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1;
            const l = Math.hypot(dx, dy);
            const n1x = -dy / l, n1y = dx / l;
            const midX = (seg.x1 + seg.x2) / 2, midY = (seg.y1 + seg.y2) / 2;
            const dot = n1x * (centerX - midX) + n1y * (centerY - midY);
            const nx = dot >= 0 ? n1x : -n1x;
            const ny = dot >= 0 ? n1y : -n1y;

            const wl = Math.min(this.radiatorWavelength, len / 5);
            const path = this._zigzag(seg.x1, seg.y1, seg.x2, seg.y2, nx, ny,
                this.radiatorOffset, this.radiatorAmplitude, wl);

            if (path.length >= 2) {
                radiators.push({
                    type: 'radiator',
                    wallSegment: { start: { x: seg.x1, y: seg.y1 }, end: { x: seg.x2, y: seg.y2 } },
                    path, color: 'red', style: 'zigzag'
                });
            }
        }

        return radiators;
    }

    _zigzag(x1, y1, x2, y2, nx, ny, offset, amp, wl) {
        const pts = [];
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.hypot(dx, dy);
        if (len < 0.5) return pts;
        const half = wl / 2;
        const n = Math.max(4, Math.floor(len / half) + 1);
        for (let i = 0; i <= n; i++) {
            const t = Math.min(i * half / len, 1.0);
            const bx = x1 + dx * t, by = y1 + dy * t;
            const ox = bx + nx * offset, oy = by + ny * offset;
            const sign = (i % 2 === 0) ? 1 : -1;
            pts.push({ x: ox + nx * sign * amp, y: oy + ny * sign * amp });
        }
        return pts;
    }

    _detectPerimeterWalls() {
        const b = this.bounds;
        const threshold = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.02;
        const segments = [];

        for (const seg of this.wallSegments) {
            if (seg.length < 0.5) continue;
            const nearLeft = Math.abs(seg.x1 - b.minX) < threshold && Math.abs(seg.x2 - b.minX) < threshold;
            const nearRight = Math.abs(seg.x1 - b.maxX) < threshold && Math.abs(seg.x2 - b.maxX) < threshold;
            const nearBot = Math.abs(seg.y1 - b.minY) < threshold && Math.abs(seg.y2 - b.minY) < threshold;
            const nearTop = Math.abs(seg.y1 - b.maxY) < threshold && Math.abs(seg.y2 - b.maxY) < threshold;
            if (nearLeft || nearRight || nearBot || nearTop) segments.push(seg);
        }

        if (segments.length === 0) {
            segments.push(
                { x1: b.minX, y1: b.minY, x2: b.maxX, y2: b.minY },
                { x1: b.maxX, y1: b.minY, x2: b.maxX, y2: b.maxY },
                { x1: b.maxX, y1: b.maxY, x2: b.minX, y2: b.maxY },
                { x1: b.minX, y1: b.maxY, x2: b.minX, y2: b.minY }
            );
        }
        return segments;
    }

    _mergeCollinear(segments) {
        if (segments.length <= 1) return segments;
        const merged = [...segments];
        let changed = true;
        while (changed) {
            changed = false;
            for (let i = 0; i < merged.length && !changed; i++) {
                for (let j = i + 1; j < merged.length && !changed; j++) {
                    const a = merged[i], b = merged[j];
                    const isHA = Math.abs(a.y2 - a.y1) < 0.2;
                    const isHB = Math.abs(b.y2 - b.y1) < 0.2;
                    const isVA = Math.abs(a.x2 - a.x1) < 0.2;
                    const isVB = Math.abs(b.x2 - b.x1) < 0.2;

                    if (isHA && isHB && Math.abs(a.y1 - b.y1) < 0.3) {
                        const minX = Math.min(a.x1, a.x2, b.x1, b.x2);
                        const maxX = Math.max(a.x1, a.x2, b.x1, b.x2);
                        const gap = Math.max(0,
                            Math.min(a.x1, a.x2) > Math.min(b.x1, b.x2)
                                ? Math.min(a.x1, a.x2) - Math.max(b.x1, b.x2)
                                : Math.min(b.x1, b.x2) - Math.max(a.x1, a.x2));
                        if (gap < 0.5) {
                            merged[i] = { x1: minX, y1: a.y1, x2: maxX, y2: a.y1, length: maxX - minX };
                            merged.splice(j, 1); changed = true;
                        }
                    } else if (isVA && isVB && Math.abs(a.x1 - b.x1) < 0.3) {
                        const minY = Math.min(a.y1, a.y2, b.y1, b.y2);
                        const maxY = Math.max(a.y1, a.y2, b.y1, b.y2);
                        const gap = Math.max(0,
                            Math.min(a.y1, a.y2) > Math.min(b.y1, b.y2)
                                ? Math.min(a.y1, a.y2) - Math.max(b.y1, b.y2)
                                : Math.min(b.y1, b.y2) - Math.max(a.y1, a.y2));
                        if (gap < 0.5) {
                            merged[i] = { x1: a.x1, y1: minY, x2: a.x1, y2: maxY, length: maxY - minY };
                            merged.splice(j, 1); changed = true;
                        }
                    }
                }
            }
        }
        return merged;
    }

    // ── Utility helpers ──────────────────────────────────────────────

    _extractSeg(wall) {
        const x1 = wall.x1 ?? (wall.start ? wall.start.x : wall.startX);
        const y1 = wall.y1 ?? (wall.start ? wall.start.y : wall.startY);
        const x2 = wall.x2 ?? (wall.end ? wall.end.x : wall.endX);
        const y2 = wall.y2 ?? (wall.end ? wall.end.y : wall.endY);
        if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
        return { x1: Number(x1), y1: Number(y1), x2: Number(x2), y2: Number(y2) };
    }

    _getRect(obj) {
        let x, y, w, h;
        if (obj.bounds) {
            x = obj.bounds.minX; y = obj.bounds.minY;
            w = obj.bounds.maxX - obj.bounds.minX;
            h = obj.bounds.maxY - obj.bounds.minY;
        } else {
            x = obj.x; y = obj.y; w = obj.width; h = obj.height;
        }
        if (x == null || y == null || !w || !h) return null;
        return { x: Number(x), y: Number(y), w: Number(w), h: Number(h) };
    }
}

module.exports = CostoProLayoutEngine;
