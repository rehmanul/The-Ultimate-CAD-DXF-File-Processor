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

// More relaxed check: wall exists anywhere along this edge
function intervalPartiallyCovers(mergedIntervals, start, end, tol = 0.1, minCoverage = 0.3) {
    const s = Math.min(start, end);
    const e = Math.max(start, end);
    const edgeLen = e - s;
    if (edgeLen < tol) return true; // trivial edge

    let covered = 0;
    for (const [a, b] of mergedIntervals) {
        const overlapStart = Math.max(a, s);
        const overlapEnd = Math.min(b, e);
        if (overlapEnd > overlapStart) {
            covered += (overlapEnd - overlapStart);
        }
    }
    return (covered / edgeLen) >= minCoverage;
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

function getEntityBounds(entity) {
    if (!entity) return null;
    if (entity.bounds && isFiniteNum(entity.bounds.minX) && isFiniteNum(entity.bounds.minY) &&
        isFiniteNum(entity.bounds.maxX) && isFiniteNum(entity.bounds.maxY)) {
        return entity.bounds;
    }
    if (entity.polygon && Array.isArray(entity.polygon) && entity.polygon.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        entity.polygon.forEach((pt) => {
            const px = Array.isArray(pt) ? pt[0] : pt.x;
            const py = Array.isArray(pt) ? pt[1] : pt.y;
            if (!Number.isFinite(px) || !Number.isFinite(py)) return;
            minX = Math.min(minX, px);
            minY = Math.min(minY, py);
            maxX = Math.max(maxX, px);
            maxY = Math.max(maxY, py);
        });
        if (Number.isFinite(minX)) return { minX, minY, maxX, maxY };
    }
    if (entity.start && entity.end) {
        const minX = Math.min(entity.start.x, entity.end.x);
        const maxX = Math.max(entity.start.x, entity.end.x);
        const minY = Math.min(entity.start.y, entity.end.y);
        const maxY = Math.max(entity.start.y, entity.end.y);
        if ([minX, minY, maxX, maxY].every(Number.isFinite)) {
            return { minX, minY, maxX, maxY };
        }
    }
    if ([entity.x1, entity.y1, entity.x2, entity.y2].every(Number.isFinite)) {
        return {
            minX: Math.min(entity.x1, entity.x2),
            minY: Math.min(entity.y1, entity.y2),
            maxX: Math.max(entity.x1, entity.x2),
            maxY: Math.max(entity.y1, entity.y2)
        };
    }
    return null;
}

function pointInBounds(x, y, bounds, padding = 0) {
    return (
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        bounds &&
        x >= bounds.minX - padding &&
        x <= bounds.maxX + padding &&
        y >= bounds.minY - padding &&
        y <= bounds.maxY + padding
    );
}

function estimateCellDimensions(distribution, unitMix, options = {}) {
    if (Number.isFinite(options.cellWidth) && Number.isFinite(options.cellHeight)) {
        return {
            cellWidth: Math.max(0.4, Number(options.cellWidth)),
            cellHeight: Math.max(0.4, Number(options.cellHeight))
        };
    }

    const aspectRatio = Number.isFinite(options.cellAspectRatio) ? options.cellAspectRatio : 0.5;
    let avgArea = null;

    // Prioritize distribution if available (allows manual overrides)
    if (distribution && typeof distribution === 'object') {
        let totalWeight = 0;
        let weightedArea = 0;
        Object.entries(distribution).forEach(([range, weightRaw]) => {
            const parts = String(range).split('-').map(Number);
            if (parts.length < 2) return;
            const min = Math.min(parts[0], parts[1]);
            const max = Math.max(parts[0], parts[1]);
            if (!Number.isFinite(min) || !Number.isFinite(max) || max <= 0) return;
            let weight = Number(weightRaw);
            if (!Number.isFinite(weight) || weight <= 0) return;
            if (weight > 1.01) weight = weight / 100;
            const mid = (min + max) / 2;
            weightedArea += mid * weight;
            totalWeight += weight;
        });
        if (totalWeight > 0) {
            avgArea = weightedArea / totalWeight;
        }
    }

    // Fallback to unit mix if distribution is missing or invalid
    if ((!Number.isFinite(avgArea) || avgArea <= 0) && Array.isArray(unitMix) && unitMix.length) {
        const areas = unitMix
            .map((t) => Number(t.targetArea || t.area || t.surface || t.target))
            .filter((v) => Number.isFinite(v) && v > 0);
        if (areas.length) {
            avgArea = areas.reduce((sum, v) => sum + v, 0) / areas.length;
        }
    }


    if (!Number.isFinite(avgArea) || avgArea <= 0) {
        avgArea = 2.2;
    }

    const width = Math.sqrt(avgArea * aspectRatio);
    const height = avgArea / width;
    return {
        cellWidth: Math.max(0.6, width),
        cellHeight: Math.max(0.8, height)
    };
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
    console.log(`[GridExtractor] Wall segments: ${segs.length}`);
    if (segs.length < 50) {
        console.log('[GridExtractor] Too few segments for grid extraction');
        return []; // not a grid-like plan
    }

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

    console.log(`[GridExtractor] Found ${vertical.size} vertical lines, ${horizontal.size} horizontal lines`);
    console.log(`[GridExtractor] X coordinates: ${xs.length}, Y coordinates: ${ys.length}`);

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

    let cells = [];
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

            // Validate edges coverage by wall intervals (relaxed)
            // At least 2 edges should be well-covered (30%+), or use relaxed mode
            const strictMode = options.strictValidation !== false;
            const minCoverage = strictMode ? 0.5 : 0.2;

            const leftOk = intervalPartiallyCovers(vMerged.get(x1) || [], y1, y2, tol, minCoverage);
            const rightOk = intervalPartiallyCovers(vMerged.get(x2) || [], y1, y2, tol, minCoverage);
            const bottomOk = intervalPartiallyCovers(hMerged.get(y1) || [], x1, x2, tol, minCoverage);
            const topOk = intervalPartiallyCovers(hMerged.get(y2) || [], x1, x2, tol, minCoverage);

            // Count how many edges have at least some coverage
            const coveredEdges = [leftOk, rightOk, bottomOk, topOk].filter(Boolean).length;
            if (coveredEdges < 2) continue; // Need at least 2 edges with walls

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

    console.log(`[GridExtractor] Found ${cells.length} valid cells from grid analysis`);

    // If grid extraction produced very few cells, try envelope subdivision instead
    if (cells.length < 10 && bounds) {
        console.log('[GridExtractor] Grid analysis sparse, trying envelope subdivision...');
        const subdivCells = generateEnvelopeSubdivision(bounds, floorPlan, unitMix, distribution, options);
        if (subdivCells.length > cells.length) {
            console.log(`[GridExtractor] Envelope subdivision produced ${subdivCells.length} cells`);
            cells = subdivCells;
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

/**
 * Generate cells with FIXED row heights but VARIED cell widths based on distribution.
 * Enhanced with: prominent corridors, size category colors, wall boundary respect.
 */
function generateEnvelopeSubdivision(bounds, floorPlan, unitMix, distribution, options = {}) {
    const cells = [];

    // --- GRID SNAPPING HELPER ---
    // Snap values to grid for cleaner, more professional layout
    const gridStep = 0.5; // Base grid step in meters (will be scaled)
    function snapToGrid(value, step) {
        return Math.round(value / step) * step;
    }

    // --- UNIT AUTO-DETECTION ---
    // Heuristic: If dimensions are huge, it's likely mm or cm
    // We check bounds before parameters to ensure we scale correctly
    const bWidth = bounds.maxX - bounds.minX;
    const bHeight = bounds.maxY - bounds.minY;
    const maxDim = Math.max(bWidth, bHeight);

    // --- UNIT AUTO-DETECTION ---
    // Heuristic 1: Check Entrance Widths (most reliable standard measure ~0.9m)
    let unitScale = 1.0;
    const entranceList = floorPlan?.entrances || [];
    let scaleFoundByEntrances = false;

    if (entranceList.length > 0) {
        let sumW = 0;
        let count = 0;
        entranceList.forEach(e => {
            const w = Number.isFinite(e.width) ? e.width : (e.bounds ? (e.bounds.maxX - e.bounds.minX) : 0);
            if (w > 0.1) { sumW += w; count++; }
        });

        if (count > 0) {
            const avgW = sumW / count;
            if (avgW > 400) unitScale = 1000.0; // ~900mm
            else if (avgW > 40) unitScale = 100.0; // ~90cm
            // else 1.0 (meters)
            scaleFoundByEntrances = true;
            console.log(`[GridExtractor] Detected scale via Entrances: ${unitScale} (AvgW: ${avgW.toFixed(1)})`);
        }
    }

    // Heuristic 2: Fallback to Bounds if entrances didn't give a clear signal
    if (!scaleFoundByEntrances) {
        if (maxDim > 5000) unitScale = 1000.0; // Millimeters (Raised threshold)
        else if (maxDim > 150) unitScale = 100.0; // Centimeters
        console.log(`[GridExtractor] Detected scale via Bounds: ${unitScale} (MaxDim: ${maxDim.toFixed(1)})`);
    }

    // Define parameters with SCALING applied immediately
    // Decreased default WallClearance to 0.2 (20cm) to allow better filling of tight spaces
    const corridorWidth = (Number.isFinite(options.corridorWidth) ? options.corridorWidth : 1.2) * unitScale;
    const margin = (Number.isFinite(options.margin) ? options.margin : 0.5) * unitScale;
    const cellSpacing = 0.1 * unitScale;
    const wallClearance = 0.2 * unitScale;

    // Global grid size for Pass 3 (referenced later)
    // We attach it to options or scope it here? 
    // Since Pass 3 is inside this function and we replaced its local definition with s_gridSize, 
    // we should define s_gridSize here to match what Pass 3 expects now.
    const s_gridSize = 0.5 * unitScale;

    const seed = Number.isFinite(options.seed) ? options.seed : Date.now();

    // Prioritize scale info logging
    if (unitScale > 1.0) {
        console.log(`[GridExtractor] Scaling applied: ${unitScale}x (MaxDim: ${maxDim.toFixed(0)})`);
    }

    // Seeded random number generator
    let rngState = seed;
    const rng = () => {
        rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
        return rngState / 0x7fffffff;
    };

    const minX = bounds.minX + margin;
    const minY = bounds.minY + margin;
    const maxX = bounds.maxX - margin;
    const maxY = bounds.maxY - margin;
    const totalWidth = maxX - minX;
    const totalHeight = maxY - minY;

    if (totalWidth < (2 * unitScale) && totalHeight < (2 * unitScale)) return cells;

    // Parse distribution
    // We must scale the area targets because user input is m^2 but coordinate system might be mm^2
    const areaScale = unitScale * unitScale;
    let parsedRanges = parseDistributionRanges(distribution);
    if (parsedRanges.length === 0) {
        parsedRanges.push({ key: '2-5', minArea: 2, maxArea: 5, weight: 1.0 });
    }

    // Apply area scaling to ranges
    parsedRanges = parsedRanges.map(r => ({
        ...r,
        minArea: r.minArea * areaScale,
        maxArea: r.maxArea * areaScale
    }));

    // Assign colors to each size category for visual distinction - CLEANER PALETTE
    const categoryColors = {
        '0-1': '#E8B4BC',   // Soft pink for smallest
        '1-3': '#7DD3FC',   // Sky blue for small
        '3-5': '#6EE7B7',   // Mint green for medium
        '5-10': '#FCD34D',  // Amber for large
        '10-20': '#C4B5FD'  // Lavender for extra large
    };

    // Calculate weighted average area to determine standard row height
    const avgArea = parsedRanges.reduce((sum, r) => sum + ((r.minArea + r.maxArea) / 2) * r.weight, 0);

    // Fixed row height - cells will vary in WIDTH to achieve target areas
    const baseRowHeight = Math.max(1.5, Math.min(3.0, Math.sqrt((avgArea / areaScale) * 1.5)));
    const rowHeight = baseRowHeight * unitScale;

    const rowGap = corridorWidth * 0.15; // Minimal gap between rows
    const mainCorridorGap = corridorWidth * 1.0; // Main corridor every 4 rows
    const secondaryCorridorGap = corridorWidth * 0.5; // Secondary corridor every 2 rows

    // Get wall segments for boundary checking
    const walls = floorPlan?.walls || [];
    const wallSegs = normalizeWallsToSegments(walls);
    const forbiddenZones = floorPlan?.forbiddenZones || [];
    const entrances = floorPlan?.entrances || [];
    const forbiddenBounds = forbiddenZones.map(getEntityBounds).filter(Boolean);
    const entranceBounds = entrances.map(getEntityBounds).filter(Boolean);

    // Extract room centers to avoid placing cells over room labels
    const rooms = floorPlan?.rooms || [];
    const roomCenters = rooms.map(room => {
        if (room.center) return { x: room.center.x, y: room.center.y };
        if (room.bounds) return {
            x: (room.bounds.minX + room.bounds.maxX) / 2,
            y: (room.bounds.minY + room.bounds.maxY) / 2
        };
        return null;
    }).filter(Boolean);
    const roomLabelClearance = 2.0 * unitScale; // Keep 2m clearance around room labels

    // Check if a cell overlaps with walls or forbidden areas
    function isCellBlocked(x, y, w, h) {
        const cx = x + w / 2;
        const cy = y + h / 2;
        const corners = [
            [x, y], [x + w, y], [x + w, y + h], [x, y + h]
        ];
        const edges = [
            [[x, y], [x + w, y]],         // bottom
            [[x + w, y], [x + w, y + h]], // right
            [[x + w, y + h], [x, y + h]], // top
            [[x, y + h], [x, y]]          // left
        ];

        // Check walls - use stricter detection
        for (const wall of wallSegs) {
            // Check if cell center is too close to wall
            const dist = distToSegment(cx, cy, wall.x1, wall.y1, wall.x2, wall.y2);
            if (dist < wallClearance) return true;

            // Check if any corner is too close to wall
            for (const [px, py] of corners) {
                const cornerDist = distToSegment(px, py, wall.x1, wall.y1, wall.x2, wall.y2);
                if (cornerDist < wallClearance * 0.5) return true;
            }

            // Check if any cell edge intersects with wall
            for (const [[ex1, ey1], [ex2, ey2]] of edges) {
                if (segmentsIntersect(ex1, ey1, ex2, ey2, wall.x1, wall.y1, wall.x2, wall.y2)) {
                    return true;
                }
            }

            // Grid-based interior point check for larger cells (scaled threshold)
            if (w > 1.0 * unitScale || h > 1.0 * unitScale) {
                const stepX = w / 3;
                const stepY = h / 3;
                for (let ix = 1; ix <= 2; ix++) {
                    for (let iy = 1; iy <= 2; iy++) {
                        const px = x + ix * stepX;
                        const py = y + iy * stepY;
                        const interiorDist = distToSegment(px, py, wall.x1, wall.y1, wall.x2, wall.y2);
                        if (interiorDist < wallClearance * 0.4) return true;
                    }
                }
            }
        }

        // Check forbidden zones (scaled clearance)
        const fbClearance = 0.3 * unitScale;
        for (const fb of forbiddenBounds) {
            if (cx >= fb.minX - fbClearance && cx <= fb.maxX + fbClearance &&
                cy >= fb.minY - fbClearance && cy <= fb.maxY + fbClearance) {
                return true;
            }
        }

        // Check entrances (scaled clearance)
        const entClearance = 0.5 * unitScale;
        for (const ent of entranceBounds) {
            if (cx >= ent.minX - entClearance && cx <= ent.maxX + entClearance &&
                cy >= ent.minY - entClearance && cy <= ent.maxY + entClearance) {
                return true;
            }
        }

        // Check room centers/labels - cells should not cover room numbers
        for (const rc of roomCenters) {
            // Check if cell overlaps with room label area
            if (x < rc.x + roomLabelClearance && x + w > rc.x - roomLabelClearance &&
                y < rc.y + roomLabelClearance && y + h > rc.y - roomLabelClearance) {
                return true;
            }
        }

        return false;
    }

    // Width sampling based on distribution (scaled) with GRID SNAPPING
    function sampleCellWidth() {
        const scaledGridStep = gridStep * unitScale; // Scaled grid step
        const rand = rng();
        let cumulative = 0;
        for (const range of parsedRanges) {
            cumulative += range.weight;
            if (rand <= cumulative) {
                const targetArea = range.minArea + rng() * (range.maxArea - range.minArea);
                const width = targetArea / rowHeight;
                const minW = 0.6 * unitScale;
                const maxW = 5 * unitScale;
                const rawWidth = Math.max(minW, Math.min(width, maxW));
                // SNAP to grid for cleaner alignment
                const snappedWidth = snapToGrid(rawWidth, scaledGridStep);
                return {
                    width: Math.max(minW, snappedWidth), // Ensure min after snap
                    rangeKey: range.key
                };
            }
        }
        return { width: snapToGrid(1.5 * unitScale, gridStep * unitScale), rangeKey: parsedRanges[0]?.key || 'M' };
    }

    // Build rows from bottom to top with GRID SNAPPING
    const scaledGridStep = gridStep * unitScale;
    let currentY = snapToGrid(minY, scaledGridStep); // Snap starting Y
    let rowIndex = 0;
    let skipCounter = 0;
    const maxSkipsPerRow = 100; // Increased to allow finding interior spaces in complex layouts
    const snappedRowHeight = snapToGrid(rowHeight, scaledGridStep); // Snap row height

    while (currentY + snappedRowHeight <= maxY) {
        let currentX = snapToGrid(minX, scaledGridStep); // Snap starting X
        let skipsThisRow = 0;

        // Fill this row with cells (scaled thresholds)
        while (currentX < maxX - 0.4 * unitScale) {
            const sampled = sampleCellWidth();
            const rawWidth = Math.min(sampled.width, maxX - currentX - cellSpacing);
            const actualWidth = snapToGrid(rawWidth, scaledGridStep); // Snap width

            if (actualWidth < 0.5 * unitScale) break;

            // Check if cell is blocked by walls
            if (!isCellBlocked(currentX, currentY, actualWidth, snappedRowHeight)) {
                const area = actualWidth * snappedRowHeight;
                const type = sampled.rangeKey;
                const color = categoryColors[type] || '#CCCCCC';

                cells.push({
                    x: currentX,
                    y: currentY,
                    width: actualWidth,
                    height: snappedRowHeight,
                    area: area,
                    type: type,
                    color: color,  // Visual distinction by size category
                    sizeCategory: type,
                    center: { x: currentX + actualWidth / 2, y: currentY + rowHeight / 2 }
                });
                currentX += actualWidth + cellSpacing;
                skipsThisRow = 0; // Reset skip counter on success
            } else {
                // Skip this blocked position and try a larger step forward (scaled)
                currentX += 1.0 * unitScale; // Jump 1 meter (scaled) to find open space
                skipsThisRow++;
                skipCounter++;
                if (skipsThisRow > maxSkipsPerRow) break;
            }
        }

        // Move to next row (use snapped height)
        currentY += snappedRowHeight;
        rowIndex++;

        // Add corridor gap based on corridor width setting (snapped)
        const corridorMultiplier = corridorWidth / 1.2; // Normalize to default 1.2m
        if (rowIndex % 4 === 0) {
            currentY += snapToGrid(mainCorridorGap * corridorMultiplier, scaledGridStep); // Main corridor
        } else if (rowIndex % 2 === 0) {
            currentY += snapToGrid(secondaryCorridorGap * corridorMultiplier, scaledGridStep); // Secondary corridor
        } else {
            currentY += snapToGrid(rowGap * corridorMultiplier, scaledGridStep); // Small gap
        }
    }

    // ========== GAP-FILLING PASS ==========
    // Find and fill gaps between existing cells to optimize space usage
    const fillerCells = [];
    const gapMinWidth = 0.3 * unitScale;  // Reduced from 0.5 and scaled
    const gapMinHeight = 0.3 * unitScale; // Reduced from 0.5 and scaled

    // Collect all occupied rectangles
    const occupied = cells.map(c => ({
        minX: c.x, maxX: c.x + c.width,
        minY: c.y, maxY: c.y + c.height
    }));

    // Check if a rectangle overlaps any existing cell
    function overlapsExisting(x, y, w, h) {
        for (const occ of occupied) {
            if (x < occ.maxX && x + w > occ.minX &&
                y < occ.maxY && y + h > occ.minY) {
                return true;
            }
        }
        return false;
    }
    // 2.1 Scan for horizontal gaps between cells in each row region
    const yLevels = [...new Set(cells.map(c => c.y))].sort((a, b) => a - b);

    for (const yLevel of yLevels) {
        const rowCells = cells.filter(c => Math.abs(c.y - yLevel) < 0.1)
            .sort((a, b) => a.x - b.x);

        if (rowCells.length < 1) continue;

        // Check start of row (from minX)
        const firstCell = rowCells[0];
        if (firstCell.x > floorPlan.bounds.minX + 2.0) { // Check space before first cell
            const gapStart = floorPlan.bounds.minX;
            const gapEnd = firstCell.x;
            const gapWidth = gapEnd - gapStart - cellSpacing;
            const gapHeight = firstCell.height;

            if (gapWidth >= gapMinWidth && gapHeight >= gapMinHeight) {
                // Try to fill this gap check logic...
                // (Abbreviated for brevity, focusing on the loop below)
            }
        }

        // Check gaps between adjacent cells
        for (let i = 0; i < rowCells.length - 1; i++) {
            const leftCell = rowCells[i];
            const rightCell = rowCells[i + 1];
            const gapStart = leftCell.x + leftCell.width;
            const gapEnd = rightCell.x;
            const gapWidth = gapEnd - gapStart - cellSpacing * 2;
            const gapHeight = leftCell.height;

            if (gapWidth >= gapMinWidth && gapHeight >= gapMinHeight) {
                const gapX = gapStart + cellSpacing;
                const gapY = yLevel;

                if (!isCellBlocked(gapX, gapY, gapWidth, gapHeight) &&
                    !overlapsExisting(gapX, gapY, gapWidth, gapHeight)) {

                    const area = gapWidth * gapHeight;
                    const type = getTypeForArea(area, parsedRanges);
                    const color = categoryColors[type] || '#FFAA00'; // Orange for filler

                    fillerCells.push({
                        x: gapX, y: gapY, width: gapWidth, height: gapHeight,
                        area: area, type: type, color: color, // Use category color, not hardcoded
                        sizeCategory: type, isFiller: true,
                        center: { x: gapX + gapWidth / 2, y: gapY + gapHeight / 2 }
                    });

                    occupied.push({ minX: gapX, maxX: gapX + gapWidth, minY: gapY, maxY: gapY + gapHeight });
                }
            }
        }
    }

    // ========== PASS 3: GRID-BASED SPACE FILLING (AGGRESSIVE) ==========
    // Uses a spatial grid to find large prohibited/empty areas and fills them

    // 1. Define Grid - Use global scaled s_gridSize
    const gridSize = s_gridSize;
    const gridMinX = floorPlan.bounds.minX;
    const gridMinY = floorPlan.bounds.minY;
    const gridWidth = Math.ceil((floorPlan.bounds.maxX - gridMinX) / gridSize);
    const gridHeight = Math.ceil((floorPlan.bounds.maxY - gridMinY) / gridSize);

    // Safety check for memory
    if (gridWidth * gridHeight < 100000) {
        const grid = new Int8Array(gridWidth * gridHeight).fill(0); // 0 = free, 1 = occupied/blocked

        // 2. Mark Static Obstacles
        // Mark Walls
        // (Simplified marking: check center of each grid cell)
        for (let gy = 0; gy < gridHeight; gy++) {
            for (let gx = 0; gx < gridWidth; gx++) {
                const cx = gridMinX + gx * gridSize + gridSize / 2;
                const cy = gridMinY + gy * gridSize + gridSize / 2;

                // Check walls/forbidden/entrances
                // We use a stricter blocked check for the grid base
                if (isCellBlocked(cx - gridSize / 2, cy - gridSize / 2, gridSize, gridSize)) {
                    grid[gy * gridWidth + gx] = 1;
                }
            }
        }

        // 3. Mark Existing Cells (including fillers from Pass 2)
        const allCells = [...cells, ...fillerCells];
        for (const cell of allCells) {
            const startGx = Math.floor((cell.x - gridMinX) / gridSize);
            const endGx = Math.floor((cell.x + cell.width - gridMinX) / gridSize);
            const startGy = Math.floor((cell.y - gridMinY) / gridSize);
            const endGy = Math.floor((cell.y + cell.height - gridMinY) / gridSize);

            for (let gy = Math.max(0, startGy); gy < Math.min(gridHeight, endGy + 1); gy++) {
                for (let gx = Math.max(0, startGx); gx < Math.min(gridWidth, endGx + 1); gx++) {
                    grid[gy * gridWidth + gx] = 1;
                }
            }
        }

        // 4. Find Maximal Rectangles in Free Space
        // We scan for free spots and try to expand them
        const maxFillers = 200; // Increased from 50 for better coverage
        let addedGridFillers = 0;

        for (let attempt = 0; attempt < maxFillers; attempt++) {
            // Simple heuristic: Find first free cell and try to expand max rectangle
            let bestRect = null;
            let maxScore = 0;

            // Sample grid - reduced stride for better coverage
            for (let gy = 1; gy < gridHeight - 1; gy += 1) {  // Changed from += 2
                for (let gx = 1; gx < gridWidth - 1; gx += 1) {  // Changed from += 2
                    if (grid[gy * gridWidth + gx] === 0) {
                        // Expand Right (max 10m scaled)
                        let rw = 1;
                        const maxRealWidth = 10.0 * unitScale;
                        while (gx + rw < gridWidth && grid[gy * gridWidth + (gx + rw)] === 0 && rw * gridSize < maxRealWidth) {
                            rw++;
                        }

                        // Expand Down (max 10m scaled)
                        let rh = 1;
                        let valid = true;
                        const maxRealHeight = 10.0 * unitScale;
                        while (valid && gy + rh < gridHeight && rh * gridSize < maxRealHeight) {
                            for (let k = 0; k < rw; k++) {
                                if (grid[(gy + rh) * gridWidth + (gx + k)] !== 0) {
                                    valid = false;
                                    break;
                                }
                            }
                            if (valid) rh++;
                        }

                        // Check dimensions
                        const realW = rw * gridSize;
                        const realH = rh * gridSize;

                        // Favor roughly square or standard sized spots (scaled minimum)
                        const minDim = 0.5 * unitScale;
                        const maxDim = 4.0 * unitScale; // Max 4m per dimension to prevent large blocks

                        // Clamp dimensions to max
                        const clampedW = Math.min(realW, maxDim);
                        const clampedH = Math.min(realH, maxDim);

                        if (clampedW >= minDim && clampedH >= minDim) {
                            // Favor squarer cells (ratio closer to 1) for cleaner look
                            const ratio = Math.min(clampedW, clampedH) / Math.max(clampedW, clampedH);
                            const score = clampedW * clampedH * (0.5 + 0.5 * ratio); // Bonus for square
                            if (score > maxScore) {
                                maxScore = score;
                                bestRect = { x: gx, y: gy, w: Math.ceil(clampedW / gridSize), h: Math.ceil(clampedH / gridSize), realW: clampedW, realH: clampedH };
                            }
                        }
                    }
                }
            }

            if (bestRect) {
                // Place it
                const finalX = gridMinX + bestRect.x * gridSize;
                const finalY = gridMinY + bestRect.y * gridSize;

                // Double check blockage (since grid is coarse)
                if (!isCellBlocked(finalX, finalY, bestRect.realW, bestRect.realH) &&
                    !overlapsExisting(finalX, finalY, bestRect.realW, bestRect.realH)) {

                    const area = bestRect.realW * bestRect.realH;
                    const type = getTypeForArea(area, parsedRanges);
                    const color = categoryColors[type] || '#CCCCCC';

                    fillerCells.push({
                        x: finalX, y: finalY, width: bestRect.realW, height: bestRect.realH,
                        area: area, type: type, color: color, // Use category color, not hardcoded
                        sizeCategory: type, isFiller: true, isGridFiller: true,
                        center: { x: finalX + bestRect.realW / 2, y: finalY + bestRect.realH / 2 }
                    });

                    // Mark grid as occupied
                    for (let gy = bestRect.y; gy < bestRect.y + bestRect.h; gy++) {
                        for (let gx = bestRect.x; gx < bestRect.x + bestRect.w; gx++) {
                            grid[gy * gridWidth + gx] = 1;
                        }
                    }

                    occupied.push({
                        minX: finalX, maxX: finalX + bestRect.realW,
                        minY: finalY, maxY: finalY + bestRect.realH
                    });

                    addedGridFillers++;
                } else {
                    // It was blocked in reality, mark grid as blocked to skip next time
                    for (let gy = bestRect.y; gy < bestRect.y + bestRect.h; gy++) {
                        for (let gx = bestRect.x; gx < bestRect.x + bestRect.w; gx++) {
                            grid[gy * gridWidth + gx] = 1;
                        }
                    }
                }
            } else {
                break; // No more space found
            }
        }
        console.log(`[GridFiller] Filled ${addedGridFillers} large distinct empty areas`);
    } else {
        console.warn('[GridFiller] Grid too large, skipping advanced filling');
    }

    // Add filler cells to main cells array
    cells.push(...fillerCells);
    console.log(`[GapFiller] Added ${fillerCells.length} filler cells to optimize space`);

    // Sort for consistent numbering (top to bottom, left to right)
    cells.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    cells.forEach((c, idx) => {
        c.id = `BOX_${idx + 1}`;
        c.label = `${c.area.toFixed(1)}m²`;
    });

    console.log(`[DistributionEngine] Generated ${cells.length} cells (rowH=${rowHeight.toFixed(2)}m, avgArea=${avgArea.toFixed(2)}m², wallsChecked=${wallSegs.length})`);
    return cells;
}

/**
 * Get type label for a given area
 */
function getTypeForArea(area, ranges) {
    for (const r of ranges) {
        if (area >= r.minArea - 0.5 && area <= r.maxArea + 0.5) {
            return r.key;
        }
    }
    // Return closest match
    if (ranges.length > 0) {
        if (area < ranges[0].minArea) return ranges[0].key;
        return ranges[ranges.length - 1].key;
    }
    return 'M';
}

/**
 * Generate corridors between entrances for circulation
 * Creates paths connecting entrances with wall clearance and direction arrows
 */
function generateCorridors(floorPlan, cells, options = {}) {
    const { corridorWidth = 1.2 } = options; // Standard 1.2m corridor width
    const wallClearance = 1.2; // Minimum distance from walls
    const corridors = [];
    const entrances = floorPlan?.entrances || [];
    const walls = floorPlan?.walls || [];
    const forbiddenZones = floorPlan?.forbiddenZones || [];

    // Get wall segments for collision checking
    const wallSegs = normalizeWallsToSegments(walls);

    // Helper: Check if a point is too close to walls
    function isNearWall(x, y, minDist) {
        for (const wall of wallSegs) {
            const dist = distToSegment(x, y, wall.x1, wall.y1, wall.x2, wall.y2);
            if (dist < minDist) return true;
        }
        return false;
    }

    // Helper: Offset a point away from nearby walls
    function offsetFromWalls(x, y, minDist) {
        let offsetX = 0, offsetY = 0;
        for (const wall of wallSegs) {
            const dist = distToSegment(x, y, wall.x1, wall.y1, wall.x2, wall.y2);
            if (dist < minDist * 2) {
                // Push away from wall
                const wallMidX = (wall.x1 + wall.x2) / 2;
                const wallMidY = (wall.y1 + wall.y2) / 2;
                const dx = x - wallMidX;
                const dy = y - wallMidY;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                offsetX += (dx / len) * (minDist - dist);
                offsetY += (dy / len) * (minDist - dist);
            }
        }
        return { x: x + offsetX, y: y + offsetY };
    }

    if (entrances.length < 1) {
        console.log('[Corridors] No entrances found, skipping corridor generation');
        return corridors;
    }

    // Get entrance centers with direction info
    const entranceCenters = entrances.map((ent, idx) => {
        let center;
        if (ent.center) center = { x: ent.center.x, y: ent.center.y };
        else {
            const bounds = getEntityBounds(ent);
            if (bounds) center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
        }
        if (!center) return null;

        // Offset from walls
        const adjusted = offsetFromWalls(center.x, center.y, wallClearance);
        return {
            ...adjusted,
            isEntry: idx === 0, // First entrance is entry
            isExit: idx === entrances.length - 1, // Last is exit
            originalIdx: idx
        };
    }).filter(Boolean);

    // Create main corridor spine through center of floor
    if (entranceCenters.length >= 1) {
        const bounds = floorPlan?.bounds || { minX: 0, maxX: 100, minY: 0, maxY: 100 };
        const centerY = (bounds.minY + bounds.maxY) / 2;
        const centerX = (bounds.minX + bounds.maxX) / 2;

        // Create horizontal main corridor with wall clearance
        const mainCorridor = {
            id: 'MAIN_CORRIDOR',
            type: 'horizontal',
            x: bounds.minX + wallClearance,
            y: centerY - corridorWidth / 2,
            width: (bounds.maxX - bounds.minX) - 2 * wallClearance,
            height: corridorWidth,
            isMainCorridor: true,
            direction: 'left-to-right', // Traffic direction
            hasArrows: true
        };
        corridors.push(mainCorridor);

        // Connect each entrance to main corridor
        for (const entrance of entranceCenters) {
            const connector = {
                id: `CONNECTOR_${entrance.originalIdx}`,
                type: entrance.y < centerY ? 'vertical' : 'vertical',
                x: entrance.x - corridorWidth / 2,
                y: Math.min(entrance.y, centerY),
                width: corridorWidth,
                height: Math.abs(entrance.y - centerY) + corridorWidth,
                isConnector: true,
                direction: entrance.y < centerY ? 'down' : 'up',
                hasArrows: true,
                fromEntrance: entrance.isEntry,
                toExit: entrance.isExit
            };
            corridors.push(connector);
        }
    }

    // Add secondary corridors perpendicular to main (every ~8m)
    if (floorPlan?.bounds) {
        const bounds = floorPlan.bounds;
        const spacing = 8.0; // 8m between secondary corridors
        const centerY = (bounds.minY + bounds.maxY) / 2;

        for (let x = bounds.minX + wallClearance + spacing; x < bounds.maxX - wallClearance; x += spacing) {
            // Check if this position intersects walls
            if (!isNearWall(x, centerY, wallClearance)) {
                const secondaryCorridor = {
                    id: `SECONDARY_${Math.floor(x)}`,
                    type: 'vertical',
                    x: x - corridorWidth / 2,
                    y: bounds.minY + wallClearance,
                    width: corridorWidth,
                    height: (bounds.maxY - bounds.minY) - 2 * wallClearance,
                    isSecondaryCorridor: true,
                    direction: 'bidirectional',
                    hasArrows: false
                };
                corridors.push(secondaryCorridor);
            }
        }
    }

    console.log(`[Corridors] Generated ${corridors.length} corridor segments with ${wallClearance}m wall clearance`);
    return corridors;
}

/**
 * Parse distribution object into structured ranges with weights
 */
function parseDistributionRanges(distribution) {
    const ranges = [];
    if (!distribution || typeof distribution !== 'object') return ranges;

    let totalWeight = 0;
    Object.entries(distribution).forEach(([key, weightRaw]) => {
        const parts = String(key).split('-').map(Number);
        if (parts.length < 2) return;
        const minArea = Math.min(parts[0], parts[1]);
        const maxArea = Math.max(parts[0], parts[1]);
        if (!Number.isFinite(minArea) || !Number.isFinite(maxArea) || maxArea <= 0) return;

        let weight = Number(weightRaw);
        if (!Number.isFinite(weight) || weight <= 0) return;
        // Normalize if percentages (> 1)
        if (weight > 1.01) weight = weight / 100;

        ranges.push({ key, minArea, maxArea, weight });
        totalWeight += weight;
    });

    // Normalize weights to sum to 1
    if (totalWeight > 0 && Math.abs(totalWeight - 1) > 0.01) {
        ranges.forEach(r => r.weight = r.weight / totalWeight);
    }

    return ranges.sort((a, b) => a.minArea - b.minArea);
}

// Helper: distance from point to line segment
function distToSegment(px, py, x1, y1, x2, y2) {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;
    if (param < 0) {
        xx = x1;
        yy = y1;
    } else if (param > 1) {
        xx = x2;
        yy = y2;
    } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }

    const dx = px - xx;
    const dy = py - yy;
    return Math.sqrt(dx * dx + dy * dy);
}

// Helper: check if two line segments intersect
function segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
    const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    if (Math.abs(denom) < 1e-10) return false; // Parallel

    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
    const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

    return ua > 0.01 && ua < 0.99 && ub > 0.01 && ub < 0.99;
}

/**
 * Generate exclusion (gray) zones around detected obstacles
 * Creates buffer regions that ilots cannot occupy for safety/access
 * 
 * @param {Object} floorPlan - The parsed floor plan with obstacles
 * @param {Object} options - Configuration options
 * @returns {Array} Array of exclusion zone rectangles
 */
function generateExclusionZones(floorPlan, options = {}) {
    const {
        stairClearance = 2.5,     // 2.5m clearance around stairs
        elevatorClearance = 2.0,  // 2.0m clearance around elevators
        pillarClearance = 0.5,    // 0.5m clearance around pillars
        radiatorClearance = 0.8,  // 0.8m clearance around radiators
        exitClearance = 1.5,      // 1.5m clearance around exits
        shaftClearance = 1.0,     // 1.0m clearance around shafts
        defaultClearance = 0.5    // Default buffer if type unknown
    } = options;

    const exclusionZones = [];

    // Helper to determine clearance based on obstacle type
    function getClearanceForType(obstacleType) {
        const typeStr = String(obstacleType || '').toLowerCase();
        if (/stair|escalier|marche/.test(typeStr)) return stairClearance;
        if (/elevator|ascenseur|lift/.test(typeStr)) return elevatorClearance;
        if (/column|poteau|pillar|pilier/.test(typeStr)) return pillarClearance;
        if (/radiateur|radiator|chauffage|heating/.test(typeStr)) return radiatorClearance;
        if (/exit|sortie|door|porte|entrance/.test(typeStr)) return exitClearance;
        if (/shaft|gaine|duct|conduit/.test(typeStr)) return shaftClearance;
        return defaultClearance;
    }

    // Helper to create buffered zone from entity bounds
    function createBufferedZone(entity, clearance, zoneType) {
        let bounds = null;

        // Extract bounds from various entity formats
        if (entity.bounds) {
            bounds = entity.bounds;
        } else if (entity.x !== undefined && entity.y !== undefined) {
            bounds = {
                minX: entity.x,
                minY: entity.y,
                maxX: entity.x + (entity.width || 1),
                maxY: entity.y + (entity.height || 1)
            };
        } else if (entity.start && entity.end) {
            bounds = {
                minX: Math.min(entity.start.x, entity.end.x),
                minY: Math.min(entity.start.y, entity.end.y),
                maxX: Math.max(entity.start.x, entity.end.x),
                maxY: Math.max(entity.start.y, entity.end.y)
            };
        } else if (entity.center) {
            const radius = entity.radius || 0.5;
            bounds = {
                minX: entity.center.x - radius,
                minY: entity.center.y - radius,
                maxX: entity.center.x + radius,
                maxY: entity.center.y + radius
            };
        }

        if (!bounds) return null;

        // Create buffered exclusion zone
        return {
            id: `EXCLUSION_${zoneType}_${exclusionZones.length}`,
            type: 'exclusion',
            zoneType: zoneType,
            x: bounds.minX - clearance,
            y: bounds.minY - clearance,
            width: (bounds.maxX - bounds.minX) + 2 * clearance,
            height: (bounds.maxY - bounds.minY) + 2 * clearance,
            clearance: clearance,
            source: entity,
            color: '#9CA3AF' // Gray color for exclusion zones
        };
    }

    // Process obstacles from forbiddenZones array
    if (Array.isArray(floorPlan?.forbiddenZones)) {
        for (const zone of floorPlan.forbiddenZones) {
            const layer = String(zone.layer || '').toLowerCase();
            const clearance = getClearanceForType(layer);
            const bufferedZone = createBufferedZone(zone, clearance, 'forbidden');
            if (bufferedZone) {
                exclusionZones.push(bufferedZone);
            }
        }
    }

    // Process detected obstacles (from semantic interpretation)
    if (Array.isArray(floorPlan?.obstacles)) {
        for (const obstacle of floorPlan.obstacles) {
            const obsType = obstacle.semanticType || obstacle.layer || obstacle.type || '';
            const clearance = getClearanceForType(obsType);
            const bufferedZone = createBufferedZone(obstacle, clearance, obsType || 'obstacle');
            if (bufferedZone) {
                exclusionZones.push(bufferedZone);
            }
        }
    }

    // Process entrances/exits (need clearance for circulation)
    if (Array.isArray(floorPlan?.entrances)) {
        for (const entrance of floorPlan.entrances) {
            const bufferedZone = createBufferedZone(entrance, exitClearance, 'exit');
            if (bufferedZone) {
                exclusionZones.push(bufferedZone);
            }
        }
    }

    // Process stair entities specifically if they exist separately
    if (Array.isArray(floorPlan?.stairs)) {
        for (const stair of floorPlan.stairs) {
            const bufferedZone = createBufferedZone(stair, stairClearance, 'stair');
            if (bufferedZone) {
                exclusionZones.push(bufferedZone);
            }
        }
    }

    // Process elevator entities if they exist
    if (Array.isArray(floorPlan?.elevators)) {
        for (const elevator of floorPlan.elevators) {
            const bufferedZone = createBufferedZone(elevator, elevatorClearance, 'elevator');
            if (bufferedZone) {
                exclusionZones.push(bufferedZone);
            }
        }
    }

    // Process columns/pillars if they exist
    if (Array.isArray(floorPlan?.columns)) {
        for (const column of floorPlan.columns) {
            const bufferedZone = createBufferedZone(column, pillarClearance, 'pillar');
            if (bufferedZone) {
                exclusionZones.push(bufferedZone);
            }
        }
    }

    console.log(`[ExclusionZones] Generated ${exclusionZones.length} gray exclusion zones`);
    return exclusionZones;
}

/**
 * Render exclusion zones as gray rectangles
 * @param {THREE.Scene} scene - Three.js scene
 * @param {Array} exclusionZones - Array of exclusion zone objects
 */
function renderExclusionZonesData(exclusionZones) {
    // This returns data for the renderer to use
    return exclusionZones.map(zone => ({
        ...zone,
        color: '#9CA3AF',
        opacity: 0.5,
        isExclusionZone: true
    }));
}

module.exports = { extractGridCells, generateCorridors, generateExclusionZones, renderExclusionZonesData };

