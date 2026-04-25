'use strict';

/**
 * CorridorShadowAnalyzer — corridors-first layout foundation
 *
 * Given a floor plan and layout parameters, this module:
 *   1. Computes horizontal aisle Y-positions (layout skeleton)
 *   2. For each aisle, clips the full-width band to contiguous X-ranges
 *      that are free of walls and obstacles ("corridor shadows")
 *   3. Returns structured data: for each shadow → {x0, x1, aisleY,
 *      aisleH, rowBelowY, rowAboveY, rowH}
 *
 * The caller (BoxPlacer) then places boxes into the above/below row
 * bands of each shadow, packing flush with zero gaps.
 */
class CorridorShadowAnalyzer {
    /**
     * @param {object} bounds        - {minX, minY, maxX, maxY}
     * @param {Array}  wallSegs      - [{x1,y1,x2,y2,len}] all wall segments
     * @param {Array}  obstacleRects - [{x,y,w,h}] forbidden zones + entrances
     * @param {object} options
     *   @param {number} options.boxDepth       - depth of each box row (m)
     *   @param {number} options.corridorWidth  - width of each aisle (m)
     *   @param {number} options.minBoxWidth    - minimum allowed box width (m)
     *   @param {number} options.wallClearance  - extra clearance around walls inside gap detection (m)
     */
    constructor(bounds, wallSegs, obstacleRects, options = {}) {
        this.bounds = bounds;
        this.wallSegs = Array.isArray(wallSegs) ? wallSegs : [];
        this.obstacles = Array.isArray(obstacleRects) ? obstacleRects : [];
        this.boxDepth = Math.max(1.0, +(options.boxDepth ?? 1.60));
        this.corridorWidth = Math.max(0.5, +(options.corridorWidth ?? 0.70));
        this.minBoxWidth = Math.max(0.4, +(options.minBoxWidth ?? 0.70));
        this.wallClearance = Math.max(0.0, +(options.wallClearance ?? 0.05));
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Public API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Compute aisle layout and wall-clipped corridor shadows.
     *
     * @returns {Array} shadows — each entry:
     *   {
     *     x0, x1,           // wall-free X range of this corridor segment
     *     aisleY, aisleH,   // corridor band Y position and height
     *     rowBelowY,        // bottom box row top edge
     *     rowAboveY,        // top box row top edge
     *     rowH,             // box row height (= boxDepth, possibly capped at bounds)
     *   }
     */
    analyze() {
        const aisles = this._computeAislePositions();
        const shadows = [];

        for (const aisle of aisles) {
            const gaps = this._clipToWallFreeGaps(
                aisle.aisleY, aisle.aisleH,
                this.bounds.minX, this.bounds.maxX
            );

            for (const gap of gaps) {
                if (gap.x1 - gap.x0 < this.minBoxWidth * 2) continue; // too narrow for any boxes
                shadows.push({
                    x0: gap.x0,
                    x1: gap.x1,
                    aisleY:    aisle.aisleY,
                    aisleH:    aisle.aisleH,
                    rowBelowY: aisle.rowBelowY,
                    rowAboveY: aisle.rowAboveY,
                    rowH:      aisle.rowH,
                });
            }
        }

        console.log(
            `[ShadowAnalyzer] ${aisles.length} aisles → ${shadows.length} shadows ` +
            `(boxDepth=${this.boxDepth}m, corridorWidth=${this.corridorWidth}m)`
        );
        return shadows;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Step 1: Compute aisle Y positions
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Lay horizontal aisle bands across the plan from bottom to top.
     * Pattern (repeating):  [row↓] [aisle] [row↑]
     * The strip height = boxDepth + corridorWidth + boxDepth.
     *
     * @returns {Array} [{aisleY, aisleH, rowBelowY, rowAboveY, rowH}]
     */
    _computeAislePositions() {
        const { minX, minY, maxX, maxY } = this.bounds;
        const planH = maxY - minY;
        const bd = this.boxDepth;
        const cw = this.corridorWidth;
        const stripH = bd + cw + bd;

        if (planH < stripH * 0.7) {
            // Plan too shallow for even one complete strip — try a single aisle
            const aisleY = minY + planH * 0.4;
            const rowH = Math.max(0.5, (planH - cw) / 2);
            return [{
                aisleY,
                aisleH: Math.min(cw, planH - rowH),
                rowBelowY: minY,
                rowAboveY: aisleY + Math.min(cw, planH - rowH),
                rowH
            }];
        }

        const numStrips = Math.max(1, Math.floor(planH / stripH));
        // Divide evenly so rows fill the plan without leftover gaps
        const exactStripH = planH / numStrips;
        // Scale bd/cw proportionally to preserve their ratio
        const scale = exactStripH / stripH;
        const scaledBd = bd * scale;
        const scaledCw = cw * scale;

        const aisles = [];
        for (let s = 0; s < numStrips; s++) {
            const stripY = minY + s * exactStripH;
            const rowBelowY  = stripY;
            const aisleY     = stripY + scaledBd;
            const rowAboveY  = aisleY + scaledCw;
            const rowH       = scaledBd;
            aisles.push({ aisleY, aisleH: scaledCw, rowBelowY, rowAboveY, rowH });
        }
        return aisles;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Step 2: Clip aisle band to wall-free X-gaps
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * For a corridor band at [aisleY … aisleY+aisleH] spanning [xStart … xEnd],
     * find all contiguous X-ranges free of walls and obstacles.
     *
     * Algorithm:
     *  - Build sorted list of [xLeft, xRight] blocked ranges from walls/obstacles
     *    that overlap the aisle band in Y
     *  - Merge overlapping blocked ranges
     *  - Return complement (free gaps)
     *
     * @param {number} aisleY   - top of aisle band
     * @param {number} aisleH   - height of aisle band
     * @param {number} xStart   - left bound
     * @param {number} xEnd     - right bound
     * @returns {Array} [{x0, x1}] sorted, non-overlapping free X-intervals
     */
    _clipToWallFreeGaps(aisleY, aisleH, xStart, xEnd) {
        const yMin = aisleY;
        const yMax = aisleY + aisleH;
        const cl   = this.wallClearance;
        const blocked = []; // [{xL, xR}]

        // ── Wall segments ────────────────────────────────────────────────────
        // A vertical (or near-vertical) wall segment that crosses the aisle band
        // blocks a narrow X-range. A nearly-horizontal wall that runs along the
        // aisle is a perimeter wall — skip it (boxes touch perimeter walls).
        for (const seg of this.wallSegs) {
            const segYMin = Math.min(seg.y1, seg.y2);
            const segYMax = Math.max(seg.y1, seg.y2);
            const segXMin = Math.min(seg.x1, seg.x2);
            const segXMax = Math.max(seg.x1, seg.x2);

            // Must overlap the aisle Y band
            if (segYMax < yMin || segYMin > yMax) continue;

            const isHorizontalish = (segXMax - segXMin) > (segYMax - segYMin) * 2;
            if (isHorizontalish) {
                // Horizontal wall — check if it runs along aisle top/bottom edge
                // (perimeter wall) or truly bisects it
                const wallCenterY = (seg.y1 + seg.y2) / 2;
                const atTop    = Math.abs(wallCenterY - yMax) < 0.3;
                const atBottom = Math.abs(wallCenterY - yMin) < 0.3;
                if (atTop || atBottom) continue; // aisle-edge perimeter wall — skip
                // Horizontal wall bisecting the aisle — blocks its full X range
                blocked.push({ xL: segXMin - cl, xR: segXMax + cl });
            } else {
                // Vertical or diagonal wall crossing the aisle — blocks its X range
                const wallMidX = (seg.x1 + seg.x2) / 2;
                // Skip pure perimeter walls (on bounding box left/right edge)
                const onLeft  = Math.abs(wallMidX - xStart) < 0.5;
                const onRight = Math.abs(wallMidX - xEnd)   < 0.5;
                if (onLeft || onRight) continue;
                blocked.push({ xL: segXMin - cl, xR: segXMax + cl });
            }
        }

        // ── Obstacle rects (forbidden zones, entrances) ───────────────────────
        for (const ob of this.obstacles) {
            const obXMin = ob.x;
            const obXMax = ob.x + (ob.w ?? ob.width ?? 0);
            const obYMin = ob.y;
            const obYMax = ob.y + (ob.h ?? ob.height ?? 0);

            // Must overlap aisle band in Y
            if (obYMax < yMin || obYMin > yMax) continue;
            // Must be within X range
            if (obXMax < xStart || obXMin > xEnd) continue;

            blocked.push({ xL: obXMin - cl, xR: obXMax + cl });
        }

        // ── Build free gaps (complement of blocked) ───────────────────────────
        return this._complementGaps(blocked, xStart, xEnd, this.minBoxWidth * 0.5);
    }

    /**
     * Compute the complement of a set of possibly-overlapping blocked intervals
     * within [domainStart, domainEnd].
     * Returns free intervals longer than minLen.
     */
    _complementGaps(blocked, domainStart, domainEnd, minLen = 0.5) {
        if (blocked.length === 0) {
            return [{ x0: domainStart, x1: domainEnd }];
        }

        // Clamp and sort
        const ranges = blocked
            .map(b => ({ xL: Math.max(domainStart, b.xL), xR: Math.min(domainEnd, b.xR) }))
            .filter(b => b.xR > b.xL)
            .sort((a, b) => a.xL - b.xL);

        // Merge overlapping
        const merged = [{ ...ranges[0] }];
        for (let i = 1; i < ranges.length; i++) {
            const last = merged[merged.length - 1];
            if (ranges[i].xL <= last.xR + 0.01) {
                last.xR = Math.max(last.xR, ranges[i].xR);
            } else {
                merged.push({ ...ranges[i] });
            }
        }

        // Complement
        const gaps = [];
        let cursor = domainStart;
        for (const block of merged) {
            if (block.xL > cursor + minLen) {
                gaps.push({ x0: cursor, x1: block.xL });
            }
            cursor = Math.max(cursor, block.xR);
        }
        if (cursor < domainEnd - minLen) {
            gaps.push({ x0: cursor, x1: domainEnd });
        }

        return gaps;
    }
}

module.exports = CorridorShadowAnalyzer;
