/**
 * Integration Tests for Phase 1 Refactoring
 * Tests the complete workflow: DXF Upload → Distribution → Îlots → Corridors
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Mock server will be required in beforeAll
let app;

describe('Phase 1 Integration Tests', () => {
    beforeAll(() => {
        // Set environment for testing
        process.env.NODE_ENV = 'test';
        process.env.SKIP_ML_BOOTSTRAP = '1'; // Skip ML training in tests
        
        // Require app after env vars are set
        app = require('../../../server');
    });

    afterAll((done) => {
        // Cleanup
        if (app && app.close) {
            app.close(done);
        } else {
            done();
        }
    });

    describe('Complete Workflow', () => {
        let uploadedUrn;
        let generatedIlots;
        let floorPlan;

        test('should upload and process DXF file', async () => {
            // Create a simple mock DXF file for testing
            const mockDxfPath = path.join(__dirname, '../../fixtures/test.dxf');
            
            // Create fixtures directory if it doesn't exist
            const fixturesDir = path.join(__dirname, '../../fixtures');
            if (!fs.existsSync(fixturesDir)) {
                fs.mkdirSync(fixturesDir, { recursive: true });
            }

            // Create minimal DXF file for testing
            if (!fs.existsSync(mockDxfPath)) {
                const minimalDxf = `0
SECTION
2
ENTITIES
0
LINE
8
WALLS
10
0.0
20
0.0
11
10.0
21
0.0
0
ENDSEC
0
EOF
`;
                fs.writeFileSync(mockDxfPath, minimalDxf);
            }

            const response = await request(app)
                .post('/api/jobs')
                .attach('file', mockDxfPath)
                .expect(200);

            expect(response.body).toHaveProperty('success', true);
            expect(response.body).toHaveProperty('urn');
            expect(response.body).toHaveProperty('cadData');
            
            uploadedUrn = response.body.urn;
            floorPlan = response.body.cadData;
        });

        test('should generate îlots with custom distribution', async () => {
            const distribution = {
                '0-1': 15,
                '1-3': 30,
                '3-5': 35,
                '5-10': 20
            };

            const response = await request(app)
                .post('/api/ilots')
                .send({
                    floorPlan,
                    distribution,
                    options: {
                        totalIlots: 20,
                        seed: 12345
                    }
                })
                .expect(200);

            expect(response.body).toHaveProperty('success', true);
            expect(response.body).toHaveProperty('ilots');
            expect(response.body.ilots.length).toBeGreaterThan(0);
            expect(response.body).toHaveProperty('totalArea');
            
            generatedIlots = response.body.ilots;
        });

        test('should generate corridors with facing row detection', async () => {
            const response = await request(app)
                .post('/api/corridors')
                .send({
                    floorPlan,
                    ilots: generatedIlots,
                    corridorWidth: 1.5,
                    options: {
                        generateVertical: true,
                        generateHorizontal: true,
                        minRowDistance: 1.5,
                        maxRowDistance: 8.0
                    }
                })
                .expect(200);

            expect(response.body).toHaveProperty('success', true);
            expect(response.body).toHaveProperty('corridors');
            expect(response.body).toHaveProperty('metadata');
            expect(response.body.metadata).toHaveProperty('vertical');
            expect(response.body.metadata).toHaveProperty('horizontal');
            expect(response.body.metadata).toHaveProperty('totalArea');
        });

        test('should export to PDF', async () => {
            const response = await request(app)
                .post('/api/export/pdf')
                .send({
                    floorPlan,
                    ilots: generatedIlots,
                    corridors: []
                })
                .expect(200);

            expect(response.body).toHaveProperty('success', true);
            expect(response.body).toHaveProperty('filename');
            expect(response.body.filename).toMatch(/\.pdf$/);
        });
    });

    describe('Distribution Validation', () => {
        test('should accept valid distribution totaling 100%', async () => {
            const distribution = {
                '0-1': 10,
                '1-3': 25,
                '3-5': 30,
                '5-10': 35
            };

            const response = await request(app)
                .post('/api/ilots')
                .send({
                    floorPlan: {
                        walls: [],
                        forbiddenZones: [],
                        entrances: [],
                        bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
                        rooms: []
                    },
                    distribution,
                    options: { totalIlots: 10 }
                })
                .expect(200);

            expect(response.body.success).toBe(true);
        });

        test('should handle different distribution configurations', async () => {
            const distribution = {
                '2-4': 50,
                '4-8': 50
            };

            const response = await request(app)
                .post('/api/ilots')
                .send({
                    floorPlan: {
                        walls: [],
                        forbiddenZones: [],
                        entrances: [],
                        bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
                        rooms: []
                    },
                    distribution,
                    options: { totalIlots: 10 }
                })
                .expect(200);

            expect(response.body.success).toBe(true);
        });
    });

    describe('Color Detection Integration', () => {
        test('should classify entities by color', async () => {
            const mockFloorPlan = {
                walls: [
                    { layer: 'DOOR', color: 1, start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
                    { layer: 'STAIRS', color: 5, start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
                    { layer: 'WALLS', color: 0, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
                ],
                forbiddenZones: [],
                entrances: [],
                bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
                rooms: []
            };

            const response = await request(app)
                .post('/api/ilots')
                .send({
                    floorPlan: mockFloorPlan,
                    distribution: { '1-3': 100 },
                    options: { totalIlots: 5 }
                })
                .expect(200);

            expect(response.body.success).toBe(true);
        });
    });

    describe('Corridor Generation Options', () => {
        let testIlots;

        beforeAll(() => {
            // Create test îlots in facing rows
            testIlots = [
                { x: 0, y: 0, width: 2, height: 1, area: 2 },
                { x: 3, y: 0, width: 2, height: 1, area: 2 },
                { x: 0, y: 5, width: 2, height: 1, area: 2 },
                { x: 3, y: 5, width: 2, height: 1, area: 2 }
            ];
        });

        test('should generate only vertical corridors when horizontal disabled', async () => {
            const response = await request(app)
                .post('/api/corridors')
                .send({
                    floorPlan: {
                        walls: [],
                        forbiddenZones: [],
                        entrances: [],
                        bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 }
                    },
                    ilots: testIlots,
                    corridorWidth: 1.5,
                    options: {
                        generateVertical: true,
                        generateHorizontal: false
                    }
                })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.metadata.horizontal.count).toBe(0);
        });

        test('should generate only horizontal corridors when vertical disabled', async () => {
            const response = await request(app)
                .post('/api/corridors')
                .send({
                    floorPlan: {
                        walls: [],
                        forbiddenZones: [],
                        entrances: [],
                        bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 }
                    },
                    ilots: testIlots,
                    corridorWidth: 1.5,
                    options: {
                        generateVertical: false,
                        generateHorizontal: true
                    }
                })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.metadata.vertical.count).toBe(0);
        });

        test('should respect custom corridor width', async () => {
            const customWidth = 2.5;

            const response = await request(app)
                .post('/api/corridors')
                .send({
                    floorPlan: {
                        walls: [],
                        forbiddenZones: [],
                        entrances: [],
                        bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 }
                    },
                    ilots: testIlots,
                    corridorWidth: customWidth
                })
                .expect(200);

            expect(response.body.success).toBe(true);
            // Corridors should have height/width <= customWidth
            response.body.corridors.forEach(corridor => {
                const dimension = corridor.orientation === 'vertical' ? corridor.width : corridor.height;
                expect(dimension).toBeLessThanOrEqual(customWidth);
            });
        });
    });

    describe('Error Handling', () => {
        test('should return error for missing floor plan', async () => {
            const response = await request(app)
                .post('/api/ilots')
                .send({
                    distribution: { '1-3': 100 }
                })
                .expect(400);

            expect(response.body).toHaveProperty('error');
        });

        test('should return error for missing îlots in corridor generation', async () => {
            const response = await request(app)
                .post('/api/corridors')
                .send({
                    floorPlan: {
                        walls: [],
                        forbiddenZones: [],
                        entrances: [],
                        bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 }
                    }
                })
                .expect(400);

            expect(response.body).toHaveProperty('error');
        });

        test('should handle empty îlots array', async () => {
            const response = await request(app)
                .post('/api/corridors')
                .send({
                    floorPlan: {
                        walls: [],
                        forbiddenZones: [],
                        entrances: [],
                        bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 }
                    },
                    ilots: []
                })
                .expect(400);

            expect(response.body).toHaveProperty('error');
        });
    });

    describe('Performance Tests', () => {
        test('should process large floor plan within reasonable time', async () => {
            const largeFloorPlan = {
                walls: Array(100).fill(null).map((_, i) => ({
                    start: { x: i * 2, y: 0 },
                    end: { x: i * 2 + 1, y: 0 }
                })),
                forbiddenZones: [],
                entrances: [],
                bounds: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
                rooms: []
            };

            const startTime = Date.now();

            const response = await request(app)
                .post('/api/ilots')
                .send({
                    floorPlan: largeFloorPlan,
                    distribution: { '1-3': 100 },
                    options: { totalIlots: 50 }
                })
                .expect(200);

            const duration = Date.now() - startTime;

            expect(response.body.success).toBe(true);
            expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
        });

        test('should generate corridors for many îlots efficiently', async () => {
            const manyIlots = Array(50).fill(null).map((_, i) => ({
                x: (i % 10) * 3,
                y: Math.floor(i / 10) * 3,
                width: 2,
                height: 1,
                area: 2
            }));

            const startTime = Date.now();

            const response = await request(app)
                .post('/api/corridors')
                .send({
                    floorPlan: {
                        walls: [],
                        forbiddenZones: [],
                        entrances: [],
                        bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 }
                    },
                    ilots: manyIlots,
                    corridorWidth: 1.5
                })
                .expect(200);

            const duration = Date.now() - startTime;

            expect(response.body.success).toBe(true);
            expect(duration).toBeLessThan(3000); // Should complete within 3 seconds
        });
    });
});
