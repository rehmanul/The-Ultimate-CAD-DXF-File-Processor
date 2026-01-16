# COSTO V1 Gap Analysis (FloorPlan Pro vs. COSTO Requirements)

This document captures a concise, repository-aligned gap analysis between the current
FloorPlan Pro system and the COSTO V1 specification. It is intended to be used as a
product planning reference and to align implementation priorities.

## Executive Summary

FloorPlan Pro currently operates as a DXF/DWG-driven floorplan generator with automatic
îlot placement, corridor generation, and export capabilities. However, COSTO V1 requires
additional semantic interpretation, unit-mix compliance, catalog-driven constraints,
compliance validation, and reporting outputs that are not yet implemented or exposed in
the UI.

## Current Capabilities (Confirmed)

* DXF/DWG upload and processing pipeline.
* Automatic îlot (box) placement and corridor generation.
* Multi-floor stack tooling and export options (PDF/PNG/4K/SVG/DXF/3D claims).
* Interactive editing with undo/redo and measurement tools.

## Gap Analysis

### Input Semantics & Layer Mapping

* **Missing:** User-facing layer mapping workflow for semantic interpretation.
* **Missing:** Semantic extraction for exits, fire doors, forbidden zones, and obstacles.
* **Missing:** Scale normalization and unit conversion workflow.

### Unit Mix & Catalog

* **Missing:** CSV/XLSX import for unit mix targets with tolerance and priority.
* **Missing:** Configurable box catalog templates (sizes, door widths, partition rules).

### Optimization & Scoring

* **Partial:** Existing placement algorithms, but no weighted multi-objective scoring
  aligned with COSTO (unit mix, yield, partition length, regularity).
* **Missing:** Deviation report when targets are infeasible.

### Constraints & Compliance

* **Partial:** Corridor width control is present.
* **Missing:** Main vs secondary corridor classes, dead-end limits, and exit distance checks.
* **Missing:** Fire door/exit clearance validation.

### Exports & Reporting

* **Partial:** Export formats exist, but no COSTO-grade structured report.
* **Missing:** Annotated DXF layers, interactive SVG with datasheets, Excel/CSV outputs,
  deviation tables, and compliance notes.

### Project Management

* **Missing:** Autosave, versioned project files, and version-stamped exports.

## Recommended Implementation Phases

### Phase 0: Inputs & Semantics

1. Layer standard JSON + UI mapping workflow.
2. Semantic interpreter (envelope/obstacles/exits).
3. Scale normalization (auto-detect + manual override).

### Phase 1: Unit Mix & Catalog

4. Unit mix import + deviation reporting.
5. Box catalog templates + constraints.
6. Deterministic generation tuned to catalog + mix.

### Phase 2: Compliance

7. Corridor classification and connectivity validation.
8. Exit distance checks and clearance enforcement.

### Phase 3: Exports & Traceability

9. Annotated DXF + interactive SVG + Excel/CSV.
10. Structured PDF report (assumptions + KPIs + deviations).
11. Project versioning + export stamping.
