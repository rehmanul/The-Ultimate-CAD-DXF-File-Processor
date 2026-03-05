'use strict';

const BoxPlacer = require('../../../lib/costo-engine/boxPlacer');
const CirculationRouter = require('../../../lib/costo-engine/circulationRouter');
const WallHuggingPlacer = require('../../../lib/costo-engine/wallHuggingPlacer');
const CostoProLayoutEngine = require('../../../lib/CostoProLayoutEngine');
const { segmentIntersectsRect } = require('../../../lib/costo-engine/geometry');

/**
 * Test helper: create a simple floor plan with bounds and optional internal walls
 */
function makeFloorPlan(opts = {}) {
    const bounds = opts.bounds || { minX: 0, minY: 0, maxX: 30, maxY: 20 };
    const walls = opts.walls || [];
    const entrances = opts.entrances || [];
    const forbiddenZones = opts.forbiddenZones || [];
    return { bounds, walls, entrances, forbiddenZones };
}

function defaultOptions() {
    return {
        corridorWidth: 1.2,
        boxDepth: 2.5,
        boxSpacing: 0.05
    };
}

function pointInPolygon(point, polygon) {
    const x = Number(point.x);
    const y = Number(point.y);
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = Number(polygon[i].x);
        const yi = Number(polygon[i].y);
        const xj = Number(polygon[j].x);
        const yj = Number(polygon[j].y);
        const intersect = ((yi > y) !== (yj > y)) &&
            (x < ((xj - xi) * (y - yi)) / Math.max(1e-9, (yj - yi)) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function pointToSegDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-12) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

function pointInsideOrOnPolygon(point, polygon, tolerance = 0.06) {
    if (pointInPolygon(point, polygon)) return true;
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        if (pointToSegDist(point.x, point.y, a.x, a.y, b.x, b.y) <= tolerance) return true;
    }
    return false;
}

function rectCorners(rect) {
    return [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.width, y: rect.y },
        { x: rect.x + rect.width, y: rect.y + rect.height },
        { x: rect.x, y: rect.y + rect.height }
    ];
}

describe('BoxPlacer boundary containment', () => {
    test('all boxes are within floor plan bounds', () => {
        const fp = makeFloorPlan();
        const placer = new BoxPlacer(fp, defaultOptions());
        const result = placer.placeInRooms([], { S: 25, M: 25, L: 25, XL: 25 });
        const b = fp.bounds;
        const tolerance = 0.02;

        for (const u of result.units) {
            expect(u.x).toBeGreaterThanOrEqual(b.minX - tolerance);
            expect(u.y).toBeGreaterThanOrEqual(b.minY - tolerance);
            expect(u.x + u.width).toBeLessThanOrEqual(b.maxX + tolerance);
            expect(u.y + u.height).toBeLessThanOrEqual(b.maxY + tolerance);
        }
    });

    test('all corridors are within floor plan bounds', () => {
        const fp = makeFloorPlan();
        const placer = new BoxPlacer(fp, defaultOptions());
        const result = placer.placeInRooms([], { S: 25, M: 25, L: 25, XL: 25 });
        const b = fp.bounds;
        const tolerance = 0.02;

        for (const c of result.corridors) {
            expect(c.x).toBeGreaterThanOrEqual(b.minX - tolerance);
            expect(c.y).toBeGreaterThanOrEqual(b.minY - tolerance);
            expect(c.x + c.width).toBeLessThanOrEqual(b.maxX + tolerance);
            expect(c.y + c.height).toBeLessThanOrEqual(b.maxY + tolerance);
        }
    });

    test('boxes respect internal walls', () => {
        // Add a vertical internal wall cutting the plan in half
        const fp = makeFloorPlan({
            walls: [
                { start: { x: 15, y: 0 }, end: { x: 15, y: 20 } }
            ]
        });
        const placer = new BoxPlacer(fp, defaultOptions());
        const result = placer.placeInRooms([], { S: 25, M: 25, L: 25, XL: 25 });

        // No box should cross the wall at x=15
        for (const u of result.units) {
            const crossesWall = (u.x < 15 && u.x + u.width > 15);
            expect(crossesWall).toBe(false);
        }
    });

    test('generates at least some units', () => {
        const fp = makeFloorPlan();
        const placer = new BoxPlacer(fp, defaultOptions());
        const result = placer.placeInRooms([], { S: 25, M: 25, L: 25, XL: 25 });

        expect(result.units.length).toBeGreaterThan(0);
        expect(result.corridors.length).toBeGreaterThan(0);
    });
});

describe('CirculationRouter wall-crossing check', () => {
    test('spine segments do not cross internal walls', () => {
        const fp = makeFloorPlan({
            walls: [
                { start: { x: 15, y: 0 }, end: { x: 15, y: 20 } }
            ]
        });

        // Create mock corridors on both sides of the wall
        const corridors = [
            { id: 'c1', type: 'ACCESS', direction: 'vertical', x: 5, y: 2, width: 1.2, height: 16 },
            { id: 'c2', type: 'ACCESS', direction: 'vertical', x: 10, y: 2, width: 1.2, height: 16 },
            { id: 'c3', type: 'ACCESS', direction: 'vertical', x: 20, y: 2, width: 1.2, height: 16 },
            { id: 'c4', type: 'ACCESS', direction: 'vertical', x: 25, y: 2, width: 1.2, height: 16 }
        ];

        const router = new CirculationRouter(fp, { corridorWidth: 1.2 });
        const route = router.generateRoute(corridors, []);

        // Check that no spine segment crosses x=15
        const wallSeg = { x1: 15, y1: 0, x2: 15, y2: 20 };
        for (const seg of route) {
            if (seg.type !== 'SPINE') continue;
            for (let i = 0; i < seg.path.length - 1; i++) {
                const p1 = seg.path[i];
                const p2 = seg.path[i + 1];
                const minX = Math.min(p1.x, p2.x) - 0.05;
                const minY = Math.min(p1.y, p2.y) - 0.05;
                const w = Math.abs(p2.x - p1.x) + 0.1;
                const h = Math.abs(p2.y - p1.y) + 0.1;
                const crosses = segmentIntersectsRect(
                    wallSeg.x1, wallSeg.y1, wallSeg.x2, wallSeg.y2,
                    minX, minY, minX + w, minY + h
                );
                expect(crosses).toBe(false);
            }
        }
    });

    test('route without walls generates spine segments', () => {
        const fp = makeFloorPlan(); // no walls

        const corridors = [
            { id: 'c1', type: 'ACCESS', direction: 'vertical', x: 5, y: 2, width: 1.2, height: 16 },
            { id: 'c2', type: 'ACCESS', direction: 'vertical', x: 15, y: 2, width: 1.2, height: 16 },
            { id: 'c3', type: 'ACCESS', direction: 'vertical', x: 25, y: 2, width: 1.2, height: 16 }
        ];

        const router = new CirculationRouter(fp, { corridorWidth: 1.2 });
        const route = router.generateRoute(corridors, []);

        const spines = route.filter(s => s.type === 'SPINE');
        expect(spines.length).toBeGreaterThan(0);
    });
});

describe('WallHuggingPlacer perimeter strategy', () => {
    test('reconstructs perimeter from walls when envelope is missing', () => {
        const fp = makeFloorPlan({
            bounds: { minX: 0, minY: 0, maxX: 30, maxY: 20 },
            walls: [
                { x1: 0, y1: 0, x2: 30, y2: 0 },
                { x1: 30, y1: 0, x2: 30, y2: 20 },
                { x1: 30, y1: 20, x2: 0, y2: 20 },
                { x1: 0, y1: 20, x2: 0, y2: 0 },
                { x1: 12, y1: 0, x2: 12, y2: 10 } // internal wall noise
            ]
        });
        const placer = new WallHuggingPlacer(fp, { clearance: 0.5, minSegmentLength: 0.8 });
        const perimeter = placer.computePerimeterSegments();

        expect(perimeter.perimeterPolygon.length).toBeGreaterThanOrEqual(4);
        expect(perimeter.segments.length).toBeGreaterThanOrEqual(4);
        expect(['walls', 'boundsFallback']).toContain(perimeter.source);
    });

    test('places boxes inside inset perimeter and away from wall lines', () => {
        const fp = makeFloorPlan({
            bounds: { minX: 0, minY: 0, maxX: 30, maxY: 20 },
            walls: [
                { x1: 0, y1: 0, x2: 30, y2: 0 },
                { x1: 30, y1: 0, x2: 30, y2: 20 },
                { x1: 30, y1: 20, x2: 0, y2: 20 },
                { x1: 0, y1: 20, x2: 0, y2: 0 }
            ]
        });
        const placer = new WallHuggingPlacer(fp, { clearance: 0.5, minSegmentLength: 0.8, boxDepth: 2.5 });
        const specs = [
            { type: 'S', width: 1.29, depth: 2.5 },
            { type: 'M', width: 1.49, depth: 2.5 },
            { type: 'L', width: 1.59, depth: 2.5 }
        ];
        const result = placer.placeBoxesAlongPerimeter(specs, 0.5, { gap: 0.02, targetCount: 200 });

        expect(result.units.length).toBeGreaterThan(0);
        expect(result.insetPerimeter.length).toBeGreaterThanOrEqual(4);

        for (const unit of result.units) {
            for (const corner of rectCorners(unit)) {
                expect(pointInsideOrOnPolygon(corner, result.insetPerimeter)).toBe(true);
            }
            for (const wall of fp.walls) {
                const hits = segmentIntersectsRect(
                    wall.x1, wall.y1, wall.x2, wall.y2,
                    unit.x, unit.y, unit.x + unit.width, unit.y + unit.height
                );
                expect(hits).toBe(false);
            }
        }

        for (let i = 0; i < result.units.length; i++) {
            for (let j = i + 1; j < result.units.length; j++) {
                const a = result.units[i];
                const b = result.units[j];
                const overlap =
                    a.x < b.x + b.width &&
                    a.x + a.width > b.x &&
                    a.y < b.y + b.height &&
                    a.y + a.height > b.y;
                expect(overlap).toBe(false);
            }
        }
    });
});

describe('CostoProLayoutEngine wall-hugging mode', () => {
    test('generates perimeter boxes and interior corridors', () => {
        const floorPlan = makeFloorPlan({
            bounds: { minX: 0, minY: 0, maxX: 40, maxY: 24 },
            walls: [
                { x1: 0, y1: 0, x2: 40, y2: 0 },
                { x1: 40, y1: 0, x2: 40, y2: 24 },
                { x1: 40, y1: 24, x2: 0, y2: 24 },
                { x1: 0, y1: 24, x2: 0, y2: 0 }
            ],
            entrances: [],
            forbiddenZones: []
        });

        const engine = new CostoProLayoutEngine(floorPlan, {
            layoutMode: 'wallHugging',
            wallClearanceMm: 500,
            corridorWidth: 1.2,
            boxDepth: 2.5,
            boxSpacing: 0.02
        });
        const result = engine.generate({
            distribution: { S: 25, M: 35, L: 25, XL: 15 },
            targetCount: 120
        });

        expect(result.layoutMode).toBe('wallHugging');
        expect(Array.isArray(result.units)).toBe(true);
        expect(Array.isArray(result.corridors)).toBe(true);
        expect(result.units.length).toBeGreaterThan(0);
        expect(result.corridors.length).toBeGreaterThan(0);
    });
});

describe('Corridor quality: continuity and no box in corridor', () => {
    test('every corridor has finite positive width and height (continuous strip)', () => {
        const floorPlan = makeFloorPlan({ bounds: { minX: 0, minY: 0, maxX: 25, maxY: 18 } });
        const engine = new CostoProLayoutEngine(floorPlan, defaultOptions());
        const result = engine.generate({ distribution: { S: 30, M: 30, L: 20, XL: 20 }, targetCount: 80 });
        const corridors = result.corridors || [];
        corridors.forEach((c, i) => {
            const w = Number(c.width);
            const h = Number(c.height);
            expect(Number.isFinite(w) && w > 0).toBe(true);
            expect(Number.isFinite(h) && h > 0).toBe(true);
            expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
        });
    });

    test('no box center falls inside a corridor rectangle', () => {
        const floorPlan = makeFloorPlan({ bounds: { minX: 0, minY: 0, maxX: 30, maxY: 20 } });
        const engine = new CostoProLayoutEngine(floorPlan, defaultOptions());
        const result = engine.generate({ distribution: { S: 25, M: 25, L: 25, XL: 25 }, targetCount: 60 });
        const units = result.units || [];
        const corridors = result.corridors || [];
        const tolerance = 0.02;
        units.forEach((u) => {
            const cx = u.x + (Number(u.width) || 0) / 2;
            const cy = u.y + (Number(u.height) || 0) / 2;
            corridors.forEach((c) => {
                const l = Number(c.x);
                const t = Number(c.y);
                const r = l + Number(c.width);
                const b = t + Number(c.height);
                const inside = cx >= l - tolerance && cx <= r + tolerance && cy >= t - tolerance && cy <= b + tolerance;
                expect(inside).toBe(false);
            });
        });
    });
});
