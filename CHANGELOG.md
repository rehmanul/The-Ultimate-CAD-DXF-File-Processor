# Changelog

All notable changes to the project are documented here.

---

## [1.1.0] - 2026-02-28

### Added
- **Single source of truth:** Viewer and all exports (reference-pdf, SVG, etc.) use the same payload (`buildVectorExportPayload`) so UI and export never diverge.
- **Radiators on all code paths:** Non-COSTO render path now draws radiators when available so the viewer matches export in every flow.
- **PDF-style thin walls:** Optional "PDF-style thin walls" checkbox in Layers; when enabled, viewer uses thin wall lines to match PDF export look. Option is passed to all `renderCostoLayout` call sites.
- **Architectural parameters doc:** `Md Files/ARCHITECTURAL_PARAMETERS.md` — one-page reference for corridor width, clearances, egress limit, box depths, and API usage.
- **Compliance summary parameter snapshot:** Download Compliance Summary now includes a "Parameter snapshot" section (egress limit, require elevators, minimum accessible entrances, floor height).
- **Smoke test for Test2 corridors:** `scripts/smokeTest2Corridors.js` runs the Test2 DXF pipeline and asserts minimum corridor count and continuity (no invalid strips).
- **Building code presets:** Existing `lib/buildingCodePresets.js` and `GET /api/building-code-presets` provide IBC-style and Eurocode-style presets for corridor width, egress limit, and accessibility.

### Changed
- **Corridors layer toggle:** The "Corridors" checkbox now controls both `corridorsGroup` and `_flowGroup`, so unchecking Corridors hides the red dashed circulation lines in the viewer.
- **Bay layout preview:** One continuous red dashed line per corridor (no fragmented zig-zags); simple centerline paths used when corridor data is present.
- **Legacy PDF route:** `POST /api/export/pdf` marked as LEGACY in code (ExportManager path); UI uses reference-pdf only.

### Fixed
- Corridors layer had no effect in the COSTO path because circulation was drawn in `_flowGroup`; toggle now syncs both groups.
- Bay layout preview showed fragmented corridor lines; now one continuous strip per corridor.

### Documentation
- `Md Files/OWNERSHIP_IMPROVEMENTS.md` — answers to product-quality questions and implemented/recommended improvements.
- `Md Files/ARCHITECTURAL_PARAMETERS.md` — architectural and API parameter reference.

---

## [1.0.0] - 2026-02-09

- Production-ready FloorPlan Pro: DXF processing, îlot generation, corridor layout, multi-floor, reference PDF export, presets, compliance.
