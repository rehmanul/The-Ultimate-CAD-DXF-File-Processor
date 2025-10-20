/**
 * Multi-Floor Manager
 * Aligns multiple floor plans, detects vertical circulation connectors,
 * builds cross-floor connectivity graphs, and exposes consolidated metadata
 * for stacked building analysis.
 */

const DEFAULT_FLOOR_HEIGHT = 3.2; // meters
const DEFAULT_MATCH_TOLERANCE = 1.25; // meters
const DEFAULT_EGRESS_LIMIT = 45; // meters (approximate code requirement)

class MultiFloorManager {
    /**
     * @param {Object} [options]
     * @param {number} [options.floorHeight] - Default distance between floors in meters.
     * @param {number} [options.connectorMatchTolerance] - Max XY delta for aligning vertical connectors.
     * @param {number} [options.egressDistanceLimit] - Maximum allowed straight-line distance to an exit.
     * @param {boolean} [options.requireElevators] - Whether elevators are required for accessibility.
     * @param {number} [options.minimumAccessibleEntrances] - Minimum number of grade-level accessible entrances.
     */
    constructor(options = {}) {
        this.floorHeight = typeof options.floorHeight === 'number' ? options.floorHeight : DEFAULT_FLOOR_HEIGHT;
        this.connectorMatchTolerance = typeof options.connectorMatchTolerance === 'number'
            ? options.connectorMatchTolerance
            : DEFAULT_MATCH_TOLERANCE;
        this.alignmentTolerance = options.alignmentTolerance || 0.02; // meters
        this.egressDistanceLimit = typeof options.egressDistanceLimit === 'number'
            ? options.egressDistanceLimit
            : DEFAULT_EGRESS_LIMIT;
        this.requireElevators = options.requireElevators !== undefined ? options.requireElevators : true;
        this.minimumAccessibleEntrances = typeof options.minimumAccessibleEntrances === 'number'
            ? options.minimumAccessibleEntrances
            : 1;
    }

    /**
     * Stack multiple floors into a single building representation.
     * @param {Array} floors
     * @returns {Object}
     */
    stackFloors(floors) {
        if (!Array.isArray(floors) || floors.length === 0) {
            throw new Error('At least one floor is required');
        }

        const normalizedFloors = this._normalizeFloors(floors);
        const alignmentWarnings = this._validateAlignment(normalizedFloors);
        const connectors = this._detectConnectorCandidates(normalizedFloors);
        const edges = this._matchVerticalConnectors(connectors);
        const graph = this._buildVerticalGraph(connectors, edges);
        const crossFloorPaths = this._computeCrossFloorPaths(graph, normalizedFloors);
        const compliance = this._computeCompliance(normalizedFloors, connectors, edges);

        return {
            floors: normalizedFloors,
            connectors,
            edges,
            graph,
            crossFloorPaths,
            stats: this._buildStats(normalizedFloors, connectors, edges, compliance),
            compliance,
            warnings: alignmentWarnings
        };
    }

    /**
     * Normalize floor payloads into consistent structure.
     * @param {Array} floors
     * @returns {Array}
     * @private
     */
    _normalizeFloors(floors) {
        return floors
            .map((input, index) => {
                if (!input || typeof input !== 'object') {
                    throw new Error(`Floor at index ${index} is invalid`);
                }

                const floorPlan = input.floorPlan || input.plan || null;
                if (!floorPlan || typeof floorPlan !== 'object') {
                    throw new Error(`Floor ${input.id || index} is missing floorPlan data`);
                }

                const bounds = floorPlan.bounds || {};
                if (typeof bounds.width !== 'number' || typeof bounds.height !== 'number') {
                    throw new Error(`Floor ${input.id || index} is missing bounds width/height`);
                }

                const level = typeof input.level === 'number'
                    ? input.level
                    : (typeof input.floor === 'number' ? input.floor : index);

                const z = typeof input.z === 'number' ? input.z : level * this.floorHeight;

                return {
                    id: input.id || `floor_${index}`,
                    name: input.name || input.id || `Floor ${level}`,
                    level,
                    z,
                    floorHeight: input.floorHeight || this.floorHeight,
                    translation: {
                        x: input.translation?.x || 0,
                        y: input.translation?.y || 0,
                        z
                    },
                    bounds: {
                        minX: bounds.minX ?? 0,
                        minY: bounds.minY ?? 0,
                        maxX: bounds.maxX ?? bounds.width,
                        maxY: bounds.maxY ?? bounds.height,
                        width: bounds.width,
                        height: bounds.height,
                        area: bounds.area ?? (bounds.width * bounds.height)
                    },
                    floorPlan,
                    ilots: input.ilots || floorPlan.ilots || [],
                    corridors: input.corridors || floorPlan.corridors || [],
                    metadata: input.metadata || {}
                };
            })
            .sort((a, b) => a.level - b.level);
    }

    /**
     * Ensure floors align within tolerances.
     * @param {Array} floors
     * @returns {Array<string>} warnings
     * @private
     */
    _validateAlignment(floors) {
        if (floors.length <= 1) return [];

        const reference = floors[0].bounds;
        const warnings = [];

        floors.forEach((floor) => {
            const widthDelta = Math.abs(floor.bounds.width - reference.width);
            const heightDelta = Math.abs(floor.bounds.height - reference.height);

            if (widthDelta > this.alignmentTolerance || heightDelta > this.alignmentTolerance) {
                warnings.push(`Floor ${floor.id} bounds differ from base floor by ${widthDelta.toFixed(3)}m width, ${heightDelta.toFixed(3)}m height.`);
            }
        });

        return warnings;
    }

    /**
     * Extract vertical circulation candidates per floor.
     * @param {Array} floors
     * @returns {Array} connectors
     * @private
     */
    _detectConnectorCandidates(floors) {
        const connectors = [];
        const keywordMatchers = [/STAIR/i, /ELEVATOR/i, /LIFT/i, /ESCALATOR/i, /SHAFT/i];

        floors.forEach((floor) => {
            const zones = floor.floorPlan.forbiddenZones || [];
            let index = 0;

            zones.forEach((zone) => {
                const label = String(zone.layer || zone.name || zone.type || '').toUpperCase();
                const isVertical = keywordMatchers.some((regex) => regex.test(label));
                if (!isVertical) return;

                const centroid = this._extractCentroid(zone);
                if (!centroid) return;

                const bbox = this._extractBoundingBox(zone);
                connectors.push({
                    id: `${floor.id}_${label}_${index++}`,
                    floorId: floor.id,
                    floorLevel: floor.level,
                    type: this._resolveConnectorType(label),
                    centroid,
                    boundingBox: bbox,
                    polygon: this._extractPolygon(zone),
                    area: bbox ? bbox.area : null,
                    metadata: {
                        label,
                        originalLayer: zone.layer || null,
                        height: floor.floorHeight
                    }
                });
            });
        });

        return connectors;
    }

    /**
     * Attempt to match connectors between adjacent floors.
     * @param {Array} connectors
     * @returns {Array} edges
     * @private
     */
    _matchVerticalConnectors(connectors) {
        if (connectors.length === 0) return [];

        const byFloor = connectors.reduce((acc, connector) => {
            if (!acc[connector.floorLevel]) acc[connector.floorLevel] = [];
            acc[connector.floorLevel].push(connector);
            return acc;
        }, {});

        const levels = Object.keys(byFloor).map(Number).sort((a, b) => a - b);
        const edges = [];

        levels.forEach((level) => {
            const current = byFloor[level] || [];
            const next = byFloor[level + 1] || [];
            if (!current.length || !next.length) return;

            const usedNext = new Set();

            current.forEach((connector) => {
                const candidates = next
                    .filter((cand) => !usedNext.has(cand.id) && cand.type === connector.type)
                    .map((cand) => ({
                        candidate: cand,
                        distance: this._distance2D(connector.centroid, cand.centroid)
                    }))
                    .sort((a, b) => a.distance - b.distance);

                const best = candidates.find((c) => c.distance <= this.connectorMatchTolerance);
                if (best) {
                    usedNext.add(best.candidate.id);
                    edges.push({
                        id: `${connector.id}__${best.candidate.id}`,
                        from: connector.id,
                        to: best.candidate.id,
                        type: connector.type,
                        weight: best.distance,
                        levelDelta: 1
                    });
                }
            });
        });

        return edges;
    }

    /**
     * Build graph structure from connectors and edges.
     * @param {Array} connectors
     * @param {Array} edges
     * @returns {{nodes: Array, edges: Array, adjacency: Object}}
     * @private
     */
    _buildVerticalGraph(connectors, edges) {
        const adjacency = {};
        connectors.forEach((connector) => {
            adjacency[connector.id] = [];
        });

        edges.forEach((edge) => {
            adjacency[edge.from].push(edge.to);
            adjacency[edge.to].push(edge.from);
        });

        return {
            nodes: connectors,
            edges,
            adjacency
        };
    }

    /**
     * Compute cross-floor paths using BFS across vertical connectors.
     * @param {Object} graph
     * @param {Array} floors
     * @returns {Array}
     * @private
     */
    _computeCrossFloorPaths(graph, floors) {
        const paths = [];
        if (!graph.nodes.length) return paths;

        const floorIdsByLevel = floors.reduce((acc, floor) => {
            acc[floor.level] = floor.id;
            return acc;
        }, {});

        const connectorsByFloor = graph.nodes.reduce((acc, connector) => {
            if (!acc[connector.floorLevel]) acc[connector.floorLevel] = [];
            acc[connector.floorLevel].push(connector);
            return acc;
        }, {});

        const levels = Object.keys(connectorsByFloor).map(Number).sort((a, b) => a - b);

        for (let i = 0; i < levels.length; i++) {
            for (let j = i + 1; j < levels.length; j++) {
                const startLevel = levels[i];
                const endLevel = levels[j];
                const startNodes = connectorsByFloor[startLevel] || [];
                const targetIds = new Set((connectorsByFloor[endLevel] || []).map((node) => node.id));
                if (!startNodes.length || !targetIds.size) continue;

                const visited = new Set();
                const queue = startNodes.map((node) => ({
                    nodeId: node.id,
                    path: [node.id]
                }));

                let foundPath = null;
                while (queue.length && !foundPath) {
                    const current = queue.shift();
                    if (targetIds.has(current.nodeId)) {
                        foundPath = current.path;
                        break;
                    }
                    visited.add(current.nodeId);

                    const neighbors = graph.adjacency[current.nodeId] || [];
                    neighbors.forEach((neighborId) => {
                        if (visited.has(neighborId)) return;
                        queue.push({
                            nodeId: neighborId,
                            path: [...current.path, neighborId]
                        });
                    });
                }

                if (foundPath) {
                    paths.push({
                        fromLevel: startLevel,
                        toLevel: endLevel,
                        fromFloorId: floorIdsByLevel[startLevel],
                        toFloorId: floorIdsByLevel[endLevel],
                        nodePath: foundPath
                    });
                }
            }
        }

        return paths;
    }

    /**
     * Build stats summary.
     * @param {Array} floors
     * @param {Array} connectors
     * @param {Array} edges
     * @returns {Object}
     * @private
     */
    _buildStats(floors, connectors, edges, compliance) {
        const connectorsByType = connectors.reduce((acc, connector) => {
            if (!acc[connector.type]) acc[connector.type] = 0;
            acc[connector.type] += 1;
            return acc;
        }, {});

        return {
            floorCount: floors.length,
            totalHeight: (floors.length - 1) * this.floorHeight,
            connectors: connectorsByType,
            verticalConnections: edges.length,
            complianceSummary: {
                egress: {
                    passCount: compliance.egress.floors.filter(f => f.pass).length,
                    failCount: compliance.egress.floors.filter(f => !f.pass).length
                },
                accessibility: {
                    passCount: compliance.accessibility.floors.filter(f => f.pass).length,
                    failCount: compliance.accessibility.floors.filter(f => !f.pass).length
                }
            }
        };
    }

    /**
     * Resolve connector type from label.
     * @param {string} label
     * @returns {string}
     * @private
     */
    _resolveConnectorType(label) {
        const normalized = label.toUpperCase();
        if (normalized.includes('ELEVATOR') || normalized.includes('LIFT')) return 'elevator';
        if (normalized.includes('ESCALATOR')) return 'escalator';
        if (normalized.includes('SHAFT')) return 'shaft';
        return 'stair';
    }

    /**
     * Extract polygon data if available.
     * @param {Object} zone
     * @returns {Array|null}
     * @private
     */
    _extractPolygon(zone) {
        if (Array.isArray(zone.polygon)) return zone.polygon;
        if (Array.isArray(zone.points)) return zone.points;
        if (Array.isArray(zone.vertices)) return zone.vertices;
        return null;
    }

    /**
     * Compute centroid from various geometry descriptions.
     * @param {Object} zone
     * @returns {{x:number,y:number}|null}
     * @private
     */
    _extractCentroid(zone) {
        if (zone.center && typeof zone.center.x === 'number' && typeof zone.center.y === 'number') {
            return { x: zone.center.x, y: zone.center.y };
        }

        const polygon = this._extractPolygon(zone);
        if (polygon && polygon.length) {
            return this._polygonCentroid(polygon);
        }

        if (zone.start && zone.end) {
            const sx = zone.start.x ?? zone.start[0];
            const sy = zone.start.y ?? zone.start[1];
            const ex = zone.end.x ?? zone.end[0];
            const ey = zone.end.y ?? zone.end[1];
            if ([sx, sy, ex, ey].every((val) => typeof val === 'number')) {
                return { x: (sx + ex) / 2, y: (sy + ey) / 2 };
            }
        }

        if (typeof zone.x === 'number' && typeof zone.y === 'number') {
            return { x: zone.x, y: zone.y };
        }

        return null;
    }

    /**
     * Compute bounding box.
     * @param {Object} zone
     * @returns {{minX:number,minY:number,maxX:number,maxY:number,width:number,height:number,area:number}|null}
     * @private
     */
    _extractBoundingBox(zone) {
        const polygon = this._extractPolygon(zone);
        if (polygon && polygon.length) {
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            polygon.forEach((point) => {
                const x = point.x ?? point[0];
                const y = point.y ?? point[1];
                if (typeof x !== 'number' || typeof y !== 'number') return;
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            });
            if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;
            const width = maxX - minX;
            const height = maxY - minY;
            return {
                minX,
                minY,
                maxX,
                maxY,
                width,
                height,
                area: width * height
            };
        }
        return null;
    }

    /**
     * Compute centroid of polygon.
     * @param {Array} polygon
     * @returns {{x:number,y:number}}
     * @private
     */
    _polygonCentroid(polygon) {
        let area = 0;
        let cx = 0;
        let cy = 0;

        for (let i = 0; i < polygon.length; i++) {
            const p1 = polygon[i];
            const p2 = polygon[(i + 1) % polygon.length];
            const x1 = p1.x ?? p1[0];
            const y1 = p1.y ?? p1[1];
            const x2 = p2.x ?? p2[0];
            const y2 = p2.y ?? p2[1];

            const f = (x1 * y2) - (x2 * y1);
            area += f;
            cx += (x1 + x2) * f;
            cy += (y1 + y2) * f;
        }

        area *= 0.5;
        if (Math.abs(area) < 1e-9) {
            // Degenerate polygon - fallback to average of vertices
            const total = polygon.length;
            const sum = polygon.reduce((acc, point) => {
                const x = point.x ?? point[0];
                const y = point.y ?? point[1];
                return { x: acc.x + x, y: acc.y + y };
            }, { x: 0, y: 0 });
            return { x: sum.x / total, y: sum.y / total };
        }

        const factor = 1 / (6 * area);
        return { x: cx * factor, y: cy * factor };
    }

    /**
     * Euclidean distance in 2D.
     * @param {{x:number,y:number}} a
     * @param {{x:number,y:number}} b
     * @returns {number}
     * @private
     */
    _distance2D(a, b) {
        return Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));
    }

    /**
     * Compute compliance metrics for egress and accessibility.
     * @param {Array} floors
     * @param {Array} connectors
     * @param {Array} edges
     * @returns {Object}
     * @private
     */
    _computeCompliance(floors, connectors, edges) {
        const egressResults = [];
        const accessibilityResults = [];
        const connectorsByFloorId = connectors.reduce((acc, connector) => {
            if (!acc[connector.floorId]) acc[connector.floorId] = [];
            acc[connector.floorId].push(connector);
            return acc;
        }, {});

        floors.forEach((floor) => {
            const floorId = floor.id;
            const floorConnectors = connectorsByFloorId[floorId] || [];
            const rooms = floor.floorPlan?.rooms || [];
            const entrances = floor.floorPlan?.entrances || [];

            // --- Egress evaluation ---
            const egressReport = {
                floorId,
                floorLevel: floor.level,
                roomCount: rooms.length,
                evaluatedRooms: 0,
                maxDistance: 0,
                averageDistance: 0,
                pass: true,
                violations: []
            };

            if (rooms.length === 0 || entrances.length === 0) {
                egressReport.pass = false;
                egressReport.violations.push('Insufficient geometry (rooms or entrances) to evaluate egress distances.');
            } else {
                let totalDistance = 0;
                const distances = [];
                rooms.forEach((room) => {
                    const centroid = this._extractRoomCentroid(room);
                    if (!centroid) return;
                    const distance = this._distanceToNearestEntrance(centroid, entrances);
                    if (distance === null) return;
                    distances.push(distance);
                    totalDistance += distance;
                });

                if (distances.length === 0) {
                    egressReport.pass = false;
                    egressReport.violations.push('No room could be paired with a valid exit.');
                } else {
                    egressReport.evaluatedRooms = distances.length;
                    egressReport.maxDistance = Math.max(...distances);
                    egressReport.averageDistance = totalDistance / distances.length;
                    if (egressReport.maxDistance > this.egressDistanceLimit) {
                        egressReport.pass = false;
                        egressReport.violations.push(`Max egress distance ${egressReport.maxDistance.toFixed(1)}m exceeds limit ${this.egressDistanceLimit}m.`);
                    }
                }
            }

            // --- Accessibility evaluation ---
            const accessibilityReport = {
                floorId,
                floorLevel: floor.level,
                hasElevator: floorConnectors.some(conn => conn.type === 'elevator'),
                stairCount: floorConnectors.filter(conn => conn.type === 'stair' || conn.type === 'escalator').length,
                accessibleEntrances: this._countAccessibleEntrances(entrances),
                pass: true,
                notes: []
            };

            if (floor.level > 0) {
                if (floorConnectors.length === 0) {
                    accessibilityReport.pass = false;
                    accessibilityReport.notes.push('No vertical connector (stair/elevator) found for this floor.');
                }
                if (this.requireElevators && !accessibilityReport.hasElevator) {
                    accessibilityReport.pass = false;
                    accessibilityReport.notes.push('Accessibility requirement: elevator missing for upper floor.');
                }
            }

            if (floor.level === 0) {
                if (accessibilityReport.accessibleEntrances < this.minimumAccessibleEntrances) {
                    accessibilityReport.pass = false;
                    accessibilityReport.notes.push(`Need at least ${this.minimumAccessibleEntrances} accessible entrance(s).`);
                }
            }

            egressResults.push(egressReport);
            accessibilityResults.push(accessibilityReport);
        });

        return {
            egress: {
                floors: egressResults
            },
            accessibility: {
                floors: accessibilityResults
            }
        };
    }

    /**
     * Determine approximate room centroid.
     * @param {Object} room
     * @returns {{x:number,y:number}|null}
     * @private
     */
    _extractRoomCentroid(room) {
        if (!room) return null;
        if (room.center && typeof room.center.x === 'number' && typeof room.center.y === 'number') {
            return { x: room.center.x, y: room.center.y };
        }
        if (room.centroid && typeof room.centroid.x === 'number' && typeof room.centroid.y === 'number') {
            return { x: room.centroid.x, y: room.centroid.y };
        }
        if (Array.isArray(room.polygon) && room.polygon.length) {
            return this._polygonCentroid(room.polygon);
        }
        if (typeof room.x === 'number' && typeof room.y === 'number') {
            return { x: room.x, y: room.y };
        }
        return null;
    }

    /**
     * Find nearest entrance to a point.
     * @param {{x:number,y:number}} point
     * @param {Array} entrances
     * @returns {number|null}
     * @private
     */
    _distanceToNearestEntrance(point, entrances) {
        if (!point || !entrances || entrances.length === 0) return null;

        let min = Infinity;
        entrances.forEach((entrance) => {
            const centroid = this._extractCentroid(entrance);
            if (!centroid) return;
            const d = this._distance2D(point, centroid);
            if (d < min) min = d;
        });

        return min === Infinity ? null : min;
    }

    /**
     * Count accessible entrances (simple heuristic: doorway width >= 0.9m).
     * @param {Array} entrances
     * @returns {number}
     * @private
     */
    _countAccessibleEntrances(entrances) {
        if (!Array.isArray(entrances) || entrances.length === 0) return 0;
        let count = 0;
        entrances.forEach((entrance) => {
            const width = this._estimateEntranceWidth(entrance);
            if (width >= 0.9) count += 1;
        });
        return count;
    }

    /**
     * Estimate entrance width based on geometry.
     * @param {Object} entrance
     * @returns {number}
     * @private
     */
    _estimateEntranceWidth(entrance) {
        if (entrance.width && typeof entrance.width === 'number') return entrance.width;
        if (entrance.boundingBox) {
            return Math.max(entrance.boundingBox.width || 0, entrance.boundingBox.height || 0);
        }
        if (entrance.start && entrance.end) {
            const sx = entrance.start.x ?? entrance.start[0];
            const sy = entrance.start.y ?? entrance.start[1];
            const ex = entrance.end.x ?? entrance.end[0];
            const ey = entrance.end.y ?? entrance.end[1];
            if ([sx, sy, ex, ey].every((val) => typeof val === 'number')) {
                return Math.hypot(ex - sx, ey - sy);
            }
        }
        if (Array.isArray(entrance.polygon) && entrance.polygon.length >= 2) {
            const [p1, p2] = [entrance.polygon[0], entrance.polygon[1]];
            const x1 = p1.x ?? p1[0];
            const y1 = p1.y ?? p1[1];
            const x2 = p2.x ?? p2[0];
            const y2 = p2.y ?? p2[1];
            if ([x1, y1, x2, y2].every((val) => typeof val === 'number')) {
                return Math.hypot(x2 - x1, y2 - y1);
            }
        }
        return 0;
    }
}

module.exports = MultiFloorManager;
