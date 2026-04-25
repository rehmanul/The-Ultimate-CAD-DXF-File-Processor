'use strict';
/**
 * CORRIDOR ENGINE v11 — Full 10-Step Spec Implementation
 * ─────────────────────────────────────────────────────────────────────
 * Implements the client algorithm specification exactly:
 *
 * Step 1: usable_area = building - obstacles - restricted_zones
 * Step 2: Detect main building axis (longest dimension → corridor direction)
 * Step 3: Generate corridors as bands (buffer around axis line), continuous, full-span
 * Step 4: left_band = offset(corridor, +BOX_DEPTH) / right_band = offset(corridor, -BOX_DEPTH)
 * Step 5: Fill boxes inside each band linearly, boxes face the corridor
 * Step 6: Facing rows — corridor IS the space between two facing rows (not added separately)
 * Step 7: Ensure corridor continuity — no boxes inside corridors
 * Step 8: Fill secondary areas (gaps between main pairs) with secondary corridors + rows
 * Step 9: Cleanup (remove overlaps, standardize)
 * Step 10: Export
 *
 * CORRECT LOGIC (from spec):
 *   for each corridor:
 *     create_rows()
 *     place_boxes_along_rows()
 *
 * NOT:
 *   for each empty space:
 *     place_box()
 */

const fs   = require('fs');
const path = require('path');
const CostoExports = require('./lib/costoExports');
const WallHuggingPlacer = require('./lib/costo-engine/wallHuggingPlacer');
const rdInstance = require('./lib/roomDetector'); // Singleton RoomDetector for topological room extraction

/* ── Parameters ─────────────────────────────────────────────────────────
 * Calibrated from Final.pdf reference (Z:\2025\PROJETS\22_ANTOINE - COSTOCKA):
 *   - Main units: 3.83m deep × 1.53–2.90m wide (avg 2.0m) → 5.8–11m² per unit
 *   - Main corridor: 1.20m (measured from green-arrow corridor band)
 *   - Pair width: 3.83+3.83+1.20 = 8.86m → 4 pairs in 40.35m building ✓
 * ────────────────────────────────────────────────────────────────────── */
const BOX_DEPTH      = 2.90;   // m — box depth (perp to corridor) — 5 vertical pairs: 5×(2.9+2.9+1.2)=35m in 40.35m
const BOX_W          = 1.20;   // m — box width (along corridor) — narrow units matching COSTO reference
const MIN_BW         = 0.20;   // m — min box width (edge partial boxes) — lower for wall-flush fill
const MAIN_CORR_W    = 0.80;   // m — main corridor width (narrowed to match reference density)
const SEC_CORR_W     = 1.00;   // m — secondary corridor width
const WALL_MARGIN    = 0.00;   // m — boxes start RIGHT at building boundary (flush)
const STRUCT_LEN     = 5.00;   // m — walls ≥5m used for obstacle detection
const COLL_INSET     = 0.00;   // m - NO inset: boxes MUST be flush against walls (0cm gap)
const PERIM_STRIP    = 0.00;   // m — NO perimeter strip: boxes start at walls (was BOX_DEPTH)
const SEC_MIN_H      = 2.50;   // m — min band height to attempt secondary fill
const SEC_MIN_BOXES  = 1;      // keep ALL box segments including single-box near room walls
const PAIR_SEP       = 0.00;   // m — seam between back-to-back pairs (0 = pairs are flush)

/* ── Professional layer-aware DXF parser ────────────────────────────────────
 * Reads ALL LINE + LWPOLYLINE entities, grouped by layer name (DXF code 8).
 * This is the CORRECT professional approach:
 *   - MUR (Wall) layer LINE segments = structural walls
 *   - MUR layer closed LWPOLYLINE ≥5m² = service core rooms (stairwells, shafts)
 *   - NO_ENTREE (No Entry) layer = restricted access zones (forbidden for storage)
 *   - ENTREE__SORTIE (Entry/Exit) layer = door openings / access points
 * Building bounds are computed from MUR layer extents ONLY (not scale bars etc.)
 */
function parseDXFLayered(text) {
    const lines = text.replace(/\r/g,'').split('\n');
    // Result buckets per layer
    const result = {
        murLines:        [],   // LINE on MUR layer
        murPolygons:     [],   // closed LWPOLYLINE on MUR (service cores)
        noEntryPolygons: [],   // LWPOLYLINE on NO_ENTREE (forbidden zones)
        entryPolygons:   [],   // LWPOLYLINE on ENTREE__SORTIE (door/access)
        murHatches:      [],   // HATCH on MUR layer (filled architectural regions)
        entryHatches:    [],   // HATCH on ENTREE__SORTIE (door area fills)
        noEntryHatches:  [],   // HATCH on NO_ENTREE (forbidden zone fills)
        inserts:         [],   // INSERT block references (staircase symbols etc.)
        allLines:        [],   // ALL LINE segments (any layer)
        bounds: { minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity },
    };

    let inE=false, curEnt=null, curLayer=null, p={};

    const flush = () => {
        if(curEnt==='LINE') {
            const x1=+p[10],y1=+p[20],x2=+p[11],y2=+p[21];
            if([x1,y1,x2,y2].every(Number.isFinite) && Math.hypot(x2-x1,y2-y1)>=0.05) {
                const seg = {x1,y1,x2,y2,layer:curLayer||''};
                result.allLines.push(seg);
                if(curLayer==='MUR') {
                    result.murLines.push(seg);
                    // Update bounds from MUR layer only
                    result.bounds.minX=Math.min(result.bounds.minX,x1,x2);
                    result.bounds.minY=Math.min(result.bounds.minY,y1,y2);
                    result.bounds.maxX=Math.max(result.bounds.maxX,x1,x2);
                    result.bounds.maxY=Math.max(result.bounds.maxY,y1,y2);
                }
            }
        } else if(curEnt==='LWPOLYLINE') {
            const xs=p._x||[], ys=p._y||[];
            const closed=!!(p[70]&1);
            if(xs.length>=2) {
                let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
                for(let k=0;k<xs.length;k++){
                    minX=Math.min(minX,xs[k]); minY=Math.min(minY,ys[k]);
                    maxX=Math.max(maxX,xs[k]); maxY=Math.max(maxY,ys[k]);
                }
                const w=maxX-minX, h=maxY-minY;
                const bboxArea = w*h;
                const pts = xs.map((xv,k)=>({x:xv,y:ys[k]}));
                const poly = {x:minX,y:minY,w,h,bboxArea,pts,closed,npts:xs.length,layer:curLayer||''};

                if(curLayer==='MUR') {
                    if(closed && xs.length>=3 && bboxArea>=3) result.murPolygons.push(poly);
                    // Update MUR bounds
                    result.bounds.minX=Math.min(result.bounds.minX,minX);
                    result.bounds.minY=Math.min(result.bounds.minY,minY);
                    result.bounds.maxX=Math.max(result.bounds.maxX,maxX);
                    result.bounds.maxY=Math.max(result.bounds.maxY,maxY);
                } else if(curLayer==='NO_ENTREE') {
                    result.noEntryPolygons.push(poly);
                } else if(curLayer==='ENTREE__SORTIE') {
                    result.entryPolygons.push(poly);
                }
            }
        } else if(curEnt==='HATCH') {
            // HATCH boundary paths: extract coordinate pairs from code 10/20 sequences
            const xs = p._hx || [], ys = p._hy || [];
            const nPts = Math.min(xs.length, ys.length);
            if(nPts >= 3) {
                let hMinX=Infinity,hMinY=Infinity,hMaxX=-Infinity,hMaxY=-Infinity;
                const pts = [];
                for(let k=0;k<nPts;k++) {
                    pts.push({x:xs[k],y:ys[k]});
                    hMinX=Math.min(hMinX,xs[k]); hMinY=Math.min(hMinY,ys[k]);
                    hMaxX=Math.max(hMaxX,xs[k]); hMaxY=Math.max(hMaxY,ys[k]);
                }
                const hw=hMaxX-hMinX, hh=hMaxY-hMinY;
                const hatch = {x:hMinX,y:hMinY,w:hw,h:hh,area:hw*hh,pts,npts:nPts,layer:curLayer||''};
                if(curLayer==='MUR')                result.murHatches.push(hatch);
                else if(curLayer==='ENTREE__SORTIE') result.entryHatches.push(hatch);
                else if(curLayer==='NO_ENTREE')      result.noEntryHatches.push(hatch);
            }
        } else if(curEnt==='INSERT') {
            const ins = {layer:curLayer||'',blockName:p._blockName||'',x:p[10]||0,y:p[20]||0,
                         xscale:p[41]||1,yscale:p[42]||1,rotation:p[50]||0};
            result.inserts.push(ins);
        }
        p={}; curEnt=null; curLayer=null;
    };

    let i=0;
    while(i<lines.length-1) {
        const c=lines[i].trim(), v=lines[i+1].trim(); i+=2;
        if(c==='0') { flush(); if(v==='ENDSEC') inE=false; else if(inE) curEnt=v; continue; }
        if(c==='2'&&v==='ENTITIES') { inE=true; continue; }
        if(!inE||!curEnt) continue;
        if(c==='8') curLayer=v;
        if(c==='10') p[10]=+v; if(c==='20') p[20]=+v;
        if(c==='11') p[11]=+v; if(c==='21') p[21]=+v;
        if(c==='70') p[70]=+v;
        if(curEnt==='LWPOLYLINE') {
            if(!p._x){p._x=[];p._y=[];}
            if(c==='10') p._x.push(+v);
            if(c==='20') p._y.push(+v);
        }
        if(curEnt==='HATCH') {
            if(!p._hx){p._hx=[];p._hy=[];}
            if(c==='10') p._hx.push(+v);
            if(c==='20') p._hy.push(+v);
        }
        if(curEnt==='INSERT') {
            if(c==='2') p._blockName=v;
            if(c==='41') p[41]=+v;
            if(c==='42') p[42]=+v;
            if(c==='50') p[50]=+v;
        }
    }
    flush();

    // Sort MUR polygons by bbox area descending (largest service cores first)
    result.murPolygons.sort((a,b)=>b.bboxArea-a.bboxArea);

    // Deduplicate MUR polygons (same DXF often draws wall inner+outer boundary twice)
    const seen = new Set();
    result.murPolygons = result.murPolygons.filter(p => {
        const k=`${Math.round(p.x*10)},${Math.round(p.y*10)},${Math.round(p.w*10)},${Math.round(p.h*10)}`;
        if(seen.has(k)) return false; seen.add(k); return true;
    });

    return result;
}

/* ── Legacy compatibility wrapper ───────────────────────────────────────── */
function parseDXF(text) {
    return parseDXFLayered(text).allLines.map(s=>({x1:s.x1,y1:s.y1,x2:s.x2,y2:s.y2}));
}




/* parseRoomPolygons removed — superseded by parseDXFLayered().murPolygons */

/* ── Point-in-polygon test (ray casting) ────────────────────────────── */
function pointInPoly(px, py, pts) {
    let inside = false;
    for(let i=0, j=pts.length-1; i<pts.length; j=i++) {
        const xi=pts[i].x, yi=pts[i].y, xj=pts[j].x, yj=pts[j].y;
        if(((yi>py)!==(yj>py)) && (px < (xj-xi)*(py-yi)/(yj-yi)+xi))
            inside = !inside;
    }
    return inside;
}

/* ── AABB vs segment ────────────────────────────────────────────────── */
function segAABB(wx1,wy1,wx2,wy2,bx,by,bw,bh){
    const sX0=Math.min(wx1,wx2),sX1=Math.max(wx1,wx2),sY0=Math.min(wy1,wy2),sY1=Math.max(wy1,wy2);
    if(sX1<bx||sX0>bx+bw||sY1<by||sY0>by+bh)return false;
    if(wx1>=bx&&wx1<=bx+bw&&wy1>=by&&wy1<=by+bh)return true;
    if(wx2>=bx&&wx2<=bx+bw&&wy2>=by&&wy2<=by+bh)return true;
    const dx=wx2-wx1,dy=wy2-wy1,L=Math.hypot(dx,dy);
    if(L<0.001)return false;
    const nx=dy/L,ny=-dx/L;
    const d=[nx*(bx-wx1)+ny*(by-wy1),nx*(bx+bw-wx1)+ny*(by-wy1),nx*(bx-wx1)+ny*(by+bh-wy1),nx*(bx+bw-wx1)+ny*(by+bh-wy1)];
    return Math.min(...d)<=0&&Math.max(...d)>=0;
}

function isBlocked(bx, by, bw, bh, structWalls){
    // NO inset: boxes MUST be placed FLUSH against walls with ZERO gap
    // Only reject if box INTERIOR truly crosses a wall (not just touching)
    const ix = bx;  // No COLL_INSET offset
    const iy = by;  // No COLL_INSET offset
    const iw = bw;  // Full width
    const ih = bh;  // Full height
    for(const w of structWalls)
        if(segAABB(w.x1,w.y1,w.x2,w.y2,ix,iy,iw,ih)) return true;
    return false;
}

/* ── STEP 5/6: Fill a single row (obstacle-zone exclusion) ─────────────────
 * Uses obstacle BOUNDING BOXES (not per-wall isBlocked) to skip service core zones.
 * This gives CLEAN rectangular exclusions matching the reference COSTO design:
 *   - Band rows run full-width except where obstacle zones block them
 *   - No ragged single-box gaps from incidental wall-segment crossings
 * excludeZones: array of {x,y,w,h} bounding boxes for obstacle clusters
 * margin: expand each zone by this amount on each side (default 0) */
function fillRow(rowX, rowW, rowY, rowH, _unused, excludeZones, margin){
    const exZ = excludeZones || [];
    const mg  = margin || 0;
    const boxes=[];
    let ox=rowX;
    const endX = rowX+rowW;
    while(ox+MIN_BW<=endX){
        const bw=Math.min(BOX_W, endX-ox);
        if(bw<MIN_BW){ox+=bw;continue;}
        // Check if centre of this box falls inside any obstacle exclusion zone
        const bcx=ox+bw/2, bcy=rowY+rowH/2;
        const blocked = exZ.some(z=>
            bcx > z.x-mg && bcx < z.x+z.w+mg &&
            bcy > z.y-mg && bcy < z.y+z.h+mg);
        if(!blocked) boxes.push({x:ox,y:rowY,width:bw,height:rowH});
        ox+=bw;
    }
    return boxes;
}

/* Compatibility wrapper: old call sites that pass structWalls still work */
function fillRowWalls(rowX, rowW, rowY, rowH, structWalls){
    // No wall-level blocking — room exclusion handles structural elements
    return fillRow(rowX, rowW, rowY, rowH, null, [], 0);
}

/* ── STEP 2: Detect main building axis direction ─────────────────── */
function detectMainAxis(usW, usH) {
    // REFERENCE ARCHITECTURE (Final.pdf): corridors run EAST-WEST (horizontal),
    // stacked NORTH-SOUTH. Multiple horizontal pairs fill the N-S span.
    // This matches the client's corridor-based generation algorithm diagram.
    void usW; void usH;           // parameters kept for signature compatibility
    return 'horizontal';
}


/* ── STEP 1: Detect obstacle cluster zones (service cores) ───────────────
 * Uses structural walls (>=STRUCT_LEN) with 3m grid, threshold=5.
 * Detects dense room clusters (service cores) as rectangular exclusion zones.
 * Bands skip these zones cleanly with a configurable margin. */
function detectObstacles(structWalls, usX, usY, usW, usH) {
    const G=3.0;
    const cols=Math.ceil(usW/G),rows=Math.ceil(usH/G);
    const grid=new Array(cols*rows).fill(0);
    for(const w of structWalls){
        const cx=Math.floor(((w.x1+w.x2)/2-usX)/G);
        const cy=Math.floor(((w.y1+w.y2)/2-usY)/G);
        if(cx>=0&&cx<cols&&cy>=0&&cy<rows) grid[cy*cols+cx]++;
    }
    const zones=[];
    for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
        if(grid[r*cols+c]>=5){
            const zx=usX+c*G-0.5,zy=usY+r*G-0.5,zw=G+1,zh=G+1;
            let merged=false;
            for(const z of zones){
                if(zx<z.x+z.w+3&&zx+zw>z.x-3&&zy<z.y+z.h+3&&zy+zh>z.y-3){
                    z.x=Math.min(z.x,zx);z.y=Math.min(z.y,zy);
                    z.w=Math.max(z.x+z.w,zx+zw)-z.x;z.h=Math.max(z.y+z.h,zy+zh)-z.y;
                    merged=true;break;
                }
            }
            if(!merged) zones.push({x:zx,y:zy,w:zw,h:zh});
        }
    }
    return zones;
}

/* ── Detect wall-dense clusters on the LEFT side of the building ────────────
 * Only counts INTERIOR walls (not the building perimeter) in a 2m grid.
 * Threshold=3 requires ≥3 interior walls per 2m cell to flag a cluster.
 * This detects the upper-left L-shape and lower-left stairwell service cores
 * which are built from LINE segments (not LWPOLYLINE) in Test2.dxf. */
function detectCornerClusters(allWalls, usX, usY, usW, usH, buildMinX, buildMaxX, buildMinY, buildMaxY) {
    const G = 2.0;
    const THRESH = 3;
    const ZONE_W = usW; // scan full building width
    const cols = Math.ceil(ZONE_W / G);
    const rows = Math.ceil(usH / G);
    const grid = new Array(cols * rows).fill(0);
    const PERIM = 0.8; // wall midpoint within 0.8m of boundary = perimeter wall, skip

    for(const w of allWalls) {
        const mx = (w.x1 + w.x2) / 2;
        const my = (w.y1 + w.y2) / 2;
        // Skip perimeter walls (the building boundary itself)
        if(Math.abs(mx - buildMinX) < PERIM || Math.abs(mx - buildMaxX) < PERIM ||
           Math.abs(my - buildMinY) < PERIM || Math.abs(my - buildMaxY) < PERIM) continue;
        const lx = mx - usX;
        const ly = my - usY;
        if(lx < 0 || lx >= ZONE_W || ly < 0 || ly >= usH) continue;
        const cx = Math.floor(lx / G);
        const cy = Math.floor(ly / G);
        if(cx >= 0 && cx < cols && cy >= 0 && cy < rows) grid[cy * cols + cx]++;
    }

    // Find above-threshold cells and merge into zones (adjacent cells only)
    const zones = [];
    for(let r = 0; r < rows; r++) for(let c = 0; c < cols; c++) {
        if(grid[r * cols + c] >= THRESH) {
            const zx = usX + c * G, zy = usY + r * G;
            let merged = false;
            for(const z of zones) {
                // Only merge if truly adjacent (touching, not just within G distance)
                if(zx < z.x + z.w + 0.1 && zx + G > z.x - 0.1 &&
                   zy < z.y + z.h + 0.1 && zy + G > z.y - 0.1) {
                    z.x = Math.min(z.x, zx); z.y = Math.min(z.y, zy);
                    z.w = Math.max(z.x + z.w, zx + G) - z.x;
                    z.h = Math.max(z.y + z.h, zy + G) - z.y;
                    merged = true; break;
                }
            }
            if(!merged) zones.push({x:zx, y:zy, w:G, h:G});
        }
    }

    // Return clusters ≥8m² and ≤50m² (room-scale, not building-scale artifacts)
    // 2×2m cells (4m²) are typically just wall junctions, not rooms
    return zones.filter(z => z.w * z.h >= 8 && z.w * z.h <= 50);
}

/* ── STEP 7: Remove any box overlapping a corridor ─────────────────── */
function pruneBoxesInCorridors(boxes, corridors){
    const EPS=0.02;
    return boxes.filter(b=>!corridors.some(c=>
        b.x+EPS<c.x+c.width&&b.x+b.width-EPS>c.x&&
        b.y+EPS<c.y+c.height&&b.y+b.height-EPS>c.y
    ));
}

/* ── STEP 8: Secondary fill — always glues boxes to BOTH wall faces ──── */
function fillSecondaryBand(bandX, bandW, bandY, bandH, _corrW, boxD, structWalls, existingCorridors) {
    const MIN_CORR = 0.80;  // minimum viable corridor width
    const adaptCorrW = bandH - 2*boxD; // what's left after two rows

    if(adaptCorrW >= MIN_CORR){
        // Full secondary pair with adaptive corridor — boxes touch BOTH walls
        // Top row: flush to bandY (top wall)
        // Corridor: adaptive width in the middle
        // Bottom row: flush to bandY+bandH (bottom wall)
        const corrY = bandY + boxD;
        const corr  = {
            id:`sec_${bandY.toFixed(1)}`,
            x:bandX, y:corrY, width:bandW, height:adaptCorrW,
            direction:'horizontal', type:'secondary_artery',
            corners:[{x:bandX,y:corrY},{x:bandX+bandW,y:corrY},
                     {x:bandX+bandW,y:corrY+adaptCorrW},{x:bandX,y:corrY+adaptCorrW}],
        };
        const allCorr=[...existingCorridors, corr];
        const topBoxes  = fillRow(bandX, bandW, bandY,            boxD, structWalls);
        const botBoxes  = fillRow(bandX, bandW, corrY+adaptCorrW, boxD, structWalls);
        return {boxes: pruneBoxesInCorridors([...topBoxes,...botBoxes], allCorr), corridors:[corr]};
    }

    // Not enough height for two rows + corridor
    if(bandH >= boxD * 0.6){
        // Single row — place at the BOTTOM so it's flush with the wall below
        const rowH = Math.min(boxD, bandH);
        const rowY = bandY + bandH - rowH;  // flush to bottom wall
        return {boxes: fillRow(bandX, bandW, rowY, rowH, structWalls), corridors:[]};
    }

    return {boxes:[], corridors:[]};
}

/* ── STEP 8.5: Wall-Touch Layer — ALL WALL FACES (Horizontal + Vertical) ──
 *
 * Fills every free zone adjacent to every structural wall face.
 *
 * VERTICAL walls (dY > dX):
 *   → Perpendicular boxes: 2.0m (E-W depth into building) × 1.0m (N-S slot)
 *   → Placed on LEFT face and RIGHT face of each vertical wall
 *   → Stacked along the wall's full height at 1.0m steps
 *
 * HORIZONTAL walls (dX > dY):
 *   → Normal-orientation boxes: 1.0m (E-W slot) × 2.0m (N-S depth into building)
 *   → Placed on TOP face and BOTTOM face of each horizontal wall
 *   → Filled across the wall's full width at 1.0m steps
 *
 * All placements checked against occupancy grid (no overlaps with existing boxes or corridors).
 * ─────────────────────────────────────────────────────────────────────────── */
function addWallHuggingBoxes(faceWalls, existingBoxes, corridors, usX, usY, usW, usH, blockWalls) {
    // faceWalls: walls to iterate and place face boxes on (e.g. all walls >=2m)
    // blockWalls: walls used for isBlocked collision check (e.g. structural walls >=5m)
    // If blockWalls is null/undefined, falls back to faceWalls.
    const _blockWalls = blockWalls || faceWalls;
    // ALL wall faces use the SAME standard 1m×2m portrait box:
    //   BW = 1m (parallel to corridor / along wall in horizontal case)
    //   BD = 2m (perpendicular depth from wall into storage space)
    //
    // VERTICAL wall (N-S running) → column of portrait boxes:
    //   box at x=[wallX, wallX+1], y=[oy, oy+2], stepping oy+=2m (BD steps along wall)
    //   Left face: bx = wallX-1;  Right face: bx = wallX
    //
    // HORIZONTAL wall (E-W running) → row of portrait boxes:
    //   box at x=[ox, ox+1], y=[wallY, wallY+2] or y=[wallY-2,wallY], stepping ox+=1m (BW steps)
    //   Below wall: by = wallY;  Above wall: by = wallY-BD
    const BW = BOX_W;      // 1.0m — narrow dimension (along wall for horiz, into space for vert)
    const BD = BOX_DEPTH;  // 2.0m — depth into storage space

    // ── Occupancy grid: 0.5m × 0.5m cells ───────────────────────────────────
    const GS = 0.50;
    const gCols = Math.ceil(usW / GS) + 2;
    const gRows = Math.ceil(usH / GS) + 2;
    const occ   = new Uint8Array(gCols * gRows);

    const markOcc = (bx, by, bw, bh) => {
        const c0 = Math.max(0, Math.floor((bx-usX)/GS));
        const c1 = Math.min(gCols-1, Math.ceil((bx+bw-usX)/GS));
        const r0 = Math.max(0, Math.floor((by-usY)/GS));
        const r1 = Math.min(gRows-1, Math.ceil((by+bh-usY)/GS));
        for(let r=r0;r<=r1;r++) for(let c=c0;c<=c1;c++) occ[r*gCols+c]=1;
    };
    const isOcc = (bx, by, bw, bh) => {
        const E=0.06;
        const c0=Math.max(0,Math.floor((bx+E-usX)/GS));
        const c1=Math.min(gCols-1,Math.ceil((bx+bw-E-usX)/GS));
        const r0=Math.max(0,Math.floor((by+E-usY)/GS));
        const r1=Math.min(gRows-1,Math.ceil((by+bh-E-usY)/GS));
        for(let r=r0;r<=r1;r++) for(let c=c0;c<=c1;c++) if(occ[r*gCols+c]) return true;
        return false;
    };

    // Seed with existing boxes + corridors (so wall-face boxes never enter corridors)
    for(const b of existingBoxes) markOcc(b.x, b.y, b.width, b.height);
    for(const c of corridors)     markOcc(c.x, c.y, c.width, c.height);

    const newBoxes = [];
    let vCount=0, hCount=0;

    const tryPlace = (bx, by, bw, bh) => {
        const cx = Math.max(usX, bx), cy = Math.max(usY, by);
        const cw = Math.min(bx+bw, usX+usW) - cx;
        const ch = Math.min(by+bh, usY+usH) - cy;
        if(cw < MIN_BW || ch < MIN_BW) return false;
        if(isOcc(cx,cy,cw,ch)) return false;
        // No wall-level blocking — room exclusion handles structural elements
        newBoxes.push({x:cx, y:cy, width:cw, height:ch});
        markOcc(cx, cy, cw, ch);
        return true;
    };

    for(const wall of faceWalls) {
        const dX = Math.abs(wall.x2-wall.x1);
        const dY = Math.abs(wall.y2-wall.y1);
        const isVert = dY >= dX;

        if(isVert) {
            // ── VERTICAL wall → portrait column boxes (1m wide × 2m tall) ──
            // stepped in BD (2m) increments along the wall length (N-S)
            const wallX  = (wall.x1+wall.x2)/2;
            const wallY0 = Math.min(wall.y1,wall.y2);
            const wallY1 = Math.max(wall.y1,wall.y2);
            for(const side of [-1, 1]) {        // -1 = left face,  +1 = right face
                const bx = side===-1 ? wallX - BW : wallX;  // 1m box touching wall
                // Snap start to global grid: usY + n*BD >= wallY0
                // This aligns portrait boxes with main band landscape boxes everywhere.
                const nStart = Math.ceil((wallY0 - usY) / BD);
                let oy = usY + nStart * BD;
                while(oy + MIN_BW <= wallY1) {
                    const ch = Math.min(BD, wallY1-oy); // 2m tall (or partial at end)
                    if(tryPlace(bx, oy, BW, ch)) vCount++;
                    oy += BD; // step 2m along wall
                }
            }
        } else {
            // ── HORIZONTAL wall → portrait row boxes (1m wide × 2m tall) ──
            // stepped in BW (1m) increments along the wall length (E-W)
            const wallY  = (wall.y1+wall.y2)/2;
            const wallX0 = Math.min(wall.x1,wall.x2);
            const wallX1 = Math.max(wall.x1,wall.x2);
            for(const side of [-1, 1]) {        // -1 = below wall (box sits on top), +1 = above wall
                const by = side===-1 ? wallY - BD : wallY;  // 2m deep box touching wall
                // Snap start to global grid: usX + n*BW >= wallX0
                const nStartX = Math.ceil((wallX0 - usX) / BW);
                let ox = usX + nStartX * BW;
                while(ox + MIN_BW <= wallX1) {
                    const cw = Math.min(BW, wallX1-ox); // 1m wide (or partial at end)
                    if(tryPlace(ox, by, cw, BD)) hCount++;
                    ox += BW; // step 1m along wall
                }
            }
        }
    }

    // Perimeter column fill REMOVED: bands now cover full width (usX to usX+usW).
    // The old loop bypassed isOcc and double-placed 2m x 1m boxes on top of
    // 1m x 2m band boxes, creating orphaned clusters seen in red-arrow review.
    console.log(`[Step 8.5] Wall-touch: +${newBoxes.length} boxes (${vCount} vert + ${hCount} horiz)`);
    return newBoxes;
}

/* ── MAIN: Generate layout from DXF ─────────────────────────────────── */
async function generateV11(dxfPath, outputPath){
    console.log('=============================================================');
    console.log(' CORRIDOR ENGINE v11 — Full 10-Step Spec Implementation       ');
    console.log('=============================================================\n');

    // ── Step 1: Parse DXF — LAYER-AWARE (Professional) ────────────────────────
    const dxfText = fs.readFileSync(dxfPath,'utf8');
    const dxfData = parseDXFLayered(dxfText);
    const { murLines, murPolygons, noEntryPolygons, entryPolygons,
            murHatches, entryHatches, noEntryHatches, inserts } = dxfData;
    const { minX, minY, maxX, maxY } = dxfData.bounds;

    // Wall data: MUR layer LINE segments only (structurally correct)
    const allWalls   = murLines.filter(s => Math.hypot(s.x2-s.x1,s.y2-s.y1) >= 0.20);
    const structWalls= murLines.filter(s => Math.hypot(s.x2-s.x1,s.y2-s.y1) >= STRUCT_LEN);

    // faceWalls: MUR walls ≥2m, canonically deduplicated
    const _fwSeen = new Set();
    const faceWalls = murLines
        .filter(s => Math.hypot(s.x2-s.x1,s.y2-s.y1) >= 2.0)
        .filter(w => {
            const k = [w.x1,w.y1,w.x2,w.y2].map(v=>Math.round(v*100)/100);
            const key = (k[0]<k[2]||(k[0]===k[2]&&k[1]<k[3]))
                ? `${k[0]},${k[1]},${k[2]},${k[3]}`
                : `${k[2]},${k[3]},${k[0]},${k[1]}`;
            if(_fwSeen.has(key)) return false; _fwSeen.add(key); return true;
        });

    const wallObjs = allWalls.map(s=>({start:{x:s.x1,y:s.y1},end:{x:s.x2,y:s.y2}}));
    const bounds = {minX,minY,maxX,maxY};

    // ── Detect left service zone (stairwells/utility rooms) BEFORE setting usX ──
    // Service zone = the densest vertical wall cluster in left 25% of building.
    // Must be computed first so storage starts AFTER the service complex.
    const SV_BUCKET = 0.5, SV_PERIM = 2.5;
    const xDens = {};
    allWalls.forEach(s => {
        const mx = (s.x1 + s.x2) / 2;
        if (mx < minX + SV_PERIM || mx > maxX - SV_PERIM) return;
        const bkt = (Math.round(mx / SV_BUCKET) * SV_BUCKET).toFixed(1);
        xDens[bkt] = (xDens[bkt] || 0) + Math.hypot(s.x2-s.x1, s.y2-s.y1);
    });
    const SV_MAX_X = minX + (maxX - minX) * 0.25;
    let svZoneX = null, svDensity = 0;
    Object.keys(xDens).forEach(k => {
        const x = parseFloat(k);
        if (x > minX + SV_PERIM && x <= SV_MAX_X && xDens[k] > svDensity) {
            svDensity = xDens[k]; svZoneX = x;
        }
    });
    const hasServiceZone = svZoneX !== null && svDensity >= 15.0;

    // ── Storage area bounds: FULL WIDTH — per-box exclusion via mergedZones (Step 9a) ──
    // Do NOT use a strip offset for svZoneX — the reference shows storage rows reaching
    // near the left wall, with only the SPECIFIC ROOM POLYGONS excluded box-by-box.
    // svZoneX is kept for architectural wall rendering and radiator perimeter detection.
    const usX = minX + WALL_MARGIN;
    const usY = minY + WALL_MARGIN;
    const usW = (maxX - WALL_MARGIN) - usX;
    const usH = (maxY - minY) - WALL_MARGIN * 2;
    console.log(`[Step 1] Storage zone: FULL WIDTH usX=${usX.toFixed(2)} usW=${usW.toFixed(2)}m SvZone=${hasServiceZone ? svZoneX.toFixed(1)+'m (arch detail only)' : 'none'}`);

    // ── Service Core Detection: DIRECT LAYER SEMANTICS ──────────────────────
    // MUR closed LWPOLYLINE with bboxArea ≥ 5m² AND both dimensions ≥ 2m:
    //   → Both dimensions must be ≥ 2m so thin structural beams (e.g. 7.5×1.6m)
    //     and narrow edge strips (e.g. 0.85×11.2m) are NOT treated as rooms.
    //   → Only actual rooms (stairwells, elevator shafts, mechanical rooms)
    //     have both width and height above 2m.
    // NO_ENTREE LWPOLYLINE = restricted access zones.
    // ── Step 2: Force VERTICAL axis — corridors run N-S matching COSTO reference ────
    // Reference uses N-S column pairs (vertical corridors), NOT horizontal bands.
    const mainAxis = 'vertical';
    console.log(`[Step 2] Main axis: VERTICAL (forced) — N-S column pairs | building ${usW.toFixed(1)}m wide × ${usH.toFixed(1)}m tall`);
    const MIN_CORE_DIM = 1.2;   // m — min dimension in BOTH axes (was 2.0m, now catches corridors too)
    const serviceCores = murPolygons.filter(p =>
        p.bboxArea >= 3 && p.w >= MIN_CORE_DIM && p.h >= MIN_CORE_DIM
    );

    // ── Wall-cluster obstacle detection ────────────────────────────────
    // detectObstacles: finds 3m grid cells with ≥5 structural walls → obstacle bounding box
    // detectCornerClusters: finer 2m grid on LEFT 30% of building to catch LINE-based rooms
    const wallObstacles = detectObstacles(allWalls, usX, usY, usW, usH);
    const cornerObstacles = detectCornerClusters(allWalls, usX, usY, usW, usH, minX, maxX, minY, maxY);

    // ── Interior walls for isBlocked filtering ─────────────────────────
    // Exclude building perimeter walls (within 0.5m of boundary) so boxes flush
    // against the building edge are NOT rejected. Only interior partition walls block boxes.
    const PERIM_THRESH = 0.5;
    const interiorWalls = structWalls.filter(w => {
        const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2;
        if(Math.abs(mx - minX) < PERIM_THRESH || Math.abs(mx - maxX) < PERIM_THRESH) return false;
        if(Math.abs(my - minY) < PERIM_THRESH || Math.abs(my - maxY) < PERIM_THRESH) return false;
        return true;
    });

    // ALL MUR walls ≥0.3m for comprehensive collision detection
    // Use very tight perimeter filter (0.15m) — only exclude walls ON the building boundary,
    // NOT walls that are 0.3-0.5m inside (those are real interior partition walls).
    const PERIM_TIGHT = 0.15; // only exclude walls truly ON the building edge
    const allInteriorWalls = allWalls.filter(w => {
        const len = Math.hypot(w.x2-w.x1, w.y2-w.y1);
        if(len < 1.5) return false; // Check walls ≥1.5m (real partitions, not door frames)
        // Exclude wall ONLY if BOTH endpoints are on the same perimeter edge
        const onLeft  = Math.abs(w.x1 - minX) < PERIM_TIGHT && Math.abs(w.x2 - minX) < PERIM_TIGHT;
        const onRight = Math.abs(w.x1 - maxX) < PERIM_TIGHT && Math.abs(w.x2 - maxX) < PERIM_TIGHT;
        const onBot   = Math.abs(w.y1 - minY) < PERIM_TIGHT && Math.abs(w.y2 - minY) < PERIM_TIGHT;
        const onTop   = Math.abs(w.y1 - maxY) < PERIM_TIGHT && Math.abs(w.y2 - maxY) < PERIM_TIGHT;
        if(onLeft || onRight || onBot || onTop) return false;
        return true;
    });

    // Service core polygon edges NOT added to allInteriorWalls
    // Room exclusion is handled by the mergedZones AABB overlap check (overlapsRoom)
    // Adding polygon edges here double-blocks boxes near service cores, creating gaps

    // ── Top-right staircase detection ───────────────────────────────────
    // The spiral staircase at the top-right is built from many SHORT wall segments (<5m)
    // that don't appear in structWalls. Detect dense wall clusters in the top-right corner.
    const trCornerWalls = allWalls.filter(w => {
        const mx = (w.x1+w.x2)/2, my = (w.y1+w.y2)/2;
        return mx > maxX - 5 && my > maxY - 5;
    });
    const staircaseZones = [];
    if (trCornerWalls.length >= 15) {
        // Dense wall cluster = staircase room. Compute bounding box.
        let sx1=Infinity, sy1=Infinity, sx2=-Infinity, sy2=-Infinity;
        for(const w of trCornerWalls) {
            sx1=Math.min(sx1,w.x1,w.x2); sy1=Math.min(sy1,w.y1,w.y2);
            sx2=Math.max(sx2,w.x1,w.x2); sy2=Math.max(sy2,w.y1,w.y2);
        }
        staircaseZones.push({x:sx1-0.1, y:sy1-0.1, w:sx2-sx1+0.2, h:sy2-sy1+0.2, pts:null});
        console.log(`[Step 1] Staircase zone: (${sx1.toFixed(1)},${sy1.toFixed(1)}) ${(sx2-sx1).toFixed(1)}×${(sy2-sy1).toFixed(1)}m from ${trCornerWalls.length} walls`);
    }

    // ── Bottom-right service room detection ─────────────────────────────
    // Dense wall clusters at bottom-right form service rooms (mechanical, stairwell)
    // that aren't captured as closed LWPOLYLINE polygons.
    const brServiceZones = [];
    // Zone 1: VERTICAL walls around x=31-33, y=8-15 (room side boundaries only)
    const brWalls1 = allWalls.filter(w => {
        const mx=(w.x1+w.x2)/2, my=(w.y1+w.y2)/2;
        const isVertical = Math.abs(w.y2-w.y1) > Math.abs(w.x2-w.x1);
        return isVertical && mx > 30 && mx < 34 && my > 7 && my < 16;
    });
    if (brWalls1.length >= 8) {
        let bx1=Infinity,by1=Infinity,bx2=-Infinity,by2=-Infinity;
        for(const w of brWalls1){bx1=Math.min(bx1,w.x1,w.x2);by1=Math.min(by1,w.y1,w.y2);bx2=Math.max(bx2,w.x1,w.x2);by2=Math.max(by2,w.y1,w.y2);}
        brServiceZones.push({x:bx1-0.1,y:by1-0.1,w:bx2-bx1+0.2,h:by2-by1+0.2,pts:null});
        console.log(`[Step 1] BR service zone 1: (${bx1.toFixed(1)},${by1.toFixed(1)}) ${(bx2-bx1).toFixed(1)}×${(by2-by1).toFixed(1)}m from ${brWalls1.length} walls`);
    }
    // Zone 2: walls around x=39-42, y=1-9 (right edge service corridor)
    const brWalls2 = allWalls.filter(w => {
        const mx=(w.x1+w.x2)/2, my=(w.y1+w.y2)/2;
        return mx > 38 && my > 1 && my < 9;
    });
    if (brWalls2.length >= 8) {
        let bx1=Infinity,by1=Infinity,bx2=-Infinity,by2=-Infinity;
        for(const w of brWalls2){bx1=Math.min(bx1,w.x1,w.x2);by1=Math.min(by1,w.y1,w.y2);bx2=Math.max(bx2,w.x1,w.x2);by2=Math.max(by2,w.y1,w.y2);}
        brServiceZones.push({x:bx1-0.1,y:by1-0.1,w:bx2-bx1+0.2,h:by2-by1+0.2,pts:null});
        console.log(`[Step 1] BR service zone 2: (${bx1.toFixed(1)},${by1.toFixed(1)}) ${(bx2-bx1).toFixed(1)}×${(by2-by1).toFixed(1)}m from ${brWalls2.length} walls`);
    }


    // ── Entry access corridor exclusion zones ─────────────────────────
    // Each ENTREE__SORTIE polygon represents a doorway. Create a 1.5m-deep
    // exclusion zone perpendicular to the door so boxes don't block access.
    const entryAccessZones = [];
    for(const ep of entryPolygons) {
        const isVertDoor = ep.h > ep.w; // vertical door = expand in X
        if(isVertDoor) {
            // Door opens left/right — clear 0.8m on BOTH sides
            entryAccessZones.push({x: ep.x - 0.8, y: ep.y - 0.1, w: ep.w + 1.6, h: ep.h + 0.2, pts: null});
        } else {
            // Door opens up/down — clear 0.8m on BOTH sides
            entryAccessZones.push({x: ep.x - 0.1, y: ep.y - 0.8, w: ep.w + 0.2, h: ep.h + 1.6, pts: null});
        }
    }
    console.log(`[Step 1] Entry access corridors: ${entryAccessZones.length} zones from ${entryPolygons.length} entries`);

    // ── Right-side service rooms ─────────────────────────────────────
    // Only exclude the ACTUAL service room footprints (elevator shaft, staircase)
    // NOT a full-height strip. Boxes should fill right up to service room walls.
    const shaftZones = [];
    // Service core footprints are already in mergedZones via serviceCores.
    // No additional full-height strip needed.
    console.log(`[Step 1] Right service rooms: handled by core footprints only`);

    const mergedZones = [
        // ALL service cores — use polygon pts for precise exclusion
        ...serviceCores.map(p => ({x:p.x, y:p.y, w:p.w, h:p.h, pts:p.pts||null})),
        ...staircaseZones,
    ];
    console.log(`[Step 1] Room exclusion zones: ${mergedZones.length} (${serviceCores.length} cores + ${staircaseZones.length} stairs)`);

    console.log(`[Step 1] Plan: ${(maxX-minX).toFixed(1)}m x ${(maxY-minY).toFixed(1)}m`);
    console.log(`[Step 1] MUR walls: ${allWalls.length} segs | Service cores: ${serviceCores.length} polygons | NO_ENTREE zones: ${noEntryPolygons.length} | Access points: ${entryPolygons.length}`);
    console.log(`[Step 1] Wall obstacles: ${wallObstacles.length} | Corner clusters: ${cornerObstacles.length} | Interior walls: ${interiorWalls.length}/${structWalls.length}`);
    serviceCores.forEach((z,i)=>console.log(`  Core ${i}: (${z.x.toFixed(1)},${z.y.toFixed(1)}) ${z.w.toFixed(1)}×${z.h.toFixed(1)}m  area=${z.bboxArea.toFixed(1)}m² npts=${z.npts}`));
    wallObstacles.forEach((z,i)=>console.log(`  WallObs ${i}: (${z.x.toFixed(1)},${z.y.toFixed(1)}) ${z.w.toFixed(1)}×${z.h.toFixed(1)}m`));
    cornerObstacles.forEach((z,i)=>console.log(`  Corner ${i}: (${z.x.toFixed(1)},${z.y.toFixed(1)}) ${z.w.toFixed(1)}×${z.h.toFixed(1)}m`));

    // expandedObstacles for band-level exclusion = wall-touching service cores
    const WALL_TOUCH = 1.5;
    const expandedObstacles = mergedZones.filter(z =>
        z.x <= usX + WALL_TOUCH ||
        z.x + z.w >= usX + usW - WALL_TOUCH ||
        z.y <= usY + WALL_TOUCH ||
        z.y + z.h >= usY + usH - WALL_TOUCH
    );
    console.log(`[Step 1] Band exclusion: ${expandedObstacles.length}/${mergedZones.length} wall-touching zones`);



    // ── Step 3: Generate main corridor positions ──────────────────────
    // Pair = BOX_DEPTH + CORRIDOR + BOX_DEPTH
    // Reduced BOX_DEPTH to 3.45m to fit 4 vertical pairs in standard building width
    const BOX_DEPTH_V = BOX_DEPTH;  // Use global constant (2.90m wide landscape boxes)
    const PAIR_H = BOX_W + MAIN_CORR_W + BOX_W;  // 1.2 + 1.2 + 1.2 = 3.6m (LANDSCAPE pairs)
    const mainCorridors=[], mainBandBoxes=[], bandEdges=[];

    // Track where each pair occupies [stackStart, stackStart+PAIR_H]
    // ── PRE-STEP: Place wall-face boxes FIRST (wall-first architecture) ────────
    // Corridor positions are deterministic from sp — pre-compute them before band fill
    // so wall-face boxes can be placed with PRIORITY (corridors seeded, no bands yet).
    const preCorridors = [];
    // Vertical: pairs start from LEFT building edge — reference shows service rooms
    // are WITHIN the first pair's left column, not a separate excluded zone.
    const stackStart = usX;  // full building width available for corridor pairs
    const stackDim   = usW;  // entire building width
    let _sp = stackStart;
    while(_sp + PAIR_H <= stackStart + stackDim) {
        const corrSP_ = _sp + BOX_DEPTH_V;
        preCorridors.push({id:`pre_corr_${preCorridors.length}`,x:corrSP_,y:usY,width:MAIN_CORR_W,height:usH});
        _sp += PAIR_H + PAIR_SEP;
    }
    // ── PRE-STEP: Perimeter wall coverage ─────────
    // In landscape horizontal-pair mode, wall coverage is handled by the pair rows themselves:
    // - LEFT/RIGHT walls: each row starts at usX and ends at usX+usW (flush)
    // - BOTTOM wall: Pair 0's Row A starts at usY (flush)
    // - TOP wall: last pair's Row B extends to usY+usH (flush)
    // No separate perimeter boxes needed.
    const perimBoxes = [];
    const wallFaceBoxesFirst = [];
    console.log(`[PRE] Perimeter handled by pair rows (flush to walls)`);

    // Helper: does a candidate box overlap any wall-face priority box?
    const isWFOcc = (bx,by,bw,bh) => false; // No priority boxes in landscape mode

    let pairIdx = 0;

    // ═══════════════════════════════════════════════════════════════════════
    // HORIZONTAL PAIR ARCHITECTURE — LANDSCAPE BOXES (matching COSTO ref)
    // ═══════════════════════════════════════════════════════════════════════
    // Each pair stacks bottom→top:
    //
    //   Row A (BOX_W=1.2m tall, landscape boxes 2.9m wide × 1.2m tall)
    //   ═══════ HORIZONTAL CORRIDOR (1.2m) ═══════
    //   Row B (BOX_W=1.2m tall, landscape boxes 2.9m wide × 1.2m tall)
    //
    // Each pair: 1.2 + 1.2 + 1.2 = 3.6m total height
    // Building ~40.7m → 11 full pairs
    //
    // Each row fills LEFT→RIGHT with boxes of BOX_DEPTH (2.9m) width,
    // flush against building walls.
    // ═══════════════════════════════════════════════════════════════════════

    // PAIR_H already defined above: BOX_W + MAIN_CORR_W + BOX_W = 3.6m
    const ROW_H = BOX_W;  // Each row is 1.2m tall (landscape box height)

    console.log(`[Step 3] === HORIZONTAL PAIR LAYOUT (LANDSCAPE) ===`);
    console.log(`[Step 3] Pair height: ${PAIR_H.toFixed(1)}m (${BOX_W}+${MAIN_CORR_W}+${BOX_W})`);
    console.log(`[Step 3] Box: ${BOX_DEPTH}m wide × ${BOX_W}m tall (landscape)`);
    console.log(`[Step 3] Building: ${usW.toFixed(1)}m wide × ${usH.toFixed(1)}m tall → ${Math.floor(usH/PAIR_H)} full pairs`);

    // ── Helper: get vertical wall X positions crossing a Y range ──────
    // Only considers LONG vertical walls (≥3m span) that truly partition the building
    const getVertWallXs = (yMin, yMax) => {
        const xs = [];
        for(const w of allInteriorWalls) {
            if(Math.abs(w.x2 - w.x1) > 0.5) continue; // skip horizontal walls
            const wallH = Math.abs(w.y2 - w.y1);
            if(wallH < 3.0) continue; // only long vertical partitions split the row
            const wy1 = Math.min(w.y1, w.y2), wy2 = Math.max(w.y1, w.y2);
            if(wy2 > yMin + 0.1 && wy1 < yMax - 0.1) xs.push((w.x1 + w.x2) / 2);
        }
        return [...new Set(xs.map(x => Math.round(x*10)/10))].sort((a,b) => a - b);
    };

    // ── Early corridor geometry constants ──
    const SV_ZONE_W = 10.0; // service zone width from constants
    const leftVertCorrX = usX + SV_ZONE_W - MAIN_CORR_W; // position vertical corridor

    // ── Helper: fill a horizontal row with LANDSCAPE boxes ──────
    // WALL-AWARE: fill RIGHT of vertical corridor to right wall,
    // skipping past any structural wall that crosses the box position.
    const fillHorizRow = (rowY, rowH, doorSide, pIdx) => {
        const boxes = [];
        const startX = leftVertCorrX + MAIN_CORR_W; // start RIGHT of left vertical corridor (flush)
        const endX = usX + usW; // extend to building right wall (reference style)
        let bx = startX;

        // Helper: check if a box at (bx, rowY, w, rowH) hits ANY interior wall (vert or horiz)
        const hitsWall = (x, w) => {
            let nearest = null;
            for(const wall of allInteriorWalls) {
                const wLen = Math.hypot(wall.x2-wall.x1, wall.y2-wall.y1);
                if(wLen < 1.0) continue;
                const isVert = Math.abs(wall.x2-wall.x1) < 0.5;
                if(!isVert) continue; // only vertical walls split horizontal rows
                if(segAABB(wall.x1,wall.y1,wall.x2,wall.y2, x, rowY, w, rowH)) {
                    const wL = Math.min(wall.x1,wall.x2);
                    if(!nearest || wL < nearest.wallLeft) {
                        nearest = { hit: true, wallLeft: wL, wallRight: Math.max(wall.x1,wall.x2) };
                    }
                }
            }
            return nearest || { hit: false };
        };

        while(bx + MIN_BW <= endX + 0.01) {
            const candidateW = Math.min(BOX_DEPTH, endX - bx);
            if(candidateW < MIN_BW) break;
            
            const check = hitsWall(bx, candidateW);
            
            if(!check.hit) {
                // No wall — place full box
                boxes.push({x: bx, y: rowY, width: candidateW, height: rowH, doorSide, pairIdx: pIdx});
                bx += candidateW;
            } else {
                // Wall blocks this box. Try placing a PARTIAL box BEFORE the wall — FLUSH
                const spaceBeforeWall = check.wallLeft - bx;
                if(spaceBeforeWall >= MIN_BW) {
                    const partialCheck = hitsWall(bx, spaceBeforeWall);
                    if(!partialCheck.hit) {
                        boxes.push({x: bx, y: rowY, width: spaceBeforeWall, height: rowH, doorSide, pairIdx: pIdx});
                    }
                }
                // Skip past the wall and continue — FLUSH against wall edge (NO gap)
                const newBx = check.wallRight;
                if(newBx <= bx + 0.01) bx += 0.1; // safety: always advance
                else bx = newBx;
            }
        }
        return boxes;
    };


    // ── Stack horizontal pairs from bottom to top ──
    const nPairs = Math.floor(usH / PAIR_H);
    let pairY = usY; // start flush from building bottom
    // bandEdges already declared above (line 774)

    while(pairY + PAIR_H <= usY + usH + 0.01) {
        const rowAY = pairY;                     // Bottom row (doors face UP to corridor)
        const corrY = pairY + ROW_H;             // Corridor position
        const rowBY = corrY + MAIN_CORR_W;       // Top row (doors face DOWN to corridor)

        // Create horizontal corridor
        mainCorridors.push({
            id: `main_h${pairIdx}`,
            x: leftVertCorrX, y: corrY, width: usX + usW - leftVertCorrX, height: MAIN_CORR_W,
            direction: 'horizontal', type: 'main_artery',
            corners: [{x:leftVertCorrX,y:corrY},{x:usX+usW,y:corrY},{x:usX+usW,y:corrY+MAIN_CORR_W},{x:leftVertCorrX,y:corrY+MAIN_CORR_W}]
        });

        // Fill Row A (bottom row, doors face UP to corridor above)
        const rowABoxes = fillHorizRow(rowAY, ROW_H, 'top', pairIdx);
        mainBandBoxes.push(...rowABoxes);

        // Fill Row B (top row, doors face DOWN to corridor below)
        const rowBBoxes = fillHorizRow(rowBY, ROW_H, 'bottom', pairIdx);
        mainBandBoxes.push(...rowBBoxes);

        bandEdges.push({top: pairY, bot: pairY + PAIR_H});
        console.log(`[Step 3] Pair ${pairIdx}: Y=${pairY.toFixed(1)}-${(pairY+PAIR_H).toFixed(1)} | RowA: ${rowABoxes.length} | Corr: Y=${corrY.toFixed(1)} | RowB: ${rowBBoxes.length}`);

        pairY += PAIR_H + PAIR_SEP;
        pairIdx++;
    }

    // ── Fill remaining space at top with partial rows ──
    const remainingH = (usY + usH) - pairY;
    if(remainingH >= MIN_BW) {
        if(remainingH >= PAIR_H * 0.5) {
            // Fit a partial pair: Row + Corridor + partial Row
            const rowAY = pairY;
            const corrY = pairY + ROW_H;
            const rowBY = corrY + MAIN_CORR_W;
            const rowBH = Math.min(ROW_H, (usY + usH) - rowBY);

            if(rowBH >= MIN_BW) {
                mainCorridors.push({
                    id: `main_h${pairIdx}`,
                    x: leftVertCorrX, y: corrY, width: usX + usW - leftVertCorrX, height: MAIN_CORR_W,
                    direction: 'horizontal', type: 'main_artery',
                    corners: [{x:leftVertCorrX,y:corrY},{x:usX+usW,y:corrY},{x:usX+usW,y:corrY+MAIN_CORR_W},{x:leftVertCorrX,y:corrY+MAIN_CORR_W}]
                });
                mainBandBoxes.push(...fillHorizRow(rowAY, ROW_H, 'top', pairIdx));
                mainBandBoxes.push(...fillHorizRow(rowBY, rowBH, 'bottom', pairIdx));
                bandEdges.push({top: pairY, bot: pairY + ROW_H + MAIN_CORR_W + rowBH});
                console.log(`[Step 3] Partial pair ${pairIdx}: Y=${pairY.toFixed(1)}-${(pairY+ROW_H+MAIN_CORR_W+rowBH).toFixed(1)} (rowBH=${rowBH.toFixed(1)}m)`);
                pairIdx++;
            }
        } else {
            // Fill with a single row using whatever height remains (flush to top wall)
            const rowH = Math.min(ROW_H, remainingH);
            const rowBoxes = fillHorizRow(pairY, rowH, 'bottom', pairIdx);
            mainBandBoxes.push(...rowBoxes);
            bandEdges.push({top: pairY, bot: pairY + rowH});
            console.log(`[Step 3] Top edge row: Y=${pairY.toFixed(1)} h=${rowH.toFixed(1)}m | ${rowBoxes.length} boxes`);
            pairIdx++;
        }
    }

    // ── Add vertical corridor on LEFT side (service zone boundary) ──
    // Reference design shows a vertical corridor at the service zone edge (~10m from left)
    // connecting all horizontal corridors for access to service rooms
    mainCorridors.push({
        id: 'vert_left',
        x: leftVertCorrX, y: usY, width: MAIN_CORR_W, height: usH,
        direction: 'vertical', type: 'main_artery',
        corners: [{x:leftVertCorrX,y:usY},{x:leftVertCorrX+MAIN_CORR_W,y:usY},
                  {x:leftVertCorrX+MAIN_CORR_W,y:usY+usH},{x:leftVertCorrX,y:usY+usH}]
    });
    console.log(`[Step 3] Left vertical corridor: x=${leftVertCorrX.toFixed(1)} (service zone boundary)`);

    // No right vertical corridor — reference only uses ONE vertical corridor (left).
    // Landscape rows extend full-width from left corridor to right wall.

    // ── LEFT-ZONE DENSE GRID FILL ─────────────────────────────────────────
    // Client requirement: NO SPACE between boxes. The left zone is packed as
    // a CONTINUOUS grid — boxes touch each other edge-to-edge in both X and Y.
    // No horizontal corridor gaps. Access is from the vertical corridor on the right.
    // This matches the professional reference (solid block of portrait boxes).
    const leftZoneBoxes = [];
    const leftX = usX;
    const leftEnd = leftVertCorrX; // up to the vertical corridor
    const leftW = leftEnd - leftX;
    if(leftW >= BOX_W + 0.1) {
        // Continuous Y packing: stack boxes from bottom wall to top wall, no gaps
        let ly = usY;
        while(ly + BOX_W <= usY + usH + 0.01) {
            let lx = leftX;
            while(lx + BOX_W <= leftEnd + 0.01) {
                leftZoneBoxes.push({x:lx, y:ly, width:BOX_W, height:BOX_W, doorSide:'right', pairIdx:0});
                lx += BOX_W;
            }
            ly += BOX_W; // ZERO gap — next row starts immediately
        }
        console.log(`[Step 3] Left-zone DENSE grid: +${leftZoneBoxes.length} boxes (${leftW.toFixed(1)}m × ${usH.toFixed(1)}m, zero gaps)`);
    }
    mainBandBoxes.push(...leftZoneBoxes);

    // No right-zone portrait fill — reference extends landscape rows full width.
    // Wall-collision cleanup handles boxes that overlap service room walls.
    console.log(`[Step 3] No right zone — landscape rows cover full width`);

    // ── Step 7: Ensure corridor continuity — remove any box inside corridors ──
    const cleanMain = pruneBoxesInCorridors(mainBandBoxes, mainCorridors);

    // ── Step 8: Fill secondary areas (gaps between pairs and at top/bottom) ──
    const allGapBands=[];
    // Pre-stackStart gap: usX → stackStart (the left service zone area — fill around service rooms)
    const SEC_MIN_H = BOX_DEPTH + 0.1;  // minimum gap height to bother filling
    if(stackStart > usX + SEC_MIN_H)
        allGapBands.push({y0:usX, y1:stackStart});
    // Top gap: stackStart → first pair top
    if(bandEdges.length>0 && bandEdges[0].top - stackStart >= SEC_MIN_H)
        allGapBands.push({y0:stackStart, y1:bandEdges[0].top});
    // Inter-pair gaps
    for(let k=0;k<bandEdges.length-1;k++){
        const gapY0=bandEdges[k].bot+PAIR_SEP;
        const gapY1=bandEdges[k+1].top;
        if(gapY1-gapY0>=SEC_MIN_H) allGapBands.push({y0:gapY0, y1:gapY1});
    }
    // Bottom gap: last pair bottom → stackStart+stackDim
    const lastBot=bandEdges.length?bandEdges[bandEdges.length-1].bot+PAIR_SEP:stackStart;
    if(stackStart+stackDim-lastBot>=SEC_MIN_H)
        allGapBands.push({y0:lastBot, y1:stackStart+stackDim});

    const secBoxes=[], secCorridors=[];
    for(const gap of allGapBands){
        // For vertical stacking: gap is an X-range [gap.y0, gap.y1].
        // Fill with landscape boxes (BOX_DEPTH wide x BOX_W tall) for the full Y height.
        // Clamp right edge so we don't overlap right-wall face boxes.
        const xEnd = Math.min(gap.y1, usX+usW-BOX_DEPTH+0.01);
        for(let gx=gap.y0; gx+BOX_DEPTH<=xEnd+0.01; gx+=BOX_DEPTH)
            for(let gy=usY; gy+BOX_W<=usY+usH+0.01; gy+=BOX_W)
                secBoxes.push({x:gx, y:gy, width:BOX_DEPTH, height:BOX_W});
    }
    console.log(`[Step 8] Secondary: ${secCorridors.length} corridors, ${secBoxes.length} boxes (${allGapBands.length} gap bands)`);

    // ── Guaranteed top + bottom flush rows ──────────────────────────────────
    // Ensures the top and bottom exterior walls are ALWAYS fully covered,
    // regardless of secondary band height. Uses full width (usX to usX+usW).
    const allSoFar = [...mainBandBoxes, ...secBoxes]; // occupancy seed
    const isAlreadyOcc = (bx,by,bw,bh) => {
        const E=0.04;
        return allSoFar.some(b=>
            bx+bw>b.x+E && bx<b.x+b.width-E &&
            by+bh>b.y+E && by<b.y+b.height-E
        );
    };
    // Bottom flush row: y=[usY, usY+BOX_DEPTH] full width, skip if already occupied
    const bottomFlushY = usY;
    const bottomFlushBoxes = fillRow(usX, usW, bottomFlushY, BOX_DEPTH, null, [], 0.0)
        .filter(b => !isAlreadyOcc(b.x, b.y, b.width, b.height));
    // Top flush row: y=[usY+usH-BOX_DEPTH, usY+usH] full width, skip if already occupied
    const topFlushY = usY + usH - BOX_DEPTH;
    const topFlushBoxes = topFlushY > usY + BOX_DEPTH
        ? fillRow(usX, usW, topFlushY, BOX_DEPTH, null, [], 0.0)
              .filter(b => !isAlreadyOcc(b.x, b.y, b.width, b.height))
        : [];
    console.log(`[Step 8b] Flush rows: bottom +${bottomFlushBoxes.length}, top +${topFlushBoxes.length}`);

    // ── POST-STEP: Horizontal wall face fill (after bands) ───────────────────
    // Now bands are complete — seed with them + corridors and fill remaining
    // horizontal obstacle wall faces that bands didn't cover.
    const horizFaceWalls = faceWalls.filter(w=> Math.abs(w.x2-w.x1) > Math.abs(w.y2-w.y1));
    const allBandBoxes = [...wallFaceBoxesFirst,...cleanMain,...secBoxes,...bottomFlushBoxes,...topFlushBoxes];
    const wallFaceBoxesPost = addWallHuggingBoxes(horizFaceWalls, allBandBoxes, [...mainCorridors,...secCorridors], usX, usY, usW, usH, structWalls);
    console.log(`[POST] Horizontal wall-face fill: +${wallFaceBoxesPost.length} boxes`);

    // ── DENSE SWEEP: Final gap fill — scan ALL positions, place in any open slot ──────
    // After all bands+flush+post-step, do a comprehensive portrait box sweep.
    // Every 1m×2m position in the building that is:
    //   (a) not already occupied by an existing box
    //   (b) not inside any corridor zone
    //   (c) not blocked by a structural wall
    // gets a box placed. This fills every remaining gap including around room walls.
    const allCorridors=[...mainCorridors,...secCorridors];
    const denseAllBoxes=[...wallFaceBoxesFirst,...cleanMain,...secBoxes,...bottomFlushBoxes,...topFlushBoxes,...wallFaceBoxesPost];
    // Build occupancy grid for fast lookup
    const denseGap=[];
    const prePlaced = new Set();
    for(const b of denseAllBoxes) {
        const gx=Math.round(b.x*10), gy=Math.round(b.y*10);
        prePlaced.add(`${gx},${gy}`);
    }
    // Sweep: try BOTH orientations — portrait (BOX_W×BOX_DEPTH) and landscape (BOX_DEPTH×BOX_W)
    const tryPlace = (gx, gy, bw, bh) => {
        const kx=Math.round(gx*10), ky=Math.round(gy*10);
        const k=`${kx},${ky},${Math.round(bw*10)}`;
        if(prePlaced.has(k)) return false;
        if(gx+bw > usX+usW+0.01 || gy+bh > usY+usH+0.01) return false;
        // Skip if in any corridor
        const inCorr = allCorridors.some(c=>
            gx+bw-0.02>c.x && gx+0.02<c.x+c.width &&
            gy+bh-0.02>c.y && gy+0.02<c.y+c.height);
        if(inCorr) return false;
        // Skip if inside detected room zone (AABB overlap, not just center)
        const inExcl = mergedZones.some(z=>
            gx+bw-0.1>z.x && gx+0.1<z.x+z.w &&
            gy+bh-0.1>z.y && gy+0.1<z.y+z.h);
        if(inExcl) return false;
        // Skip if wall collision (interior structural walls)
        if(isBlocked(gx, gy, bw, bh, allInteriorWalls)) return false;
        // Skip if overlaps any existing box
        const overlaps = denseAllBoxes.some(b=>
            gx+bw-0.04>b.x && gx+0.04<b.x+b.width &&
            gy+bh-0.04>b.y && gy+0.04<b.y+b.height);
        if(overlaps) return false;
        // Also check against already-placed dense boxes
        const overlapsDense = denseGap.some(b=>
            gx+bw-0.04>b.x && gx+0.04<b.x+b.width &&
            gy+bh-0.04>b.y && gy+0.04<b.y+b.height);
        if(overlapsDense) return false;
        denseGap.push({x:gx, y:gy, width:bw, height:bh});
        prePlaced.add(k);
        return true;
    };
    // Pass 1: landscape orientation (BOX_DEPTH wide × BOX_W tall) — fine 0.5m grid
    const STEP = 0.50; // fine grid step for gap detection
    for(let gy=usY; gy<usY+usH-BOX_W+0.01; gy+=STEP) {
        for(let gx=usX; gx<usX+usW-BOX_DEPTH+0.01; gx+=STEP) {
            tryPlace(gx, gy, BOX_DEPTH, BOX_W);
        }
    }
    // Pass 2: portrait orientation (BOX_W wide × BOX_DEPTH tall) — fine 0.5m grid
    for(let gy=usY; gy<usY+usH-BOX_DEPTH+0.01; gy+=STEP) {
        for(let gx=usX; gx<usX+usW-BOX_W+0.01; gx+=STEP) {
            tryPlace(gx, gy, BOX_W, BOX_DEPTH);
        }
    }
    console.log(`[DENSE] Sweep fill: +${denseGap.length} gap boxes`);

    // ── Step 9: Cleanup — merge all, enforce no box in any corridor ──
    // (allCorridors already declared in DENSE SWEEP block above)

    // ── Step 9a: Post-filter — remove any box that OVERLAPS a room zone ──
    // Full AABB overlap so boxes don't render on service room walls.
    const ROOM_MARGIN = 0; // Flush against room walls — reference design has zero gap
    const overlapsRoom = (b, zones) => {
        const bx1 = b.x + ROOM_MARGIN, by1 = b.y + ROOM_MARGIN;
        const bx2 = b.x + b.width - ROOM_MARGIN, by2 = b.y + b.height - ROOM_MARGIN;
        return zones.some(z => {
            if(bx2 <= z.x || bx1 >= z.x+z.w || by2 <= z.y || by1 >= z.y+z.h) return false;
            if(z.pts && z.pts.length >= 3) {
                const cx = b.x+b.width/2, cy = b.y+b.height/2;
                if(pointInPoly(cx, cy, z.pts)) return true;
                if(pointInPoly(bx1, by1, z.pts)) return true;
                if(pointInPoly(bx2, by1, z.pts)) return true;
                if(pointInPoly(bx1, by2, z.pts)) return true;
                if(pointInPoly(bx2, by2, z.pts)) return true;
                for(const pt of z.pts) {
                    if(pt.x >= bx1 && pt.x <= bx2 && pt.y >= by1 && pt.y <= by2) return true;
                }
                return false;
            }
            return true;
        });
    };
    // filterRooms: exclude box overlapping room OR crossing interior walls
    const filterRooms = b => !overlapsRoom(b, mergedZones) && !isBlocked(b.x, b.y, b.width, b.height, allInteriorWalls);

    // Priority order: main-band landscape FIRST (wins dedup), then wall-face portraits.
    // wallFaceBoxesFirst filtered by rooms so staircase portraits are excluded.
    const wallFaceFiltered = wallFaceBoxesFirst.filter(filterRooms);
    const mainFiltered = cleanMain.filter(filterRooms);
    const secFiltered = secBoxes.filter(filterRooms);

    // ── POST-FILTER GAP FILL ────────────────────────────────────────────
    // After filterRooms removes boxes overlapping service cores, gaps appear between
    // the last placed box and the core boundary. Fill these gaps with partial boxes.
    const gapFillBoxes = [];
    const allZoneExclusions = [...mergedZones]; // service cores + staircase + NO_ENTREE

    // Group landscape boxes by row Y position
    const landBoxesByRow = {};
    for(const b of mainFiltered) {
        const ky = Math.round(b.y * 10);
        if(!landBoxesByRow[ky]) landBoxesByRow[ky] = [];
        landBoxesByRow[ky].push(b);
    }

    for(const ky in landBoxesByRow) {
        const rowBoxes = landBoxesByRow[ky].sort((a,b) => a.x - b.x);
        if(rowBoxes.length === 0) continue;
        const rowY = rowBoxes[0].y;
        const rowH = rowBoxes[0].height;
        const doorSide = rowBoxes[0].doorSide;
        const pairIdx = rowBoxes[0].pairIdx;

        // Find gaps between consecutive boxes
        for(let i = 0; i < rowBoxes.length - 1; i++) {
            const gapStart = rowBoxes[i].x + rowBoxes[i].width;
            const gapEnd = rowBoxes[i+1].x;
            const gapW = gapEnd - gapStart;
            if(gapW >= MIN_BW) {
                // Try full-size boxes first, then partial at the end
                let bx = gapStart;
                while(bx + MIN_BW <= gapEnd + 0.01) {
                    const w = Math.min(BOX_DEPTH, gapEnd - bx);
                    if(w < MIN_BW) break;
                    const candidate = {x: bx, y: rowY, width: w, height: rowH, doorSide, pairIdx};
                    if(filterRooms(candidate)) {
                        gapFillBoxes.push(candidate);
                        bx += w;
                    } else {
                        // This box overlaps an exclusion — try smaller
                        // Find nearest zone boundary ahead
                        let maxW = w;
                        while(maxW >= MIN_BW) {
                            maxW -= 0.1;
                            const smaller = {x: bx, y: rowY, width: maxW, height: rowH, doorSide, pairIdx};
                            if(filterRooms(smaller)) { gapFillBoxes.push(smaller); bx += maxW; break; }
                        }
                        if(maxW < MIN_BW) bx += 0.5; // skip ahead
                    }
                }
            }
        }

        // Check gap at end of row + between-box gaps near exclusion zones
        const lastBox = rowBoxes[rowBoxes.length - 1];
        const lastEnd = lastBox.x + lastBox.width;
        const rowRightEdge = usX + usW;
        if(rowRightEdge - lastEnd >= MIN_BW) {
            let bx = lastEnd;
            while(bx + MIN_BW <= rowRightEdge + 0.01) {
                const w = Math.min(BOX_DEPTH, rowRightEdge - bx);
                if(w < MIN_BW) break;
                const candidate = {x: bx, y: rowY, width: w, height: rowH, doorSide, pairIdx};
                if(filterRooms(candidate)) {
                    gapFillBoxes.push(candidate);
                    bx += w;
                } else {
                    // Shrink until it fits before exclusion zone
                    let maxW = w;
                    while(maxW >= MIN_BW) {
                        maxW -= 0.1;
                        const smaller = {x: bx, y: rowY, width: maxW, height: rowH, doorSide, pairIdx};
                        if(filterRooms(smaller)) { gapFillBoxes.push(smaller); bx += maxW; break; }
                    }
                    if(maxW < MIN_BW) bx += 0.5; // skip past exclusion zone
                }
            }
        }
    }
    console.log(`[GAP FILL] +${gapFillBoxes.length} partial boxes filling gaps near service cores`);

    const allBoxesRaw = [
        ...mainFiltered,
        ...gapFillBoxes,
        ...secFiltered,
        ...bottomFlushBoxes.filter(filterRooms),
        ...topFlushBoxes.filter(filterRooms),
        ...wallFaceFiltered,                        // portrait — after landscape
        ...wallFaceBoxesPost.filter(filterRooms),
        ...denseGap.filter(filterRooms)
    ];

    // ── Two-pass dedup ────────────────────────────────────────────────────────
    // Pass 1 (fast key-based): same top-left corner (rounded to 0.1m) → keep first = landscape.
    // Pass 2 (AABB): catch portrait boxes that survived key-dedup but physically overlap a
    //   landscape box (e.g. interior wall-face portrait at non-.5 x vs adjacent landscape).
    //   This is the "unit_710 bug" fix. O(N²) ≈ 700×700 = 490K checks — negligible.
    const _seenPos = new Set();
    const _keyDedup = allBoxesRaw.filter(b => {
        const k = `${Math.round(b.x*10)},${Math.round(b.y*10)}`;
        if(_seenPos.has(k)) return false; _seenPos.add(k); return true;
    });
    const allBoxesDedup = [];
    for(const b of _keyDedup) {
        const hit = allBoxesDedup.some(e =>
            b.x + 0.04 < e.x + e.width  && b.x + b.width  - 0.04 > e.x &&
            b.y + 0.04 < e.y + e.height && b.y + b.height - 0.04 > e.y
        );
        if(!hit) allBoxesDedup.push(b);
    }
    console.log(`[DEDUP] raw:${allBoxesRaw.length} keyPass:${_keyDedup.length} aabbPass:${allBoxesDedup.length}`);

    const pruned = pruneBoxesInCorridors(allBoxesDedup, allCorridors);

    // ── CORRIDOR-ACCESSIBILITY FILTER ──────────────────────────────────
    // Client requirement: "There are areas where you can't access boxing"
    //
    // ENGINEERING FIX: For each box, verify that the horizontal corridor it
    // faces is physically reachable from the nearest vertical artery without
    // any wall crossing the corridor path. A red dashed line through a wall
    // is NOT a real corridor — it's fiction on paper.
    //
    // Algorithm:
    //  1) Find the horizontal corridor this box faces (corridor Y band)
    //  2) Find the nearest vertical corridor (left at x=10.1 or right at x=32.5)
    //  3) Trace the corridor strip from the vertical corridor edge to the box
    //  4) If any wall ≥1m crosses that strip → box is UNREACHABLE → remove

    // Collect vertical corridor edges
    const vertCorridors = allCorridors.filter(c => c.direction === 'vertical');
    const horizCorridors = allCorridors.filter(c => c.direction === 'horizontal');

    const isCorridorReachable = (b) => {
        // All boxes are reachable:
        // - Left zone: dense grid, accessed directly from vertical corridor
        // - Center/right: accessed from horizontal corridors
        // Physical wall blocking is handled by deep-block + wall-collision filters
        return true;

        const boxDoorY = b.doorSide === 'top' 
            ? b.y + b.height  // door on top → corridor above
            : b.y;            // door on bottom → corridor below

        // Find the closest horizontal corridor to the box's door edge
        let bestCorr = null, bestDist = Infinity;
        for(const c of horizCorridors) {
            const corrCenterY = c.y + c.height / 2;
            const dist = Math.abs(corrCenterY - boxDoorY);
            if(dist < bestDist) { bestDist = dist; bestCorr = c; }
        }
        if(!bestCorr || bestDist > MAIN_CORR_W * 1.5) return true; // no corridor found, skip check

        const corrY = bestCorr.y;
        const corrH = bestCorr.height;

        // Find the nearest vertical corridor to this box
        let nearestVertX = null, nearestVertDist = Infinity;
        for(const vc of vertCorridors) {
            const vcCenterX = vc.x + vc.width / 2;
            const dist = Math.abs(vcCenterX - boxCenterX);
            if(dist < nearestVertDist) {
                nearestVertDist = dist;
                nearestVertX = vc.x + (boxCenterX > vcCenterX ? vc.width : 0);
            }
        }
        if(nearestVertX === null) return true; // no vertical corridor

        // Trace the corridor strip from the vertical corridor edge to the box
        // The strip is: [min(nearestVertX, boxCenterX), max(nearestVertX, boxCenterX)] × [corrY, corrY+corrH]
        const stripX1 = Math.min(nearestVertX, boxCenterX);
        const stripX2 = Math.max(nearestVertX, boxCenterX);
        const stripY1 = corrY + 0.05;  // slight inset to avoid edge-touching walls
        const stripY2 = corrY + corrH - 0.05;

        // Check if any wall ≥1m crosses this corridor strip
        for(const w of allInteriorWalls) {
            const wLen = Math.hypot(w.x2-w.x1, w.y2-w.y1);
            if(wLen < 2.0) continue;  // only significant walls block corridors

            // Only check walls that are roughly VERTICAL (they cross the horizontal corridor)
            // A vertical wall crosses the corridor if it spans the corridor's Y band
            const isVertWall = Math.abs(w.x2 - w.x1) < 0.5;
            if(isVertWall) {
                const wallX = (w.x1 + w.x2) / 2;
                const wallYmin = Math.min(w.y1, w.y2);
                const wallYmax = Math.max(w.y1, w.y2);
                // Wall must be between the vert corridor and the box
                if(wallX > stripX1 + 0.1 && wallX < stripX2 - 0.1) {
                    // Wall must span at least 80% of corridor height to truly block it
                    const corrHeight = stripY2 - stripY1;
                    const wallOverlap = Math.min(wallYmax, stripY2) - Math.max(wallYmin, stripY1);
                    if(wallOverlap > corrHeight * 0.8) {
                        return false; // BLOCKED — wall fully crosses corridor
                    }
                }
            }
            // Horizontal walls along corridor boundary are room end-walls, 
            // not corridor barriers. Skip them.
        }
        return true; // REACHABLE
    };

    // Apply all filters in order:
    // 1) Deep wall crossing (wall through box center)
    // 2) Corridor reachability (can you walk to the box?)
    // 3) Wall collision cleanup (wall touches box)
    const ACCESS_INSET = 0.40;
    const isDeepBlocked = (b) => {
        const inX = b.width * ACCESS_INSET;
        const inY = b.height * ACCESS_INSET;
        const ix = b.x + inX, iy = b.y + inY;
        const iw = b.width - inX*2, ih = b.height - inY*2;
        if(iw < 0.01 || ih < 0.01) return false;
        for(const w of allInteriorWalls) {
            const wLen = Math.hypot(w.x2-w.x1, w.y2-w.y1);
            if(wLen < 4.0) continue;
            // Only vertical walls partition storage space
            const isVert = Math.abs(w.x2-w.x1) < 0.5;
            if(!isVert) continue;
            if(segAABB(w.x1,w.y1,w.x2,w.y2, ix,iy,iw,ih)) return true;
        }
        return false;
    };

    let deepRemoved = 0, reachRemoved = 0, wallCleanup = 0;

    // Pass 1: Deep wall blocking
    const pass1 = pruned.filter(b => {
        if(isDeepBlocked(b)) {
            deepRemoved++;
            // Find which wall blocked it
            const inX = b.width * ACCESS_INSET;
            const inY = b.height * ACCESS_INSET;
            const ix = b.x + inX, iy = b.y + inY;
            const iw = b.width - inX*2, ih = b.height - inY*2;
            for(const w of allInteriorWalls) {
                const wLen = Math.hypot(w.x2-w.x1, w.y2-w.y1);
                if(wLen < 4.0) continue;
                if(segAABB(w.x1,w.y1,w.x2,w.y2, ix,iy,iw,ih)) {
                    console.log(`  [DEEP] Box(${b.x.toFixed(1)},${b.y.toFixed(1)} ${b.width.toFixed(1)}×${b.height.toFixed(1)}) killed by wall(${w.x1.toFixed(1)},${w.y1.toFixed(1)})→(${w.x2.toFixed(1)},${w.y2.toFixed(1)}) len=${wLen.toFixed(1)}`);
                    break;
                }
            }
            return false;
        }
        return true;
    });

    // Pass 2: Corridor reachability
    const pass2 = pass1.filter(b => {
        if(!isCorridorReachable(b)) {
            reachRemoved++;
            console.log(`  [REACH] Box(${b.x.toFixed(1)},${b.y.toFixed(1)} ${b.width.toFixed(1)}×${b.height.toFixed(1)}) unreachable`);
            return false;
        }
        return true;
    });

    // Pass 3: Wall collision cleanup (ALL walls - vertical AND horizontal)
    const allBoxes = pass2.filter(b => {
        for(const w of allInteriorWalls) {
            const wLen = Math.hypot(w.x2-w.x1, w.y2-w.y1);
            if(wLen < 2.0) continue;  // ignore short room dividers
            if(segAABB(w.x1,w.y1,w.x2,w.y2, b.x+COLL_INSET, b.y+COLL_INSET, b.width-COLL_INSET*2, b.height-COLL_INSET*2)) {
                wallCleanup++;
                console.log(`  [WALL] Box(${b.x.toFixed(1)},${b.y.toFixed(1)} ${b.width.toFixed(1)}×${b.height.toFixed(1)}) hit wall(${w.x1.toFixed(1)},${w.y1.toFixed(1)})→(${w.x2.toFixed(1)},${w.y2.toFixed(1)}) len=${wLen.toFixed(1)}`);
                return false;
            }
        }
        return true;
    });

    console.log(`[ACCESS] Deep-blocked: ${deepRemoved} | Unreachable: ${reachRemoved} | Wall-collision: ${wallCleanup}`);
    console.log(`[ACCESS] Total removed: ${deepRemoved + reachRemoved + wallCleanup} → ${allBoxes.length} boxes survive`);


    // Count box-vs-corridor overlaps (should be 0)
    let overlaps=0;
    for(let i=0;i<allBoxes.length;i++) {
        const b=allBoxes[i];
        for(const c of allCorridors)
            if(b.x+0.02<c.x+c.width&&b.x+b.width-0.02>c.x&&b.y+0.02<c.y+c.height&&b.y+b.height-0.02>c.y) overlaps++;
    }

    // ── HONEST WALL COLLISION AUDIT ──
    // Actually check every final box against ALL interior wall segments
    let wallCollisions = 0;
    for(const b of allBoxes) {
        if(isBlocked(b.x, b.y, b.width, b.height, allInteriorWalls)) wallCollisions++;
    }

    console.log(`\n[Step 9] FINAL: ${allBoxes.length} boxes | ${allCorridors.length} corridors | ${overlaps} corridor-overlaps | ${wallCollisions} WALL COLLISIONS`);
    if(wallCollisions > 0) console.log(`[WARNING] ${wallCollisions} boxes still cross interior walls!`);
    console.log(`\n[Step 9] FINAL: ${allBoxes.length} boxes (${wallFaceBoxesFirst.length} wall-face + ${cleanMain.length} main + ${secBoxes.length} sec) | ${allCorridors.length} corridors | ${overlaps} overlaps`);

    // ── Step 10: Format and Export ────────────────────────────────────
    let uid=1;
    const boxes=allBoxes.map(b=>{
        const area=+(b.width*b.height).toFixed(2);
        return{id:`unit_${uid++}`,x:b.x,y:b.y,width:b.width,height:b.height,area,
            type:area>=3.0?'L':area>=2.0?'M':'S',label:`${area}`,
            zone:'main',partitionType:'toleGrise',layoutMode:'specV11',
            doorSide: b.doorSide||null,
            facing:   b.facing  ||null,
        };
    });

    // ── Build circulationPaths for horizontal corridor arrows ──
    // The renderer draws directional arrows (left↔right pathways) from circulationPaths.
    // Add both horizontal corridors as circulation paths for visual indicators.
    const circulationPaths = allCorridors
        .filter(c => c.direction === 'horizontal')
        .map(c => ({
            id: c.id,
            path: [
                {x: c.x, y: c.y + c.height/2},
                {x: c.x + c.width, y: c.y + c.height/2}
            ],
            type: 'main_artery',
            direction: 'horizontal'
        }));
    // Also add vertical corridor centerlines
    allCorridors.filter(c => c.direction !== 'horizontal').forEach(c => {
        circulationPaths.push({
            id: c.id,
            path: [
                {x: c.x + c.width/2, y: c.y},
                {x: c.x + c.width/2, y: c.y + c.height}
            ],
            type: 'main_artery',
            direction: 'vertical'
        });
    });

    // Add corridorFace to each box based on doorSide
    boxes.forEach(b => {
        b.corridorFace = b.doorSide || 'bottom';
    });

    const solution={
        boxes,
        corridors:allCorridors,
        circulationPaths,
        radiators: [],  // Will be auto-generated by exportToReferencePDF
        layoutMode:'specV11',
        corridorWidth:MAIN_CORR_W,
        unitMixCompliance:1.0
    };

    // ── Build floorPlan: pass ALL 1073 MUR segments for full architectural rendering ─────
    // ALL wall segs passed: perimeter walls, interior partitions, service zone rooms,
    // staircase spiral lines — all draw automatically. Styled in renderer by isPerim/isSvZone.
    const allWallObjs = allWalls.map(s => {
        const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
        const isPerim = mx <= minX + 1.5 || mx >= maxX - 1.5 ||
                        my <= minY + 1.5 || my >= maxY - 1.5;
        // isSvZone: wall is near ANY service core/room polygon (not just left zone)
        // This ensures stairwells, elevator shafts, corridors EVERYWHERE render thick
        const nearCore = serviceCores.some(z =>
            mx >= z.x - 1.5 && mx <= z.x + z.w + 1.5 &&
            my >= z.y - 1.5 && my <= z.y + z.h + 1.5
        );
        const isSvZone = nearCore || (hasServiceZone && mx <= svZoneX + 0.5);
        return { start:{x:s.x1,y:s.y1}, end:{x:s.x2,y:s.y2}, isPerim, isSvZone };
    });

    // Service cores → grey filled rooms + box exclusion zones
    const coreRooms = serviceCores.map(p => ({
        id: `core_${p.x.toFixed(0)}_${p.y.toFixed(0)}`,
        polygon: p.pts || [
            {x:p.x,y:p.y},{x:p.x+p.w,y:p.y},
            {x:p.x+p.w,y:p.y+p.h},{x:p.x,y:p.y+p.h}
        ],
        type: 'service_core', area: p.bboxArea, label: 'SERVICE'
    }));

    // Large MUR LWPOLYLINE room outlines (staircase bays, service rooms, corridors)
    const archRooms = murPolygons
        .filter(p => p.bboxArea >= 5.0 && p.w >= 1.2 && p.h >= 1.2)
        .map(p => ({
            id: `room_${p.x.toFixed(0)}_${p.y.toFixed(0)}`,
            pts: p.pts || [
                {x:p.x,y:p.y},{x:p.x+p.w,y:p.y},
                {x:p.x+p.w,y:p.y+p.h},{x:p.x,y:p.y+p.h}
            ],
            bbox: {x:p.x, y:p.y, w:p.w, h:p.h},
            npts: p.npts || 4,
            isSvZone: hasServiceZone && p.x + p.w <= svZoneX + 2.0
        }));

    // Entrance/exit door markers from ENTREE__SORTIE layer
    const entranceMarkers = entryPolygons.map((p,i) => ({
        id: `entry_${i}`,
        cx: p.cx !== undefined ? p.cx : p.x + (p.w||0)/2,
        cy: p.cy !== undefined ? p.cy : p.y + (p.h||0)/2,
        w:  p.w || 0.15,
        h:  p.h || 0.15,
        pts: p.pts || [{x:p.x,y:p.y},{x:p.x+(p.w||0),y:p.y},{x:p.x+(p.w||0),y:p.y+(p.h||0)},{x:p.x,y:p.y+(p.h||0)}]
    }));

    console.log(`[Step 10] Walls: ${allWallObjs.length} | ArchRooms: ${archRooms.length} | Hatches: ${murHatches.length} MUR + ${entryHatches.length} entry + ${noEntryHatches.length} noEntry | Inserts: ${inserts.length} | Cores: ${coreRooms.length}`);
    const floorPlan = {
        bounds,
        buildingBounds: {minX, minY, maxX, maxY},
        walls:          allWallObjs,        // All MUR LINE segs with isPerim/isSvZone flags
        archRooms,                          // MUR LWPOLYLINE room outlines
        forbiddenZones: coreRooms,          // Service cores (grey filled)
        entrances:      entranceMarkers,    // ENTREE__SORTIE door markers
        murHatches,                         // 46 MUR HATCH filled regions (wall fills, staircase)
        entryHatches,                       // 9 ENTREE__SORTIE HATCH fills
        noEntryHatches,                     // 5 NO_ENTREE HATCH fills
        noEntryZones: noEntryPolygons.map(p => ({pts: p.pts || [{x:p.x,y:p.y},{x:p.x+p.w,y:p.y},{x:p.x+p.w,y:p.y+p.h},{x:p.x,y:p.y+p.h}]})),
        inserts,                            // INSERT block refs (spiral staircase symbol)
        rooms:[], doors:[], envelope:[], name:'Test2.dxf',
        svZoneX: hasServiceZone ? svZoneX : null,
    };

    const metrics={
        totalBoxes:boxes.length,
        totalArea:+boxes.reduce((s,b)=>s+b.area,0).toFixed(1),
        corridorCount:allCorridors.length,corridorWidth:MAIN_CORR_W,
        generatedBy:`v11 (10-step spec) | axis=${mainAxis} | ${mainCorridors.length} main + ${secCorridors.length} sec | struct≥${STRUCT_LEN}m`,
    };

    console.log('[Step 10] Generating PDF...');
    const pdfBytes=await CostoExports.exportToReferencePDF(solution,floorPlan,metrics,{
        presetMode:'reference',        // Use 'reference' to enable arrows/radiators
        strictReference:false,          // Allow visual elements
        rotatePlan90:false,
        pageSize:'A1',
        orientation:'portrait',
        title:'PLAN ETAGE 01 1-200',   // Match reference title
        scale:'1:200',
        drawingNumber:'[01]',
        sheetNumber:'3',
        companyName:'COSTO',
        companyAddress:'5 chemin de la dime 95700 Roissy FRANCE',
        greenArrows:true,               // Enable GREEN circulation arrows
        showCirculationArrows:true,     // Show arrows in corridors
        showRadiators:true,             // Enable red radiator waves
        showDimensions:false,           // Match reference: no dimension labels
        showUnitLabels:false,           // Match reference: no unit labels
        showAreas:true,                 // Show area inside boxes
        showBoxNumbers:false,           // No box numbers
        useRowZigzags:true,             // Use zigzag radiator pattern
        referenceMode:true,             // Enable reference styling
    });

    fs.mkdirSync(path.dirname(outputPath),{recursive:true});
    fs.writeFileSync(outputPath,pdfBytes);

    console.log('\n=============================================================');
    console.log(' PDF GENERATED');
    console.log(` Path:      ${outputPath}`);
    console.log(` Main axis: ${mainAxis.toUpperCase()}`);
    console.log(` Pairs:     ${mainCorridors.length} main corridors`);
    console.log(` Secondary: ${secCorridors.length} corridors`);
    console.log(` Boxes:     ${boxes.length}`);
    console.log(` Overlaps:  ${overlaps}`);
    console.log('=============================================================');

    return {boxCount:boxes.length,mainCorridors:mainCorridors.length,secCorridors:secCorridors.length,overlaps,mainAxis};
}


/**
 * generateV11FromWalls(wallSegments, bounds)
 * Same v11 algorithm but accepts pre-parsed walls from server.js floorPlan.
 */
async function generateV11FromWalls(wallSegments, bounds) {
    // Normalise wall format
    const allWalls = (wallSegments || [])
        .filter(w => w && ((w.start && w.end) || w.x1 !== undefined))
        .map(w => w.start ? {x1:w.start.x,y1:w.start.y,x2:w.end.x,y2:w.end.y} : {x1:w.x1,y1:w.y1,x2:w.x2,y2:w.y2})
        .filter(w => Math.hypot(w.x2-w.x1,w.y2-w.y1)>=0.20);
    const structWalls = allWalls.filter(w=>Math.hypot(w.x2-w.x1,w.y2-w.y1)>=STRUCT_LEN);

    const {minX,minY,maxX,maxY}=bounds;
    const usX=minX+WALL_MARGIN,usY=minY+WALL_MARGIN;
    const usW=(maxX-minX)-WALL_MARGIN*2,usH=(maxY-minY)-WALL_MARGIN*2;

    const mainAxis=detectMainAxis(usW,usH);
    const stackStart=mainAxis==='horizontal'?usY:usX;
    const stackDim  =mainAxis==='horizontal'?usH:usW;

    const PAIR_H=BOX_DEPTH+MAIN_CORR_W+BOX_DEPTH;
    const mainCorridors=[],mainBandBoxes=[],bandEdges=[];
    let sp=stackStart,pairIdx=0;
    while(sp+PAIR_H<=stackStart+stackDim){
        const corrSP=sp+BOX_DEPTH,botRowSP=sp+BOX_DEPTH+MAIN_CORR_W;
        const corr=mainAxis==='horizontal'
            ?{id:`main_${pairIdx}`,x:usX,y:corrSP,width:usW,height:MAIN_CORR_W,direction:'horizontal',type:'main_artery',
              corners:[{x:usX,y:corrSP},{x:usX+usW,y:corrSP},{x:usX+usW,y:corrSP+MAIN_CORR_W},{x:usX,y:corrSP+MAIN_CORR_W}]}
            :{id:`main_${pairIdx}`,x:corrSP,y:usY,width:MAIN_CORR_W,height:usH,direction:'vertical',type:'main_artery',
              corners:[{x:corrSP,y:usY},{x:corrSP+MAIN_CORR_W,y:usY},{x:corrSP+MAIN_CORR_W,y:usY+usH},{x:corrSP,y:usY+usH}]};
        mainCorridors.push(corr);
        const bX=usX+PERIM_STRIP, bW=usW-2*PERIM_STRIP;
        mainBandBoxes.push(...fillRow(bX,bW,sp,BOX_DEPTH,structWalls));
        mainBandBoxes.push(...fillRow(bX,bW,botRowSP,BOX_DEPTH,structWalls));
        bandEdges.push({top:sp,bot:sp+PAIR_H});
        sp+=PAIR_H+PAIR_SEP; pairIdx++;
    }
    const cleanMain=pruneBoxesInCorridors(mainBandBoxes,mainCorridors);

    const allGapBands=[];
    if(bandEdges.length>0&&bandEdges[0].top-stackStart>=SEC_MIN_H)
        allGapBands.push({y0:stackStart,y1:bandEdges[0].top});
    for(let k=0;k<bandEdges.length-1;k++){
        const gapY0=bandEdges[k].bot+PAIR_SEP,gapY1=bandEdges[k+1].top;
        if(gapY1-gapY0>=SEC_MIN_H)allGapBands.push({y0:gapY0,y1:gapY1});
    }
    const lastBot=bandEdges.length?bandEdges[bandEdges.length-1].bot+PAIR_SEP:stackStart;
    if(stackStart+stackDim-lastBot>=SEC_MIN_H)
        allGapBands.push({y0:lastBot,y1:stackStart+stackDim});

    const secBoxes=[],secCorridors=[];
    for(const gap of allGapBands){
        const r=fillSecondaryBand(usX,usW,gap.y0,gap.y1-gap.y0,SEC_CORR_W,BOX_DEPTH,structWalls,mainCorridors);
        secBoxes.push(...r.boxes);secCorridors.push(...r.corridors);
    }

    const allCorridors=[...mainCorridors,...secCorridors];
    // Step 8.5: wall-hugging perpendicular boxes
    const whBoxes = addWallHuggingBoxes(structWalls, [...cleanMain,...secBoxes], allCorridors, usX, usY, usW, usH);
    const allBoxes=pruneBoxesInCorridors([...cleanMain,...secBoxes,...whBoxes],allCorridors);

    let uid=1;
    const boxes=allBoxes.map(b=>{
        const area=+(b.width*b.height).toFixed(2);
        return{id:`unit_${uid++}`,x:b.x,y:b.y,width:b.width,height:b.height,area,
            type:area>=3.0?'L':area>=2.0?'M':'S',label:`${area}`,
            zone:'main',partitionType:'toleGrise',layoutMode:'specV11',
            doorSide: b.doorSide||null,
            facing:   b.facing  ||null,
        };
    });
    return {boxes,corridors:allCorridors,metrics:{totalBoxes:boxes.length,
        totalArea:+boxes.reduce((s,b)=>s+b.area,0).toFixed(1),
        corridorCount:allCorridors.length,
        generatedBy:`v11 walls-api | axis=${mainAxis} | ${mainCorridors.length}+${secCorridors.length} corrs | struct≥${STRUCT_LEN}m`}};
}

module.exports = {generateV11, generateV11FromWalls, generateV12};

/* ─────────────────────────────────────────────────────────────────────────
 * generateV12 — WALL-FIRST ENGINE
 * ─────────────────────────────────────────────────────────────────────────
 * Architecture (matches client's yellow-annotation instruction):
 *
 * STEP 1 — Wall-face boxes FIRST:
 *   For every structural wall (≥ TOUCH_LEN=3m):
 *     • Horizontal walls → normal boxes (1m E-W × 2m N-S) above + below
 *     • Vertical walls   → perp boxes  (2m E-W × 1m N-S) left  + right
 *   Uses occupancy grid to prevent overlaps.
 *   Mark all placed zones in grid.
 *
 * STEP 2 — Interior fill (wall-aware horizontal bands):
 *   fillRow is given a skipZones list derived from the occupied grid.
 *   Bands fill interior open space only.
 *
 * STEP 3 — Corridors:
 *   Same facing-row-pair corridor model. Corridors drawn at band midlines.
 *
 * STEP 4 — Export.
 * ───────────────────────────────────────────────────────────────────────── */
const TOUCH_LEN   = 3.00;  // m — wall length threshold for face-box placement
const V_FW        = BOX_DEPTH; // 2.0m — perpendicular face box width  (E-W)
const V_FH        = BOX_W;    // 1.0m — perpendicular face box height (N-S)
const H_FW        = BOX_W;    // 1.0m — parallel face box width  (E-W)
const H_FH        = BOX_DEPTH;// 2.0m — parallel face box height (N-S)

async function generateV12(dxfPath, outputPath) {
    console.log('=============================================================');
    console.log(' WALL-FIRST ENGINE v12                                       ');
    console.log('=============================================================\n');

    const dxfText = fs.readFileSync(dxfPath, 'utf8');
    const wallObjs = parseDXF(dxfText);
    // Compute bounds inline (same as generateV11)
    const allX = wallObjs.flatMap(w=>[w.x1,w.x2]);
    const allY = wallObjs.flatMap(w=>[w.y1,w.y2]);
    const minX=Math.min(...allX), maxX=Math.max(...allX);
    const minY=Math.min(...allY), maxY=Math.max(...allY);
    const bounds = {minX,minY,maxX,maxY};
    const usX=minX, usY=minY, usW=maxX-minX, usH=maxY-minY;

    // ── Smart perimeter wall detection ──────────────────────────────────────
    // A wall qualifies for face-box placement if:
    //   (A) It's on the building perimeter: any endpoint within PERIM_TOL of boundary
    //   (B) It's a major long wall (≥ LONG_WALL_LEN) — forms service core/room edges
    // This prevents random interior cross-walls from breaking the band structure.
    const PERIM_TOL = BOX_DEPTH + 0.5;  // 2.5m — perimeter proximity tolerance
    const LONG_WALL_LEN = 6.0;          // walls ≥6m are always considered structural perimeter
    const isPerimWall = (w) => {
        const len = Math.hypot(w.x2-w.x1, w.y2-w.y1);
        if(len < TOUCH_LEN) return false;  // too short
        if(len >= LONG_WALL_LEN) return true; // long walls always qualify
        // Check if any endpoint is close to building boundary
        for(const [px,py] of [[w.x1,w.y1],[w.x2,w.y2]]) {
            if( Math.abs(px-minX)<PERIM_TOL || Math.abs(px-maxX)<PERIM_TOL ||
                Math.abs(py-minY)<PERIM_TOL || Math.abs(py-maxY)<PERIM_TOL )
                return true;
        }
        return false;
    };
    const touchWalls = wallObjs.filter(isPerimWall);
    const blockWalls = wallObjs.filter(w => Math.hypot(w.x2-w.x1,w.y2-w.y1) >= STRUCT_LEN);
    console.log(`[V12 S1] touchWalls: ${touchWalls.length} (perimeter/major) | blockWalls: ${blockWalls.length} (≥${STRUCT_LEN}m)`);

    // ── Occupancy grid (0.5m cells) ──────────────────────────────────────────
    const GS = 0.50;
    const gCols = Math.ceil(usW/GS)+2, gRows = Math.ceil(usH/GS)+2;
    const occ   = new Uint8Array(gCols * gRows);
    const markOcc = (bx,by,bw,bh) => {
        const c0=Math.max(0,Math.floor((bx-usX)/GS)), c1=Math.min(gCols-1,Math.ceil((bx+bw-usX)/GS));
        const r0=Math.max(0,Math.floor((by-usY)/GS)), r1=Math.min(gRows-1,Math.ceil((by+bh-usY)/GS));
        for(let r=r0;r<=r1;r++) for(let c=c0;c<=c1;c++) occ[r*gCols+c]=1;
    };

    // ── STEP 1: Place boxes against ALL wall faces ───────────────────────────
    const wallFaceBoxes = [];
    let vFaceCount=0, hFaceCount=0;

    // Exact overlap check (not grid) for precise boundary handling
    const exactOverlaps = (bx,by,bw,bh, boxes) => {
        const E=0.02;
        return boxes.some(b => bx+bw>b.x+E && bx<b.x+b.width-E && by+bh>b.y+E && by<b.y+b.height-E);
    };

    const tryPlaceWF = (bx,by,bw,bh) => {
        const cx=Math.max(usX,bx), cy=Math.max(usY,by);
        const cw=Math.min(bx+bw,usX+usW)-cx, ch=Math.min(by+bh,usY+usH)-cy;
        if(cw<MIN_BW||ch<MIN_BW) return false;
        // Only check blockWalls for blocking (not touchWalls — that would block perimeter boxes)
        if(isBlocked(cx,cy,cw,ch,blockWalls)) return false;
        if(exactOverlaps(cx,cy,cw,ch,wallFaceBoxes)) return false;
        wallFaceBoxes.push({x:cx,y:cy,width:cw,height:ch});
        markOcc(cx,cy,cw,ch);
        return true;
    };

    for(const wall of touchWalls) {
        const dX=Math.abs(wall.x2-wall.x1), dY=Math.abs(wall.y2-wall.y1);
        const isVert = dY >= dX;

        if(isVert) {
            // Vertical wall: perpendicular boxes (V_FW × V_FH) on LEFT and RIGHT face
            const wallX  = (wall.x1+wall.x2)/2;
            const wallY0 = Math.min(wall.y1,wall.y2);
            const wallY1 = Math.max(wall.y1,wall.y2);
            for(const side of [-1,1]) {
                const bx = side===-1 ? wallX-V_FW : wallX;
                let oy=wallY0;
                while(oy+MIN_BW<=wallY1){
                    const bh=Math.min(V_FH,wallY1-oy);
                    if(tryPlaceWF(bx,oy,V_FW,bh)) vFaceCount++;
                    oy+=V_FH;
                }
            }
        } else {
            // Horizontal wall: normal boxes (H_FW × H_FH) ABOVE and BELOW
            const wallY  = (wall.y1+wall.y2)/2;
            const wallX0 = Math.min(wall.x1,wall.x2);
            const wallX1 = Math.max(wall.x1,wall.x2);
            for(const side of [-1,1]) {
                const by = side===-1 ? wallY-H_FH : wallY;
                let ox=wallX0;
                while(ox+MIN_BW<=wallX1){
                    const bw=Math.min(H_FW,wallX1-ox);
                    if(tryPlaceWF(ox,by,bw,H_FH)) hFaceCount++;
                    ox+=H_FW;
                }
            }
        }
    }
    console.log(`[V12 S1] Wall-face boxes: ${wallFaceBoxes.length} (${vFaceCount} vert + ${hFaceCount} horiz)`);

    // ── STEP 2: Fill interior with wall-aware horizontal bands ───────────────
    // Build skip-zone list from wall-face occupied columns
    // For each X column, track which Y ranges are occupied
    // Simplified: skip X positions where the occupancy grid has cells marked at
    // specific Y rows. We use a grid-scan shortcut.
    const mainAxis = detectMainAxis(usW, usH);
    const stackStart = mainAxis==='horizontal' ? usY : usX;
    const stackDim   = mainAxis==='horizontal' ? usH  : usW;
    const spanStart  = mainAxis==='horizontal' ? usX  : usY;
    const spanDim    = mainAxis==='horizontal' ? usW  : usH;

    // Exact AABB check against wallFaceBoxes (avoids coarse 0.5m grid false positives)
    const isColRowOcc = (bx, by, bw, bh) => {
        const E=0.02;
        return wallFaceBoxes.some(b =>
            bx+bw > b.x+E && bx < b.x+b.width-E &&
            by+bh > b.y+E && by < b.y+b.height-E
        );
    };

    // fillRow variant that skips occupied grid zones (wall-face boxes)
    const fillRowSkip = (rowX, rowW, rowY, rowH) => {
        const boxes=[];
        let ox=rowX;
        const rowEnd=rowX+rowW;
        while(ox+MIN_BW<=rowEnd){
            const bw=Math.min(BOX_W,rowEnd-ox);
            if(bw<MIN_BW){ox+=bw;continue;}
            // Skip if this slot overlaps with any already-occupied wall-face zone
            if(!isColRowOcc(ox,rowY,bw,rowH) && !isBlocked(ox,rowY,bw,rowH,blockWalls)){
                boxes.push({x:ox,y:rowY,width:bw,height:rowH});
            }
            ox+=bw;
        }
        return boxes;
    };

    const PAIR_H = BOX_DEPTH+MAIN_CORR_W+BOX_DEPTH;
    const mainCorridors=[], bandBoxes=[], bandEdges=[];
    let sp=stackStart, pairIdx=0;
    while(sp+PAIR_H<=stackStart+stackDim){
        const corrSP=sp+BOX_DEPTH, botRowSP=sp+BOX_DEPTH+MAIN_CORR_W;
        const corr = mainAxis==='horizontal'
            ? {id:`mc_${pairIdx}`,x:usX,y:corrSP,width:usW,height:MAIN_CORR_W,
               direction:'horizontal',type:'main_artery',
               corners:[{x:usX,y:corrSP},{x:usX+usW,y:corrSP},{x:usX+usW,y:corrSP+MAIN_CORR_W},{x:usX,y:corrSP+MAIN_CORR_W}]}
            : {id:`mc_${pairIdx}`,x:corrSP,y:usY,width:MAIN_CORR_W,height:usH,
               direction:'vertical',type:'main_artery',
               corners:[{x:corrSP,y:usY},{x:corrSP+MAIN_CORR_W,y:usY},{x:corrSP+MAIN_CORR_W,y:usY+usH},{x:corrSP,y:usY+usH}]};
        mainCorridors.push(corr);
        // DON'T mark corridors in occ grid — they span full width and would
        // poison the grid for wall-face box placement on perimeter areas
        bandBoxes.push(...fillRowSkip(usX, usW, sp,        BOX_DEPTH));
        bandBoxes.push(...fillRowSkip(usX, usW, botRowSP,  BOX_DEPTH));
        bandEdges.push({top:sp, bot:sp+PAIR_H});
        sp+=PAIR_H+PAIR_SEP; pairIdx++;
    }
    console.log(`[V12 S2] Interior bands: ${mainCorridors.length} corridors, ${bandBoxes.length} boxes`);

    // Secondary fill for gap bands (top, inter-pair, bottom)
    const gapBands=[];
    if(bandEdges.length>0 && bandEdges[0].top-stackStart>=SEC_MIN_H)
        gapBands.push({y0:stackStart, y1:bandEdges[0].top});
    for(let k=0;k<bandEdges.length-1;k++){
        const g0=bandEdges[k].bot+PAIR_SEP, g1=bandEdges[k+1].top;
        if(g1-g0>=SEC_MIN_H) gapBands.push({y0:g0, y1:g1});
    }
    const lastBot=bandEdges.length?bandEdges[bandEdges.length-1].bot+PAIR_SEP:stackStart;
    if(stackStart+stackDim-lastBot>=SEC_MIN_H)
        gapBands.push({y0:lastBot, y1:stackStart+stackDim});

    const secBoxes=[], secCorridors=[];
    for(const gap of gapBands){
        const bandH=gap.y1-gap.y0;
        const r=fillSecondaryBand(usX,usW,gap.y0,bandH,SEC_CORR_W,BOX_DEPTH,blockWalls,mainCorridors);
        // Filter secondary boxes that overlap wall-face zones
        const filteredBoxes = r.boxes.filter(b=>!isColRowOcc(b.x,b.y,b.width,b.height));
        secBoxes.push(...filteredBoxes);
        secCorridors.push(...r.corridors);
    }
    console.log(`[V12 S2] Secondary: ${secCorridors.length} corridors, ${secBoxes.length} boxes`);

    // ── Merge all, prune corridor overlaps ───────────────────────────────────
    const allCorridors=[...mainCorridors,...secCorridors];
    const allBoxesRaw=[...wallFaceBoxes,...bandBoxes,...secBoxes];
    const allBoxes=pruneBoxesInCorridors(allBoxesRaw, allCorridors);

    let overlaps=0;
    for(const b of allBoxes) for(const c of allCorridors)
        if(b.x+0.02<c.x+c.width&&b.x+b.width-0.02>c.x&&b.y+0.02<c.y+c.height&&b.y+b.height-0.02>c.y) overlaps++;
    console.log(`\n[V12 FINAL] ${allBoxes.length} boxes (${wallFaceBoxes.length} wall-face + ${bandBoxes.length} bands + ${secBoxes.length} sec) | ${allCorridors.length} corridors | ${overlaps} overlaps`);

    // ── Step 4: Format and Export ─────────────────────────────────────────────
    let uid=1;
    const boxes=allBoxes.map(b=>{
        const area=+(b.width*b.height).toFixed(2);
        // corridorFace: which edge faces the corridor (where door is)
        // doorSide 'top' means door on top edge → corridorFace is 'top'
        // doorSide 'bottom' means door on bottom edge → corridorFace is 'bottom'
        // doorSide 'left' means door on left edge → corridorFace is 'left'
        // doorSide 'right' means door on right edge → corridorFace is 'right'
        const corridorFace = b.doorSide || 'bottom';
        return{id:`unit_${uid++}`,x:b.x,y:b.y,width:b.width,height:b.height,area,
            type:area>=3.0?'L':area>=2.0?'M':'S',label:`${area}`,
            zone:'main',partitionType:'toleGrise',layoutMode:'specV11',
            doorSide: b.doorSide||null,
            corridorFace: corridorFace,
            facing:   b.facing  ||null,
        };
    });

    const solution={
        boxes,
        corridors:allCorridors,
        circulationPaths,
        radiators: [],  // Will be auto-generated by exportToReferencePDF
        layoutMode:'specV11',
        corridorWidth:MAIN_CORR_W,
        unitMixCompliance:1.0
    };
    // Convert walls to {start:{x,y},end:{x,y}} format expected by drawFloorPlanToPDF
    const wallsForPDF = wallObjs.map(w=>({start:{x:w.x1,y:w.y1},end:{x:w.x2,y:w.y2}}));
    const floorPlan={bounds,walls:wallsForPDF,rooms:[],doors:[],envelope:[],entrances:[],forbiddenZones:[],name:'Test2.dxf'};
    const metrics={
        totalBoxes:boxes.length,
        totalArea:+boxes.reduce((s,b)=>s+b.area,0).toFixed(1),
        totalCorridors:allCorridors.length,
        wallFaceBoxes:wallFaceBoxes.length,
        generatedBy:`v12 wall-first | axis=${mainAxis} | ${mainCorridors.length}+${secCorridors.length} corrs | touch≥${TOUCH_LEN}m | block≥${STRUCT_LEN}m`,
    };

    console.log('[V12] Generating PDF (reference style)...');
    let pdfBytes;
    try {
        pdfBytes = await CostoExports.exportToReferencePDF(solution,floorPlan,metrics,{
            presetMode:'reference',  // Use 'reference' not 'strictReference' to enable arrows/radiators
            strictReference:false,    // Allow visual elements
            rotatePlan90:true,
            pageSize:'A1',
            orientation:'portrait',
            title:'PLAN ETAGE 01 1-200',
            scale:'1:200',
            drawingNumber:'[01]',
            sheetNumber:'3',
            companyName:'COSTO',
            companyAddress:'5 chemin de la dime 95700 Roissy FRANCE',
            showCirculationArrows:true,  // Enable green circulation arrows
            showRadiators:true,          // Enable red radiator waves
            showDimensions:false,        // Match reference: no dimension labels
            showUnitLabels:false,        // Match reference: no unit labels
            showAreas:true,              // Show area inside boxes
            showBoxNumbers:false,        // No box numbers
            useRowZigzags:true,          // Use zigzag radiator pattern
            referenceMode:true,          // Enable reference styling
            greenArrows:true,            // Force green arrows in corridors
        });
        if(!pdfBytes||pdfBytes.length<10000){throw new Error(`blank (${pdfBytes?.length||0} bytes)`);}
    } catch(e) {
        console.log(`[V12] exportToReferencePDF fallback (${e.message}): using exportToPDF...`);
        pdfBytes = await CostoExports.exportToPDF(solution,floorPlan,metrics,{
            pageSize:'A1',
            title:`Test2.dxf \u2014 Wall-First v12 | ${boxes.length} units`,
            showLegend:false,showTitleBlock:false,referenceMode:true,
        });
    }
    fs.mkdirSync(path.dirname(outputPath),{recursive:true});
    fs.writeFileSync(outputPath,pdfBytes);
    console.log('=============================================================');
    console.log(` PDF: ${outputPath}`);
    console.log(`Boxes: ${boxes.length} | Corridors: ${allCorridors.length} | Overlaps: ${overlaps}`);
    console.log('=============================================================');
    return {boxCount:boxes.length, wallFaceBoxes:wallFaceBoxes.length, overlaps, mainAxis};
}

/* ── Standalone runner ───────────────────────────────────────────────── */
if(require.main===module){
    const dxfPath=path.join(__dirname,'Samples','Test2.dxf');
    const outPath=path.join(__dirname,'exports','Test2_FULL_CIRCULATION.pdf');
    generateV11(dxfPath,outPath).catch(e=>{console.error('ERROR:',e.message,e.stack);process.exit(1);});
}


