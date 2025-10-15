# FloorPlan Pro - Corridor Overlap Fix

## Objective
Fix corridor generation to create vertical corridors between columns (grouped by X-coordinate) instead of horizontal corridors between rows, preventing overlapping and matching the reference image layout.

## Implementation Steps

1. **Create TODO.md** - Document the plan and track progress
   - Status: ✅ Completed

2. **Update lib/productionCorridorGenerator.js**
   - Rename `groupIlotsByRows()` to `groupIlotsByColumns()` and change grouping to use X-coordinate (ilot.x)
   - Update `generateCorridors()` method:
     - Group ilots by columns
     - Sort ilots within each column by Y-position
     - Calculate vertical gaps between adjacent ilots in the same column
     - Generate vertical corridors (rectangular polygons spanning the ilot width horizontally and the Y-gap vertically)
     - Apply margin to prevent overlap with ilots
     - Ensure corridor height fits within the gap minus margins
   - Status: ⏳ Pending

3. **Test the updated corridor generator**
   - Create sample ilot data simulating column-based layout
   - Verify generated corridors are vertical (height > width typically)
   - Check no overlap with ilots using geometry helpers
   - Validate corridor properties (id, polygon, area, dimensions)
   - Status: ⏳ Pending

4. **Update unit tests**
   - Modify `tests/unit/lib/productionCorridorGenerator.test.js` to test new vertical corridor logic
   - Add tests for column grouping, vertical gap calculation, and polygon generation
   - Ensure tests cover edge cases (insufficient gap, single ilot per column, varying ilot sizes)
   - Status: ⏳ Pending

5. **Integration testing**
   - Test full workflow: DXF upload → ilot generation → corridor generation → export
   - Verify corridors connect properly in the rendered output
   - Check for visual overlap in browser preview
   - Status: ⏳ Pending

6. **Parameter tuning**
   - Adjust default margin (0.5) and corridorWidth (1.2) if needed based on test results
   - Add configuration options for corridor orientation (vertical/horizontal toggle)
   - Status: ⏳ Pending

7. **Documentation and cleanup**
   - Update README.md with new corridor generation behavior
   - Add JSDoc comments to updated methods
   - Remove obsolete horizontal corridor code
   - Status: ⏳ Pending

8. **Commit and deploy**
   - Commit changes with descriptive message
   - Push to repository
   - Run full test suite
   - Status: ⏳ Pending

## Reference
- Expected layout: Vertical corridors between ilot columns to prevent overlap
- Current issue: Horizontal corridors between rows causing overlap
- Key files: lib/productionCorridorGenerator.js, tests/unit/lib/productionCorridorGenerator.test.js

## Progress Tracking
- Date started: Current session
- Estimated completion: After testing and validation
