'use strict';

const { extractSegments } = require('./geometry');

/**
 * CirculationRouter v3 - Production graph-based circulation routing.
 *
 * Builds a wall-safe centerline graph directly from corridor geometry:
 * 1. Convert corridor rectangles into axis-aligned centerlines
 * 2. Merge colinear centerlines
 * 3. Split at intersections and build graph edges
 * 4. Keep only wall-safe edges
 * 5. Connect entrances to nearest graph nodes with wall-safe links
 */
class CirculationRouter {
    constructor(floorPlan, options) {
        this.bounds = floorPlan.bounds;
        this.entrances = floorPlan.entrances || [];
        this.forbiddenZones = floorPlan.forbiddenZones || [];
        this.options = options || {};
        this.oneWayFlow = this.options.oneWayFlow === true;
        // Disabled by default to avoid non-architectural synthetic connector strokes.
        this.allowSyntheticConnectors = this.options.allowSyntheticConnectors === true;
        this.blockThroughUnits = this.options.blockThroughUnits !== false;

        this.allWalls = [];
        const wallSources = [
            ...(floorPlan.walls || []),
            ...(floorPlan.envelope || []).map((e) => ({ start: e.start, end: e.end }))
        ];

        for (const wall of wallSources) {
            const segs = extractSegments(wall);
            for (const seg of segs) {
                const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
                if (len >= 0.3) this.allWalls.push(seg);
            }
        }

        console.log(`[CirculationRouter] Loaded ${this.allWalls.length} wall segments for crossing checks`);
    }

    generateRoute(corridors, units) {
        if (!Array.isArray(corridors) || corridors.length === 0) return [];

        if (this.blockThroughUnits && Array.isArray(units) && units.length > 0) {
            const before = this.allWalls.length;
            for (const u of units) {
                const x = Number(u.x);
                const y = Number(u.y);
                const w = Number(u.width);
                const h = Number(u.height);
                if (![x, y, w, h].every(Number.isFinite)) continue;
                if (w <= 0 || h <= 0) continue;
                this.allWalls.push(
                    { x1: x, y1: y, x2: x + w, y2: y },
                    { x1: x + w, y1: y, x2: x + w, y2: y + h },
                    { x1: x + w, y1: y + h, x2: x, y2: y + h },
                    { x1: x, y1: y + h, x2: x, y2: y }
                );
            }
            console.log(`[CircRoute] Added ${this.allWalls.length - before} box edge segments (${units.length} units)`);
        }

        const axisSegments = this._buildCenterlineSegments(corridors);
        if (!axisSegments.length) return [];

        const { nodes, edges, blockedEdges } = this._buildCenterlineGraph(axisSegments);

        const majorAxis = this._resolveMajorAxis(edges);
        const routeSegments = edges.map((edge) => ({
            type: edge.axis === majorAxis && edge.length >= 1.0 ? 'SPINE' : 'BRANCH',
            style: 'solid_blue',
            path: [edge.p1, edge.p2]
        }));

        const nodeList = Array.from(nodes.values());
        const entranceSegments = this._buildEntranceConnections(nodeList);
        routeSegments.push(...entranceSegments);

        const cleaned = this._cleanupSegments(routeSegments);
        const flowSummary = this._applyFlowAndArrows(cleaned);

        const spineCount = cleaned.filter((s) => s.type === 'SPINE').length;
        const branchCount = cleaned.filter((s) => s.type === 'BRANCH').length;
        const entranceCount = cleaned.filter((s) => s.type === 'ENTRANCE_CONNECTION').length;
        const connectorCount = cleaned.filter((s) => s.type === 'FLOW_CONNECTOR').length;

        console.log(
            `[CirculationRouter] Graph: ${axisSegments.length} centerlines, ${edges.length} edges, ${blockedEdges} blocked` +
            ` | Route: ${spineCount} spine, ${branchCount} branches, ${entranceCount} entrance connections, ${connectorCount} connectors` +
            ` | Flow: ${flowSummary.routeConnected ? 'entry->exit connected' : 'entry->exit NOT connected'}` +
            `${flowSummary.bridgedComponents ? `, bridged components=${flowSummary.bridgedComponents}` : ''}`
        );

        return cleaned;
    }

    _buildCenterlineSegments(corridors) {
        const raw = [];
        for (const c of corridors) {
            const x = Number(c.x);
            const y = Number(c.y);
            const w = Number(c.width);
            const h = Number(c.height);
            if (![x, y, w, h].every(Number.isFinite)) continue;
            if (w <= 0 || h <= 0) continue;

            const isHorizontal = c.direction === 'horizontal' || (w >= h);
            if (isHorizontal) {
                const yMid = y + h / 2;
                raw.push({ axis: 'H', c: yMid, s: x, e: x + w });
            } else {
                const xMid = x + w / 2;
                raw.push({ axis: 'V', c: xMid, s: y, e: y + h });
            }
        }

        const mergedH = this._mergeColinear(raw.filter((s) => s.axis === 'H'));
        const mergedV = this._mergeColinear(raw.filter((s) => s.axis === 'V'));

        const out = [];
        let id = 0;
        for (const s of mergedH) out.push({ id: `seg_${id++}`, axis: 'H', c: s.c, s: s.s, e: s.e });
        for (const s of mergedV) out.push({ id: `seg_${id++}`, axis: 'V', c: s.c, s: s.s, e: s.e });
        return out;
    }

    _mergeColinear(segments) {
        if (!segments.length) return [];

        const coordTolerance = 0.20;
        const joinGap = 0.25;

        const groups = [];
        for (const seg of segments) {
            let group = null;
            for (const g of groups) {
                if (Math.abs(g.c - seg.c) <= coordTolerance) {
                    group = g;
                    break;
                }
            }
            if (!group) {
                group = { c: seg.c, items: [] };
                groups.push(group);
            }
            group.items.push(seg);
            group.c = (group.c * (group.items.length - 1) + seg.c) / group.items.length;
        }

        const merged = [];
        for (const g of groups) {
            const intervals = g.items
                .map((item) => ({ s: Math.min(item.s, item.e), e: Math.max(item.s, item.e) }))
                .sort((a, b) => a.s - b.s);

            if (!intervals.length) continue;
            let current = { s: intervals[0].s, e: intervals[0].e };

            for (let i = 1; i < intervals.length; i++) {
                const it = intervals[i];
                if (it.s <= current.e + joinGap) {
                    current.e = Math.max(current.e, it.e);
                } else {
                    if (current.e - current.s >= 0.5) {
                        merged.push({ c: g.c, s: current.s, e: current.e });
                    }
                    current = { s: it.s, e: it.e };
                }
            }

            if (current.e - current.s >= 0.5) {
                merged.push({ c: g.c, s: current.s, e: current.e });
            }
        }

        return merged;
    }

    _buildCenterlineGraph(segments) {
        const nodes = new Map();
        const splitPoints = new Map();

        const horizontals = segments.filter((s) => s.axis === 'H');
        const verticals = segments.filter((s) => s.axis === 'V');

        for (const seg of segments) splitPoints.set(seg.id, []);

        for (const h of horizontals) {
            for (const v of verticals) {
                if (v.c >= h.s - 1e-6 && v.c <= h.e + 1e-6 && h.c >= v.s - 1e-6 && h.c <= v.e + 1e-6) {
                    splitPoints.get(h.id).push({ x: v.c, y: h.c });
                    splitPoints.get(v.id).push({ x: v.c, y: h.c });
                }
            }
        }

        const edges = [];
        let blockedEdges = 0;

        for (const seg of segments) {
            const pts = [];
            if (seg.axis === 'H') {
                pts.push({ x: seg.s, y: seg.c }, { x: seg.e, y: seg.c });
            } else {
                pts.push({ x: seg.c, y: seg.s }, { x: seg.c, y: seg.e });
            }
            pts.push(...splitPoints.get(seg.id));

            const unique = this._uniquePoints(pts);
            unique.sort((a, b) => (seg.axis === 'H' ? a.x - b.x : a.y - b.y));

            for (let i = 0; i < unique.length - 1; i++) {
                const p1 = unique[i];
                const p2 = unique[i + 1];
                const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                if (len < 0.2) continue;

                if (this._segmentCrossesWall(p1, p2)) {
                    blockedEdges += 1;
                    continue;
                }

                const n1 = this._upsertNode(nodes, p1);
                const n2 = this._upsertNode(nodes, p2);
                n1.edges.add(n2.key);
                n2.edges.add(n1.key);
                edges.push({ axis: seg.axis, p1, p2, length: len });
            }
        }

        return { nodes, edges, blockedEdges };
    }

    _resolveMajorAxis(edges) {
        let h = 0;
        let v = 0;
        for (const e of edges) {
            if (e.axis === 'H') h += e.length;
            else v += e.length;
        }
        return h >= v ? 'H' : 'V';
    }

    _buildEntranceConnections(nodes) {
        if (!nodes.length) return [];

        const connections = [];
        const entrancePoints = this._getEntrancePoints();

        for (const ent of entrancePoints) {
            let nearest = null;
            let nearestDist = Infinity;
            for (const n of nodes) {
                const d = Math.hypot(n.x - ent.x, n.y - ent.y);
                if (d < nearestDist) {
                    nearestDist = d;
                    nearest = n;
                }
            }

            if (!nearest || nearestDist < 0.5 || nearestDist > 25) continue;

            // Keep entrance links axis-aligned only (no diagonal connectors).
            const aligned = Math.abs(ent.x - nearest.x) <= 1e-6 || Math.abs(ent.y - nearest.y) <= 1e-6;
            if (aligned && !this._segmentCrossesWall(ent, nearest)) {
                connections.push({
                    type: 'ENTRANCE_CONNECTION',
                    style: 'solid_blue',
                    path: [{ x: ent.x, y: ent.y }, { x: nearest.x, y: nearest.y }]
                });
                continue;
            }

            // Try L-shape A
            const midA = { x: nearest.x, y: ent.y };
            const a1 = !this._segmentCrossesWall(ent, midA);
            const a2 = !this._segmentCrossesWall(midA, nearest);
            if (a1 && a2) {
                connections.push({
                    type: 'ENTRANCE_CONNECTION',
                    style: 'solid_blue',
                    path: [{ x: ent.x, y: ent.y }, midA, { x: nearest.x, y: nearest.y }]
                });
                continue;
            }

            // Try L-shape B
            const midB = { x: ent.x, y: nearest.y };
            const b1 = !this._segmentCrossesWall(ent, midB);
            const b2 = !this._segmentCrossesWall(midB, nearest);
            if (b1 && b2) {
                connections.push({
                    type: 'ENTRANCE_CONNECTION',
                    style: 'solid_blue',
                    path: [{ x: ent.x, y: ent.y }, midB, { x: nearest.x, y: nearest.y }]
                });
                continue;
            }

            // Manhattan detour fallback
            const offsets = [0.6, 1.2, 1.8, 2.4];
            for (const off of offsets) {
                let linked = false;
                for (const s of [-1, 1]) {
                    const y = ent.y + s * off;
                    const p1 = { x: ent.x, y };
                    const p2 = { x: nearest.x, y };
                    if (p1.x < this.bounds.minX || p1.x > this.bounds.maxX || p1.y < this.bounds.minY || p1.y > this.bounds.maxY) continue;
                    if (p2.x < this.bounds.minX || p2.x > this.bounds.maxX || p2.y < this.bounds.minY || p2.y > this.bounds.maxY) continue;
                    if (!this._segmentCrossesWall(ent, p1) && !this._segmentCrossesWall(p1, p2) && !this._segmentCrossesWall(p2, nearest)) {
                        connections.push({
                            type: 'ENTRANCE_CONNECTION',
                            style: 'solid_blue',
                            path: [{ x: ent.x, y: ent.y }, p1, p2, { x: nearest.x, y: nearest.y }]
                        });
                        linked = true;
                        break;
                    }
                }
                if (linked) break;
            }
        }

        return connections;
    }

    _cleanupSegments(segments) {
        return segments
            .map((seg) => {
                const path = seg.path || [];
                if (path.length < 2) return null;
                const deduped = [path[0]];
                for (let i = 1; i < path.length; i++) {
                    const prev = deduped[deduped.length - 1];
                    const cur = path[i];
                    if (Math.hypot(cur.x - prev.x, cur.y - prev.y) > 0.1) {
                        deduped.push(cur);
                    }
                }
                if (deduped.length < 2) return null;
                return { ...seg, path: deduped };
            })
            .filter(Boolean);
    }

    _applyFlowAndArrows(segments) {
        if (!Array.isArray(segments) || segments.length === 0) {
            return { routeConnected: false, routeLength: 0, bridged: false };
        }

        const entrancePoints = this._getEntrancePoints();
        const center = {
            x: (this.bounds.minX + this.bounds.maxX) / 2,
            y: (this.bounds.minY + this.bounds.maxY) / 2
        };
        const { entry: defaultEntry, exit: defaultExit } = this._resolveFlowAnchors(entrancePoints, center);
        let graph = this._buildSegmentGraph(segments);
        let flowEntry = defaultEntry;
        let flowExit = defaultExit;
        let entryNode = this._findNearestNode(graph.nodes, defaultEntry);
        let exitNode = this._findNearestNode(graph.nodes, defaultExit);
        let routeKeys = null;
        let bridged = false;
        const enforceRouteContinuity = this.oneWayFlow && this.allowSyntheticConnectors;

        const connectedAnchors = this._selectConnectedFlowAnchors(
            graph.nodes,
            entrancePoints,
            defaultEntry,
            defaultExit
        );
        if (connectedAnchors) {
            flowEntry = connectedAnchors.entry;
            flowExit = connectedAnchors.exit;
            entryNode = connectedAnchors.entryNode;
            exitNode = connectedAnchors.exitNode;
            routeKeys = connectedAnchors.routeKeys;
        }

        if (!routeKeys && entryNode && exitNode) {
            routeKeys = this._shortestPath(graph.nodes, entryNode.key, exitNode.key);
            if (!routeKeys && enforceRouteContinuity) {
                bridged = this._bridgeDisconnectedGraph(segments, graph, entryNode.key, exitNode.key);
                if (bridged) {
                    graph = this._buildSegmentGraph(segments);
                    entryNode = this._findNearestNode(graph.nodes, flowEntry);
                    exitNode = this._findNearestNode(graph.nodes, flowExit);
                    if (entryNode && exitNode) {
                        routeKeys = this._shortestPath(graph.nodes, entryNode.key, exitNode.key);
                    }
                }
            }
        }

        if (!routeKeys) {
            const fallbackAnchors = this._selectFallbackFlowAnchors(graph.nodes);
            if (fallbackAnchors) {
                flowEntry = fallbackAnchors.entry;
                flowExit = fallbackAnchors.exit;
                entryNode = fallbackAnchors.entryNode;
                exitNode = fallbackAnchors.exitNode;
                routeKeys = fallbackAnchors.routeKeys;
            }
        }

        let routeConnected = Array.isArray(routeKeys) && routeKeys.length >= 2;
        let bridgedComponents = 0;
        if (enforceRouteContinuity && entryNode) {
            bridgedComponents = this._bridgeDetachedComponents(segments, graph, entryNode.key);
            if (bridgedComponents > 0) {
                graph = this._buildSegmentGraph(segments);
                entryNode = this._findNearestNode(graph.nodes, flowEntry) || entryNode;
                exitNode = this._findNearestNode(graph.nodes, flowExit) || exitNode;
                if (entryNode && exitNode) {
                    routeKeys = this._shortestPath(graph.nodes, entryNode.key, exitNode.key) || routeKeys;
                    routeConnected = Array.isArray(routeKeys) && routeKeys.length >= 2;
                }
            }
        }

        const routeEdges = routeConnected ? this._buildRouteEdgeSet(routeKeys) : new Set();
        const distances = entryNode ? this._dijkstra(graph.nodes, entryNode.key) : new Map();
        const routeLength = routeConnected ? routeKeys.length : 0;

        if (routeConnected) {
            console.log(`[CirculationRouter] Flow validated: entry->exit route contains ${routeLength} graph nodes`);
        } else {
            console.warn('[CirculationRouter] Flow warning: unable to validate continuous entry->exit route');
        }

        for (const seg of segments) {
            let path = Array.isArray(seg.path) ? seg.path.slice() : [];
            if (path.length < 2) continue;

            const startKey = this._pointKey(path[0]);
            const endKey = this._pointKey(path[path.length - 1]);
            const dStart = distances.get(startKey);
            const dEnd = distances.get(endKey);
            const hasStart = Number.isFinite(dStart);
            const hasEnd = Number.isFinite(dEnd);

            let reverse = false;
            if (hasStart && hasEnd) {
                reverse = dEnd + 1e-6 < dStart;
            } else if (!hasStart && hasEnd) {
                reverse = true;
            }

            if (reverse) {
                path.reverse();
            }

            const onMainRoute = routeConnected ? this._segmentTouchesRoute(path, routeEdges) : false;
            const pathConnected = Number.isFinite(distances.get(this._pointKey(path[0]))) ||
                Number.isFinite(distances.get(this._pointKey(path[path.length - 1])));

            seg.path = path;
            seg.direction = 'entry_to_exit';
            seg.flowEntry = { x: flowEntry.x, y: flowEntry.y };
            seg.flowExit = { x: flowExit.x, y: flowExit.y };
            seg.onMainRoute = onMainRoute;
            seg.flowValid = this.oneWayFlow ? (pathConnected || onMainRoute) : true;

            const arrows = [];
            if (!seg.flowValid) {
                seg.arrows = arrows;
                continue;
            }

            for (let i = 0; i < path.length - 1; i++) {
                const p1 = path[i];
                const p2 = path[i + 1];
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const len = Math.hypot(dx, dy);
                if (len < 0.25) continue;

                const angle = Math.atan2(dy, dx);
                const baseStep = onMainRoute
                    ? 1.45
                    : (seg.type === 'SPINE' ? 1.65 : 1.85);
                const numArrows = Math.max(1, Math.floor((len + 0.2) / baseStep));
                const nx = -dy / len;
                const ny = dx / len;
                const laneOffset = this.oneWayFlow ? 0 : 0.045;
                for (let a = 0; a < numArrows; a++) {
                    const t = (a + 0.5) / numArrows;
                    const cx = p1.x + dx * t;
                    const cy = p1.y + dy * t;
                    if (this.oneWayFlow) {
                        arrows.push({
                            x: cx,
                            y: cy,
                            angle,
                            kind: seg.type || 'FLOW'
                        });
                    } else {
                        arrows.push({
                            x: cx + nx * laneOffset,
                            y: cy + ny * laneOffset,
                            angle,
                            kind: seg.type || 'FLOW'
                        });
                        arrows.push({
                            x: cx - nx * laneOffset,
                            y: cy - ny * laneOffset,
                            angle: angle + Math.PI,
                            kind: seg.type || 'FLOW'
                        });
                    }
                }
            }
            seg.arrows = arrows;
        }

        return { routeConnected, routeLength, bridged, bridgedComponents };
    }

    _selectConnectedFlowAnchors(nodes, entrancePoints, defaultEntry, defaultExit) {
        if (!nodes || nodes.size < 2) return null;
        if (!Array.isArray(entrancePoints) || entrancePoints.length < 2) {
            const entryNode = this._findNearestNode(nodes, defaultEntry);
            const exitNode = this._findNearestNode(nodes, defaultExit);
            if (!entryNode || !exitNode) return null;
            const routeKeys = this._shortestPath(nodes, entryNode.key, exitNode.key);
            return {
                entry: defaultEntry,
                exit: defaultExit,
                entryNode,
                exitNode,
                routeKeys
            };
        }

        const candidates = entrancePoints
            .map((pt) => ({ pt, node: this._findNearestNode(nodes, pt) }))
            .filter((it) => it.node);
        if (candidates.length < 2) return null;

        let best = null;
        for (let i = 0; i < candidates.length; i++) {
            for (let j = i + 1; j < candidates.length; j++) {
                const a = candidates[i];
                const b = candidates[j];
                const routeKeys = this._shortestPath(nodes, a.node.key, b.node.key);
                if (!routeKeys || routeKeys.length < 2) continue;

                const spread = Math.hypot(a.pt.x - b.pt.x, a.pt.y - b.pt.y);
                if (!best || spread > best.spread) {
                    let entry = a;
                    let exit = b;
                    const aKey = a.pt.x + a.pt.y;
                    const bKey = b.pt.x + b.pt.y;
                    if (aKey > bKey) {
                        entry = b;
                        exit = a;
                    }
                    best = {
                        spread,
                        entry: { x: entry.pt.x, y: entry.pt.y },
                        exit: { x: exit.pt.x, y: exit.pt.y },
                        entryNode: entry.node,
                        exitNode: exit.node,
                        routeKeys
                    };
                }
            }
        }

        if (best) return best;

        const entryNode = this._findNearestNode(nodes, defaultEntry);
        const exitNode = this._findNearestNode(nodes, defaultExit);
        if (!entryNode || !exitNode) return null;
        return {
            entry: defaultEntry,
            exit: defaultExit,
            entryNode,
            exitNode,
            routeKeys: null
        };
    }

    _selectFallbackFlowAnchors(nodes) {
        if (!nodes || nodes.size < 2) return null;
        const { components } = this._buildConnectedComponents(nodes);
        if (!components.length) return null;

        components.sort((a, b) => b.length - a.length);
        const primary = components[0];
        if (!primary || primary.length < 2) return null;

        let bestA = nodes.get(primary[0]);
        let bestB = nodes.get(primary[1]);
        let bestDist = 0;
        for (let i = 0; i < primary.length; i++) {
            const a = nodes.get(primary[i]);
            if (!a) continue;
            for (let j = i + 1; j < primary.length; j++) {
                const b = nodes.get(primary[j]);
                if (!b) continue;
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (d > bestDist) {
                    bestDist = d;
                    bestA = a;
                    bestB = b;
                }
            }
        }

        if (!bestA || !bestB) return null;
        const routeKeys = this._shortestPath(nodes, bestA.key, bestB.key);
        if (!routeKeys || routeKeys.length < 2) return null;

        return {
            entry: { x: bestA.x, y: bestA.y },
            exit: { x: bestB.x, y: bestB.y },
            entryNode: { key: bestA.key, x: bestA.x, y: bestA.y, distance: 0 },
            exitNode: { key: bestB.key, x: bestB.x, y: bestB.y, distance: 0 },
            routeKeys
        };
    }

    _buildSegmentGraph(segments) {
        const nodes = new Map();
        const edges = [];
        const upsert = (pt) => {
            const key = this._pointKey(pt);
            if (!nodes.has(key)) {
                nodes.set(key, { key, x: pt.x, y: pt.y, neighbors: [] });
            }
            return nodes.get(key);
        };

        const toPoint = (raw) => {
            if (!raw) return null;
            const x = Number(raw.x);
            const y = Number(raw.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            return { x, y };
        };

        segments.forEach((seg, segIndex) => {
            if (!Array.isArray(seg.path) || seg.path.length < 2) return;
            for (let i = 0; i < seg.path.length - 1; i++) {
                const p1 = toPoint(seg.path[i]);
                const p2 = toPoint(seg.path[i + 1]);
                if (!p1 || !p2) continue;
                const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                if (!Number.isFinite(len) || len < 0.08) continue;

                const n1 = upsert(p1);
                const n2 = upsert(p2);
                n1.neighbors.push({ toKey: n2.key, length: len, segIndex });
                n2.neighbors.push({ toKey: n1.key, length: len, segIndex });
                edges.push({ fromKey: n1.key, toKey: n2.key, length: len, segIndex });
            }
        });

        return { nodes, edges };
    }

    _findNearestNode(nodes, point) {
        if (!nodes || nodes.size === 0 || !point) return null;
        let best = null;
        let bestDist = Infinity;
        for (const node of nodes.values()) {
            const d = Math.hypot(node.x - point.x, node.y - point.y);
            if (d < bestDist) {
                bestDist = d;
                best = { key: node.key, x: node.x, y: node.y, distance: d };
            }
        }
        return best;
    }

    _dijkstra(nodes, startKey) {
        const dist = new Map();
        if (!nodes || !nodes.has(startKey)) return dist;
        const queue = [{ key: startKey, dist: 0 }];
        dist.set(startKey, 0);

        while (queue.length > 0) {
            queue.sort((a, b) => a.dist - b.dist);
            const cur = queue.shift();
            if (!cur) continue;
            const bestKnown = dist.get(cur.key);
            if (!Number.isFinite(bestKnown) || cur.dist > bestKnown + 1e-9) continue;
            const node = nodes.get(cur.key);
            if (!node) continue;
            for (const nb of node.neighbors) {
                const candidate = cur.dist + nb.length;
                const prev = dist.get(nb.toKey);
                if (!Number.isFinite(prev) || candidate + 1e-9 < prev) {
                    dist.set(nb.toKey, candidate);
                    queue.push({ key: nb.toKey, dist: candidate });
                }
            }
        }
        return dist;
    }

    _shortestPath(nodes, startKey, endKey) {
        if (!nodes || !nodes.has(startKey) || !nodes.has(endKey)) return null;
        if (startKey === endKey) return [startKey];

        const dist = new Map();
        const prev = new Map();
        const queue = [{ key: startKey, dist: 0 }];
        dist.set(startKey, 0);

        while (queue.length > 0) {
            queue.sort((a, b) => a.dist - b.dist);
            const cur = queue.shift();
            if (!cur) continue;
            const known = dist.get(cur.key);
            if (!Number.isFinite(known) || cur.dist > known + 1e-9) continue;
            if (cur.key === endKey) break;

            const node = nodes.get(cur.key);
            if (!node) continue;
            for (const nb of node.neighbors) {
                const nd = cur.dist + nb.length;
                const prevDist = dist.get(nb.toKey);
                if (!Number.isFinite(prevDist) || nd + 1e-9 < prevDist) {
                    dist.set(nb.toKey, nd);
                    prev.set(nb.toKey, cur.key);
                    queue.push({ key: nb.toKey, dist: nd });
                }
            }
        }

        if (!dist.has(endKey)) return null;
        const path = [];
        let cursor = endKey;
        while (cursor) {
            path.push(cursor);
            if (cursor === startKey) break;
            cursor = prev.get(cursor);
        }
        path.reverse();
        return path.length > 0 && path[0] === startKey ? path : null;
    }

    _buildConnectedComponents(nodes) {
        const components = [];
        const componentByNode = new Map();
        const visited = new Set();

        for (const key of nodes.keys()) {
            if (visited.has(key)) continue;
            const stack = [key];
            visited.add(key);
            const compIdx = components.length;
            const compNodes = [];

            while (stack.length > 0) {
                const curKey = stack.pop();
                compNodes.push(curKey);
                componentByNode.set(curKey, compIdx);
                const node = nodes.get(curKey);
                if (!node) continue;
                for (const nb of node.neighbors) {
                    if (visited.has(nb.toKey)) continue;
                    visited.add(nb.toKey);
                    stack.push(nb.toKey);
                }
            }

            components.push(compNodes);
        }

        return { components, componentByNode };
    }

    _bridgeDisconnectedGraph(segments, graph, entryKey, exitKey) {
        if (!graph || !graph.nodes || graph.nodes.size === 0) return false;
        const { components, componentByNode } = this._buildConnectedComponents(graph.nodes);
        const entryComp = componentByNode.get(entryKey);
        const exitComp = componentByNode.get(exitKey);
        if (!Number.isInteger(entryComp) || !Number.isInteger(exitComp)) return false;
        if (entryComp === exitComp) return false;

        const entryNodes = components[entryComp]
            .map((k) => graph.nodes.get(k))
            .filter(Boolean);
        const exitNodes = components[exitComp]
            .map((k) => graph.nodes.get(k))
            .filter(Boolean);
        if (!entryNodes.length || !exitNodes.length) return false;

        const bridgePath = this._findBestWallSafeBridge(entryNodes, exitNodes);
        if (!bridgePath || bridgePath.length < 2) return false;

        segments.push({
            type: 'FLOW_CONNECTOR',
            style: 'solid_blue',
            path: bridgePath,
            synthetic: true
        });

        console.warn(
            `[CirculationRouter] Added flow connector (${bridgePath.length - 1} segment(s)) to enforce entry->exit continuity`
        );
        return true;
    }

    _bridgeDetachedComponents(segments, graph, anchorKey) {
        if (!graph || !graph.nodes || graph.nodes.size === 0 || !anchorKey) return 0;
        const { components, componentByNode } = this._buildConnectedComponents(graph.nodes);
        if (!components.length) return 0;

        const mainComp = componentByNode.get(anchorKey);
        if (!Number.isInteger(mainComp)) return 0;

        let connected = 0;
        let mainNodes = components[mainComp]
            .map((key) => graph.nodes.get(key))
            .filter(Boolean);

        for (let compIdx = 0; compIdx < components.length; compIdx++) {
            if (compIdx === mainComp) continue;
            const compNodes = components[compIdx]
                .map((key) => graph.nodes.get(key))
                .filter(Boolean);
            if (!compNodes.length || !mainNodes.length) continue;

            const bridgePath = this._findBestWallSafeBridge(mainNodes, compNodes);
            if (!bridgePath || bridgePath.length < 2) continue;

            segments.push({
                type: 'FLOW_CONNECTOR',
                style: 'solid_blue',
                path: bridgePath,
                synthetic: true
            });
            connected += 1;

            // Grow the bridge target set progressively so later components can connect through newly-linked geometry.
            mainNodes = mainNodes.concat(compNodes);
        }

        if (connected > 0) {
            console.warn(`[CirculationRouter] Added ${connected} connector(s) to attach detached circulation components`);
        }
        return connected;
    }

    _findBestWallSafeBridge(entryNodes, exitNodes) {
        const sample = (arr, limit) => {
            if (arr.length <= limit) return arr;
            const step = Math.ceil(arr.length / limit);
            const out = [];
            for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
            return out;
        };

        const aNodes = sample(entryNodes, 140);
        const bNodes = sample(exitNodes, 140);

        let best = null;
        for (const a of aNodes) {
            for (const b of bNodes) {
                const connectorPath = this._buildSafeConnectorPath(a, b);
                if (!connectorPath) continue;
                const len = this._pathLength(connectorPath);
                if (!Number.isFinite(len)) continue;
                if (!best || len < best.length) {
                    best = { length: len, path: connectorPath };
                }
            }
        }
        return best ? best.path : null;
    }

    _buildSafeConnectorPath(a, b) {
        const pa = { x: a.x, y: a.y };
        const pb = { x: b.x, y: b.y };
        const inBounds = (p) =>
            p.x >= this.bounds.minX - 1e-6 &&
            p.x <= this.bounds.maxX + 1e-6 &&
            p.y >= this.bounds.minY - 1e-6 &&
            p.y <= this.bounds.maxY + 1e-6;
        const pathSafe = (path) => {
            for (let i = 0; i < path.length - 1; i++) {
                if (this._segmentCrossesWall(path[i], path[i + 1])) return false;
            }
            return true;
        };

        // Keep connectors axis-aligned only (no diagonal visual artifacts).
        if (Math.abs(pa.x - pb.x) <= 1e-6 || Math.abs(pa.y - pb.y) <= 1e-6) {
            if (pathSafe([pa, pb])) return [pa, pb];
        }

        // Try direct L-shapes first.
        const midA = { x: pb.x, y: pa.y };
        if (inBounds(midA) && pathSafe([pa, midA, pb])) return [pa, midA, pb];

        const midB = { x: pa.x, y: pb.y };
        if (inBounds(midB) && pathSafe([pa, midB, pb])) return [pa, midB, pb];

        // If blocked, try Manhattan detours with fixed offsets.
        const offsets = [0.6, 1.2, 1.8, 2.4, 3.0];
        for (const off of offsets) {
            for (const s of [-1, 1]) {
                const y = pa.y + s * off;
                const p1 = { x: pa.x, y };
                const p2 = { x: pb.x, y };
                if (inBounds(p1) && inBounds(p2) && pathSafe([pa, p1, p2, pb])) return [pa, p1, p2, pb];
            }
            for (const s of [-1, 1]) {
                const x = pa.x + s * off;
                const p1 = { x, y: pa.y };
                const p2 = { x, y: pb.y };
                if (inBounds(p1) && inBounds(p2) && pathSafe([pa, p1, p2, pb])) return [pa, p1, p2, pb];
            }
        }

        return null;
    }

    _pathLength(path) {
        if (!Array.isArray(path) || path.length < 2) return 0;
        let len = 0;
        for (let i = 0; i < path.length - 1; i++) {
            len += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
        }
        return len;
    }

    _buildRouteEdgeSet(routeKeys) {
        const set = new Set();
        for (let i = 0; i < routeKeys.length - 1; i++) {
            set.add(this._edgeKey(routeKeys[i], routeKeys[i + 1]));
        }
        return set;
    }

    _segmentTouchesRoute(path, routeEdges) {
        if (!Array.isArray(path) || path.length < 2 || !(routeEdges instanceof Set)) return false;
        for (let i = 0; i < path.length - 1; i++) {
            const k1 = this._pointKey(path[i]);
            const k2 = this._pointKey(path[i + 1]);
            if (routeEdges.has(this._edgeKey(k1, k2))) return true;
        }
        return false;
    }

    _edgeKey(a, b) {
        return a < b ? `${a}|${b}` : `${b}|${a}`;
    }

    _resolveFlowAnchors(entrancePoints, center) {
        if (entrancePoints.length >= 2) {
            let bestA = entrancePoints[0];
            let bestB = entrancePoints[1];
            let bestD = -Infinity;
            for (let i = 0; i < entrancePoints.length; i++) {
                for (let j = i + 1; j < entrancePoints.length; j++) {
                    const a = entrancePoints[i];
                    const b = entrancePoints[j];
                    const d = Math.hypot(a.x - b.x, a.y - b.y);
                    if (d > bestD) {
                        bestD = d;
                        bestA = a;
                        bestB = b;
                    }
                }
            }
            const aKey = bestA.x + bestA.y;
            const bKey = bestB.x + bestB.y;
            return aKey <= bKey
                ? { entry: bestA, exit: bestB }
                : { entry: bestB, exit: bestA };
        }

        if (entrancePoints.length === 1) {
            const entry = entrancePoints[0];
            const exit = {
                x: 2 * center.x - entry.x,
                y: 2 * center.y - entry.y
            };
            return { entry, exit };
        }

        const entry = { x: this.bounds.minX, y: this.bounds.minY };
        const exit = { x: this.bounds.maxX, y: this.bounds.maxY };
        return { entry, exit };
    }

    _upsertNode(nodes, p) {
        const key = this._pointKey(p);
        if (!nodes.has(key)) {
            nodes.set(key, { key, x: p.x, y: p.y, edges: new Set() });
        }
        return nodes.get(key);
    }

    _uniquePoints(points) {
        const seen = new Set();
        const out = [];
        for (const p of points) {
            const key = this._pointKey(p);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ x: p.x, y: p.y });
        }
        return out;
    }

    _pointKey(p) {
        return `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
    }

    _getEntrancePoints() {
        const points = [];
        for (const ent of this.entrances) {
            if (ent.start && ent.end) {
                points.push({
                    x: (ent.start.x + ent.end.x) / 2,
                    y: (ent.start.y + ent.end.y) / 2
                });
            } else if (ent.x != null && ent.y != null) {
                points.push({ x: ent.x, y: ent.y });
            }
        }
        return points;
    }

    _segmentCrossesWall(p1, p2) {
        const ax = p1.x;
        const ay = p1.y;
        const bx = p2.x;
        const by = p2.y;
        const dLen = Math.hypot(bx - ax, by - ay);
        if (dLen < 0.1) return false;

        const shrink = 0.05 / dLen;
        const sax = ax + (bx - ax) * shrink;
        const say = ay + (by - ay) * shrink;
        const sbx = bx - (bx - ax) * shrink;
        const sby = by - (by - ay) * shrink;

        for (const wall of this.allWalls) {
            const wMinX = Math.min(wall.x1, wall.x2);
            const wMaxX = Math.max(wall.x1, wall.x2);
            const wMinY = Math.min(wall.y1, wall.y2);
            const wMaxY = Math.max(wall.y1, wall.y2);
            const sMinX = Math.min(sax, sbx);
            const sMaxX = Math.max(sax, sbx);
            const sMinY = Math.min(say, sby);
            const sMaxY = Math.max(say, sby);
            if (wMaxX < sMinX || wMinX > sMaxX || wMaxY < sMinY || wMinY > sMaxY) continue;

            if (this._segSegIntersect(sax, say, sbx, sby, wall.x1, wall.y1, wall.x2, wall.y2)) {
                return true;
            }
        }
        return false;
    }

    _segSegIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
        const cross = (ux, uy, vx, vy) => ux * vy - uy * vx;
        const rx = bx - ax;
        const ry = by - ay;
        const sx = dx - cx;
        const sy = dy - cy;
        const denom = cross(rx, ry, sx, sy);
        if (Math.abs(denom) < 1e-10) return false;
        const t = cross(cx - ax, cy - ay, sx, sy) / denom;
        const u = cross(cx - ax, cy - ay, rx, ry) / denom;
        return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
    }
}

module.exports = CirculationRouter;
