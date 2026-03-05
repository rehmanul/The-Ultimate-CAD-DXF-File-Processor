/**
 * Bug Condition Exploration Test for Corridor Accessibility Gaps
 * 
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**
 * 
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * 
 * This test encodes the expected behavior - it will validate the fix when it passes after implementation.
 * 
 * GOAL: Surface counterexamples that demonstrate the bug exists (disconnected networks, unreachable areas)
 */

const AdvancedCorridorNetworkGenerator = require('../../lib/advancedCorridorNetworkGenerator');
const CirculationRouter = require('../../lib/costo-engine/circulationRouter');

describe('Corridor Accessibility Gaps - Bug Condition Exploration', () => {
    /**
     * Helper function to generate corridors WITHOUT the fix
     * This generates the initial corridors (steps 1-3) but skips the validation/bridging step
     */
    function generateUnfixedCorridors(floorPlan, îlots, options = {}) {
        const generator = new AdvancedCorridorNetworkGenerator(floorPlan, îlots, options);
        
        const corridors = [];
        
        // Step 1: Generate vertical corridors (between rows)
        const verticalCorridors = generator.generateVerticalCorridors();
        corridors.push(...verticalCorridors);

        // Step 2: Generate horizontal corridors (between columns)
        const horizontalCorridors = generator.generateHorizontalCorridors();
        corridors.push(...horizontalCorridors);

        // Step 3: Generate perimeter corridors (around edges)
        const perimeterCorridors = generator.generatePerimeterCorridors();
        corridors.push(...perimeterCorridors);

        // NOTE: We skip Step 4 (validateAndBridgeConnectivity) to get unfixed corridors
        // NOTE: We skip Step 5 (connectCorridorPaths) as it's just path connection
        
        return corridors;
    }

    /**
     * Helper function to build circulation graph from corridor segments
     * Returns nodes map with connectivity information
     */
    function buildCirculationGraph(corridors, floorPlan) {
        if (!corridors || corridors.length === 0) {
            return { nodes: new Map(), edges: [] };
        }

        const router = new CirculationRouter(floorPlan, {});
        const segments = router._buildCenterlineSegments(corridors);
        const graph = router._buildCenterlineGraph(segments);
        
        return graph;
    }

    /**
     * Helper function to detect disconnected components in the circulation graph
     * Returns array of components (each component is an array of node keys)
     */
    function findDisconnectedComponents(nodes) {
        const components = [];
        const visited = new Set();

        for (const key of nodes.keys()) {
            if (visited.has(key)) continue;
            
            const stack = [key];
            visited.add(key);
            const compNodes = [];

            while (stack.length > 0) {
                const curKey = stack.pop();
                compNodes.push(curKey);
                const node = nodes.get(curKey);
                if (!node) continue;
                
                // Nodes from _buildCenterlineGraph have 'edges' (Set), not 'neighbors'
                if (node.edges) {
                    for (const edgeKey of node.edges) {
                        if (visited.has(edgeKey)) continue;
                        visited.add(edgeKey);
                        stack.push(edgeKey);
                    }
                }
            }

            components.push(compNodes);
        }

        return components;
    }

    /**
     * Helper function to check if all îlots are connected to at least one corridor
     * Returns array of unreachable îlots
     */
    function findUnreachableÎlots(îlots, corridors) {
        const unreachable = [];
        
        for (const îlot of îlots) {
            let hasCorridorAccess = false;
            
            // Check if îlot is adjacent to or overlaps with any corridor
            for (const corridor of corridors) {
                if (isAdjacentOrOverlapping(îlot, corridor)) {
                    hasCorridorAccess = true;
                    break;
                }
            }
            
            if (!hasCorridorAccess) {
                unreachable.push(îlot);
            }
        }
        
        return unreachable;
    }

    /**
     * Helper function to check if îlot is adjacent to or overlaps with corridor
     */
    function isAdjacentOrOverlapping(îlot, corridor) {
        const tolerance = 0.5; // Small tolerance for adjacency
        
        const îlotRight = îlot.x + îlot.width;
        const îlotBottom = îlot.y + îlot.height;
        const corridorRight = corridor.x + corridor.width;
        const corridorBottom = corridor.y + corridor.height;
        
        // Check for overlap or adjacency
        const horizontalOverlap = !(îlotRight + tolerance < corridor.x || corridorRight + tolerance < îlot.x);
        const verticalOverlap = !(îlotBottom + tolerance < corridor.y || corridorBottom + tolerance < îlot.y);
        
        return horizontalOverlap && verticalOverlap;
    }

    /**
     * Helper function to check if all areas are reachable from entrances
     * Returns false if any corridor nodes are unreachable from entrance nodes
     */
    function allAreasReachableFromEntrances(nodes, entrancePoints) {
        if (!entrancePoints || entrancePoints.length === 0) {
            // If no entrances, we can't validate reachability
            return true;
        }

        // Find entrance nodes (nodes closest to entrance points)
        const entranceNodes = new Set();
        for (const entrance of entrancePoints) {
            let closestNode = null;
            let closestDist = Infinity;
            
            for (const [key, node] of nodes.entries()) {
                const dist = Math.hypot(node.x - entrance.x, node.y - entrance.y);
                if (dist < closestDist) {
                    closestDist = dist;
                    closestNode = key;
                }
            }
            
            if (closestNode) {
                entranceNodes.add(closestNode);
            }
        }

        if (entranceNodes.size === 0) {
            return false;
        }

        // BFS from entrance nodes to find all reachable nodes
        const reachable = new Set();
        const queue = Array.from(entranceNodes);
        
        for (const key of queue) {
            reachable.add(key);
        }

        while (queue.length > 0) {
            const curKey = queue.shift();
            const node = nodes.get(curKey);
            if (!node) continue;
            
            // Nodes from _buildCenterlineGraph have 'edges' (Set), not 'neighbors'
            if (node.edges) {
                for (const edgeKey of node.edges) {
                    if (reachable.has(edgeKey)) continue;
                    reachable.add(edgeKey);
                    queue.push(edgeKey);
                }
            }
        }

        // Check if all nodes are reachable
        return reachable.size === nodes.size;
    }

    /**
     * Bug condition function: returns true if the bug condition holds
     * (disconnected components OR unreachable îlots OR areas not reachable from entrances)
     */
    function isBugCondition(floorPlan, îlots, corridors, entrancePoints) {
        if (!corridors || corridors.length === 0) {
            return false; // No corridors means no bug to test
        }

        const graph = buildCirculationGraph(corridors, floorPlan);
        const disconnectedComponents = findDisconnectedComponents(graph.nodes);
        const unreachableÎlots = findUnreachableÎlots(îlots, corridors);
        const allReachable = allAreasReachableFromEntrances(graph.nodes, entrancePoints);

        return (disconnectedComponents.length > 1) || 
               (unreachableÎlots.length > 0) || 
               (!allReachable);
    }

    /**
     * Test Case 1: Isolated Îlot Cluster
     * A group of îlots in the corner has no corridor connecting it to the main network
     */
    test('should detect isolated îlot cluster (EXPECTED TO FAIL on unfixed code)', () => {
        const floorPlan = {
            bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
            walls: []
        };

        // Create îlots: main cluster on left, isolated cluster on right
        const îlots = [
            // Main cluster (left side)
            { x: 10, y: 10, width: 8, height: 8, id: 'ilot1' },
            { x: 10, y: 20, width: 8, height: 8, id: 'ilot2' },
            { x: 20, y: 10, width: 8, height: 8, id: 'ilot3' },
            { x: 20, y: 20, width: 8, height: 8, id: 'ilot4' },
            
            // Isolated cluster (right side, far from main cluster)
            { x: 70, y: 70, width: 8, height: 8, id: 'ilot5' },
            { x: 70, y: 80, width: 8, height: 8, id: 'ilot6' },
            { x: 80, y: 70, width: 8, height: 8, id: 'ilot7' },
            { x: 80, y: 80, width: 8, height: 8, id: 'ilot8' }
        ];

        const entrancePoints = [{ x: 5, y: 15 }]; // Entrance near main cluster

        // Generate UNFIXED corridors (without the fix)
        const unfixedCorridors = generateUnfixedCorridors(floorPlan, îlots, {});

        // Verify bug condition holds on UNFIXED corridors
        expect(isBugCondition(floorPlan, îlots, unfixedCorridors, entrancePoints)).toBe(true);

        // Now generate FIXED corridors (with the fix)
        const generator = new AdvancedCorridorNetworkGenerator(floorPlan, îlots, {});
        const fixedCorridors = generator.generateNetwork();

        // Expected behavior: All îlots should be reachable after fix
        const unreachableÎlots = findUnreachableÎlots(îlots, fixedCorridors);
        expect(unreachableÎlots.length).toBe(0); // This should PASS after fix

        // Expected behavior: Circulation network should be fully connected after fix
        const graph = buildCirculationGraph(fixedCorridors, floorPlan);
        const components = findDisconnectedComponents(graph.nodes);
        expect(components.length).toBe(1); // This should PASS after fix
    });

    /**
     * Test Case 2: Unbridged Gap Between Corridor Segments
     * Horizontal corridors exist on left and right, but no vertical bridge connects them
     */
    test('should detect unbridged gap between corridor segments (EXPECTED TO FAIL on unfixed code)', () => {
        const floorPlan = {
            bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
            walls: []
        };

        // Create îlots: two separate rows with a large gap between them
        const îlots = [
            // Left row
            { x: 10, y: 10, width: 8, height: 8, id: 'ilot1' },
            { x: 10, y: 20, width: 8, height: 8, id: 'ilot2' },
            { x: 10, y: 30, width: 8, height: 8, id: 'ilot3' },
            
            // Right row (large horizontal gap)
            { x: 60, y: 10, width: 8, height: 8, id: 'ilot4' },
            { x: 60, y: 20, width: 8, height: 8, id: 'ilot5' },
            { x: 60, y: 30, width: 8, height: 8, id: 'ilot6' }
        ];

        const entrancePoints = [{ x: 5, y: 15 }]; // Entrance near left row

        // Generate UNFIXED corridors (without the fix)
        const unfixedCorridors = generateUnfixedCorridors(floorPlan, îlots, {});

        // Verify bug condition holds on UNFIXED corridors
        expect(isBugCondition(floorPlan, îlots, unfixedCorridors, entrancePoints)).toBe(true);

        // Now generate FIXED corridors (with the fix)
        const generator = new AdvancedCorridorNetworkGenerator(floorPlan, îlots, {});
        const fixedCorridors = generator.generateNetwork();

        // Expected behavior: All areas should be reachable from entrance after fix
        const graph = buildCirculationGraph(fixedCorridors, floorPlan);
        const allReachable = allAreasReachableFromEntrances(graph.nodes, entrancePoints);
        expect(allReachable).toBe(true); // This should PASS after fix

        // Expected behavior: No disconnected components after fix
        const components = findDisconnectedComponents(graph.nodes);
        expect(components.length).toBe(1); // This should PASS after fix
    });

    /**
     * Test Case 3: Unreachable Corridor Segment
     * A vertical corridor exists but is not connected to entrance-accessible corridors
     */
    test('should detect unreachable corridor segment (EXPECTED TO FAIL on unfixed code)', () => {
        const floorPlan = {
            bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
            walls: []
        };

        // Create îlots: main group with entrance access, isolated pair far away
        const îlots = [
            // Main group (entrance accessible)
            { x: 10, y: 10, width: 8, height: 8, id: 'ilot1' },
            { x: 20, y: 10, width: 8, height: 8, id: 'ilot2' },
            { x: 30, y: 10, width: 8, height: 8, id: 'ilot3' },
            
            // Isolated pair (will create vertical corridor, but disconnected)
            { x: 70, y: 10, width: 8, height: 8, id: 'ilot4' },
            { x: 70, y: 25, width: 8, height: 8, id: 'ilot5' }
        ];

        const entrancePoints = [{ x: 5, y: 14 }]; // Entrance near main group

        // Generate UNFIXED corridors (without the fix)
        const unfixedCorridors = generateUnfixedCorridors(floorPlan, îlots, {});

        // Verify bug condition holds on UNFIXED corridors
        expect(isBugCondition(floorPlan, îlots, unfixedCorridors, entrancePoints)).toBe(true);

        // Now generate FIXED corridors (with the fix)
        const generator = new AdvancedCorridorNetworkGenerator(floorPlan, îlots, {});
        const fixedCorridors = generator.generateNetwork();

        // Expected behavior: All corridor segments should be reachable from entrance after fix
        const graph = buildCirculationGraph(fixedCorridors, floorPlan);
        const allReachable = allAreasReachableFromEntrances(graph.nodes, entrancePoints);
        expect(allReachable).toBe(true); // This should PASS after fix

        // Expected behavior: Single connected component after fix
        const components = findDisconnectedComponents(graph.nodes);
        expect(components.length).toBe(1); // This should PASS after fix
    });

    /**
     * Test Case 4: Multiple Entrances with Isolated Components
     * Multiple entrances exist, but some connect to isolated components
     */
    test('should detect multiple entrances with isolated components (EXPECTED TO FAIL on unfixed code)', () => {
        const floorPlan = {
            bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
            walls: []
        };

        // Create îlots: three separate clusters
        const îlots = [
            // Cluster 1 (top-left)
            { x: 10, y: 10, width: 8, height: 8, id: 'ilot1' },
            { x: 20, y: 10, width: 8, height: 8, id: 'ilot2' },
            
            // Cluster 2 (bottom-left)
            { x: 10, y: 50, width: 8, height: 8, id: 'ilot3' },
            { x: 20, y: 50, width: 8, height: 8, id: 'ilot4' },
            
            // Cluster 3 (right side)
            { x: 70, y: 30, width: 8, height: 8, id: 'ilot5' },
            { x: 80, y: 30, width: 8, height: 8, id: 'ilot6' }
        ];

        const entrancePoints = [
            { x: 5, y: 14 },  // Entrance 1 near cluster 1
            { x: 5, y: 54 },  // Entrance 2 near cluster 2
            { x: 65, y: 34 }  // Entrance 3 near cluster 3
        ];

        // Generate UNFIXED corridors (without the fix)
        const unfixedCorridors = generateUnfixedCorridors(floorPlan, îlots, {});

        // Verify bug condition holds on UNFIXED corridors
        expect(isBugCondition(floorPlan, îlots, unfixedCorridors, entrancePoints)).toBe(true);

        // Now generate FIXED corridors (with the fix)
        const generator = new AdvancedCorridorNetworkGenerator(floorPlan, îlots, {});
        const fixedCorridors = generator.generateNetwork();

        // Expected behavior: All areas should be reachable from all entrances after fix
        const graph = buildCirculationGraph(fixedCorridors, floorPlan);
        const components = findDisconnectedComponents(graph.nodes);
        expect(components.length).toBe(1); // This should PASS after fix

        // Expected behavior: All îlots should have corridor access after fix
        const unreachableÎlots = findUnreachableÎlots(îlots, fixedCorridors);
        expect(unreachableÎlots.length).toBe(0); // This should PASS after fix
    });
});
