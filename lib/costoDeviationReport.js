/**
 * COSTO Deviation Report - V1
 * Generates comprehensive deviation report when unit mix cannot be fully met
 * Based on COSTO V1 specifications
 */

class CostoDeviationReport {
    constructor(unitMix, solution) {
        this.unitMix = unitMix;
        this.solution = solution;
        this.boxes = solution.boxes || [];
    }

    /**
     * Generate comprehensive deviation report
     * @returns {Object} - Deviation report
     */
    generate() {
        const typologyAnalysis = this.analyzeTypologies();
        const areaAnalysis = this.analyzeAreas();
        const causes = this.identifyCauses();

        return {
            summary: {
                totalTargetArea: this.calculateTotalTargetArea(),
                totalActualArea: this.calculateTotalActualArea(),
                lostArea: this.calculateLostArea(),
                complianceRate: this.calculateComplianceRate(),
                overallStatus: this.getOverallStatus()
            },
            typologies: typologyAnalysis,
            areas: areaAnalysis,
            causes: causes,
            recommendations: this.generateRecommendations(typologyAnalysis, causes)
        };
    }

    /**
     * Analyze each typology
     */
    analyzeTypologies() {
        if (!this.unitMix || !this.unitMix.typologies) {
            return [];
        }

        return this.unitMix.typologies.map(typo => {
            const actualBoxes = this.boxes.filter(b => b.type === typo.name);
            const actualArea = actualBoxes.reduce((sum, b) => 
                sum + (b.area || b.width * b.height), 0);
            const actualCount = actualBoxes.length;
            
            const targetArea = typo.targetArea || 0;
            const tolerance = typo.tolerance || targetArea * 0.1;
            
            const deviation = actualArea - targetArea;
            const deviationPct = targetArea > 0 ? (deviation / targetArea) * 100 : 0;
            const withinTolerance = Math.abs(deviation) <= tolerance;
            
            // Calculate missing/excess
            let missing = 0;
            let excess = 0;
            if (deviation < -tolerance) {
                missing = Math.abs(deviation + tolerance);
            } else if (deviation > tolerance) {
                excess = deviation - tolerance;
            }

            return {
                typology: typo.name,
                targetArea,
                actualArea,
                deviation,
                deviationPct,
                tolerance,
                withinTolerance,
                missing,
                excess,
                actualCount,
                priority: typo.priority || 'souhaitable',
                status: this.getTypologyStatus(deviation, tolerance, typo.priority)
            };
        });
    }

    /**
     * Analyze area distribution
     */
    analyzeAreas() {
        const totalTarget = this.calculateTotalTargetArea();
        const totalActual = this.calculateTotalActualArea();
        const lost = this.calculateLostArea();
        const usable = this.solution.metrics?.usableArea || totalActual;

        return {
            totalTarget,
            totalActual,
            lost,
            usable,
            yield: usable > 0 ? totalActual / usable : 0,
            efficiency: totalTarget > 0 ? totalActual / totalTarget : 0
        };
    }

    /**
     * Identify probable causes of deviations
     */
    identifyCauses() {
        const causes = [];

        // Check geometry constraints
        const geometryIssues = this.checkGeometryConstraints();
        if (geometryIssues.length > 0) {
            causes.push({
                type: 'geometry',
                severity: 'high',
                description: 'Geometry constraints limiting placement',
                details: geometryIssues
            });
        }

        // Check unit mix feasibility
        const feasibilityIssues = this.checkFeasibility();
        if (feasibilityIssues.length > 0) {
            causes.push({
                type: 'feasibility',
                severity: 'medium',
                description: 'Unit mix may be infeasible for available space',
                details: feasibilityIssues
            });
        }

        // Check priority conflicts
        const priorityIssues = this.checkPriorityConflicts();
        if (priorityIssues.length > 0) {
            causes.push({
                type: 'priority',
                severity: 'low',
                description: 'Priority conflicts in unit mix',
                details: priorityIssues
            });
        }

        return causes;
    }

    checkGeometryConstraints() {
        const issues = [];
        const obstacles = this.solution.floorPlan?.obstacles || [];
        const forbiddenZones = this.solution.floorPlan?.forbiddenZones || [];
        const envelope = this.solution.floorPlan?.envelope || this.solution.floorPlan?.rooms?.[0]?.polygon;

        if (!envelope || envelope.length === 0) {
            issues.push('No usable envelope defined');
        }

        const obstacleArea = this.calculateObstacleArea(obstacles);
        const forbiddenArea = this.calculateForbiddenArea(forbiddenZones);
        
        if (obstacleArea > 0) {
            issues.push(`Obstacles occupy ${obstacleArea.toFixed(2)} m²`);
        }
        
        if (forbiddenArea > 0) {
            issues.push(`Forbidden zones occupy ${forbiddenArea.toFixed(2)} m²`);
        }

        return issues;
    }

    checkFeasibility() {
        const issues = [];
        const totalTarget = this.calculateTotalTargetArea();
        const usable = this.solution.metrics?.usableArea || 0;

        if (totalTarget > usable * 0.9) {
            issues.push(`Target area (${totalTarget.toFixed(2)} m²) exceeds 90% of usable area (${usable.toFixed(2)} m²)`);
        }

        return issues;
    }

    checkPriorityConflicts() {
        const issues = [];
        const typologies = this.analyzeTypologies();
        
        const mandatory = typologies.filter(t => t.priority === 'obligatoire' && !t.withinTolerance);
        if (mandatory.length > 0) {
            issues.push(`${mandatory.length} mandatory typologies not met`);
        }

        return issues;
    }

    calculateTotalTargetArea() {
        if (!this.unitMix || !this.unitMix.typologies) return 0;
        return this.unitMix.typologies.reduce((sum, typo) => 
            sum + (typo.targetArea || 0), 0);
    }

    calculateTotalActualArea() {
        return this.boxes.reduce((sum, box) => 
            sum + (box.area || box.width * box.height), 0);
    }

    calculateLostArea() {
        const usable = this.solution.metrics?.usableArea || 0;
        const actual = this.calculateTotalActualArea();
        return Math.max(0, usable - actual);
    }

    calculateComplianceRate() {
        const typologies = this.analyzeTypologies();
        if (typologies.length === 0) return 0;

        const totalWeight = typologies.reduce((sum, t) => 
            sum + (t.priority === 'obligatoire' ? 2 : 1), 0);
        
        const weightedCompliance = typologies.reduce((sum, t) => {
            const weight = t.priority === 'obligatoire' ? 2 : 1;
            const compliance = t.withinTolerance ? 1 : Math.max(0, 1 - Math.abs(t.deviationPct) / 100);
            return sum + compliance * weight;
        }, 0);

        return totalWeight > 0 ? (weightedCompliance / totalWeight) * 100 : 0;
    }

    getOverallStatus() {
        const compliance = this.calculateComplianceRate();
        if (compliance >= 95) return 'excellent';
        if (compliance >= 85) return 'good';
        if (compliance >= 70) return 'acceptable';
        return 'needs_improvement';
    }

    getTypologyStatus(deviation, tolerance, priority) {
        if (Math.abs(deviation) <= tolerance) return 'ok';
        if (priority === 'obligatoire') {
            return deviation < 0 ? 'critical_missing' : 'critical_excess';
        }
        return deviation < 0 ? 'missing' : 'excess';
    }

    calculateObstacleArea(obstacles) {
        // Simplified: estimate area from bounding boxes
        return obstacles.reduce((sum, obs) => {
            if (obs.bounds) {
                const w = obs.bounds.maxX - obs.bounds.minX;
                const h = obs.bounds.maxY - obs.bounds.minY;
                return sum + w * h;
            }
            return sum;
        }, 0);
    }

    calculateForbiddenArea(forbiddenZones) {
        // Simplified: estimate area from polygons
        return forbiddenZones.reduce((sum, zone) => {
            if (zone.polygon && zone.polygon.length >= 3) {
                let area = 0;
                for (let i = 0; i < zone.polygon.length; i++) {
                    const j = (i + 1) % zone.polygon.length;
                    const xi = zone.polygon[i][0] || zone.polygon[i].x;
                    const yi = zone.polygon[i][1] || zone.polygon[i].y;
                    const xj = zone.polygon[j][0] || zone.polygon[j].x;
                    const yj = zone.polygon[j][1] || zone.polygon[j].y;
                    area += xi * yj - xj * yi;
                }
                return sum + Math.abs(area / 2);
            }
            return sum;
        }, 0);
    }

    generateRecommendations(typologies, causes) {
        const recommendations = [];

        // Check for missing mandatory typologies
        const missingMandatory = typologies.filter(t => 
            t.priority === 'obligatoire' && t.status === 'critical_missing'
        );
        if (missingMandatory.length > 0) {
            recommendations.push({
                priority: 'high',
                action: 'Adjust unit mix to meet mandatory typologies',
                details: `Missing: ${missingMandatory.map(t => t.typology).join(', ')}`
            });
        }

        // Check geometry constraints
        const geometryCauses = causes.filter(c => c.type === 'geometry');
        if (geometryCauses.length > 0) {
            recommendations.push({
                priority: 'medium',
                action: 'Review geometry constraints',
                details: 'Consider reducing obstacles or forbidden zones if possible'
            });
        }

        // Check yield
        const yieldRatio = this.solution.metrics?.yieldRatio || 0;
        if (yieldRatio < 0.6) {
            recommendations.push({
                priority: 'medium',
                action: 'Improve space utilization',
                details: `Current yield: ${(yieldRatio * 100).toFixed(1)}%. Target: 70-80%`
            });
        }

        return recommendations;
    }
}

module.exports = CostoDeviationReport;
