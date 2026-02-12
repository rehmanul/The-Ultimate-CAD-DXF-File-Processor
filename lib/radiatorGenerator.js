/**
 * RadiatorGenerator
 * Generates radiator POSITION data along perimeter walls
 * Matches COSTO V1 reference: small discrete angled symbols with "100×300" labels
 * NO ZIGZAG PATHS — only position + wall + label data
 */
class RadiatorGenerator {
    constructor(floorPlan, options = {}) {
        this.floorPlan = floorPlan;
        this.symbolSpacing = options.symbolSpacing || 3.0;  // 3m between symbols
        this.wallOffset = options.wallOffset || 0.3;        // 30cm offset from wall
        this.label = options.label || '100×300';             // Default radiator label
    }

    /**
     * Generate radiator position data along perimeter walls
     * @returns {Array} Array of radiator objects with wall + positions (NO zigzag paths)
     */
    generateRadiators() {
        const radiators = [];

        if (!this.floorPlan || !this.floorPlan.walls) {
            console.warn('[Radiator Gen] No walls found in floor plan');
            return radiators;
        }

        // Identify perimeter walls (walls on the outer boundary)
        const perimeterWalls = this.identifyPerimeterWalls();

        perimeterWalls.forEach((wall, index) => {
            const wallLength = Math.hypot(
                wall.end.x - wall.start.x,
                wall.end.y - wall.start.y
            );

            // Skip short walls (< 2m)
            if (wallLength < 2) return;

            // Calculate number of symbols along this wall
            const numSymbols = Math.max(1, Math.floor(wallLength / this.symbolSpacing));
            const positions = [];

            for (let i = 0; i < numSymbols; i++) {
                const t = (i + 0.5) / numSymbols;
                positions.push({
                    x: wall.start.x + (wall.end.x - wall.start.x) * t,
                    y: wall.start.y + (wall.end.y - wall.start.y) * t
                });
            }

            // Store as position data (NOT zigzag path)
            // Also store start/end as a simple 2-point "path" for backwards compatibility
            radiators.push({
                id: `radiator_${index}`,
                type: 'radiator',
                wall: wall,
                label: this.label,
                positions: positions,
                wallAngle: Math.atan2(
                    wall.end.y - wall.start.y,
                    wall.end.x - wall.start.x
                ),
                // Backwards-compatible "path" — just start and end (NO zigzag points)
                path: [
                    { x: wall.start.x, y: wall.start.y },
                    { x: wall.end.x, y: wall.end.y }
                ],
                length: wallLength
            });
        });

        console.log(`[Radiator Gen] Generated ${radiators.length} radiator runs with symbol positions`);
        return radiators;
    }

    /**
     * Identify perimeter walls (outer boundary walls)
     * @returns {Array} Array of perimeter wall objects
     */
    identifyPerimeterWalls() {
        const walls = this.floorPlan.walls || [];
        const bounds = this.floorPlan.bounds || this.calculateBounds(walls);

        const tolerance = 0.5; // 50cm tolerance for perimeter detection
        const perimeterWalls = [];

        walls.forEach(wall => {
            if (!wall.start || !wall.end) return;

            const isOnPerimeter =
                // Top wall
                (Math.abs(wall.start.y - bounds.maxY) < tolerance &&
                    Math.abs(wall.end.y - bounds.maxY) < tolerance) ||
                // Bottom wall
                (Math.abs(wall.start.y - bounds.minY) < tolerance &&
                    Math.abs(wall.end.y - bounds.minY) < tolerance) ||
                // Left wall
                (Math.abs(wall.start.x - bounds.minX) < tolerance &&
                    Math.abs(wall.end.x - bounds.minX) < tolerance) ||
                // Right wall
                (Math.abs(wall.start.x - bounds.maxX) < tolerance &&
                    Math.abs(wall.end.x - bounds.maxX) < tolerance);

            if (isOnPerimeter) {
                perimeterWalls.push(wall);
            }
        });

        return perimeterWalls;
    }

    /**
     * Calculate bounds from walls
     */
    calculateBounds(walls) {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        walls.forEach(wall => {
            if (wall.start) {
                minX = Math.min(minX, wall.start.x);
                minY = Math.min(minY, wall.start.y);
                maxX = Math.max(maxX, wall.start.x);
                maxY = Math.max(maxY, wall.start.y);
            }
            if (wall.end) {
                minX = Math.min(minX, wall.end.x);
                minY = Math.min(minY, wall.end.y);
                maxX = Math.max(maxX, wall.end.x);
                maxY = Math.max(maxY, wall.end.y);
            }
        });

        return { minX, minY, maxX, maxY };
    }
}

module.exports = RadiatorGenerator;
