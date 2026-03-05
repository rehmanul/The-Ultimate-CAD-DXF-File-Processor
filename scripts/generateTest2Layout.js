#!/usr/bin/env node
'use strict';

/**
 * Generate a professional bay-based layout PDF from Test2.dxf
 * Uses CostoAPI → ProfessionalGridLayoutEngine → CostoExports
 *
 * Architecture: CORRIDOR-FIRST, ROW-PAIR BASED
 *   corridor = controlled empty space between two parallel box rows
 */

const fs = require('fs');
const path = require('path');

const DXF_PATH = path.resolve(__dirname, '..', 'Samples', 'Test2.dxf');
const OUTPUT_DIR = path.resolve(__dirname, '..', 'Samples', 'Test2_Output');
const OUTPUT_PDF = path.join(OUTPUT_DIR, 'Test2_layout_from_dxf.pdf');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function main() {
    console.log('=== Test2 Bay-Based Layout Generation ===');
    console.log('Input:', DXF_PATH);

    // 1. Parse DXF
    console.log('\n[1/5] Parsing DXF...');
    const costoAPI = require('../lib/costoAPI');
    const floorPlan = await costoAPI.processCADFile(DXF_PATH);

    console.log('  Bounds:', JSON.stringify(floorPlan.bounds));
    console.log('  Walls:', (floorPlan.walls || []).length);
    console.log('  Entrances:', (floorPlan.entrances || []).length);

    // 2. Generate layout with ProfessionalGridLayoutEngine (corridor-first, strip-based)
    console.log('\n[2/5] Generating bay-based layout (ProfessionalGridLayoutEngine)...');
    const ProfessionalGridLayoutEngine = require('../lib/ProfessionalGridLayoutEngine');

    const engine = new ProfessionalGridLayoutEngine(
        {
            bounds: floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 },
            walls: floorPlan.walls || [],
            rooms: floorPlan.rooms || [],
            entrances: floorPlan.entrances || [],
            entities: floorPlan.entities || [],
            forbiddenZones: floorPlan.forbiddenZones || [],
            envelope: floorPlan.envelope || []
        },
        {
            corridorWidth: 1.00,
            wallClearance: 0.05,
            boxDepth: 2.00,
            boxSpacing: 0.02
        }
    );

    const distribution = { S: 35, M: 40, L: 20, XL: 5 };
    const solution = engine.generate({ distribution, targetCount: 400 });
    solution.boxes = solution.units;

    console.log('  Units:', solution.units.length);
    console.log('  Corridors:', solution.corridors.length);
    console.log('  Radiators:', (solution.radiators || []).length);
    console.log('  Circulation paths:', (solution.circulationPaths || []).length);

    // 3. Check corridor connectivity
    console.log('\n[3/5] Checking corridor connectivity...');
    const corridors = solution.corridors;
    const tol = 0.5;
    const touches = (a, b) => {
        const xOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const yOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        return (xOverlap > -tol && yOverlap > -tol);
    };
    const adj = corridors.map(() => []);
    for (let i = 0; i < corridors.length; i++) {
        for (let j = i + 1; j < corridors.length; j++) {
            if (touches(corridors[i], corridors[j])) { adj[i].push(j); adj[j].push(i); }
        }
    }
    const visited = new Set();
    let components = 0;
    for (let s = 0; s < corridors.length; s++) {
        if (visited.has(s)) continue;
        components++;
        const q = [s]; visited.add(s);
        while (q.length) { const i = q.shift(); for (const j of adj[i]) { if (!visited.has(j)) { visited.add(j); q.push(j); } } }
    }
    console.log('  Components:', components);
    console.log('  Connected:', components <= 1 ? 'FULLY CONNECTED' : 'DISCONNECTED (' + components + ' components)');

    // 4. Export PDF (green arrows, no raw walls)
    console.log('\n[4/5] Exporting PDF...');
    const costoExports = require('../lib/costoExports');

    const totalArea = solution.units.reduce((s, u) => s + (u.width || 0) * (u.height || 0), 0);
    const metrics = {
        totalUnits: solution.units.length,
        totalArea,
        usableArea: totalArea * 0.75,
        yieldRatio: 0.75
    };

    const pdfBytes = await costoExports.exportToPDF(solution, floorPlan, metrics, {
        pageSize: 'A1',
        title: 'COSTO V1 - Test2 Professional Bay Layout',
        scale: '1:200',
        floorLabel: 'PLAN ETAGE 01',
        showLegend: true,
        showTitleBlock: true,
        hideRawWalls: true,
        greenArrows: true
    });

    fs.writeFileSync(OUTPUT_PDF, pdfBytes);
    console.log('  PDF saved:', OUTPUT_PDF, '(' + (pdfBytes.length / 1024).toFixed(0) + ' KB)');

    console.log('\n[5/5] Done!');
}

main().catch(e => { console.error('Fatal:', e.message); console.error(e.stack); process.exit(1); });
