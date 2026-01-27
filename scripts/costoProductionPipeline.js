/**
 * COSTO Production Pipeline - Complete End-to-End Processing
 * Processes Test2.dxf and generates professional output matching reference quality
 */

const fs = require('fs');
const path = require('path');
const DxfParser = require('dxf-parser');
const CostoAPI = require('../lib/costoAPI');
const CostoExports = require('../lib/costoExports');
const CostoNumbering = require('../lib/costoNumbering');
const CostoProjectManager = require('../lib/costoProjectManager');
const CostoBoxCatalog = require('../lib/costoBoxCatalog');

async function processTest2ToProduction() {
    console.log('='.repeat(80));
    console.log('COSTO V1 - Production Pipeline');
    console.log('Processing Test2.dxf to match reference quality');
    console.log('='.repeat(80));

    const test2Path = path.join(__dirname, '..', 'Samples', 'Test2.dxf');
    const outputDir = path.join(__dirname, '..', 'Samples', 'Output');
    
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Step 1: Process CAD file with COSTO layer standard
    console.log('\n[1/8] Processing CAD file with COSTO layer standard...');
    const floorPlan = await CostoAPI.processCADFile(test2Path);
    console.log(`   ✓ Processed: ${floorPlan.walls?.length || 0} walls, ${floorPlan.exits?.length || 0} exits`);
    console.log(`   ✓ Bounds: ${floorPlan.bounds.minX.toFixed(2)} to ${floorPlan.bounds.maxX.toFixed(2)} x ${floorPlan.bounds.minY.toFixed(2)} to ${floorPlan.bounds.maxY.toFixed(2)}`);

    // Step 2: Configure unit mix (based on reference)
    console.log('\n[2/8] Configuring unit mix...');
    const unitMix = {
        typologies: [
            { name: 'S', targetArea: 150, tolerance: 15, priority: 'obligatoire' },
            { name: 'M', targetArea: 200, tolerance: 20, priority: 'obligatoire' },
            { name: 'L', targetArea: 250, tolerance: 25, priority: 'souhaitable' },
            { name: 'XL', targetArea: 100, tolerance: 10, priority: 'souhaitable' }
        ]
    };
    console.log(`   ✓ Unit mix: ${unitMix.typologies.length} typologies`);

    // Step 3: Configure business rules
    console.log('\n[3/8] Configuring business rules...');
    const rules = {
        mainCorridorWidth: 1.5,
        secondaryCorridorWidth: 1.2,
        minClearance: 0.3,
        roundingArea: 0.5,
        roundingDimension: 0.1,
        maxDistanceToExit: 30.0,
        minClearanceFireDoor: 1.5
    };
    console.log(`   ✓ Rules configured`);

    // Step 4: Generate optimized layout
    console.log('\n[4/8] Generating optimized layout...');
    const startTime = Date.now();
    const result = CostoAPI.generateLayout(floorPlan, unitMix, rules, {
        method: 'hybrid',
        maxIterations: 150,
        populationSize: 75
    });
    const generationTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`   ✓ Generated ${result.solution.boxes.length} boxes in ${generationTime}s`);
    console.log(`   ✓ Score: ${result.metrics.totalScore.toFixed(3)}`);
    console.log(`   ✓ Compliance: ${(result.metrics.unitMixCompliance * 100).toFixed(1)}%`);
    console.log(`   ✓ Yield: ${(result.metrics.yieldRatio * 100).toFixed(1)}%`);

    // Step 5: Apply automatic numbering
    console.log('\n[5/8] Applying automatic numbering...');
    const numberedBoxes = CostoNumbering.applyNumbering(result.solution.boxes, {
        scheme: 'default',
        startZone: 1,
        startRow: 1,
        startNumber: 1
    });
    result.solution.boxes = numberedBoxes;
    const numberingStats = CostoNumbering.getStatistics(numberedBoxes);
    console.log(`   ✓ Numbered ${numberedBoxes.length} boxes`);
    console.log(`   ✓ Zones: ${numberingStats.zoneCount}, Rows: ${numberingStats.rowCount}`);

    // Step 6: Calculate surface areas by zone
    console.log('\n[6/8] Calculating surface areas...');
    const surfaceAreas = calculateSurfaceAreasByZone(numberedBoxes, floorPlan);
    console.log(`   ✓ Calculated areas for ${Object.keys(surfaceAreas).length} zones`);

    // Step 7: Generate professional PDF export
    console.log('\n[7/8] Generating professional PDF export...');
    const pdfBytes = await CostoExports.exportToPDF(
        result.solution,
        floorPlan,
        { ...result.metrics, surfaceAreas },
        {
            pageSize: 'A1',
            title: 'COSTO V1 - Plan Étage 01 & 02',
            scale: '1:200',
            showLegend: true,
            showTitleBlock: true,
            companyName: 'COSTO',
            companyAddress: '5 chemin de la dime 95700 Roissy FRANCE',
            includeCompass: true,
            includeAreaAnnotations: true,
            surfaceAreas: surfaceAreas
        }
    );
    const pdfPath = path.join(outputDir, 'Test2_Production.pdf');
    fs.writeFileSync(pdfPath, pdfBytes);
    console.log(`   ✓ PDF exported: ${pdfPath}`);

    // Step 8: Generate all other exports
    console.log('\n[8/8] Generating additional exports...');
    
    // DWG Export
    const dwgContent = CostoExports.exportToDWG(result.solution, floorPlan, {
        includeOriginal: true,
        separateLayers: true
    });
    const dwgPath = path.join(outputDir, 'Test2_Production.dxf');
    fs.writeFileSync(dwgPath, dwgContent);
    console.log(`   ✓ DWG exported: ${dwgPath}`);

    // Excel Export
    const excelBuffer = CostoExports.exportToExcel(
        result.solution,
        unitMix,
        result.deviation,
        {}
    );
    const excelPath = path.join(outputDir, 'Test2_Production.xlsx');
    fs.writeFileSync(excelPath, excelBuffer);
    console.log(`   ✓ Excel exported: ${excelPath}`);

    // Interactive SVG
    const svgContent = CostoExports.exportToInteractiveSVG(result.solution, floorPlan, {
        width: 2400,
        height: 1600,
        interactive: true,
        showGrid: true
    });
    const svgPath = path.join(outputDir, 'Test2_Production.svg');
    fs.writeFileSync(svgPath, svgContent);
    console.log(`   ✓ SVG exported: ${svgPath}`);

    // Report PDF
    const reportPdfBytes = await CostoExports.exportReportPDF(
        result.solution,
        result.metrics,
        result.compliance,
        result.deviation,
        {
            assumptions: [
                'Scale: 1:200',
                'Unit mix based on market requirements',
                'Circulation width: 1.5m main, 1.2m secondary',
                'Minimum clearance: 0.3m from walls',
                'Maximum distance to exit: 30m'
            ],
            version: '1.0'
        }
    );
    const reportPath = path.join(outputDir, 'Test2_Report.pdf');
    fs.writeFileSync(reportPath, reportPdfBytes);
    console.log(`   ✓ Report PDF exported: ${reportPath}`);

    // Save project
    const projectId = `test2_${Date.now()}`;
    CostoProjectManager.saveProject(projectId, {
        floorPlan,
        unitMix,
        rules,
        solution: result.solution,
        metrics: result.metrics,
        compliance: result.compliance,
        deviation: result.deviation,
        metadata: {
            name: 'Test2 Production Layout',
            description: 'Professional layout matching reference quality',
            dwgFile: test2Path
        },
        dwgReference: test2Path,
        exports: {
            pdf: pdfPath,
            dwg: dwgPath,
            excel: excelPath,
            svg: svgPath,
            report: reportPath
        }
    });
    console.log(`   ✓ Project saved: ${projectId}`);

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('PRODUCTION PIPELINE COMPLETE');
    console.log('='.repeat(80));
    console.log(`\nGenerated Layout:`);
    console.log(`  • Total Boxes: ${numberedBoxes.length}`);
    console.log(`  • Total Area: ${result.metrics.totalArea.toFixed(2)} m²`);
    console.log(`  • Usable Area: ${result.metrics.usableArea.toFixed(2)} m²`);
    console.log(`  • Yield: ${(result.metrics.yieldRatio * 100).toFixed(1)}%`);
    console.log(`  • Compliance: ${(result.metrics.unitMixCompliance * 100).toFixed(1)}%`);
    console.log(`  • Generation Time: ${generationTime}s`);
    console.log(`\nExports:`);
    console.log(`  • PDF: ${pdfPath}`);
    console.log(`  • DWG: ${dwgPath}`);
    console.log(`  • Excel: ${excelPath}`);
    console.log(`  • SVG: ${svgPath}`);
    console.log(`  • Report: ${reportPath}`);
    console.log(`\nProject ID: ${projectId}`);
    console.log('='.repeat(80));
}

function calculateSurfaceAreasByZone(boxes, floorPlan) {
    const zones = {};
    
    boxes.forEach(box => {
        const zone = box.zone || 'ZONE_1';
        if (!zones[zone]) {
            zones[zone] = {
                boxes: [],
                totalArea: 0,
                boxCount: 0
            };
        }
        const area = box.area || (box.width * box.height);
        zones[zone].boxes.push(box);
        zones[zone].totalArea += area;
        zones[zone].boxCount++;
    });

    // Calculate per-zone statistics
    Object.keys(zones).forEach(zone => {
        zones[zone].averageArea = zones[zone].totalArea / zones[zone].boxCount;
        zones[zone].minArea = Math.min(...zones[zone].boxes.map(b => b.area || b.width * b.height));
        zones[zone].maxArea = Math.max(...zones[zone].boxes.map(b => b.area || b.width * b.height));
    });

    return zones;
}

// Run if called directly
if (require.main === module) {
    processTest2ToProduction().catch(err => {
        console.error('Pipeline failed:', err);
        process.exit(1);
    });
}

module.exports = { processTest2ToProduction };
