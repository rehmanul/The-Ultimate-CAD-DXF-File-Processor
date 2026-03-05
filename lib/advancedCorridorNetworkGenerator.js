const CirculationRouter = require('./costo-engine/circulationRouter');
const CorridorRouter = require('./corridorRouter');

/**
 * AdvancedCorridorNetworkGenerator
 * Creates complete circulation network with horizontal AND vertical corridors
 * Matches COSTO V1 reference output (pink circulation paths)
 */
class AdvancedCorridorNetworkGenerator {
    constructor(floorPlan, ilots, options = {}) {
        this.floorPlan = floorPlan;
        this.ilots = ilots || [];
        this.corridorWidth = options.corridorWidth || 1.2;
        this.margin = options.margin || 0.2;
        this.bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        this.minCorridorLength = options.minCorridorLength || 2.0;
    }

    /**
     * Generate complete corridor network
     * @returns {Array} Array of corridor segments with corners for path rendering
     */
    generateNetwork() {
        if (!this.ilots || this.ilots.length === 0) {
            console.warn('[Corridor Network] No îlots provided');
            return [];
        }

        const corridors = [];

        // Step 1: Generate vertical corridors (between rows)
        const verticalCorridors = this.generateVerticalCorridors();
        corridors.push(...verticalCorridors);

        // Step 2: Generate horizontal corridors (between columns)
        const horizontalCorridors = this.generateHorizontalCorridors();
        corridors.push(...horizontalCorridors);

        // Step 3: Generate perimeter corridors (around edges)
        const perimeterCorridors = this.generatePerimeterCorridors();
        corridors.push(...perimeterCorridors);

        // Step 4: Post-generation validation loop to ensure full connectivity
        const validatedCorridors = this.validateAndBridgeConnectivity(corridors);

        // Step 5: Connect corridors into continuous paths
        const connectedPaths = this.connectCorridorPaths(validatedCorridors);

        console.log(`[Corridor Network] Generated ${connectedPaths.length} corridor paths`);
        return connectedPaths;
    }

    /**
     * Generate vertical corridors between rows of îlots
     * @returns {Array} Vertical corridor segments
     */
    generateVerticalCorridors() {
        const corridors = [];
        const rows = this.groupIlotsByRows();

        rows.forEach((row, rowIndex) => {
            if (row.length < 2) return;

            const sorted = [...row].sort((a, b) => a.x - b.x);

            for (let i = 0; i < sorted.length - 1; i++) {
                const current = sorted[i];
                const next = sorted[i + 1];
                const currentRight = current.x + current.width;
                const gap = next.x - currentRight;

                if (gap < (this.margin + this.corridorWidth)) continue;

                const corridorX = currentRight + this.margin;
                const minY = Math.min(current.y, next.y);
                const maxY = Math.max(current.y + current.height, next.y + next.height);
                const corridorHeight = maxY - minY;

                if (corridorHeight < this.minCorridorLength) continue;

                corridors.push({
                    id: `v_${rowIndex}_${i}`,
                    type: 'vertical',
                    x: corridorX,
                    y: minY,
                    width: this.corridorWidth,
                    height: corridorHeight,
                    corners: [
                        [corridorX, minY],
                        [corridorX, maxY],
                        [corridorX + this.corridorWidth, maxY],
                        [corridorX + this.corridorWidth, minY]
                    ]
                });
            }
        });

        return corridors;
    }

    /**
     * Generate horizontal corridors between columns of îlots
     * @returns {Array} Horizontal corridor segments
     */
    generateHorizontalCorridors() {
        const corridors = [];
        const columns = this.groupIlotsByColumns();

        columns.forEach((column, colIndex) => {
            if (column.length < 2) return;

            const sorted = [...column].sort((a, b) => a.y - b.y);

            for (let i = 0; i < sorted.length - 1; i++) {
                const current = sorted[i];
                const next = sorted[i + 1];
                const currentBottom = current.y + current.height;
                const gap = next.y - currentBottom;

                if (gap < (this.margin + this.corridorWidth)) continue;

                const corridorY = currentBottom + this.margin;
                const minX = Math.min(current.x, next.x);
                const maxX = Math.max(current.x + current.width, next.x + next.width);
                const corridorWidth = maxX - minX;

                if (corridorWidth < this.minCorridorLength) continue;

                corridors.push({
                    id: `h_${colIndex}_${i}`,
                    type: 'horizontal',
                    x: minX,
                    y: corridorY,
                    width: corridorWidth,
                    height: this.corridorWidth,
                    corners: [
                        [minX, corridorY],
                        [maxX, corridorY],
                        [maxX, corridorY + this.corridorWidth],
                        [minX, corridorY + this.corridorWidth]
                    ]
                });
            }
        });

        return corridors;
    }

    /**
     * Generate perimeter corridors around the edges
     * @returns {Array} Perimeter corridor segments
     */
    generatePerimeterCorridors() {
        const corridors = [];
        const bounds = this.bounds;
        const margin = 1.5; // Distance from wall

        // Check if there's space for perimeter corridors
        const hasTopSpace = this.checkSpaceForPerimeter('top', margin);
        const hasBottomSpace = this.checkSpaceForPerimeter('bottom', margin);
        const hasLeftSpace = this.checkSpaceForPerimeter('left', margin);
        const hasRightSpace = this.checkSpaceForPerimeter('right', margin);

        // Top perimeter
        if (hasTopSpace) {
            const y = bounds.maxY - margin - this.corridorWidth;
            corridors.push({
                id: 'perimeter_top',
                type: 'horizontal',
                x: bounds.minX + margin,
                y: y,
                width: (bounds.maxX - bounds.minX) - 2 * margin,
                height: this.corridorWidth,
                corners: [
                    [bounds.minX + margin, y],
                    [bounds.maxX - margin, y],
                    [bounds.maxX - margin, y + this.corridorWidth],
                    [bounds.minX + margin, y + this.corridorWidth]
                ]
            });
        }

        // Bottom perimeter
        if (hasBottomSpace) {
            const y = bounds.minY + margin;
            corridors.push({
                id: 'perimeter_bottom',
                type: 'horizontal',
                x: bounds.minX + margin,
                y: y,
                width: (bounds.maxX - bounds.minX) - 2 * margin,
                height: this.corridorWidth,
                corners: [
                    [bounds.minX + margin, y],
                    [bounds.maxX - margin, y],
                    [bounds.maxX - margin, y + this.corridorWidth],
                    [bounds.minX + margin, y + this.corridorWidth]
                ]
            });
        }

        // Left perimeter
        if (hasLeftSpace) {
            const x = bounds.minX + margin;
            corridors.push({
                id: 'perimeter_left',
                type: 'vertical',
                x: x,
                y: bounds.minY + margin,
                width: this.corridorWidth,
                height: (bounds.maxY - bounds.minY) - 2 * margin,
                corners: [
                    [x, bounds.minY + margin],
                    [x, bounds.maxY - margin],
                    [x + this.corridorWidth, bounds.maxY - margin],
                    [x + this.corridorWidth, bounds.minY + margin]
                ]
            });
        }

        // Right perimeter
        if (hasRightSpace) {
            const x = bounds.maxX - margin - this.corridorWidth;
            corridors.push({
                id: 'perimeter_right',
                type: 'vertical',
                x: x,
                y: bounds.minY + margin,
                width: this.corridorWidth,
                height: (bounds.maxY - bounds.minY) - 2 * margin,
                corners: [
                    [x, bounds.minY + margin],
                    [x, bounds.maxY - margin],
                    [x + this.corridorWidth, bounds.maxY - margin],
                    [x + this.corridorWidth, bounds.minY + margin]
                ]
            });
        }

        return corridors;
    }

    /**
     * Check if there's space for a perimeter corridor
     * @param {string} side - 'top', 'bottom', 'left', or 'right'
     * @param {number} margin - Margin from edge
     * @returns {boolean} True if space available
     */
    checkSpaceForPerimeter(side, margin) {
        const bounds = this.bounds;
        const threshold = margin + this.corridorWidth + 0.5;

        for (const ilot of this.ilots) {
            switch (side) {
                case 'top':
                    if (ilot.y + ilot.height > bounds.maxY - threshold) return false;
                    break;
                case 'bottom':
                    if (ilot.y < bounds.minY + threshold) return false;
                    break;
                case 'left':
                    if (ilot.x < bounds.minX + threshold) return false;
                    break;
                case 'right':
                    if (ilot.x + ilot.width > bounds.maxX - threshold) return false;
                    break;
            }
        }
        return true;
    }

    /**
     * Detect isolated îlots that have no adjacent or overlapping corridor segments
     * @param {Array} corridors - Array of corridor segments
     * @returns {Object} Object with isolated îlots and connectivity information
     */
    detectIsolatedÎlots(corridors) {
        const isolatedÎlots = [];
        const connectedÎlots = [];
        const proximityThreshold = this.margin + 0.5; // Slightly larger than margin for detection

        for (const îlot of this.ilots) {
            let isConnected = false;

            // Check if îlot is adjacent to or overlaps with any corridor
            for (const corridor of corridors) {
                if (this._isÎlotAdjacentToCorridor(îlot, corridor, proximityThreshold)) {
                    isConnected = true;
                    break;
                }
            }

            if (isConnected) {
                connectedÎlots.push(îlot);
            } else {
                isolatedÎlots.push(îlot);
            }
        }

        console.log(
            `[Corridor Network] Îlot connectivity: ${connectedÎlots.length} connected, ` +
            `${isolatedÎlots.length} isolated`
        );

        return {
            isolatedÎlots,
            connectedÎlots,
            totalÎlots: this.ilots.length,
            isolationRate: this.ilots.length > 0 ? isolatedÎlots.length / this.ilots.length : 0
        };
    }

    /**
     * Check if an îlot is adjacent to or overlaps with a corridor
     * @param {Object} îlot - Îlot with x, y, width, height
     * @param {Object} corridor - Corridor with x, y, width, height
     * @param {number} threshold - Proximity threshold for adjacency detection
     * @returns {boolean} True if îlot is adjacent to or overlaps with corridor
     */
    _isÎlotAdjacentToCorridor(îlot, corridor, threshold) {
        // Calculate îlot bounds
        const îlotLeft = îlot.x;
        const îlotRight = îlot.x + îlot.width;
        const îlotTop = îlot.y;
        const îlotBottom = îlot.y + îlot.height;

        // Calculate corridor bounds
        const corridorLeft = corridor.x;
        const corridorRight = corridor.x + corridor.width;
        const corridorTop = corridor.y;
        const corridorBottom = corridor.y + corridor.height;

        // Check for overlap (îlot intersects corridor)
        const hasOverlap = !(
            îlotRight < corridorLeft ||
            îlotLeft > corridorRight ||
            îlotBottom < corridorTop ||
            îlotTop > corridorBottom
        );

        if (hasOverlap) {
            return true;
        }

        // Check for adjacency (îlot is within threshold distance of corridor)
        // Horizontal adjacency (îlot to left or right of corridor)
        const horizontallyAligned = !(îlotBottom < corridorTop || îlotTop > corridorBottom);
        if (horizontallyAligned) {
            // Calculate horizontal gap
            let horizontalGap;
            if (îlotRight <= corridorLeft) {
                // Îlot is to the left of corridor
                horizontalGap = corridorLeft - îlotRight;
            } else if (îlotLeft >= corridorRight) {
                // Îlot is to the right of corridor
                horizontalGap = îlotLeft - corridorRight;
            } else {
                // They overlap horizontally (already handled above, but just in case)
                horizontalGap = 0;
            }
            
            if (horizontalGap <= threshold) {
                return true;
            }
        }

        // Vertical adjacency (îlot above or below corridor)
        const verticallyAligned = !(îlotRight < corridorLeft || îlotLeft > corridorRight);
        if (verticallyAligned) {
            // Calculate vertical gap
            let verticalGap;
            if (îlotBottom <= corridorTop) {
                // Îlot is above corridor
                verticalGap = corridorTop - îlotBottom;
            } else if (îlotTop >= corridorBottom) {
                // Îlot is below corridor
                verticalGap = îlotTop - corridorBottom;
            } else {
                // They overlap vertically (already handled above, but just in case)
                verticalGap = 0;
            }
            
            if (verticalGap <= threshold) {
                return true;
            }
        }

        return false;
    }

    /**
     * Validate corridor network connectivity and bridge gaps if needed.
     * Implements post-generation validation loop to ensure full connectivity.
     * 
     * @param {Array} corridors - Initial corridor segments
     * @returns {Array} Corridors with bridging corridors added if needed
     */
    validateAndBridgeConnectivity(corridors) {
        const maxIterations = 10; // Maximum number of bridging attempts
        let iteration = 0;
        let currentCorridors = [...corridors];
        
        // Create a minimal floor plan object for connectivity detection
        // Use floorPlan properties if available, otherwise use defaults
        const floorPlan = {
            bounds: this.bounds,
            walls: (this.floorPlan && this.floorPlan.walls) ? this.floorPlan.walls : [],
            forbiddenZones: (this.floorPlan && this.floorPlan.forbiddenZones) ? this.floorPlan.forbiddenZones : [],
            entrances: (this.floorPlan && this.floorPlan.entrances) ? this.floorPlan.entrances : []
        };

        // Create CirculationRouter instance for connectivity detection
        const circulationRouter = new CirculationRouter(floorPlan, {
            corridorWidth: this.corridorWidth
        });

        console.log('[Corridor Network] Starting post-generation validation loop');

        while (iteration < maxIterations) {
            iteration++;

            // Decompose L-shaped corridors into horizontal and vertical segments for connectivity analysis
            const decomposedCorridors = this._decomposeCorridors(currentCorridors);

            // Run connectivity detection
            const connectivityAnalysis = circulationRouter.detectConnectivity(
                decomposedCorridors,
                this.ilots,
                floorPlan.entrances
            );

            const {
                isFullyConnected,
                disconnectedComponents,
                unreachableÎlots,
                unreachableFromEntrances,
                totalComponents
            } = connectivityAnalysis;

            console.log(
                `[Corridor Network] Iteration ${iteration}: ` +
                `${totalComponents} component(s), ` +
                `${unreachableÎlots.length} unreachable îlot(s), ` +
                `${unreachableFromEntrances.length} unreachable node(s)`
            );

            // Check if network is fully connected
            // If there are no entrances, we only check for disconnected components and unreachable îlots
            const hasEntrances = floorPlan.entrances && floorPlan.entrances.length > 0;
            const isConnectedEnough = hasEntrances 
                ? isFullyConnected 
                : (totalComponents <= 1 && unreachableÎlots.length === 0);
            
            if (isConnectedEnough) {
                console.log(
                    `[Corridor Network] Network is fully connected after ${iteration} iteration(s)`
                );
                break;
            }

            // If disconnected components exist, generate bridging corridors
            if (disconnectedComponents.length > 1) {
                const bridgingCorridors = CorridorRouter.generateBridgingCorridors(
                    decomposedCorridors,
                    floorPlan,
                    disconnectedComponents,
                    { corridorWidth: this.corridorWidth }
                );

                if (bridgingCorridors.length === 0) {
                    console.warn(
                        `[Corridor Network] Unable to generate bridging corridors at iteration ${iteration}. ` +
                        `Network has ${totalComponents} disconnected component(s).`
                    );
                    break;
                }

                console.log(
                    `[Corridor Network] Generated ${bridgingCorridors.length} bridging corridor(s) ` +
                    `at iteration ${iteration}`
                );

                // Add bridging corridors to the network
                currentCorridors = [...currentCorridors, ...bridgingCorridors];
            } else {
                // No disconnected components but still not fully connected
                // This might happen if there are unreachable îlots or entrance issues
                console.warn(
                    `[Corridor Network] Network has single component but ${unreachableÎlots.length} ` +
                    `unreachable îlot(s) and ${unreachableFromEntrances.length} unreachable node(s)`
                );
                break;
            }
        }

        // Final connectivity check
        const finalDecomposed = this._decomposeCorridors(currentCorridors);
        const finalAnalysis = circulationRouter.detectConnectivity(
            finalDecomposed,
            this.ilots,
            floorPlan.entrances
        );

        const hasEntrances = floorPlan.entrances && floorPlan.entrances.length > 0;
        const finallyConnected = hasEntrances 
            ? finalAnalysis.isFullyConnected 
            : (finalAnalysis.totalComponents <= 1 && finalAnalysis.unreachableÎlots.length === 0);

        if (!finallyConnected) {
            console.warn(
                `[Corridor Network] WARNING: Full connectivity could not be achieved after ${iteration} iteration(s). ` +
                `Network has ${finalAnalysis.totalComponents} component(s), ` +
                `${finalAnalysis.unreachableÎlots.length} unreachable îlot(s)` +
                (hasEntrances ? `, ${finalAnalysis.unreachableFromEntrances.length} unreachable node(s).` : '.')
            );
        }

        // Step 6: Ensure all entrances connect to the main component
        if (hasEntrances) {
            console.log('[Corridor Network] Validating entrance connectivity to main component');
            currentCorridors = this.ensureEntranceConnectivity(currentCorridors, floorPlan, circulationRouter);
        }

        return currentCorridors;
    }
    /**
     * Ensure all entrances are connected to the main component.
     * After connecting entrance to nearest corridor node, verify node is in main component.
     * If not, find nearest node in main component and create connection.
     *
     * @param {Array} corridors - Current corridor segments
     * @param {Object} floorPlan - Floor plan with entrances
     * @param {Object} circulationRouter - CirculationRouter instance
     * @returns {Array} Corridors with entrance bridging corridors added if needed
     */
    ensureEntranceConnectivity(corridors, floorPlan, circulationRouter) {
        const entrances = floorPlan.entrances;

        if (!entrances || entrances.length === 0) {
            console.log('[Corridor Network] No entrances to connect');
            return corridors;
        }

        // Decompose corridors for connectivity analysis
        const decomposedCorridors = this._decomposeCorridors(corridors);

        // Run connectivity detection to identify components
        const connectivityAnalysis = circulationRouter.detectConnectivity(
            decomposedCorridors,
            this.ilots,
            entrances
        );

        const { disconnectedComponents, totalComponents } = connectivityAnalysis;

        if (totalComponents <= 1) {
            console.log('[Corridor Network] Single component - all entrances can reach all areas');
            return corridors;
        }

        // Find the main component (largest by node count)
        let mainComponent = null;
        let maxNodes = 0;
        for (const component of disconnectedComponents) {
            if (component.nodes.length > maxNodes) {
                maxNodes = component.nodes.length;
                mainComponent = component;
            }
        }

        if (!mainComponent) {
            console.warn('[Corridor Network] No main component found');
            return corridors;
        }

        console.log(
            `[Corridor Network] Main component has ${mainComponent.nodes.length} nodes, ` +
            `${totalComponents} total component(s)`
        );

        // Build centerline graph to find entrance nodes
        const axisSegments = circulationRouter._buildCenterlineSegments(decomposedCorridors);
        const { nodes } = circulationRouter._buildCenterlineGraph(axisSegments);

        // For each entrance, verify it connects to the main component
        const entranceBridges = [];
        const entrancePoints = this._getEntrancePointsFromArray(entrances);

        for (const entPoint of entrancePoints) {
            // Find nearest node to entrance
            const nearestNode = this._findNearestNode(nodes, entPoint);
            if (!nearestNode) {
                console.warn(`[Corridor Network] No nearest node found for entrance at (${entPoint.x}, ${entPoint.y})`);
                continue;
            }

            // Check if nearest node is in main component
            const isInMainComponent = mainComponent.nodeKeys.includes(nearestNode.key);

            if (isInMainComponent) {
                console.log(
                    `[Corridor Network] Entrance at (${entPoint.x}, ${entPoint.y}) ` +
                    `already connects to main component via node ${nearestNode.key}`
                );
                continue;
            }

            // Entrance connects to a non-main component, need to bridge to main component
            console.log(
                `[Corridor Network] Entrance at (${entPoint.x}, ${entPoint.y}) ` +
                `connects to isolated component, bridging to main component`
            );

            // Find nearest node in main component
            let nearestMainNode = null;
            let minDist = Infinity;
            for (const nodeKey of mainComponent.nodeKeys) {
                const node = nodes.get(nodeKey);
                if (!node) continue;

                const dist = Math.hypot(node.x - entPoint.x, node.y - entPoint.y);
                if (dist < minDist) {
                    minDist = dist;
                    nearestMainNode = node;
                }
            }

            if (!nearestMainNode) {
                console.warn(
                    `[Corridor Network] No node found in main component for entrance at ` +
                    `(${entPoint.x}, ${entPoint.y})`
                );
                continue;
            }

            // Create bridging corridor from entrance to main component node
            // Prefer axis-aligned corridors (horizontal or vertical)
            const dx = Math.abs(nearestMainNode.x - entPoint.x);
            const dy = Math.abs(nearestMainNode.y - entPoint.y);

            if (dx < 0.1) {
                // Vertical corridor
                const minY = Math.min(entPoint.y, nearestMainNode.y);
                const maxY = Math.max(entPoint.y, nearestMainNode.y);
                entranceBridges.push({
                    id: `entrance_bridge_v_${entPoint.x}_${entPoint.y}`,
                    type: 'vertical',
                    x: entPoint.x - this.corridorWidth / 2,
                    y: minY,
                    width: this.corridorWidth,
                    height: maxY - minY,
                    isBridge: true,
                    isEntranceBridge: true,
                    corners: [
                        [entPoint.x - this.corridorWidth / 2, minY],
                        [entPoint.x - this.corridorWidth / 2, maxY],
                        [entPoint.x + this.corridorWidth / 2, maxY],
                        [entPoint.x + this.corridorWidth / 2, minY]
                    ]
                });
            } else if (dy < 0.1) {
                // Horizontal corridor
                const minX = Math.min(entPoint.x, nearestMainNode.x);
                const maxX = Math.max(entPoint.x, nearestMainNode.x);
                entranceBridges.push({
                    id: `entrance_bridge_h_${entPoint.x}_${entPoint.y}`,
                    type: 'horizontal',
                    x: minX,
                    y: entPoint.y - this.corridorWidth / 2,
                    width: maxX - minX,
                    height: this.corridorWidth,
                    isBridge: true,
                    isEntranceBridge: true,
                    corners: [
                        [minX, entPoint.y - this.corridorWidth / 2],
                        [maxX, entPoint.y - this.corridorWidth / 2],
                        [maxX, entPoint.y + this.corridorWidth / 2],
                        [minX, entPoint.y + this.corridorWidth / 2]
                    ]
                });
            } else {
                // L-shaped corridor (horizontal then vertical, or vice versa)
                // Choose the orientation that minimizes total length
                const horizontalFirst = dx > dy;

                if (horizontalFirst) {
                    // Horizontal segment from entrance to intermediate point
                    const midX = nearestMainNode.x;
                    const midY = entPoint.y;

                    entranceBridges.push({
                        id: `entrance_bridge_l_${entPoint.x}_${entPoint.y}`,
                        type: 'l-shaped',
                        isBridge: true,
                        isEntranceBridge: true,
                        corners: [
                            [entPoint.x, entPoint.y - this.corridorWidth / 2],
                            [midX, midY - this.corridorWidth / 2],
                            [midX, nearestMainNode.y],
                            [midX + this.corridorWidth, nearestMainNode.y],
                            [midX + this.corridorWidth, midY + this.corridorWidth / 2],
                            [entPoint.x, midY + this.corridorWidth / 2]
                        ]
                    });
                } else {
                    // Vertical segment from entrance to intermediate point
                    const midX = entPoint.x;
                    const midY = nearestMainNode.y;

                    entranceBridges.push({
                        id: `entrance_bridge_l_${entPoint.x}_${entPoint.y}`,
                        type: 'l-shaped',
                        isBridge: true,
                        isEntranceBridge: true,
                        corners: [
                            [entPoint.x - this.corridorWidth / 2, entPoint.y],
                            [midX - this.corridorWidth / 2, midY],
                            [nearestMainNode.x, midY],
                            [nearestMainNode.x, midY + this.corridorWidth],
                            [midX + this.corridorWidth / 2, midY + this.corridorWidth],
                            [midX + this.corridorWidth / 2, entPoint.y]
                        ]
                    });
                }
            }

            console.log(
                `[Corridor Network] Created entrance bridge from (${entPoint.x}, ${entPoint.y}) ` +
                `to main component node at (${nearestMainNode.x}, ${nearestMainNode.y})`
            );
        }

        if (entranceBridges.length > 0) {
            console.log(`[Corridor Network] Added ${entranceBridges.length} entrance bridge(s)`);
            return [...corridors, ...entranceBridges];
        }

        return corridors;
    }

    /**
     * Helper to extract entrance points from an array of entrance objects.
     * @param {Array} entrances - Array of entrance objects
     * @returns {Array} Array of {x, y} points
     */
    _getEntrancePointsFromArray(entrances) {
        const points = [];
        for (const ent of entrances) {
            if (ent && typeof ent.x === 'number' && typeof ent.y === 'number') {
                points.push({ x: ent.x, y: ent.y });
            }
        }
        return points;
    }

    /**
     * Find the nearest node to a given point.
     * @param {Map} nodes - Map of graph nodes
     * @param {Object} point - Point with x, y coordinates
     * @returns {Object|null} Nearest node or null if no nodes
     */
    _findNearestNode(nodes, point) {
        let nearest = null;
        let minDist = Infinity;

        for (const node of nodes.values()) {
            const dist = Math.hypot(node.x - point.x, node.y - point.y);
            if (dist < minDist) {
                minDist = dist;
                nearest = node;
            }
        }

        return nearest;
    }

    /**
     * Decompose L-shaped corridors into separate horizontal and vertical segments.
     * This is needed for connectivity analysis which expects axis-aligned rectangles.
     * 
     * @param {Array} corridors - Array of corridor segments (may include L-shaped)
     * @returns {Array} Array of decomposed corridor segments (all rectangular)
     */
    _decomposeCorridors(corridors) {
        const decomposed = [];
        
        for (const corridor of corridors) {
            if (corridor.type === 'l-shaped' && corridor.corners && corridor.corners.length >= 4) {
                // L-shaped corridor needs to be decomposed into horizontal and vertical segments
                // The corners define the path of the L-shape
                // We need to create two rectangles: one horizontal and one vertical
                
                const corners = corridor.corners;
                
                // Find the bend point (where horizontal meets vertical)
                // For an L-shape, we have at least 4 corners
                // Typically: start -> horizontal -> bend -> vertical -> end
                
                // Extract unique X and Y coordinates
                const xCoords = [...new Set(corners.map(c => c[0]))].sort((a, b) => a - b);
                const yCoords = [...new Set(corners.map(c => c[1]))].sort((a, b) => a - b);
                
                if (xCoords.length >= 2 && yCoords.length >= 2) {
                    // Create horizontal segment
                    const hMinX = Math.min(...xCoords);
                    const hMaxX = Math.max(...xCoords);
                    const hY = yCoords[0]; // Use first Y coordinate for horizontal segment
                    
                    decomposed.push({
                        id: `${corridor.id}_h`,
                        type: 'horizontal',
                        x: hMinX,
                        y: hY,
                        width: hMaxX - hMinX,
                        height: this.corridorWidth,
                        isBridge: corridor.isBridge,
                        corners: [
                            [hMinX, hY],
                            [hMaxX, hY],
                            [hMaxX, hY + this.corridorWidth],
                            [hMinX, hY + this.corridorWidth]
                        ]
                    });
                    
                    // Create vertical segment
                    const vX = xCoords[xCoords.length - 1]; // Use last X coordinate for vertical segment
                    const vMinY = Math.min(...yCoords);
                    const vMaxY = Math.max(...yCoords);
                    
                    decomposed.push({
                        id: `${corridor.id}_v`,
                        type: 'vertical',
                        x: vX,
                        y: vMinY,
                        width: this.corridorWidth,
                        height: vMaxY - vMinY,
                        isBridge: corridor.isBridge,
                        corners: [
                            [vX, vMinY],
                            [vX, vMaxY],
                            [vX + this.corridorWidth, vMaxY],
                            [vX + this.corridorWidth, vMinY]
                        ]
                    });
                }
            } else {
                // Regular horizontal or vertical corridor, keep as-is
                decomposed.push(corridor);
            }
        }
        
        return decomposed;
    }

    /**
     * Connect corridor segments into continuous paths
     * @param {Array} corridors - Array of corridor segments
     * @returns {Array} Connected corridor paths
     */
    connectCorridorPaths(corridors) {
        // Decompose L-shaped corridors into horizontal and vertical segments
        // This ensures that all returned corridors are axis-aligned rectangles
        const decomposed = this._decomposeCorridors(corridors);
        
        // For now, return corridors as-is with proper corner structure
        // Future enhancement: merge adjacent corridors into single paths
        return decomposed.map(corridor => ({
            ...corridor,
            // Ensure corners are in correct format for rendering
            corners: corridor.corners || this.rectangleToCorners(corridor)
        }));
    }

    /**
     * Convert rectangle corridor to corner points
     * @param {Object} corridor - Corridor with x, y, width, height
     * @returns {Array} Array of corner points
     */
    rectangleToCorners(corridor) {
        return [
            [corridor.x, corridor.y],
            [corridor.x + corridor.width, corridor.y],
            [corridor.x + corridor.width, corridor.y + corridor.height],
            [corridor.x, corridor.y + corridor.height]
        ];
    }

    /**
     * Group îlots by rows (similar Y coordinates)
     * @returns {Array} Array of row groups
     */
    groupIlotsByRows() {
        const rows = {};
        const tolerance = 1.0;

        this.ilots.forEach(ilot => {
            const pos = ilot.y;
            let foundKey = null;

            for (const key of Object.keys(rows)) {
                if (Math.abs(Number(key) - pos) < tolerance) {
                    foundKey = key;
                    break;
                }
            }

            if (foundKey !== null) {
                rows[foundKey].push(ilot);
            } else {
                rows[pos] = [ilot];
            }
        });

        return Object.values(rows);
    }

    /**
     * Group îlots by columns (similar X coordinates)
     * @returns {Array} Array of column groups
     */
    groupIlotsByColumns() {
        const columns = {};
        const tolerance = 1.0;

        this.ilots.forEach(ilot => {
            const pos = ilot.x;
            let foundKey = null;

            for (const key of Object.keys(columns)) {
                if (Math.abs(Number(key) - pos) < tolerance) {
                    foundKey = key;
                    break;
                }
            }

            if (foundKey !== null) {
                columns[foundKey].push(ilot);
            } else {
                columns[pos] = [ilot];
            }
        });

        return Object.values(columns);
    }
}

module.exports = AdvancedCorridorNetworkGenerator;
