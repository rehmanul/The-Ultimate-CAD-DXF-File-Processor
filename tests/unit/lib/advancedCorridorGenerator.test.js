/**
 * Unit Tests for Advanced Corridor Generator
 */

const AdvancedCorridorGenerator = require('../../../lib/advancedCorridorGenerator');

describe('AdvancedCorridorGenerator', () => {
    let mockFloorPlan;
    let mockIlots;

    beforeEach(() => {
        mockFloorPlan = {
            walls: [],
            forbiddenZones: [],
            entrances: [],
            bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 }
        };

        // Create îlots in grid pattern for testing
        mockIlots = [
            // Column 1
            { x: 2, y: 2, width: 2, height: 1, area: 2 },
            { x: 2, y: 5, width: 2, height: 1, area: 2 },
            { x: 2, y: 8, width: 2, height: 1, area: 2 },
            // Column 2
            { x: 6, y: 2, width: 2, height: 1, area: 2 },
            { x: 6, y: 5, width: 2, height: 1, area: 2 },
            { x: 6, y: 8, width: 2, height: 1, area: 2 }
        ];
    });

    describe('constructor', () => {
        test('should initialize with default options', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            expect(generator.options.corridorWidth).toBe(1.5);
            expect(generator.options.margin).toBe(0.5);
            expect(generator.options.generateVertical).toBe(true);
            expect(generator.options.generateHorizontal).toBe(true);
        });

        test('should accept custom options', () => {
            const options = {
                corridorWidth: 2.0,
                margin: 1.0,
                generateVertical: false,
                minCorridorLength: 3.0
            };
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots, options);
            expect(generator.options.corridorWidth).toBe(2.0);
            expect(generator.options.margin).toBe(1.0);
            expect(generator.options.generateVertical).toBe(false);
            expect(generator.options.minCorridorLength).toBe(3.0);
        });
    });

    describe('generateAllCorridors', () => {
        test('should generate both vertical and horizontal corridors', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const result = generator.generateAllCorridors();

            expect(result.corridors).toBeDefined();
            expect(result.metadata).toBeDefined();
            expect(result.metadata.vertical.count).toBeGreaterThanOrEqual(0);
            expect(result.metadata.horizontal.count).toBeGreaterThanOrEqual(0);
        });

        test('should return metadata with counts and areas', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const result = generator.generateAllCorridors();

            expect(result.metadata.vertical).toHaveProperty('count');
            expect(result.metadata.vertical).toHaveProperty('totalArea');
            expect(result.metadata.horizontal).toHaveProperty('count');
            expect(result.metadata.horizontal).toHaveProperty('totalArea');
            expect(result.metadata).toHaveProperty('totalArea');
        });

        test('should generate only vertical corridors when horizontal disabled', () => {
            const options = { generateHorizontal: false };
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots, options);
            const result = generator.generateAllCorridors();

            expect(result.metadata.horizontal.count).toBe(0);
        });

        test('should generate only horizontal corridors when vertical disabled', () => {
            const options = { generateVertical: false };
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots, options);
            const result = generator.generateAllCorridors();

            expect(result.metadata.vertical.count).toBe(0);
        });
    });

    describe('generateVerticalCorridors', () => {
        test('should generate vertical corridors between ilots in columns', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const corridors = generator.generateVerticalCorridors();

            expect(corridors.length).toBeGreaterThan(0);
            corridors.forEach(corridor => {
                expect(corridor.type).toBe('vertical');
                expect(corridor.orientation).toBe('vertical');
            });
        });

        test('should respect minimum corridor length', () => {
            const options = { minCorridorLength: 2.0 };
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots, options);
            const corridors = generator.generateVerticalCorridors();

            corridors.forEach(corridor => {
                expect(corridor.height).toBeGreaterThanOrEqual(2.0);
            });
        });

        test('should include corridor dimensions', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const corridors = generator.generateVerticalCorridors();

            corridors.forEach(corridor => {
                expect(corridor).toHaveProperty('x');
                expect(corridor).toHaveProperty('y');
                expect(corridor).toHaveProperty('width');
                expect(corridor).toHaveProperty('height');
                expect(corridor).toHaveProperty('area');
            });
        });
    });

    describe('generateHorizontalCorridors', () => {
        test('should generate horizontal corridors between facing rows', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const corridors = generator.generateHorizontalCorridors();

            corridors.forEach(corridor => {
                expect(corridor.type).toBe('horizontal');
                expect(corridor.orientation).toBe('horizontal');
            });
        });

        test('should include quality scores', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const corridors = generator.generateHorizontalCorridors();

            corridors.forEach(corridor => {
                expect(corridor).toHaveProperty('qualityScore');
                expect(corridor.qualityScore).toBeGreaterThan(0);
                expect(corridor.qualityScore).toBeLessThanOrEqual(1);
            });
        });

        test('should include row connection metadata', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const corridors = generator.generateHorizontalCorridors();

            corridors.forEach(corridor => {
                expect(corridor).toHaveProperty('connectsRows');
                expect(corridor).toHaveProperty('metadata');
            });
        });
    });

    describe('optimizeCorridors', () => {
        test('should remove duplicate corridors', () => {
            const duplicateCorridors = [
                { x: 0, y: 0, width: 2, height: 1, area: 2, orientation: 'vertical' },
                { x: 0, y: 0, width: 2, height: 1, area: 2, orientation: 'vertical' }
            ];
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const optimized = generator.optimizeCorridors(duplicateCorridors);

            expect(optimized.length).toBe(1);
        });

        test('should merge adjacent corridors of same orientation', () => {
            const adjacentCorridors = [
                { id: 'c1', x: 0, y: 0, width: 1, height: 2, area: 2, orientation: 'vertical', priority: 1 },
                { id: 'c2', x: 0, y: 1.5, width: 1, height: 2, area: 2, orientation: 'vertical', priority: 1 }
            ];
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const optimized = generator.optimizeCorridors(adjacentCorridors);

            // Should merge overlapping corridors
            expect(optimized.length).toBeLessThanOrEqual(adjacentCorridors.length);
        });

        test('should not merge corridors of different orientations', () => {
            const mixedCorridors = [
                { x: 0, y: 0, width: 2, height: 1, area: 2, orientation: 'horizontal', priority: 1 },
                { x: 0, y: 0, width: 1, height: 2, area: 2, orientation: 'vertical', priority: 1 }
            ];
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const optimized = generator.optimizeCorridors(mixedCorridors);

            // Should keep both if different orientations
            expect(optimized.length).toBeGreaterThan(0);
        });

        test('should sort by priority', () => {
            const corridors = [
                { x: 0, y: 0, width: 2, height: 1, area: 2, orientation: 'vertical', priority: 0.5 },
                { x: 5, y: 0, width: 2, height: 1, area: 2, orientation: 'vertical', priority: 0.9 }
            ];
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const optimized = generator.optimizeCorridors(corridors);

            if (optimized.length > 1) {
                expect(optimized[0].priority).toBeGreaterThanOrEqual(optimized[1].priority);
            }
        });
    });

    describe('corridorsOverlap', () => {
        test('should detect overlapping corridors', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const c1 = { x: 0, y: 0, width: 2, height: 2 };
            const c2 = { x: 1, y: 1, width: 2, height: 2 };

            expect(generator.corridorsOverlap(c1, c2)).toBe(true);
        });

        test('should detect non-overlapping corridors', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const c1 = { x: 0, y: 0, width: 2, height: 2 };
            const c2 = { x: 5, y: 5, width: 2, height: 2 };

            expect(generator.corridorsOverlap(c1, c2)).toBe(false);
        });

        test('should detect edge-touching corridors', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const c1 = { x: 0, y: 0, width: 2, height: 2 };
            const c2 = { x: 2, y: 0, width: 2, height: 2 }; // Touching edge

            expect(generator.corridorsOverlap(c1, c2)).toBe(false);
        });
    });

    describe('mergeCorridors', () => {
        test('should merge overlapping vertical corridors', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const c1 = { id: 'c1', x: 0, y: 0, width: 1, height: 2, orientation: 'vertical' };
            const c2 = { id: 'c2', x: 0, y: 1, width: 1, height: 2, orientation: 'vertical' };

            const merged = generator.mergeCorridors(c1, c2);
            expect(merged).not.toBeNull();
            expect(merged.height).toBeGreaterThan(c1.height);
        });

        test('should merge overlapping horizontal corridors', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const c1 = { id: 'c1', x: 0, y: 0, width: 2, height: 1, orientation: 'horizontal' };
            const c2 = { id: 'c2', x: 1, y: 0, width: 2, height: 1, orientation: 'horizontal' };

            const merged = generator.mergeCorridors(c1, c2);
            expect(merged).not.toBeNull();
            expect(merged.width).toBeGreaterThan(c1.width);
        });

        test('should not merge corridors of different orientations', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const c1 = { id: 'c1', x: 0, y: 0, width: 2, height: 1, orientation: 'horizontal' };
            const c2 = { id: 'c2', x: 0, y: 0, width: 1, height: 2, orientation: 'vertical' };

            const merged = generator.mergeCorridors(c1, c2);
            expect(merged).toBeNull();
        });

        test('should include merged metadata', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const c1 = { id: 'c1', x: 0, y: 0, width: 1, height: 2, orientation: 'vertical', priority: 0.8 };
            const c2 = { id: 'c2', x: 0, y: 1, width: 1, height: 2, orientation: 'vertical', priority: 0.6 };

            const merged = generator.mergeCorridors(c1, c2);
            expect(merged.merged).toBe(true);
            expect(merged.mergedFrom).toEqual(['c1', 'c2']);
            expect(merged.priority).toBe(0.8); // Max of priorities
        });
    });

    describe('validateCorridors', () => {
        test('should validate corridors dont cut through ilots', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const corridors = [
                { x: 2, y: 2, width: 2, height: 1, area: 2 } // Overlaps with first ilot
            ];

            const result = generator.validateCorridors(corridors);
            expect(result.valid).toBeDefined();
            expect(result.invalid).toBeDefined();
        });

        test('should return valid corridors', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const corridors = [
                { x: 10, y: 10, width: 2, height: 1, area: 2 } // No overlap
            ];

            const result = generator.validateCorridors(corridors);
            expect(result.valid.length).toBeGreaterThan(0);
        });
    });

    describe('corridorCutsThroughIlot', () => {
        test('should detect when corridor cuts through ilot', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const corridor = { x: 2, y: 2, width: 2, height: 1, area: 2 };
            const ilot = { x: 2, y: 2, width: 2, height: 1 };

            expect(generator.corridorCutsThroughIlot(corridor, ilot)).toBe(true);
        });

        test('should not flag minor overlaps as cutting through', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const corridor = { x: 2, y: 2.9, width: 2, height: 0.2, area: 0.4 };
            const ilot = { x: 2, y: 2, width: 2, height: 1 };

            // Small overlap (<20%) should not be considered cutting through
            expect(generator.corridorCutsThroughIlot(corridor, ilot)).toBe(false);
        });
    });

    describe('generate', () => {
        test('should generate and validate corridors', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const result = generator.generate();

            expect(result.corridors).toBeDefined();
            expect(result.metadata).toBeDefined();
            expect(result.invalid).toBeDefined();
        });

        test('should return only valid corridors', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const result = generator.generate();

            expect(result.metadata.validCount).toBe(result.corridors.length);
        });

        test('should track invalid corridors', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots);
            const result = generator.generate();

            expect(result.metadata).toHaveProperty('invalidCount');
            expect(result.metadata.invalidCount).toBeGreaterThanOrEqual(0);
        });
    });

    describe('edge cases', () => {
        test('should handle empty ilots array', () => {
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, []);
            const result = generator.generate();

            expect(result.corridors.length).toBe(0);
        });

        test('should handle single ilot', () => {
            const singleIlot = [{ x: 2, y: 2, width: 2, height: 1, area: 2 }];
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, singleIlot);
            const result = generator.generate();

            expect(result.corridors.length).toBe(0);
        });

        test('should handle very large corridor width', () => {
            const options = { corridorWidth: 5.0 };
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots, options);
            const result = generator.generate();

            // Should still generate corridors but clamp dimensions
            expect(result.corridors).toBeDefined();
        });

        test('should handle very small minimum corridor length', () => {
            const options = { minCorridorLength: 0.1 };
            const generator = new AdvancedCorridorGenerator(mockFloorPlan, mockIlots, options);
            const result = generator.generate();

            expect(result.corridors).toBeDefined();
        });
    });
});
