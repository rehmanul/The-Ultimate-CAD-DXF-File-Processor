/**
 * ML Training Data Generator for FloorPlan Pro
 * Generates synthetic training data for CAD entity classification
 */

class MLTrainingDataGenerator {
    constructor() {
        this.layerNames = {
            walls: ['WALLS', 'MURS', 'WALL', 'MUR'],
            entrances: ['DOORS', 'ENTRANCES', 'PORTES', 'DOOR', 'PORTE', 'ENTREE_SORTIE'],
            forbidden: ['STAIRS', 'CABINETRY', 'LIGHTING', 'POWER', 'APPLIANCES', 'ELEVATORS', 'ESCALIERS', 'MEUBLES', 'ECLAIRAGE', 'ELECTRICITE', 'APPAREILS']
        };

        this.colors = {
            walls: [0x000000, 0x333333, 0x666666], // Black/gray
            entrances: [0xFF0000, 0xCC0000, 0xAA0000], // Red shades
            forbidden: [0x0000FF, 0x0000CC, 0x0000AA] // Blue shades
        };
    }

    /**
     * Generate synthetic CAD entity training data
     */
    generateCADEntityTrainingData(count = 1000) {
        const trainingData = [];

        // Generate wall entities
        const wallCount = Math.floor(count * 0.5);
        for (let i = 0; i < wallCount; i++) {
            trainingData.push(this.generateWallEntity());
        }

        // Generate entrance entities
        const entranceCount = Math.floor(count * 0.25);
        for (let i = 0; i < entranceCount; i++) {
            trainingData.push(this.generateEntranceEntity());
        }

        // Generate forbidden zone entities
        const forbiddenCount = Math.floor(count * 0.25);
        for (let i = 0; i < forbiddenCount; i++) {
            trainingData.push(this.generateForbiddenEntity());
        }

        // Shuffle the data
        this.shuffleArray(trainingData);

        return trainingData;
    }

    /**
     * Generate a synthetic wall entity
     */
    generateWallEntity() {
        const layer = this.randomChoice(this.layerNames.walls);
        const color = this.randomChoice(this.colors.walls);

        // Walls are typically long and thin rectangles
        const length = 5 + Math.random() * 15; // 5-20m
        const width = 0.1 + Math.random() * 0.3; // 10-40cm

        const area = length * width;
        const perimeter = 2 * (length + width);
        const aspectRatio = length / width;

        const centerX = Math.random() * 50; // 0-50m
        const centerY = Math.random() * 50;

        return {
            type: 'wall',
            layer: layer,
            color: color,
            area: area,
            perimeter: perimeter,
            aspectRatio: aspectRatio,
            center: { x: centerX, y: centerY }
        };
    }

    /**
     * Generate a synthetic entrance entity
     */
    generateEntranceEntity() {
        const layer = this.randomChoice(this.layerNames.entrances);
        const color = this.randomChoice(this.colors.entrances);

        // Entrances are typically small rectangles or squares
        const width = 0.8 + Math.random() * 1.2; // 0.8-2m
        const height = 0.8 + Math.random() * 1.2; // 0.8-2m

        const area = width * height;
        const perimeter = 2 * (width + height);
        const aspectRatio = width / height;

        const centerX = Math.random() * 50;
        const centerY = Math.random() * 50;

        return {
            type: 'entrance',
            layer: layer,
            color: color,
            area: area,
            perimeter: perimeter,
            aspectRatio: aspectRatio,
            center: { x: centerX, y: centerY }
        };
    }

    /**
     * Generate a synthetic forbidden zone entity
     */
    generateForbiddenEntity() {
        const layer = this.randomChoice(this.layerNames.forbidden);
        const color = this.randomChoice(this.colors.forbidden);

        // Forbidden zones vary in size but are typically larger than entrances
        const width = 1 + Math.random() * 4; // 1-5m
        const height = 1 + Math.random() * 4; // 1-5m

        const area = width * height;
        const perimeter = 2 * (width + height);
        const aspectRatio = width / height;

        const centerX = Math.random() * 50;
        const centerY = Math.random() * 50;

        return {
            type: 'forbidden',
            layer: layer,
            color: color,
            area: area,
            perimeter: perimeter,
            aspectRatio: aspectRatio,
            center: { x: centerX, y: centerY }
        };
    }

    /**
     * Generate room classification training data
     */
    generateRoomTrainingData(count = 500) {
        const trainingData = [];
        const roomTypes = ['office', 'meeting', 'utility', 'hall', 'entry', 'circulation', 'storage', 'other'];

        for (let i = 0; i < count; i++) {
            const roomType = this.randomChoice(roomTypes);
            trainingData.push(this.generateRoomEntity(roomType));
        }

        return trainingData;
    }

    /**
     * Generate a synthetic room entity
     */
    generateRoomEntity(roomType) {
        let area, width, height;

        switch (roomType) {
            case 'office':
                area = 8 + Math.random() * 12; // 8-20m²
                break;
            case 'meeting':
                area = 15 + Math.random() * 35; // 15-50m²
                break;
            case 'utility':
                area = 2 + Math.random() * 3; // 2-5m²
                break;
            case 'hall':
                area = 50 + Math.random() * 100; // 50-150m²
                break;
            case 'entry':
                area = 10 + Math.random() * 20; // 10-30m²
                break;
            case 'circulation':
                area = 20 + Math.random() * 40; // 20-60m²
                break;
            case 'storage':
                area = 5 + Math.random() * 15; // 5-20m²
                break;
            default:
                area = 10 + Math.random() * 40; // 10-50m²
        }

        // Generate dimensions based on area
        const aspectRatio = 0.5 + Math.random() * 1.5; // 0.5-2.0
        width = Math.sqrt(area * aspectRatio);
        height = area / width;

        const bounds = {
            minX: Math.random() * 30,
            minY: Math.random() * 30,
            maxX: Math.random() * 30 + width,
            maxY: Math.random() * 30 + height
        };

        const center = {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2
        };

        // Generate adjacency count based on room type
        let adjacencyCount;
        switch (roomType) {
            case 'office':
                adjacencyCount = 2 + Math.floor(Math.random() * 3); // 2-4
                break;
            case 'meeting':
                adjacencyCount = 3 + Math.floor(Math.random() * 4); // 3-6
                break;
            case 'utility':
                adjacencyCount = 1 + Math.floor(Math.random() * 2); // 1-2
                break;
            case 'hall':
                adjacencyCount = 4 + Math.floor(Math.random() * 6); // 4-9
                break;
            default:
                adjacencyCount = 2 + Math.floor(Math.random() * 4); // 2-5
        }

        // Distance to entrance (simplified)
        const distanceToEntrance = 2 + Math.random() * 15; // 2-17m

        return {
            type: roomType,
            area: area,
            bounds: bounds,
            center: center,
            adjacency: adjacencyCount,
            distanceToEntrance: distanceToEntrance
        };
    }

    /**
     * Generate furniture placement training data
     */
    generateFurnitureTrainingData(count = 300) {
        const trainingData = [];
        const furnitureTypes = ['desk', 'chair', 'table', 'cabinet', 'sofa', 'bed', 'shelf'];
        const roomTypes = ['office', 'meeting', 'utility', 'hall', 'entry', 'circulation', 'storage', 'other'];

        for (let i = 0; i < count; i++) {
            const roomType = this.randomChoice(roomTypes);
            const furnitureType = this.randomChoice(furnitureTypes);

            const roomData = this.generateRoomEntity(roomType);
            const placement = this.generateFurniturePlacement(roomData, furnitureType);

            trainingData.push({
                roomType: roomType,
                roomArea: roomData.area,
                roomWidth: roomData.bounds.maxX - roomData.bounds.minX,
                roomHeight: roomData.bounds.maxY - roomData.bounds.minY,
                furnitureType: furnitureType,
                x: placement.x,
                y: placement.y,
                rotation: placement.rotation
            });
        }

        return trainingData;
    }

    /**
     * Generate furniture placement for a room
     */
    generateFurniturePlacement(room, furnitureType) {
        const bounds = room.bounds;
        const roomWidth = bounds.maxX - bounds.minX;
        const roomHeight = bounds.maxY - bounds.minY;

        let x, y, rotation;

        switch (furnitureType) {
            case 'desk':
                // Desks typically against walls
                x = bounds.minX + 0.5 + Math.random() * (roomWidth - 1);
                y = bounds.minY + 0.5 + Math.random() * (roomHeight - 1);
                rotation = Math.random() < 0.5 ? 0 : Math.PI / 2; // Horizontal or vertical
                break;
            case 'chair':
                // Chairs near desks or in meeting areas
                x = bounds.minX + 1 + Math.random() * (roomWidth - 2);
                y = bounds.minY + 1 + Math.random() * (roomHeight - 2);
                rotation = Math.random() * 2 * Math.PI; // Any rotation
                break;
            case 'table':
                // Tables in center of room
                x = bounds.minX + roomWidth * 0.3 + Math.random() * (roomWidth * 0.4);
                y = bounds.minY + roomHeight * 0.3 + Math.random() * (roomHeight * 0.4);
                rotation = Math.random() * 2 * Math.PI;
                break;
            case 'cabinet':
                // Cabinets against walls
                x = bounds.minX + 0.2 + Math.random() * (roomWidth - 0.4);
                y = bounds.minY + 0.2 + Math.random() * (roomHeight - 0.4);
                rotation = Math.random() < 0.5 ? 0 : Math.PI / 2;
                break;
            default:
                // Default placement
                x = bounds.minX + roomWidth * 0.2 + Math.random() * (roomWidth * 0.6);
                y = bounds.minY + roomHeight * 0.2 + Math.random() * (roomHeight * 0.6);
                rotation = Math.random() * 2 * Math.PI;
        }

        return { x, y, rotation };
    }

    /**
     * Generate layout optimization training data
     */
    generateLayoutTrainingData(count = 200) {
        const trainingData = [];

        for (let i = 0; i < count; i++) {
            const layout = this.generateLayout();
            const qualityScore = this.scoreLayout(layout);
            trainingData.push({
                ...layout,
                qualityScore: qualityScore
            });
        }

        return trainingData;
    }

    /**
     * Generate a synthetic layout
     */
    generateLayout() {
        const floorPlan = {
            totalArea: 400 + Math.random() * 600, // 400-1000m²
            entrances: [
                { x: Math.random() * 50, y: Math.random() * 50 }
            ],
            rooms: []
        };

        // Generate 5-15 rooms
        const roomCount = 5 + Math.floor(Math.random() * 10);
        for (let i = 0; i < roomCount; i++) {
            floorPlan.rooms.push(this.generateRoomEntity(this.randomChoice(['office', 'meeting', 'utility'])));
        }

        // Generate ilots
        const ilotCount = 10 + Math.floor(Math.random() * 40);
        const ilots = [];
        for (let i = 0; i < ilotCount; i++) {
            ilots.push({
                x: Math.random() * 40,
                y: Math.random() * 40,
                width: 0.8 + Math.random() * 3.2, // 0.8-4m
                height: 0.8 + Math.random() * 3.2,
                area: 0 // Will be calculated
            });
            ilots[i].area = ilots[i].width * ilots[i].height;
        }

        // Generate corridors
        const corridors = [];
        const corridorCount = 2 + Math.floor(Math.random() * 5);
        for (let i = 0; i < corridorCount; i++) {
            corridors.push({
                length: 5 + Math.random() * 20, // 5-25m
                width: 1 + Math.random() * 1 // 1-2m
            });
        }

        return {
            floorPlan: floorPlan,
            ilots: ilots,
            corridors: corridors
        };
    }

    /**
     * Score layout quality
     */
    scoreLayout(layout) {
        const ilots = layout.ilots || [];
        const corridors = layout.corridors || [];
        const floorPlan = layout.floorPlan || {};

        let score = 0;

        // Density score (20%)
        const totalIlotArea = ilots.reduce((sum, ilot) => sum + (ilot.area || 0), 0);
        const floorArea = floorPlan.totalArea || 500;
        const density = totalIlotArea / floorArea;
        score += Math.min(density * 2, 1) * 0.2;

        // Distribution score (30%)
        if (ilots.length > 1) {
            const centers = ilots.map(ilot => ({
                x: ilot.x + ilot.width / 2,
                y: ilot.y + ilot.height / 2
            }));
            const meanX = centers.reduce((sum, c) => sum + c.x, 0) / centers.length;
            const meanY = centers.reduce((sum, c) => sum + c.y, 0) / centers.length;
            const variance = centers.reduce((sum, c) =>
                sum + Math.pow(c.x - meanX, 2) + Math.pow(c.y - meanY, 2), 0) / centers.length;
            score += Math.max(0, 1 - variance / 200) * 0.3;
        }

        // Accessibility score (25%)
        const entrances = floorPlan.entrances || [];
        if (entrances.length > 0 && ilots.length > 0) {
            let totalDistance = 0;
            ilots.forEach(ilot => {
                const center = { x: ilot.x + ilot.width / 2, y: ilot.y + ilot.height / 2 };
                let minDist = Infinity;
                entrances.forEach(entrance => {
                    const dist = Math.sqrt(Math.pow(center.x - entrance.x, 2) + Math.pow(center.y - entrance.y, 2));
                    minDist = Math.min(minDist, dist);
                });
                totalDistance += minDist;
            });
            const avgDistance = totalDistance / ilots.length;
            score += Math.max(0, 1 - avgDistance / 30) * 0.25;
        }

        // Corridor efficiency (15%)
        const totalCorridorLength = corridors.reduce((sum, c) => sum + (c.length || 0), 0);
        const corridorEfficiency = totalCorridorLength / Math.sqrt(floorArea);
        score += Math.min(corridorEfficiency * 0.5, 1) * 0.15;

        // Collision penalty (10%)
        let collisions = 0;
        for (let i = 0; i < ilots.length; i++) {
            for (let j = i + 1; j < ilots.length; j++) {
                if (this.ilotsOverlap(ilots[i], ilots[j])) {
                    collisions++;
                }
            }
        }
        score += Math.max(0, 1 - collisions / 10) * 0.1;

        return Math.max(0, Math.min(1, score));
    }

    /**
     * Check if two ilots overlap
     */
    ilotsOverlap(ilot1, ilot2) {
        return !(ilot1.x + ilot1.width < ilot2.x ||
            ilot2.x + ilot2.width < ilot1.x ||
            ilot1.y + ilot1.height < ilot2.y ||
            ilot2.y + ilot2.height < ilot1.y);
    }

    /**
     * Utility function to get random choice from array
     */
    randomChoice(array) {
        return array[Math.floor(Math.random() * array.length)];
    }

    /**
     * Shuffle array in place
     */
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    /**
     * Generate complete training dataset
     */
    generateCompleteTrainingData() {
        console.log('Generating ML training data...');

        const trainingData = {
            cadEntities: this.generateCADEntityTrainingData(2000),
            rooms: this.generateRoomTrainingData(1000),
            furniture: this.generateFurnitureTrainingData(500),
            layouts: this.generateLayoutTrainingData(300)
        };

        console.log(`Generated training data: ${trainingData.cadEntities.length} CAD entities, ${trainingData.rooms.length} rooms, ${trainingData.furniture.length} furniture placements, ${trainingData.layouts.length} layouts`);

        return trainingData;
    }
}

module.exports = new MLTrainingDataGenerator();
