const assert = require('assert');
const { buildReport } = require('../../lib/unitMixReport');

describe('UnitMixReport', () => {

    it('should compute area compliance with tolerance', () => {
        const ilots = [
            { type: 'S', area: 5 },
            { type: 'S', area: 5 },
            { type: 'M', area: 10 }
        ];
        const unitMix = [
            { type: 'S', targetArea: 12, tolerance: { type: 'percentage', value: 10 }, priority: 2 },
            { type: 'M', targetArea: 10, tolerance: { type: 'absolute', value: 0 }, priority: 1 }
        ];

        const report = buildReport(ilots, unitMix);

        assert.ok(report);
        assert.strictEqual(report.summary.totalTargetArea, 22);
        assert.strictEqual(report.summary.totalActualArea, 20);
        assert.strictEqual(report.byType.length, 2);

        const small = report.byType.find((row) => row.type === 'S');
        assert.strictEqual(small.actualArea, 10);
        assert.strictEqual(small.deltaArea, -2);
        assert.strictEqual(small.withinTolerance, false);

        const medium = report.byType.find((row) => row.type === 'M');
        assert.strictEqual(medium.actualArea, 10);
        assert.strictEqual(medium.deltaArea, 0);
        assert.strictEqual(medium.withinTolerance, true);
    });

    it('should compute count compliance when target counts are provided', () => {
        const ilots = [
            { type: 'L', area: 12 },
            { type: 'L', area: 11 },
            { type: 'L', area: 10 }
        ];
        const unitMix = [
            { type: 'L', targetCount: 4, tolerance: '25%', priority: 1 }
        ];

        const report = buildReport(ilots, unitMix);

        assert.ok(report);
        assert.strictEqual(report.summary.totalTargetCount, 4);
        assert.strictEqual(report.summary.totalActualCount, 3);

        const large = report.byType[0];
        assert.strictEqual(large.deltaCount, -1);
        assert.strictEqual(large.withinTolerance, true);
    });
});
