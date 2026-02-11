/**
 * RawPlanAnalyzer - Analyze raw/incomplete floor plans
 *
 * Detects: gaps, disconnected walls, open endpoints, T-junctions,
 * missing connections. Produces a report for completion pipeline.
 */

const TOLERANCE = 0.15;
const GAP_THRESHOLD = 2.5;

class RawPlanAnalyzer {
    constructor(options = {}) {
        this.gapThreshold = options.gapThreshold ?? GAP_THRESHOLD;
        this.tolerance = options.tolerance ?? TOLERANCE;
    }

    /**
     * Analyze raw floor plan geometry
     * @param {Array} walls - Wall segments { start: {x,y}, end: {x,y} }
     * @param {Object} bounds - { minX, minY, maxX, maxY }
     * @param {Array} entities - Raw CAD entities (optional, for door detection)
     * @returns {Object} Analysis report
     */
    analyze(walls, bounds = {}, entities = []) {
        const report = {
            gapCount: 0,
            openEndpoints: [],
            gaps: [],
            recommendations: [],
            doors: [],
            raw: true
        };

        if (!Array.isArray(walls) || walls.length === 0) {
            report.recommendations.push('No walls found – plan may be empty or unreadable.');
            return report;
        }

        const endpoints = this._extractEndpoints(walls);
        const { gaps, openEndpoints } = this._findGapsAndOpenEndpoints(endpoints);
        const doors = this._detectDoors(entities, walls);

        report.gaps = gaps;
        report.gapCount = gaps.length;
        report.openEndpoints = openEndpoints;
        report.doors = doors;

        if (gaps.length > 0) {
            report.recommendations.push(`Found ${gaps.length} gap(s) between wall endpoints – can be auto-filled.`);
        }
        if (openEndpoints.length > 0) {
            report.recommendations.push(`${openEndpoints.length} wall endpoint(s) are not connected – consider completion.`);
        }
        if (gaps.length === 0 && openEndpoints.length === 0) {
            report.raw = false;
            report.recommendations.push('Plan appears complete – no gaps detected.');
        }

        return report;
    }

    _extractEndpoints(walls) {
        const endpoints = [];
        walls.forEach((wall, idx) => {
            if (wall.start && wall.end) {
                endpoints.push({
                    x: wall.start.x,
                    y: wall.start.y,
                    wallIdx: idx,
                    type: 'start',
                    wall
                });
                endpoints.push({
                    x: wall.end.x,
                    y: wall.end.y,
                    wallIdx: idx,
                    type: 'end',
                    wall
                });
            }
        });
        return endpoints;
    }

    _samePoint(p1, p2) {
        return Math.hypot(p1.x - p2.x, p1.y - p2.y) < this.tolerance;
    }

    _findGapsAndOpenEndpoints(endpoints) {
        const gaps = [];
        const openEndpoints = [];
        const used = new Set();

        // First pass: mark connected endpoints (within tolerance = same point)
        for (let i = 0; i < endpoints.length; i++) {
            if (used.has(i)) continue;
            for (let j = i + 1; j < endpoints.length; j++) {
                if (used.has(j)) continue;
                if (endpoints[j].wallIdx === endpoints[i].wallIdx) continue;
                const dist = Math.hypot(endpoints[i].x - endpoints[j].x, endpoints[i].y - endpoints[j].y);
                if (dist <= this.tolerance) {
                    // Connected — mark both as used
                    used.add(i);
                    used.add(j);
                    break;
                }
            }
        }

        // Second pass: find gaps among remaining (unconnected) endpoints
        const unmatched = [];
        for (let i = 0; i < endpoints.length; i++) {
            if (!used.has(i)) unmatched.push({ idx: i, ep: endpoints[i] });
        }

        const gapUsed = new Set();
        for (let a = 0; a < unmatched.length; a++) {
            if (gapUsed.has(a)) continue;
            const p1 = unmatched[a].ep;
            let nearestIdx = -1;
            let nearestDist = this.gapThreshold;

            for (let b = 0; b < unmatched.length; b++) {
                if (a === b || gapUsed.has(b)) continue;
                const p2 = unmatched[b].ep;
                if (p2.wallIdx === p1.wallIdx) continue;
                const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
                if (dist > this.tolerance && dist < nearestDist) {
                    nearestDist = dist;
                    nearestIdx = b;
                }
            }

            if (nearestIdx !== -1) {
                const p2 = unmatched[nearestIdx].ep;
                gaps.push({
                    start: { x: p1.x, y: p1.y },
                    end: { x: p2.x, y: p2.y },
                    distance: nearestDist,
                    fillable: nearestDist >= 0.1 && nearestDist <= this.gapThreshold
                });
                gapUsed.add(a);
                gapUsed.add(nearestIdx);
            } else {
                openEndpoints.push({ x: p1.x, y: p1.y, wallIdx: p1.wallIdx, type: p1.type });
            }
        }

        return { gaps, openEndpoints };
    }

    _detectDoors(entities, walls) {
        const doors = [];
        if (!Array.isArray(entities)) return doors;

        for (const ent of entities) {
            const layer = (ent.layer || '').toUpperCase();
            if (layer.includes('DOOR') || layer.includes('PORTE') || layer.includes('OUVERTURE')) {
                if (ent.type === 'ARC' && ent.center) {
                    const radius = ent.radius || 0;
                    const startAngle = (ent.startAngle || 0) * Math.PI / 180;
                    const endAngle = (ent.endAngle || 90) * Math.PI / 180;
                    const cx = ent.center.x ?? 0;
                    const cy = ent.center.y ?? 0;
                    const start = { x: cx + radius * Math.cos(startAngle), y: cy + radius * Math.sin(startAngle) };
                    const end = { x: cx + radius * Math.cos(endAngle), y: cy + radius * Math.sin(endAngle) };
                    doors.push({
                        type: 'ARC',
                        center: { x: cx, y: cy },
                        radius,
                        start,
                        end,
                        width: radius * 2,
                        layer
                    });
                } else if (ent.type === 'LINE' && ent.start && ent.end) {
                    const len = Math.hypot(ent.end.x - ent.start.x, ent.end.y - ent.start.y);
                    doors.push({
                        type: 'LINE',
                        start: ent.start,
                        end: ent.end,
                        width: len,
                        layer
                    });
                }
            }
        }

        return doors;
    }
}

module.exports = { RawPlanAnalyzer };
