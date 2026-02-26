const MultiFloorManager = require('./multiFloorManager');
const CrossFloorRouter = require('./crossFloorRouter');
const { performance } = require('perf_hooks');

/**
 * Profile multi-floor stacking and routing operations.
 * Automatically duplicates floors to reach the desired floor count when requested.
 */
function profileMultiFloor(floors = [], options = {}) {
    if (!Array.isArray(floors) || floors.length === 0) {
        throw new Error('At least one floor is required for profiling');
    }

    const iterations = Math.max(1, Number(options.iterations || 3));
    const targetFloors = Math.max(Number(options.targetFloorCount || 6), floors.length);
    const autoExpand = options.autoExpand !== false;
    const stackOptions = options.stackOptions || {};
    const routeOptions = options.routeOptions || {};

    const expandedFloors = autoExpand ? expandFloors(floors, targetFloors) : floors;

    const stackTimings = [];
    const routeTimings = [];
    let lastStackResult = null;
    let lastRouteResult = null;

    for (let i = 0; i < iterations; i++) {
        const manager = new MultiFloorManager(stackOptions);
        const stackStart = performance.now();
        const stackResult = manager.stackFloors(expandedFloors);
        const stackDuration = performance.now() - stackStart;

        stackTimings.push(stackDuration);
        lastStackResult = stackResult;

        const connectors = stackResult.connectors || [];
        const edges = stackResult.edges || [];
        if (connectors.length) {
            const routeStart = performance.now();
            lastRouteResult = CrossFloorRouter.computeRoutes(expandedFloors, connectors, edges, routeOptions);
            const routeDuration = performance.now() - routeStart;
            routeTimings.push(routeDuration);
        } else {
            routeTimings.push(0);
            lastRouteResult = null;
        }
    }

    return {
        parameters: {
            iterations,
            floorCount: expandedFloors.length,
            originalFloorCount: floors.length,
            autoExpanded: expandedFloors.length !== floors.length,
            stackOptions,
            routeOptions
        },
        stack: buildTimingSummary(stackTimings),
        routing: buildTimingSummary(routeTimings),
        lastStackResult,
        lastRouteResult
    };
}

function expandFloors(floors, targetCount) {
    if (floors.length >= targetCount) return floors;

    const expanded = floors.map(f => ({ ...f }));
    let nextLevel = Math.max(...floors.map(f => f.level ?? 0)) + 1;

    while (expanded.length < targetCount) {
        floors.forEach((floor) => {
            if (expanded.length >= targetCount) return;
            const clone = JSON.parse(JSON.stringify(floor));
            clone.id = `${floor.id || 'floor'}_dup_${expanded.length}`;
            clone.level = nextLevel++;
            expanded.push(clone);
        });
    }

    return expanded;
}

function buildTimingSummary(samples) {
    const filtered = samples.filter(v => typeof v === 'number' && !Number.isNaN(v));
    if (!filtered.length) {
        return { averageMs: 0, minMs: 0, maxMs: 0, samples: [] };
    }
    const total = filtered.reduce((sum, v) => sum + v, 0);
    return {
        averageMs: total / filtered.length,
        minMs: Math.min(...filtered),
        maxMs: Math.max(...filtered),
        samples: filtered
    };
}

module.exports = {
    profileMultiFloor
};
