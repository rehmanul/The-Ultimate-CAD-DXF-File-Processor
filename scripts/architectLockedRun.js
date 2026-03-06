/**
 * Architect-locked production pipeline.
 *
 * Usage:
 *   node scripts/architectLockedRun.js --input "Samples/etage01.dxf"
 *
 * Guarantees:
 * - Filters decorative/output layers from wall geometry.
 * - Runs strict COSTO generation with architectural guardrails.
 * - Fails fast if quality gate rejects generation.
 * - Exports only validated reference-style PDF + JSON QA report.
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../server');

function parseArgs() {
    const args = process.argv.slice(2);
    const out = {};
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--input' && args[i + 1]) out.input = args[++i];
        else if (a === '--title' && args[i + 1]) out.title = args[++i];
        else if (a === '--remove-box-id' && args[i + 1]) out.removeBoxId = args[++i];
        else if (a === '--remove-box-point' && args[i + 1]) out.removeBoxPoint = args[++i];
        else if (a === '--remove-box-radius' && args[i + 1]) out.removeBoxRadius = args[++i];
    }
    return out;
}

function normalizeLayerName(v) {
    return String(v || '').trim().toUpperCase();
}

function isDecorativeLayer(layer) {
    const l = normalizeLayerName(layer);
    if (!l) return true;
    if (
        l.includes('TEXT') ||
        l.includes('TEXTE') ||
        l.includes('COTE') ||
        l.includes('DIM') ||
        l.includes('HATCH') ||
        l.includes('RADIATEUR') ||
        l.includes('RADIATOR') ||
        l.includes('FLECHE') ||
        l.includes('ARROW') ||
        l.includes('LIGNE_CIRCULATION') ||
        l.includes('CIRCULATION') ||
        l.includes('BOX') ||
        l.includes('ILOT') ||
        l.includes('TOLE') ||
        l.includes('ANNOT') ||
        l.includes('LEGENDE') ||
        l.includes('LEGEND')
    ) return true;
    return false;
}

function isStructuralLayer(layer) {
    const l = normalizeLayerName(layer);
    if (!l) return false;
    return (
        l === 'MUR' ||
        l === 'MURS' ||
        l.includes('WALL') ||
        l.includes('MUR') ||
        l.includes('STRUCT') ||
        l.includes('COLON') ||
        l.includes('POTEAU') ||
        l.includes('PILAR') ||
        l.includes('PILLAR')
    );
}

function chooseWallLayers(walls) {
    const byLayer = new Map();
    for (const w of walls || []) {
        const layer = normalizeLayerName(w.layer || 'UNKNOWN');
        byLayer.set(layer, (byLayer.get(layer) || 0) + 1);
    }
    const entries = Array.from(byLayer.entries()).sort((a, b) => b[1] - a[1]);
    const structural = entries
        .filter(([layer]) => isStructuralLayer(layer) && !isDecorativeLayer(layer))
        .map(([layer]) => layer);

    if (structural.length > 0) {
        return {
            selectedLayers: structural,
            reason: 'structural-layer-match',
            distribution: Object.fromEntries(entries)
        };
    }

    // Fallback: use top non-decorative layer(s)
    const fallback = entries
        .filter(([layer]) => !isDecorativeLayer(layer))
        .slice(0, 3)
        .map(([layer]) => layer);

    return {
        selectedLayers: fallback,
        reason: fallback.length > 0 ? 'fallback-top-non-decorative' : 'none-found',
        distribution: Object.fromEntries(entries)
    };
}

function inferEntrancesFromBounds(bounds) {
    const minX = Number(bounds?.minX);
    const minY = Number(bounds?.minY);
    const maxX = Number(bounds?.maxX);
    const maxY = Number(bounds?.maxY);
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return [];

    const cy = (minY + maxY) / 2;
    const width = maxX - minX;
    const doorHalf = Math.max(0.35, Math.min(1.2, width * 0.01));

    return [
        { start: { x: minX, y: cy - doorHalf }, end: { x: minX, y: cy + doorHalf }, inferred: true, kind: 'entry' },
        { start: { x: maxX, y: cy - doorHalf }, end: { x: maxX, y: cy + doorHalf }, inferred: true, kind: 'exit' }
    ];
}

function analyzeSolution(solution) {
    const boxes = Array.isArray(solution.boxes) ? solution.boxes : [];
    const corridors = Array.isArray(solution.corridors) ? solution.corridors : [];
    const circulation = Array.isArray(solution.circulationPaths) ? solution.circulationPaths : [];

    let invalidBoxes = 0;
    let tinyBoxes = 0;
    for (const b of boxes) {
        const x = Number(b.x), y = Number(b.y), w = Number(b.width), h = Number(b.height);
        if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
            invalidBoxes++;
            continue;
        }
        if (Math.min(w, h) < 0.45) tinyBoxes++;
    }

    let majorCorridors = 0;
    let narrowMajorCorridors = 0;
    let horizontalMajor = 0;
    let verticalMajor = 0;
    for (const c of corridors) {
        const w = Number(c?.width), h = Number(c?.height);
        if (![w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
        const length = Math.max(w, h);
        const type = normalizeLayerName(c?.type || '');
        const isConnector = type === 'CONNECTOR';
        const isMajor = !isConnector && length >= 3.0;
        if (!isMajor) continue;
        majorCorridors++;
        if (Math.min(w, h) < 1.15) narrowMajorCorridors++;
        if (w >= h) horizontalMajor++;
        else verticalMajor++;
    }

    let validCirculationPaths = 0;
    for (const cp of circulation) {
        const p = cp?.path || cp?.points || cp;
        if (Array.isArray(p) && p.length >= 2) validCirculationPaths++;
    }

    return {
        boxes: boxes.length,
        invalidBoxes,
        tinyBoxes,
        corridors: corridors.length,
        majorCorridors,
        narrowMajorCorridors,
        horizontalMajor,
        verticalMajor,
        circulationPaths: circulation.length,
        validCirculationPaths
    };
}

async function run() {
    const args = parseArgs();
    const inputArg = args.input || 'Samples/etage01.dxf';
    const inputPath = path.isAbsolute(inputArg) ? inputArg : path.join(__dirname, '..', inputArg);
    if (!fs.existsSync(inputPath)) {
        throw new Error(`Input file not found: ${inputPath}`);
    }

    const stamp = Date.now();
    const baseName = path.parse(inputPath).name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const exportsDir = path.join(__dirname, '..', 'exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

    console.log(`[ArchitectLocked] Input: ${inputPath}`);

    const jobsRes = await request(app)
        .post('/api/jobs')
        .attach('file', fs.readFileSync(inputPath), path.basename(inputPath));
    if (jobsRes.status !== 200 || !jobsRes.body?.success) {
        throw new Error(`CAD processing failed: ${jobsRes.body?.error || jobsRes.status}`);
    }

    const cad = jobsRes.body.cadData || {};
    const wallSelection = chooseWallLayers(cad.walls || []);
    const selectedSet = new Set(wallSelection.selectedLayers);
    const structuralWalls = (cad.walls || []).filter((w) => selectedSet.has(normalizeLayerName(w.layer)));
    if (structuralWalls.length === 0) {
        throw new Error('No structural walls selected after layer filtering.');
    }

    const entrances = (cad.entrances || []).length > 0
        ? cad.entrances
        : inferEntrancesFromBounds(cad.bounds);

    const floorPlan = {
        urn: cad.urn || `${baseName}_${stamp}`,
        walls: structuralWalls,
        forbiddenZones: cad.forbiddenZones || [],
        entrances,
        bounds: cad.bounds,
        rooms: [],
        entities: (cad.entities || []).filter((e) => selectedSet.has(normalizeLayerName(e.layer)))
    };

    const floorArea = Math.max(
        0,
        (Number(cad.bounds?.maxX) - Number(cad.bounds?.minX)) *
        (Number(cad.bounds?.maxY) - Number(cad.bounds?.minY))
    );
    const targetIlots = Math.max(120, Math.min(900, Math.floor((floorArea * 0.86) / 3.2)));

    const genPayload = {
        floorPlan,
        options: {
            style: 'COSTO',
            strictMode: true,
            architecturalGuardrails: true,
            fillPlan: true,
            maximizeFill: true,
            corridorWidth: 1.2,
            oneWayFlow: true,
            layoutMode: 'rowBased',
            wallClearance: 0.05,
            boxSpacing: 0.015,
            rowGapClearance: 0.04,
            corridorGapClearance: 0.02,
            corridorInset: 0.02,
            minGapLength: 0.45,
            densityFactor: 1.15,
            totalIlots: targetIlots,
            distribution: { small: 25, medium: 35, large: 30, xlarge: 10 }
        }
    };
    if (args.removeBoxId) {
        genPayload.options.surgicalRemoveBoxId = String(args.removeBoxId);
    } else if (args.removeBoxPoint) {
        const [sxRaw, syRaw] = String(args.removeBoxPoint).split(',');
        const sx = Number(sxRaw);
        const sy = Number(syRaw);
        const sr = Number.isFinite(Number(args.removeBoxRadius)) ? Number(args.removeBoxRadius) : 1.5;
        if (Number.isFinite(sx) && Number.isFinite(sy)) {
            genPayload.options.surgicalRemoveBox = { x: sx, y: sy, radius: sr };
        }
    }

    const genRes = await request(app).post('/api/costo/generate').send(genPayload);
    if (genRes.status !== 200 || !genRes.body?.success) {
        const fail = {
            success: false,
            stage: 'generate',
            status: genRes.status,
            error: genRes.body?.error || 'Generation failed',
            issues: genRes.body?.issues || [],
            snapshot: genRes.body?.snapshot || null,
            inputFile: inputPath,
            wallSelection,
            selectedWallCount: structuralWalls.length,
            generatedAt: new Date().toISOString()
        };
        const failPath = path.join(exportsDir, `architect_locked_${baseName}_FAIL_${stamp}.json`);
        fs.writeFileSync(failPath, JSON.stringify(fail, null, 2));
        console.error(`[ArchitectLocked] FAILED -> ${failPath}`);
        process.exit(2);
    }

    const generated = genRes.body;
    const solution = {
        boxes: generated.ilots || [],
        corridors: generated.corridors || [],
        radiators: generated.radiators || [],
        circulationPaths: generated.circulationPaths || [],
        layoutMode: generated.layoutMode || 'rowBased'
    };

    const exportTitle = args.title || 'PLAN ETAGE 01 1-200';
    const expRes = await request(app)
        .post('/api/costo/export/reference-pdf')
        .send({
            solution,
            floorPlan,
            metrics: generated.metrics || {},
            presetMode: 'strictReference',
            options: {
                strictReference: true,
                presetMode: 'strictReference',
                title: exportTitle,
                documentId: '[01]',
                layoutMode: solution.layoutMode,
                floorLabels: ['PLAN ETAGE 01', 'PLAN ETAGE 02'],
                showCorridorPathways: true,
                showCirculationLines: true,
                showRadiatorLabels: false
            }
        });

    if (expRes.status !== 200 || !expRes.body?.success) {
        throw new Error(`Export failed: ${expRes.body?.error || expRes.status}`);
    }

    const exportedPdf = path.join(__dirname, '..', 'exports', expRes.body.filename);
    const finalPdf = path.join(exportsDir, `architect_locked_${baseName}_${stamp}.pdf`);
    fs.copyFileSync(exportedPdf, finalPdf);

    const qa = analyzeSolution(solution);
    const guardrailCleanup = Array.isArray(generated.phases)
        ? generated.phases.find((p) => p && p.name === 'guardrail_box_cleanup')
        : null;
    const report = {
        success: true,
        inputFile: inputPath,
        outputPdf: finalPdf,
        generatedAt: new Date().toISOString(),
        floorArea,
        targetIlots,
        selectedWallCount: structuralWalls.length,
        wallSelection,
        inferredEntrances: (cad.entrances || []).length === 0,
        entranceCount: entrances.length,
        layoutMode: solution.layoutMode,
        metrics: generated.metrics || {},
        guardrailCleanup: guardrailCleanup || null,
        qa
    };
    const reportPath = path.join(exportsDir, `architect_locked_${baseName}_${stamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`[ArchitectLocked] SUCCESS`);
    console.log(`[ArchitectLocked] PDF: ${finalPdf}`);
    console.log(`[ArchitectLocked] Report: ${reportPath}`);
    console.log(
        `[ArchitectLocked] Summary: boxes=${qa.boxes}, corridors=${qa.corridors}, ` +
        `majorCorridors=${qa.majorCorridors}, validPaths=${qa.validCirculationPaths}`
    );
}

run().catch((err) => {
    console.error(`[ArchitectLocked] ERROR: ${err.message}`);
    process.exit(1);
});
