/**
 * COSTORoomSubdivider - Subdivides detected rooms into storage units
 * 
 * Uses actual room polygons from RoomDetector to create storage units
 * that fit within the architectural boundaries.
 */
class COSTORoomSubdivider {
    constructor(options = {}) {
        this.boxDepth = options.boxDepth || 2.5;            // Depth of each storage row
        this.corridorWidth = options.corridorWidth || 1.2;  // Corridor between double-rows
        this.minBoxWidth = options.minBoxWidth || 1.0;
        this.maxBoxWidth = options.maxBoxWidth || 4.0;
        this.dividerWidth = options.dividerWidth || 0.05;
        this.perimeterMargin = options.perimeterMargin || 0.3;
    }

    /**
     * Subdivide all rooms into storage units
     * @param {Array} rooms - Array of detected rooms with polygons
     * @param {Object} distribution - Size distribution
     * @param {Array} unitMix - Unit mix configuration
     * @param {number} targetCount - Target number of units
     * @returns {Object} { ilots: [], corridors: [] }
     */
    subdivideRooms(rooms, distribution, unitMix, targetCount) {
        console.log(`[COSTORoomSubdivider] Subdividing ${rooms.length} rooms`);

        const allIlots = [];
        const allCorridors = [];
        let remainingCount = targetCount;

        // Sort rooms by area (largest first) for better distribution
        const sortedRooms = [...rooms].sort((a, b) => b.area - a.area);

        // Build size distribution
        const sizes = this._buildSizeDistribution(distribution, unitMix, targetCount);
        let sizeIndex = 0;

        for (const room of sortedRooms) {
            if (remainingCount <= 0) break;

            // Calculate room's share of total units based on area ratio
            const totalArea = sortedRooms.reduce((sum, r) => sum + r.area, 0);
            const roomShare = Math.ceil((room.area / totalArea) * targetCount);
            const roomTargetCount = Math.min(roomShare, remainingCount);

            const result = this._subdivideRoom(room, sizes, sizeIndex, roomTargetCount);

            allIlots.push(...result.ilots);
            allCorridors.push(...result.corridors);

            sizeIndex += result.ilots.length;
            remainingCount -= result.ilots.length;
        }

        // Assign sequential IDs
        allIlots.forEach((ilot, idx) => {
            ilot.id = `ilot_${idx + 1}`;
            ilot.index = idx;
        });

        console.log(`[COSTORoomSubdivider] Created ${allIlots.length} units, ${allCorridors.length} corridors`);

        return { ilots: allIlots, corridors: allCorridors };
    }

    /**
     * Subdivide a single room into storage units
     */
    _subdivideRoom(room, sizes, startSizeIndex, targetCount) {
        const ilots = [];
        const corridors = [];

        // Get room bounds from polygon or bounds property
        const bounds = room.bounds || this._getPolygonBounds(room.polygon);
        if (!bounds) {
            console.warn(`[COSTORoomSubdivider] Room ${room.id} has no bounds`);
            return { ilots: [], corridors: [] };
        }

        const { minX, minY, maxX, maxY } = bounds;
        const roomWidth = maxX - minX;
        const roomHeight = maxY - minY;

        // Skip rooms that are too small
        if (roomWidth < this.minBoxWidth * 2 || roomHeight < this.boxDepth) {
            console.log(`[COSTORoomSubdivider] Room ${room.id} too small (${roomWidth.toFixed(1)} x ${roomHeight.toFixed(1)})`);
            return { ilots: [], corridors: [] };
        }

        // Calculate usable area
        const usableMinX = minX + this.perimeterMargin;
        const usableMaxX = maxX - this.perimeterMargin;
        const usableMinY = minY + this.perimeterMargin;
        const usableMaxY = maxY - this.perimeterMargin;
        const usableWidth = usableMaxX - usableMinX;
        const usableHeight = usableMaxY - usableMinY;

        if (usableWidth < this.minBoxWidth || usableHeight < this.boxDepth) {
            return { ilots: [], corridors: [] };
        }

        // Calculate strips (double-row + corridor pattern)
        const doubleRowHeight = 2 * this.boxDepth;
        const stripPlusCorridor = doubleRowHeight + this.corridorWidth;
        const numStrips = Math.max(1, Math.floor((usableHeight + this.corridorWidth) / stripPlusCorridor));

        // Center strips vertically
        const totalStripHeight = numStrips * doubleRowHeight + Math.max(0, numStrips - 1) * this.corridorWidth;
        let currentY = usableMinY + (usableHeight - totalStripHeight) / 2;

        let sizeIdx = startSizeIndex;
        let ilotsCreated = 0;

        for (let stripIdx = 0; stripIdx < numStrips && ilotsCreated < targetCount; stripIdx++) {
            const row1Y = currentY;
            const row2Y = currentY + this.boxDepth;

            // Fill row 1 (top of strip)
            let currentX = usableMinX;
            while (currentX < usableMaxX - this.minBoxWidth && ilotsCreated < targetCount) {
                const remainingWidth = usableMaxX - currentX;
                const boxWidth = this._getBoxWidth(sizes, sizeIdx++, remainingWidth);

                if (boxWidth < this.minBoxWidth) break;

                // Check if box is inside room polygon (if polygon exists)
                if (this._isInsideRoom(currentX, row1Y, boxWidth, this.boxDepth, room)) {
                    const area = boxWidth * this.boxDepth;
                    ilots.push({
                        x: currentX,
                        y: row1Y,
                        width: boxWidth,
                        height: this.boxDepth,
                        area: area,
                        roomId: room.id,
                        strip: stripIdx,
                        row: stripIdx * 2,
                        type: this._getType(area),
                        sizeCategory: this._getSizeCategory(area),
                        label: `${boxWidth.toFixed(1)}m`,
                        capacity: Math.max(1, Math.floor(area / 5))
                    });
                    ilotsCreated++;
                }
                currentX += boxWidth + this.dividerWidth;
            }

            // Fill row 2 (bottom of strip, back-to-back)
            currentX = usableMinX;
            while (currentX < usableMaxX - this.minBoxWidth && ilotsCreated < targetCount) {
                const remainingWidth = usableMaxX - currentX;
                const boxWidth = this._getBoxWidth(sizes, sizeIdx++, remainingWidth);

                if (boxWidth < this.minBoxWidth) break;

                if (this._isInsideRoom(currentX, row2Y, boxWidth, this.boxDepth, room)) {
                    const area = boxWidth * this.boxDepth;
                    ilots.push({
                        x: currentX,
                        y: row2Y,
                        width: boxWidth,
                        height: this.boxDepth,
                        area: area,
                        roomId: room.id,
                        strip: stripIdx,
                        row: stripIdx * 2 + 1,
                        type: this._getType(area),
                        sizeCategory: this._getSizeCategory(area),
                        label: `${boxWidth.toFixed(1)}m`,
                        capacity: Math.max(1, Math.floor(area / 5))
                    });
                    ilotsCreated++;
                }
                currentX += boxWidth + this.dividerWidth;
            }

            currentY += doubleRowHeight;

            // Add corridor between strips
            if (stripIdx < numStrips - 1) {
                corridors.push({
                    x: usableMinX,
                    y: currentY,
                    width: usableWidth,
                    height: this.corridorWidth,
                    type: 'horizontal',
                    roomId: room.id
                });
                currentY += this.corridorWidth;
            }
        }

        // Add perimeter corridor for this room
        corridors.push({
            x: minX,
            y: minY,
            width: roomWidth,
            height: this.perimeterMargin,
            type: 'perimeter',
            roomId: room.id
        });

        return { ilots, corridors };
    }

    /**
     * Check if a box is inside the room polygon
     */
    _isInsideRoom(x, y, width, height, room) {
        // Fast path: if no polygon, assume inside bounds
        if (!room.polygon || !Array.isArray(room.polygon) || room.polygon.length < 3) {
            return true;
        }

        // Check center point of box
        const centerX = x + width / 2;
        const centerY = y + height / 2;

        return this._pointInPolygon(centerX, centerY, room.polygon);
    }

    /**
     * Point-in-polygon test using ray casting
     */
    _pointInPolygon(x, y, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x || polygon[i][0];
            const yi = polygon[i].y || polygon[i][1];
            const xj = polygon[j].x || polygon[j][0];
            const yj = polygon[j].y || polygon[j][1];

            const intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    _getPolygonBounds(polygon) {
        if (!polygon || polygon.length === 0) return null;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of polygon) {
            const x = p.x !== undefined ? p.x : p[0];
            const y = p.y !== undefined ? p.y : p[1];
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
        return { minX, minY, maxX, maxY };
    }

    _getBoxWidth(sizes, index, maxWidth) {
        if (sizes.length > 0) {
            const sizeEntry = sizes[index % sizes.length];
            const targetArea = sizeEntry.area || 5;
            const targetWidth = targetArea / this.boxDepth;
            return Math.min(maxWidth - this.dividerWidth, Math.max(this.minBoxWidth, targetWidth));
        }
        const targetWidth = this.minBoxWidth + Math.random() * (this.maxBoxWidth - this.minBoxWidth);
        return Math.min(maxWidth - this.dividerWidth, Math.max(this.minBoxWidth, targetWidth));
    }

    _buildSizeDistribution(distribution, unitMix, targetCount) {
        const sizes = [];

        if (unitMix && unitMix.length > 0) {
            unitMix.forEach(unit => {
                const count = unit.count || unit.quantity || 1;
                const area = unit.area || unit.targetArea || 5;
                for (let i = 0; i < count; i++) {
                    sizes.push({ area: area, type: unit.type || 'standard' });
                }
            });
        } else if (distribution) {
            Object.entries(distribution).forEach(([key, value]) => {
                const weight = typeof value === 'number' ? value : (value.weight || value.count || 1);
                const [minArea, maxArea] = this._parseRange(key);
                const count = Math.ceil(weight * targetCount / 100) || 1;
                for (let i = 0; i < count; i++) {
                    const area = minArea + Math.random() * (maxArea - minArea);
                    sizes.push({ area: area, type: key });
                }
            });
        }

        // Shuffle
        for (let i = sizes.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [sizes[i], sizes[j]] = [sizes[j], sizes[i]];
        }

        return sizes;
    }

    _parseRange(key) {
        const match = key.match(/(\d+)-(\d+)/);
        if (match) return [parseFloat(match[1]), parseFloat(match[2])];
        return [2, 6];
    }

    _getType(area) {
        if (area <= 3) return 'XS';
        if (area <= 6) return 'S';
        if (area <= 12) return 'M';
        if (area <= 20) return 'L';
        return 'XL';
    }

    _getSizeCategory(area) {
        if (area <= 1) return '0-1';
        if (area <= 3) return '1-3';
        if (area <= 6) return '3-6';
        if (area <= 10) return '6-10';
        if (area <= 15) return '10-15';
        return '15+';
    }
}

module.exports = COSTORoomSubdivider;
