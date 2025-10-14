/**
 * Intelligent Geometry Detector
 * Automatically detects doors, stairs, and forbidden zones from DXF geometry
 * No manual layer naming or color coding required
 */

class IntelligentDetector {
    /**
     * Detect doors/entrances by finding gaps in walls
     */
    static detectDoors(walls, bounds) {
        const doors = [];
        const wallLines = walls.filter(w => w.start && w.end);
        
        // Find wall gaps (potential doors) - typically 0.8m to 2.5m wide
        for (let i = 0; i < wallLines.length; i++) {
            for (let j = i + 1; j < wallLines.length; j++) {
                const w1 = wallLines[i];
                const w2 = wallLines[j];
                
                // Check if walls are parallel and close
                if (this._areParallel(w1, w2)) {
                    const gap = this._gapBetweenLines(w1, w2);
                    if (gap > 0.8 && gap < 2.5) {
                        // Found potential door
                        const doorRect = this._createDoorRectangle(w1, w2, gap);
                        if (doorRect) doors.push(doorRect);
                    }
                }
            }
        }
        
        console.log(`[Intelligent Detector] Found ${doors.length} doors by gap analysis`);
        return doors;
    }
    
    /**
     * Detect stairs by finding parallel line patterns
     */
    static detectStairs(entities) {
        const stairs = [];
        const lines = entities.filter(e => e.start && e.end);
        
        // Stairs have 5-20 parallel lines with regular spacing (0.25-0.35m)
        const groups = this._findParallelGroups(lines, 5, 20);
        
        for (const group of groups) {
            const spacing = this._averageSpacing(group);
            if (spacing > 0.2 && spacing < 0.4) {
                // Found stair pattern
                const bounds = this._groupBounds(group);
                const area = bounds.width * bounds.height;
                if (area > 2 && area < 50) {
                    stairs.push({
                        polygon: this._boundsToPolygon(bounds),
                        type: 'stairs',
                        confidence: 0.9
                    });
                }
            }
        }
        
        console.log(`[Intelligent Detector] Found ${stairs.length} stairs by pattern analysis`);
        return stairs;
    }
    
    /**
     * Detect elevators by finding small rectangular enclosures
     */
    static detectElevators(polygons) {
        const elevators = [];
        
        for (const poly of polygons) {
            if (!poly.polygon || poly.polygon.length < 4) continue;
            
            const bounds = this._polygonBounds(poly.polygon);
            const area = bounds.width * bounds.height;
            const aspectRatio = Math.max(bounds.width, bounds.height) / Math.min(bounds.width, bounds.height);
            
            // Elevators: 2-8 m², nearly square (aspect ratio < 2)
            if (area > 2 && area < 8 && aspectRatio < 2) {
                elevators.push({
                    polygon: poly.polygon,
                    type: 'elevator',
                    confidence: 0.85
                });
            }
        }
        
        console.log(`[Intelligent Detector] Found ${elevators.length} elevators by size analysis`);
        return elevators;
    }
    
    // Helper methods
    static _areParallel(line1, line2, tolerance = 5) {
        const angle1 = Math.atan2(line1.end.y - line1.start.y, line1.end.x - line1.start.x);
        const angle2 = Math.atan2(line2.end.y - line2.start.y, line2.end.x - line2.start.x);
        const diff = Math.abs(angle1 - angle2) * 180 / Math.PI;
        return diff < tolerance || Math.abs(diff - 180) < tolerance;
    }
    
    static _gapBetweenLines(line1, line2) {
        const d1 = this._pointToLineDistance(line1.start, line2);
        const d2 = this._pointToLineDistance(line1.end, line2);
        return Math.min(d1, d2);
    }
    
    static _pointToLineDistance(point, line) {
        const dx = line.end.x - line.start.x;
        const dy = line.end.y - line.start.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return Infinity;
        const t = Math.max(0, Math.min(1, ((point.x - line.start.x) * dx + (point.y - line.start.y) * dy) / (len * len)));
        const projX = line.start.x + t * dx;
        const projY = line.start.y + t * dy;
        return Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2);
    }
    
    static _createDoorRectangle(wall1, wall2, width) {
        const mid1 = { x: (wall1.start.x + wall1.end.x) / 2, y: (wall1.start.y + wall1.end.y) / 2 };
        const mid2 = { x: (wall2.start.x + wall2.end.x) / 2, y: (wall2.start.y + wall2.end.y) / 2 };
        
        return {
            polygon: [
                [mid1.x - width/2, mid1.y - width/2],
                [mid1.x + width/2, mid1.y - width/2],
                [mid2.x + width/2, mid2.y + width/2],
                [mid2.x - width/2, mid2.y + width/2]
            ],
            type: 'door',
            confidence: 0.8
        };
    }
    
    static _findParallelGroups(lines, minCount, maxCount) {
        const groups = [];
        const used = new Set();
        
        for (let i = 0; i < lines.length; i++) {
            if (used.has(i)) continue;
            const group = [lines[i]];
            used.add(i);
            
            for (let j = i + 1; j < lines.length; j++) {
                if (used.has(j)) continue;
                if (this._areParallel(lines[i], lines[j])) {
                    group.push(lines[j]);
                    used.add(j);
                }
            }
            
            if (group.length >= minCount && group.length <= maxCount) {
                groups.push(group);
            }
        }
        
        return groups;
    }
    
    static _averageSpacing(lines) {
        if (lines.length < 2) return 0;
        let totalSpacing = 0;
        for (let i = 0; i < lines.length - 1; i++) {
            const d = this._gapBetweenLines(lines[i], lines[i + 1]);
            totalSpacing += d;
        }
        return totalSpacing / (lines.length - 1);
    }
    
    static _groupBounds(lines) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const line of lines) {
            minX = Math.min(minX, line.start.x, line.end.x);
            maxX = Math.max(maxX, line.start.x, line.end.x);
            minY = Math.min(minY, line.start.y, line.end.y);
            maxY = Math.max(maxY, line.start.y, line.end.y);
        }
        return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
    }
    
    static _boundsToPolygon(bounds) {
        return [
            [bounds.minX, bounds.minY],
            [bounds.maxX, bounds.minY],
            [bounds.maxX, bounds.maxY],
            [bounds.minX, bounds.maxY]
        ];
    }
    
    static _polygonBounds(polygon) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const pt of polygon) {
            minX = Math.min(minX, pt[0]);
            maxX = Math.max(maxX, pt[0]);
            minY = Math.min(minY, pt[1]);
            maxY = Math.max(maxY, pt[1]);
        }
        return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
    }
}

module.exports = IntelligentDetector;
