/**
 * Process Test2.dwg - COSTO reference-style output
 * Full pipeline: CAD → raw plan complete → ilots (COSTO) → reference PDF export
 * Output matches expected format: Tôle Blanche, Tôle Grise, circulation lines, radiators, box labels
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');

const app = require('../server');

const INPUT_DWG = path.join(__dirname, '..', 'Samples', 'Files', 'Test2.dwg');
const INPUT_DXF = path.join(__dirname, '..', 'Samples', 'Files', 'Test2.dxf');
const OUTPUT_DIR = path.join(__dirname, '..', 'Samples', 'Test2_Output');

async function ensureOutputDir() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        console.log(`Created output directory: ${OUTPUT_DIR}`);
    }
}

function buildSolutionFromIlots(ilots, costoCorridors, costoRadiators, costoCirculationPaths) {
    const boxes = (ilots || []).map((ilot, idx) => {
        const area = ilot.area || (ilot.width * ilot.height) || 0;
        const unitSize = ilot.unitSize || ilot.label?.replace(/[^\d.]/g, '') || area.toFixed(2);
        return {
            id: ilot.id || `BOX_${idx + 1}`,
            x: ilot.x || 0,
            y: ilot.y || 0,
            width: ilot.width || 0,
            height: ilot.height || 0,
            area: area,
            unitSize: parseFloat(unitSize) || area,
            type: ilot.type || ilot.sizeCategory || 'M',
            zone: ilot.zone || '',
            row: ilot.row || 0
        };
    });
    const corridors = (costoCorridors || []).map(c => ({
        corners: c.polygon || c.corners || [],
        width: c.width || 1.2
    }));
    return {
        boxes,
        corridors,
        radiators: costoRadiators || [],
        circulationPaths: costoCirculationPaths || []
    };
}

async function run() {
    console.log('='.repeat(70));
    console.log('Processing Test2 - COSTO Reference-Style Output');
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

    // Step 1: Upload and process CAD
    console.log('\n[1/5] Processing CAD file...');
    const fileBuffer = fs.readFileSync(inputPath);
    const jobsRes = await request(app)
        .post('/api/jobs')
        .attach('file', fileBuffer, inputName)
        .expect((res) => {
            if (res.status !== 200) {
                throw new Error(`Jobs API returned ${res.status}: ${JSON.stringify(res.body)}`);
            }
            if (!res.body.success) {
                throw new Error(`Jobs failed: ${res.body.error || 'Unknown'}`);
            }
        });

    const cadData = jobsRes.body.cadData;
    if (!cadData || !cadData.walls || cadData.walls.length === 0) {
        throw new Error('No walls extracted from CAD. Check file format.');
    }

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

    // Step 2: Raw plan complete
    console.log('\n[2/5] Completing raw plan...');
    const completeRes = await request(app)
        .post('/api/raw-plan/complete')
        .send({ floorPlan, options: { validate: true } })
        .expect(200);

    if (completeRes.body.completedPlan) {
        floorPlan = completeRes.body.completedPlan;
        const filled = (completeRes.body.syntheticSegments || []).length;
        console.log(`   ✓ Filled ${filled} gap(s)`);
    } else {
        console.log('   ✓ No gaps to fill');
    }

    // Step 3: Generate ilots (COSTO style - returns corridors, radiators, circulation paths)
    console.log('\n[3/5] Generating ilots (COSTO layout)...');

    // Calculate target ilots from floor area: (usableArea × 0.65) / avgBoxArea for higher coverage
    const floorWidth = floorPlan.bounds.maxX - floorPlan.bounds.minX;
    const floorHeight = floorPlan.bounds.maxY - floorPlan.bounds.minY;
    const floorArea = floorWidth * floorHeight;
    const avgBoxArea = 3.5; // Use smaller avg for higher count
    const targetIlots = Math.max(50, Math.floor((floorArea * 0.65) / avgBoxArea));
    console.log(`   Floor area: ${floorArea.toFixed(1)} m², Target îlots: ${targetIlots}`);

    const ilotsRes = await request(app)
        .post('/api/ilots')
        .send({
            floorPlan,
            distribution: { '0-2': 25, '2-5': 35, '5-10': 30, '10-20': 10 },
            options: { totalIlots: targetIlots, corridorWidth: 1.0, seed: 42, style: 'COSTO' }
        })
        .expect(200);

    const ilots = ilotsRes.body.ilots || [];
    const costoCorridors = ilotsRes.body.costoCorridors || [];
    const costoRadiators = ilotsRes.body.costoRadiators || [];
    const costoCirculationPaths = ilotsRes.body.costoCirculationPaths || [];

    console.log(`   ✓ ${ilots.length} ilots, ${costoCorridors.length} corridors, ${costoRadiators.length} radiators`);

    // Step 4: Export COSTO reference PDF
    console.log('\n[4/5] Exporting reference-style PDF...');
    const solution = buildSolutionFromIlots(ilots, costoCorridors, costoRadiators, costoCirculationPaths);

    const exportRes = await request(app)
        .post('/api/costo/export/reference-pdf')
        .send({
            solution,
            floorPlan,
            metrics: {
                totalArea: ilotsRes.body.totalArea || 0,
                yieldRatio: 0.85,
                unitMixCompliance: 0.95,
                totalBoxes: ilots.length
            },
            options: {
                pageSize: 'A1',
                title: 'COSTO V1 - Plan Étage 01',
                scale: '1:200',
                showLegend: true,
                showTitleBlock: true,
                companyName: 'COSTO',
                companyAddress: '5 chemin de la dime 95700 Roissy FRANCE',
                includeCompass: true,
                legendMode: 'reference',
                showScaleInfo: true,
                showUnitLabels: true,
                showAreas: true
            }
        })
        .expect(200);

    const pdfFilename = exportRes.body.filename;
    const pdfServerPath = path.join(__dirname, '..', 'exports', pdfFilename);
    const pdfOutputPath = path.join(OUTPUT_DIR, 'Test2_layout.pdf');

    if (fs.existsSync(pdfServerPath)) {
        fs.copyFileSync(pdfServerPath, pdfOutputPath);
    } else {
        throw new Error(`PDF not saved at ${pdfServerPath}`);
    }
    console.log(`   ✓ Saved: ${path.basename(pdfOutputPath)}`);

    // Step 5: Save JSON files
    console.log('\n[5/5] Saving JSON...');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'floor_plan.json'), JSON.stringify({ walls: floorPlan.walls?.length, bounds: floorPlan.bounds, rooms: floorPlan.rooms?.length }, null, 2), 'utf8');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'ilots.json'), JSON.stringify(ilots, null, 2), 'utf8');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'solution.json'), JSON.stringify({
        ilots: ilots.length,
        corridors: costoCorridors.length,
        radiators: costoRadiators.length,
        circulationPaths: costoCirculationPaths.length,
        totalArea: ilotsRes.body.totalArea,
        generatedAt: new Date().toISOString()
    }, null, 2), 'utf8');
    console.log(`   ✓ Saved: floor_plan.json, ilots.json, solution.json`);

    console.log('\n' + '='.repeat(70));
    console.log('Done. Output:', OUTPUT_DIR);
    console.log('   Test2_layout.pdf - Reference-style (Tôle Blanche, circulation, radiators)');
    console.log('='.repeat(70));
}

run().catch(err => {
    console.error('Error:', err.message || err);
    process.exit(1);
});
