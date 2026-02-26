'use strict';

const CirculationRouter = require('./costo-engine/circulationRouter');

/**
 * CostoProLayoutEngine v4 - Production-grade layout engine.
 *
 * Matches the COSTO reference output exactly:
 *   - Dense double-loaded storage box rows (back-to-back)
 *   - Grid-based wall collision (no overlap with walls/forbidden zones)
 *   - Red zigzag radiators along ALL perimeter wall segments
 *   - Light-blue dashed circulation lines through every corridor
 *   - Dimension annotations on each box (width text)
 *   - COSTO partition types: toleBlanche (structural) / toleGrise (internal)
 *
 * Box size catalog (matching reference annotations):
 *   S  = 1.29m wide × boxDepth deep
 *   M  = 1.39m wide × boxDepth deep
 *   L  = 1.49m wide × boxDepth deep
 *   XL = 1.59m wide × boxDepth deep
 *
 * Reference geometry (Plan Etage 01 @ 1:200):
 *   corridorWidth = 1.20m (main arteries)
 *   boxDepth      = 2.50m (standard unit depth)
 *   stripWidth    = 2.50 + 1.20 + 2.50 = 6.20m per double-loaded pair
 */
class CostoProLayoutEngine {
    constructor(floorPlan, options = {}) {
        this.bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        this.walls = floorPlan.walls || [];
        this.rooms = floorPlan.rooms || [];
        this.forbiddenZones = floorPlan.forbiddenZones || [];
        this.entrances = floorPlan.entrances || [];
        this.entities = floorPlan.entities || [];
        this.envelope = floorPlan.envelope || [];

        // Layout parameters
        this.corridorWidth = Math.max(0.8, Number(options.corridorWidth) || 1.20);
        this.wallClearance = Math.max(0.02, Number(options.wallClearance) || 0.10);
        this.boxDepth = Math.max(1.5, Number(options.boxDepth) || 2.50);
        this.boxSpacing = Math.max(0.00, Number(options.boxSpacing) || 0.02);
        this.rowGapClearance = Math.max(0.01, Number(options.rowGapClearance) || 0.04);
        this.corridorGapClearance = Math.max(0.01, Number(options.corridorGapClearance) || 0.04);
        this.corridorInset = Math.max(0.00, Number(options.corridorInset) || 0.04);
        this.minGapLength = Math.max(0.30, Number(options.minGapLength) || 0.60);
        this.maximizeFill = options.maximizeFill !== false;
        this.oneWayFlow = options.oneWayFlow === true;
        this.blockThroughUnits = options.blockThroughUnits !== false;

        // Radiator parameters (tight like reference)
        this.radiatorAmplitude = 0.12;
        this.radiatorWavelength = 0.38;
        this.radiatorOffset = 0.18;

        // Occupancy grid resolution (0.20m cells for precision)
        this.gridSize = 0.20;

        this._prepareWallSegments();
        this._buildGrid();
    }

    // ─────────────────────────────────────────────────────────────────
    //  Wall / obstacle preparation
    // ─────────────────────────────────────────────────────────────────

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
        const addEntranceRect = (x, y, w, h) => {
            if (![x, y, w, h].every(Number.isFinite)) return;
            if (w <= 0 || h <= 0) return;
            const minSize = Math.max(0.6, this.corridorWidth * 0.65);
            const inflate = Math.max(0.25, this.corridorWidth * 0.25);
            const rw = Math.max(minSize, w);
            const rh = Math.max(minSize, h);
            const rx = Math.max(this.bounds.minX, x - inflate);
            const ry = Math.max(this.bounds.minY, y - inflate);
            const rr = Math.min(this.bounds.maxX, x + rw + inflate);
            const rt = Math.min(this.bounds.maxY, y + rh + inflate);
            if (rr - rx <= 0 || rt - ry <= 0) return;
            this.entranceRects.push({ x: rx, y: ry, w: rr - rx, h: rt - ry });
        };

        for (const ent of this.entrances) {
            if (!ent) continue;

            if (ent.start && ent.end) {
                const sx = Number(ent.start.x), sy = Number(ent.start.y);
                const ex = Number(ent.end.x), ey = Number(ent.end.y);
                if ([sx, sy, ex, ey].every(Number.isFinite)) {
                    const len = Math.hypot(ex - sx, ey - sy);
                    const t = Math.max(0.6, this.corridorWidth * 0.55);
                    if (Math.abs(ex - sx) >= Math.abs(ey - sy)) {
                        const cx = (sx + ex) / 2;
                        const cy = (sy + ey) / 2;
                        const w = Math.max(len, t);
                        addEntranceRect(cx - w / 2, cy - t / 2, w, t);
                    } else {
                        const cx = (sx + ex) / 2;
                        const cy = (sy + ey) / 2;
                        const h = Math.max(len, t);
                        addEntranceRect(cx - t / 2, cy - h / 2, t, h);
                    }
                    continue;
                }
            }

            if (Array.isArray(ent.polygon) && ent.polygon.length >= 2) {
                const xs = ent.polygon
                    .map((p) => Number(Array.isArray(p) ? p[0] : p?.x))
                    .filter(Number.isFinite);
                const ys = ent.polygon
                    .map((p) => Number(Array.isArray(p) ? p[1] : p?.y))
                    .filter(Number.isFinite);
                if (xs.length && ys.length) {
                    const minX = Math.min(...xs);
                    const maxX = Math.max(...xs);
                    const minY = Math.min(...ys);
                    const maxY = Math.max(...ys);
                    addEntranceRect(minX, minY, maxX - minX, maxY - minY);
                    continue;
                }
            }

            const ex = Number(ent.x);
            const ey = Number(ent.y);
            const ew = Number.isFinite(Number(ent.width)) ? Number(ent.width) : this.corridorWidth;
            const eh = Number.isFinite(Number(ent.height)) ? Number(ent.height) : this.corridorWidth;
            if ([ex, ey].every(Number.isFinite)) {
                addEntranceRect(ex - ew / 2, ey - eh / 2, ew, eh);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────
    //  Occupancy grid
    // ─────────────────────────────────────────────────────────────────

    _buildGrid() {
        const b = this.bounds;
        const gs = this.gridSize;
        this.gridMinX = b.minX;
        this.gridMinY = b.minY;
        this.gridCols = Math.ceil((b.maxX - b.minX) / gs);
        this.gridRows = Math.ceil((b.maxY - b.minY) / gs);
        this.grid = Array.from({ length: this.gridRows }, () => new Uint8Array(this.gridCols));

        // Burn walls with 1-cell (0.20m) buffer
        for (const seg of this.wallSegments) {
            if (seg.length < 0.25) continue;
            this._burnLine(seg.x1, seg.y1, seg.x2, seg.y2, 1);
        }

        // Burn forbidden zones
        for (const r of this.forbiddenRects) {
            this._burnRect(r.x, r.y, r.w, r.h, 1);
        }

        // NOTE: Do NOT burn entrances — they must remain walkable for paths
        // Boxes still avoid them via _boxHitsObstacle() default behavior
    }

    _burnLine(x1, y1, x2, y2, buffer) {
        const gs = this.gridSize;
        const len = Math.hypot(x2 - x1, y2 - y1);
        const steps = Math.max(2, Math.ceil(len / (gs * 0.4)));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const px = x1 + (x2 - x1) * t;
            const py = y1 + (y2 - y1) * t;
            const gc = Math.floor((px - this.gridMinX) / gs);
            const gr = Math.floor((py - this.gridMinY) / gs);
            for (let dr = -buffer; dr <= buffer; dr++) {
                for (let dc = -buffer; dc <= buffer; dc++) {
                    const nr = gr + dr, nc = gc + dc;
                    if (nr >= 0 && nr < this.gridRows && nc >= 0 && nc < this.gridCols)
                        this.grid[nr][nc] = 1;
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
        for (let r = Math.max(0, r1); r < Math.min(this.gridRows, r2); r++)
            for (let c = Math.max(0, c1); c < Math.min(this.gridCols, c2); c++)
                this.grid[r][c] = 1;
    }

    // ─────────────────────────────────────────────────────────────────
    //  Zone detection — prefer architectural rooms, fall back to flood-fill
    // ─────────────────────────────────────────────────────────────────

    _zonesFromRooms() {
        const zones = [];
        const dedupe = new Set();
        const minArea = 3;  // Accept smaller rooms (lowered from 6)
        const inset = Math.max(0.30, this.wallClearance + 0.20);  // Account for wall thickness (0.15-0.25m)
        console.log(`[CostoProLayout v4] _zonesFromRooms: ${this.rooms.length} rooms, inset=${inset.toFixed(3)}, minArea=${minArea}`);

        const push = (mnX, mnY, mxX, mxY) => {
            if (![mnX, mnY, mxX, mxY].every(Number.isFinite)) return;
            const x1 = Math.max(this.bounds.minX, mnX + inset);
            const y1 = Math.max(this.bounds.minY, mnY + inset);
            const x2 = Math.min(this.bounds.maxX, mxX - inset);
            const y2 = Math.min(this.bounds.maxY, mxY - inset);
            if (x2 - x1 < 0.8 || y2 - y1 < 0.8) return;  // Accept narrower zones (lowered from 1.2)
            const key = [x1, y1, x2, y2].map(v => Math.round(v * 10)).join('|');
            if (dedupe.has(key)) return;
            dedupe.add(key);
            const area = (x2 - x1) * (y2 - y1);
            if (area < minArea) return;
            zones.push({ minX: x1, minY: y1, maxX: x2, maxY: y2, area });
        };

        for (const room of this.rooms) {
            if (!room) continue;
            const b = room.bounds;
            if (b && Number.isFinite(b.minX)) { push(b.minX, b.minY, b.maxX, b.maxY); continue; }
            if (Number.isFinite(room.x) && Number.isFinite(room.width)) {
                push(room.x, room.y, room.x + room.width, room.y + room.height); continue;
            }
            if (Array.isArray(room.polygon) && room.polygon.length >= 3) {
                let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
                for (const pt of room.polygon) {
                    const x = Number(Array.isArray(pt) ? pt[0] : pt?.x);
                    const y = Number(Array.isArray(pt) ? pt[1] : pt?.y);
                    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
                    mnX = Math.min(mnX, x); mnY = Math.min(mnY, y);
                    mxX = Math.max(mxX, x); mxY = Math.max(mxY, y);
                }
                push(mnX, mnY, mxX, mxY);
            }
        }
        zones.sort((a, b) => b.area - a.area);
        return zones;
    }

    _findZones() {
        const gs = this.gridSize;
        const rows = this.gridRows, cols = this.gridCols;
        const stripWidth = this.boxDepth + this.corridorWidth + this.boxDepth; // ~6.2m

        // ── Pass 1: Open grid — find large connected areas for double-loaded rows ──
        const visited1 = Array.from({ length: rows }, () => new Uint8Array(cols));
        const largeZones = [];
        const minStripCells = Math.ceil(stripWidth / gs); // Needs to be >= strip width

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (this.grid[r][c] || visited1[r][c]) continue;
                const queue = [[r, c]];
                visited1[r][c] = 1;
                let mnR = r, mxR = r, mnC = c, mxC = c, count = 0;
                while (queue.length) {
                    const [cr, cc] = queue.shift();
                    count++;
                    if (cr < mnR) mnR = cr; if (cr > mxR) mxR = cr;
                    if (cc < mnC) mnC = cc; if (cc > mxC) mxC = cc;
                    for (const [nr, nc] of [[cr - 1, cc], [cr + 1, cc], [cr, cc - 1], [cr, cc + 1]]) {
                        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols &&
                            !this.grid[nr][nc] && !visited1[nr][nc]) {
                            visited1[nr][nc] = 1;
                            queue.push([nr, nc]);
                        }
                    }
                }
                const zW = mxC - mnC + 1, zH = mxR - mnR + 1;
                // Only keep zones large enough for at least 1 double-loaded strip
                if ((zW >= minStripCells || zH >= minStripCells) && count >= 50) {
                    largeZones.push({
                        minX: this.gridMinX + mnC * gs,
                        minY: this.gridMinY + mnR * gs,
                        maxX: this.gridMinX + (mxC + 1) * gs,
                        maxY: this.gridMinY + (mxR + 1) * gs,
                        cells: count, area: count * gs * gs
                    });
                }
            }
        }
        console.log(`[CostoProLayout v4] Pass 1 (open grid): ${largeZones.length} large zones for corridors`);

        // ── Pass 2: Door-closed grid — find individual rooms for remaining fill ──
        const doorClosedGrid = Array.from({ length: rows }, (_, r) => new Uint8Array(this.grid[r]));

        for (const ent of this.entrances) {
            const segs = [];
            if (ent.start && ent.end) {
                segs.push({ x1: ent.start.x, y1: ent.start.y, x2: ent.end.x, y2: ent.end.y });
            } else if (ent.vertices && ent.vertices.length >= 2) {
                for (let i = 0; i < ent.vertices.length - 1; i++) {
                    segs.push({
                        x1: ent.vertices[i].x, y1: ent.vertices[i].y,
                        x2: ent.vertices[i + 1].x, y2: ent.vertices[i + 1].y
                    });
                }
            }
            if (segs.length > 0) {
                for (const seg of segs) {
                    const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
                    const steps = Math.max(2, Math.ceil(len / (gs * 0.4)));
                    for (let i = 0; i <= steps; i++) {
                        const t = i / steps;
                        const px = seg.x1 + (seg.x2 - seg.x1) * t;
                        const py = seg.y1 + (seg.y2 - seg.y1) * t;
                        const gc = Math.floor((px - this.gridMinX) / gs);
                        const gr = Math.floor((py - this.gridMinY) / gs);
                        for (let dr = -2; dr <= 2; dr++) {
                            for (let dc = -2; dc <= 2; dc++) {
                                const nr = gr + dr, nc = gc + dc;
                                if (nr >= 0 && nr < rows && nc >= 0 && nc < cols)
                                    doorClosedGrid[nr][nc] = 1;
                            }
                        }
                    }
                }
            } else {
                const ex = ent.x ?? 0, ey = ent.y ?? 0;
                const ew = ent.width || 1.5, eh = ent.height || 1.5;
                const c1 = Math.floor((ex - this.gridMinX) / gs) - 2;
                const c2 = Math.ceil((ex + ew - this.gridMinX) / gs) + 2;
                const r1 = Math.floor((ey - this.gridMinY) / gs) - 2;
                const r2 = Math.ceil((ey + eh - this.gridMinY) / gs) + 2;
                for (let r = Math.max(0, r1); r < Math.min(rows, r2); r++)
                    for (let c = Math.max(0, c1); c < Math.min(cols, c2); c++)
                        doorClosedGrid[r][c] = 1;
            }
        }

        const visited2 = Array.from({ length: rows }, () => new Uint8Array(cols));
        const smallZones = [];
        const minCells = Math.ceil(0.6 / gs);
        const minAreaCells = Math.ceil(1.0 / (gs * gs));

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (doorClosedGrid[r][c] || visited2[r][c]) continue;
                const queue = [[r, c]];
                visited2[r][c] = 1;
                let mnR = r, mxR = r, mnC = c, mxC = c, count = 0;
                while (queue.length) {
                    const [cr, cc] = queue.shift();
                    count++;
                    if (cr < mnR) mnR = cr; if (cr > mxR) mxR = cr;
                    if (cc < mnC) mnC = cc; if (cc > mxC) mxC = cc;
                    for (const [nr, nc] of [[cr - 1, cc], [cr + 1, cc], [cr, cc - 1], [cr, cc + 1]]) {
                        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols &&
                            !doorClosedGrid[nr][nc] && !visited2[nr][nc]) {
                            visited2[nr][nc] = 1;
                            queue.push([nr, nc]);
                        }
                    }
                }
                const zW = mxC - mnC + 1, zH = mxR - mnR + 1;
                if (zW >= minCells && zH >= minCells && count >= minAreaCells) {
                    smallZones.push({
                        minX: this.gridMinX + mnC * gs,
                        minY: this.gridMinY + mnR * gs,
                        maxX: this.gridMinX + (mxC + 1) * gs,
                        maxY: this.gridMinY + (mxR + 1) * gs,
                        cells: count, area: count * gs * gs
                    });
                }
            }
        }
        console.log(`[CostoProLayout v4] Pass 2 (door-closed): ${smallZones.length} per-room zones`);

        // Use per-room zones for maximum fill — they respect wall boundaries
        // Large zones span the entire building and boxes skip internal walls
        const zones = smallZones.length >= 2 ? smallZones : [...largeZones, ...smallZones];

        zones.sort((a, b) => b.area - a.area);
        console.log(`[CostoProLayout v4] Combined: ${zones.length} zones (${largeZones.length} large + ${zones.length - largeZones.length} small)`);
        return zones;
    }

    // ─────────────────────────────────────────────────────────────────
    //  Collision detection
    // ─────────────────────────────────────────────────────────────────

    _rectsOverlap(a, b, inset = 0) {
        return a.x < b.x + b.width - inset &&
            a.x + a.width > b.x + inset &&
            a.y < b.y + b.height - inset &&
            a.y + a.height > b.y + inset;
    }

    _boxHitsWall(bx, by, bw, bh) {
        const cl = this.wallClearance;
        const l = bx - cl, r = bx + bw + cl;
        const b = by - cl, t = by + bh + cl;
        for (const seg of this.wallSegments) {
            const sMinX = Math.min(seg.x1, seg.x2), sMaxX = Math.max(seg.x1, seg.x2);
            const sMinY = Math.min(seg.y1, seg.y2), sMaxY = Math.max(seg.y1, seg.y2);
            if (sMaxX < l || sMinX > r || sMaxY < b || sMinY > t) continue;
            if (this._segIntersectsRect(seg.x1, seg.y1, seg.x2, seg.y2, l, b, r, t)) return true;
        }
        return false;
    }

    _boxHitsObstacle(bx, by, bw, bh, { ignoreEntrances = false } = {}) {
        for (const r of this.forbiddenRects)
            if (bx < r.x + r.w && bx + bw > r.x && by < r.y + r.h && by + bh > r.y) return true;
        if (!ignoreEntrances) {
            for (const r of this.entranceRects)
                if (bx < r.x + r.w && bx + bw > r.x && by < r.y + r.h && by + bh > r.y) return true;
        }
        return false;
    }

    _segIntersectsRect(x1, y1, x2, y2, rL, rB, rR, rT) {
        const dx = x2 - x1, dy = y2 - y1;
        const p = [-dx, dx, -dy, dy];
        const q = [x1 - rL, rR - x1, y1 - rB, rT - y1];
        let tMin = 0, tMax = 1;
        for (let i = 0; i < 4; i++) {
            if (Math.abs(p[i]) < 1e-10) { if (q[i] < 0) return false; }
            else {
                const t = q[i] / p[i];
                if (p[i] < 0) { if (t > tMin) tMin = t; }
                else { if (t < tMax) tMax = t; }
                if (tMin > tMax) return false;
            }
        }
        return true;
    }

    _segSegIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
        const cross = (ux, uy, vx, vy) => ux * vy - uy * vx;
        const rx = bx - ax;
        const ry = by - ay;
        const sx = dx - cx;
        const sy = dy - cy;
        const denom = cross(rx, ry, sx, sy);
        if (Math.abs(denom) < 1e-10) return false;
        const t = cross(cx - ax, cy - ay, sx, sy) / denom;
        const u = cross(cx - ax, cy - ay, rx, ry) / denom;
        return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
    }

    _isBoxValid(bx, by, bw, bh) {
        const bounds = this.bounds;
        const cl = this.wallClearance;
        if (bx < bounds.minX + cl || bx + bw > bounds.maxX - cl) return false;
        if (by < bounds.minY + cl || by + bh > bounds.maxY - cl) return false;
        if (this._boxHitsWall(bx, by, bw, bh)) return false;
        if (this._boxHitsObstacle(bx, by, bw, bh)) return false;
        return true;
    }

    _corridorCrossesStructuralWall(corridor) {
        if (!corridor) return true;
        const x = Number(corridor.x);
        const y = Number(corridor.y);
        const w = Number(corridor.width);
        const h = Number(corridor.height);
        if (![x, y, w, h].every(Number.isFinite)) return true;
        if (w <= 0 || h <= 0) return true;

        const isHorizontal = corridor.direction === 'horizontal' || w >= h;
        const p1 = isHorizontal
            ? { x, y: y + h / 2 }
            : { x: x + w / 2, y };
        const p2 = isHorizontal
            ? { x: x + w, y: y + h / 2 }
            : { x: x + w / 2, y: y + h };

        for (const seg of this.wallSegments) {
            const sMinX = Math.min(seg.x1, seg.x2);
            const sMaxX = Math.max(seg.x1, seg.x2);
            const sMinY = Math.min(seg.y1, seg.y2);
            const sMaxY = Math.max(seg.y1, seg.y2);
            const cMinX = Math.min(p1.x, p2.x);
            const cMaxX = Math.max(p1.x, p2.x);
            const cMinY = Math.min(p1.y, p2.y);
            const cMaxY = Math.max(p1.y, p2.y);
            if (sMaxX < cMinX || sMinX > cMaxX || sMaxY < cMinY || sMinY > cMaxY) continue;
            if (this._segIntersectsRect(seg.x1, seg.y1, seg.x2, seg.y2, x, y, x + w, y + h)) {
                if (this._segSegIntersect(p1.x, p1.y, p2.x, p2.y, seg.x1, seg.y1, seg.x2, seg.y2)) {
                    return true;
                }
            }
        }
        return false;
    }

    _corridorsConflict(a, b) {
        if (!a || !b) return false;
        const aH = a.direction === 'horizontal' || a.width >= a.height;
        const bH = b.direction === 'horizontal' || b.width >= b.height;
        if (aH !== bH) return false;

        if (aH) {
            const ay = a.y + a.height / 2;
            const by = b.y + b.height / 2;
            const centerTol = Math.max(0.03, Math.min(a.height, b.height) * 0.45);
            if (Math.abs(ay - by) > centerTol) return false;
            const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
            if (overlap <= 0) return false;
            return overlap >= Math.min(a.width, b.width) * 0.45;
        }

        const ax = a.x + a.width / 2;
        const bx = b.x + b.width / 2;
        const centerTol = Math.max(0.03, Math.min(a.width, b.width) * 0.45);
        if (Math.abs(ax - bx) > centerTol) return false;
        const overlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (overlap <= 0) return false;
        return overlap >= Math.min(a.height, b.height) * 0.45;
    }

    _sanitizeFinalLayout(units, corridors) {
        const safeUnits = [];
        const safeCorridors = [];

        for (const unit of (units || [])) {
            if (!unit || ![unit.x, unit.y, unit.width, unit.height].every(Number.isFinite)) continue;
            if (!this._isBoxValid(unit.x, unit.y, unit.width, unit.height)) continue;
            const overlapsExisting = safeUnits.some((u) => this._rectsOverlap(unit, u, 0.01));
            if (overlapsExisting) continue;
            safeUnits.push(unit);
        }

        for (const corridor of (corridors || [])) {
            if (!corridor || ![corridor.x, corridor.y, corridor.width, corridor.height].every(Number.isFinite)) continue;
            if (corridor.width < 0.05 || corridor.height < 0.05) continue;
            if (corridor.x < this.bounds.minX || corridor.y < this.bounds.minY) continue;
            if (corridor.x + corridor.width > this.bounds.maxX || corridor.y + corridor.height > this.bounds.maxY) continue;
            if (this._corridorCrossesStructuralWall(corridor)) continue;
            if (this._boxHitsObstacle(corridor.x, corridor.y, corridor.width, corridor.height, { ignoreEntrances: true })) continue;
            const overlapsUnit = safeUnits.some((u) => this._rectsOverlap(corridor, u, 0.002));
            if (overlapsUnit) continue;
            const overlapsCorridor = safeCorridors.some((c) => this._corridorsConflict(corridor, c));
            if (overlapsCorridor) continue;
            safeCorridors.push(corridor);
        }

        return {
            units: safeUnits,
            corridors: safeCorridors,
            removedUnits: Math.max(0, (units || []).length - safeUnits.length),
            removedCorridors: Math.max(0, (corridors || []).length - safeCorridors.length)
        };
    }

    // ─────────────────────────────────────────────────────────────────
    //  Size catalog — exactly matching reference dimension annotations
    // ─────────────────────────────────────────────────────────────────

    _buildSizeCatalog(distribution) {
        // Widths chosen to match reference annotation values (1.29, 1.39, 1.40, 1.49, etc.)
        const catalog = [
            { type: 'S', width: 1.29, area: 1.29 * this.boxDepth },
            { type: 'S', width: 1.39, area: 1.39 * this.boxDepth },
            { type: 'M', width: 1.49, area: 1.49 * this.boxDepth },
            { type: 'M', width: 1.59, area: 1.59 * this.boxDepth },
            { type: 'L', width: 2.29, area: 2.29 * this.boxDepth },
            { type: 'L', width: 2.49, area: 2.49 * this.boxDepth },
            { type: 'XL', width: 3.29, area: 3.29 * this.boxDepth },
            { type: 'XL', width: 3.49, area: 3.49 * this.boxDepth },
        ];

        const total = (distribution.S || 0) + (distribution.M || 0) +
            (distribution.L || 0) + (distribution.XL || 0) || 100;
        const sizes = [];
        for (const item of catalog) {
            const pct = (distribution[item.type] || 0) / total;
            const cnt = Math.max(1, Math.round(pct * 16));
            for (let i = 0; i < cnt; i++) sizes.push(item);
        }

        // Seeded shuffle for reproducibility
        for (let i = sizes.length - 1; i > 0; i--) {
            const j = Math.floor((i * 6364136223846793005 % sizes.length + sizes.length) % sizes.length);
            [sizes[i], sizes[j]] = [sizes[j], sizes[i]];
        }

        return sizes.length ? sizes : [{ type: 'M', width: 1.49, area: 1.49 * this.boxDepth }];
    }

    // ─────────────────────────────────────────────────────────────────
    //  Main generation entry point
    // ─────────────────────────────────────────────────────────────────

    generate(config = {}) {
        const distribution = config.distribution || { S: 30, M: 40, L: 20, XL: 10 };

        // Diagnostics
        let freeCells = 0;
        for (let r = 0; r < this.gridRows; r++)
            for (let c = 0; c < this.gridCols; c++)
                if (!this.grid[r][c]) freeCells++;
        const totalCells = this.gridRows * this.gridCols;
        console.log(`[CostoProLayout v4] Grid ${this.gridCols}×${this.gridRows}, free: ${freeCells}/${totalCells} (${(freeCells / totalCells * 100).toFixed(1)}%)`);
        console.log(`[CostoProLayout v4] corridorWidth=${this.corridorWidth} boxDepth=${this.boxDepth} wallClearance=${this.wallClearance}`);

        // Step 1: Get zones — always prefer door-closed flood-fill (accurate free space)
        // Room bounding boxes overlap internal walls, flood-fill respects wall geometry
        const floodZones = this._findZones();
        const roomZones = floodZones.length >= 2 ? [] : this._zonesFromRooms(); // fallback only
        console.log(`[CostoProLayout v4] floodZones=${floodZones.length}, roomZones=${roomZones.length}`);
        const zones = floodZones.length >= 1 ? floodZones : roomZones;
        console.log(`[CostoProLayout v4] Using ${zones.length} zones (from ${zones === floodZones ? 'door-closed-flood' : 'rooms'})`);

        // Adaptive box depth: if median zone is too small for standard strips, shrink
        if (zones.length > 0) {
            const minDims = zones.map(z => Math.min(z.maxX - z.minX, z.maxY - z.minY)).sort((a, b) => a - b);
            const medianMinDim = minDims[Math.floor(minDims.length / 2)];
            const stripWidth = this.boxDepth + this.corridorWidth + this.boxDepth;
            console.log(`[CostoProLayout v4] Median zone min-dim=${medianMinDim.toFixed(2)}, current stripWidth=${stripWidth.toFixed(2)}`);
            if (medianMinDim < stripWidth && medianMinDim >= 2.0) {
                // Shrink box depth to fit: medianMinDim = 2*newDepth + corridorWidth
                const newDepth = Math.max(1.0, (medianMinDim - this.corridorWidth) / 2);
                console.log(`[CostoProLayout v4] Adaptive: shrinking boxDepth ${this.boxDepth.toFixed(2)} → ${newDepth.toFixed(2)}`);
                this.boxDepth = newDepth;
            } else if (medianMinDim < 2.0 && medianMinDim >= 0.8) {
                // Very small zones — use single-row with minimal depth
                this.boxDepth = Math.max(0.8, medianMinDim * 0.7);
                console.log(`[CostoProLayout v4] Adaptive: tiny zones, boxDepth → ${this.boxDepth.toFixed(2)}`);
            }
        }
        // Step 2: Place double-loaded rows in every zone
        const units = [];
        const corridors = [];
        let unitId = 1;
        const sizes = this._buildSizeCatalog(distribution);
        let sizeIdx = 0;
        const overlapInset = 0.01;

        for (const zone of zones) {
            const zW = (zone.maxX - zone.minX).toFixed(1), zH = (zone.maxY - zone.minY).toFixed(1);
            // Per-zone adaptive box depth: shrink if zone is too narrow for standard strips
            const savedBd = this.boxDepth;
            const zMinDim = Math.min(zone.maxX - zone.minX, zone.maxY - zone.minY);
            const stripNeeded = this.boxDepth + this.corridorWidth + this.boxDepth;
            if (zMinDim < stripNeeded && zMinDim >= 1.5) {
                this.boxDepth = Math.max(0.8, (zMinDim - this.corridorWidth) / 2);
            }
            const result = this._placeRowsInZone(zone, unitId, sizes, sizeIdx);
            this.boxDepth = savedBd;  // Restore global depth
            const beforeCount = units.length;
            for (const candidate of (result.units || [])) {
                const overlaps = units.some(u => this._rectsOverlap(candidate, u, overlapInset));
                if (!overlaps) { units.push(candidate); }
            }
            corridors.push(...(result.corridors || []));
            console.log(`[Zone] ${zW}×${zH}m → ${units.length - beforeCount} boxes (total: ${units.length})`);
            unitId = units.length + 1;
            sizeIdx = result.nextSizeIdx;
        }

        // Step 2b: Gap-filling pass — place individual boxes in remaining empty space
        {
            const gapFillBefore = units.length;
            const bd = this.boxDepth;
            const sp = this.boxSpacing;
            const b = this.bounds;
            const cl = this.wallClearance;

            // Build spatial index of existing rects for fast overlap check
            const occupied = units.map(u => ({ x: u.x, y: u.y, w: u.width, h: u.height }));
            for (const c of corridors) {
                if (Number.isFinite(c.x) && Number.isFinite(c.width))
                    occupied.push({ x: c.x, y: c.y, w: c.width, h: c.height });
            }
            // Also block forbidden zone bounding boxes
            for (const fz of this.forbiddenZones) {
                const r = this._getRect(fz);
                if (r) occupied.push(r);
            }

            const overlapsAny = (bx, by, bw, bh) => {
                for (const r of occupied) {
                    if (bx < r.x + r.w && bx + bw > r.x && by < r.y + r.h && by + bh > r.y) return true;
                }
                return false;
            };

            // Box sizes to try (from largest to smallest)
            const boxSizes = [
                { type: 'L', width: 2.29 },
                { type: 'M', width: 1.59 },
                { type: 'M', width: 1.49 },
                { type: 'S', width: 1.39 },
                { type: 'S', width: 1.29 },
                { type: 'S', width: 1.00 },
            ];

            // Fine scan step — must be small enough to find gaps inside rooms
            const step = 0.5;
            let diagOverlap = 0, diagWall = 0, diagObstacle = 0, diagBounds = 0, diagPlaced = 0;

            for (let scanY = b.minY + cl; scanY + bd <= b.maxY - cl; scanY += step) {
                for (let scanX = b.minX + cl; scanX + 1.0 <= b.maxX - cl; scanX += step) {
                    // Quick overlap check with smallest box
                    if (overlapsAny(scanX, scanY, 1.0, bd)) { diagOverlap++; continue; }

                    // Try to place the widest possible box here (horizontal)
                    let placed = false;
                    for (const size of boxSizes) {
                        const bw = size.width;
                        const bh = bd;
                        if (scanX + bw > b.maxX - cl) { diagBounds++; continue; }
                        if (this._boxHitsWall(scanX, scanY, bw, bh)) { diagWall++; continue; }
                        if (this._boxHitsObstacle(scanX, scanY, bw, bh)) { diagObstacle++; continue; }
                        if (overlapsAny(scanX, scanY, bw, bh)) { diagOverlap++; continue; }

                        const u = this._makeUnit(unitId++, scanX, scanY, bw, bh,
                            { type: size.type, width: bw, area: bw * bd }, 'single', false);
                        units.push(u);
                        occupied.push({ x: scanX, y: scanY, w: bw, h: bh });
                        placed = true;
                        diagPlaced++;
                        scanX += bw; // Jump past the placed box
                        break;
                    }

                    // Also try rotated (width = bd, height = boxWidth)
                    if (!placed) {
                        for (const size of boxSizes) {
                            const bw = bd;
                            const bh = size.width;
                            if (scanY + bh > b.maxY - cl) continue;
                            if (scanX + bw > b.maxX - cl) continue;
                            if (this._boxHitsWall(scanX, scanY, bw, bh)) { diagWall++; continue; }
                            if (this._boxHitsObstacle(scanX, scanY, bw, bh)) { diagObstacle++; continue; }
                            if (overlapsAny(scanX, scanY, bw, bh)) { diagOverlap++; continue; }

                            const u = this._makeUnit(unitId++, scanX, scanY, bw, bh,
                                { type: size.type, width: size.width, area: bw * bh }, 'single', true);
                            units.push(u);
                            occupied.push({ x: scanX, y: scanY, w: bw, h: bh });
                            diagPlaced++;
                            scanX += bw;
                            break;
                        }
                    }
                }
            }

            const gapFilled = units.length - gapFillBefore;
            console.log(`[CostoProLayout v4] Gap-fill: +${gapFilled} boxes | rejected: overlap=${diagOverlap} wall=${diagWall} obstacle=${diagObstacle} bounds=${diagBounds} | placed=${diagPlaced}`);
        }

        // Step 3: Cross-zone connector corridors
        const crossCorridors = this._buildCrossZoneCorridors(zones);
        corridors.push(...crossCorridors);
        console.log(`[CostoProLayout v4] Cross-zone connectors: ${crossCorridors.length}`);

        // Step 3b: Main hallways (envelope loop + spine connectors)
        const mainHallways = this._buildMainHallways(corridors, units);
        corridors.push(...mainHallways);
        console.log(`[CostoProLayout v4] Main hallways: ${mainHallways.length}`);

        // Step 4: Filter corridors (segmented corridors don't need wall-crossing check)
        const cleanCorridors = corridors.filter(c => {
            if (!c) return false;
            if (![c.x, c.y, c.width, c.height].every(Number.isFinite)) return false;
            if (c.width < 0.05 || c.height < 0.05) return false;
            // Skip wall-hit check: segmented corridors are built between box positions
            if (this._boxHitsObstacle(c.x, c.y, c.width, c.height, { ignoreEntrances: true })) return false;
            return true;
        });
        const sanitized = this._sanitizeFinalLayout(units, cleanCorridors);
        const finalUnits = sanitized.units;
        const finalCorridors = sanitized.corridors;
        if (sanitized.removedUnits > 0 || sanitized.removedCorridors > 0) {
            console.log(
                `[CostoProLayout v4] Safety sanitize: removed ${sanitized.removedUnits} overlapping/out-of-bounds boxes and ` +
                `${sanitized.removedCorridors} invalid corridors`
            );
        }
        finalCorridors.forEach((c, i) => { c.id = `corridor_${i}`; });
        finalUnits.forEach((u, i) => {
            u.id = `unit_${i + 1}`;
            u.displayNumber = i + 1;
            u.dimensionLabel = `${u.width.toFixed(2)}`;
        });

        console.log(`[CostoProLayout v4] ✓ ${finalUnits.length} units, ${finalCorridors.length} corridors`);

        // Step 5: Radiators along ALL perimeter wall segments
        const radiators = this._generateRadiators(finalUnits, finalCorridors);
        console.log(`[CostoProLayout v4] ✓ ${radiators.length} radiator segments`);

        // Step 6: Circulation paths
        let circulationPaths = [];
        try {
            const router = new CirculationRouter({
                bounds: this.bounds,
                walls: this.walls,
                envelope: this.envelope,
                entrances: this.entrances,
                forbiddenZones: this.forbiddenZones
            }, { oneWayFlow: this.oneWayFlow, blockThroughUnits: this.blockThroughUnits });
            circulationPaths = router.generateRoute(finalCorridors, finalUnits);
        } catch (err) {
            console.warn('[CostoProLayout v4] Circulation router fallback:', err.message);
            circulationPaths = finalCorridors
                .filter(c => c.type === 'ACCESS')
                .map(c => ({
                    type: c.type,
                    style: 'dashed_lightblue',
                    path: c.direction === 'horizontal'
                        ? [{ x: c.x, y: c.y + c.height / 2 }, { x: c.x + c.width, y: c.y + c.height / 2 }]
                        : [{ x: c.x + c.width / 2, y: c.y }, { x: c.x + c.width / 2, y: c.y + c.height }]
                }));
        }

        return { units: finalUnits, corridors: finalCorridors, radiators, circulationPaths };
    }

    // ─────────────────────────────────────────────────────────────────
    //  Cross-zone corridor injection
    // ─────────────────────────────────────────────────────────────────

    _buildCrossZoneCorridors(zones) {
        const cw = this.corridorWidth;
        const maxGap = cw * 2.5;
        const minOverlap = cw * 1.2;
        const bridges = [];

        for (let i = 0; i < zones.length; i++) {
            for (let j = i + 1; j < zones.length; j++) {
                const a = zones[i], b = zones[j];

                // Horizontal adjacency
                const hGap = Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX);
                const hOverlap = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
                if (hGap >= 0 && hGap <= maxGap && hOverlap >= minOverlap) {
                    const bx = Math.min(a.maxX, b.maxX);
                    const bw = Math.max(hGap, cw * 0.5);
                    const mid = (Math.max(a.minY, b.minY) + Math.min(a.maxY, b.maxY)) / 2;
                    const by = mid - cw / 2;
                    if (!this._boxHitsWall(bx, by, bw, cw) && !this._boxHitsObstacle(bx, by, bw, cw, { ignoreEntrances: true }))
                        bridges.push({ type: 'ACCESS', direction: 'horizontal', x: bx, y: by, width: bw, height: cw, isCrossZone: true });
                }

                // Vertical adjacency
                const vGap = Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY);
                const vOverlap = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
                if (vGap >= 0 && vGap <= maxGap && vOverlap >= minOverlap) {
                    const by = Math.min(a.maxY, b.maxY);
                    const bh = Math.max(vGap, cw * 0.5);
                    const mid = (Math.max(a.minX, b.minX) + Math.min(a.maxX, b.maxX)) / 2;
                    const bx = mid - cw / 2;
                    if (!this._boxHitsWall(bx, by, cw, bh) && !this._boxHitsObstacle(bx, by, cw, bh, { ignoreEntrances: true }))
                        bridges.push({ type: 'ACCESS', direction: 'vertical', x: bx, y: by, width: cw, height: bh, isCrossZone: true });
                }
            }
        }
        return bridges;
    }

    // ─────────────────────────────────────────────────────────────────
    //  Main hallway injection — envelope loop + spine connectors
    // ─────────────────────────────────────────────────────────────────

    _buildMainHallways(existingCorridors, units) {
        const cw = this.corridorWidth;
        const b = this.bounds;
        const hallways = [];

        // Collect all box rects for gap detection
        const boxes = units.map(u => ({ x: u.x, y: u.y, w: u.width, h: u.height }));
        if (boxes.length === 0) return hallways;

        // === Strategy: find free-space gaps between unit clusters ===
        // Scan horizontal bands and vertical bands for continuous gaps
        // wider than corridorWidth → those are real hallways

        const spanX = b.maxX - b.minX;
        const spanY = b.maxY - b.minY;
        const step = cw * 0.5; // scan resolution

        // --- Horizontal hallways (scan Y bands) ---
        for (let y = b.minY + cw; y < b.maxY - cw; y += step) {
            // Check if a horizontal strip at this Y is free of boxes
            const stripY0 = y, stripY1 = y + cw;
            let blocked = false;
            for (const box of boxes) {
                if (box.y < stripY1 && box.y + box.h > stripY0) {
                    // Box overlaps this Y band — find clear X segments
                    blocked = true;
                    break;
                }
            }
            if (blocked) continue;

            // This Y band is clear of all boxes → find longest clear X runs
            // Split by walls
            const wallCrossings = [];
            for (const seg of this.wallSegments) {
                // Horizontal wall check: does this wall cross our strip?
                const wMinY = Math.min(seg.y1, seg.y2), wMaxY = Math.max(seg.y1, seg.y2);
                const wMinX = Math.min(seg.x1, seg.x2), wMaxX = Math.max(seg.x1, seg.x2);
                // Vertical wall crossing our horizontal strip
                if (wMaxX - wMinX < cw && wMaxY - wMinY > cw * 0.5) {
                    if (wMinY < stripY1 && wMaxY > stripY0) {
                        wallCrossings.push((wMinX + wMaxX) / 2);
                    }
                }
            }
            wallCrossings.sort((a, c) => a - c);

            // Build segments between wall crossings
            const points = [b.minX + cw, ...wallCrossings, b.maxX - cw];
            for (let i = 0; i < points.length - 1; i++) {
                const sx = points[i] + cw * 0.3;
                const ex = points[i + 1] - cw * 0.3;
                const len = ex - sx;
                if (len > cw * 3) { // Only corridors longer than 3x corridor width
                    hallways.push({
                        type: 'ACCESS', direction: 'horizontal', isMainHallway: true,
                        x: sx, y: stripY0, width: len, height: cw
                    });
                }
            }
            y += cw; // Skip ahead to avoid duplicate hallways
        }

        // --- Vertical hallways (scan X bands) ---
        for (let x = b.minX + cw; x < b.maxX - cw; x += step) {
            const stripX0 = x, stripX1 = x + cw;
            let blocked = false;
            for (const box of boxes) {
                if (box.x < stripX1 && box.x + box.w > stripX0) {
                    blocked = true;
                    break;
                }
            }
            if (blocked) continue;

            // This X band is clear of all boxes → find longest clear Y runs
            const wallCrossings = [];
            for (const seg of this.wallSegments) {
                const wMinX = Math.min(seg.x1, seg.x2), wMaxX = Math.max(seg.x1, seg.x2);
                const wMinY = Math.min(seg.y1, seg.y2), wMaxY = Math.max(seg.y1, seg.y2);
                // Horizontal wall crossing our vertical strip
                if (wMaxY - wMinY < cw && wMaxX - wMinX > cw * 0.5) {
                    if (wMinX < stripX1 && wMaxX > stripX0) {
                        wallCrossings.push((wMinY + wMaxY) / 2);
                    }
                }
            }
            wallCrossings.sort((a, c) => a - c);

            const points = [b.minY + cw, ...wallCrossings, b.maxY - cw];
            for (let i = 0; i < points.length - 1; i++) {
                const sy = points[i] + cw * 0.3;
                const ey = points[i + 1] - cw * 0.3;
                const len = ey - sy;
                if (len > cw * 3) {
                    hallways.push({
                        type: 'ACCESS', direction: 'vertical', isMainHallway: true,
                        x: stripX0, y: sy, width: cw, height: len
                    });
                }
            }
            x += cw; // Skip ahead
        }

        console.log(`[CostoProLayout v4] Main hallway scan: ${hallways.length} segments (before wall filter)`);
        // Filter out segments that clip structural walls
        return hallways.filter(h => !this._boxHitsWall(h.x, h.y, h.width, h.height));
    }

    // ─────────────────────────────────────────────────────────────────
    //  Double-loaded row placement within a zone
    // ─────────────────────────────────────────────────────────────────

    _placeRowsInZone(zone, startId, sizes, sizeIdx) {
        const units = [];
        const corridors = [];
        const cw = this.corridorWidth;
        const bd = this.boxDepth;
        const sp = this.boxSpacing;
        const stripWidth = bd + cw + bd; // e.g. 2.5 + 1.2 + 2.5 = 6.2m

        const zW = zone.maxX - zone.minX;
        const zH = zone.maxY - zone.minY;

        const numStripsH = Math.floor(zW / stripWidth);
        const numStripsV = Math.floor(zH / stripWidth);

        // Choose orientation that fits more double-loaded pairs
        const useVerticalStrips = numStripsV > numStripsH && zW > zH * 0.6;
        const numStrips = useVerticalStrips ? numStripsV : numStripsH;

        if (numStrips < 1) {
            return this._placeSingleRowInZone(zone, startId, sizes, sizeIdx);
        }

        for (let s = 0; s < numStrips; s++) {
            const stripStart = (useVerticalStrips ? zone.minY : zone.minX) + s * stripWidth;

            const leftStart = stripStart;
            const corridorStart = stripStart + bd;
            const rightStart = stripStart + bd + cw;

            const fillStart = useVerticalStrips ? zone.minX : zone.minY;
            const fillEnd = useVerticalStrips ? zone.maxX : zone.maxY;
            let corridorHasBoxes = false;

            // ── Left row ──────────────────────────────────────────────
            let cur = fillStart;
            while (cur + this.minGapLength <= fillEnd) {
                const size = sizes[sizeIdx % sizes.length]; sizeIdx++;
                const boxW = size.width;
                if (cur + boxW > fillEnd) break;

                const bx = useVerticalStrips ? cur : leftStart;
                const by = useVerticalStrips ? leftStart : cur;
                const bw = useVerticalStrips ? boxW : bd;
                const bh = useVerticalStrips ? bd : boxW;

                if (this._isBoxValid(bx, by, bw, bh)) {
                    units.push(this._makeUnit(startId + units.length, bx, by, bw, bh, size, 'left', useVerticalStrips));
                    corridorHasBoxes = true;
                }
                cur += boxW + sp;
            }

            // ── Right row ─────────────────────────────────────────────
            cur = fillStart;
            while (cur + this.minGapLength <= fillEnd) {
                const size = sizes[sizeIdx % sizes.length]; sizeIdx++;
                const boxW = size.width;
                if (cur + boxW > fillEnd) break;

                const bx = useVerticalStrips ? cur : rightStart;
                const by = useVerticalStrips ? rightStart : cur;
                const bw = useVerticalStrips ? boxW : bd;
                const bh = useVerticalStrips ? bd : boxW;

                if (this._isBoxValid(bx, by, bw, bh)) {
                    units.push(this._makeUnit(startId + units.length, bx, by, bw, bh, size, 'right', useVerticalStrips));
                    corridorHasBoxes = true;
                }
                cur += boxW + sp;
            }

            // ── Corridor segments between rows ────────────────────────
            // Create short wall-safe segments rather than one long corridor
            if (corridorHasBoxes) {
                // Find contiguous box runs to create corridor segments
                const boxPositions = units
                    .filter(u => {
                        const pos = useVerticalStrips ? u.x : u.y;
                        const end = useVerticalStrips ? u.x + u.width : u.y + u.height;
                        return pos >= fillStart && end <= fillEnd;
                    })
                    .map(u => ({
                        start: useVerticalStrips ? u.x : u.y,
                        end: useVerticalStrips ? u.x + u.width : u.y + u.height
                    }))
                    .sort((a, b) => a.start - b.start);

                if (boxPositions.length > 0) {
                    // Merge overlapping/adjacent box positions into corridor segments
                    let segStart = boxPositions[0].start;
                    let segEnd = boxPositions[0].end;

                    for (let i = 1; i <= boxPositions.length; i++) {
                        const bp = i < boxPositions.length ? boxPositions[i] : null;
                        if (bp && bp.start <= segEnd + sp * 2) {
                            segEnd = Math.max(segEnd, bp.end);
                        } else {
                            // Emit corridor segment
                            const segLen = segEnd - segStart;
                            if (segLen >= this.minGapLength) {
                                if (useVerticalStrips) {
                                    corridors.push({
                                        type: 'ACCESS', direction: 'horizontal',
                                        x: segStart, y: corridorStart, width: segLen, height: cw
                                    });
                                } else {
                                    corridors.push({
                                        type: 'ACCESS', direction: 'vertical',
                                        x: corridorStart, y: segStart, width: cw, height: segLen
                                    });
                                }
                            }
                            if (bp) { segStart = bp.start; segEnd = bp.end; }
                        }
                    }
                }
            }
        }

        // Fill leftover edge with single row
        const edgeStart = (useVerticalStrips ? zone.minY : zone.minX) + numStrips * stripWidth;
        const edgeEnd = useVerticalStrips ? zone.maxY : zone.maxX;
        if (edgeEnd - edgeStart >= bd * 0.6) {
            const edgeZone = useVerticalStrips
                ? { minX: zone.minX, minY: edgeStart, maxX: zone.maxX, maxY: edgeEnd }
                : { minX: edgeStart, minY: zone.minY, maxX: edgeEnd, maxY: zone.maxY };
            const edgeResult = this._placeSingleRowInZone(edgeZone, startId + units.length, sizes, sizeIdx);
            units.push(...(edgeResult.units || []));
            sizeIdx = edgeResult.nextSizeIdx;
        }

        return { units, corridors, nextSizeIdx: sizeIdx };
    }

    _makeUnit(id, bx, by, bw, bh, size, rowSide, useVerticalStrips) {
        const doorSide = rowSide === 'left'
            ? (useVerticalStrips ? 'top' : 'right')
            : (useVerticalStrips ? 'bottom' : 'left');
        return {
            id: `unit_${id}`,
            x: bx, y: by, width: bw, height: bh,
            area: Number((bw * bh).toFixed(2)),
            type: size.type,
            label: `${size.area.toFixed(1)}m²`,
            dimensionLabel: `${(useVerticalStrips ? bw : bh).toFixed(2)}`,  // width annotation
            partitionType: rowSide === 'left' ? 'toleGrise' : 'toleBlanche',
            row: rowSide,
            doorSide,
            doorWidth: 0.8,
            partitions: {
                top: rowSide === 'right' && !useVerticalStrips ? 'tole_blanche' : 'tole_grise',
                bottom: rowSide === 'left' && !useVerticalStrips ? 'tole_blanche' : 'tole_grise',
                left: rowSide === 'right' && useVerticalStrips ? 'tole_blanche' : 'tole_grise',
                right: rowSide === 'left' && useVerticalStrips ? 'tole_blanche' : 'tole_grise',
            }
        };
    }

    _placeSingleRowInZone(zone, startId, sizes, sizeIdx) {
        const units = [];
        const corridors = [];
        const bd = this.boxDepth;
        const sp = this.boxSpacing;
        const zW = zone.maxX - zone.minX;
        const zH = zone.maxY - zone.minY;

        if (zW < this.minGapLength && zH < this.minGapLength) return { units, corridors, nextSizeIdx: sizeIdx };

        const horizontal = zW >= zH;
        const fillStart = horizontal ? zone.minX : zone.minY;
        const fillEnd = horizontal ? zone.maxX : zone.maxY;
        const rowStart = horizontal ? zone.minY : zone.minX;
        const rowDepth = Math.min(bd, horizontal ? zH : zW);

        let cur = fillStart;
        while (cur + this.minGapLength <= fillEnd) {
            const size = sizes[sizeIdx % sizes.length]; sizeIdx++;
            const boxW = size.width;
            if (cur + boxW > fillEnd) break;

            const bx = horizontal ? cur : rowStart;
            const by = horizontal ? rowStart : cur;
            const bw = horizontal ? boxW : rowDepth;
            const bh = horizontal ? rowDepth : boxW;

            if (this._isBoxValid(bx, by, bw, bh)) {
                units.push(this._makeUnit(startId + units.length, bx, by, bw, bh, size, 'single', !horizontal));
            }
            cur += boxW + sp;
        }

        return { units, corridors, nextSizeIdx: sizeIdx };
    }

    // ─────────────────────────────────────────────────────────────────
    //  Radiator generation — continuous zigzag along ALL perimeter walls
    // ─────────────────────────────────────────────────────────────────

    _generateRadiators(units, corridors) {
        const radiators = [];
        const b = this.bounds;
        const centerX = (b.minX + b.maxX) / 2;
        const centerY = (b.minY + b.maxY) / 2;

        // ── Part 1: Perimeter wall radiators ────────────────────────
        const perimeterSegs = this._detectPerimeterWalls();
        const merged = this._mergeCollinear(perimeterSegs);

        for (const seg of merged) {
            const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
            if (len < 0.8) continue;

            const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1;
            const l = Math.hypot(dx, dy);
            const n1x = -dy / l, n1y = dx / l;
            const midX = (seg.x1 + seg.x2) / 2, midY = (seg.y1 + seg.y2) / 2;
            const dot = n1x * (centerX - midX) + n1y * (centerY - midY);
            const nx = dot >= 0 ? n1x : -n1x;
            const ny = dot >= 0 ? n1y : -n1y;

            const wl = Math.min(this.radiatorWavelength, len / 4);
            const path = this._zigzag(
                seg.x1, seg.y1, seg.x2, seg.y2,
                nx, ny, this.radiatorOffset, this.radiatorAmplitude, wl
            );

            if (path.length >= 2) {
                radiators.push({
                    type: 'radiator',
                    wallSegment: { start: { x: seg.x1, y: seg.y1 }, end: { x: seg.x2, y: seg.y2 } },
                    path, color: 'red', style: 'zigzag',
                    length: len
                });
            }
        }

        // ── Part 2: Corridor-adjacent unit-edge radiators ───────────
        if (units && corridors && units.length > 0 && corridors.length > 0) {
            const edgeTol = 0.15; // tolerance for edge adjacency detection
            const dedupeSet = new Set();

            for (const corridor of corridors) {
                const cx = corridor.x, cy = corridor.y;
                const cw = corridor.width, ch = corridor.height;
                if (!Number.isFinite(cx) || !Number.isFinite(cw)) continue;

                // Corridor edges
                const isVert = ch > cw; // vertical corridor
                for (const unit of units) {
                    const ux = unit.x, uy = unit.y;
                    const uw = unit.width, uh = unit.height;
                    if (!Number.isFinite(ux) || !Number.isFinite(uw)) continue;

                    // Check each unit edge for adjacency to the corridor
                    const edges = [
                        // Bottom edge of unit → top of corridor
                        { adj: Math.abs(uy - (cy + ch)) < edgeTol, x1: ux, y1: uy, x2: ux + uw, y2: uy, nx: 0, ny: 1 },
                        // Top edge of unit → bottom of corridor
                        { adj: Math.abs((uy + uh) - cy) < edgeTol, x1: ux, y1: uy + uh, x2: ux + uw, y2: uy + uh, nx: 0, ny: -1 },
                        // Left edge of unit → right of corridor
                        { adj: Math.abs(ux - (cx + cw)) < edgeTol, x1: ux, y1: uy, x2: ux, y2: uy + uh, nx: 1, ny: 0 },
                        // Right edge of unit → left of corridor
                        { adj: Math.abs((ux + uw) - cx) < edgeTol, x1: ux + uw, y1: uy, x2: ux + uw, y2: uy + uh, nx: -1, ny: 0 },
                    ];

                    for (const edge of edges) {
                        if (!edge.adj) continue;
                        const len = Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1);
                        if (len < 0.4) continue;

                        // Deduplicate: don't place radiators on same edge twice
                        const key = [Math.round(edge.x1 * 10), Math.round(edge.y1 * 10),
                        Math.round(edge.x2 * 10), Math.round(edge.y2 * 10)].join('|');
                        if (dedupeSet.has(key)) continue;
                        dedupeSet.add(key);

                        const wl = Math.min(this.radiatorWavelength, len / 4);
                        const path = this._zigzag(
                            edge.x1, edge.y1, edge.x2, edge.y2,
                            edge.nx, edge.ny, this.radiatorOffset * 0.8, this.radiatorAmplitude * 0.8, wl
                        );
                        if (path.length >= 2) {
                            radiators.push({
                                type: 'radiator',
                                wallSegment: { start: { x: edge.x1, y: edge.y1 }, end: { x: edge.x2, y: edge.y2 } },
                                path, color: 'red', style: 'zigzag',
                                length: len, source: 'corridor-edge'
                            });
                        }
                    }
                }
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

        // If we have actual envelope segments from CAD, use distance-to-envelope
        if (this.envelope && this.envelope.length > 0) {
            const envSegs = [];
            for (const eSeg of this.envelope) {
                const s = this._extractSeg(eSeg);
                if (s) envSegs.push(s);
            }

            if (envSegs.length > 0) {
                const maxDist = 0.5; // Wall midpoint must be within 0.5m of envelope
                const segs = [];
                for (const seg of this.wallSegments) {
                    if (seg.length < 0.4) continue;
                    const midX = (seg.x1 + seg.x2) / 2, midY = (seg.y1 + seg.y2) / 2;
                    let minD = Infinity;
                    for (const es of envSegs) {
                        const d = this._pointToSegDist(midX, midY, es.x1, es.y1, es.x2, es.y2);
                        if (d < minD) minD = d;
                    }
                    if (minD <= maxDist) segs.push(seg);
                }
                if (segs.length > 0) return segs;
            }
        }

        // Fallback: bounds-based detection
        const tw = Math.max((b.maxX - b.minX), (b.maxY - b.minY)) * 0.025;
        const segs = [];
        for (const seg of this.wallSegments) {
            if (seg.length < 0.4) continue;
            const nearL = Math.abs(seg.x1 - b.minX) < tw && Math.abs(seg.x2 - b.minX) < tw;
            const nearR = Math.abs(seg.x1 - b.maxX) < tw && Math.abs(seg.x2 - b.maxX) < tw;
            const nearB = Math.abs(seg.y1 - b.minY) < tw && Math.abs(seg.y2 - b.minY) < tw;
            const nearT = Math.abs(seg.y1 - b.maxY) < tw && Math.abs(seg.y2 - b.maxY) < tw;
            if (nearL || nearR || nearB || nearT) segs.push(seg);
        }
        return segs;
    }

    /** Point-to-segment distance for envelope proximity check */
    _pointToSegDist(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq < 0.0001) return Math.hypot(px - x1, py - y1);
        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }

    _mergeCollinear(segs) {
        if (segs.length <= 1) return segs;
        const merged = [...segs];
        let changed = true;
        while (changed) {
            changed = false;
            for (let i = 0; i < merged.length && !changed; i++) {
                for (let j = i + 1; j < merged.length && !changed; j++) {
                    const a = merged[i], bb = merged[j];
                    const isHA = Math.abs(a.y2 - a.y1) < 0.25;
                    const isHB = Math.abs(bb.y2 - bb.y1) < 0.25;
                    const isVA = Math.abs(a.x2 - a.x1) < 0.25;
                    const isVB = Math.abs(bb.x2 - bb.x1) < 0.25;

                    if (isHA && isHB && Math.abs(a.y1 - bb.y1) < 0.35) {
                        const minX = Math.min(a.x1, a.x2, bb.x1, bb.x2), maxX = Math.max(a.x1, a.x2, bb.x1, bb.x2);
                        const gap = Math.max(0, Math.min(a.x1, a.x2) > Math.min(bb.x1, bb.x2)
                            ? Math.min(a.x1, a.x2) - Math.max(bb.x1, bb.x2)
                            : Math.min(bb.x1, bb.x2) - Math.max(a.x1, a.x2));
                        if (gap < 0.6) {
                            merged[i] = { x1: minX, y1: a.y1, x2: maxX, y2: a.y1, length: maxX - minX };
                            merged.splice(j, 1); changed = true;
                        }
                    } else if (isVA && isVB && Math.abs(a.x1 - bb.x1) < 0.35) {
                        const minY = Math.min(a.y1, a.y2, bb.y1, bb.y2), maxY = Math.max(a.y1, a.y2, bb.y1, bb.y2);
                        const gap = Math.max(0, Math.min(a.y1, a.y2) > Math.min(bb.y1, bb.y2)
                            ? Math.min(a.y1, a.y2) - Math.max(bb.y1, bb.y2)
                            : Math.min(bb.y1, bb.y2) - Math.max(a.y1, a.y2));
                        if (gap < 0.6) {
                            merged[i] = { x1: a.x1, y1: minY, x2: a.x1, y2: maxY, length: maxY - minY };
                            merged.splice(j, 1); changed = true;
                        }
                    }
                }
            }
        }
        return merged;
    }

    // ─────────────────────────────────────────────────────────────────
    //  Utility helpers
    // ─────────────────────────────────────────────────────────────────

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
