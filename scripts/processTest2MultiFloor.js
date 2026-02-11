/**
 * Process Test2.dxf with MULTI-FLOOR output (matching Final.pdf)
 * Generates 2 floors: Étage 01 and Étage 02
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../server');

const INPUT_DWG = path.join(__dirname, '..', 'Samples', 'Test2.dwg');
const INPUT_DXF = path.join(__dirname, '..', 'Samples', 'Test2.dxf');
const OUTPUT_DIR = path.join(__dirname, '..', 'Samples', 'Test2_Output_MultiFloor');

async function ensureOutputDir() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
}

function buildSolutionFromIlots(ilots, costoCorridors, costoRadiators) {
    return {
        boxes: (ilots || []).map(ilot => ({
            id: ilot.id,
            x: ilot.x || 0,
            y: ilot.y || 0,
            width: ilot.width || 0,
            height: ilot.height || 0,
            area: ilot.area || (ilot.width * ilot.height) || 0,
            unitSize: ilot.unitSize || ilot.area || 0,
            displayNumber: ilot.displayNumber || ilot.id,
            floor: ilot.floor || 1
        })),
        corridors: (costoCorridors || []).map(c => ({
            corners: c.polygon || c.corners || [],
            width: c.width || 1.2
        })),
        radiators: costoRadiators || [],
        circulationPaths: []
    };
}

async function generateFloor(floorPlan, floorNumber, startNumber) {
    console.log(`\n   Generating Floor ${floorNumber}...`);
    
    const floorWidth = floorPlan.bounds.maxX - floorPlan.bounds.minX;
    const floorHeight = floorPlan.bounds.maxY - floorPlan.bounds.minY;
    const floorArea = floorWidth * floorHeight;
    const targetIlots = Math.max(50, Math.floor((floorArea * 0.65) / 3.5));

    const ilotsRes = await request(app)
        .post('/api/ilots')
        .send({
            floorPlan,
            distribution: { '0-2': 25, '2-5': 35, '5-10': 30, '10-20': 10 },
            options: { 
                totalIlots: targetIlots, 
                corridorWidth: 1.0, 
                seed: 42 + floorNumber, // Different seed per floor
                style: 'COSTO',
                floor: floorNumber,
                floorStart: 1,
                startNumber: startNumber
            }
        });

    return {
        ilots: ilotsRes.body.ilots || [],
        corridors: ilotsRes.body.costoCorridors || [],
        radiators: ilotsRes.body.costoRadiators || [],
        totalArea: ilotsRes.body.totalArea || 0
    };
}

async function run() {
    console.log('='.repeat(70));
    console.log('Processing Test2 - MULTI-FLOOR Output (2 Floors)');
    console.log('TARGET: Match Final.pdf style with 2 floors');
    console.log('='.repeat(70));

    let inputPath = INPUT_DWG;
    let inputName = 'Test2.dwg';
    if (!fs.existsSync(INPUT_DWG)) {
        if (fs.existsSync(path.join(__dirname, '..', 'Samples', 'Test2.dwg'))) {
            inputPath = path.join(__dirname, '..', 'Samples', 'Test2.dwg');
        } else if (fs.existsSync(INPUT_DXF)) {
            inputPath = INPUT_DXF;
            inputName = 'Test2.dxf';
        } else if (fs.existsSync(path.join(__dirname, '..', 'Samples', 'Test2.dxf'))) {
            inputPath = path.join(__dirname, '..', 'Samples', 'Test2.dxf');
            inputName = 'Test2.dxf';
        } else {
            throw new Error(`Test2.dwg/dxf not found in Samples`);
        }
    }

    await ensureOutputDir();

    // Step 1: Upload and process CAD (once)
    console.log('\n[1/4] Processing CAD file...');
    const fileBuffer = fs.readFileSync(inputPath);
    const jobsRes = await request(app)
        .post('/api/jobs')
        .attach('file', fileBuffer, inputName);

    if (jobsRes.status !== 200 || !jobsRes.body.success) {
        throw new Error(`Jobs API failed: ${jobsRes.body.error || 'Unknown'}`);
    }

    const cadData = jobsRes.body.cadData;
    let floorPlan = {
        urn: cadData.urn || `test2_${Date.now()}`,
        walls: cadData.walls || [],
        forbiddenZones: cadData.forbiddenZones || [],
        entrances: cadData.entrances || [],
        bounds: cadData.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        rooms: cadData.rooms || [],
        entities: cadData.entities || []
    };

    console.log(`   ✓ ${floorPlan.walls.length} walls, ${floorPlan.forbiddenZones?.length || 0} forbidden, ${floorPlan.entrances?.length || 0} entrances`);

    // Step 2: Complete raw plan (once)
    console.log('\n[2/4] Completing raw plan...');
    const completeRes = await request(app)
        .post('/api/raw-plan/complete')
        .send({ floorPlan, options: { validate: true } });

    if (completeRes.body.completedPlan) {
        floorPlan = completeRes.body.completedPlan;
        console.log(`   ✓ Filled ${(completeRes.body.syntheticSegments || []).length} gap(s)`);
    }

    // Step 3: Generate BOTH floors
    console.log('\n[3/4] Generating both floors...');
    
    // Floor 1: Étage 01 (boxes 101-199)
    const floor1 = await generateFloor(floorPlan, 1, 1);
    console.log(`   ✓ Floor 1: ${floor1.ilots.length} boxes (101-${100 + floor1.ilots.length})`);

    // Floor 2: Étage 02 (boxes 201-299) - slight variation
    const floor2 = await generateFloor(floorPlan, 2, 1);
    console.log(`   ✓ Floor 2: ${floor2.ilots.length} boxes (201-${200 + floor2.ilots.length})`);

    // Step 4: Export MULTI-FLOOR PDF
    console.log('\n[4/4] Exporting multi-floor PDF...');
    
    const solution1 = buildSolutionFromIlots(floor1.ilots, floor1.corridors, floor1.radiators);
    const solution2 = buildSolutionFromIlots(floor2.ilots, floor2.corridors, floor2.radiators);

    const exportRes = await request(app)
        .post('/api/costo/export/reference-pdf')
        .send({
            solution: solution1, // Primary solution
            floorPlan: floorPlan,
            metrics: {
                totalArea: floor1.totalArea + floor2.totalArea,
                yieldRatio: 0.85,
                totalBoxes: floor1.ilots.length + floor2.ilots.length
            },
            options: {
                pageSize: 'A1',
                title: 'PLAN ETAGE 01 ET 02',
                scale: '1:200',
                showLegend: true,
                showTitleBlock: true,
                drawingNumber: '[01]',
                sheetNumber: '3',
                companyName: 'COSTO',
                companyAddress: '5 chemin de la dime 95700 Roissy FRANCE',
                includeCompass: true,
                legendMode: 'reference',
                showScaleInfo: true,
                showUnitLabels: true,
                showAreas: true,
                showBoxNumbers: true,
                // MULTI-FLOOR OPTIONS:
                multiFloor: true,
                floorPlans: [floorPlan, floorPlan],
                solutions: [solution1, solution2],
                floorLabels: ['PLAN ETAGE 01', 'PLAN ETAGE 02']
            }
        });

    if (exportRes.status !== 200 || !exportRes.body.success) {
        throw new Error(`Export failed: ${exportRes.body.error || 'Unknown'}`);
    }

    const pdfFilename = exportRes.body.filename;
    const pdfServerPath = path.join(__dirname, '..', 'exports', pdfFilename);
    const pdfOutputPath = path.join(OUTPUT_DIR, 'Test2_MultiFloor.pdf');

    fs.copyFileSync(pdfServerPath, pdfOutputPath);
    console.log(`   ✓ Saved: ${path.basename(pdfOutputPath)}`);

    // Save summary
    fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify({
        inputFile: inputName,
        floor1: { boxes: floor1.ilots.length, area: floor1.totalArea },
        floor2: { boxes: floor2.ilots.length, area: floor2.totalArea },
        totalBoxes: floor1.ilots.length + floor2.ilots.length,
        generatedAt: new Date().toISOString()
    }, null, 2));

    console.log('\n' + '='.repeat(70));
    console.log('Done! Multi-floor output:', OUTPUT_DIR);
    console.log('   Test2_MultiFloor.pdf - 2 floors like Final.pdf');
    console.log('='.repeat(70));
}

run().catch(err => {
    console.error('Error:', err.message || err);
    process.exit(1);
});
