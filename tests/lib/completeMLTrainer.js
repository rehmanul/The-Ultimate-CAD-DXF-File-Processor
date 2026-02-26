/**
 * Complete ML Trainer for FloorPlan Pro
 * Handles training, initialization, and persistence of ML models
 */

const MLProcessor = require('./mlProcessor');
const EnhancedMLTrainingDataGenerator = require('./enhancedMLTrainingDataGenerator');
const fs = require('fs').promises;
const path = require('path');

class CompleteMLTrainer {
    constructor() {
        this.mlProcessor = MLProcessor;
        this.dataGenerator = EnhancedMLTrainingDataGenerator;
        this.modelsDir = path.join(__dirname, '../models');
        this.trainingDataPath = path.join(__dirname, '../training-data.json');
        this._initializationInFlight = null;
    }

    /**
     * Initialize ML system - load models or train from scratch
     */
    async initializeML() {
        if (this._initializationInFlight) {
            return this._initializationInFlight;
        }

        const runInitialization = async () => {
            try {
                console.log('[ML Trainer] Initializing ML system...');

                // Initialize ML processor first
                await this.mlProcessor.initialize();

                // Try to load existing models
                const loaded = await this.loadModels();

                if (loaded) {
                    console.log('[ML Trainer] Loaded existing models successfully');
                    this.mlProcessor.isInitialized = true;
                    return true;
                }

                // No models found - train from scratch with small dataset
                console.log('[ML Trainer] No existing models, training with synthetic data...');
                await this.quickTrain();

                return true;

            } catch (error) {
                console.error('[ML Trainer] Initialization failed:', error.message);
                console.log('[ML Trainer] Falling back to rule-based classification');
                return false;
            }
        };

        this._initializationInFlight = runInitialization().finally(() => {
            this._initializationInFlight = null;
        });

        return this._initializationInFlight;
    }

    /**
     * Quick training with small dataset for development
     */
    async quickTrain(samples = 100) {
        try {
            console.log(`[ML Trainer] Quick training with ${samples} samples...`);

            // Generate small training dataset
            const trainingData = this.dataGenerator.generateCompleteTrainingData(samples);

            // Train room classifier only (fastest)
            if (this.mlProcessor.models.roomClassifier) {
                await this.trainRoomClassifier(trainingData.rooms);
                console.log('[ML Trainer] Room classifier trained');
            }

            // Save training data for reference
            await this.saveTrainingData(trainingData);

            // Save models
            await this.saveModels();

            console.log('[ML Trainer] Quick training completed');
            this.mlProcessor.isInitialized = true;

        } catch (error) {
            console.error('[ML Trainer] Quick training failed:', error.message);
            throw error;
        }
    }

    /**
     * Full training with large dataset
     */
    async fullTrain(samples = 1000) {
        try {
            console.log(`[ML Trainer] Full training with ${samples} samples...`);

            // Generate complete training dataset
            const trainingData = this.dataGenerator.generateCompleteTrainingData(samples);

            // Save training data
            await this.saveTrainingData(trainingData);

            // Train all models
            await this.trainAllModels(trainingData);

            // Save trained models
            await this.saveModels();

            console.log('[ML Trainer] Full training completed');
            this.mlProcessor.isInitialized = true;

        } catch (error) {
            console.error('[ML Trainer] Full training failed:', error.message);
            throw error;
        }
    }

    /**
     * Train room classifier model
     */
    async trainRoomClassifier(roomData) {
        if (!this.mlProcessor.models.roomClassifier) {
            console.warn('[ML Trainer] Room classifier model not initialized');
            return;
        }

        const tf = require('@tensorflow/tfjs');

        // Prepare training data
        const features = roomData.map(d => d.features);
        const labels = roomData.map(d => d.label);

        // Convert to tensors
        const xs = tf.tensor2d(features);
        const ys = tf.oneHot(tf.tensor1d(labels, 'int32'), 8); // 8 room types

        // Train model
        await this.mlProcessor.models.roomClassifier.fit(xs, ys, {
            epochs: 20,
            batchSize: 32,
            validationSplit: 0.2,
            callbacks: {
                onEpochEnd: (epoch, logs) => {
                    if (epoch % 5 === 0) {
                        console.log(`  Epoch ${epoch + 1}: loss = ${logs.loss.toFixed(4)}, accuracy = ${logs.acc.toFixed(4)}`);
                    }
                }
            }
        });

        // Cleanup tensors
        xs.dispose();
        ys.dispose();
    }

    /**
     * Train all models
     */
    async trainAllModels(trainingData) {
        // Train room classifier
        if (trainingData.rooms && trainingData.rooms.length > 0) {
            console.log('[ML Trainer] Training room classifier...');
            await this.trainRoomClassifier(trainingData.rooms);
        }

        // Train furniture placer (optional - more complex)
        if (trainingData.furniture && trainingData.furniture.length > 0 && this.mlProcessor.models.furniturePlacer) {
            console.log('[ML Trainer] Training furniture placer...');
            await this.trainFurniturePlacer(trainingData.furniture);
        }

        // CAD entity classifier training would go here
        // Layout optimizer training would go here
    }

    /**
     * Train furniture placer model
     */
    async trainFurniturePlacer(furnitureData) {
        if (!this.mlProcessor.models.furniturePlacer) return;

        const tf = require('@tensorflow/tfjs');

        const features = furnitureData.map(d => d.features);
        const labels = furnitureData.map(d => d.label);

        const xs = tf.tensor2d(features);
        const ys = tf.tensor2d(labels);

        await this.mlProcessor.models.furniturePlacer.fit(xs, ys, {
            epochs: 30,
            batchSize: 32,
            validationSplit: 0.2,
            callbacks: {
                onEpochEnd: (epoch, logs) => {
                    if (epoch % 10 === 0) {
                        console.log(`  Epoch ${epoch + 1}: loss = ${logs.loss.toFixed(4)}`);
                    }
                }
            }
        });

        xs.dispose();
        ys.dispose();
    }

    /**
     * Save trained models to disk
     */
    async saveModels() {
        try {
            // Ensure models directory exists
            await fs.mkdir(this.modelsDir, { recursive: true });

            // Save each model
            for (const [name, model] of Object.entries(this.mlProcessor.models)) {
                if (model) {
                    const modelPath = `file://${path.join(this.modelsDir, name)}`;
                    await model.save(modelPath);
                    console.log(`[ML Trainer] Saved ${name} model`);
                }
            }
        } catch (error) {
            console.error('[ML Trainer] Failed to save models:', error.message);
        }
    }

    /**
     * Load trained models from disk
     */
    async loadModels() {
        try {
            const tf = require('@tensorflow/tfjs');

            // Check if models directory exists
            try {
                await fs.access(this.modelsDir);
            } catch {
                console.log('[ML Trainer] Models directory not found');
                return false;
            }

            let loadedAny = false;

            // Load each model
            for (const name of Object.keys(this.mlProcessor.models)) {
                const modelPath = `file://${path.join(this.modelsDir, name, 'model.json')}`;
                
                try {
                    await fs.access(path.join(this.modelsDir, name, 'model.json'));
                    this.mlProcessor.models[name] = await tf.loadLayersModel(modelPath);
                    console.log(`[ML Trainer] Loaded ${name} model`);
                    loadedAny = true;
                } catch {
                    console.log(`[ML Trainer] ${name} model not found`);
                }
            }

            return loadedAny;

        } catch (error) {
            console.error('[ML Trainer] Failed to load models:', error.message);
            return false;
        }
    }

    /**
     * Save training data to JSON
     */
    async saveTrainingData(trainingData) {
        try {
            await fs.writeFile(
                this.trainingDataPath,
                JSON.stringify(trainingData, null, 2)
            );
            console.log(`[ML Trainer] Training data saved (${Object.keys(trainingData).length} categories)`);
        } catch (error) {
            console.error('[ML Trainer] Failed to save training data:', error.message);
        }
    }

    /**
     * Load training data from JSON
     */
    async loadTrainingData() {
        try {
            const data = await fs.readFile(this.trainingDataPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.log('[ML Trainer] No existing training data found');
            return null;
        }
    }

    /**
     * Add real-world data from CAD files
     */
    async addRealWorldData(cadData, corrections = {}) {
        try {
            console.log('[ML Trainer] Adding real-world training data...');

            // Load existing training data
            let existingData = await this.loadTrainingData();
            if (!existingData) {
                existingData = this.dataGenerator.generateCompleteTrainingData(100);
            }

            // Extract features from CAD data and add to training set
            if (cadData.rooms && corrections.rooms) {
                cadData.rooms.forEach((room, index) => {
                    if (corrections.rooms[index]) {
                        const features = this.extractRoomFeatures(room);
                        const label = this.roomTypeToIndex(corrections.rooms[index].type);
                        existingData.rooms.push({ features, label });
                    }
                });
            }

            // Save updated training data
            await this.saveTrainingData(existingData);

            console.log('[ML Trainer] Real-world data added to training set');

        } catch (error) {
            console.error('[ML Trainer] Failed to add real-world data:', error.message);
        }
    }

    /**
     * Extract room features for ML
     */
    extractRoomFeatures(room) {
        return [
            room.area || 0,
            room.aspectRatio || 1,
            room.adjacencyCount || 0,
            room.distanceToEntrance || 0,
            room.perimeter || 0
        ];
    }

    /**
     * Convert room type string to index
     */
    roomTypeToIndex(roomType) {
        const types = ['office', 'meeting_room', 'conference_room', 'reception',
                       'cafeteria', 'restroom', 'storage', 'server_room'];
        return types.indexOf(roomType.toLowerCase()) || 0;
    }

    /**
     * Evaluate model performance
     */
    async evaluateModels(testData) {
        console.log('[ML Trainer] Evaluating model performance...');

        const results = {};

        // Evaluate room classifier
        if (this.mlProcessor.models.roomClassifier && testData.rooms) {
            const accuracy = await this.evaluateRoomClassifier(testData.rooms);
            results.roomClassifier = { accuracy };
            console.log(`  Room Classifier Accuracy: ${(accuracy * 100).toFixed(2)}%`);
        }

        return results;
    }

    /**
     * Evaluate room classifier accuracy
     */
    async evaluateRoomClassifier(testRooms) {
        const tf = require('@tensorflow/tfjs');

        const features = testRooms.map(d => d.features);
        const labels = testRooms.map(d => d.label);

        const xs = tf.tensor2d(features);
        const ys = tf.oneHot(tf.tensor1d(labels, 'int32'), 8);

        const predictions = this.mlProcessor.models.roomClassifier.predict(xs);
        const predictedLabels = predictions.argMax(-1);
        const actualLabels = tf.tensor1d(labels, 'int32');

        const correct = predictedLabels.equal(actualLabels).sum();
        const total = labels.length;
        const accuracy = await correct.data() / total;

        // Cleanup
        xs.dispose();
        ys.dispose();
        predictions.dispose();
        predictedLabels.dispose();
        actualLabels.dispose();
        correct.dispose();

        return accuracy;
    }
}

module.exports = new CompleteMLTrainer();
