'use strict';

const CorridorShadowAnalyzer = require('../../../lib/costo-engine/corridorShadowAnalyzer');

function makeBounds(minX = 0, minY = 0, maxX = 30, maxY = 20) {
    return { minX, minY, maxX, maxY };
}

const DEFAULT_OPTS = {
    boxDepth:      1.60,
    corridorWidth: 0.80,
    minBoxWidth:   0.70,
    wallClearance: 0.05,
};

// ─────────────────────────────────────────────────────────────────────────────
describe('CorridorShadowAnalyzer — aisle positions', () => {

    test('returns at least one aisle for a typical warehouse plan', () => {
        const analyzer = new CorridorShadowAnalyzer(makeBounds(), [], [], DEFAULT_OPTS);
        const shadows = analyzer.analyze();
        expect(shadows.length).toBeGreaterThan(0);
    });

    test('aisle Y is between bounds.minY and bounds.maxY', () => {
        const b = makeBounds(0, 0, 40, 24);
        const analyzer = new CorridorShadowAnalyzer(b, [], [], DEFAULT_OPTS);
        const shadows = analyzer.analyze();
        for (const s of shadows) {
            expect(s.aisleY).toBeGreaterThanOrEqual(b.minY);
            expect(s.aisleY + s.aisleH).toBeLessThanOrEqual(b.maxY + 0.01);
        }
    });

    test('row-below and row-above Y edges are within plan bounds', () => {
        const b = makeBounds();
        const analyzer = new CorridorShadowAnalyzer(b, [], [], DEFAULT_OPTS);
        const shadows = analyzer.analyze();
        for (const s of shadows) {
            expect(s.rowBelowY).toBeGreaterThanOrEqual(b.minY - 0.01);
            expect(s.rowAboveY + s.rowH).toBeLessThanOrEqual(b.maxY + 0.01);
        }
    });

    test('more strips produced for taller plan', () => {
        const shortPlan = new CorridorShadowAnalyzer(makeBounds(0,0,30,10), [], [], DEFAULT_OPTS);
        const tallPlan  = new CorridorShadowAnalyzer(makeBounds(0,0,30,40), [], [], DEFAULT_OPTS);
        const shortShadows = shortPlan.analyze();
        const tallShadows  = tallPlan.analyze();
        expect(tallShadows.length).toBeGreaterThan(shortShadows.length);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('CorridorShadowAnalyzer — wall-free gap clipping', () => {

    test('no walls → one shadow spanning full width', () => {
        const b = makeBounds(0, 0, 20, 12);
        const analyzer = new CorridorShadowAnalyzer(b, [], [], DEFAULT_OPTS);
        const shadows = analyzer.analyze();

        // Every shadow should span (nearly) the full X range
        for (const s of shadows) {
            expect(s.x0).toBeCloseTo(b.minX, 1);
            expect(s.x1).toBeCloseTo(b.maxX, 1);
        }
    });

    test('internal vertical wall creates two shadow segments per aisle', () => {
        const b = makeBounds(0, 0, 20, 12);
        // Vertical internal wall crossing all aisles at x=10
        const wallSegs = [
            { x1: 10, y1: b.minY, x2: 10, y2: b.maxY, len: b.maxY - b.minY }
        ];
        const analyzer = new CorridorShadowAnalyzer(b, wallSegs, [], DEFAULT_OPTS);
        const shadows = analyzer.analyze();

        // For each logical aisle, there should be 2 shadows (left + right of wall)
        // Group by aisleY
        const byAisle = new Map();
        for (const s of shadows) {
            const key = s.aisleY.toFixed(2);
            if (!byAisle.has(key)) byAisle.set(key, []);
            byAisle.get(key).push(s);
        }
        for (const [aisleY, segs] of byAisle) {
            expect(segs.length).toBe(2);
            // Left shadow ends before wall
            expect(segs[0].x1).toBeLessThanOrEqual(10 + 0.1);
            // Right shadow starts after wall
            expect(segs[1].x0).toBeGreaterThanOrEqual(10 - 0.1);
        }
    });

    test('obstacle rect in the middle of an aisle creates two shadows', () => {
        const b = makeBounds(0, 0, 30, 20);
        const opts = { ...DEFAULT_OPTS, boxDepth: 2.0, corridorWidth: 1.2 };
        // Obstacle at center: x=12..18, y=0..20 (blocks all aisles)
        const obstacles = [{ x: 12, y: 0, w: 6, h: 20 }];
        const analyzer = new CorridorShadowAnalyzer(b, [], obstacles, opts);
        const shadows = analyzer.analyze();

        // Every aisle should be split by the obstacle
        const byAisle = new Map();
        for (const s of shadows) {
            const key = s.aisleY.toFixed(2);
            if (!byAisle.has(key)) byAisle.set(key, []);
            byAisle.get(key).push(s);
        }
        for (const [, segs] of byAisle) {
            expect(segs.length).toBe(2);
        }
    });

    test('fully blocked aisle returns no shadows for that aisle', () => {
        const b = makeBounds(0, 0, 10, 12);
        // Obstacle covering the entire X range for all Y
        const obstacles = [{ x: -1, y: -1, w: 12, h: 14 }];
        const analyzer = new CorridorShadowAnalyzer(b, [], obstacles, DEFAULT_OPTS);
        const shadows = analyzer.analyze();
        // No usable shadows — everything is blocked
        expect(shadows.length).toBe(0);
    });

    test('shadow x0 is always < x1', () => {
        const b = makeBounds(0, 0, 25, 18);
        const wallSegs = [
            { x1: 8, y1: 0, x2: 8, y2: 18, len: 18 },
            { x1: 17, y1: 0, x2: 17, y2: 18, len: 18 },
        ];
        const analyzer = new CorridorShadowAnalyzer(b, wallSegs, [], DEFAULT_OPTS);
        const shadows = analyzer.analyze();
        for (const s of shadows) {
            expect(s.x0).toBeLessThan(s.x1);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('CorridorShadowAnalyzer — output shape', () => {

    test('every shadow has all required fields', () => {
        const analyzer = new CorridorShadowAnalyzer(makeBounds(), [], [], DEFAULT_OPTS);
        const shadows = analyzer.analyze();
        const REQUIRED = ['x0','x1','aisleY','aisleH','rowBelowY','rowAboveY','rowH'];
        for (const s of shadows) {
            for (const field of REQUIRED) {
                expect(s).toHaveProperty(field);
                expect(Number.isFinite(s[field])).toBe(true);
            }
        }
    });

    test('aisleH is approximately corridorWidth', () => {
        const opts = { ...DEFAULT_OPTS, corridorWidth: 1.2 };
        const analyzer = new CorridorShadowAnalyzer(makeBounds(), [], [], opts);
        const shadows = analyzer.analyze();
        for (const s of shadows) {
            // Allow slight variation due to strip scaling
            expect(s.aisleH).toBeGreaterThan(0.5);
            expect(s.aisleH).toBeLessThan(2.0);
        }
    });
});
