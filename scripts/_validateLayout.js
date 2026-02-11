'use strict';

const fs = require('fs');
const path = require('path');

// Load the DXF processor and COSTO engine
const dxfProcessor = require('../lib/dxfProcessor');
const CostoLayoutEngineV2 = require('../lib/costo-engine/index');
const { rectHitsWalls, extractSegments } = require('../lib/costo-engine/geometry');

async function validate() {
    const dxfPath = path.join(__dirname, '..', 'Samples', 'Test2.dxf');
    if (!fs.existsSync(dxfPath)) {
        console.error('Test2.dxf not found');
        process.exit(1);
    }

    console.log('=== COSTO Layout Validation ===\n');

    // Parse DXF
    const dxfBuf = fs.readFileSync(dxfPath, 'utf-8');
    const DxfParser = require('dxf-parser');
    const parser = new DxfParser();
    const dxf = parser.parseSync(dxfBuf);
    const floorPlan = dxfProcessor.processParsedDXF(dxf);

    console.log(`Floor plan: ${(floorPlan.bounds.maxX - floorPlan.bounds.minX).toFixed(1)} x ${(floorPlan.bounds.maxY - floorPlan.bounds.minY).toFixed(1)} m`);
    console.log(`Walls: ${floorPlan.walls?.length || 0}, Entrances: ${floorPlan.entrances?.length || 0}, Forbidden: ${floorPlan.forbiddenZones?.length || 0}\n`);

    // Generate layout
    const engine = new CostoLayoutEngineV2(floorPlan, {
        corridorWidth: 1.2,
        boxDepth: 2.5,
        boxSpacing: 0.05
    });
    const result = engine.generate({ distribution: { S: 25, M: 35, L: 25, XL: 15 } });

    const { units, corridors, circulationPaths } = result;
    console.log(`\nResults: ${units.length} units, ${corridors.length} corridors, ${circulationPaths.length} circulation paths\n`);

    // Extract all wall segments
    const allWalls = [];
    for (const wall of (floorPlan.walls || [])) {
        const segs = extractSegments(wall);
        for (const seg of segs) {
            const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
            if (len >= 0.3) allWalls.push(seg);
        }
    }

    // Check boxes overlapping walls
    let boxWallHits = 0;
    for (const u of units) {
        if (rectHitsWalls(u.x, u.y, u.width, u.height, allWalls, 0)) {
            boxWallHits++;
        }
    }
    console.log(`Box-wall intersections: ${boxWallHits} / ${units.length} ${boxWallHits === 0 ? '✓' : '✗ FAIL'}`);

    // Check corridors overlapping walls
    let corrWallHits = 0;
    for (const c of corridors) {
        if (rectHitsWalls(c.x, c.y, c.width, c.height, allWalls, 0)) {
            corrWallHits++;
        }
    }
    console.log(`Corridor-wall intersections: ${corrWallHits} / ${corridors.length} ${corrWallHits === 0 ? '✓' : '✗ FAIL'}`);

    // Check box-box overlaps
    let boxOverlaps = 0;
    for (let i = 0; i < units.length; i++) {
        for (let j = i + 1; j < units.length; j++) {
            const a = units[i], b = units[j];
            if (a.x < b.x + b.width && a.x + a.width > b.x &&
                a.y < b.y + b.height && a.y + a.height > b.y) {
                const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
                const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
                if (overlapX > 0.01 && overlapY > 0.01) {
                    boxOverlaps++;
                }
            }
        }
    }
    console.log(`Box-box overlaps: ${boxOverlaps} ${boxOverlaps === 0 ? '✓' : '✗ FAIL'}`);

    // Fill rate
    const totalArea = (floorPlan.bounds.maxX - floorPlan.bounds.minX) * (floorPlan.bounds.maxY - floorPlan.bounds.minY);
    const boxArea = units.reduce((s, u) => s + u.width * u.height, 0);
    console.log(`Fill rate: ${(boxArea / totalArea * 100).toFixed(1)}%`);

    // Type distribution
    const typeCounts = {};
    for (const u of units) {
        typeCounts[u.type] = (typeCounts[u.type] || 0) + 1;
    }
    console.log(`Types: ${JSON.stringify(typeCounts)}`);

    // Circulation paths
    const mainRoutes = circulationPaths.filter(cp => cp.style === 'solid_blue' || cp.type === 'SPINE' || cp.type === 'BRANCH' || cp.type === 'ENTRANCE_CONNECTION');
    const centerlines = circulationPaths.filter(cp => cp.type === 'CORRIDOR_CENTER');
    console.log(`Circulation: ${mainRoutes.length} main route segments, ${centerlines.length} corridor centerlines`);

    console.log('\n=== Validation Complete ===');
}

validate().catch(err => {
    console.error('Validation failed:', err);
    process.exit(1);
});
