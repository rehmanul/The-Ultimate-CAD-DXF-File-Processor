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
        this.wallMargin = options.wallMargin || 1.5; // Increased margin to keep ilots inside walls

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

        const allIlots = [];

        // If rooms detected, fill each room
        if (this.rooms && this.rooms.length > 0) {
            this.rooms.forEach((room, idx) => {
                const roomIlots = this._fillRoom(room, idx);
                allIlots.push(...roomIlots);
            });
        }

        // If no ilots from rooms, use full bounds with wall collision checking
        if (allIlots.length === 0) {
            console.log('[Ilot Placer] No rooms found, using bounds with wall avoidance');
            const boundsIlots = this._fillBoundsWithWallAvoidance();
            allIlots.push(...boundsIlots);
        }

        console.log(`[Ilot Placer] Generated ${allIlots.length} ilots`);
        return allIlots;
    }

    _fillRoom(room, roomIdx) {
        const ilots = [];
        const bounds = room.bounds || this._polygonToBounds(room.polygon);
        if (!bounds) return ilots;

        const minX = bounds.minX + this.wallMargin;
        const maxX = bounds.maxX - this.wallMargin;
        const minY = bounds.minY + this.wallMargin;
        const maxY = bounds.maxY - this.wallMargin;

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
                if (room.polygon && !this._isBoxInPolygon(x, y, this.zoneWidth, this.zoneHeight, room.polygon)) {
                    continue;
                }

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
                    label: `${area.toFixed(1)}m²`,
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
                    label: `${area.toFixed(1)}m²`,
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
