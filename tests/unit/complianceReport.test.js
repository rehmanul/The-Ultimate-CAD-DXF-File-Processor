const { buildComplianceReport } = require('../../lib/complianceReport');

describe('ComplianceReport', () => {
    test('builds KPI summary with totalArea and ilot dimensions', () => {
        const floorPlan = {
            totalArea: 200,
            bounds: { minX: 0, minY: 0, maxX: 10, maxY: 20 }
        };
        const ilots = [
            { width: 2, height: 3, area: 6 },
            { width: 1.5, height: 4 }
        ];
        const corridors = [
            { length: 10, area: 15 },
            { width: 2, height: 6 }
        ];
        const unitMixReport = { summary: { weightedComplianceRate: 0.85 } };

        const report = buildComplianceReport({
            floorPlan,
            ilots,
            corridors,
            unitMixReport
        });

        expect(report.kpis.usableArea).toBe(200);
        expect(report.kpis.leasableArea).toBeCloseTo(12, 5);
        expect(report.kpis.partitionLength).toBeCloseTo(2 * (2 + 3) + 2 * (1.5 + 4), 5);
        expect(report.kpis.corridorArea).toBeCloseTo(15, 5);
        expect(report.kpis.corridorLength).toBeCloseTo(10 + 6, 5);
        expect(report.kpis.unitMixComplianceRate).toBe(0.85);
        expect(report.assumptions.length).toBeGreaterThan(0);
    });

    test('uses bounds area when totalArea is missing', () => {
        const floorPlan = { bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 } };
        const report = buildComplianceReport({ floorPlan });

        expect(report.kpis.usableArea).toBe(25);
        expect(report.kpis.leasableArea).toBe(0);
        expect(report.kpis.yieldRatio).toBe(0);
        expect(report.assumptions[0]).toContain('bounds');
    });
});
