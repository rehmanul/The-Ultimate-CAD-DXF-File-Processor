const DEFAULT_PRIORITY = 1;

function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function normalizeType(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (!text.length) return null;
    
    // Extract base type name (e.g., "S (<2m²)" -> "S")
    const match = text.match(/^([A-Za-z0-9]+)/);
    return match ? match[1] : text;
}

function normalizeTolerance(tolerance) {
    if (!tolerance) {
        return { type: 'percentage', value: 0 };
    }

    if (typeof tolerance === 'object' && tolerance.type && typeof tolerance.value !== 'undefined') {
        const value = toNumber(tolerance.value);
        return {
            type: tolerance.type === 'absolute' ? 'absolute' : 'percentage',
            value: value !== null && value >= 0 ? value : 0
        };
    }

    if (typeof tolerance === 'string' && tolerance.includes('%')) {
        const value = toNumber(tolerance.replace('%', ''));
        return {
            type: 'percentage',
            value: value !== null && value >= 0 ? value : 0
        };
    }

    const numeric = toNumber(tolerance);
    return {
        type: 'absolute',
        value: numeric !== null && numeric >= 0 ? numeric : 0
    };
}

function getIlotArea(ilot) {
    const area = toNumber(ilot.area);
    if (area !== null && area >= 0) return area;

    const width = toNumber(ilot.width);
    const height = toNumber(ilot.height);
    if (width !== null && height !== null) {
        return Math.max(0, width * height);
    }

    return null;
}

function buildActuals(ilots) {
    const actuals = new Map();

    if (!Array.isArray(ilots)) {
        return actuals;
    }

    ilots.forEach((ilot) => {
        if (!ilot || typeof ilot !== 'object') return;
        const type = normalizeType(ilot.type || ilot.sizeCategory);
        if (!type) return;

        const area = getIlotArea(ilot);
        const entry = actuals.get(type) || { area: 0, count: 0 };
        entry.count += 1;
        if (area !== null) {
            entry.area += area;
        }
        actuals.set(type, entry);
    });

    return actuals;
}

function buildReport(ilots, unitMix) {
    if (!Array.isArray(unitMix) || unitMix.length === 0) {
        return null;
    }

    const actuals = buildActuals(ilots);
    const results = [];

    let totalTargetArea = 0;
    let totalActualArea = 0;
    let totalTargetCount = 0;
    let totalActualCount = 0;
    let weightedCompliance = 0;
    let totalWeight = 0;

    const discrepancies = {
        missingAreas: [],
        excessAreas: [],
        missingCounts: [],
        excessCounts: []
    };

    unitMix.forEach((item) => {
        if (!item || typeof item !== 'object') return;
        const type = normalizeType(item.type || item.Type);
        if (!type) return;

        const targetArea = toNumber(item.targetArea || item.target_area || item.area || item['target area']);
        const targetCount = toNumber(item.targetCount || item.target_count || item.count || item['target count']);
        const tolerance = normalizeTolerance(item.tolerance);
        const priority = toNumber(item.priority) || DEFAULT_PRIORITY;

        const actual = actuals.get(type) || { area: 0, count: 0 };
        const actualArea = actual.area || 0;
        const actualCount = actual.count || 0;

        totalActualArea += actualArea;
        totalActualCount += actualCount;

        let deltaArea = null;
        let deltaCount = null;
        let withinTolerance = null;
        let complianceRatio = 0;

        if (targetArea !== null) {
            totalTargetArea += targetArea;
            deltaArea = actualArea - targetArea;
            const allowed = tolerance.type === 'percentage'
                ? (targetArea * (tolerance.value / 100))
                : tolerance.value;
            withinTolerance = Math.abs(deltaArea) <= allowed;
            complianceRatio = targetArea > 0 ? Math.max(0, 1 - (Math.abs(deltaArea) / targetArea)) : 0;

            if (deltaArea < 0) {
                discrepancies.missingAreas.push({ type, amount: Math.abs(deltaArea) });
            } else if (deltaArea > 0) {
                discrepancies.excessAreas.push({ type, amount: deltaArea });
            }
        }

        if (targetCount !== null) {
            totalTargetCount += targetCount;
            deltaCount = actualCount - targetCount;
            const allowedCount = tolerance.type === 'percentage'
                ? (targetCount * (tolerance.value / 100))
                : tolerance.value;
            const withinCount = Math.abs(deltaCount) <= allowedCount;
            withinTolerance = withinTolerance === null ? withinCount : (withinTolerance && withinCount);
            const countRatio = targetCount > 0 ? Math.max(0, 1 - (Math.abs(deltaCount) / targetCount)) : 0;
            complianceRatio = targetArea !== null ? complianceRatio : countRatio;

            if (deltaCount < 0) {
                discrepancies.missingCounts.push({ type, amount: Math.abs(deltaCount) });
            } else if (deltaCount > 0) {
                discrepancies.excessCounts.push({ type, amount: deltaCount });
            }
        }

        weightedCompliance += complianceRatio * priority;
        totalWeight += priority;

        results.push({
            type,
            targetArea: targetArea !== null ? targetArea : null,
            targetCount: targetCount !== null ? targetCount : null,
            actualArea,
            actualCount,
            deltaArea,
            deltaCount,
            tolerance,
            priority,
            withinTolerance
        });
    });

    const weightedComplianceRate = totalWeight > 0 ? weightedCompliance / totalWeight : 0;

    return {
        summary: {
            weightedComplianceRate,
            totalTargetArea,
            totalActualArea,
            totalTargetCount,
            totalActualCount
        },
        byType: results,
        discrepancies
    };
}

module.exports = { buildReport };
