import ezdxf
import json
import math
from collections import defaultdict

doc = ezdxf.readfile('../Samples/Test2.dxf')
msp = doc.modelspace()

# Export detailed analysis to JSON
analysis = {
    'file_info': {
        'filename': 'Test2.dxf',
        'dxf_version': doc.dxfversion,
        'encoding': doc.encoding,
        'measurement_system': 'metric'
    },
    'layers': [],
    'entities': {
        'total': len(msp),
        'by_type': {},
        'by_layer': {}
    },
    'geometry': {
        'bounds': {},
        'storage_units': [],
        'corridors': [],
        'forbidden_zones': []
    }
}

# Layer info
for layer in doc.layers:
    analysis['layers'].append({
        'name': layer.dxf.name,
        'color': layer.dxf.color,
        'linetype': layer.dxf.linetype
    })

# Entity counts
for entity in msp:
    etype = entity.dxftype()
    layer = entity.dxf.layer
    analysis['entities']['by_type'][etype] = analysis['entities']['by_type'].get(etype, 0) + 1
    analysis['entities']['by_layer'][layer] = analysis['entities']['by_layer'].get(layer, 0) + 1

# Geometry bounds
all_x, all_y = [], []
for line in msp.query('LINE'):
    all_x.extend([line.dxf.start.x, line.dxf.end.x])
    all_y.extend([line.dxf.start.y, line.dxf.end.y])

analysis['geometry']['bounds'] = {
    'min_x': min(all_x),
    'max_x': max(all_x),
    'min_y': min(all_y),
    'max_y': max(all_y),
    'width': max(all_x) - min(all_x),
    'height': max(all_y) - min(all_y)
}

def poly_area(points):
    n = len(points)
    area = 0
    for i in range(n):
        j = (i + 1) % n
        area += points[i][0] * points[j][1]
        area -= points[j][0] * points[i][1]
    return abs(area) / 2

# Storage units (MUR layer closed polys)
for pl in msp.query('LWPOLYLINE'):
    if pl.dxf.layer == 'MUR' and pl.closed:
        points = list(pl.get_points('xy'))
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        analysis['geometry']['storage_units'].append({
            'area': poly_area(points),
            'width': max(xs) - min(xs),
            'height': max(ys) - min(ys),
            'center': (sum(xs)/len(xs), sum(ys)/len(ys)),
            'vertex_count': len(points)
        })

# Corridors (ENTREE__SORTIE layer)
for pl in msp.query('LWPOLYLINE'):
    if pl.dxf.layer == 'ENTREE__SORTIE' and pl.closed:
        points = list(pl.get_points('xy'))
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        analysis['geometry']['corridors'].append({
            'area': poly_area(points),
            'width': max(xs) - min(xs),
            'height': max(ys) - min(ys),
            'center': (sum(xs)/len(xs), sum(ys)/len(ys))
        })

# Forbidden zones (NO_ENTREE layer)
for pl in msp.query('LWPOLYLINE'):
    if pl.dxf.layer == 'NO_ENTREE' and pl.closed:
        points = list(pl.get_points('xy'))
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        analysis['geometry']['forbidden_zones'].append({
            'area': poly_area(points),
            'width': max(xs) - min(xs),
            'height': max(ys) - min(ys),
            'center': (sum(xs)/len(xs), sum(ys)/len(ys))
        })

# Save to JSON
with open('test2_analysis.json', 'w') as f:
    json.dump(analysis, f, indent=2, default=str)

print('Analysis exported to test2_analysis.json')
print(f"Summary:")
print(f"  - {len(analysis['geometry']['storage_units'])} storage units")
print(f"  - {len(analysis['geometry']['corridors'])} corridors")
print(f"  - {len(analysis['geometry']['forbidden_zones'])} forbidden zones")
print(f"  - Total area: {analysis['geometry']['bounds']['width'] * analysis['geometry']['bounds']['height']:.2f} sq units")
