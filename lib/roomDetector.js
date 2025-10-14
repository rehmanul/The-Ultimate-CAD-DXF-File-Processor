class RoomDetector {
    constructor() {
        this.mlProcessor = null;
        this.initializeML = this.initializeML.bind(this);
    }

    async initializeML() {
        try {
            this.mlProcessor = require('./mlProcessor');
            await this.mlProcessor.initialize();
            console.log('ML processor initialized for room detection');
        } catch (error) {
            console.warn('ML processor not available, using rule-based detection:', error.message);
        }
    }

    async detectRooms(walls, entrances, forbiddenZones, bounds) {
        if (!this.mlProcessor || !this.mlProcessor.isInitialized) {
            await this.initializeML();
        }

        if (!walls || walls.length === 0) return [];

        // Basic closed polygon detection
        let rooms = [];
        const closedPolygons = this.findClosedPolygons(walls);

        // Advanced segmentation for open/non-closed areas
        const segmentedPolygons = this.segmentOpenAreas(walls, entrances, forbiddenZones, bounds);

        // Combine and deduplicate polygons
        const allPolygons = [...closedPolygons, ...segmentedPolygons];
        const uniquePolygons = this.deduplicatePolygons(allPolygons);

        for (const [index, polygon] of uniquePolygons.entries()) {
            const area = this.calculatePolygonArea(polygon);
            const center = this.calculateCentroid(polygon);
            const roomBounds = this.getPolygonBounds(polygon);
            const type = await this.classifyRoomType(polygon, area, center, entrances, forbiddenZones);

            if (area > 0.5) { // Minimum 0.5 m² for advanced detection
                rooms.push({
                    id: `room_${index}`,
                    name: `Room ${index + 1}`,
                    area: area,
                    type: type.type || type,
                    confidence: type.confidence || 0.7,
                    features: type.features || {},
                    subtype: this.getRoomSubtype(type.type || type, area, roomBounds),
                    bounds: roomBounds,
                    center: center,
                    polygon: polygon,
                    adjacency: this.getAdjacentElements(polygon, entrances, forbiddenZones)
                });
            }
        }

        // Sort by area descending for prioritization
        rooms.sort((a, b) => b.area - a.area);

        return rooms;
    }

    findClosedPolygons(walls) {
        const polygons = [];
        // Handle both line segments and polygon objects
        const segments = [];
        for (const wall of walls) {
            if (wall.start && wall.end) {
                // Line segment
                segments.push({
                    start: { x: wall.start.x, y: wall.start.y },
                    end: { x: wall.end.x, y: wall.end.y }
                });
            } else if (wall.polygon && wall.polygon.length >= 2) {
                // Polygon - convert to line segments
                const polygon = wall.polygon;
                for (let i = 0; i < polygon.length - 1; i++) {
                    segments.push({
                        start: { x: polygon[i][0], y: polygon[i][1] },
                        end: { x: polygon[i + 1][0], y: polygon[i + 1][1] }
                    });
                }
                // Close the polygon if it's not already closed
                if (polygon.length > 2) {
                    const first = polygon[0];
                    const last = polygon[polygon.length - 1];
                    if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 0.01) {
                        segments.push({
                            start: { x: last[0], y: last[1] },
                            end: { x: first[0], y: first[1] }
                        });
                    }
                }
            }
        }

        const used = new Set();

        for (let i = 0; i < segments.length; i++) {
            if (used.has(i)) continue;

            const polygon = this.tracePolygon(segments, i, used);
            if (polygon && polygon.length >= 3) {
                // Simplify and validate polygon
                const simplified = this.simplifyPolygon(polygon);
                if (simplified && this.isValidPolygon(simplified)) {
                    polygons.push(simplified);
                }
            }
        }

        return polygons;
    }

    segmentOpenAreas(walls, entrances, forbiddenZones, bounds) {
        // Use graph-based segmentation for open areas
        const graph = this.buildWallGraph(walls);
        const voronoiRegions = this.generateVoronoiRegions(graph, bounds);

        // Filter regions that form valid rooms (avoid entrances/forbidden)
        return voronoiRegions.filter(region => {
            const area = this.calculatePolygonArea(region);
            const intersectsEntrance = entrances && entrances.length > 0 ? entrances.some(e => this.polygonsIntersect(region, e.polygon || [e.start, e.end])) : false;
            const intersectsForbidden = forbiddenZones && forbiddenZones.length > 0 ? forbiddenZones.some(z => this.polygonsIntersect(region, z.polygon)) : false;
            return area > 1 && !intersectsEntrance && !intersectsForbidden;
        });
    }

    buildWallGraph(walls) {
        // Create adjacency graph of wall endpoints
        const nodes = new Map();
        const edges = [];
        const gaps = []; // Store gap information

        walls.forEach((wall, index) => {
            if (wall.start && wall.end) {
                // Line segment
                const startKey = `${wall.start.x.toFixed(2)},${wall.start.y.toFixed(2)}`;
                const endKey = `${wall.end.x.toFixed(2)},${wall.end.y.toFixed(2)}`;

                let startNode = nodes.get(startKey);
                if (!startNode) {
                    startNode = { x: wall.start.x, y: wall.start.y, id: startKey, connectedWalls: [] };
                    nodes.set(startKey, startNode);
                }
                startNode.connectedWalls.push(index);

                let endNode = nodes.get(endKey);
                if (!endNode) {
                    endNode = { x: wall.end.x, y: wall.end.y, id: endKey, connectedWalls: [] };
                    nodes.set(endKey, endNode);
                }
                endNode.connectedWalls.push(index);

                edges.push({ from: startKey, to: endKey, wallIndex: index });
            } else if (wall.polygon && wall.polygon.length >= 2) {
                // Polygon - add all segments of the polygon
                const polygon = wall.polygon;
                for (let i = 0; i < polygon.length - 1; i++) {
                    const start = { x: polygon[i][0], y: polygon[i][1] };
                    const end = { x: polygon[i + 1][0], y: polygon[i + 1][1] };
                    const startKey = `${start.x.toFixed(2)},${start.y.toFixed(2)}`;
                    const endKey = `${end.x.toFixed(2)},${end.y.toFixed(2)}`;

                    let startNode = nodes.get(startKey);
                    if (!startNode) {
                        startNode = { x: start.x, y: start.y, id: startKey, connectedWalls: [] };
                        nodes.set(startKey, startNode);
                    }
                    startNode.connectedWalls.push(index);

                    let endNode = nodes.get(endKey);
                    if (!endNode) {
                        endNode = { x: end.x, y: end.y, id: endKey, connectedWalls: [] };
                        nodes.set(endKey, endNode);
                    }
                    endNode.connectedWalls.push(index);

                    edges.push({ from: startKey, to: endKey, wallIndex: index });
                }
                
                // Close polygon if it's not already closed
                if (polygon.length > 2) {
                    const first = { x: polygon[0][0], y: polygon[0][1] };
                    const last = { x: polygon[polygon.length - 1][0], y: polygon[polygon.length - 1][1] };
                    if (Math.hypot(first.x - last.x, first.y - last.y) > 0.01) {
                        const firstKey = `${first.x.toFixed(2)},${first.y.toFixed(2)}`;
                        const lastKey = `${last.x.toFixed(2)},${last.y.toFixed(2)}`;
                        
                        let firstNode = nodes.get(firstKey);
                        if (!firstNode) {
                            firstNode = { x: first.x, y: first.y, id: firstKey, connectedWalls: [] };
                            nodes.set(firstKey, firstNode);
                        }
                        firstNode.connectedWalls.push(index);

                        let lastNode = nodes.get(lastKey);
                        if (!lastNode) {
                            lastNode = { x: last.x, y: last.y, id: lastKey, connectedWalls: [] };
                            nodes.set(lastKey, lastNode);
                        }
                        lastNode.connectedWalls.push(index);

                        edges.push({ from: lastKey, to: firstKey, wallIndex: index });
                    }
                }
            }
        });

        // Detect gaps between wall endpoints
        const nodeList = Array.from(nodes.values());
        for (let i = 0; i < nodeList.length; i++) {
            for (let j = i + 1; j < nodeList.length; j++) {
                const node1 = nodeList[i];
                const node2 = nodeList[j];
                const dist = Math.hypot(node1.x - node2.x, node1.y - node2.y);
                if (dist > 0 && dist < 1) { // Gap threshold: 1 meter (tighter tolerance for better accuracy)
                    gaps.push({ from: node1.id, to: node2.id, distance: dist });
                }
            }
        }

        // Add implicit edges for open spaces (concave hull approximation)
        const hull = this.computeConcaveHull(Array.from(nodes.values()));
        return { nodes: Array.from(nodes.values()), edges, gaps, hull };
    }

    generateVoronoiRegions(graph, bounds) {
        // Simplified Voronoi-like partitioning using Delaunay triangulation
        const points = graph.nodes;
        const triangles = this.delaunayTriangulate(points);

        // Incorporate gaps into region generation
        const regions = this.mergeTrianglesIntoRegions(triangles, graph.edges, graph.gaps, bounds);
        return regions.map(region => this.convexHull(region));
    }

    delaunayTriangulate(points) {
        // Incremental Delaunay triangulation
        if (points.length < 3) return [];

        const triangles = [];
        const superTriangle = this.createSuperTriangle(points);
        triangles.push(superTriangle);

        for (const point of points) {
            const badTriangles = [];
            const edges = [];

            // Find triangles that contain the point
            for (const triangle of triangles) {
                if (this.pointInTriangle(point, triangle)) {
                    badTriangles.push(triangle);
                }
            }

            // Find boundary edges
            for (const triangle of badTriangles) {
                for (let i = 0; i < 3; i++) {
                    const edge = [triangle[i], triangle[(i + 1) % 3]];
                    let shared = false;
                    for (const other of badTriangles) {
                        if (other !== triangle && this.edgesEqual(edge, [other[0], other[1]]) ||
                            this.edgesEqual(edge, [other[1], other[2]]) ||
                            this.edgesEqual(edge, [other[2], other[0]])) {
                            shared = true;
                            break;
                        }
                    }
                    if (!shared) edges.push(edge);
                }
            }

            // Remove bad triangles
            for (const triangle of badTriangles) {
                const index = triangles.indexOf(triangle);
                if (index > -1) triangles.splice(index, 1);
            }

            // Add new triangles
            for (const edge of edges) {
                triangles.push([edge[0], edge[1], point]);
            }
        }

        // Remove triangles with super triangle vertices
        return triangles.filter(triangle =>
            !triangle.some(vertex => superTriangle.some(superVertex =>
                vertex[0] === superVertex[0] && vertex[1] === superVertex[1]
            ))
        );
    }

    createSuperTriangle(points) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of points) {
            minX = Math.min(minX, p[0]);
            minY = Math.min(minY, p[1]);
            maxX = Math.max(maxX, p[0]);
            maxY = Math.max(maxY, p[1]);
        }

        const dx = maxX - minX;
        const dy = maxY - minY;
        const deltaMax = Math.max(dx, dy);
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;

        return [
            [midX - 20 * deltaMax, midY - deltaMax],
            [midX, midY + 20 * deltaMax],
            [midX + 20 * deltaMax, midY - deltaMax]
        ];
    }

    pointInTriangle(point, triangle) {
        const [p1, p2, p3] = triangle;
        const area = this.calculatePolygonArea([p1, p2, p3]);
        const area1 = this.calculatePolygonArea([point, p2, p3]);
        const area2 = this.calculatePolygonArea([p1, point, p3]);
        const area3 = this.calculatePolygonArea([p1, p2, point]);
        return Math.abs(area - (area1 + area2 + area3)) < 1e-6;
    }

    edgesEqual(edge1, edge2) {
        return (edge1[0][0] === edge2[0][0] && edge1[0][1] === edge2[0][1] &&
            edge1[1][0] === edge2[1][0] && edge1[1][1] === edge2[1][1]) ||
            (edge1[0][0] === edge2[1][0] && edge1[0][1] === edge2[1][1] &&
                edge1[1][0] === edge2[0][0] && edge1[1][1] === edge2[0][1]);
    }

    mergeTrianglesIntoRegions(triangles, wallEdges, gaps, bounds) {
        // Union-find to merge triangles into regions based on shared edges not in walls or gaps
        const parent = new Map();
        const find = (x) => parent.get(x) === x ? x : parent.set(x, find(parent.get(x)));
        const union = (x, y) => parent.set(find(x), find(y));

        // Initialize each triangle as its own region
        triangles.forEach((triangle, i) => parent.set(i, i));

        // Merge triangles that share edges not present in wall edges or gaps
        for (let i = 0; i < triangles.length; i++) {
            for (let j = i + 1; j < triangles.length; j++) {
                if (this.trianglesShareNonWallEdge(triangles[i], triangles[j], wallEdges) ||
                    this.trianglesShareGapEdge(triangles[i], triangles[j], gaps)) {
                    union(i, j);
                }
            }
        }

        // Group triangles by their root parent
        const regions = new Map();
        triangles.forEach((triangle, i) => {
            const root = find(i);
            if (!regions.has(root)) regions.set(root, []);
            regions.get(root).push(triangle);
        });

        // Convert groups to polygon regions
        return Array.from(regions.values()).map(group => {
            // Merge triangle polygons into a single polygon
            return this.mergeTrianglePolygons(group);
        });
    }


    trianglesShareNonWallEdge(triangle1, triangle2, wallEdges) {
        const edges1 = this.getTriangleEdges(triangle1);
        const edges2 = this.getTriangleEdges(triangle2);

        for (const edge1 of edges1) {
            for (const edge2 of edges2) {
                if (this.edgesEqual(edge1, edge2)) {
                    // Check if this edge is in wall edges
                    const isWallEdge = wallEdges.some(wallEdge =>
                        this.edgesEqual(edge1, [wallEdge.from, wallEdge.to])
                    );
                    if (!isWallEdge) return true;
                }
            }
        }
        return false;
    }

    trianglesShareGapEdge(triangle1, triangle2, gaps) {
        const edges1 = this.getTriangleEdges(triangle1);
        const edges2 = this.getTriangleEdges(triangle2);

        for (const edge1 of edges1) {
            for (const edge2 of edges2) {
                if (this.edgesEqual(edge1, edge2)) {
                    // Check if this edge is in gaps
                    const isGapEdge = gaps.some(gap => {
                        const node1 = { x: parseFloat(gap.from.split(',')[0]), y: parseFloat(gap.from.split(',')[1]) };
                        const node2 = { x: parseFloat(gap.to.split(',')[0]), y: parseFloat(gap.to.split(',')[1]) };
                        // Check if the edge matches the gap (within tolerance)
                        const tolerance = 0.01;
                        const match1 = Math.abs(edge1[0].x - node1.x) < tolerance && 
                                      Math.abs(edge1[0].y - node1.y) < tolerance &&
                                      Math.abs(edge1[1].x - node2.x) < tolerance && 
                                      Math.abs(edge1[1].y - node2.y) < tolerance;
                        const match2 = Math.abs(edge1[0].x - node2.x) < tolerance && 
                                      Math.abs(edge1[0].y - node2.y) < tolerance &&
                                      Math.abs(edge1[1].x - node1.x) < tolerance && 
                                      Math.abs(edge1[1].y - node1.y) < tolerance;
                        return match1 || match2;
                    });
                    if (isGapEdge) return true;
                }
            }
        }
        return false;
    }

    getTriangleEdges(triangle) {
        const edges = [];
        for (let i = 0; i < 3; i++) {
            edges.push([triangle[i], triangle[(i + 1) % 3]]);
        }
        return edges;
    }

    mergeTrianglePolygons(triangles) {
        // Simple merge: combine all points and compute convex hull
        const allPoints = [];
        triangles.forEach(triangle => allPoints.push(...triangle));
        return this.convexHull(allPoints);
    }

    computeConvexHull(points) {
        // Graham scan or Jarvis march
        if (points.length < 3) return points;

        // Find lowest y-point
        let minIdx = 0;
        for (let i = 1; i < points.length; i++) {
            if (points[i].y < points[minIdx].y || (points[i].y === points[minIdx].y && points[i].x < points[minIdx].x)) {
                minIdx = i;
            }
        }

        // Sort by polar angle
        const sorted = points.map((p, i) => ({ p, i })).sort((a, b) => {
            const cross = (a.p.x - points[minIdx].x) * (b.p.y - points[minIdx].y) - (a.p.y - points[minIdx].y) * (b.p.x - points[minIdx].x);
            return cross === 0 ? 0 : cross > 0 ? -1 : 1;
        }).map(item => item.p);

        // Build hull
        const hull = [];
        for (let p of sorted) {
            while (hull.length >= 2 && this.crossProduct(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) {
                hull.pop();
            }
            hull.push(p);
        }

        return hull.map(p => [p.x, p.y]);
    }

    computeConcaveHull(points, threshold = 0.1) {
        // Alpha shapes for concave hull
        if (points.length < 3) return points;

        const alpha = 1 / threshold; // Alpha parameter
        const triangles = this.delaunayTriangulate(points);

        // Filter triangles based on circumradius
        const validTriangles = triangles.filter(triangle => {
            const circumradius = this.getCircumradius(triangle);
            return circumradius <= alpha;
        });

        // Extract boundary edges
        const edgeCount = new Map();
        validTriangles.forEach(triangle => {
            const edges = this.getTriangleEdges(triangle);
            edges.forEach(edge => {
                const key = this.edgeKey(edge);
                edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
            });
        });

        // Boundary edges appear only once
        const boundaryEdges = [];
        edgeCount.forEach((count, key) => {
            if (count === 1) boundaryEdges.push(this.parseEdgeKey(key));
        });

        // Reconstruct polygon from boundary edges
        return this.reconstructPolygon(boundaryEdges);
    }

    getCircumradius(triangle) {
        const [p1, p2, p3] = triangle;
        const a = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        const b = Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
        const c = Math.hypot(p1[0] - p3[0], p1[1] - p3[1]);
        const s = (a + b + c) / 2;
        const area = Math.sqrt(s * (s - a) * (s - b) * (s - c));
        return a * b * c / (4 * area);
    }

    edgeKey(edge) {
        const [p1, p2] = edge;
        return `${Math.min(p1[0], p2[0])},${Math.min(p1[1], p2[1])}-${Math.max(p1[0], p2[0])},${Math.max(p1[1], p2[1])}`;
    }

    parseEdgeKey(key) {
        const [p1Str, p2Str] = key.split('-');
        const p1 = p1Str.split(',').map(Number);
        const p2 = p2Str.split(',').map(Number);
        return [p1, p2];
    }

    reconstructPolygon(edges) {
        if (edges.length === 0) return [];

        const polygon = [edges[0][0], edges[0][1]];
        edges.splice(0, 1);

        while (edges.length > 0) {
            const lastPoint = polygon[polygon.length - 1];
            let found = false;
            for (let i = 0; i < edges.length; i++) {
                const edge = edges[i];
                if (this.pointsEqual(lastPoint, edge[0])) {
                    polygon.push(edge[1]);
                    edges.splice(i, 1);
                    found = true;
                    break;
                } else if (this.pointsEqual(lastPoint, edge[1])) {
                    polygon.push(edge[0]);
                    edges.splice(i, 1);
                    found = true;
                    break;
                }
            }
            if (!found) break; // Cannot continue
        }

        return polygon;
    }

    pointsEqual(p1, p2, epsilon = 1e-6) {
        return Math.abs(p1[0] - p2[0]) < epsilon && Math.abs(p1[1] - p2[1]) < epsilon;
    }

    crossProduct(o, a, b) {
        return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    }

    simplifyPolygon(polygon, epsilon = 0.1) {
        if (polygon.length <= 3) return polygon; // Don't simplify small polygons
        const result = this.douglasPeucker(polygon, epsilon);
        // Ensure we have at least 3 points for a valid polygon
        if (result.length < 3) return polygon;
        return result;
    }

    douglasPeucker(points, epsilon) {
        if (points.length <= 2) return points;

        let maxDist = 0;
        let index = 0;
        const end = points.length - 1;

        for (let i = 1; i < end; i++) {
            const dist = this.perpendicularDistance(points[i], points[0], points[end]);
            if (dist > maxDist) {
                index = i;
                maxDist = dist;
            }
        }

        if (maxDist > epsilon) {
            const left = this.douglasPeucker(points.slice(0, index + 1), epsilon);
            const right = this.douglasPeucker(points.slice(index), epsilon);
            return left.slice(0, -1).concat(right);
        } else {
            return [points[0], points[end]];
        }
    }

    perpendicularDistance(point, lineStart, lineEnd) {
        const dx = lineEnd[0] - lineStart[0];
        const dy = lineEnd[1] - lineStart[1];
        const mag = Math.sqrt(dx * dx + dy * dy);
        if (mag > 0) {
            const dx1 = point[0] - lineStart[0];
            const dy1 = point[1] - lineStart[1];
            const cross = dx1 * dy - dy1 * dx;
            return Math.abs(cross) / mag;
        }
        return 0;
    }

    isValidPolygon(polygon) {
        // Check no self-intersections, clockwise/counter-clockwise
        const area = this.calculatePolygonArea(polygon);
        return area > 0 && !this.hasSelfIntersections(polygon) && polygon.length >= 3;
    }

    hasSelfIntersections(polygon) {
        // Check for line segment intersections
        for (let i = 0; i < polygon.length; i++) {
            for (let j = i + 2; j < polygon.length; j++) {
                if (this.segmentsIntersect(polygon[i], polygon[(i + 1) % polygon.length], polygon[j], polygon[(j + 1) % polygon.length])) {
                    return true;
                }
            }
        }
        return false;
    }

    segmentsIntersect(p1, p2, p3, p4) {
        // Standard line segment intersection check
        const denom = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
        if (Math.abs(denom) < 1e-10) return false; // parallel or collinear

        const t = ((p1[0] - p3[0]) * (p3[1] - p4[1]) - (p1[1] - p3[1]) * (p3[0] - p4[0])) / denom;
        const u = -((p1[0] - p2[0]) * (p1[1] - p3[1]) - (p1[1] - p2[1]) * (p1[0] - p3[0])) / denom;

        return t > 0 && t < 1 && u > 0 && u < 1; // strict inequality to avoid endpoint intersections
    }

    polygonsIntersect(poly1, poly2) {
        // Check if any edges intersect or one is inside the other
        for (let i = 0; i < poly1.length; i++) {
            for (let j = 0; j < poly2.length; j++) {
                if (this.segmentsIntersect(poly1[i], poly1[(i + 1) % poly1.length], poly2[j], poly2[(j + 1) % poly2.length])) {
                    return true;
                }
            }
        }
        // Point-in-polygon check for containment
        return poly2.some(pt => this.pointInPolygon(pt, poly1));
    }

    pointInPolygon(point, polygon) {
        // Ray casting algorithm
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            if ((polygon[i][1] > point[1]) !== (polygon[j][1] > point[1]) &&
                (point[0] < (polygon[j][0] - polygon[i][0]) * (point[1] - polygon[i][1]) / (polygon[j][1] - polygon[i][1]) + polygon[i][0])) {
                inside = !inside;
            }
        }
        return inside;
    }

    deduplicatePolygons(polygons) {
        // Remove overlapping/duplicate polygons using Jaccard similarity > 0.8
        const unique = [];
        for (let poly of polygons) {
            const isDuplicate = unique.some(existing => {
                const intersection = this.polygonIntersection(poly, existing);
                const union = this.polygonUnion(poly, existing);
                return intersection / union > 0.8;
            });
            if (!isDuplicate) unique.push(poly);
        }
        return unique;
    }

    polygonIntersection(poly1, poly2) {
        // Sutherland-Hodgman clipping algorithm
        if (!poly1 || !poly2 || poly1.length < 3 || poly2.length < 3) return 0;

        let output = poly1.slice();
        const subject = poly2;

        for (let i = 0; i < subject.length; i++) {
            const clipEdge = [subject[i], subject[(i + 1) % subject.length]];
            const input = output.slice();
            output = [];

            for (let j = 0; j < input.length; j++) {
                const current = input[j];
                const prev = input[(j - 1 + input.length) % input.length];

                if (this.isInside(current, clipEdge)) {
                    if (!this.isInside(prev, clipEdge)) {
                        output.push(this.computeIntersection(prev, current, clipEdge));
                    }
                    output.push(current);
                } else if (this.isInside(prev, clipEdge)) {
                    output.push(this.computeIntersection(prev, current, clipEdge));
                }
            }
        }

        return this.calculatePolygonArea(output);
    }

    isInside(point, edge) {
        const [p1, p2] = edge;
        return (p2[0] - p1[0]) * (point[1] - p1[1]) > (p2[1] - p1[1]) * (point[0] - p1[0]);
    }

    computeIntersection(p1, p2, edge) {
        const [e1, e2] = edge;
        const dx1 = p2[0] - p1[0];
        const dy1 = p2[1] - p1[1];
        const dx2 = e2[0] - e1[0];
        const dy2 = e2[1] - e1[1];

        const denom = dx1 * dy2 - dy1 * dx2;
        if (Math.abs(denom) < 1e-10) return p1; // parallel lines

        const t = ((e1[0] - p1[0]) * dy2 - (e1[1] - p1[1]) * dx2) / denom;
        return [
            p1[0] + t * dx1,
            p1[1] + t * dy1
        ];
    }

    polygonUnion(poly1, poly2) {
        // Union area
        return this.calculatePolygonArea(poly1) + this.calculatePolygonArea(poly2); // Simplified
    }

    async classifyRoomType(polygon, area, center, entrances, forbiddenZones) {
        // Try ML classification first
        if (this.mlProcessor && this.mlProcessor.isInitialized) {
            try {
                const roomData = {
                    area: area,
                    bounds: this.getPolygonBounds(polygon),
                    center: center,
                    adjacency: this.getAdjacentElements(polygon, entrances, forbiddenZones)
                };

                const mlResult = await this.mlProcessor.classifyRoom(roomData);
                if (mlResult && mlResult.confidence > 0.5) { // Use ML result if confidence is high
                    return {
                        type: mlResult.type,
                        confidence: mlResult.confidence,
                        features: mlResult.features
                    };
                }
            } catch (error) {
                console.warn('ML room classification failed, falling back to rules:', error.message);
            }
        }

        // Fallback to rule-based classification
        const ruleBasedType = this.ruleBasedRoomClassification(area, center, entrances, forbiddenZones);
        return {
            type: ruleBasedType,
            confidence: 0.7, // Lower confidence for rule-based
            features: {}
        };
    }

    ruleBasedRoomClassification(area, center, entrances, forbiddenZones) {
        if (area < 5) return 'utility'; // Closet, bathroom
        if (area < 20) return 'office'; // Single/double desk
        if (area < 50) return 'meeting'; // Conference
        if (this.isNearEntrances(center, entrances, 5)) return 'entry';
        if (this.isNearForbidden(center, forbiddenZones, 10)) return 'circulation';
        return 'hall'; // Large open space
    }

    getRoomSubtype(type, area, bounds) {
        const aspect = (bounds.maxX - bounds.minX) / (bounds.maxY - bounds.minY);
        if (aspect > 2 || aspect < 0.5) return 'elongated';
        if (this.isRectangular(bounds)) return 'rectangular';
        return 'irregular';
    }

    isNearEntrances(center, entrances, threshold) {
        return entrances.some(e => {
            const dist = Math.sqrt(Math.pow(center.x - e.center?.x || e.start.x, 2) + Math.pow(center.y - e.center?.y || e.start.y, 2));
            return dist < threshold;
        });
    }

    isNearForbidden(center, forbiddenZones, threshold) {
        return forbiddenZones.some(z => {
            const dist = Math.sqrt(Math.pow(center.x - z.center.x, 2) + Math.pow(center.y - z.center.y, 2));
            return dist < threshold;
        });
    }

    isRectangular(bounds) {
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;
        const diagonal = Math.sqrt(width * width + height * height);
        const sides = 2 * (width + height);
        return Math.abs(sides - 4 * diagonal / Math.sqrt(2)) < 1; // Approx rectangle
    }

    getAdjacentElements(polygon, entrances, forbiddenZones) {
        const adj = { entrances: [], forbidden: [] };
        if (entrances && entrances.length > 0) {
            entrances.forEach((e, idx) => {
                if (this.polygonsIntersect(polygon, e.polygon || [e.start, e.end])) {
                    adj.entrances.push(idx);
                }
            });
        }
        if (forbiddenZones && forbiddenZones.length > 0) {
            forbiddenZones.forEach((z, idx) => {
                if (this.polygonsIntersect(polygon, z.polygon)) {
                    adj.forbidden.push(idx);
                }
            });
        }
        return adj;
    }

    convexHull(points) {
        // Andrew's monotone chain
        if (points.length < 3) return points;

        points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

        const lower = [];
        for (let pt of points) {
            while (lower.length >= 2 && this.cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) {
                lower.pop();
            }
            lower.push(pt);
        }

        const upper = [];
        for (let i = points.length - 1; i >= 0; i--) {
            const pt = points[i];
            while (upper.length >= 2 && this.cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) {
                upper.pop();
            }
            upper.push(pt);
        }

        upper.pop();
        lower.pop();
        return [...lower, ...upper];
    }

    cross(o, a, b) {
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    }

    tracePolygon(segments, startIndex, used, maxSteps = 200) {
        const polygon = [];
        const tolerance = 0.05; // Tighter tolerance for advanced

        let currentIndex = startIndex;
        let currentPoint = { ...segments[startIndex].start };
        polygon.push([currentPoint.x, currentPoint.y]);

        used.add(currentIndex);
        currentPoint = { ...segments[currentIndex].end };

        let steps = 0;
        while (steps < maxSteps) {
            polygon.push([currentPoint.x, currentPoint.y]);

            // Check closure with tolerance
            const firstPoint = polygon[0];
            const dist = Math.hypot(currentPoint.x - firstPoint[0], currentPoint.y - firstPoint[1]);

            if (dist < tolerance && polygon.length >= 3) {
                // Ensure no duplicates
                return polygon.filter((pt, i) => i === 0 || Math.hypot(pt[0] - polygon[i - 1][0], pt[1] - polygon[i - 1][1]) > tolerance);
            }

            // Find best next segment (closest start or end)
            let nextIndex = -1;
            let minDist = Infinity;
            let chosenDStart, chosenDEnd;

            for (let i = 0; i < segments.length; i++) {
                if (used.has(i)) continue;

                // Distance to start
                let dStart = Math.hypot(segments[i].start.x - currentPoint.x, segments[i].start.y - currentPoint.y);
                // Distance to end (for bidirectional tracing)
                let dEnd = Math.hypot(segments[i].end.x - currentPoint.x, segments[i].end.y - currentPoint.y);

                const d = Math.min(dStart, dEnd);
                if (d < minDist && d < tolerance * 2) {
                    minDist = d;
                    nextIndex = i;
                    chosenDStart = dStart;
                    chosenDEnd = dEnd;
                }
            }

            if (nextIndex === -1) break;

            used.add(nextIndex);
            // Choose the closer endpoint as next current
            const seg = segments[nextIndex];
            if (chosenDStart <= chosenDEnd) {
                currentPoint = { ...seg.end };
            } else {
                currentPoint = { ...seg.start };
            }
            steps++;
        }

        return null;
    }

    calculatePolygonArea(polygon) {
        if (!polygon || polygon.length < 3) return 0;

        let area = 0;
        for (let i = 0; i < polygon.length; i++) {
            const j = (i + 1) % polygon.length;
            area += polygon[i][0] * polygon[j][1];
            area -= polygon[j][0] * polygon[i][1];
        }

        return Math.abs(area / 2);
    }

    calculateCentroid(polygon) {
        if (!polygon || polygon.length === 0) return { x: 0, y: 0 };

        // Weighted centroid using area
        let sumX = 0, sumY = 0, totalArea = 0;
        for (let i = 0; i < polygon.length; i++) {
            const j = (i + 1) % polygon.length;
            const factor = (polygon[i][0] * polygon[j][1] - polygon[j][0] * polygon[i][1]);
            sumX += (polygon[i][0] + polygon[j][0]) * factor;
            sumY += (polygon[i][1] + polygon[j][1]) * factor;
            totalArea += factor;
        }

        return {
            x: sumX / (6 * totalArea),
            y: sumY / (6 * totalArea)
        };
    }

    getPolygonBounds(polygon) {
        if (!polygon || polygon.length === 0) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        polygon.forEach(pt => {
            minX = Math.min(minX, pt[0]);
            minY = Math.min(minY, pt[1]);
            maxX = Math.max(maxX, pt[0]);
            maxY = Math.max(maxY, pt[1]);
        });

        return { minX, minY, maxX, maxY };
    }
}

module.exports = new RoomDetector();
