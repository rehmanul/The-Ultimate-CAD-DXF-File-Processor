# Architectural Parameters

One-page reference for layout and compliance parameters used in the system. All dimensions are in **meters** unless noted.

---

## Layout (îlot generation)

| Parameter | Typical range | Default | Where |
|-----------|----------------|---------|--------|
| **Corridor width** | 1.0 – 2.0 m | 1.20 m | Sidebar → Corridor width slider; API `options.corridorWidth` |
| **Box depth** | 1.5 – 3.0 m | 2.50 m | Engine options `boxDepth` |
| **Wall clearance** | 0.02 – 0.15 m | 0.10 m | Engine `wallClearance` |
| **Row gap clearance** | 0.01 – 0.10 m | 0.04 m | Engine `rowGapClearance` |
| **Corridor gap clearance** | 0.01 – 0.08 m | 0.04 m | Engine `corridorGapClearance` |
| **Box spacing** | 0 – 0.05 m | 0.02 m | Engine `boxSpacing` |
| **Placement grid step** | 0.05 – 0.20 m | 0.10 m | Engine `placementGridStep` |
| **Row alignment step** | 0.10 – 0.30 m | 0.20 m | Engine `rowAlignmentStep` |

**Box typologies (COSTO reference):** S 1.29 m, M 1.39 m, L 1.49 m, XL 1.59 m wide × box depth.

---

## Multi-floor & compliance

| Parameter | Typical range | Default | Where |
|-----------|----------------|---------|--------|
| **Egress distance limit** | 30 – 60 m | 45 m | Multi-Floor → Egress limit input; API `egressDistanceLimit` |
| **Floor height** | 2.8 – 4.0 m | 3.2 m | Multi-Floor → Floor height; used for connector visualization |
| **Require elevators** | Yes / No | Yes | Multi-Floor → Require elevators toggle |
| **Minimum accessible entrances** | 1 – 4 | 1 | Multi-Floor → Accessible entrances |
| **Connector match tolerance** | 0.1 – 0.5 m | — | Multi-Floor → Connector tolerance |

Egress is evaluated as **straight-line distance** from room centroid to nearest entrance; result is pass/fail per floor and included in Compliance Summary export.

---

## API usage

- **Generate îlots:** `POST /api/ilots` or `POST /api/costo/generate` — send `floorPlan`, `distribution`, `options` (e.g. `corridorWidth`, `boxDepth`, `layoutMode`).
- **Reference PDF export:** `POST /api/costo/export/reference-pdf` — send `floorPlan`, `solution: { boxes, corridors, radiators, circulationPaths }`.
- **Multi-floor stack:** `POST /api/multi-floor/stack` — send `floors`, `options: { egressDistanceLimit, requireElevators, minimumAccessibleEntrances }`.

---

*Last updated: 2026-02-28*
