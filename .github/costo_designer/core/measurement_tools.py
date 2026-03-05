import math

class MeasurementTools:
    @staticmethod
    def distance(p1, p2):
        return math.hypot(p2[0] - p1[0], p2[1] - p1[1])

    @staticmethod
    def area(polygon_points):
        # Shoelace formula
        n = len(polygon_points)
        area = 0.0
        for i in range(n):
            j = (i + 1) % n
            area += polygon_points[i][0] * polygon_points[j][1]
            area -= polygon_points[j][0] * polygon_points[i][1]
        return abs(area) / 2.0
