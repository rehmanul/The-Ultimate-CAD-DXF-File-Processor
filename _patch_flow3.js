const fs = require('fs');
const f = 'c:/Users/Admin/Desktop/The-Ultimate-CAD-DXF-File-Processor/public/threeRenderer.js';
const src = fs.readFileSync(f, 'utf8');
const lines = src.split('\n');

// Find the method comment line
let startLine = -1;
for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('//') && trimmed.includes('serpentine flow arrows')) {
        startLine = i;
        break;
    }
    if (trimmed.startsWith('/**') && i + 1 < lines.length && lines[i + 1].includes('Serpentine flow arrows')) {
        startLine = i;
        break;
    }
    if (trimmed.startsWith('//') && trimmed.includes('Complete serpentine flow')) {
        startLine = i;
        break;
    }
    if (trimmed.startsWith('//') && trimmed.includes('Bold flow direction')) {
        startLine = i;
        break;
    }
    if (trimmed.startsWith('//') && trimmed.includes('Professional flow direction')) {
        startLine = i;
        break;
    }
}

if (startLine < 0) {
    // Find the method declaration directly
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('_renderGlobalFlowFromSegments(')) {
            startLine = i;
            break;
        }
    }
}

// Find onResize that follows
let endLine = -1;
for (let i = startLine + 5; i < lines.length; i++) {
    if (lines[i].trim().startsWith('onResize(') || lines[i].trim().startsWith('onResize (')) {
        endLine = i;
        break;
    }
}

if (startLine < 0 || endLine < 0) {
    console.error('Could not find method boundaries. startLine:', startLine, 'endLine:', endLine);
    process.exit(1);
}

console.log('Replacing lines ' + (startLine + 1) + ' to ' + endLine);

const newLines = [
    '    /**',
    '     * Serpentine flow arrows on corridor centerlines ONLY.',
    '     * Places bold arrows INSIDE actual corridors, forming a snake route.',
    '     */',
    '    _renderGlobalFlowFromSegments(floorPlan, splitSegs, units, corridors) {',
    '        if (!this._flowGroup) {',
    '            this._flowGroup = new THREE.Group();',
    "            this._flowGroup.name = 'globalFlow';",
    '            this.scene.add(this._flowGroup);',
    '        }',
    '        this._flowGroup.clear();',
    '',
    '        if (!corridors || corridors.length === 0) return;',
    '        const bounds = floorPlan && floorPlan.bounds;',
    '        if (!bounds) return;',
    '',
    '        // ── 1. Collect vertical corridor centerlines ──',
    '        const vCorridors = [];',
    '        for (const c of corridors) {',
    '            if (![c.x, c.y, c.width, c.height].every(Number.isFinite)) continue;',
    '            const isH = c.direction === "horizontal" || c.width > c.height;',
    '            if (!isH) {',
    '                vCorridors.push({',
    '                    cx: c.x + c.width / 2,',
    '                    y1: c.y,',
    '                    y2: c.y + c.height,',
    '                });',
    '            }',
    '        }',
    '',
    '        // ── 2. Merge into columns (corridors at same X) ──',
    '        const COL_SNAP = 1.5;',
    '        const columns = [];',
    '        vCorridors.sort((a, b) => a.cx - b.cx);',
    '        for (const vc of vCorridors) {',
    '            let found = columns.find(col => Math.abs(col.cx - vc.cx) < COL_SNAP);',
    '            if (found) {',
    '                found.segs.push({ y1: vc.y1, y2: vc.y2 });',
    '                found.cx = (found.cx + vc.cx) / 2;',
    '            } else {',
    '                columns.push({ cx: vc.cx, segs: [{ y1: vc.y1, y2: vc.y2 }] });',
    '            }',
    '        }',
    '        columns.sort((a, b) => a.cx - b.cx);',
    '',
    '        // Merge overlapping segments and compute full Y range per column',
    '        for (const col of columns) {',
    '            col.segs.sort((a, b) => a.y1 - b.y1);',
    '            const merged = [{ ...col.segs[0] }];',
    '            for (let i = 1; i < col.segs.length; i++) {',
    '                const prev = merged[merged.length - 1];',
    '                if (col.segs[i].y1 <= prev.y2 + 1.0) {',
    '                    prev.y2 = Math.max(prev.y2, col.segs[i].y2);',
    '                } else {',
    '                    merged.push({ ...col.segs[i] });',
    '                }',
    '            }',
    '            col.segs = merged;',
    '            col.y1 = merged[0].y1;',
    '            col.y2 = merged[merged.length - 1].y2;',
    '        }',
    '',
    '        if (columns.length === 0) return;',
    '',
    '        // ── 3. Build serpentine route along corridor centerlines ──',
    '        // Pattern: col0 UP → horizontal link → col1 DOWN → link → col2 UP …',
    '        const route = [];',
    '',
    '        for (let ci = 0; ci < columns.length; ci++) {',
    '            const col = columns[ci];',
    '            const goUp = (ci % 2 === 0);',
    '',
    '            if (goUp) {',
    '                for (const seg of col.segs) {',
    '                    route.push({ x: col.cx, y: seg.y1 });',
    '                    route.push({ x: col.cx, y: seg.y2 });',
    '                }',
    '            } else {',
    '                for (let si = col.segs.length - 1; si >= 0; si--) {',
    '                    route.push({ x: col.cx, y: col.segs[si].y2 });',
    '                    route.push({ x: col.cx, y: col.segs[si].y1 });',
    '                }',
    '            }',
    '',
    '            // Horizontal link to next column',
    '            if (ci < columns.length - 1) {',
    '                const lastPt = route[route.length - 1];',
    '                const nextCol = columns[ci + 1];',
    '                const nextGoUp = ((ci + 1) % 2 === 0);',
    '                // Next column starts at bottom if going up, top if going down',
    '                const nextStartY = nextGoUp ? nextCol.y1 : nextCol.y2;',
    '                // Horizontal link at connecting Y level',
    '                const linkY = lastPt.y;',
    '                if (Math.abs(linkY - nextStartY) > 0.5) {',
    '                    // Need to connect at same Y, then move to next start',
    '                    route.push({ x: nextCol.cx, y: linkY });',
    '                    route.push({ x: nextCol.cx, y: nextStartY });',
    '                } else {',
    '                    route.push({ x: nextCol.cx, y: linkY });',
    '                }',
    '                // Remove last point since the column loop will add it',
    '                route.pop();',
    '            }',
    '        }',
    '',
    '        // ── 4. Render bold arrows along route ──',
    '        const GREEN = 0x2e7d32;',
    '        const arrowMat = new THREE.MeshBasicMaterial({ color: GREEN, side: THREE.DoubleSide });',
    '        const Z = 0.25;',
    '',
    '        const planSpan = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 20);',
    '        const ARROW_SIZE = Math.max(0.5, Math.min(1.5, planSpan * 0.018));',
    '        const ARROW_SPACING = Math.max(1.8, Math.min(4.0, planSpan * 0.045));',
    '',
    '        const drawArrow = (x, y, angle) => {',
    '            const s = ARROW_SIZE;',
    '            const shape = new THREE.Shape();',
    '            shape.moveTo(-s * 0.5, -s * 0.4);',
    '            shape.lineTo(s * 0.5, 0);',
    '            shape.lineTo(-s * 0.5, s * 0.4);',
    '            shape.closePath();',
    '            const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), arrowMat);',
    '            mesh.position.set(x, y, Z);',
    '            mesh.rotation.z = angle;',
    '            this._flowGroup.add(mesh);',
    '        };',
    '',
    '        let totalArrows = 0, hArrows = 0, vArrows = 0;',
    '',
    '        for (let i = 0; i < route.length - 1; i++) {',
    '            const ax = route[i].x, ay = route[i].y;',
    '            const bx = route[i + 1].x, by = route[i + 1].y;',
    '            const dx = bx - ax, dy = by - ay;',
    '            const segLen = Math.hypot(dx, dy);',
    '            if (segLen < 0.3) continue;',
    '',
    '            const angle = Math.atan2(dy, dx);',
    '            const numArrows = Math.max(1, Math.floor(segLen / ARROW_SPACING));',
    '            for (let a = 0; a < numArrows; a++) {',
    '                const t = (a + 0.5) / numArrows;',
    '                drawArrow(ax + dx * t, ay + dy * t, angle);',
    '                totalArrows++;',
    '                if (Math.abs(dx) > Math.abs(dy)) hArrows++;',
    '                else vArrows++;',
    '            }',
    '        }',
    '',
    "        console.log('[Flow] Serpentine: ' + columns.length + ' cols, ' + route.length + ' waypoints, ' + totalArrows + ' arrows (' + hArrows + ' H, ' + vArrows + ' V)');",
    '    }',
];

const before = lines.slice(0, startLine);
const after = lines.slice(endLine);
const allLines = [...before, ...newLines, ...after];
fs.writeFileSync(f, allLines.join('\n'), 'utf8');
console.log('Done! Clean serpentine method written.');
