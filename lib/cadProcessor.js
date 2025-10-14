const fs = require('fs');

class CADProcessor {
    constructor() {
        this.supportedFormats = ['.dxf', '.dwg'];
        this.layerMappings = {
            walls: ['WALL', 'WALLS', 'MUR', 'MURS', '0'],
            forbidden: ['FORBIDDEN', 'BLUE', 'RESTRICTED', 'INTERDIT'],
            entrances: ['ENTRANCE', 'DOOR', 'RED', 'PORTE', 'ENTREE']
        };
    }

    async processDXF(filePath, originalFilename = null) {
        try {
            const fileBuffer = fs.readFileSync(filePath);
            const filename = originalFilename || filePath.split('/').pop() || filePath.split('\\').pop();
            return await this.processCADFile(fileBuffer, filename);
        } catch (error) {
            console.error('DXF Processing Error:', error);
            throw new Error('Failed to process DXF file: ' + error.message);
        }
    }

    async processCADFile(fileBuffer, filename) {
        const extension = filename.toLowerCase().split('.').pop();

        if (!this.supportedFormats.includes('.' + extension)) {
            throw new Error(`Unsupported file format: ${extension}`);
        }

        let entities;
        if (extension === 'dxf') {
            entities = this.parseDXF(fileBuffer);
        } else if (extension === 'dwg') {
            entities = this.parseDWG(fileBuffer);
        }

        return this.processEntities(entities);
    }

    parseDXF(buffer) {
        const content = buffer.toString('utf8');
        const lines = content.split('\n').map(line => line.trim());

        const entities = [];
        let currentEntity = null;
        let currentLayer = '0';

        for (let i = 0; i < lines.length - 1; i += 2) {
            const code = parseInt(lines[i]);
            const value = lines[i + 1];

            if (isNaN(code)) continue;

            switch (code) {
                case 0:
                    if (currentEntity) {
                        entities.push(currentEntity);
                    }
                    currentEntity = {
                        type: value,
                        layer: currentLayer,
                        color: 7
                    };
                    break;
                case 8:
                    currentLayer = value;
                    if (currentEntity) currentEntity.layer = value;
                    break;
                case 62:
                    if (currentEntity) currentEntity.color = parseInt(value);
                    break;
                case 10:
                    if (currentEntity) currentEntity.x1 = parseFloat(value);
                    break;
                case 20:
                    if (currentEntity) currentEntity.y1 = parseFloat(value);
                    break;
                case 11:
                    if (currentEntity) currentEntity.x2 = parseFloat(value);
                    break;
                case 21:
                    if (currentEntity) currentEntity.y2 = parseFloat(value);
                    break;
                case 40:
                    if (currentEntity) currentEntity.radius = parseFloat(value);
                    break;
            }
        }

        if (currentEntity) {
            entities.push(currentEntity);
        }

        return entities;
    }

    parseDWG(buffer) {
        throw new Error('DWG files require conversion to DXF format first');
    }

    processEntities(entities) {
        const floorPlan = {
            walls: [],
            forbiddenZones: [],
            entrances: [],
            bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
            rooms: []
        };

        entities.forEach(entity => {
            this.updateBounds(floorPlan.bounds, entity);

            if (this.isWall(entity)) {
                floorPlan.walls.push(this.createWall(entity));
            } else if (this.isForbiddenZone(entity)) {
                floorPlan.forbiddenZones.push(this.createZone(entity));
            } else if (this.isEntrance(entity)) {
                floorPlan.entrances.push(this.createZone(entity));
            }
        });

        if (floorPlan.bounds.minX === Infinity) {
            floorPlan.bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        }

        // Use advanced room detection
        try {
            const roomDetector = require('./roomDetector');
            floorPlan.rooms = roomDetector.detectRooms(floorPlan.walls, floorPlan.entrances, floorPlan.forbiddenZones, floorPlan.bounds);
        } catch (e) {
            console.warn('Room detection failed, using fallback');
            floorPlan.rooms = this.detectRooms(floorPlan.walls, floorPlan.bounds);
        }

        return {
            walls: floorPlan.walls,
            forbiddenZones: floorPlan.forbiddenZones,
            entrances: floorPlan.entrances,
            rooms: floorPlan.rooms,
            bounds: floorPlan.bounds
        };
    }

    isWall(entity) {
        if (entity.type === 'LINE') {
            const layer = entity.layer.toLowerCase();
            if (this.layerMappings.walls.some(w => layer.includes(w.toLowerCase()))) {
                return true;
            }
            if (entity.color === 0 || entity.color === 7) {
                return true;
            }
        }
        return false;
    }

    isForbiddenZone(entity) {
        const layer = entity.layer.toLowerCase();
        if (this.layerMappings.forbidden.some(f => layer.includes(f.toLowerCase()))) {
            return true;
        }
        if (entity.color === 5) {
            return true;
        }
        return false;
    }

    isEntrance(entity) {
        const layer = entity.layer.toLowerCase();
        if (this.layerMappings.entrances.some(e => layer.includes(e.toLowerCase()))) {
            return true;
        }
        if (entity.color === 1) {
            return true;
        }
        return false;
    }

    createWall(entity) {
        return {
            type: 'line',
            start: { x: entity.x1 || 0, y: entity.y1 || 0 },
            end: { x: entity.x2 || entity.x1 || 0, y: entity.y2 || entity.y1 || 0 },
            layer: entity.layer,
            color: entity.color || 0
        };
    }

    createZone(entity) {
        let polygon;

        if (entity.type === 'CIRCLE') {
            const centerX = entity.x1 || 0;
            const centerY = entity.y1 || 0;
            const radius = entity.radius || 1;

            polygon = [];
            for (let i = 0; i < 16; i++) {
                const angle = (i / 16) * 2 * Math.PI;
                polygon.push([
                    centerX + radius * Math.cos(angle),
                    centerY + radius * Math.sin(angle)
                ]);
            }
        } else {
            const x1 = entity.x1 || 0;
            const y1 = entity.y1 || 0;
            const x2 = entity.x2 || x1 + 1;
            const y2 = entity.y2 || y1 + 1;

            polygon = [
                [Math.min(x1, x2), Math.min(y1, y2)],
                [Math.max(x1, x2), Math.min(y1, y2)],
                [Math.max(x1, x2), Math.max(y1, y2)],
                [Math.min(x1, x2), Math.max(y1, y2)]
            ];
        }

        return {
            type: 'line',
            polygon: polygon,
            layer: entity.layer,
            color: entity.color || 0
        };
    }

    updateBounds(bounds, entity) {
        const coords = [entity.x1, entity.y1, entity.x2, entity.y2].filter(coord => coord !== undefined && !isNaN(coord));

        coords.forEach(coord => {
            if (coord < bounds.minX) bounds.minX = coord;
            if (coord > bounds.maxX) bounds.maxX = coord;
            if (coord < bounds.minY) bounds.minY = coord;
            if (coord > bounds.maxY) bounds.maxY = coord;
        });
    }

    detectRooms(walls, bounds) {
        const rooms = [];
        const totalArea = Math.abs((bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY));

        rooms.push({
            id: 1,
            name: 'Main Area',
            area: Math.max(totalArea, 100),
            bounds: bounds,
            center: {
                x: (bounds.minX + bounds.maxX) / 2,
                y: (bounds.minY + bounds.maxY) / 2
            },
            type: 'office'
        });

        return rooms;
    }
}

module.exports = CADProcessor;