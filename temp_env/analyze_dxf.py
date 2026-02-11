import ezdxf
import json
from collections import defaultdict

doc = ezdxf.readfile('../Samples/Test2.dxf')
msp = doc.modelspace()

print('='*70)
print('DXF FILE ANALYSIS: Test2.dxf')
print('='*70)

# Basic file info
print('\n[FILE INFORMATION]')
print(f'   DXF Version: {doc.dxfversion}')
print(f'   File Encoding: {doc.encoding}')

# Header variables
print('\n[HEADER VARIABLES]')
header = doc.header
try:
    print(f'   INSUNITS: {header.get("$INSUNITS", "N/A")}')
except:
    pass
try:
    print(f'   MEASUREMENT: {header.get("$MEASUREMENT", "N/A")}')
except:
    pass

# Layers
print(f'\n[LAYERS - {len(doc.layers)} total]')
for layer in doc.layers:
    print(f'   - {layer.dxf.name}: color={layer.dxf.color}, linetype={layer.dxf.linetype}')

# Entity counts by type
print(f'\n[ENTITY COUNTS IN MODELSPACE - {len(msp)} total]')
entity_counts = {}
for entity in msp:
    etype = entity.dxftype()
    entity_counts[etype] = entity_counts.get(etype, 0) + 1

for etype, count in sorted(entity_counts.items(), key=lambda x: -x[1]):
    print(f'   {etype}: {count}')

# Detailed analysis of LINE entities
print('\n[LINE ENTITIES ANALYSIS]')
lines = list(msp.query('LINE'))
if lines:
    print(f'   Total LINE entities: {len(lines)}')
    
# Detailed analysis of LWPOLYLINE entities  
print('\n[LWPOLYLINE ENTITIES ANALYSIS]')
lwpolylines = list(msp.query('LWPOLYLINE'))
if lwpolylines:
    print(f'   Total LWPOLYLINE entities: {len(lwpolylines)}')
    closed_count = sum(1 for p in lwpolylines if p.closed)
    print(f'   Closed polylines: {closed_count}')
    open_count = len(lwpolylines) - closed_count
    print(f'   Open polylines: {open_count}')

# Detailed analysis of TEXT/MTEXT
print('\n[TEXT ENTITIES ANALYSIS]')
texts = list(msp.query('TEXT'))
mtexts = list(msp.query('MTEXT'))
print(f'   TEXT entities: {len(texts)}')
print(f'   MTEXT entities: {len(mtexts)}')

# Layer usage analysis
print('\n[LAYER USAGE IN MODELSPACE]')
layer_usage = defaultdict(int)
for entity in msp:
    layer_usage[entity.dxf.layer] += 1

for layer, count in sorted(layer_usage.items(), key=lambda x: -x[1])[:15]:
    print(f'   {layer}: {count} entities')

# Bounding box analysis
print('\n[GEOMETRIC BOUNDS]')
all_points = []
for entity in msp:
    try:
        if entity.dxftype() == 'LINE':
            all_points.append((entity.dxf.start.x, entity.dxf.start.y))
            all_points.append((entity.dxf.end.x, entity.dxf.end.y))
        elif hasattr(entity, 'get_points'):
            pts = list(entity.get_points('xy'))
            all_points.extend(pts)
    except:
        pass

if all_points:
    min_x = min(p[0] for p in all_points)
    max_x = max(p[0] for p in all_points)
    min_y = min(p[1] for p in all_points)
    max_y = max(p[1] for p in all_points)
    width = max_x - min_x
    height = max_y - min_y
    print(f'   Bounds: ({min_x:.2f}, {min_y:.2f}) to ({max_x:.2f}, {max_y:.2f})')
    print(f'   Width: {width:.2f} units')
    print(f'   Height: {height:.2f} units')

print('\n' + '='*70)
print('ANALYSIS COMPLETE')
print('='*70)
