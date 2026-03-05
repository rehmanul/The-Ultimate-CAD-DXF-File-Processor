from shapely.geometry import Polygon, LineString, Point
from typing import List, Tuple

class GeometryUtils:
    @staticmethod
    def calculate_area(points: List[Tuple[float, float]]) -> float:
        if len(points) < 3:
            return 0.0
        return Polygon(points).area

    @staticmethod
    def calculate_distance(p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
        return Point(p1).distance(Point(p2))

    @staticmethod
    def create_polygon(points: List[Tuple[float, float]]) -> Polygon:
        return Polygon(points)
