# Node.js Integration for 3-Stage Floor Plan Processor
# Add these endpoints to your server.js file

"""
// 3-Stage Floor Plan Processing Endpoints for server.js

// Stage 1: Process Empty Floor Plan
app.post('/api/stages/stage1-empty-plan', (req, res) => {
    try {
        const { floorPlan } = req.body;
        
        if (!floorPlan) {
            return res.status(400).json({ error: 'Floor plan data required' });
        }

        // Normalize floor plan data
        const normalizedFloorPlan = {
            walls: floorPlan.walls || [],
            rooms: floorPlan.rooms || [],
            entrances: floorPlan.entrances || [],
            forbidden_zones: floorPlan.forbiddenZones || floorPlan.forbidden_zones || [],
            bounds: floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 }
        };

        // Call Python processor for Stage 1
        const { spawn } = require('child_process');
        const python = spawn('python3', ['-c', `
import sys
import json
sys.path.append('.')
from three_stage_processor import ThreeStageFloorPlanProcessor

processor = ThreeStageFloorPlanProcessor()
data = json.loads(sys.stdin.read())
result = processor.process_stage1_empty_plan(data)
print(json.dumps(result))
        `]);
        
        let result = '';
        let error = '';
        
        python.stdin.write(JSON.stringify(normalizedFloorPlan));
        python.stdin.end();
        
        python.stdout.on('data', (data) => {
            result += data.toString();
        });
        
        python.stderr.on('data', (data) => {
            error += data.toString();
        });
        
        python.on('close', (code) => {
            if (code !== 0) {
                console.error('Stage 1 processing error:', error);
                return res.status(500).json({ 
                    error: 'Stage 1 processing failed: ' + error 
                });
            }
            
            try {
                const stage1Result = JSON.parse(result);
                
                // Store result for next stage
                global.stage1Result = stage1Result;
                
                res.json({
                    success: true,
                    stage: 1,
                    type: 'empty_plan_analysis',
                    result: stage1Result,
                    visualization: {
                        rooms: stage1Result.rooms,
                        walls: stage1Result.walls,
                        entrances: stage1Result.entrances,
                        show_measurements: true,
                        color_scheme: 'clean_architectural'
                    },
                    message: `Analyzed ${stage1Result.metrics.room_count} rooms, ${stage1Result.metrics.available_space.toFixed(1)}m² available`
                });
            } catch (parseError) {
                res.status(500).json({ 
                    error: 'Failed to parse Stage 1 result' 
                });
            }
        });
        
    } catch (error) {
        console.error('Stage 1 endpoint error:', error);
        res.status(500).json({ 
            error: 'Stage 1 processing failed: ' + error.message 
        });
    }
});

// Stage 2: Place Ilots
app.post('/api/stages/stage2-place-ilots', (req, res) => {
    try {
        const { stage1Result, options = {} } = req.body;
        
        const stage1Data = stage1Result || global.stage1Result;
        if (!stage1Data) {
            return res.status(400).json({ 
                error: 'Stage 1 result required. Please process Stage 1 first.' 
            });
        }

        // Set default ilot placement options
        const ilotOptions = Object.assign({
            ilot_distribution: {
                '1-3': 0.30,
                '3-5': 0.40,
                '5-10': 0.25,
                '10-15': 0.05
            },
            coverage_ratio: 0.25,
            min_ilot_size: 3.0,
            max_ilot_size: 50.0
        }, options);

        // Call Python processor for Stage 2
        const { spawn } = require('child_process');
        const python = spawn('python3', ['-c', `
import sys
import json
sys.path.append('.')
from three_stage_processor import ThreeStageFloorPlanProcessor

processor = ThreeStageFloorPlanProcessor()
data = json.loads(sys.stdin.read())
stage1_result = data['stage1_result']
options = data['options']
result = processor.process_stage2_ilot_placement(stage1_result, options)
print(json.dumps(result))
        `]);
        
        let result = '';
        let error = '';
        
        python.stdin.write(JSON.stringify({
            stage1_result: stage1Data,
            options: ilotOptions
        }));
        python.stdin.end();
        
        python.stdout.on('data', (data) => {
            result += data.toString();
        });
        
        python.stderr.on('data', (data) => {
            error += data.toString();
        });
        
        python.on('close', (code) => {
            if (code !== 0) {
                console.error('Stage 2 processing error:', error);
                return res.status(500).json({ 
                    error: 'Stage 2 processing failed: ' + error 
                });
            }
            
            try {
                const stage2Result = JSON.parse(result);
                
                // Store result for next stage
                global.stage2Result = stage2Result;
                
                res.json({
                    success: true,
                    stage: 2,
                    type: 'ilot_placement',
                    result: stage2Result,
                    visualization: {
                        rooms: stage2Result.base_layout.rooms,
                        ilots: stage2Result.ilots,
                        show_measurements: true,
                        highlight_ilots: true,
                        ilot_color: 'red',
                        ilot_outline: true
                    },
                    statistics: stage2Result.placement_stats,
                    message: `Placed ${stage2Result.placement_stats.total_ilots} ilots (${stage2Result.placement_stats.placed_area.toFixed(1)}m²)`
                });
            } catch (parseError) {
                res.status(500).json({ 
                    error: 'Failed to parse Stage 2 result' 
                });
            }
        });
        
    } catch (error) {
        console.error('Stage 2 endpoint error:', error);
        res.status(500).json({ 
            error: 'Stage 2 processing failed: ' + error.message 
        });
    }
});

// Stage 3: Generate Corridors
app.post('/api/stages/stage3-generate-corridors', (req, res) => {
    try {
        const { stage2Result, options = {} } = req.body;
        
        const stage2Data = stage2Result || global.stage2Result;
        if (!stage2Data) {
            return res.status(400).json({ 
                error: 'Stage 2 result required. Please process Stages 1 and 2 first.' 
            });
        }

        // Set default corridor generation options
        const corridorOptions = Object.assign({
            corridor_width: 1.2,
            generate_flow_indicators: true,
            min_corridor_length: 2.0,
            connection_strategy: 'comprehensive'
        }, options);

        // Call Python processor for Stage 3
        const { spawn } = require('child_process');
        const python = spawn('python3', ['-c', `
import sys
import json
sys.path.append('.')
from three_stage_processor import ThreeStageFloorPlanProcessor

processor = ThreeStageFloorPlanProcessor()
data = json.loads(sys.stdin.read())
stage2_result = data['stage2_result']
options = data['options']
result = processor.process_stage3_corridor_generation(stage2_result, options)
print(json.dumps(result))
        `]);
        
        let result = '';
        let error = '';
        
        python.stdin.write(JSON.stringify({
            stage2_result: stage2Data,
            options: corridorOptions
        }));
        python.stdin.end();
        
        python.stdout.on('data', (data) => {
            result += data.toString();
        });
        
        python.stderr.on('data', (data) => {
            error += data.toString();
        });
        
        python.on('close', (code) => {
            if (code !== 0) {
                console.error('Stage 3 processing error:', error);
                return res.status(500).json({ 
                    error: 'Stage 3 processing failed: ' + error 
                });
            }
            
            try {
                const stage3Result = JSON.parse(result);
                
                // Store complete result
                global.stage3Result = stage3Result;
                global.completeLayout = {
                    rooms: stage3Result.ilot_layout.base_layout.rooms,
                    ilots: stage3Result.ilot_layout.ilots,
                    corridors: stage3Result.corridors,
                    flow_indicators: stage3Result.flow_indicators
                };
                
                res.json({
                    success: true,
                    stage: 3,
                    type: 'complete_layout',
                    result: stage3Result,
                    visualization: {
                        rooms: stage3Result.ilot_layout.base_layout.rooms,
                        ilots: stage3Result.ilot_layout.ilots,
                        corridors: stage3Result.corridors,
                        flow_indicators: stage3Result.flow_indicators,
                        show_all_layers: true,
                        corridor_color: 'red',
                        flow_color: 'red'
                    },
                    statistics: stage3Result.corridor_stats,
                    message: `Generated ${stage3Result.corridor_stats.total_corridors} corridors with ${stage3Result.corridor_stats.flow_indicators} flow indicators`
                });
            } catch (parseError) {
                res.status(500).json({ 
                    error: 'Failed to parse Stage 3 result' 
                });
            }
        });
        
    } catch (error) {
        console.error('Stage 3 endpoint error:', error);
        res.status(500).json({ 
            error: 'Stage 3 processing failed: ' + error.message 
        });
    }
});

// Complete 3-Stage Workflow
app.post('/api/stages/complete-workflow', (req, res) => {
    try {
        const { floorPlan, options = {} } = req.body;
        
        if (!floorPlan) {
            return res.status(400).json({ error: 'Floor plan data required' });
        }

        // Normalize floor plan data
        const normalizedFloorPlan = {
            walls: floorPlan.walls || [],
            rooms: floorPlan.rooms || [],
            entrances: floorPlan.entrances || [],
            forbidden_zones: floorPlan.forbiddenZones || floorPlan.forbidden_zones || [],
            bounds: floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 }
        };

        // Set comprehensive options
        const workflowOptions = Object.assign({
            ilot_distribution: {
                '1-3': 0.30,
                '3-5': 0.40,
                '5-10': 0.25,
                '10-15': 0.05
            },
            coverage_ratio: 0.25,
            corridor_width: 1.2,
            generate_flow_indicators: true
        }, options);

        // Call Python processor for complete workflow
        const { spawn } = require('child_process');
        const python = spawn('python3', ['-c', `
import sys
import json
sys.path.append('.')
from three_stage_processor import ThreeStageFloorPlanProcessor

processor = ThreeStageFloorPlanProcessor()
data = json.loads(sys.stdin.read())
floor_plan = data['floor_plan']
options = data['options']
result = processor.process_complete_workflow(floor_plan, options)
print(json.dumps(result))
        `]);
        
        let result = '';
        let error = '';
        
        python.stdin.write(JSON.stringify({
            floor_plan: normalizedFloorPlan,
            options: workflowOptions
        }));
        python.stdin.end();
        
        python.stdout.on('data', (data) => {
            result += data.toString();
        });
        
        python.stderr.on('data', (data) => {
            error += data.toString();
        });
        
        python.on('close', (code) => {
            if (code !== 0) {
                console.error('Complete workflow error:', error);
                return res.status(500).json({ 
                    error: 'Complete workflow failed: ' + error 
                });
            }
            
            try {
                const completeResult = JSON.parse(result);
                
                // Store all stage results
                global.stage1Result = completeResult.stages.stage1_empty;
                global.stage2Result = completeResult.stages.stage2_ilots;
                global.stage3Result = completeResult.stages.stage3_complete;
                global.completeLayout = completeResult.final_layout;
                
                res.json({
                    success: true,
                    workflow_type: '3_stage_complete',
                    stages: completeResult.stages,
                    final_layout: completeResult.final_layout,
                    progression_summary: completeResult.progression_summary,
                    message: `Complete 3-stage workflow: ${completeResult.progression_summary.stage1_rooms} rooms → ${completeResult.progression_summary.stage2_ilots} ilots → ${completeResult.progression_summary.stage3_corridors} corridors`
                });
            } catch (parseError) {
                res.status(500).json({ 
                    error: 'Failed to parse complete workflow result' 
                });
            }
        });
        
    } catch (error) {
        console.error('Complete workflow endpoint error:', error);
        res.status(500).json({ 
            error: 'Complete workflow failed: ' + error.message 
        });
    }
});

// Get current stage result
app.get('/api/stages/current/:stage', (req, res) => {
    try {
        const stage = parseInt(req.params.stage);
        
        let result = null;
        let message = '';
        
        switch (stage) {
            case 1:
                result = global.stage1Result;
                message = result ? 'Stage 1 result available' : 'Stage 1 not processed yet';
                break;
            case 2:
                result = global.stage2Result;
                message = result ? 'Stage 2 result available' : 'Stage 2 not processed yet';
                break;
            case 3:
                result = global.stage3Result;
                message = result ? 'Stage 3 result available' : 'Stage 3 not processed yet';
                break;
            default:
                return res.status(400).json({ error: 'Invalid stage number (1-3)' });
        }
        
        res.json({
            success: !!result,
            stage: stage,
            result: result,
            message: message
        });
        
    } catch (error) {
        console.error('Get stage result error:', error);
        res.status(500).json({ 
            error: 'Failed to get stage result: ' + error.message 
        });
    }
});

// Reset workflow (clear all stage results)
app.post('/api/stages/reset', (req, res) => {
    try {
        global.stage1Result = null;
        global.stage2Result = null;
        global.stage3Result = null;
        global.completeLayout = null;
        
        res.json({
            success: true,
            message: 'All stage results cleared'
        });
        
    } catch (error) {
        console.error('Reset workflow error:', error);
        res.status(500).json({ 
            error: 'Failed to reset workflow: ' + error.message 
        });
    }
});
"""