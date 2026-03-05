/**
 * Generate Reference-Style Architectural Drawing
 * Creates PDF output matching your reference image exactly
 */

const exporter = require('./lib/costoExports');
const fs = require('fs');
const path = require('path');

async function generateReferenceDrawing() {
    
    // Sample floor plan data (replace with your actual DXF data)
    const floorPlan = {
        bounds: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
        walls: [
            { start: { x: 0, y: 0 }, end: { x: 50, y: 0 } },
            { start: { x: 50, y: 0 }, end: { x: 50, y: 30 } },
            { start: { x: 50, y: 30 }, end: { x: 0, y: 30 } },
            { start: { x: 0, y: 30 }, end: { x: 0, y: 0 } }
        ],
        rooms: [
            { number: 1, center: { x: 5, y: 5 } },
            { number: 2, center: { x: 15, y: 5 } },
            { number: 3, center: { x: 25, y: 5 } }
        ]
    };

    // Sample solution with storage boxes
    const solution = {
        boxes: [
            { 
                id: 1, x: 5, y: 10, width: 2.5, height: 2.0, 
                area: 5.0, type: 'S',
                partitions: { top: 'tole_grise', bottom: 'tole_grise', left: 'tole_blanche', right: 'tole_grise' }
            },
            { 
                id: 2, x: 8, y: 10, width: 3.0, height: 2.5, 
                area: 7.5, type: 'M',
                partitions: { top: 'tole_grise', bottom: 'tole_grise', left: 'tole_grise', right: 'tole_grise' }
            },
            { 
                id: 3, x: 12, y: 10, width: 4.0, height: 3.0, 
                area: 12.0, type: 'L',
                partitions: { top: 'tole_grise', bottom: 'tole_grise', left: 'tole_grise', right: 'tole_blanche' }
            }
        ],
        corridors: [
            { x: 5, y: 13, width: 15, height: 1.2 },
            { x: 10, y: 8, width: 1.2, height: 8 }
        ],
        radiators: [
            { 
                path: [
                    { x: 1, y: 1 }, { x: 1.5, y: 0.8 }, { x: 2, y: 1.2 }, 
                    { x: 2.5, y: 0.8 }, { x: 3, y: 1.2 }, { x: 3.5, y: 1 }
                ]
            }
        ],
        circulationPaths: [
            { path: [{ x: 5, y: 13.6 }, { x: 20, y: 13.6 }] }
        ]
    };

    const metrics = {
        totalArea: 24.5,
        totalBoxes: 3,
        yieldRatio: 0.85
    };

    // Reference export options (matches your image exactly)
    const options = {
        pageSize: 'A1',
        title: 'PLAN ETAGE 01 1-200',
        scale: '1:200',
        sheetNumber: '3',
        companyName: 'COSTO',
        companyAddress: '5 chemin de la dime 95700 Roissy FRANCE',
        showLegend: true,
        showTitleBlock: true,
        legendMode: 'reference',
        includeCompass: true,
        showDimensions: true,
        showUnitLabels: true,
        useRowZigzags: true,
        multiFloor: true,
        floorPlans: [floorPlan, floorPlan], // Two floors like your reference
        solutions: [solution, solution],
        floorLabels: ['PLAN ETAGE 01', 'PLAN ETAGE 02'],
        presetMode: 'strictReference' // Exact reference matching
    };

    try {
        console.log('Generating reference-style PDF...');
        
        // Generate the PDF
        const pdfBytes = await exporter.exportToReferencePDF(
            solution, 
            floorPlan, 
            metrics, 
            options
        );

        console.log('PDF bytes length:', pdfBytes ? pdfBytes.length : 'null');
        
        if (!pdfBytes || pdfBytes.length < 1000) {
            throw new Error('PDF generation failed - output too small');
        }

        // Save to output directory
        const outputPath = path.join(__dirname, 'output', 'reference-style-drawing.pdf');
        
        // Ensure output directory exists
        if (!fs.existsSync(path.dirname(outputPath))) {
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        }
        
        fs.writeFileSync(outputPath, pdfBytes);
        
        console.log(`✅ PDF generated: ${pdfBytes.length} bytes`);
        console.log(`📄 Output: ${outputPath}`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    }
}

// Run the generator
if (require.main === module) {
    generateReferenceDrawing();
}

module.exports = { generateReferenceDrawing };