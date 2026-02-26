/**
 * RawPlanPipeline - Orchestrated flow for raw floor plan completion
 *
 * Phase 1: Analyze raw plan (gaps, open endpoints, doors)
 * Phase 2: Fill gaps (WallGapCompleter)
 * Phase 3: Validate geometry (architectural rules)
 * Phase 4: Ready for placement (boxes, corridors, connectors)
 */

const { RawPlanAnalyzer } = require('./RawPlanAnalyzer');
const WallGapCompleter = require('./WallGapCompleter');
const ArchitecturalValidator = require('./architecturalValidator');

class RawPlanPipeline {
    constructor(options = {}) {
        this.gapThreshold = options.gapThreshold ?? 3.0;
        this.autoComplete = options.autoComplete !== false;
        this.validateAfterComplete = options.validateAfterComplete !== false;
    }

    /**
     * Run the full pipeline on a raw floor plan
     * @param {Object} floorPlan - { walls, forbiddenZones, entrances, bounds, entities }
     * @returns {Object} { completedPlan, analysis, validation, ready }
     */
    run(floorPlan) {
        const result = {
            completedPlan: null,
            analysis: null,
            validation: null,
            syntheticSegments: [],
            ready: false,
            phases: []
        };

        const walls = Array.isArray(floorPlan.walls) ? floorPlan.walls : [];
        const bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const entities = floorPlan.entities || [];

        // Phase 1: Analyze
        const analyzer = new RawPlanAnalyzer({ gapThreshold: this.gapThreshold });
        result.analysis = analyzer.analyze(walls, bounds, entities);
        result.phases.push({ phase: 1, name: 'analyze', status: 'done' });

        // Phase 2: Fill gaps
        let completedWalls = walls;
        if (this.autoComplete && result.analysis.gapCount > 0) {
            const completer = new WallGapCompleter({
                gapThreshold: this.gapThreshold,
                minWallLength: 0.3  // Allow smaller filler segments for better coverage
            });
            const { completedWalls: cw, syntheticSegments } = completer.completeWalls(walls, []);
            completedWalls = cw;
            result.syntheticSegments = syntheticSegments || [];
            result.phases.push({ phase: 2, name: 'fill', status: 'done', filled: result.syntheticSegments.length });
        } else {
            result.phases.push({ phase: 2, name: 'fill', status: 'skipped' });
        }

        result.completedPlan = {
            ...floorPlan,
            walls: completedWalls,
            _rawAnalysis: result.analysis,
            _syntheticSegments: result.syntheticSegments
        };

        // Phase 3: Validate (optional)
        if (this.validateAfterComplete) {
            try {
                const validator = new ArchitecturalValidator(
                    { ...floorPlan, walls: completedWalls },
                    { rawPlan: true }  // Relaxed checks for raw plans (no ilots/corridors yet)
                );
                result.validation = validator.validate();
                result.phases.push({ phase: 3, name: 'validate', status: 'done', passed: result.validation.valid });
            } catch (e) {
                result.phases.push({ phase: 3, name: 'validate', status: 'error', error: e.message });
            }
        } else {
            result.phases.push({ phase: 3, name: 'validate', status: 'skipped' });
        }

        result.ready = true;
        return result;
    }

    /**
     * Run only analysis (no completion) – for preview/report
     */
    analyzeOnly(floorPlan) {
        const analyzer = new RawPlanAnalyzer({ gapThreshold: this.gapThreshold });
        const walls = Array.isArray(floorPlan.walls) ? floorPlan.walls : [];
        const bounds = floorPlan.bounds || {};
        const entities = floorPlan.entities || [];
        return analyzer.analyze(walls, bounds, entities);
    }
}

module.exports = { RawPlanPipeline };
