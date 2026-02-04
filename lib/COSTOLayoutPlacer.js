/**
 * COSTOLayoutPlacer - Professional COSTO-style ilot layout
 * Creates organized horizontal rows with:
 * - Uniform row heights
 * - Aligned boxes within rows
 * - Clear corridor gaps between rows
 * - Dimension labels ready for rendering
 */
class COSTOLayoutPlacer {
    constructor(floorPlan, options = {}) {
        this.floorPlan = floorPlan;
        this.bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        this.walls = floorPlan.walls || [];
        this.forbiddenZones = floorPlan.forbiddenZones || [];
        this.entrances = floorPlan.entrances || [];
        this.rooms = floorPlan.rooms || [];

        // COSTO layout parameters
        this.rowHeight = options.rowHeight || 2.5;      // Standard row height (m)
        this.corridorWidth = options.corridorWidth || 1.2;  // Gap between rows
        this.margin = options.margin || 1.0;            // Border margin
        this.minBoxWidth = options.minBoxWidth || 1.0;  // Minimum box width
        this.maxBoxWidth = options.maxBoxWidth || 4.0;  // Maximum box width
    }

    /**
     * Generate ilots in COSTO style - organized horizontal rows
     */
    generateIlots(distribution, targetCount = 50, unitMix = []) {
        console.log('[COSTOLayoutPlacer] Generating COSTO-style layout');

        const ilots = [];
        const { minX, minY, maxX, maxY } = this.bounds;

        // Calculate usable area
        const startX = minX + this.margin;
        const endX = maxX - this.margin;
        const startY = minY + this.margin;
        const endY = maxY - this.margin;

        const usableWidth = endX - startX;
        const usableHeight = endY - startY;

        // Calculate row parameters
        const rowSpacing = this.rowHeight + this.corridorWidth;
        const numRows = Math.floor(usableHeight / rowSpacing);

        // Build size distribution from unit mix or distribution
        const sizes = this._buildSizeDistribution(distribution, unitMix);

        let ilotId = 0;
        let remainingCount = targetCount;

        // Generate rows from bottom to top
        for (let row = 0; row < numRows && remainingCount > 0; row++) {
            const rowY = startY + (row * rowSpacing);
            const rowIlots = this._fillRow(startX, rowY, usableWidth, this.rowHeight, sizes, remainingCount, row);

            ilots.push(...rowIlots);
            remainingCount -= rowIlots.length;
        }

        // Assign IDs and finalize
        ilots.forEach((ilot, idx) => {
            ilot.id = `ilot_${idx + 1}`;
            ilot.index = idx;
        });

        console.log(`[COSTOLayoutPlacer] Generated ${ilots.length} ilots in ${numRows} rows`);
        return ilots;
    }

    /**
     * Fill a single row with boxes
     */
    _fillRow(startX, y, availableWidth, height, sizes, maxCount, rowIndex) {
        const rowIlots = [];
        let currentX = startX;
        const gap = 0.1; // Small gap between boxes in same row

        while (currentX < startX + availableWidth - this.minBoxWidth && rowIlots.length < maxCount) {
            // Select width for this box
            const remainingWidth = (startX + availableWidth) - currentX;
            const width = this._selectWidth(sizes, remainingWidth);

            if (width < this.minBoxWidth) break;

            // Check if position is valid (not in forbidden zone, entrance, etc.)
            if (this._isValidPosition(currentX, y, width, height)) {
                const area = width * height;
                const ilot = {
                    x: currentX,
                    y: y,
                    width: width,
                    height: height,
                    area: area,
                    row: rowIndex,
                    type: this._getType(area),
                    sizeCategory: this._getSizeCategory(area),
                    label: `${width.toFixed(2)}m`,
                    capacity: Math.max(1, Math.floor(area / 5))
                };

                rowIlots.push(ilot);
                currentX += width + gap;
            } else {
                // Skip this position
                currentX += this.minBoxWidth;
            }
        }

        return rowIlots;
    }

    /**
     * Select width for next box based on distribution
     */
    _selectWidth(sizes, maxWidth) {
        const availableWidth = Math.min(this.maxBoxWidth, maxWidth);

        if (sizes.length === 0) {
            // Default: random width between min and max
            return Math.min(availableWidth, this.minBoxWidth + Math.random() * (this.maxBoxWidth - this.minBoxWidth));
        }

        // Pick from distribution
        const sizeEntry = sizes[Math.floor(Math.random() * sizes.length)];
        const targetArea = sizeEntry.area || 5;
        const targetWidth = targetArea / this.rowHeight;

        return Math.min(availableWidth, Math.max(this.minBoxWidth, targetWidth));
    }

    /**
     * Build size distribution from unit mix
     */
    _buildSizeDistribution(distribution, unitMix) {
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
            // Use distribution object
            Object.entries(distribution).forEach(([key, value]) => {
                const count = value.count || value || 5;
                const [minArea, maxArea] = this._parseRange(key);
                for (let i = 0; i < count; i++) {
                    sizes.push({ area: (minArea + maxArea) / 2, type: key });
                }
            });
        }

        return sizes;
    }

    _parseRange(key) {
        const match = key.match(/(\d+)-(\d+)/);
        if (match) {
            return [parseFloat(match[1]), parseFloat(match[2])];
        }
        return [5, 10]; // Default
    }

    /**
     * Check if position is valid for placing a box
     */
    _isValidPosition(x, y, width, height) {
        // Check walls
        for (const wall of this.walls) {
            if (this._boxIntersectsWall(x, y, width, height, wall)) {
                return false;
            }
        }

        // Check forbidden zones
        for (const zone of this.forbiddenZones) {
            if (this._boxIntersectsZone(x, y, width, height, zone)) {
                return false;
            }
        }

        // Check entrances
        for (const entrance of this.entrances) {
            if (this._boxIntersectsZone(x, y, width, height, entrance)) {
                return false;
            }
        }

        return true;
    }

    _boxIntersectsWall(x, y, w, h, wall) {
        if (!wall.start || !wall.end) return false;

        const wallMinX = Math.min(wall.start.x, wall.end.x) - 0.1;
        const wallMaxX = Math.max(wall.start.x, wall.end.x) + 0.1;
        const wallMinY = Math.min(wall.start.y, wall.end.y) - 0.1;
        const wallMaxY = Math.max(wall.start.y, wall.end.y) + 0.1;

        return !(x + w < wallMinX || x > wallMaxX || y + h < wallMinY || y > wallMaxY);
    }

    _boxIntersectsZone(x, y, w, h, zone) {
        if (zone.bounds) {
            const zb = zone.bounds;
            return !(x + w < zb.minX || x > zb.maxX || y + h < zb.minY || y > zb.maxY);
        }
        if (zone.x !== undefined && zone.width !== undefined) {
            return !(x + w < zone.x || x > zone.x + zone.width ||
                y + h < zone.y || y > zone.y + zone.height);
        }
        return false;
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

module.exports = COSTOLayoutPlacer;
