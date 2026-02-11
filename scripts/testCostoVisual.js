'use strict';
const fs = require('fs');
const ProfessionalCADProcessor = require('../lib/professionalCADProcessor');
const CostoEngine = require('../lib/costo-engine');
const { extractSegments } = require('../lib/costo-engine/geometry');

async function main() {
    const proc = new ProfessionalCADProcessor();
    const fp = await proc.processDXF('Samples/Test2.dxf');

    const engine = new CostoEngine(fp, { corridorWidth: 1.2, boxDepth: 2.5 });
    const result = engine.generate({ distribution: { S: 25, M: 35, L: 25, XL: 15 } });

    const b = fp.bounds;
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    const scale = 15;
    const svgW = w * scale, svgH = h * scale;

    const lines = [];
    lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="${b.minX} ${b.minY} ${w} ${h}">`);
    lines.push(`<rect x="${b.minX}" y="${b.minY}" width="${w}" height="${h}" fill="#f8f8f8"/>`);

    // Corridors (pink)
    for (const c of result.corridors) {
        lines.push(`<rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" fill="#fce4ec" stroke="#f48fb1" stroke-width="0.05" opacity="0.5"/>`);
    }

    // Units (colored by type)
    const colors = { S: '#dbeafe', M: '#d1fae5', L: '#fef3c7', XL: '#fce7f3' };
    const outlines = { S: '#3b82f6', M: '#10b981', L: '#f59e0b', XL: '#ec4899' };
    for (const u of result.units) {
        lines.push(`<rect x="${u.x}" y="${u.y}" width="${u.width}" height="${u.height}" fill="${colors[u.type] || '#e0e7ff'}" stroke="${outlines[u.type] || '#6366f1'}" stroke-width="0.04" opacity="0.7"/>`);
    }

    // Walls (dark)
    for (const wall of fp.walls) {
        const segs = extractSegments(wall);
        for (const s of segs) {
            lines.push(`<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="#374151" stroke-width="0.12"/>`);
        }
    }

    // Circulation paths (blue ribbons for main route)
    for (const cp of result.circulationPaths) {
        if (!cp.path || cp.path.length < 2) continue;
        let d = `M ${cp.path[0].x} ${cp.path[0].y}`;
        for (let i = 1; i < cp.path.length; i++) {
            d += ` L ${cp.path[i].x} ${cp.path[i].y}`;
        }
        if (cp.type === 'CORRIDOR_CENTER') {
            lines.push(`<path d="${d}" stroke="#66b3f2" stroke-width="0.08" fill="none" stroke-dasharray="0.3,0.2"/>`);
        } else {
            lines.push(`<path d="${d}" stroke="#1a56db" stroke-width="0.3" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`);
        }
    }

    // Entrances (red)
    for (const ent of fp.entrances) {
        if (ent.start && ent.end) {
            lines.push(`<line x1="${ent.start.x}" y1="${ent.start.y}" x2="${ent.end.x}" y2="${ent.end.y}" stroke="red" stroke-width="0.15"/>`);
        }
    }

    // Forbidden zones (yellow)
    for (const fz of fp.forbiddenZones) {
        if (fz.polygon) {
            const pts = fz.polygon.map(pt => `${Array.isArray(pt) ? pt[0] : pt.x},${Array.isArray(pt) ? pt[1] : pt.y}`).join(' ');
            lines.push(`<polygon points="${pts}" fill="#ffcc00" opacity="0.4" stroke="#cc9900" stroke-width="0.05"/>`);
        }
    }

    lines.push('</svg>');
    fs.writeFileSync('exports/costo_test2_output.svg', lines.join('\n'));
    console.log('SVG written to exports/costo_test2_output.svg');
    console.log(`Units: ${result.units.length}, Corridors: ${result.corridors.length}, Circulation: ${result.circulationPaths.length}`);
}

main().catch(e => console.error(e));
