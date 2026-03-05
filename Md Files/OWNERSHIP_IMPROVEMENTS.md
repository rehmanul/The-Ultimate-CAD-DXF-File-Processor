# Ownership Improvements & Quality Answers

This document answers product-quality questions and records improvements made (and recommended) as if the system were built from scratch with full ownership.

---

## 1. Is the main app 100% tightened and working smoothly?

**Short answer: Nearly. One fix was applied; a few optional cleanups remain.**

**What’s in place:**
- DXF upload → CAD processing → îlot generation → corridor display → PDF/PNG/SVG/DXF/GLTF export: **wired end-to-end**.
- Multi-floor stack, presets, distribution, optimize layout/paths, compliance, edit tools (undo/redo, snap, split, merge), measure tools, door placement: **all wired**.
- Corridors come from “Generate Îlots” only (no separate “Generate Corridors” button in main flow); corridor logic is row-placement only (continuous strip between two parallel rows).

**Fix applied (this pass):**
- **Corridors layer toggle:** The “Corridors” checkbox now controls both `corridorsGroup` and `_flowGroup`, so turning Corridors off hides the red dashed circulation lines in the viewer (previously the checkbox had no effect in the COSTO path).

**Optional cleanups (not blocking):**
- “Generate Corridors” button exists in HTML but is hidden; could be removed or repurposed.
- Legacy `POST /api/export/pdf` (ExportManager) is unused; all PDF export uses reference-pdf. Consider removing or marking legacy.
- “PDF” and “Reference PDF” both call the same API; consider one button/label.

---

## 2. Does the UI frontend render the same visual as the export?

**Short answer: Mostly. Same intent; a few style differences.**

**Aligned:**
- **Corridors:** Both show red dashed centerlines + directional arrows; continuity fixed so one continuous line per corridor in both viewer and PDF.
- **Units/boxes:** Both show outlines, optional dimensions/labels, door side vs other edge.
- **Forbidden zones / entrances:** Same concepts; PDF has extra spiral-stair symbol.

**Differences:**
- **Walls:** Viewer = thick gray fill; PDF = thin gray lines (Tôle Blanche style). Intentional difference; PDF matches drawing standards.
- **Radiators:** Both draw light blue lines when data is present. In the COSTO path, `renderCostoLayout` calls `renderRadiators(radiators)`, so they appear in the viewer; if a different code path is used, radiators can be missing in the viewer.
- **Box partition semantics:** PDF can use per-edge `partitions` (tole_grise / tole_blanche); viewer uses door-side vs other. For full parity, ensure the same partition data is passed to both.

**Conclusion:** Export and viewer are aligned for corridors and units; small style and partition semantics differences are acceptable for production but can be tightened if the client requires pixel-perfect parity.

---

## 3. Does the system follow real-world architectural CAD rules and geometry?

**Short answer: Yes for the core; compliance and code alignment are partially there.**

**What’s in place:**
- **Geometry:** Real-world units (meters), axis-aligned layout, grid and collision (walls, forbidden zones, envelope). Corridor width (e.g. 1.2 m), box depth (e.g. 2.5 m), clearances (wall, row gap, corridor gap) are configurable and used consistently.
- **Layout rules:** Row-based placement, double-loaded corridors (strip between two parallel rows), no boxes inside corridor strips, continuous corridor strips (no fragmented “hallway” objects).
- **Multi-floor / compliance:** `multiFloorManager` evaluates **egress** (max distance to exit, configurable limit) and **accessibility** (elevators, accessible entrances). These align with common building-code concerns (egress distance, accessibility).

**Gaps / notes:**
- **Fire / exits:** COSTO gap analysis and docs mention fire doors, exit clearance, forbidden zones; semantic extraction and explicit fire-door/exit validation are not fully implemented. Egress distance is evaluated; fire-rated separation or exit width is not.
- **Standards:** No explicit reference to a specific building code (e.g. IBC, Eurocode). Parameters (corridor width, egress limit, clearances) are configurable so a client can set them to match local codes.
- **Calculations:** Dimensions, areas, and distances are computed in meters; no symbolic dimensioning standard (e.g. NCS) is enforced—export is suitable for real use but not certified to a particular CAD standard.

**Conclusion:** The system is suitable for real-world storage/warehouse layout and multi-floor compliance checks; for strict “certified to code X” you’d add explicit code references and any missing fire/exit validations.

---

## 4. Ownership: best features, enhancements, advancements (as if built from scratch)

**Implemented in this pass:**
1. **Bay layout preview:** One continuous red dashed line per corridor (no zig-zags); Corridors layer toggle now hides/shows that circulation in the viewer.
2. **Corridor logic:** Already enforced: corridors only from row placement (strip between two parallel rows); no independent corridor shapes.

**Implemented (this release):**
1. **Single source of truth for “what is a corridor”:** Ensure PDF and viewer both consume the same corridor list and the same partition/per-edge data for boxes so UI and export never diverge.
2. **Radiators visibility:** Ensure every code path that shows the layout (including non-COSTO fallbacks) either draws radiators or explicitly hides them so behavior is consistent.
3. **Wall style option:** Optional “PDF-style thin walls” in the viewer for clients who want the same look on screen as on paper.
4. **Documented parameters:** One-page “Architectural parameters” doc (corridor width, clearances, egress limit, box depths) with typical ranges and where they are in the UI/API.
5. **Legacy cleanup:** Remove or clearly mark legacy PDF/export paths to avoid confusion and reduce maintenance.
6. **Accessibility / egress in UI:** Surface egress and accessibility results (pass/fail, max distance) in the multi-floor or report UI so users don’t need to call the API directly.

**If building from scratch, additionally:**
- Preset “building code” profiles (e.g. IBC residential, Eurocode) that set corridor width, egress limit, and accessibility options.
- Optional export of a short “compliance summary” (PDF or sidebar) with egress/accessibility and parameter snapshot.
- Unit tests that assert corridor continuity (no fragmented segments) and that no box center falls inside a corridor rectangle.

---

## Anything else

- **Tests:** Keep running `node scripts/processTest2Dxf.js` and the main app flow after changes; add a smoke test that checks corridor count and continuity if you add more layout modes.
- **Performance:** For very large plans (e.g. 1000+ units), consider level-of-detail or culling for the viewer; export and layout engine already handle large counts.
- **Versioning:** Bump a version or changelog when you ship the corridor-parity and layer-toggle fixes so the client has a clear “before/after” reference.

---

*Last updated: 2026-02-28*
