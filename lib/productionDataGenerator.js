/**
 * Production Training Data Generator for FloorPlan Pro
 * Generates realistic architectural training data from DXF patterns and real-world building layouts
 */

class ProductionDataGenerator {
    constructor() {
        // Real architectural layer naming conventions
        this.layerPatterns = {
            walls: [
                'WALLS', 'WALL', 'MUR', 'MURS', 'A-WALL', 'A-WALLS',
                'ARCHITECTURE-WALL', 'STRUCTURE', 'PAROI', 'CLOISON'
            ],
            entrances: [
                'DOORS', 'DOOR', 'PORTE', 'PORTES', 'ENTREE', 'SORTIE',
                'EXIT', 'ENTREE_SORTIE', 'A-DOOR', 'A-FLOR-DOOR',
                'OPENING', 'OUVERTURE', 'ACCESS'
            ],
            forbidden: [
                'STAIRS', 'STAIR', 'ESCALIER', 'ESCALIERS', 'ELEVATOR',
                'LIFT', 'ASCENSEUR', 'SHAFT', 'MECHANICAL', 'HVAC',
                'PLUMBING', 'ELECTRICAL', 'TOILETS', 'WC', 'SANITAIRE'
            ]
        };

        // AutoCAD color index mapping (256 colors)
        this.colorPatterns = {
            walls: [0, 7, 8, 9, 250, 251, 252, 253, 254, 255], // Black, white, grays
            entrances: [1, 10, 12, 14, 20, 30], // Reds, pinks
            forbidden: [5, 140, 150, 160, 170, 180] // Blues
        };

        // Room type characteristics (area in m²)
        this.roomTypes = {
            office: { minArea: 9, maxArea: 25, aspectRatio: [1.2, 2.0], adjacency: [2, 4] },
            meeting: { minArea: 15, maxArea: 80, aspectRatio: [1.3, 2.5], adjacency: [1, 3] },
            utility: { minArea: 2, maxArea: 8, aspectRatio: [0.8, 1.5], adjacency: [1, 2] },
            hall: { minArea: 50, maxArea: 500, aspectRatio: [1.5, 4.0], adjacency: [4, 10] },
            entry: { minArea: 10, maxArea: 40, aspectRatio: [1.0, 2.0], adjacency: [2, 6] },
            circulation: { minArea: 10, maxArea: 100, aspectRatio: [2.0, 10.0], adjacency: [3, 8] },
            storage: { minArea: 4, maxArea: 30, aspectRatio: [0.8, 1.8], adjacency: [1, 2] },
            other: { minArea: 5, maxArea: 50, aspectRatio: [1.0, 2.5], adjacency: [1, 4] }
        };

        // Furniture types and their typical dimensions
        this.furnitureTypes = {
            desk: { width: [1.2, 1.8], depth: [0.6, 0.8], height: 0.75 },
            chair: { width: [0.5, 0.6], depth: [0.5, 0.6], height: 0.9 },
            table: { width: [1.5, 3.0], depth: [0.8, 1.5], height: 0.75 },
            cabinet: { width: [0.8, 1.2], depth: [0.4, 0.6], height: 2.0 },
            sofa: { width: [1.8, 2.5], depth: [0.8, 1.0], height: 0.8 },
            bed: { width: [1.4, 2.0], depth: [1.9, 2.2], height: 0.5 },
            shelf: { width: [0.8, 2.0], depth: [0.3, 0.5], height: 2.0 }
        };
    }

    /**
     * Generate complete production training dataset
     */
    generateCompleteDataset(options = {}) {
        const config = {
            cadEntities: options.cadEntities || 5000,
            rooms: options.rooms || 2000,
            furniture: options.furniture || 1000,
            layouts: options.layouts || 500,
            ...options
        };

        console.log('Generating production training dataset...');
        console.log(`Target: ${config.cadEntities} CAD entities, ${config.rooms} rooms, ${config.furniture} furniture items, ${config.layouts} layouts`);

        const dataset = {
            cadEntities: this.generateCADEntities(config.cadEntities),
            rooms: this.generateRooms(config.rooms),
            furniture: this.generateFurniture(config.furniture),
            layouts: this.generateLayouts(config.layouts),
            metadata: {
                generated: new Date().toISOString(),
                version: '1.0.0',
                datasetSize: {
                    cadEntities: config.cadEntities,
                    rooms: config.rooms,
                    furniture: config.furniture,
                    layouts: config.layouts
                }
            }
        };

        console.log('Production dataset generation complete');
        return dataset;
    }

    /**
     * Generate realistic CAD entities with architectural patterns
     */
    generateCADEntities(count) {
        const entities = [];
        const distribution = {
            wall: 0.50,      // 50% walls
            entrance: 0.25,  // 25% entrances
            forbidden: 0.25  // 25% forbidden zones
        };

        const wallCount = Math.floor(count * distribution.wall);
        const entranceCount = Math.floor(count * distribution.entrance);
        const forbiddenCount = count - wallCount - entranceCount;

        // Generate walls
        for (let i = 0; i < wallCount; i++) {
            entities.push(this.generateWallEntity());
        }

        // Generate entrances
        for (let i = 0; i < entranceCount; i++) {
            entities.push(this.generateEntranceEntity());
        }

        // Generate forbidden zones
        for (let i = 0; i < forbiddenCount; i++) {
            entities.push(this.generateForbiddenEntity());
        }

        // Shuffle
        return this.shuffleArray(entities);
    }

    /**
     * Generate realistic wall entity
     */
    generateWallEntity() {
        const layer = this.randomChoice(this.layerPatterns.walls);
        const color = this.randomChoice(this.colorPatterns.walls);

        // Walls: long thin rectangles (typical wall thickness 0.15-0.30m)
        const length = this.randomRange(1.0, 20.0); // 1-20m
        const thickness = this.randomRange(0.15, 0.30); // 15-30cm

        const area = length * thickness;
        const perimeter = 2 * (length + thickness);
        const aspectRatio = length / thickness;

        // Position in building (0-100m range)
        const centerX = this.randomRange(0, 100);
        const centerY = this.randomRange(0, 100);

        // Add realistic variations
        const hasOpenings = Math.random() < 0.3; // 30% walls have openings
        const structuralType = this.randomChoice(['exterior', 'interior', 'partition']);

        return {
            type: 'wall',
            layer: layer,
            color: color,
            area: area,
            perimeter: perimeter,
            aspectRatio: aspectRatio,
            center: { x: centerX, y: centerY },
            thickness: thickness,
            length: length,
            hasOpenings: hasOpenings,
            structuralType: structuralType
        };
    }

    /**
     * Generate realistic entrance entity
     */
    generateEntranceEntity() {
        const layer = this.randomChoice(this.layerPatterns.entrances);
        const color = this.randomChoice(this.colorPatterns.entrances);

        // Standard door sizes (0.8-1.2m width, with swing arc)
        const doorWidth = this.randomRange(0.8, 1.2);
        const swingRadius = doorWidth; // Door swing creates arc
        
        // Door representation as small rectangle
        const width = doorWidth;
        const height = 0.1; // Thin representation in plan

        const area = width * height + (Math.PI * swingRadius * swingRadius) / 4; // Include swing area
        const perimeter = 2 * (width + height) + (Math.PI * swingRadius) / 2; // Include arc
        const aspectRatio = width / height;

        const centerX = this.randomRange(0, 100);
        const centerY = this.randomRange(0, 100);

        // Door types
        const doorType = this.randomChoice(['single', 'double', 'sliding', 'revolving']);
        const swingDirection = this.randomChoice(['left', 'right', 'both']);

        return {
            type: 'entrance',
            layer: layer,
            color: color,
            area: area,
            perimeter: perimeter,
            aspectRatio: aspectRatio,
            center: { x: centerX, y: centerY },
            doorWidth: doorWidth,
            doorType: doorType,
            swingDirection: swingDirection
        };
    }

    /**
     * Generate realistic forbidden zone entity
     */
    generateForbiddenEntity() {
        const layer = this.randomChoice(this.layerPatterns.forbidden);
        const color = this.randomChoice(this.colorPatterns.forbidden);

        // Forbidden zones: stairs, elevators, shafts
        const zoneType = this.randomChoice(['stair', 'elevator', 'mechanical', 'shaft', 'toilet']);
        
        let width, height, area, perimeter, aspectRatio;

        switch (zoneType) {
            case 'stair':
                // Typical stair: 1.2-2.0m width, 3-6m length
                width = this.randomRange(1.2, 2.0);
                height = this.randomRange(3.0, 6.0);
                break;
            case 'elevator':
                // Typical elevator: 1.5-2.5m square
                width = this.randomRange(1.5, 2.5);
                height = this.randomRange(1.5, 2.5);
                break;
            case 'mechanical':
                // Mechanical rooms: variable size
                width = this.randomRange(2.0, 5.0);
                height = this.randomRange(2.0, 5.0);
                break;
            case 'shaft':
                // Vertical shafts: compact square
                width = this.randomRange(0.8, 1.5);
                height = this.randomRange(0.8, 1.5);
                break;
            case 'toilet':
                // Toilets: 1.5-3m width, 2-4m depth
                width = this.randomRange(1.5, 3.0);
                height = this.randomRange(2.0, 4.0);
                break;
            default:
                width = this.randomRange(1.5, 3.0);
                height = this.randomRange(2.0, 4.0);
        }

        area = width * height;
        perimeter = 2 * (width + height);
        aspectRatio = width / height;

        const centerX = this.randomRange(0, 100);
        const centerY = this.randomRange(0, 100);

        return {
            type: 'forbidden',
            layer: layer,
            color: color,
            area: area,
            perimeter: perimeter,
            aspectRatio: aspectRatio,
            center: { x: centerX, y: centerY },
            zoneType: zoneType,
            width: width,
            height: height
        };
    }

    /**
     * Generate realistic room data
     */
    generateRooms(count) {
        const rooms = [];

        for (const [roomType, characteristics] of Object.entries(this.roomTypes)) {
            const typeCount = Math.floor(count / Object.keys(this.roomTypes).length);

            for (let i = 0; i < typeCount; i++) {
                rooms.push(this.generateRoom(roomType, characteristics));
            }
        }

        return this.shuffleArray(rooms);
    }

    /**
     * Generate single room
     */
    generateRoom(type, characteristics) {
        const area = this.randomRange(characteristics.minArea, characteristics.maxArea);
        const aspectRatio = this.randomRange(characteristics.aspectRatio[0], characteristics.aspectRatio[1]);

        // Calculate dimensions from area and aspect ratio
        const height = Math.sqrt(area / aspectRatio);
        const width = area / height;

        // Random position
        const posX = this.randomRange(0, 80);
        const posY = this.randomRange(0, 80);

        const bounds = {
            minX: posX,
            minY: posY,
            maxX: posX + width,
            maxY: posY + height
        };

        const center = {
            x: posX + width / 2,
            y: posY + height / 2
        };

        // Adjacency count
        const adjacencyCount = Math.floor(this.randomRange(
            characteristics.adjacency[0],
            characteristics.adjacency[1]
        ));

        // Distance to entrance (realistic building layout)
        const distanceToEntrance = this.randomRange(2, 30);

        const perimeter = 2 * (width + height);

        return {
            type: type,
            area: area,
            bounds: bounds,
            center: center,
            width: width,
            height: height,
            aspectRatio: aspectRatio,
            adjacency: this.generateAdjacency(adjacencyCount),
            distanceToEntrance: distanceToEntrance,
            perimeter: perimeter
        };
    }

    /**
     * Generate adjacency relationships
     */
    generateAdjacency(count) {
        const adjacency = {};
        for (let i = 0; i < count; i++) {
            const roomId = `room_${Math.floor(Math.random() * 1000)}`;
            adjacency[roomId] = true;
        }
        return adjacency;
    }

    /**
     * Generate furniture placement data
     */
    generateFurniture(count) {
        const furniture = [];

        for (const [furnitureType, dimensions] of Object.entries(this.furnitureTypes)) {
            const typeCount = Math.floor(count / Object.keys(this.furnitureTypes).length);

            for (let i = 0; i < typeCount; i++) {
                furniture.push(this.generateFurnitureItem(furnitureType, dimensions));
            }
        }

        return this.shuffleArray(furniture);
    }

    /**
     * Generate single furniture item
     */
    generateFurnitureItem(furnitureType, dimensions) {
        // Room context
        const roomType = this.randomChoice(Object.keys(this.roomTypes));
        const roomArea = this.randomRange(10, 50);
        const roomWidth = this.randomRange(3, 8);
        const roomHeight = roomArea / roomWidth;

        // Furniture dimensions
        const width = this.randomRange(dimensions.width[0], dimensions.width[1]);
        const depth = this.randomRange(dimensions.depth[0], dimensions.depth[1]);

        // Placement within room (normalized 0-1)
        // Furniture tends to be against walls or centered
        const placementStyle = this.randomChoice(['wall', 'centered', 'corner']);
        
        let x, y;
        switch (placementStyle) {
            case 'wall':
                x = Math.random() < 0.5 ? 0.2 : 0.8; // Left or right wall
                y = this.randomRange(0.2, 0.8);
                break;
            case 'centered':
                x = this.randomRange(0.4, 0.6);
                y = this.randomRange(0.4, 0.6);
                break;
            case 'corner':
                x = Math.random() < 0.5 ? 0.15 : 0.85;
                y = Math.random() < 0.5 ? 0.15 : 0.85;
                break;
        }

        // Rotation (typically aligned to room axes or 90° rotations)
        const rotation = this.randomChoice([0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]);

        return {
            furnitureType: furnitureType,
            roomType: roomType,
            roomArea: roomArea,
            roomWidth: roomWidth,
            roomHeight: roomHeight,
            x: x * roomWidth,
            y: y * roomHeight,
            rotation: rotation,
            width: width,
            depth: depth,
            placementStyle: placementStyle
        };
    }

    /**
     * Generate layout quality data
     */
    generateLayouts(count) {
        const layouts = [];

        for (let i = 0; i < count; i++) {
            layouts.push(this.generateLayout());
        }

        return layouts;
    }

    /**
     * Generate single layout with quality score
     */
    generateLayout() {
        // Generate floor plan context
        const floorArea = this.randomRange(100, 500);
        const numRooms = Math.floor(this.randomRange(5, 25));
        const numEntrances = Math.floor(this.randomRange(1, 4));

        // Generate ilots
        const numIlots = Math.floor(this.randomRange(10, 50));
        const ilots = [];
        
        for (let i = 0; i < numIlots; i++) {
            const width = this.randomRange(1, 4);
            const height = this.randomRange(1, 4);
            ilots.push({
                x: this.randomRange(0, Math.sqrt(floorArea)),
                y: this.randomRange(0, Math.sqrt(floorArea)),
                width: width,
                height: height,
                area: width * height
            });
        }

        // Generate corridors
        const numCorridors = Math.floor(this.randomRange(2, 8));
        const corridors = [];
        
        for (let i = 0; i < numCorridors; i++) {
            corridors.push({
                length: this.randomRange(5, 20),
                width: this.randomRange(1.2, 2.0)
            });
        }

        // Calculate quality score based on architectural principles
        const density = ilots.reduce((sum, i) => sum + i.area, 0) / floorArea;
        const avgDistanceToEntrance = this.randomRange(5, 20);
        const corridorEfficiency = corridors.reduce((sum, c) => sum + c.length, 0) / floorArea;
        
        // Quality score (0-1): balanced density, good circulation, accessibility
        const qualityScore = this.calculateQualityScore({
            density,
            avgDistanceToEntrance,
            corridorEfficiency,
            numIlots,
            numCorridors
        });

        return {
            ilots: ilots,
            corridors: corridors,
            floorPlan: {
                totalArea: floorArea,
                rooms: Array(numRooms).fill(null).map(() => ({ type: 'office' })),
                entrances: Array(numEntrances).fill(null).map(() => ({ x: 0, y: 0 }))
            },
            qualityScore: qualityScore,
            metrics: {
                density: density,
                avgDistanceToEntrance: avgDistanceToEntrance,
                corridorEfficiency: corridorEfficiency
            }
        };
    }

    /**
     * Calculate layout quality score
     */
    calculateQualityScore(metrics) {
        // Ideal density: 0.5-0.7 (50-70% space utilization)
        const densityScore = Math.max(0, 1 - Math.abs(metrics.density - 0.6) / 0.4);

        // Distance to entrance: prefer shorter (5-15m optimal)
        const distanceScore = Math.max(0, 1 - Math.abs(metrics.avgDistanceToEntrance - 10) / 15);

        // Corridor efficiency: 0.1-0.2 optimal (10-20% circulation space)
        const corridorScore = Math.max(0, 1 - Math.abs(metrics.corridorEfficiency - 0.15) / 0.15);

        // Count penalties
        const ilotCountScore = Math.min(1, metrics.numIlots / 30); // More ilots = better
        const corridorCountScore = Math.min(1, metrics.numCorridors / 5); // Adequate corridors

        // Weighted average
        const score = (
            densityScore * 0.30 +
            distanceScore * 0.25 +
            corridorScore * 0.25 +
            ilotCountScore * 0.10 +
            corridorCountScore * 0.10
        );

        return Math.max(0, Math.min(1, score));
    }

    /**
     * Extract training data from real DXF processing result
     */
    extractFromDXFResult(dxfResult) {
        const trainingData = {
            cadEntities: [],
            rooms: [],
            furniture: [],
            layouts: []
        };

        // Extract CAD entities
        if (dxfResult.walls) {
            dxfResult.walls.forEach(wall => {
                trainingData.cadEntities.push({
                    type: 'wall',
                    layer: wall.layer || 'WALLS',
                    color: wall.color || 0,
                    area: this.calculateArea(wall),
                    perimeter: this.calculatePerimeter(wall),
                    aspectRatio: this.calculateAspectRatio(wall),
                    center: this.calculateCenter(wall)
                });
            });
        }

        if (dxfResult.entrances) {
            dxfResult.entrances.forEach(entrance => {
                trainingData.cadEntities.push({
                    type: 'entrance',
                    layer: entrance.layer || 'DOORS',
                    color: entrance.color || 1,
                    area: this.calculateArea(entrance),
                    perimeter: this.calculatePerimeter(entrance),
                    aspectRatio: this.calculateAspectRatio(entrance),
                    center: this.calculateCenter(entrance)
                });
            });
        }

        if (dxfResult.forbiddenZones) {
            dxfResult.forbiddenZones.forEach(zone => {
                trainingData.cadEntities.push({
                    type: 'forbidden',
                    layer: zone.layer || 'STAIRS',
                    color: zone.color || 5,
                    area: this.calculateArea(zone),
                    perimeter: this.calculatePerimeter(zone),
                    aspectRatio: this.calculateAspectRatio(zone),
                    center: this.calculateCenter(zone)
                });
            });
        }

        // Extract rooms
        if (dxfResult.rooms) {
            trainingData.rooms = dxfResult.rooms.map(room => ({
                type: room.type || 'office',
                area: room.area || 0,
                bounds: room.bounds || { minX: 0, minY: 0, maxX: 5, maxY: 5 },
                center: room.center || { x: 2.5, y: 2.5 },
                adjacency: room.adjacency || {},
                distanceToEntrance: this.calculateDistanceToNearestEntrance(room, dxfResult.entrances)
            }));
        }

        return trainingData;
    }

    /**
     * Geometry calculation helpers
     */
    calculateArea(entity) {
        if (entity.area) return entity.area;
        if (entity.polygon) {
            return this.polygonArea(entity.polygon);
        }
        if (entity.start && entity.end) {
            const width = Math.abs(entity.end.x - entity.start.x);
            const height = Math.abs(entity.end.y - entity.start.y);
            return width * height;
        }
        return 1;
    }

    calculatePerimeter(entity) {
        if (entity.perimeter) return entity.perimeter;
        if (entity.polygon) {
            return this.polygonPerimeter(entity.polygon);
        }
        if (entity.start && entity.end) {
            const width = Math.abs(entity.end.x - entity.start.x);
            const height = Math.abs(entity.end.y - entity.start.y);
            return 2 * (width + height);
        }
        return 4;
    }

    calculateAspectRatio(entity) {
        if (entity.aspectRatio) return entity.aspectRatio;
        if (entity.start && entity.end) {
            const width = Math.abs(entity.end.x - entity.start.x);
            const height = Math.abs(entity.end.y - entity.start.y);
            return height > 0 ? width / height : 1;
        }
        return 1;
    }

    calculateCenter(entity) {
        if (entity.center) return entity.center;
        if (entity.polygon) {
            return this.polygonCentroid(entity.polygon);
        }
        if (entity.start && entity.end) {
            return {
                x: (entity.start.x + entity.end.x) / 2,
                y: (entity.start.y + entity.end.y) / 2
            };
        }
        return { x: 0, y: 0 };
    }

    polygonArea(polygon) {
        let area = 0;
        for (let i = 0; i < polygon.length; i++) {
            const j = (i + 1) % polygon.length;
            area += polygon[i][0] * polygon[j][1];
            area -= polygon[j][0] * polygon[i][1];
        }
        return Math.abs(area / 2);
    }

    polygonPerimeter(polygon) {
        let perimeter = 0;
        for (let i = 0; i < polygon.length; i++) {
            const j = (i + 1) % polygon.length;
            const dx = polygon[j][0] - polygon[i][0];
            const dy = polygon[j][1] - polygon[i][1];
            perimeter += Math.sqrt(dx * dx + dy * dy);
        }
        return perimeter;
    }

    polygonCentroid(polygon) {
        let sumX = 0, sumY = 0;
        polygon.forEach(point => {
            sumX += point[0];
            sumY += point[1];
        });
        return {
            x: sumX / polygon.length,
            y: sumY / polygon.length
        };
    }

    calculateDistanceToNearestEntrance(room, entrances) {
        if (!entrances || entrances.length === 0) return 10;
        
        const roomCenter = room.center || { x: 0, y: 0 };
        let minDist = Infinity;

        entrances.forEach(entrance => {
            const entranceCenter = this.calculateCenter(entrance);
            const dist = Math.sqrt(
                Math.pow(roomCenter.x - entranceCenter.x, 2) +
                Math.pow(roomCenter.y - entranceCenter.y, 2)
            );
            minDist = Math.min(minDist, dist);
        });

        return minDist;
    }

    /**
     * Utility functions
     */
    randomChoice(array) {
        return array[Math.floor(Math.random() * array.length)];
    }

    randomRange(min, max) {
        return min + Math.random() * (max - min);
    }

    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    /**
     * Save dataset to file
     */
    async saveDataset(dataset, filepath) {
        const fs = require('fs').promises;
        await fs.writeFile(filepath, JSON.stringify(dataset, null, 2));
        console.log(`Dataset saved to ${filepath}`);
    }

    /**
     * Load dataset from file
     */
    async loadDataset(filepath) {
        const fs = require('fs').promises;
        const data = await fs.readFile(filepath, 'utf8');
        return JSON.parse(data);
    }
}

module.exports = new ProductionDataGenerator();
