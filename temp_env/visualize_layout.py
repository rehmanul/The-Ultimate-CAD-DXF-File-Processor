import ezdxf
import json
import math
from collections import defaultdict

doc = ezdxf.readfile('../Samples/Test2.dxf')
msp = doc.modelspace()

print('='*70)
print('LAYOUT STRUCTURE SUMMARY: Test2.dxf')
print('='*70)

# Categorize entities by their likely purpose
print('\n[LAYER SEMANTICS]')
layer_info = {
    'MUR': 'Walls / Storage boxes (French: MUR = Wall)',
    'ENTREE__SORTIE': 'Entry/Exit points / Corridors (French: ENTREE/SORTIE)',
    'NO_ENTREE': 'No-entry zones / Forbidden areas (French: NO ENTREE)',
    'ESCHELLE_GRAPHIQUE_1_M': 'Graphic scale / Legend',
    '0': 'Default layer',
    'DEFPOINTS': 'Definition points for dimensions'
}

for layer in doc.layers:
    name = layer.dxf.name
    desc = layer_info.get(name, 'Unknown')
    print(f'   {name}: {desc}')

# Detailed wall/box analysis
print('\n[STORAGE BOX ANALYSIS - MUR Layer]')
lines_mur = [e for e in msp if e.dxftype() == 'LINE' and e.dxf.layer == 'MUR']
lwpolys_mur = [e for e in msp if e.dxftype() == 'LWPOLYLINE' and e.dxf.layer == 'MUR']

print(f'   Line segments: {len(lines_mur)}')
print(f'   Polylines (open): {len([p for p in lwpolys_mur if not p.closed])}')
print(f'   Polylines (closed/rooms): {len([p for p in lwpolys_mur if p.closed])}')

# Calculate total wall length
total_wall_length = 0
horizontal_walls = 0
vertical_walls = 0

for line in lines_mur:
    dx = line.dxf.end.x - line.dxf.start.x
    dy = line.dxf.end.y - line.dxf.start.y
    length = math.sqrt(dx*dx + dy*dy)
    total_wall_length += length
    
    if abs(dy) < 0.01:
        horizontal_walls += 1
    elif abs(dx) < 0.01:
        vertical_walls += 1

print(f'   Total wall line length: {total_wall_length:.2f} units')
print(f'   Horizontal segments: {horizontal_walls}')
print(f'   Vertical segments: {vertical_walls}')

# Entry/Exit analysis
print('\n[CORRIDOR/ENTRY ANALYSIS - ENTREE__SORTIE Layer]')
lines_entry = [e for e in msp if e.dxftype() == 'LINE' and e.dxf.layer == 'ENTREE__SORTIE']
lwpolys_entry = [e for e in msp if e.dxftype() == 'LWPOLYLINE' and e.dxf.layer == 'ENTREE__SORTIE']
hatches_entry = [e for e in msp if e.dxftype() == 'HATCH' and e.dxf.layer == 'ENTREE__SORTIE']

print(f'   Line segments: {len(lines_entry)}')
print(f'   Closed polylines (corridor areas): {len([p for p in lwpolys_entry if p.closed])}')
print(f'   Hatches (corridor fills): {len(hatches_entry)}')

# Analyze corridor dimensions
closed_entry_polys = [p for p in lwpolys_entry if p.closed]
if closed_entry_polys:
    widths = []
    heights = []
    for pl in closed_entry_polys:
        points = list(pl.get_points('xy'))
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        widths.append(max(xs) - min(xs))
        heights.append(max(ys) - min(ys))
    
    print(f'   Corridor width range: {min(widths):.2f} to {max(widths):.2f} units')
    print(f'   Corridor height range: {min(heights):.2f} to {max(heights):.2f} units')

# No-entry zones analysis
print('\n[FORBIDDEN ZONES - NO_ENTREE Layer]')
lines_noentry = [e for e in msp if e.dxftype() == 'LINE' and e.dxf.layer == 'NO_ENTREE']
lwpolys_noentry = [e for e in msp if e.dxftype() == 'LWPOLYLINE' and e.dxf.layer == 'NO_ENTREE']
hatches_noentry = [e for e in msp if e.dxftype() == 'HATCH' and e.dxf.layer == 'NO_ENTREE']

print(f'   Line segments: {len(lines_noentry)}')
print(f'   Closed polylines (blocked areas): {len([p for p in lwpolys_noentry if p.closed])}')
print(f'   Hatches (blocked area fills): {len(hatches_noentry)}')

# Calculate bounding box of the entire floor plan
print('\n[FLOOR PLAN DIMENSIONS]')
all_x = []
all_y = []

for line in msp.query('LINE'):
    all_x.extend([line.dxf.start.x, line.dxf.end.x])
    all_y.extend([line.dxf.start.y, line.dxf.end.y])

for pl in msp.query('LWPOLYLINE'):
    for pt in pl.get_points('xy'):
        all_x.append(pt[0])
        all_y.append(pt[1])

if all_x and all_y:
    min_x, max_x = min(all_x), max(all_x)
    min_y, max_y = min(all_y), max(all_y)
    width = max_x - min_x
    height = max_y - min_y
    area = width * height
    
    print(f'   Bounding box: ({min_x:.2f}, {min_y:.2f}) to ({max_x:.2f}, {max_y:.2f})')
    print(f'   Width: {width:.2f} units')
    print(f'   Height: {height:.2f} units')
    print(f'   Total area: {area:.2f} sq units')
    print(f'   Aspect ratio: {width/height:.2f}')

# Estimate number of storage units
print('\n[STORAGE UNIT ESTIMATION]')
# Based on closed polylines on MUR layer
closed_mur_polys = [p for p in lwpolys_mur if p.closed]
print(f'   Closed wall polylines (likely rooms): {len(closed_mur_polys)}')

# Alternative: Count based on grid pattern
# Get unique x and y coordinates from wall lines
wall_x_coords = set()
wall_y_coords = set()
for line in lines_mur:
    wall_x_coords.add(round(line.dxf.start.x, 0))
    wall_x_coords.add(round(line.dxf.end.x, 0))
    wall_y_coords.add(round(line.dxf.start.y, 0))
    wall_y_coords.add(round(line.dxf.end.y, 0))

print(f'   Distinct X coordinates: {len(wall_x_coords)}')
print(f'   Distinct Y coordinates: {len(wall_y_coords)}')

# File metadata
print('\n[FILE METADATA]')
print(f'   DXF Version: {doc.dxfversion} (AutoCAD 2000)')
print(f'   Created by: {doc.header.get("$ACADVER", "Unknown")}')
print(f'   Measurement system: Metric (MEASUREMENT = 1)')

# Summary
print('\n' + '='*70)
print('SUMMARY')
print('='*70)
print(f'''
This DXF file represents a storage facility floor plan with:

- FLOOR PLAN SIZE: ~{width:.1f} x {height:.1f} units ({area:.0f} sq units total)
- WALLS: {len(lines_mur)} line segments defining storage unit boundaries
- STORAGE UNITS: Approximately {len(closed_mur_polys)} distinct rooms/boxes
- CORRIDORS: {len(closed_entry_polys)} defined entry/circulation areas  
- FORBIDDEN ZONES: {len([p for p in lwpolys_noentry if p.closed])} no-entry areas

LAYER STRUCTURE (French terminology):
- MUR (Walls): Storage unit boundaries
- ENTREE__SORTIE (Entry/Exit): Corridors and access paths
- NO_ENTREE (No Entry): Blocked/forbidden areas
- ESCHELLE_GRAPHIQUE: Scale reference

The layout appears to be a COSTO-style self-storage warehouse with:
- Grid-based storage unit arrangement
- Defined circulation corridors
- Clear separation between accessible and forbidden zones
''')

print('='*70)
