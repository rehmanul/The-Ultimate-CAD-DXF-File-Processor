import ezdxf
import json
from collections import defaultdict

doc = ezdxf.readfile('../Samples/Test2.dxf')
msp = doc.modelspace()

print('='*70)
print('DETAILED DXF ANALYSIS: Test2.dxf')
print('='*70)

# Analyze HATCH entities (often represent rooms/areas)
print('\n[HATCH ENTITIES DETAILS - 63 total]')
hatches = list(msp.query('HATCH'))
layer_hatch = defaultdict(int)
hatch_patterns = defaultdict(int)
for hatch in hatches:
    layer_hatch[hatch.dxf.layer] += 1
    pattern_name = hatch.dxf.pattern_name if hasattr(hatch.dxf, 'pattern_name') else 'SOLID'
    hatch_patterns[pattern_name] += 1
    
print('   Hatches by layer:')
for layer, count in layer_hatch.items():
    print(f'      {layer}: {count}')

# Detailed LWPOLYLINE analysis by layer
print('\n[LWPOLYLINE BY LAYER]')
lwpolylines = list(msp.query('LWPOLYLINE'))
polylines_by_layer = defaultdict(list)
for pl in lwpolylines:
    polylines_by_layer[pl.dxf.layer].append(pl)

for layer, pls in polylines_by_layer.items():
    closed = sum(1 for p in pls if p.closed)
    print(f'   {layer}: {len(pls)} total ({closed} closed, {len(pls)-closed} open)')

# Analyze LINE segments - look for patterns (walls, grid, etc.)
print('\n[LINE SEGMENTS ANALYSIS]')
lines = list(msp.query('LINE'))
lines_by_layer = defaultdict(list)
for line in lines:
    lines_by_layer[line.dxf.layer].append(line)

for layer, lns in lines_by_layer.items():
    # Calculate total line length
    total_length = 0
    for line in lns:
        dx = line.dxf.end.x - line.dxf.start.x
        dy = line.dxf.end.y - line.dxf.start.y
        length = (dx*dx + dy*dy) ** 0.5
        total_length += length
    print(f'   {layer}: {len(lns)} lines, total length: {total_length:.2f} units')

# Check for specific geometric patterns
print('\n[GEOMETRIC PATTERN DETECTION]')

# Find horizontal and vertical lines
horizontal_lines = []
vertical_lines = []
for line in lines:
    dx = abs(line.dxf.end.x - line.dxf.start.x)
    dy = abs(line.dxf.end.y - line.dxf.start.y)
    if dy < 0.01 and dx > 0.01:  # Nearly horizontal
        horizontal_lines.append(line)
    elif dx < 0.01 and dy > 0.01:  # Nearly vertical
        vertical_lines.append(line)

print(f'   Horizontal lines: {len(horizontal_lines)}')
print(f'   Vertical lines: {len(vertical_lines)}')
print(f'   Angled lines: {len(lines) - len(horizontal_lines) - len(vertical_lines)}')

# Check for grid patterns (similar spacing)
if horizontal_lines:
    y_coords = []
    for line in horizontal_lines:
        y_coords.append((line.dxf.start.y + line.dxf.end.y) / 2)
    y_coords = sorted(set(round(y, 2) for y in y_coords))
    print(f'   Unique horizontal Y-positions: {len(y_coords)}')
    if len(y_coords) > 1:
        spacings = [y_coords[i+1] - y_coords[i] for i in range(len(y_coords)-1)]
        common_spacings = defaultdict(int)
        for s in spacings:
            common_spacings[round(s, 2)] += 1
        print(f'   Common horizontal spacings: {dict(sorted(common_spacings.items(), key=lambda x: -x[1])[:5])}')

if vertical_lines:
    x_coords = []
    for line in vertical_lines:
        x_coords.append((line.dxf.start.x + line.dxf.end.x) / 2)
    x_coords = sorted(set(round(x, 2) for x in x_coords))
    print(f'   Unique vertical X-positions: {len(x_coords)}')

# Sample a few entities for detailed inspection
print('\n[SAMPLE ENTITIES]')
print('\nSample LWPOLYLINE (first closed one):')
closed_pls = [p for p in lwpolylines if p.closed]
if closed_pls:
    pl = closed_pls[0]
    points = list(pl.get_points('xy'))
    print(f'   Layer: {pl.dxf.layer}')
    print(f'   Points: {len(points)}')
    print(f'   Closed: {pl.closed}')
    print(f'   First 3 points: {points[:3]}')

print('\nSample HATCH:')
if hatches:
    h = hatches[0]
    print(f'   Layer: {h.dxf.layer}')
    print(f'   Pattern: {h.dxf.pattern_name if hasattr(h.dxf, "pattern_name") else "SOLID"}')
    print(f'   Associative: {h.dxf.associative}')

# Check for block references (inserts)
inserts = list(msp.query('INSERT'))
print(f'\n[BLOCK REFERENCES]')
print(f'   Total INSERT entities: {len(inserts)}')
if inserts:
    block_names = defaultdict(int)
    for ins in inserts:
        block_names[ins.dxf.name] += 1
    for name, count in block_names.items():
        print(f'      {name}: {count}')

print('\n' + '='*70)
