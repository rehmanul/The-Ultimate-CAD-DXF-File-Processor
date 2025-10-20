const MultiFloorManager = require('./multiFloorManager');
const CrossFloorRouter = require('./crossFloorRouter');
const { performance } = require('perf_hooks');

function buildReport(floors = [], options = {}) {
    if (!Array.isArray(floors) || floors.length === 0) {
        throw new Error('Floors array is required to generate report');
    }

    const stackOptions = options.stackOptions || {};
    const routeOptions = options.routeOptions || {};
    const profileSummary = options.profile || null;

    const manager = new MultiFloorManager(stackOptions);
    const stackStart = performance.now();
    const stackResult = manager.stackFloors(floors);
    const stackDuration = performance.now() - stackStart;

    const connectors = stackResult.connectors || [];
    const edges = stackResult.edges || [];

    let routeResult = null;
    let routingDuration = 0;

    if (connectors.length) {
        const routeStart = performance.now();
        routeResult = CrossFloorRouter.computeRoutes(floors, connectors, edges, routeOptions);
        routingDuration = performance.now() - routeStart;
    } else {
        routeResult = {
            routes: [],
            segments: [],
            summary: {
                componentCount: 0,
                routeCount: 0,
                segmentCount: 0,
                unreachable: connectors.map(c => c.id)
            }
        };
    }

    const report = {
        generatedAt: new Date().toISOString(),
        summary: buildSummary(stackResult, routeResult),
        metrics: {
            stackMs: stackDuration,
            routingMs: routingDuration
        },
        warnings: stackResult.warnings || [],
        compliance: stackResult.compliance || null,
        profile: profileSummary,
        raw: {
            stackResult,
            routeResult
        },
        markdown: buildMarkdown(stackResult, routeResult, stackDuration, routingDuration, profileSummary)
    };

    return report;
}

function buildSummary(stackResult, routeResult) {
    const floors = stackResult.floors || [];
    const connectors = stackResult.connectors || [];
    const summary = {
        floorCount: floors.length,
        floorNames: floors.map(f => f.name || f.id || `Floor ${f.level ?? ''}`),
        connectors: {
            total: connectors.length,
            elevators: connectors.filter(c => c.type === 'elevator').length,
            stairs: connectors.filter(c => c.type === 'stair').length,
            escalators: connectors.filter(c => c.type === 'escalator').length,
            shafts: connectors.filter(c => c.type === 'shaft').length
        },
        routes: {
            total: routeResult.summary?.routeCount || 0,
            segments: routeResult.summary?.segmentCount || 0,
            unreachable: routeResult.summary?.unreachable || []
        }
    };
    return summary;
}

function buildMarkdown(stackResult, routeResult, stackDuration, routingDuration, profileSummary) {
    const lines = [];
    lines.push('# Multi-Floor Report');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('## Overview');
    lines.push('');
    lines.push(`- Floors processed: ${stackResult.floors?.length || 0}`);
    lines.push(`- Connectors detected: ${stackResult.connectors?.length || 0}`);
    lines.push(`- Stack processing time: ${stackDuration.toFixed(1)} ms`);
    lines.push(`- Routing time: ${routingDuration.toFixed(1)} ms`);
    lines.push('');
    if (profileSummary) {
        lines.push('## Performance Profile');
        lines.push('');
        lines.push(`- Iterations: ${profileSummary.parameters?.iterations || 0}`);
        if (profileSummary.stack) {
            lines.push(`- Avg stack time: ${profileSummary.stack.averageMs?.toFixed?.(1) || 0} ms`);
        }
        if (profileSummary.routing) {
            lines.push(`- Avg routing time: ${profileSummary.routing.averageMs?.toFixed?.(1) || 0} ms`);
        }
        lines.push('');
    }
    if (stackResult.warnings?.length) {
        lines.push('## Warnings');
        lines.push('');
        stackResult.warnings.forEach(w => lines.push(`- ${w}`));
        lines.push('');
    }
    if (routeResult.summary?.unreachable?.length) {
        lines.push('## Unreachable Connectors');
        lines.push('');
        routeResult.summary.unreachable.forEach(id => lines.push(`- ${id}`));
        lines.push('');
    }
    lines.push('## Compliance Snapshot');
    lines.push('');
    if (stackResult.compliance?.egress?.floors) {
        stackResult.compliance.egress.floors.forEach(f => {
            lines.push(`- Floor ${f.floorLevel}: egress ${f.pass ? 'PASS' : 'FAIL'} (max ${f.maxDistance?.toFixed?.(1) || 'N/A'} m)`);
        });
    } else {
        lines.push('- No compliance data available.');
    }
    lines.push('');
    return lines.join('\n');
}

module.exports = {
    buildReport
};
