class BoxCatalog:
    def __init__(self):
        self.templates = {}

    def define_template(self, name, min_area, max_area, width_range, depth_range, door_width, partition_type):
        """Create box template"""
        # S: 0-1m², M: 1-3m², L: 3-5m², XL: 5-10m²
        # Width constraints (min/max)
        # Depth constraints (min/max)
        # Aspect ratio limits
        # Module alignment (0.1m grid)
        pass

    def get_box_dimensions(self, target_area, max_width, rules):
        """Generate valid box dimensions"""
        # Try aspect ratios: [1.2, 1.5, 1.8, 2.0]
        # Apply rounding rules (0.5m² increments)
        # Validate against catalog constraints
        # Return width, depth, actual_area
        pass
