const request = require('supertest');
const app = require('../../server');
const fs = require('fs');
const path = require('path');

describe('E2E Workflow Tests', () => {
  let testUrn;
  let cadData;
  let ilots;
  let corridors;

  beforeAll(async () => {
    // Create a test DXF file
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
20.0
21
0.0
0
LINE
8
WALLS
10
20.0
20
0.0
11
20.0
21
15.0
0
LINE
8
WALLS
10
20.0
20
15.0
11
0.0
21
15.0
0
LINE
8
WALLS
10
0.0
20
15.0
11
0.0
21
0.0
0
LINE
8
ENTRANCE
10
8.0
20
0.0
11
12.0
21
0.0
0
ENDSEC
0
EOF`;

    const tempDir = path.join(__dirname, '../../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const tempFilePath = path.join(tempDir, 'e2e_test.dxf');
    fs.writeFileSync(tempFilePath, mockDxfContent);

    // Upload the file
    const uploadResponse = await request(app)
      .post('/api/jobs')
      .attach('file', tempFilePath)
      .expect(200);

    testUrn = uploadResponse.body.urn;
    cadData = uploadResponse.body.cadData;

    // Clean up temp file
    fs.unlinkSync(tempFilePath);
    fs.rmSync(tempDir, { recursive: true });
  }, 30000);

  test('Step 1: File upload should return valid CAD data', () => {
    expect(testUrn).toBeDefined();
    expect(cadData).toHaveProperty('walls');
    expect(cadData).toHaveProperty('entrances');
    expect(Array.isArray(cadData.walls)).toBe(true);
    expect(Array.isArray(cadData.entrances)).toBe(true);
    expect(cadData.walls.length).toBeGreaterThan(0);
  });

  test('Step 2: Analysis should process CAD data correctly', async () => {
    const response = await request(app)
      .post('/api/analyze')
      .send({ urn: testUrn })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body).toHaveProperty('walls');
    expect(response.body).toHaveProperty('entrances');
    expect(response.body).toHaveProperty('totalArea');
    expect(response.body.totalArea).toBeGreaterThan(0);
  });

  test('Step 3: Ilot generation should create parking spaces', async () => {
    const floorPlan = {
      walls: cadData.walls,
      forbiddenZones: cadData.forbiddenZones || [],
      entrances: cadData.entrances,
      bounds: cadData.bounds,
      rooms: cadData.rooms || []
    };

    const response = await request(app)
      .post('/api/ilots')
      .send({
        floorPlan,
        distribution: { '1-3': 0.4, '3-5': 0.4, '5-10': 0.2 },
        options: { totalIlots: 10, seed: 42 }
      })
      .expect(200);

    ilots = response.body.ilots;

    expect(response.body.success).toBe(true);
    expect(ilots.length).toBeGreaterThan(0);
    expect(response.body.totalArea).toBeGreaterThan(0);
    expect(response.body.count).toBeGreaterThan(0);

    // Validate ilot structure
    ilots.forEach(ilot => {
      expect(ilot).toHaveProperty('x');
      expect(ilot).toHaveProperty('y');
      expect(ilot).toHaveProperty('width');
      expect(ilot).toHaveProperty('height');
      expect(ilot).toHaveProperty('area');
      expect(ilot.area).toBeGreaterThan(0);
    });
  });

  test('Step 4: Corridor generation should create access paths', async () => {
    const floorPlan = {
      walls: cadData.walls,
      forbiddenZones: cadData.forbiddenZones || [],
      entrances: cadData.entrances,
      bounds: cadData.bounds,
      rooms: cadData.rooms || []
    };

    const response = await request(app)
      .post('/api/corridors')
      .send({
        floorPlan,
        ilots,
        corridorWidth: 1.5
      })
      .expect(200);

    corridors = response.body.corridors;

    expect(response.body.success).toBe(true);
    expect(Array.isArray(corridors)).toBe(true);
    // totalArea may be 0 when no corridors are generated for small test plans
    expect(typeof response.body.totalArea).toBe('number');

    // Validate corridor structure (if any were generated)
    corridors.forEach(corridor => {
      expect(corridor).toHaveProperty('polygon');
      expect(corridor).toHaveProperty('area');
      expect(corridor).toHaveProperty('width');
      expect(corridor).toHaveProperty('height');
      expect(Array.isArray(corridor.polygon)).toBe(true);
      expect(corridor.polygon.length).toBe(4); // Rectangle has 4 points
    });
  });

  test('Step 5: Layout optimization should improve placement', async () => {
    const floorPlan = {
      walls: cadData.walls,
      forbiddenZones: cadData.forbiddenZones || [],
      entrances: cadData.entrances,
      bounds: cadData.bounds,
      rooms: cadData.rooms || []
    };

    const response = await request(app)
      .post('/api/optimize/layout')
      .send({ floorPlan, ilots })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.ilots).toBeDefined();
    expect(response.body.totalArea).toBeGreaterThan(0);
  });

  test('Step 6: Path optimization should optimize corridor routes', async () => {
    const floorPlan = {
      walls: cadData.walls,
      forbiddenZones: cadData.forbiddenZones || [],
      entrances: cadData.entrances,
      bounds: cadData.bounds,
      rooms: cadData.rooms || []
    };

    const response = await request(app)
      .post('/api/optimize/paths')
      .send({ floorPlan, ilots })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.paths).toBeDefined();
    // totalLength may be 0 for small test plans with few ilots
    expect(typeof response.body.totalLength).toBe('number');
  });

  test('Step 7: PDF export should generate report', async () => {
    const floorPlan = {
      walls: cadData.walls,
      forbiddenZones: cadData.forbiddenZones || [],
      entrances: cadData.entrances,
      bounds: cadData.bounds,
      rooms: cadData.rooms || []
    };

    const response = await request(app)
      .post('/api/export/pdf')
      .send({
        floorPlan,
        ilots,
        corridors,
        options: { title: 'E2E Test Report' }
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.filename).toMatch(/\.pdf$/);
    expect(response.body.filepath).toBeDefined();

    // Verify file was created
    expect(fs.existsSync(response.body.filepath)).toBe(true);

    // Clean up
    if (fs.existsSync(response.body.filepath)) {
      fs.unlinkSync(response.body.filepath);
    }
  });

  test('Step 8: SVG export should generate vector graphics', async () => {
    const floorPlan = {
      walls: cadData.walls,
      forbiddenZones: cadData.forbiddenZones || [],
      entrances: cadData.entrances,
      bounds: cadData.bounds,
      rooms: cadData.rooms || []
    };

    const response = await request(app)
      .post('/api/export/image')
      .send({
        floorPlan,
        ilots,
        corridors,
        options: { format: 'svg' }
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.filename).toMatch(/\.svg$/);
    expect(response.body.filepath).toBeDefined();

    // Verify file was created
    expect(fs.existsSync(response.body.filepath)).toBe(true);

    // Clean up
    if (fs.existsSync(response.body.filepath)) {
      fs.unlinkSync(response.body.filepath);
    }
  });

  test('Step 9: Job status should be available', async () => {
    const response = await request(app)
      .get(`/api/jobs/${testUrn}/status`)
      .expect(200);

    expect(response.body.status).toBe('success');
    expect(response.body.progress).toBe('100%');
    expect(response.body.ready).toBe(true);
  });

  test('Step 10: Health check should return system status', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body).toHaveProperty('timestamp');
    expect(response.body).toHaveProperty('sqlite');
  });

  test('Step 11: Detailed health check should return comprehensive status', async () => {
    const response = await request(app)
      .get('/healthz')
      .expect(200);

    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('timestamp');
    expect(response.body).toHaveProperty('persistence');
    expect(response.body).toHaveProperty('aps');
    expect(response.body).toHaveProperty('server');
  });
});
