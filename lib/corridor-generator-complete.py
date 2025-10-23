# FloorPlan Pro - Advanced Corridor Generator
# Compatible with The Ultimate CAD DXF File Processor
# Generates comprehensive corridor networks with green arrow circulation flow

import json
import sys
import math
import random
from typing import List, Dict, Any, Tuple, Optional
import numpy as np

class FloorPlanCorridorGenerator:
    """
    Advanced corridor generator based on the CAD DXF processor architecture.
    Analyzes room layouts, ilot placements, and circulation patterns to generate
    optimal corridor networks with comprehensive green arrow visualization.
    
    Features:
    - Room cluster analysis and row detection
    - Multi-level corridor generation (main, connecting, access, vertical)
    - Comprehensive green arrow circulation flow mapping
    - Corridor network optimization and validation
    - Compatible with CAD DXF processor architecture
    - Supports custom corridor widths and spacing parameters
    """
    
    def __init__(self):
        self.corridor_width = 1.2  # Default corridor width in meters
        self.min_corridor_length = 2.0
        self.max_corridor_spacing = 8.0
        self.overlap_threshold = 0.6
        self.safety_margin = 0.5
        
    def analyze_floor_plan(self, floor_plan_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Analyze floor plan geometry to extract rooms, circulation zones, and constraints
        
        Args:
            floor_plan_data: Dictionary containing walls, rooms, entrances, forbidden_zones, bounds
            
        Returns:
            Dictionary with analyzed floor plan data including room centroids and circulation grid
        """
        try:
            # Extract basic components with safe defaults
            walls = floor_plan_data.get('walls', [])
            rooms = floor_plan_data.get('rooms', [])
            entrances = floor_plan_data.get('entrances', [])
            forbidden_zones = floor_plan_data.get('forbidden_zones', [])
            bounds = floor_plan_data.get('bounds', {'minX': 0, 'minY': 0, 'maxX': 100, 'maxY': 100})
            
            # Calculate room centroids and areas
            room_analysis = []
            for i, room in enumerate(rooms):
                try:
                    centroid = self._calculate_room_centroid(room)
                    area = room.get('area', 0) or self._calculate_polygon_area(room.get('polygon', []))
                    room_analysis.append({
                        'id': room.get('id', f'room_{i}'),
                        'centroid': centroid,
                        'area': area,
                        'bounds': self._get_room_bounds(room),
                        'type': room.get('type', 'office'),
                        'original': room
                    })
                except Exception as e:
                    print(f"Warning: Failed to analyze room {i}: {e}")
                    continue
            
            # Detect circulation zones (areas not occupied by rooms or forbidden zones)
            circulation_grid = self._create_circulation_grid(bounds, rooms, forbidden_zones, walls)
            
            return {
                'bounds': bounds,
                'rooms': room_analysis,
                'entrances': entrances,
                'walls': walls,
                'forbidden_zones': forbidden_zones,
                'circulation_grid': circulation_grid,
                'total_area': (bounds.get('maxX', 100) - bounds.get('minX', 0)) * (bounds.get('maxY', 100) - bounds.get('minY', 0))
            }
        except Exception as e:
            print(f"Error analyzing floor plan: {e}")
            return {
                'bounds': {'minX': 0, 'minY': 0, 'maxX': 100, 'maxY': 100},
                'rooms': [], 'entrances': [], 'walls': [], 'forbidden_zones': [],
                'circulation_grid': [], 'total_area': 10000
            }
    
    def generate_corridor_network(self, analysis: Dict[str, Any], options: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Generate comprehensive corridor network with multiple circulation paths
        
        Args:
            analysis: Output from analyze_floor_plan()
            options: Generation options including corridor_width, generate_arrows
            
        Returns:
            Dictionary with corridors, arrows, statistics, and metadata
        """
        if options is None:
            options = {}
            
        try:
            corridor_width = options.get('corridor_width', self.corridor_width)
            generate_arrows = options.get('generate_arrows', True)
            
            rooms = analysis.get('rooms', [])
            entrances = analysis.get('entrances', [])
            bounds = analysis.get('bounds', {'minX': 0, 'minY': 0, 'maxX': 100, 'maxY': 100})
            
            print(f"Generating corridors for {len(rooms)} rooms, {len(entrances)} entrances")
            
            corridors = []
            
            # Step 1: Identify room clusters and rows
            room_clusters = self._identify_room_clusters(rooms)
            room_rows = self._identify_room_rows(room_clusters)
            
            print(f"Found {len(room_clusters)} clusters, {len(room_rows)} rows")
            
            # Step 2: Generate main circulation corridors
            main_corridors = self._generate_main_corridors(room_rows, corridor_width, bounds)
            corridors.extend(main_corridors)
            
            # Step 2.5: Fallback to grid-based corridors if no main corridors
            if not main_corridors and rooms:
                grid_corridors = self._generate_grid_based_corridors(rooms, corridor_width, bounds)
                corridors.extend(grid_corridors)
                main_corridors = grid_corridors
                print(f"Generated {len(grid_corridors)} grid-based corridors as fallback")
            
            # Step 3: Generate connecting corridors
            connecting_corridors = self._generate_connecting_corridors(main_corridors, corridor_width)
            corridors.extend(connecting_corridors)
            
            # Step 4: Generate access corridors from entrances
            access_corridors = self._generate_access_corridors(entrances, corridors, corridor_width)
            corridors.extend(access_corridors)
            
            # Step 5: Generate vertical circulation paths
            vertical_corridors = self._generate_vertical_circulation(rooms, main_corridors, corridor_width)
            corridors.extend(vertical_corridors)
            
            # Step 6: Generate directional arrows for circulation flow
            corridor_arrows = []
            if generate_arrows and corridors:
                corridor_arrows = self._generate_corridor_arrows(corridors, entrances, rooms)
            
            # Step 7: Optimize and validate corridor network
            optimized_corridors = self._optimize_corridor_network(corridors)
            
            return {
                'corridors': optimized_corridors,
                'arrows': corridor_arrows,
                'statistics': {
                    'total_corridors': len(optimized_corridors),
                    'main_corridors': len(main_corridors),
                    'connecting_corridors': len(connecting_corridors),
                    'access_corridors': len(access_corridors),
                    'vertical_corridors': len(vertical_corridors),
                    'total_corridor_area': sum(c.get('area', 0) for c in optimized_corridors),
                    'average_width': corridor_width
                },
                'metadata': {
                    'generation_method': 'enhanced_circulation_analysis',
                    'room_clusters': len(room_clusters),
                    'room_rows': len(room_rows),
                    'options': options
                }
            }
        except Exception as e:
            print(f"Error generating corridor network: {e}")
            return {
                'corridors': [], 'arrows': [],
                'statistics': {'total_corridors': 0, 'total_corridor_area': 0},
                'metadata': {'error': str(e)}
            }
    
    def _identify_room_clusters(self, rooms: List[Dict]) -> List[List[Dict]]:
        """Group rooms into clusters based on proximity"""
        if not rooms:
            return []
            
        clusters = []
        visited = set()
        
        for room in rooms:
            if room['id'] in visited:
                continue
                
            cluster = []
            self._explore_cluster(room, rooms, cluster, visited, max_distance=10.0)
            if cluster:
                clusters.append(cluster)
        
        return clusters
    
    def _explore_cluster(self, room: Dict, all_rooms: List[Dict], cluster: List[Dict], 
                        visited: set, max_distance: float):
        """Recursively explore room cluster using proximity"""
        if room['id'] in visited:
            return
            
        visited.add(room['id'])
        cluster.append(room)
        
        room_center = room['centroid']
        for other_room in all_rooms:
            if other_room['id'] in visited:
                continue
                
            other_center = other_room['centroid']
            distance = math.sqrt(
                (room_center['x'] - other_center['x'])**2 + 
                (room_center['y'] - other_center['y'])**2
            )
            
            if distance <= max_distance:
                self._explore_cluster(other_room, all_rooms, cluster, visited, max_distance)
    
    def _identify_room_rows(self, clusters: List[List[Dict]]) -> List[List[Dict]]:
        """Identify horizontal rows of rooms within clusters"""
        rows = []
        
        for cluster in clusters:
            if len(cluster) < 2:
                continue
                
            # Sort rooms by Y coordinate
            sorted_rooms = sorted(cluster, key=lambda r: r['centroid']['y'])
            
            current_row = [sorted_rooms[0]]
            
            for room in sorted_rooms[1:]:
                room_y = room['centroid']['y']
                row_y = current_row[-1]['centroid']['y']
                
                # Use generous tolerance for row detection
                if abs(room_y - row_y) <= 8.0:
                    current_row.append(room)
                else:
                    if len(current_row) >= 2:
                        # Sort row by X coordinate
                        current_row.sort(key=lambda r: r['centroid']['x'])
                        rows.append(current_row)
                    current_row = [room]
            
            # Add final row if it has multiple rooms
            if len(current_row) >= 2:
                current_row.sort(key=lambda r: r['centroid']['x'])
                rows.append(current_row)
        
        return rows
    
    def _generate_main_corridors(self, room_rows: List[List[Dict]], 
                               corridor_width: float, bounds: Dict) -> List[Dict]:
        """Generate main horizontal corridors between room rows"""
        corridors = []
        
        for i in range(len(room_rows) - 1):
            row1 = room_rows[i]
            row2 = room_rows[i + 1]
            
            if self._rows_face_each_other(row1, row2):
                corridor = self._create_corridor_between_rows(row1, row2, corridor_width)
                if corridor:
                    corridor['id'] = f'main_corridor_{len(corridors)}'
                    corridor['type'] = 'main'
                    corridors.append(corridor)
        
        return corridors
    
    def _rows_face_each_other(self, row1: List[Dict], row2: List[Dict]) -> bool:
        """Check if two rows face each other and should have a corridor between them"""
        row1_y = sum(r['centroid']['y'] for r in row1) / len(row1)
        row2_y = sum(r['centroid']['y'] for r in row2) / len(row2)
        
        y_distance = abs(row1_y - row2_y)
        return 1.0 <= y_distance <= 15.0  # Generous distance range
    
    def _create_corridor_between_rows(self, row1: List[Dict], row2: List[Dict], 
                                    corridor_width: float) -> Optional[Dict]:
        """Create a corridor between two facing rows"""
        try:
            # Calculate bounds of each row
            row1_bounds = self._calculate_row_bounds(row1)
            row2_bounds = self._calculate_row_bounds(row2)
            
            # Find X overlap
            min_x = max(row1_bounds['minX'], row2_bounds['minX'])
            max_x = min(row1_bounds['maxX'], row2_bounds['maxX'])
            
            if min_x >= max_x:
                return None  # No horizontal overlap
            
            # Calculate vertical position
            gap = row2_bounds['minY'] - row1_bounds['maxY']
            
            if gap <= 0:
                # Rows overlap vertically - position corridor between centers
                corridor_y = (row1_bounds['maxY'] + row2_bounds['minY']) / 2 - corridor_width / 2
                corridor_height = corridor_width
            else:
                # Position corridor in the gap
                corridor_y = row1_bounds['maxY'] + self.safety_margin
                corridor_height = max(corridor_width, gap - 2 * self.safety_margin)
            
            return {
                'x': min_x,
                'y': corridor_y,
                'width': max_x - min_x,
                'height': corridor_height,
                'area': (max_x - min_x) * corridor_height,
                'direction': 'horizontal'
            }
        except Exception as e:
            print(f"Error creating corridor between rows: {e}")
            return None
    
    def _generate_grid_based_corridors(self, rooms: List[Dict], corridor_width: float, bounds: Dict) -> List[Dict]:
        """Fallback: Generate corridors based on a regular grid pattern"""
        corridors = []
        
        try:
            # Find the range of room positions
            room_x_coords = [r['centroid']['x'] for r in rooms]
            room_y_coords = [r['centroid']['y'] for r in rooms]
            
            min_x, max_x = min(room_x_coords), max(room_x_coords)
            min_y, max_y = min(room_y_coords), max(room_y_coords)
            
            # Create horizontal corridors at regular intervals
            y_positions = []
            for y in range(int(min_y), int(max_y) + 1, 10):  # Every 10m
                # Check if there are rooms near this Y level
                rooms_at_level = [r for r in rooms if abs(r['centroid']['y'] - y) <= 5]
                if len(rooms_at_level) >= 2:
                    y_positions.append(y)
            
            # Generate horizontal corridors
            for i, y_pos in enumerate(y_positions):
                corridor = {
                    'id': f'grid_horizontal_{i}',
                    'type': 'main',
                    'x': bounds.get('minX', 0) + 1,
                    'y': y_pos + 4,  # Offset to avoid overlapping rooms
                    'width': bounds.get('width', bounds.get('maxX', 100) - bounds.get('minX', 0)) - 2,
                    'height': corridor_width,
                    'area': (bounds.get('width', bounds.get('maxX', 100) - bounds.get('minX', 0)) - 2) * corridor_width,
                    'direction': 'horizontal'
                }
                corridors.append(corridor)
            
            # Create vertical spine corridor
            if corridors:
                spine_x = min_x - 3  # Position spine to the left of rooms
                spine = {
                    'id': 'grid_vertical_spine',
                    'type': 'main',
                    'x': spine_x,
                    'y': min_y - 2,
                    'width': corridor_width,
                    'height': max_y - min_y + 4,
                    'area': corridor_width * (max_y - min_y + 4),
                    'direction': 'vertical'
                }
                corridors.append(spine)
                
        except Exception as e:
            print(f"Error generating grid-based corridors: {e}")
        
        return corridors
    
    def _generate_connecting_corridors(self, main_corridors: List[Dict], 
                                     corridor_width: float) -> List[Dict]:
        """Generate perpendicular corridors connecting main corridors"""
        corridors = []
        
        try:
            for i in range(len(main_corridors) - 1):
                corridor1 = main_corridors[i]
                corridor2 = main_corridors[i + 1]
                
                connector = self._create_connecting_corridor(corridor1, corridor2, corridor_width)
                if connector:
                    connector['id'] = f'connecting_corridor_{len(corridors)}'
                    connector['type'] = 'connecting'
                    corridors.append(connector)
        except Exception as e:
            print(f"Error generating connecting corridors: {e}")
        
        return corridors
    
    def _create_connecting_corridor(self, corridor1: Dict, corridor2: Dict, 
                                  corridor_width: float) -> Optional[Dict]:
        """Create a connecting corridor between two main corridors"""
        try:
            # Find connection points (centers of corridors)
            center1 = {
                'x': corridor1['x'] + corridor1['width'] / 2,
                'y': corridor1['y'] + corridor1['height'] / 2
            }
            center2 = {
                'x': corridor2['x'] + corridor2['width'] / 2,
                'y': corridor2['y'] + corridor2['height'] / 2
            }
            
            # Create vertical connector if corridors are roughly aligned horizontally
            if abs(center1['x'] - center2['x']) < corridor_width * 2:
                return {
                    'x': center1['x'] - corridor_width / 2,
                    'y': min(center1['y'], center2['y']),
                    'width': corridor_width,
                    'height': abs(center1['y'] - center2['y']),
                    'area': corridor_width * abs(center1['y'] - center2['y']),
                    'direction': 'vertical'
                }
            else:
                # Create horizontal connector
                return {
                    'x': min(center1['x'], center2['x']),
                    'y': center1['y'] - corridor_width / 2,
                    'width': abs(center1['x'] - center2['x']),
                    'height': corridor_width,
                    'area': abs(center1['x'] - center2['x']) * corridor_width,
                    'direction': 'horizontal'
                }
        except Exception as e:
            print(f"Error creating connecting corridor: {e}")
            return None
    
    def _generate_access_corridors(self, entrances: List[Dict], existing_corridors: List[Dict], 
                                 corridor_width: float) -> List[Dict]:
        """Generate corridors connecting entrances to the main circulation network"""
        corridors = []
        
        try:
            for i, entrance in enumerate(entrances):
                entrance_center = self._get_entrance_center(entrance)
                if not entrance_center:
                    continue
                
                # Find nearest corridor
                nearest_corridor = self._find_nearest_corridor(entrance_center, existing_corridors)
                if not nearest_corridor:
                    continue
                
                access_corridor = self._create_access_corridor(entrance_center, nearest_corridor, corridor_width)
                if access_corridor:
                    access_corridor['id'] = f'access_corridor_{i}'
                    access_corridor['type'] = 'access'
                    corridors.append(access_corridor)
        except Exception as e:
            print(f"Error generating access corridors: {e}")
        
        return corridors
    
    def _generate_vertical_circulation(self, rooms: List[Dict], main_corridors: List[Dict], 
                                     corridor_width: float) -> List[Dict]:
        """Generate additional vertical circulation paths"""
        corridors = []
        
        try:
            # Create vertical spines connecting different areas
            if main_corridors:
                # Find leftmost and rightmost corridors
                leftmost = min(main_corridors, key=lambda c: c['x'])
                rightmost = max(main_corridors, key=lambda c: c['x'] + c['width'])
                
                # Create vertical spine on the left side
                left_spine = {
                    'id': 'vertical_spine_left',
                    'type': 'vertical_spine',
                    'x': leftmost['x'] - corridor_width - 1.0,
                    'y': leftmost['y'],
                    'width': corridor_width,
                    'height': (rightmost['y'] + rightmost['height']) - leftmost['y'],
                    'area': corridor_width * ((rightmost['y'] + rightmost['height']) - leftmost['y']),
                    'direction': 'vertical'
                }
                
                if left_spine['height'] > 5.0:  # Only add if significant length
                    corridors.append(left_spine)
        except Exception as e:
            print(f"Error generating vertical circulation: {e}")
        
        return corridors
    
    def _generate_corridor_arrows(self, corridors: List[Dict], entrances: List[Dict], 
                                rooms: List[Dict]) -> List[Dict]:
        """Generate directional arrows showing circulation flow throughout corridors"""
        arrows = []
        
        try:
            # Generate arrows for each corridor
            for corridor in corridors:
                corridor_arrows = self._generate_arrows_for_corridor(corridor, entrances, rooms)
                arrows.extend(corridor_arrows)
            
            # Generate connection arrows between corridors
            connection_arrows = self._generate_connection_arrows(corridors)
            arrows.extend(connection_arrows)
            
            # Generate entrance/exit flow arrows
            entrance_arrows = self._generate_entrance_flow_arrows(entrances, corridors)
            arrows.extend(entrance_arrows)
        except Exception as e:
            print(f"Error generating corridor arrows: {e}")
        
        return arrows
    
    def _generate_arrows_for_corridor(self, corridor: Dict, entrances: List[Dict], 
                                    rooms: List[Dict]) -> List[Dict]:
        """Generate arrows along a single corridor showing traffic flow"""
        arrows = []
        
        try:
            corridor_center = {
                'x': corridor['x'] + corridor['width'] / 2,
                'y': corridor['y'] + corridor['height'] / 2
            }
            
            # Determine primary flow direction based on corridor orientation
            if corridor.get('direction') == 'horizontal':
                # Horizontal corridor - arrows flow left-right
                num_arrows = max(3, int(corridor['width'] / 4.0))  # Arrow every 4m
                for i in range(num_arrows):
                    x = corridor['x'] + (corridor['width'] * (i + 0.5) / num_arrows)
                    y = corridor_center['y']
                    
                    # Bidirectional arrows for main circulation
                    arrows.append({
                        'x': x,
                        'y': y,
                        'direction': 'right',
                        'type': 'circulation',
                        'size': 'medium',
                        'color': 'green'
                    })
                    arrows.append({
                        'x': x,
                        'y': y + 0.3,
                        'direction': 'left',
                        'type': 'circulation',
                        'size': 'medium',
                        'color': 'green'
                    })
            else:
                # Vertical corridor - arrows flow up-down
                num_arrows = max(3, int(corridor['height'] / 4.0))
                for i in range(num_arrows):
                    x = corridor_center['x']
                    y = corridor['y'] + (corridor['height'] * (i + 0.5) / num_arrows)
                    
                    arrows.append({
                        'x': x,
                        'y': y,
                        'direction': 'up',
                        'type': 'circulation',
                        'size': 'medium',
                        'color': 'green'
                    })
                    arrows.append({
                        'x': x + 0.3,
                        'y': y,
                        'direction': 'down',
                        'type': 'circulation',
                        'size': 'medium',
                        'color': 'green'
                    })
        except Exception as e:
            print(f"Error generating arrows for corridor: {e}")
        
        return arrows
    
    def _generate_connection_arrows(self, corridors: List[Dict]) -> List[Dict]:
        """Generate arrows at corridor intersections"""
        arrows = []
        
        try:
            # Find intersections between corridors
            for i, corridor1 in enumerate(corridors):
                for j, corridor2 in enumerate(corridors[i+1:], i+1):
                    intersection = self._find_corridor_intersection(corridor1, corridor2)
                    if intersection:
                        # Add directional arrows at intersection
                        arrows.extend(self._create_intersection_arrows(intersection, corridor1, corridor2))
        except Exception as e:
            print(f"Error generating connection arrows: {e}")
        
        return arrows
    
    def _generate_entrance_flow_arrows(self, entrances: List[Dict], corridors: List[Dict]) -> List[Dict]:
        """Generate arrows showing flow from entrances into corridor network"""
        arrows = []
        
        try:
            for entrance in entrances:
                entrance_center = self._get_entrance_center(entrance)
                if not entrance_center:
                    continue
                
                # Find nearest corridor
                nearest_corridor = self._find_nearest_corridor(entrance_center, corridors)
                if not nearest_corridor:
                    continue
                
                # Create flow arrows from entrance to corridor
                flow_arrows = self._create_entrance_flow_path(entrance_center, nearest_corridor)
                arrows.extend(flow_arrows)
        except Exception as e:
            print(f"Error generating entrance flow arrows: {e}")
        
        return arrows
    
    def _create_entrance_flow_path(self, entrance_center: Dict, target_corridor: Dict) -> List[Dict]:
        """Create arrows showing flow path from entrance to corridor"""
        arrows = []
        
        try:
            target_center = {
                'x': target_corridor['x'] + target_corridor['width'] / 2,
                'y': target_corridor['y'] + target_corridor['height'] / 2
            }
            
            # Calculate direction vector
            dx = target_center['x'] - entrance_center['x']
            dy = target_center['y'] - entrance_center['y']
            distance = math.sqrt(dx**2 + dy**2)
            
            if distance > 0:
                # Normalize direction
                dx /= distance
                dy /= distance
                
                # Create arrows along the path
                num_arrows = max(2, int(distance / 3.0))  # Arrow every 3m
                for i in range(num_arrows):
                    t = (i + 0.5) / num_arrows
                    x = entrance_center['x'] + dx * distance * t
                    y = entrance_center['y'] + dy * distance * t
                    
                    # Determine arrow direction
                    if abs(dx) > abs(dy):
                        direction = 'right' if dx > 0 else 'left'
                    else:
                        direction = 'up' if dy > 0 else 'down'
                    
                    arrows.append({
                        'x': x,
                        'y': y,
                        'direction': direction,
                        'type': 'entrance_flow',
                        'size': 'large',
                        'color': 'bright_green'
                    })
        except Exception as e:
            print(f"Error creating entrance flow path: {e}")
        
        return arrows
    
    # Helper methods with error handling
    def _calculate_room_centroid(self, room: Dict) -> Dict:
        """Calculate centroid of room with fallback options"""
        try:
            if 'center' in room and room['center']:
                return room['center']
            
            if 'centroid' in room and room['centroid']:
                return room['centroid']
            
            if 'polygon' in room and room['polygon']:
                polygon = room['polygon']
                x_sum = sum(p[0] if isinstance(p, list) else p['x'] for p in polygon)
                y_sum = sum(p[1] if isinstance(p, list) else p['y'] for p in polygon)
                return {'x': x_sum / len(polygon), 'y': y_sum / len(polygon)}
            
            # Fallback to room position if available
            return {'x': room.get('x', 0), 'y': room.get('y', 0)}
        except Exception as e:
            print(f"Error calculating room centroid: {e}")
            return {'x': 0, 'y': 0}
    
    def _calculate_polygon_area(self, polygon: List) -> float:
        """Calculate area of polygon using shoelace formula"""
        if not polygon or len(polygon) < 3:
            return 0
        
        try:
            area = 0
            for i in range(len(polygon)):
                j = (i + 1) % len(polygon)
                p1 = polygon[i]
                p2 = polygon[j]
                
                x1 = p1[0] if isinstance(p1, list) else p1['x']
                y1 = p1[1] if isinstance(p1, list) else p1['y']
                x2 = p2[0] if isinstance(p2, list) else p2['x']
                y2 = p2[1] if isinstance(p2, list) else p2['y']
                
                area += x1 * y2 - x2 * y1
            
            return abs(area) / 2
        except Exception as e:
            print(f"Error calculating polygon area: {e}")
            return 0
    
    def _get_room_bounds(self, room: Dict) -> Dict:
        """Get bounding box of room with fallback"""
        try:
            if 'bounds' in room:
                return room['bounds']
            
            if 'polygon' in room and room['polygon']:
                polygon = room['polygon']
                x_coords = [p[0] if isinstance(p, list) else p['x'] for p in polygon]
                y_coords = [p[1] if isinstance(p, list) else p['y'] for p in polygon]
                
                return {
                    'minX': min(x_coords), 'maxX': max(x_coords),
                    'minY': min(y_coords), 'maxY': max(y_coords)
                }
            
            # Fallback bounds
            x = room.get('x', 0)
            y = room.get('y', 0)
            width = room.get('width', 5)
            height = room.get('height', 5)
            
            return {
                'minX': x, 'maxX': x + width,
                'minY': y, 'maxY': y + height
            }
        except Exception as e:
            print(f"Error getting room bounds: {e}")
            return {'minX': 0, 'maxX': 5, 'minY': 0, 'maxY': 5}
    
    def _create_circulation_grid(self, bounds: Dict, rooms: List[Dict], 
                               forbidden_zones: List[Dict], walls: List[Dict]) -> List[List[int]]:
        """Create a grid marking available circulation areas"""
        try:
            grid_resolution = 1.0  # 1m grid
            width = int((bounds.get('maxX', 100) - bounds.get('minX', 0)) / grid_resolution) + 1
            height = int((bounds.get('maxY', 100) - bounds.get('minY', 0)) / grid_resolution) + 1
            
            # Initialize grid as all available (0 = available, 1 = occupied)
            grid = [[0 for _ in range(width)] for _ in range(height)]
            
            # Mark rooms as occupied
            for room in rooms:
                room_bounds = self._get_room_bounds(room)
                self._mark_bounds_in_grid(grid, room_bounds, bounds, grid_resolution, 1)
            
            # Mark forbidden zones as occupied
            for zone in forbidden_zones:
                if 'polygon' in zone and zone['polygon']:
                    # For simplicity, use bounding box of polygon
                    x_coords = [p[0] if isinstance(p, list) else p['x'] for p in zone['polygon']]
                    y_coords = [p[1] if isinstance(p, list) else p['y'] for p in zone['polygon']]
                    zone_bounds = {
                        'minX': min(x_coords), 'maxX': max(x_coords),
                        'minY': min(y_coords), 'maxY': max(y_coords)
                    }
                    self._mark_bounds_in_grid(grid, zone_bounds, bounds, grid_resolution, 1)
            
            return grid
        except Exception as e:
            print(f"Error creating circulation grid: {e}")
            return [[0]]
    
    def _mark_bounds_in_grid(self, grid: List[List[int]], bounds: Dict, 
                           floor_bounds: Dict, resolution: float, value: int):
        """Mark rectangular bounds in grid with error handling"""
        try:
            start_x = int((bounds['minX'] - floor_bounds.get('minX', 0)) / resolution)
            end_x = int((bounds['maxX'] - floor_bounds.get('minX', 0)) / resolution)
            start_y = int((bounds['minY'] - floor_bounds.get('minY', 0)) / resolution)
            end_y = int((bounds['maxY'] - floor_bounds.get('minY', 0)) / resolution)
            
            for y in range(max(0, start_y), min(len(grid), end_y + 1)):
                for x in range(max(0, start_x), min(len(grid[0]) if grid else 0, end_x + 1)):
                    grid[y][x] = value
        except Exception as e:
            print(f"Error marking bounds in grid: {e}")
    
    def _calculate_row_bounds(self, row: List[Dict]) -> Dict:
        """Calculate bounding box of a row of rooms"""
        try:
            all_bounds = [self._get_room_bounds(room) for room in row]
            
            return {
                'minX': min(b['minX'] for b in all_bounds),
                'maxX': max(b['maxX'] for b in all_bounds),
                'minY': min(b['minY'] for b in all_bounds),
                'maxY': max(b['maxY'] for b in all_bounds)
            }
        except Exception as e:
            print(f"Error calculating row bounds: {e}")
            return {'minX': 0, 'maxX': 10, 'minY': 0, 'maxY': 10}
    
    def _get_entrance_center(self, entrance: Dict) -> Optional[Dict]:
        """Get center point of entrance"""
        try:
            if 'center' in entrance:
                return entrance['center']
            
            if 'start' in entrance and 'end' in entrance:
                return {
                    'x': (entrance['start']['x'] + entrance['end']['x']) / 2,
                    'y': (entrance['start']['y'] + entrance['end']['y']) / 2
                }
            
            if 'polygon' in entrance and entrance['polygon']:
                polygon = entrance['polygon']
                x_sum = sum(p[0] if isinstance(p, list) else p['x'] for p in polygon)
                y_sum = sum(p[1] if isinstance(p, list) else p['y'] for p in polygon)
                return {'x': x_sum / len(polygon), 'y': y_sum / len(polygon)}
            
            return None
        except Exception as e:
            print(f"Error getting entrance center: {e}")
            return None
    
    def _find_nearest_corridor(self, point: Dict, corridors: List[Dict]) -> Optional[Dict]:
        """Find the nearest corridor to a point"""
        if not corridors:
            return None
        
        try:
            min_distance = float('inf')
            nearest = None
            
            for corridor in corridors:
                center = {
                    'x': corridor['x'] + corridor['width'] / 2,
                    'y': corridor['y'] + corridor['height'] / 2
                }
                
                distance = math.sqrt(
                    (point['x'] - center['x'])**2 + (point['y'] - center['y'])**2
                )
                
                if distance < min_distance:
                    min_distance = distance
                    nearest = corridor
            
            return nearest
        except Exception as e:
            print(f"Error finding nearest corridor: {e}")
            return None
    
    def _create_access_corridor(self, entrance_center: Dict, target_corridor: Dict, 
                              corridor_width: float) -> Dict:
        """Create access corridor from entrance to target corridor"""
        try:
            target_center = {
                'x': target_corridor['x'] + target_corridor['width'] / 2,
                'y': target_corridor['y'] + target_corridor['height'] / 2
            }
            
            # Create straight corridor from entrance to target
            min_x = min(entrance_center['x'], target_center['x'])
            max_x = max(entrance_center['x'], target_center['x'])
            min_y = min(entrance_center['y'], target_center['y'])
            max_y = max(entrance_center['y'], target_center['y'])
            
            # Determine if corridor should be horizontal or vertical based on distance
            dx = abs(entrance_center['x'] - target_center['x'])
            dy = abs(entrance_center['y'] - target_center['y'])
            
            if dx > dy:  # More horizontal distance
                return {
                    'x': min_x,
                    'y': entrance_center['y'] - corridor_width / 2,
                    'width': dx,
                    'height': corridor_width,
                    'area': dx * corridor_width,
                    'direction': 'horizontal'
                }
            else:  # More vertical distance
                return {
                    'x': entrance_center['x'] - corridor_width / 2,
                    'y': min_y,
                    'width': corridor_width,
                    'height': dy,
                    'area': corridor_width * dy,
                    'direction': 'vertical'
                }
        except Exception as e:
            print(f"Error creating access corridor: {e}")
            return {
                'x': 0, 'y': 0, 'width': corridor_width, 'height': corridor_width,
                'area': corridor_width * corridor_width, 'direction': 'horizontal'
            }
    
    def _find_corridor_intersection(self, corridor1: Dict, corridor2: Dict) -> Optional[Dict]:
        """Find intersection point between two corridors"""
        try:
            # Simple rectangle intersection check
            x1_min, x1_max = corridor1['x'], corridor1['x'] + corridor1['width']
            y1_min, y1_max = corridor1['y'], corridor1['y'] + corridor1['height']
            x2_min, x2_max = corridor2['x'], corridor2['x'] + corridor2['width']
            y2_min, y2_max = corridor2['y'], corridor2['y'] + corridor2['height']
            
            # Check if rectangles overlap
            if (x1_max > x2_min and x2_max > x1_min and y1_max > y2_min and y2_max > y1_min):
                # Calculate intersection center
                inter_x = (max(x1_min, x2_min) + min(x1_max, x2_max)) / 2
                inter_y = (max(y1_min, y2_min) + min(y1_max, y2_max)) / 2
                
                return {'x': inter_x, 'y': inter_y}
            
            return None
        except Exception as e:
            print(f"Error finding corridor intersection: {e}")
            return None
    
    def _create_intersection_arrows(self, intersection: Dict, corridor1: Dict, 
                                  corridor2: Dict) -> List[Dict]:
        """Create directional arrows at corridor intersection"""
        arrows = []
        
        try:
            # Add arrows pointing in all four directions from intersection
            directions = ['up', 'down', 'left', 'right']
            for i, direction in enumerate(directions):
                offset_x = 0.5 * (i % 2) * (1 if i > 1 else -1)
                offset_y = 0.5 * ((i + 1) % 2) * (1 if i < 2 else -1)
                
                arrows.append({
                    'x': intersection['x'] + offset_x,
                    'y': intersection['y'] + offset_y,
                    'direction': direction,
                    'type': 'intersection',
                    'size': 'small',
                    'color': 'green'
                })
        except Exception as e:
            print(f"Error creating intersection arrows: {e}")
        
        return arrows
    
    def _optimize_corridor_network(self, corridors: List[Dict]) -> List[Dict]:
        """Optimize corridor network by removing redundancies and merging adjacent corridors"""
        if not corridors:
            return []
        
        try:
            optimized = []
            
            # Remove very small or invalid corridors
            for corridor in corridors:
                area = corridor.get('area', 0)
                if area > 2.0:  # Minimum 2m² corridor area
                    optimized.append(corridor)
            
            # Merge adjacent corridors (simplified version)
            merged = []
            used = set()
            
            for i, corridor in enumerate(optimized):
                if i in used:
                    continue
                    
                current = corridor.copy()
                used.add(i)
                
                # Look for adjacent corridors to merge
                for j, other in enumerate(optimized[i+1:], i+1):
                    if j in used:
                        continue
                    
                    if self._can_merge_corridors(current, other):
                        current = self._merge_corridors(current, other)
                        used.add(j)
                
                merged.append(current)
            
            return merged
        except Exception as e:
            print(f"Error optimizing corridor network: {e}")
            return corridors
    
    def _can_merge_corridors(self, corridor1: Dict, corridor2: Dict) -> bool:
        """Check if two corridors can be merged"""
        try:
            # Simple adjacency check - corridors should be aligned and touching
            tolerance = 0.1
            
            # Check for horizontal alignment and adjacency
            if (abs(corridor1['y'] - corridor2['y']) < tolerance and 
                abs(corridor1['height'] - corridor2['height']) < tolerance):
                # Check if they're adjacent horizontally
                return (abs(corridor1['x'] + corridor1['width'] - corridor2['x']) < tolerance or
                       abs(corridor2['x'] + corridor2['width'] - corridor1['x']) < tolerance)
            
            # Check for vertical alignment and adjacency
            if (abs(corridor1['x'] - corridor2['x']) < tolerance and 
                abs(corridor1['width'] - corridor2['width']) < tolerance):
                # Check if they're adjacent vertically
                return (abs(corridor1['y'] + corridor1['height'] - corridor2['y']) < tolerance or
                       abs(corridor2['y'] + corridor2['height'] - corridor1['y']) < tolerance)
            
            return False
        except Exception as e:
            print(f"Error checking if corridors can merge: {e}")
            return False
    
    def _merge_corridors(self, corridor1: Dict, corridor2: Dict) -> Dict:
        """Merge two adjacent corridors into one"""
        try:
            min_x = min(corridor1['x'], corridor2['x'])
            min_y = min(corridor1['y'], corridor2['y'])
            max_x = max(corridor1['x'] + corridor1['width'], corridor2['x'] + corridor2['width'])
            max_y = max(corridor1['y'] + corridor1['height'], corridor2['y'] + corridor2['height'])
            
            return {
                'id': f"merged_{corridor1.get('id', 'unknown')}_{corridor2.get('id', 'unknown')}",
                'type': corridor1.get('type', 'merged'),
                'x': min_x,
                'y': min_y,
                'width': max_x - min_x,
                'height': max_y - min_y,
                'area': (max_x - min_x) * (max_y - min_y),
                'direction': corridor1.get('direction', 'horizontal')
            }
        except Exception as e:
            print(f"Error merging corridors: {e}")
            return corridor1

# Export function for easy integration
def generate_corridors_for_floor_plan(floor_plan_data, options=None):
    """
    Main entry point for corridor generation.
    
    Args:
        floor_plan_data: Dictionary with rooms, entrances, walls, forbidden_zones, bounds
        options: Optional dictionary with corridor_width, generate_arrows, etc.
    
    Returns:
        Dictionary with corridors, arrows, statistics, and metadata
    """
    generator = FloorPlanCorridorGenerator()
    analysis = generator.analyze_floor_plan(floor_plan_data)
    return generator.generate_corridor_network(analysis, options)

def main():
    """
    Entry point for command-line usage. Expects JSON on stdin with:
    {
        "floor_plan": {...},
        "options": {...}
    }
    """
    try:
        raw_input = sys.stdin.read()
        if not raw_input or not raw_input.strip():
            raise ValueError('No input provided for corridor generation')

        input_data = json.loads(raw_input)
        floor_plan_data = input_data.get('floor_plan')
        if floor_plan_data is None:
            raise ValueError('Input JSON must include "floor_plan" data')

        options = input_data.get('options') or {}

        original_stdout = sys.stdout
        try:
            # Redirect diagnostic prints to stderr so stdout remains pure JSON
            sys.stdout = sys.stderr
            result = generate_corridors_for_floor_plan(floor_plan_data, options)
        finally:
            sys.stdout = original_stdout

        sys.stdout.write(json.dumps(result) + '\n')
    except Exception as exc:
        error_result = {
            'success': False,
            'corridors': [],
            'arrows': [],
            'statistics': {'total_corridors': 0, 'total_corridor_area': 0},
            'metadata': {},
            'error': str(exc)
        }
        sys.stdout.write(json.dumps(error_result) + '\n')
    finally:
        try:
            sys.stdout.flush()
        except Exception:
            pass


if __name__ == "__main__":
    main()
