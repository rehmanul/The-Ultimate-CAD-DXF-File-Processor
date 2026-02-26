/**
 * generate_pdf.js
 * ===============
 * Professional PDF generator for COSTO layouts.
 * Reads a layout JSON (from professional_pipeline.py) and generates
 * a reference-quality PDF matching the PLAN ETAGE 01/02 architectural style.
 *
 * Usage:
 *   node generate_pdf.js [layout.json] [output.pdf]
 *
 * Or import as module:
 *   const gen = require('./generate_pdf');
 *   await gen.generatePDF(layoutData, 'output.pdf', options);
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const CostoExports = require('./lib/costoExports');

// ─── CLI entry ────────────────────────────────────────────────────────────────
if (require.main === module) {
    const [,, jsonPath, outPath] = process.argv;
    const src  = jsonPath || 'output/costo_output.json';
    const dest = outPath  || src.replace(/\.json$/, '.pdf');

    if (!fs.existsSync(src)) {
        console.error(`[PDF] File not found: ${src}`);
        process.exit(1);
    }

    const layout = JSON.parse(fs.readFileSync(src, 'utf8'));
    generatePDF(layout, dest)
        .then(() => console.log(`[PDF] Saved: ${dest}`))
        .catch(err => { console.error('[PDF] Error:', err.message); process.exit(1); });
}

// ─── Main export ──────────────────────────────────────────────────────────────
async function generatePDF(layoutData, outputPath, options = {}) {
    const { floorPlan, solution, metrics } = layoutData;

    const opts = {
        // Page layout
        pageSize:         options.pageSize      || 'A1',
        orientation:      options.orientation   || 'auto',
        fitFactor:        options.fitFactor     || 0.97,

        // Title block
        title:            options.title         || 'PLAN ETAGE 01  1-200',
        companyName:      options.companyName   || 'COSTO',
        companyAddress:   options.companyAddress || '5 chemin de la dime 95700\nRoissy FRANCE',
        scale:            options.scale         || '1:200',
        sheetNumber:      options.sheetNumber   || '3',
        drawingNumber:    options.drawingNumber || '',
        documentId:       options.documentId    || 'D.costo2023.CFG.PARAMS.jpg',

        // Legend
        showLegend:       true,
        legendMode:       'reference',
        includeCompass:   true,

        // Annotations
        showBoxNumbers:   options.showBoxNumbers   !== false,
        showUnitLabels:   options.showUnitLabels   !== false,
        showDimensions:   options.showDimensions   !== false,
        showAreas:        options.showAreas        !== false,
        showDoors:        options.showDoors        !== false,

        // Multi-floor support
        multiFloor:       options.multiFloor       || false,
        floorPlans:       options.floorPlans       || null,
        solutions:        options.solutions        || null,
        floorLabels:      options.floorLabels      || ['PLAN ETAGE 01', 'PLAN ETAGE 02'],

        // Radiators: pass engine-generated data
        useRowZigzags: true,
    };

    const pdfBytes = await CostoExports.exportToReferencePDF(solution, floorPlan, metrics, opts);

    // Ensure output directory exists
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(outputPath, pdfBytes);

    return outputPath;
}

module.exports = { generatePDF };
