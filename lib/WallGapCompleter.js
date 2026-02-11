/**
 * WallGapCompleter - Detect and complete incomplete wall segments
 * 
 * Analyzes wall geometry to find gaps and generates synthetic
 * segments to close room boundaries.
 */

class WallGapCompleter {
    constructor(options = {}) {
        this.gapThreshold = options.gapThreshold || 2.0;  // Max gap to fill (meters)
        this.minWallLength = options.minWallLength || 0.5;  // Min wall segment length
        this.debugMode = options.debug || false;
    }

    /**
     * Complete wall gaps in the floor plan (runs up to 3 iterations for cascaded gaps)
     * @param {Array} walls - Array of wall segments
     * @param {Array} zones - Detected zones with potential gaps
     * @returns {Object} { completedWalls, syntheticSegments }
     */
    completeWalls(walls, zones) {
        console.log(`[WallGapCompleter] Analyzing ${walls.length} walls for gaps...`);

        let currentWalls = [...walls];
        let totalFilled = 0;
        const allSynthetic = [];
        const MAX_ITERATIONS = 3; // Only 3 passes - more causes explosion
        let prevGapCount = Infinity;

        for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
            const endpoints = this._extractEndpoints(currentWalls);
            const gaps = this._findGaps(endpoints);

            // Stop if no gaps or gaps are increasing (cascade detected)
            if (gaps.length === 0) {
                console.log(`[WallGapCompleter] Iteration ${iteration + 1}: No gaps, done.`);
                break;
            }

            if (gaps.length >= prevGapCount) {
                console.log(`[WallGapCompleter] Iteration ${iteration + 1}: Gap count not decreasing (${gaps.length}), stopping.`);
                break;
            }

            prevGapCount = gaps.length;
            const syntheticSegments = this._generateFillerSegments(gaps);

            // Add synthetic segments with unique IDs
            const iterationSegments = syntheticSegments.map((seg, idx) => ({
                ...seg,
                id: `synthetic_wall_iter${iteration}_${idx + 1}`
            }));

            currentWalls = [...currentWalls, ...iterationSegments];
            allSynthetic.push(...iterationSegments);
            totalFilled += iterationSegments.length;

            console.log(`[WallGapCompleter] Iteration ${iteration + 1}: ${gaps.length} gaps → ${iterationSegments.length} filled`);
        }

        console.log(`[WallGapCompleter] Complete: ${totalFilled} filler segments added`);

        return {
            completedWalls: currentWalls,
            syntheticSegments: allSynthetic,
            gapCount: totalFilled
        };
    }

    /**
     * Extract all wall endpoints
     */
    _extractEndpoints(walls) {
        const endpoints = [];

        for (const wall of walls) {
            if (wall.start && wall.end) {
                endpoints.push({
                    x: wall.start.x,
                    y: wall.start.y,
                    type: 'start',
                    wall
                });
                endpoints.push({
                    x: wall.end.x,
                    y: wall.end.y,
                    type: 'end',
                    wall
                });
            }
        }

        return endpoints;
    }

    /**
     * Find gaps between wall endpoints
     */
    _findGaps(endpoints) {
        const gaps = [];
        const used = new Set();

        for (let i = 0; i < endpoints.length; i++) {
            if (used.has(i)) continue;

            const p1 = endpoints[i];
            let nearestIdx = -1;
            let nearestDist = this.gapThreshold;

            for (let j = 0; j < endpoints.length; j++) {
                if (i === j || used.has(j)) continue;
                if (p1.wall === endpoints[j].wall) continue;  // Same wall

                const p2 = endpoints[j];
                const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);

                if (dist > 0.01 && dist < nearestDist) {  // Not same point, within threshold
                    nearestDist = dist;
                    nearestIdx = j;
                }
            }

            if (nearestIdx !== -1) {
                const p2 = endpoints[nearestIdx];
                gaps.push({
                    start: { x: p1.x, y: p1.y },
                    end: { x: p2.x, y: p2.y },
                    distance: nearestDist
                });
                used.add(i);
                used.add(nearestIdx);
            }
        }

        return gaps;
    }

    /**
     * Generate synthetic wall segments to fill gaps
     */
    _generateFillerSegments(gaps) {
        return gaps
            .filter(gap => gap.distance >= this.minWallLength)
            .map((gap, idx) => ({
                type: 'LINE',
                start: gap.start,
                end: gap.end,
                layer: 'SYNTHETIC_WALL',
                synthetic: true,
                gapFiller: true,
                id: `synthetic_wall_${idx + 1}`
            }));
    }

    /**
     * Complete zone boundaries using wall completion
     */
    completeZoneBoundaries(zones, walls) {
        const completedZones = [];

        for (const zone of zones) {
            if (!zone.hasIncompleteWalls) {
                completedZones.push(zone);
                continue;
            }

            // Find walls that intersect this zone's bounds
            const zoneWalls = this._findWallsInZone(walls, zone.bounds);

            // Complete gaps within zone
            const { completedWalls, syntheticSegments } = this.completeWalls(zoneWalls, [zone]);

            // Update zone with completed boundary
            const completedZone = { ...zone };
            if (syntheticSegments.length > 0) {
                completedZone.completedBoundary = true;
                completedZone.syntheticWalls = syntheticSegments;
            }

            completedZones.push(completedZone);
        }

        return completedZones;
    }

    /**
     * Find walls that intersect a bounding box
     */
    _findWallsInZone(walls, bounds) {
        return walls.filter(wall => {
            if (!wall.start || !wall.end) return false;

            const inBounds = (x, y) =>
                x >= bounds.minX && x <= bounds.maxX &&
                y >= bounds.minY && y <= bounds.maxY;

            return inBounds(wall.start.x, wall.start.y) ||
                inBounds(wall.end.x, wall.end.y);
        });
    }

    /**
     * Validate that a zone polygon is properly closed
     */
    static isPolygonClosed(polygon, tolerance = 0.1) {
        if (!polygon || polygon.length < 3) return false;

        const first = polygon[0];
        const last = polygon[polygon.length - 1];

        return Math.hypot(first.x - last.x, first.y - last.y) < tolerance;
    }
}

module.exports = WallGapCompleter;
