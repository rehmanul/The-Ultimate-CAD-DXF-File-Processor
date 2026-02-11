/**
 * RadiatorGenerator
 * Generates RED ZIGZAG polylines along perimeter walls
 * Matches COSTO V1 reference output exactly
 */
class RadiatorGenerator {
    constructor(floorPlan, options = {}) {
        this.floorPlan = floorPlan;
        this.zigzagAmplitude = options.zigzagAmplitude || 0.15; // 15cm amplitude
        this.zigzagFrequency = options.zigzagFrequency || 0.5;  // Zigzag every 50cm
        this.wallOffset = options.wallOffset || 0.3; // 30cm from wall
    }

    /**
     * Generate radiator paths along perimeter walls
     * @returns {Array} Array of radiator objects with zigzag paths
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
            const radiatorPath = this.generateZigzagPath(wall);
            
            if (radiatorPath && radiatorPath.length >= 2) {
                radiators.push({
                    id: `radiator_${index}`,
                    type: 'radiator',
                    wall: wall,
                    path: radiatorPath,
                    length: this.calculatePathLength(radiatorPath)
                });
            }
        });

        console.log(`[Radiator Gen] Generated ${radiators.length} radiator paths`);
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
     * Generate zigzag path along a wall
     * @param {Object} wall - Wall object with start and end points
     * @returns {Array} Array of points forming zigzag path
     */
    generateZigzagPath(wall) {
        if (!wall || !wall.start || !wall.end) return [];

        const start = wall.start;
        const end = wall.end;
        
        // Calculate wall direction and length
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const wallLength = Math.hypot(dx, dy);
        
        if (wallLength < 0.1) return []; // Skip very short walls

        // Normalize direction
        const dirX = dx / wallLength;
        const dirY = dy / wallLength;
        
        // Perpendicular direction (for offset from wall)
        const perpX = -dirY;
        const perpY = dirX;

        // Generate zigzag points
        const path = [];
        const segmentCount = Math.ceil(wallLength / this.zigzagFrequency);
        
        for (let i = 0; i <= segmentCount; i++) {
            const t = i / segmentCount;
            const baseX = start.x + dx * t;
            const baseY = start.y + dy * t;
            
            // Alternate zigzag amplitude
            const amplitude = (i % 2 === 0) ? this.zigzagAmplitude : -this.zigzagAmplitude;
            
            // Offset from wall + zigzag
            const x = baseX + perpX * this.wallOffset + perpX * amplitude;
            const y = baseY + perpY * this.wallOffset + perpY * amplitude;
            
            path.push([x, y]);
        }

        return path;
    }

    /**
     * Calculate bounds from walls
     * @param {Array} walls - Array of wall objects
     * @returns {Object} Bounds object {minX, minY, maxX, maxY}
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

    /**
     * Calculate total length of a path
     * @param {Array} path - Array of points
     * @returns {number} Total path length
     */
    calculatePathLength(path) {
        let length = 0;
        for (let i = 0; i < path.length - 1; i++) {
            const p1 = path[i];
            const p2 = path[i + 1];
            const dx = p2[0] - p1[0];
            const dy = p2[1] - p1[1];
            length += Math.hypot(dx, dy);
        }
        return length;
    }
}

module.exports = RadiatorGenerator;
