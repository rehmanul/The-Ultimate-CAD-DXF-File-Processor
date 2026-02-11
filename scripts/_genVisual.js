'use strict';

const fs = require('fs');
const path = require('path');
const DxfParser = require('dxf-parser');
const dxfProcessor = require('../lib/dxfProcessor');
const CostoLayoutEngineV2 = require('../lib/costo-engine/index');

const dxfPath = path.join(__dirname, '..', 'Samples', 'Test2.dxf');
const dxfBuf = fs.readFileSync(dxfPath, 'utf-8');
const parser = new DxfParser();
const dxf = parser.parseSync(dxfBuf);
const floorPlan = dxfProcessor.processParsedDXF(dxf);

const engine = new CostoLayoutEngineV2(floorPlan, {
    corridorWidth: 1.2, boxDepth: 2.5, boxSpacing: 0.05
});
const result = engine.generate({ distribution: { S: 25, M: 35, L: 25, XL: 15 } });

const b = floorPlan.bounds;
const pad = 2;
const scale = 15;
const w = (b.maxX - b.minX + pad * 2) * scale;
const h = (b.maxY - b.minY + pad * 2) * scale;

function tx(x) { return (x - b.minX + pad) * scale; }
function ty(y) { return h - (y - b.minY + pad) * scale; } // flip Y

const typeColors = {
    'S': { fill: '#dbeafe', stroke: '#3b82f6' },
    'M': { fill: '#d1fae5', stroke: '#10b981' },
    'L': { fill: '#fef3c7', stroke: '#f59e0b' },
    'XL': { fill: '#fce7f3', stroke: '#ec4899' }
};

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n`;
svg += `<rect width="${w}" height="${h}" fill="#f8f8f8"/>\n`;

// Corridors (pink fill)
for (const c of result.corridors) {
    svg += `<rect x="${tx(c.x)}" y="${ty(c.y + c.height)}" width="${c.width * scale}" height="${c.height * scale}" fill="#fce4ec" opacity="0.5"/>\n`;
}

// Boxes
for (const u of result.units) {
    const col = typeColors[u.type] || { fill: '#e0e7ff', stroke: '#6366f1' };
    svg += `<rect x="${tx(u.x)}" y="${ty(u.y + u.height)}" width="${u.width * scale}" height="${u.height * scale}" fill="${col.fill}" stroke="${col.stroke}" stroke-width="0.5" opacity="0.7"/>\n`;
}

// Walls
const { extractSegments } = require('../lib/costo-engine/geometry');
for (const wall of (floorPlan.walls || [])) {
    const segs = extractSegments(wall);
    for (const seg of segs) {
        svg += `<line x1="${tx(seg.x1)}" y1="${ty(seg.y1)}" x2="${tx(seg.x2)}" y2="${ty(seg.y2)}" stroke="#374151" stroke-width="1.5"/>\n`;
    }
}

// Entrances (red)
for (const ent of (floorPlan.entrances || [])) {
    if (ent.start && ent.end) {
        svg += `<line x1="${tx(ent.start.x)}" y1="${ty(ent.start.y)}" x2="${tx(ent.end.x)}" y2="${ty(ent.end.y)}" stroke="red" stroke-width="2"/>\n`;
    }
}

// Forbidden zones (yellow)
for (const fz of (floorPlan.forbiddenZones || [])) {
    if (fz.polygon) {
        const pts = fz.polygon.map(pt => {
            const x = Array.isArray(pt) ? pt[0] : pt.x;
            const y = Array.isArray(pt) ? pt[1] : pt.y;
            return `${tx(x)},${ty(y)}`;
        }).join(' ');
        svg += `<polygon points="${pts}" fill="#ffcc00" opacity="0.4" stroke="#cc9900" stroke-width="1"/>\n`;
    }
}

// Circulation paths (blue)
const circulationPaths = result.circulationPaths || [];
for (const cp of circulationPaths) {
    if (!Array.isArray(cp.path) || cp.path.length < 2) continue;
    const isMain = cp.style === 'solid_blue' || cp.type === 'SPINE' || cp.type === 'BRANCH' || cp.type === 'ENTRANCE_CONNECTION';
    if (isMain) {
        const pts = cp.path.map(pt => `${tx(pt.x)},${ty(pt.y)}`).join(' ');
        svg += `<polyline points="${pts}" fill="none" stroke="#0044cc" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>\n`;
    }
}

// Legend
svg += `<rect x="10" y="10" width="180" height="130" fill="white" stroke="#ccc" rx="5"/>\n`;
svg += `<text x="20" y="30" font-size="14" font-weight="bold">LÉGENDE</text>\n`;
const legendItems = [
    { color: '#3b82f6', label: 'S - Petit' },
    { color: '#10b981', label: 'M - Moyen' },
    { color: '#f59e0b', label: 'L - Grand' },
    { color: '#ec4899', label: 'XL - Très Grand' },
    { color: '#0044cc', label: 'Circulation' }
];
legendItems.forEach((item, i) => {
    const y = 50 + i * 20;
    svg += `<rect x="20" y="${y - 8}" width="12" height="12" fill="${item.color}" opacity="0.7"/>\n`;
    svg += `<text x="38" y="${y + 2}" font-size="11">${item.label}</text>\n`;
});

svg += `</svg>`;

const outPath = path.join(__dirname, '..', 'exports', 'costo_test2_output.svg');
fs.writeFileSync(outPath, svg);
console.log(`SVG written to ${outPath}`);
console.log(`${result.units.length} units, ${result.corridors.length} corridors, ${circulationPaths.length} circulation paths`);

// Also try to generate PNG using sharp
try {
    const sharp = require('sharp');
    const pngPath = path.join(__dirname, '..', 'exports', 'costo_test2_output.png');
    sharp(Buffer.from(svg))
        .resize(1200)
        .png()
        .toFile(pngPath)
        .then(() => console.log(`PNG written to ${pngPath}`))
        .catch(err => console.log('PNG generation failed:', err.message));
} catch (e) {
    console.log('sharp not available, SVG only');
}
