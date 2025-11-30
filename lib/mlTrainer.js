/**
 * ML Trainer for FloorPlan Pro
 * Handles training and initialization of ML models
 */

const MLProcessor = require('./mlProcessor');
const MLTrainingDataGenerator = require('./mlTrainingDataGenerator');
const fs = require('fs').promises;
const path = require('path');

class MLTrainer {
    constructor() {
        this.mlProcessor = MLProcessor;
        this.dataGenerator = MLTrainingDataGenerator;
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
            const startedAt = Date.now();
            try {
                console.log('Initializing ML system...');

                // Try to load existing models first
                await this.mlProcessor.loadModels();

                // Check if models are loaded
                const hasModels = Object.values(this.mlProcessor.models).some(model => model !== null);

                if (hasModels) {
                    console.log('Loaded existing ML models');
                    this.mlProcessor.isInitialized = true;
                } else {
                    console.log('No existing models found, training from scratch...');
                    await this.trainFromScratch();
                }

                const duration = Date.now() - startedAt;
                console.log(`ML system initialized successfully in ${duration}ms`);
                return true;

            } catch (error) {
                console.error('ML initialization failed:', error);
                console.log('Falling back to rule-based classification');
                return false;
            }
        };

        this._initializationInFlight = runInitialization().finally(() => {
            this._initializationInFlight = null;
        });

        return this._initializationInFlight;
    }

    /**
     * Train all models from scratch with synthetic data
     */
    async trainFromScratch() {
        try {
            console.log('Training ML models from scratch...');

            // Generate training data
            const trainingData = this.dataGenerator.generateCompleteTrainingData();

            // Save training data for future use
            await this.saveTrainingData(trainingData);

            // Initialize models
            await this.mlProcessor.initialize();

            // Train models
            await this.mlProcessor.trainModels(trainingData);

            // Save trained models
            await this.mlProcessor.saveModels();

            console.log('ML training completed and models saved');

        } catch (error) {
            console.error('Training from scratch failed:', error);
            throw error;
        }
    }

    /**
     * Retrain models with additional data
     */
    async retrainWithAdditionalData(newTrainingData) {
        try {
            console.log('Retraining ML models with additional data...');

            // Load existing training data
            let existingData = await this.loadTrainingData();

            // Merge with new data
            const mergedData = this.mergeTrainingData(existingData, newTrainingData);

            // Save merged data
            await this.saveTrainingData(mergedData);

            // Retrain models
            await this.mlProcessor.trainModels(mergedData);

            // Save updated models
            await this.mlProcessor.saveModels();

            console.log('ML retraining completed');

        } catch (error) {
            console.error('Retraining failed:', error);
            throw error;
        }
    }

    /**
     * Add real-world data from processed DXF files
     */
    async addRealWorldData(cadData, userCorrections = {}) {
        try {
            console.log('Adding real-world training data...');

            const newTrainingData = {
                cadEntities: [],
                rooms: [],
                furniture: [],
                layouts: []
            };

            // Extract CAD entity data
            if (cadData.walls) {
                cadData.walls.forEach(wall => {
                    newTrainingData.cadEntities.push({
                        type: 'wall',
                        layer: wall.layer || 'WALLS',
                        color: wall.color || 0x000000,
                        area: this.calculateEntityArea(wall),
                        perimeter: this.calculateEntityPerimeter(wall),
                        aspectRatio: this.calculateAspectRatio(wall),
                        center: this.calculateEntityCenter(wall)
                    });
                });
            }

            if (cadData.entrances) {
                cadData.entrances.forEach(entrance => {
                    newTrainingData.cadEntities.push({
                        type: 'entrance',
                        layer: entrance.layer || 'DOORS',
                        color: entrance.color || 0xFF0000,
                        area: this.calculateEntityArea(entrance),
                        perimeter: this.calculateEntityPerimeter(entrance),
                        aspectRatio: this.calculateAspectRatio(entrance),
                        center: this.calculateEntityCenter(entrance)
                    });
                });
            }

            if (cadData.forbiddenZones) {
                cadData.forbiddenZones.forEach(forbidden => {
                    newTrainingData.cadEntities.push({
                        type: 'forbidden',
                        layer: forbidden.layer || 'STAIRS',
                        color: forbidden.color || 0x0000FF,
                        area: this.calculateEntityArea(forbidden),
                        perimeter: this.calculateEntityPerimeter(forbidden),
                        aspectRatio: this.calculateAspectRatio(forbidden),
                        center: this.calculateEntityCenter(forbidden)
                    });
                });
            }

            // Extract room data
            if (cadData.rooms) {
                cadData.rooms.forEach(room => {
                    newTrainingData.rooms.push({
                        type: room.type || 'office',
                        area: room.area || 0,
                        bounds: room.bounds || { minX: 0, minY: 0, maxX: 10, maxY: 10 },
                        center: room.center || { x: 5, y: 5 },
                        adjacency: room.adjacency ? Object.keys(room.adjacency).length : 2,
                        distanceToEntrance: this.calculateDistanceToEntrance(room.center, cadData.entrances)
                    });
                });
            }

            // Apply user corrections
            if (userCorrections.cadEntities) {
                userCorrections.cadEntities.forEach(correction => {
                    const entity = newTrainingData.cadEntities.find(e =>
                        e.center.x === correction.center.x && e.center.y === correction.center.y
                    );
                    if (entity) {
                        entity.type = correction.correctType;
                    }
                });
            }

            // Retrain with new data
            await this.retrainWithAdditionalData(newTrainingData);

        } catch (error) {
            console.error('Failed to add real-world data:', error);
        }
    }

    /**
     * Calculate entity area
     */
    calculateEntityArea(entity) {
        if (entity.area) return entity.area;

        if (entity.polygon && entity.polygon.length >= 3) {
            // Calculate polygon area
            let area = 0;
            const polygon = entity.polygon;
            for (let i = 0; i < polygon.length; i++) {
                const j = (i + 1) % polygon.length;
                area += polygon[i][0] * polygon[j][1];
                area -= polygon[j][0] * polygon[i][1];
            }
            return Math.abs(area / 2);
        }

        if (entity.start && entity.end) {
            // Calculate rectangle area
            const width = Math.abs(entity.end.x - entity.start.x);
            const height = Math.abs(entity.end.y - entity.start.y);
            return width * height;
        }

        return 1; // Default
    }

    /**
     * Calculate entity perimeter
     */
    calculateEntityPerimeter(entity) {
        if (entity.perimeter) return entity.perimeter;

        if (entity.polygon && entity.polygon.length >= 3) {
            // Calculate polygon perimeter
            let perimeter = 0;
            const polygon = entity.polygon;
            for (let i = 0; i < polygon.length; i++) {
                const j = (i + 1) % polygon.length;
                const dx = polygon[j][0] - polygon[i][0];
                const dy = polygon[j][1] - polygon[i][1];
                perimeter += Math.sqrt(dx * dx + dy * dy);
            }
            return perimeter;
        }

        if (entity.start && entity.end) {
            // Calculate rectangle perimeter
            const width = Math.abs(entity.end.x - entity.start.x);
            const height = Math.abs(entity.end.y - entity.start.y);
            return 2 * (width + height);
        }

        return 4; // Default
    }

    /**
     * Calculate aspect ratio
     */
    calculateAspectRatio(entity) {
        if (entity.start && entity.end) {
            const width = Math.abs(entity.end.x - entity.start.x);
            const height = Math.abs(entity.end.y - entity.start.y);
            return width / height;
        }
        return 1;
    }

    /**
     * Calculate entity center
     */
    calculateEntityCenter(entity) {
        if (entity.center) return entity.center;

        if (entity.polygon && entity.polygon.length > 0) {
            // Calculate polygon centroid
            let sumX = 0, sumY = 0;
            entity.polygon.forEach(point => {
                sumX += point[0];
                sumY += point[1];
            });
            return {
                x: sumX / entity.polygon.length,
                y: sumY / entity.polygon.length
            };
        }

        if (entity.start && entity.end) {
            return {
                x: (entity.start.x + entity.end.x) / 2,
                y: (entity.start.y + entity.end.y) / 2
            };
        }

        return { x: 0, y: 0 };
    }

    /**
     * Calculate distance to nearest entrance
     */
    calculateDistanceToEntrance(center, entrances) {
        if (!entrances || entrances.length === 0) return 10;

        let minDist = Infinity;
        entrances.forEach(entrance => {
            const entranceCenter = this.calculateEntityCenter(entrance);
            const dist = Math.sqrt(
                Math.pow(center.x - entranceCenter.x, 2) +
                Math.pow(center.y - entranceCenter.y, 2)
            );
            minDist = Math.min(minDist, dist);
        });

        return minDist;
    }

    /**
     * Merge training data
     */
    mergeTrainingData(existingData, newData) {
        return {
            cadEntities: [...(existingData.cadEntities || []), ...(newData.cadEntities || [])],
            rooms: [...(existingData.rooms || []), ...(newData.rooms || [])],
            furniture: [...(existingData.furniture || []), ...(newData.furniture || [])],
            layouts: [...(existingData.layouts || []), ...(newData.layouts || [])]
        };
    }

    /**
     * Save training data to disk
     */
    async saveTrainingData(data) {
        try {
            await fs.mkdir(path.dirname(this.trainingDataPath), { recursive: true });
            await fs.writeFile(this.trainingDataPath, JSON.stringify(data, null, 2));
            console.log('Training data saved to disk');
        } catch (error) {
            console.error('Failed to save training data:', error);
        }
    }

    /**
     * Load training data from disk
     */
    async loadTrainingData() {
        try {
            const data = await fs.readFile(this.trainingDataPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.log('No existing training data found, starting fresh');
            return {
                cadEntities: [],
                rooms: [],
                furniture: [],
                layouts: []
            };
        }
    }

    /**
     * Get training statistics
     */
    async getTrainingStats() {
        try {
            const data = await this.loadTrainingData();
            const stats = {
                cadEntities: data.cadEntities ? data.cadEntities.length : 0,
                rooms: data.rooms ? data.rooms.length : 0,
                furniture: data.furniture ? data.furniture.length : 0,
                layouts: data.layouts ? data.layouts.length : 0,
                modelsTrained: this.mlProcessor.isInitialized,
                modelsAvailable: Object.values(this.mlProcessor.models).filter(m => m !== null).length
            };
            return stats;
        } catch (error) {
            console.error('Failed to get training stats:', error);
            return null;
        }
    }

    /**
     * Reset ML system (delete models and training data)
     */
    async resetML() {
        try {
            console.log('Resetting ML system...');

            // Delete models directory
            try {
                await fs.rm(this.modelsDir, { recursive: true, force: true });
            } catch (e) { /* ignore */ }

            // Delete training data
            try {
                await fs.unlink(this.trainingDataPath);
            } catch (e) { /* ignore */ }

            // Reset processor
            this.mlProcessor.isInitialized = false;
            this.mlProcessor.models = {
                roomClassifier: null,
                furniturePlacer: null,
                layoutOptimizer: null,
                cadEntityClassifier: null
            };

            console.log('ML system reset complete');

        } catch (error) {
            console.error('Failed to reset ML system:', error);
        }
    }
}

module.exports = new MLTrainer();
