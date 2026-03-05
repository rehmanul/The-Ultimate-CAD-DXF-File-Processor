# View current output – UI visual + Export PDF

## 1. Export PDF visual (already generated)

**File:** `Samples/Test2_Output/Test2_layout_from_dxf.pdf`

- Open this file in any PDF viewer to see the **export visual**: COSTO-style plan with boxes, corridors, **red dashed** circulation pathways (no arrows in reference style), radiators, legend, and title block.
- Regenerate anytime:  
  `node scripts/processTest2Dxf.js`

---

## 2. UI rendering visual (in-browser)

1. **Start the server**
   ```bash
   npm start
   ```
   Server runs at **http://localhost:3000**.

2. **Open in browser**
   - Go to: **http://localhost:3000** (or http://localhost:3000/public/index.html if needed).

3. **Load Test2 and see the layout**
   - Upload **Test2.dxf** from `Samples/Test2.dxf`, then click **Generate Îlots**.
   - The **UI** now draws **red** corridor centerlines (circulation paths) and matches the reference style. If you still see green/blue, hard-refresh (Ctrl+F5) so the updated `babylonRenderer.js` loads.

4. **Export PDF from the UI (optional)**
   - Use **Reference PDF** in the Export section to download the same-style PDF (red dashed circulation, no arrows).

---

## 3. “Bay” and why you don’t see it on the UI

- **Bay** is an **internal** concept inside the layout engine (`lib/CostoProLayoutEngine.js`): the engine splits zones into bays, plans strip rows per bay, and places boxes. That **is** the “bay-level” layout.
- The **UI does not expose a “Bay” tab or label**. What you see (boxes, corridors, red circulation lines) **is** the result of that bay-level planning. The reference image titled “Professional Bay-Level Layout Test” (Bay Boundary, Corridor centerline, etc.) was likely from another tool or an older/uncommitted export; this repo does not contain that exact title/legend text. The **same geometric output** (layout, circulation paths) is what you get from **Generate Îlots** + **Reference PDF** or `scripts/processTest2Dxf.js`.

---

## 4. Git / “revert to correct output”

- No commit in this repo was found that clearly corresponds to “12:18 am correct output” or the exact “Professional Bay-Level Layout Test” image.
- The **current code** has been fixed so that:
  - The API returns **costoCirculationPaths** and the UI reads it (so circulation paths appear).
  - The UI and export use **red** for circulation lines (no green/blue).
  - Reference PDF uses dashed centerlines without arrows.
- **Recommendation:** Use the current branch with these fixes rather than reverting. If you have a specific commit hash or date when the “correct” output was generated, you can try: `git log --oneline` then `git checkout <commit>` to inspect that state.

---

## Quick reference

| What            | Where / How |
|-----------------|-------------|
| **Export PDF**  | `Samples/Test2_Output/Test2_layout_from_dxf.pdf` |
| **UI visual**   | `npm start` → http://localhost:3000 → upload Test2.dxf → **Generate Îlots** → red circulation paths |
| **Regenerate PDF** | `node scripts/processTest2Dxf.js` |
| **Bay**         | Internal engine concept; layout you see is the bay-level result (no separate “Bay” UI). |
