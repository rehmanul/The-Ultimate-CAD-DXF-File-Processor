/**
 * Unit tests for isolated îlot detection in AdvancedCorridorNetworkGenerator
 * Tests the detectIsolatedÎlots method and _isÎlotAdjacentToCorridor helper
 */

const AdvancedCorridorNetworkGenerator = require('../../lib/advancedCorridorNetworkGenerator');

describe('Isolated Îlot Detection', () => {
    describe('detectIsolatedÎlots', () => {
        test('should identify îlots with no adjacent corridors as isolated', () => {
            const floorPlan = {
                bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }
            };

            const îlots = [
                { id: 1, x: 10, y: 10, width: 5, height: 5 },  // Isolated
                { id: 2, x: 30, y: 10, width: 5, height: 5 },  // Connected
                { id: 3, x: 50, y: 10, width: 5, height: 5 }   // Isolated
            ];

            const corridors = [
                { id: 'c1', x: 28.5, y: 8, width: 1.2, height: 10 }  // Adjacent to îlot 2 (right edge = 29.7, gap = 0.3)
            ];

            const generator = new AdvancedCorridorNetworkGenerator(floorPlan, îlots);
            const result = generator.detectIsolatedÎlots(corridors);

            expect(result.isolatedÎlots).toHaveLength(2);
            expect(result.connectedÎlots).toHaveLength(1);
            expect(result.totalÎlots).toBe(3);
            expect(result.isolationRate).toBeCloseTo(2/3);
            expect(result.connectedÎlots[0].id).toBe(2);
        });

        test('should identify all îlots as connected when all have adjacent corridors', () => {
            const floorPlan = {
                bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }
            };

            const îlots = [
                { id: 1, x: 10, y: 10, width: 5, height: 5 },
                { id: 2, x: 30, y: 10, width: 5, height: 5 }
            ];

            const corridors = [
                { id: 'c1', x: 8.5, y: 8, width: 1.2, height: 10 },   // Adjacent to îlot 1 (right edge = 9.7, gap = 0.3)
                { id: 'c2', x: 28.5, y: 8, width: 1.2, height: 10 }   // Adjacent to îlot 2 (right edge = 29.7, gap = 0.3)
            ];

            const generator = new AdvancedCorridorNetworkGenerator(floorPlan, îlots);
            const result = generator.detectIsolatedÎlots(corridors);

            expect(result.isolatedÎlots).toHaveLength(0);
            expect(result.connectedÎlots).toHaveLength(2);
            expect(result.isolationRate).toBe(0);
        });

        test('should identify all îlots as isolated when no corridors exist', () => {
            const floorPlan = {
                bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }
            };

            const îlots = [
                { id: 1, x: 10, y: 10, width: 5, height: 5 },
                { id: 2, x: 30, y: 10, width: 5, height: 5 }
            ];

            const corridors = [];

            const generator = new AdvancedCorridorNetworkGenerator(floorPlan, îlots);
            const result = generator.detectIsolatedÎlots(corridors);

            expect(result.isolatedÎlots).toHaveLength(2);
            expect(result.connectedÎlots).toHaveLength(0);
            expect(result.isolationRate).toBe(1);
        });

        test('should detect îlot overlapping with corridor as connected', () => {
            const floorPlan = {
                bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }
            };

            const îlots = [
                { id: 1, x: 10, y: 10, width: 5, height: 5 }
            ];

            const corridors = [
                { id: 'c1', x: 12, y: 12, width: 1.2, height: 3 }  // Overlaps with îlot
            ];

            const generator = new AdvancedCorridorNetworkGenerator(floorPlan, îlots);
            const result = generator.detectIsolatedÎlots(corridors);

            expect(result.isolatedÎlots).toHaveLength(0);
            expect(result.connectedÎlots).toHaveLength(1);
        });
    });

    describe('_isÎlotAdjacentToCorridor', () => {
        let generator;

        beforeEach(() => {
            const floorPlan = {
                bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }
            };
            generator = new AdvancedCorridorNetworkGenerator(floorPlan, []);
        });

        test('should detect horizontal adjacency (îlot to left of corridor)', () => {
            const îlot = { x: 10, y: 10, width: 5, height: 5 };
            const corridor = { x: 15.5, y: 10, width: 1.2, height: 5 };
            const threshold = 0.7;

            const result = generator._isÎlotAdjacentToCorridor(îlot, corridor, threshold);
            expect(result).toBe(true);
        });

        test('should detect horizontal adjacency (îlot to right of corridor)', () => {
            const îlot = { x: 20, y: 10, width: 5, height: 5 };
            const corridor = { x: 18, y: 10, width: 1.5, height: 5 };  // corridor right = 19.5, gap = 0.5
            const threshold = 0.7;

            const result = generator._isÎlotAdjacentToCorridor(îlot, corridor, threshold);
            expect(result).toBe(true);
        });

        test('should detect vertical adjacency (îlot above corridor)', () => {
            const îlot = { x: 10, y: 10, width: 5, height: 5 };
            const corridor = { x: 10, y: 15.5, width: 5, height: 1.2 };
            const threshold = 0.7;

            const result = generator._isÎlotAdjacentToCorridor(îlot, corridor, threshold);
            expect(result).toBe(true);
        });

        test('should detect vertical adjacency (îlot below corridor)', () => {
            const îlot = { x: 10, y: 20, width: 5, height: 5 };
            const corridor = { x: 10, y: 18, width: 5, height: 1.5 };  // corridor bottom = 19.5, gap = 0.5
            const threshold = 0.7;

            const result = generator._isÎlotAdjacentToCorridor(îlot, corridor, threshold);
            expect(result).toBe(true);
        });

        test('should detect overlap between îlot and corridor', () => {
            const îlot = { x: 10, y: 10, width: 5, height: 5 };
            const corridor = { x: 12, y: 12, width: 1.2, height: 2 };
            const threshold = 0.7;

            const result = generator._isÎlotAdjacentToCorridor(îlot, corridor, threshold);
            expect(result).toBe(true);
        });

        test('should return false when îlot is too far from corridor', () => {
            const îlot = { x: 10, y: 10, width: 5, height: 5 };
            const corridor = { x: 20, y: 10, width: 1.2, height: 5 };
            const threshold = 0.7;

            const result = generator._isÎlotAdjacentToCorridor(îlot, corridor, threshold);
            expect(result).toBe(false);
        });

        test('should return false when îlot and corridor are not aligned', () => {
            const îlot = { x: 10, y: 10, width: 5, height: 5 };
            const corridor = { x: 20, y: 20, width: 1.2, height: 5 };
            const threshold = 0.7;

            const result = generator._isÎlotAdjacentToCorridor(îlot, corridor, threshold);
            expect(result).toBe(false);
        });
    });
});
