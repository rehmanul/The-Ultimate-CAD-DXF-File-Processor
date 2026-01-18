const architecturalStandards = require('./architecturalStandards');
const unitCatalog = require('./unitCatalog');

/**
 * RowBasedIlotPlacerCatalog - Catalog-driven ilot placement
 * COSTO V1: Uses unit mix targets instead of random distribution
 * Returns both ilots AND a deviation report
 */
class RowBasedIlotPlacerCatalog {
    constructor(floorPlan, options = {}) {
        this.floorPlan = floorPlan;
        this.bounds = Object.assign({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, floorPlan.bounds || {});
        this.walls = floorPlan.walls || [];
        this.forbiddenZones = floorPlan.forbiddenZones || [];
        this.entrances = floorPlan.entrances || [];
        this.rooms = floorPlan.rooms || [];

        this.corridorWidth = options.corridorWidth || 1.2;
        this.wallMargin = options.wallMargin || 0.5;

        try {
            const createRng = require('./seededRng');
            this.rng = (typeof options.seed !== 'undefined') ? createRng(Number(options.seed)) : createRng(Date.now());
        } catch (e) {
            this.rng = Math.random;
        }
    }

    /**
     * COSTO V1: Generate ilots driven by unit mix targets
     * @param {Object|Array} unitMixOrDistribution - Either unit mix array [{type, targetCount}] or distribution object
     * @param {number} targetCount - Optional fallback target count if using distribution
     * @returns {Object} { ilots: [], deviationReport: {} }
     */
    generateIlots(unitMixOrDistribution, targetCount = 50) {
        console.log(`[Ilot Placer Catalog] Starting COSTO V1 generation`);

        // Determine if we have a proper unit mix or just distribution weights
        let unitMixTargets = null;
        let distribution = null;

        if (Array.isArray(unitMixOrDistribution)) {
            // Proper unit mix array from CSV/Excel import
            unitMixTargets = unitMixOrDistribution;
            console.log(`[Ilot Placer Catalog] Using Unit Mix targets:`, unitMixTargets.map(t => `${t.type}:${t.targetCount || t.targetArea}`));
        } else {
            // Legacy distribution object (S/M/L weights or area ranges)
            distribution = unitMixOrDistribution || { 'S': 0.25, 'M': 0.35, 'L': 0.40 };
        }

        const allIlots = [];
        const placementReasons = [];
        let spaceExhausted = false;

        // Track fulfillment by type
        const fulfillment = {};
        unitCatalog.getTemplates().forEach(t => {
            fulfillment[t.id] = { target: 0, placed: 0, areaTarget: 0, areaPlaced: 0 };
        });

        // Set targets from unit mix
        if (unitMixTargets) {
            unitMixTargets.forEach(mix => {
                const templateId = this._mapTypeToTemplateId(mix.type);
                if (fulfillment[templateId]) {
                    fulfillment[templateId].target = mix.targetCount || 0;
                    fulfillment[templateId].areaTarget = mix.targetArea || 0;
                }
            });
        }

        // If rooms detected, fill each room respecting unit mix
        if (this.rooms && this.rooms.length > 0) {
            this.rooms.forEach((room, idx) => {
                const result = this._fillRoomWithMixTargets(room, idx, fulfillment, distribution);
                allIlots.push(...result.ilots);
                if (result.spaceExhausted) spaceExhausted = true;
                placementReasons.push(...result.reasons);
            });
        }

        // If no ilots from rooms, use full bounds
        if (allIlots.length === 0) {
            console.log('[Ilot Placer Catalog] No rooms found, using bounds');
            const result = this._fillBoundsWithMixTargets(fulfillment, distribution);
            allIlots.push(...result.ilots);
            if (result.spaceExhausted) spaceExhausted = true;
            placementReasons.push(...result.reasons);
        }

        // Build deviation report (COSTO V1 requirement)
        const deviationReport = this._buildDeviationReport(fulfillment, spaceExhausted, placementReasons);

        console.log(`[Ilot Placer Catalog] Generated ${allIlots.length} ilots`);
        console.log(`[Ilot Placer Catalog] Deviation summary:`, deviationReport.summary);

        return {
            ilots: allIlots,
            deviationReport
        };
    }

    _mapTypeToTemplateId(type) {
        // Map common type names to catalog IDs
        const typeUpper = String(type).toUpperCase().trim();
        if (typeUpper === 'SMALL' || typeUpper === 'S' || typeUpper.includes('1-3')) return 'S';
        if (typeUpper === 'MEDIUM' || typeUpper === 'M' || typeUpper.includes('3-5')) return 'M';
        if (typeUpper === 'LARGE' || typeUpper === 'L' || typeUpper.includes('5-10')) return 'L';
        if (typeUpper === 'XL' || typeUpper === 'EXTRA' || typeUpper.includes('10+')) return 'XL';
        return 'M'; // Default to Medium
    }

    _selectTemplateForMix(fulfillment, distribution) {
        const templates = unitCatalog.getTemplates();

        // Priority 1: Try to fulfill unmet targets
        for (const t of templates) {
            const f = fulfillment[t.id];
            if (f.target > 0 && f.placed < f.target) {
                return t; // This type still needs more units
            }
        }

        // Priority 2: Use distribution weights if no strict targets
        if (distribution) {
            const weights = templates.map(t => distribution[t.id] || 0.1);
            const total = weights.reduce((a, b) => a + b, 0);
            let rand = this.rng() * total;
            for (let i = 0; i < templates.length; i++) {
                rand -= weights[i];
                if (rand <= 0) return templates[i];
            }
        }

        return templates[0];
    }

    _fillRoomWithMixTargets(room, roomIdx, fulfillment, distribution) {
        const ilots = [];
        const reasons = [];
        let spaceExhausted = false;

        const bounds = room.bounds || this._polygonToBounds(room.polygon);
        if (!bounds) return { ilots, reasons, spaceExhausted };

        const minX = bounds.minX + this.wallMargin;
        const maxX = bounds.maxX - this.wallMargin;
        const minY = bounds.minY + this.wallMargin;
        const maxY = bounds.maxY - this.wallMargin;

        let currentX = minX;
        let currentY = minY;
        let rowMaxHeight = 0;
        const placedRects = [];
        const maxAttempts = 500;
        let attempts = 0;

        while (currentY < maxY && attempts < maxAttempts) {
            const template = this._selectTemplateForMix(fulfillment, distribution);
            const dim = template.dimensions[Math.floor(this.rng() * template.dimensions.length)];
            const w = dim.width;
            const h = dim.depth;

            // Check if fits in current row
            if (currentX + w > maxX) {
                currentX = minX;
                currentY += rowMaxHeight + this.corridorWidth;
                rowMaxHeight = 0;
                continue;
            }

            // Check if fits vertically
            if (currentY + h > maxY) {
                spaceExhausted = true;
                reasons.push(`Room ${roomIdx}: Vertical space exhausted at y=${currentY.toFixed(2)}`);
                break;
            }

            // Check if inside room polygon
            if (room.polygon && !this._isBoxInPolygon(currentX, currentY, w, h, room.polygon)) {
                currentX += w + this.corridorWidth;
                attempts++;
                continue;
            }

            // Check forbidden/entrances/overlaps
            if (this._collidesWithForbidden(currentX, currentY, w, h)) {
                reasons.push(`Skipped: Forbidden zone collision at (${currentX.toFixed(2)}, ${currentY.toFixed(2)})`);
                currentX += 0.5;
                attempts++;
                continue;
            }

            if (this._collidesWithEntrance(currentX, currentY, w, h)) {
                currentX += 0.5;
                attempts++;
                continue;
            }

            if (this._checkOverlaps(placedRects, currentX, currentY, w, h)) {
                currentX += 0.5;
                attempts++;
                continue;
            }

            // Place the unit
            placedRects.push({ x: currentX, y: currentY, w, h });
            const area = w * h;

            ilots.push({
                x: currentX,
                y: currentY,
                width: w,
                height: h,
                area: area,
                sizeCategory: template.id,
                type: template.name,
                id: `ilot_${ilots.length + 1}_r${roomIdx}`,
                label: `${template.id}`,
                capacity: Math.max(1, Math.floor(area / 5)),
                roomId: roomIdx
            });

            // Update fulfillment tracking
            fulfillment[template.id].placed++;
            fulfillment[template.id].areaPlaced += area;

            rowMaxHeight = Math.max(rowMaxHeight, h);
            currentX += w + this.corridorWidth;
            attempts = 0;
        }

        if (attempts >= maxAttempts) {
            reasons.push(`Room ${roomIdx}: Max attempts (${maxAttempts}) reached`);
        }

        return { ilots, reasons, spaceExhausted };
    }

    _fillBoundsWithMixTargets(fulfillment, distribution) {
        const ilots = [];
        const reasons = [];
        let spaceExhausted = false;

        const minX = this.bounds.minX + this.wallMargin;
        const maxX = this.bounds.maxX - this.wallMargin;
        const minY = this.bounds.minY + this.wallMargin;
        const maxY = this.bounds.maxY - this.wallMargin;

        let currentX = minX;
        let currentY = minY;
        let rowMaxHeight = 0;
        const placedRects = [];
        const maxAttempts = 1000;
        let attempts = 0;

        while (currentY < maxY && attempts < maxAttempts) {
            const template = this._selectTemplateForMix(fulfillment, distribution);
            const dim = template.dimensions[Math.floor(this.rng() * template.dimensions.length)];
            const w = dim.width;
            const h = dim.depth;

            if (currentX + w > maxX) {
                currentX = minX;
                currentY += rowMaxHeight + this.corridorWidth;
                rowMaxHeight = 0;
                continue;
            }

            if (currentY + h > maxY) {
                spaceExhausted = true;
                reasons.push(`Bounds: Vertical space exhausted at y=${currentY.toFixed(2)}`);
                break;
            }

            if (this._collidesWithWall(currentX, currentY, w, h) ||
                this._collidesWithForbidden(currentX, currentY, w, h) ||
                this._collidesWithEntrance(currentX, currentY, w, h) ||
                this._checkOverlaps(placedRects, currentX, currentY, w, h)) {
                currentX += 0.5;
                attempts++;
                continue;
            }

            placedRects.push({ x: currentX, y: currentY, w, h });
            const area = w * h;

            ilots.push({
                x: currentX,
                y: currentY,
                width: w,
                height: h,
                area: area,
                sizeCategory: template.id,
                type: template.name,
                id: `ilot_${ilots.length + 1}`,
                label: `${template.id}`,
                capacity: Math.max(1, Math.floor(area / 5))
            });

            fulfillment[template.id].placed++;
            fulfillment[template.id].areaPlaced += area;

            rowMaxHeight = Math.max(rowMaxHeight, h);
            currentX += w + this.corridorWidth;
            attempts = 0;
        }

        return { ilots, reasons, spaceExhausted };
    }

    _buildDeviationReport(fulfillment, spaceExhausted, reasons) {
        const deviations = [];
        let totalTarget = 0;
        let totalPlaced = 0;

        for (const [typeId, f] of Object.entries(fulfillment)) {
            totalTarget += f.target;
            totalPlaced += f.placed;

            if (f.target > 0) {
                const deviation = f.placed - f.target;
                const deviationPct = f.target > 0 ? ((deviation / f.target) * 100).toFixed(1) : 0;

                deviations.push({
                    type: typeId,
                    target: f.target,
                    placed: f.placed,
                    deviation: deviation,
                    deviationPercent: parseFloat(deviationPct),
                    areaTarget: f.areaTarget,
                    areaPlaced: parseFloat(f.areaPlaced.toFixed(2)),
                    status: deviation >= 0 ? 'FULFILLED' : 'SHORTFALL'
                });
            }
        }

        const overallCompliance = totalTarget > 0 ? ((totalPlaced / totalTarget) * 100).toFixed(1) : 100;

        return {
            summary: {
                totalTarget,
                totalPlaced,
                overallCompliance: parseFloat(overallCompliance),
                spaceExhausted,
                hasDeviations: deviations.some(d => d.deviation < 0)
            },
            deviations,
            reasons: reasons.slice(0, 20) // Limit to 20 reasons for readability
        };
    }

    _checkOverlaps(placedRects, x, y, w, h) {
        for (const placed of placedRects) {
            if (this._boxesOverlap(x, y, w, h, placed.x, placed.y, placed.w, placed.h)) {
                return true;
            }
        }
        return false;
    }

    _isBoxInPolygon(x, y, w, h, polygon) {
        const cx = x + w / 2;
        const cy = y + h / 2;
        return this._pointInPolygon(cx, cy, polygon);
    }

    _pointInPolygon(x, y, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const pi = polygon[i];
            const pj = polygon[j];
            const xi = Array.isArray(pi) ? pi[0] : pi.x;
            const yi = Array.isArray(pi) ? pi[1] : pi.y;
            const xj = Array.isArray(pj) ? pj[0] : pj.x;
            const yj = Array.isArray(pj) ? pj[1] : pj.y;
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }

    _collidesWithWall(x, y, w, h) {
        for (const wall of this.walls) {
            if (!wall.start || !wall.end) continue;
            if (this._lineIntersectsBox(wall.start.x, wall.start.y, wall.end.x, wall.end.y, x, y, w, h)) return true;
        }
        return false;
    }

    _lineIntersectsBox(x1, y1, x2, y2, bx, by, bw, bh) {
        const left = bx, right = bx + bw, top = by, bottom = by + bh;
        if ((x1 >= left && x1 <= right && y1 >= top && y1 <= bottom) ||
            (x2 >= left && x2 <= right && y2 >= top && y2 <= bottom)) return true;
        return this._lineIntersectsLine(x1, y1, x2, y2, left, top, right, top) ||
            this._lineIntersectsLine(x1, y1, x2, y2, right, top, right, bottom) ||
            this._lineIntersectsLine(x1, y1, x2, y2, left, bottom, right, bottom) ||
            this._lineIntersectsLine(x1, y1, x2, y2, left, top, left, bottom);
    }

    _lineIntersectsLine(x1, y1, x2, y2, x3, y3, x4, y4) {
        const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        if (Math.abs(d) < 0.0001) return false;
        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
        const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / d;
        return t >= 0 && t <= 1 && u >= 0 && u <= 1;
    }

    _collidesWithForbidden(x, y, w, h) {
        for (const zone of this.forbiddenZones) {
            const bounds = zone.bounds || this._polygonToBounds(zone.polygon);
            if (bounds && this._boxesOverlap(x, y, w, h, bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)) return true;
        }
        return false;
    }

    _collidesWithEntrance(x, y, w, h) {
        const clearance = 1.5;
        for (const entrance of this.entrances) {
            const bounds = entrance.bounds || this._polygonToBounds(entrance.polygon);
            if (bounds) {
                const ex = bounds.minX - clearance;
                const ey = bounds.minY - clearance;
                const ew = (bounds.maxX - bounds.minX) + 2 * clearance;
                const eh = (bounds.maxY - bounds.minY) + 2 * clearance;
                if (this._boxesOverlap(x, y, w, h, ex, ey, ew, eh)) return true;
            }
        }
        return false;
    }

    _polygonToBounds(polygon) {
        if (!polygon || polygon.length === 0) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const pt of polygon) {
            const px = Array.isArray(pt) ? pt[0] : pt.x;
            const py = Array.isArray(pt) ? pt[1] : pt.y;
            minX = Math.min(minX, px);
            maxX = Math.max(maxX, px);
            minY = Math.min(minY, py);
            maxY = Math.max(maxY, py);
        }
        return { minX, minY, maxX, maxY };
    }

    _boxesOverlap(x1, y1, w1, h1, x2, y2, w2, h2) {
        return !(x1 + w1 <= x2 || x2 + w2 <= x1 || y1 + h1 <= y2 || y2 + h2 <= y1);
    }
}

module.exports = RowBasedIlotPlacerCatalog;
