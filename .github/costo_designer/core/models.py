from dataclasses import dataclass, field
from typing import List, Tuple

@dataclass
class Box:
    id: str
    type: str
    x: float
    y: float
    width: float
    height: float
    area: float
    zone: str = "default"
    row: int = 0

    @property
    def corners(self) -> List[Tuple[float, float]]:
        return [
            (self.x, self.y),
            (self.x + self.width, self.y),
            (self.x + self.width, self.y + self.height),
            (self.x, self.y + self.height)
        ]

@dataclass
class Corridor:
    id: str
    type: str
    corners: List[Tuple[float, float]]

@dataclass
class Solution:
    boxes: List[Box] = field(default_factory=list)
    corridors: List[Corridor] = field(default_factory=list)
