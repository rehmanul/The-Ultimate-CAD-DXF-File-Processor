/**
 * ARCHITECTURAL VALIDATION — Direct engine test
 * Parses Test2.dxf → builds floor plan → runs engine → validates every box
 */
const fs = require('fs');
const path = require('path');
const DxfParser = require('dxf-parser');
const dxfProcessor = require('./lib/dxfProcessor');
const ProfessionalGridLayoutEngine = require('./lib/ProfessionalGridLayoutEngine');

const dxfPath = path.join(__dirname, 'Samples', 'Test2.dxf');
const fileContent = fs.readFileSync(dxfPath, 'utf-8');

// Parse DXF
const parser = new DxfParser();
const dxf = parser.parseSync(fileContent);
const cadData = dxfProcessor.processParsedDXF(dxf);

console.log('=== ARCHITECTURAL VALIDATION ===');
console.log(`Walls: ${cadData.walls.length}`);
console.log(`ForbiddenZones: ${cadData.forbiddenZones.length}`);
console.log(`Bounds: minX=${cadData.bounds.minX.toFixed(1)} minY=${cadData.bounds.minY.toFixed(1)} maxX=${cadData.bounds.maxX.toFixed(1)} maxY=${cadData.bounds.maxY.toFixed(1)}`);

// Count walls with polygons
const wallsWithPolygons = cadData.walls.filter(w => w.polygon && w.polygon.length >= 3);
console.log(`Walls with polygon data: ${wallsWithPolygons.length}`);

// Build floor plan
const floorPlan = {
    bounds: cadData.bounds,
    walls: cadData.walls,
    forbiddenZones: cadData.forbiddenZones || [],
    entrances: cadData.entrances || [],
    totalArea: cadData.totalArea || 0
};

// Generate layout
console.log('\nGenerating layout...');
const engine = new ProfessionalGridLayoutEngine(floorPlan, {});
const result = engine.generate({});

const units = result.units || [];
const corridors = result.corridors || [];

console.log(`\n📦 Units: ${units.length}`);
console.log(`🛤️  Corridors: ${corridors.length}`);
console.log(`🧱 FZ rects (incl wall polygons): ${engine.fzRects.length}`);
console.log(`🔧 Internal wall segs: ${engine.wallSegs.length}`);
console.log(`🔧 All wall segs: ${(engine.allWallSegs || []).length}`);

// ── V1: No box center inside wall polygon obstacle ──
console.log('\n--- V1: Box center vs forbidden zones ---');
let v1 = 0;
for (const u of units) {
    const cx = u.x + u.width / 2;
    const cy = u.y + u.height / 2;
    for (const fz of engine.fzRects) {
        if (cx >= fz.x && cx <= fz.x + fz.w && cy >= fz.y && cy <= fz.y + fz.h) {
            v1++;
            if (v1 <= 5) console.log(`  ❌ Box ${u.id} (${cx.toFixed(2)},${cy.toFixed(2)}) inside FZ (${fz.x.toFixed(1)},${fz.y.toFixed(1)} ${fz.w.toFixed(1)}x${fz.h.toFixed(1)})`);
            break;
        }
    }
}
console.log(`  ${v1 === 0 ? '✅ PASS' : '❌ FAIL: ' + v1}`);

// ── V2: No box crosses wall segment ──
console.log('\n--- V2: Box vs wall segments ---');
let v2 = 0;
for (const u of units) {
    if (engine._boxHitsWall(u.x, u.y, u.width, u.height)) {
        v2++;
        if (v2 <= 5) console.log(`  ⚠️ Box ${u.id} crosses wall seg`);
    }
}
if (v2 > 5) console.log(`  ...${v2 - 5} more`);
console.log(`  ${v2 === 0 ? '✅ PASS' : '⚠️ ' + v2 + ' wall crossings'}`);

// ── V3: Bounds check ──
console.log('\n--- V3: Inside building bounds ---');
const b = cadData.bounds;
let v3 = 0;
for (const u of units) {
    if (u.x < b.minX - 0.5 || u.y < b.minY - 0.5 || u.x + u.width > b.maxX + 0.5 || u.y + u.height > b.maxY + 0.5) {
        v3++;
        if (v3 <= 3) console.log(`  ❌ Box ${u.id} outside bounds`);
    }
}
console.log(`  ${v3 === 0 ? '✅ PASS' : '❌ FAIL: ' + v3}`);

// ── V4: Box-box overlap ──
console.log('\n--- V4: Box-to-box overlap ---');
let v4 = 0;
for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
        const a = units[i], bb = units[j];
        if (a.x + 0.05 < bb.x + bb.width && a.x + a.width - 0.05 > bb.x &&
            a.y + 0.05 < bb.y + bb.height && a.y + a.height - 0.05 > bb.y) {
            v4++;
            if (v4 <= 3) console.log(`  ❌ ${a.id} overlaps ${bb.id}`);
        }
    }
}
if (v4 > 3) console.log(`  ...${v4 - 3} more`);
console.log(`  ${v4 === 0 ? '✅ PASS' : '⚠️ ' + v4}`);

// ── SUMMARY ──
console.log('\n=== SUMMARY ===');
console.log(`📦 ${units.length} boxes, 🛤️ ${corridors.length} corridors`);
console.log(`V1 center-in-FZ: ${v1}`);
console.log(`V2 wall-crossing: ${v2}`);
console.log(`V3 outside-bounds: ${v3}`);
console.log(`V4 box-overlap: ${v4}`);
const critical = v1 + v3;
console.log(`\n${critical === 0 ? '✅ ALL CRITICAL PASS' : '❌ ' + critical + ' CRITICAL VIOLATIONS'}`);
process.exit(critical > 0 ? 1 : 0);
