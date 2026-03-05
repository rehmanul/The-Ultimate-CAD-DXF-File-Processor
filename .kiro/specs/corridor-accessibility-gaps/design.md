# Corridor Accessibility Gaps Bugfix Design

## Overview

The corridor routing system generates circulation networks with horizontal and vertical corridors but fails to ensure complete accessibility coverage. The bug manifests as disconnected corridor segments, isolated îlots, and unreachable areas that cannot be accessed from entrances. This fix will implement connectivity validation and gap-bridging logic to ensure all accessible areas are reachable through a fully connected circulation network.

The fix strategy involves: (1) detecting disconnected graph components after corridor generation, (2) identifying isolated îlots and corridor segments, (3) generating bridging corridors to connect disconnected regions, (4) validating reachability from entrances, and (5) ensuring all accessible areas have valid circulation paths.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug - when the corridor generation system produces disconnected circulation networks with unreachable areas
- **Property (P)**: The desired behavior - all accessible areas must be reachable from at least one entrance through connected corridor segments
- **Preservation**: Existing corridor generation logic (horizontal/vertical corridor creation, wall-crossing checks, corridor merging, entrance routing) that must remain unchanged
- **Îlot**: A building block or space unit in the floor plan that needs corridor access
- **Circulation Network**: The graph of corridor segments represented as nodes and edges
- **Disconnected Component**: A subgraph of the circulation network that has no path to other components
- **Reachability Analysis**: Graph traversal (BFS/DFS) to determine which areas can be reached from entrances
- **Bridging Corridor**: A corridor segment generated specifically to connect disconnected components
- **corridorGenerator.js**: Module that generates basic horizontal and vertical corridors
- **advancedCorridorGenerator.js**: Module with enhanced corridor generation logic
- **advancedCorridorNetworkGenerator.js**: Module that builds corridor networks
- **corridorRouter.js**: Module that routes corridors and handles geometry
- **circulationRouter.js**: Module in costo-engine that builds centerline graphs and validates circulation

## Bug Details

### Fault Condition

The bug manifests when the corridor generation system produces a circulation network where some areas are unreachable from entrances. This occurs because the system generates corridor segments independently (horizontal corridors between facing rows, vertical corridors in column gaps) without validating that these segments form a connected graph or that all îlots are accessible.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type FloorPlanWithCorridors
  OUTPUT: boolean
  
  LET corridorGraph = buildCirculationGraph(input.corridors)
  LET entranceNodes = getEntranceNodes(input.entrances, corridorGraph)
  LET allÎlots = input.îlots
  LET disconnectedComponents = findDisconnectedComponents(corridorGraph)
  LET unreachableÎlots = findUnreachableÎlots(allÎlots, corridorGraph, entranceNodes)
  
  RETURN (disconnectedComponents.length > 1)
         OR (unreachableÎlots.length > 0)
         OR (NOT allAreasReachableFromEntrances(corridorGraph, entranceNodes))
END FUNCTION
```

### Examples

- **Isolated Îlot Cluster**: A group of îlots in the corner of the floor plan has no horizontal or vertical corridor connecting it to the main circulation network. Users cannot navigate to this area from the entrance.

- **Unbridged Gap**: Horizontal corridors exist on the left side and right side of the floor plan, but there is no vertical corridor bridging the gap between them. The two corridor segments form disconnected components.

- **Unreachable Corridor Segment**: A vertical corridor exists between two îlots, but it is not connected to any horizontal corridor that leads to an entrance. The corridor segment is isolated and unreachable.

- **Edge Case - Single Entrance**: A floor plan with one entrance has multiple corridor segments, but only one segment is connected to the entrance. Other segments remain disconnected and inaccessible.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Horizontal corridor generation between facing rows with sufficient overlap must continue to work with correct dimensions and positioning
- Vertical corridor generation in gaps between îlots must continue to respect minimum gap requirements and corridor width constraints
- Wall-crossing checks must continue to prevent corridors from crossing walls or forbidden zones
- Corridor merging and optimization must continue to remove redundant corridors and merge adjacent segments
- Entrance connection routing (L-shaped, Manhattan) must continue to generate wall-safe entrance links
- Flow arrow orientation must continue to point from entry to exit points

**Scope:**
All inputs that do NOT involve disconnected circulation networks should be completely unaffected by this fix. This includes:
- Floor plans where corridors are already fully connected
- Corridor generation logic for individual horizontal and vertical segments
- Wall-crossing validation and forbidden zone checks
- Corridor geometry calculations and merging operations
- Entrance routing and connection logic

## Hypothesized Root Cause

Based on the bug description, the most likely issues are:

1. **Missing Connectivity Validation**: The corridor generation modules create horizontal and vertical corridors independently without checking if the resulting network forms a connected graph. There is no post-generation validation step that detects disconnected components.

2. **Insufficient Gap Bridging Logic**: The vertical corridor generation logic may only create corridors in direct column gaps but fails to identify and bridge larger gaps between disconnected corridor segments that require longer connecting corridors.

3. **No Reachability Analysis**: The system does not perform graph traversal (BFS/DFS) from entrance nodes to verify that all corridor segments and îlots are reachable. Without this analysis, isolated regions go undetected.

4. **Isolated Îlot Detection Missing**: The system does not check whether each îlot is connected to at least one corridor segment. Îlots that fall outside the horizontal/vertical corridor generation patterns remain isolated.

5. **Component Unification Not Implemented**: Even if disconnected components are detected, there is no algorithm to generate bridging corridors that connect these components into a unified network.

6. **Entrance Connection Validation Incomplete**: The entrance connection logic may connect entrances to the nearest corridor node without verifying that this node is part of the main connected component, leaving other components unreachable.

## Correctness Properties

Property 1: Fault Condition - Complete Accessibility Coverage

_For any_ floor plan where the bug condition holds (disconnected corridor components or unreachable îlots exist), the fixed corridor generation system SHALL detect disconnected components, generate bridging corridors to connect them, and ensure all accessible areas are reachable from at least one entrance through the circulation network.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

Property 2: Preservation - Existing Corridor Generation Logic

_For any_ floor plan where the bug condition does NOT hold (corridors are already fully connected), the fixed system SHALL produce exactly the same corridor network as the original system, preserving all existing corridor generation, wall-crossing checks, merging, and entrance routing behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**Primary Files**: 
- `advancedCorridorNetworkGenerator.js` (main coordination logic)
- `circulationRouter.js` (graph building and validation)
- `corridorRouter.js` (bridging corridor generation)

**Specific Changes**:

1. **Add Connectivity Detection**: Implement graph analysis to detect disconnected components
   - After corridor generation, build the circulation graph from corridor segments
   - Use union-find or DFS to identify disconnected components
   - Return list of components with their nodes and îlots

2. **Implement Reachability Analysis**: Add entrance-based reachability validation
   - Perform BFS/DFS from entrance nodes to find all reachable corridor nodes
   - Identify unreachable corridor segments and îlots
   - Return list of unreachable regions

3. **Add Isolated Îlot Detection**: Check îlot-to-corridor connectivity
   - For each îlot, check if it is adjacent to or overlaps with any corridor segment
   - Identify îlots with no corridor access
   - Prioritize these îlots for bridging corridor generation

4. **Implement Gap Bridging Algorithm**: Generate connecting corridors between disconnected components
   - Find closest pairs of nodes between disconnected components
   - Generate horizontal or vertical bridging corridors (prefer axis-aligned)
   - Validate that bridging corridors do not cross walls or forbidden zones
   - Add bridging corridors to the network and re-validate connectivity

5. **Add Post-Generation Validation**: Implement validation loop after corridor generation
   - After initial corridor generation, run connectivity detection
   - If disconnected components exist, run gap bridging algorithm
   - Repeat until network is fully connected or maximum iterations reached
   - Log warnings if full connectivity cannot be achieved

6. **Enhance Entrance Connection Logic**: Ensure entrances connect to main component
   - After connecting entrance to nearest corridor node, verify node is in main component
   - If not, find nearest node in main component and create connection
   - Validate that all entrances can reach all corridor segments

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code (disconnected networks, unreachable areas), then verify the fix correctly detects and bridges gaps while preserving existing corridor generation behavior.

### Exploratory Fault Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Create floor plans with known connectivity issues (isolated îlots, disconnected corridor segments, unbridged gaps) and run the UNFIXED corridor generation system. Assert that the resulting circulation network has disconnected components or unreachable areas. Analyze the output to confirm root causes.

**Test Cases**:
1. **Isolated Îlot Test**: Create floor plan with îlot cluster in corner with no adjacent corridors (will fail on unfixed code - îlots remain isolated)
2. **Unbridged Gap Test**: Create floor plan with horizontal corridors on left and right but no vertical bridge (will fail on unfixed code - disconnected components)
3. **Unreachable Segment Test**: Create floor plan with vertical corridor not connected to entrance-accessible corridors (will fail on unfixed code - segment unreachable)
4. **Multiple Entrance Test**: Create floor plan with multiple entrances where some connect to isolated components (will fail on unfixed code - some areas unreachable from some entrances)

**Expected Counterexamples**:
- Circulation graph has multiple disconnected components (component count > 1)
- BFS/DFS from entrance nodes does not reach all corridor segments
- Some îlots have no adjacent corridor segments
- Possible causes: missing connectivity validation, no gap bridging logic, no reachability analysis

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior (fully connected circulation network).

**Pseudocode:**
```
FOR ALL floorPlan WHERE isBugCondition(floorPlan) DO
  corridorNetwork := generateCorridors_fixed(floorPlan)
  ASSERT isFullyConnected(corridorNetwork)
  ASSERT allÎlotsReachable(floorPlan.îlots, corridorNetwork)
  ASSERT allAreasReachableFromEntrances(corridorNetwork, floorPlan.entrances)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL floorPlan WHERE NOT isBugCondition(floorPlan) DO
  originalNetwork := generateCorridors_original(floorPlan)
  fixedNetwork := generateCorridors_fixed(floorPlan)
  ASSERT corridorSegmentsEqual(originalNetwork, fixedNetwork)
  ASSERT entranceConnectionsEqual(originalNetwork, fixedNetwork)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many floor plan configurations automatically across the input domain
- It catches edge cases that manual unit tests might miss (different îlot arrangements, entrance positions, wall configurations)
- It provides strong guarantees that existing corridor generation behavior is unchanged for already-connected networks

**Test Plan**: Observe behavior on UNFIXED code first for floor plans with already-connected corridors, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Horizontal Corridor Preservation**: Observe that horizontal corridors between facing rows are generated correctly on unfixed code, then verify same corridors are generated after fix
2. **Vertical Corridor Preservation**: Observe that vertical corridors in column gaps are generated correctly on unfixed code, then verify same corridors are generated after fix
3. **Wall-Crossing Preservation**: Observe that wall-crossing checks prevent invalid corridors on unfixed code, then verify same validation occurs after fix
4. **Entrance Routing Preservation**: Observe that entrance connections use L-shaped/Manhattan routing on unfixed code, then verify same routing after fix

### Unit Tests

- Test connectivity detection algorithm with known disconnected graphs
- Test reachability analysis (BFS/DFS) from entrance nodes
- Test isolated îlot detection with various îlot arrangements
- Test gap bridging algorithm with different component configurations
- Test edge cases (single entrance, no entrances, single corridor segment)
- Test validation loop termination conditions

### Property-Based Tests

- Generate random floor plans with varying îlot counts and positions, verify all îlots are reachable after fix
- Generate random corridor networks with disconnected components, verify fix connects them
- Generate random already-connected floor plans, verify preservation of existing corridors
- Test across many entrance configurations to ensure all entrances can reach all areas

### Integration Tests

- Test full corridor generation flow with complex floor plans containing multiple disconnected regions
- Test that bridging corridors respect wall-crossing constraints and forbidden zones
- Test that corridor merging and optimization still work after bridging corridors are added
- Test visual output (red dashed circulation lines) shows fully connected network
- Test that flow arrows are correctly oriented after bridging corridors are added
