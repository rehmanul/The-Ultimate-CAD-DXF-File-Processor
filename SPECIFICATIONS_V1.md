# COSTO Self-Storage Auto-Layout Specification (V1)

**Version:** V1 (Defined June 2025)

## 1) Context and Objective
COSTO designs and installs self-storage facilities. Producing a unit mix currently requires many manual iterations (drawing, measurements, circulation/safety checks). The objective is to automatically generate a compliant, optimized storage-unit layout from a bare plan and target unit mix.

**Inputs**
- Bare DWG/DXF plan (perimeter, columns/obstacles, technical rooms, shafts, stairs, exits, etc.).
- Target unit mix (quantities/areas per type).
- Operational and safety constraints.

**Outputs**
- Optimized cubicle plan (layout).
- Bill of quantities (areas and counts per type).
- DWG/PDF/SVG exports.
- Discrepancy report if 100% unit mix compliance is impossible.

## 2) Scope
### 2.1 In Scope (V1)
- DWG/DXF import and interpretation of constraint layers.
- Configurable box catalog (sizes, depths, widths, doors).
- Unit mix input/import (Excel/CSV).
- Automatic layout generation (single or multi-level).
- Manual editing (move, resize, merge, split) after optimization.
- Checks/reports: areas, circulation, fire safety rules (simple configurable rules).
- Exports: annotated DWG, PDF, interactive SVG (hover/click for datasheet).

### 2.2 Out of Scope (V2+)
- Structural calculations (loads), full MEP/SSI sizing.
- Complete execution plan (assembly details).
- Automatic supplier quotes (extension).

## 3) Target Users and Use Cases
### 3.1 Profiles
- Design Office / Methods: generate and adjust plans.
- Sales / Pre-sales: test multiple unit mixes quickly.
- Technical Management: validate compliance, productivity, and yield.

### 3.2 Main Use Cases
1. Load blank DWG (level).
2. Define usable areas, obstacles, restricted areas.
3. Load unit mix (surface/target counts, tolerances).
4. Configure rules (circulation, rounding, templates).
5. Generate.
6. Review plan + quantity takeoff + score (compliance rate, yield).
7. Manually adjust if needed.
8. Export DWG/PDF/SVG + report.

## 4) Input Data
### 4.1 Plan Files
- DWG/DXF, 2D preferred (3D optional).
- Units: meters.
- Origin: not important but consistent within file.

### 4.2 Layer Convention (standard or mapped)
- Usable envelope/perimeter (closed polyline).
- Obstacles (columns, ducts, technical rooms).
- Prohibited areas (smoke extraction, shafts, voids, etc.).
- Exits/stairs/freight elevators (circulation and access constraints).
- Fire doors/access control (if included).

### 4.3 Unit Mix (CSV/Excel)
- Type (e.g., S/M/L or 1–2 m², 2–3 m²).
- Target area or target unit count.
- Tolerance (±% or ± m²).
- Priority (mandatory/desirable).

## 5) Unit Catalog (Configurable)
For each family:
- Nominal area (or range).
- Possible dimensions (W x D) or template list.
- Standard door width.
- Partition type (thickness, module).
- Optional accessible units (specific rules).
- Optional premium units (near entrance, wide access points).

## 6) Business Rules and Layout Constraints
### 6.1 Circulation
- Minimum main corridor width (e.g., 1.50 m / 1.80 m).
- Minimum secondary corridor width (e.g., 1.20 m).
- Continuity of circulation (no dead ends where prohibited).
- Guaranteed access to exits/stairs/main access.

### 6.2 Row Construction
- Layout by strips (rows) along main axes.
- Returns at end of aisles.
- Fill optimization (minimize wasted space).

### 6.3 Surface Compliance
- Net interior area definition for units.
- Rounding rules (e.g., 0.5 m² increments) as parameters.
- Tolerance per typology.

### 6.4 Safety / Operation (Simple Rules)
- No encroachment on smoke extraction, LT zones, etc.
- Clearances in front of fire doors/exits.
- Optional maximum distance to exit if points provided.

## 7) Optimization Logic
### 7.1 Objective (Weighted Score)
1. Unit mix compliance (weighted deviation).
2. Maximize leasable m² / usable m².
3. Minimize partition wall linear meters (cost).
4. Plan readability (axes, repeatability, standardization).

### 7.2 Method (Expected)
- Generate candidates (strips + cutting).
- Heuristic/meta-heuristic (simulated annealing/tabu) or MILP.
- Post-processing: cleanup, alignment, collision detection, numbering.

### 7.3 Handling Impossibility
- Provide best solution + deviation report:
  - Missing/excess typology areas.
  - Lost m².
  - Probable causes (constraints, geometry).

## 8) User Interface (V1)
### 8.1 Main Screen
- Plan view (zoom, pan, snaps).
- Layer toggles.
- Unit Mix panel (import, tolerances, priorities).
- Rules panel (circulation, rounding, templates).
- Generate button + score/deviation display.
- Edit mode: move/resize/lock a row.

### 8.2 Box Objects
- Selection highlight + properties.
- Details: ID, dimensions, area, type, row, violated constraints.
- Automatic numbering (configurable: zone + row + number).

## 9) Expected Outputs
### 9.1 Graphic Exports
- DWG: separate layers (boxes, text, dimensions, circulation).
- PDF: A3/A1 plans, title block, legend.
- Interactive SVG: hover/click box for information.

### 9.2 Data Exports
- Excel/CSV:
  - List of boxes (ID, area, length, depth, type, level, zone).
  - Consolidated by type.
  - Discrepancies vs unit mix.
- PDF report:
  - Assumptions (rules, versions).
  - KPIs: leasable m², yield, partition length, compliance rate.

## 10) Non-Functional Requirements
- Performance: generation < 60 s for standard level.
- Reliability: autosave + project versioning.
- Traceability: exports include version ID + parameters.
- Compatibility: Windows priority; Web option in V2.
- Interop: robust DWG/DXF library, native SVG/PDF.

## 11) Architecture (Recommendation)
- Geometric engine: polygons, offsets, collisions, no-go zones.
- Optimization solver: separate module (internal API).
- UI: CAD viewer (snap, layers, selection).
- Project format: single file (JSON + DWG references + exports).

## 12) Acceptance Criteria
### 12.1 Minimum Functional Tests
1. DWG import + layer mapping (envelope + obstacles).
2. Unit mix import (Excel) + validation.
3. Generation without collisions, boxes inside envelope, traffic flow respected.
4. DWG export with correct layers in AutoCAD.
5. Excel export consistency (areas + unit counts).
6. Deviation report correctness when mix unattainable.

### 12.2 Validation KPIs
- Unit mix compliance rate ≥ target (e.g., 95%).
- Leasable m² / usable m² yield ≥ target.
- Generation time ≤ target.

## 13) Expected Deliverables
- Software installer + license.
- User manual + DWG COSTO convention guide.
- Test case set (DWG + unit mix + expected results).
- Technical documentation (internal API, formats, configuration).
- V1 support (bug fixes) + V2 enhancement option.

## 14) Roadmap (Indicative)
- Phase 0: COSTO DWG layer standard + catalog + rules.
- Phase 1: MVP (DWG import + unit mix + simple band generation + exports).
- Phase 2: Improved solver + advanced editing + security controls.
- Phase 3: Multi-level design + site optimization + cost estimation.

---

**Note:** Defining a COSTO DWG standard (layer names + object types) is recommended to reduce mapping friction.
