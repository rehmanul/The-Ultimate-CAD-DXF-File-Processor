/**
 * COSTOLayoutPlacer - Zone-Aware COSTO Layout
 * 
 * Properly respects DXF architecture:
 * 1. Uses detected rooms/zones from RoomDetector
 * 2. Places boxes ONLY within valid storage zones
 * 3. Avoids forbidden zones (stairs, elevators, columns)
 * 4. Draws circulation around zone perimeters
 */
const roomDetector = require('./roomDetector');

class COSTOLayoutPlacer {
    constructor(floorPlan, options = {}) {
        this.floorPlan = floorPlan;
        this.bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        this.walls = floorPlan.walls || [];
        this.forbiddenZones = floorPlan.forbiddenZones || [];
        this.entrances = floorPlan.entrances || [];
        this.rooms = floorPlan.rooms || [];

        // Layout parameters
        this.boxDepth = options.boxDepth || 2.5;
        this.corridorWidth = options.corridorWidth || 1.2;
        this.margin = options.margin || 0.4;
        this.minBoxWidth = 1.2;
        this.maxBoxWidth = 4.0;
        this.minZoneArea = options.minZoneArea || 20; // Minimum area to be a storage zone

        this.corridors = [];
    }

    generateIlots(distribution, targetCount = 50, unitMix = []) {
        console.log('[COSTOLayoutPlacer] Starting zone-aware generation');
        console.log(`[COSTOLayoutPlacer] Input: walls=${this.walls.length}, rooms=${this.rooms.length}, forbiddenZones=${this.forbiddenZones.length}`);

        // Step 1: Get or detect storage zones
        let zones = this._getStorageZones();
        console.log(`[COSTOLayoutPlacer] Found ${zones.length} storage zones (minArea=${this.minZoneArea})`);

        if (zones.length === 0) {
            console.warn('[COSTOLayoutPlacer] No zones detected, using bounds as fallback');
            zones = [this._createZoneFromBounds()];
        }

        // Step 2: Place boxes in each zone
        const allIlots = [];
        const sizes = this._buildSizes(distribution, targetCount);
        let sizeIdx = 0;

        // Distribute target count among zones by area
        const totalArea = zones.reduce((sum, z) => sum + (z.area || 0), 0);

        for (const zone of zones) {
            const zoneShare = totalArea > 0
                ? Math.ceil((zone.area / totalArea) * targetCount)
                : Math.ceil(targetCount / zones.length);

            const zoneIlots = this._fillZoneWithBoxes(zone, sizes, sizeIdx, zoneShare);
            allIlots.push(...zoneIlots);
            sizeIdx += zoneIlots.length;

            // Add perimeter corridor for this zone
            this._addZonePerimeterCorridor(zone);
        }

        // Assign IDs
        allIlots.forEach((ilot, idx) => {
            ilot.id = `ilot_${idx + 1}`;
            ilot.index = idx;
        });

        console.log(`[COSTOLayoutPlacer] Generated ${allIlots.length} ilots in ${zones.length} zones`);
        return allIlots;
    }

    _getStorageZones() {
        // Use pre-detected rooms if available
        if (this.rooms && this.rooms.length > 0) {
            console.log(`[COSTOLayoutPlacer] Using ${this.rooms.length} pre-detected rooms`);
            return this._validateZones(this.rooms.filter(r => r.area >= this.minZoneArea));
        }

        // Detect rooms from walls
        if (this.walls && this.walls.length > 0) {
            console.log(`[COSTOLayoutPlacer] Detecting zones from ${this.walls.length} walls...`);
            try {
                const detectedRooms = roomDetector.detectRooms(
                    this.walls,
                    this.entrances,
                    this.forbiddenZones,
                    this.bounds,
                    { snapTolerance: 0.1, minRoomArea: this.minZoneArea }
                );
                console.log(`[COSTOLayoutPlacer] RoomDetector found ${detectedRooms.length} rooms`);

                // Validate and filter to large zones suitable for storage
                const validated = this._validateZones(detectedRooms);
                const filtered = validated.filter(r => r.area >= this.minZoneArea);
                console.log(`[COSTOLayoutPlacer] After validation/filter: ${filtered.length} zones`);
                return filtered;
            } catch (e) {
                console.error('[COSTOLayoutPlacer] Room detection failed:', e.message);
            }
        } else {
            console.log('[COSTOLayoutPlacer] No walls available for room detection');
        }

        return [];
    }

    _validateZones(zones) {
        // Ensure all zones have valid bounds - compute from polygon if needed
        return zones.filter(zone => {
            if (!zone) return false;

            // Ensure bounds exist
            if (!zone.bounds && zone.polygon && zone.polygon.length >= 3) {
                zone.bounds = this._getPolygonBounds(zone.polygon);
            }

            // Must have valid bounds
            if (!zone.bounds ||
                typeof zone.bounds.minX !== 'number' ||
                typeof zone.bounds.maxX !== 'number') {
                console.warn(`[COSTOLayoutPlacer] Skipping zone ${zone.id} - invalid bounds`);
                return false;
            }

            // Ensure area is computed
            if (typeof zone.area !== 'number') {
                zone.area = (zone.bounds.maxX - zone.bounds.minX) * (zone.bounds.maxY - zone.bounds.minY);
            }

            return zone.area > 0;
        });
    }

    _createZoneFromBounds() {
        const { minX, minY, maxX, maxY } = this.bounds;
        return {
            id: 'zone_bounds',
            bounds: this.bounds,
            area: (maxX - minX) * (maxY - minY),
            polygon: [
                { x: minX, y: minY },
                { x: maxX, y: minY },
                { x: maxX, y: maxY },
                { x: minX, y: maxY }
            ]
        };
    }

    _fillZoneWithBoxes(zone, sizes, startSizeIdx, targetCount) {
        const ilots = [];
        const bounds = zone.bounds || this._getPolygonBounds(zone.polygon);

        if (!bounds) return ilots;

        const { minX, minY, maxX, maxY } = bounds;
        const zoneWidth = maxX - minX;
        const zoneHeight = maxY - minY;

        // Skip zones too small
        if (zoneWidth < this.minBoxWidth * 2 || zoneHeight < this.boxDepth * 2) {
            return ilots;
        }

        // Usable area with margins
        const startX = minX + this.margin;
        const endX = maxX - this.margin;
        const startY = minY + this.margin;
        const endY = maxY - this.margin;
        const usableHeight = endY - startY;

        // Calculate strips (double-row + corridor pattern)
        const doubleRowHeight = 2 * this.boxDepth;
        const stripWithCorridor = doubleRowHeight + this.corridorWidth;
        const numStrips = Math.max(1, Math.floor((usableHeight + this.corridorWidth) / stripWithCorridor));

        let currentY = startY;
        let sizeIdx = startSizeIdx;
        let ilotsCreated = 0;

        for (let stripIdx = 0; stripIdx < numStrips && ilotsCreated < targetCount; stripIdx++) {
            // Row 1
            let x = startX;
            while (x < endX - this.minBoxWidth && ilotsCreated < targetCount) {
                const width = this._getWidth(sizes, sizeIdx++, endX - x);
                if (width < this.minBoxWidth) break;

                // Check if box is valid (inside zone, not in forbidden area)
                if (this._isValidPlacement(x, currentY, width, this.boxDepth, zone)) {
                    ilots.push(this._createIlot(x, currentY, width, this.boxDepth, zone.id, stripIdx, 0, ilots.length));
                    ilotsCreated++;
                }
                x += width + 0.05;
            }

            // Row 2 (back-to-back)
            const row2Y = currentY + this.boxDepth;
            x = startX;
            while (x < endX - this.minBoxWidth && ilotsCreated < targetCount) {
                const width = this._getWidth(sizes, sizeIdx++, endX - x);
                if (width < this.minBoxWidth) break;

                if (this._isValidPlacement(x, row2Y, width, this.boxDepth, zone)) {
                    ilots.push(this._createIlot(x, row2Y, width, this.boxDepth, zone.id, stripIdx, 1, ilots.length));
                    ilotsCreated++;
                }
                x += width + 0.05;
            }

            currentY += doubleRowHeight;

            // Add internal corridor between strip pairs
            if (stripIdx < numStrips - 1) {
                this.corridors.push({
                    x: startX,
                    y: currentY,
                    width: endX - startX,
                    height: this.corridorWidth,
                    type: 'internal',
                    zoneId: zone.id
                });
            }

            currentY += this.corridorWidth;
        }

        return ilots;
    }

    _isValidPlacement(x, y, width, height, zone) {
        // Check against forbidden zones
        for (const fz of this.forbiddenZones) {
            if (this._boxIntersects(x, y, width, height, fz)) {
                return false;
            }
        }

        // Check if inside zone polygon (if available)
        if (zone.polygon && zone.polygon.length >= 3) {
            const centerX = x + width / 2;
            const centerY = y + height / 2;
            if (!this._pointInPolygon(centerX, centerY, zone.polygon)) {
                return false;
            }
        }

        return true;
    }

    _boxIntersects(x, y, w, h, zone) {
        let zx, zy, zw, zh;

        if (zone.bounds) {
            zx = zone.bounds.minX;
            zy = zone.bounds.minY;
            zw = zone.bounds.maxX - zone.bounds.minX;
            zh = zone.bounds.maxY - zone.bounds.minY;
        } else if (zone.x !== undefined) {
            zx = zone.x;
            zy = zone.y;
            zw = zone.width || 0;
            zh = zone.height || 0;
        } else {
            return false;
        }

        return !(x + w < zx || x > zx + zw || y + h < zy || y > zy + zh);
    }

    _pointInPolygon(x, y, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x !== undefined ? polygon[i].x : polygon[i][0];
            const yi = polygon[i].y !== undefined ? polygon[i].y : polygon[i][1];
            const xj = polygon[j].x !== undefined ? polygon[j].x : polygon[j][0];
            const yj = polygon[j].y !== undefined ? polygon[j].y : polygon[j][1];

            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }

    _getPolygonBounds(polygon) {
        if (!polygon || polygon.length === 0) return null;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let validPoints = 0;

        for (const p of polygon) {
            if (!p) continue; // Skip undefined/null points

            let px, py;
            if (typeof p.x === 'number') {
                px = p.x;
                py = p.y;
            } else if (Array.isArray(p) && p.length >= 2) {
                px = p[0];
                py = p[1];
            } else {
                continue; // Skip invalid point format
            }

            if (typeof px !== 'number' || typeof py !== 'number' || !isFinite(px) || !isFinite(py)) {
                continue; // Skip non-numeric
            }

            minX = Math.min(minX, px);
            minY = Math.min(minY, py);
            maxX = Math.max(maxX, px);
            maxY = Math.max(maxY, py);
            validPoints++;
        }

        if (validPoints < 3) return null; // Need at least 3 valid points
        return { minX, minY, maxX, maxY };
    }

    _addZonePerimeterCorridor(zone) {
        const bounds = zone.bounds || this._getPolygonBounds(zone.polygon);
        if (!bounds) return;

        this.corridors.push({
            x: bounds.minX,
            y: bounds.minY,
            width: bounds.maxX - bounds.minX,
            height: bounds.maxY - bounds.minY,
            type: 'perimeter',
            zoneId: zone.id,
            isPerimeter: true
        });
    }

    _createIlot(x, y, width, height, zoneId, strip, row, index) {
        const area = width * height;
        return {
            x, y, width, height, area,
            zoneId, strip, row,
            type: area <= 6 ? 'S' : area <= 12 ? 'M' : 'L',
            sizeCategory: `${Math.floor(area)}-${Math.ceil(area)}`,
            label: `${width.toFixed(1)}m`,
            capacity: Math.max(1, Math.floor(area / 5))
        };
    }

    _getWidth(sizes, idx, maxWidth) {
        if (sizes.length > 0) {
            const targetArea = sizes[idx % sizes.length];
            const width = Math.min(this.maxBoxWidth, Math.max(this.minBoxWidth, targetArea / this.boxDepth));
            return Math.min(maxWidth - 0.05, width);
        }
        return Math.min(maxWidth - 0.05, this.minBoxWidth + Math.random() * (this.maxBoxWidth - this.minBoxWidth));
    }

    _buildSizes(distribution, count) {
        const sizes = [];
        if (!distribution) return sizes;

        Object.entries(distribution).forEach(([key, weight]) => {
            const match = key.match(/(\d+)-(\d+)/);
            if (match) {
                const min = parseFloat(match[1]);
                const max = parseFloat(match[2]);
                const num = Math.ceil((typeof weight === 'number' ? weight : 1) * count / 100);
                for (let i = 0; i < num; i++) {
                    sizes.push(min + Math.random() * (max - min));
                }
            }
        });

        // Shuffle
        for (let i = sizes.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [sizes[i], sizes[j]] = [sizes[j], sizes[i]];
        }

        return sizes;
    }

    getCorridors() {
        return this.corridors;
    }
}

module.exports = COSTOLayoutPlacer;
