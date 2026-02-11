import ezdxf
import json
from collections import defaultdict

doc = ezdxf.readfile('../Samples/Test2.dxf')
msp = doc.modelspace()

print('='*70)
print('ROOM/BOX ANALYSIS: Test2.dxf')
print('='*70)

# Analyze closed LWPOLYLINEs as potential rooms/boxes
lwpolylines = list(msp.query('LWPOLYLINE'))
closed_polys = [p for p in lwpolylines if p.closed]

print(f'\nTotal closed polylines (potential rooms/boxes): {len(closed_polys)}')

# Calculate areas of closed polylines
def poly_area(points):
    """Calculate area using shoelace formula"""
    n = len(points)
    area = 0
    for i in range(n):
        j = (i + 1) % n
        area += points[i][0] * points[j][1]
        area -= points[j][0] * points[i][1]
    return abs(area) / 2

print('\n[AREAS OF CLOSED POLYLINES BY LAYER]')
areas_by_layer = defaultdict(list)
for pl in closed_polys:
    points = list(pl.get_points('xy'))
    area = poly_area(points)
    areas_by_layer[pl.dxf.layer].append({
        'area': area,
        'points': len(points),
        'bounds': (min(p[0] for p in points), min(p[1] for p in points), 
                   max(p[0] for p in points), max(p[1] for p in points))
    })

for layer, areas in areas_by_layer.items():
    print(f'\n   Layer: {layer}')
    print(f'   Count: {len(areas)}')
    if areas:
        all_areas = [a['area'] for a in areas]
        print(f'   Area range: {min(all_areas):.4f} to {max(all_areas):.4f}')
        print(f'   Average area: {sum(all_areas)/len(all_areas):.4f}')
        print(f'   Total area: {sum(all_areas):.4f}')
        
        # Find common sizes
        from collections import Counter
        rounded_areas = [round(a, 2) for a in all_areas]
        common = Counter(rounded_areas).most_common(5)
        print(f'   Most common sizes: {common}')

# Analyze HATCH areas
print('\n[HATCH ENTITIES - DETAILED]')
hatches = list(msp.query('HATCH'))
for layer in ['ENTREE__SORTIE', 'NO_ENTREE', 'MUR']:
    layer_hatches = [h for h in hatches if h.dxf.layer == layer]
    if layer_hatches:
        print(f'\n   Layer: {layer} ({len(layer_hatches)} hatches)')
        for i, h in enumerate(layer_hatches[:3]):  # Sample first 3
            try:
                paths = list(h.paths.rendering_paths)
                print(f'      Hatch {i+1}: {len(paths)} path(s)')
            except:
                print(f'      Hatch {i+1}: unable to analyze paths')

# Check for corridor patterns
print('\n[POTENTIAL CORRIDOR DETECTION]')
# Corridors are typically on ENTREE__SORTIE layer
entree_polys = [p for p in closed_polys if p.dxf.layer == 'ENTREE__SORTIE']
if entree_polys:
    print(f'   Found {len(entree_polys)} closed polys on ENTREE__SORTIE layer')
    # Analyze their shapes
    for pl in entree_polys[:3]:
        points = list(pl.get_points('xy'))
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        width = max(xs) - min(xs)
        height = max(ys) - min(ys)
        area = poly_area(points)
        print(f'      Shape: {width:.2f} x {height:.2f}, Area: {area:.4f}')

# Detect grid structure
print('\n[GRID STRUCTURE ANALYSIS]')
wall_polys = [p for p in closed_polys if p.dxf.layer == 'MUR']
if wall_polys:
    # Get centers of all wall boxes
    centers = []
    for pl in wall_polys:
        points = list(pl.get_points('xy'))
        cx = sum(p[0] for p in points) / len(points)
        cy = sum(p[1] for p in points) / len(points)
        centers.append((cx, cy))
    
    # Analyze X distribution
    x_coords = sorted(set(round(c[0], 1) for c in centers))
    y_coords = sorted(set(round(c[1], 1) for c in centers))
    print(f'   Unique X grid positions: {len(x_coords)}')
    print(f'   Unique Y grid positions: {len(y_coords)}')
    print(f'   Approximate grid: {len(x_coords)} x {len(y_coords)} = {len(x_coords) * len(y_coords)} positions')
    
    # Show spacing
    if len(x_coords) > 1:
        x_spacings = [x_coords[i+1] - x_coords[i] for i in range(len(x_coords)-1)]
        common_x = defaultdict(int)
        for s in x_spacings:
            common_x[round(s, 1)] += 1
        print(f'   X-spacing patterns: {dict(sorted(common_x.items(), key=lambda x: -x[1])[:3])}')
    
    if len(y_coords) > 1:
        y_spacings = [y_coords[i+1] - y_coords[i] for i in range(len(y_coords)-1)]
        common_y = defaultdict(int)
        for s in y_spacings:
            common_y[round(s, 1)] += 1
        print(f'   Y-spacing patterns: {dict(sorted(common_y.items(), key=lambda x: -x[1])[:3])}')

print('\n' + '='*70)
