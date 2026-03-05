class EntityExtractor:
    def extract_polygons(self, entities):
        polygons = []
        for e in entities:
            # Handle LWPOLYLINE, POLYLINE
            if e.dxftype() in ['LWPOLYLINE', 'POLYLINE']:
                # ezdxf vertices are iterables
                points = []
                if e.dxftype() == 'LWPOLYLINE':
                    points = [(v[0], v[1]) for v in e.get_points()]
                else:
                    points = [(v.dxf.location.x, v.dxf.location.y) for v in e.vertices]
                polygons.append(points)
        return polygons
