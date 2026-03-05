# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Fault Condition** - Complete Accessibility Coverage
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists (disconnected networks, unreachable areas)
  - **Scoped PBT Approach**: Scope the property to concrete failing cases - floor plans with known connectivity issues (isolated îlots, disconnected corridor segments, unbridged gaps)
  - Test that for floor plans where isBugCondition(input) holds (disconnected components OR unreachable îlots OR areas not reachable from entrances), the system produces disconnected circulation networks
  - Create test cases: isolated îlot cluster, unbridged gap between corridor segments, unreachable corridor segment, multiple entrances with isolated components
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found: circulation graph has multiple disconnected components, BFS/DFS from entrance nodes does not reach all corridor segments, some îlots have no adjacent corridor segments
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Existing Corridor Generation Logic
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for floor plans with already-connected corridors (where isBugCondition returns false)
  - Observe: horizontal corridors between facing rows are generated correctly with proper dimensions and positioning
  - Observe: vertical corridors in column gaps respect minimum gap requirements and corridor width constraints
  - Observe: wall-crossing checks prevent corridors from crossing walls or forbidden zones
  - Observe: entrance connections use L-shaped/Manhattan routing correctly
  - Write property-based tests capturing observed behavior patterns: for all floor plans with already-connected corridors, the system produces the same corridor network (same segments, same entrance connections, same wall-crossing validation)
  - Property-based testing generates many floor plan configurations automatically for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Fix for corridor accessibility gaps

  - [x] 3.1 Add connectivity detection to circulationRouter.js
    - Implement graph analysis to detect disconnected components after corridor generation
    - Build circulation graph from corridor segments (nodes and edges)
    - Use union-find or DFS to identify disconnected components
    - Return list of components with their nodes and îlots
    - _Bug_Condition: isBugCondition(input) where (disconnectedComponents.length > 1) OR (unreachableÎlots.length > 0) OR (NOT allAreasReachableFromEntrances)_
    - _Expected_Behavior: isFullyConnected(corridorNetwork) AND allÎlotsReachable(îlots, corridorNetwork) AND allAreasReachableFromEntrances(corridorNetwork, entrances)_
    - _Preservation: Existing corridor generation logic (horizontal/vertical corridor creation, wall-crossing checks, corridor merging, entrance routing) must remain unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 3.2 Implement reachability analysis in circulationRouter.js
    - Add entrance-based reachability validation using BFS/DFS
    - Perform graph traversal from entrance nodes to find all reachable corridor nodes
    - Identify unreachable corridor segments and îlots
    - Return list of unreachable regions
    - _Bug_Condition: isBugCondition(input) where (disconnectedComponents.length > 1) OR (unreachableÎlots.length > 0) OR (NOT allAreasReachableFromEntrances)_
    - _Expected_Behavior: isFullyConnected(corridorNetwork) AND allÎlotsReachable(îlots, corridorNetwork) AND allAreasReachableFromEntrances(corridorNetwork, entrances)_
    - _Preservation: Existing corridor generation logic must remain unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 3.3 Add isolated îlot detection to advancedCorridorNetworkGenerator.js
    - Check îlot-to-corridor connectivity for each îlot
    - Identify îlots with no adjacent or overlapping corridor segments
    - Prioritize isolated îlots for bridging corridor generation
    - _Bug_Condition: isBugCondition(input) where (disconnectedComponents.length > 1) OR (unreachableÎlots.length > 0) OR (NOT allAreasReachableFromEntrances)_
    - _Expected_Behavior: isFullyConnected(corridorNetwork) AND allÎlotsReachable(îlots, corridorNetwork) AND allAreasReachableFromEntrances(corridorNetwork, entrances)_
    - _Preservation: Existing corridor generation logic must remain unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 3.4 Implement gap bridging algorithm in corridorRouter.js
    - Find closest pairs of nodes between disconnected components
    - Generate horizontal or vertical bridging corridors (prefer axis-aligned)
    - Validate that bridging corridors do not cross walls or forbidden zones
    - Add bridging corridors to the network and re-validate connectivity
    - _Bug_Condition: isBugCondition(input) where (disconnectedComponents.length > 1) OR (unreachableÎlots.length > 0) OR (NOT allAreasReachableFromEntrances)_
    - _Expected_Behavior: isFullyConnected(corridorNetwork) AND allÎlotsReachable(îlots, corridorNetwork) AND allAreasReachableFromEntrances(corridorNetwork, entrances)_
    - _Preservation: Existing corridor generation logic must remain unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 3.5 Add post-generation validation loop to advancedCorridorNetworkGenerator.js
    - After initial corridor generation, run connectivity detection
    - If disconnected components exist, run gap bridging algorithm
    - Repeat until network is fully connected or maximum iterations reached
    - Log warnings if full connectivity cannot be achieved
    - _Bug_Condition: isBugCondition(input) where (disconnectedComponents.length > 1) OR (unreachableÎlots.length > 0) OR (NOT allAreasReachableFromEntrances)_
    - _Expected_Behavior: isFullyConnected(corridorNetwork) AND allÎlotsReachable(îlots, corridorNetwork) AND allAreasReachableFromEntrances(corridorNetwork, entrances)_
    - _Preservation: Existing corridor generation logic must remain unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 3.6 Enhance entrance connection logic in advancedCorridorNetworkGenerator.js
    - After connecting entrance to nearest corridor node, verify node is in main component
    - If not, find nearest node in main component and create connection
    - Validate that all entrances can reach all corridor segments
    - _Bug_Condition: isBugCondition(input) where (disconnectedComponents.length > 1) OR (unreachableÎlots.length > 0) OR (NOT allAreasReachableFromEntrances)_
    - _Expected_Behavior: isFullyConnected(corridorNetwork) AND allÎlotsReachable(îlots, corridorNetwork) AND allAreasReachableFromEntrances(corridorNetwork, entrances)_
    - _Preservation: Existing corridor generation logic must remain unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 3.7 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Complete Accessibility Coverage
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed - all areas are now reachable, circulation network is fully connected)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 3.8 Verify preservation tests still pass
    - **Property 2: Preservation** - Existing Corridor Generation Logic
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions - existing corridor generation behavior is unchanged for already-connected floor plans)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Verify fix is running in production environment
  - Verify that the corridor accessibility fix code is actually executing when the user generates floor plans
  - Check that ProfessionalGridLayoutEngine.js is calling AdvancedCorridorNetworkGenerator
  - Verify connectivity fix logs appear in console output
  - Confirm bridging corridors are being generated and added to the network
  - Validate that the enhanced corridor network is being returned to the frontend
  - Test with actual floor plan upload to ensure fix is applied end-to-end
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
