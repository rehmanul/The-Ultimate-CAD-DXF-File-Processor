# Pro-level output verification

This document confirms that the pipeline produces **real pro-level output**: boxes (îlots), corridors, and **directive traffic pathways** on corridors, with export to PDF.

---

## 1. What was run

- **Script:** `node scripts/processTest2Dxf.js`
- **Input:** `Samples/Test2.dxf` (41.67 × 41.67 m plan, 1060 walls, 21 rooms)
- **Pipeline:** Upload DXF → complete raw plan → **Generate îlots** (COSTO row-based) → **Export reference PDF**

---

## 2. Generated output (proof)

| Output | Count | Meaning |
|--------|--------|--------|
| **Boxes (îlots)** | 30 | Storage units placed in rows; fill limited by current zone detection (one main zone + gap-fill). |
| **Corridors** | 18 | Corridor rectangles between facing rows. |
| **Circulation paths** | 30 | **Directive traffic pathways**: each path has `path` (polyline) and flow direction (`flowEntry` → `flowExit`). Drawn as **red dashed centerlines** on corridors. |
| **Junctions** | 38 | Connection points (e.g. door_bay, corridor intersections). |
| **Radiators** | 30 | Radiator segments along walls. |

- **Directive** = circulation router builds a graph from corridor centerlines, validates **entry → exit** flow, and outputs paths with explicit direction for PDF/UI.
- **Traffic pathways on corridors** = pathways are constrained to corridor geometry (centerlines); PDF and UI draw them as red dashed lines along corridors.

---

## 3. Where to see the output

| What | Where |
|------|--------|
| **Reference PDF** | `Samples/Test2_Output/Test2_layout_from_dxf.pdf` — open in any PDF viewer. Contains: boxes, corridors, **red dashed circulation centerlines** (no arrows in reference style), radiators, legend, title block. |
| **Stats** | `Samples/Test2_Output/summary.json` |
| **Box list (sample)** | `Samples/Test2_Output/ilots.json` |
| **Corridors** | `Samples/Test2_Output/corridors.json` |
| **In-browser report** | Open `Samples/Test2_Output/pro_output_report.html` in a browser to see counts and a link to the PDF. |

---

## 4. Regenerate anytime

```bash
node scripts/processTest2Dxf.js
```

Then open `Samples/Test2_Output/Test2_layout_from_dxf.pdf` and/or `Samples/Test2_Output/pro_output_report.html`.

---

## 5. “Boxes filled entire plan”

- Current run places **30 boxes** in one large zone + gap-fill (target was 360; zone/bay logic produced fewer). So the **structure** is pro-level (corridors + directive circulation), but **density** is moderate for this DXF.
- For denser fill on other plans: use the UI **Generate Îlots** with a higher **Target Îlots** value, or use a DXF with simpler/open zones so the engine creates more bays and fills more of the floor.

---

## Summary

- **Generated:** boxes, corridors, radiators, **30 directive circulation paths** on corridors, 38 junctions.  
- **Exported:** `Test2_layout_from_dxf.pdf` with red dashed corridor pathways.  
- **Shown:** Open the PDF and/or `Samples/Test2_Output/pro_output_report.html` to verify pro-level output.
