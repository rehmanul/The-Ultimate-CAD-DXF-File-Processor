/**
 * Test script to verify reference output matching (Image 1)
 * Tests corridor generation, radiator generation, and PDF export
 */

const fs = require('fs');
const path = require('path');
const CostoCompletePipeline = require('../lib/costoCompletePipeline');

// Mock floor plan data (simplified for testing)
const mockFloorPlan = {
    bounds: {
        minX: 0,
        minY: 0,
        maxX: 50,
        maxY: 40
    },
    walls: [
        // Perimeter walls
        { start: { x: 0, y: 0 }, end: { x: 50, y: 0 } },      // Bottom
        { start: { x: 50, y: 0 }, end: { x: 50, y: 40 } },    // Right
        { start: { x: 50, y: 40 }, end: { x: 0, y: 40 } },    // Top
        { start: { x: 0, y: 40 }, end: { x: 0, y: 0 } },      // Left
        // Internal walls
        { start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
        { start: { x: 40, y: 30 }, end: { x: 40, y: 40 } }
    ],
    exits: [
        { start: { x: 20, y: 0 }, end: { x: 22, y: 0 } }
    ],
    forbiddenZones: []
};

// Mock storage boxes (îlots) in a grid pattern
const mockBoxes = [];
const boxWidth = 3;
const boxHeight = 2.5;
const spacing = 1.5;

// Create 3 rows of 5 boxes each
for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
        mockBoxes.push({
            id: `BOX_${row}_${col}`,
            x: 5 + col * (boxWidth + spacing),
            y: 5 + row * (boxHeight + spacing),
            width: boxWidth,
            height: boxHeight,
            area: boxWidth * boxHeight,
            type: 'M',
            sizeCategory: 'M',
            capacity: 7.5
        });
    }
}

async function testPipeline() {
    console.log('=== Testing COSTO Complete Pipeline ===\n');

    try {
        // Initialize pipeline
        const pipeline = new CostoCompletePipeline({
            corridorWidth: 1.2,
            useAdvancedCorridors: true,
            generateRadiators: true
        });

        // Process complete solution
        console.log('Processing complete solution...');
        const solution = await pipeline.processComplete(mockFloorPlan, mockBoxes, {
            metadata: {
                projectName: 'Test Reference Output',
                versionId: 'TEST_001'
            }
        });

        // Display results
        console.log('\n=== Results ===');
        console.log(`Boxes: ${solution.boxes.length}`);
        console.log(`Corridors: ${solution.corridors.length}`);
        console.log(`Radiators: ${solution.radiators.length}`);
        console.log('\nMetrics:');
        console.log(`  Total Box Area: ${solution.metrics.totalBoxArea.toFixed(2)} m²`);
        console.log(`  Total Corridor Area: ${solution.metrics.totalCorridorArea.toFixed(2)} m²`);
        console.log(`  Total Radiator Length: ${solution.metrics.totalRadiatorLength.toFixed(2)} m`);
        console.log(`  Yield Ratio: ${(solution.metrics.yieldRatio * 100).toFixed(1)}%`);
        console.log(`  Circulation Ratio: ${(solution.metrics.circulationRatio * 100).toFixed(1)}%`);

        // Test corridor structure
        console.log('\n=== Corridor Details ===');
        solution.corridors.slice(0, 3).forEach((corridor, i) => {
            console.log(`Corridor ${i + 1}:`);
            console.log(`  ID: ${corridor.id}`);
            console.log(`  Type: ${corridor.type}`);
            console.log(`  Dimensions: ${corridor.width.toFixed(2)}m x ${corridor.height.toFixed(2)}m`);
            console.log(`  Corners: ${corridor.corners ? corridor.corners.length : 0} points`);
        });

        // Test radiator structure
        console.log('\n=== Radiator Details ===');
        solution.radiators.slice(0, 2).forEach((radiator, i) => {
            console.log(`Radiator ${i + 1}:`);
            console.log(`  ID: ${radiator.id}`);
            console.log(`  Path points: ${radiator.path.length}`);
            console.log(`  Length: ${radiator.length.toFixed(2)}m`);
        });

        // Export to PDF
        console.log('\n=== Exporting to PDF ===');
        const pdfBytes = await pipeline.exportToPDF(solution, mockFloorPlan, {
            title: 'Test Reference Output - COSTO V1',
            scale: '1:100',
            pageNumber: 1
        });

        // Save PDF
        const outputDir = path.join(__dirname, '..', 'exports');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const pdfPath = path.join(outputDir, 'test_reference_output.pdf');
        fs.writeFileSync(pdfPath, pdfBytes);
        console.log(`PDF saved to: ${pdfPath}`);

        // Export to DXF
        console.log('\n=== Exporting to DXF ===');
        const dxfContent = pipeline.exportToDXF(solution, mockFloorPlan);
        const dxfPath = path.join(outputDir, 'test_reference_output.dxf');
        fs.writeFileSync(dxfPath, dxfContent);
        console.log(`DXF saved to: ${dxfPath}`);

        // Export to SVG
        console.log('\n=== Exporting to SVG ===');
        const svgContent = pipeline.exportToSVG(solution, mockFloorPlan);
        const svgPath = path.join(outputDir, 'test_reference_output.svg');
        fs.writeFileSync(svgPath, svgContent);
        console.log(`SVG saved to: ${svgPath}`);

        console.log('\n=== Test Complete ===');
        console.log('✓ All exports generated successfully');
        console.log('✓ Check the exports folder for output files');

    } catch (error) {
        console.error('\n=== Test Failed ===');
        console.error('Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run test
testPipeline();
