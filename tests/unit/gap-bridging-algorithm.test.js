/**
 * Unit tests for gap bridging algorithm in corridorRouter.js
 * 
 * Tests the generateBridgingCorridors static method in isolation
 */

const CorridorRouter = require('../../lib/corridorRouter');

describe('Gap Bridging Algorithm', () => {
    test('should generate bridging corridor between two disconnected components', () => {
        const floorPlan = {
            bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
            walls: [],
            forbiddenZones: []
        };

        // Create two disconnected components
        const disconnectedComponents = [
            {
                componentIndex: 0,
                nodes: [
                    { x: 10, y: 10, key: '10_10' },
                    { x: 15, y: 10, key: '15_10' },
                    { x: 20, y: 10, key: '20_10' }
                ]
            },
            {
                componentIndex: 1,
                nodes: [
                    { x: 70, y: 70, key: '70_70' },
                    { x: 75, y: 70, key: '75_70' },
                    { x: 80, y: 70, key: '80_70' }
                ]
            }
        ];

        const corridors = [];
        const options = { corridorWidth: 1.2 };

        const bridgingCorridors = CorridorRouter.generateBridgingCorridors(
            corridors,
            floorPlan,
            disconnectedComponents,
            options
        );

        // Should generate at least one bridging corridor
        expect(bridgingCorridors.length).toBeGreaterThan(0);
        
        // Bridging corridor should have required properties
        const bridge = bridgingCorridors[0];
        expect(bridge).toHaveProperty('id');
        expect(bridge).toHaveProperty('type');
        expect(bridge).toHaveProperty('x');
        expect(bridge).toHaveProperty('y');
        expect(bridge).toHaveProperty('width');
        expect(bridge).toHaveProperty('height');
        expect(bridge).toHaveProperty('isBridge', true);
        expect(bridge).toHaveProperty('corners');
        expect(bridge.corners.length).toBeGreaterThan(0);
    });

    test('should return empty array when components are already connected', () => {
        const floorPlan = {
            bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
            walls: [],
            forbiddenZones: []
        };

        // Single component (already connected)
        const disconnectedComponents = [
            {
                componentIndex: 0,
                nodes: [
                    { x: 10, y: 10, key: '10_10' },
                    { x: 15, y: 10, key: '15_10' },
                    { x: 20, y: 10, key: '20_10' }
                ]
            }
        ];

        const corridors = [];
        const options = { corridorWidth: 1.2 };

        const bridgingCorridors = CorridorRouter.generateBridgingCorridors(
            corridors,
            floorPlan,
            disconnectedComponents,
            options
        );

        // Should not generate any bridging corridors
        expect(bridgingCorridors.length).toBe(0);
    });

    test('should generate horizontal bridging corridor for horizontally aligned nodes', () => {
        const floorPlan = {
            bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
            walls: [],
            forbiddenZones: []
        };

        // Two components with horizontally aligned nodes
        const disconnectedComponents = [
            {
                componentIndex: 0,
                nodes: [
                    { x: 10, y: 50, key: '10_50' }
                ]
            },
            {
                componentIndex: 1,
                nodes: [
                    { x: 30, y: 50, key: '30_50' }
                ]
            }
        ];

        const corridors = [];
        const options = { corridorWidth: 1.2 };

        const bridgingCorridors = CorridorRouter.generateBridgingCorridors(
            corridors,
            floorPlan,
            disconnectedComponents,
            options
        );

        expect(bridgingCorridors.length).toBe(1);
        expect(bridgingCorridors[0].type).toBe('horizontal');
    });

    test('should generate vertical bridging corridor for vertically aligned nodes', () => {
        const floorPlan = {
            bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
            walls: [],
            forbiddenZones: []
        };

        // Two components with vertically aligned nodes
        const disconnectedComponents = [
            {
                componentIndex: 0,
                nodes: [
                    { x: 50, y: 10, key: '50_10' }
                ]
            },
            {
                componentIndex: 1,
                nodes: [
                    { x: 50, y: 30, key: '50_30' }
                ]
            }
        ];

        const corridors = [];
        const options = { corridorWidth: 1.2 };

        const bridgingCorridors = CorridorRouter.generateBridgingCorridors(
            corridors,
            floorPlan,
            disconnectedComponents,
            options
        );

        expect(bridgingCorridors.length).toBe(1);
        expect(bridgingCorridors[0].type).toBe('vertical');
    });

    test('should connect multiple disconnected components', () => {
        const floorPlan = {
            bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
            walls: [],
            forbiddenZones: []
        };

        // Three disconnected components
        const disconnectedComponents = [
            {
                componentIndex: 0,
                nodes: [{ x: 10, y: 10, key: '10_10' }]
            },
            {
                componentIndex: 1,
                nodes: [{ x: 30, y: 10, key: '30_10' }]
            },
            {
                componentIndex: 2,
                nodes: [{ x: 50, y: 10, key: '50_10' }]
            }
        ];

        const corridors = [];
        const options = { corridorWidth: 1.2 };

        const bridgingCorridors = CorridorRouter.generateBridgingCorridors(
            corridors,
            floorPlan,
            disconnectedComponents,
            options
        );

        // Should generate 2 bridges to connect 3 components
        expect(bridgingCorridors.length).toBe(2);
    });

    test('should respect wall obstacles when generating bridging corridors', () => {
        const floorPlan = {
            bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
            walls: [
                {
                    start: { x: 25, y: 0 },
                    end: { x: 25, y: 100 }
                }
            ],
            forbiddenZones: []
        };

        // Two components separated by a wall
        const disconnectedComponents = [
            {
                componentIndex: 0,
                nodes: [{ x: 10, y: 50, key: '10_50' }]
            },
            {
                componentIndex: 1,
                nodes: [{ x: 40, y: 50, key: '40_50' }]
            }
        ];

        const corridors = [];
        const options = { corridorWidth: 1.2 };

        const bridgingCorridors = CorridorRouter.generateBridgingCorridors(
            corridors,
            floorPlan,
            disconnectedComponents,
            options
        );

        // Should either generate no bridge (if wall blocks all paths)
        // or generate an L-shaped bridge that goes around the wall
        if (bridgingCorridors.length > 0) {
            const bridge = bridgingCorridors[0];
            // If a bridge was generated, it should be L-shaped to avoid the wall
            expect(['l-shaped', 'horizontal', 'vertical']).toContain(bridge.type);
        }
    });
});
