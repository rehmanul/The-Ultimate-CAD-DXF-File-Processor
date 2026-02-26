/**
 * Production-Grade Geometry Helper Library
 * Robust geometric operations for CAD processing and spatial analysis
 */

class GeometryHelpers {
    /**
     * Calculate the area of a polygon using the Shoelace formula
     */
    static polygonArea(polygon) {
        if (!polygon || polygon.length < 3) return 0;
        
        let area = 0;
        for (let i = 0; i < polygon.length; i++) {
            const j = (i + 1) % polygon.length;
            const p1 = Array.isArray(polygon[i]) ? polygon[i] : [polygon[i].x, polygon[i].y];
            const p2 = Array.isArray(polygon[j]) ? polygon[j] : [polygon[j].x, polygon[j].y];
            area += p1[0] * p2[1];
            area -= p2[0] * p1[1];
        }
        return Math.abs(area / 2);
    }

    /**
     * Calculate polygon centroid
     */
    static polygonCentroid(polygon) {
        if (!polygon || polygon.length < 3) return null;
        
        let cx = 0, cy = 0, signedArea = 0;
        
        for (let i = 0; i < polygon.length; i++) {
            const j = (i + 1) % polygon.length;
            const p1 = Array.isArray(polygon[i]) ? polygon[i] : [polygon[i].x, polygon[i].y];
            const p2 = Array.isArray(polygon[j]) ? polygon[j] : [polygon[j].x, polygon[j].y];
            
            const cross = p1[0] * p2[1] - p2[0] * p1[1];
            signedArea += cross;
            cx += (p1[0] + p2[0]) * cross;
            cy += (p1[1] + p2[1]) * cross;
        }
        
        signedArea *= 0.5;
        if (Math.abs(signedArea) < 1e-10) return null;
        
        cx /= (6 * signedArea);
        cy /= (6 * signedArea);
        
        return { x: cx, y: cy };
    }

    /**
     * Check if a point is inside a polygon (ray casting algorithm)
     */
    static pointInPolygon(point, polygon) {
        if (!polygon || polygon.length < 3) return false;
        
        const [px, py] = Array.isArray(point) ? point : [point.x, point.y];
        let inside = false;
        
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const p1 = Array.isArray(polygon[i]) ? polygon[i] : [polygon[i].x, polygon[i].y];
            const p2 = Array.isArray(polygon[j]) ? polygon[j] : [polygon[j].x, polygon[j].y];
            
            const [xi, yi] = p1;
            const [xj, yj] = p2;
            
            const intersect = ((yi > py) !== (yj > py)) && 
                            (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        
        return inside;
    }

    /**
     * Calculate distance from point to line segment
     */
    static pointToSegmentDistance(point, segmentStart, segmentEnd) {
        const [px, py] = Array.isArray(point) ? point : [point.x, point.y];
        const [x1, y1] = Array.isArray(segmentStart) ? segmentStart : [segmentStart.x, segmentStart.y];
        const [x2, y2] = Array.isArray(segmentEnd) ? segmentEnd : [segmentEnd.x, segmentEnd.y];
        
        const dx = x2 - x1;
        const dy = y2 - y1;
        
        if (dx === 0 && dy === 0) {
            return Math.hypot(px - x1, py - y1);
        }
        
        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
        const projX = x1 + t * dx;
        const projY = y1 + t * dy;
        
        return Math.hypot(px - projX, py - projY);
    }

    /**
     * Check if two line segments intersect
     */
    static segmentsIntersect(seg1Start, seg1End, seg2Start, seg2End) {
        const p1 = Array.isArray(seg1Start) ? seg1Start : [seg1Start.x, seg1Start.y];
        const p2 = Array.isArray(seg1End) ? seg1End : [seg1End.x, seg1End.y];
        const p3 = Array.isArray(seg2Start) ? seg2Start : [seg2Start.x, seg2Start.y];
        const p4 = Array.isArray(seg2End) ? seg2End : [seg2End.x, seg2End.y];
        
        const ccw = (a, b, c) => (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0]);
        
        return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
    }

    /**
     * Calculate intersection point of two line segments
     */
    static segmentIntersectionPoint(seg1Start, seg1End, seg2Start, seg2End) {
        const p1 = Array.isArray(seg1Start) ? seg1Start : [seg1Start.x, seg1Start.y];
        const p2 = Array.isArray(seg1End) ? seg1End : [seg1End.x, seg1End.y];
        const p3 = Array.isArray(seg2Start) ? seg2Start : [seg2Start.x, seg2Start.y];
        const p4 = Array.isArray(seg2End) ? seg2End : [seg2End.x, seg2End.y];
        
        const x1 = p1[0], y1 = p1[1];
        const x2 = p2[0], y2 = p2[1];
        const x3 = p3[0], y3 = p3[1];
        const x4 = p4[0], y4 = p4[1];
        
        const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        if (Math.abs(denom) < 1e-10) return null; // Parallel or coincident
        
        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
        const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
        
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
            return {
                x: x1 + t * (x2 - x1),
                y: y1 + t * (y2 - y1)
            };
        }
        
        return null;
    }

    /**
     * Douglas-Peucker polyline simplification
     */
    static simplifyPolyline(points, tolerance = 0.1) {
        if (!points || points.length <= 2) return points;
        
        const sqTolerance = tolerance * tolerance;
        
        const simplifyDPStep = (points, first, last, sqTolerance, simplified) => {
            let maxSqDist = sqTolerance;
            let index = 0;
            
            const p1 = points[first];
            const p2 = points[last];
            
            for (let i = first + 1; i < last; i++) {
                const sqDist = this.sqDistanceToSegment(points[i], p1, p2);
                if (sqDist > maxSqDist) {
                    index = i;
                    maxSqDist = sqDist;
                }
            }
            
            if (maxSqDist > sqTolerance) {
                if (index - first > 1) simplifyDPStep(points, first, index, sqTolerance, simplified);
                simplified.push(points[index]);
                if (last - index > 1) simplifyDPStep(points, index, last, sqTolerance, simplified);
            }
        };
        
        const simplified = [points[0]];
        simplifyDPStep(points, 0, points.length - 1, sqTolerance, simplified);
        simplified.push(points[points.length - 1]);
        
        return simplified;
    }

    /**
     * Squared distance from point to segment (helper for Douglas-Peucker)
     */
    static sqDistanceToSegment(point, segStart, segEnd) {
        const p = Array.isArray(point) ? point : [point.x, point.y];
        const p1 = Array.isArray(segStart) ? segStart : [segStart.x, segStart.y];
        const p2 = Array.isArray(segEnd) ? segEnd : [segEnd.x, segEnd.y];
        
        let dx = p2[0] - p1[0];
        let dy = p2[1] - p1[1];
        
        if (dx === 0 && dy === 0) {
            dx = p[0] - p1[0];
            dy = p[1] - p1[1];
            return dx * dx + dy * dy;
        }
        
        const t = ((p[0] - p1[0]) * dx + (p[1] - p1[1]) * dy) / (dx * dx + dy * dy);
        
        if (t < 0) {
            dx = p[0] - p1[0];
            dy = p[1] - p1[1];
        } else if (t > 1) {
            dx = p[0] - p2[0];
            dy = p[1] - p2[1];
        } else {
            dx = p[0] - (p1[0] + t * dx);
            dy = p[1] - (p1[1] + t * dy);
        }
        
        return dx * dx + dy * dy;
    }

    /**
     * Calculate bounding box of a set of points
     */
    static calculateBounds(points) {
        if (!points || points.length === 0) {
            return { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 };
        }
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        for (const point of points) {
            const [x, y] = Array.isArray(point) ? point : [point.x, point.y];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        
        return {
            minX,
            minY,
            maxX,
            maxY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    /**
     * Expand bounding box by a margin
     */
    static expandBounds(bounds, margin) {
        return {
            minX: bounds.minX - margin,
            minY: bounds.minY - margin,
            maxX: bounds.maxX + margin,
            maxY: bounds.maxY + margin,
            width: (bounds.maxX - bounds.minX) + 2 * margin,
            height: (bounds.maxY - bounds.minY) + 2 * margin
        };
    }

    /**
     * Check if two rectangles overlap
     */
    static rectanglesOverlap(rect1, rect2) {
        return !(rect1.x2 <= rect2.x1 || rect1.x1 >= rect2.x2 || 
                rect1.y2 <= rect2.y1 || rect1.y1 >= rect2.y2);
    }

    /**
     * Calculate overlap area between two rectangles
     */
    static rectangleOverlapArea(rect1, rect2) {
        const xOverlap = Math.max(0, Math.min(rect1.x2, rect2.x2) - Math.max(rect1.x1, rect2.x1));
        const yOverlap = Math.max(0, Math.min(rect1.y2, rect2.y2) - Math.max(rect1.y1, rect2.y1));
        return xOverlap * yOverlap;
    }

    /**
     * Buffer/offset a polygon (simplified Minkowski sum approach)
     */
    static bufferPolygon(polygon, distance) {
        if (!polygon || polygon.length < 3) return polygon;
        
        // Simple implementation: offset each edge by distance along its normal
        const offsetPoints = [];
        
        for (let i = 0; i < polygon.length; i++) {
            const curr = Array.isArray(polygon[i]) ? polygon[i] : [polygon[i].x, polygon[i].y];
            const next = Array.isArray(polygon[(i + 1) % polygon.length]) 
                ? polygon[(i + 1) % polygon.length] 
                : [polygon[(i + 1) % polygon.length].x, polygon[(i + 1) % polygon.length].y];
            
            // Calculate perpendicular vector (normal)
            const dx = next[0] - curr[0];
            const dy = next[1] - curr[1];
            const len = Math.hypot(dx, dy);
            
            if (len > 0) {
                const nx = -dy / len * distance;
                const ny = dx / len * distance;
                offsetPoints.push([curr[0] + nx, curr[1] + ny]);
            }
        }
        
        return offsetPoints.length >= 3 ? offsetPoints : polygon;
    }

    /**
     * Check if a rectangle intersects a polygon
     */
    static rectanglePolygonIntersection(rect, polygon) {
        if (!polygon || polygon.length < 3) return false;
        
        // Convert rect to corners
        const rectCorners = [
            [rect.x1, rect.y1],
            [rect.x2, rect.y1],
            [rect.x2, rect.y2],
            [rect.x1, rect.y2]
        ];
        
        // Check if any rect corner is inside polygon
        for (const corner of rectCorners) {
            if (this.pointInPolygon(corner, polygon)) return true;
        }
        
        // Check if any polygon vertex is inside rect
        for (const vertex of polygon) {
            const [x, y] = Array.isArray(vertex) ? vertex : [vertex.x, vertex.y];
            if (x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2) {
                return true;
            }
        }
        
        // Check if any edges intersect
        const rectEdges = [
            [rectCorners[0], rectCorners[1]],
            [rectCorners[1], rectCorners[2]],
            [rectCorners[2], rectCorners[3]],
            [rectCorners[3], rectCorners[0]]
        ];
        
        for (let i = 0; i < polygon.length; i++) {
            const p1 = polygon[i];
            const p2 = polygon[(i + 1) % polygon.length];
            
            for (const [r1, r2] of rectEdges) {
                if (this.segmentsIntersect(p1, p2, r1, r2)) return true;
            }
        }
        
        return false;
    }

    /**
     * Normalize polygon to standard array format [[x,y], [x,y], ...]
     */
    static normalizePolygon(polygon) {
        if (!polygon || !Array.isArray(polygon)) return [];
        
        return polygon.map(point => {
            if (Array.isArray(point) && point.length >= 2) {
                return [Number(point[0]), Number(point[1])];
            } else if (typeof point === 'object' && point !== null && 
                       typeof point.x === 'number' && typeof point.y === 'number') {
                return [Number(point.x), Number(point.y)];
            }
            return null;
        }).filter(p => p !== null);
    }

    /**
     * Calculate minimum distance between a point and a polygon
     */
    static pointToPolygonDistance(point, polygon) {
        if (!polygon || polygon.length < 3) return Infinity;
        
        let minDist = Infinity;
        
        for (let i = 0; i < polygon.length; i++) {
            const p1 = polygon[i];
            const p2 = polygon[(i + 1) % polygon.length];
            const dist = this.pointToSegmentDistance(point, p1, p2);
            if (dist < minDist) minDist = dist;
        }
        
        return minDist;
    }

    /**
     * Rotate a point around origin
     */
    static rotatePoint(point, angle, origin = [0, 0]) {
        const [px, py] = Array.isArray(point) ? point : [point.x, point.y];
        const [ox, oy] = Array.isArray(origin) ? origin : [origin.x, origin.y];
        
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        
        const dx = px - ox;
        const dy = py - oy;
        
        return {
            x: ox + dx * cos - dy * sin,
            y: oy + dx * sin + dy * cos
        };
    }

    /**
     * Check if a polygon is clockwise oriented
     */
    static isClockwise(polygon) {
        if (!polygon || polygon.length < 3) return false;
        
        let sum = 0;
        for (let i = 0; i < polygon.length; i++) {
            const p1 = Array.isArray(polygon[i]) ? polygon[i] : [polygon[i].x, polygon[i].y];
            const p2 = Array.isArray(polygon[(i + 1) % polygon.length]) 
                ? polygon[(i + 1) % polygon.length] 
                : [polygon[(i + 1) % polygon.length].x, polygon[(i + 1) % polygon.length].y];
            sum += (p2[0] - p1[0]) * (p2[1] + p1[1]);
        }
        
        return sum > 0;
    }
}

module.exports = GeometryHelpers;
