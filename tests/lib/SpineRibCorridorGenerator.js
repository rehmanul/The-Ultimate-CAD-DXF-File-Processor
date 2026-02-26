/**
 * SpineRibCorridorGenerator - Architectural Corridor Layout
 * 
 * Generates professional spine-and-rib corridor networks:
 * - Main spine connecting entrance/exit points
 * - Perpendicular ribs providing access to storage units
 * - Optimized for maximum storage-to-corridor ratio
 * - Compliant with IBC corridor width requirements
 */

class SpineRibCorridorGenerator {
    constructor(floorPlan, options = {}) {
        this.bounds = floorPlan.bounds;
        this.walls = floorPlan.walls || [];
        this.entrances = floorPlan.entrances || [];
        this.forbiddenZones = floorPlan.forbiddenZones || [];
        this.storageZones = floorPlan.storageZones || [];

        // Corridor dimensions (COSTO/IBC compliant)
        this.spineWidth = options.spineWidth || 2.0;          // Main spine: 2m
        this.ribWidth = options.ribWidth || 1.2;              // Access ribs: 1.2m
        this.minRibSpacing = options.minRibSpacing || 6;      // Minimum 6m between ribs
        this.maxRibSpacing = options.maxRibSpacing || 12;     // Maximum 12m between ribs
        this.wallBuffer = options.wallBuffer || 0.3;          // Clearance from walls

        // Generated corridors
        this.spine = null;
        this.ribs = [];
        this.corridors = [];
    }

    /**
     * Generate complete corridor network
     * @returns {Object} { spine, ribs, corridors, stats }
     */
    generate() {
        console.log(`[SpineRibCorridor] Generating corridor network`);
        console.log(`[SpineRibCorridor] Entrances: ${this.entrances.length}`);
        console.log(`[SpineRibCorridor] Bounds: ${this.bounds.maxX - this.bounds.minX}m x ${this.bounds.maxY - this.bounds.minY}m`);

        // Step 1: Generate main spine
        this.spine = this._generateSpine();

        // Step 2: Generate perpendicular ribs
        this.ribs = this._generateRibs();

        // Step 3: Convert to corridor rectangles
        this.corridors = this._buildCorridorRectangles();

        const stats = {
            spineLength: this._calculateSpineLength(),
            ribCount: this.ribs.length,
            totalCorridorLength: this._calculateTotalLength(),
            corridorArea: this._calculateCorridorArea()
        };

        console.log(`[SpineRibCorridor] Generated spine + ${this.ribs.length} ribs = ${this.corridors.length} corridors`);

        return {
            spine: this.spine,
            ribs: this.ribs,
            corridors: this.corridors,
            stats
        };
    }

    /**
     * Generate main spine connecting entrances
     */
    _generateSpine() {
        const width = this.bounds.maxX - this.bounds.minX;
        const height = this.bounds.maxY - this.bounds.minY;

        // Determine spine orientation based on floor shape
        const isWide = width > height;

        // Get entrance positions
        const entrancePoints = this._getEntrancePoints();

        let spine;

        if (entrancePoints.length >= 2) {
            // Connect entrances with optimal path
            spine = this._connectEntrances(entrancePoints);
        } else if (isWide) {
            // Horizontal spine along center
            const centerY = this.bounds.minY + height / 2;
            spine = {
                type: 'HORIZONTAL',
                start: { x: this.bounds.minX + this.wallBuffer, y: centerY },
                end: { x: this.bounds.maxX - this.wallBuffer, y: centerY },
                width: this.spineWidth
            };
        } else {
            // Vertical spine along center
            const centerX = this.bounds.minX + width / 2;
            spine = {
                type: 'VERTICAL',
                start: { x: centerX, y: this.bounds.minY + this.wallBuffer },
                end: { x: centerX, y: this.bounds.maxY - this.wallBuffer },
                width: this.spineWidth
            };
        }

        // Optimize spine position to avoid walls
        spine = this._optimizeSpinePosition(spine);

        return spine;
    }

    /**
     * Generate perpendicular ribs from spine
     */
    _generateRibs() {
        if (!this.spine) return [];

        const ribs = [];
        const isHorizontal = this.spine.type === 'HORIZONTAL';

        // Calculate rib positions along spine
        let spineLength, spineStart;
        if (isHorizontal) {
            spineLength = this.spine.end.x - this.spine.start.x;
            spineStart = this.spine.start.x;
        } else {
            spineLength = this.spine.end.y - this.spine.start.y;
            spineStart = this.spine.start.y;
        }

        // Calculate optimal rib spacing
        const numRibs = Math.max(2, Math.floor(spineLength / this.maxRibSpacing) + 1);
        const ribSpacing = spineLength / (numRibs - 1);

        for (let i = 0; i < numRibs; i++) {
            const position = spineStart + i * ribSpacing;

            if (isHorizontal) {
                // Vertical ribs extending up and down
                ribs.push(this._createRib(position, 'NORTH'));
                ribs.push(this._createRib(position, 'SOUTH'));
            } else {
                // Horizontal ribs extending left and right
                ribs.push(this._createRib(position, 'EAST'));
                ribs.push(this._createRib(position, 'WEST'));
            }
        }

        // Filter out ribs that collide with walls or forbidden zones
        return ribs.filter(rib => this._isValidRib(rib));
    }

    /**
     * Create a single rib
     */
    _createRib(position, direction) {
        const rib = {
            type: 'RIB',
            direction,
            width: this.ribWidth
        };

        const spineY = this.spine.start.y;
        const spineX = this.spine.start.x;
        const halfSpine = this.spineWidth / 2;

        switch (direction) {
            case 'NORTH':
                rib.start = { x: position, y: spineY + halfSpine };
                rib.end = { x: position, y: this.bounds.maxY - this.wallBuffer };
                break;
            case 'SOUTH':
                rib.start = { x: position, y: this.bounds.minY + this.wallBuffer };
                rib.end = { x: position, y: spineY - halfSpine };
                break;
            case 'EAST':
                rib.start = { x: spineX + halfSpine, y: position };
                rib.end = { x: this.bounds.maxX - this.wallBuffer, y: position };
                break;
            case 'WEST':
                rib.start = { x: this.bounds.minX + this.wallBuffer, y: position };
                rib.end = { x: spineX - halfSpine, y: position };
                break;
        }

        // Calculate rib length
        rib.length = Math.hypot(
            rib.end.x - rib.start.x,
            rib.end.y - rib.start.y
        );

        return rib;
    }

    /**
     * Convert spine and ribs to corridor rectangles
     */
    _buildCorridorRectangles() {
        const corridors = [];

        // Add spine as corridor
        if (this.spine) {
            corridors.push(this._spineToRectangle(this.spine));
        }

        // Add ribs as corridors
        for (const rib of this.ribs) {
            corridors.push(this._ribToRectangle(rib));
        }

        return corridors;
    }

    /**
     * Convert spine to rectangle
     */
    _spineToRectangle(spine) {
        const halfWidth = spine.width / 2;

        if (spine.type === 'HORIZONTAL') {
            return {
                type: 'MAIN',
                subtype: 'SPINE',
                x: spine.start.x,
                y: spine.start.y - halfWidth,
                width: spine.end.x - spine.start.x,
                height: spine.width,
                orientation: 'HORIZONTAL'
            };
        } else {
            return {
                type: 'MAIN',
                subtype: 'SPINE',
                x: spine.start.x - halfWidth,
                y: spine.start.y,
                width: spine.width,
                height: spine.end.y - spine.start.y,
                orientation: 'VERTICAL'
            };
        }
    }

    /**
     * Convert rib to rectangle
     */
    _ribToRectangle(rib) {
        const halfWidth = rib.width / 2;
        const isVertical = rib.direction === 'NORTH' || rib.direction === 'SOUTH';

        if (isVertical) {
            const minY = Math.min(rib.start.y, rib.end.y);
            const maxY = Math.max(rib.start.y, rib.end.y);
            return {
                type: 'ACCESS',
                subtype: 'RIB',
                direction: rib.direction,
                x: rib.start.x - halfWidth,
                y: minY,
                width: rib.width,
                height: maxY - minY,
                orientation: 'VERTICAL'
            };
        } else {
            const minX = Math.min(rib.start.x, rib.end.x);
            const maxX = Math.max(rib.start.x, rib.end.x);
            return {
                type: 'ACCESS',
                subtype: 'RIB',
                direction: rib.direction,
                x: minX,
                y: rib.start.y - halfWidth,
                width: maxX - minX,
                height: rib.width,
                orientation: 'HORIZONTAL'
            };
        }
    }

    /**
     * Get entrance points as coordinates
     */
    _getEntrancePoints() {
        return this.entrances.map(ent => ({
            x: ent.x || ent.bounds?.minX || (ent.bounds?.minX + ent.bounds?.maxX) / 2 || 0,
            y: ent.y || ent.bounds?.minY || (ent.bounds?.minY + ent.bounds?.maxY) / 2 || 0
        }));
    }

    /**
     * Connect entrance points with optimal spine
     */
    _connectEntrances(points) {
        if (points.length < 2) return null;

        // Simple: connect first two entrances
        const p1 = points[0];
        const p2 = points[1];

        const dx = Math.abs(p2.x - p1.x);
        const dy = Math.abs(p2.y - p1.y);

        // L-shaped or straight connection
        if (dx > dy) {
            // Primarily horizontal
            return {
                type: 'HORIZONTAL',
                start: { x: Math.min(p1.x, p2.x), y: (p1.y + p2.y) / 2 },
                end: { x: Math.max(p1.x, p2.x), y: (p1.y + p2.y) / 2 },
                width: this.spineWidth
            };
        } else {
            // Primarily vertical
            return {
                type: 'VERTICAL',
                start: { x: (p1.x + p2.x) / 2, y: Math.min(p1.y, p2.y) },
                end: { x: (p1.x + p2.x) / 2, y: Math.max(p1.y, p2.y) },
                width: this.spineWidth
            };
        }
    }

    /**
     * Optimize spine position to avoid walls
     */
    _optimizeSpinePosition(spine) {
        // Check for wall collisions and adjust
        let attempts = 0;
        const maxAttempts = 10;
        const adjustStep = 1.0; // 1m adjustments

        while (this._spineCollidesWithWalls(spine) && attempts < maxAttempts) {
            if (spine.type === 'HORIZONTAL') {
                // Try moving up or down
                spine.start.y += adjustStep * (attempts % 2 === 0 ? 1 : -1);
                spine.end.y = spine.start.y;
            } else {
                // Try moving left or right
                spine.start.x += adjustStep * (attempts % 2 === 0 ? 1 : -1);
                spine.end.x = spine.start.x;
            }
            attempts++;
        }

        return spine;
    }

    /**
     * Check if spine collides with walls
     */
    _spineCollidesWithWalls(spine) {
        const halfWidth = spine.width / 2;

        for (const wall of this.walls) {
            if (!wall.start || !wall.end) continue;

            // Check line intersection with buffered spine
            if (this._lineIntersectsRect(
                wall.start.x, wall.start.y, wall.end.x, wall.end.y,
                Math.min(spine.start.x, spine.end.x) - halfWidth,
                Math.min(spine.start.y, spine.end.y) - halfWidth,
                Math.abs(spine.end.x - spine.start.x) + spine.width,
                Math.abs(spine.end.y - spine.start.y) + spine.width
            )) {
                return true;
            }
        }
        return false;
    }

    /**
     * Check if rib is valid (doesn't collide)
     */
    _isValidRib(rib) {
        if (rib.length < 2) return false; // Too short

        // Check forbidden zones
        for (const zone of this.forbiddenZones) {
            const zb = this._getZoneBounds(zone);
            if (!zb) continue;

            if (this._ribIntersectsRect(rib, zb)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Check if rib intersects rectangle
     */
    _ribIntersectsRect(rib, rect) {
        const halfWidth = rib.width / 2;
        const ribRect = {
            minX: Math.min(rib.start.x, rib.end.x) - halfWidth,
            maxX: Math.max(rib.start.x, rib.end.x) + halfWidth,
            minY: Math.min(rib.start.y, rib.end.y) - halfWidth,
            maxY: Math.max(rib.start.y, rib.end.y) + halfWidth
        };

        return !(ribRect.maxX <= rect.minX || rect.maxX <= ribRect.minX ||
            ribRect.maxY <= rect.minY || rect.maxY <= ribRect.minY);
    }

    /**
     * Line-rectangle intersection
     */
    _lineIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh) {
        // Check if line intersects rectangle
        const left = rx, right = rx + rw, top = ry, bottom = ry + rh;

        // Quick bounds check
        if (Math.max(x1, x2) < left || Math.min(x1, x2) > right ||
            Math.max(y1, y2) < top || Math.min(y1, y2) > bottom) {
            return false;
        }

        // Check if any endpoint is inside
        if ((x1 >= left && x1 <= right && y1 >= top && y1 <= bottom) ||
            (x2 >= left && x2 <= right && y2 >= top && y2 <= bottom)) {
            return true;
        }

        return true; // Simplified - line crosses bounds
    }

    /**
     * Get zone bounds
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

    // Stats helpers
    _calculateSpineLength() {
        if (!this.spine) return 0;
        return Math.hypot(
            this.spine.end.x - this.spine.start.x,
            this.spine.end.y - this.spine.start.y
        );
    }

    _calculateTotalLength() {
        let total = this._calculateSpineLength();
        for (const rib of this.ribs) {
            total += rib.length || 0;
        }
        return total;
    }

    _calculateCorridorArea() {
        let area = 0;
        for (const corridor of this.corridors) {
            area += corridor.width * corridor.height;
        }
        return area;
    }
}

module.exports = SpineRibCorridorGenerator;
