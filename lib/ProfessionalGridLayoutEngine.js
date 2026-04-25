'use strict';

function num(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeBounds(bounds = {}) {
    const minX = num(bounds.minX, 0);
    const minY = num(bounds.minY, 0);
    const maxX = num(bounds.maxX, minX + 100);
    const maxY = num(bounds.maxY, minY + 100);

    if (maxX <= minX || maxY <= minY) {
        return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    }

    return { minX, minY, maxX, maxY };
}

function rectFromPoints(points) {
    if (!Array.isArray(points) || points.length < 3) return null;
    const xs = [];
    const ys = [];

    for (const rawPoint of points) {
        if (!rawPoint) continue;
        const x = num(Array.isArray(rawPoint) ? rawPoint[0] : rawPoint.x, NaN);
        const y = num(Array.isArray(rawPoint) ? rawPoint[1] : rawPoint.y, NaN);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        xs.push(x);
        ys.push(y);
    }

    if (xs.length < 3 || ys.length < 3) return null;
    return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys)
    };
}

function rectFromBounds(zone) {
    if (!zone || !zone.bounds) return null;
    const minX = num(zone.bounds.minX, NaN);
    const minY = num(zone.bounds.minY, NaN);
    const maxX = num(zone.bounds.maxX, NaN);
    const maxY = num(zone.bounds.maxY, NaN);
    if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) {
        return null;
    }
    return {
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY
    };
}

function normalizeRect(rect, padding = 0) {
    if (!rect) return null;
    const x = num(rect.x, NaN);
    const y = num(rect.y, NaN);
    const w = num(rect.w ?? rect.width, NaN);
    const h = num(rect.h ?? rect.height, NaN);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;

    return {
        x: x - padding,
        y: y - padding,
        w: w + padding * 2,
        h: h + padding * 2
    };
}

function rectsOverlap(a, b, gap = 0) {
    return (
        a.x < b.x + b.w + gap &&
        a.x + a.w > b.x - gap &&
        a.y < b.y + b.h + gap &&
        a.y + a.h > b.y - gap
    );
}

function subtractIntervals(start, end, blockers, minLength) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    let intervals = [{ start, end }];

    for (const blocker of blockers) {
        if (!blocker || !Number.isFinite(blocker.start) || !Number.isFinite(blocker.end)) continue;
        const cutStart = Math.max(start, blocker.start);
        const cutEnd = Math.min(end, blocker.end);
        if (cutEnd <= cutStart) continue;

        const next = [];
        for (const interval of intervals) {
            if (cutEnd <= interval.start || cutStart >= interval.end) {
                next.push(interval);
                continue;
            }
            if (cutStart > interval.start) {
                next.push({ start: interval.start, end: cutStart });
            }
            if (cutEnd < interval.end) {
                next.push({ start: cutEnd, end: interval.end });
            }
        }
        intervals = next;
    }

    return intervals.filter((interval) => interval.end - interval.start >= minLength);
}

function mergeRects(rects, gap = 0.15) {
    const pending = rects.filter(Boolean).map((rect) => ({ ...rect }));
    const merged = [];

    while (pending.length > 0) {
        let current = pending.pop();
        let changed = true;

        while (changed) {
            changed = false;
            for (let index = pending.length - 1; index >= 0; index -= 1) {
                if (!rectsOverlap(current, pending[index], gap)) continue;
                const other = pending.splice(index, 1)[0];
                current = {
                    x: Math.min(current.x, other.x),
                    y: Math.min(current.y, other.y),
                    w: Math.max(current.x + current.w, other.x + other.w) - Math.min(current.x, other.x),
                    h: Math.max(current.y + current.h, other.y + other.h) - Math.min(current.y, other.y)
                };
                changed = true;
            }
        }

        merged.push(current);
    }

    return merged;
}

function rectCenterline(rect) {
    const x = num(rect.x, 0);
    const y = num(rect.y, 0);
    const width = num(rect.width, 0);
    const height = num(rect.height, 0);
    if (width <= 0 || height <= 0) return null;

    if (width >= height) {
        const cy = y + height / 2;
        return {
            direction: 'horizontal',
            points: [
                { x, y: cy },
                { x: x + width, y: cy }
            ]
        };
    }

    const cx = x + width / 2;
    return {
        direction: 'vertical',
        points: [
            { x: cx, y },
            { x: cx, y: y + height }
        ]
    };
}

class ProfessionalGridLayoutEngine {
    constructor(floorPlan, options = {}) {
        this.floorPlan = floorPlan || {};
        this.bounds = sanitizeBounds(this.floorPlan.bounds);
        this.walls = Array.isArray(this.floorPlan.walls) ? this.floorPlan.walls : [];
        this.forbiddenZones = Array.isArray(this.floorPlan.forbiddenZones) ? this.floorPlan.forbiddenZones : [];
        this.rooms = Array.isArray(this.floorPlan.rooms) ? this.floorPlan.rooms : [];
        this.entrances = Array.isArray(this.floorPlan.entrances) ? this.floorPlan.entrances : [];

        this.corridorWidth = Math.max(0.9, num(options.corridorWidth, 1.1));
        this.boxDepth = Math.max(1.7, num(options.boxDepth, 2.05));
        this.boxSpacing = Math.max(0.02, num(options.boxSpacing, 0.05));
        this.unitLength = Math.max(1.55, num(options.unitLength, this.boxDepth * 0.95));
        this.minUnitLength = Math.max(0.8, num(options.minBoxWidth, 0.9));
        this.edgeMargin = Math.max(0.18, Math.min(0.6, this.boxDepth * 0.18));
        this.obstaclePadding = Math.max(0.08, Math.min(0.35, this.boxDepth * 0.06));
        this.wallBandThickness = Math.max(0.12, Math.min(0.28, this.boxDepth * 0.08));

        this.planWidth = this.bounds.maxX - this.bounds.minX;
        this.planHeight = this.bounds.maxY - this.bounds.minY;
        this.obstacleRects = this._collectObstacleRects();
    }

    _collectObstacleRects() {
        const rects = [];

        for (const zone of this.forbiddenZones) {
            const rect = normalizeRect(
                rectFromPoints(zone.polygon) ||
                rectFromBounds(zone) ||
                normalizeRect(zone, 0),
                this.obstaclePadding
            );
            if (rect && rect.w >= 0.35 && rect.h >= 0.35) rects.push(rect);
        }

        for (const room of this.rooms) {
            const baseRect = rectFromPoints(room.points || room.polygon) || rectFromBounds(room) || room.bounds;
            const rect = normalizeRect(baseRect, this.obstaclePadding);
            if (!rect) continue;
            const area = num(room.area, rect.w * rect.h);
            const minSide = Math.min(rect.w, rect.h);
            if (area < 1.2) continue;
            if (minSide < 0.45) continue;
            rects.push(rect);
        }

        // Wall thickness buffer: internal walls are typically 0.10-0.25m thick
        const wallThickness = Math.max(0.12, this.wallBandThickness);

        for (const wall of this.walls) {
            // Case 1: Wall with polygon data
            if (Array.isArray(wall.polygon)) {
                const polyRect = normalizeRect(rectFromPoints(wall.polygon), this.obstaclePadding * 0.5);
                if (polyRect && polyRect.w > 0.3 && polyRect.h > 0.3) rects.push(polyRect);
                continue;
            }

            // Case 2: Wall as line segment ({x1,y1,x2,y2} or {startX,startY,endX,endY})
            const x1 = num(wall.x1 ?? wall.startX, NaN);
            const y1 = num(wall.y1 ?? wall.startY, NaN);
            const x2 = num(wall.x2 ?? wall.endX, NaN);
            const y2 = num(wall.y2 ?? wall.endY, NaN);
            if (![x1, y1, x2, y2].every(Number.isFinite)) continue;

            const segLen = Math.hypot(x2 - x1, y2 - y1);
            if (segLen < 0.25) continue; // Skip tiny segments (noise)

            // Convert line segment to a rectangular obstacle with wall thickness
            const minX = Math.min(x1, x2) - wallThickness;
            const minY = Math.min(y1, y2) - wallThickness;
            const maxX = Math.max(x1, x2) + wallThickness;
            const maxY = Math.max(y1, y2) + wallThickness;
            const w = maxX - minX;
            const h = maxY - minY;

            // Only include walls that form meaningful obstacles (not tiny slivers)
            if (w > 0.15 && h > 0.15) {
                rects.push({ x: minX, y: minY, w, h });
            }
        }

        return mergeRects(rects, 0.08).filter((rect) => rect.w > 0.3 && rect.h > 0.3);
    }

    _buildColumnPattern() {
        const totalWidth = this.planWidth - this.edgeMargin * 2;
        const groupWidth = (this.boxDepth * 2) + this.corridorWidth;
        let centerBands = Math.floor((totalWidth - (this.boxDepth * 2) - this.corridorWidth) / groupWidth);
        centerBands = Math.max(1, Math.min(8, centerBands));

        let patternWidth = (this.boxDepth * 2) + ((centerBands + 1) * this.corridorWidth) + (centerBands * this.boxDepth * 2);
        while (centerBands > 1 && patternWidth > totalWidth + 0.01) {
            centerBands -= 1;
            patternWidth = (this.boxDepth * 2) + ((centerBands + 1) * this.corridorWidth) + (centerBands * this.boxDepth * 2);
        }

        const startX = this.bounds.minX + Math.max(this.edgeMargin, (this.planWidth - patternWidth) / 2);
        const corridors = [];
        const columns = [];
        let cursorX = startX;

        columns.push({
            kind: 'single',
            x: cursorX,
            width: this.boxDepth,
            face: 'right'
        });
        cursorX += this.boxDepth;

        for (let index = 0; index < centerBands + 1; index += 1) {
            corridors.push({
                kind: 'vertical',
                x: cursorX,
                width: this.corridorWidth
            });
            cursorX += this.corridorWidth;

            if (index >= centerBands) continue;
            columns.push({
                kind: 'double-left',
                x: cursorX,
                width: this.boxDepth,
                face: 'left'
            });
            cursorX += this.boxDepth;
            columns.push({
                kind: 'double-right',
                x: cursorX,
                width: this.boxDepth,
                face: 'right'
            });
            cursorX += this.boxDepth;
        }

        columns.push({
            kind: 'single',
            x: cursorX,
            width: this.boxDepth,
            face: 'left'
        });

        return { corridors, columns };
    }

    _obstaclesForVerticalBand(x, width) {
        return this.obstacleRects
            .filter((rect) => rect.x < x + width && rect.x + rect.w > x)
            .map((rect) => ({
                start: rect.y,
                end: rect.y + rect.h
            }))
            .sort((a, b) => a.start - b.start);
    }

    _obstaclesForHorizontalBand(y, height) {
        return this.obstacleRects
            .filter((rect) => rect.y < y + height && rect.y + rect.h > y)
            .map((rect) => ({
                start: rect.x,
                end: rect.x + rect.w
            }))
            .sort((a, b) => a.start - b.start);
    }

    _buildVerticalCorridorSegments(pattern, y0, y1) {
        const segments = [];
        const minSegment = Math.max(this.unitLength * 0.65, 2.0);

        pattern.corridors.forEach((corridor, index) => {
            const blockers = this._obstaclesForVerticalBand(corridor.x, corridor.width);
            const spans = subtractIntervals(y0, y1, blockers, minSegment);
            spans.forEach((span, spanIndex) => {
                segments.push({
                    id: `corridor_v_${index}_${spanIndex}`,
                    x: corridor.x,
                    y: span.start,
                    width: corridor.width,
                    height: span.end - span.start,
                    direction: 'vertical',
                    type: 'main_artery',
                    polygon: [
                        { x: corridor.x, y: span.start },
                        { x: corridor.x + corridor.width, y: span.start },
                        { x: corridor.x + corridor.width, y: span.end },
                        { x: corridor.x, y: span.end }
                    ]
                });
            });
        });

        return segments;
    }

    _buildHorizontalConnectorSegments(y, height, type) {
        const startX = this.bounds.minX + this.edgeMargin;
        const endX = this.bounds.maxX - this.edgeMargin;
        const blockers = this._obstaclesForHorizontalBand(y, height);
        const spans = subtractIntervals(startX, endX, blockers, Math.max(this.boxDepth * 2, 4));

        return spans.map((span, index) => ({
            id: `${type}_${index}`,
            x: span.start,
            y,
            width: span.end - span.start,
            height,
            direction: 'horizontal',
            type: 'connector',
            polygon: [
                { x: span.start, y },
                { x: span.end, y },
                { x: span.end, y: y + height },
                { x: span.start, y: y + height }
            ]
        }));
    }

    _fillVerticalBand(units, x, width, y0, y1, face, targetCount) {
        const blockers = this._obstaclesForVerticalBand(x, width);
        const spans = subtractIntervals(y0, y1, blockers, this.minUnitLength);

        for (const span of spans) {
            let cursorY = span.start;
            while (cursorY + this.minUnitLength <= span.end) {
                if (targetCount > 0 && units.length >= targetCount) return;
                const remaining = span.end - cursorY;
                const height = Math.min(this.unitLength, remaining);
                if (height < this.minUnitLength) break;

                units.push({
                    x,
                    y: cursorY,
                    width,
                    height,
                    corridorFace: face,
                    doorSide: face,
                    facing: face
                });

                cursorY += height + this.boxSpacing;
            }
        }
    }

    _fillHorizontalBand(units, x0, x1, y, height, face, targetCount) {
        const blockers = this._obstaclesForHorizontalBand(y, height);
        const spans = subtractIntervals(x0, x1, blockers, this.minUnitLength);

        for (const span of spans) {
            let cursorX = span.start;
            while (cursorX + this.minUnitLength <= span.end) {
                if (targetCount > 0 && units.length >= targetCount) return;
                const remaining = span.end - cursorX;
                const width = Math.min(this.unitLength, remaining);
                if (width < this.minUnitLength) break;

                units.push({
                    x: cursorX,
                    y,
                    width,
                    height,
                    corridorFace: face,
                    doorSide: face,
                    facing: face
                });

                cursorX += width + this.boxSpacing;
            }
        }
    }

    _filterUnitConflicts(units, corridors) {
        const corridorRects = corridors.map((corridor) => ({
            x: corridor.x,
            y: corridor.y,
            w: corridor.width,
            h: corridor.height
        }));

        return units.filter((unit) => {
            const unitRect = {
                x: unit.x + 0.03,
                y: unit.y + 0.03,
                w: Math.max(0, unit.width - 0.06),
                h: Math.max(0, unit.height - 0.06)
            };

            for (const rect of this.obstacleRects) {
                if (rectsOverlap(unitRect, rect, 0)) return false;
            }

            for (const rect of corridorRects) {
                if (rectsOverlap(unitRect, rect, 0)) return false;
            }

            return true;
        });
    }

    _buildCirculationPaths(corridors) {
        return corridors.map((corridor) => {
            const centerline = rectCenterline(corridor);
            return {
                id: `path_${corridor.id}`,
                type: corridor.type || 'main_artery',
                direction: centerline ? centerline.direction : corridor.direction,
                points: centerline ? centerline.points : []
            };
        }).filter((path) => Array.isArray(path.points) && path.points.length >= 2);
    }

    generate(args = {}) {
        const targetCount = Math.max(0, Math.floor(num(args.targetCount, 0)));
        const pattern = this._buildColumnPattern();

        const rawStripDepth = Math.max(this.boxDepth, Math.min(this.planHeight * 0.11, this.boxDepth * 1.25));
        const stripDepth = Math.min(rawStripDepth, Math.max(1.7, (this.planHeight - this.corridorWidth * 2 - this.edgeMargin * 2) / 4.5));
        const bottomConnectorY = this.bounds.minY + stripDepth;
        const topConnectorY = this.bounds.maxY - stripDepth - this.corridorWidth;
        const verticalZoneStart = bottomConnectorY + this.corridorWidth;
        const verticalZoneEnd = topConnectorY;
        const corridors = [];
        const units = [];

        if (verticalZoneEnd - verticalZoneStart < this.unitLength * 3) {
            return {
                units: [],
                corridors: [],
                radiators: [],
                circulationPaths: [],
                floorPlanOutline: [
                    { x: this.bounds.minX, y: this.bounds.minY },
                    { x: this.bounds.maxX, y: this.bounds.minY },
                    { x: this.bounds.maxX, y: this.bounds.maxY },
                    { x: this.bounds.minX, y: this.bounds.maxY }
                ],
                layoutMode: 'professionalReference'
            };
        }

        corridors.push(...this._buildHorizontalConnectorSegments(bottomConnectorY, this.corridorWidth, 'corridor_h_bottom'));
        corridors.push(...this._buildHorizontalConnectorSegments(topConnectorY, this.corridorWidth, 'corridor_h_top'));
        corridors.push(...this._buildVerticalCorridorSegments(pattern, verticalZoneStart, verticalZoneEnd));

        const horizontalBandStartX = this.bounds.minX + this.edgeMargin;
        const horizontalBandEndX = this.bounds.maxX - this.edgeMargin;
        this._fillHorizontalBand(units, horizontalBandStartX, horizontalBandEndX, this.bounds.minY + this.edgeMargin * 0.4, stripDepth - this.edgeMargin * 0.5, 'top', targetCount);
        this._fillHorizontalBand(units, horizontalBandStartX, horizontalBandEndX, topConnectorY + this.corridorWidth, stripDepth - this.edgeMargin * 0.5, 'bottom', targetCount);

        for (const column of pattern.columns) {
            this._fillVerticalBand(units, column.x, column.width, verticalZoneStart, verticalZoneEnd, column.face, targetCount);
        }

        const cleanedUnits = this._filterUnitConflicts(units, corridors).map((unit, index) => {
            const width = +unit.width.toFixed(3);
            const height = +unit.height.toFixed(3);
            const area = +(width * height).toFixed(2);
            return {
                id: `unit_${index + 1}`,
                displayNumber: index + 1,
                x: +unit.x.toFixed(3),
                y: +unit.y.toFixed(3),
                width,
                height,
                area,
                label: `${area.toFixed(2)}m²`,
                type: area >= 4.6 ? 'L' : area >= 3.2 ? 'M' : 'S',
                zone: 'main',
                partitionType: 'toleGrise',
                partitions: {
                    top: 'tole_grise',
                    bottom: 'tole_grise',
                    left: 'tole_grise',
                    right: 'tole_grise'
                },
                corridorFace: unit.corridorFace,
                doorSide: unit.doorSide,
                facing: unit.facing,
                layoutMode: 'professionalReference'
            };
        });

        const circulationPaths = this._buildCirculationPaths(corridors);
        const floorPlanOutline = [
            { x: this.bounds.minX, y: this.bounds.minY },
            { x: this.bounds.maxX, y: this.bounds.minY },
            { x: this.bounds.maxX, y: this.bounds.maxY },
            { x: this.bounds.minX, y: this.bounds.maxY }
        ];

        return {
            units: cleanedUnits,
            corridors,
            radiators: [],
            circulationPaths,
            floorPlanOutline,
            layoutMode: 'professionalReference'
        };
    }
}

module.exports = ProfessionalGridLayoutEngine;
