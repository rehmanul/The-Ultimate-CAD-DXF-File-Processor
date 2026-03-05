# Fix: Match Reference Output Corridor Density

## Problem

Current output: **17 corridors**
Reference output: **25-35+ corridors** (complete grid coverage)

## Root Cause

`ProfessionalGridLayoutEngine.js` generates vertical spine corridors only every ~8 columns:

```javascript
const spineEvery = Math.max(1, Math.round(8 * bw / targetW));
for (let col = spineEvery; col < numCols; col += spineEvery) {
    // Only creates 4-5 vertical spines
}
```

This creates sparse vertical coverage. The reference output has vertical corridors at EVERY significant column gap.

## Solution

Generate vertical corridors at EVERY column gap (like COSTO V1), not just every 8th column.

### Changes Required

**File:** `lib/ProfessionalGridLayoutEngine.js`

**Location:** Around line 420 (vertical spine generation)

**Change from:**
```javascript
// 3c. Vertical spine corridors at regular intervals (~8 columns)
const spineEvery = Math.max(1, Math.round(8 * bw / targetW));
for (let col = spineEvery; col < numCols; col += spineEvery) {
    const sx = b.minX + col * (bw + this.boxSpacing) - cw / 2;
    rawCorridors.push({
        id: `spine_${col}`, type: 'SPINE', direction: 'vertical',
        x: sx, y: b.minY, width: cw, height: this.planH,
        isSpine: true
    });
}
```

**Change to:**
```javascript
// 3c. Vertical corridors at EVERY column gap (COSTO V1 reference style)
// This creates complete grid coverage matching the reference output
for (let col = 1; col < numCols; col++) {
    // Place vertical corridor between columns (in the gap)
    const sx = b.minX + col * (bw + this.boxSpacing) - (this.boxSpacing + cw) / 2;
    rawCorridors.push({
        id: `vertical_${col}`, type: 'SPINE', direction: 'vertical',
        x: sx, y: b.minY, width: cw, height: this.planH,
        isSpine: true
    });
}
```

### Expected Result

With 32 columns, this will generate:
- 6 horizontal aisles (between rows)
- 4 perimeter corridors
- **31 vertical corridors** (between every column)
- 4 wall connectors

**Total: ~45 corridors** (matches reference density)

### Alternative: Selective Vertical Corridors

If 45 corridors is too many, use a smaller interval:

```javascript
// 3c. Vertical corridors every 2-3 columns (balanced coverage)
const spineEvery = 2; // or 3 for less density
for (let col = spineEvery; col < numCols; col += spineEvery) {
    const sx = b.minX + col * (bw + this.boxSpacing) - cw / 2;
    rawCorridors.push({
        id: `spine_${col}`, type: 'SPINE', direction: 'vertical',
        x: sx, y: b.minY, width: cw, height: this.planH,
        isSpine: true
    });
}
```

This would generate ~15 vertical corridors, total ~30 corridors.

## Implementation Steps

1. Open `lib/ProfessionalGridLayoutEngine.js`
2. Find the vertical spine generation section (around line 420)
3. Replace the `spineEvery` logic with one of the options above
4. Restart server
5. Regenerate floor plan
6. Check server logs for corridor count
7. Compare with reference output

## Testing

After the fix, server logs should show:
```
[BayGrid] Pathway network: 6 aisles, 4 perimeter, 31 spines, 4 wall connectors
[BayGrid] Corridors: 45 raw → 45 segments (0 wall splits)
[BayGrid] Connected corridors: 45, Disconnected: 0
```

The visual output should now match the reference with complete grid coverage.
