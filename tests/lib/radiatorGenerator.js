/**
 * RadiatorGenerator
 * Generates radiator WAVY PATH data along perimeter walls
 * Matches COSTO V1 reference: continuous RED WAVY LINES around perimeter
 * Generates actual zigzag/wavy path points for rendering
 */
class RadiatorGenerator {
    constructor(floorPlan, options = {}) {
        this.floorPlan = floorPlan;
        this.waveAmplitude = options.waveAmplitude || 0.03;  // Wave amplitude in meters (3cm — tight like reference)
        this.waveFrequency = options.waveFrequency || 5.0;   // Waves per meter (dense, continuous look)
        this.wallOffset = options.wallOffset || 0.2;         // 20cm offset from wall
        this.label = options.label || '100×300';             // Default radiator label
        this.style = options.style || 'wavy';                // 'wavy' or 'zigzag'
    }

    /**
     * Generate radiator wavy path data along perimeter walls
     * @returns {Array} Array of radiator objects with wavy paths for rendering
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

            // Skip short walls (< 1m)
            if (wallLength < 1) return;

            // Generate wavy path along this wall
            const wavyPath = this.generateWavyPath(wall, wallLength);

            // Also generate discrete positions for symbol rendering (backwards compatibility)
            const symbolSpacing = 3.0;
            const numSymbols = Math.max(1, Math.floor(wallLength / symbolSpacing));
            const positions = [];

            for (let i = 0; i < numSymbols; i++) {
                const t = (i + 0.5) / numSymbols;
                positions.push({
                    x: wall.start.x + (wall.end.x - wall.start.x) * t,
                    y: wall.start.y + (wall.end.y - wall.start.y) * t
                });
            }

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
                // WAVY PATH for rendering (this is what matches the reference!)
                path: wavyPath,
                length: wallLength,
                style: this.style
            });
        });

        console.log(`[Radiator Gen] Generated ${radiators.length} radiator runs with wavy paths`);
        return radiators;
    }

    /**
     * Generate a wavy/zigzag path along a wall segment
     * @param {Object} wall - Wall with start and end points
     * @param {number} wallLength - Length of the wall
     * @returns {Array} Array of path points forming a wave
     */
    generateWavyPath(wall, wallLength) {
        const path = [];

        // Calculate wall direction vector
        const dx = wall.end.x - wall.start.x;
        const dy = wall.end.y - wall.start.y;

        // Normalize
        const normX = dx / wallLength;
        const normY = dy / wallLength;

        // Perpendicular vector (for wave amplitude)
        const perpX = -normY;
        const perpY = normX;

        // Number of wave segments
        const numWaves = Math.ceil(wallLength * this.waveFrequency);
        const segmentLength = wallLength / (numWaves * 2); // Two points per wave

        if (this.style === 'zigzag') {
            // Generate zigzag pattern (sharp angles)
            for (let i = 0; i <= numWaves * 2; i++) {
                const t = i / (numWaves * 2);
                const baseX = wall.start.x + dx * t;
                const baseY = wall.start.y + dy * t;

                // Alternate between positive and negative amplitude
                const amp = (i % 2 === 0) ? this.waveAmplitude : -this.waveAmplitude;

                path.push({
                    x: baseX + perpX * amp,
                    y: baseY + perpY * amp
                });
            }
        } else {
            // Generate smooth wavy pattern (sine wave approximation)
            const pointsPerWave = 8; // 8 points per wavelength for smooth curve
            const totalPoints = numWaves * pointsPerWave + 1;

            for (let i = 0; i <= totalPoints; i++) {
                const t = i / totalPoints;
                const baseX = wall.start.x + dx * t;
                const baseY = wall.start.y + dy * t;

                // Sine wave for smooth curves
                const phase = t * numWaves * Math.PI * 2;
                const amp = Math.sin(phase) * this.waveAmplitude;

                path.push({
                    x: baseX + perpX * amp,
                    y: baseY + perpY * amp
                });
            }
        }

        return path;
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
