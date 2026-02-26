/**
 * Generate Reference-Style Output for Visual Comparison
 * Creates PDF and DXF outputs that can be compared with reference image
 */

const fs = require('fs');
const path = require('path');
const ProfessionalCADProcessor = require('../lib/professionalCADProcessor');
const RadiatorGenerator = require('../lib/radiatorGenerator');
const COSTOLayoutPlacer = require('../lib/COSTOLayoutPlacer');
const CostoExports = require('../lib/costoExports');

console.log('═'.repeat(80));
console.log('GENERATING REFERENCE-STYLE OUTPUT');
console.log('═'.repeat(80));
console.log('');

async function generateOutput() {
    try {
        // Step 1: Process DXF
        console.log('📋 Step 1: Processing Test2.dxf...');
        const sampleDxfPath = path.join(__dirname, '../Samples/Test2.dxf');
        const processor = new ProfessionalCADProcessor();
        const floorPlan = await processor.processDXF(sampleDxfPath);
        console.log(`✓ Processed: ${floorPlan.walls.length} walls, ${floorPlan.rooms.length} rooms`);
        console.log('');

        // Step 2: Generate Radiators
        console.log('🔥 Step 2: Generating Radiators (Red Wavy Lines)...');
        const radiatorGen = new RadiatorGenerator(floorPlan, {
            waveAmplitude: 0.15,
            waveFrequency: 0.4,
            style: 'wavy'
        });
        const radiators = radiatorGen.generateRadiators();
        console.log(`✓ Generated ${radiators.length} radiator paths`);
        console.log('');

        // Step 3: Generate Storage Boxes
        console.log('📦 Step 3: Generating Storage Layout...');
        const placer = new COSTOLayoutPlacer(floorPlan, {
            boxDepth: 2.5,
            minBoxWidth: 1.5,
            maxBoxWidth: 4.5,
            corridorWidth: 1.2
        });
        
        const distribution = { '1-2': 0.25, '2-5': 0.40, '5-10': 0.25, '10-20': 0.10 };
        const boxes = placer.generateIlots(distribution, 50);
        const corridors = placer.getCorridors();
        console.log(`✓ Generated ${boxes.length} boxes, ${corridors.length} corridors`);
        console.log('');

        // Step 4: Build Solution
        const solution = {
            boxes: boxes,
            corridors: corridors,
            radiators: radiators
        };

        const metrics = {
            totalArea: boxes.reduce((sum, b) => sum + (b.area || b.width * b.height), 0),
            boxCount: boxes.length,
            corridorCount: corridors.length,
            radiatorCount: radiators.length
        };

        // Step 5: Export to PDF
        console.log('📑 Step 4: Exporting to PDF...');
        const pdfBytes = await CostoExports.exportToPDF(solution, floorPlan, metrics, {
            pageSize: 'A1',
            showLegend: true,
            showTitleBlock: true,
            includeRadiators: true,
            scale: '1:200',
            companyName: 'COSTO',
            companyAddress: '5 chemin de la dune 95700 Roissy FRANCE',
            pageNumber: 3,
            version: '1.0',
            floorLabel: 'PLAN ETAGE 01'
        });
        
        const pdfPath = path.join(__dirname, '../exports/REFERENCE_STYLE_OUTPUT.pdf');
        fs.writeFileSync(pdfPath, pdfBytes);
        console.log(`✓ PDF saved: ${pdfPath}`);
        console.log(`  Size: ${(pdfBytes.length / 1024).toFixed(2)} KB`);
        console.log('');

        // Step 6: Export to DXF
        console.log('📄 Step 5: Exporting to DXF...');
        const dxfContent = CostoExports.exportToDWG(solution, floorPlan, {
            includeOriginal: true,
            separateLayers: true
        });
        
        const dxfPath = path.join(__dirname, '../exports/REFERENCE_STYLE_OUTPUT.dxf');
        fs.writeFileSync(dxfPath, dxfContent, 'utf8');
        console.log(`✓ DXF saved: ${dxfPath}`);
        console.log(`  Size: ${(dxfContent.length / 1024).toFixed(2)} KB`);
        console.log('');

        // Step 7: Export to SVG
        console.log('🎨 Step 6: Exporting to SVG...');
        const svgContent = CostoExports.exportToInteractiveSVG(solution, floorPlan, {
            width: 2400,
            height: 1600,
            interactive: true,
            showGrid: false
        });
        
        const svgPath = path.join(__dirname, '../exports/REFERENCE_STYLE_OUTPUT.svg');
        fs.writeFileSync(svgPath, svgContent, 'utf8');
        console.log(`✓ SVG saved: ${svgPath}`);
        console.log(`  Size: ${(svgContent.length / 1024).toFixed(2)} KB`);
        console.log('');

        // Summary
        console.log('═'.repeat(80));
        console.log('✅ OUTPUT GENERATION COMPLETE');
        console.log('═'.repeat(80));
        console.log('');
        console.log('Generated Files:');
        console.log(`  📄 ${pdfPath}`);
        console.log(`  📄 ${dxfPath}`);
        console.log(`  📄 ${svgPath}`);
        console.log('');
        console.log('Content Summary:');
        console.log(`  • ${boxes.length} storage boxes`);
        console.log(`  • ${corridors.length} corridor segments`);
        console.log(`  • ${radiators.length} radiator paths (RED WAVY LINES)`);
        console.log(`  • ${floorPlan.walls.length} walls`);
        console.log(`  • Total box area: ${metrics.totalArea.toFixed(2)} m²`);
        console.log('');
        console.log('Visual Elements Included:');
        console.log('  ✓ Red wavy radiator lines (perimeter)');
        console.log('  ✓ Blue dashed corridor lines');
        console.log('  ✓ Tôle Blanche (gray) and Tôle Grise (blue) partitions');
        console.log('  ✓ Green page border');
        console.log('  ✓ Professional legend with all line types');
        console.log('  ✓ Title block with company info');
        console.log('');
        console.log('📂 Compare these files with:');
        console.log('   Samples/Ref. Output Samples/Expected output MUST.jpg');
        console.log('');
        console.log('═'.repeat(80));

        return 0;

    } catch (error) {
        console.error('');
        console.error('❌ ERROR:', error.message);
        console.error('Stack:', error.stack);
        console.error('');
        return 1;
    }
}

// Run
generateOutput()
    .then(exitCode => process.exit(exitCode))
    .catch(error => {
        console.error('Unhandled error:', error);
        process.exit(1);
    });
