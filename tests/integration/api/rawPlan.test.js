const request = require('supertest');
const path = require('path');
const app = require(path.resolve(__dirname, '../../../server'));

describe('API /api/raw-plan', () => {
    const baseFloorPlan = {
        walls: [
            { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
            { start: { x: 10, y: 0 }, end: { x: 10, y: 8 } },
            { start: { x: 10, y: 8 }, end: { x: 0, y: 8 } },
            { start: { x: 0, y: 8 }, end: { x: 0, y: 0 } }
        ],
        bounds: { minX: 0, minY: 0, maxX: 10, maxY: 8 }
    };

    describe('POST /api/raw-plan/analyze', () => {
        test('should analyze floor plan and return analysis', async () => {
            const res = await request(app)
                .post('/api/raw-plan/analyze')
                .send({ floorPlan: baseFloorPlan })
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(res.body.analysis).toBeDefined();
            expect(res.body.analysis).toHaveProperty('gapCount');
            expect(res.body.analysis).toHaveProperty('recommendations');
        });

        test('should return 400 when floor plan missing', async () => {
            const res = await request(app)
                .post('/api/raw-plan/analyze')
                .send({})
                .expect(400);

            expect(res.body.error).toContain('walls required');
        });

        test('should return 400 when walls missing', async () => {
            const res = await request(app)
                .post('/api/raw-plan/analyze')
                .send({ floorPlan: { bounds: {} } })
                .expect(400);

            expect(res.body.error).toBeDefined();
        });
    });

    describe('POST /api/raw-plan/complete', () => {
        test('should return 410 (endpoint disabled in production)', async () => {
            const floorPlanWithGap = {
                walls: [
                    { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
                    { start: { x: 10.5, y: 0 }, end: { x: 10.5, y: 8 } },
                    { start: { x: 10.5, y: 8 }, end: { x: 0, y: 8 } },
                    { start: { x: 0, y: 8 }, end: { x: 0, y: 0 } }
                ],
                bounds: { minX: 0, minY: 0, maxX: 11, maxY: 8 }
            };

            const res = await request(app)
                .post('/api/raw-plan/complete')
                .send({ floorPlan: floorPlanWithGap })
                .expect(410);

            expect(res.body.success).toBe(false);
            expect(res.body.error).toContain('Raw plan completion is disabled');
            expect(res.body.error).toContain('Source geometry is kept authentic');
        });

        test('should return 410 for any request (endpoint disabled)', async () => {
            const res = await request(app)
                .post('/api/raw-plan/complete')
                .send({ floorPlan: baseFloorPlan })
                .expect(410);

            expect(res.body.success).toBe(false);
            expect(res.body.error).toBeDefined();
        });

        test('should return 410 even when floor plan missing', async () => {
            const res = await request(app)
                .post('/api/raw-plan/complete')
                .send({})
                .expect(410);

            expect(res.body.success).toBe(false);
            expect(res.body.error).toContain('Raw plan completion is disabled');
        });
    });
});
