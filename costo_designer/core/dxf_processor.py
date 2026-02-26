import ezdxf
from typing import List, Optional, Dict, Tuple
import math


class DXFProcessor:
    def __init__(self, filepath: str):
        self.filepath = filepath
        self.doc = None
        self.msp = None

    def load(self):
        try:
            self.doc = ezdxf.readfile(self.filepath)
            self.msp = self.doc.modelspace()
        except IOError:
            raise Exception(f"Not a DXF file or a generic I/O error: {self.filepath}")
        except ezdxf.DXFStructureError:
            raise Exception(f"Invalid or corrupted DXF file: {self.filepath}")

    def get_entities(self, layer: str = None, dxftype: str = None):
        if not self.msp:
            return []
        entities = list(self.msp)
        if layer:
            entities = [e for e in entities if hasattr(e.dxf, 'layer') and e.dxf.layer == layer]
        if dxftype:
            entities = [e for e in entities if e.dxftype() == dxftype]
        return entities

    def get_layers(self) -> List[str]:
        if not self.doc:
            return []
        return [layer.dxf.name for layer in self.doc.layers]

    def get_walls(self) -> List[Dict]:
        """Extract wall segments from LINE and LWPOLYLINE entities."""
        walls = []
        if not self.msp:
            return walls
        wall_layer_patterns = ['wall', 'mur', 'cloison', 'paroi', 'enveloppe', 'contour']
        for entity in self.msp:
            layer = getattr(entity.dxf, 'layer', '').lower()
            is_wall_layer = any(p in layer for p in wall_layer_patterns)
            if entity.dxftype() == 'LINE':
                start = entity.dxf.start
                end = entity.dxf.end
                length = math.hypot(end.x - start.x, end.y - start.y)
                if length > 0.1:
                    walls.append({
                        'start': {'x': float(start.x), 'y': float(start.y)},
                        'end': {'x': float(end.x), 'y': float(end.y)},
                        'length': length,
                        'layer': entity.dxf.layer,
                        'is_wall': is_wall_layer
                    })
            elif entity.dxftype() == 'LWPOLYLINE':
                pts = list(entity.get_points())
                closed = entity.closed
                for i in range(len(pts) - 1):
                    p1, p2 = pts[i], pts[i + 1]
                    length = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
                    if length > 0.1:
                        walls.append({
                            'start': {'x': float(p1[0]), 'y': float(p1[1])},
                            'end': {'x': float(p2[0]), 'y': float(p2[1])},
                            'length': length,
                            'layer': entity.dxf.layer,
                            'is_wall': is_wall_layer
                        })
                if closed and len(pts) >= 2:
                    p1, p2 = pts[-1], pts[0]
                    length = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
                    if length > 0.1:
                        walls.append({
                            'start': {'x': float(p1[0]), 'y': float(p1[1])},
                            'end': {'x': float(p2[0]), 'y': float(p2[1])},
                            'length': length,
                            'layer': entity.dxf.layer,
                            'is_wall': is_wall_layer
                        })
        return walls

    def get_dimensions(self) -> List[Dict]:
        """Extract dimension annotations from the DXF file."""
        dimensions = []
        if not self.msp:
            return dimensions
        for entity in self.msp:
            if entity.dxftype() in ('DIMENSION', 'ALIGNED_DIMENSION', 'LINEAR_DIMENSION'):
                try:
                    dim = {
                        'type': entity.dxftype(),
                        'layer': getattr(entity.dxf, 'layer', '0'),
                        'measurement': getattr(entity.dxf, 'actual_measurement', None),
                        'text': getattr(entity.dxf, 'text', ''),
                    }
                    if hasattr(entity.dxf, 'defpoint'):
                        dp = entity.dxf.defpoint
                        dim['defpoint'] = {'x': float(dp.x), 'y': float(dp.y)}
                    dimensions.append(dim)
                except Exception:
                    pass
            elif entity.dxftype() == 'TEXT':
                try:
                    text = entity.dxf.text.strip()
                    if text:
                        pos = entity.dxf.insert
                        dimensions.append({
                            'type': 'TEXT',
                            'text': text,
                            'layer': entity.dxf.layer,
                            'position': {'x': float(pos.x), 'y': float(pos.y)},
                            'height': float(getattr(entity.dxf, 'height', 2.5))
                        })
                except Exception:
                    pass
            elif entity.dxftype() == 'MTEXT':
                try:
                    text = entity.text.strip()
                    if text:
                        pos = entity.dxf.insert
                        dimensions.append({
                            'type': 'MTEXT',
                            'text': text,
                            'layer': getattr(entity.dxf, 'layer', '0'),
                            'position': {'x': float(pos.x), 'y': float(pos.y)},
                            'height': float(getattr(entity.dxf, 'char_height', 2.5))
                        })
                except Exception:
                    pass
        return dimensions

    def get_bounds(self) -> Dict:
        """Compute overall bounding box of all entities."""
        xs, ys = [], []
        if not self.msp:
            return {'minX': 0, 'minY': 0, 'maxX': 100, 'maxY': 100}
        for entity in self.msp:
            try:
                if entity.dxftype() == 'LINE':
                    xs += [entity.dxf.start.x, entity.dxf.end.x]
                    ys += [entity.dxf.start.y, entity.dxf.end.y]
                elif entity.dxftype() in ('LWPOLYLINE', 'POLYLINE'):
                    if entity.dxftype() == 'LWPOLYLINE':
                        for p in entity.get_points():
                            xs.append(p[0]); ys.append(p[1])
                    else:
                        for v in entity.vertices:
                            xs.append(v.dxf.location.x)
                            ys.append(v.dxf.location.y)
                elif entity.dxftype() in ('CIRCLE', 'ARC'):
                    cx, cy, r = entity.dxf.center.x, entity.dxf.center.y, entity.dxf.radius
                    xs += [cx - r, cx + r]; ys += [cy - r, cy + r]
            except Exception:
                pass
        if not xs:
            return {'minX': 0, 'minY': 0, 'maxX': 100, 'maxY': 100}
        return {'minX': min(xs), 'minY': min(ys), 'maxX': max(xs), 'maxY': max(ys)}

    def get_forbidden_zones(self) -> List[Dict]:
        """Extract forbidden zones from hatched areas, blocks named stairs/elevator etc."""
        forbidden = []
        if not self.msp:
            return forbidden
        forbidden_patterns = [
            'stair', 'escalier', 'marche', 'elevator', 'ascenseur',
            'column', 'poteau', 'pillar', 'shaft', 'gaine',
            'forbidden', 'interdit', 'obstacle'
        ]
        for entity in self.msp:
            layer = getattr(entity.dxf, 'layer', '').lower()
            if any(p in layer for p in forbidden_patterns):
                try:
                    if entity.dxftype() == 'LWPOLYLINE':
                        pts = [(float(p[0]), float(p[1])) for p in entity.get_points()]
                        if len(pts) >= 3:
                            xs = [p[0] for p in pts]
                            ys = [p[1] for p in pts]
                            forbidden.append({
                                'type': layer,
                                'polygon': [[p[0], p[1]] for p in pts],
                                'bounds': {
                                    'minX': min(xs), 'minY': min(ys),
                                    'maxX': max(xs), 'maxY': max(ys)
                                }
                            })
                    elif entity.dxftype() == 'INSERT':
                        ins = entity.dxf.insert
                        forbidden.append({
                            'type': layer,
                            'center': {'x': float(ins.x), 'y': float(ins.y)},
                            'polygon': [
                                [float(ins.x) - 1, float(ins.y) - 1],
                                [float(ins.x) + 1, float(ins.y) - 1],
                                [float(ins.x) + 1, float(ins.y) + 1],
                                [float(ins.x) - 1, float(ins.y) + 1],
                            ]
                        })
                except Exception:
                    pass
        return forbidden
