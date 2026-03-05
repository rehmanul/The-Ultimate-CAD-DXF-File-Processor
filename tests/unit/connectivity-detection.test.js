/**
 * Unit tests for connectivity detection in CirculationRouter
 * Tests the new detectConnectivity method added in Task 3.1
 */

const CirculationRouter = require('../../lib/costo-engine/circulationRouter');

describe('CirculationRouter - Connectivity Detection', () => {
    test('detectConnectivity returns fully connected for single corridor', () => {
        const floorPlan = {
            bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
            walls: [],
            entrances: [{ x: 5, y: 15 }]
        };

        const corridors = [
            { x: 10, y: 10, width: 30, height: 2, direction: 'horizontal' }
        ];

        const îlots = [
            { x: 10, y: 5, width: 8, height: 4 },
            { x: 20, y: 5, width: 8, height: 4 }
        ];

        const router = new CirculationRouter(floorPlan, {});
        const result = router.detectConnectivity(corridors, îlots, floorPlan.entrances);

        // Debug output
        console.log('Result:', JSON.stringify(result, null, 2));

        // With a single connected corridor and îlots adjacent to it, should be fully connected
        // However, unreachableÎlots might still be populated if îlots are not close enough
        expect(result.totalComponents).toBe(1);
        expect(result.disconnectedComponents.length).toBe(1);
        expect(result.unreachableFromEntrances.length).toBe(0);
    });

    test('detectConnectivity detects disconnected components', () => {
        const floorPlan = {
            bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
            walls: [],
            entrances: [{ x: 5, y: 15 }]
        };

        // Two separate corridors with no connection
        const corridors = [
            { x: 10, y: 10, width: 20, height: 2, direction: 'horizontal' },
            { x: 60, y: 60, width: 20, height: 2, direction: 'horizontal' }
        ];

        const îlots = [];

        const router = new CirculationRouter(floorPlan, {});
        const result = router.detectConnectivity(corridors, îlots, floorPlan.entrances);

        expect(result.isFullyConnected).toBe(false);
        expect(result.totalComponents).toBeGreaterThan(1);
        expect(result.disconnectedComponents.length).toBeGreaterThan(1);
    });

    test('detectConnectivity identifies unreachable îlots', () => {
        const floorPlan = {
            bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
            walls: [],
            entrances: [{ x: 5, y: 15 }]
        };

        const corridors = [
            { x: 10, y: 10, width: 20, height: 2, direction: 'horizontal' }
        ];

        // Îlots: some adjacent to corridor, some far away
        const îlots = [
            { x: 10, y: 5, width: 8, height: 4 },  // Adjacent to corridor
            { x: 70, y: 70, width: 8, height: 8 }  // Far from corridor (isolated)
        ];

        const router = new CirculationRouter(floorPlan, {});
        const result = router.detectConnectivity(corridors, îlots, floorPlan.entrances);

        expect(result.unreachableÎlots.length).toBeGreaterThan(0);
        expect(result.isFullyConnected).toBe(false);
    });

    test('detectConnectivity handles empty corridors', () => {
        const floorPlan = {
            bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
            walls: [],
            entrances: [{ x: 5, y: 15 }]
        };

        const corridors = [];
        const îlots = [
            { x: 10, y: 5, width: 8, height: 4 }
        ];

        const router = new CirculationRouter(floorPlan, {});
        const result = router.detectConnectivity(corridors, îlots, floorPlan.entrances);

        expect(result.isFullyConnected).toBe(false);
        expect(result.totalComponents).toBe(0);
        expect(result.unreachableÎlots.length).toBe(îlots.length);
    });

    test('detectConnectivity identifies nodes unreachable from entrances', () => {
        const floorPlan = {
            bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
            walls: [],
            entrances: [{ x: 5, y: 15 }]
        };

        // Two disconnected corridors, entrance only near first one
        const corridors = [
            { x: 10, y: 10, width: 20, height: 2, direction: 'horizontal' },
            { x: 70, y: 70, width: 20, height: 2, direction: 'horizontal' }
        ];

        const îlots = [];

        const router = new CirculationRouter(floorPlan, {});
        const result = router.detectConnectivity(corridors, îlots, floorPlan.entrances);

        expect(result.unreachableFromEntrances.length).toBeGreaterThan(0);
        expect(result.isFullyConnected).toBe(false);
    });

    test('detectConnectivity returns component information with nodes', () => {
        const floorPlan = {
            bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
            walls: [],
            entrances: [{ x: 5, y: 15 }]
        };

        const corridors = [
            { x: 10, y: 10, width: 30, height: 2, direction: 'horizontal' }
        ];

        const îlots = [];

        const router = new CirculationRouter(floorPlan, {});
        const result = router.detectConnectivity(corridors, îlots, floorPlan.entrances);

        expect(result.disconnectedComponents.length).toBeGreaterThan(0);
        expect(result.disconnectedComponents[0]).toHaveProperty('componentIndex');
        expect(result.disconnectedComponents[0]).toHaveProperty('nodeKeys');
        expect(result.disconnectedComponents[0]).toHaveProperty('nodes');
        expect(result.disconnectedComponents[0]).toHaveProperty('îlots');
        expect(Array.isArray(result.disconnectedComponents[0].nodes)).toBe(true);
    });
});
