/**
 * COSTOLayoutPlacer - Professional COSTO-style ilot layout
 * 
 * FIXED: Dense, tightly-packed horizontal strips
 * 
 * Target Layout (from COSTO reference):
 * - Boxes fill entire width of each strip (wall-to-wall)
 * - Minimal gaps between boxes (just small dividers)
 * - Multiple horizontal strips stacked vertically
 * - Corridors only BETWEEN strips, not within
 * - Perimeter circulation around edges
 */
class COSTOLayoutPlacer {
    constructor(floorPlan, options = {}) {
        this.floorPlan = floorPlan;
        this.bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        this.walls = floorPlan.walls || [];
        this.forbiddenZones = floorPlan.forbiddenZones || [];
        this.entrances = floorPlan.entrances || [];
        this.rooms = floorPlan.rooms || [];

        // COSTO layout parameters - TIGHTER VALUES
        this.boxDepth = options.boxDepth || 2.5;            // Depth of each box row (height)
        this.corridorWidth = options.corridorWidth || 1.2;  // Width of corridors between strips
        this.perimeterMargin = options.perimeterMargin || 0.3; // Small margin from walls
        this.minBoxWidth = options.minBoxWidth || 1.0;      // Minimum box width
        this.maxBoxWidth = options.maxBoxWidth || 3.5;      // Maximum box width
        this.dividerWidth = options.dividerWidth || 0.05;   // Tiny gap between boxes (just divider line)

        // Track generated corridors for circulation lines
        this.corridors = [];
    }

    /**
     * Generate ilots in COSTO style with DENSE packing
     */
    generateIlots(distribution, targetCount = 50, unitMix = []) {
        console.log('[COSTOLayoutPlacer] Generating DENSE horizontal strip layout');

        const ilots = [];
        const { minX, minY, maxX, maxY } = this.bounds;

        const boundsWidth = maxX - minX;
        const boundsHeight = maxY - minY;

        // Calculate usable area (inside perimeter margin)
        const usableMinX = minX + this.perimeterMargin;
        const usableMaxX = maxX - this.perimeterMargin;
        const usableMinY = minY + this.perimeterMargin;
        const usableMaxY = maxY - this.perimeterMargin;
        const usableHeight = usableMaxY - usableMinY;
        const usableWidth = usableMaxX - usableMinX;

        // Calculate how many strips we can fit
        // Each strip = 2 rows back-to-back (2 * boxDepth) + corridor between strips
        const doubleRowHeight = 2 * this.boxDepth;
        const stripPlusCorridor = doubleRowHeight + this.corridorWidth;

        // Maximum strips that fit
        const numStrips = Math.max(1, Math.floor((usableHeight + this.corridorWidth) / stripPlusCorridor));

        // Recalculate to center strips
        const totalStripHeight = numStrips * doubleRowHeight + (numStrips - 1) * this.corridorWidth;
        const startY = usableMinY + (usableHeight - totalStripHeight) / 2;

        // Build size distribution
        const sizes = this._buildSizeDistribution(distribution, unitMix, targetCount);
        let sizeIndex = 0;

        let currentY = startY;

        // Create horizontal strips from bottom to top
        for (let stripIdx = 0; stripIdx < numStrips; stripIdx++) {
            // Row 1: Top row of this double-row strip
            const row1Y = currentY;
            // Row 2: Bottom row (back-to-back with row 1)
            const row2Y = currentY + this.boxDepth;

            // Fill ROW 1 - left to right, COMPLETELY
            let currentX = usableMinX;
            while (currentX < usableMaxX - this.minBoxWidth) {
                const remainingWidth = usableMaxX - currentX;
                const boxWidth = this._getBoxWidth(sizes, sizeIndex++, remainingWidth);

                if (boxWidth < this.minBoxWidth) break;

                // Check for forbidden zones/entrances
                if (this._isValidPosition(currentX, row1Y, boxWidth, this.boxDepth)) {
                    const area = boxWidth * this.boxDepth;
                    ilots.push({
                        x: currentX,
                        y: row1Y,
                        width: boxWidth,
                        height: this.boxDepth,
                        area: area,
                        strip: stripIdx,
                        row: stripIdx * 2,
                        type: this._getType(area),
                        sizeCategory: this._getSizeCategory(area),
                        label: `${boxWidth.toFixed(1)}m`,
                        capacity: Math.max(1, Math.floor(area / 5))
                    });
                }

                currentX += boxWidth + this.dividerWidth;
            }

            // Fill ROW 2 - left to right, COMPLETELY (back-to-back)
            currentX = usableMinX;
            while (currentX < usableMaxX - this.minBoxWidth) {
                const remainingWidth = usableMaxX - currentX;
                const boxWidth = this._getBoxWidth(sizes, sizeIndex++, remainingWidth);

                if (boxWidth < this.minBoxWidth) break;

                if (this._isValidPosition(currentX, row2Y, boxWidth, this.boxDepth)) {
                    const area = boxWidth * this.boxDepth;
                    ilots.push({
                        x: currentX,
                        y: row2Y,
                        width: boxWidth,
                        height: this.boxDepth,
                        area: area,
                        strip: stripIdx,
                        row: stripIdx * 2 + 1,
                        type: this._getType(area),
                        sizeCategory: this._getSizeCategory(area),
                        label: `${boxWidth.toFixed(1)}m`,
                        capacity: Math.max(1, Math.floor(area / 5))
                    });
                }

                currentX += boxWidth + this.dividerWidth;
            }

            // Move to next strip position
            currentY += doubleRowHeight;

            // Add corridor BETWEEN this strip and the next
            if (stripIdx < numStrips - 1) {
                this.corridors.push({
                    x: usableMinX,
                    y: currentY,
                    width: usableWidth,
                    height: this.corridorWidth,
                    type: 'horizontal',
                    stripBefore: stripIdx,
                    stripAfter: stripIdx + 1
                });
                currentY += this.corridorWidth;
            }
        }

        // Add perimeter corridor for circulation
        this._addPerimeterCorridors(minX, minY, maxX, maxY, boundsWidth, boundsHeight);

        // Assign IDs
        ilots.forEach((ilot, idx) => {
            ilot.id = `ilot_${idx + 1}`;
            ilot.index = idx;
        });

        console.log(`[COSTOLayoutPlacer] Generated ${ilots.length} ilots in ${numStrips} strips with ${this.corridors.length} corridors`);

        return ilots;
    }

    _addPerimeterCorridors(minX, minY, maxX, maxY, boundsWidth, boundsHeight) {
        this.corridors.push({
            x: minX,
            y: minY,
            width: boundsWidth,
            height: this.perimeterMargin,
            type: 'perimeter-bottom'
        });
        this.corridors.push({
            x: minX,
            y: maxY - this.perimeterMargin,
            width: boundsWidth,
            height: this.perimeterMargin,
            type: 'perimeter-top'
        });
        this.corridors.push({
            x: minX,
            y: minY,
            width: this.perimeterMargin,
            height: boundsHeight,
            type: 'perimeter-left'
        });
        this.corridors.push({
            x: maxX - this.perimeterMargin,
            y: minY,
            width: this.perimeterMargin,
            height: boundsHeight,
            type: 'perimeter-right'
        });
    }

    /**
     * Get box width from size distribution
     */
    _getBoxWidth(sizes, index, maxWidth) {
        if (sizes.length > 0) {
            const sizeEntry = sizes[index % sizes.length];
            const targetArea = sizeEntry.area || 5;
            const targetWidth = targetArea / this.boxDepth;
            // Clamp between min and available width
            return Math.min(maxWidth - this.dividerWidth, Math.max(this.minBoxWidth, targetWidth));
        }
        // Default width - random within range
        const targetWidth = this.minBoxWidth + Math.random() * (this.maxBoxWidth - this.minBoxWidth);
        return Math.min(maxWidth - this.dividerWidth, Math.max(this.minBoxWidth, targetWidth));
    }

    /**
     * Get the generated corridors for rendering
     */
    getCorridors() {
        return this.corridors;
    }

    /**
     * Build size distribution from unit mix
     */
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
                const avgArea = (minArea + maxArea) / 2;
                // Create enough entries based on weight
                const count = Math.ceil(weight * targetCount / 100) || 1;
                for (let i = 0; i < count; i++) {
                    // Vary area slightly within range
                    const area = minArea + Math.random() * (maxArea - minArea);
                    sizes.push({ area: area, type: key });
                }
            });
        }

        // Shuffle for more random distribution
        for (let i = sizes.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [sizes[i], sizes[j]] = [sizes[j], sizes[i]];
        }

        return sizes;
    }

    _parseRange(key) {
        const match = key.match(/(\d+)-(\d+)/);
        if (match) {
            return [parseFloat(match[1]), parseFloat(match[2])];
        }
        return [2, 6];
    }

    /**
     * Check if position is valid for placing a box
     */
    _isValidPosition(x, y, width, height) {
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
