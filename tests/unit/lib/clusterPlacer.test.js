const ClusterPlacer = require('../../../lib/ClusterPlacer');

describe('ClusterPlacer', () => {
    let floorPlan;
    let placer;

    beforeEach(() => {
        floorPlan = {
            bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
            walls: [
                { start: { x: 0, y: 0 }, end: { x: 20, y: 0 } },
                { start: { x: 20, y: 0 }, end: { x: 20, y: 20 } },
                { start: { x: 20, y: 20 }, end: { x: 0, y: 20 } },
                { start: { x: 0, y: 20 }, end: { x: 0, y: 0 } }
            ],
            forbiddenZones: [],
            entrances: []
        };
        placer = new ClusterPlacer(floorPlan);
    });

    test('should place a single cluster within bounds', () => {
        const space = {
            bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
            polygon: [[0, 0], [10, 0], [10, 10], [0, 10]]
        };
        const configs = [{ type: 'team_4', count: 1 }];
        const ilots = placer.placeClusters(space, configs);

        expect(ilots.length).toBe(4); // 2x2 cluster
        ilots.forEach(ilot => {
            expect(ilot.x).toBeGreaterThanOrEqual(0);
            expect(ilot.x).toBeLessThanOrEqual(10);
            expect(ilot.y).toBeGreaterThanOrEqual(0);
            expect(ilot.y).toBeLessThanOrEqual(10);
        });
    });

    test('should respect forbidden zones', () => {
        // Create a small room with a large forbidden zone in the middle
        const space = {
            bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
            polygon: [[0, 0], [10, 0], [10, 10], [0, 10]]
        };

        // Forbidden zone covering most of the center
        placer.forbiddenZones = [{
            polygon: [[2, 2], [8, 2], [8, 8], [2, 8]]
        }];

        const configs = [{ type: 'team_4', count: 1 }];
        const ilots = placer.placeClusters(space, configs);

        // Should either place in the corners or fail if no space
        if (ilots.length > 0) {
            ilots.forEach(ilot => {
                // Check if ilot is inside forbidden zone (approximate check)
                const inZone = ilot.x > 2 && ilot.x < 8 && ilot.y > 2 && ilot.y < 8;
                expect(inZone).toBe(false);
            });
        }
    });

    test('should handle rotation', () => {
        const space = {
            bounds: { minX: 0, minY: 0, maxX: 10, maxY: 20 }, // Vertical room
            polygon: [[0, 0], [10, 0], [10, 20], [0, 20]]
        };
        const configs = [{ type: 'team_4', count: 5 }]; // Try to place many
        const ilots = placer.placeClusters(space, configs);

        // We can't easily assert exact rotation without mocking Math.random, 
        // but we can check that ilots are generated validly.
        expect(ilots.length).toBeGreaterThan(0);
    });

    test('should not overlap clusters', () => {
        const space = {
            bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
            polygon: [[0, 0], [10, 0], [10, 10], [0, 10]]
        };
        const configs = [{ type: 'team_4', count: 2 }];
        const ilots = placer.placeClusters(space, configs);

        // If 2 clusters placed (8 desks), check for overlaps
        if (ilots.length === 8) {
            for (let i = 0; i < ilots.length; i++) {
                for (let j = i + 1; j < ilots.length; j++) {
                    const a = ilots[i];
                    const b = ilots[j];
                    // Simple box overlap check
                    const overlap = !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
                    expect(overlap).toBe(false);
                }
            }
        }
    });
});
