const WallGapCompleter = require('../../../lib/WallGapCompleter');

describe('WallGapCompleter', () => {
    describe('constructor', () => {
        test('should initialize with default options', () => {
            const c = new WallGapCompleter();
            expect(c.gapThreshold).toBe(2.0);
            expect(c.minWallLength).toBe(0.5);
        });

        test('should accept custom options', () => {
            const c = new WallGapCompleter({ gapThreshold: 3.0, minWallLength: 0.3, debug: true });
            expect(c.gapThreshold).toBe(3.0);
            expect(c.minWallLength).toBe(0.3);
            expect(c.debugMode).toBe(true);
        });
    });

    describe('completeWalls', () => {
        test('should return original walls when no gaps exist', () => {
            const c = new WallGapCompleter();
            const walls = [
                { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
                { start: { x: 10, y: 0 }, end: { x: 10, y: 8 } },
                { start: { x: 10, y: 8 }, end: { x: 0, y: 8 } },
                { start: { x: 0, y: 8 }, end: { x: 0, y: 0 } }
            ];
            const result = c.completeWalls(walls, []);
            expect(result.completedWalls.length).toBe(walls.length);
            expect(result.syntheticSegments.length).toBe(0);
            expect(result.gapCount).toBe(0);
        });

        test('should fill a single gap between two walls', () => {
            const c = new WallGapCompleter({ gapThreshold: 2.0 });
            const walls = [
                { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
                { start: { x: 6, y: 0 }, end: { x: 10, y: 0 } }
            ];
            const result = c.completeWalls(walls, []);
            expect(result.gapCount).toBe(1);
            expect(result.syntheticSegments.length).toBe(1);
            expect(result.completedWalls.length).toBe(3);

            const syn = result.syntheticSegments[0];
            expect(syn.synthetic).toBe(true);
            expect(syn.gapFiller).toBe(true);
            expect(syn.layer).toBe('SYNTHETIC_WALL');
            expect(syn.type).toBe('LINE');
        });

        test('should fill multiple gaps', () => {
            const c = new WallGapCompleter({ gapThreshold: 2.0 });
            const walls = [
                { start: { x: 0, y: 0 }, end: { x: 3, y: 0 } },
                { start: { x: 4, y: 0 }, end: { x: 7, y: 0 } },
                { start: { x: 8, y: 0 }, end: { x: 10, y: 0 } }
            ];
            const result = c.completeWalls(walls, []);
            expect(result.gapCount).toBe(2);
            expect(result.syntheticSegments.length).toBe(2);
            expect(result.completedWalls.length).toBe(5);
        });

        test('should not fill gaps below minWallLength', () => {
            const c = new WallGapCompleter({ gapThreshold: 2.0, minWallLength: 1.5 });
            const walls = [
                { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
                { start: { x: 6, y: 0 }, end: { x: 10, y: 0 } }
            ];
            const result = c.completeWalls(walls, []);
            // Gap is 1.0m, below minWallLength 1.5m → detected but not filled
            expect(result.gapCount).toBe(1);
            expect(result.syntheticSegments.length).toBe(0);
        });

        test('should not fill gaps above threshold', () => {
            const c = new WallGapCompleter({ gapThreshold: 1.0 });
            const walls = [
                { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
                { start: { x: 8, y: 0 }, end: { x: 15, y: 0 } }
            ];
            const result = c.completeWalls(walls, []);
            // Gap is 3.0m > threshold 1.0 → not even detected as a gap
            expect(result.gapCount).toBe(0);
            expect(result.syntheticSegments.length).toBe(0);
        });

        test('should handle walls without start/end gracefully', () => {
            const c = new WallGapCompleter();
            const walls = [
                { polygon: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
                { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
            ];
            const result = c.completeWalls(walls, []);
            // Only 1 wall has start/end → 2 endpoints, no pair from different wall
            expect(result.completedWalls.length).toBeGreaterThanOrEqual(walls.length);
        });

        test('should handle empty walls array', () => {
            const c = new WallGapCompleter();
            const result = c.completeWalls([], []);
            expect(result.completedWalls.length).toBe(0);
            expect(result.syntheticSegments.length).toBe(0);
            expect(result.gapCount).toBe(0);
        });

        test('synthetic segments have correct IDs', () => {
            const c = new WallGapCompleter({ gapThreshold: 2.0 });
            const walls = [
                { start: { x: 0, y: 0 }, end: { x: 3, y: 0 } },
                { start: { x: 4, y: 0 }, end: { x: 7, y: 0 } },
                { start: { x: 8, y: 0 }, end: { x: 10, y: 0 } }
            ];
            const result = c.completeWalls(walls, []);
            expect(result.syntheticSegments[0].id).toBe('synthetic_wall_1');
            expect(result.syntheticSegments[1].id).toBe('synthetic_wall_2');
        });
    });

    describe('completeZoneBoundaries', () => {
        test('should skip zones without incomplete walls', () => {
            const c = new WallGapCompleter();
            const zones = [
                { id: 'z1', hasIncompleteWalls: false, bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } }
            ];
            const walls = [{ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }];
            const result = c.completeZoneBoundaries(zones, walls);
            expect(result.length).toBe(1);
            expect(result[0]).toEqual(zones[0]);
        });

        test('should complete zones with incomplete walls', () => {
            const c = new WallGapCompleter({ gapThreshold: 2.0 });
            const zones = [
                { id: 'z1', hasIncompleteWalls: true, bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } }
            ];
            const walls = [
                { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
                { start: { x: 6, y: 0 }, end: { x: 10, y: 0 } }
            ];
            const result = c.completeZoneBoundaries(zones, walls);
            expect(result.length).toBe(1);
            expect(result[0].completedBoundary).toBe(true);
            expect(result[0].syntheticWalls.length).toBeGreaterThan(0);
        });

        test('should only use walls within zone bounds', () => {
            const c = new WallGapCompleter({ gapThreshold: 2.0 });
            const zones = [
                { id: 'z1', hasIncompleteWalls: true, bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } }
            ];
            const walls = [
                { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },       // In bounds
                { start: { x: 6, y: 0 }, end: { x: 10, y: 0 } },       // In bounds
                { start: { x: 50, y: 50 }, end: { x: 60, y: 50 } }     // Out of bounds
            ];
            const result = c.completeZoneBoundaries(zones, walls);
            expect(result[0].completedBoundary).toBe(true);
        });
    });

    describe('isPolygonClosed', () => {
        test('should return true for a closed polygon', () => {
            const polygon = [
                { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 0 }
            ];
            expect(WallGapCompleter.isPolygonClosed(polygon)).toBe(true);
        });

        test('should return false for an open polygon', () => {
            const polygon = [
                { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 5 }
            ];
            expect(WallGapCompleter.isPolygonClosed(polygon)).toBe(false);
        });

        test('should return false for less than 3 points', () => {
            expect(WallGapCompleter.isPolygonClosed([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
        });

        test('should return false for null polygon', () => {
            expect(WallGapCompleter.isPolygonClosed(null)).toBe(false);
        });

        test('should use custom tolerance', () => {
            const polygon = [
                { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 0.5 }
            ];
            expect(WallGapCompleter.isPolygonClosed(polygon, 0.1)).toBe(false);
            expect(WallGapCompleter.isPolygonClosed(polygon, 1.0)).toBe(true);
        });
    });
});
