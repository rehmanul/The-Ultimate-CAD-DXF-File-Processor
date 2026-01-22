const architecturalStandards = require('./architecturalStandards');

/**
 * RowBasedIlotPlacer - Room-aware ilot placement
 * Places ilots INSIDE detected rooms, not across walls
 */
class RowBasedIlotPlacer {
    constructor(floorPlan, options = {}) {
        this.floorPlan = floorPlan;
        this.bounds = Object.assign({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, floorPlan.bounds || {});
        this.walls = floorPlan.walls || [];
        this.forbiddenZones = floorPlan.forbiddenZones || [];
        this.entrances = floorPlan.entrances || [];
        this.rooms = floorPlan.rooms || [];

        // Zone dimensions - smaller for better room fitting
        this.zoneWidth = options.zoneWidth || 3;
        this.zoneHeight = options.zoneHeight || 2.5;
        this.corridorWidth = options.corridorWidth || 1.0;
        this.wallMargin = (typeof options.wallMargin === 'number') ? options.wallMargin : 0.5; // Reduced margin to fit more rooms

        try {
            const createRng = require('./seededRng');
            this.rng = (typeof options.seed !== 'undefined') ? createRng(Number(options.seed)) : createRng(Date.now());
        } catch (e) {
            this.rng = Math.random;
        }
    }

    generateIlots(distribution, targetCount = 50) {
        console.log(`[Ilot Placer] Starting room-aware generation`);
        console.log(`[Ilot Placer] Detected ${this.rooms.length} rooms`);
        console.log(`[Ilot Placer] Using distribution:`, distribution);

        // Store distribution for use in ilot size generation
        this.distribution = distribution || { '1-3': 0.25, '3-5': 0.35, '5-10': 0.40 };
        this.targetCount = targetCount;

        // Build size ranges based on distribution
        this.sizeRanges = this._buildSizeRanges(this.distribution);

        const allIlots = [];

        // If rooms detected, fill each room with varied ilot sizes
        if (this.rooms && this.rooms.length > 0) {
            this.rooms.forEach((room, idx) => {
                const roomIlots = this._fillRoomWithDistribution(room, idx);
                allIlots.push(...roomIlots);
            });
        }

        // Check if we met the target count. If not, try to fill the remaining space globally.
        // This handles cases where room detection missed areas or rooms are sparsely populated.
        if (allIlots.length < targetCount) {
             const needed = targetCount - allIlots.length;
             console.log(`[Ilot Placer] Room fill yielded ${allIlots.length}/${targetCount} ilots. Attempting global fill for ${needed} more...`);

             // Pass existing ilots to avoid overlap
             const extraIlots = this._fillBoundsWithDistribution(allIlots, needed);
             allIlots.push(...extraIlots);
        }

        // If STILL 0 (e.g. no rooms and global fill failed somehow?), try global fill ignoring rooms if not already tried
        if (allIlots.length === 0 && (!this.rooms || this.rooms.length === 0)) {
             // Already tried global fill above if allIlots was 0 < targetCount
             // But if we had rooms but they were all skipped (tiny), we also tried global fill.
             // So we should be good.
             console.log('[Ilot Placer] Warning: Generated 0 ilots even after global fill attempt.');
        }

        console.log(`[Ilot Placer] Generated ${allIlots.length} ilots with varied sizes`);
        return allIlots;
    }

    _buildSizeRanges(distribution) {
        // Convert distribution percentages to size ranges
        const ranges = [];
        const entries = Object.entries(distribution).sort((a, b) => {
            const aMin = parseFloat(a[0].split('-')[0]);
            const bMin = parseFloat(b[0].split('-')[0]);
            return aMin - bMin;
        });

        entries.forEach(([rangeKey, weight]) => {
            if (weight <= 0) return;
            const [minStr, maxStr] = rangeKey.split('-');
            const minArea = parseFloat(minStr) || 0;
            const maxArea = parseFloat(maxStr) || minArea + 5;
            ranges.push({
                rangeKey,
                minArea,
                maxArea,
                weight: Number(weight) > 1 ? Number(weight) / 100 : Number(weight)
            });
        });

        return ranges;
    }

    _selectSizeFromDistribution() {
        // Randomly select a size range based on distribution weights
        const total = this.sizeRanges.reduce((sum, r) => sum + r.weight, 0);
        let rand = this.rng() * total;

        for (const range of this.sizeRanges) {
            rand -= range.weight;
            if (rand <= 0) {
                // Generate a random area within this range
                const area = range.minArea + this.rng() * (range.maxArea - range.minArea);
                // Calculate width and height with reasonable aspect ratio
                const aspectRatio = 0.6 + this.rng() * 0.8; // Between 0.6 and 1.4
                const width = Math.sqrt(area * aspectRatio);
                const height = area / width;
                return { area, width: Math.max(1, width), height: Math.max(1, height), rangeKey: range.rangeKey };
            }
        }

        // Fallback to default
        return { area: 7.5, width: this.zoneWidth, height: this.zoneHeight, rangeKey: '3-5' };
    }

    _fillRoomWithDistribution(room, roomIdx) {
        const ilots = [];
        const bounds = room.bounds || this._polygonToBounds(room.polygon);
        if (!bounds) return ilots;

        const minX = bounds.minX + this.wallMargin;
        const maxX = bounds.maxX - this.wallMargin;
        const minY = bounds.minY + this.wallMargin;
        const maxY = bounds.maxY - this.wallMargin;

        const roomWidth = maxX - minX;
        const roomHeight = maxY - minY;

        // Skip tiny rooms (adjusted for smaller margin)
        if (roomWidth < 1 || roomHeight < 1) {
             console.log(`[Ilot Placer] Skipping room ${roomIdx}: Dimensions too small after margin. Width: ${roomWidth.toFixed(2)}, Height: ${roomHeight.toFixed(2)}, Margin: ${this.wallMargin}`);
             return ilots;
        }

        // Place ilots with varying sizes based on distribution
        let currentX = minX;
        let currentY = minY;
        let rowMaxHeight = 0;
        const placedRects = [];
        const maxAttempts = 500;
        let attempts = 0;

        while (currentY < maxY && attempts < maxAttempts) {
            const size = this._selectSizeFromDistribution();
            const w = size.width;
            const h = size.height;

            // Check if fits in current row
            if (currentX + w > maxX) {
                // Move to next row
                currentX = minX;
                currentY += rowMaxHeight + this.corridorWidth;
                rowMaxHeight = 0;
                continue;
            }

            // Check if fits vertically
            if (currentY + h > maxY) break;

            // Check if inside room polygon
            if (room.polygon && !this._isBoxInPolygon(currentX, currentY, w, h, room.polygon)) {
                currentX += w + this.corridorWidth;
                attempts++;
                continue;
            }

            // Check forbidden zones and entrances
            if (this._collidesWithForbidden(currentX, currentY, w, h) ||
                this._collidesWithEntrance(currentX, currentY, w, h)) {
                currentX += w + this.corridorWidth;
                attempts++;
                continue;
            }

            // Check overlap with placed ilots
            let overlaps = false;
            for (const placed of placedRects) {
                if (this._boxesOverlap(currentX, currentY, w, h, placed.x, placed.y, placed.w, placed.h)) {
                    overlaps = true;
                    break;
                }
            }
            if (overlaps) {
                currentX += 0.5;
                attempts++;
                continue;
            }

            // Place the ilot
            placedRects.push({ x: currentX, y: currentY, w, h });
            ilots.push({
                x: currentX,
                y: currentY,
                width: w,
                height: h,
                area: size.area,
                sizeCategory: size.rangeKey,
                type: this._getType(size.area),
                id: `ilot_${ilots.length + 1}`,
                label: `${size.area.toFixed(1)}m²`,
                capacity: Math.max(1, Math.floor(size.area / 5)),
                roomId: roomIdx
            });

            rowMaxHeight = Math.max(rowMaxHeight, h);
            currentX += w + this.corridorWidth;
            attempts = 0; // Reset attempts after successful placement
        }

        return ilots;
    }

    _fillBoundsWithDistribution(existingIlots = [], limit = Infinity) {
        const ilots = [];

        const minX = this.bounds.minX + this.wallMargin;
        const maxX = this.bounds.maxX - this.wallMargin;
        const minY = this.bounds.minY + this.wallMargin;
        const maxY = this.bounds.maxY - this.wallMargin;

        let currentX = minX;
        let currentY = minY;
        let rowMaxHeight = 0;

        // Track locally placed rects + existing ones for collision
        // Map existing ilots to simple rects for faster checking
        const placedRects = existingIlots.map(i => ({
             x: Number(i.x),
             y: Number(i.y),
             w: Number(i.width),
             h: Number(i.height)
        }));

        const maxAttempts = 2000; // Increased attempts for global fill
        let attempts = 0;

        while (currentY < maxY && attempts < maxAttempts && ilots.length < limit) {
            const size = this._selectSizeFromDistribution();
            const w = size.width;
            const h = size.height;

            // Check if fits in current row
            if (currentX + w > maxX) {
                // Move to next row
                currentX = minX;
                currentY += (rowMaxHeight > 0 ? rowMaxHeight : 1) + this.corridorWidth;
                rowMaxHeight = 0;
                continue;
            }

            // Check if fits vertically
            if (currentY + h > maxY) break;

            // Check wall collision
            if (this._collidesWithWall(currentX, currentY, w, h)) {
                currentX += w + this.corridorWidth;
                attempts++;
                continue;
            }

            if (this._collidesWithForbidden(currentX, currentY, w, h) ||
                this._collidesWithEntrance(currentX, currentY, w, h)) {
                currentX += w + this.corridorWidth;
                attempts++;
                continue;
            }

            // Check overlap with placed ilots (both existing and new)
            let overlaps = false;
            for (const placed of placedRects) {
                if (this._boxesOverlap(currentX, currentY, w, h, placed.x, placed.y, placed.w, placed.h)) {
                    overlaps = true;
                    break;
                }
            }
            if (overlaps) {
                // Shift a bit more than just 0.5 to escape the obstacle
                currentX += 0.5;
                attempts++;
                continue;
            }

            // Place the ilot
            placedRects.push({ x: currentX, y: currentY, w, h });
            ilots.push({
                x: currentX,
                y: currentY,
                width: w,
                height: h,
                area: size.area,
                sizeCategory: size.rangeKey,
                type: this._getType(size.area),
                id: `ilot_${existingIlots.length + ilots.length + 1}`, // Ensure unique IDs
                label: `${size.area.toFixed(1)}m²`,
                capacity: Math.max(1, Math.floor(size.area / 5))
            });

            rowMaxHeight = Math.max(rowMaxHeight, h);
            currentX += w + this.corridorWidth;
            attempts = 0; // Reset attempts after successful placement
        }

        return ilots;
    }

    _fillRoom(room, roomIdx) {
        // Deprecated, using _fillRoomWithDistribution instead
        return this._fillRoomWithDistribution(room, roomIdx);
    }

    _fillBoundsWithWallAvoidance() {
         // Deprecated, using _fillBoundsWithDistribution instead
        return this._fillBoundsWithDistribution();
    }

    _isBoxInPolygon(x, y, w, h, polygon) {
        // Check if center of box is inside polygon
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

            // Line-box intersection
            if (this._lineIntersectsBox(wall.start.x, wall.start.y, wall.end.x, wall.end.y, x, y, w, h)) {
                return true;
            }
        }
        return false;
    }

    _lineIntersectsBox(x1, y1, x2, y2, bx, by, bw, bh) {
        // Check if line segment intersects box
        const left = bx, right = bx + bw, top = by, bottom = by + bh;

        // Check if any endpoint is inside box
        if ((x1 >= left && x1 <= right && y1 >= top && y1 <= bottom) ||
            (x2 >= left && x2 <= right && y2 >= top && y2 <= bottom)) {
            return true;
        }

        // Check line intersection with box edges
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
            if (bounds && this._boxesOverlap(x, y, w, h, bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)) {
                return true;
            }
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
                if (this._boxesOverlap(x, y, w, h, ex, ey, ew, eh)) {
                    return true;
                }
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

    _getType(area) {
        if (area < 6) return 'single';
        if (area < 12) return 'double';
        if (area < 20) return 'team';
        return 'meeting';
    }
}

module.exports = RowBasedIlotPlacer;
