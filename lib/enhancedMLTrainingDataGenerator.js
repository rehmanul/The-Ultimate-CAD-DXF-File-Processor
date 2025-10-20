/**
 * Enhanced ML Training Data Generator
 * Generates realistic synthetic training data for ML models
 */

class EnhancedMLTrainingDataGenerator {
    constructor() {
        this.roomTypes = [
            'office', 'meeting_room', 'conference_room', 'reception',
            'cafeteria', 'restroom', 'storage', 'server_room'
        ];
        
        this.furnitureTypes = [
            'desk', 'chair', 'table', 'cabinet', 'sofa', 'whiteboard'
        ];
    }

    /**
     * Generate complete training dataset
     */
    generateCompleteTrainingData(samples = 1000) {
        console.log(`Generating ${samples} training samples...`);
        
        return {
            rooms: this.generateRoomClassificationData(samples),
            furniture: this.generateFurniturePlacementData(samples),
            layouts: this.generateLayoutOptimizationData(samples * 0.1),
            cadEntities: this.generateCADEntityData(samples)
        };
    }

    /**
     * Generate room classification training data
     */
    generateRoomClassificationData(samples) {
        const data = [];
        
        for (let i = 0; i < samples; i++) {
            const roomType = this.roomTypes[Math.floor(Math.random() * this.roomTypes.length)];
            const features = this.generateRoomFeatures(roomType);
            
            data.push({
                features,
                label: this.roomTypes.indexOf(roomType)
            });
        }
        
        return data;
    }

    /**
     * Generate realistic room features based on room type
     */
    generateRoomFeatures(roomType) {
        let area, aspectRatio, adjacencyCount, distanceToEntrance, perimeter;
        
        switch (roomType) {
            case 'office':
                area = 9 + Math.random() * 16; // 9-25 m²
                aspectRatio = 1.2 + Math.random() * 0.8; // 1.2-2.0
                adjacencyCount = 2 + Math.floor(Math.random() * 3); // 2-4
                distanceToEntrance = 10 + Math.random() * 30; // 10-40m
                break;
                
            case 'meeting_room':
                area = 15 + Math.random() * 35; // 15-50 m²
                aspectRatio = 1.0 + Math.random() * 0.5; // 1.0-1.5
                adjacencyCount = 1 + Math.floor(Math.random() * 3); // 1-3
                distanceToEntrance = 5 + Math.random() * 20; // 5-25m
                break;
                
            case 'conference_room':
                area = 30 + Math.random() * 70; // 30-100 m²
                aspectRatio = 1.5 + Math.random() * 1.0; // 1.5-2.5
                adjacencyCount = 1 + Math.floor(Math.random() * 2); // 1-2
                distanceToEntrance = 10 + Math.random() * 30; // 10-40m
                break;
                
            case 'reception':
                area = 20 + Math.random() * 40; // 20-60 m²
                aspectRatio = 1.0 + Math.random() * 0.5; // 1.0-1.5
                adjacencyCount = 3 + Math.floor(Math.random() * 3); // 3-5
                distanceToEntrance = 0 + Math.random() * 5; // 0-5m (near entrance!)
                break;
                
            case 'cafeteria':
                area = 50 + Math.random() * 150; // 50-200 m²
                aspectRatio = 1.0 + Math.random() * 0.5; // 1.0-1.5
                adjacencyCount = 2 + Math.floor(Math.random() * 3); // 2-4
                distanceToEntrance = 15 + Math.random() * 35; // 15-50m
                break;
                
            case 'restroom':
                area = 4 + Math.random() * 8; // 4-12 m²
                aspectRatio = 0.8 + Math.random() * 0.7; // 0.8-1.5
                adjacencyCount = 1 + Math.floor(Math.random() * 2); // 1-2
                distanceToEntrance = 5 + Math.random() * 30; // 5-35m
                break;
                
            case 'storage':
                area = 3 + Math.random() * 12; // 3-15 m²
                aspectRatio = 0.7 + Math.random() * 1.3; // 0.7-2.0
                adjacencyCount = 1 + Math.floor(Math.random() * 2); // 1-2
                distanceToEntrance = 20 + Math.random() * 40; // 20-60m
                break;
                
            case 'server_room':
                area = 8 + Math.random() * 22; // 8-30 m²
                aspectRatio = 1.0 + Math.random() * 0.5; // 1.0-1.5
                adjacencyCount = 1; // Isolated
                distanceToEntrance = 30 + Math.random() * 50; // 30-80m (far from entrance)
                break;
                
            default:
                area = 10 + Math.random() * 20;
                aspectRatio = 1.0 + Math.random() * 1.0;
                adjacencyCount = 2 + Math.floor(Math.random() * 3);
                distanceToEntrance = 10 + Math.random() * 30;
        }
        
        perimeter = 2 * Math.sqrt(area * aspectRatio) + 2 * Math.sqrt(area / aspectRatio);
        
        return [area, aspectRatio, adjacencyCount, distanceToEntrance, perimeter];
    }

    /**
     * Generate furniture placement training data
     */
    generateFurniturePlacementData(samples) {
        const data = [];
        
        for (let i = 0; i < samples; i++) {
            const roomType = Math.floor(Math.random() * this.roomTypes.length);
            const roomArea = 10 + Math.random() * 40;
            const roomWidth = Math.sqrt(roomArea * (1 + Math.random()));
            const roomHeight = roomArea / roomWidth;
            const furnitureType = Math.floor(Math.random() * this.furnitureTypes.length);
            
            // Generate realistic furniture placement
            const placement = this.generateFurniturePlacement(
                this.roomTypes[roomType],
                roomWidth,
                roomHeight,
                this.furnitureTypes[furnitureType]
            );
            
            data.push({
                features: [roomType, roomArea, roomWidth, roomHeight, furnitureType],
                label: placement
            });
        }
        
        return data;
    }

    /**
     * Generate realistic furniture placement for room type
     */
    generateFurniturePlacement(roomType, width, height, furnitureType) {
        let x, y, rotation;
        
        // Place furniture logically based on room type and furniture type
        if (furnitureType === 'desk' && roomType === 'office') {
            // Desks along walls
            if (Math.random() < 0.5) {
                x = 0.1 + Math.random() * 0.2; // Near left wall
                y = 0.2 + Math.random() * 0.6;
                rotation = 0;
            } else {
                x = 0.7 + Math.random() * 0.2; // Near right wall
                y = 0.2 + Math.random() * 0.6;
                rotation = Math.PI;
            }
        } else if (furnitureType === 'table' && roomType === 'meeting_room') {
            // Tables in center
            x = 0.3 + Math.random() * 0.4;
            y = 0.3 + Math.random() * 0.4;
            rotation = (Math.random() < 0.5) ? 0 : Math.PI / 2;
        } else {
            // Random placement with some logic
            x = 0.1 + Math.random() * 0.8;
            y = 0.1 + Math.random() * 0.8;
            rotation = Math.random() * Math.PI * 2;
        }
        
        return [x, y, rotation];
    }

    /**
     * Generate layout optimization training data
     */
    generateLayoutOptimizationData(samples) {
        const data = [];
        
        for (let i = 0; i < samples; i++) {
            // Generate random layout parameters
            const numRooms = 5 + Math.floor(Math.random() * 20);
            const totalArea = 200 + Math.random() * 800;
            const aspectRatio = 0.5 + Math.random() * 1.5;
            
            // Generate quality score based on layout parameters
            const score = this.calculateLayoutQuality(numRooms, totalArea, aspectRatio);
            
            data.push({
                features: [numRooms, totalArea, aspectRatio],
                label: score
            });
        }
        
        return data;
    }

    /**
     * Calculate layout quality score (0-1)
     */
    calculateLayoutQuality(numRooms, totalArea, aspectRatio) {
        // Higher score for balanced layouts
        const densityScore = Math.min(1, totalArea / (numRooms * 20)) * 0.4;
        const ratioScore = (1 - Math.abs(aspectRatio - 1)) * 0.3;
        const sizeScore = Math.min(1, numRooms / 15) * 0.3;
        
        return densityScore + ratioScore + sizeScore;
    }

    /**
     * Generate CAD entity classification training data
     */
    generateCADEntityData(samples) {
        const data = [];
        const entityTypes = ['wall', 'entrance', 'forbidden', 'window', 'column'];
        
        for (let i = 0; i < samples; i++) {
            const entityType = entityTypes[Math.floor(Math.random() * entityTypes.length)];
            const features = this.generateEntityFeatures(entityType);
            
            data.push({
                features,
                label: entityTypes.indexOf(entityType)
            });
        }
        
        return data;
    }

    /**
     * Generate CAD entity features based on type
     */
    generateEntityFeatures(entityType) {
        const features = {
            layer: '',
            color: 0,
            center: { x: 0, y: 0 },
            area: 0,
            perimeter: 0,
            aspectRatio: 1
        };
        
        switch (entityType) {
            case 'wall':
                features.layer = Math.random() < 0.8 ? 'WALLS' : '0';
                features.color = Math.random() < 0.7 ? 0 : 7; // Black or white
                features.area = 0.1 + Math.random() * 2;
                features.perimeter = 2 + Math.random() * 20;
                features.aspectRatio = 10 + Math.random() * 40; // Long and thin
                break;
                
            case 'entrance':
                features.layer = Math.random() < 0.6 ? 'DOOR' : 'ENTRANCE';
                features.color = 1; // Red
                features.area = 0.5 + Math.random() * 2;
                features.perimeter = 3 + Math.random() * 8;
                features.aspectRatio = 1.5 + Math.random() * 2;
                break;
                
            case 'forbidden':
                features.layer = Math.random() < 0.5 ? 'STAIRS' : 'ELEVATOR';
                features.color = 5; // Blue
                features.area = 2 + Math.random() * 10;
                features.perimeter = 8 + Math.random() * 25;
                features.aspectRatio = 0.8 + Math.random() * 1.4;
                break;
                
            case 'window':
                features.layer = 'WINDOWS';
                features.color = Math.random() < 0.5 ? 0 : 7;
                features.area = 0.5 + Math.random() * 3;
                features.perimeter = 4 + Math.random() * 12;
                features.aspectRatio = 2 + Math.random() * 4;
                break;
                
            case 'column':
                features.layer = 'COLUMNS';
                features.color = 0;
                features.area = 0.2 + Math.random() * 1;
                features.perimeter = 2 + Math.random() * 4;
                features.aspectRatio = 0.9 + Math.random() * 0.2; // Nearly square
                break;
        }
        
        features.center.x = Math.random() * 100;
        features.center.y = Math.random() * 100;
        
        return features;
    }

    /**
     * Save training data to JSON file
     */
    async saveToFile(trainingData, filepath) {
        const fs = require('fs').promises;
        await fs.writeFile(filepath, JSON.stringify(trainingData, null, 2));
        console.log(`Training data saved to ${filepath}`);
    }

    /**
     * Load training data from JSON file
     */
    async loadFromFile(filepath) {
        const fs = require('fs').promises;
        const data = await fs.readFile(filepath, 'utf8');
        return JSON.parse(data);
    }
}

module.exports = new EnhancedMLTrainingDataGenerator();
