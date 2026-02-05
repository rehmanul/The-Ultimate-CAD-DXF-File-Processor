/**
 * COSTOLayoutPlacer - Professional COSTO-style ilot layout
 * 
 * CORRECT PATTERN (from COSTO reference analysis):
 * 
 * 1. Boxes organized in HORIZONTAL STRIPS (double-rows)
 *    - Each strip = 2 rows of boxes facing each other (back-to-back)
 *    - Blue boxes with dark blue internal dividers
 * 
 * 2. CORRIDOR between each strip pair
 *    - Red zigzag circulation line runs through each corridor
 *    - Corridors are HORIZONTAL running left-to-right
 * 
 * 3. PERIMETER circulation
 *    - Zigzag around the outer edge connecting all corridors
 * 
 * Layout Structure:
 *    [Wall]
 *    [Box Row 1 - top strip]
 *    [Box Row 2 - top strip] (back-to-back with row 1)
 *    ═══════ CORRIDOR with zigzag ═══════
 *    [Box Row 3 - middle strip]
 *    [Box Row 4 - middle strip] (back-to-back with row 3)
 *    ═══════ CORRIDOR with zigzag ═══════
 *    [Box Row 5 - bottom strip]
 *    [Box Row 6 - bottom strip]
 *    [Wall]
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
        this.boxDepth = options.boxDepth || 2.5;            // Depth of each box row
        this.corridorWidth = options.corridorWidth || 1.5;  // Width of corridors between strips
        this.perimeterMargin = options.perimeterMargin || 0.5; // Margin from walls for perimeter aisle
        this.minBoxWidth = options.minBoxWidth || 1.0;      // Minimum box width
        this.maxBoxWidth = options.maxBoxWidth || 4.0;      // Maximum box width
        this.boxGap = options.boxGap || 0.05;               // Small gap between adjacent boxes

        // Track generated corridors for circulation lines
        this.corridors = [];
    }

    /**
     * Generate ilots in COSTO style:
     * - Horizontal strips of back-to-back box rows
     * - Corridors between strips with zigzag circulation
     */
    generateIlots(distribution, targetCount = 50, unitMix = []) {
        console.log('[COSTOLayoutPlacer] Generating horizontal strip layout with corridors');

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

        // Calculate strip dimensions
        // Each strip = 2 box rows (back-to-back) = 2 * boxDepth
        const stripHeight = 2 * this.boxDepth;
        const stripPlusCorridor = stripHeight + this.corridorWidth;

        // How many strips can we fit?
        const numStrips = Math.max(1, Math.floor(usableHeight / stripPlusCorridor));

        // Center the strips vertically
        const totalStripsHeight = numStrips * stripPlusCorridor - this.corridorWidth; // Last strip doesn't need trailing corridor
        const startY = usableMinY + (usableHeight - totalStripsHeight) / 2;

        // Build size distribution for box widths
        const sizes = this._buildSizeDistribution(distribution, unitMix);

        let ilotIndex = 0;
        let currentY = startY;

        // Create horizontal strips from bottom to top
        for (let stripIdx = 0; stripIdx < numStrips && ilotIndex < targetCount; stripIdx++) {
            // Top row of this strip
            const row1Y = currentY;
            // Bottom row of this strip (back-to-back, boxes face opposite directions)
            const row2Y = currentY + this.boxDepth;

            // Fill both rows of this strip
            let currentX = usableMinX;

            while (currentX < usableMaxX - this.minBoxWidth && ilotIndex < targetCount) {
                const remainingWidth = usableMaxX - currentX;
                const boxWidth = this._selectWidth(sizes, remainingWidth);

                if (boxWidth < this.minBoxWidth) break;

                // Top row box
                if (this._isValidPosition(currentX, row1Y, boxWidth, this.boxDepth) && ilotIndex < targetCount) {
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
                    ilotIndex++;
                }

                // Bottom row box (same x position, different y)
                if (this._isValidPosition(currentX, row2Y, boxWidth, this.boxDepth) && ilotIndex < targetCount) {
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
                    ilotIndex++;
                }

                currentX += boxWidth + this.boxGap;
            }

            // Move to next strip position
            currentY += stripHeight;

            // Add corridor BETWEEN this strip and the next (if not last strip)
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

        // Add perimeter corridor for circulation around the edges
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

        // Assign IDs
        ilots.forEach((ilot, idx) => {
            ilot.id = `ilot_${idx + 1}`;
            ilot.index = idx;
        });

        console.log(`[COSTOLayoutPlacer] Generated ${ilots.length} ilots in ${numStrips} strips with ${this.corridors.length} corridors`);

        return ilots;
    }

    /**
     * Get the generated corridors for rendering
     */
    getCorridors() {
        return this.corridors;
    }

    /**
     * Select width for box based on distribution
     */
    _selectWidth(sizes, maxWidth) {
        if (sizes.length > 0) {
            const sizeEntry = sizes[Math.floor(Math.random() * sizes.length)];
            const targetArea = sizeEntry.area || 5;
            const targetWidth = targetArea / this.boxDepth;
            return Math.min(maxWidth, Math.max(this.minBoxWidth, targetWidth));
        }
        // Default: random width
        const targetWidth = this.minBoxWidth + Math.random() * (this.maxBoxWidth - this.minBoxWidth);
        return Math.min(maxWidth, Math.max(this.minBoxWidth, targetWidth));
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
            Object.entries(distribution).forEach(([key, value]) => {
                const count = typeof value === 'number' ? Math.ceil(value * 10) : (value.count || 5);
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
        return [5, 10];
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

        // Check entrances (keep them clear)
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
