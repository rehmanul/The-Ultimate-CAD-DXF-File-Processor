/**
 * COSTO Compliance Checker - V1
 * Validates layout against business rules and safety constraints
 * Based on COSTO V1 specifications
 */

class CostoComplianceChecker {
    constructor(floorPlan, rules = {}) {
        this.floorPlan = floorPlan;
        this.rules = {
            mainCorridorWidth: rules.mainCorridorWidth || 1.5,
            secondaryCorridorWidth: rules.secondaryCorridorWidth || 1.2,
            minClearance: rules.minClearance || 0.3,
            maxDistanceToExit: rules.maxDistanceToExit || 30.0, // meters
            minClearanceFireDoor: rules.minClearanceFireDoor || 1.5,
            ...rules
        };
        this.violations = [];
    }

    /**
     * Run all compliance checks
     * @param {Object} solution - Solution with boxes and corridors
     * @returns {Object} - Compliance report
     */
    check(solution) {
        this.violations = [];
        const boxes = solution.boxes || [];
        const corridors = solution.corridors || [];

        // Check circulation
        this.checkCirculation(corridors);
        
        // Check access to exits
        this.checkExitAccess(boxes, corridors);
        
        // Check forbidden zones
        this.checkForbiddenZones(boxes);
        
        // Check fire door clearances
        this.checkFireDoorClearances(boxes);
        
        // Check maximum distance to exit
        this.checkMaxDistanceToExit(boxes);
        
        // Check box constraints
        this.checkBoxConstraints(boxes);

        return {
            passed: this.violations.length === 0,
            violations: this.violations,
            summary: this.generateSummary()
        };
    }

    /**
     * Check circulation rules
     */
    checkCirculation(corridors) {
        // Check minimum widths
        corridors.forEach(corridor => {
            const width = this.getCorridorWidth(corridor);
            const minWidth = corridor.type === 'main' 
                ? this.rules.mainCorridorWidth 
                : this.rules.secondaryCorridorWidth;
            
            if (width < minWidth) {
                this.violations.push({
                    type: 'circulation',
                    severity: 'error',
                    message: `Corridor ${corridor.id} width (${width.toFixed(2)}m) below minimum (${minWidth}m)`,
                    element: corridor
                });
            }
        });

        // Check continuity (no non-compliant dead ends) - only when multiple corridors
        if (corridors && corridors.length >= 3) {
            const deadEnds = this.detectDeadEndCorridors(corridors);
            deadEnds.forEach(({ corridor, connectionCount }) => {
            this.violations.push({
                type: 'circulation',
                severity: 'warning',
                message: `Corridor ${corridor.id || 'unnamed'} may be a dead end (${connectionCount} connection(s))`,
                element: corridor
            });
            });
        }
    }

    /**
     * Detect corridors that are dead ends (only one or zero connections to other corridors)
     */
    detectDeadEndCorridors(corridors) {
        if (!corridors || corridors.length < 2) return [];
        const tolerance = 0.5;
        const deadEnds = [];

        corridors.forEach(corridor => {
            const c1 = this.getCorridorBounds(corridor);
            let connectionCount = 0;

            corridors.forEach(other => {
                if (other === corridor) return;
                const c2 = this.getCorridorBounds(other);
                if (this.corridorsConnect(c1, c2, tolerance)) connectionCount++;
            });

            if (connectionCount <= 1) {
                deadEnds.push({ corridor, connectionCount });
            }
        });

        return deadEnds;
    }

    getCorridorBounds(c) {
        return {
            x: c.x ?? 0, y: c.y ?? 0,
            w: c.width ?? 1, h: c.height ?? 1
        };
    }

    corridorsConnect(b1, b2, tol) {
        const ax1 = b1.x, ay1 = b1.y, ax2 = b1.x + b1.w, ay2 = b1.y + b1.h;
        const bx1 = b2.x, by1 = b2.y, bx2 = b2.x + b2.w, by2 = b2.y + b2.h;
        return !(ax2 + tol < bx1 || bx2 + tol < ax1 || ay2 + tol < by1 || by2 + tol < ay1);
    }

    /**
     * Check access to exits
     */
    checkExitAccess(boxes, corridors) {
        const exits = this.floorPlan.exits || this.floorPlan.entrances || [];
        if (exits.length === 0) return;

        boxes.forEach(box => {
            const hasAccess = this.hasAccessToExit(box, exits, corridors);
            if (!hasAccess) {
                this.violations.push({
                    type: 'access',
                    severity: 'warning',
                    message: `Box ${box.id} may not have clear access to exit`,
                    element: box
                });
            }
        });
    }

    /**
     * Check forbidden zones
     */
    checkForbiddenZones(boxes) {
        const forbiddenZones = this.floorPlan.forbiddenZones || [];
        
        boxes.forEach(box => {
            forbiddenZones.forEach(zone => {
                if (this.boxIntersectsZone(box, zone)) {
                    this.violations.push({
                        type: 'forbidden_zone',
                        severity: 'error',
                        message: `Box ${box.id} intersects forbidden zone`,
                        element: box,
                        zone: zone
                    });
                }
            });
        });
    }

    /**
     * Check fire door clearances
     */
    checkFireDoorClearances(boxes) {
        const fireDoors = this.floorPlan.fireDoors || [];
        const clearance = this.rules.minClearanceFireDoor;

        boxes.forEach(box => {
            fireDoors.forEach(door => {
                const distance = this.distanceToDoor(box, door);
                if (distance < clearance) {
                    this.violations.push({
                        type: 'fire_door_clearance',
                        severity: 'error',
                        message: `Box ${box.id} too close to fire door (${distance.toFixed(2)}m < ${clearance}m)`,
                        element: box,
                        door: door
                    });
                }
            });
        });
    }

    /**
     * Check maximum distance to exit
     */
    checkMaxDistanceToExit(boxes) {
        const exits = this.floorPlan.exits || this.floorPlan.entrances || [];
        if (exits.length === 0 || !this.rules.maxDistanceToExit) return;

        boxes.forEach(box => {
            const minDistance = Math.min(...exits.map(exit => 
                this.distanceToExit(box, exit)
            ));

            if (minDistance > this.rules.maxDistanceToExit) {
                this.violations.push({
                    type: 'max_distance_exit',
                    severity: 'warning',
                    message: `Box ${box.id} exceeds maximum distance to exit (${minDistance.toFixed(2)}m > ${this.rules.maxDistanceToExit}m)`,
                    element: box
                });
            }
        });
    }

    /**
     * Check box constraints
     */
    checkBoxConstraints(boxes) {
        boxes.forEach(box => {
            // Check minimum dimensions
            if (box.width < 0.5 || box.height < 0.5) {
                this.violations.push({
                    type: 'box_size',
                    severity: 'error',
                    message: `Box ${box.id} has invalid dimensions`,
                    element: box
                });
            }

            // Check area
            const area = box.area || box.width * box.height;
            if (area < 0.5) {
                this.violations.push({
                    type: 'box_area',
                    severity: 'error',
                    message: `Box ${box.id} area (${area.toFixed(2)}m²) below minimum`,
                    element: box
                });
            }
        });
    }

    // Helper methods

    getCorridorWidth(corridor) {
        if (corridor.width) return corridor.width;
        if (corridor.height) return corridor.height;
        // Calculate from corners if available
        if (corridor.corners && corridor.corners.length >= 2) {
            const p1 = corridor.corners[0];
            const p2 = corridor.corners[1];
            return Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        }
        return 0;
    }

    hasAccessToExit(box, exits, corridors) {
        // Simplified: check if box center is within reasonable distance of a corridor
        // Full implementation would use pathfinding
        const boxCenter = {
            x: box.x + box.width / 2,
            y: box.y + box.height / 2
        };

        for (const corridor of corridors) {
            const distance = this.distanceToCorridor(boxCenter, corridor);
            if (distance < 5.0) { // Within 5m of a corridor
                return true;
            }
        }
        return false;
    }

    distanceToCorridor(point, corridor) {
        if (corridor.corners && corridor.corners.length >= 2) {
            let minDist = Infinity;
            for (let i = 0; i < corridor.corners.length - 1; i++) {
                const p1 = corridor.corners[i];
                const p2 = corridor.corners[i + 1];
                const dist = this.pointToSegmentDistance(
                    point,
                    { x: p1[0] || p1.x, y: p1[1] || p1.y },
                    { x: p2[0] || p2.x, y: p2[1] || p2.y }
                );
                minDist = Math.min(minDist, dist);
            }
            return minDist;
        }
        return Infinity;
    }

    boxIntersectsZone(box, zone) {
        const boxPolygon = [
            [box.x, box.y],
            [box.x + box.width, box.y],
            [box.x + box.width, box.y + box.height],
            [box.x, box.y + box.height]
        ];

        const zonePolygon = zone.polygon || [];
        if (zonePolygon.length === 0) return false;

        // Check if any box corner is inside zone
        for (const corner of boxPolygon) {
            if (this.pointInPolygon(corner, zonePolygon)) {
                return true;
            }
        }

        // Check if box center is in zone
        const center = [box.x + box.width / 2, box.y + box.height / 2];
        return this.pointInPolygon(center, zonePolygon);
    }

    distanceToDoor(box, door) {
        const boxCenter = {
            x: box.x + box.width / 2,
            y: box.y + box.height / 2
        };

        const doorPoint = door.center || {
            x: (door.start.x + door.end.x) / 2,
            y: (door.start.y + door.end.y) / 2
        };

        return Math.hypot(
            boxCenter.x - doorPoint.x,
            boxCenter.y - doorPoint.y
        );
    }

    distanceToExit(box, exit) {
        const boxCenter = {
            x: box.x + box.width / 2,
            y: box.y + box.height / 2
        };

        const exitPoint = exit.center || {
            x: (exit.start.x + exit.end.x) / 2,
            y: (exit.start.y + exit.end.y) / 2
        };

        return Math.hypot(
            boxCenter.x - exitPoint.x,
            boxCenter.y - exitPoint.y
        );
    }

    pointInPolygon(point, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i][0] || polygon[i].x;
            const yi = polygon[i][1] || polygon[i].y;
            const xj = polygon[j][0] || polygon[j].x;
            const yj = polygon[j][1] || polygon[j].y;
            
            const intersect = ((yi > point[1]) !== (yj > point[1])) &&
                (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    pointToSegmentDistance(point, segStart, segEnd) {
        const dx = segEnd.x - segStart.x;
        const dy = segEnd.y - segStart.y;
        const lenSq = dx * dx + dy * dy;
        
        if (lenSq === 0) {
            return Math.hypot(point.x - segStart.x, point.y - segStart.y);
        }
        
        const t = Math.max(0, Math.min(1, 
            ((point.x - segStart.x) * dx + (point.y - segStart.y) * dy) / lenSq
        ));
        
        const projX = segStart.x + t * dx;
        const projY = segStart.y + t * dy;
        
        return Math.hypot(point.x - projX, point.y - projY);
    }

    generateSummary() {
        const byType = {};
        this.violations.forEach(v => {
            byType[v.type] = (byType[v.type] || 0) + 1;
        });

        const errors = this.violations.filter(v => v.severity === 'error').length;
        const warnings = this.violations.filter(v => v.severity === 'warning').length;

        return {
            total: this.violations.length,
            errors,
            warnings,
            byType
        };
    }
}

module.exports = CostoComplianceChecker;
