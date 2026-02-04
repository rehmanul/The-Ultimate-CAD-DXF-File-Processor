/**
 * COSTOLayoutPlacer - Professional COSTO-style ilot layout
 * 
 * KEY PATTERN (from COSTO reference):
 * - Boxes START AT WALLS and face inward
 * - Central corridor runs through MIDDLE of each room/zone
 * - Double-row pattern: boxes on both sides of central aisle
 * - Red zigzag circulation line along central corridor
 * - Cyan arrows showing traffic direction
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
        this.boxDepth = options.boxDepth || 2.5;           // Depth of storage boxes (perpendicular to aisle)
        this.centralAisleWidth = options.centralAisleWidth || 2.0;  // Main central corridor width
        this.minBoxWidth = options.minBoxWidth || 1.0;     // Minimum box width
        this.maxBoxWidth = options.maxBoxWidth || 4.0;     // Maximum box width
        this.boxGap = options.boxGap || 0.1;               // Gap between adjacent boxes
    }

    /**
     * Generate ilots in COSTO style:
     * - Boxes touch walls on left and right
     * - Central corridor runs down the middle
     */
    generateIlots(distribution, targetCount = 50, unitMix = []) {
        console.log('[COSTOLayoutPlacer] Generating wall-touching layout with central corridor');

        const ilots = [];
        const { minX, minY, maxX, maxY } = this.bounds;

        const boundsWidth = maxX - minX;
        const boundsHeight = maxY - minY;

        // Determine layout orientation based on room shape
        const isWiderThanTall = boundsWidth > boundsHeight;

        // Build size distribution
        const sizes = this._buildSizeDistribution(distribution, unitMix);

        if (isWiderThanTall) {
            // Horizontal layout: boxes on top and bottom, corridor in middle
            this._placeHorizontalLayout(ilots, sizes, targetCount);
        } else {
            // Vertical layout: boxes on left and right, corridor in middle
            this._placeVerticalLayout(ilots, sizes, targetCount);
        }

        // Assign IDs
        ilots.forEach((ilot, idx) => {
            ilot.id = `ilot_${idx + 1}`;
            ilot.index = idx;
        });

        console.log(`[COSTOLayoutPlacer] Generated ${ilots.length} ilots with central corridor`);
        return ilots;
    }

    /**
     * Vertical layout: boxes on LEFT and RIGHT walls, corridor through MIDDLE
     */
    _placeVerticalLayout(ilots, sizes, targetCount) {
        const { minX, minY, maxX, maxY } = this.bounds;
        const boundsWidth = maxX - minX;
        const boundsHeight = maxY - minY;

        // Calculate corridor center
        const centerX = (minX + maxX) / 2;
        const halfAisle = this.centralAisleWidth / 2;

        // Left side: boxes from minX to (centerX - halfAisle)
        const leftRowX = minX;
        const leftRowWidth = (centerX - halfAisle) - minX;

        // Right side: boxes from (centerX + halfAisle) to maxX
        const rightRowX = centerX + halfAisle;
        const rightRowWidth = maxX - rightRowX;

        let remainingCount = targetCount;
        let rowIndex = 0;

        // Fill left side (rows go from bottom to top)
        let currentY = minY;
        while (currentY < maxY - this.minBoxWidth && remainingCount > 0) {
            const boxWidth = this._selectWidth(sizes, Math.min(leftRowWidth, this.maxBoxWidth));
            const boxHeight = this._selectHeight(sizes, maxY - currentY);

            if (boxHeight < this.minBoxWidth) break;

            if (this._isValidPosition(leftRowX, currentY, boxWidth, boxHeight)) {
                const area = boxWidth * boxHeight;
                ilots.push({
                    x: leftRowX,
                    y: currentY,
                    width: Math.min(boxWidth, leftRowWidth),
                    height: boxHeight,
                    area: area,
                    row: rowIndex,
                    side: 'left',
                    type: this._getType(area),
                    sizeCategory: this._getSizeCategory(area),
                    label: `${boxWidth.toFixed(2)}m`,
                    capacity: Math.max(1, Math.floor(area / 5))
                });
                remainingCount--;
            }
            currentY += boxHeight + this.boxGap;
            rowIndex++;
        }

        // Fill right side (rows go from bottom to top)
        currentY = minY;
        rowIndex = 0;
        while (currentY < maxY - this.minBoxWidth && remainingCount > 0) {
            const boxWidth = this._selectWidth(sizes, Math.min(rightRowWidth, this.maxBoxWidth));
            const boxHeight = this._selectHeight(sizes, maxY - currentY);

            if (boxHeight < this.minBoxWidth) break;

            if (this._isValidPosition(rightRowX, currentY, boxWidth, boxHeight)) {
                const area = boxWidth * boxHeight;
                ilots.push({
                    x: rightRowX,
                    y: currentY,
                    width: Math.min(boxWidth, rightRowWidth),
                    height: boxHeight,
                    area: area,
                    row: rowIndex,
                    side: 'right',
                    type: this._getType(area),
                    sizeCategory: this._getSizeCategory(area),
                    label: `${boxWidth.toFixed(2)}m`,
                    capacity: Math.max(1, Math.floor(area / 5))
                });
                remainingCount--;
            }
            currentY += boxHeight + this.boxGap;
            rowIndex++;
        }

        // Store central corridor info for rendering
        this.centralCorridor = {
            type: 'vertical',
            x: centerX - halfAisle,
            y: minY,
            width: this.centralAisleWidth,
            height: boundsHeight
        };
    }

    /**
     * Horizontal layout: boxes on TOP and BOTTOM walls, corridor through MIDDLE
     */
    _placeHorizontalLayout(ilots, sizes, targetCount) {
        const { minX, minY, maxX, maxY } = this.bounds;
        const boundsWidth = maxX - minX;
        const boundsHeight = maxY - minY;

        // Calculate corridor center
        const centerY = (minY + maxY) / 2;
        const halfAisle = this.centralAisleWidth / 2;

        // Bottom side: boxes from minY to (centerY - halfAisle)
        const bottomRowY = minY;
        const bottomRowHeight = (centerY - halfAisle) - minY;

        // Top side: boxes from (centerY + halfAisle) to maxY
        const topRowY = centerY + halfAisle;
        const topRowHeight = maxY - topRowY;

        let remainingCount = targetCount;

        // Fill bottom side (boxes go from left to right)
        let currentX = minX;
        let rowIndex = 0;
        while (currentX < maxX - this.minBoxWidth && remainingCount > 0) {
            const boxWidth = this._selectWidth(sizes, maxX - currentX);
            const boxHeight = Math.min(bottomRowHeight, this.boxDepth);

            if (boxWidth < this.minBoxWidth) break;

            if (this._isValidPosition(currentX, bottomRowY, boxWidth, boxHeight)) {
                const area = boxWidth * boxHeight;
                ilots.push({
                    x: currentX,
                    y: bottomRowY,
                    width: boxWidth,
                    height: boxHeight,
                    area: area,
                    row: rowIndex,
                    side: 'bottom',
                    type: this._getType(area),
                    sizeCategory: this._getSizeCategory(area),
                    label: `${boxWidth.toFixed(2)}m`,
                    capacity: Math.max(1, Math.floor(area / 5))
                });
                remainingCount--;
            }
            currentX += boxWidth + this.boxGap;
            rowIndex++;
        }

        // Fill top side (boxes go from left to right)
        currentX = minX;
        rowIndex = 0;
        while (currentX < maxX - this.minBoxWidth && remainingCount > 0) {
            const boxWidth = this._selectWidth(sizes, maxX - currentX);
            const boxHeight = Math.min(topRowHeight, this.boxDepth);

            if (boxWidth < this.minBoxWidth) break;

            if (this._isValidPosition(currentX, topRowY, boxWidth, boxHeight)) {
                const area = boxWidth * boxHeight;
                ilots.push({
                    x: currentX,
                    y: topRowY,
                    width: boxWidth,
                    height: boxHeight,
                    area: area,
                    row: rowIndex,
                    side: 'top',
                    type: this._getType(area),
                    sizeCategory: this._getSizeCategory(area),
                    label: `${boxWidth.toFixed(2)}m`,
                    capacity: Math.max(1, Math.floor(area / 5))
                });
                remainingCount--;
            }
            currentX += boxWidth + this.boxGap;
            rowIndex++;
        }

        // Store central corridor info for rendering
        this.centralCorridor = {
            type: 'horizontal',
            x: minX,
            y: centerY - halfAisle,
            width: boundsWidth,
            height: this.centralAisleWidth
        };
    }

    /**
     * Select width for box based on distribution
     */
    _selectWidth(sizes, maxWidth) {
        const targetWidth = this.minBoxWidth + Math.random() * (this.maxBoxWidth - this.minBoxWidth);
        return Math.min(maxWidth, Math.max(this.minBoxWidth, targetWidth));
    }

    /**
     * Select height for box based on distribution
     */
    _selectHeight(sizes, maxHeight) {
        const targetHeight = this.boxDepth;
        return Math.min(maxHeight, Math.max(this.minBoxWidth, targetHeight));
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
