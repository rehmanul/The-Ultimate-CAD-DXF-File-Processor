/**
 * ML Training and Optimization Routes for FloorPlan Pro
 */

const express = require('express');
const router = express.Router();
const ProductionMLTrainer = require('./productionMLTrainer');
const ProductionDataGenerator = require('./productionDataGenerator');
const GeneticOptimizer = require('./geneticOptimizer');
const fs = require('fs').promises;
const path = require('path');

// Training status tracking
let trainingStatus = {
    isTraining: false,
    progress: 0,
    currentModel: null,
    error: null
};

// Optimization status tracking
let optimizationStatus = {
    isOptimizing: false,
    progress: 0,
    generation: 0,
    bestFitness: 0,
    error: null
};

/**
 * Generate training dataset
 */
router.post('/generate-dataset', async (req, res) => {
    try {
        const { cadEntities, rooms, furniture, layouts } = req.body;

        const dataset = ProductionDataGenerator.generateCompleteDataset({
            cadEntities: cadEntities || 5000,
            rooms: rooms || 2000,
            furniture: furniture || 1000,
            layouts: layouts || 500
        });

        // Save dataset
        const datasetPath = path.join(__dirname, '../training-data.json');
        await ProductionDataGenerator.saveDataset(dataset, datasetPath);

        res.json({
            success: true,
            message: 'Training dataset generated successfully',
            dataset: {
                cadEntities: dataset.cadEntities.length,
                rooms: dataset.rooms.length,
                furniture: dataset.furniture.length,
                layouts: dataset.layouts.length
            },
            path: datasetPath
        });
    } catch (error) {
        console.error('Dataset generation error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Start ML training
 */
router.post('/train', async (req, res) => {
    try {
        if (trainingStatus.isTraining) {
            return res.status(400).json({
                success: false,
                error: 'Training already in progress'
            });
        }

        trainingStatus = {
            isTraining: true,
            progress: 0,
            currentModel: 'Initializing',
            error: null
        };

        // Load or generate training data
        let trainingData;
        const datasetPath = path.join(__dirname, '../training-data.json');
        
        try {
            trainingData = await ProductionDataGenerator.loadDataset(datasetPath);
        } catch (error) {
            console.log('No existing dataset found, generating new one...');
            trainingData = ProductionDataGenerator.generateCompleteDataset();
            await ProductionDataGenerator.saveDataset(trainingData, datasetPath);
        }

        // Start training in background
        (async () => {
            try {
                await ProductionMLTrainer.trainAll(trainingData);
                trainingStatus = {
                    isTraining: false,
                    progress: 100,
                    currentModel: 'Complete',
                    error: null
                };
            } catch (error) {
                console.error('Training error:', error);
                trainingStatus = {
                    isTraining: false,
                    progress: 0,
                    currentModel: null,
                    error: error.message
                };
            }
        })();

        res.json({
            success: true,
            message: 'Training started',
            datasetSize: {
                cadEntities: trainingData.cadEntities.length,
                rooms: trainingData.rooms.length,
                furniture: trainingData.furniture.length,
                layouts: trainingData.layouts.length
            }
        });
    } catch (error) {
        console.error('Training start error:', error);
        trainingStatus.isTraining = false;
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get training status
 */
router.get('/training-status', (req, res) => {
    res.json(trainingStatus);
});

/**
 * Load trained models
 */
router.post('/load-models', async (req, res) => {
    try {
        const success = await ProductionMLTrainer.loadModels();
        
        res.json({
            success: success,
            message: success ? 'Models loaded successfully' : 'No trained models found',
            models: Object.keys(ProductionMLTrainer.models).filter(k => ProductionMLTrainer.models[k] !== null)
        });
    } catch (error) {
        console.error('Model loading error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get training statistics
 */
router.get('/training-stats', (req, res) => {
    try {
        const stats = {};
        
        for (const [name, model] of Object.entries(ProductionMLTrainer.models)) {
            if (model) {
                stats[name] = ProductionMLTrainer.getEvaluationMetrics(name);
            }
        }

        res.json({
            success: true,
            stats: stats,
            trainingHistory: ProductionMLTrainer.trainingHistory
        });
    } catch (error) {
        console.error('Stats retrieval error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Extract training data from DXF result
 */
router.post('/extract-training-data', async (req, res) => {
    try {
        const { dxfResult } = req.body;

        if (!dxfResult) {
            return res.status(400).json({
                success: false,
                error: 'DXF result required'
            });
        }

        const trainingData = ProductionDataGenerator.extractFromDXFResult(dxfResult);

        // Append to existing dataset
        const datasetPath = path.join(__dirname, '../training-data.json');
        let existingData;
        
        try {
            existingData = await ProductionDataGenerator.loadDataset(datasetPath);
        } catch (error) {
            existingData = { cadEntities: [], rooms: [], furniture: [], layouts: [] };
        }

        existingData.cadEntities.push(...trainingData.cadEntities);
        existingData.rooms.push(...trainingData.rooms);
        
        await ProductionDataGenerator.saveDataset(existingData, datasetPath);

        res.json({
            success: true,
            message: 'Training data extracted and saved',
            extracted: {
                cadEntities: trainingData.cadEntities.length,
                rooms: trainingData.rooms.length
            },
            totalDataset: {
                cadEntities: existingData.cadEntities.length,
                rooms: existingData.rooms.length,
                furniture: existingData.furniture.length,
                layouts: existingData.layouts.length
            }
        });
    } catch (error) {
        console.error('Training data extraction error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Run genetic optimization
 */
router.post('/optimize', async (req, res) => {
    try {
        if (optimizationStatus.isOptimizing) {
            return res.status(400).json({
                success: false,
                error: 'Optimization already in progress'
            });
        }

        const { floorPlan, distributionConfig, options } = req.body;

        if (!floorPlan || !distributionConfig) {
            return res.status(400).json({
                success: false,
                error: 'Floor plan and distribution config required'
            });
        }

        optimizationStatus = {
            isOptimizing: true,
            progress: 0,
            generation: 0,
            bestFitness: 0,
            error: null
        };

        // Start optimization in background
        const optimizer = new GeneticOptimizer(options);
        
        (async () => {
            try {
                await optimizer.initialize(floorPlan, distributionConfig);
                
                const result = await optimizer.optimize((progress) => {
                    optimizationStatus = {
                        isOptimizing: true,
                        progress: (progress.generation / progress.totalGenerations) * 100,
                        generation: progress.generation,
                        bestFitness: progress.bestFitness,
                        error: null
                    };
                });

                optimizationStatus = {
                    isOptimizing: false,
                    progress: 100,
                    generation: result.generation,
                    bestFitness: result.fitness.total,
                    error: null,
                    result: result
                };
            } catch (error) {
                console.error('Optimization error:', error);
                optimizationStatus = {
                    isOptimizing: false,
                    progress: 0,
                    generation: 0,
                    bestFitness: 0,
                    error: error.message
                };
            } finally {
                await optimizer.cleanup();
            }
        })();

        res.json({
            success: true,
            message: 'Genetic optimization started',
            config: {
                populationSize: optimizer.config.populationSize,
                generations: optimizer.config.generations
            }
        });
    } catch (error) {
        console.error('Optimization start error:', error);
        optimizationStatus.isOptimizing = false;
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get optimization status
 */
router.get('/optimization-status', (req, res) => {
    res.json(optimizationStatus);
});

/**
 * Get optimization result
 */
router.get('/optimization-result', (req, res) => {
    if (!optimizationStatus.result) {
        return res.status(404).json({
            success: false,
            error: 'No optimization result available'
        });
    }

    res.json({
        success: true,
        result: {
            ilots: optimizationStatus.result.ilots,
            fitness: optimizationStatus.result.fitness,
            generation: optimizationStatus.result.generation
        }
    });
});

/**
 * Reset ML system
 */
router.post('/reset', async (req, res) => {
    try {
        if (trainingStatus.isTraining) {
            return res.status(400).json({
                success: false,
                error: 'Cannot reset while training is in progress'
            });
        }

        // Clear models
        ProductionMLTrainer.models = {};
        ProductionMLTrainer.trainingHistory = {};

        // Delete model files
        const modelsDir = path.join(__dirname, '../models');
        try {
            await fs.rm(modelsDir, { recursive: true, force: true });
        } catch (error) {
            console.log('No models directory to delete');
        }

        // Delete training data
        const datasetPath = path.join(__dirname, '../training-data.json');
        try {
            await fs.unlink(datasetPath);
        } catch (error) {
            console.log('No training data to delete');
        }

        trainingStatus = {
            isTraining: false,
            progress: 0,
            currentModel: null,
            error: null
        };

        res.json({
            success: true,
            message: 'ML system reset successfully'
        });
    } catch (error) {
        console.error('Reset error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Health check
 */
router.get('/health', async (req, res) => {
    try {
        const hasModels = Object.values(ProductionMLTrainer.models).some(m => m !== null);
        
        let datasetSize = 0;
        try {
            const datasetPath = path.join(__dirname, '../training-data.json');
            const data = await ProductionDataGenerator.loadDataset(datasetPath);
            datasetSize = data.cadEntities.length + data.rooms.length + data.furniture.length + data.layouts.length;
        } catch (error) {
            // No dataset yet
        }

        res.json({
            success: true,
            status: {
                modelsLoaded: hasModels,
                modelCount: Object.values(ProductionMLTrainer.models).filter(m => m !== null).length,
                datasetSize: datasetSize,
                isTraining: trainingStatus.isTraining,
                isOptimizing: optimizationStatus.isOptimizing
            }
        });
    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
