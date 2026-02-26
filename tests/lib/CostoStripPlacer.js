/**
 * CostoStripPlacer - Production COSTO storage layout engine
 * 
 * Implements professional strip-based storage unit placement:
 * - Horizontal strips with back-to-back rows
 * - Main corridors at zone boundaries
 * - Access corridors between row pairs
 * - Strict wall collision enforcement
 * - COSTO standard dimensions and clearances
 */

class CostoStripPlacer {
    constructor(floorPlan, options = {}) {
        this.floorPlan = floorPlan;
        this.bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        this.walls = floorPlan.walls || [];
        this.forbiddenZones = floorPlan.forbiddenZones || [];
        this.entrances = floorPlan.entrances || [];
        this.storageZones = floorPlan.storageZones || [];

        // COSTO standard dimensions (meters)
        this.mainCorridorWidth = options.mainCorridorWidth || 1.5;
        this.accessCorridorWidth = options.accessCorridorWidth || 1.2;
        this.wallClearance = options.wallClearance || 0.3;
        this.boxSpacing = options.boxSpacing || 0.05; // 5cm between boxes

        // Box dimensions from COSTO catalog
        this.boxCatalog = options.boxCatalog || [
            { type: 'SMALL', width: 1.5, height: 2.0, area: 3 },
            { type: 'MEDIUM', width: 2.0, height: 2.5, area: 5 },
            { type: 'LARGE', width: 2.5, height: 3.0, area: 7.5 },
            { type: 'XLARGE', width: 3.0, height: 4.0, area: 12 }
        ];

        // Internal state
        this.placedBoxes = [];
        this.corridors = [];
        this.stats = { targetCount: 0, placedCount: 0 };
    }

    /**
     * Generate organized storage layout
     * @param {Object} distribution - Size distribution {small: 20, medium: 50, ...}
     * @param {Number} targetCount - Target number of boxes
     * @returns {Array} Placed boxes
     */
    generateLayout(distribution, targetCount = 50) {
        console.log(`[CostoStripPlacer] Starting organized strip layout`);
        console.log(`[CostoStripPlacer] Storage zones: ${this.storageZones.length}`);
        console.log(`[CostoStripPlacer] Target: ${targetCount} boxes`);

        this.placedBoxes = [];
        this.corridors = [];
        this.stats.targetCount = targetCount;

        // If we have storage zones from detector, use them
        if (this.storageZones.length > 0) {
            for (const zone of this.storageZones) {
                this._fillZoneWithStrips(zone, distribution);
            }
        } else {
            // Fallback: create single zone from bounds with wall clearance
            const zone = this._createDefaultZone();
            this._fillZoneWithStrips(zone, distribution);
        }

        this.stats.placedCount = this.placedBoxes.length;
        console.log(`[CostoStripPlacer] Placed ${this.placedBoxes.length} boxes`);

        return this.placedBoxes;
    }

    /**
     * Fill a storage zone with horizontal strips
     */
    _fillZoneWithStrips(zone, distribution) {
        const bounds = zone.bounds;
        if (!bounds) return;

        // Inset by main corridor width
        const innerBounds = {
            minX: bounds.minX + this.mainCorridorWidth,
            maxX: bounds.maxX - this.mainCorridorWidth,
            minY: bounds.minY + this.mainCorridorWidth,
            maxY: bounds.maxY - this.mainCorridorWidth
        };

        // Add main corridor around zone perimeter
        this._addPerimeterCorridor(bounds, innerBounds);

        // Calculate strip layout
        const stripHeight = this._calculateOptimalStripHeight(distribution);
        const stripSpacing = stripHeight * 2 + this.accessCorridorWidth; // Two rows + corridor

        let currentY = innerBounds.minY;
        let stripIndex = 0;

        while (currentY + stripHeight <= innerBounds.maxY) {
            // Place first row of strip
            this._placeRowOfBoxes(
                innerBounds.minX,
                innerBounds.maxX,
                currentY,
                stripHeight,
                distribution,
                'DOWN', // Boxes face down (corridor below)
                stripIndex * 2
            );

            // Place second row (back-to-back)
            const secondRowY = currentY + stripHeight;
            if (secondRowY + stripHeight <= innerBounds.maxY) {
                this._placeRowOfBoxes(
                    innerBounds.minX,
                    innerBounds.maxX,
                    secondRowY,
                    stripHeight,
                    distribution,
                    'UP', // Boxes face up (corridor above)
                    stripIndex * 2 + 1
                );
            }

            // Add access corridor after row pair
            const corridorY = currentY + stripHeight * 2;
            if (corridorY + this.accessCorridorWidth <= innerBounds.maxY) {
                this.corridors.push({
                    type: 'ACCESS',
                    x: innerBounds.minX,
                    y: corridorY,
                    width: innerBounds.maxX - innerBounds.minX,
                    height: this.accessCorridorWidth,
                    orientation: 'HORIZONTAL'
                });
            }

            currentY += stripSpacing;
            stripIndex++;
        }
    }

    /**
     * Place a row of boxes
     */
    _placeRowOfBoxes(minX, maxX, y, rowHeight, distribution, facing, rowId) {
        let currentX = minX;
        let boxIndex = 0;

        while (currentX < maxX - 1) { // At least 1m remaining
            // Select box size based on distribution
            const boxType = this._selectBoxType(distribution);
            const boxWidth = boxType.width;
            const boxHeight = Math.min(boxType.height, rowHeight);

            // Check if box fits horizontally
            if (currentX + boxWidth > maxX) {
                break;
            }

            // Collision check before placement
            if (!this._isValidPlacement(currentX, y, boxWidth, boxHeight)) {
                currentX += 0.5; // Skip forward
                continue;
            }

            // Place the box
            this.placedBoxes.push({
                id: `box_${this.placedBoxes.length + 1}`,
                x: currentX,
                y: y,
                width: boxWidth,
                height: boxHeight,
                area: boxWidth * boxHeight,
                type: boxType.type,
                facing: facing,
                rowId: rowId,
                label: `${(boxWidth * boxHeight).toFixed(1)}m²`
            });

            currentX += boxWidth + this.boxSpacing;
            boxIndex++;
        }
    }

    /**
     * Strict collision validation
     * Returns false if placement would violate any constraint
     */
    _isValidPlacement(x, y, width, height) {
        // Check wall collisions with buffer
        if (this._collidesWithWalls(x, y, width, height)) {
            return false;
        }

        // Check forbidden zones
        if (this._collidesWithForbidden(x, y, width, height)) {
            return false;
        }

        // Check entrance clearance
        if (this._collidesWithEntrances(x, y, width, height)) {
            return false;
        }

        // Check overlap with existing boxes
        if (this._overlapsExistingBoxes(x, y, width, height)) {
            return false;
        }

        return true;
    }

    /**
     * Check wall collision with buffer zone
     */
    _collidesWithWalls(x, y, width, height) {
        const buffer = this.wallClearance;

        // Inflate box by buffer
        const checkX = x - buffer;
        const checkY = y - buffer;
        const checkW = width + buffer * 2;
        const checkH = height + buffer * 2;

        for (const wall of this.walls) {
            if (wall.start && wall.end) {
                if (this._lineIntersectsRect(
                    wall.start.x, wall.start.y,
                    wall.end.x, wall.end.y,
                    checkX, checkY, checkW, checkH
                )) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Line-rectangle intersection test
     */
    _lineIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh) {
        // Check if line endpoints are inside rectangle
        if (this._pointInRect(x1, y1, rx, ry, rw, rh) ||
            this._pointInRect(x2, y2, rx, ry, rw, rh)) {
            return true;
        }

        // Check line against all four edges using line-line intersection
        const edges = [
            [rx, ry, rx + rw, ry],           // Top
            [rx + rw, ry, rx + rw, ry + rh], // Right
            [rx, ry + rh, rx + rw, ry + rh], // Bottom
            [rx, ry, rx, ry + rh]            // Left
        ];

        for (const edge of edges) {
            if (this._lineIntersectsLine(x1, y1, x2, y2, edge[0], edge[1], edge[2], edge[3])) {
                return true;
            }
        }

        return false;
    }

    /**
     * Line-line intersection test
     */
    _lineIntersectsLine(x1, y1, x2, y2, x3, y3, x4, y4) {
        const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
        if (Math.abs(denom) < 1e-10) return false; // Parallel

        const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
        const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

        return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
    }

    /**
     * Point in rectangle test
     */
    _pointInRect(px, py, rx, ry, rw, rh) {
        return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
    }

    /**
     * Check forbidden zone collision
     */
    _collidesWithForbidden(x, y, width, height) {
        for (const zone of this.forbiddenZones) {
            const zb = this._getZoneBounds(zone);
            if (!zb) continue;

            // Check axis-aligned rectangle overlap
            if (this._rectsOverlap(x, y, width, height, zb.minX, zb.minY, zb.maxX - zb.minX, zb.maxY - zb.minY)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Check entrance clearance
     */
    _collidesWithEntrances(x, y, width, height) {
        const clearance = 3.0; // 3m entrance clearance

        for (const entrance of this.entrances) {
            const eb = this._getZoneBounds(entrance);
            if (!eb) continue;

            // Inflate entrance bounds by clearance
            const inflatedBounds = {
                minX: eb.minX - clearance,
                maxX: eb.maxX + clearance,
                minY: eb.minY - clearance,
                maxY: eb.maxY + clearance
            };

            if (this._rectsOverlap(x, y, width, height,
                inflatedBounds.minX, inflatedBounds.minY,
                inflatedBounds.maxX - inflatedBounds.minX,
                inflatedBounds.maxY - inflatedBounds.minY)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Check overlap with existing boxes
     */
    _overlapsExistingBoxes(x, y, width, height) {
        const buffer = this.boxSpacing;

        for (const box of this.placedBoxes) {
            if (this._rectsOverlap(
                x - buffer, y - buffer, width + buffer * 2, height + buffer * 2,
                box.x, box.y, box.width, box.height
            )) {
                return true;
            }
        }
        return false;
    }

    /**
     * Rectangle overlap test
     */
    _rectsOverlap(x1, y1, w1, h1, x2, y2, w2, h2) {
        return !(x1 + w1 <= x2 || x2 + w2 <= x1 || y1 + h1 <= y2 || y2 + h2 <= y1);
    }

    /**
     * Select box type based on distribution
     */
    _selectBoxType(distribution) {
        // Weighted random selection
        const weights = [
            distribution.small || 25,
            distribution.medium || 40,
            distribution.large || 25,
            distribution.xlarge || 10
        ];

        const total = weights.reduce((a, b) => a + b, 0);
        let rand = Math.random() * total;

        for (let i = 0; i < this.boxCatalog.length; i++) {
            rand -= weights[i];
            if (rand <= 0) {
                return this.boxCatalog[i];
            }
        }

        return this.boxCatalog[1]; // Default to medium
    }

    /**
     * Calculate optimal strip height based on box sizes
     */
    _calculateOptimalStripHeight(distribution) {
        // Average box height weighted by distribution
        const weights = [
            distribution.small || 25,
            distribution.medium || 40,
            distribution.large || 25,
            distribution.xlarge || 10
        ];
        const total = weights.reduce((a, b) => a + b, 0);

        let avgHeight = 0;
        for (let i = 0; i < this.boxCatalog.length; i++) {
            avgHeight += this.boxCatalog[i].height * (weights[i] / total);
        }

        return avgHeight;
    }

    /**
     * Add perimeter corridor around zone
     */
    _addPerimeterCorridor(outerBounds, innerBounds) {
        // Main corridors around perimeter
        this.corridors.push({
            type: 'MAIN',
            x: outerBounds.minX,
            y: outerBounds.minY,
            width: this.mainCorridorWidth,
            height: outerBounds.maxY - outerBounds.minY,
            orientation: 'VERTICAL',
            side: 'LEFT'
        });

        this.corridors.push({
            type: 'MAIN',
            x: outerBounds.maxX - this.mainCorridorWidth,
            y: outerBounds.minY,
            width: this.mainCorridorWidth,
            height: outerBounds.maxY - outerBounds.minY,
            orientation: 'VERTICAL',
            side: 'RIGHT'
        });
    }

    /**
     * Create default zone from bounds
     */
    _createDefaultZone() {
        return {
            id: 'default_zone',
            bounds: {
                minX: this.bounds.minX + this.wallClearance,
                maxX: this.bounds.maxX - this.wallClearance,
                minY: this.bounds.minY + this.wallClearance,
                maxY: this.bounds.maxY - this.wallClearance
            },
            area: (this.bounds.maxX - this.bounds.minX) * (this.bounds.maxY - this.bounds.minY)
        };
    }

    /**
     * Get bounds from zone
     */
    _getZoneBounds(zone) {
        if (zone.bounds) return zone.bounds;
        if (zone.x !== undefined) {
            return {
                minX: zone.x,
                maxX: zone.x + (zone.width || 0),
                minY: zone.y,
                maxY: zone.y + (zone.height || 0)
            };
        }
        return null;
    }

    /**
     * Get generated corridors
     */
    getCorridors() {
        return this.corridors;
    }

    /**
     * Get placement statistics
     */
    getStats() {
        return this.stats;
    }
}

module.exports = CostoStripPlacer;
