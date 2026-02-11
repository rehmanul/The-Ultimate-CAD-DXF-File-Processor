const { RawPlanAnalyzer } = require('../../../lib/RawPlanAnalyzer');

describe('RawPlanAnalyzer', () => {
    describe('constructor', () => {
        test('should initialize with default options', () => {
            const a = new RawPlanAnalyzer();
            expect(a.gapThreshold).toBe(2.5);
            expect(a.tolerance).toBe(0.15);
        });

        test('should accept custom options', () => {
            const a = new RawPlanAnalyzer({ gapThreshold: 5, tolerance: 0.3 });
            expect(a.gapThreshold).toBe(5);
            expect(a.tolerance).toBe(0.3);
        });
    });

    describe('analyze', () => {
        test('should return report for empty walls array', () => {
            const a = new RawPlanAnalyzer();
            const r = a.analyze([]);
            expect(r.gapCount).toBe(0);
            expect(r.recommendations).toContain('No walls found – plan may be empty or unreadable.');
            expect(r.raw).toBe(true);
        });

        test('should return report for null walls', () => {
            const a = new RawPlanAnalyzer();
            const r = a.analyze(null);
            expect(r.gapCount).toBe(0);
            expect(r.recommendations.length).toBeGreaterThan(0);
        });

        test('should detect no gaps in a closed rectangle', () => {
            const a = new RawPlanAnalyzer();
            const walls = [
                { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
                { start: { x: 10, y: 0 }, end: { x: 10, y: 8 } },
                { start: { x: 10, y: 8 }, end: { x: 0, y: 8 } },
                { start: { x: 0, y: 8 }, end: { x: 0, y: 0 } }
            ];
            const r = a.analyze(walls, { minX: 0, minY: 0, maxX: 10, maxY: 8 });
            expect(r.gapCount).toBe(0);
            expect(r.openEndpoints.length).toBe(0);
            expect(r.raw).toBe(false);
            expect(r.recommendations).toEqual(
                expect.arrayContaining([expect.stringContaining('complete')])
            );
        });

        test('should detect a gap between disconnected walls', () => {
            const a = new RawPlanAnalyzer();
            const walls = [
                { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
                { start: { x: 10.5, y: 0 }, end: { x: 10.5, y: 8 } },
                { start: { x: 10.5, y: 8 }, end: { x: 0, y: 8 } },
                { start: { x: 0, y: 8 }, end: { x: 0, y: 0 } }
            ];
            const r = a.analyze(walls);
            expect(r.gapCount).toBeGreaterThan(0);
            expect(r.raw).toBe(true);
            expect(r.gaps.length).toBeGreaterThan(0);
            const gap = r.gaps.find(g => g.fillable);
            expect(gap).toBeDefined();
        });

        test('should report gaps with distance and fillable flag', () => {
            const a = new RawPlanAnalyzer();
            const walls = [
                { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
                { start: { x: 6, y: 0 }, end: { x: 10, y: 0 } }
            ];
            const r = a.analyze(walls);
            expect(r.gaps.length).toBeGreaterThan(0);
            const gap = r.gaps[0];
            expect(gap).toHaveProperty('distance');
            expect(gap).toHaveProperty('fillable');
            expect(gap.distance).toBeCloseTo(1.0, 0);
            expect(gap.fillable).toBe(true);
        });

        test('should not detect gap between points within tolerance', () => {
            const a = new RawPlanAnalyzer({ tolerance: 0.2 });
            const walls = [
                { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
                { start: { x: 10.1, y: 0 }, end: { x: 10.1, y: 8 } }
            ];
            const r = a.analyze(walls);
            // Distance 0.1 < tolerance 0.2, so NOT a gap — it's a connected point
            expect(r.gaps.length).toBe(0);
        });

        test('should detect gaps beyond threshold as open endpoints', () => {
            const a = new RawPlanAnalyzer({ gapThreshold: 1.0 });
            const walls = [
                { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
                { start: { x: 8, y: 0 }, end: { x: 15, y: 0 } }
            ];
            const r = a.analyze(walls);
            // Distance 3 > threshold 1, so no gap but open endpoints
            expect(r.gaps.length).toBe(0);
            expect(r.openEndpoints.length).toBeGreaterThan(0);
        });

        test('should skip walls without start/end', () => {
            const a = new RawPlanAnalyzer();
            const walls = [
                { polygon: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
                { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
            ];
            const r = a.analyze(walls);
            // Only one wall has endpoints → 2 endpoints, both open
            expect(r.openEndpoints.length).toBe(2);
        });
    });

    describe('_detectDoors', () => {
        test('should detect ARC doors on door layer', () => {
            const a = new RawPlanAnalyzer();
            const entities = [
                { type: 'ARC', layer: 'DOOR', center: { x: 5, y: 0 }, radius: 0.45, startAngle: 0, endAngle: 90 }
            ];
            const r = a.analyze(
                [{ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }],
                {},
                entities
            );
            expect(r.doors.length).toBe(1);
            expect(r.doors[0].type).toBe('ARC');
            expect(r.doors[0].radius).toBe(0.45);
            expect(r.doors[0].width).toBeCloseTo(0.9, 1);
        });

        test('should detect LINE doors on PORTE layer', () => {
            const a = new RawPlanAnalyzer();
            const entities = [
                { type: 'LINE', layer: 'porte_int', start: { x: 2, y: 0 }, end: { x: 2.9, y: 0 } }
            ];
            const r = a.analyze(
                [{ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }],
                {},
                entities
            );
            expect(r.doors.length).toBe(1);
            expect(r.doors[0].type).toBe('LINE');
            expect(r.doors[0].width).toBeCloseTo(0.9, 1);
        });

        test('should detect OUVERTURE layer', () => {
            const a = new RawPlanAnalyzer();
            const entities = [
                { type: 'LINE', layer: 'OUVERTURE', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }
            ];
            const r = a.analyze(
                [{ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }],
                {},
                entities
            );
            expect(r.doors.length).toBe(1);
        });

        test('should ignore entities on non-door layers', () => {
            const a = new RawPlanAnalyzer();
            const entities = [
                { type: 'LINE', layer: 'WALLS', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }
            ];
            const r = a.analyze(
                [{ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }],
                {},
                entities
            );
            expect(r.doors.length).toBe(0);
        });

        test('should handle null entities', () => {
            const a = new RawPlanAnalyzer();
            const r = a.analyze(
                [{ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }],
                {},
                null
            );
            expect(r.doors.length).toBe(0);
        });
    });

    describe('recommendations', () => {
        test('should recommend auto-fill when gaps found', () => {
            const a = new RawPlanAnalyzer();
            const walls = [
                { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
                { start: { x: 6, y: 0 }, end: { x: 10, y: 0 } }
            ];
            const r = a.analyze(walls);
            expect(r.recommendations.some(m => m.includes('auto-filled'))).toBe(true);
        });

        test('should recommend completion when open endpoints found', () => {
            const a = new RawPlanAnalyzer({ gapThreshold: 0.5 });
            const walls = [
                { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
                { start: { x: 50, y: 50 }, end: { x: 60, y: 50 } }
            ];
            const r = a.analyze(walls);
            expect(r.recommendations.some(m => m.includes('not connected'))).toBe(true);
        });

        test('should report plan as complete when no issues', () => {
            const a = new RawPlanAnalyzer();
            const walls = [
                { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
                { start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
                { start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
                { start: { x: 0, y: 10 }, end: { x: 0, y: 0 } }
            ];
            const r = a.analyze(walls);
            expect(r.raw).toBe(false);
            expect(r.recommendations.some(m => m.includes('complete'))).toBe(true);
        });
    });
});
