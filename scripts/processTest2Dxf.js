/**
 * Process Test2.dxf - Dedicated script for COSTO reference-style output.
 * Produces the same styled sheet as Final.pdf (border, legend, title block) for Test2.dxf.
 * Output: Samples/Test2_Output/Test2_layout_from_dxf.pdf + JSON summaries.
 *
 * Plan 7.1 Golden-file: After running, visually compare Test2_layout_from_dxf.pdf with
 * Reference Output Examples/Expected output MUST.jpg (bays near units 235/253/238/237/258,
 * junctions at doors/staircase, wall gaps and outlines).
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../server');

const INPUT_DXF = path.join(__dirname, '..', 'Samples', 'Test2.dxf');
const OUTPUT_DIR = path.join(__dirname, '..', 'Samples', 'Test2_Output');

function resolveInputDxf() {
    if (fs.existsSync(INPUT_DXF)) return INPUT_DXF;
    const alt = path.join(__dirname, '..', 'Samples', 'Test2.dxf');
    if (fs.existsSync(alt)) return alt;
    throw new Error(`Test2.dxf not found. Expected: ${INPUT_DXF}`);
}

async function ensureOutputDir() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
}

function buildSolutionFromIlots(ilots, costoCorridors, costoRadiators, costoCirculationPaths, costoJunctions) {
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
            x: c.x,
            y: c.y,
            width: c.width ?? 1.2,
            height: c.height ?? 1.2,
            direction: c.direction,
            corners: c.polygon || c.corners || [],
            width: c.width || 1.2
        })),
        radiators: costoRadiators || [],
        circulationPaths: costoCirculationPaths || [],
        junctions: Array.isArray(costoJunctions) ? costoJunctions : []
    };
}

async function run() {
    console.log('='.repeat(70));
    console.log('Processing Test2.dxf - COSTO reference-style output');
    console.log('TARGET: Same styled sheet as Final.pdf (UI + Export)');
    console.log('='.repeat(70));

    const inputDxf = resolveInputDxf();
    const fileSizeMB = (fs.statSync(inputDxf).size / 1024 / 1024).toFixed(2);
    console.log(`\nInput file: ${path.basename(inputDxf)} (${fileSizeMB} MB)`);

    await ensureOutputDir();

    // Step 1: Upload and process
    console.log('\n[1/5] Uploading and processing Test2.dxf...');
    const fileBuffer = fs.readFileSync(inputDxf);
    const startTime = Date.now();
    const jobsRes = await request(app)
        .post('/api/jobs')
        .attach('file', fileBuffer, 'Test2.dxf');

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
        urn: cadData.urn || `test2_${Date.now()}`,
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

    // Step 3: Generate ilots (COSTO style – row-based so boxes fill the entire plan like reference)
    console.log('\n[3/5] Generating ilots...');
    const floorWidth = floorPlan.bounds.maxX - floorPlan.bounds.minX;
    const floorHeight = floorPlan.bounds.maxY - floorPlan.bounds.minY;
    const floorArea = floorWidth * floorHeight;
    const targetIlots = Math.max(360, Math.min(500, Math.floor((floorArea * 0.65) / 3.5)));

    console.log(`   Floor area: ${floorArea.toFixed(1)} m², Target boxes: ~${targetIlots} (row-based fill)`); 

    const ilotsRes = await request(app)
        .post('/api/ilots')
        .send({
            floorPlan,
            distribution: { '0-2': 25, '2-5': 35, '5-10': 30, '10-20': 10 },
            options: {
                totalIlots: targetIlots,
                corridorWidth: 1.2,
                wallClearance: 0.06,
                wallClearanceMm: 60,
                boxSpacing: 0.02,
                rowGapClearance: 0.04,
                corridorGapClearance: 0.02,
                corridorInset: 0.02,
                minGapLength: 0.45,
                seed: 42,
                style: 'COSTO',
                layoutMode: 'rowBased',
                floor: 1,
                floorStart: 1,
                startNumber: 1,
                strictMode: true,
                fillPlan: true,
                maximizeFill: true
            }
        });

    const ilots = ilotsRes.body.ilots || [];
    const costoCorridors = ilotsRes.body.costoCorridors || [];
    const costoRadiators = ilotsRes.body.costoRadiators || [];
    const costoCirculationPaths = ilotsRes.body.costoCirculationPaths || [];
    const costoJunctions = ilotsRes.body.costoJunctions || [];

    console.log(`   ✓ ${ilots.length.toLocaleString()} boxes, ${costoCorridors.length} corridors, ${costoRadiators.length} radiators, ${(costoJunctions || []).length} junctions`);

    // Step 4: Export reference-style PDF (same style as Final.pdf)
    console.log('\n[4/5] Exporting reference-style PDF...');

    const solution = buildSolutionFromIlots(ilots, costoCorridors, costoRadiators, costoCirculationPaths, costoJunctions);

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
                showCorridorPathways: true,
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
                layoutMode: 'rowBased',
                showScaleInfo: true,
                orientation: 'landscape',
                fitFactor: 0.99,
                showDimensions: true,
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
    const pdfOutputPath = path.join(OUTPUT_DIR, 'Test2_layout_from_dxf.pdf');

    fs.copyFileSync(pdfServerPath, pdfOutputPath);
    console.log(`   ✓ Saved: Test2_layout_from_dxf.pdf`);

    // Step 5: Save JSON summaries
    console.log('\n[5/5] Saving JSON summaries...');
    fs.writeFileSync(
        path.join(OUTPUT_DIR, 'ilots.json'),
        JSON.stringify({ count: ilots.length, sample: ilots.slice(0, 5) }, null, 2)
    );
    fs.writeFileSync(
        path.join(OUTPUT_DIR, 'summary.json'),
        JSON.stringify({
            inputFile: 'Test2.dxf',
            fileSizeMB,
            walls: cadData.walls.length,
            rooms: cadData.rooms?.length || 0,
            boxes: ilots.length,
            corridors: costoCorridors.length,
            radiators: costoRadiators.length,
            circulationPaths: costoCirculationPaths.length,
            totalArea: ilotsRes.body.totalArea,
            generatedAt: new Date().toISOString()
        }, null, 2)
    );
    // Save full corridor list (with x, y, width, height) for connection analysis
    fs.writeFileSync(
        path.join(OUTPUT_DIR, 'corridors.json'),
        JSON.stringify({ bounds: floorPlan.bounds, corridors: costoCorridors }, null, 2)
    );

    console.log('\n' + '='.repeat(70));
    console.log('✓ COMPLETE - Output:', OUTPUT_DIR);
    console.log('='.repeat(70));
    console.log('\nGenerated files:');
    console.log('  - Test2_layout_from_dxf.pdf (COSTO reference style)');
    console.log('  - summary.json');
    console.log('  - ilots.json');
    console.log('  - corridors.json (run: node scripts/showCorridorConnections.js)');
}

run().catch((err) => {
    console.error('\nERROR:', err.message);
    process.exit(1);
});
