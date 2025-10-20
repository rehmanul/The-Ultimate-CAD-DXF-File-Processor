const MultiFloorManager = require('../../../lib/multiFloorManager');

describe('MultiFloorManager', () => {
    const baseFloor = {
        id: 'level_0',
        level: 0,
        floorPlan: {
            bounds: { minX: 0, minY: 0, width: 20, height: 30 },
            forbiddenZones: [
                {
                    layer: 'STAIRS_MAIN',
                    polygon: [
                        { x: 2, y: 2 },
                        { x: 4, y: 2 },
                        { x: 4, y: 4 },
                        { x: 2, y: 4 }
                    ]
                }
            ]
        },
        ilots: [],
        corridors: []
    };

    test('stacks floors and links vertical connectors', () => {
        const floors = [
            baseFloor,
            {
                id: 'level_1',
                level: 1,
                floorPlan: {
                    bounds: { minX: 0, minY: 0, width: 20, height: 30 },
                    forbiddenZones: [
                        {
                            layer: 'STAIRS_MAIN',
                            polygon: [
                                { x: 2.1, y: 2 },
                                { x: 4.1, y: 2 },
                                { x: 4.1, y: 4 },
                                { x: 2.1, y: 4 }
                            ]
                        }
                    ]
                },
                ilots: [],
                corridors: []
            }
        ];

        const manager = new MultiFloorManager({ floorHeight: 3.5 });
        const result = manager.stackFloors(floors);

        expect(result.floors).toHaveLength(2);
        expect(result.connectors).toHaveLength(2);
        expect(result.edges).toHaveLength(1);
        expect(result.graph.edges).toHaveLength(1);
        expect(result.stats.floorCount).toBe(2);
        expect(result.stats.verticalConnections).toBe(1);
        expect(result.compliance).toBeDefined();
        expect(result.compliance.accessibility.floors).toHaveLength(2);
        expect(result.crossFloorPaths).toHaveLength(1);
        expect(result.crossFloorPaths[0]).toMatchObject({
            fromLevel: 0,
            toLevel: 1
        });
    });

    test('reports alignment warnings and respects connector types', () => {
        const floors = [
            {
                ...baseFloor,
                floorPlan: {
                    ...baseFloor.floorPlan,
                    forbiddenZones: [
                        {
                            layer: 'ELEVATOR_CORE',
                            polygon: [
                                { x: 10, y: 10 },
                                { x: 12, y: 10 },
                                { x: 12, y: 12 },
                                { x: 10, y: 12 }
                            ]
                        }
                    ]
                }
            },
            {
                id: 'level_1',
                level: 1,
                floorPlan: {
                    bounds: { minX: 0, minY: 0, width: 20.05, height: 30 },
                    forbiddenZones: [
                        {
                            layer: 'ELEVATOR_CORE',
                            polygon: [
                                { x: 10.05, y: 10 },
                                { x: 12.05, y: 10 },
                                { x: 12.05, y: 12 },
                                { x: 10.05, y: 12 }
                            ]
                        }
                    ]
                }
            },
            {
                id: 'level_2',
                level: 2,
                floorPlan: {
                    bounds: { minX: 0, minY: 0, width: 20.05, height: 30 },
                    forbiddenZones: [
                        {
                            layer: 'STAIR_WEST',
                            polygon: [
                                { x: 5, y: 5 },
                                { x: 6, y: 5 },
                                { x: 6, y: 6 },
                                { x: 5, y: 6 }
                            ]
                        }
                    ]
                }
            }
        ];

        const manager = new MultiFloorManager();
        const result = manager.stackFloors(floors);

        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.connectors.filter((c) => c.type === 'elevator')).toHaveLength(2);
        expect(result.connectors.filter((c) => c.type === 'stair')).toHaveLength(1);
        expect(result.edges).toHaveLength(1);
        expect(result.edges[0].type).toBe('elevator');
        const hasStairEdge = result.edges.some((edge) => edge.type === 'stair');
        expect(hasStairEdge).toBe(false);
        expect(result.compliance.egress.floors).toHaveLength(3);
        expect(result.stats.complianceSummary.accessibility.failCount).toBeGreaterThanOrEqual(1);
    });

    test('evaluates egress and accessibility compliance', () => {
        const floors = [
            {
                id: 'ground',
                level: 0,
                floorPlan: {
                    bounds: { minX: 0, minY: 0, width: 30, height: 30 },
                    rooms: [
                        { center: { x: 5, y: 5 } },
                        { center: { x: 10, y: 10 } }
                    ],
                    entrances: [
                        { start: { x: 0, y: 0 }, end: { x: 0, y: 2 } },
                        { start: { x: 15, y: 0 }, end: { x: 17, y: 0 } }
                    ],
                    forbiddenZones: [
                        {
                            layer: 'ELEVATOR_CORE',
                            polygon: [
                                { x: 8, y: 8 },
                                { x: 10, y: 8 },
                                { x: 10, y: 10 },
                                { x: 8, y: 10 }
                            ]
                        }
                    ]
                }
            },
            {
                id: 'floor2',
                level: 1,
                floorPlan: {
                    bounds: { minX: 0, minY: 0, width: 30, height: 30 },
                    rooms: [
                        { center: { x: 12, y: 12 } },
                        { center: { x: 18, y: 18 } }
                    ],
                    entrances: [
                        { start: { x: 0, y: 0 }, end: { x: 0, y: 2 } }
                    ],
                    forbiddenZones: [
                        {
                            layer: 'ELEVATOR_CORE',
                            polygon: [
                                { x: 8, y: 8 },
                                { x: 10, y: 8 },
                                { x: 10, y: 10 },
                                { x: 8, y: 10 }
                            ]
                        },
                        {
                            layer: 'STAIR_WEST',
                            polygon: [
                                { x: 2, y: 2 },
                                { x: 3, y: 2 },
                                { x: 3, y: 4 },
                                { x: 2, y: 4 }
                            ]
                        }
                    ]
                }
            }
        ];

        const manager = new MultiFloorManager({ egressDistanceLimit: 60 });
        const result = manager.stackFloors(floors);

        const ground = result.compliance.egress.floors.find(f => f.floorId === 'ground');
        const upper = result.compliance.accessibility.floors.find(f => f.floorId === 'floor2');

        expect(ground).toBeDefined();
        expect(ground.pass).toBe(true);
        expect(ground.maxDistance).toBeGreaterThan(0);
        expect(upper).toBeDefined();
        expect(upper.hasElevator).toBe(true);
        expect(upper.stairCount).toBeGreaterThan(0);
        expect(upper.pass).toBe(true);
    });
});
