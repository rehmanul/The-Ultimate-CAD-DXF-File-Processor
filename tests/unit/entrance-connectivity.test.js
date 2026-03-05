const AdvancedCorridorNetworkGenerator = require('../../lib/advancedCorridorNetworkGenerator');
const CirculationRouter = require('../../lib/costo-engine/circulationRouter');

describe('Entrance Connectivity Enhancement', () => {
    test('entrance connects to main component when nearest node is in main component', () => {
        // Create a simple floor plan with one connected corridor network
        const floorPlan = {
            bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
            walls: [],
            forbiddenZones: [],
            entrances: [{ x: 5, y: 5 }]
        };

        const îlots = [
            { x: 10, y: 10, width: 5, height: 5 },
            { x: 20, y: 10, width: 5, height: 5 }
        ];

        const corridors = [
            {
                id: 'h1',
                type: 'horizontal',
                x: 5,
                y: 12,
                width: 25,
                height: 1.2,
                corners: [[5, 12], [30, 12], [30, 13.2], [5, 13.2]]
            }
        ];

        const generator = new AdvancedCorridorNetworkGenerator(floorPlan, îlots);
        const circulationRouter = new CirculationRouter(floorPlan);

        const result = generator.ensureEntranceConnectivity(corridors, floorPlan, circulationRouter);

        // Should return corridors unchanged since entrance is already near main component
        expect(result.length).toBeGreaterThanOrEqual(corridors.length);
    });

    test('creates bridge when entrance connects to isolated component', () => {
        // Create a floor plan with two clearly disconnected corridor segments
        // Entrance is near the smaller isolated component
        const floorPlan = {
            bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
            walls: [],
            forbiddenZones: [],
            entrances: [{ x: 10, y: 10 }]
        };

        const îlots = [
            // Small cluster near entrance
            { x: 5, y: 15, width: 5, height: 5 },
            { x: 15, y: 15, width: 5, height: 5 },
            // Large cluster far from entrance
            { x: 50, y: 50, width: 5, height: 5 },
            { x: 60, y: 50, width: 5, height: 5 },
            { x: 50, y: 60, width: 5, height: 5 },
            { x: 60, y: 60, width: 5, height: 5 }
        ];

        const corridors = [
            // Small isolated corridor near entrance (horizontal)
            {
                id: 'h1',
                type: 'horizontal',
                x: 5,
                y: 17,
                width: 15,
                height: 1.2,
                corners: [[5, 17], [20, 17], [20, 18.2], [5, 18.2]]
            },
            // Large main corridor network (horizontal + vertical = more nodes)
            {
                id: 'h2',
                type: 'horizontal',
                x: 50,
                y: 52,
                width: 15,
                height: 1.2,
                corners: [[50, 52], [65, 52], [65, 53.2], [50, 53.2]]
            },
            {
                id: 'v1',
                type: 'vertical',
                x: 57,
                y: 50,
                width: 1.2,
                height: 15,
                corners: [[57, 50], [57, 65], [58.2, 65], [58.2, 50]]
            }
        ];

        const generator = new AdvancedCorridorNetworkGenerator(floorPlan, îlots);
        const circulationRouter = new CirculationRouter(floorPlan);

        const result = generator.ensureEntranceConnectivity(corridors, floorPlan, circulationRouter);

        // The entrance is near the small component (h1 with 2 nodes), 
        // but the main component is h2+v1 (with more nodes due to intersection)
        // So a bridge should be created from the small component to the main component
        expect(result.length).toBeGreaterThan(corridors.length);
        
        // Check that at least one corridor is marked as entrance bridge
        const entranceBridges = result.filter(c => c.isEntranceBridge);
        expect(entranceBridges.length).toBeGreaterThan(0);
    });

    test('handles multiple entrances connecting to different components', () => {
        // Create a floor plan with two disconnected corridor segments
        // Each entrance is near a different component
        const floorPlan = {
            bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
            walls: [],
            forbiddenZones: [],
            entrances: [
                { x: 10, y: 10 },  // Near first component
                { x: 90, y: 90 }   // Near second component
            ]
        };

        const îlots = [
            { x: 5, y: 15, width: 5, height: 5 },
            { x: 15, y: 15, width: 5, height: 5 },
            { x: 85, y: 85, width: 5, height: 5 },
            { x: 95, y: 85, width: 5, height: 5 }
        ];

        const corridors = [
            // First corridor network
            {
                id: 'h1',
                type: 'horizontal',
                x: 5,
                y: 17,
                width: 15,
                height: 1.2,
                corners: [[5, 17], [20, 17], [20, 18.2], [5, 18.2]]
            },
            // Second corridor network (disconnected)
            {
                id: 'h2',
                type: 'horizontal',
                x: 85,
                y: 87,
                width: 15,
                height: 1.2,
                corners: [[85, 87], [100, 87], [100, 88.2], [85, 88.2]]
            }
        ];

        const generator = new AdvancedCorridorNetworkGenerator(floorPlan, îlots);
        const circulationRouter = new CirculationRouter(floorPlan);

        const result = generator.ensureEntranceConnectivity(corridors, floorPlan, circulationRouter);

        // Should add entrance bridge corridor(s) to connect smaller component to main
        expect(result.length).toBeGreaterThan(corridors.length);
    });

    test('handles no entrances gracefully', () => {
        const floorPlan = {
            bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
            walls: [],
            forbiddenZones: [],
            entrances: []
        };

        const îlots = [
            { x: 10, y: 10, width: 5, height: 5 }
        ];

        const corridors = [
            {
                id: 'h1',
                type: 'horizontal',
                x: 5,
                y: 12,
                width: 15,
                height: 1.2,
                corners: [[5, 12], [20, 12], [20, 13.2], [5, 13.2]]
            }
        ];

        const generator = new AdvancedCorridorNetworkGenerator(floorPlan, îlots);
        const circulationRouter = new CirculationRouter(floorPlan);

        const result = generator.ensureEntranceConnectivity(corridors, floorPlan, circulationRouter);

        // Should return corridors unchanged
        expect(result).toEqual(corridors);
    });

    test('handles single component network (no bridging needed)', () => {
        const floorPlan = {
            bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
            walls: [],
            forbiddenZones: [],
            entrances: [{ x: 5, y: 5 }]
        };

        const îlots = [
            { x: 10, y: 10, width: 5, height: 5 },
            { x: 20, y: 10, width: 5, height: 5 }
        ];

        // Single connected corridor network
        const corridors = [
            {
                id: 'h1',
                type: 'horizontal',
                x: 5,
                y: 12,
                width: 25,
                height: 1.2,
                corners: [[5, 12], [30, 12], [30, 13.2], [5, 13.2]]
            }
        ];

        const generator = new AdvancedCorridorNetworkGenerator(floorPlan, îlots);
        const circulationRouter = new CirculationRouter(floorPlan);

        const result = generator.ensureEntranceConnectivity(corridors, floorPlan, circulationRouter);

        // Should return corridors unchanged (single component, no bridging needed)
        expect(result).toEqual(corridors);
    });
});
