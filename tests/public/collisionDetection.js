// Collision Detection and Validation (Babylon.js / pure-JS version)
// Replaced THREE.Box2/Vector2 with simple AABB math

export class CollisionDetection {
    constructor(floorPlan) {
        this.floorPlan = floorPlan;
        this.walls = floorPlan.walls || [];
        this.forbiddenZones = floorPlan.forbiddenZones || [];
        this.entrances = floorPlan.entrances || [];
    }

    // --- Simple AABB helpers (replacing THREE.Box2 / Vector2) ---
    _makeBox(x, y, w, h) { return { minX: x, minY: y, maxX: x + w, maxY: y + h }; }
    _boxContainsPoint(box, px, py) { return px >= box.minX && px <= box.maxX && py >= box.minY && py <= box.maxY; }
    _boxesIntersect(a, b) { return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY; }

    isIlotValid(ilot, otherIlots = []) {
        if (!this.isWithinBounds(ilot)) return { valid: false, reason: 'Outside floor bounds' };
        if (this.checkWallCollision(ilot)) return { valid: false, reason: 'Collides with walls' };
        if (this.checkForbiddenZoneCollision(ilot)) return { valid: false, reason: 'In forbidden zone' };
        if (this.checkIlotCollision(ilot, otherIlots)) return { valid: false, reason: 'Overlaps another ilot' };
        if (this.checkEntranceDistance(ilot) < 0.5) return { valid: false, reason: 'Too close to entrance' };
        return { valid: true };
    }

    isWithinBounds(ilot) {
        const b = this.floorPlan.bounds;
        return ilot.x >= b.minX && ilot.x + ilot.width <= b.maxX && ilot.y >= b.minY && ilot.y + ilot.height <= b.maxY;
    }

    checkWallCollision(ilot) {
        const box = this._makeBox(ilot.x, ilot.y, ilot.width, ilot.height);
        for (const wall of this.walls) {
            if (wall.polygon && this.polygonIntersectsBox(wall.polygon, box)) return true;
        }
        return false;
    }

    checkForbiddenZoneCollision(ilot) {
        const box = this._makeBox(ilot.x, ilot.y, ilot.width, ilot.height);
        for (const zone of this.forbiddenZones) {
            if (zone.polygon && this.polygonIntersectsBox(zone.polygon, box)) return true;
        }
        return false;
    }

    checkIlotCollision(ilot, otherIlots) {
        const box = this._makeBox(ilot.x, ilot.y, ilot.width, ilot.height);
        for (const other of otherIlots) {
            if (other === ilot) continue;
            const otherBox = this._makeBox(other.x, other.y, other.width, other.height);
            if (this._boxesIntersect(box, otherBox)) return true;
        }
        return false;
    }

    checkEntranceDistance(ilot) {
        let minDist = Infinity;
        const cx = ilot.x + ilot.width / 2, cy = ilot.y + ilot.height / 2;
        for (const entrance of this.entrances) {
            if (entrance.polygon) {
                const ec = this.getPolygonCenter(entrance.polygon);
                minDist = Math.min(minDist, Math.hypot(cx - ec.x, cy - ec.y));
            }
        }
        return minDist;
    }

    polygonIntersectsBox(polygon, box) {
        for (const pt of polygon) {
            const px = Array.isArray(pt) ? pt[0] : pt.x;
            const py = Array.isArray(pt) ? pt[1] : pt.y;
            if (this._boxContainsPoint(box, px, py)) return true;
        }
        return false;
    }

    getPolygonCenter(polygon) {
        let sx = 0, sy = 0;
        for (const pt of polygon) { sx += Array.isArray(pt) ? pt[0] : pt.x; sy += Array.isArray(pt) ? pt[1] : pt.y; }
        return { x: sx / polygon.length, y: sy / polygon.length };
    }

    snapToGrid(value, gridSize = 0.5) { return Math.round(value / gridSize) * gridSize; }

    snapIlotToGrid(ilot, gridSize = 0.5) {
        return { ...ilot, x: this.snapToGrid(ilot.x, gridSize), y: this.snapToGrid(ilot.y, gridSize), width: this.snapToGrid(ilot.width, gridSize), height: this.snapToGrid(ilot.height, gridSize) };
    }
}
