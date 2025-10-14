// Collision Detection and Validation
import * as THREE from 'three';

export class CollisionDetection {
    constructor(floorPlan) {
        this.floorPlan = floorPlan;
        this.walls = floorPlan.walls || [];
        this.forbiddenZones = floorPlan.forbiddenZones || [];
        this.entrances = floorPlan.entrances || [];
    }
    
    isIlotValid(ilot, otherIlots = []) {
        if (!this.isWithinBounds(ilot)) return { valid: false, reason: 'Outside floor bounds' };
        
        const wallCollision = this.checkWallCollision(ilot);
        if (wallCollision) return { valid: false, reason: 'Collides with walls' };
        
        const forbiddenCollision = this.checkForbiddenZoneCollision(ilot);
        if (forbiddenCollision) return { valid: false, reason: 'In forbidden zone' };
        
        const ilotCollision = this.checkIlotCollision(ilot, otherIlots);
        if (ilotCollision) return { valid: false, reason: 'Overlaps another ilot' };
        
        const entranceDistance = this.checkEntranceDistance(ilot);
        if (entranceDistance < 0.5) return { valid: false, reason: 'Too close to entrance' };
        
        return { valid: true };
    }
    
    isWithinBounds(ilot) {
        const bounds = this.floorPlan.bounds;
        return ilot.x >= bounds.minX && 
               ilot.x + ilot.width <= bounds.maxX &&
               ilot.y >= bounds.minY && 
               ilot.y + ilot.height <= bounds.maxY;
    }
    
    checkWallCollision(ilot) {
        const ilotBox = new THREE.Box2(
            new THREE.Vector2(ilot.x, ilot.y),
            new THREE.Vector2(ilot.x + ilot.width, ilot.y + ilot.height)
        );
        
        for (const wall of this.walls) {
            if (wall.polygon) {
                if (this.polygonIntersectsBox(wall.polygon, ilotBox)) return true;
            }
        }
        return false;
    }
    
    checkForbiddenZoneCollision(ilot) {
        const ilotBox = new THREE.Box2(
            new THREE.Vector2(ilot.x, ilot.y),
            new THREE.Vector2(ilot.x + ilot.width, ilot.y + ilot.height)
        );
        
        for (const zone of this.forbiddenZones) {
            if (zone.polygon && this.polygonIntersectsBox(zone.polygon, ilotBox)) return true;
        }
        return false;
    }
    
    checkIlotCollision(ilot, otherIlots) {
        const ilotBox = new THREE.Box2(
            new THREE.Vector2(ilot.x, ilot.y),
            new THREE.Vector2(ilot.x + ilot.width, ilot.y + ilot.height)
        );
        
        for (const other of otherIlots) {
            if (other === ilot) continue;
            const otherBox = new THREE.Box2(
                new THREE.Vector2(other.x, other.y),
                new THREE.Vector2(other.x + other.width, other.y + other.height)
            );
            if (ilotBox.intersectsBox(otherBox)) return true;
        }
        return false;
    }
    
    checkEntranceDistance(ilot) {
        let minDist = Infinity;
        const ilotCenter = { x: ilot.x + ilot.width / 2, y: ilot.y + ilot.height / 2 };
        
        for (const entrance of this.entrances) {
            if (entrance.polygon) {
                const entranceCenter = this.getPolygonCenter(entrance.polygon);
                const dist = Math.hypot(ilotCenter.x - entranceCenter.x, ilotCenter.y - entranceCenter.y);
                minDist = Math.min(minDist, dist);
            }
        }
        return minDist;
    }
    
    polygonIntersectsBox(polygon, box) {
        for (const pt of polygon) {
            const point = new THREE.Vector2(Array.isArray(pt) ? pt[0] : pt.x, Array.isArray(pt) ? pt[1] : pt.y);
            if (box.containsPoint(point)) return true;
        }
        return false;
    }
    
    getPolygonCenter(polygon) {
        let sumX = 0, sumY = 0;
        for (const pt of polygon) {
            sumX += Array.isArray(pt) ? pt[0] : pt.x;
            sumY += Array.isArray(pt) ? pt[1] : pt.y;
        }
        return { x: sumX / polygon.length, y: sumY / polygon.length };
    }
    
    snapToGrid(value, gridSize = 0.5) {
        return Math.round(value / gridSize) * gridSize;
    }
    
    snapIlotToGrid(ilot, gridSize = 0.5) {
        return {
            ...ilot,
            x: this.snapToGrid(ilot.x, gridSize),
            y: this.snapToGrid(ilot.y, gridSize),
            width: this.snapToGrid(ilot.width, gridSize),
            height: this.snapToGrid(ilot.height, gridSize)
        };
    }
}
