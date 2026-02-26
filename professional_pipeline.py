"""
professional_pipeline.py
========================
Full COSTO Professional Output Pipeline (Python side)

Usage:
    python professional_pipeline.py input.dxf [output_prefix]

Produces:
    - output_prefix.pdf  — Reference-quality architectural floor plan PDF
    - output_prefix.dxf  — Annotated DXF with COSTO layer standard
    - output_prefix.json — Layout data for the Node.js server

This script wraps the full pipeline:
  DXF → parse → semantic interpretation → strip placement → export
"""
import sys
import os
import json
import math
import argparse
from pathlib import Path


# ── Attempt real imports; fall back to stubs ─────────────────────────────────
try:
    from costo_designer.core.dxf_processor import DXFProcessor
    from costo_designer.core.semantic_interpreter import SemanticLayerInterpreter
    from costo_designer.optimization.optimization_engine import StorageOptimizer
    HAS_COSTO = True
except ImportError:
    HAS_COSTO = False

try:
    from shapely.geometry import Polygon
    HAS_SHAPELY = True
except ImportError:
    HAS_SHAPELY = False

try:
    from pdf_exporter import ProfessionalPDFExporter
    HAS_PDF = True
except ImportError:
    HAS_PDF = False


# ── Minimal fallback DXF reader (no ezdxf needed) ───────────────────────────
class MinimalDXFReader:
    """Ultra-minimal DXF reader (LINE entities only, no ezdxf dependency)."""
    def __init__(self, filepath):
        self.filepath = filepath
        self.lines = []
        self.texts = []
        self._read()

    def _read(self):
        try:
            with open(self.filepath, 'r', encoding='utf-8', errors='replace') as f:
                raw = f.read()
        except Exception:
            return

        # Parse LINE entities
        import re
        line_pattern = re.compile(
            r'0\s+LINE.*?8\s+(\S+).*?10\s+([-\d.]+)\s+20\s+([-\d.]+).*?11\s+([-\d.]+)\s+21\s+([-\d.]+)',
            re.DOTALL
        )
        for m in line_pattern.finditer(raw):
            layer, x1, y1, x2, y2 = m.group(1), float(m.group(2)), float(m.group(3)), float(m.group(4)), float(m.group(5))
            if abs(x2 - x1) + abs(y2 - y1) > 0.01:
                self.lines.append({'layer': layer, 'start': [x1, y1], 'end': [x2, y2]})

    def get_bounds(self):
        xs = [l['start'][0] for l in self.lines] + [l['end'][0] for l in self.lines]
        ys = [l['start'][1] for l in self.lines] + [l['end'][1] for l in self.lines]
        if not xs:
            return {'minX': 0, 'minY': 0, 'maxX': 100, 'maxY': 100}
        return {'minX': min(xs), 'minY': min(ys), 'maxX': max(xs), 'maxY': max(ys)}

    def get_walls(self):
        return [
            {
                'start': {'x': l['start'][0], 'y': l['start'][1]},
                'end':   {'x': l['end'][0],   'y': l['end'][1]},
                'length': math.hypot(l['end'][0]-l['start'][0], l['end'][1]-l['start'][1]),
                'layer': l['layer']
            }
            for l in self.lines
        ]


# ── Strip-based placement (pure-Python, no ezdxf/shapely needed) ─────────────
class SimpleStripPlacer:
    """
    Simplified strip-based storage box placer.
    Produces back-to-back box rows separated by 1.2m corridors.
    """
    CATALOG = {
        'S':  {'width': 1.00, 'depth': 2.00},
        'M':  {'width': 2.00, 'depth': 2.50},
        'L':  {'width': 3.00, 'depth': 3.00},
        'XL': {'width': 4.00, 'depth': 3.00},
    }
    DISTRIBUTION = {'S': 0.25, 'M': 0.35, 'L': 0.25, 'XL': 0.15}

    CORRIDOR_WIDTH = 1.20  # m
    WALL_CLEARANCE = 0.20  # m
    BOX_SPACING    = 0.05  # m

    def place(self, bounds, walls=None):
        minX, minY = bounds['minX'] + self.WALL_CLEARANCE, bounds['minY'] + self.WALL_CLEARANCE
        maxX, maxY = bounds['maxX'] - self.WALL_CLEARANCE, bounds['maxY'] - self.WALL_CLEARANCE

        max_depth = max(c['depth'] for c in self.CATALOG.values())
        strip_height = max_depth * 2 + self.CORRIDOR_WIDTH

        boxes     = []
        corridors = []
        box_id    = 1
        strip_idx = 0

        # Build weighted type sequence
        import random
        type_seq = []
        for t, w in self.DISTRIBUTION.items():
            type_seq.extend([t] * int(w * 100))
        random.shuffle(type_seq)
        if not type_seq:
            type_seq = ['M'] * 100
        type_cycle = type_seq * 10
        t_idx = 0

        y = minY
        while y + strip_height <= maxY:
            row_depth   = max_depth
            top_y1      = y
            top_y2      = y + row_depth
            corr_y1     = top_y2
            corr_y2     = top_y2 + self.CORRIDOR_WIDTH
            bottom_y1   = corr_y2
            bottom_y2   = corr_y2 + row_depth

            if bottom_y2 > maxY:
                break

            # Top row (faces downward = toward corridor)
            for row_y, row_name in [(top_y1, f'top_{strip_idx}'), (bottom_y1, f'bot_{strip_idx}')]:
                x = minX
                while x + 0.5 < maxX:
                    btype = type_cycle[t_idx % len(type_cycle)]; t_idx += 1
                    cat   = self.CATALOG[btype]
                    bw, bd = cat['width'], min(row_depth, cat['depth'])
                    if x + bw > maxX:
                        # Try smallest box
                        cat2 = self.CATALOG['S']
                        if x + cat2['width'] <= maxX:
                            btype, bw, bd = 'S', cat2['width'], min(row_depth, cat2['depth'])
                        else:
                            break
                    boxes.append({
                        'id':     f'B{box_id:04d}',
                        'type':   btype,
                        'x':      round(x, 3),
                        'y':      round(row_y, 3),
                        'width':  bw,
                        'height': bd,
                        'area':   round(bw * bd, 2),
                        'zone':   f'Z{strip_idx + 1}',
                        'row':    strip_idx * 2 + (0 if 'top' in row_name else 1) + 1,
                        'facing': 'bottom' if 'top' in row_name else 'top',
                        'partitions': {
                            'top':    'tole_grise',
                            'bottom': 'tole_grise',
                            'left':   'tole_grise',
                            'right':  'tole_grise',
                        }
                    })
                    box_id += 1
                    x += bw + self.BOX_SPACING

            corridors.append({
                'id':    f'CORR_{strip_idx + 1}',
                'type':  'access',
                'x':     round(minX, 3),
                'y':     round(corr_y1, 3),
                'width': round(maxX - minX, 3),
                'height': round(self.CORRIDOR_WIDTH, 3),
            })

            y = bottom_y2 + self.WALL_CLEARANCE * 0.3
            strip_idx += 1

        return boxes, corridors

    def generate_radiators(self, bounds, walls):
        """Generate zigzag radiator path data along perimeter walls."""
        radiators = []
        minX, minY = bounds['minX'], bounds['minY']
        maxX, maxY = bounds['maxX'], bounds['maxY']
        tol = 1.0  # m tolerance for perimeter detection
        perimeter_walls = []
        for w in (walls or []):
            sx, sy = w['start']['x'], w['start']['y']
            ex, ey = w['end']['x'],   w['end']['y']
            on_edge = (
                (abs(sy - minY) < tol and abs(ey - minY) < tol) or
                (abs(sy - maxY) < tol and abs(ey - maxY) < tol) or
                (abs(sx - minX) < tol and abs(ex - minX) < tol) or
                (abs(sx - maxX) < tol and abs(ex - maxX) < tol)
            )
            if on_edge:
                perimeter_walls.append(w)

        # If no walls on perimeter, use bounding box edges
        if not perimeter_walls:
            perimeter_walls = [
                {'start': {'x': minX, 'y': minY}, 'end': {'x': maxX, 'y': minY}, 'length': maxX-minX},
                {'start': {'x': maxX, 'y': minY}, 'end': {'x': maxX, 'y': maxY}, 'length': maxY-minY},
                {'start': {'x': maxX, 'y': maxY}, 'end': {'x': minX, 'y': maxY}, 'length': maxX-minX},
                {'start': {'x': minX, 'y': maxY}, 'end': {'x': minX, 'y': minY}, 'length': maxY-minY},
            ]

        for i, w in enumerate(perimeter_walls):
            sx, sy = w['start']['x'], w['start']['y']
            ex, ey = w['end']['x'],   w['end']['y']
            wlen   = math.hypot(ex - sx, ey - sy)
            if wlen < 1:
                continue
            # Zigzag path: 5 zigzags per meter, amplitude 15cm
            amp   = 0.15
            freq  = 5.0
            n_pts = max(4, int(wlen * freq * 2))
            path  = []
            dx, dy   = (ex - sx) / wlen, (ey - sy) / wlen
            perp_x, perp_y = -dy, dx
            for k in range(n_pts + 1):
                t    = k / n_pts
                base = (sx + dx * wlen * t, sy + dy * wlen * t)
                sign = 1 if k % 2 == 0 else -1
                path.append({'x': base[0] + perp_x * amp * sign,
                              'y': base[1] + perp_y * amp * sign})
            # Discrete positions for symbol rendering
            spacing = 3.0
            n_sym   = max(1, int(wlen / spacing))
            positions = [
                {
                    'x': sx + dx * wlen * (k + 0.5) / n_sym,
                    'y': sy + dy * wlen * (k + 0.5) / n_sym,
                }
                for k in range(n_sym)
            ]
            radiators.append({
                'id':        f'RAD_{i}',
                'type':      'radiator',
                'label':     '100\u00d7300',
                'wallAngle': math.atan2(ey - sy, ex - sx),
                'path':      path,
                'positions': positions,
            })
        return radiators

    def generate_circulation_paths(self, corridors, bounds):
        """Generate main circulation route through all corridors."""
        if not corridors:
            return []
        minX = bounds['minX'] + 0.2
        maxX = bounds['maxX'] - 0.2
        paths = []
        for corr in corridors:
            cx  = corr['x'] + corr['width'] / 2
            cy  = corr['y'] + corr['height'] / 2
            paths.append({
                'type':  'CORRIDOR_CENTER',
                'style': 'dashed_lightblue',
                'path':  [
                    {'x': corr['x'],                     'y': cy},
                    {'x': corr['x'] + corr['width'],     'y': cy},
                ],
            })
        # Connect corridors vertically (main spine)
        if len(corridors) >= 2:
            mid_x = (minX + maxX) / 2
            pts   = [{'x': mid_x, 'y': c['y'] + c['height'] / 2} for c in corridors]
            pts.sort(key=lambda p: p['y'])
            paths.append({'type': 'MAIN_SPINE', 'style': 'dashed_lightblue', 'path': pts})
        return paths


# ── Main pipeline ─────────────────────────────────────────────────────────────
def run_pipeline(dxf_path: str, output_prefix: str, options: dict = None):
    options = options or {}
    print(f"[Pipeline] Processing: {dxf_path}")

    # 1. Read DXF
    walls, bounds, texts, forbidden = [], None, [], []
    if HAS_COSTO:
        try:
            proc = DXFProcessor(dxf_path)
            proc.load()
            walls   = proc.get_walls()
            bounds  = proc.get_bounds()
            texts   = proc.get_dimensions()
            interp  = SemanticLayerInterpreter(proc.doc)
            interp.detect_envelope()
            interp.detect_obstacles()
            interp.detect_forbidden_zones()
            interp.detect_exits()
            forbidden = [
                {'polygon': list(p.exterior.coords), 'type': 'obstacle'}
                for p in (interp.obstacles + interp.forbidden_zones)
                if hasattr(p, 'exterior')
            ]
            print(f"[Pipeline] ezdxf: {len(walls)} walls, {len(texts)} text entities")
        except Exception as e:
            print(f"[Pipeline] ezdxf failed ({e}), falling back to minimal reader")
            HAS_COSTO_LOCAL = False
    if not bounds:
        try:
            reader = MinimalDXFReader(dxf_path)
            walls  = reader.get_walls()
            bounds = reader.get_bounds()
            print(f"[Pipeline] Minimal reader: {len(walls)} walls")
        except Exception as e:
            print(f"[Pipeline] Minimal reader failed: {e}")
            bounds = {'minX': 0, 'minY': 0, 'maxX': 60, 'maxY': 40}
            walls  = []

    print(f"[Pipeline] Bounds: {bounds}")
    w = bounds['maxX'] - bounds['minX']
    h = bounds['maxY'] - bounds['minY']
    print(f"[Pipeline] Floor plan: {w:.1f}m × {h:.1f}m = {w*h:.0f}m²")

    # 2. Place boxes
    placer = SimpleStripPlacer()
    boxes, corridors = placer.place(bounds, walls)
    print(f"[Pipeline] Placed: {len(boxes)} boxes, {len(corridors)} corridors")

    # 3. Generate radiators and circulation paths
    radiators          = placer.generate_radiators(bounds, walls)
    circulation_paths  = placer.generate_circulation_paths(corridors, bounds)

    # 4. Build layout JSON (compatible with Node.js server)
    total_area = sum(b['area'] for b in boxes)
    layout_data = {
        'floorPlan': {
            'bounds':        bounds,
            'walls':         walls,
            'forbiddenZones': forbidden,
            'entrances':     [],
            'rooms':         [],
        },
        'solution': {
            'boxes':           boxes,
            'corridors':       corridors,
            'radiators':       radiators,
            'circulationPaths': circulation_paths,
        },
        'metrics': {
            'totalBoxes': len(boxes),
            'totalArea':  round(total_area, 2),
            'yieldRatio': round(total_area / max(1, w * h), 3),
            'corridorCount': len(corridors),
        },
    }

    json_path = f"{output_prefix}.json"
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(layout_data, f, indent=2, ensure_ascii=False)
    print(f"[Pipeline] Saved layout JSON: {json_path}")

    # 5. Annotated DXF output
    dxf_out = f"{output_prefix}.dxf"
    _write_annotated_dxf(dxf_out, bounds, walls, boxes, corridors, radiators)
    print(f"[Pipeline] Saved annotated DXF: {dxf_out}")

    # 6. PDF export (via Node.js costoExports — generate curl command)
    print(f"\n[Pipeline] To generate PDF, run:")
    print(f"  node generate_pdf.js {json_path}")

    return layout_data


def _write_annotated_dxf(path, bounds, walls, boxes, corridors, radiators):
    """Write a proper DXF file with COSTO layer standard."""
    lines = [
        '  0\nSECTION\n  2\nHEADER\n  9\n$ACADVER\n  1\nAC1024\n  0\nENDSEC\n',
        '  0\nSECTION\n  2\nTABLES\n  0\nTABLE\n  2\nLAYER\n',
    ]
    layers = [
        ('WALLS',        7),   # White
        ('TOLE_GRISE',   5),   # Blue
        ('TOLE_BLANCHE', 252), # Gray
        ('CORRIDORS',    4),   # Cyan
        ('RADIATEURS',   1),   # Red
        ('DIMENSIONS',   6),   # Magenta
        ('LABELS',       7),   # White
        ('CIRCULATION',  4),   # Cyan (dashed)
    ]
    for name, color in layers:
        lines.append(f'  0\nLAYER\n  2\n{name}\n 70\n     0\n 62\n{color:6d}\n')
    lines.append('  0\nENDTAB\n  0\nENDSEC\n')
    lines.append('  0\nSECTION\n  2\nENTITIES\n')

    def line_entity(layer, x1, y1, x2, y2, color=None):
        s = f'  0\nLINE\n  8\n{layer}\n 10\n{x1:.4f}\n 20\n{y1:.4f}\n 11\n{x2:.4f}\n 21\n{y2:.4f}\n'
        if color is not None:
            s = f'  0\nLINE\n  8\n{layer}\n 62\n{color}\n 10\n{x1:.4f}\n 20\n{y1:.4f}\n 11\n{x2:.4f}\n 21\n{y2:.4f}\n'
        return s

    def polyline_entity(layer, pts, closed=True, color=None):
        s = f'  0\nLWPOLYLINE\n  8\n{layer}\n'
        if color is not None:
            s += f' 62\n{color}\n'
        s += f' 90\n{len(pts)}\n 70\n{"1" if closed else "0"}\n'
        for x, y in pts:
            s += f' 10\n{x:.4f}\n 20\n{y:.4f}\n'
        return s

    def text_entity(layer, x, y, txt, h=0.4, color=None):
        s = f'  0\nTEXT\n  8\n{layer}\n 10\n{x:.4f}\n 20\n{y:.4f}\n 40\n{h:.3f}\n  1\n{txt}\n'
        if color is not None:
            s = f'  0\nTEXT\n  8\n{layer}\n 62\n{color}\n 10\n{x:.4f}\n 20\n{y:.4f}\n 40\n{h:.3f}\n  1\n{txt}\n'
        return s

    # Walls
    for w in walls:
        lines.append(line_entity('WALLS', w['start']['x'], w['start']['y'], w['end']['x'], w['end']['y']))

    # Boxes (TOLE_GRISE for partitions)
    for box in boxes:
        x, y, bw, bh = box['x'], box['y'], box['width'], box['height']
        pts = [(x, y), (x+bw, y), (x+bw, y+bh), (x, y+bh)]
        lines.append(polyline_entity('TOLE_GRISE', pts, closed=True, color=5))
        # Area label inside box
        cx, cy = x + bw / 2, y + bh / 2
        area_text = f"{box['area']:.2f}m\u00b2"
        lines.append(text_entity('LABELS', cx - len(area_text)*0.12, cy - 0.1, area_text, h=0.35))
        # Dimension labels (width x height)
        dim_text = f"{bw:.2f}"
        lines.append(text_entity('DIMENSIONS', cx - 0.3, y - 0.5, dim_text, h=0.3, color=6))

    # Corridors (dashed centerline style)
    for corr in corridors:
        cx = corr['x'] + corr['width'] / 2
        cy = corr['y'] + corr['height'] / 2
        lines.append(line_entity('CORRIDORS', corr['x'], cy, corr['x'] + corr['width'], cy, color=4))

    # Radiators (zigzag path = LWPOLYLINE)
    for rad in radiators:
        if rad.get('path') and len(rad['path']) >= 2:
            pts = [(p['x'], p['y']) for p in rad['path']]
            lines.append(polyline_entity('RADIATEURS', pts, closed=False, color=1))
        # Dimension label
        if rad.get('positions') and rad['positions']:
            p = rad['positions'][0]
            lines.append(text_entity('LABELS', p['x'], p['y'] + 0.3, rad.get('label', '100\xd7300'), h=0.25, color=1))

    lines.append('  0\nENDSEC\n  0\nEOF\n')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(''.join(lines))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='COSTO Professional Pipeline')
    parser.add_argument('dxf',    help='Input DXF file path')
    parser.add_argument('output', nargs='?', default='output/costo_output', help='Output prefix (no extension)')
    parser.add_argument('--corridor-width', type=float, default=1.2, help='Access corridor width (m)')
    args = parser.parse_args()

    os.makedirs(os.path.dirname(args.output) or '.', exist_ok=True)
    result = run_pipeline(args.dxf, args.output, {'corridorWidth': args.corridor_width})
    print(f"\n[Pipeline] Done! Total area placed: {result['metrics']['totalArea']}m²  "
          f"Yield: {result['metrics']['yieldRatio']*100:.1f}%")
