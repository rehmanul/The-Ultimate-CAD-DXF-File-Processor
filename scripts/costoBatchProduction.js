/**
 * COSTO Batch Production Pipeline
 * Processes every uploaded floor plan (DXF/DWG) and generates full production exports:
 * - Reference-style PDF (matches Expected output MUST.jpg)
 * - Reference PNG + SVG (SVG wraps the PNG to preserve exact visuals)
 * - Interactive SVG
 * - DWG/DXF, Excel, CSV, Report PDF
 *
 * Strict production mode: no mock/demo data, no fallback generation.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const CostoAPI = require('../lib/costoAPI');
const CostoExports = require('../lib/costoExports');
const CostoNumbering = require('../lib/costoNumbering');
const CostoBoxCatalog = require('../lib/costoBoxCatalog');
const UnitMixParser = require('../lib/unitMixParser');
const AdvancedCorridorGenerator = require('../lib/advancedCorridorGenerator');
const CostoOptimizationEngine = require('../lib/costoOptimizationEngine');
const CostoComplianceChecker = require('../lib/costoComplianceChecker');
const CostoDeviationReport = require('../lib/costoDeviationReport');
const UnitSizeCalculator = require('../lib/unitSizeCalculator');
const DxfParser = require('dxf-parser');
const dxfProcessor = require('../lib/dxfProcessor');
const { extractGridCells } = require('../lib/gridCellExtractor');
const { sanitizeCorridor } = require('../lib/sanitizers');

const DEFAULT_UNIT_MIX = path.join(__dirname, '..', 'Samples', 'sample-unit-mix.csv');
const DEFAULT_INPUT_DIRS = [
    path.join(__dirname, '..', 'Samples', 'Files'),
    path.join(__dirname, '..', 'Samples'),
    path.join(__dirname, '..', 'uploads')
];

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function collectCadFiles(directories) {
    const exts = new Set(['.dxf', '.dwg']);
    const found = [];
    const seen = new Set();
    const ignoredDirs = new Set([
        'Ref. Output Samples',
        'Output',
        'exports',
        'node_modules'
    ]);

    const walk = (dir) => {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (ignoredDirs.has(entry.name)) {
                    continue;
                }
                walk(fullPath);
                continue;
            }
            const ext = path.extname(entry.name).toLowerCase();
            if (!exts.has(ext)) continue;
            const resolved = path.resolve(fullPath);
            if (seen.has(resolved)) continue;
            seen.add(resolved);
            found.push(resolved);
        }
    };

    directories.forEach(walk);
    return found;
}

function groupCadFiles(files) {
    const groups = new Map();
    files.forEach((file) => {
        const parsed = path.parse(file);
        const key = path.join(parsed.dir, parsed.name).toLowerCase();
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(file);
    });

    const priority = (file) => {
        const ext = path.extname(file).toLowerCase();
        if (ext === '.dxf') return 0;
        if (ext === '.dwg') return 1;
        return 2;
    };

    return Array.from(groups.values()).map(group => group.sort((a, b) => priority(a) - priority(b)));
}

function normalizeTypologyName(name) {
    const raw = String(name || '').trim();
    if (!raw) return null;
    const upper = raw.toUpperCase();

    if (upper.startsWith('XL') || upper.includes('EXTRA')) return 'XL';
    if (upper.startsWith('L') || upper.includes('LARGE')) return 'L';
    if (upper.startsWith('M') || upper.includes('MED')) return 'M';
    if (upper.startsWith('S') || upper.includes('SMALL')) return 'S';

    return null;
}

function normalizeUnitMix(unitMix) {
    if (!unitMix || !Array.isArray(unitMix.typologies)) {
        throw new Error('Unit mix must include typologies array');
    }

    const merged = new Map();
    unitMix.typologies.forEach((typo) => {
        const normalized = normalizeTypologyName(typo.name);
        if (!normalized) {
            throw new Error(`Unrecognized unit mix typology "${typo.name}". Provide S/M/L/XL compatible names.`);
        }

        const targetArea = Number(typo.targetArea);
        const tolerance = Number(typo.tolerance || 0);
        if (!Number.isFinite(targetArea) || targetArea <= 0) {
            throw new Error(`Invalid targetArea for typology "${typo.name}"`);
        }
        if (!Number.isFinite(tolerance) || tolerance < 0) {
            throw new Error(`Invalid tolerance for typology "${typo.name}"`);
        }

        if (!merged.has(normalized)) {
            merged.set(normalized, {
                name: normalized,
                targetArea: 0,
                tolerance: 0,
                minArea: 0,
                maxArea: 0,
                priority: 'souhaitable',
                count: 0
            });
        }

        const entry = merged.get(normalized);
        entry.targetArea += targetArea;
        entry.tolerance += tolerance;
        if (typo.priority === 'obligatoire') {
            entry.priority = 'obligatoire';
        }
    });

    const typologies = Array.from(merged.values()).map((entry) => {
        entry.minArea = Math.max(0, entry.targetArea - entry.tolerance);
        entry.maxArea = entry.targetArea + entry.tolerance;
        return entry;
    });

    const totals = typologies.reduce((acc, entry) => {
        acc.targetArea += entry.targetArea;
        acc.totalTolerance += entry.tolerance;
        return acc;
    }, { targetArea: 0, totalTolerance: 0 });

    return {
        typologies,
        totals: {
            targetArea: totals.targetArea,
            totalTolerance: totals.totalTolerance,
            minArea: totals.targetArea - totals.totalTolerance,
            maxArea: totals.targetArea + totals.totalTolerance,
            typeCount: typologies.length
        },
        metadata: {
            ...(unitMix.metadata || {}),
            normalizedAt: new Date().toISOString(),
            normalized: true
        }
    };
}

let cachedLibreDwg = null;
let cachedLibredwgPkg = null;

function resolveLibreDwgWasmDir() {
    try {
        const resolvedEntry = require.resolve('@mlightcad/libredwg-web');
        const distDir = path.dirname(resolvedEntry);
        const candidate = path.normalize(path.join(distDir, '..', 'wasm'));
        const wasmPath = path.join(candidate, 'libredwg-web.wasm');
        if (fs.existsSync(wasmPath)) {
            return candidate;
        }
    } catch (e) {
        // Ignore and fallback below
    }
    return path.normalize(path.join(process.cwd(), 'node_modules', '@mlightcad', 'libredwg-web', 'wasm'));
}

async function extractDwgEntities(dwgPath) {
    const buffer = fs.readFileSync(dwgPath);
    if (!cachedLibredwgPkg) {
        const pkg = require('@mlightcad/libredwg-web');
        cachedLibredwgPkg = pkg.default || pkg;
    }
    const { LibreDwg, Dwg_File_Type } = cachedLibredwgPkg;

    if (!cachedLibreDwg) {
        const wasmDir = resolveLibreDwgWasmDir();
        cachedLibreDwg = await LibreDwg.create(wasmDir);
    }

    const dwgInstance = cachedLibreDwg;
    const data = dwgInstance.dwg_read_data(new Uint8Array(buffer), Dwg_File_Type.DWG);
    if (!data) {
        throw new Error('DWG parsing failed (no data returned)');
    }

    const { database } = dwgInstance.convertEx(data) || {};
    if (typeof dwgInstance.dwg_free === 'function') {
        try { dwgInstance.dwg_free(data); } catch (e) { /* non-fatal */ }
    }

    if (!database || !Array.isArray(database.entities) || database.entities.length === 0) {
        throw new Error('DWG conversion returned no entities');
    }

    const entities = [];
    for (const ent of database.entities) {
        if (!ent || !ent.type) continue;
        const layer = ent.layer || '0';
        const colorIndex = ent.colorIndex || (ent.color && ent.color.index) || 0;
        if (ent.type === 'LINE') {
            const s = ent.startPoint || ent.start;
            const e = ent.endPoint || ent.end;
            if (!s || !e) continue;
            entities.push({
                type: 'LINE',
                layer,
                colorIndex,
                color: colorIndex,
                start: { x: s.x, y: s.y },
                end: { x: e.x, y: e.y }
            });
        } else if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
            const verts = ent.vertices || [];
            if (verts.length < 2) continue;
            entities.push({
                type: 'LWPOLYLINE',
                layer,
                colorIndex,
                color: colorIndex,
                vertices: verts.map(v => ({ x: v.x, y: v.y })),
                closed: ent.closed === true || ent.isClosed === true || ent.shape === true
            });
        }
    }

    if (!entities.length) {
        throw new Error('DWG conversion produced no usable LINE/LWPOLYLINE entities');
    }

    return { entities };
}

function computeSurfaceAreasByZone(boxes) {
    const zones = {};
    boxes.forEach((box) => {
        const zone = box.zone || 'ZONE_1';
        if (!zones[zone]) {
            zones[zone] = { boxes: [], totalArea: 0, boxCount: 0 };
        }
        const area = box.area || (box.width * box.height);
        zones[zone].boxes.push(box);
        zones[zone].totalArea += area;
        zones[zone].boxCount += 1;
    });

    Object.keys(zones).forEach((zone) => {
        const data = zones[zone];
        data.averageArea = data.totalArea / data.boxCount;
        data.minArea = Math.min(...data.boxes.map(b => b.area || b.width * b.height));
        data.maxArea = Math.max(...data.boxes.map(b => b.area || b.width * b.height));
    });

    return zones;
}

function parseDxfWithProcessor(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parser = new DxfParser();
    const dxf = parser.parseSync(content);
    return dxfProcessor.processParsedDXF(dxf);
}

function parseEntitiesWithProcessor(dxfLike) {
    if (!dxfLike || !Array.isArray(dxfLike.entities)) {
        return null;
    }
    return dxfProcessor.processParsedDXF(dxfLike);
}

function mergeFloorPlans(primary, enriched) {
    if (!enriched) return primary;
    const merged = {
        ...primary,
        ...enriched
    };

    merged.bounds = enriched.bounds && Number.isFinite(enriched.bounds.minX) ? enriched.bounds : primary.bounds;
    merged.walls = (enriched.walls && enriched.walls.length) ? enriched.walls : primary.walls;
    merged.rooms = (enriched.rooms && enriched.rooms.length) ? enriched.rooms : primary.rooms;
    merged.forbiddenZones = (enriched.forbiddenZones && enriched.forbiddenZones.length) ? enriched.forbiddenZones : primary.forbiddenZones;
    merged.entrances = (enriched.entrances && enriched.entrances.length) ? enriched.entrances : primary.entrances;
    merged.exits = (enriched.exits && enriched.exits.length) ? enriched.exits : primary.exits;
    merged.envelope = (enriched.envelope && enriched.envelope.length) ? enriched.envelope : primary.envelope;
    merged.staircases = (enriched.staircases && enriched.staircases.length) ? enriched.staircases : primary.staircases;
    merged.specialRooms = (enriched.specialRooms && enriched.specialRooms.length) ? enriched.specialRooms : primary.specialRooms;
    merged.greenZones = (enriched.greenZones && enriched.greenZones.length) ? enriched.greenZones : primary.greenZones;

    return merged;
}

function resolveTypologyForArea(area, unitMix) {
    if (!unitMix || !Array.isArray(unitMix.typologies)) return 'M';
    const target = Number(area);
    if (!Number.isFinite(target)) return 'M';

    let best = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const typo of unitMix.typologies) {
        const min = Number.isFinite(typo.minArea) ? typo.minArea : typo.targetArea - (typo.tolerance || 0);
        const max = Number.isFinite(typo.maxArea) ? typo.maxArea : typo.targetArea + (typo.tolerance || 0);
        if (Number.isFinite(min) && Number.isFinite(max) && target >= min && target <= max) {
            return typo.name;
        }
        const center = Number.isFinite(typo.targetArea) ? typo.targetArea : (min + max) / 2;
        if (Number.isFinite(center)) {
            const diff = Math.abs(center - target);
            if (diff < bestDiff) {
                bestDiff = diff;
                best = typo.name;
            }
        }
    }
    return best || 'M';
}

function buildBoxesFromRooms(floorPlan, unitMix) {
    const rooms = Array.isArray(floorPlan.rooms) ? floorPlan.rooms : [];
    const boxes = [];
    let index = 1;

    rooms.forEach((room) => {
        const bounds = room.bounds;
        if (!bounds || !Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY) ||
            !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.maxY)) {
            return;
        }
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;
        if (width <= 0 || height <= 0) return;

        const area = Number.isFinite(room.area) ? room.area : width * height;
        const unitSize = UnitSizeCalculator.calculateUnitSizeLabel(area);
        const type = resolveTypologyForArea(area, unitMix);

        boxes.push({
            id: `BOX_${index++}`,
            x: bounds.minX,
            y: bounds.minY,
            width,
            height,
            area,
            type,
            unitSize,
            roomId: room.id,
            roomLabel: room.name || room.label || null
        });
    });

    return boxes;
}

function splitFloorPlanByRoomClusters(floorPlan) {
    const rooms = Array.isArray(floorPlan.rooms) ? floorPlan.rooms : [];
    if (rooms.length < 80) return null;

    const centers = rooms.map((room) => {
        const bounds = room.bounds;
        if (!bounds) return null;
        const cx = (bounds.minX + bounds.maxX) / 2;
        const cy = (bounds.minY + bounds.maxY) / 2;
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
        return { room, cx, cy };
    }).filter(Boolean);

    if (centers.length < 80) return null;
    centers.sort((a, b) => a.cy - b.cy);

    let maxGap = 0;
    let splitIndex = -1;
    for (let i = 1; i < centers.length; i++) {
        const gap = centers[i].cy - centers[i - 1].cy;
        if (gap > maxGap) {
            maxGap = gap;
            splitIndex = i;
        }
    }

    const bounds = floorPlan.bounds || {};
    const height = Number.isFinite(bounds.maxY) && Number.isFinite(bounds.minY) ? bounds.maxY - bounds.minY : 0;
    if (splitIndex < 0 || maxGap < Math.max(3, height * 0.12)) {
        return null;
    }

    const lowerRooms = centers.slice(0, splitIndex).map(c => c.room);
    const upperRooms = centers.slice(splitIndex).map(c => c.room);
    if (lowerRooms.length < 20 || upperRooms.length < 20) return null;

    const buildFloor = (roomsSubset) => {
        const boundsLocal = roomsSubset.reduce((acc, room) => {
            const b = room.bounds;
            if (!b) return acc;
            acc.minX = Math.min(acc.minX, b.minX);
            acc.minY = Math.min(acc.minY, b.minY);
            acc.maxX = Math.max(acc.maxX, b.maxX);
            acc.maxY = Math.max(acc.maxY, b.maxY);
            return acc;
        }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

        const boundsReady = (Number.isFinite(boundsLocal.minX) && Number.isFinite(boundsLocal.minY) &&
            Number.isFinite(boundsLocal.maxX) && Number.isFinite(boundsLocal.maxY))
            ? boundsLocal
            : floorPlan.bounds;

        const filterByBounds = (items, getCenter) => {
            if (!Array.isArray(items)) return [];
            return items.filter((item) => {
                const center = getCenter(item);
                if (!center) return false;
                return center.x >= boundsReady.minX - 1 && center.x <= boundsReady.maxX + 1 &&
                    center.y >= boundsReady.minY - 1 && center.y <= boundsReady.maxY + 1;
            });
        };

        return {
            ...floorPlan,
            bounds: boundsReady,
            rooms: roomsSubset,
            walls: filterByBounds(floorPlan.walls, (wall) => {
                if (!wall.start || !wall.end) return null;
                return {
                    x: (wall.start.x + wall.end.x) / 2,
                    y: (wall.start.y + wall.end.y) / 2
                };
            }),
            entrances: filterByBounds(floorPlan.entrances, (ent) => ent.center || ent.start),
            exits: filterByBounds(floorPlan.exits, (exit) => exit.center || exit.start),
            forbiddenZones: filterByBounds(floorPlan.forbiddenZones, (zone) => {
                const b = zone.bounds;
                if (b) return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
                return null;
            })
        };
    };

    return {
        floors: [
            buildFloor(upperRooms),
            buildFloor(lowerRooms)
        ]
    };
}

function splitBoxesByY(boxes, bounds) {
    if (!Array.isArray(boxes) || boxes.length < 120) return null;
    const centers = boxes
        .map((box) => ({
            box,
            cy: box.y + (box.height / 2)
        }))
        .filter((item) => Number.isFinite(item.cy))
        .sort((a, b) => a.cy - b.cy);

    if (centers.length < 120) return null;
    let maxGap = 0;
    let splitIndex = -1;
    for (let i = 1; i < centers.length; i++) {
        const gap = centers[i].cy - centers[i - 1].cy;
        if (gap > maxGap) {
            maxGap = gap;
            splitIndex = i;
        }
    }

    const height = bounds && Number.isFinite(bounds.maxY) && Number.isFinite(bounds.minY)
        ? bounds.maxY - bounds.minY
        : 0;
    if (splitIndex < 0 || maxGap < Math.max(3, height * 0.12)) {
        if (height > 0 && boxes.length > 300 && height > (bounds.maxX - bounds.minX) * 1.1) {
            const minY = bounds.minY;
            const cutoff = minY + height * 0.22;
            const lowerBoxes = boxes.filter(b => (b.y + b.height / 2) <= cutoff);
            const upperBoxes = boxes.filter(b => (b.y + b.height / 2) > cutoff);
            if (lowerBoxes.length >= 30 && upperBoxes.length >= 30) {
                return { lowerBoxes, upperBoxes };
            }
        }
        return null;
    }

    const lowerBoxes = centers.slice(0, splitIndex).map(c => c.box);
    const upperBoxes = centers.slice(splitIndex).map(c => c.box);
    if (lowerBoxes.length < 30 || upperBoxes.length < 30) return null;

    return { lowerBoxes, upperBoxes };
}

function buildFloorPlanFromBoxes(floorPlan, boxes) {
    const boundsLocal = boxes.reduce((acc, box) => {
        acc.minX = Math.min(acc.minX, box.x);
        acc.minY = Math.min(acc.minY, box.y);
        acc.maxX = Math.max(acc.maxX, box.x + box.width);
        acc.maxY = Math.max(acc.maxY, box.y + box.height);
        return acc;
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

    const boundsReady = (Number.isFinite(boundsLocal.minX) && Number.isFinite(boundsLocal.minY) &&
        Number.isFinite(boundsLocal.maxX) && Number.isFinite(boundsLocal.maxY))
        ? boundsLocal
        : floorPlan.bounds;

    const filterByBounds = (items, getCenter) => {
        if (!Array.isArray(items)) return [];
        return items.filter((item) => {
            const center = getCenter(item);
            if (!center) return false;
            return center.x >= boundsReady.minX - 1 && center.x <= boundsReady.maxX + 1 &&
                center.y >= boundsReady.minY - 1 && center.y <= boundsReady.maxY + 1;
        });
    };

    return {
        ...floorPlan,
        bounds: boundsReady,
        walls: filterByBounds(floorPlan.walls, (wall) => {
            if (!wall.start || !wall.end) return null;
            return {
                x: (wall.start.x + wall.end.x) / 2,
                y: (wall.start.y + wall.end.y) / 2
            };
        }),
        entrances: filterByBounds(floorPlan.entrances, (ent) => ent.center || ent.start),
        exits: filterByBounds(floorPlan.exits, (exit) => exit.center || exit.start),
        forbiddenZones: filterByBounds(floorPlan.forbiddenZones, (zone) => {
            const b = zone.bounds;
            if (b) return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
            return null;
        }),
        rooms: []
    };
}

function buildCorridors(floorPlan, boxes, corridorWidth) {
    const ilots = boxes.map((box) => ({
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height
    }));

    const heights = ilots.map(i => i.height).filter(h => Number.isFinite(h) && h > 0).sort((a, b) => a - b);
    const medianHeight = heights.length ? heights[Math.floor(heights.length / 2)] : corridorWidth;
    const rowTolerance = Math.max(0.8, medianHeight * 0.6);

    const corridorGenerator = new AdvancedCorridorGenerator({
        walls: floorPlan.walls || [],
        forbiddenZones: floorPlan.forbiddenZones || [],
        entrances: floorPlan.exits || floorPlan.entrances || [],
        bounds: floorPlan.bounds,
        rooms: floorPlan.rooms || []
    }, ilots, {
        corridorWidth,
        margin: Math.max(0.3, corridorWidth * 0.2),
        minCorridorLength: 1.0,
        generateVertical: true,
        generateHorizontal: true,
        rowTolerance,
        minRowDistance: Math.max(corridorWidth * 0.8, 1.2),
        maxRowDistance: Math.max(corridorWidth * 6, 6.0),
        minOverlap: 0.35
    });

    const result = corridorGenerator.generate();
    return (result.corridors || [])
        .map((corridor, idx) => {
            const clean = sanitizeCorridor(corridor);
            if (!clean) return null;
            const corners = clean.polygon || (clean.x !== undefined && clean.y !== undefined ? [
                [clean.x, clean.y],
                [clean.x + (clean.width || corridorWidth), clean.y],
                [clean.x + (clean.width || corridorWidth), clean.y + (clean.height || corridorWidth)],
                [clean.x, clean.y + (clean.height || corridorWidth)]
            ] : []);

            return {
                id: clean.id || `CORR_${idx + 1}`,
                x: clean.x,
                y: clean.y,
                width: clean.width,
                height: clean.height,
                corners
            };
        })
        .filter(Boolean);
}

function computeSolutionMetrics(floorPlan, unitMix, rules, solution) {
    const optimizer = new CostoOptimizationEngine(floorPlan, unitMix, rules);
    return optimizer.calculateMetrics(solution);
}

function computeComplianceAndDeviation(floorPlan, unitMix, rules, solution, metrics) {
    const complianceChecker = new CostoComplianceChecker(floorPlan, rules);
    const compliance = complianceChecker.check(solution);
    const deviationReport = new CostoDeviationReport(unitMix, { ...solution, metrics, floorPlan });
    const deviation = deviationReport.generate();
    return { compliance, deviation };
}

async function renderReferenceImageFromSvg(svgPath, outputBase) {
    const svgBuffer = fs.readFileSync(svgPath);
    const pngPath = `${outputBase}.png`;
    const jpgPath = `${outputBase}.jpg`;

    await sharp(svgBuffer)
        .png()
        .toFile(pngPath);

    await sharp(pngPath)
        .jpeg({ quality: 92 })
        .toFile(jpgPath);

    return { pngPath, jpgPath };
}

async function run() {
    console.log('='.repeat(80));
    console.log('COSTO Batch Production Pipeline');
    console.log('Full production exports for every uploaded floor plan');
    console.log('='.repeat(80));

    const unitMixPath = process.env.UNIT_MIX_FILE || DEFAULT_UNIT_MIX;
    if (!fs.existsSync(unitMixPath)) {
        throw new Error(`Unit mix file not found: ${unitMixPath}`);
    }

    const rawUnitMix = UnitMixParser.parseFile(unitMixPath, path.basename(unitMixPath));
    const unitMix = normalizeUnitMix(rawUnitMix);

    unitMix.typologies.forEach((typo) => {
        const template = CostoBoxCatalog.getTemplate(typo.name);
        if (!template) {
            throw new Error(`Missing COSTO template for typology "${typo.name}". Add a template before running.`);
        }
    });

    const files = collectCadFiles(DEFAULT_INPUT_DIRS);
    if (!files.length) {
        throw new Error('No DXF/DWG files found in Samples/Files or Samples/');
    }
    const fileGroups = groupCadFiles(files);

    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const outputRoot = path.join(__dirname, '..', 'exports', `costo_batch_${runId}`);
    ensureDir(outputRoot);

    const rules = {
        mainCorridorWidth: 1.5,
        secondaryCorridorWidth: 1.2,
        minClearance: 0.3,
        roundingArea: 0.5,
        roundingDimension: 0.1,
        maxDistanceToExit: 30.0,
        minClearanceFireDoor: 1.5
    };

    const optimizationOptions = {
        method: 'hybrid',
        maxIterations: 150,
        populationSize: 75
    };

    const summary = [];
    const failures = [];

    for (const group of fileGroups) {
        let processed = false;
        let lastError = null;

        for (const filePath of group) {
            const ext = path.extname(filePath).toLowerCase();
            const baseName = path.basename(filePath, ext);
            const relativePath = path.relative(path.join(__dirname, '..'), filePath);
            const safeName = relativePath
                .replace(/[:\\/]/g, '_')
                .replace(/\s+/g, '_')
                .replace(/\./g, '_');
            const outputDir = path.join(outputRoot, safeName);
            ensureDir(outputDir);

            console.log(`\nProcessing: ${filePath}`);
            try {
                let floorPlan = null;

            if (ext === '.dwg') {
                console.log('  Parsing DWG with LibreDWG -> COSTO layer standard...');
                const dxfLike = await extractDwgEntities(filePath);
                floorPlan = CostoAPI.processWithCostoLayers(dxfLike);
                const enriched = parseEntitiesWithProcessor(dxfLike);
                floorPlan = mergeFloorPlans(floorPlan, enriched);
            } else {
                console.log('  Parsing CAD with COSTO layer standard...');
                floorPlan = await CostoAPI.processCADFile(filePath);
                const enriched = parseDxfWithProcessor(filePath);
                floorPlan = mergeFloorPlans(floorPlan, enriched);
            }

            if (!floorPlan || !floorPlan.bounds ||
                !Number.isFinite(floorPlan.bounds.minX) ||
                !Number.isFinite(floorPlan.bounds.minY) ||
                !Number.isFinite(floorPlan.bounds.maxX) ||
                !Number.isFinite(floorPlan.bounds.maxY) ||
                floorPlan.bounds.maxX <= floorPlan.bounds.minX ||
                floorPlan.bounds.maxY <= floorPlan.bounds.minY) {
                throw new Error(`Invalid bounds extracted from ${filePath}. Aborting to avoid non-production output.`);
            }

            if ((!Array.isArray(floorPlan.walls) || floorPlan.walls.length === 0) &&
                (!Array.isArray(floorPlan.envelope) || floorPlan.envelope.length === 0)) {
                throw new Error(`No usable geometry extracted from ${filePath}. Aborting to avoid fallback output.`);
            }

            if (!Array.isArray(floorPlan.entrances) || floorPlan.entrances.length === 0) {
                if (Array.isArray(floorPlan.exits) && floorPlan.exits.length > 0) {
                    floorPlan.entrances = floorPlan.exits;
                }
            }

            const corridorWidth = rules.secondaryCorridorWidth;
            const roomBoxes = buildBoxesFromRooms(floorPlan, unitMix);
            const gridBoxes = roomBoxes.length < 50
                ? extractGridCells(floorPlan, null, unitMix.typologies, {
                    strictValidation: false,
                    minCellArea: 0.5,
                    maxCellArea: 40
                })
                : [];
            const useRoomBoxes = roomBoxes.length >= 50;
            const useGridBoxes = !useRoomBoxes && gridBoxes.length >= 20;
            let solution = null;
            let metrics = null;
            let compliance = null;
            let deviation = null;
            let exportFloorPlans = null;
            let exportSolutions = null;
            let useMultiFloor = false;
            let result = null;

            if (useRoomBoxes) {
                console.log(`  Using ${roomBoxes.length} DXF rooms as production boxes...`);
                const multi = splitFloorPlanByRoomClusters(floorPlan);
                if (multi && Array.isArray(multi.floors) && multi.floors.length >= 2) {
                    useMultiFloor = true;
                    exportFloorPlans = multi.floors.slice(0, 2);
                    exportSolutions = exportFloorPlans.map((fp) => {
                        const boxes = buildBoxesFromRooms(fp, unitMix);
                        const corridors = buildCorridors(fp, boxes, corridorWidth);
                        return { boxes, corridors };
                    });
                    const combinedBoxes = exportSolutions.flatMap(s => s.boxes);
                    const combinedCorridors = exportSolutions.flatMap(s => s.corridors);
                    console.log(`  Multi-floor detected: ${exportFloorPlans.length} floors, ${combinedBoxes.length} boxes`);

                    const numberedBoxes = CostoNumbering.applyNumbering(combinedBoxes, {
                        scheme: 'default',
                        startZone: 1,
                        startRow: 1,
                        startNumber: 1
                    });

                    solution = {
                        boxes: numberedBoxes,
                        corridors: combinedCorridors
                    };
                } else {
                    console.log('  Generating corridors from DXF rooms...');
                    const corridors = buildCorridors(floorPlan, roomBoxes, corridorWidth);
                    const numberedBoxes = CostoNumbering.applyNumbering(roomBoxes, {
                        scheme: 'default',
                        startZone: 1,
                        startRow: 1,
                        startNumber: 1
                    });
                    solution = {
                        boxes: numberedBoxes,
                        corridors
                    };
                }

                metrics = computeSolutionMetrics(floorPlan, unitMix, rules, solution);
                const complianceData = computeComplianceAndDeviation(floorPlan, unitMix, rules, solution, metrics);
                compliance = complianceData.compliance;
                deviation = complianceData.deviation;
            } else if (useGridBoxes) {
                console.log(`  Using ${gridBoxes.length} grid-extracted cells as production boxes...`);
                const split = splitBoxesByY(gridBoxes, floorPlan.bounds);
                if (split) {
                    useMultiFloor = true;
                    const upperPlan = buildFloorPlanFromBoxes(floorPlan, split.upperBoxes);
                    const lowerPlan = buildFloorPlanFromBoxes(floorPlan, split.lowerBoxes);
                    exportFloorPlans = [upperPlan, lowerPlan];

                    exportSolutions = exportFloorPlans.map((fp, index) => {
                        const boxes = index === 0 ? split.upperBoxes : split.lowerBoxes;
                        const corridors = buildCorridors(fp, boxes, corridorWidth);
                        return { boxes, corridors };
                    });

                    const combinedBoxes = exportSolutions.flatMap(s => s.boxes);
                    const combinedCorridors = exportSolutions.flatMap(s => s.corridors);
                    console.log(`  Multi-floor detected from grid: ${exportFloorPlans.length} floors, ${combinedBoxes.length} boxes`);

                    const numberedBoxes = CostoNumbering.applyNumbering(combinedBoxes, {
                        scheme: 'default',
                        startZone: 1,
                        startRow: 1,
                        startNumber: 1
                    });

                    solution = {
                        boxes: numberedBoxes,
                        corridors: combinedCorridors
                    };
                } else {
                    const corridors = buildCorridors(floorPlan, gridBoxes, corridorWidth);
                    const numberedBoxes = CostoNumbering.applyNumbering(gridBoxes, {
                        scheme: 'default',
                        startZone: 1,
                        startRow: 1,
                        startNumber: 1
                    });
                    solution = {
                        boxes: numberedBoxes,
                        corridors
                    };
                }

                metrics = computeSolutionMetrics(floorPlan, unitMix, rules, solution);
                const complianceData = computeComplianceAndDeviation(floorPlan, unitMix, rules, solution, metrics);
                compliance = complianceData.compliance;
                deviation = complianceData.deviation;
            } else {
                console.log('  Generating optimized layout...');
                result = CostoAPI.generateLayout(floorPlan, unitMix, rules, optimizationOptions);
                if (!result || !result.solution || !Array.isArray(result.solution.boxes) || result.solution.boxes.length === 0) {
                    throw new Error(`Layout generation produced no boxes for ${filePath}. Aborting to avoid fallback output.`);
                }

                console.log('  Applying numbering...');
                const numberedBoxes = CostoNumbering.applyNumbering(result.solution.boxes, {
                    scheme: 'default',
                    startZone: 1,
                    startRow: 1,
                    startNumber: 1
                });

                console.log('  Generating corridors...');
                const corridors = buildCorridors(floorPlan, numberedBoxes, corridorWidth);

                solution = {
                    ...result.solution,
                    boxes: numberedBoxes,
                    corridors
                };
                metrics = result.metrics || computeSolutionMetrics(floorPlan, unitMix, rules, solution);
                if (result.compliance && result.deviation) {
                    compliance = result.compliance;
                    deviation = result.deviation;
                } else {
                    const complianceData = computeComplianceAndDeviation(floorPlan, unitMix, rules, solution, metrics);
                    compliance = complianceData.compliance;
                    deviation = complianceData.deviation;
                }
            }

            const surfaceAreas = computeSurfaceAreasByZone(solution.boxes || []);
            metrics = {
                ...(metrics || {}),
                surfaceAreas
            };

            console.log('  Exporting reference PDF...');
            const referencePdfBytes = await CostoExports.exportToReferencePDF(solution, floorPlan, metrics, {
                pageSize: 'A1',
                title: `COSTO V1 - ${baseName}`,
                scale: '1:200',
                drawingNumber: '[01]',
                showLegend: true,
                showTitleBlock: true,
                showDimensions: true,
                showUnitLabels: true,
                companyName: 'COSTO',
                companyAddress: '5 chemin de la dime 95700 Roissy FRANCE',
                includeCompass: true,
                multiFloor: useMultiFloor,
                floorPlans: exportFloorPlans,
                solutions: exportSolutions
            });
            const referencePdfPath = path.join(outputDir, `${baseName}_reference.pdf`);
            fs.writeFileSync(referencePdfPath, referencePdfBytes);

            console.log('  Exporting reference SVG...');
            const referenceSvgBuffer = CostoExports.exportToReferenceSVG(solution, floorPlan, metrics, {
                pageSize: 'A1',
                title: `COSTO V1 - ${baseName}`,
                scale: '1:200',
                drawingNumber: '[01]',
                showLegend: true,
                showTitleBlock: true,
                showUnitLabels: true,
                companyName: 'COSTO',
                companyAddress: '5 chemin de la dime 95700 Roissy FRANCE',
                multiFloor: useMultiFloor,
                floorPlans: exportFloorPlans,
                solutions: exportSolutions
            });
            const referenceSvgPath = path.join(outputDir, `${baseName}_reference.svg`);
            fs.writeFileSync(referenceSvgPath, referenceSvgBuffer);

            console.log('  Exporting reference PNG/JPG...');
            const { pngPath, jpgPath } = await renderReferenceImageFromSvg(referenceSvgPath, path.join(outputDir, `${baseName}_reference`));

            console.log('  Exporting interactive SVG...');
            const interactiveSvg = await CostoExports.exportToInteractiveSVG(solution, floorPlan, {
                width: 2400,
                height: 1600,
                interactive: true,
                showGrid: true
            });
            const interactiveSvgPath = path.join(outputDir, `${baseName}_interactive.svg`);
            fs.writeFileSync(interactiveSvgPath, interactiveSvg);

            console.log('  Exporting DWG/DXF...');
            const dwgContent = CostoExports.exportToDWG(solution, floorPlan, {
                includeOriginal: true,
                separateLayers: true
            });
            const dwgPath = path.join(outputDir, `${baseName}_layout.dxf`);
            fs.writeFileSync(dwgPath, dwgContent);

            console.log('  Exporting Excel/CSV...');
            const excelBuffer = CostoExports.exportToExcel(solution, unitMix, deviation, {});
            const excelPath = path.join(outputDir, `${baseName}_data.xlsx`);
            fs.writeFileSync(excelPath, excelBuffer);

            const csvContent = CostoExports.exportToCSV(solution, {});
            const csvPath = path.join(outputDir, `${baseName}_data.csv`);
            fs.writeFileSync(csvPath, csvContent);

            console.log('  Exporting report PDF...');
            const reportPdfBytes = await CostoExports.exportReportPDF(solution, metrics, compliance, deviation, {
                assumptions: [
                    'Scale: 1:200',
                    'Unit mix based on provided file',
                    'Circulation width: 1.5m main, 1.2m secondary',
                    'Minimum clearance: 0.3m from walls',
                    'Maximum distance to exit: 30m'
                ],
                version: '1.0'
            });
            const reportPath = path.join(outputDir, `${baseName}_report.pdf`);
            fs.writeFileSync(reportPath, reportPdfBytes);

                summary.push({
                    file: filePath,
                    outputs: {
                        referencePdf: referencePdfPath,
                        referencePng: pngPath,
                        referenceJpg: jpgPath,
                        referenceSvg: referenceSvgPath,
                        interactiveSvg: interactiveSvgPath,
                        dwg: dwgPath,
                        excel: excelPath,
                        csv: csvPath,
                        report: reportPath
                    }
                });

                console.log(`  ✅ Completed: ${baseName}`);
                processed = true;
                break;
            } catch (error) {
                lastError = error;
                console.error(`  ❌ Failed: ${baseName} (${error.message || error})`);
                if (group.length > 1) {
                    console.log('  -> Trying alternate source for this plan...');
                }
            }
        }

        if (!processed && lastError) {
            failures.push({ file: group[0], error: lastError.message || String(lastError) });
        }
    }

    const summaryPath = path.join(outputRoot, 'batch_summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify({ generatedAt: new Date().toISOString(), summary, failures }, null, 2));
    console.log('\nAll floor plans processed.');
    console.log(`Output root: ${outputRoot}`);
    console.log(`Summary: ${summaryPath}`);
    if (failures.length > 0) {
        console.log(`Failures: ${failures.length}`);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    run().catch((err) => {
        console.error('Batch pipeline failed:', err.message || err);
        process.exit(1);
    });
}

module.exports = { run };
