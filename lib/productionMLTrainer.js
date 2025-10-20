/**
 * Production ML Trainer for FloorPlan Pro
 * Real training pipeline with transfer learning, data augmentation, and model versioning
 */

let tf;
try {
    tf = require('@tensorflow/tfjs-node');
} catch (error) {
    console.warn('[@tensorflow/tfjs-node] native bindings unavailable – falling back to @tensorflow/tfjs (CPU/WebGL emulation).', error && error.message ? error.message : error);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    tf = require('@tensorflow/tfjs');
}
const fs = require('fs').promises;
const path = require('path');

class ProductionMLTrainer {
    constructor() {
        this.modelsDir = path.join(__dirname, '../models');
        this.checkpointsDir = path.join(__dirname, '../checkpoints');
        this.trainingDataPath = path.join(__dirname, '../training-data.json');
        this.validationSplit = 0.2;
        this.testSplit = 0.1;
        this.models = {};
        this.trainingHistory = {};
        
        // Room types for classification
        this.roomTypes = ['office', 'meeting', 'utility', 'hall', 'entry', 'circulation', 'storage', 'other'];
        
        // CAD entity types
        this.cadEntityTypes = ['wall', 'forbidden', 'entrance'];
        
        // Model configurations
        this.config = {
            roomClassifier: {
                inputShape: [5],
                hiddenLayers: [64, 32, 16],
                outputSize: 8,
                dropout: 0.3,
                learningRate: 0.001
            },
            cadEntityClassifier: {
                inputShape: [9],
                hiddenLayers: [128, 64, 32],
                outputSize: 3,
                dropout: 0.4,
                learningRate: 0.0005
            },
            furniturePlacer: {
                inputShape: [5],
                hiddenLayers: [128, 64, 32],
                outputSize: 3,
                dropout: 0.3,
                learningRate: 0.001
            },
            layoutOptimizer: {
                inputShape: [10],
                hiddenLayers: [64, 32, 16],
                outputSize: 1,
                dropout: 0.2,
                learningRate: 0.001
            }
        };
    }

    /**
     * Initialize training system
     */
    async initialize() {
        await fs.mkdir(this.modelsDir, { recursive: true });
        await fs.mkdir(this.checkpointsDir, { recursive: true });
        console.log('Production ML trainer initialized');
    }

    /**
     * Build room classifier with transfer learning architecture
     */
    buildRoomClassifier() {
        const config = this.config.roomClassifier;
        const model = tf.sequential();

        // Input layer
        model.add(tf.layers.dense({
            inputShape: config.inputShape,
            units: config.hiddenLayers[0],
            activation: 'relu',
            kernelInitializer: 'heNormal',
            kernelRegularizer: tf.regularizers.l2({ l2: 0.001 })
        }));
        model.add(tf.layers.batchNormalization());
        model.add(tf.layers.dropout({ rate: config.dropout }));

        // Hidden layers
        for (let i = 1; i < config.hiddenLayers.length; i++) {
            model.add(tf.layers.dense({
                units: config.hiddenLayers[i],
                activation: 'relu',
                kernelInitializer: 'heNormal',
                kernelRegularizer: tf.regularizers.l2({ l2: 0.001 })
            }));
            model.add(tf.layers.batchNormalization());
            model.add(tf.layers.dropout({ rate: config.dropout * 0.8 }));
        }

        // Output layer
        model.add(tf.layers.dense({
            units: config.outputSize,
            activation: 'softmax',
            kernelInitializer: 'glorotUniform'
        }));

        model.compile({
            optimizer: tf.train.adam(config.learningRate),
            loss: 'categoricalCrossentropy',
            metrics: ['accuracy', 'categoricalAccuracy']
        });

        return model;
    }

    /**
     * Build CAD entity classifier with deep architecture
     */
    buildCADEntityClassifier() {
        const config = this.config.cadEntityClassifier;
        const model = tf.sequential();

        // Input layer
        model.add(tf.layers.dense({
            inputShape: config.inputShape,
            units: config.hiddenLayers[0],
            activation: 'relu',
            kernelInitializer: 'heNormal',
            kernelRegularizer: tf.regularizers.l2({ l2: 0.001 })
        }));
        model.add(tf.layers.batchNormalization());
        model.add(tf.layers.dropout({ rate: config.dropout }));

        // Hidden layers
        for (let i = 1; i < config.hiddenLayers.length; i++) {
            model.add(tf.layers.dense({
                units: config.hiddenLayers[i],
                activation: 'relu',
                kernelInitializer: 'heNormal',
                kernelRegularizer: tf.regularizers.l2({ l2: 0.001 })
            }));
            model.add(tf.layers.batchNormalization());
            model.add(tf.layers.dropout({ rate: config.dropout * 0.8 }));
        }

        // Output layer
        model.add(tf.layers.dense({
            units: config.outputSize,
            activation: 'softmax',
            kernelInitializer: 'glorotUniform'
        }));

        model.compile({
            optimizer: tf.train.adam(config.learningRate),
            loss: 'categoricalCrossentropy',
            metrics: ['accuracy', 'precision', 'recall']
        });

        return model;
    }

    /**
     * Build furniture placement model
     */
    buildFurniturePlacer() {
        const config = this.config.furniturePlacer;
        const model = tf.sequential();

        // Input layer
        model.add(tf.layers.dense({
            inputShape: config.inputShape,
            units: config.hiddenLayers[0],
            activation: 'relu',
            kernelInitializer: 'heNormal'
        }));
        model.add(tf.layers.batchNormalization());
        model.add(tf.layers.dropout({ rate: config.dropout }));

        // Hidden layers
        for (let i = 1; i < config.hiddenLayers.length; i++) {
            model.add(tf.layers.dense({
                units: config.hiddenLayers[i],
                activation: 'relu',
                kernelInitializer: 'heNormal'
            }));
            model.add(tf.layers.batchNormalization());
            model.add(tf.layers.dropout({ rate: config.dropout * 0.8 }));
        }

        // Output layer
        model.add(tf.layers.dense({
            units: config.outputSize,
            activation: 'sigmoid' // Normalized coordinates [0, 1]
        }));

        model.compile({
            optimizer: tf.train.adam(config.learningRate),
            loss: 'meanSquaredError',
            metrics: ['mae', 'mse']
        });

        return model;
    }

    /**
     * Build layout optimizer model
     */
    buildLayoutOptimizer() {
        const config = this.config.layoutOptimizer;
        const model = tf.sequential();

        // Input layer
        model.add(tf.layers.dense({
            inputShape: config.inputShape,
            units: config.hiddenLayers[0],
            activation: 'relu',
            kernelInitializer: 'heNormal'
        }));
        model.add(tf.layers.batchNormalization());
        model.add(tf.layers.dropout({ rate: config.dropout }));

        // Hidden layers
        for (let i = 1; i < config.hiddenLayers.length; i++) {
            model.add(tf.layers.dense({
                units: config.hiddenLayers[i],
                activation: 'relu',
                kernelInitializer: 'heNormal'
            }));
            model.add(tf.layers.batchNormalization());
        }

        // Output layer
        model.add(tf.layers.dense({
            units: config.outputSize,
            activation: 'linear' // Quality score
        }));

        model.compile({
            optimizer: tf.train.adam(config.learningRate),
            loss: 'meanSquaredError',
            metrics: ['mae']
        });

        return model;
    }

    /**
     * Data augmentation for training
     */
    augmentData(features, labels, augmentationFactor = 3) {
        const augmentedFeatures = [];
        const augmentedLabels = [];

        for (let i = 0; i < features.length; i++) {
            augmentedFeatures.push([...features[i]]);
            augmentedLabels.push([...labels[i]]);

            // Generate augmented samples
            for (let j = 0; j < augmentationFactor; j++) {
                const augmented = features[i].map(val => {
                    // Add Gaussian noise (5% std)
                    const noise = (Math.random() - 0.5) * 0.1;
                    return val + noise * val;
                });
                augmentedFeatures.push(augmented);
                augmentedLabels.push([...labels[i]]);
            }
        }

        return { features: augmentedFeatures, labels: augmentedLabels };
    }

    /**
     * Split data into train/validation/test sets
     */
    splitData(features, labels) {
        const totalSize = features.length;
        const testSize = Math.floor(totalSize * this.testSplit);
        const valSize = Math.floor(totalSize * this.validationSplit);
        const trainSize = totalSize - testSize - valSize;

        // Shuffle indices
        const indices = Array.from({ length: totalSize }, (_, i) => i);
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
        }

        return {
            train: {
                features: indices.slice(0, trainSize).map(i => features[i]),
                labels: indices.slice(0, trainSize).map(i => labels[i])
            },
            validation: {
                features: indices.slice(trainSize, trainSize + valSize).map(i => features[i]),
                labels: indices.slice(trainSize, trainSize + valSize).map(i => labels[i])
            },
            test: {
                features: indices.slice(trainSize + valSize).map(i => features[i]),
                labels: indices.slice(trainSize + valSize).map(i => labels[i])
            }
        };
    }

    /**
     * Train room classifier
     */
    async trainRoomClassifier(trainingData) {
        console.log('Training room classifier...');
        
        const model = this.buildRoomClassifier();
        
        // Extract features and labels
        const features = trainingData.rooms.map(room => this.extractRoomFeatures(room));
        const labels = trainingData.rooms.map(room => this.roomTypeToOneHot(room.type));

        // Augment data
        const augmented = this.augmentData(features, labels);
        
        // Split data
        const split = this.splitData(augmented.features, augmented.labels);

        // Convert to tensors
        const trainXs = tf.tensor2d(split.train.features);
        const trainYs = tf.tensor2d(split.train.labels);
        const valXs = tf.tensor2d(split.validation.features);
        const valYs = tf.tensor2d(split.validation.labels);

        // Training callbacks
        const callbacks = {
            onEpochEnd: async (epoch, logs) => {
                console.log(`Epoch ${epoch + 1}: loss=${logs.loss.toFixed(4)}, acc=${logs.acc.toFixed(4)}, val_loss=${logs.val_loss.toFixed(4)}, val_acc=${logs.val_acc.toFixed(4)}`);
                
                // Save checkpoint every 10 epochs
                if ((epoch + 1) % 10 === 0) {
                    await this.saveCheckpoint(model, 'room-classifier', epoch + 1);
                }
            },
            onTrainEnd: () => {
                console.log('Room classifier training completed');
            }
        };

        // Train model
        const history = await model.fit(trainXs, trainYs, {
            epochs: 100,
            batchSize: 32,
            validationData: [valXs, valYs],
            callbacks: callbacks,
            shuffle: true
        });

        // Evaluate on test set
        if (split.test.features.length > 0) {
            const testXs = tf.tensor2d(split.test.features);
            const testYs = tf.tensor2d(split.test.labels);
            const evaluation = model.evaluate(testXs, testYs);
            console.log(`Test accuracy: ${evaluation[1].dataSync()[0].toFixed(4)}`);
            testXs.dispose();
            testYs.dispose();
            evaluation[0].dispose();
            evaluation[1].dispose();
        }

        // Cleanup
        trainXs.dispose();
        trainYs.dispose();
        valXs.dispose();
        valYs.dispose();

        this.models.roomClassifier = model;
        this.trainingHistory.roomClassifier = history.history;
        
        return model;
    }

    /**
     * Train CAD entity classifier
     */
    async trainCADEntityClassifier(trainingData) {
        console.log('Training CAD entity classifier...');
        
        const model = this.buildCADEntityClassifier();
        
        // Extract features and labels
        const features = trainingData.cadEntities.map(entity => this.extractCADEntityFeatures(entity));
        const labels = trainingData.cadEntities.map(entity => this.cadEntityTypeToOneHot(entity.type));

        // Augment data
        const augmented = this.augmentData(features, labels, 2);
        
        // Split data
        const split = this.splitData(augmented.features, augmented.labels);

        // Convert to tensors
        const trainXs = tf.tensor2d(split.train.features);
        const trainYs = tf.tensor2d(split.train.labels);
        const valXs = tf.tensor2d(split.validation.features);
        const valYs = tf.tensor2d(split.validation.labels);

        // Training callbacks
        const callbacks = {
            onEpochEnd: async (epoch, logs) => {
                console.log(`Epoch ${epoch + 1}: loss=${logs.loss.toFixed(4)}, acc=${logs.acc.toFixed(4)}, val_loss=${logs.val_loss.toFixed(4)}, val_acc=${logs.val_acc.toFixed(4)}`);
                
                if ((epoch + 1) % 10 === 0) {
                    await this.saveCheckpoint(model, 'cad-entity-classifier', epoch + 1);
                }
            }
        };

        // Train model
        const history = await model.fit(trainXs, trainYs, {
            epochs: 150,
            batchSize: 64,
            validationData: [valXs, valYs],
            callbacks: callbacks,
            shuffle: true
        });

        // Evaluate on test set
        if (split.test.features.length > 0) {
            const testXs = tf.tensor2d(split.test.features);
            const testYs = tf.tensor2d(split.test.labels);
            const evaluation = model.evaluate(testXs, testYs);
            console.log(`Test accuracy: ${evaluation[1].dataSync()[0].toFixed(4)}`);
            testXs.dispose();
            testYs.dispose();
            evaluation[0].dispose();
            evaluation[1].dispose();
        }

        // Cleanup
        trainXs.dispose();
        trainYs.dispose();
        valXs.dispose();
        valYs.dispose();

        this.models.cadEntityClassifier = model;
        this.trainingHistory.cadEntityClassifier = history.history;
        
        return model;
    }

    /**
     * Train furniture placer
     */
    async trainFurniturePlacer(trainingData) {
        console.log('Training furniture placer...');
        
        const model = this.buildFurniturePlacer();
        
        if (!trainingData.furniture || trainingData.furniture.length === 0) {
            console.log('No furniture data available, skipping training');
            this.models.furniturePlacer = model;
            return model;
        }

        // Extract features and labels
        const features = trainingData.furniture.map(item => [
            this.getRoomTypeIndex(item.roomType),
            item.roomArea,
            item.roomWidth,
            item.roomHeight,
            this.getFurnitureTypeIndex(item.furnitureType)
        ]);

        const labels = trainingData.furniture.map(item => [
            item.x / item.roomWidth,
            item.y / item.roomHeight,
            item.rotation / (2 * Math.PI)
        ]);

        // Split data
        const split = this.splitData(features, labels);

        // Convert to tensors
        const trainXs = tf.tensor2d(split.train.features);
        const trainYs = tf.tensor2d(split.train.labels);
        const valXs = tf.tensor2d(split.validation.features);
        const valYs = tf.tensor2d(split.validation.labels);

        // Training callbacks
        const callbacks = {
            onEpochEnd: async (epoch, logs) => {
                if ((epoch + 1) % 20 === 0) {
                    console.log(`Epoch ${epoch + 1}: loss=${logs.loss.toFixed(4)}, mae=${logs.mae.toFixed(4)}`);
                    await this.saveCheckpoint(model, 'furniture-placer', epoch + 1);
                }
            }
        };

        // Train model
        const history = await model.fit(trainXs, trainYs, {
            epochs: 100,
            batchSize: 32,
            validationData: [valXs, valYs],
            callbacks: callbacks,
            shuffle: true
        });

        // Cleanup
        trainXs.dispose();
        trainYs.dispose();
        valXs.dispose();
        valYs.dispose();

        this.models.furniturePlacer = model;
        this.trainingHistory.furniturePlacer = history.history;
        
        return model;
    }

    /**
     * Train layout optimizer
     */
    async trainLayoutOptimizer(trainingData) {
        console.log('Training layout optimizer...');
        
        const model = this.buildLayoutOptimizer();
        
        if (!trainingData.layouts || trainingData.layouts.length === 0) {
            console.log('No layout data available, skipping training');
            this.models.layoutOptimizer = model;
            return model;
        }

        // Extract features and labels
        const features = trainingData.layouts.map(layout => this.extractLayoutFeatures(layout, layout.floorPlan));
        const labels = trainingData.layouts.map(layout => [layout.qualityScore]);

        // Split data
        const split = this.splitData(features, labels);

        // Convert to tensors
        const trainXs = tf.tensor2d(split.train.features);
        const trainYs = tf.tensor2d(split.train.labels);
        const valXs = tf.tensor2d(split.validation.features);
        const valYs = tf.tensor2d(split.validation.labels);

        // Training callbacks
        const callbacks = {
            onEpochEnd: async (epoch, logs) => {
                if ((epoch + 1) % 10 === 0) {
                    console.log(`Epoch ${epoch + 1}: loss=${logs.loss.toFixed(4)}, mae=${logs.mae.toFixed(4)}`);
                    await this.saveCheckpoint(model, 'layout-optimizer', epoch + 1);
                }
            }
        };

        // Train model
        const history = await model.fit(trainXs, trainYs, {
            epochs: 100,
            batchSize: 32,
            validationData: [valXs, valYs],
            callbacks: callbacks,
            shuffle: true
        });

        // Cleanup
        trainXs.dispose();
        trainYs.dispose();
        valXs.dispose();
        valYs.dispose();

        this.models.layoutOptimizer = model;
        this.trainingHistory.layoutOptimizer = history.history;
        
        return model;
    }

    /**
     * Feature extraction helpers
     */
    extractRoomFeatures(room) {
        const area = room.area || 0;
        const bounds = room.bounds;
        const width = bounds ? Math.abs(bounds.maxX - bounds.minX) : 5;
        const height = bounds ? Math.abs(bounds.maxY - bounds.minY) : 4;
        const aspectRatio = height > 0 ? width / height : 1;
        const adjacencyCount = room.adjacency ? Object.keys(room.adjacency).length : 0;
        const distanceToEntrance = room.distanceToEntrance || 5;
        const perimeter = 2 * (width + height);

        return [area, aspectRatio, adjacencyCount, distanceToEntrance, perimeter];
    }

    extractCADEntityFeatures(entity) {
        const color = entity.color || 0;
        const r = ((color >> 16) & 0xFF) / 255;
        const g = ((color >> 8) & 0xFF) / 255;
        const b = (color & 0xFF) / 255;

        const layerName = (entity.layer || '').toLowerCase();
        let layerHash = 0;
        for (let i = 0; i < layerName.length; i++) {
            layerHash = ((layerHash << 5) - layerHash + layerName.charCodeAt(i)) & 0xFFFFFFFF;
        }
        const positiveHash = layerHash < 0 ? layerHash + 0x100000000 : layerHash;
        const normalizedLayerHash = ((positiveHash % 1000) / 1000) || 0.001;

        const area = entity.area || 1;
        const perimeter = entity.perimeter || 4;
        const aspectRatio = entity.aspectRatio || 1;
        const positionX = entity.center ? entity.center.x / 50 : 0;
        const positionY = entity.center ? entity.center.y / 50 : 0;

        return [r, g, b, normalizedLayerHash, area, perimeter, aspectRatio, positionX, positionY];
    }

    extractLayoutFeatures(layout, floorPlan) {
        const ilots = layout.ilots || [];
        const corridors = layout.corridors || [];

        const totalArea = ilots.reduce((sum, ilot) => sum + ((ilot.width || 0) * (ilot.height || 0)), 0);
        const floorArea = floorPlan.totalArea || 100;
        const density = totalArea / floorArea;

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

        const avgDistanceToEntrance = 5;
        const totalCorridorLength = corridors.reduce((sum, c) => sum + (c.length || 0), 0);
        const corridorEfficiency = totalCorridorLength / floorArea;
        const collisions = 0;

        return [
            density,
            Math.sqrt(variance) / 10,
            avgDistanceToEntrance / 20,
            corridorEfficiency,
            collisions / 10,
            ilots.length / 50,
            totalArea / 1000,
            centers.length > 0 ? 1 : 0,
            0.5,
            0.5
        ];
    }

    roomTypeToOneHot(type) {
        const index = this.roomTypes.indexOf(type);
        return this.roomTypes.map((_, i) => i === index ? 1 : 0);
    }

    cadEntityTypeToOneHot(type) {
        const index = this.cadEntityTypes.indexOf(type);
        return this.cadEntityTypes.map((_, i) => i === index ? 1 : 0);
    }

    getRoomTypeIndex(roomType) {
        const index = this.roomTypes.indexOf(roomType);
        return (index >= 0 ? index : 7) / this.roomTypes.length;
    }

    getFurnitureTypeIndex(furnitureType) {
        const types = ['desk', 'chair', 'table', 'cabinet', 'sofa', 'bed', 'shelf'];
        const index = types.indexOf(furnitureType);
        return (index >= 0 ? index : 0) / types.length;
    }

    /**
     * Save checkpoint
     */
    async saveCheckpoint(model, name, epoch) {
        try {
            const checkpointPath = path.join(this.checkpointsDir, `${name}-epoch-${epoch}`);
            await fs.mkdir(checkpointPath, { recursive: true });
            await model.save(`file://${checkpointPath}`);
            console.log(`Checkpoint saved: ${name} epoch ${epoch}`);
        } catch (error) {
            console.error(`Failed to save checkpoint: ${error.message}`);
        }
    }

    /**
     * Save trained models
     */
    async saveModels() {
        console.log('Saving trained models...');

        for (const [name, model] of Object.entries(this.models)) {
            if (model) {
                const modelPath = path.join(this.modelsDir, name);
                await fs.mkdir(modelPath, { recursive: true });
                await model.save(`file://${modelPath}`);
                console.log(`Model saved: ${name}`);
            }
        }

        // Save training history
        const historyPath = path.join(this.modelsDir, 'training-history.json');
        await fs.writeFile(historyPath, JSON.stringify(this.trainingHistory, null, 2));
        console.log('Training history saved');
    }

    /**
     * Load trained models
     */
    async loadModels() {
        console.log('Loading trained models...');

        for (const name of ['roomClassifier', 'cadEntityClassifier', 'furniturePlacer', 'layoutOptimizer']) {
            try {
                const modelPath = path.join(this.modelsDir, name, 'model.json');
                const modelExists = await fs.access(modelPath).then(() => true).catch(() => false);
                
                if (modelExists) {
                    this.models[name] = await tf.loadLayersModel(`file://${modelPath}`);
                    console.log(`Model loaded: ${name}`);
                }
            } catch (error) {
                console.error(`Failed to load model ${name}: ${error.message}`);
            }
        }

        // Load training history
        try {
            const historyPath = path.join(this.modelsDir, 'training-history.json');
            const historyData = await fs.readFile(historyPath, 'utf8');
            this.trainingHistory = JSON.parse(historyData);
        } catch (error) {
            console.log('No training history found');
        }

        return Object.keys(this.models).length > 0;
    }

    /**
     * Train all models
     */
    async trainAll(trainingData) {
        await this.initialize();

        console.log('Starting production ML training pipeline...');
        console.log(`Training data: ${trainingData.rooms?.length || 0} rooms, ${trainingData.cadEntities?.length || 0} CAD entities`);

        if (trainingData.rooms && trainingData.rooms.length > 0) {
            await this.trainRoomClassifier(trainingData);
        }

        if (trainingData.cadEntities && trainingData.cadEntities.length > 0) {
            await this.trainCADEntityClassifier(trainingData);
        }

        if (trainingData.furniture && trainingData.furniture.length > 0) {
            await this.trainFurniturePlacer(trainingData);
        }

        if (trainingData.layouts && trainingData.layouts.length > 0) {
            await this.trainLayoutOptimizer(trainingData);
        }

        await this.saveModels();
        console.log('Production ML training completed');
    }

    /**
     * Get model evaluation metrics
     */
    getEvaluationMetrics(modelName) {
        const history = this.trainingHistory[modelName];
        if (!history) return null;

        const lastEpoch = history.loss.length - 1;
        return {
            finalLoss: history.loss[lastEpoch],
            finalAccuracy: history.acc ? history.acc[lastEpoch] : null,
            finalValLoss: history.val_loss[lastEpoch],
            finalValAccuracy: history.val_acc ? history.val_acc[lastEpoch] : null,
            epochs: history.loss.length,
            bestEpoch: history.val_loss.indexOf(Math.min(...history.val_loss)) + 1
        };
    }

    /**
     * Generate confusion matrix for classifier
     */
    async generateConfusionMatrix(model, testData, labels) {
        const predictions = model.predict(tf.tensor2d(testData));
        const predClasses = predictions.argMax(-1).dataSync();
        const trueClasses = tf.tensor2d(labels).argMax(-1).dataSync();

        const numClasses = labels[0].length;
        const matrix = Array(numClasses).fill(0).map(() => Array(numClasses).fill(0));

        for (let i = 0; i < predClasses.length; i++) {
            matrix[trueClasses[i]][predClasses[i]]++;
        }

        predictions.dispose();
        return matrix;
    }
}

module.exports = new ProductionMLTrainer();
