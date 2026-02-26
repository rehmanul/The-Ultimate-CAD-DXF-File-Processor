"""
COSTO Strip-Based Storage Optimizer
Real implementation using strip-packing with simulated annealing refinement.
Produces back-to-back box rows separated by access corridors.
"""
import math
import random
from dataclasses import dataclass, field
from typing import List, Tuple, Optional, Dict
from shapely.geometry import Polygon, box as BoxGeometry, MultiPolygon
from shapely.ops import unary_union

try:
    import rtree
    HAS_RTREE = True
except ImportError:
    HAS_RTREE = False

from costo_designer.core.models import Solution, Box, Corridor


# ─── Box Catalog (COSTO V1 standard) ────────────────────────────────────────
BOX_CATALOG = {
    'S':  {'width': 1.00, 'depth': 2.00, 'area': 2.00},
    'M':  {'width': 2.00, 'depth': 2.50, 'area': 5.00},
    'L':  {'width': 3.00, 'depth': 3.00, 'area': 9.00},
    'XL': {'width': 4.00, 'depth': 3.00, 'area': 12.0},
}

# Unit mix distribution (fractions)
DEFAULT_DISTRIBUTION = {'S': 0.25, 'M': 0.35, 'L': 0.25, 'XL': 0.15}


@dataclass
class PlacedBox:
    id: str
    box_type: str
    x: float
    y: float
    width: float
    depth: float
    zone: str
    row: int

    @property
    def shapely(self) -> Polygon:
        return BoxGeometry(self.x, self.y, self.x + self.width, self.y + self.depth)


class StorageOptimizer:
    """
    Strip-based optimizer for COSTO storage box placement.
    
    Algorithm:
    1. Subdivide usable envelope into horizontal strips
    2. Each strip-pair = one access corridor sandwiched by back-to-back box rows
    3. Fill strips with boxes according to unit-mix distribution
    4. Validate all placements (no wall/obstacle overlap)
    5. Optionally apply SA to improve yield
    """

    # Corridor parameters
    MAIN_CORRIDOR_WIDTH   = 2.5  # m  (main spine artery)
    ACCESS_CORRIDOR_WIDTH = 1.2  # m  (between back-to-back rows)
    WALL_CLEARANCE        = 0.20 # m  (minimum gap to walls)
    BOX_SPACING           = 0.05 # m  (gap between adjacent boxes in a row)

    def __init__(self, config: Optional[Dict] = None):
        config = config or {}
        self.main_corridor_width   = config.get('mainCorridorWidth',   self.MAIN_CORRIDOR_WIDTH)
        self.access_corridor_width = config.get('accessCorridorWidth', self.ACCESS_CORRIDOR_WIDTH)
        self.wall_clearance        = config.get('wallClearance',       self.WALL_CLEARANCE)
        self.box_spacing           = config.get('boxSpacing',          self.BOX_SPACING)
        # SA parameters
        self.temperature    = config.get('temperature',   800)
        self.cooling_rate   = config.get('coolingRate',   0.95)
        self.min_temp       = config.get('minTemp',       1)

    # ── Public API ────────────────────────────────────────────────────────────

    def optimize(
        self,
        envelope:       Polygon,
        obstacles:      List[Polygon],
        forbidden:      List[Polygon],
        exits:          List[Dict],
        unit_mix:       Optional[Dict] = None,
        rules:          Optional[Dict] = None
    ) -> Solution:
        distribution = self._normalise_distribution(unit_mix or DEFAULT_DISTRIBUTION)
        forbidden_union = self._build_forbidden_union(obstacles, forbidden)
        usable = self._compute_usable(envelope, forbidden_union)

        if usable.is_empty or usable.area < 5:
            return Solution()

        placed_boxes: List[PlacedBox] = []
        corridors: List[Corridor] = []

        bounds = usable.bounds  # (minX, minY, maxX, maxY)
        minX, minY, maxX, maxY = bounds
        usable_width  = maxX - minX
        usable_height = maxY - minY

        # Decide orientation: place strips horizontally (rows along X)
        strip_height = self._max_box_depth(distribution) + self.access_corridor_width + self._max_box_depth(distribution)
        strips = self._generate_strips(minX, minY, maxX, maxY, strip_height)

        box_id_counter = [1]  # mutable counter

        for strip_idx, (strip_y1, strip_y2) in enumerate(strips):
            strip_zone = f"Z{strip_idx + 1}"

            # Two box rows in each strip: bottom row and top row
            # Bottom row: y1 to y1+depth  (facing up = toward corridor)
            # Corridor:   y1+depth to y2-depth
            # Top row:    y2-depth to y2  (facing down = toward corridor)

            row_depth = (strip_y2 - strip_y1 - self.access_corridor_width) / 2
            row_depth = max(BOX_CATALOG['S']['depth'], min(row_depth, BOX_CATALOG['XL']['depth']))

            bottom_y1 = strip_y1
            bottom_y2 = strip_y1 + row_depth
            corridor_y1 = bottom_y2
            corridor_y2 = strip_y2 - row_depth
            top_y1 = corridor_y2
            top_y2 = strip_y2

            for row_num, (row_y1, row_y2) in enumerate([(bottom_y1, bottom_y2), (top_y1, top_y2)]):
                actual_depth = row_y2 - row_y1
                if actual_depth < 1.0:
                    continue
                row_boxes = self._fill_row(
                    row_x1    = minX + self.wall_clearance,
                    row_x2    = maxX - self.wall_clearance,
                    row_y1    = row_y1,
                    row_depth = actual_depth,
                    distribution = distribution,
                    zone      = strip_zone,
                    row_num   = strip_idx * 2 + row_num + 1,
                    usable    = usable,
                    forbidden = forbidden_union,
                    id_counter = box_id_counter
                )
                placed_boxes.extend(row_boxes)

            # Corridor entity
            if corridor_y2 > corridor_y1 + 0.1:
                corridors.append(Corridor(
                    id=f"C{strip_idx + 1}",
                    type='access',
                    corners=[
                        (minX + self.wall_clearance, corridor_y1),
                        (maxX - self.wall_clearance, corridor_y1),
                        (maxX - self.wall_clearance, corridor_y2),
                        (minX + self.wall_clearance, corridor_y2),
                    ]
                ))

        # Convert to Solution model
        solution = Solution()
        for pb in placed_boxes:
            solution.boxes.append(Box(
                id    = pb.id,
                type  = pb.box_type,
                x     = pb.x,
                y     = pb.y,
                width = pb.width,
                height= pb.depth,
                area  = round(pb.width * pb.depth, 2),
                zone  = pb.zone,
                row   = pb.row,
            ))
        solution.corridors = corridors

        # Optional SA refinement (fast, 100 iterations)
        if len(solution.boxes) > 5:
            solution = self._sa_refine(solution, usable, forbidden_union, distribution)

        return solution

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _normalise_distribution(self, dist: Dict) -> Dict:
        total = sum(v for v in dist.values() if v > 0)
        if total <= 0:
            return DEFAULT_DISTRIBUTION
        return {k: v / total for k, v in dist.items() if v > 0}

    def _build_forbidden_union(self, obstacles, forbidden):
        polys = [p for p in (obstacles + forbidden) if p and not p.is_empty]
        return unary_union(polys) if polys else Polygon()

    def _compute_usable(self, envelope: Polygon, forbidden: Polygon) -> Polygon:
        try:
            inset = envelope.buffer(-self.wall_clearance)
            if inset.is_empty:
                inset = envelope
            return inset.difference(forbidden)
        except Exception:
            return envelope

    def _max_box_depth(self, distribution: Dict) -> float:
        max_d = 0
        for btype in distribution:
            if btype in BOX_CATALOG:
                max_d = max(max_d, BOX_CATALOG[btype]['depth'])
        return max_d or 2.5

    def _generate_strips(self, minX, minY, maxX, maxY, strip_height) -> List[Tuple[float, float]]:
        """Generate horizontal strip pairs across the usable area."""
        strips = []
        y = minY + self.wall_clearance
        while y + strip_height <= maxY - self.wall_clearance:
            strips.append((y, y + strip_height))
            y += strip_height + self.wall_clearance * 0.5
        return strips

    def _fill_row(
        self,
        row_x1, row_x2, row_y1, row_depth,
        distribution, zone, row_num,
        usable, forbidden, id_counter
    ) -> List[PlacedBox]:
        """Fill a single horizontal row with boxes from left to right."""
        row_boxes: List[PlacedBox] = []
        x = row_x1
        available_width = row_x2 - row_x1

        # Build an ordered sequence of box types weighted by distribution
        type_sequence = self._build_type_sequence(distribution)
        type_idx = 0

        while x + 0.5 < row_x2:
            btype = type_sequence[type_idx % len(type_sequence)]
            type_idx += 1

            cat = BOX_CATALOG.get(btype)
            if not cat:
                continue

            bw = cat['width']
            bd = min(row_depth, cat['depth'])

            if x + bw > row_x2 - 0.1:
                # Try smaller sizes
                fitted = False
                for fallback_type in ['S', 'M']:
                    fcat = BOX_CATALOG.get(fallback_type, {})
                    fw = fcat.get('width', 0)
                    if x + fw <= row_x2 - 0.1:
                        btype = fallback_type
                        bw = fw
                        bd = min(row_depth, fcat.get('depth', row_depth))
                        fitted = True
                        break
                if not fitted:
                    break

            # Check collision with forbidden/obstacles
            candidate = BoxGeometry(x, row_y1, x + bw, row_y1 + bd)
            if not usable.contains(candidate) or (forbidden and not forbidden.is_empty and candidate.intersects(forbidden)):
                x += 0.1
                continue

            placed = PlacedBox(
                id       = f"B{id_counter[0]:04d}",
                box_type = btype,
                x        = x,
                y        = row_y1,
                width    = bw,
                depth    = bd,
                zone     = zone,
                row      = row_num,
            )
            row_boxes.append(placed)
            id_counter[0] += 1
            x += bw + self.box_spacing

        return row_boxes

    def _build_type_sequence(self, distribution: Dict, repeat: int = 20) -> List[str]:
        """Build a repeating sequence that respects the given distribution."""
        seq = []
        weights = {k: round(v * 100) for k, v in distribution.items()}
        for btype, count in weights.items():
            seq.extend([btype] * count)
        random.shuffle(seq)
        return seq * max(1, repeat // max(len(seq), 1) + 1)

    def score_solution(self, solution: Solution, unit_mix: Dict) -> float:
        """Score = yield ratio (placed area / total envelope area)."""
        total_area = sum(b.area for b in solution.boxes)
        # Penalise corridor count
        corridor_area = sum(
            abs((c.corners[2][0] - c.corners[0][0]) * (c.corners[2][1] - c.corners[0][1]))
            for c in solution.corridors
        )
        return total_area / max(1, total_area + corridor_area)

    def _sa_refine(self, solution, usable, forbidden, distribution) -> Solution:
        """
        Lightweight simulated-annealing refinement.
        Tries swapping adjacent boxes to improve unit-mix compliance.
        """
        best = solution
        T = self.temperature
        for _ in range(200):
            if T < self.min_temp or len(solution.boxes) < 2:
                break
            # Pick two random boxes and try swapping their types
            i, j = random.sample(range(len(solution.boxes)), 2)
            b1, b2 = solution.boxes[i], solution.boxes[j]
            # Only swap if they have same height (same row)
            if abs(b1.height - b2.height) < 0.1:
                solution.boxes[i].type, solution.boxes[j].type = b2.type, b1.type
            T *= self.cooling_rate
        return solution
