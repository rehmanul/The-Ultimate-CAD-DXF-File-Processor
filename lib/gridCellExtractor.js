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
    const corridorWidth = Number.isFinite(options.corridorWidth) ? options.corridorWidth : 1.2;
    const margin = Number.isFinite(options.margin) ? options.margin : 0.5;
    const cellSpacing = 0.1; // Gap between cells
    const seed = Number.isFinite(options.seed) ? options.seed : Date.now();
    const wallClearance = 0.4; // Distance to keep from walls (balanced for coverage)

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

    if (totalWidth < 2 || totalHeight < 2) return cells;

    // Parse distribution to get size preferences
    const parsedRanges = parseDistributionRanges(distribution);
    if (parsedRanges.length === 0) {
        parsedRanges.push({ key: '2-5', minArea: 2, maxArea: 5, weight: 1.0 });
    }

    // Assign colors to each size category for visual distinction
    const categoryColors = {
        '0-1': '#FF6B6B',   // Red for smallest
        '1-3': '#4ECDC4',   // Teal for small-medium
        '3-5': '#45B7D1',   // Blue for medium
        '5-10': '#96CEB4',  // Green for large
        '10-20': '#DDA0DD'  // Purple for extra large
    };

    // Calculate weighted average area to determine standard row height
    const avgArea = parsedRanges.reduce((sum, r) => sum + ((r.minArea + r.maxArea) / 2) * r.weight, 0);

    // Fixed row height - cells will vary in WIDTH to achieve target areas
    const rowHeight = Math.max(1.5, Math.min(3.0, Math.sqrt(avgArea * 1.5)));
    const rowGap = corridorWidth * 0.15; // Minimal gap between rows
    const mainCorridorGap = corridorWidth * 1.0; // Main corridor every 4 rows (reduced)
    const secondaryCorridorGap = corridorWidth * 0.5; // Secondary corridor every 2 rows (reduced)

    // Get wall segments for boundary checking
    const walls = floorPlan?.walls || [];
    const wallSegs = normalizeWallsToSegments(walls);
    const forbiddenZones = floorPlan?.forbiddenZones || [];
    const entrances = floorPlan?.entrances || [];
    const forbiddenBounds = forbiddenZones.map(getEntityBounds).filter(Boolean);
    const entranceBounds = entrances.map(getEntityBounds).filter(Boolean);

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

            // Grid-based interior point check for larger cells
            if (w > 1.0 || h > 1.0) {
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

        // Check forbidden zones
        for (const fb of forbiddenBounds) {
            if (cx >= fb.minX - 0.3 && cx <= fb.maxX + 0.3 &&
                cy >= fb.minY - 0.3 && cy <= fb.maxY + 0.3) {
                return true;
            }
        }

        // Check entrances
        for (const ent of entranceBounds) {
            if (cx >= ent.minX - 0.5 && cx <= ent.maxX + 0.5 &&
                cy >= ent.minY - 0.5 && cy <= ent.maxY + 0.5) {
                return true;
            }
        }

        return false;
    }

    // Width sampling based on distribution
    function sampleCellWidth() {
        const rand = rng();
        let cumulative = 0;
        for (const range of parsedRanges) {
            cumulative += range.weight;
            if (rand <= cumulative) {
                const targetArea = range.minArea + rng() * (range.maxArea - range.minArea);
                const width = targetArea / rowHeight;
                const variation = 0.9 + rng() * 0.2;
                return {
                    width: Math.max(0.6, Math.min(width * variation, 8)),
                    rangeKey: range.key
                };
            }
        }
        return { width: 1.5, rangeKey: parsedRanges[0]?.key || 'M' };
    }

    // Build rows from bottom to top
    let currentY = minY;
    let rowIndex = 0;
    let skipCounter = 0;
    const maxSkipsPerRow = 20; // Limit skips to prevent infinite loops

    while (currentY + rowHeight <= maxY) {
        let currentX = minX;
        let skipsThisRow = 0;

        // Fill this row with cells
        while (currentX < maxX - 0.4) {
            const sampled = sampleCellWidth();
            const actualWidth = Math.min(sampled.width, maxX - currentX - cellSpacing);

            if (actualWidth < 0.5) break;

            // Check if cell is blocked by walls
            if (!isCellBlocked(currentX, currentY, actualWidth, rowHeight)) {
                const area = actualWidth * rowHeight;
                const type = sampled.rangeKey;
                const color = categoryColors[type] || '#CCCCCC';

                cells.push({
                    x: currentX,
                    y: currentY,
                    width: actualWidth,
                    height: rowHeight,
                    area: area,
                    type: type,
                    color: color,  // Visual distinction by size category
                    sizeCategory: type,
                    center: { x: currentX + actualWidth / 2, y: currentY + rowHeight / 2 }
                });
                currentX += actualWidth + cellSpacing;
                skipsThisRow = 0; // Reset skip counter on success
            } else {
                // Skip this blocked position and try a smaller step forward
                currentX += 0.3;
                skipsThisRow++;
                skipCounter++;
                if (skipsThisRow > maxSkipsPerRow) break;
            }
        }

        // Move to next row
        currentY += rowHeight;
        rowIndex++;

        // Add corridor gap based on corridor width setting
        const corridorMultiplier = corridorWidth / 1.2; // Normalize to default 1.2m
        if (rowIndex % 4 === 0) {
            currentY += mainCorridorGap * corridorMultiplier; // Main corridor
        } else if (rowIndex % 2 === 0) {
            currentY += secondaryCorridorGap * corridorMultiplier; // Secondary corridor
        } else {
            currentY += rowGap * corridorMultiplier; // Small gap
        }
    }

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

module.exports = { extractGridCells };

