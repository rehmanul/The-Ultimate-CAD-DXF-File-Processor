from shapely.geometry import Polygon, LineString, MultiPolygon, Point
from shapely.ops import unary_union, polygonize, split
import math
from typing import List, Dict, Optional, Tuple


class SemanticLayerInterpreter:
    """
    Real semantic interpreter for COSTO DXF files.
    Extracts: envelope, obstacles, forbidden zones, exits, fire doors.
    Uses heuristics based on layer names, colors, and geometry.
    """

    # Layer name patterns for each semantic type
    ENVELOPE_PATTERNS = [
        'enveloppe', 'contour', 'outline', 'perimeter', 'perimetre',
        'ext', 'exterior', 'boundary', 'dalles', 'floor'
    ]
    OBSTACLE_PATTERNS = [
        'column', 'poteau', 'pillar', 'pilier', 'colonne',
        'beam', 'poutre', 'structural', 'struct'
    ]
    FORBIDDEN_PATTERNS = [
        'stair', 'escalier', 'marche', 'step', 'elevator', 'ascenseur',
        'lift', 'monte-charge', 'wc', 'toilet', 'sanitaire',
        'forbidden', 'interdit', 'inaccessible', 'shaft', 'gaine',
        'tech', 'technique', 'electric', 'electrique'
    ]
    EXIT_PATTERNS = [
        'exit', 'sortie', 'entrance', 'entree', 'door', 'porte',
        'access', 'acces', 'gate', 'portail', 'loading', 'quai'
    ]
    FIRE_DOOR_PATTERNS = [
        'fire', 'feu', 'cf', 'coupe-feu', 'firewall', 'pare-feu',
        'security', 'securite', 'emergency', 'urgence'
    ]
    WALL_PATTERNS = [
        'wall', 'mur', 'cloison', 'paroi', 'tole', 'metal', 'panel',
        'partition', 'separation'
    ]

    def __init__(self, dxf_doc, scale_factor: float = 1.0):
        self.dxf_doc = dxf_doc
        self.scale_factor = scale_factor
        self.msp = dxf_doc.modelspace() if dxf_doc else None
        self.envelope: Optional[Polygon] = None
        self.obstacles: List[Polygon] = []
        self.forbidden_zones: List[Polygon] = []
        self.exits: List[Dict] = []
        self.fire_doors: List[Dict] = []
        self.walls: List[Dict] = []
        self._entity_cache = {}

    def _matches(self, layer: str, patterns: List[str]) -> bool:
        l = layer.lower()
        return any(p in l for p in patterns)

    def _entity_to_polygon(self, entity) -> Optional[Polygon]:
        try:
            etype = entity.dxftype()
            if etype == 'LWPOLYLINE':
                pts = [(float(p[0]), float(p[1])) for p in entity.get_points()]
                if len(pts) >= 3:
                    return Polygon(pts)
            elif etype == 'POLYLINE':
                pts = [(float(v.dxf.location.x), float(v.dxf.location.y)) for v in entity.vertices]
                if len(pts) >= 3:
                    return Polygon(pts)
            elif etype == 'CIRCLE':
                c = entity.dxf.center
                r = entity.dxf.radius
                return Point(c.x, c.y).buffer(r, resolution=16)
            elif etype == 'INSERT':
                # Block reference — return bounding box
                ins = entity.dxf.insert
                sx = float(getattr(entity.dxf, 'xscale', 1.0))
                sy = float(getattr(entity.dxf, 'yscale', 1.0))
                # Simple 1mx1m footprint scaled
                return Point(ins.x, ins.y).buffer(max(sx, sy) * 0.5, resolution=4)
        except Exception:
            pass
        return None

    def _entity_to_line(self, entity) -> Optional[Tuple[Dict, Dict]]:
        try:
            etype = entity.dxftype()
            if etype == 'LINE':
                s, e = entity.dxf.start, entity.dxf.end
                return ({'x': float(s.x), 'y': float(s.y)},
                        {'x': float(e.x), 'y': float(e.y)})
        except Exception:
            pass
        return None

    def detect_envelope(self, layer_mapping: Optional[Dict] = None) -> Optional[Polygon]:
        """Extract usable perimeter from the largest closed polygon in envelope layers."""
        if not self.msp:
            return None

        candidates: List[Polygon] = []

        for entity in self.msp:
            layer = getattr(entity.dxf, 'layer', '')
            is_envelope = self._matches(layer, self.ENVELOPE_PATTERNS)
            is_wall = self._matches(layer, self.WALL_PATTERNS)

            if layer_mapping:
                mapped = layer_mapping.get(layer, {})
                if mapped.get('type') == 'envelope':
                    is_envelope = True

            if is_envelope or (is_wall and entity.dxftype() == 'LWPOLYLINE'):
                poly = self._entity_to_polygon(entity)
                if poly and poly.is_valid and not poly.is_empty and poly.area > 10:
                    candidates.append(poly)

        if not candidates:
            # Fallback: derive envelope from all wall lines
            all_lines = []
            for entity in self.msp:
                layer = getattr(entity.dxf, 'layer', '')
                if self._matches(layer, self.WALL_PATTERNS) or self._matches(layer, self.ENVELOPE_PATTERNS):
                    if entity.dxftype() == 'LINE':
                        s, e = entity.dxf.start, entity.dxf.end
                        all_lines.append(LineString([(s.x, s.y), (e.x, e.y)]))
            if all_lines:
                merged = unary_union(all_lines)
                polys = list(polygonize(merged))
                if polys:
                    candidates = [p for p in polys if p.area > 10]

        if not candidates:
            return None

        # Select the largest candidate as the envelope
        envelope = max(candidates, key=lambda p: p.area)
        self.envelope = envelope
        return envelope

    def detect_obstacles(self) -> List[Polygon]:
        """Extract structural obstacles (columns, pillars, beams)."""
        if not self.msp:
            return []
        obstacles = []
        for entity in self.msp:
            layer = getattr(entity.dxf, 'layer', '')
            if self._matches(layer, self.OBSTACLE_PATTERNS):
                poly = self._entity_to_polygon(entity)
                if poly and poly.is_valid and not poly.is_empty:
                    obstacles.append(poly)
        self.obstacles = obstacles
        return obstacles

    def detect_forbidden_zones(self) -> List[Polygon]:
        """Extract forbidden zones (stairs, elevators, toilets, technical rooms)."""
        if not self.msp:
            return []
        forbidden = []
        for entity in self.msp:
            layer = getattr(entity.dxf, 'layer', '')
            if self._matches(layer, self.FORBIDDEN_PATTERNS):
                poly = self._entity_to_polygon(entity)
                if poly and poly.is_valid and not poly.is_empty:
                    forbidden.append(poly)
        self.forbidden_zones = forbidden
        return forbidden

    def detect_exits(self) -> List[Dict]:
        """Detect exits/entrances from relevant layers."""
        if not self.msp:
            return []
        exits = []
        for entity in self.msp:
            layer = getattr(entity.dxf, 'layer', '')
            if self._matches(layer, self.EXIT_PATTERNS):
                line = self._entity_to_line(entity)
                if line:
                    exits.append({'start': line[0], 'end': line[1], 'layer': layer})
                else:
                    poly = self._entity_to_polygon(entity)
                    if poly:
                        c = poly.centroid
                        exits.append({
                            'center': {'x': c.x, 'y': c.y},
                            'area': poly.area,
                            'layer': layer
                        })
        self.exits = exits
        return exits

    def detect_fire_doors(self) -> List[Dict]:
        """Detect fire doors / firewall intersections."""
        if not self.msp:
            return []
        fire_doors = []
        for entity in self.msp:
            layer = getattr(entity.dxf, 'layer', '')
            if self._matches(layer, self.FIRE_DOOR_PATTERNS):
                line = self._entity_to_line(entity)
                if line:
                    fire_doors.append({'start': line[0], 'end': line[1], 'layer': layer})
        self.fire_doors = fire_doors
        return fire_doors

    def validate_plan(self) -> bool:
        """Validate that we have at least an envelope."""
        return self.envelope is not None and self.envelope.area > 10

    def get_usable_area(self) -> Optional[Polygon]:
        """Compute the actual placeable area: envelope minus obstacles and forbidden zones."""
        if not self.envelope:
            return None
        usable = self.envelope
        for obs in self.obstacles:
            try:
                usable = usable.difference(obs.buffer(0.5))
            except Exception:
                pass
        for fz in self.forbidden_zones:
            try:
                usable = usable.difference(fz.buffer(0.3))
            except Exception:
                pass
        return usable

    def get_summary(self) -> Dict:
        return {
            'envelope_area': self.envelope.area if self.envelope else 0,
            'obstacle_count': len(self.obstacles),
            'forbidden_zone_count': len(self.forbidden_zones),
            'exit_count': len(self.exits),
            'fire_door_count': len(self.fire_doors),
            'valid': self.validate_plan()
        }
