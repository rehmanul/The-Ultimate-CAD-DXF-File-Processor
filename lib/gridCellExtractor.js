/**
 * Grid Cell Extractor (orthogonal DXF wall grids)
 * هدف: استخراج "خلايا" (مستطيلات) من شبكة خطوط الجدران (LINE) لاستخدامها كـ boxes/îlots
 *
 * This is a pragmatic V1 extractor for orthogonal plans like COSTO Test2.dxf:
 * - Detect vertical/horizontal wall segments
 * - Build interval maps (x -> y-intervals, y -> x-intervals)
 * - Enumerate adjacent x,y coordinates as candidate cells
 * - Validate that all 4 edges are covered by wall intervals
 */

function isFiniteNum(n) {
    return typeof n === 'number' && Number.isFinite(n);
}

function snap(n, tol) {
    return Math.round(n / tol) * tol;
}

function mergeIntervals(intervals, tol = 1e-6) {
    if (!Array.isArray(intervals) || intervals.length === 0) return [];
    const sorted = intervals
        .map(([a, b]) => [Math.min(a, b), Math.max(a, b)])
        .sort((i1, i2) => i1[0] - i2[0]);
    const merged = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        const [s, e] = sorted[i];
        const last = merged[merged.length - 1];
        if (s <= last[1] + tol) {
            last[1] = Math.max(last[1], e);
        } else {
            merged.push([s, e]);
        }
    }
    return merged;
}

function intervalCovers(mergedIntervals, start, end, tol = 1e-3) {
    const s = Math.min(start, end) - tol;
    const e = Math.max(start, end) + tol;
    for (const [a, b] of mergedIntervals) {
        if (a <= s && b >= e) return true;
    }
    return false;
}

function normalizeWallsToSegments(walls) {
    const segs = [];
    for (const w of walls || []) {
        if (w && w.start && w.end && isFiniteNum(w.start.x) && isFiniteNum(w.start.y) && isFiniteNum(w.end.x) && isFiniteNum(w.end.y)) {
            segs.push({ x1: w.start.x, y1: w.start.y, x2: w.end.x, y2: w.end.y });
        } else if (w && isFiniteNum(w.x1) && isFiniteNum(w.y1) && isFiniteNum(w.x2) && isFiniteNum(w.y2)) {
            segs.push({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 });
        }
    }
    return segs;
}

function pickTypeByArea(area, unitMix, distribution) {
    const a = Number(area);
    if (!Number.isFinite(a)) return 'M';

    // Prefer unitMix ranges if provided with minArea/maxArea
    if (Array.isArray(unitMix) && unitMix.length) {
        const ranges = unitMix
            .map((t) => ({
                name: t.name || t.type || 'M',
                min: Number.isFinite(Number(t.minArea)) ? Number(t.minArea) : null,
                max: Number.isFinite(Number(t.maxArea)) ? Number(t.maxArea) : null,
                target: Number.isFinite(Number(t.targetArea)) ? Number(t.targetArea) : null
            }))
            .filter(r => r.min !== null && r.max !== null);
        for (const r of ranges) {
            if (a >= r.min - 1e-6 && a <= r.max + 1e-6) return r.name;
        }
    }

    // Fallback: parse distribution keys like "0-1", "1-3", ...
    if (distribution && typeof distribution === 'object') {
        const entries = Object.keys(distribution)
            .map((k) => {
                const parts = String(k).split('-').map(Number);
                if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
                    return { key: k, min: Math.min(parts[0], parts[1]), max: Math.max(parts[0], parts[1]) };
                }
                return null;
            })
            .filter(Boolean)
            .sort((a1, a2) => a1.min - a2.min);
        for (const e of entries) {
            if (a >= e.min - 1e-6 && a <= e.max + 1e-6) return e.key;
        }
    }

    return 'M';
}

/**
 * Extract grid cells as ilots.
 * @param {Object} floorPlan normalized floorPlan
 * @param {Object} distribution normalized distribution object (weights or percents)
 * @param {Array} unitMix unitMix typologies (optional)
 * @param {Object} options extractor options
 */
function extractGridCells(floorPlan, distribution, unitMix, options = {}) {
    const bounds = floorPlan?.bounds;
    if (!bounds) return [];

    const tol = Number.isFinite(options.snapTolerance) ? options.snapTolerance : 0.05; // meters
    const angleTol = Number.isFinite(options.angleTolerance) ? options.angleTolerance : 1e-3;
    const minCellSize = Number.isFinite(options.minCellSize) ? options.minCellSize : 0.6; // m
    const maxCellArea = Number.isFinite(options.maxCellArea) ? options.maxCellArea : 40; // m²
    const minCellArea = Number.isFinite(options.minCellArea) ? options.minCellArea : 0.5; // m²

    const segs = normalizeWallsToSegments(floorPlan.walls || []);
    if (segs.length < 50) return []; // not a grid-like plan

    const vertical = new Map();   // x -> intervals on y
    const horizontal = new Map(); // y -> intervals on x
    const xsSet = new Set();
    const ysSet = new Set();

    for (const s of segs) {
        const dx = s.x2 - s.x1;
        const dy = s.y2 - s.y1;
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue;

        if (Math.abs(dx) <= angleTol && Math.abs(dy) > angleTol) {
            const x = snap(s.x1, tol);
            const yA = snap(s.y1, tol);
            const yB = snap(s.y2, tol);
            xsSet.add(x);
            ysSet.add(yA); ysSet.add(yB);
            if (!vertical.has(x)) vertical.set(x, []);
            vertical.get(x).push([yA, yB]);
        } else if (Math.abs(dy) <= angleTol && Math.abs(dx) > angleTol) {
            const y = snap(s.y1, tol);
            const xA = snap(s.x1, tol);
            const xB = snap(s.x2, tol);
            ysSet.add(y);
            xsSet.add(xA); xsSet.add(xB);
            if (!horizontal.has(y)) horizontal.set(y, []);
            horizontal.get(y).push([xA, xB]);
        }
    }

    const xs = Array.from(xsSet).sort((a, b) => a - b);
    const ys = Array.from(ysSet).sort((a, b) => a - b);

    // Merge intervals for fast coverage checks
    const vMerged = new Map();
    for (const [x, intervals] of vertical.entries()) vMerged.set(x, mergeIntervals(intervals, tol));
    const hMerged = new Map();
    for (const [y, intervals] of horizontal.entries()) hMerged.set(y, mergeIntervals(intervals, tol));

    // Limit worst-case enumeration
    const maxX = Number.isFinite(options.maxX) ? options.maxX : 600;
    const maxY = Number.isFinite(options.maxY) ? options.maxY : 600;
    const xsLim = xs.slice(0, maxX);
    const ysLim = ys.slice(0, maxY);

    const cells = [];
    for (let xi = 0; xi < xsLim.length - 1; xi++) {
        const x1 = xsLim[xi];
        const x2 = xsLim[xi + 1];
        const w = x2 - x1;
        if (w < minCellSize) continue;
        if (!vMerged.has(x1) || !vMerged.has(x2)) continue;

        for (let yi = 0; yi < ysLim.length - 1; yi++) {
            const y1 = ysLim[yi];
            const y2 = ysLim[yi + 1];
            const h = y2 - y1;
            if (h < minCellSize) continue;
            if (!hMerged.has(y1) || !hMerged.has(y2)) continue;

            const area = w * h;
            if (area < minCellArea || area > maxCellArea) continue;

            // Must be within plan bounds
            if (x1 < bounds.minX - tol || x2 > bounds.maxX + tol || y1 < bounds.minY - tol || y2 > bounds.maxY + tol) continue;

            // Validate 4 edges coverage by wall intervals
            const leftOk = intervalCovers(vMerged.get(x1), y1, y2, tol);
            const rightOk = intervalCovers(vMerged.get(x2), y1, y2, tol);
            const bottomOk = intervalCovers(hMerged.get(y1), x1, x2, tol);
            const topOk = intervalCovers(hMerged.get(y2), x1, x2, tol);
            if (!(leftOk && rightOk && bottomOk && topOk)) continue;

            const cx = x1 + w / 2;
            const cy = y1 + h / 2;

            const type = pickTypeByArea(area, unitMix, distribution);
            cells.push({
                x: x1,
                y: y1,
                width: w,
                height: h,
                area,
                type,
                center: { x: cx, y: cy }
            });
        }
    }

    // Stable sort for nicer numbering (top-left to bottom-right)
    cells.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    cells.forEach((c, idx) => {
        c.id = `BOX_${idx + 1}`;
        c.label = `${c.area.toFixed(1)}m2`;
    });

    return cells;
}

module.exports = { extractGridCells };

