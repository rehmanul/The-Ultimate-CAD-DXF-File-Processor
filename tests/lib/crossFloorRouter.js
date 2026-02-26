/**
 * Cross-Floor Router
 * Builds a multi-floor circulation network using connector metadata
 * and returns vertical + horizontal path segments between floors.
 */

const DEFAULT_LEVEL_HEIGHT = 3.2;
const DEFAULT_HORIZONTAL_WEIGHT = 1.0;
const DEFAULT_VERTICAL_WEIGHT = 1.4;

function computeRoutes(floors = [], connectors = [], edges = [], options = {}) {
    if (!Array.isArray(connectors) || connectors.length === 0) {
        return {
            graph: { adjacency: {}, nodes: {} },
            routes: [],
            segments: [],
            summary: {
                componentCount: 0,
                routeCount: 0,
                segmentCount: 0,
                unreachable: []
            }
        };
    }

    const levelHeight = typeof options.floorHeight === 'number' && options.floorHeight > 0
        ? options.floorHeight
        : DEFAULT_LEVEL_HEIGHT;

    const horizontalWeight = typeof options.horizontalWeight === 'number' && options.horizontalWeight > 0
        ? options.horizontalWeight
        : DEFAULT_HORIZONTAL_WEIGHT;

    const verticalWeight = typeof options.verticalWeight === 'number' && options.verticalWeight > 0
        ? options.verticalWeight
        : DEFAULT_VERTICAL_WEIGHT;

    const nodes = new Map();
    connectors.forEach((connector) => {
        if (!connector || !connector.id) return;
        nodes.set(connector.id, normalizeConnector(connector));
    });

    const adjacency = buildAdjacency(nodes, edges, {
        levelHeight,
        horizontalWeight,
        verticalWeight
    });

    const components = buildComponents(nodes, adjacency);
    const segments = [];
    const segmentLookup = new Map();
    const paths = [];
    const unreachable = [];

    components.forEach((component) => {
        if (!component.size) return;
        const baseLevel = Math.min(...Array.from(component).map(id => nodes.get(id).floorLevel));
        const baseNodes = Array.from(component).filter(id => nodes.get(id).floorLevel === baseLevel);
        const otherNodes = Array.from(component).filter(id => nodes.get(id).floorLevel !== baseLevel);

        if (baseNodes.length === 0 || otherNodes.length === 0) return;

        otherNodes.forEach((nodeId) => {
            const bestPath = findBestPath(nodeId, baseNodes, nodes, adjacency, levelHeight);
            if (!bestPath) {
                unreachable.push(nodeId);
                return;
            }

            const segmentIndices = addSegmentsForPath(bestPath.path, nodes, segments, segmentLookup, levelHeight);
            paths.push({
                id: `${nodeId}__${bestPath.target}`,
                from: nodeId,
                to: bestPath.target,
                cost: bestPath.cost,
                floors: bestPath.path.map(id => nodes.get(id).floorLevel),
                segments: segmentIndices
            });
        });
    });

    return {
        graph: {
            adjacency,
            nodes: Object.fromEntries(nodes.entries())
        },
        routes: paths,
        segments,
        summary: {
            componentCount: components.length,
            routeCount: paths.length,
            segmentCount: segments.length,
            unreachable
        }
    };
}

function normalizeConnector(connector) {
    const centroid = connector.centroid || connector.center || (connector.boundingBox
        ? {
            x: (connector.boundingBox.minX + connector.boundingBox.maxX) / 2,
            y: (connector.boundingBox.minY + connector.boundingBox.maxY) / 2
        }
        : null);

    return {
        id: connector.id,
        floorId: connector.floorId,
        floorLevel: connector.floorLevel ?? 0,
        type: connector.type || 'stair',
        centroid: centroid ? { x: centroid.x || 0, y: centroid.y || 0 } : { x: 0, y: 0 },
        metadata: connector.metadata || {}
    };
}

function buildAdjacency(nodes, edges, options) {
    const adjacency = {};

    nodes.forEach((node) => {
        adjacency[node.id] = [];
    });

    // Horizontal connections between connectors on the same floor
    const nodesByFloor = {};
    nodes.forEach((node) => {
        if (!nodesByFloor[node.floorLevel]) nodesByFloor[node.floorLevel] = [];
        nodesByFloor[node.floorLevel].push(node);
    });

    Object.values(nodesByFloor).forEach((floorNodes) => {
        for (let i = 0; i < floorNodes.length; i++) {
            for (let j = i + 1; j < floorNodes.length; j++) {
                const a = floorNodes[i];
                const b = floorNodes[j];
                const weight = horizontalDistance(a, b) * options.horizontalWeight;
                adjacency[a.id].push({ id: b.id, weight, type: 'horizontal' });
                adjacency[b.id].push({ id: a.id, weight, type: 'horizontal' });
            }
        }
    });

    // Vertical connections derived from stack edges
    edges.forEach((edge) => {
        if (!edge || !edge.from || !edge.to) return;
        if (!nodes.has(edge.from) || !nodes.has(edge.to)) return;

        const a = nodes.get(edge.from);
        const b = nodes.get(edge.to);
        const deltaLevel = Math.abs((a.floorLevel ?? 0) - (b.floorLevel ?? 0));
        const weight = verticalDistance(a, b, options.levelHeight, deltaLevel) * options.verticalWeight;

        adjacency[a.id].push({ id: b.id, weight, type: 'vertical' });
        adjacency[b.id].push({ id: a.id, weight, type: 'vertical' });
    });

    return adjacency;
}

function horizontalDistance(a, b) {
    const dx = (a.centroid?.x || 0) - (b.centroid?.x || 0);
    const dy = (a.centroid?.y || 0) - (b.centroid?.y || 0);
    return Math.sqrt(dx * dx + dy * dy);
}

function verticalDistance(a, b, levelHeight, deltaLevel) {
    const base = horizontalDistance(a, b);
    const dz = (deltaLevel || Math.abs((a.floorLevel ?? 0) - (b.floorLevel ?? 0))) * levelHeight;
    return Math.sqrt(base * base + dz * dz);
}

function buildComponents(nodes, adjacency) {
    const visited = new Set();
    const components = [];

    nodes.forEach((node) => {
        if (visited.has(node.id)) return;
        const stack = [node.id];
        const component = new Set();

        while (stack.length) {
            const current = stack.pop();
            if (visited.has(current)) continue;
            visited.add(current);
            component.add(current);

            (adjacency[current] || []).forEach((neighbor) => {
                if (!visited.has(neighbor.id)) stack.push(neighbor.id);
            });
        }

        components.push(component);
    });

    return components;
}

function findBestPath(startId, targets, nodes, adjacency, levelHeight) {
    let best = null;
    targets.forEach((targetId) => {
        if (startId === targetId) return;
        const result = aStar(startId, targetId, nodes, adjacency, levelHeight);
        if (!result) return;
        if (!best || result.cost < best.cost) {
            best = { target: targetId, ...result };
        }
    });
    return best;
}

function aStar(startId, goalId, nodes, adjacency, levelHeight) {
    if (!nodes.has(startId) || !nodes.has(goalId)) return null;

    const openSet = new Set([startId]);
    const cameFrom = {};
    const gScore = {};
    const fScore = {};

    nodes.forEach((_, id) => {
        gScore[id] = Infinity;
        fScore[id] = Infinity;
    });
    gScore[startId] = 0;
    fScore[startId] = heuristic(nodes.get(startId), nodes.get(goalId), levelHeight);

    while (openSet.size > 0) {
        let current = null;
        let lowest = Infinity;

        openSet.forEach((id) => {
            if (fScore[id] < lowest) {
                lowest = fScore[id];
                current = id;
            }
        });

        if (current === goalId) {
            const path = reconstructPath(cameFrom, current);
            return {
                path,
                cost: gScore[current]
            };
        }

        openSet.delete(current);

        (adjacency[current] || []).forEach((neighbor) => {
            const tentativeG = gScore[current] + neighbor.weight;
            if (tentativeG < gScore[neighbor.id]) {
                cameFrom[neighbor.id] = current;
                gScore[neighbor.id] = tentativeG;
                fScore[neighbor.id] = tentativeG + heuristic(nodes.get(neighbor.id), nodes.get(goalId), levelHeight);
                if (!openSet.has(neighbor.id)) {
                    openSet.add(neighbor.id);
                }
            }
        });
    }

    return null;
}

function heuristic(a, b, levelHeight) {
    if (!a || !b) return Infinity;
    const dx = (a.centroid?.x || 0) - (b.centroid?.x || 0);
    const dy = (a.centroid?.y || 0) - (b.centroid?.y || 0);
    const dz = ((a.floorLevel ?? 0) - (b.floorLevel ?? 0)) * levelHeight;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function reconstructPath(cameFrom, current) {
    const path = [current];
    while (cameFrom[current] !== undefined) {
        current = cameFrom[current];
        path.unshift(current);
    }
    return path;
}

function addSegmentsForPath(path, nodes, segments, segmentLookup, levelHeight) {
    const indices = [];

    for (let i = 0; i < path.length - 1; i++) {
        const start = nodes.get(path[i]);
        const end = nodes.get(path[i + 1]);
        if (!start || !end) continue;

        const type = start.floorLevel === end.floorLevel ? 'horizontal' : 'vertical';
        const key = `${start.id}->${end.id}`;
        const reverseKey = `${end.id}->${start.id}`;

        if (!segmentLookup.has(key) && segmentLookup.has(reverseKey)) {
            indices.push(segmentLookup.get(reverseKey));
            continue;
        }

        if (!segmentLookup.has(key)) {
            const segment = {
                id: key,
                from: start.id,
                to: end.id,
                type,
                start: toSegmentPoint(start, levelHeight),
                end: toSegmentPoint(end, levelHeight),
                floorLevels: [start.floorLevel, end.floorLevel],
                length: type === 'horizontal'
                    ? horizontalDistance(start, end)
                    : Math.abs((start.floorLevel - end.floorLevel) * levelHeight),
                metadata: {
                    connectorType: start.type === end.type ? start.type : 'mixed'
                }
            };
            segmentLookup.set(key, segments.length);
            segments.push(segment);
        }

        indices.push(segmentLookup.get(key));
    }

    return indices;
}

function toSegmentPoint(node, levelHeight) {
    const z = (node.floorLevel ?? 0) * levelHeight;
    return {
        x: node.centroid?.x || 0,
        y: node.centroid?.y || 0,
        z
    };
}

module.exports = {
    computeRoutes
};
