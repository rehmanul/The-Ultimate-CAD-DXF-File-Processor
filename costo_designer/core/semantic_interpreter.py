from shapely.geometry import Polygon

class SemanticLayerInterpreter:
    def __init__(self, dxf_doc):
        self.dxf_doc = dxf_doc
        self.envelope = []
        self.obstacles = []
        self.forbidden_zones = []
        self.exits = []
        self.fire_doors = []

    def detect_envelope(self, layer_mapping=None):
        """Extract usable perimeter from LWPOLYLINE/POLYLINE entities"""
        # Mock return
        return Polygon([(0,0), (100,0), (100,50), (0,50)])

    def detect_obstacles(self):
        return []

    def detect_forbidden_zones(self):
        return []

    def detect_exits(self):
        return []

    def validate_plan(self):
        return True
