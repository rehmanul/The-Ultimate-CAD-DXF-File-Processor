/**
 * Show N-S ↔ E-W corridor connections.
 * Loads corridors from Test2_Output/corridors.json (create by running processTest2Dxf.js first),
 * finds where horizontal (E-W) and vertical (N-S) centerlines cross, and prints a report.
 * Optionally writes an HTML file that draws the connection points so you can see them.
 *
 * Usage: node scripts/showCorridorConnections.js [--html]
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'Samples', 'Test2_Output');
const CORRIDORS_JSON = path.join(OUTPUT_DIR, 'corridors.json');

function loadCorridors() {
    if (!fs.existsSync(CORRIDORS_JSON)) {
        console.error('No corridors.json found. Run first: node scripts/processTest2Dxf.js');
        process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(CORRIDORS_JSON, 'utf8'));
    return { bounds: raw.bounds || {}, corridors: raw.corridors || [] };
}

function normalizeCorridor(c, index) {
    let x = c.x, y = c.y, w = c.width, h = c.height;
    if ((!Number.isFinite(x) || !Number.isFinite(y)) && Array.isArray(c.corners) && c.corners.length) {
        const xs = c.corners.map(p => (Array.isArray(p) ? p[0] : p.x)).filter(Number.isFinite);
        const ys = c.corners.map(p => (Array.isArray(p) ? p[1] : p.y)).filter(Number.isFinite);
        if (xs.length && ys.length) {
            x = Math.min(...xs);
            y = Math.min(...ys);
            w = Math.max(...xs) - x;
            h = Math.max(...ys) - y;
        }
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    w = Number.isFinite(w) && w > 0 ? w : 1.2;
    h = Number.isFinite(h) && h > 0 ? h : 1.2;
    const isHorizontal = c.direction === 'horizontal' || w >= h;
    return { index, x, y, width: w, height: h, isHorizontal, direction: isHorizontal ? 'E-W' : 'N-S' };
}

function findIntersections(corridors) {
    const tol = 1e-6;
    const horizontal = corridors.filter(c => c.isHorizontal);
    const vertical = corridors.filter(c => !c.isHorizontal);
    const connections = [];

    for (const h of horizontal) {
        const hY = h.y + h.height / 2;
        const hX1 = h.x;
        const hX2 = h.x + h.width;
        for (const v of vertical) {
            const vX = v.x + v.width / 2;
            const vY1 = v.y;
            const vY2 = v.y + v.height;
            if (vX >= hX1 - tol && vX <= hX2 + tol && hY >= vY1 - tol && hY <= vY2 + tol) {
                connections.push({
                    x: vX,
                    y: hY,
                    eWest: { index: h.index, x: h.x, y: h.y, width: h.width, height: h.height },
                    nSouth: { index: v.index, x: v.x, y: v.y, width: v.width, height: v.height }
                });
            }
        }
    }
    return connections;
}

function main() {
    const writeHtml = process.argv.includes('--html');
    const { bounds, corridors } = loadCorridors();

    const normalized = corridors
        .map((c, i) => normalizeCorridor(c, i))
        .filter(Boolean);

    const connections = findIntersections(normalized);
    const byPoint = new Map();
    for (const conn of connections) {
        const key = `${conn.x.toFixed(2)},${conn.y.toFixed(2)}`;
        if (!byPoint.has(key)) byPoint.set(key, []);
        byPoint.get(key).push(conn);
    }

    const minX = bounds.minX ?? 0;
    const maxX = bounds.maxX ?? 50;
    const minY = bounds.minY ?? 0;
    const maxY = bounds.maxY ?? 50;

    console.log('\n' + '='.repeat(70));
    console.log('N-S ↔ E-W CORRIDOR CONNECTIONS (where pathways meet)');
    console.log('='.repeat(70));
    console.log(`Corridors: ${normalized.length} total (${normalized.filter(c => c.isHorizontal).length} E-W, ${normalized.filter(c => !c.isHorizontal).length} N-S)`);
    console.log(`Connection points (N-S path meets E-W path): ${connections.length}`);
    console.log('');

    let n = 0;
    for (const [pointKey, conns] of byPoint) {
        n++;
        const c0 = conns[0];
        const eWestIds = [...new Set(conns.map(c => c.eWest.index))];
        const nSouthIds = [...new Set(conns.map(c => c.nSouth.index))];
        console.log(`  [${n}] At (${c0.x.toFixed(2)}, ${c0.y.toFixed(2)}) m`);
        console.log(`      E-W corridor(s): ${eWestIds.join(', ')}  ↔  N-S corridor(s): ${nSouthIds.join(', ')}`);
        console.log(`      → When walking N-S you can turn onto E-W (and vice versa).`);
        console.log('');
    }

    console.log('='.repeat(70));
    console.log('Summary: At each point above, the north–south pathway is connected to the east–west pathway.');
    console.log('='.repeat(70) + '\n');

    if (writeHtml) {
        const htmlPath = path.join(OUTPUT_DIR, 'corridor_connections.html');
        const scale = 12;
        const width = (maxX - minX) * scale;
        const height = (maxY - minY) * scale;
        const toSx = (x) => ((x - minX) / (maxX - minX || 1)) * width;
        const toSy = (y) => height - ((y - minY) / (maxY - minY || 1)) * height;

        const points = Array.from(byPoint.keys()).map(k => {
            const [x, y] = k.split(',').map(Number);
            return { x, y, sx: toSx(x), sy: toSy(y) };
        });

        const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>N-S / E-W corridor connections</title></head>
<body style="margin:20px;font-family:sans-serif;">
<h1>N-S ↔ E-W connection points</h1>
<p>Green dots = where a north–south corridor meets an east–west corridor (you can turn).</p>
<svg width="${width + 40}" height="${height + 40}" style="border:1px solid #ccc;">
  <g transform="translate(20,20)">
    <rect width="${width}" height="${height}" fill="#f8f8f8"/>
    ${normalized.filter(c => c.isHorizontal).map(h => {
            const x1 = toSx(h.x);
            const x2 = toSx(h.x + h.width);
            const y = toSy(h.y + h.height / 2);
            return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#b3d9ff" stroke-width="2"/>`;
        }).join('\n    ')}
    ${normalized.filter(c => !c.isHorizontal).map(v => {
            const y1 = toSy(v.y);
            const y2 = toSy(v.y + v.height);
            const x = toSx(v.x + v.width / 2);
            return `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="#ffccb3" stroke-width="2"/>`;
        }).join('\n    ')}
    ${points.map(p => `<circle cx="${p.sx}" cy="${p.sy}" r="6" fill="#0a0" stroke="#fff" stroke-width="2"/>`).join('\n    ')}
  </g>
</svg>
<p><small>Blue = E-W centerlines, Orange = N-S centerlines. Plan bounds: ${minX.toFixed(1)}–${maxX.toFixed(1)} m × ${minY.toFixed(1)}–${maxY.toFixed(1)} m.</small></p>
</body></html>`;
        fs.writeFileSync(htmlPath, html);
        console.log(`Wrote ${htmlPath} — open in a browser to see connection points.\n`);
    } else {
        console.log('Run with --html to generate corridor_connections.html and see points visually.\n');
    }
}

main();
