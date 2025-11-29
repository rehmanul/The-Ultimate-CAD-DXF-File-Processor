/**
 * Row-Based Ilot Placer - Professional and Organized
 * Places ilots in structured rows to create a hotel-like layout
 */
class RowBasedIlotPlacer {
    constructor(floorPlan, options = {}) {
        this.bounds = Object.assign({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, floorPlan.bounds || {});
        this.walls = floorPlan.walls || [];
        this.forbiddenZones = floorPlan.forbiddenZones || [];
        this.entrances = floorPlan.entrances || [];
        this.rooms = floorPlan.rooms || [];

        this.margin = options.margin || 1.0;
        this.spacing = options.spacing || 0.3;
        this.corridorWidth = options.corridorWidth || 1.2;

        const minSpan = Math.max(6, (this.corridorWidth + this.margin) * 3);
        let width = this.bounds.maxX - this.bounds.minX;
        let height = this.bounds.maxY - this.bounds.minY;
        const centerX = (this.bounds.minX + this.bounds.maxX) / 2 || 0;
        const centerY = (this.bounds.minY + this.bounds.maxY) / 2 || 0;

        if (!Number.isFinite(width) || width <= 0) {
            width = minSpan;
        }
        if (!Number.isFinite(height) || height <= 0) {
            height = minSpan;
        }

        if (width < minSpan) width = minSpan;
        if (height < minSpan) height = minSpan;

        this.bounds.minX = centerX - width / 2;
        this.bounds.maxX = centerX + width / 2;
        this.bounds.minY = centerY - height / 2;
        this.bounds.maxY = centerY + height / 2;

        this.bounds.width = this.bounds.maxX - this.bounds.minX;
        this.bounds.height = this.bounds.maxY - this.bounds.minY;
        this.bounds.area = this.bounds.width * this.bounds.height;

        // Detect usable spaces
        this.usableSpaces = this._detectUsableSpaces();

        try {
            const createRng = require('./seededRng');
            this.rng = (typeof options.seed !== 'undefined') ? createRng(Number(options.seed)) : createRng(Date.now());
        } catch (e) {
            this.rng = Math.random;
        }
    }

    _detectUsableSpaces() {
        // Use rooms if available AND they're large enough, otherwise use full bounds
        if (this.rooms && this.rooms.length > 0) {
            console.log(`[Row Placer] Using ${this.rooms.length} rooms for placement`);
            const roomSpaces = this.rooms.map(room => {
                const bounds = room.bounds || this._polygonToBounds(room.polygon);
                // Validate bounds
                const width = bounds.maxX - bounds.minX;
                const height = bounds.maxY - bounds.minY;
                const area = room.area || (width * height);

                return {
                    bounds: bounds,
                    area: area,
                    polygon: room.polygon,
                    valid: width > 2 && height > 2 && area > 4 // At least 2m x 2m to fit îlots
                };
            }).filter(s => s.valid && s.area > 4); // Only rooms large enough for îlots

            // Calculate average room size
            const totalRoomArea = this.rooms.reduce((sum, r) => sum + (r.area || 0), 0);
            const avgRoomArea = totalRoomArea / this.rooms.length;

            // If rooms are too small (< 3m² average), use full floor bounds instead
            if (roomSpaces.length > 0 && avgRoomArea >= 3) {
                console.log(`[Row Placer] Found ${roomSpaces.length} valid rooms for placement (avg: ${avgRoomArea.toFixed(2)}m²)`);
                return roomSpaces;
            }
            console.log(`[Row Placer] Rooms too small (avg: ${avgRoomArea.toFixed(2)}m²), using full floor bounds for îlot placement`);
        }

        console.log('[Row Placer] No rooms or rooms too small, using full bounds');
        return [{
            bounds: this.bounds,
            area: (this.bounds.maxX - this.bounds.minX) * (this.bounds.maxY - this.bounds.minY),
            polygon: null,
            valid: true
        }];
    }

    _polygonToBounds(polygon) {
        if (!polygon || polygon.length === 0) return this.bounds;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const pt of polygon) {
            const x = Array.isArray(pt) ? pt[0] : pt.x;
            const y = Array.isArray(pt) ? pt[1] : pt.y;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
        return { minX, minY, maxX, maxY };
    }

    generateIlots(distribution, targetCount = 50) {
        console.log(`[Row Placer] Generating ${targetCount} ilots in ${this.usableSpaces.length} spaces`);

        const sizes = this._calculateSizes(distribution, targetCount);
        const allIlots = [];

        // Distribute ilots across usable spaces
        let sizeIndex = 0;
        for (const space of this.usableSpaces) {
            if (sizeIndex >= sizes.length) break;

            const spaceIlots = Math.ceil((sizes.length - sizeIndex) * (space.area / this.usableSpaces.reduce((sum, s) => sum + s.area, 0)));
            const spaceSizes = sizes.slice(sizeIndex, sizeIndex + spaceIlots);

            const ilots = this._placeInRows(spaceSizes, space);

            allIlots.push(...ilots);
            sizeIndex += spaceIlots;
        }

        console.log(`[Row Placer] Placed ${allIlots.length}/${targetCount} ilots`);
        return allIlots;
    }

    _calculateSizes(distribution, targetCount) {
        const sizes = [];
        const entries = Object.entries(distribution || {});
        if (!entries.length) return sizes;

        const normalizedEntries = entries.map(([range, weight]) => {
            let normalizedWeight = Number(weight);
            if (Number.isNaN(normalizedWeight)) normalizedWeight = 0;
            if (normalizedWeight > 1.01) normalizedWeight = normalizedWeight / 100;
            if (normalizedWeight < 0) normalizedWeight = 0;
            return [range, normalizedWeight];
        });

        let totalWeight = normalizedEntries.reduce((sum, [, weight]) => sum + weight, 0);
        if (totalWeight <= 0) totalWeight = 1;

        normalizedEntries.forEach(([range, share]) => {
            const [minSize, maxSize] = range.split('-').map(Number);
            const proportion = share / Math.max(totalWeight, 1);
            const count = Math.round(targetCount * proportion);

            for (let i = 0; i < count; i++) {
                const area = minSize + this.rng() * (maxSize - minSize);
                const aspectRatio = 0.7 + this.rng() * 0.6; // 0.7 to 1.3
                const width = Math.sqrt(area * aspectRatio);
                const height = area / width;

                sizes.push({
                    width: Math.max(0.8, width),
                    height: Math.max(0.8, height),
                    area: width * height
                });
            }
        });

        return sizes.sort((a, b) => b.area - a.area);
    }

    _placeInRows(sizes, space) {
        const ilots = [];
        const bounds = space.bounds;
        const polygon = space.polygon;

        let currentY = bounds.minY + this.margin;
        let rowHeight = 0;
        let sizeIndex = 0;

        while (currentY < bounds.maxY - this.margin && sizeIndex < sizes.length) {
            let currentX = bounds.minX + this.margin;
            rowHeight = 0; // Reset for each row

            // Place ilots in a row
            while (currentX < bounds.maxX - this.margin && sizeIndex < sizes.length) {
                const size = sizes[sizeIndex];
                if (currentX + size.width + this.spacing > bounds.maxX - this.margin) {
                    break; // Move to next row
                }

                if (this._isValidPosition(currentX, currentY, size.width, size.height, { bounds, polygon }, ilots)) {
                    const ilot = {
                        id: `ilot_${ilots.length + 1}`,
                        x: currentX,
                        y: currentY,
                        width: size.width,
                        height: size.height,
                        area: size.width * size.height,
                        type: this._getType(size.width * size.height),
                        capacity: Math.ceil(size.width * size.height * 1.5),
                    };
                    ilots.push(ilot);
                    rowHeight = Math.max(rowHeight, size.height);
                    currentX += size.width + this.spacing;
                    sizeIndex++;
                } else {
                    currentX += size.width + this.spacing; // Move to the next position
                }
            }
            currentY += rowHeight + this.corridorWidth;
        }

        return ilots;
    }

    _isValidPosition(x, y, width, height, space = null, existingIlots = []) {
        const bounds = space?.bounds || this.bounds;
        const polygon = space?.polygon;

        // Must be within bounds
        if (x < bounds.minX || y < bounds.minY || x + width > bounds.maxX || y + height > bounds.maxY) {
            return false;
        }

        // Respect room polygon geometry when available
        if (polygon && !this._rectangleFullyInsidePolygon(x, y, width, height, polygon)) {
            return false;
        }

        // Must NOT overlap forbidden zones (blue)
        for (const zone of this.forbiddenZones) {
            if (zone.polygon && this._boxIntersectsPolygon(x, y, width, height, zone.polygon)) {
                return false;
            }
        }

        // Must NOT touch entrances (red)
        for (const entrance of this.entrances) {
            if (entrance.polygon && this._boxIntersectsPolygon(x, y, width, height, entrance.polygon)) {
                return false;
            }
        }

        // Must NOT overlap other ilots
        for (const ilot of existingIlots) {
            if (this._boxesOverlap(x, y, width, height, ilot.x, ilot.y, ilot.width, ilot.height)) {
                return false;
            }
        }

        return true;
    }

    _boxIntersectsPolygon(x, y, width, height, polygon) {
        // Check if box corners are inside polygon
        const corners = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
        for (const corner of corners) {
            if (this._pointInPolygon(corner, polygon)) return true;
        }

        // Check if polygon points are inside box
        for (const pt of polygon) {
            const px = Array.isArray(pt) ? pt[0] : pt.x;
            const py = Array.isArray(pt) ? pt[1] : pt.y;
            if (px >= x && px <= x + width && py >= y && py <= y + height) return true;
        }

        return false;
    }

    _rectangleFullyInsidePolygon(x, y, width, height, polygon) {
        if (!Array.isArray(polygon) || polygon.length < 3) return true;

        const corners = [
            [x, y],
            [x + width, y],
            [x + width, y + height],
            [x, y + height]
        ];

        for (const corner of corners) {
            if (!this._pointInPolygon(corner, polygon)) {
                return false;
            }
        }

        // Guard against concave intrusions by checking the rectangle centre
        const center = [x + width / 2, y + height / 2];
        if (!this._pointInPolygon(center, polygon)) {
            return false;
        }

        const rectEdges = this._rectangleEdges(x, y, width, height);
        const polyEdges = this._polygonEdges(polygon);
        for (const [rStart, rEnd] of rectEdges) {
            for (const [pStart, pEnd] of polyEdges) {
                if (this._segmentsIntersect(rStart, rEnd, pStart, pEnd)) {
                    return false;
                }
            }
        }

        return true;
    }

    _rectangleEdges(x, y, width, height) {
        return [
            [[x, y], [x + width, y]],
            [[x + width, y], [x + width, y + height]],
            [[x + width, y + height], [x, y + height]],
            [[x, y + height], [x, y]]
        ];
    }

    _polygonEdges(polygon) {
        const edges = [];
        for (let i = 0; i < polygon.length; i++) {
            const start = this._normalizePoint(polygon[i]);
            const end = this._normalizePoint(polygon[(i + 1) % polygon.length]);
            edges.push([start, end]);
        }
        return edges;
    }

    _normalizePoint(pt) {
        if (Array.isArray(pt)) {
            return [Number(pt[0]) || 0, Number(pt[1]) || 0];
        }
        return [Number(pt?.x) || 0, Number(pt?.y) || 0];
    }

    _segmentsIntersect(a, b, c, d) {
        const p1 = this._normalizePoint(a);
        const p2 = this._normalizePoint(b);
        const p3 = this._normalizePoint(c);
        const p4 = this._normalizePoint(d);

        const o1 = this._orientation(p1, p2, p3);
        const o2 = this._orientation(p1, p2, p4);
        const o3 = this._orientation(p3, p4, p1);
        const o4 = this._orientation(p3, p4, p2);

        // Proper intersection
        if (o1 !== o2 && o3 !== o4) {
            return true;
        }

        // Touching or colinear intersections are allowed (îlots may touch walls)
        return false;
    }

    _orientation(p, q, r) {
        const [px, py] = p;
        const [qx, qy] = q;
        const [rx, ry] = r;
        const val = (qy - py) * (rx - qx) - (qx - px) * (ry - qy);
        if (Math.abs(val) < 1e-9) return 0;
        return val > 0 ? 1 : -1;
    }

    _boxesOverlap(x1, y1, w1, h1, x2, y2, w2, h2) {
        return !(x1 + w1 <= x2 || x2 + w2 <= x1 || y1 + h1 <= y2 || y2 + h2 <= y1);
    }

    _distanceToPolygon(x, y, width, height, polygon) {
        let minDist = Infinity;
        for (const pt of polygon) {
            const px = Array.isArray(pt) ? pt[0] : pt.x;
            const py = Array.isArray(pt) ? pt[1] : pt.y;
            const dx = Math.max(x - px, 0, px - (x + width));
            const dy = Math.max(y - py, 0, py - (y + height));
            minDist = Math.min(minDist, Math.sqrt(dx * dx + dy * dy));
        }
        return minDist;
    }

    _overlapsPolygon(x, y, width, height, polygon) {
        const corners = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
        for (const corner of corners) {
            if (this._pointInPolygon(corner, polygon)) return true;
        }
        return false;
    }

    _pointInPolygon(point, polygon) {
        const [x, y] = point;
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const pi = polygon[i];
            const pj = polygon[j];
            const xi = Array.isArray(pi) ? pi[0] : pi.x;
            const yi = Array.isArray(pi) ? pi[1] : pi.y;
            const xj = Array.isArray(pj) ? pj[0] : pj.x;
            const yj = Array.isArray(pj) ? pj[1] : pj.y;
            const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    _getType(area) {
        if (area < 1) return 'single';
        if (area < 3) return 'double';
        if (area < 5) return 'team';
        return 'meeting';
    }
}

module.exports = RowBasedIlotPlacer;
