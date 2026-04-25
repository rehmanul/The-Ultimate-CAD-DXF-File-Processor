'use strict';

const CirculationRouter = require('./costo-engine/circulationRouter');
const WallHuggingPlacer = require('./costo-engine/wallHuggingPlacer');
const FacingRowDetector = require('./facingRowDetector');

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
        this._outerPerimeterPolygon = null;
        this._outerPerimeterSource = 'unresolved';
        this._outerPerimeterResolved = false;

        // Layout parameters
        this.corridorWidth = Math.max(0.8, Number(options.corridorWidth) || 1.20);
        this.wallClearance = Math.max(0.02, Number(options.wallClearance) || 0.10);
        this.layoutMode = options.layoutMode === 'wallHugging' ? 'wallHugging' : 'rowBased';
        this.wallClearanceMm = Number.isFinite(Number(options.wallClearanceMm))
            ? Math.max(50, Number(options.wallClearanceMm))
            : 500;
        this.boxDepth = Math.max(1.5, Number(options.boxDepth) || 2.50);
        this.boxSpacing = Math.max(0.00, Number(options.boxSpacing) || 0.02);
        this.rowGapClearance = Math.max(0.01, Number(options.rowGapClearance) || 0.04);
        this.corridorGapClearance = Math.max(0.01, Number(options.corridorGapClearance) || 0.04);
        this.corridorInset = Math.max(0.00, Number(options.corridorInset) || 0.04);
        this.minGapLength = Math.max(0.30, Number(options.minGapLength) || 0.60);
        this.maximizeFill = options.maximizeFill !== false;
        this.oneWayFlow = options.oneWayFlow === true;
        // Keep false by default: corridor geometry already encodes no-box regions,
        // and treating every unit edge as a wall can fragment circulation graphs.
        this.blockThroughUnits = options.blockThroughUnits === true;
        this.retainDisconnectedCorridors = options.retainDisconnectedCorridors !== false;
        this.corridorComponentMinLength = Math.max(
            this.corridorWidth * 1.5,
            Number(options.corridorComponentMinLength) || 1.8
        );

        // Radiator parameters (tight like reference)
        this.radiatorAmplitude = 0.12;
        this.radiatorWavelength = 0.38;
        this.radiatorOffset = 0.18;

        // Occupancy grid resolution (0.20m cells for precision)
        this.gridSize = 0.20;
        // Placement grid: all box (x,y) snap to this step for straight, wall-aligned layout (no disordered boxes)
        this.placementGridStep = Math.max(0.05, Number(options.placementGridStep) || 0.10);
        // Row alignment: Y snapped to this step so boxes line up in clear horizontal rows (no disordered stacks)
        this.rowAlignmentStep = Math.max(0.10, Number(options.rowAlignmentStep) || 0.20);

        this._prepareWallSegments();
        this._buildGrid();
    }

    /**
     * Compute corridor junction graph and classify junction types.
     * Returns { junctions: [{x,y,degree,type}], isJunction: (x,y)=>bool }
     * Types: 'dead_end'(1), 'linear'(2), 'T'(3), 'cross'(4)
     */
    static computeCorridorJunctionMetadata(corridors) {
        const tol = 0.20;
        const hSegs = [];
        const vSegs = [];
        for (const c of corridors || []) {
            const x = Number(c.x), y = Number(c.y), w = Number(c.width), h = Number(c.height);
            if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
            const isHz = c.direction === 'horizontal' || w >= h;
            if (isHz) {
                hSegs.push({ c: y + h / 2, s: x, e: x + w });
            } else {
                vSegs.push({ c: x + w / 2, s: y, e: y + h });
            }
        }
        const pointData = new Map();
        const key = (px, py) => `${Math.round(px / tol)}_${Math.round(py / tol)}`;
        const addPoint = (px, py) => {
            const k = key(px, py);
            const cur = pointData.get(k) || { count: 0, x: px, y: py };
            cur.count++;
            cur.x = (cur.x * (cur.count - 1) + px) / cur.count;
            cur.y = (cur.y * (cur.count - 1) + py) / cur.count;
            pointData.set(k, cur);
        };
        for (const h of hSegs) {
            addPoint(h.s, h.c);
            addPoint(h.e, h.c);
            for (const v of vSegs) {
                if (v.c >= h.s - tol && v.c <= h.e + tol && h.c >= v.s - tol && h.c <= v.e + tol) {
                    addPoint(v.c, h.c);
                }
            }
        }
        for (const v of vSegs) {
            addPoint(v.c, v.s);
            addPoint(v.c, v.e);
        }
        const junctions = [];
        for (const [, data] of pointData) {
            if (data.count < 2) continue;
            let type = 'linear';
            if (data.count >= 4) type = 'cross';
            else if (data.count === 3) type = 'T';
            junctions.push({ x: data.x, y: data.y, degree: data.count, type });
        }
        const isJunction = (px, py, radius = 0.08) => {
            for (const j of junctions) {
                if (Math.hypot(px - j.x, py - j.y) <= radius) return true;
            }
            return false;
        };
        return { junctions, isJunction };
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
            // Keep a stronger no-place buffer near entrances so units cannot
            // visually sit on top of access points.
            const minSize = Math.max(0.85, this.corridorWidth * 0.85);
            const inflate = Math.max(0.35, this.corridorWidth * 0.32);
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

        // Burn walls with 2-cell (0.40m) buffer
        for (const seg of this.wallSegments) {
            if (seg.length < 0.25) continue;
            this._burnLine(seg.x1, seg.y1, seg.x2, seg.y2, 2);
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

    _isRectInFreeGrid(bx, by, bw, bh) {
        if (!this.grid || !this.grid.length) return true;
        const gs = this.gridSize;
        const c1 = Math.max(0, Math.floor((bx - this.gridMinX) / gs));
        const c2 = Math.min(this.gridCols - 1, Math.floor((bx + bw - this.gridMinX) / gs));
        const r1 = Math.max(0, Math.floor((by - this.gridMinY) / gs));
        const r2 = Math.min(this.gridRows - 1, Math.floor((by + bh - this.gridMinY) / gs));
        for (let r = r1; r <= r2; r++)
            for (let c = c1; c <= c2; c++)
                if (this.grid[r][c]) return false;
        return true;
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

    // ─────────────────────────────────────────────────────────────────
    //  Bay detection — corridor-plus-rows regions anchored to walls
    // ─────────────────────────────────────────────────────────────────

    /**
     * Detect high-level \"bays\" inside each free-space zone. A bay represents a
     * corridor band plus its adjacent double-loaded rows.
     *
     * Initial implementation is deliberately coarse:
     *   - Uses the zone rectangle from _findZones / _zonesFromRooms
     *   - Chooses a dominant orientation based on aspect ratio
     *   - Uses zone bounds as proxies for inside-of-wall lines
     *
     * Later we can refine this to follow detailed wall geometry and split zones
     * into multiple bays when cross-walls or strong room boundaries exist.
     */
    _detectBays(zones) {
        this._bays = [];
        this._validGapFillRegions = [];
        let bayCounter = 1;

        if (!Array.isArray(zones) || zones.length === 0) {
            console.log('[CostoProLayout v4] Bay planner: no zones, no bays');
            return this._bays;
        }

        /**
         * Helper: project wall segments onto an axis-aligned zone to find the
         * nearest wall position from each face (left, right, top, bottom).
         * Returns { wallMinX, wallMaxX, wallMinY, wallMaxY } — the innermost
         * wall face positions within the zone, defaulting to zone bounds
         * when no wall is found near a face.
         */
        const wallProjectionsForZone = (zMinX, zMaxX, zMinY, zMaxY) => {
            const tol = Math.max(0.5, this.wallClearance * 3);
            let wallMinX = zMinX, wallMaxX = zMaxX;
            let wallMinY = zMinY, wallMaxY = zMaxY;

            for (const seg of this.wallSegments) {
                const sx1 = Math.min(seg.x1, seg.x2), sx2 = Math.max(seg.x1, seg.x2);
                const sy1 = Math.min(seg.y1, seg.y2), sy2 = Math.max(seg.y1, seg.y2);
                const isHWall = Math.abs(sy2 - sy1) < Math.abs(sx2 - sx1) * 0.25; // nearly horizontal
                const isVWall = Math.abs(sx2 - sx1) < Math.abs(sy2 - sy1) * 0.25; // nearly vertical

                // Only consider walls that overlap the zone footprint by at least 30%
                const xOverlap = Math.min(sx2, zMaxX) - Math.max(sx1, zMinX);
                const yOverlap = Math.min(sy2, zMaxY) - Math.max(sy1, zMinY);

                if (isHWall && yOverlap > -tol && xOverlap > (zMaxX - zMinX) * 0.25) {
                    const wallY = (sy1 + sy2) / 2;
                    // Near bottom face of zone
                    if (Math.abs(wallY - zMinY) < tol) wallMinY = Math.max(wallMinY, wallY);
                    // Near top face of zone
                    if (Math.abs(wallY - zMaxY) < tol) wallMaxY = Math.min(wallMaxY, wallY);
                }
                if (isVWall && xOverlap > -tol && yOverlap > (zMaxY - zMinY) * 0.25) {
                    const wallX = (sx1 + sx2) / 2;
                    // Near left face of zone
                    if (Math.abs(wallX - zMinX) < tol) wallMinX = Math.max(wallMinX, wallX);
                    // Near right face of zone
                    if (Math.abs(wallX - zMaxX) < tol) wallMaxX = Math.min(wallMaxX, wallX);
                }
            }
            return { wallMinX, wallMaxX, wallMinY, wallMaxY };
        };

        for (const zone of zones) {
            if (!zone) continue;
            const zMinX = Number(zone.minX), zMaxX = Number(zone.maxX);
            const zMinY = Number(zone.minY), zMaxY = Number(zone.maxY);
            if (![zMinX, zMaxX, zMinY, zMaxY].every(Number.isFinite)) continue;

            const zW = zMaxX - zMinX;
            const zH = zMaxY - zMinY;
            if (zW <= 0 || zH <= 0) continue;

            const orientation = zW >= zH ? 'horizontal' : 'vertical';
            if (!zone.id) zone.id = `zone_${bayCounter}`;

            // Project real wall geometry onto this zone
            const { wallMinX, wallMaxX, wallMinY, wallMaxY } = wallProjectionsForZone(zMinX, zMaxX, zMinY, zMaxY);

            const cw = this.corridorWidth;
            const bd = this.boxDepth;
            const cl = this.wallClearance;

            let leftWallLine, rightWallLine, corridorCenterLine;
            let leftStripFrame = null, corridorFrame = null, rightStripFrame = null;

            if (orientation === 'horizontal') {
                // Wall-anchored: bottom row starts at wallMinY + cl
                const bottomFace = wallMinY;  // real wall Y
                const topFace = wallMaxY;  // real wall Y
                const bottomRowY = bottomFace + cl;
                const corridorY = bottomRowY + bd;
                const topRowY = corridorY + cw;

                leftWallLine = { x1: zMinX, y1: bottomFace, x2: zMaxX, y2: bottomFace };
                rightWallLine = { x1: zMinX, y1: topFace, x2: zMaxX, y2: topFace };
                corridorCenterLine = (topFace - bottomFace >= bd * 2 + cw + cl * 2)
                    ? { x1: zMinX, y1: corridorY + cw / 2, x2: zMaxX, y2: corridorY + cw / 2 }
                    : null;

                const runX0 = zMinX + cl, runX1 = zMaxX - cl;
                if (runX1 - runX0 > 0.5 && topFace - bottomFace >= bd * 2 + cw + cl * 2) {
                    leftStripFrame = { minX: runX0, maxX: runX1, minY: bottomRowY, maxY: bottomRowY + bd };
                    corridorFrame = { minX: runX0, maxX: runX1, minY: corridorY, maxY: corridorY + cw };
                    rightStripFrame = { minX: runX0, maxX: runX1, minY: topRowY, maxY: Math.min(topRowY + bd, topFace) };
                }
            } else {
                // Wall-anchored: left row starts at wallMinX + cl
                const leftFace = wallMinX;
                const rightFace = wallMaxX;
                const leftRowX = leftFace + cl;
                const corridorX = leftRowX + bd;
                const rightRowX = corridorX + cw;

                leftWallLine = { x1: leftFace, y1: zMinY, x2: leftFace, y2: zMaxY };
                rightWallLine = { x1: rightFace, y1: zMinY, x2: rightFace, y2: zMaxY };
                corridorCenterLine = (rightFace - leftFace >= bd * 2 + cw + cl * 2)
                    ? { x1: corridorX + cw / 2, y1: zMinY, x2: corridorX + cw / 2, y2: zMaxY }
                    : null;

                const runY0 = zMinY + cl, runY1 = zMaxY - cl;
                if (runY1 - runY0 > 0.5 && rightFace - leftFace >= bd * 2 + cw + cl * 2) {
                    leftStripFrame = { minX: leftRowX, maxX: leftRowX + bd, minY: runY0, maxY: runY1 };
                    corridorFrame = { minX: corridorX, maxX: corridorX + cw, minY: runY0, maxY: runY1 };
                    rightStripFrame = { minX: rightRowX, maxX: Math.min(rightRowX + bd, rightFace), minY: runY0, maxY: runY1 };
                }
            }

            const bay = {
                id: `bay_${bayCounter}`,
                zoneId: zone.id,
                orientation,
                minX: zMinX, minY: zMinY, maxX: zMaxX, maxY: zMaxY,
                // Real wall geometry anchors
                wallMinX, wallMaxX, wallMinY, wallMaxY,
                leftWallLine, rightWallLine, corridorCenterLine,
                // Strip frame rects derived from wall geometry
                leftStripFrame, corridorFrame, rightStripFrame
            };

            // Register only box-row strip frames as valid gap-fill regions.
            // corridorFrame is intentionally excluded — gap-fill must NEVER place
            // boxes inside corridor bands.
            for (const frame of [leftStripFrame, rightStripFrame]) {
                if (frame) this._validGapFillRegions.push(frame);
            }

            this._bays.push(bay);
            if (!zone._bays) zone._bays = [];
            zone._bays.push(bay);
            bayCounter += 1;
        }

        // Non-bay zones: their full interior is a valid gap-fill region
        // (ensuring open plans with no bays still get gap-fill coverage)
        if (this._bays.length === 0) {
            for (const zone of zones) {
                if (!zone) continue;
                const cl = this.wallClearance;
                const frame = { minX: zone.minX + cl, maxX: zone.maxX - cl, minY: zone.minY + cl, maxY: zone.maxY - cl };
                if (frame.maxX > frame.minX && frame.maxY > frame.minY)
                    this._validGapFillRegions.push(frame);
            }
        }

        console.log(`[CostoProLayout v4] Bay planner: ${this._bays.length} bays from ${zones.length} zones, ${this._validGapFillRegions.length} gap-fill regions`);
        return this._bays;
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

        // Always include both large (open) and small (per-room) zones so empty areas get filled.
        // Large zones cover full-plan open space; small zones add per-room fill. Sort by area (largest first).
        const zones = [...largeZones, ...smallZones];

        zones.sort((a, b) => b.area - a.area);
        console.log(`[CostoProLayout v4] Combined: ${zones.length} zones (${largeZones.length} large + ${smallZones.length} small)`);
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

    /** True if (px, py) lies inside a valid gap-fill region (bay or non-bay zone). No restriction when regions not set. */
    _isPointInValidGapFillRegion(px, py) {
        if (!this._validGapFillRegions || this._validGapFillRegions.length === 0) return true;
        const inset = 0.02;
        for (const r of this._validGapFillRegions) {
            if (px >= r.minX + inset && px <= r.maxX - inset && py >= r.minY + inset && py <= r.maxY - inset)
                return true;
        }
        return false;
    }

    /** Snap value to placement grid so all boxes align in a straight manner (no disordered placement). */
    _snapToPlacementGrid(v) {
        const g = this.placementGridStep;
        return Math.round(v / g) * g;
    }

    /** Snap Y to row alignment step so boxes in the same horizontal band share the same Y (clear rows, no disordered stacks). */
    _snapToRowAlignment(y) {
        const step = this.rowAlignmentStep;
        return Math.round(y / step) * step;
    }

    _boxHitsWall(bx, by, bw, bh, clearanceOverride) {
        const cl = clearanceOverride !== undefined ? clearanceOverride : this.wallClearance;
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
            const entrancePad = Math.max(0.24, this.corridorWidth * 0.26);
            for (const r of this.entranceRects)
                if (
                    bx < (r.x + r.w + entrancePad) &&
                    (bx + bw) > (r.x - entrancePad) &&
                    by < (r.y + r.h + entrancePad) &&
                    (by + bh) > (r.y - entrancePad)
                ) return true;
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
        if (!this._isRectInFreeGrid(bx, by, bw, bh)) return false;
        if (this._boxHitsWall(bx, by, bw, bh)) return false;
        if (this._boxHitsObstacle(bx, by, bw, bh)) return false;
        return true;
    }

    /** Distance from box center to nearest point on any wall; return { dist, nearestX, nearestY }. */
    _distanceBoxToNearestWall(bx, by, bw, bh) {
        const cx = bx + bw / 2;
        const cy = by + bh / 2;
        let best = { dist: Infinity, nearestX: cx, nearestY: cy };
        for (const seg of this.wallSegments) {
            const dx = seg.x2 - seg.x1;
            const dy = seg.y2 - seg.y1;
            const len2 = dx * dx + dy * dy || 1e-20;
            let t = ((cx - seg.x1) * dx + (cy - seg.y1) * dy) / len2;
            t = Math.max(0, Math.min(1, t));
            const px = seg.x1 + t * dx;
            const py = seg.y1 + t * dy;
            const d = Math.hypot(cx - px, cy - py);
            if (d < best.dist) best = { dist: d, nearestX: px, nearestY: py };
        }
        return best;
    }

    /** Nudge unit toward nearest wall (flush to wall) so boxes effectively start from walls, keeping a small clearance. */
    _nudgeUnitTowardWall(unit, otherUnits, corridors, clearance = 0.02) {
        const { dist, nearestX, nearestY } = this._distanceBoxToNearestWall(unit.x, unit.y, unit.width, unit.height);
        // Fine-tuning only: nudge when gap is small (2–12cm). Skip if already flush or too far.
        if (dist <= clearance + 0.005 || dist > 0.12) return null;
        const cx = unit.x + unit.width / 2;
        const cy = unit.y + unit.height / 2;
        // Cap nudge for fine-tuning only (strip placement is primary; nudge is secondary).
        const nudgeMax = Math.min(dist - clearance, 0.08);
        if (nudgeMax <= 0) return null;
        const dx = (nearestX - cx) / dist * nudgeMax;
        const dy = (nearestY - cy) / dist * nudgeMax;
        const newBx = this._snapToPlacementGrid(unit.x + dx);
        const newBy = this._snapToRowAlignment(unit.y + dy);
        const b = this.bounds;
        if (newBx < b.minX + clearance || newBy < b.minY + clearance) return null;
        if (newBx + unit.width > b.maxX - clearance || newBy + unit.height > b.maxY - clearance) return null;
        if (this._boxHitsWall(newBx, newBy, unit.width, unit.height, clearance)) return null;
        if (this._boxHitsObstacle(newBx, newBy, unit.width, unit.height)) return null;
        const corridorGuard = 0.02;
        for (const c of corridors) {
            if (!c || !Number.isFinite(c.x)) continue;
            const inner = { x: c.x + corridorGuard, y: c.y + corridorGuard, width: Math.max(0, c.width - corridorGuard * 2), height: Math.max(0, c.height - corridorGuard * 2) };
            if (this._rectsOverlap({ x: newBx, y: newBy, width: unit.width, height: unit.height }, inner, 0)) return null;
        }
        for (const u of otherUnits) {
            if (u === unit) continue;
            if (this._rectsOverlap({ x: newBx, y: newBy, width: unit.width, height: unit.height }, u, 0.02)) return null;
        }
        return { x: newBx, y: newBy };
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

    /**
     * True if corridor a's bounding box overlaps corridor b's (by any amount).
     * Used to replace zone/spine corridors with facing-row corridors in the same region.
     */
    _corridorOverlapsCorridor(a, b) {
        if (!a || !b) return false;
        const ax2 = a.x + (a.width || 0);
        const ay2 = a.y + (a.height || 0);
        const bx2 = b.x + (b.width || 0);
        const by2 = b.y + (b.height || 0);
        return a.x < bx2 && ax2 > b.x && a.y < by2 && ay2 > b.y;
    }

    /**
     * Generate one corridor per facing row pair from placed units.
     * Corridors are the strip between two parallel facing rows (primary source for between-rows space).
     */
    _generateCorridorsFromFacingRows(units) {
        if (!Array.isArray(units) || units.length < 2) return [];

        const ilots = units
            .map((u, i) => ({
                id: u.id || `u${i}`,
                x: Number(u.x),
                y: Number(u.y),
                width: Number(u.width),
                height: Number(u.height)
            }))
            .filter((u) => [u.x, u.y, u.width, u.height].every(Number.isFinite) && u.width > 0 && u.height > 0);

        const detector = new FacingRowDetector(ilots, {
            rowTolerance: 3.0,
            minRowDistance: Math.max(0.8, this.corridorWidth * 0.8),
            maxRowDistance: 12.0,
            minOverlap: 0.5
        });

        const detected = detector.detectFacingRows();
        const rows = Array.isArray(detected.rows) ? detected.rows : [];

        const clampInterval = (s, e, min, max) => [Math.max(min, s), Math.min(max, e)];
        const mergeIntervals = (intervals) => {
            const sorted = intervals
                .map(([a, b]) => [Math.min(a, b), Math.max(a, b)])
                .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
                .sort((a, b) => a[0] - b[0]);
            const merged = [];
            for (const [a, b] of sorted) {
                const last = merged[merged.length - 1];
                if (!last || a > last[1]) merged.push([a, b]);
                else last[1] = Math.max(last[1], b);
            }
            return merged;
        };
        const subtractIntervals = (base, blocks) => {
            const [b0, b1] = base;
            const mergedBlocks = mergeIntervals(blocks.map((blk) => clampInterval(blk[0], blk[1], b0, b1)));
            const out = [];
            let cur = b0;
            for (const [s, e] of mergedBlocks) {
                if (s > cur) out.push([cur, s]);
                cur = Math.max(cur, e);
            }
            if (cur < b1) out.push([cur, b1]);
            return out;
        };

        const corridors = [];
        const corridorH = this.corridorWidth;
        const bandGuard = Math.max(0.01, Math.min(0.08, this.corridorGapClearance || 0.03));

        // Architectural rule: only consider adjacent rows (reduces noisy overlapping corridors).
        for (let i = 0; i < rows.length - 1; i++) {
            const rowA = rows[i];
            const rowB = rows[i + 1];
            const relationship = detector.analyzeRowRelationship(rowA, rowB);
            if (!relationship.isFacing) continue;

            const gapMinY = relationship.corridorPosition.minY;
            const gapMaxY = relationship.corridorPosition.maxY;
            const gapH = gapMaxY - gapMinY;
            if (!Number.isFinite(gapH) || gapH < Math.max(0.6, corridorH * 0.6)) continue;

            const h = Math.min(corridorH, gapH);
            const y = gapMinY + (gapH - h) / 2;

            const x0 = relationship.overlapStart;
            const x1 = relationship.overlapEnd;
            if (![x0, x1].every(Number.isFinite) || x1 - x0 < this.minGapLength) continue;

            // Block out any unit that intrudes into the corridor band (true architectural rule: corridor is clear).
            const blocks = [];
            for (const u of ilots) {
                const uy1 = u.y;
                const uy2 = u.y + u.height;
                const overlapsY = (y + h) > uy1 + bandGuard && y < uy2 - bandGuard;
                if (!overlapsY) continue;
                blocks.push([u.x - bandGuard, u.x + u.width + bandGuard]);
            }

            const free = subtractIntervals([x0, x1], blocks);
            const corridorId = `facing_${i}_${i + 1}`;
            for (const [fx0, fx1] of free) {
                const w = fx1 - fx0;
                if (w < this.minGapLength) continue;
                const rect = {
                    x: fx0,
                    y,
                    width: w,
                    height: h,
                    direction: 'horizontal',
                    type: 'between_facing_rows',
                    corridorId,
                    connectsRows: [i, i + 1]
                };
                // Only check forbidden zones, NOT walls — since these corridors
                // sit between already-placed box rows, wall-crossing is irrelevant.
                const hitsForbidden = this.forbiddenZones.some(fz => {
                    const fx = Number(fz.x || fz.minX || 0), fy = Number(fz.y || fz.minY || 0);
                    const fw = Number(fz.width || (fz.maxX - fz.minX) || 0);
                    const fh = Number(fz.height || (fz.maxY - fz.minY) || 0);
                    return rect.x < fx + fw && rect.x + rect.width > fx &&
                        rect.y < fy + fh && rect.y + rect.height > fy;
                });
                if (hitsForbidden) continue;
                corridors.push(rect);
            }
        }

        if (corridors.length > 0) {
            console.log(`[CostoProLayout v4] Facing-row corridors: ${corridors.length} (primary between rows)`);
        }
        return corridors;
    }

    /**
     * Link disconnected corridor components by inserting perpendicular connector corridors.
     * Runs BFS to find connected components, then inserts the shortest perpendicular
     * connector between the two closest corridors from different components.
     * Repeats until only one component remains or no connector can be found.
     */
    _linkDisconnectedCorridors(corridors, units) {
        if (!Array.isArray(corridors) || corridors.length < 2) return corridors;

        const tol = 0.5;
        const cw = this.corridorWidth;
        const result = corridors.slice();

        // Helper: check if two corridor rects touch/overlap
        const touches = (a, b) => {
            const xOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
            const yOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
            return (xOverlap > -tol && yOverlap > -tol);
        };

        // Helper: find connected components via BFS
        const findComponents = (list) => {
            const adj = list.map(() => []);
            for (let i = 0; i < list.length; i++) {
                for (let j = i + 1; j < list.length; j++) {
                    if (touches(list[i], list[j])) { adj[i].push(j); adj[j].push(i); }
                }
            }
            const visited = new Set();
            const comps = [];
            for (let s = 0; s < list.length; s++) {
                if (visited.has(s)) continue;
                const q = [s]; visited.add(s);
                const indices = [];
                while (q.length) { const i = q.shift(); indices.push(i); for (const j of adj[i]) { if (!visited.has(j)) { visited.add(j); q.push(j); } } }
                comps.push(indices);
            }
            return comps;
        };

        // Helper: does a rect overlap any unit?
        const hitsUnit = (rx, ry, rw, rh) => {
            const buf = 0.02;
            for (const u of (units || [])) {
                if (rx < u.x + u.width - buf && rx + rw > u.x + buf &&
                    ry < u.y + u.height - buf && ry + rh > u.y + buf) return true;
            }
            return false;
        };

        let maxIterations = 20;
        while (maxIterations-- > 0) {
            const comps = findComponents(result);
            if (comps.length <= 1) break;

            // Find closest corridor pair across different components
            let bestDist = Infinity, bestA = -1, bestB = -1;
            for (let ci = 0; ci < comps.length; ci++) {
                for (let cj = ci + 1; cj < comps.length; cj++) {
                    for (const ai of comps[ci]) {
                        for (const bi of comps[cj]) {
                            const a = result[ai], b = result[bi];
                            const aCx = a.x + a.width / 2, aCy = a.y + a.height / 2;
                            const bCx = b.x + b.width / 2, bCy = b.y + b.height / 2;
                            const d = Math.hypot(aCx - bCx, aCy - bCy);
                            if (d < bestDist) { bestDist = d; bestA = ai; bestB = bi; }
                        }
                    }
                }
            }

            if (bestA < 0) break;

            const a = result[bestA], b = result[bestB];
            const aCx = a.x + a.width / 2, aCy = a.y + a.height / 2;
            const bCx = b.x + b.width / 2, bCy = b.y + b.height / 2;

            // Insert a connector between them:
            // - If they share X overlap → vertical connector
            // - If they share Y overlap → horizontal connector
            // - Otherwise → L-shaped connector (two segments)
            const xOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
            const yOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);

            let connectors = [];

            if (xOverlap > cw * 0.5) {
                // Vertical connector at the shared X band
                const cx = Math.max(a.x, b.x) + Math.max(0, xOverlap - cw) / 2;
                const cy = Math.min(aCy, bCy);
                const ch = Math.abs(bCy - aCy);
                connectors.push({ x: cx, y: cy, width: Math.min(cw, xOverlap), height: ch, direction: 'vertical', type: 'connector' });
            } else if (yOverlap > cw * 0.5) {
                // Horizontal connector at the shared Y band
                const cy = Math.max(a.y, b.y) + Math.max(0, yOverlap - cw) / 2;
                const cx = Math.min(aCx, bCx);
                const cw2 = Math.abs(bCx - aCx);
                connectors.push({ x: cx, y: cy, width: cw2, height: Math.min(cw, yOverlap), direction: 'horizontal', type: 'connector' });
            } else {
                // L-shaped: horizontal stub from A center to B.x, then vertical to B center
                const hx = Math.min(aCx, bCx);
                const hw = Math.abs(bCx - aCx) + cw;
                connectors.push({ x: hx, y: aCy, width: hw, height: cw, direction: 'horizontal', type: 'connector' });
                const vy = Math.min(aCy, bCy);
                const vh = Math.abs(bCy - aCy) + cw;
                connectors.push({ x: bCx, y: vy, width: cw, height: vh, direction: 'vertical', type: 'connector' });
            }

            let added = 0;
            for (const conn of connectors) {
                if (!hitsUnit(conn.x, conn.y, conn.width, conn.height)) {
                    result.push(conn);
                    added++;
                } else {
                    // Try narrow version
                    const narrow = { ...conn };
                    if (conn.direction === 'horizontal') {
                        narrow.height = cw * 0.8;
                        narrow.y = conn.y + (conn.height - narrow.height) / 2;
                    } else {
                        narrow.width = cw * 0.8;
                        narrow.x = conn.x + (conn.width - narrow.width) / 2;
                    }
                    if (!hitsUnit(narrow.x, narrow.y, narrow.width, narrow.height)) {
                        result.push(narrow);
                        added++;
                    }
                }
            }

            if (added === 0) {
                // Force-add connector even if it overlaps units (connectivity > density)
                for (const conn of connectors) result.push(conn);
                console.log(`[CostoProLayout v4] Connector forced (overlaps units) to ensure connectivity`);
            }
        }

        const comps = findComponents(result);
        console.log(`[CostoProLayout v4] Linked corridors: ${result.length} total, ${comps.length} component(s)`);
        return result;
    }

    _normalizeCorridorRect(corridor) {
        if (!corridor) return null;
        const x = Number(corridor.x);
        const y = Number(corridor.y);
        const w = Number(corridor.width);
        const h = Number(corridor.height);
        if (![x, y, w, h].every(Number.isFinite)) return null;
        if (w <= 0 || h <= 0) return null;
        return {
            ...corridor,
            x,
            y,
            width: w,
            height: h,
            direction: corridor.direction || (w >= h ? 'horizontal' : 'vertical')
        };
    }

    _splitCorridorByStructuralWalls(corridor) {
        const c = this._normalizeCorridorRect(corridor);
        if (!c) return [];

        const horizontal = c.direction === 'horizontal' || c.width >= c.height;
        const lineCoord = horizontal ? (c.y + c.height / 2) : (c.x + c.width / 2);
        const axisStart = horizontal ? c.x : c.y;
        const axisEnd = horizontal ? (c.x + c.width) : (c.y + c.height);
        const tol = Math.max(0.02, this.wallClearance * 0.45);
        const minSeg = Math.max(this.minGapLength, this.corridorWidth * 0.75);

        const blockers = [];
        for (const seg of this.wallSegments) {
            if (!seg) continue;
            const x1 = Number(seg.x1);
            const y1 = Number(seg.y1);
            const x2 = Number(seg.x2);
            const y2 = Number(seg.y2);
            if (![x1, y1, x2, y2].every(Number.isFinite)) continue;

            if (horizontal) {
                const sMinY = Math.min(y1, y2) - tol;
                const sMaxY = Math.max(y1, y2) + tol;
                if (lineCoord < sMinY || lineCoord > sMaxY) continue;

                if (Math.abs(y2 - y1) < 1e-8) {
                    if (Math.abs(y1 - lineCoord) > tol) continue;
                    blockers.push({ start: Math.min(x1, x2) - tol, end: Math.max(x1, x2) + tol });
                    continue;
                }

                const t = (lineCoord - y1) / (y2 - y1);
                if (t < -1e-6 || t > 1 + 1e-6) continue;
                const xHit = x1 + (x2 - x1) * t;
                blockers.push({ start: xHit - tol, end: xHit + tol });
                continue;
            }

            const sMinX = Math.min(x1, x2) - tol;
            const sMaxX = Math.max(x1, x2) + tol;
            if (lineCoord < sMinX || lineCoord > sMaxX) continue;

            if (Math.abs(x2 - x1) < 1e-8) {
                if (Math.abs(x1 - lineCoord) > tol) continue;
                blockers.push({ start: Math.min(y1, y2) - tol, end: Math.max(y1, y2) + tol });
                continue;
            }

            const t = (lineCoord - x1) / (x2 - x1);
            if (t < -1e-6 || t > 1 + 1e-6) continue;
            const yHit = y1 + (y2 - y1) * t;
            blockers.push({ start: yHit - tol, end: yHit + tol });
        }

        if (blockers.length === 0) {
            return [c];
        }

        blockers.sort((a, b) => a.start - b.start);
        const merged = [];
        for (const blk of blockers) {
            const s = Math.max(axisStart, Math.min(axisEnd, blk.start));
            const e = Math.max(axisStart, Math.min(axisEnd, blk.end));
            if (e <= s) continue;
            if (!merged.length || s > merged[merged.length - 1].end + 1e-6) {
                merged.push({ start: s, end: e });
            } else {
                merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, e);
            }
        }

        if (merged.length === 0) {
            return [c];
        }

        const segments = [];
        let cursor = axisStart;
        for (const blk of merged) {
            if (blk.start - cursor >= minSeg) {
                if (horizontal) {
                    segments.push({
                        ...c,
                        x: cursor,
                        y: c.y,
                        width: blk.start - cursor,
                        height: c.height,
                        direction: 'horizontal'
                    });
                } else {
                    segments.push({
                        ...c,
                        x: c.x,
                        y: cursor,
                        width: c.width,
                        height: blk.start - cursor,
                        direction: 'vertical'
                    });
                }
            }
            cursor = Math.max(cursor, blk.end);
        }

        if (axisEnd - cursor >= minSeg) {
            if (horizontal) {
                segments.push({
                    ...c,
                    x: cursor,
                    y: c.y,
                    width: axisEnd - cursor,
                    height: c.height,
                    direction: 'horizontal'
                });
            } else {
                segments.push({
                    ...c,
                    x: c.x,
                    y: cursor,
                    width: c.width,
                    height: axisEnd - cursor,
                    direction: 'vertical'
                });
            }
        }

        return segments;
    }

    _corridorLength(corridor) {
        if (!corridor) return 0;
        const w = Number(corridor.width) || 0;
        const h = Number(corridor.height) || 0;
        return Math.max(w, h);
    }

    _corridorCenterline(corridor) {
        if (!corridor || ![corridor.x, corridor.y, corridor.width, corridor.height].every(Number.isFinite)) return null;
        const x = Number(corridor.x);
        const y = Number(corridor.y);
        const w = Number(corridor.width);
        const h = Number(corridor.height);
        if (w <= 0 || h <= 0) return null;
        const horizontal = corridor.direction === 'horizontal' || w >= h;
        if (horizontal) {
            const cy = y + h / 2;
            return { a: { x, y: cy }, b: { x: x + w, y: cy } };
        }
        const cx = x + w / 2;
        return { a: { x: cx, y }, b: { x: cx, y: y + h } };
    }

    _corridorTouchesEntrance(corridor) {
        if (!corridor || !this.entranceRects || this.entranceRects.length === 0) return false;
        const seg = this._corridorCenterline(corridor);
        if (!seg) return false;

        for (const r of this.entranceRects) {
            if (!r) continue;
            const rectOverlap =
                corridor.x < r.x + r.w &&
                corridor.x + corridor.width > r.x &&
                corridor.y < r.y + r.h &&
                corridor.y + corridor.height > r.y;
            if (rectOverlap) return true;

            if (this._segIntersectsRect(seg.a.x, seg.a.y, seg.b.x, seg.b.y, r.x, r.y, r.x + r.w, r.y + r.h)) {
                return true;
            }
        }
        return false;
    }

    _corridorSegmentsConnected(a, b) {
        const segA = this._corridorCenterline(a);
        const segB = this._corridorCenterline(b);
        if (!segA || !segB) return false;

        // Fast path: clearly overlapping corridor rectangles.
        const rectOverlap =
            a.x < b.x + b.width &&
            a.x + a.width > b.x &&
            a.y < b.y + b.height &&
            a.y + a.height > b.y;
        if (rectOverlap) return true;

        const tol = Math.max(0.08, this.corridorWidth * 0.10);
        const near = (p, seg) =>
            this._pointToSegDist(p.x, p.y, seg.a.x, seg.a.y, seg.b.x, seg.b.y) <= tol;

        return (
            near(segA.a, segB) ||
            near(segA.b, segB) ||
            near(segB.a, segA) ||
            near(segB.b, segA)
        );
    }

    _filterCorridorsByReachability(corridors) {
        if (!Array.isArray(corridors) || corridors.length <= 1) {
            return Array.isArray(corridors) ? corridors : [];
        }

        if (this.retainDisconnectedCorridors) {
            return corridors.slice();
        }

        const n = corridors.length;
        const adj = Array.from({ length: n }, () => []);
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                if (this._corridorSegmentsConnected(corridors[i], corridors[j])) {
                    adj[i].push(j);
                    adj[j].push(i);
                }
            }
        }

        const seeds = new Set();
        for (let i = 0; i < n; i++) {
            if (this._corridorTouchesEntrance(corridors[i])) seeds.add(i);
        }
        const components = [];
        const seen = new Set();
        for (let i = 0; i < n; i++) {
            if (seen.has(i)) continue;
            const queue = [i];
            seen.add(i);
            const indices = [];
            while (queue.length > 0) {
                const cur = queue.shift();
                indices.push(cur);
                for (const nxt of adj[cur]) {
                    if (seen.has(nxt)) continue;
                    seen.add(nxt);
                    queue.push(nxt);
                }
            }
            const totalLength = indices.reduce((sum, idx) => sum + this._corridorLength(corridors[idx]), 0);
            const hasSeed = indices.some((idx) => seeds.has(idx));
            components.push({ indices, totalLength, hasSeed });
        }

        components.sort((a, b) => b.totalLength - a.totalLength);
        const keep = new Set();
        const minLen = this.corridorComponentMinLength;
        const seededExists = components.some((c) => c.hasSeed);

        if (seededExists) {
            for (const comp of components) {
                if (comp.hasSeed || comp.totalLength >= minLen) {
                    for (const idx of comp.indices) keep.add(idx);
                }
            }
        } else {
            for (const comp of components) {
                if (comp.totalLength >= minLen || comp.indices.length > 1) {
                    for (const idx of comp.indices) keep.add(idx);
                }
            }
            if (keep.size === 0 && components.length > 0) {
                for (const idx of components[0].indices) keep.add(idx);
            }
        }

        return corridors.filter((_, idx) => keep.has(idx));
    }

    _sanitizeFinalLayout(units, corridors) {
        const candidateCorridors = [];
        for (const corridor of (corridors || [])) {
            const split = this._splitCorridorByStructuralWalls(corridor);
            for (const part of split) {
                if (!part || ![part.x, part.y, part.width, part.height].every(Number.isFinite)) continue;
                if (part.width < 0.05 || part.height < 0.05) continue;
                if (part.x < this.bounds.minX || part.y < this.bounds.minY) continue;
                if (part.x + part.width > this.bounds.maxX || part.y + part.height > this.bounds.maxY) continue;
                if (this.layoutMode === 'wallHugging') {
                    if (!this._isRectInsideOuterPerimeter(part, Math.max(0.04, this.wallClearance * 0.4))) continue;
                }
                if (this._corridorCrossesStructuralWall(part)) continue;
                if (this._boxHitsObstacle(part.x, part.y, part.width, part.height, { ignoreEntrances: true })) continue;
                const overlapsCorridor = candidateCorridors.some((c) => this._corridorsConflict(part, c));
                if (overlapsCorridor) continue;
                candidateCorridors.push(part);
            }
        }

        const safeCorridors = this._filterCorridorsByReachability(candidateCorridors);
        const corridorGuard = Math.max(0.03, Math.min(0.22, this.corridorWidth * 0.18));

        const safeUnits = [];
        const unitUnitInset = 0.02;   // No collision: require 2cm gap between boxes
        const unitCorridorInset = 0.02;  // No collision: require 2cm gap between box and corridor
        for (const unit of (units || [])) {
            if (!unit || ![unit.x, unit.y, unit.width, unit.height].every(Number.isFinite)) continue;
            if (!this._isBoxValid(unit.x, unit.y, unit.width, unit.height)) continue;
            const overlapsExisting = safeUnits.some((u) => this._rectsOverlap(unit, u, unitUnitInset));
            if (overlapsExisting) continue;

            const overlapsCorridor = safeCorridors.some((c) => {
                const innerX = c.x + corridorGuard;
                const innerY = c.y + corridorGuard;
                const innerW = Math.max(0, c.width - corridorGuard * 2);
                const innerH = Math.max(0, c.height - corridorGuard * 2);
                if (innerW <= 0 || innerH <= 0) {
                    return this._rectsOverlap(unit, c, unitCorridorInset);
                }
                return this._rectsOverlap(
                    unit,
                    { x: innerX, y: innerY, width: innerW, height: innerH },
                    unitCorridorInset
                );
            });
            if (overlapsCorridor) continue;

            safeUnits.push(unit);
        }

        return {
            units: safeUnits,
            corridors: safeCorridors,
            removedUnits: Math.max(0, (units || []).length - safeUnits.length),
            removedCorridors: Math.max(0, (corridors || []).length - safeCorridors.length)
        };
    }

    _fillResidualGaps(units, corridors, options = {}) {
        const sourceUnits = Array.isArray(units) ? units : [];
        if (!this.maximizeFill || sourceUnits.length === 0) {
            return { units: sourceUnits, added: 0 };
        }

        const targetCount = Number.isFinite(Number(options.targetCount))
            ? Math.max(1, Math.floor(Number(options.targetCount)))
            : Infinity;
        if (sourceUnits.length >= targetCount) {
            return { units: sourceUnits, added: 0 };
        }

        const denseUnits = sourceUnits.slice();
        const occupied = denseUnits.map((u) => ({
            x: Number(u.x),
            y: Number(u.y),
            w: Number(u.width),
            h: Number(u.height)
        })).filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y) && r.w > 0 && r.h > 0);

        const corridorGuard = Math.max(0.02, Math.min(0.18, this.corridorWidth * 0.14));
        const corridorRects = (Array.isArray(corridors) ? corridors : [])
            .map((c) => ({
                x: Number(c?.x) + corridorGuard,
                y: Number(c?.y) + corridorGuard,
                width: Math.max(0, Number(c?.width) - corridorGuard * 2),
                height: Math.max(0, Number(c?.height) - corridorGuard * 2)
            }))
            .filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y) && r.width > 0 && r.height > 0);

        const overlapWithOccupied = (rect, inset = 0.02) => {
            for (const r of occupied) {
                if (
                    rect.x < r.x + r.w - inset &&
                    rect.x + rect.width > r.x + inset &&
                    rect.y < r.y + r.h - inset &&
                    rect.y + rect.height > r.y + inset
                ) {
                    return true;
                }
            }
            return false;
        };

        const overlapWithCorridors = (rect, inset = 0.02) => {
            for (const c of corridorRects) {
                if (this._rectsOverlap(rect, c, inset)) return true;
            }
            return false;
        };

        const b = this.bounds;
        const cl = this.wallClearance;
        const edgeClearance = Math.max(0.05, cl * 0.5);
        const depth = this.boxDepth;
        const minWidth = 0.80;
        const scanStep = Math.max(0.10, Math.min(0.22, depth * 0.06));
        const sizeCatalog = [
            { type: 'XL', width: 3.49 },
            { type: 'XL', width: 3.29 },
            { type: 'L', width: 2.49 },
            { type: 'L', width: 2.29 },
            { type: 'M', width: 1.59 },
            { type: 'M', width: 1.49 },
            { type: 'S', width: 1.39 },
            { type: 'S', width: 1.29 },
            { type: 'S', width: 1.00 },
            { type: 'S', width: 0.90 },
            { type: 'S', width: 0.80 }
        ];

        const isGapFillValid = (x, y, w, h) => {
            if (x < b.minX + edgeClearance || y < b.minY + edgeClearance) return false;
            if (x + w > b.maxX - edgeClearance || y + h > b.maxY - edgeClearance) return false;
            if (!this._isRectInsideOuterPerimeter({ x, y, width: w, height: h }, 0.03)) return false;
            if (!this._isRectInFreeGrid(x, y, w, h)) return false;
            if (this._boxHitsWall(x, y, w, h)) return false;
            if (this._boxHitsObstacle(x, y, w, h)) return false;
            return true;
        };

        let added = 0;
        for (let y = b.minY + edgeClearance; y + Math.min(depth, minWidth) <= b.maxY - edgeClearance + 1e-6; y += scanStep) {
            if (denseUnits.length >= targetCount) break;
            for (let x = b.minX + edgeClearance; x + minWidth <= b.maxX - edgeClearance + 1e-6; x += scanStep) {
                if (denseUnits.length >= targetCount) break;

                const sx = this._snapToPlacementGrid(x);
                const sy = this._snapToRowAlignment(y);
                if (!this._isPointInValidGapFillRegion(sx, sy)) continue;
                const probe = { x: sx, y: sy, width: minWidth, height: Math.min(depth, minWidth) };
                if (overlapWithOccupied(probe)) continue;
                if (overlapWithCorridors(probe)) continue;

                let placed = false;
                for (const size of sizeCatalog) {
                    if (placed) break;
                    for (const rotated of [false, true]) {
                        const bw = rotated ? depth : size.width;
                        const bh = rotated ? size.width : depth;
                        if (sx + bw > b.maxX - edgeClearance || sy + bh > b.maxY - edgeClearance) continue;

                        const rect = { x: sx, y: sy, width: bw, height: bh };
                        if (overlapWithOccupied(rect)) continue;
                        if (overlapWithCorridors(rect)) continue;
                        if (!isGapFillValid(sx, sy, bw, bh)) continue;

                        const unit = this._makeUnit(
                            denseUnits.length + 1,
                            sx,
                            sy,
                            bw,
                            bh,
                            { type: size.type, width: size.width, area: bw * bh },
                            'single',
                            rotated
                        );
                        denseUnits.push(unit);
                        occupied.push({ x: sx, y: sy, w: bw, h: bh });
                        added += 1;
                        placed = true;

                        // Skip ahead once a unit is placed to reduce redundant probes.
                        x += Math.max(scanStep, bw - scanStep * 0.2);
                        break;
                    }
                }
            }
        }

        return { units: denseUnits, added };
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
        const targetCount = Number.isFinite(Number(config.targetCount))
            ? Math.max(1, Math.floor(Number(config.targetCount)))
            : null;

        // Diagnostics
        let freeCells = 0;
        for (let r = 0; r < this.gridRows; r++)
            for (let c = 0; c < this.gridCols; c++)
                if (!this.grid[r][c]) freeCells++;
        const totalCells = this.gridRows * this.gridCols;
        console.log(`[CostoProLayout v4] Grid ${this.gridCols}×${this.gridRows}, free: ${freeCells}/${totalCells} (${(freeCells / totalCells * 100).toFixed(1)}%)`);
        console.log(`[CostoProLayout v4] corridorWidth=${this.corridorWidth} boxDepth=${this.boxDepth} wallClearance=${this.wallClearance}`);

        if (this.layoutMode === 'wallHugging') {
            return this._generateWallHuggingLayout({ distribution, targetCount });
        }

        // Step 1: Get zones — always prefer door-closed flood-fill (accurate free space)
        // Room bounding boxes overlap internal walls, flood-fill respects wall geometry
        const floodZones = this._findZones();
        const roomZones = floodZones.length >= 2 ? [] : this._zonesFromRooms(); // fallback only
        console.log(`[CostoProLayout v4] floodZones=${floodZones.length}, roomZones=${roomZones.length}`);
        const zones = floodZones.length >= 1 ? floodZones : roomZones;
        console.log(`[CostoProLayout v4] Using ${zones.length} zones (from ${zones === floodZones ? 'door-closed-flood' : 'rooms'})`);

        // Detect high-level bays (corridor + rows regions) once for all zones.
        const bays = this._detectBays(zones);
        this._baysByZoneId = new Map();
        for (const bay of bays) {
            if (!bay || !bay.zoneId) continue;
            if (!this._baysByZoneId.has(bay.zoneId)) {
                this._baysByZoneId.set(bay.zoneId, []);
            }
            this._baysByZoneId.get(bay.zoneId).push(bay);
        }

        // Valid gap-fill regions: bay bounds + zones without bays (no stray singles outside strip frames)
        this._validGapFillRegions = [];
        for (const bay of bays) {
            if (bay && Number.isFinite(bay.minX))
                this._validGapFillRegions.push({ minX: bay.minX, minY: bay.minY, maxX: bay.maxX, maxY: bay.maxY });
        }
        for (const zone of zones) {
            if (zone._bays && zone._bays.length > 0) continue;
            if (zone && Number.isFinite(zone.minX))
                this._validGapFillRegions.push({ minX: zone.minX, minY: zone.minY, maxX: zone.maxX, maxY: zone.maxY });
        }
        if (this._validGapFillRegions.length === 0) {
            this._validGapFillRegions = [{ minX: this.bounds.minX, minY: this.bounds.minY, maxX: this.bounds.maxX, maxY: this.bounds.maxY }];
        }
        console.log(`[CostoProLayout v4] Valid gap-fill regions: ${this._validGapFillRegions.length}`);

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

        // Step 2b: Gap-filling pass — place boxes in empty space; corridors in occupied so corridor space is preserved
        {
            const gapFillBefore = units.length;
            const bd = this.boxDepth;
            const sp = this.boxSpacing;
            const b = this.bounds;
            const cl = this.wallClearance;
            const gapFillCl = Math.max(0.05, cl * 0.5);  // Safe clearance; corridor space kept via occupied
            const overlapInsetGap = 0.02;  // Require small gap so sanitize won't remove (unit-unit 0.01, unit-corridor 0.002)

            // Build spatial index: units + corridors (never place on corridor space) + forbidden
            const occupied = units.map(u => ({ x: u.x, y: u.y, w: u.width, h: u.height }));
            for (const c of corridors) {
                if (Number.isFinite(c.x) && Number.isFinite(c.width))
                    occupied.push({ x: c.x, y: c.y, w: c.width, h: c.height });
            }
            for (const fz of this.forbiddenZones) {
                const r = this._getRect(fz);
                if (r) occupied.push(r);
            }

            const overlapsAny = (bx, by, bw, bh, inset = overlapInsetGap) => {
                const ax1 = bx + inset, ay1 = by + inset, ax2 = bx + bw - inset, ay2 = by + bh - inset;
                if (ax2 <= ax1 || ay2 <= ay1) return true;
                for (const r of occupied) {
                    const bx1 = r.x + inset, by1 = r.y + inset, bx2 = r.x + r.w - inset, by2 = r.y + r.h - inset;
                    if (bx2 <= bx1 || by2 <= by1) continue;
                    if (ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1) return true;
                }
                return false;
            };

            const boxSizes = [
                { type: 'L', width: 2.29 },
                { type: 'M', width: 1.59 },
                { type: 'M', width: 1.49 },
                { type: 'S', width: 1.39 },
                { type: 'S', width: 1.29 },
                { type: 'S', width: 1.00 },
                { type: 'S', width: 0.90 },
                { type: 'S', width: 0.80 },
            ];

            const step = 0.3;  // Finer step to fill more gaps
            let diagOverlap = 0, diagWall = 0, diagObstacle = 0, diagBounds = 0, diagPlaced = 0;

            for (let scanY = b.minY + gapFillCl; scanY + bd <= b.maxY - gapFillCl; scanY += step) {
                for (let scanX = b.minX + gapFillCl; scanX + 1.0 <= b.maxX - gapFillCl; scanX += step) {
                    const sx = this._snapToPlacementGrid(scanX);
                    const sy = this._snapToRowAlignment(scanY);
                    if (!this._isPointInValidGapFillRegion(sx, sy)) continue;
                    if (overlapsAny(sx, sy, 1.0, bd)) { diagOverlap++; continue; }

                    let placed = false;
                    for (const size of boxSizes) {
                        const bw = size.width;
                        const bh = bd;
                        if (sx + bw > b.maxX - gapFillCl) { diagBounds++; continue; }
                        if (!this._isRectInFreeGrid(sx, sy, bw, bh)) { diagWall++; continue; }
                        if (this._boxHitsWall(sx, sy, bw, bh, gapFillCl)) { diagWall++; continue; }
                        if (this._boxHitsObstacle(sx, sy, bw, bh)) { diagObstacle++; continue; }
                        if (overlapsAny(sx, sy, bw, bh)) { diagOverlap++; continue; }

                        const u = this._makeUnit(unitId++, sx, sy, bw, bh,
                            { type: size.type, width: bw, area: bw * bd }, 'single', false);
                        units.push(u);
                        occupied.push({ x: sx, y: sy, w: bw, h: bh });
                        placed = true;
                        diagPlaced++;
                        scanX += bw;
                        break;
                    }

                    if (!placed) {
                        for (const size of boxSizes) {
                            const bw = bd;
                            const bh = size.width;
                            if (sy + bh > b.maxY - gapFillCl) continue;
                            if (sx + bw > b.maxX - gapFillCl) continue;
                            if (this._boxHitsWall(sx, sy, bw, bh, gapFillCl)) { diagWall++; continue; }
                            if (!this._isRectInFreeGrid(sx, sy, bw, bh)) { diagWall++; continue; }
                            if (this._boxHitsObstacle(sx, sy, bw, bh)) { diagObstacle++; continue; }
                            if (overlapsAny(sx, sy, bw, bh)) { diagOverlap++; continue; }

                            const u = this._makeUnit(unitId++, sx, sy, bw, bh,
                                { type: size.type, width: size.width, area: bw * bh }, 'single', true);
                            units.push(u);
                            occupied.push({ x: sx, y: sy, w: bw, h: bh });
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

        // Step 2b-2: Second gap-fill pass — finer step (0.25) to fill remaining empty areas everywhere
        {
            const gapFill2Before = units.length;
            const bd = this.boxDepth;
            const b = this.bounds;
            const gapFillCl2 = Math.max(0.05, this.wallClearance * 0.5);
            const overlapInsetGap2 = 0.02;
            const occupied2 = units.map(u => ({ x: u.x, y: u.y, w: u.width, h: u.height }));
            for (const c of corridors) {
                if (Number.isFinite(c.x) && Number.isFinite(c.width))
                    occupied2.push({ x: c.x, y: c.y, w: c.width, h: c.height });
            }
            for (const fz of this.forbiddenZones) {
                const r = this._getRect(fz);
                if (r) occupied2.push(r);
            }
            const overlapsAny2 = (bx, by, bw, bh, inset = overlapInsetGap2) => {
                const ax1 = bx + inset, ay1 = by + inset, ax2 = bx + bw - inset, ay2 = by + bh - inset;
                if (ax2 <= ax1 || ay2 <= ay1) return true;
                for (const r of occupied2) {
                    const bx1 = r.x + inset, by1 = r.y + inset, bx2 = r.x + r.w - inset, by2 = r.y + r.h - inset;
                    if (bx2 <= bx1 || by2 <= by1) continue;
                    if (ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1) return true;
                }
                return false;
            };
            const boxSizes2 = [
                { type: 'M', width: 1.59 }, { type: 'M', width: 1.49 },
                { type: 'S', width: 1.39 }, { type: 'S', width: 1.29 }, { type: 'S', width: 1.00 }, { type: 'S', width: 0.90 }, { type: 'S', width: 0.80 },
            ];
            const step2 = 0.25;
            let placed2 = 0;
            for (let scanY = b.minY + gapFillCl2; scanY + bd <= b.maxY - gapFillCl2; scanY += step2) {
                for (let scanX = b.minX + gapFillCl2; scanX + 1.0 <= b.maxX - gapFillCl2; scanX += step2) {
                    const sx = this._snapToPlacementGrid(scanX);
                    const sy = this._snapToRowAlignment(scanY);
                    if (!this._isPointInValidGapFillRegion(sx, sy)) continue;
                    if (overlapsAny2(sx, sy, 1.0, bd)) continue;
                    for (const size of boxSizes2) {
                        const bw = size.width;
                        const bh = bd;
                        if (sx + bw > b.maxX - gapFillCl2) continue;
                        if (!this._isRectInFreeGrid(sx, sy, bw, bh)) continue;
                        if (this._boxHitsWall(sx, sy, bw, bh, gapFillCl2)) continue;
                        if (this._boxHitsObstacle(sx, sy, bw, bh)) continue;
                        if (overlapsAny2(sx, sy, bw, bh)) continue;
                        const u = this._makeUnit(unitId++, sx, sy, bw, bh,
                            { type: size.type, width: bw, area: bw * bd }, 'single', false);
                        units.push(u);
                        occupied2.push({ x: sx, y: sy, w: bw, h: bh });
                        placed2++;
                        scanX += bw;
                        break;
                    }
                }
            }
            if (placed2 > 0) console.log(`[CostoProLayout v4] Gap-fill pass 2: +${placed2} boxes (tighter clearance)`);
        }

        // Step 2b-3: Reverse-direction gap-fill — scan from maxX/maxY backwards to catch gaps missed by forward scan
        {
            const gapFillRevBefore = units.length;
            const bd = this.boxDepth;
            const b = this.bounds;
            const revCl = Math.max(0.05, this.wallClearance * 0.5);
            const revInset = 0.02;
            const occupiedRev = units.map(u => ({ x: u.x, y: u.y, w: u.width, h: u.height }));
            for (const c of corridors) {
                if (Number.isFinite(c.x) && Number.isFinite(c.width))
                    occupiedRev.push({ x: c.x, y: c.y, w: c.width, h: c.height });
            }
            for (const fz of this.forbiddenZones) {
                const r = this._getRect(fz);
                if (r) occupiedRev.push(r);
            }
            const overlapsAnyRev = (bx, by, bw, bh, inset = revInset) => {
                const ax1 = bx + inset, ay1 = by + inset, ax2 = bx + bw - inset, ay2 = by + bh - inset;
                if (ax2 <= ax1 || ay2 <= ay1) return true;
                for (const r of occupiedRev) {
                    const bx1 = r.x + inset, by1 = r.y + inset, bx2 = r.x + r.w - inset, by2 = r.y + r.h - inset;
                    if (bx2 <= bx1 || by2 <= by1) continue;
                    if (ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1) return true;
                }
                return false;
            };
            const boxSizesRev = [
                { type: 'M', width: 1.59 }, { type: 'M', width: 1.49 },
                { type: 'S', width: 1.39 }, { type: 'S', width: 1.29 }, { type: 'S', width: 1.00 }, { type: 'S', width: 0.90 }, { type: 'S', width: 0.80 },
            ];
            const stepRev = 0.25;
            let placedRev = 0;
            for (let scanY = b.maxY - bd - revCl; scanY >= b.minY + revCl; scanY -= stepRev) {
                for (let scanX = b.maxX - 1.0 - revCl; scanX >= b.minX + revCl; scanX -= stepRev) {
                    const sx = this._snapToPlacementGrid(scanX);
                    const sy = this._snapToRowAlignment(scanY);
                    if (!this._isPointInValidGapFillRegion(sx, sy)) continue;
                    if (overlapsAnyRev(sx, sy, 1.0, bd)) continue;
                    for (const size of boxSizesRev) {
                        const bw = size.width;
                        const bh = bd;
                        if (sx < b.minX + revCl) continue;
                        if (sx + bw > b.maxX - revCl) continue;
                        if (!this._isRectInFreeGrid(sx, sy, bw, bh)) continue;
                        if (this._boxHitsWall(sx, sy, bw, bh, revCl)) continue;
                        if (this._boxHitsObstacle(sx, sy, bw, bh)) continue;
                        if (overlapsAnyRev(sx, sy, bw, bh)) continue;
                        const u = this._makeUnit(unitId++, sx, sy, bw, bh,
                            { type: size.type, width: bw, area: bw * bd }, 'single', false);
                        units.push(u);
                        occupiedRev.push({ x: sx, y: sy, w: bw, h: bh });
                        placedRev++;
                        break;
                    }
                }
            }
            if (placedRev > 0) console.log(`[CostoProLayout v4] Gap-fill reverse: +${placedRev} boxes`);
        }

        // Step 2b-4: Micro gap-fill — very fine step (0.2) to pack small boxes in remaining slivers
        {
            const microBefore = units.length;
            const bd = this.boxDepth;
            const b = this.bounds;
            const microCl = Math.max(0.05, this.wallClearance * 0.5);
            const microInset = 0.02;
            const occupiedMicro = units.map(u => ({ x: u.x, y: u.y, w: u.width, h: u.height }));
            for (const c of corridors) {
                if (Number.isFinite(c.x) && Number.isFinite(c.width))
                    occupiedMicro.push({ x: c.x, y: c.y, w: c.width, h: c.height });
            }
            for (const fz of this.forbiddenZones) {
                const r = this._getRect(fz);
                if (r) occupiedMicro.push(r);
            }
            const overlapsAnyMicro = (bx, by, bw, bh, inset = microInset) => {
                const ax1 = bx + inset, ay1 = by + inset, ax2 = bx + bw - inset, ay2 = by + bh - inset;
                if (ax2 <= ax1 || ay2 <= ay1) return true;
                for (const r of occupiedMicro) {
                    const bx1 = r.x + inset, by1 = r.y + inset, bx2 = r.x + r.w - inset, by2 = r.y + r.h - inset;
                    if (bx2 <= bx1 || by2 <= by1) continue;
                    if (ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1) return true;
                }
                return false;
            };
            const boxSizesMicro = [
                { type: 'S', width: 1.00 }, { type: 'S', width: 0.90 }, { type: 'S', width: 0.80 },
            ];
            const stepMicro = 0.2;
            let placedMicro = 0;
            for (let scanY = b.minY + microCl; scanY + bd <= b.maxY - microCl; scanY += stepMicro) {
                for (let scanX = b.minX + microCl; scanX + 0.8 <= b.maxX - microCl; scanX += stepMicro) {
                    const sx = this._snapToPlacementGrid(scanX);
                    const sy = this._snapToRowAlignment(scanY);
                    if (!this._isPointInValidGapFillRegion(sx, sy)) continue;
                    if (overlapsAnyMicro(sx, sy, 0.8, bd)) continue;
                    for (const size of boxSizesMicro) {
                        const bw = size.width;
                        const bh = bd;
                        if (sx + bw > b.maxX - microCl) continue;
                        if (!this._isRectInFreeGrid(sx, sy, bw, bh)) continue;
                        if (this._boxHitsWall(sx, sy, bw, bh, microCl)) continue;
                        if (this._boxHitsObstacle(sx, sy, bw, bh)) continue;
                        if (overlapsAnyMicro(sx, sy, bw, bh)) continue;
                        const u = this._makeUnit(unitId++, sx, sy, bw, bh,
                            { type: size.type, width: bw, area: bw * bd }, 'single', false);
                        units.push(u);
                        occupiedMicro.push({ x: sx, y: sy, w: bw, h: bh });
                        placedMicro++;
                        scanX += bw;
                        break;
                    }
                }
            }
            if (placedMicro > 0) console.log(`[CostoProLayout v4] Gap-fill micro: +${placedMicro} boxes`);
        }

        // Step 2b-5: Nano fill — step 0.15, 0.80m boxes only, safe clearance to fill last slivers
        {
            const nanoBefore = units.length;
            const bd = this.boxDepth;
            const b = this.bounds;
            const nanoCl = Math.max(0.05, this.wallClearance * 0.5);
            const nanoInset = 0.02;
            const occupiedNano = units.map(u => ({ x: u.x, y: u.y, w: u.width, h: u.height }));
            for (const c of corridors) {
                if (Number.isFinite(c.x) && Number.isFinite(c.width))
                    occupiedNano.push({ x: c.x, y: c.y, w: c.width, h: c.height });
            }
            for (const fz of this.forbiddenZones) {
                const r = this._getRect(fz);
                if (r) occupiedNano.push(r);
            }
            const overlapsAnyNano = (bx, by, bw, bh, inset = nanoInset) => {
                const ax1 = bx + inset, ay1 = by + inset, ax2 = bx + bw - inset, ay2 = by + bh - inset;
                if (ax2 <= ax1 || ay2 <= ay1) return true;
                for (const r of occupiedNano) {
                    const bx1 = r.x + inset, by1 = r.y + inset, bx2 = r.x + r.w - inset, by2 = r.y + r.h - inset;
                    if (bx2 <= bx1 || by2 <= by1) continue;
                    if (ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1) return true;
                }
                return false;
            };
            const stepNano = 0.15;
            let placedNano = 0;
            for (let scanY = b.minY + nanoCl; scanY + bd <= b.maxY - nanoCl; scanY += stepNano) {
                for (let scanX = b.minX + nanoCl; scanX + 0.8 <= b.maxX - nanoCl; scanX += stepNano) {
                    const sx = this._snapToPlacementGrid(scanX);
                    const sy = this._snapToRowAlignment(scanY);
                    if (!this._isPointInValidGapFillRegion(sx, sy)) continue;
                    if (overlapsAnyNano(sx, sy, 0.8, bd)) continue;
                    if (sx + 0.8 > b.maxX - nanoCl) continue;
                    if (!this._isRectInFreeGrid(sx, sy, 0.8, bd)) continue;
                    if (this._boxHitsWall(sx, sy, 0.8, bd, nanoCl)) continue;
                    if (this._boxHitsObstacle(sx, sy, 0.8, bd)) continue;
                    if (overlapsAnyNano(sx, sy, 0.8, bd)) continue;
                    const u = this._makeUnit(unitId++, sx, sy, 0.8, bd,
                        { type: 'S', width: 0.8, area: 0.8 * bd }, 'single', false);
                    units.push(u);
                    occupiedNano.push({ x: sx, y: sy, w: 0.8, h: bd });
                    placedNano++;
                    scanX += 0.8;
                }
            }
            if (placedNano > 0) console.log(`[CostoProLayout v4] Gap-fill nano: +${placedNano} boxes`);
        }

        // Step 2c: Fill right band — cover right 70% of plan; finer step to fill more
        {
            const b = this.bounds;
            const planW = b.maxX - b.minX;
            const rightBandMinX = b.minX + 0.30 * planW;  // right 70% of plan
            const bandCl = Math.max(0.05, this.wallClearance * 0.5);
            const bandInset = 0.02;
            if ((b.maxX - rightBandMinX) >= 1.5) {
                const occupied = units.map(u => ({ x: u.x, y: u.y, w: u.width, h: u.height }));
                for (const c of corridors) {
                    if (Number.isFinite(c.x) && Number.isFinite(c.width))
                        occupied.push({ x: c.x, y: c.y, w: c.width, h: c.height });
                }
                for (const fz of this.forbiddenZones) {
                    const r = this._getRect(fz);
                    if (r) occupied.push(r);
                }
                const overlapsAny = (bx, by, bw, bh, inset = bandInset) => {
                    const ax1 = bx + inset, ay1 = by + inset, ax2 = bx + bw - inset, ay2 = by + bh - inset;
                    if (ax2 <= ax1 || ay2 <= ay1) return true;
                    for (const r of occupied) {
                        const bx1 = r.x + inset, by1 = r.y + inset, bx2 = r.x + r.w - inset, by2 = r.y + r.h - inset;
                        if (bx2 <= bx1 || by2 <= by1) continue;
                        if (ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1) return true;
                    }
                    return false;
                };
                const boxSizes = [
                    { type: 'M', width: 1.59 }, { type: 'M', width: 1.49 },
                    { type: 'S', width: 1.39 }, { type: 'S', width: 1.29 }, { type: 'S', width: 1.00 }, { type: 'S', width: 0.90 }, { type: 'S', width: 0.80 }
                ];
                const bd = this.boxDepth;
                const step = 0.2;
                let added = 0;
                for (let scanY = b.minY + bandCl; scanY + bd <= b.maxY - bandCl; scanY += step) {
                    for (let scanX = rightBandMinX; scanX + 1.0 <= b.maxX - bandCl; scanX += step) {
                        const sx = this._snapToPlacementGrid(scanX);
                        const sy = this._snapToRowAlignment(scanY);
                        if (!this._isPointInValidGapFillRegion(sx, sy)) continue;
                        if (overlapsAny(sx, sy, 1.0, bd)) continue;
                        for (const size of boxSizes) {
                            const bw = size.width;
                            const bh = bd;
                            if (sx + bw > b.maxX - bandCl) continue;
                            if (!this._isRectInFreeGrid(sx, sy, bw, bh)) continue;
                            if (this._boxHitsWall(sx, sy, bw, bh, bandCl)) continue;
                            if (this._boxHitsObstacle(sx, sy, bw, bh)) continue;
                            if (overlapsAny(sx, sy, bw, bh)) continue;
                            const u = this._makeUnit(unitId++, sx, sy, bw, bh,
                                { type: size.type, width: bw, area: bw * bd }, 'single', false);
                            units.push(u);
                            occupied.push({ x: sx, y: sy, w: bw, h: bh });
                            added++;
                            break;
                        }
                    }
                }
                if (added > 0) console.log(`[CostoProLayout v4] Right-band fill: +${added} boxes`);
            }
        }

        // Step 3: Cross-zone connector corridors
        const crossCorridors = this._buildCrossZoneCorridors(zones);
        corridors.push(...crossCorridors);
        console.log(`[CostoProLayout v4] Cross-zone connectors: ${crossCorridors.length}`);

        // Step 3b: Main hallways (envelope loop + spine connectors)
        const mainHallways = this._buildMainHallways(corridors, units);
        corridors.push(...mainHallways);
        console.log(`[CostoProLayout v4] Main hallways: ${mainHallways.length}`);

        // Step 3c: Full-plan east-west and south-north spines for continuous walkthrough
        const fullPlanSpines = this._buildFullPlanSpines(units);
        corridors.push(...fullPlanSpines);
        console.log(`[CostoProLayout v4] Full-plan spines (E-W/S-N): ${fullPlanSpines.length}`);

        // Step 3d: Gap filler — add corridors in any empty strip (central/side gaps) so pathways connect
        const gapFill = this._buildGapFillerCorridors(units, corridors);
        corridors.push(...gapFill);
        if (gapFill.length > 0) console.log(`[CostoProLayout v4] Gap-filler corridors: ${gapFill.length}`);

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
        let finalUnits = sanitized.units;
        let finalCorridors = sanitized.corridors;
        if (sanitized.removedUnits > 0 || sanitized.removedCorridors > 0) {
            console.log(
                `[CostoProLayout v4] Safety sanitize: removed ${sanitized.removedUnits} overlapping/out-of-bounds boxes and ` +
                `${sanitized.removedCorridors} invalid corridors`
            );
        }
        const postFill = this._fillResidualGaps(finalUnits, finalCorridors, { targetCount });
        if (postFill.added > 0) {
            finalUnits = postFill.units;
            console.log(`[CostoProLayout v4] Residual fill: +${postFill.added} boxes after sanitize`);
        }
        // Flush to wall: nudge boxes that have a small gap from walls closer (so boxes are placed "from" walls, not floating)
        let flushCount = 0;
        for (const unit of finalUnits) {
            const nudged = this._nudgeUnitTowardWall(unit, finalUnits, finalCorridors);
            if (nudged) {
                unit.x = nudged.x;
                unit.y = nudged.y;
                flushCount++;
            }
        }
        if (flushCount > 0) console.log(`[CostoProLayout v4] Flush to wall: ${flushCount} boxes nudged closer`);
        // Prefer corridors between facing rows: generate from geometry, remove conflicting generic corridors.
        const facingRowCorridors = this._generateCorridorsFromFacingRows(finalUnits);
        if (facingRowCorridors.length > 0) {
            finalCorridors = finalCorridors.filter(
                (c) => !facingRowCorridors.some((f) => this._corridorsConflict(c, f) || this._corridorOverlapsCorridor(c, f))
            );
            // Architectural rule: corridors take priority over gap-fill boxes.
            // Remove any units that sit inside a facing-row corridor band.
            const beforeCount = finalUnits.length;
            finalUnits = finalUnits.filter(
                (u) => !facingRowCorridors.some((c) => this._rectsOverlap(u, c, 0.02))
            );
            const evicted = beforeCount - finalUnits.length;
            if (evicted > 0) console.log(`[CostoProLayout v4] Evicted ${evicted} units from corridor bands`);
            finalCorridors.push(...facingRowCorridors);
        }
        // Link disconnected corridor components with connector corridors
        finalCorridors = this._linkDisconnectedCorridors(finalCorridors, finalUnits);
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
            }, {
                oneWayFlow: this.oneWayFlow,
                // Architectural rule: circulation must not go through boxes.
                blockThroughUnits: true,
                // Avoid synthetic strokes that can look "random" and cut through units.
                allowSyntheticConnectors: false,
                enforceRouteContinuity: true
            });
            circulationPaths = router.generateRoute(finalCorridors, finalUnits);
            if (!Array.isArray(circulationPaths)) circulationPaths = [];
            const fallback = this._buildFallbackCirculationPaths(finalCorridors);
            const uncovered = finalCorridors.filter((c) => !this._corridorCenterlineCovered(c, circulationPaths));
            for (const c of uncovered) {
                const isHorizontal = c.direction === 'horizontal' || c.width >= c.height;
                circulationPaths.push({
                    type: 'SPINE',
                    style: 'dashed_lightblue',
                    path: isHorizontal
                        ? [{ x: c.x, y: c.y + c.height / 2 }, { x: c.x + c.width, y: c.y + c.height / 2 }]
                        : [{ x: c.x + c.width / 2, y: c.y }, { x: c.x + c.width / 2, y: c.y + c.height }]
                });
            }
            if (circulationPaths.length === 0) circulationPaths = fallback;
        } catch (err) {
            console.warn('[CostoProLayout v4] Circulation router fallback:', err.message);
            circulationPaths = this._buildFallbackCirculationPaths(finalCorridors);
        }

        return { units: finalUnits, corridors: finalCorridors, radiators, circulationPaths, layoutMode: this.layoutMode };
    }

    _generateWallHuggingLayout({ distribution, targetCount }) {
        const clearanceMeters = Math.max(this.wallClearance, this.wallClearanceMm / 1000);
        const sizeCatalog = this._buildSizeCatalog(distribution || {});
        const specs = this._buildWallHuggingSpecs(sizeCatalog, targetCount);

        const floorPlanForPlacer = {
            bounds: this.bounds,
            walls: this.walls,
            envelope: this.envelope
        };
        const perimeterWalls = this._detectPerimeterWalls();
        const collisionWalls = this._buildWallHuggingCollisionWalls(perimeterWalls);
        const runPlacement = (placerFloorPlan, sourceTag = 'primary') => {
            const placer = new WallHuggingPlacer(placerFloorPlan, {
                clearance: clearanceMeters,
                minSegmentLength: this.minGapLength,
                boxDepth: this.boxDepth
            });
            const rawPlacement = placer.placeBoxesAlongPerimeter(specs, clearanceMeters, {
                depth: this.boxDepth,
                gap: this.boxSpacing,
                overlapInset: 0.01,
                targetCount: targetCount || Infinity,
                wallSegments: collisionWalls,
                wallClearance: Math.max(0.01, this.wallClearance * 0.5),
                preferDensePlacement: true,
                isRectValid: (rect) => this._isWallHuggingRectValid(rect, { placementSource: sourceTag })
            });

            const units = [];
            let unitId = 1;
            for (const candidate of (rawPlacement.units || [])) {
                const overlaps = units.some((u) => this._rectsOverlap(candidate, u, 0.01));
                if (overlaps) continue;
                units.push(this._makeWallHuggingUnit(unitId++, candidate));
            }
            return { placement: rawPlacement, units, sourceTag };
        };

        let run = runPlacement(floorPlanForPlacer, 'primary');
        if ((run.units || []).length === 0 && run.placement?.perimeterSource !== 'boundsFallback') {
            console.warn(
                `[CostoProLayout v4] Wall-hugging produced zero units (source=${run.placement?.perimeterSource || 'unknown'}), ` +
                'retrying with bounds fallback perimeter'
            );
            run = runPlacement({ bounds: this.bounds, walls: [], envelope: [] }, 'boundsFallbackRetry');
        }

        const placement = run.placement;
        const units = run.units;

        const rawCorridors = this._buildWallHuggingCorridors(placement.insetPerimeter, units);
        const corridorCandidates = [];
        for (const c of (rawCorridors || [])) {
            corridorCandidates.push(c);
        }
        const hallways = this._buildMainHallways(rawCorridors || [], units || []);
        for (const c of hallways) {
            corridorCandidates.push(c);
        }

        const cleanCorridors = corridorCandidates.filter((c) => {
            if (!c) return false;
            if (![c.x, c.y, c.width, c.height].every(Number.isFinite)) return false;
            if (c.width < 0.05 || c.height < 0.05) return false;
            if (this._boxHitsObstacle(c.x, c.y, c.width, c.height, { ignoreEntrances: true })) return false;
            return true;
        });
        const filteredUnits = units.filter((u) => {
            if (!u) return false;
            if (![u.x, u.y, u.width, u.height].every(Number.isFinite)) return false;
            if (u.width <= 0 || u.height <= 0) return false;
            if (this._boxHitsObstacle(u.x, u.y, u.width, u.height)) return false;
            return true;
        });
        const filteredCorridors = cleanCorridors.filter((c) => {
            return !filteredUnits.some((u) => this._rectsOverlap(u, c, 0.01));
        });

        const sanitized = this._sanitizeFinalLayout(filteredUnits, filteredCorridors);
        let finalUnits = sanitized.units;
        let finalCorridors = sanitized.corridors;
        if (sanitized.removedUnits > 0 || sanitized.removedCorridors > 0) {
            console.log(
                `[CostoProLayout v4] Wall-hugging sanitize: removed ${sanitized.removedUnits} boxes and ` +
                `${sanitized.removedCorridors} corridors`
            );
        }
        const postFill = this._fillResidualGaps(finalUnits, finalCorridors, { targetCount });
        if (postFill.added > 0) {
            finalUnits = postFill.units;
            const reSanitized = this._sanitizeFinalLayout(finalUnits, finalCorridors);
            finalUnits = reSanitized.units;
            finalCorridors = reSanitized.corridors;
            console.log(`[CostoProLayout v4] Wall-hugging residual fill: +${postFill.added} boxes`);
        }
        // Prefer corridors between facing rows (same as row-based layout)
        const facingRowCorridors = this._generateCorridorsFromFacingRows(finalUnits);
        if (facingRowCorridors.length > 0) {
            finalCorridors = finalCorridors.filter(
                (c) => !facingRowCorridors.some((f) => this._corridorsConflict(c, f) || this._corridorOverlapsCorridor(c, f))
            );
            const safeFacing = facingRowCorridors.filter((c) => !finalUnits.some((u) => this._rectsOverlap(u, c, 0.02)));
            finalCorridors.push(...safeFacing);
        }

        finalCorridors.forEach((c, i) => { c.id = `corridor_${i}`; });
        finalUnits.forEach((u, i) => {
            u.id = `unit_${i + 1}`;
            u.displayNumber = i + 1;
            u.dimensionLabel = `${u.width.toFixed(2)}`;
            u.layoutMode = 'wallHugging';
        });

        const radiators = this._generateRadiators(finalUnits, finalCorridors);

        let circulationPaths = [];
        try {
            const router = new CirculationRouter({
                bounds: this.bounds,
                walls: this.walls,
                envelope: this.envelope,
                entrances: this.entrances,
                forbiddenZones: this.forbiddenZones
            }, {
                oneWayFlow: this.oneWayFlow,
                blockThroughUnits: true,
                allowSyntheticConnectors: false,
                enforceRouteContinuity: true
            });
            circulationPaths = router.generateRoute(finalCorridors, finalUnits);
            if (!Array.isArray(circulationPaths)) circulationPaths = [];
            const fallback = this._buildFallbackCirculationPaths(finalCorridors);
            const uncovered = finalCorridors.filter((c) => !this._corridorCenterlineCovered(c, circulationPaths));
            for (const c of uncovered) {
                const isHorizontal = c.direction === 'horizontal' || c.width >= c.height;
                circulationPaths.push({
                    type: 'SPINE',
                    style: 'dashed_lightblue',
                    path: isHorizontal
                        ? [{ x: c.x, y: c.y + c.height / 2 }, { x: c.x + c.width, y: c.y + c.height / 2 }]
                        : [{ x: c.x + c.width / 2, y: c.y }, { x: c.x + c.width / 2, y: c.y + c.height }]
                });
            }
            if (circulationPaths.length === 0) circulationPaths = fallback;
        } catch (err) {
            console.warn('[CostoProLayout v4] Wall-hugging circulation fallback:', err.message);
            circulationPaths = this._buildFallbackCirculationPaths(finalCorridors);
        }

        console.log(
            `[CostoProLayout v4] Wall-hugging mode: ${finalUnits.length} units, ${finalCorridors.length} corridors ` +
            `(source=${placement.perimeterSource || 'unknown'})`
        );
        console.log(`[CostoProLayout v4] Wall-hugging diagnostics:`, placement.diagnostics || {});

        return {
            units: finalUnits,
            corridors: finalCorridors,
            radiators,
            circulationPaths,
            layoutMode: 'wallHugging',
            diagnostics: {
                wallHugging: placement.diagnostics || {},
                perimeterSource: placement.perimeterSource || 'unknown',
                collisionWalls: collisionWalls.length
            }
        };
    }

    _buildWallHuggingSpecs(catalog, targetCount) {
        const source = Array.isArray(catalog) && catalog.length
            ? catalog
            : [{ type: 'M', width: 1.49, area: 1.49 * this.boxDepth }];
        const desired = Number.isFinite(targetCount)
            ? Math.max(source.length, targetCount * 2)
            : Math.max(source.length * 12, 220);
        const specs = [];
        for (let i = 0; i < desired; i++) {
            const size = source[i % source.length];
            specs.push({
                type: size.type || 'M',
                width: Number(size.width) || 1.49,
                depth: this.boxDepth,
                area: (Number(size.width) || 1.49) * this.boxDepth
            });
        }
        return specs;
    }

    _isWallHuggingRectValid(rect, options = {}) {
        if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return false;
        if (rect.width <= 0 || rect.height <= 0) return false;

        const b = this.bounds;
        const cl = Math.max(0.02, this.wallClearance);
        if (rect.x < b.minX + cl || rect.y < b.minY + cl) return false;
        if (rect.x + rect.width > b.maxX - cl || rect.y + rect.height > b.maxY - cl) return false;
        const placementSource = String(options.placementSource || '');
        const skipOuterPerimeter = placementSource === 'boundsFallbackRetry';
        if (!skipOuterPerimeter && !this._isRectInsideOuterPerimeter(rect, Math.max(0.04, cl * 0.4))) return false;
        if (this._boxHitsObstacle(rect.x, rect.y, rect.width, rect.height)) return false;
        return true;
    }

    _makeWallHuggingUnit(id, candidate) {
        const bw = Number(candidate.width) || 1.0;
        const bh = Number(candidate.height) || this.boxDepth;
        const segAxis = candidate.axis || (bw >= bh ? 'horizontal' : 'vertical');
        const preferredWidth = Number(candidate.preferredWidth);
        const dimension = Number.isFinite(preferredWidth)
            ? preferredWidth
            : (segAxis === 'vertical' ? bh : bw);
        const inward = candidate.inwardNormal || { x: 0, y: -1 };
        const doorSide = Math.abs(inward.x) >= Math.abs(inward.y)
            ? (inward.x >= 0 ? 'right' : 'left')
            : (inward.y >= 0 ? 'top' : 'bottom');

        return {
            id: `unit_${id}`,
            x: Number(candidate.x),
            y: Number(candidate.y),
            width: bw,
            height: bh,
            area: Number((bw * bh).toFixed(2)),
            type: candidate.type || 'M',
            label: `${(bw * bh).toFixed(1)}mÂ²`,
            dimensionLabel: `${dimension.toFixed(2)}`,
            partitionType: 'toleGrise',
            row: 'perimeter',
            doorSide,
            doorWidth: 0.8,
            layoutMode: 'wallHugging',
            partitions: {
                top: 'tole_grise',
                bottom: 'tole_grise',
                left: 'tole_grise',
                right: 'tole_grise'
            }
        };
    }

    _buildWallHuggingCorridors(insetPolygon, units) {
        if (!Array.isArray(insetPolygon) || insetPolygon.length < 3) return [];

        const helper = new WallHuggingPlacer({
            bounds: this.bounds,
            walls: this.walls,
            envelope: this.envelope
        }, {
            boxDepth: this.boxDepth,
            minSegmentLength: this.minGapLength
        });

        const extraInset = Math.max(this.boxDepth + this.rowGapClearance, this.corridorWidth * 0.9);
        const interior = helper.computeInsetPerimeter(insetPolygon, extraInset).polygon;
        const core = Array.isArray(interior) && interior.length >= 3 ? interior : insetPolygon;
        const xs = core.map((p) => Number(p.x)).filter(Number.isFinite);
        const ys = core.map((p) => Number(p.y)).filter(Number.isFinite);
        if (!xs.length || !ys.length) return [];

        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const width = maxX - minX;
        const height = maxY - minY;
        if (width <= this.corridorWidth * 1.25 || height <= this.corridorWidth * 1.25) return [];

        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const corridors = [];

        const horizontal = {
            type: 'ACCESS',
            direction: 'horizontal',
            x: minX,
            y: cy - this.corridorWidth / 2,
            width: width,
            height: this.corridorWidth
        };
        const vertical = {
            type: 'ACCESS',
            direction: 'vertical',
            x: cx - this.corridorWidth / 2,
            y: minY,
            width: this.corridorWidth,
            height: height
        };

        const horizontalFit = this._fitCorridorRectInsidePolygon(horizontal, core);
        const verticalFit = this._fitCorridorRectInsidePolygon(vertical, core);
        if (horizontalFit) corridors.push(horizontalFit);
        if (verticalFit) corridors.push(verticalFit);

        const spacing = this.corridorWidth * 1.8;
        if (height > this.corridorWidth * 4) {
            const upper = this._fitCorridorRectInsidePolygon({
                ...horizontal,
                y: cy + spacing - this.corridorWidth / 2
            }, core);
            const lower = this._fitCorridorRectInsidePolygon({
                ...horizontal,
                y: cy - spacing - this.corridorWidth / 2
            }, core);
            if (upper) corridors.push(upper);
            if (lower) corridors.push(lower);
        }

        if (width > this.corridorWidth * 4) {
            const left = this._fitCorridorRectInsidePolygon({
                ...vertical,
                x: cx - spacing - this.corridorWidth / 2
            }, core);
            const right = this._fitCorridorRectInsidePolygon({
                ...vertical,
                x: cx + spacing - this.corridorWidth / 2
            }, core);
            if (left) corridors.push(left);
            if (right) corridors.push(right);
        }

        const filtered = corridors.filter((c) => c && c.width > 0 && c.height > 0);
        const overlapInset = 0.01;
        const deduped = [];
        for (const c of filtered) {
            if (deduped.some((d) => this._rectsOverlap(c, d, overlapInset))) continue;
            if (units.some((u) => this._rectsOverlap(c, u, 0.01))) continue;
            deduped.push({
                ...c,
                type: 'ACCESS',
                source: 'wallHugging'
            });
        }
        return deduped;
    }

    _fitCorridorRectInsidePolygon(rect, polygon) {
        if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return null;
        let candidate = { ...rect };
        const minSize = Math.max(0.4, this.corridorWidth * 0.6);

        for (let i = 0; i < 16; i++) {
            if (candidate.width < minSize || candidate.height < minSize) return null;
            if (
                this._wallHuggingRectInsidePolygon(candidate, polygon, 0.05) &&
                !this._boxHitsObstacle(candidate.x, candidate.y, candidate.width, candidate.height, { ignoreEntrances: true })
            ) {
                return candidate;
            }

            const cx = candidate.x + candidate.width / 2;
            const cy = candidate.y + candidate.height / 2;
            candidate.width *= 0.9;
            candidate.height *= 0.9;
            candidate.x = cx - candidate.width / 2;
            candidate.y = cy - candidate.height / 2;
        }

        return null;
    }

    _wallHuggingRectInsidePolygon(rect, polygon, tolerance = 0.05) {
        if (!Array.isArray(polygon) || polygon.length < 3) return false;
        const corners = [
            { x: rect.x, y: rect.y },
            { x: rect.x + rect.width, y: rect.y },
            { x: rect.x + rect.width, y: rect.y + rect.height },
            { x: rect.x, y: rect.y + rect.height }
        ];

        for (const corner of corners) {
            if (this._pointInPolygon(corner, polygon)) continue;
            const dist = this._pointToPolygonDistance(corner, polygon);
            if (!Number.isFinite(dist) || dist > tolerance) return false;
        }
        return true;
    }

    _pointInPolygon(point, polygon) {
        const px = Number(point.x);
        const py = Number(point.y);
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = Number(polygon[i].x);
            const yi = Number(polygon[i].y);
            const xj = Number(polygon[j].x);
            const yj = Number(polygon[j].y);
            const intersects = ((yi > py) !== (yj > py)) &&
                (px < ((xj - xi) * (py - yi)) / Math.max(1e-9, (yj - yi)) + xi);
            if (intersects) inside = !inside;
        }
        return inside;
    }

    _pointToPolygonDistance(point, polygon) {
        let minDist = Infinity;
        for (let i = 0; i < polygon.length; i++) {
            const a = polygon[i];
            const b = polygon[(i + 1) % polygon.length];
            const d = this._pointToSegDist(point.x, point.y, a.x, a.y, b.x, b.y);
            if (d < minDist) minDist = d;
        }
        return minDist;
    }

    _boxHitsPerimeterWalls(bx, by, bw, bh) {
        const cl = Math.max(0.01, this.wallClearance * 0.4);
        const l = bx - cl;
        const r = bx + bw + cl;
        const b = by - cl;
        const t = by + bh + cl;
        const segs = this._detectPerimeterWalls();

        for (const seg of segs) {
            const sMinX = Math.min(seg.x1, seg.x2);
            const sMaxX = Math.max(seg.x1, seg.x2);
            const sMinY = Math.min(seg.y1, seg.y2);
            const sMaxY = Math.max(seg.y1, seg.y2);
            if (sMaxX < l || sMinX > r || sMaxY < b || sMinY > t) continue;
            if (this._segIntersectsRect(seg.x1, seg.y1, seg.x2, seg.y2, l, b, r, t)) return true;
        }
        return false;
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
    //  Full-plan east-west and south-north spine corridors
    //  Ensures continuous walkthrough E-W and S-N like reference "ligne circulation"
    // ─────────────────────────────────────────────────────────────────

    _buildFullPlanSpines(units) {
        const cw = this.corridorWidth;
        const b = this.bounds;
        const spanX = b.maxX - b.minX;
        const spanY = b.maxY - b.minY;
        const minRun = Math.max(cw * 1.5, 2.0);
        const spines = [];
        const boxPad = Math.max(0.05, cw * 0.15);

        const boxes = (units || []).map(u => ({
            x: Number(u.x),
            y: Number(u.y),
            w: Number(u.width) || 0,
            h: Number(u.height) || 0
        })).filter(r => r.w > 0 && r.h > 0);

        const mergeIntervals = (intervals, lo, hi) => {
            const clipped = intervals
                .map(([s, e]) => [Math.max(lo, Math.min(hi, s)), Math.max(lo, Math.min(hi, e))])
                .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e - s > 0.01)
                .sort((a, b) => a[0] - b[0]);
            if (!clipped.length) return [[lo, hi]];
            const merged = [clipped[0].slice()];
            for (let i = 1; i < clipped.length; i++) {
                const cur = clipped[i];
                const prev = merged[merged.length - 1];
                if (cur[0] <= prev[1] + 0.02) {
                    prev[1] = Math.max(prev[1], cur[1]);
                } else {
                    merged.push(cur.slice());
                }
            }
            return merged;
        };

        const clearRuns = (blocked, lo, hi) => {
            const runs = [];
            let cursor = lo;
            for (const [s, e] of blocked) {
                if (s > cursor + 0.05) runs.push([cursor, s]);
                cursor = Math.max(cursor, e);
            }
            if (hi > cursor + 0.05) runs.push([cursor, hi]);
            return runs;
        };

        // Vertical spines (south-north): multiple positions across plan width for full S-N walkthrough
        const numVSpines = Math.max(3, Math.min(7, Math.floor(spanX / 8)));
        const vPositions = [];
        for (let i = 0; i < numVSpines; i++) {
            const t = (i + 1) / (numVSpines + 1);
            vPositions.push(b.minX + spanX * t);
        }

        for (const x of vPositions) {
            if (x + cw > b.maxX || x < b.minX) continue;
            const stripX0 = x;
            const stripX1 = x + cw;
            const blocked = [];
            for (const box of boxes) {
                if (box.x < stripX1 && box.x + box.w > stripX0) {
                    blocked.push([box.y - boxPad, box.y + box.h + boxPad]);
                }
            }
            for (const seg of this.wallSegments) {
                const wMinX = Math.min(seg.x1, seg.x2);
                const wMaxX = Math.max(seg.x1, seg.x2);
                const wMinY = Math.min(seg.y1, seg.y2);
                const wMaxY = Math.max(seg.y1, seg.y2);
                if (wMaxX < stripX0 || wMinX > stripX1) continue;
                if (wMinY < wMaxY) blocked.push([wMinY - boxPad, wMaxY + boxPad]);
            }
            const merged = mergeIntervals(blocked, b.minY, b.maxY);
            const runs = clearRuns(merged, b.minY, b.maxY);
            for (const [sy, ey] of runs) {
                const len = ey - sy;
                if (len < minRun) continue;
                if (this._boxHitsWall(stripX0, sy, cw, len)) continue;
                if (this._boxHitsObstacle(stripX0, sy, cw, len, { ignoreEntrances: true })) continue;
                spines.push({
                    type: 'SPINE',
                    direction: 'vertical',
                    x: stripX0,
                    y: sy,
                    width: cw,
                    height: len,
                    isFullPlanSpine: true
                });
            }
        }

        // Horizontal spines (east-west): multiple positions across plan height for full E-W walkthrough
        const numHSpines = Math.max(3, Math.min(7, Math.floor(spanY / 8)));
        const hPositions = [];
        for (let i = 0; i < numHSpines; i++) {
            const t = (i + 1) / (numHSpines + 1);
            hPositions.push(b.minY + spanY * t);
        }

        for (const y of hPositions) {
            if (y + cw > b.maxY || y < b.minY) continue;
            const stripY0 = y;
            const stripY1 = y + cw;
            const blocked = [];
            for (const box of boxes) {
                if (box.y < stripY1 && box.y + box.h > stripY0) {
                    blocked.push([box.x - boxPad, box.x + box.w + boxPad]);
                }
            }
            for (const seg of this.wallSegments) {
                const wMinY = Math.min(seg.y1, seg.y2);
                const wMaxY = Math.max(seg.y1, seg.y2);
                const wMinX = Math.min(seg.x1, seg.x2);
                const wMaxX = Math.max(seg.x1, seg.x2);
                if (wMaxY < stripY0 || wMinY > stripY1) continue;
                if (wMinX < wMaxX) blocked.push([wMinX - boxPad, wMaxX + boxPad]);
            }
            const merged = mergeIntervals(blocked, b.minX, b.maxX);
            const runs = clearRuns(merged, b.minX, b.maxX);
            for (const [sx, ex] of runs) {
                const len = ex - sx;
                if (len < minRun) continue;
                if (this._boxHitsWall(sx, stripY0, len, cw)) continue;
                if (this._boxHitsObstacle(sx, stripY0, len, cw, { ignoreEntrances: true })) continue;
                spines.push({
                    type: 'SPINE',
                    direction: 'horizontal',
                    x: sx,
                    y: stripY0,
                    width: len,
                    height: cw,
                    isFullPlanSpine: true
                });
            }
        }

        return spines;
    }

    /**
     * Add corridor segments in empty strips (central horizontal/vertical gaps) so pathways connect.
     * Dense scan so we don't miss narrow gaps between module clusters.
     */
    _buildGapFillerCorridors(units, existingCorridors) {
        const cw = this.corridorWidth;
        const b = this.bounds;
        const spanX = b.maxX - b.minX;
        const spanY = b.maxY - b.minY;
        const minRunGap = Math.max(2.5, cw * 2);
        const step = 0.5;
        const boxPad = Math.max(0.04, cw * 0.12);
        const out = [];

        const boxes = (units || []).map(u => ({
            x: Number(u.x),
            y: Number(u.y),
            w: Number(u.width) || 0,
            h: Number(u.height) || 0
        })).filter(r => r.w > 0 && r.h > 0);

        const mergeIntervals = (intervals, lo, hi) => {
            const clipped = intervals
                .map(([s, e]) => [Math.max(lo, Math.min(hi, s)), Math.max(lo, Math.min(hi, e))])
                .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e - s > 0.02)
                .sort((a, b) => a[0] - b[0]);
            if (!clipped.length) return [];
            const merged = [clipped[0].slice()];
            for (let i = 1; i < clipped.length; i++) {
                const cur = clipped[i];
                const prev = merged[merged.length - 1];
                if (cur[0] <= prev[1] + 0.03) prev[1] = Math.max(prev[1], cur[1]);
                else merged.push(cur.slice());
            }
            return merged;
        };

        const clearRuns = (blocked, lo, hi) => {
            const runs = [];
            let cursor = lo;
            for (const [s, e] of blocked) {
                if (s > cursor + 0.05) runs.push([cursor, s]);
                cursor = Math.max(cursor, e);
            }
            if (hi > cursor + 0.05) runs.push([cursor, hi]);
            return runs;
        };

        // Horizontal gap filler (east-west strips)
        for (let y = b.minY + cw * 0.3; y + cw <= b.maxY - cw * 0.3; y += step) {
            const stripY0 = y;
            const stripY1 = y + cw;
            const blocked = [];
            for (const box of boxes) {
                if (box.y < stripY1 && box.y + box.h > stripY0)
                    blocked.push([box.x - boxPad, box.x + box.w + boxPad]);
            }
            for (const seg of this.wallSegments) {
                const wMinY = Math.min(seg.y1, seg.y2);
                const wMaxY = Math.max(seg.y1, seg.y2);
                const wMinX = Math.min(seg.x1, seg.x2);
                const wMaxX = Math.max(seg.x1, seg.x2);
                if (wMaxY < stripY0 || wMinY > stripY1) continue;
                if (wMinX < wMaxX) blocked.push([wMinX - boxPad, wMaxX + boxPad]);
            }
            const merged = mergeIntervals(blocked, b.minX, b.maxX);
            const runs = clearRuns(merged, b.minX, b.maxX);
            for (const [sx, ex] of runs) {
                const len = ex - sx;
                if (len < minRunGap) continue;
                if (this._boxHitsWall(sx, stripY0, len, cw)) continue;
                if (this._boxHitsObstacle(sx, stripY0, len, cw, { ignoreEntrances: true })) continue;
                out.push({
                    type: 'ACCESS',
                    direction: 'horizontal',
                    x: sx,
                    y: stripY0,
                    width: len,
                    height: cw,
                    isGapFiller: true
                });
            }
        }

        // Vertical gap filler (south-north strips)
        for (let x = b.minX + cw * 0.3; x + cw <= b.maxX - cw * 0.3; x += step) {
            const stripX0 = x;
            const stripX1 = x + cw;
            const blocked = [];
            for (const box of boxes) {
                if (box.x < stripX1 && box.x + box.w > stripX0)
                    blocked.push([box.y - boxPad, box.y + box.h + boxPad]);
            }
            for (const seg of this.wallSegments) {
                const wMinX = Math.min(seg.x1, seg.x2);
                const wMaxX = Math.max(seg.x1, seg.x2);
                const wMinY = Math.min(seg.y1, seg.y2);
                const wMaxY = Math.max(seg.y1, seg.y2);
                if (wMaxX < stripX0 || wMinX > stripX1) continue;
                if (wMinY < wMaxY) blocked.push([wMinY - boxPad, wMaxY + boxPad]);
            }
            const merged = mergeIntervals(blocked, b.minY, b.maxY);
            const runs = clearRuns(merged, b.minY, b.maxY);
            for (const [sy, ey] of runs) {
                const len = ey - sy;
                if (len < minRunGap) continue;
                if (this._boxHitsWall(stripX0, sy, cw, len)) continue;
                if (this._boxHitsObstacle(stripX0, sy, cw, len, { ignoreEntrances: true })) continue;
                out.push({
                    type: 'ACCESS',
                    direction: 'vertical',
                    x: stripX0,
                    y: sy,
                    width: cw,
                    height: len,
                    isGapFiller: true
                });
            }
        }

        return out;
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

        // === Strategy: segmented free-space scan ===
        // Build clear runs between blocked intervals (boxes + structural walls),
        // then keep only runs that actually connect existing corridor spines.

        const minX = b.minX + cw * 0.2;
        const maxX = b.maxX - cw * 0.2;
        const minY = b.minY + cw * 0.2;
        const maxY = b.maxY - cw * 0.2;
        const step = Math.max(0.40, cw * 0.6);
        const boxPad = Math.max(0.01, (this.boxSpacing || 0.02) * 0.5);
        const wallPad = Math.max(0.06, cw * 0.24);
        const minRun = cw * 2.2;

        const isVertical = (c) => c && Number.isFinite(c.width) && Number.isFinite(c.height) && (c.direction === 'vertical' || c.height > c.width);
        const isHorizontal = (c) => c && Number.isFinite(c.width) && Number.isFinite(c.height) && (c.direction === 'horizontal' || c.width >= c.height);
        const baseVertical = (existingCorridors || []).filter(isVertical);
        const baseHorizontal = (existingCorridors || []).filter(isHorizontal);
        const dominantVertical = baseVertical.length >= Math.max(3, Math.round(baseHorizontal.length * 1.4));
        const dominantHorizontal = baseHorizontal.length >= Math.max(3, Math.round(baseVertical.length * 1.4));
        const shouldScanHorizontal = !dominantHorizontal;
        const shouldScanVertical = !dominantVertical;
        const minRunHorizontal = dominantVertical ? cw * 1.4 : minRun;
        const minRunVertical = dominantHorizontal ? cw * 1.4 : minRun;
        const planSpanX = maxX - minX;
        const planSpanY = maxY - minY;
        // Lower threshold so shorter clear runs (e.g. central gap) still get pathways (was 0.15)
        const longRunThreshold = Math.max(3.0, Math.min(planSpanX, planSpanY) * 0.08);

        const mergeIntervals = (intervals, lo, hi) => {
            const clipped = intervals
                .map(([s, e]) => [Math.max(lo, Math.min(hi, s)), Math.max(lo, Math.min(hi, e))])
                .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e - s > 0.01)
                .sort((a, b) => a[0] - b[0]);
            if (!clipped.length) return [];
            const merged = [clipped[0].slice()];
            for (let i = 1; i < clipped.length; i++) {
                const cur = clipped[i];
                const prev = merged[merged.length - 1];
                if (cur[0] <= prev[1] + 0.04) {
                    prev[1] = Math.max(prev[1], cur[1]);
                } else {
                    merged.push(cur.slice());
                }
            }
            return merged;
        };

        const clearRuns = (blocked, lo, hi) => {
            const runs = [];
            let cursor = lo;
            for (const [s, e] of blocked) {
                if (s > cursor + minRun) runs.push([cursor, s]);
                cursor = Math.max(cursor, e);
            }
            if (hi > cursor + minRun) runs.push([cursor, hi]);
            return runs;
        };

        const touchesCorridorSpine = (dir, start, end, fixed0, fixed1) => {
            if (dir === 'horizontal') {
                let hits = 0;
                for (const c of baseVertical) {
                    const cy0 = c.y;
                    const cy1 = c.y + c.height;
                    if (cy1 < fixed0 - 0.02 || cy0 > fixed1 + 0.02) continue;
                    const cx = c.x + c.width / 2;
                    if (cx >= start - 0.05 && cx <= end + 0.05) hits += 1;
                }
                return hits >= 2;
            }
            let hits = 0;
            for (const c of baseHorizontal) {
                const cx0 = c.x;
                const cx1 = c.x + c.width;
                if (cx1 < fixed0 - 0.02 || cx0 > fixed1 + 0.02) continue;
                const cy = c.y + c.height / 2;
                if (cy >= start - 0.05 && cy <= end + 0.05) hits += 1;
            }
            return hits >= 2;
        };

        const candidateHallways = [];

        // --- Horizontal connectors ---
        if (shouldScanHorizontal) for (let y = minY; y < maxY - cw; y += step) {
            const stripY0 = y;
            const stripY1 = y + cw;
            const blocked = [];

            for (const box of boxes) {
                if (box.y < stripY1 && box.y + box.h > stripY0) {
                    blocked.push([box.x - boxPad, box.x + box.w + boxPad]);
                }
            }
            for (const seg of this.wallSegments) {
                const wMinY = Math.min(seg.y1, seg.y2);
                const wMaxY = Math.max(seg.y1, seg.y2);
                const wMinX = Math.min(seg.x1, seg.x2);
                const wMaxX = Math.max(seg.x1, seg.x2);
                const isMostlyVerticalWall = (wMaxX - wMinX) <= (wMaxY - wMinY);
                if (!isMostlyVerticalWall) continue;
                if (wMinY < stripY1 && wMaxY > stripY0) {
                    const cx = (wMinX + wMaxX) * 0.5;
                    blocked.push([cx - wallPad, cx + wallPad]);
                }
            }

            const merged = mergeIntervals(blocked, minX, maxX);
            const runs = clearRuns(merged, minX, maxX);
            for (const [sx, ex] of runs) {
                const len = ex - sx;
                if (len < minRunHorizontal) continue;
                const linked = touchesCorridorSpine('horizontal', sx, ex, stripY0, stripY1);
                const longEnoughToStandAlone = len >= longRunThreshold;
                if (!linked && !longEnoughToStandAlone && len < cw * 2.2) continue;
                candidateHallways.push({
                    type: 'ACCESS',
                    direction: 'horizontal',
                    isMainHallway: true,
                    x: sx,
                    y: stripY0,
                    width: len,
                    height: cw
                });
            }
        }

        // --- Vertical connectors ---
        if (shouldScanVertical) for (let x = minX; x < maxX - cw; x += step) {
            const stripX0 = x;
            const stripX1 = x + cw;
            const blocked = [];

            for (const box of boxes) {
                if (box.x < stripX1 && box.x + box.w > stripX0) {
                    blocked.push([box.y - boxPad, box.y + box.h + boxPad]);
                }
            }
            for (const seg of this.wallSegments) {
                const wMinX = Math.min(seg.x1, seg.x2);
                const wMaxX = Math.max(seg.x1, seg.x2);
                const wMinY = Math.min(seg.y1, seg.y2);
                const wMaxY = Math.max(seg.y1, seg.y2);
                const isMostlyHorizontalWall = (wMaxY - wMinY) <= (wMaxX - wMinX);
                if (!isMostlyHorizontalWall) continue;
                if (wMinX < stripX1 && wMaxX > stripX0) {
                    const cy = (wMinY + wMaxY) * 0.5;
                    blocked.push([cy - wallPad, cy + wallPad]);
                }
            }

            const merged = mergeIntervals(blocked, minY, maxY);
            const runs = clearRuns(merged, minY, maxY);
            for (const [sy, ey] of runs) {
                const len = ey - sy;
                if (len < minRunVertical) continue;
                const linked = touchesCorridorSpine('vertical', sy, ey, stripX0, stripX1);
                const longEnoughToStandAlone = len >= longRunThreshold;
                if (!linked && !longEnoughToStandAlone && len < cw * 2.2) continue;
                candidateHallways.push({
                    type: 'ACCESS',
                    direction: 'vertical',
                    isMainHallway: true,
                    x: stripX0,
                    y: sy,
                    width: cw,
                    height: len
                });
            }
        }

        const dedupe = new Set();
        for (const h of candidateHallways) {
            if (this._boxHitsWall(h.x, h.y, h.width, h.height)) continue;
            if (this._boxHitsObstacle(h.x, h.y, h.width, h.height, { ignoreEntrances: true })) continue;
            const key = [
                h.direction,
                Math.round((h.x + h.width / 2) / (cw * 0.5)),
                Math.round((h.y + h.height / 2) / (cw * 0.5)),
                Math.round(h.width / (cw * 0.5)),
                Math.round(h.height / (cw * 0.5))
            ].join('|');
            if (dedupe.has(key)) continue;
            dedupe.add(key);
            hallways.push(h);
        }

        console.log(`[CostoProLayout v4] Main hallway scan: ${candidateHallways.length} segments (before dedupe/filter)`);
        return hallways;
    }

    // ─────────────────────────────────────────────────────────────────
    //  Double-loaded row placement within a zone (bay-aware)
    // ─────────────────────────────────────────────────────────────────

    _planBayStrips(bay, startId, sizes, sizeIdx) {
        const units = [];
        const corridors = [];
        const cw = this.corridorWidth;
        const bd = this.boxDepth;
        const sp = this.boxSpacing;
        const cl = this.wallClearance;

        const isHorizontal = bay.orientation === 'horizontal';
        const bayW = bay.maxX - bay.minX;
        const bayH = bay.maxY - bay.minY;
        if (bayW <= 0 || bayH <= 0) {
            return { units, corridors, nextSizeIdx: sizeIdx };
        }

        // Row positions anchored from walls: one row on each side of the corridor.
        let primaryLen, runStart, runEnd;
        let row1, row2, corridorRect;

        if (isHorizontal) {
            // Corridor runs along X, rows sit below and above corridor.
            // Use real wall face anchors when available (from wall-geometry-aware _detectBays).
            const bottomFace = Number.isFinite(bay.wallMinY) ? bay.wallMinY : bay.minY;
            const topFace = Number.isFinite(bay.wallMaxY) ? bay.wallMaxY : bay.maxY;
            const neededH = bd * 2 + cw + cl * 2;
            if (topFace - bottomFace < neededH) {
                return { units, corridors, nextSizeIdx: sizeIdx };
            }
            const bottomRowY = bottomFace + cl;
            const corridorY = bottomRowY + bd;
            const topRowY = corridorY + cw;

            row1 = { side: 'bottom', x0: bay.minX + cl, y: bottomRowY, widthDir: 'x' };
            row2 = { side: 'top', x0: bay.minX + cl, y: topRowY, widthDir: 'x' };
            primaryLen = bayW - cl * 2;
            runStart = bay.minX + cl;
            runEnd = bay.maxX - cl;
            corridorRect = {
                type: 'ACCESS',
                direction: 'horizontal',
                x: runStart,
                y: corridorY,
                width: primaryLen,
                height: cw
            };
        } else {
            // Corridor runs along Y, rows sit left and right.
            // Use real wall face anchors when available.
            const leftFace = Number.isFinite(bay.wallMinX) ? bay.wallMinX : bay.minX;
            const rightFace = Number.isFinite(bay.wallMaxX) ? bay.wallMaxX : bay.maxX;
            const neededW = bd * 2 + cw + cl * 2;
            if (rightFace - leftFace < neededW) {
                return { units, corridors, nextSizeIdx: sizeIdx };
            }
            const leftRowX = leftFace + cl;
            const corridorX = leftRowX + bd;
            const rightRowX = corridorX + cw;

            row1 = { side: 'left', y0: bay.minY + cl, x: leftRowX, widthDir: 'y' };
            row2 = { side: 'right', y0: bay.minY + cl, x: rightRowX, widthDir: 'y' };
            primaryLen = bayH - cl * 2;
            runStart = bay.minY + cl;
            runEnd = bay.maxY - cl;
            corridorRect = {
                type: 'ACCESS',
                direction: 'vertical',
                x: corridorX,
                y: runStart,
                width: cw,
                height: primaryLen
            };
        }

        const widthOrder = [3.49, 3.29, 2.49, 2.29, 1.59, 1.49, 1.39, 1.29, 1.0, 0.9, 0.8];

        const placeRow = (row, isSecondRow) => {
            let cursor = runStart;
            while (cursor + this.minGapLength <= runEnd) {
                // Greedy: try larger widths first but keep catalog distribution via sizes[sizeIdx].
                let chosenWidth = null;
                let chosenSize = null;

                for (const w of widthOrder) {
                    const size = sizes[sizeIdx % sizes.length];
                    const targetW = size.width || w;
                    if (cursor + targetW > runEnd + 1e-6) continue;
                    chosenWidth = targetW;
                    chosenSize = size;
                    break;
                }

                if (!chosenWidth) break;
                sizeIdx++;

                let bx, by, bw, bh;
                if (isHorizontal) {
                    bx = this._snapToPlacementGrid(cursor);
                    by = this.rowAlignmentStep ? this._snapToRowAlignment(row.y) : row.y;
                    bw = chosenWidth;
                    bh = bd;
                } else {
                    bx = this._snapToPlacementGrid(row.x);
                    by = this.rowAlignmentStep ? this._snapToRowAlignment(cursor) : cursor;
                    bw = bd;
                    bh = chosenWidth;
                }

                if (this._isBoxValid(bx, by, bw, bh)) {
                    const unit = this._makeUnit(
                        startId + units.length,
                        bx,
                        by,
                        bw,
                        bh,
                        chosenSize,
                        row.side,
                        !isHorizontal
                    );
                    units.push(unit);
                }

                cursor += chosenWidth + sp;
            }
        };

        placeRow(row1, false);
        placeRow(row2, true);

        if (units.length > 0) {
            corridors.push(corridorRect);
        }

        return { units, corridors, nextSizeIdx: sizeIdx };
    }

    _placeRowsInZone(zone, startId, sizes, sizeIdx) {
        // If we have bay metadata for this zone, prefer bay-based planning.
        const baysForZone = zone && zone.id && this._baysByZoneId
            ? this._baysByZoneId.get(zone.id) || []
            : [];

        const units = [];
        const corridors = [];

        if (baysForZone.length > 0) {
            for (const bay of baysForZone) {
                const result = this._planBayStrips(bay, startId + units.length, sizes, sizeIdx);
                units.push(...(result.units || []));
                corridors.push(...(result.corridors || []));
                sizeIdx = result.nextSizeIdx;
            }
        } else {
            // Fallback to legacy zone-based strips when no bay exists for this zone.
            const cw = this.corridorWidth;
            const bd = this.boxDepth;
            const sp = this.boxSpacing;
            const stripWidth = bd + cw + bd;
            const zW = zone.maxX - zone.minX;
            const zH = zone.maxY - zone.minY;
            const numStripsH = Math.floor(zW / stripWidth);
            const numStripsV = Math.floor(zH / stripWidth);
            const useVerticalStrips = numStripsV > numStripsH && zW > zH * 0.6;
            const numStrips = useVerticalStrips ? numStripsV : numStripsH;

            if (numStrips < 1) {
                return this._placeSingleRowInZone(zone, startId, sizes, sizeIdx);
            }

            const zUnits = [];
            const zCorridors = [];

            for (let s = 0; s < numStrips; s++) {
                const stripStart = this._snapToPlacementGrid((useVerticalStrips ? zone.minY : zone.minX) + s * stripWidth);
                const leftStart = stripStart;
                const corridorStart = stripStart + bd;
                const rightStart = stripStart + bd + cw;
                const fillStart = this._snapToPlacementGrid(useVerticalStrips ? zone.minX : zone.minY);
                const fillEnd = useVerticalStrips ? zone.maxX : zone.maxY;
                let corridorHasBoxes = false;

                let cur = fillStart;
                while (cur + this.minGapLength <= fillEnd) {
                    const size = sizes[sizeIdx % sizes.length]; sizeIdx++;
                    const boxW = size.width;
                    if (cur + boxW > fillEnd) break;

                    const bx = this._snapToPlacementGrid(useVerticalStrips ? cur : leftStart);
                    const by = this._snapToPlacementGrid(useVerticalStrips ? leftStart : cur);
                    const bw = useVerticalStrips ? boxW : bd;
                    const bh = useVerticalStrips ? bd : boxW;

                    if (this._isBoxValid(bx, by, bw, bh)) {
                        zUnits.push(this._makeUnit(startId + units.length + zUnits.length, bx, by, bw, bh, size, 'left', useVerticalStrips));
                        corridorHasBoxes = true;
                    }
                    cur += boxW + sp;
                }

                cur = fillStart;
                while (cur + this.minGapLength <= fillEnd) {
                    const size = sizes[sizeIdx % sizes.length]; sizeIdx++;
                    const boxW = size.width;
                    if (cur + boxW > fillEnd) break;

                    const bx = this._snapToPlacementGrid(useVerticalStrips ? cur : rightStart);
                    const by = this._snapToPlacementGrid(useVerticalStrips ? rightStart : cur);
                    const bw = useVerticalStrips ? boxW : bd;
                    const bh = useVerticalStrips ? bd : boxW;

                    if (this._isBoxValid(bx, by, bw, bh)) {
                        zUnits.push(this._makeUnit(startId + units.length + zUnits.length, bx, by, bw, bh, size, 'right', useVerticalStrips));
                        corridorHasBoxes = true;
                    }
                    cur += boxW + sp;
                }

                if (corridorHasBoxes) {
                    const boxPositions = zUnits
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
                        let segStart = boxPositions[0].start;
                        let segEnd = boxPositions[0].end;

                        for (let i = 1; i <= boxPositions.length; i++) {
                            const bp = i < boxPositions.length ? boxPositions[i] : null;
                            if (bp && bp.start <= segEnd + sp * 2) {
                                segEnd = Math.max(segEnd, bp.end);
                            } else {
                                const segLen = segEnd - segStart;
                                if (segLen >= this.minGapLength) {
                                    if (useVerticalStrips) {
                                        zCorridors.push({
                                            type: 'ACCESS', direction: 'horizontal',
                                            x: segStart, y: corridorStart, width: segLen, height: cw
                                        });
                                    } else {
                                        zCorridors.push({
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

            units.push(...zUnits);
            corridors.push(...zCorridors);

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
        const fillStart = this._snapToPlacementGrid(horizontal ? zone.minX : zone.minY);
        const fillEnd = horizontal ? zone.maxX : zone.maxY;
        const rowStart = this._snapToPlacementGrid(horizontal ? zone.minY : zone.minX);
        const rowDepth = Math.min(bd, horizontal ? zH : zW);

        let cur = fillStart;
        while (cur + this.minGapLength <= fillEnd) {
            const size = sizes[sizeIdx % sizes.length]; sizeIdx++;
            const boxW = size.width;
            if (cur + boxW > fillEnd) break;

            const bx = this._snapToPlacementGrid(horizontal ? cur : rowStart);
            const by = this._snapToPlacementGrid(horizontal ? rowStart : cur);
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

    _buildWallHuggingCollisionWalls(perimeterWalls) {
        const allWalls = Array.isArray(this.wallSegments) ? this.wallSegments : [];
        const perimeter = Array.isArray(perimeterWalls) ? perimeterWalls : [];
        if (!allWalls.length) return [];
        if (!perimeter.length) return allWalls.slice();

        const distanceTolerance = Math.max(0.08, Math.min(0.35, this.wallClearance + 0.12));
        const orientationThreshold = 0.82;
        const collisionWalls = allWalls.filter(
            (seg) => !this._segmentMatchesPerimeter(seg, perimeter, distanceTolerance, orientationThreshold)
        );

        // Only hard-fallback when everything got filtered out.
        if (collisionWalls.length === 0) {
            return allWalls.slice();
        }
        return collisionWalls;
    }

    _segmentMatchesPerimeter(seg, perimeterWalls, distanceTolerance = 0.2, orientationThreshold = 0.82) {
        if (!seg || !Array.isArray(perimeterWalls) || perimeterWalls.length === 0) return false;

        const dx = Number(seg.x2) - Number(seg.x1);
        const dy = Number(seg.y2) - Number(seg.y1);
        const len = Math.hypot(dx, dy);
        if (!Number.isFinite(len) || len < 0.12) return false;

        const midX = (Number(seg.x1) + Number(seg.x2)) / 2;
        const midY = (Number(seg.y1) + Number(seg.y2)) / 2;
        for (const outer of perimeterWalls) {
            if (!outer) continue;
            const odx = Number(outer.x2) - Number(outer.x1);
            const ody = Number(outer.y2) - Number(outer.y1);
            const olen = Math.hypot(odx, ody);
            if (!Number.isFinite(olen) || olen < 0.12) continue;

            const orientation = Math.abs((dx * odx + dy * ody) / (len * olen));
            if (orientation < orientationThreshold) continue;

            const dMid = this._pointToSegDist(midX, midY, outer.x1, outer.y1, outer.x2, outer.y2);
            if (!Number.isFinite(dMid) || dMid > distanceTolerance) continue;

            const dStart = this._pointToSegDist(seg.x1, seg.y1, outer.x1, outer.y1, outer.x2, outer.y2);
            const dEnd = this._pointToSegDist(seg.x2, seg.y2, outer.x1, outer.y1, outer.x2, outer.y2);
            if (dStart <= distanceTolerance * 1.35 || dEnd <= distanceTolerance * 1.35 || dMid <= distanceTolerance * 0.8) {
                return true;
            }
        }
        return false;
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

    _getOuterPerimeterPolygon() {
        if (this._outerPerimeterResolved) return this._outerPerimeterPolygon;
        this._outerPerimeterResolved = true;

        try {
            const helper = new WallHuggingPlacer({
                bounds: this.bounds,
                walls: this.walls,
                envelope: this.envelope
            }, {
                minSegmentLength: this.minGapLength,
                clearance: Math.max(this.wallClearance, this.wallClearanceMm / 1000),
                boxDepth: this.boxDepth
            });
            const perimeter = helper.computePerimeterSegments();
            if (Array.isArray(perimeter?.perimeterPolygon) && perimeter.perimeterPolygon.length >= 3) {
                this._outerPerimeterPolygon = perimeter.perimeterPolygon
                    .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
                    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
                this._outerPerimeterSource = perimeter.source || 'unknown';

                const poly = this._outerPerimeterPolygon;
                const signedArea = (pts) => {
                    let area = 0;
                    for (let i = 0; i < pts.length; i++) {
                        const p1 = pts[i];
                        const p2 = pts[(i + 1) % pts.length];
                        area += p1.x * p2.y - p2.x * p1.y;
                    }
                    return area / 2;
                };
                const areaAbs = Math.abs(signedArea(poly));
                const bw = Math.max(1e-6, this.bounds.maxX - this.bounds.minX);
                const bh = Math.max(1e-6, this.bounds.maxY - this.bounds.minY);
                const boundsArea = bw * bh;
                const minX = Math.min(...poly.map((p) => p.x));
                const maxX = Math.max(...poly.map((p) => p.x));
                const minY = Math.min(...poly.map((p) => p.y));
                const maxY = Math.max(...poly.map((p) => p.y));
                const widthCoverage = Math.max(0, (maxX - minX) / bw);
                const heightCoverage = Math.max(0, (maxY - minY) / bh);
                const areaCoverage = boundsArea > 1e-6 ? areaAbs / boundsArea : 1;
                const source = String(this._outerPerimeterSource || 'unknown');
                const reliable =
                    source === 'boundsFallback' ||
                    (areaCoverage >= 0.45 && widthCoverage >= 0.68 && heightCoverage >= 0.68);

                if (!reliable) {
                    this._outerPerimeterPolygon = null;
                    this._outerPerimeterSource = `rejected:${source}`;
                    console.log(
                        `[CostoProLayout v4] Perimeter loop rejected (coverage=${areaCoverage.toFixed(2)}, ` +
                        `w=${widthCoverage.toFixed(2)}, h=${heightCoverage.toFixed(2)}), fallback=bounds`
                    );
                }
            }
        } catch (err) {
            this._outerPerimeterPolygon = null;
            this._outerPerimeterSource = 'error';
            console.warn('[CostoProLayout v4] Outer perimeter detection failed:', err.message);
        }

        return this._outerPerimeterPolygon;
    }

    _isRectInsideOuterPerimeter(rect, tolerance = 0.05) {
        if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return false;
        const polygon = this._getOuterPerimeterPolygon();
        if (!Array.isArray(polygon) || polygon.length < 3) return true;
        return this._wallHuggingRectInsidePolygon(rect, polygon, tolerance);
    }

    _buildFallbackCirculationPaths(corridors) {
        return (Array.isArray(corridors) ? corridors : [])
            .filter((c) => c && Number.isFinite(c.x) && Number.isFinite(c.y) && c.width > 0 && c.height > 0)
            .map((c) => {
                const isHorizontal = c.direction === 'horizontal' || c.width >= c.height;
                return {
                    type: 'SPINE',
                    style: 'dashed_lightblue',
                    path: isHorizontal
                        ? [{ x: c.x, y: c.y + c.height / 2 }, { x: c.x + c.width, y: c.y + c.height / 2 }]
                        : [{ x: c.x + c.width / 2, y: c.y }, { x: c.x + c.width / 2, y: c.y + c.height }]
                };
            });
    }

    _corridorCenterlineCovered(corridor, circulationPaths) {
        if (!corridor || !Array.isArray(circulationPaths) || circulationPaths.length === 0) return false;
        const cx = corridor.x + corridor.width / 2;
        const cy = corridor.y + corridor.height / 2;
        const tol = Math.min(corridor.width, corridor.height) * 0.4;
        for (const cp of circulationPaths) {
            const path = cp.path || [];
            for (let i = 0; i < path.length - 1; i++) {
                const p1 = path[i];
                const p2 = path[i + 1];
                const px = Number(p1.x);
                const py = Number(p1.y);
                if (Number.isFinite(px) && Number.isFinite(py) && Math.abs(px - cx) <= tol && Math.abs(py - cy) <= tol) return true;
            }
            const last = path[path.length - 1];
            if (last && Number.isFinite(last.x) && Number.isFinite(last.y) && Math.abs(last.x - cx) <= tol && Math.abs(last.y - cy) <= tol) return true;
        }
        return false;
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
