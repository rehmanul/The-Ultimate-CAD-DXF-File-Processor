class GeometryObject {
    constructor(id, properties = {}) {
        this.id = id || `obj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.properties = properties;
    }
}

class Envelope extends GeometryObject {
    constructor(id, polygon, bounds) {
        super(id);
        this.polygon = polygon;
        this.bounds = bounds || this._computeBounds(polygon);
        this.area = this._computeArea(polygon);
    }

    _computeBounds(polygon) {
        if (!polygon || polygon.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const pt of polygon) {
            const x = Array.isArray(pt) ? pt[0] : pt.x;
            const y = Array.isArray(pt) ? pt[1] : pt.y;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
        return { minX, minY, maxX, maxY };
    }

    _computeArea(polygon) {
        if (!polygon || polygon.length < 3) return 0;
        let area = 0;
        for (let i = 0; i < polygon.length; i++) {
            const j = (i + 1) % polygon.length;
            const xi = Array.isArray(polygon[i]) ? polygon[i][0] : polygon[i].x;
            const yi = Array.isArray(polygon[i]) ? polygon[i][1] : polygon[i].y;
            const xj = Array.isArray(polygon[j]) ? polygon[j][0] : polygon[j].x;
            const yj = Array.isArray(polygon[j]) ? polygon[j][1] : polygon[j].y;
            area += xi * yj;
            area -= xj * yi;
        }
        return Math.abs(area / 2);
    }
}

class Obstacle extends GeometryObject {
    constructor(id, polygon, type = 'generic') {
        super(id);
        this.polygon = polygon;
        this.type = type;
        this.bounds = this._computeBounds(polygon);
    }

    _computeBounds(polygon) {
        // Reuse logic from Envelope or utility
        // ... (simplified for brevity, assume similar implementation)
        return {};
    }
}

class ProhibitedZone extends GeometryObject {
    constructor(id, polygon, reason) {
        super(id);
        this.polygon = polygon;
        this.reason = reason;
    }
}

class Exit extends GeometryObject {
    constructor(id, polygon, width) {
        super(id);
        this.polygon = polygon;
        this.width = width;
    }
}

class Corridor extends GeometryObject {
    constructor(id, polygon, width) {
        super(id);
        this.polygon = polygon;
        this.width = width;
        this.length = 0; // To be computed
    }
}

class Box extends GeometryObject {
    constructor(id, x, y, width, height, type) {
        super(id);
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.type = type;
        this.area = width * height;
    }

    get bounds() {
        return {
            minX: this.x,
            maxX: this.x + this.width,
            minY: this.y,
            maxY: this.y + this.height
        };
    }
}

module.exports = {
    Envelope,
    Obstacle,
    ProhibitedZone,
    Exit,
    Corridor,
    Box
};
