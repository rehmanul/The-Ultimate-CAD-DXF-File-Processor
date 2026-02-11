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

        // Zone dimensions - optimized for maximum space usage
        this.zoneWidth = options.zoneWidth || 2.5;      // Reduced from 3
        this.zoneHeight = options.zoneHeight || 2.0;    // Reduced from 2.5
        this.corridorWidth = options.corridorWidth || 0.8;  // Reduced from 1.2
        this.minWallBuffer = Number.isFinite(options.minWallBuffer) ? options.minWallBuffer : 0.15;  // Reduced from 0.3
        this.useRoomPolygon = options.useRoomPolygon !== false;
        this.wallClearance = Number.isFinite(options.wallClearance)
            ? options.wallClearance
            : (architecturalStandards.ilotRules?.minDistanceFromWall || 0.3);
        this.wallMargin = Number.isFinite(options.wallMargin)
            ? options.wallMargin
            : Math.max(this.wallClearance * 2, 0.6);
        this.allowPartial = options.allowPartial !== false;
        this.stats = null;

        try {
            const createRng = require('./seededRng');
            this.rng = (typeof options.seed !== 'undefined') ? createRng(Number(options.seed)) : createRng(Date.now());
        } catch (e) {
            this.rng = Math.random;
        }
    }

    generateIlots(distribution, targetCount = 50, unitMix = []) {
        console.log(`[Ilot Placer] Starting room-aware generation`);
        console.log(`[Ilot Placer] Detected ${this.rooms.length} rooms`);
        console.log(`[Ilot Placer] Using distribution keys:`, Object.keys(distribution || {}));

        if (!distribution || typeof distribution !== 'object') {
            throw new Error('Distribution data required for ilot generation');
        }

        // Store distribution for use in ilot size generation
        this.distribution = distribution;
        this.targetCount = targetCount;
        this.unitMix = unitMix || [];
        this.unitMixRanges = this._buildUnitMixRanges(this.unitMix);
        this.remainingCount = Number.isFinite(this.targetCount) ? Math.max(0, this.targetCount) : null;

        // Build size ranges based on distribution
        this.sizeRanges = this._buildSizeRanges(this.distribution);
        if (!this.sizeRanges.length) {
            throw new Error('Distribution must include at least one size range with a positive weight');
        }
        this.minRoomDimension = this._computeMinUnitDimension();

        const allIlots = [];
        const hasRooms = Array.isArray(this.rooms) && this.rooms.length > 0;

        // If rooms detected, fill each room with varied ilot sizes
        if (hasRooms) {
            this.rooms.forEach((room, idx) => {
                if (this.remainingCount !== null && this.remainingCount <= 0) {
                    return;
                }
                const roomIlots = this._fillRoomWithDistribution(room, idx);
                allIlots.push(...roomIlots);
            });
        }

        // If no ilots from rooms, only use bounds when no rooms are available
        if (allIlots.length === 0) {
            if (!hasRooms) {
                throw new Error('No rooms detected. Provide valid room geometry before generating ilots.');
            }
            throw new Error('No placements available within detected rooms. Review room geometry and constraints.');
        }

        this.remainingCount = null;
        const target = Number.isFinite(this.targetCount) ? this.targetCount : null;
        const shortfall = target !== null ? Math.max(0, target - allIlots.length) : 0;
        this.stats = {
            targetCount: target,
            placedCount: allIlots.length,
            shortfall
        };

        if (shortfall > 0) {
            const message = `Unable to place requested ilots. Placed ${allIlots.length} of ${target}.`;
            if (!this.allowPartial) {
                throw new Error(message);
            }
            console.warn(`[Ilot Placer] ${message}`);
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
        if (!this.sizeRanges || this.sizeRanges.length === 0) {
            throw new Error('Size distribution ranges are not available');
        }
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
                return { area, width: Math.max(0.4, width), height: Math.max(0.4, height), rangeKey: range.rangeKey };
            }
        }

        throw new Error('Unable to select ilot size from distribution');
    }

    _fillRoomWithDistribution(room, roomIdx) {
        const ilots = [];
        const bounds = room.bounds || this._polygonToBounds(room.polygon);
        if (!bounds) return ilots;
        if (this.remainingCount !== null && this.remainingCount <= 0) return ilots;

        const rawWidth = bounds.maxX - bounds.minX;
        const rawHeight = bounds.maxY - bounds.minY;
        const margin = this._resolveRoomMargin(rawWidth, rawHeight);

        const minX = bounds.minX + margin;
        const maxX = bounds.maxX - margin;
        const minY = bounds.minY + margin;
        const maxY = bounds.maxY - margin;

        const roomWidth = maxX - minX;
        const roomHeight = maxY - minY;
        const minRoomDimension = Number.isFinite(this.minRoomDimension) ? this.minRoomDimension : 1.0;
        const roomCorridor = this._resolveRoomCorridorWidth(roomWidth, roomHeight);

        // Skip tiny rooms
        if (roomWidth < minRoomDimension || roomHeight < minRoomDimension) return ilots;

        // Place ilots with varying sizes based on distribution
        let currentX = minX;
        let currentY = minY;
        let rowMaxHeight = 0;
        const placedRects = [];
        const maxAttempts = 1500;  // Increased from 500 for more thorough filling
        let attempts = 0;

        while (currentY < maxY && attempts < maxAttempts) {
            if (this.remainingCount !== null && this.remainingCount <= 0) {
                break;
            }
            const size = this._selectSizeForRoom(roomWidth, roomHeight);
            if (!size) {
                attempts++;
                currentX += roomCorridor;
                continue;
            }
            const w = size.width;
            const h = size.height;

            // Check if fits in current row
            if (currentX + w > maxX) {
                // Move to next row
                currentX = minX;
                currentY += rowMaxHeight + roomCorridor;
                rowMaxHeight = 0;
                continue;
            }

            // Check if fits vertically
            if (currentY + h > maxY) break;

            // Check if inside room polygon
            if (this.useRoomPolygon && room.polygon && !this._isBoxInPolygon(currentX, currentY, w, h, room.polygon)) {
                currentX += w + roomCorridor;
                attempts++;
                continue;
            }

            // Check wall collision
            if (this._collidesWithWall(currentX, currentY, w, h)) {
                currentX += w + roomCorridor;
                attempts++;
                continue;
            }

            // Check forbidden zones and entrances
            if (this._collidesWithForbidden(currentX, currentY, w, h) ||
                this._collidesWithEntrance(currentX, currentY, w, h)) {
                currentX += w + roomCorridor;
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
                label: `${size.area.toFixed(1)}m2`,
                capacity: Math.max(1, Math.floor(size.area / 5)),
                roomId: roomIdx
            });
            if (this.remainingCount !== null) {
                this.remainingCount -= 1;
            }

            rowMaxHeight = Math.max(rowMaxHeight, h);
            currentX += w + roomCorridor;
            attempts = 0; // Reset attempts after successful placement
        }

        return ilots;
    }

    _fillBoundsWithDistribution() {
        const ilots = [];
        if (this.remainingCount !== null && this.remainingCount <= 0) return ilots;

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
            if (this.remainingCount !== null && this.remainingCount <= 0) {
                break;
            }
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
                label: `${size.area.toFixed(1)}m2`,
                capacity: Math.max(1, Math.floor(size.area / 5))
            });
            if (this.remainingCount !== null) {
                this.remainingCount -= 1;
            }

            rowMaxHeight = Math.max(rowMaxHeight, h);
            currentX += w + this.corridorWidth;
            attempts = 0; // Reset attempts after successful placement
        }

        return ilots;
    }

    _fillRoom(room, roomIdx) {
        const ilots = [];
        const bounds = room.bounds || this._polygonToBounds(room.polygon);
        if (!bounds) return ilots;

        const rawWidth = bounds.maxX - bounds.minX;
        const rawHeight = bounds.maxY - bounds.minY;
        const margin = this._resolveRoomMargin(rawWidth, rawHeight);

        const minX = bounds.minX + margin;
        const maxX = bounds.maxX - margin;
        const minY = bounds.minY + margin;
        const maxY = bounds.maxY - margin;

        const roomWidth = maxX - minX;
        const roomHeight = maxY - minY;

        // Skip tiny rooms
        if (roomWidth < 2 || roomHeight < 2) return ilots;

        // Grid within this room
        const stepX = this.zoneWidth + this.corridorWidth;
        const stepY = this.zoneHeight + this.corridorWidth;

        const numCols = Math.max(1, Math.floor(roomWidth / stepX));
        const numRows = Math.max(1, Math.floor(roomHeight / stepY));

        // Center the grid in the room
        const totalGridWidth = numCols * this.zoneWidth + (numCols - 1) * this.corridorWidth;
        const totalGridHeight = numRows * this.zoneHeight + (numRows - 1) * this.corridorWidth;
        const offsetX = minX + (roomWidth - totalGridWidth) / 2;
        const offsetY = minY + (roomHeight - totalGridHeight) / 2;

        for (let row = 0; row < numRows; row++) {
            for (let col = 0; col < numCols; col++) {
                const x = offsetX + col * stepX;
                const y = offsetY + row * stepY;

                // Check if inside room polygon
                if (this.useRoomPolygon && room.polygon && !this._isBoxInPolygon(x, y, this.zoneWidth, this.zoneHeight, room.polygon)) {
                    continue;
                }

                // Check wall collision
                if (this._collidesWithWall(x, y, this.zoneWidth, this.zoneHeight)) continue;

                // Check forbidden zones
                if (this._collidesWithForbidden(x, y, this.zoneWidth, this.zoneHeight)) continue;
                if (this._collidesWithEntrance(x, y, this.zoneWidth, this.zoneHeight)) continue;

                const area = this.zoneWidth * this.zoneHeight;
                ilots.push({
                    x, y,
                    width: this.zoneWidth,
                    height: this.zoneHeight,
                    area: area,
                    type: this._getType(area),
                    id: `ilot_${ilots.length + 1}`,
                    label: `${area.toFixed(1)}m2`,
                    capacity: Math.max(1, Math.floor(area / 5)),
                    roomId: roomIdx
                });
            }
        }

        return ilots;
    }

    _fillBoundsWithWallAvoidance() {
        const ilots = [];

        const minX = this.bounds.minX + this.wallMargin;
        const maxX = this.bounds.maxX - this.wallMargin;
        const minY = this.bounds.minY + this.wallMargin;
        const maxY = this.bounds.maxY - this.wallMargin;

        const stepX = this.zoneWidth + this.corridorWidth;
        const stepY = this.zoneHeight + this.corridorWidth;

        const numCols = Math.floor((maxX - minX) / stepX);
        const numRows = Math.floor((maxY - minY) / stepY);

        for (let row = 0; row < numRows; row++) {
            for (let col = 0; col < numCols; col++) {
                const x = minX + col * stepX;
                const y = minY + row * stepY;

                // Check wall collision
                if (this._collidesWithWall(x, y, this.zoneWidth, this.zoneHeight)) continue;
                if (this._collidesWithForbidden(x, y, this.zoneWidth, this.zoneHeight)) continue;
                if (this._collidesWithEntrance(x, y, this.zoneWidth, this.zoneHeight)) continue;

                const area = this.zoneWidth * this.zoneHeight;
                ilots.push({
                    x, y,
                    width: this.zoneWidth,
                    height: this.zoneHeight,
                    area: area,
                    type: this._getType(area),
                    id: `ilot_${ilots.length + 1}`,
                    label: `${area.toFixed(1)}m2`,
                    capacity: Math.max(1, Math.floor(area / 5))
                });
            }
        }

        return ilots;
    }

    _isBoxInPolygon(x, y, w, h, polygon) {
        // Check if center of box is inside polygon
        const cx = x + w / 2;
        const cy = y + h / 2;
        return this._pointInPolygon(cx, cy, polygon);
    }

    _pointInPolygon(x, y, polygon) {
        const cleanPolygon = this._normalizePolygon(polygon);
        if (!cleanPolygon || cleanPolygon.length < 3) return false;
        let inside = false;
        for (let i = 0, j = cleanPolygon.length - 1; i < cleanPolygon.length; j = i++) {
            const pi = cleanPolygon[i];
            const pj = cleanPolygon[j];
            const xi = pi[0];
            const yi = pi[1];
            const xj = pj[0];
            const yj = pj[1];

            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }

    _collidesWithWall(x, y, w, h) {
        // Use consistent safety buffer with configurable minimum (default 0.3m)
        const baseBuffer = Number.isFinite(this.minWallBuffer) ? this.minWallBuffer : 0.3;
        const safetyBuffer = Number.isFinite(this.wallClearance)
            ? Math.max(baseBuffer, this.wallClearance)
            : Math.max(baseBuffer, 0.5);

        // Inflate the box for the check to ensure margin
        const checkX = x - safetyBuffer;
        const checkY = y - safetyBuffer;
        const checkW = w + (safetyBuffer * 2);
        const checkH = h + (safetyBuffer * 2);

        for (const wall of this.walls) {
            // Handle simple line segments (most common case)
            if (wall.start && wall.end) {
                // Check if line segment intersects the inflated box
                if (this._lineIntersectsBox(wall.start.x, wall.start.y, wall.end.x, wall.end.y, checkX, checkY, checkW, checkH)) {
                    return true;
                }
            }

            // Handle walls defined as polygons (closed polylines)
            if (wall.polygon && Array.isArray(wall.polygon) && wall.polygon.length > 0) {
                // Check if any polygon edge intersects the box
                if (this._isBoxIntersectsPolygon(checkX, checkY, checkW, checkH, wall.polygon)) {
                    return true;
                }
            }
        }
        return false;
    }

    _isBoxIntersectsPolygon(x, y, w, h, polygon) {
        const cleanPolygon = this._normalizePolygon(polygon);
        if (!cleanPolygon || cleanPolygon.length < 3) return false;

        // Simple bounding box check first
        const pb = this._polygonToBounds(cleanPolygon);
        if (!pb) return false;
        if (!this._boxesOverlap(x, y, w, h, pb.minX, pb.minY, pb.maxX - pb.minX, pb.maxY - pb.minY)) {
            return false;
        }

        // Detailed check: Box edges vs Polygon edges
        // This relies on the _lineIntersectsLine method
        const boxEdges = [
            { p1: { x, y }, p2: { x: x + w, y } },
            { p1: { x: x + w, y }, p2: { x: x + w, y: y + h } },
            { p1: { x: x + w, y: y + h }, p2: { x, y: y + h } },
            { p1: { x, y: y + h }, p2: { x, y } }
        ];

        for (let i = 0; i < cleanPolygon.length; i++) {
            const p1 = cleanPolygon[i];
            const p2 = cleanPolygon[(i + 1) % cleanPolygon.length];
            const x1 = p1[0];
            const y1 = p1[1];
            const x2 = p2[0];
            const y2 = p2[1];

            for (const edge of boxEdges) {
                if (this._lineIntersectsLine(edge.p1.x, edge.p1.y, edge.p2.x, edge.p2.y, x1, y1, x2, y2)) {
                    return true;
                }
            }
        }

        // Check containment (polygon inside box or box center inside polygon)
        for (const pt of polygon) {
            const px = Array.isArray(pt) ? pt[0] : pt.x;
            const py = Array.isArray(pt) ? pt[1] : pt.y;
            if (px >= x && px <= x + w && py >= y && py <= y + h) {
                return true;
            }
        }

        const cx = x + w / 2;
        const cy = y + h / 2;
        if (this._pointInPolygon(cx, cy, polygon)) {
            return true;
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
        const cleanPolygon = this._normalizePolygon(polygon);
        if (!cleanPolygon || cleanPolygon.length === 0) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const pt of cleanPolygon) {
            const px = pt[0];
            const py = pt[1];
            minX = Math.min(minX, px);
            maxX = Math.max(maxX, px);
            minY = Math.min(minY, py);
            maxY = Math.max(maxY, py);
        }
        return { minX, minY, maxX, maxY };
    }

    _normalizePolygon(polygon) {
        if (!Array.isArray(polygon)) return null;
        const cleaned = [];
        for (const pt of polygon) {
            if (!pt) continue;
            if (Array.isArray(pt)) {
                const x = Number(pt[0]);
                const y = Number(pt[1]);
                if (Number.isFinite(x) && Number.isFinite(y)) {
                    cleaned.push([x, y]);
                }
                continue;
            }
            if (typeof pt === 'object') {
                const x = Number(pt.x);
                const y = Number(pt.y);
                if (Number.isFinite(x) && Number.isFinite(y)) {
                    cleaned.push([x, y]);
                }
            }
        }
        return cleaned;
    }

    _boxesOverlap(x1, y1, w1, h1, x2, y2, w2, h2) {
        return !(x1 + w1 <= x2 || x2 + w2 <= x1 || y1 + h1 <= y2 || y2 + h2 <= y1);
    }

    _buildUnitMixRanges(unitMix) {
        if (!Array.isArray(unitMix) || unitMix.length === 0) {
            return [];
        }

        const ranges = [];
        unitMix.forEach((item) => {
            if (!item || typeof item !== 'object') return;

            // Extract type name - handle various formats including typologie names with parentheses
            let type = (item.type || item.Type || item.name || item.typologie || '').toString().trim();
            if (!type) return;

            // Clean type name: remove parenthetical size info (e.g., "S (<2m²)" -> "S")
            const typeMatch = type.match(/^([A-Za-z0-9]+)/);
            if (typeMatch) {
                type = typeMatch[1];
            }

            const sizeRange = item.sizeRange || item.size_range;
            if (sizeRange) {
                const parsed = this._parseSizeRange(sizeRange);
                if (parsed) {
                    ranges.push({
                        type,
                        minArea: parsed.min,
                        maxArea: parsed.max,
                        targetArea: (parsed.min + parsed.max) / 2
                    });
                    return;
                }
            }

            // Try to extract target area from various field names
            const targetArea = parseFloat(
                item.targetArea ||
                item.target_area ||
                item.area ||
                item['target area'] ||
                item.surface_cible ||
                item.surface ||
                item.target
            );
            if (!Number.isFinite(targetArea) || targetArea <= 0) {
                return;
            }

            const tolerance = this._resolveUnitMixTolerance(item.tolerance, targetArea);
            ranges.push({
                type,
                minArea: Math.max(0, targetArea - tolerance),
                maxArea: targetArea + tolerance,
                targetArea
            });
        });

        return ranges;
    }

    _resolveUnitMixTolerance(tolerance, targetArea) {
        if (tolerance && typeof tolerance === 'object') {
            if (tolerance.type === 'percentage') {
                const pct = Number(tolerance.value);
                return Number.isFinite(pct) ? (targetArea * pct) / 100 : 0;
            }
            const abs = Number(tolerance.value);
            return Number.isFinite(abs) ? abs : 0;
        }

        if (typeof tolerance === 'string' && tolerance.includes('%')) {
            const pct = Number(tolerance.replace('%', ''));
            return Number.isFinite(pct) ? (targetArea * pct) / 100 : 0;
        }

        const abs = Number(tolerance);
        return Number.isFinite(abs) ? abs : 0;
    }

    _parseSizeRange(value) {
        const text = String(value);
        const match = text.match(/(\d+(\.\d+)?)[^0-9]+(\d+(\.\d+)?)/);
        if (!match) return null;
        const min = parseFloat(match[1]);
        const max = parseFloat(match[3]);
        if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
            return null;
        }
        return { min, max };
    }

    _getType(area) {
        // First, try to match to unit mix typologies
        if (this.unitMixRanges && this.unitMixRanges.length > 0) {
            // Find exact match within range
            const exactMatch = this.unitMixRanges.find((range) =>
                area >= range.minArea && area <= range.maxArea
            );
            if (exactMatch) {
                return exactMatch.type;
            }

            // Find closest match by target area
            let closest = null;
            let minDelta = Infinity;
            this.unitMixRanges.forEach((range) => {
                if (!Number.isFinite(range.targetArea)) return;
                const delta = Math.abs(area - range.targetArea);
                if (delta < minDelta) {
                    minDelta = delta;
                    closest = range;
                }
            });

            // Use closest match if within reasonable tolerance (50% of target area)
            if (closest && minDelta <= closest.targetArea * 0.5) {
                return closest.type;
            }
        }

        // Fallback: map to generic types if no unit mix available
        // These should only be used when unit mix is not provided
        if (area < 6) return 'single';
        if (area < 12) return 'double';
        if (area < 20) return 'team';
        return 'meeting';
    }

    _resolveRoomMargin(width, height) {
        const minDim = Math.min(width, height);
        if (!Number.isFinite(minDim) || minDim <= 0) {
            return this.wallMargin;
        }
        const scaled = minDim * 0.15;
        return Math.min(this.wallMargin, Math.max(0.1, scaled));
    }

    _computeMinUnitDimension() {
        if (!Array.isArray(this.sizeRanges) || this.sizeRanges.length === 0) {
            return 1.0;
        }
        const minArea = this.sizeRanges.reduce((min, range) => Math.min(min, range.minArea), Infinity);
        if (!Number.isFinite(minArea) || minArea <= 0) {
            return 1.0;
        }
        const minAspect = 0.6;
        return Math.max(0.4, Math.sqrt(minArea * minAspect));
    }

    _resolveRoomCorridorWidth(roomWidth, roomHeight) {
        const minDim = Math.min(roomWidth, roomHeight);
        if (!Number.isFinite(minDim) || minDim <= 0) {
            return this.corridorWidth;
        }
        const scaled = Math.max(0.2, minDim * 0.12);
        // Enforce minimum 1.2m per COSTO spec – never reduce corridor below safe width
        return Math.max(1.2, Math.min(this.corridorWidth, scaled));
    }

    _selectSizeForRoom(roomWidth, roomHeight) {
        if (!Number.isFinite(roomWidth) || !Number.isFinite(roomHeight)) {
            return null;
        }
        const maxWidth = Math.max(0.1, roomWidth);
        const maxHeight = Math.max(0.1, roomHeight);
        const maxAttempts = 30;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const size = this._selectSizeFromDistribution();
            if (!size) continue;
            if (size.width <= maxWidth && size.height <= maxHeight) {
                return size;
            }
            if (size.height <= maxWidth && size.width <= maxHeight) {
                return { ...size, width: size.height, height: size.width };
            }
        }

        const smallest = this.sizeRanges.reduce((min, range) => {
            if (!min) return range;
            return range.minArea < min.minArea ? range : min;
        }, null);

        if (!smallest) return null;
        const maxArea = Math.max(0.1, Math.min(smallest.maxArea, maxWidth * maxHeight * 0.9));
        const aspectRatio = Math.min(1.4, Math.max(0.6, maxWidth / maxHeight));
        let width = Math.sqrt(maxArea * aspectRatio);
        let height = maxArea / width;
        const scale = Math.min(maxWidth / width, maxHeight / height, 1);
        width *= scale;
        height *= scale;

        if (width <= 0 || height <= 0) return null;
        return {
            area: width * height,
            width,
            height,
            rangeKey: smallest.rangeKey
        };
    }
}

module.exports = RowBasedIlotPlacer;
