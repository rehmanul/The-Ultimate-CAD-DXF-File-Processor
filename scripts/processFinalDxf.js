/**
 * Process FINAL.dxf - The ACTUAL source file for Final.pdf
 * This should produce 100% visual match
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../server');

const INPUT_DXF = path.join(__dirname, '..', 'Samples', 'Final.dxf');
const OUTPUT_DIR = path.join(__dirname, '..', 'Samples', 'Final_Output');

async function ensureOutputDir() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
}

function buildSolutionFromIlots(ilots, costoCorridors, costoRadiators, costoCirculationPaths) {
    const boxes = (ilots || []).map((ilot, idx) => {
        const area = ilot.area || (ilot.width * ilot.height) || 0;
        return {
            id: ilot.id || `BOX_${idx + 1}`,
            x: ilot.x || 0,
            y: ilot.y || 0,
            width: ilot.width || 0,
            height: ilot.height || 0,
            area: area,
            unitSize: ilot.unitSize || area,
            type: ilot.type || 'M',
            zone: ilot.zone || '',
            row: ilot.row || 0,
            displayNumber: ilot.displayNumber || ilot.id,
            floor: ilot.floor || 1
        };
    });
    return {
        boxes,
        corridors: (costoCorridors || []).map(c => ({
            corners: c.polygon || c.corners || [],
            width: c.width || 1.2
        })),
        radiators: costoRadiators || [],
        circulationPaths: costoCirculationPaths || []
    };
}

async function run() {
    console.log('='.repeat(70));
    console.log('Processing FINAL.dxf - Source file for Final.pdf');
    console.log('TARGET: 100% Visual Match');
    console.log('='.repeat(70));

    if (!fs.existsSync(INPUT_DXF)) {
        throw new Error('Final.dxf not found in Samples folder');
    }

    const fileSizeMB = (fs.statSync(INPUT_DXF).size / 1024 / 1024).toFixed(2);
    console.log(`\nInput file: Final.dxf (${fileSizeMB} MB)`);
    
    await ensureOutputDir();

    // Step 1: Upload and process
    console.log('\n[1/5] Uploading and processing Final.dxf...');
    const fileBuffer = fs.readFileSync(INPUT_DXF);
    
    const startTime = Date.now();
    const jobsRes = await request(app)
        .post('/api/jobs')
        .attach('file', fileBuffer, 'Final.dxf');
    
    if (jobsRes.status !== 200 || !jobsRes.body.success) {
        throw new Error(`Upload failed: ${jobsRes.body.error || 'Unknown'}`);
    }
    
    const processTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   ✓ Processed in ${processTime}s`);
    
    const cadData = jobsRes.body.cadData;
    console.log(`   ✓ ${cadData.walls.length.toLocaleString()} walls`);
    console.log(`   ✓ ${cadData.rooms?.length || 0} rooms detected`);
    console.log(`   ✓ Bounds: ${JSON.stringify(cadData.bounds)}`);

    let floorPlan = {
        urn: cadData.urn || `final_${Date.now()}`,
        walls: cadData.walls,
        forbiddenZones: cadData.forbiddenZones || [],
        entrances: cadData.entrances || [],
        bounds: cadData.bounds,
        rooms: cadData.rooms || [],
        entities: cadData.entities || []
    };

    // Step 2: Complete raw plan
    console.log('\n[2/5] Completing raw plan...');
    const completeRes = await request(app)
        .post('/api/raw-plan/complete')
        .send({ floorPlan, options: { validate: true } });

    if (completeRes.body.completedPlan) {
        floorPlan = completeRes.body.completedPlan;
        console.log(`   ✓ Filled ${(completeRes.body.syntheticSegments || []).length} gaps`);
    }

    // Step 3: Generate ilots
    console.log('\n[3/5] Generating ilots...');
    const floorWidth = floorPlan.bounds.maxX - floorPlan.bounds.minX;
    const floorHeight = floorPlan.bounds.maxY - floorPlan.bounds.minY;
    const floorArea = floorWidth * floorHeight;
    const targetIlots = Math.floor(floorArea / 4); // ~4m² per box
    
    console.log(`   Floor area: ${floorArea.toFixed(0)} m²`);
    console.log(`   Target boxes: ~${targetIlots.toLocaleString()}`);

    const ilotsRes = await request(app)
        .post('/api/ilots')
        .send({
            floorPlan,
            distribution: { '0-2': 25, '2-5': 35, '5-10': 30, '10-20': 10 },
            options: { 
                totalIlots: targetIlots, 
                corridorWidth: 1.2, 
                seed: 42, 
                style: 'COSTO',
                floor: 1,
                floorStart: 1,
                startNumber: 1,
                strictMode: true,
                fillPlan: true
            }
        });

    const ilots = ilotsRes.body.ilots || [];
    const costoCorridors = ilotsRes.body.costoCorridors || [];
    const costoRadiators = ilotsRes.body.costoRadiators || [];
    
    console.log(`   ✓ ${ilots.length.toLocaleString()} boxes generated`);
    console.log(`   ✓ ${costoCorridors.length} corridors`);
    console.log(`   ✓ ${costoRadiators.length} radiators`);

    // Step 4: Export PDF
    console.log('\n[4/5] Exporting PDF (matching Final.pdf format)...');
    
    const solution = buildSolutionFromIlots(ilots, costoCorridors, costoRadiators, []);

    const exportRes = await request(app)
        .post('/api/costo/export/reference-pdf')
        .send({
            solution,
            floorPlan,
            metrics: {
                totalArea: ilotsRes.body.totalArea || 0,
                yieldRatio: 0.85,
                totalBoxes: ilots.length
            },
            options: {
                pageSize: 'A1',
                title: 'PLAN ETAGE 01 1-200',
                scale: '1:200',
                showLegend: true,
                showTitleBlock: true,
                drawingNumber: '[01]',
                sheetNumber: '3',
                documentId: '[01]',
                companyName: 'COSTO',
                companyAddress: '5 chemin de la dime 95700 Roissy FRANCE',
                includeCompass: true,
                legendMode: 'reference',
                showScaleInfo: true,
                showUnitLabels: true,
                showAreas: true,
                showBoxNumbers: true
            }
        });

    if (!exportRes.body.success) {
        throw new Error(`Export failed: ${exportRes.body.error}`);
    }

    const pdfFilename = exportRes.body.filename;
    const pdfServerPath = path.join(__dirname, '..', 'exports', pdfFilename);
    const pdfOutputPath = path.join(OUTPUT_DIR, 'Final_generated.pdf');

    fs.copyFileSync(pdfServerPath, pdfOutputPath);
    console.log(`   ✓ Saved: Final_generated.pdf`);

    // Step 5: Save data
    console.log('\n[5/5] Saving data files...');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'ilots.json'), 
        JSON.stringify({ count: ilots.length, sample: ilots.slice(0, 5) }, null, 2));
    fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify({
        inputFile: 'Final.dxf',
        fileSizeMB: fileSizeMB,
        walls: cadData.walls.length,
        rooms: cadData.rooms?.length || 0,
        boxes: ilots.length,
        corridors: costoCorridors.length,
        radiators: costoRadiators.length,
        totalArea: ilotsRes.body.totalArea,
        generatedAt: new Date().toISOString()
    }, null, 2));

    console.log('\n' + '='.repeat(70));
    console.log('✓ COMPLETE - Output:', OUTPUT_DIR);
    console.log('='.repeat(70));
    console.log(`\nGenerated files:`);
    console.log(`  - Final_generated.pdf (should match Final.pdf)`);
    console.log(`  - summary.json`);
    console.log(`  - ilots.json`);
}

run().catch(err => {
    console.error('\nERROR:', err.message);
    process.exit(1);
});
