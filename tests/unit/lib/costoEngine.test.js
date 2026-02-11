'use strict';

const BoxPlacer = require('../../../lib/costo-engine/boxPlacer');
const CirculationRouter = require('../../../lib/costo-engine/circulationRouter');
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
