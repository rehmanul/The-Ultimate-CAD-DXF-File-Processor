/**
 * Generate reference-style layout and export to PDF + PNG for visual check.
 * Uses CostoProLayoutEngine and reference colors (red circulation, light blue radiators).
 */

const fs = require('fs');
const path = require('path');
const CostoProLayoutEngine = require('../lib/CostoProLayoutEngine');
const CostoExports = require('../lib/costoExports');

// Reference colors (match reference image)
const COLORS = {
    toleBlanche: '#5c6269',
    toleGrise: '#0059d9',
    circulation: '#d11f1f',
    radiator: '#73b8fa',
    bg: '#fafafa'
};

async function main() {
    const fp = {
        bounds: { minX: 0, minY: 0, maxX: 32, maxY: 22 },
        walls: [],
        rooms: [],
        entrances: [{ x: 2, y: 11, width: 1.2, height: 0.2 }],
        forbiddenZones: []
    };

    const engine = new CostoProLayoutEngine(fp, { corridorWidth: 1.2, boxDepth: 2.5 });
    const out = engine.generate({
        distribution: { small: 25, medium: 35, large: 25, xlarge: 15 },
        targetCount: 35
    });

    const b = fp.bounds;
    const pad = 1.5;
    const scale = 28;
    const w = Math.round((b.maxX - b.minX + pad * 2) * scale);
    const h = Math.round((b.maxY - b.minY + pad * 2) * scale);

    function tx(x) { return (x - b.minX + pad) * scale; }
    function ty(y) { return h - (y - b.minY + pad) * scale; }

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n`;
    svg += `<rect width="${w}" height="${h}" fill="${COLORS.bg}"/>\n`;

    // Corridors (very light fill)
    for (const c of out.corridors) {
        svg += `<rect x="${tx(c.x)}" y="${ty(c.y + c.height)}" width="${c.width * scale}" height="${c.height * scale}" fill="#f0f4f8" stroke="none"/>\n`;
    }

    // Boxes (Tole Grise outline - blue)
    for (const u of out.units) {
        svg += `<rect x="${tx(u.x)}" y="${ty(u.y + u.height)}" width="${u.width * scale}" height="${u.height * scale}" fill="none" stroke="${COLORS.toleGrise}" stroke-width="1.2"/>\n`;
    }

    // Radiators (light blue zigzag)
    for (const rad of out.radiators) {
        const path = rad.path || [];
        if (path.length < 2) continue;
        const pts = path.map(p => `${tx(Array.isArray(p) ? p[0] : p.x)},${ty(Array.isArray(p) ? p[1] : p.y)}`).join(' ');
        svg += `<polyline points="${pts}" fill="none" stroke="${COLORS.radiator}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>\n`;
    }

    // Circulation (red dashed)
    for (const cp of out.circulationPaths) {
        if (!Array.isArray(cp.path) || cp.path.length < 2) continue;
        const pts = cp.path.map(p => `${tx(p.x)},${ty(p.y)}`).join(' ');
        svg += `<polyline points="${pts}" fill="none" stroke="${COLORS.circulation}" stroke-width="1.8" stroke-dasharray="6 4" stroke-linecap="round" stroke-linejoin="round"/>\n`;
    }

    // Legend (reference style)
    const lx = 12;
    const ly = 18;
    svg += `<rect x="${lx}" y="${ly}" width="165" height="100" fill="white" stroke="#999" stroke-width="0.8" rx="4"/>\n`;
    svg += `<text x="${lx + 8}" y="${ly + 16}" font-size="12" font-weight="bold" fill="#111">LÉGENDE</text>\n`;
    svg += `<line x1="${lx + 8}" y1="${ly + 28}" x2="${lx + 50}" y2="${ly + 28}" stroke="${COLORS.toleBlanche}" stroke-width="1.5"/>\n`;
    svg += `<text x="${lx + 56}" y="${ly + 32}" font-size="10" fill="#111">Tole Blanche</text>\n`;
    svg += `<line x1="${lx + 8}" y1="${ly + 46}" x2="${lx + 50}" y2="${ly + 46}" stroke="${COLORS.toleGrise}" stroke-width="1.2"/>\n`;
    svg += `<text x="${lx + 56}" y="${ly + 50}" font-size="10" fill="#111">Tole Grise</text>\n`;
    svg += `<line x1="${lx + 8}" y1="${ly + 64}" x2="${lx + 50}" y2="${ly + 64}" stroke="${COLORS.circulation}" stroke-width="1.2" stroke-dasharray="4 3"/>\n`;
    svg += `<text x="${lx + 56}" y="${ly + 68}" font-size="10" fill="#111">ligne circulation</text>\n`;
    svg += `<polyline points="${lx + 8},${ly + 80} ${lx + 18},${ly + 76} ${lx + 28},${ly + 82} ${lx + 38},${ly + 78} ${lx + 50},${ly + 84}" fill="none" stroke="${COLORS.radiator}" stroke-width="1.2"/>\n`;
    svg += `<text x="${lx + 56}" y="${ly + 84}" font-size="10" fill="#111">Radiateur</text>\n`;

    svg += `</svg>`;

    const exportsDir = path.join(__dirname, '..', 'exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

    const svgPath = path.join(exportsDir, 'Reference_Style_Visual.svg');
    fs.writeFileSync(svgPath, svg);
    console.log('Written:', svgPath);

    // PDF (reference style)
    const solution = {
        boxes: out.units,
        corridors: out.corridors,
        radiators: out.radiators,
        circulationPaths: out.circulationPaths
    };
    const metrics = { totalArea: 0, yieldRatio: 0, unitMixCompliance: 0 };
    const pdfBytes = await CostoExports.exportToPDF(solution, fp, metrics, {
        showLegend: true,
        showTitleBlock: true,
        scale: '1:200',
        floorLabel: 'PLAN ETAGE 01'
    });
    const pdfPath = path.join(exportsDir, 'Reference_Style_Visual.pdf');
    fs.writeFileSync(pdfPath, pdfBytes);
    console.log('Written:', pdfPath);

    // PNG via sharp
    try {
        const sharp = require('sharp');
        const pngPath = path.join(exportsDir, 'Reference_Style_Visual.png');
        await sharp(Buffer.from(svg, 'utf8'))
            .resize(1400)
            .png()
            .toFile(pngPath);
        console.log('Written:', pngPath);
    } catch (e) {
        console.log('PNG skip:', e.message);
    }
}

main().catch(e => { console.error(e); process.exit(1); });
