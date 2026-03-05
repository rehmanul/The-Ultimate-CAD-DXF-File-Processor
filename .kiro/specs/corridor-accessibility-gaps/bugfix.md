# Bugfix Requirements Document

## Introduction

The corridor/circulation routing system generates corridor networks with red dashed circulation lines but fails to ensure complete accessibility coverage. Some areas remain inaccessible, meaning there are spaces in the floor plan that cannot be reached via the circulation network. This is a critical defect as it violates the fundamental requirement that all accessible areas must have valid circulation paths connecting them.

The system includes multiple corridor generation modules (corridorGenerator.js, advancedCorridorGenerator.js, advancedCorridorNetworkGenerator.js, corridorRouter.js, and costo-engine/circulationRouter.js) that generate horizontal corridors between facing rows and vertical corridors in column gaps. However, the current implementation does not validate or guarantee that all areas are reachable from entrances, resulting in isolated or disconnected regions.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the corridor generation system creates horizontal corridors between facing rows of îlots THEN the system may leave isolated îlots or clusters that are not connected to any corridor

1.2 WHEN the corridor generation system creates vertical corridors in gaps between îlots THEN the system may fail to bridge gaps between disconnected corridor segments

1.3 WHEN the circulation router builds the centerline graph from corridor geometry THEN the system may produce disconnected graph components with no paths between them

1.4 WHEN entrances are connected to the nearest corridor nodes THEN the system may fail to connect entrances to isolated corridor segments that are not part of the main network

1.5 WHEN the system validates corridor coverage THEN the system does not check whether all accessible areas can be reached from at least one entrance

1.6 WHEN multiple corridor segments exist in different regions of the floor plan THEN the system does not detect or bridge gaps between disconnected circulation networks

### Expected Behavior (Correct)

2.1 WHEN the corridor generation system creates horizontal corridors between facing rows of îlots THEN the system SHALL ensure all îlots are connected to at least one corridor segment

2.2 WHEN the corridor generation system creates vertical corridors in gaps between îlots THEN the system SHALL generate bridging corridors to connect isolated corridor segments

2.3 WHEN the circulation router builds the centerline graph from corridor geometry THEN the system SHALL detect disconnected components and generate connecting corridors to unify the graph

2.4 WHEN entrances are connected to corridor nodes THEN the system SHALL verify that all corridor segments are reachable from at least one entrance

2.5 WHEN the system validates corridor coverage THEN the system SHALL perform reachability analysis to ensure all accessible areas can be reached from entrances

2.6 WHEN multiple corridor segments exist in different regions of the floor plan THEN the system SHALL identify gaps and generate connecting corridors to create a fully connected circulation network

### Unchanged Behavior (Regression Prevention)

3.1 WHEN horizontal corridors are generated between facing rows with sufficient overlap THEN the system SHALL CONTINUE TO create corridors with correct dimensions and positioning

3.2 WHEN vertical corridors are generated in gaps between îlots in the same column THEN the system SHALL CONTINUE TO respect minimum gap requirements and corridor width constraints

3.3 WHEN the circulation router performs wall-crossing checks THEN the system SHALL CONTINUE TO prevent corridors from crossing walls or forbidden zones

3.4 WHEN corridor segments are merged and optimized THEN the system SHALL CONTINUE TO remove redundant corridors and merge adjacent segments

3.5 WHEN entrance connections are created using L-shaped or Manhattan routing THEN the system SHALL CONTINUE TO generate wall-safe entrance links

3.6 WHEN flow arrows and directions are applied to circulation paths THEN the system SHALL CONTINUE TO orient arrows from entry to exit points
