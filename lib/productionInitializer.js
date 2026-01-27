/**
 * Production System Initializer
 * Loads production ML models and validates availability.
 */

const fs = require('fs').promises;
const path = require('path');
const ProductionMLTrainer = require('./productionMLTrainer');

class ProductionInitializer {
    constructor() {
        // Use /tmp for Render deployment (writable), project dir for local dev
        const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER;
        const writableDir = isProduction ? '/tmp' : __dirname + '/..';
        
        this.modelsDir = path.join(writableDir, 'models');
        this.isInitialized = false;
        this.modelsAvailable = false;
        
        // Ensure directories exist
        const fs = require('fs');
        if (!fs.existsSync(this.modelsDir)) {
            fs.mkdirSync(this.modelsDir, { recursive: true });
        }
    }

    /**
     * Initialize production system
     * Requires trained models on disk
     */
    async initialize() {
        console.log('=========================================');
        console.log('FloorPlan Pro - Production Initialization');
        console.log('=========================================\n');

        try {
            const modelsExist = await this.checkModelsExist();
            if (!modelsExist) {
                console.warn(`⚠ Production ML models not found in ${this.modelsDir}`);
                console.warn('⚠ Continuing without ML models - ML features will be disabled');
                console.warn('⚠ Server will start in fallback mode using geometric algorithms\n');
                this.isInitialized = false;
                this.modelsAvailable = false;
                return true; // Don't throw - allow server to start
            }

            console.log('✓ Production ML models found');
            console.log('✓ Loading pre-trained models...\n');

            const loaded = await ProductionMLTrainer.loadModels();
            if (!loaded) {
                console.warn('⚠ Failed to load production ML models');
                console.warn('⚠ Continuing without ML models - ML features will be disabled\n');
                this.isInitialized = false;
                this.modelsAvailable = false;
                return true; // Don't throw - allow server to start
            }

            console.log('✓ ML models loaded successfully');
            this.isInitialized = true;
            this.modelsAvailable = true;
            await this.displayModelInfo();
            return true;
        } catch (error) {
            console.error('✗ Production initialization error:', error.message);
            console.warn('⚠ Continuing without ML models - server will start in fallback mode\n');
            this.isInitialized = false;
            this.modelsAvailable = false;
            return true; // Don't throw - allow server to start
        }
    }
    /**
     * Check if trained models exist
     */
    async checkModelsExist() {
        try {
            const modelFiles = [
                'roomClassifier/model.json',
                'cadEntityClassifier/model.json'
            ];

            for (const file of modelFiles) {
                const modelPath = path.join(this.modelsDir, file);
                try {
                    await fs.access(modelPath);
                } catch {
                    return false;
                }
            }

            return true;
        } catch {
            return false;
        }
    }

    /**
     * Display model information
     */
    async displayModelInfo() {
        console.log('\n=========================================');
        console.log('Production ML Models Status');
        console.log('=========================================');

        const models = {
            'Room Classifier': ProductionMLTrainer.models.roomClassifier,
            'CAD Entity Classifier': ProductionMLTrainer.models.cadEntityClassifier,
            'Furniture Placer': ProductionMLTrainer.models.furniturePlacer,
            'Layout Optimizer': ProductionMLTrainer.models.layoutOptimizer
        };

        for (const [name, model] of Object.entries(models)) {
            if (model) {
                const paramCount = model.countParams ? model.countParams() : 'N/A';
                console.log(`✓ ${name}: ${paramCount} parameters`);
            } else {
                console.log(`⚠ ${name}: Not loaded`);
            }
        }

        // Display training history if available
        if (Object.keys(ProductionMLTrainer.trainingHistory).length > 0) {
            console.log('\nTraining Metrics:');
            for (const [modelName, history] of Object.entries(ProductionMLTrainer.trainingHistory)) {
                if (history && history.loss && history.loss.length > 0) {
                    const epochs = history.loss.length;
                    const finalLoss = history.loss[epochs - 1].toFixed(4);
                    const finalValLoss = history.val_loss ? history.val_loss[epochs - 1].toFixed(4) : 'N/A';
                    console.log(`  ${modelName}:`);
                    console.log(`    Epochs: ${epochs}`);
                    console.log(`    Final Loss: ${finalLoss}`);
                    console.log(`    Val Loss: ${finalValLoss}`);
                }
            }
        }

        console.log('\n=========================================');
        console.log('✓ System Ready for Production Use');
        console.log('=========================================\n');
    }

    /**
     * Get system status
     */
    getStatus() {
        return {
            initialized: this.isInitialized,
            modelsLoaded: Object.values(ProductionMLTrainer.models).filter(Boolean).length,
            trainingHistoryAvailable: Object.keys(ProductionMLTrainer.trainingHistory).length > 0
        };
    }

}

module.exports = new ProductionInitializer();

