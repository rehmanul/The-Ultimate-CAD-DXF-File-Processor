const request = require('supertest');
const path = require('path');
const app = require(path.resolve(__dirname, '../../../server'));
const fs = require('fs');

describe('API /api/jobs', () => {
  describe('POST /api/jobs', () => {
    test('should process DXF file and return CAD data', async () => {
      // Create a mock DXF file content (simplified)
      const mockDxfContent = `0
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
LINE
8
WALLS
10
10.0
20
0.0
11
10.0
21
10.0
0
ENDSEC
0
EOF`;

      // Write mock file to temp location
      const tempDir = path.join(__dirname, '../../../temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      const tempFilePath = path.join(tempDir, 'test.dxf');
      fs.writeFileSync(tempFilePath, mockDxfContent);

      const response = await request(app)
        .post('/api/jobs')
        .attach('file', tempFilePath)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('urn');
      expect(response.body).toHaveProperty('cadData');
      expect(response.body.cadData).toHaveProperty('walls');
      expect(Array.isArray(response.body.cadData.walls)).toBe(true);

      // Clean up
      fs.unlinkSync(tempFilePath);
      fs.rmSync(tempDir, { recursive: true });
    }, 15000);

    test('should return error when no file uploaded', async () => {
      const response = await request(app)
        .post('/api/jobs')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('No file uploaded');
    });

    test('should handle invalid file types', async () => {
      const response = await request(app)
        .post('/api/jobs')
        .attach('file', Buffer.from('invalid content'), 'test.txt')
        .expect(200);

      // Should still return success but with empty CAD data for non-DXF files
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('cadData');
    });
  });

  describe('POST /api/analyze', () => {
    test('should analyze CAD data and return analysis', async () => {
      // First upload a file to get CAD data
      const mockDxfContent = `0
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
5.0
21
0.0
0
ENDSEC
0
EOF`;

      const tempDir = path.join(__dirname, '../../../temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      const tempFilePath = path.join(tempDir, 'test.dxf');
      fs.writeFileSync(tempFilePath, mockDxfContent);

      // Upload file first
      const uploadResponse = await request(app)
        .post('/api/jobs')
        .attach('file', tempFilePath)
        .expect(200);

      const urn = uploadResponse.body.urn;

      // Now analyze
      const response = await request(app)
        .post('/api/analyze')
        .send({ urn })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('walls');
      expect(response.body).toHaveProperty('totalArea');
      expect(Array.isArray(response.body.walls)).toBe(true);

      // Clean up
      fs.unlinkSync(tempFilePath);
      fs.rmdirSync(tempDir);
    });

    test('should return error when URN is missing', async () => {
      const response = await request(app)
        .post('/api/analyze')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('URN required');
    });

    test('should return error when no CAD data available', async () => {
      const response = await request(app)
        .post('/api/analyze')
        .send({ urn: 'nonexistent_urn' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('No CAD data available');
    });
  });

  describe('POST /api/ilots', () => {
    test('should generate ilots from floor plan', async () => {
      const floorPlan = testUtils.createMockFloorPlan();

      const response = await request(app)
        .post('/api/ilots')
        .send({ floorPlan })
        .expect(200);

      expect(response.body).toHaveProperty('ilots');
      expect(response.body).toHaveProperty('totalArea');
      expect(response.body).toHaveProperty('count');
      expect(Array.isArray(response.body.ilots)).toBe(true);
      expect(response.body.count).toBeGreaterThan(0);
    });

    test('should return error when floor plan is missing', async () => {
      const response = await request(app)
        .post('/api/ilots')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Floor plan data required');
    });

    test('should use custom distribution and options', async () => {
      const floorPlan = testUtils.createMockFloorPlan();
      const distribution = { '1-3': 0.5, '3-5': 0.3, '5-10': 0.2 };
      const options = { totalIlots: 20, seed: 12345 };

      const response = await request(app)
        .post('/api/ilots')
        .send({ floorPlan, distribution, options })
        .expect(200);

      expect(response.body.ilots).toHaveLength(20);
    });
  });

  describe('POST /api/corridors', () => {
    test('should generate corridors from floor plan and ilots', async () => {
      const floorPlan = testUtils.createMockFloorPlan();
      const ilots = testUtils.createMockIlots(5);

      const response = await request(app)
        .post('/api/corridors')
        .send({ floorPlan, ilots })
        .expect(200);

      expect(response.body).toHaveProperty('corridors');
      expect(response.body).toHaveProperty('totalArea');
      expect(response.body).toHaveProperty('count');
      expect(Array.isArray(response.body.corridors)).toBe(true);
    });

    test('should return error when floor plan is missing', async () => {
      const response = await request(app)
        .post('/api/corridors')
        .send({ ilots: [] })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Floor plan data required');
    });

    test('should return error when ilots are missing', async () => {
      const floorPlan = testUtils.createMockFloorPlan();

      const response = await request(app)
        .post('/api/corridors')
        .send({ floorPlan })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Îlots data required');
    });
  });

  describe('POST /api/optimize/layout', () => {
    test('should optimize layout', async () => {
      const floorPlan = testUtils.createMockFloorPlan();
      const ilots = testUtils.createMockIlots(3);

      const response = await request(app)
        .post('/api/optimize/layout')
        .send({ floorPlan, ilots })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('ilots');
      expect(response.body).toHaveProperty('totalArea');
      expect(response.body).toHaveProperty('count');
    });

    test('should return error when floor plan or ilots are missing', async () => {
      const response = await request(app)
        .post('/api/optimize/layout')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Floor plan and ilots data required');
    });
  });

  describe('POST /api/optimize/paths', () => {
    test('should optimize paths', async () => {
      const floorPlan = testUtils.createMockFloorPlan();
      const ilots = testUtils.createMockIlots(3);

      const response = await request(app)
        .post('/api/optimize/paths')
        .send({ floorPlan, ilots })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('paths');
      expect(response.body).toHaveProperty('totalLength');
      expect(response.body).toHaveProperty('count');
    });

    test('should return error when floor plan is missing', async () => {
      const response = await request(app)
        .post('/api/optimize/paths')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Floor plan data required');
    });
  });

  describe('GET /api/jobs/:urn/status', () => {
    test('should return job status', async () => {
      const response = await request(app)
        .get('/api/jobs/test_urn/status')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'success');
      expect(response.body).toHaveProperty('progress', '100%');
      expect(response.body).toHaveProperty('ready', true);
    });
  });
});
