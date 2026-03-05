// Diagnostic: Understand the wall data structure
const { RawPlanPipeline } = require('./lib/RawPlanPipeline');
const fs = require('fs');
const path = require('path');

// Find the DXF file
const samplesDir = path.join(__dirname, 'Samples');
let dxfFile = null;
const subdirs = fs.readdirSync(samplesDir).filter(f => fs.statSync(path.join(samplesDir, f)).isDirectory());
for (const d of subdirs) {
    const files = fs.readdirSync(path.join(samplesDir, d)).filter(f => f.endsWith('.dxf'));
    if (files.length > 0) {
        dxfFile = path.join(samplesDir, d, files[0]);
        break;
    }
}
if (!dxfFile) {
    const files = fs.readdirSync(samplesDir).filter(f => f.endsWith('.dxf'));
    if (files.length > 0) dxfFile = path.join(samplesDir, files[0]);
}

console.log('DXF file:', dxfFile);

if (!dxfFile) {
    console.log('No DXF file found');
    process.exit(1);
}

// Process the file
const pipeline = new RawPlanPipeline();
const result = pipeline.process(fs.readFileSync(dxfFile, 'utf-8'));

const walls = result.walls || [];
const fz = result.forbiddenZones || [];
const bounds = result.bounds || {};

console.log('\n=== BOUNDS ===');
console.log(JSON.stringify(bounds));

console.log('\n=== FORBIDDEN ZONES ===');
console.log(`Count: ${fz.length}`);
fz.forEach((z, i) => console.log(`  FZ[${i}]:`, JSON.stringify(z).slice(0, 150)));

console.log('\n=== WALLS ===');
console.log(`Total walls: ${walls.length}`);

// Analyze wall lengths
const segments = [];
for (const w of walls) {
    if (w.start && w.end) {
        const len = Math.hypot(+w.end.x - +w.start.x, +w.end.y - +w.start.y);
        segments.push({ len, layer: w.layer || 'unknown', type: w.type || 'line' });
    }
}

console.log(`Total segments: ${segments.length}`);

// Length distribution
const buckets = [0.1, 0.3, 0.5, 1, 2, 3, 5, 10, 20, 50];
for (const threshold of buckets) {
    const count = segments.filter(s => s.len > threshold).length;
    console.log(`  > ${threshold}m: ${count} segments`);
}

// Layer distribution
const layers = {};
segments.forEach(s => {
    layers[s.layer] = (layers[s.layer] || 0) + 1;
});
console.log('\n=== LAYERS ===');
Object.entries(layers).sort((a, b) => b[1] - a[1]).forEach(([layer, count]) => {
    const avgLen = segments.filter(s => s.layer === layer).reduce((sum, s) => sum + s.len, 0) / count;
    console.log(`  ${layer}: ${count} segments (avg len: ${avgLen.toFixed(2)}m)`);
});

// Show first 5 walls
console.log('\n=== SAMPLE WALLS (first 5) ===');
walls.slice(0, 5).forEach((w, i) => {
    console.log(`  Wall[${i}]:`, JSON.stringify(w).slice(0, 200));
});
