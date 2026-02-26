function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function resolveUsableArea(floorPlan = {}) {
    const totalArea = toNumber(floorPlan.totalArea);
    if (totalArea !== null && totalArea > 0) {
        return { area: totalArea, source: 'totalArea' };
    }

    const bounds = floorPlan.bounds || {};
    const widthValue = toNumber(bounds.width);
    const heightValue = toNumber(bounds.height);
    const maxX = toNumber(bounds.maxX);
    const minX = toNumber(bounds.minX);
    const maxY = toNumber(bounds.maxY);
    const minY = toNumber(bounds.minY);
    const width = widthValue !== null ? widthValue : (maxX !== null && minX !== null ? maxX - minX : null);
    const height = heightValue !== null ? heightValue : (maxY !== null && minY !== null ? maxY - minY : null);
    if (width !== null && height !== null && width > 0 && height > 0) {
        return { area: width * height, source: 'bounds' };
    }

    const rooms = Array.isArray(floorPlan.rooms) ? floorPlan.rooms : [];
    const roomArea = rooms.reduce((sum, room) => sum + (toNumber(room.area) || 0), 0);
    if (roomArea > 0) {
        return { area: roomArea, source: 'rooms' };
    }

    return { area: 0, source: 'unknown' };
}

function resolveIlotArea(ilot) {
    const area = toNumber(ilot.area);
    if (area !== null && area >= 0) return area;
    const width = toNumber(ilot.width);
    const height = toNumber(ilot.height);
    if (width !== null && height !== null) return Math.max(0, width * height);
    return 0;
}

function resolveIlotPerimeter(ilot) {
    const width = toNumber(ilot.width);
    const height = toNumber(ilot.height);
    if (width !== null && height !== null) {
        return Math.max(0, 2 * (width + height));
    }
    return 0;
}

function resolveCorridorArea(corridors) {
    return corridors.reduce((sum, corridor) => sum + (toNumber(corridor.area) || 0), 0);
}

function resolveCorridorLength(corridors) {
    return corridors.reduce((sum, corridor) => {
        const length = toNumber(corridor.length);
        if (length !== null) return sum + length;
        const width = toNumber(corridor.width) || 0;
        const height = toNumber(corridor.height) || 0;
        return sum + Math.max(width, height);
    }, 0);
}

function buildComplianceReport({ floorPlan = {}, ilots = [], corridors = [], unitMixReport = null, validation = null } = {}) {
    const usableAreaResult = resolveUsableArea(floorPlan);
    const usableArea = usableAreaResult.area;

    const ilotList = Array.isArray(ilots) ? ilots : [];
    const leasableArea = ilotList.reduce((sum, ilot) => sum + resolveIlotArea(ilot), 0);
    const partitionLength = ilotList.reduce((sum, ilot) => sum + resolveIlotPerimeter(ilot), 0);

    const corridorList = Array.isArray(corridors) ? corridors : [];
    const corridorArea = resolveCorridorArea(corridorList);
    const corridorLength = resolveCorridorLength(corridorList);

    const yieldRatio = usableArea > 0 ? leasableArea / usableArea : 0;
    const unitMixComplianceRate = unitMixReport?.summary?.weightedComplianceRate ?? null;

    const assumptions = [];
    assumptions.push(`Usable area source: ${usableAreaResult.source}.`);
    assumptions.push('Partition length derived from ilot rectangle perimeters when width/height are available.');
    assumptions.push('Corridor length uses corridor.length when provided, otherwise max(width, height).');

    return {
        kpis: {
            leasableArea,
            usableArea,
            yieldRatio,
            partitionLength,
            corridorArea,
            corridorLength,
            unitMixComplianceRate
        },
        unitMixReport,
        validation,
        assumptions
    };
}

module.exports = { buildComplianceReport };
