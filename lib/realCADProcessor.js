const fs = require('fs');

class RealCADProcessor {
    constructor() {
        this.walls = [];
        this.forbiddenZones = [];
        this.entrances = [];
        this.bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    }

    async processDXF(filePath, originalFilename) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n').map(line => line.trim());
            
            this.walls = [];
            this.forbiddenZones = [];
            this.entrances = [];
            this.bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
            
            let currentEntity = null;
            let inEntitiesSection = false;
            
            for (let i = 0; i < lines.length - 1; i += 2) {
                const code = parseInt(lines[i]);
                const value = lines[i + 1];
                
                if (isNaN(code)) continue;
                
                // Check for ENTITIES section
                if (code === 0 && value === 'SECTION') {
                    if (lines[i + 3] === 'ENTITIES') {
                        inEntitiesSection = true;
                        i += 2;
                        continue;
                    }
                }
                
                if (code === 0 && value === 'ENDSEC') {
                    inEntitiesSection = false;
                    continue;
                }
                
                if (!inEntitiesSection) continue;
                
                if (code === 0) {
                    // Process previous entity
                    if (currentEntity) {
                        this.processEntity(currentEntity);
                    }
                    
                    // Start new entity
                    currentEntity = {
                        type: value,
                        layer: '0',
                        color: 7
                    };
                } else if (currentEntity) {
                    switch (code) {
                        case 8: // Layer
                            currentEntity.layer = value;
                            break;
                        case 62: // Color
                            currentEntity.color = parseInt(value);
                            break;
                        case 10: // X1
                            currentEntity.x1 = parseFloat(value);
                            break;
                        case 20: // Y1
                            currentEntity.y1 = parseFloat(value);
                            break;
                        case 11: // X2
                            currentEntity.x2 = parseFloat(value);
                            break;
                        case 21: // Y2
                            currentEntity.y2 = parseFloat(value);
                            break;
                        case 40: // Radius
                            currentEntity.radius = parseFloat(value);
                            break;
                    }
                }
            }
            
            // Process last entity
            if (currentEntity) {
                this.processEntity(currentEntity);
            }
            
            // Calculate bounds
            this.calculateBounds();
            
            // Generate rooms from bounds
            const rooms = this.generateRooms();
            
            console.log(`Processed DXF: ${this.walls.length} walls, ${this.forbiddenZones.length} forbidden zones, ${this.entrances.length} entrances`);
            
            return {
                walls: this.walls,
                forbiddenZones: this.forbiddenZones,
                entrances: this.entrances,
                rooms: rooms,
                bounds: this.bounds
            };
            
        } catch (error) {
            console.error('Real DXF Processing Error:', error);
            throw error;
        }
    }
    
    processEntity(entity) {
        if (entity.type === 'LINE' && entity.x1 !== undefined && entity.y1 !== undefined) {
            const line = {
                type: 'line',
                start: { x: entity.x1, y: entity.y1 },
                end: { x: entity.x2 || entity.x1, y: entity.y2 || entity.y1 },
                layer: entity.layer,
                color: entity.color
            };
            
            // Update bounds
            this.updateBounds(entity.x1, entity.y1);
            this.updateBounds(entity.x2 || entity.x1, entity.y2 || entity.y1);
            
            // Classify by layer and color
            const layer = entity.layer.toLowerCase();
            const color = entity.color;
            
            if (color === 5 || layer.includes('blue') || layer.includes('forbidden')) {
                this.forbiddenZones.push(line);
            } else if (color === 1 || layer.includes('red') || layer.includes('door') || layer.includes('entrance')) {
                this.entrances.push(line);
            } else {
                this.walls.push(line);
            }
        }
    }
    
    updateBounds(x, y) {
        if (x < this.bounds.minX) this.bounds.minX = x;
        if (x > this.bounds.maxX) this.bounds.maxX = x;
        if (y < this.bounds.minY) this.bounds.minY = y;
        if (y > this.bounds.maxY) this.bounds.maxY = y;
    }
    
    calculateBounds() {
        if (this.bounds.minX === Infinity) {
            this.bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        }
    }
    
    generateRooms() {
        const area = (this.bounds.maxX - this.bounds.minX) * (this.bounds.maxY - this.bounds.minY);
        
        return [{
            id: 1,
            name: 'Detected Area',
            area: area,
            bounds: this.bounds,
            center: {
                x: (this.bounds.minX + this.bounds.maxX) / 2,
                y: (this.bounds.minY + this.bounds.maxY) / 2
            },
            type: 'office'
        }];
    }
}

module.exports = RealCADProcessor;