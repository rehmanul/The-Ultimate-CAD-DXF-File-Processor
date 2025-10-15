/**
 * Machine Learning Processor for FloorPlan Pro
 * Implements ML models for room classification, furniture placement, and layout optimization
 */

const tf = require('@tensorflow/tfjs');

class MLProcessor {
    constructor() {
        this.models = {
            roomClassifier: null,
            furniturePlacer: null,
            layoutOptimizer: null,
            cadEntityClassifier: null
        };
        this.isInitialized = false;
        this.trainingData = {
            rooms: [],
            furniture: [],
            layouts: [],
            cadEntities: []
        };
    }


    /**
     * Initialize ML models - load pre-trained models or create new ones
     */
    async initialize() {
        if (this.isInitialized) return;

        try {
            console.log('Initializing ML models...');

            // Initialize room classifier model
            this.models.roomClassifier = await this.createRoomClassifier();

            // Initialize furniture placement model
            this.models.furniturePlacer = await this.createFurniturePlacer();

            // Initialize layout optimizer model
            this.models.layoutOptimizer = await this.createLayoutOptimizer();

            // Initialize CAD entity classifier model
            this.models.cadEntityClassifier = await this.createCADEntityClassifier();

            this.isInitialized = true;
            console.log('ML models initialized successfully');

        } catch (error) {
            console.error('Failed to initialize ML models:', error);
            // Fallback to rule-based methods if ML fails
            this.isInitialized = false;
        }
    }


    /**
     * Create room classification model
     * Features: area, aspect ratio, adjacency count, position relative to entrances
     */
    async createRoomClassifier() {
        const model = tf.sequential();

        // Input layer: [area, aspectRatio, adjacencyCount, distanceToEntrance, perimeter]
        model.add(tf.layers.dense({ inputShape: [5], units: 32, activation: 'relu' }));
        model.add(tf.layers.dropout({ rate: 0.2 }));
        model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
        model.add(tf.layers.dense({ units: 8, activation: 'softmax' })); // 8 room types

        model.compile({
            optimizer: tf.train.adam(0.001),
            loss: 'categoricalCrossentropy',
            metrics: ['accuracy']
        });

        return model;
    }

    /**
     * Create furniture placement model
     * Predicts optimal furniture positions based on room type and dimensions
     */
    async createFurniturePlacer() {
        const model = tf.sequential();

        // Input: [roomType, roomArea, roomWidth, roomHeight, furnitureType]
        model.add(tf.layers.dense({ inputShape: [5], units: 64, activation: 'relu' }));
        model.add(tf.layers.dropout({ rate: 0.3 }));
        model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
        model.add(tf.layers.dense({ units: 3, activation: 'sigmoid' })); // [x, y, rotation] normalized

        model.compile({
            optimizer: tf.train.adam(0.001),
            loss: 'meanSquaredError',
            metrics: ['mae']
        });

        return model;
    }

    /**
     * Create layout optimization model
     * Scores layout quality based on various factors
     */
    async createLayoutOptimizer() {
        const model = tf.sequential();

        // Input: layout features (density, distribution, accessibility, etc.)
        model.add(tf.layers.dense({ inputShape: [10], units: 32, activation: 'relu' }));
        model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
        model.add(tf.layers.dense({ units: 1, activation: 'linear' })); // Quality score

        model.compile({
            optimizer: tf.train.adam(0.001),
            loss: 'meanSquaredError',
            metrics: ['mae']
        });

        return model;
    }

    /**
     * Create CAD entity classification model
     * Classifies CAD entities as walls, forbidden zones, or entrances
     */
    async createCADEntityClassifier() {
        const model = tf.sequential();

        // Input: [colorR, colorG, colorB, layerNameHash, area, perimeter, aspectRatio, positionX, positionY]
        model.add(tf.layers.dense({ inputShape: [9], units: 64, activation: 'relu' }));
        model.add(tf.layers.dropout({ rate: 0.3 }));
        model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
        model.add(tf.layers.dense({ units: 3, activation: 'softmax' })); // 3 classes: wall, forbidden, entrance

        model.compile({
            optimizer: tf.train.adam(0.001),
            loss: 'categoricalCrossentropy',
            metrics: ['accuracy']
        });

        return model;
    }


    /**
     * Classify room type using ML model
     */
    async classifyRoom(roomData) {
        if (!this.isInitialized || !this.models.roomClassifier) {
            return this.fallbackRoomClassification(roomData);
        }

        try {
            const features = this.extractRoomFeatures(roomData);
            const input = tf.tensor2d([features], [1, 5]);

            const prediction = this.models.roomClassifier.predict(input);
            const result = prediction.dataSync();

            const roomTypes = ['office', 'meeting', 'utility', 'hall', 'entry', 'circulation', 'storage', 'other'];
            const maxIndex = result.indexOf(Math.max(...result));

            input.dispose();
            prediction.dispose();

            return {
                type: roomTypes[maxIndex],
                confidence: result[maxIndex],
                features: features
            };

        } catch (error) {
            console.error('ML room classification failed:', error);
            return this.fallbackRoomClassification(roomData);
        }
    }

    /**
     * Classify CAD entity using ML model
     */
    classifyCADEntity(entityData) {
        if (!this.isInitialized || !this.models.cadEntityClassifier) {
            return this.fallbackCADEntityClassification(entityData);
        }

        try {
            const features = this.extractCADEntityFeatures(entityData);
            const input = tf.tensor2d([features], [1, 9]);

            const prediction = this.models.cadEntityClassifier.predict(input);
            const result = prediction.dataSync();

            const entityTypes = ['wall', 'forbidden', 'entrance'];
            const maxIndex = result.indexOf(Math.max(...result));

            input.dispose();
            prediction.dispose();

            return {
                type: entityTypes[maxIndex],
                confidence: result[maxIndex],
                features: features
            };

        } catch (error) {
            console.error('ML CAD entity classification failed:', error);
            return this.fallbackCADEntityClassification(entityData);
        }
    }


    /**
     * Extract features for room classification
     */
    extractRoomFeatures(room) {
        const area = room.area || 0;
        const bounds = room.bounds || { minX: 0, minY: 0, maxX: 10, maxY: 10 };
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;
        const aspectRatio = width / height;
        const perimeter = 2 * (width + height);

        // Adjacency count (simplified)
        const adjacencyCount = room.adjacency ? Object.keys(room.adjacency).length : 0;

        // Distance to entrance (simplified)
        const distanceToEntrance = room.center ? this.calculateDistanceToEntrance(room.center) : 10;

        return [area, aspectRatio, adjacencyCount, distanceToEntrance, perimeter];
    }

    /**
     * Extract features for CAD entity classification
     */
    extractCADEntityFeatures(entity) {
        // Color features (RGB normalized to 0-1)
        const color = entity.color || 0;
        const r = ((color >> 16) & 0xFF) / 255;
        const g = ((color >> 8) & 0xFF) / 255;
        const b = (color & 0xFF) / 255;

        // Layer name hash (simple hash normalized)
        const layerName = (entity.layer || '').toLowerCase();
        let layerHash = 0;
        for (let i = 0; i < layerName.length; i++) {
            layerHash = ((layerHash << 5) - layerHash + layerName.charCodeAt(i)) & 0xFFFFFFFF;
        }
        const normalizedLayerHash = (layerHash % 1000) / 1000; // Normalize to 0-1

        // Geometric features
        const area = entity.area || 0;
        const perimeter = entity.perimeter || 0;
        const aspectRatio = entity.aspectRatio || 1;

        // Position features (normalized)
        const positionX = entity.center ? entity.center.x / 100 : 0; // Assume max 100m
        const positionY = entity.center ? entity.center.y / 100 : 0;

        return [r, g, b, normalizedLayerHash, area, perimeter, aspectRatio, positionX, positionY];
    }


    /**
     * Calculate distance to nearest entrance
     */
    calculateDistanceToEntrance(center) {
        // This would need access to floor plan entrances
        // For now, return a default value
        return 5; // meters
    }

    /**
     * Fallback rule-based room classification
     */
    fallbackRoomClassification(room) {
        const area = room.area || 0;

        if (area < 5) return { type: 'utility', confidence: 0.8 };
        if (area < 20) return { type: 'office', confidence: 0.7 };
        if (area < 50) return { type: 'meeting', confidence: 0.75 };
        return { type: 'hall', confidence: 0.6 };
    }

    /**
     * Fallback rule-based CAD entity classification
     */
    fallbackCADEntityClassification(entity) {
        const color = entity.color || 0;
        const layer = (entity.layer || '').toUpperCase();

        // Color-based classification
        if (color === 0xFF0000 || color === 1) { // Red
            return { type: 'entrance', confidence: 0.9 };
        } else if (color === 0x0000FF || color === 5) { // Blue
            return { type: 'forbidden', confidence: 0.9 };
        }

        // Layer-based classification
        if (layer.includes('ENTRANCE') || layer.includes('EXIT') || layer.includes('DOOR') ||
            layer.includes('OPENING') || layer.includes('RED')) {
            return { type: 'entrance', confidence: 0.8 };
        } else if (layer.includes('FORBIDDEN') || layer.includes('STAIR') || layer.includes('ELEVATOR') ||
            layer.includes('LIFT') || layer.includes('BLUE') || layer.includes('RESTRICT')) {
            return { type: 'forbidden', confidence: 0.8 };
        }

        // Default to wall
        return { type: 'wall', confidence: 0.7 };
    }


    /**
     * Suggest furniture placement using ML
     */
    async suggestFurniturePlacement(room, furnitureType) {
        if (!this.isInitialized || !this.models.furniturePlacer) {
            return this.fallbackFurniturePlacement(room, furnitureType);
        }

        try {
            const roomTypeIndex = this.getRoomTypeIndex(room.type);
            const features = [
                roomTypeIndex,
                room.area || 20,
                room.bounds ? (room.bounds.maxX - room.bounds.minX) : 5,
                room.bounds ? (room.bounds.maxY - room.bounds.minY) : 4,
                this.getFurnitureTypeIndex(furnitureType)
            ];

            const input = tf.tensor2d([features], [1, 5]);
            const prediction = this.models.furniturePlacer.predict(input);
            const result = prediction.dataSync();

            input.dispose();
            prediction.dispose();

            // Denormalize coordinates
            const roomWidth = room.bounds ? (room.bounds.maxX - room.bounds.minX) : 5;
            const roomHeight = room.bounds ? (room.bounds.maxY - room.bounds.minY) : 4;

            return {
                x: result[0] * roomWidth + (room.bounds ? room.bounds.minX : 0),
                y: result[1] * roomHeight + (room.bounds ? room.bounds.minY : 0),
                rotation: result[2] * 2 * Math.PI, // 0-360 degrees
                confidence: 0.8
            };

        } catch (error) {
            console.error('ML furniture placement failed:', error);
            return this.fallbackFurniturePlacement(room, furnitureType);
        }
    }

    /**
     * Get numeric index for room type
     */
    getRoomTypeIndex(roomType) {
        const types = ['office', 'meeting', 'utility', 'hall', 'entry', 'circulation', 'storage', 'other'];
        return types.indexOf(roomType) / types.length; // Normalize to 0-1
    }

    /**
     * Get numeric index for furniture type
     */
    getFurnitureTypeIndex(furnitureType) {
        const types = ['desk', 'chair', 'table', 'cabinet', 'sofa', 'bed', 'shelf'];
        return types.indexOf(furnitureType) / types.length; // Normalize to 0-1
    }

    /**
     * Fallback rule-based furniture placement
     */
    fallbackFurniturePlacement(room, furnitureType) {
        const bounds = room.bounds || { minX: 0, minY: 0, maxX: 5, maxY: 4 };
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;

        // Simple placement rules
        switch (furnitureType) {
            case 'desk':
                return { x: bounds.minX + 1, y: bounds.minY + 1, rotation: 0, confidence: 0.6 };
            case 'chair':
                return { x: centerX, y: centerY, rotation: Math.PI/2, confidence: 0.7 };
            case 'table':
                return { x: centerX, y: centerY, rotation: 0, confidence: 0.8 };
            default:
                return { x: centerX, y: centerY, rotation: 0, confidence: 0.5 };
        }
    }

    /**
     * Score layout quality using ML model
     */
    async scoreLayout(layout, floorPlan) {
        if (!this.isInitialized || !this.models.layoutOptimizer) {
            return this.fallbackLayoutScoring(layout, floorPlan);
        }

        try {
            const features = this.extractLayoutFeatures(layout, floorPlan);
            const input = tf.tensor2d([features], [1, 10]);

            const prediction = this.models.layoutOptimizer.predict(input);
            const result = prediction.dataSync();

            input.dispose();
            prediction.dispose();

            return result[0]; // Quality score 0-1

        } catch (error) {
            console.error('ML layout scoring failed:', error);
            return this.fallbackLayoutScoring(layout, floorPlan);
        }
    }

    /**
     * Extract layout features for scoring
     */
    extractLayoutFeatures(layout, floorPlan) {
        const ilots = layout.ilots || [];
        const corridors = layout.corridors || [];

        // Basic density
        const totalArea = ilots.reduce((sum, ilot) => sum + (ilot.area || 0), 0);
        const floorArea = floorPlan.totalArea || 100;
        const density = totalArea / floorArea;

        // Distribution evenness (variance of positions)
        const centers = ilots.map(ilot => ({
            x: ilot.x + (ilot.width || 1) / 2,
            y: ilot.y + (ilot.height || 1) / 2
        }));

        let meanX = 0, meanY = 0;
        centers.forEach(c => { meanX += c.x; meanY += c.y; });
        meanX /= centers.length || 1;
        meanY /= centers.length || 1;

        const variance = centers.reduce((sum, c) =>
            sum + Math.pow(c.x - meanX, 2) + Math.pow(c.y - meanY, 2), 0) / (centers.length || 1);

        // Accessibility (distance to entrances)
        const entrances = floorPlan.entrances || [];
        let avgDistanceToEntrance = 0;
        if (entrances.length > 0) {
            ilots.forEach(ilot => {
                const center = { x: ilot.x + (ilot.width || 1) / 2, y: ilot.y + (ilot.height || 1) / 2 };
                let minDist = Infinity;
                entrances.forEach(entrance => {
                    const dist = Math.sqrt(Math.pow(center.x - entrance.x, 2) + Math.pow(center.y - entrance.y, 2));
                    minDist = Math.min(minDist, dist);
                });
                avgDistanceToEntrance += minDist;
            });
            avgDistanceToEntrance /= ilots.length || 1;
        }

        // Corridor efficiency
        const totalCorridorLength = corridors.reduce((sum, c) => sum + (c.length || 0), 0);
        const corridorEfficiency = totalCorridorLength / (floorArea || 1);

        // Collision penalty
        const collisions = this.countCollisions(ilots, floorPlan);

        return [
            density,
            Math.sqrt(variance) / 10, // Normalized variance
            avgDistanceToEntrance / 20, // Normalized distance
            corridorEfficiency,
            collisions / 10, // Normalized collisions
            ilots.length / 50, // Normalized count
            totalArea / 1000, // Normalized area
            centers.length > 0 ? 1 : 0, // Has ilots
            entrances.length / 10, // Entrance count
            floorPlan.rooms ? floorPlan.rooms.length / 20 : 0 // Room count
        ];
    }

    /**
     * Count collisions in layout
     */
    countCollisions(ilots, floorPlan) {
        let collisions = 0;

        // Ilot-ilot collisions
        for (let i = 0; i < ilots.length; i++) {
            for (let j = i + 1; j < ilots.length; j++) {
                if (this.ilotsOverlap(ilots[i], ilots[j])) {
                    collisions++;
                }
            }
        }

        // Ilot-wall collisions
        ilots.forEach(ilot => {
            (floorPlan.walls || []).forEach(wall => {
                if (this.ilotIntersectsWall(ilot, wall)) {
                    collisions++;
                }
            });
        });

        return collisions;
    }

    /**
     * Check if two ilots overlap
     */
    ilotsOverlap(ilot1, ilot2) {
        return !(ilot1.x + (ilot1.width || 1) < ilot2.x ||
                ilot2.x + (ilot2.width || 1) < ilot1.x ||
                ilot1.y + (ilot1.height || 1) < ilot2.y ||
                ilot2.y + (ilot2.height || 1) < ilot1.y);
    }

    /**
     * Check if ilot intersects wall
     */
    ilotIntersectsWall(ilot, wall) {
        const ilotCenter = { x: ilot.x + (ilot.width || 1) / 2, y: ilot.y + (ilot.height || 1) / 2 };
        const wallCenter = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
        const distance = Math.sqrt(Math.pow(ilotCenter.x - wallCenter.x, 2) + Math.pow(ilotCenter.y - wallCenter.y, 2));
        return distance < 1.5; // 1.5m buffer
    }

    /**
     * Fallback rule-based layout scoring
     */
    fallbackLayoutScoring(layout, floorPlan) {
        const ilots = layout.ilots || [];
        let score = 0;

        // Density score
        const totalArea = ilots.reduce((sum, ilot) => sum + (ilot.area || 0), 0);
        const floorArea = floorPlan.totalArea || 100;
        const density = totalArea / floorArea;
        score += Math.min(density * 2, 1) * 0.3; // 30% weight

        // Distribution score
        if (ilots.length > 1) {
            const centers = ilots.map(ilot => ({
                x: ilot.x + (ilot.width || 1) / 2,
                y: ilot.y + (ilot.height || 1) / 2
            }));
            const meanX = centers.reduce((sum, c) => sum + c.x, 0) / centers.length;
            const meanY = centers.reduce((sum, c) => sum + c.y, 0) / centers.length;
            const variance = centers.reduce((sum, c) =>
                sum + Math.pow(c.x - meanX, 2) + Math.pow(c.y - meanY, 2), 0) / centers.length;
            score += Math.max(0, 1 - variance / 100) * 0.4; // 40% weight
        }

        // Collision penalty
        const collisions = this.countCollisions(ilots, floorPlan);
        score += Math.max(0, 1 - collisions / 5) * 0.3; // 30% weight

        return score;
    }

    /**
     * Train models with collected data
     */
    async trainModels(trainingData) {
        if (!trainingData || !this.isInitialized) return;

        try {
            console.log('Training ML models with collected data...');

            // Train room classifier
            if (trainingData.rooms && trainingData.rooms.length > 0) {
                await this.trainRoomClassifier(trainingData.rooms);
            }

            // Train furniture placer
            if (trainingData.furniture && trainingData.furniture.length > 0) {
                await this.trainFurniturePlacer(trainingData.furniture);
            }

            // Train layout optimizer
            if (trainingData.layouts && trainingData.layouts.length > 0) {
                await this.trainLayoutOptimizer(trainingData.layouts);
            }

            // Train CAD entity classifier
            if (trainingData.cadEntities && trainingData.cadEntities.length > 0) {
                await this.trainCADEntityClassifier(trainingData.cadEntities);
            }

            console.log('ML model training completed');

        } catch (error) {
            console.error('ML training failed:', error);
        }
    }


    /**
     * Train room classifier
     */
    async trainRoomClassifier(roomData) {
        const features = roomData.map(room => this.extractRoomFeatures(room));
        const labels = roomData.map(room => this.roomTypeToOneHot(room.type));

        const xs = tf.tensor2d(features);
        const ys = tf.tensor2d(labels);

        await this.models.roomClassifier.fit(xs, ys, {
            epochs: 50,
            batchSize: 32,
            validationSplit: 0.2,
            callbacks: {
                onEpochEnd: (epoch, logs) => {
                    if (epoch % 10 === 0) console.log(`Room classifier epoch ${epoch}: loss=${logs.loss.toFixed(4)}`);
                }
            }
        });

        xs.dispose();
        ys.dispose();
    }

    /**
     * Convert room type to one-hot encoding
     */
    roomTypeToOneHot(type) {
        const types = ['office', 'meeting', 'utility', 'hall', 'entry', 'circulation', 'storage', 'other'];
        const index = types.indexOf(type);
        return types.map((_, i) => i === index ? 1 : 0);
    }

    /**
     * Train furniture placer
     */
    async trainFurniturePlacer(furnitureData) {
        const features = furnitureData.map(item => [
            this.getRoomTypeIndex(item.roomType),
            item.roomArea,
            item.roomWidth,
            item.roomHeight,
            this.getFurnitureTypeIndex(item.furnitureType)
        ]);

        const labels = furnitureData.map(item => [
            item.x / item.roomWidth, // Normalized x
            item.y / item.roomHeight, // Normalized y
            item.rotation / (2 * Math.PI) // Normalized rotation
        ]);

        const xs = tf.tensor2d(features);
        const ys = tf.tensor2d(labels);

        await this.models.furniturePlacer.fit(xs, ys, {
            epochs: 100,
            batchSize: 32,
            validationSplit: 0.2,
            callbacks: {
                onEpochEnd: (epoch, logs) => {
                    if (epoch % 20 === 0) console.log(`Furniture placer epoch ${epoch}: loss=${logs.loss.toFixed(4)}`);
                }
            }
        });

        xs.dispose();
        ys.dispose();
    }

    /**
     * Train layout optimizer
     */
    async trainLayoutOptimizer(layoutData) {
        const features = layoutData.map(layout => this.extractLayoutFeatures(layout, layout.floorPlan));
        const labels = layoutData.map(layout => [layout.qualityScore]);

        const xs = tf.tensor2d(features);
        const ys = tf.tensor2d(labels);

        await this.models.layoutOptimizer.fit(xs, ys, {
            epochs: 50,
            batchSize: 32,
            validationSplit: 0.2,
            callbacks: {
                onEpochEnd: (epoch, logs) => {
                    if (epoch % 10 === 0) console.log(`Layout optimizer epoch ${epoch}: loss=${logs.loss.toFixed(4)}`);
                }
            }
        });

        xs.dispose();
        ys.dispose();
    }

    /**
     * Train CAD entity classifier
     */
    async trainCADEntityClassifier(cadEntityData) {
        const features = cadEntityData.map(entity => this.extractCADEntityFeatures(entity));
        const labels = cadEntityData.map(entity => this.cadEntityTypeToOneHot(entity.type));

        const xs = tf.tensor2d(features);
        const ys = tf.tensor2d(labels);

        await this.models.cadEntityClassifier.fit(xs, ys, {
            epochs: 100,
            batchSize: 32,
            validationSplit: 0.2,
            callbacks: {
                onEpochEnd: (epoch, logs) => {
                    if (epoch % 20 === 0) console.log(`CAD entity classifier epoch ${epoch}: loss=${logs.loss.toFixed(4)}`);
                }
            }
        });

        xs.dispose();
        ys.dispose();
    }

    /**
     * Convert CAD entity type to one-hot encoding
     */
    cadEntityTypeToOneHot(type) {
        const types = ['wall', 'forbidden', 'entrance'];
        const index = types.indexOf(type);
        return types.map((_, i) => i === index ? 1 : 0);
    }


    /**
     * Save models to disk
     */
    async saveModels() {
        if (!this.isInitialized) return;

        try {
            const fs = require('fs').promises;
            const path = require('path');

            const modelDir = path.join(__dirname, '../models');
            await fs.mkdir(modelDir, { recursive: true });

            if (this.models.roomClassifier) {
                await this.models.roomClassifier.save(`file://${modelDir}/room-classifier`);
            }

            if (this.models.furniturePlacer) {
                await this.models.furniturePlacer.save(`file://${modelDir}/furniture-placer`);
            }

            if (this.models.layoutOptimizer) {
                await this.models.layoutOptimizer.save(`file://${modelDir}/layout-optimizer`);
            }

            if (this.models.cadEntityClassifier) {
                await this.models.cadEntityClassifier.save(`file://${modelDir}/cad-entity-classifier`);
            }

            console.log('ML models saved to disk');

        } catch (error) {
            console.error('Failed to save ML models:', error);
        }
    }


    /**
     * Load models from disk
     */
    async loadModels() {
        try {
            const path = require('path');
            const modelDir = path.join(__dirname, '../models');

            // Check if models exist
            const fs = require('fs');
            const roomModelPath = path.join(modelDir, 'room-classifier');
            const furnitureModelPath = path.join(modelDir, 'furniture-placer');
            const layoutModelPath = path.join(modelDir, 'layout-optimizer');
            const cadEntityModelPath = path.join(modelDir, 'cad-entity-classifier');

            if (fs.existsSync(roomModelPath)) {
                this.models.roomClassifier = await tf.loadLayersModel(`file://${roomModelPath}/model.json`);
                console.log('Room classifier model loaded');
            }

            if (fs.existsSync(furnitureModelPath)) {
                this.models.furniturePlacer = await tf.loadLayersModel(`file://${furnitureModelPath}/model.json`);
                console.log('Furniture placer model loaded');
            }

            if (fs.existsSync(layoutModelPath)) {
                this.models.layoutOptimizer = await tf.loadLayersModel(`file://${layoutModelPath}/model.json`);
                console.log('Layout optimizer model loaded');
            }

            if (fs.existsSync(cadEntityModelPath)) {
                this.models.cadEntityClassifier = await tf.loadLayersModel(`file://${cadEntityModelPath}/model.json`);
                console.log('CAD entity classifier model loaded');
            }

        } catch (error) {
            console.error('Failed to load ML models:', error);
        }
    }

}

module.exports = new MLProcessor();
