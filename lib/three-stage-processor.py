# 3-Stage Floor Plan Processor - Complete Integration
# Transforms floor plans through: Empty Plan → Ilot Placement → Corridor Generation
# Matches your reference images exactly

import json
import math
from typing import Dict, List, Any, Tuple, Optional

class ThreeStageFloorPlanProcessor:
    """
    Complete 3-stage processor matching your workflow:
    
    Stage 1: Empty Floor Plan Analysis
    - Clean architectural layout with room measurements
    - Room geometry analysis and area calculations
    - Entrance and forbidden zone identification
    
    Stage 2: Intelligent Ilot Placement
    - Strategic workspace island positioning
    - Size distribution optimization
    - Room-based placement algorithm
    
    Stage 3: Comprehensive Corridor Generation
    - Red circulation network creation
    - Flow path optimization between ilots
    - Access corridor generation from entrances
    """
    
    def __init__(self):
        self.default_ilot_distribution = {
            '1-3': 0.30,    # 30% small workstations
            '3-5': 0.40,    # 40% medium team areas
            '5-10': 0.25,   # 25% large collaboration zones
            '10-15': 0.05   # 5% conference areas
        }
        
    def process_stage1_empty_plan(self, floor_plan_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Stage 1: Process empty architectural floor plan
        Input: Raw CAD data with rooms, walls, entrances
        Output: Clean analyzed layout with measurements
        """
        print("📐 Stage 1: Analyzing Empty Floor Plan...")
        
        # Extract floor plan components
        rooms = floor_plan_data.get('rooms', [])
        walls = floor_plan_data.get('walls', [])
        entrances = floor_plan_data.get('entrances', [])
        forbidden_zones = floor_plan_data.get('forbidden_zones', [])
        bounds = floor_plan_data.get('bounds', {'minX': 0, 'minY': 0, 'maxX': 100, 'maxY': 100})
        
        # Analyze each room
        analyzed_rooms = []
        total_room_area = 0
        
        for i, room in enumerate(rooms):
            analyzed_room = self._analyze_individual_room(room, i)
            analyzed_rooms.append(analyzed_room)
            total_room_area += analyzed_room['area']
        
        # Calculate floor metrics
        floor_area = (bounds['maxX'] - bounds['minX']) * (bounds['maxY'] - bounds['minY'])
        available_space = floor_area - total_room_area
        
        stage1_result = {
            'stage': 1,
            'type': 'empty_plan_analysis',
            'rooms': analyzed_rooms,
            'walls': walls,
            'entrances': entrances,
            'forbidden_zones': forbidden_zones,
            'bounds': bounds,
            'metrics': {
                'total_floor_area': floor_area,
                'room_area': total_room_area,
                'available_space': available_space,
                'room_count': len(analyzed_rooms),
                'space_efficiency': total_room_area / floor_area if floor_area > 0 else 0
            },
            'visualization': {
                'show_measurements': True,
                'show_room_areas': True,
                'highlight_entrances': True,
                'color_scheme': 'architectural_clean'
            }
        }
        
        print(f"✅ Stage 1 Complete: {len(analyzed_rooms)} rooms analyzed, {available_space:.1f}m² available")
        return stage1_result
        
    def process_stage2_ilot_placement(self, stage1_result: Dict[str, Any], 
                                     options: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Stage 2: Place workspace ilots strategically
        Input: Analyzed floor plan from Stage 1
        Output: Floor plan with positioned ilots (red rectangles)
        """
        print("🏢 Stage 2: Placing Workspace Ilots...")
        
        if options is None:
            options = {}
            
        # Get placement parameters
        distribution = options.get('ilot_distribution', self.default_ilot_distribution)
        target_coverage = options.get('coverage_ratio', 0.25)  # 25% of room space
        
        # Calculate target ilot area
        room_area = stage1_result['metrics']['room_area']
        target_ilot_area = room_area * target_coverage
        
        # Generate ilots by size distribution
        generated_ilots = self._generate_ilots_by_distribution(distribution, target_ilot_area)
        
        # Place ilots in suitable rooms
        placed_ilots = self._place_ilots_optimally(generated_ilots, stage1_result['rooms'])
        
        # Calculate placement statistics
        total_placed_area = sum(ilot['area'] for ilot in placed_ilots)
        coverage_achieved = total_placed_area / room_area if room_area > 0 else 0
        
        stage2_result = {
            'stage': 2,
            'type': 'ilot_placement',
            'ilots': placed_ilots,
            'base_layout': stage1_result,  # Preserve Stage 1 data
            'placement_stats': {
                'total_ilots': len(placed_ilots),
                'placed_area': total_placed_area,
                'target_area': target_ilot_area,
                'coverage_achieved': coverage_achieved,
                'placement_success_rate': len(placed_ilots) / len(generated_ilots) if generated_ilots else 0
            },
            'visualization': {
                'show_rooms': True,
                'show_measurements': True,
                'highlight_ilots': True,
                'ilot_color': 'red',
                'ilot_outline': True
            }
        }
        
        print(f"✅ Stage 2 Complete: {len(placed_ilots)} ilots placed ({total_placed_area:.1f}m²)")
        return stage2_result
        
    def process_stage3_corridor_generation(self, stage2_result: Dict[str, Any], 
                                         options: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Stage 3: Generate comprehensive corridor network
        Input: Floor plan with placed ilots from Stage 2
        Output: Complete layout with red circulation corridors
        """
        print("🛤️  Stage 3: Generating Circulation Network...")
        
        if options is None:
            options = {}
            
        corridor_width = options.get('corridor_width', 1.2)
        
        ilots = stage2_result['ilots']
        base_layout = stage2_result['base_layout']
        rooms = base_layout['rooms']
        entrances = base_layout['entrances']
        bounds = base_layout['bounds']
        
        # Generate different corridor types
        corridors = []
        
        # 1. Main circulation spines
        main_corridors = self._generate_main_spines(rooms, ilots, bounds, corridor_width)
        corridors.extend(main_corridors)
        
        # 2. Inter-room corridors
        room_corridors = self._generate_inter_room_corridors(rooms, corridor_width)
        corridors.extend(room_corridors)
        
        # 3. Ilot access corridors
        ilot_corridors = self._generate_ilot_access_corridors(ilots, corridors, corridor_width)
        corridors.extend(ilot_corridors)
        
        # 4. Entrance access paths
        entrance_corridors = self._generate_entrance_access_paths(entrances, corridors, corridor_width)
        corridors.extend(entrance_corridors)
        
        # Generate circulation flow indicators (red arrows/lines)
        flow_indicators = self._generate_circulation_flow(corridors, entrances, ilots)
        
        # Calculate corridor network statistics
        total_corridor_area = sum(c['area'] for c in corridors)
        
        stage3_result = {
            'stage': 3,
            'type': 'complete_layout',
            'corridors': corridors,
            'flow_indicators': flow_indicators,
            'ilot_layout': stage2_result,  # Preserve Stage 2 data
            'corridor_stats': {
                'total_corridors': len(corridors),
                'main_spines': len(main_corridors),
                'room_corridors': len(room_corridors),
                'ilot_corridors': len(ilot_corridors),
                'entrance_corridors': len(entrance_corridors),
                'total_area': total_corridor_area,
                'flow_indicators': len(flow_indicators)
            },
            'visualization': {
                'show_all_layers': True,
                'corridor_color': 'red',
                'corridor_opacity': 0.7,
                'show_flow_arrows': True,
                'arrow_color': 'red'
            }
        }
        
        print(f"✅ Stage 3 Complete: {len(corridors)} corridors, {len(flow_indicators)} flow indicators")
        return stage3_result
    
    def process_complete_workflow(self, floor_plan_data: Dict[str, Any], 
                                options: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Complete 3-stage processing workflow
        Returns all stages for progressive visualization
        """
        print("🚀 Starting 3-Stage Floor Plan Processing")
        print("=" * 50)
        
        if options is None:
            options = {}
        
        # Stage 1: Empty Plan Analysis
        stage1 = self.process_stage1_empty_plan(floor_plan_data)
        
        # Stage 2: Ilot Placement
        stage2 = self.process_stage2_ilot_placement(stage1, options)
        
        # Stage 3: Corridor Generation  
        stage3 = self.process_stage3_corridor_generation(stage2, options)
        
        # Compile complete result
        complete_result = {
            'workflow_type': 'three_stage_processing',
            'stages': {
                'stage1_empty': stage1,
                'stage2_ilots': stage2, 
                'stage3_complete': stage3
            },
            'final_layout': {
                'rooms': stage1['rooms'],
                'ilots': stage2['ilots'],
                'corridors': stage3['corridors'],
                'flow_indicators': stage3['flow_indicators'],
                'bounds': stage1['bounds']
            },
            'progression_summary': {
                'stage1_rooms': len(stage1['rooms']),
                'stage2_ilots': len(stage2['ilots']),
                'stage3_corridors': len(stage3['corridors']),
                'total_area': stage1['metrics']['total_floor_area'],
                'workspace_coverage': stage2['placement_stats']['coverage_achieved'],
                'circulation_area': stage3['corridor_stats']['total_area']
            }
        }
        
        print("\n🎉 Complete 3-Stage Workflow Finished!")
        return complete_result
    
    # Helper Methods for Stage Processing
    
    def _analyze_individual_room(self, room: Dict, index: int) -> Dict[str, Any]:
        """Analyze individual room properties"""
        room_id = room.get('id', f'room_{index:02d}')
        
        # Get or calculate area
        area = room.get('area', 0)
        if not area and 'polygon' in room:
            area = self._calculate_polygon_area(room['polygon'])
        
        # Get or calculate centroid
        centroid = room.get('center') or room.get('centroid')
        if not centroid and 'polygon' in room:
            centroid = self._calculate_centroid(room['polygon'])
        
        return {
            'id': room_id,
            'area': area,
            'centroid': centroid or {'x': 0, 'y': 0},
            'type': room.get('type', 'office'),
            'bounds': self._get_room_bounds(room),
            'measurements': {
                'area_text': f"{area:.1f}m²",
                'show_dimensions': True
            },
            'suitability': self._assess_ilot_suitability(area, room.get('type', 'office')),
            'original': room
        }
    
    def _generate_ilots_by_distribution(self, distribution: Dict[str, float], 
                                      target_area: float) -> List[Dict]:
        """Generate ilots according to size distribution"""
        ilots = []
        
        # Define size categories (people capacity -> area range)
        size_categories = {
            '1-3': {'min_area': 3, 'max_area': 8, 'capacity_range': (1, 3)},
            '3-5': {'min_area': 8, 'max_area': 15, 'capacity_range': (3, 5)}, 
            '5-10': {'min_area': 15, 'max_area': 30, 'capacity_range': (5, 10)},
            '10-15': {'min_area': 30, 'max_area': 50, 'capacity_range': (10, 15)}
        }
        
        ilot_counter = 0
        
        for category, percentage in distribution.items():
            if category not in size_categories:
                continue
                
            category_info = size_categories[category]
            category_area = target_area * percentage
            avg_ilot_size = (category_info['min_area'] + category_info['max_area']) / 2
            num_ilots = max(1, int(category_area / avg_ilot_size))
            
            for i in range(num_ilots):
                # Calculate ilot properties
                area_factor = i / max(1, num_ilots - 1)
                area = category_info['min_area'] + area_factor * (category_info['max_area'] - category_info['min_area'])
                
                # Calculate dimensions (rectangular, not square)
                aspect_ratio = 1.3 + 0.4 * area_factor  # 1.3 to 1.7
                width = math.sqrt(area * aspect_ratio)
                height = area / width
                
                # Calculate capacity
                min_cap, max_cap = category_info['capacity_range']
                capacity = int(min_cap + area_factor * (max_cap - min_cap))
                
                ilots.append({
                    'id': f'ilot_{ilot_counter:03d}',
                    'category': category,
                    'area': area,
                    'width': width,
                    'height': height,
                    'capacity': capacity,
                    'type': self._determine_workspace_type(capacity)
                })
                ilot_counter += 1
        
        return ilots
    
    def _place_ilots_optimally(self, ilots: List[Dict], rooms: List[Dict]) -> List[Dict]:
        """Place ilots in rooms using optimal positioning algorithm"""
        placed_ilots = []
        
        # Filter suitable rooms and sort by area
        suitable_rooms = [r for r in rooms if r['suitability']['suitable']]
        suitable_rooms.sort(key=lambda r: r['area'], reverse=True)
        
        # Track room occupancy
        room_usage = {room['id']: {'used_area': 0, 'ilots': []} for room in suitable_rooms}
        
        # Sort ilots by area (place larger ones first)
        sorted_ilots = sorted(ilots, key=lambda i: i['area'], reverse=True)
        
        for ilot in sorted_ilots:
            best_room = None
            
            for room in suitable_rooms:
                available_area = room['area'] - room_usage[room['id']]['used_area']
                required_area = ilot['area'] * 1.3  # Include circulation space
                
                if available_area >= required_area:
                    best_room = room
                    break
            
            if best_room:
                # Calculate position within room
                position = self._calculate_optimal_position(
                    ilot, best_room, room_usage[best_room['id']]['ilots']
                )
                
                placed_ilot = {
                    **ilot,
                    'x': position['x'],
                    'y': position['y'],
                    'room_id': best_room['id'],
                    'placed': True
                }
                
                placed_ilots.append(placed_ilot)
                room_usage[best_room['id']]['used_area'] += ilot['area'] * 1.3
                room_usage[best_room['id']]['ilots'].append(placed_ilot)
        
        return placed_ilots
    
    def _generate_main_spines(self, rooms: List[Dict], ilots: List[Dict], 
                            bounds: Dict, corridor_width: float) -> List[Dict]:
        """Generate main circulation spines"""
        corridors = []
        
        # Horizontal main spine
        center_y = (bounds['minY'] + bounds['maxY']) / 2
        main_horizontal = {
            'id': 'main_horizontal_spine',
            'type': 'main_spine',
            'x': bounds['minX'] + 1,
            'y': center_y - corridor_width / 2,
            'width': bounds['maxX'] - bounds['minX'] - 2,
            'height': corridor_width,
            'area': (bounds['maxX'] - bounds['minX'] - 2) * corridor_width,
            'direction': 'horizontal'
        }
        corridors.append(main_horizontal)
        
        # Vertical distribution spines
        if ilots:
            # Group ilots by approximate X position
            x_positions = sorted(set(round(ilot.get('x', 0) / 10) * 10 
                                   for ilot in ilots if 'x' in ilot))
            
            for i, x_pos in enumerate(x_positions[::2]):  # Every other position
                vertical_spine = {
                    'id': f'vertical_spine_{i}',
                    'type': 'vertical_spine',
                    'x': x_pos - corridor_width / 2,
                    'y': bounds['minY'] + 1,
                    'width': corridor_width,
                    'height': bounds['maxY'] - bounds['minY'] - 2,
                    'area': corridor_width * (bounds['maxY'] - bounds['minY'] - 2),
                    'direction': 'vertical'
                }
                corridors.append(vertical_spine)
        
        return corridors
    
    def _generate_inter_room_corridors(self, rooms: List[Dict], 
                                     corridor_width: float) -> List[Dict]:
        """Generate corridors between adjacent rooms"""
        corridors = []
        
        # Find room pairs that should be connected
        for i, room1 in enumerate(rooms):
            for room2 in rooms[i+1:]:
                distance = math.sqrt(
                    (room1['centroid']['x'] - room2['centroid']['x'])**2 +
                    (room1['centroid']['y'] - room2['centroid']['y'])**2
                )
                
                # Connect rooms that are 5-20m apart
                if 5 <= distance <= 20:
                    corridor = self._create_room_connector(room1, room2, corridor_width)
                    if corridor:
                        corridors.append(corridor)
        
        return corridors[:3]  # Limit connections to avoid overcrowding
    
    def _generate_ilot_access_corridors(self, ilots: List[Dict], 
                                      existing_corridors: List[Dict], 
                                      corridor_width: float) -> List[Dict]:
        """Generate access corridors to ilots"""
        corridors = []
        
        for ilot in ilots:
            if 'x' not in ilot:
                continue
                
            # Find nearest main corridor
            nearest_corridor = self._find_nearest_corridor(ilot, existing_corridors)
            if nearest_corridor:
                access_path = self._create_ilot_access_path(ilot, nearest_corridor, corridor_width)
                if access_path:
                    corridors.append(access_path)
        
        return corridors
    
    def _generate_entrance_access_paths(self, entrances: List[Dict], 
                                      corridors: List[Dict], 
                                      corridor_width: float) -> List[Dict]:
        """Generate access paths from entrances to corridor network"""
        access_corridors = []
        
        for i, entrance in enumerate(entrances):
            entrance_center = self._get_entrance_center(entrance)
            if not entrance_center:
                continue
                
            nearest_corridor = self._find_nearest_corridor_to_point(entrance_center, corridors)
            if nearest_corridor:
                access_path = {
                    'id': f'entrance_access_{i}',
                    'type': 'entrance_access',
                    'x': min(entrance_center['x'], nearest_corridor['x']),
                    'y': entrance_center['y'] - corridor_width / 2,
                    'width': abs(entrance_center['x'] - (nearest_corridor['x'] + nearest_corridor['width']/2)),
                    'height': corridor_width,
                    'area': abs(entrance_center['x'] - (nearest_corridor['x'] + nearest_corridor['width']/2)) * corridor_width,
                    'connects': f"entrance_{i}",
                    'direction': 'horizontal'
                }
                access_corridors.append(access_path)
        
        return access_corridors
    
    def _generate_circulation_flow(self, corridors: List[Dict], 
                                 entrances: List[Dict], ilots: List[Dict]) -> List[Dict]:
        """Generate red circulation flow indicators (lines and arrows)"""
        flow_indicators = []
        
        # Flow lines along corridors
        for corridor in corridors:
            flow_lines = self._create_corridor_flow_lines(corridor)
            flow_indicators.extend(flow_lines)
        
        # Directional arrows at key points
        for corridor in corridors:
            if corridor['type'] == 'main_spine':
                arrows = self._create_directional_arrows(corridor)
                flow_indicators.extend(arrows)
        
        # Entrance flow indicators
        for entrance in entrances:
            entrance_flows = self._create_entrance_flow_indicators(entrance, corridors)
            flow_indicators.extend(entrance_flows)
        
        return flow_indicators
    
    # Utility Methods
    
    def _calculate_polygon_area(self, polygon: List) -> float:
        """Calculate area using shoelace formula"""
        if len(polygon) < 3:
            return 0
        
        area = 0
        for i in range(len(polygon)):
            j = (i + 1) % len(polygon)
            p1, p2 = polygon[i], polygon[j]
            x1 = p1[0] if isinstance(p1, list) else p1.get('x', 0)
            y1 = p1[1] if isinstance(p1, list) else p1.get('y', 0) 
            x2 = p2[0] if isinstance(p2, list) else p2.get('x', 0)
            y2 = p2[1] if isinstance(p2, list) else p2.get('y', 0)
            area += x1 * y2 - x2 * y1
        
        return abs(area) / 2
    
    def _calculate_centroid(self, polygon: List) -> Dict[str, float]:
        """Calculate polygon centroid"""
        if not polygon:
            return {'x': 0, 'y': 0}
        
        x_sum = sum(p[0] if isinstance(p, list) else p.get('x', 0) for p in polygon)
        y_sum = sum(p[1] if isinstance(p, list) else p.get('y', 0) for p in polygon)
        
        return {'x': x_sum / len(polygon), 'y': y_sum / len(polygon)}
    
    def _get_room_bounds(self, room: Dict) -> Dict[str, float]:
        """Get room bounding rectangle"""
        if 'bounds' in room:
            return room['bounds']
        
        if 'polygon' in room:
            polygon = room['polygon']
            x_coords = [p[0] if isinstance(p, list) else p.get('x', 0) for p in polygon]
            y_coords = [p[1] if isinstance(p, list) else p.get('y', 0) for p in polygon]
            
            return {
                'minX': min(x_coords), 'maxX': max(x_coords),
                'minY': min(y_coords), 'maxY': max(y_coords)
            }
        
        # Default bounds
        return {
            'minX': room.get('x', 0), 'maxX': room.get('x', 0) + room.get('width', 10),
            'minY': room.get('y', 0), 'maxY': room.get('y', 0) + room.get('height', 10)
        }
    
    def _assess_ilot_suitability(self, area: float, room_type: str) -> Dict[str, Any]:
        """Assess room suitability for ilot placement"""
        suitable_types = ['office', 'workspace', 'meeting', 'conference', 'open_office']
        type_suitable = room_type.lower() in suitable_types
        area_suitable = area >= 10.0  # Minimum 10m² for ilot
        
        return {
            'suitable': type_suitable and area_suitable,
            'score': 0.8 if type_suitable and area_suitable else 0.2,
            'reasons': {
                'type_ok': type_suitable,
                'area_ok': area_suitable
            }
        }
    
    def _determine_workspace_type(self, capacity: int) -> str:
        """Determine workspace type based on capacity"""
        if capacity <= 1:
            return 'individual_desk'
        elif capacity <= 3:
            return 'small_team'
        elif capacity <= 6:
            return 'team_workspace'
        else:
            return 'collaboration_area'
    
    def _calculate_optimal_position(self, ilot: Dict, room: Dict, 
                                  existing_ilots: List[Dict]) -> Dict[str, float]:
        """Calculate optimal position for ilot in room"""
        bounds = room['bounds']
        margin = 0.5  # 50cm margin from walls
        
        # Simple grid-based placement
        grid_x = bounds['minX'] + margin
        grid_y = bounds['minY'] + margin
        
        # Offset based on existing ilots to avoid overlap
        offset_x = len(existing_ilots) * (ilot['width'] + 1.0)
        offset_y = (len(existing_ilots) // 2) * (ilot['height'] + 1.0)
        
        return {
            'x': min(grid_x + offset_x, bounds['maxX'] - ilot['width'] - margin),
            'y': min(grid_y + offset_y, bounds['maxY'] - ilot['height'] - margin)
        }
    
    def _create_room_connector(self, room1: Dict, room2: Dict, 
                             corridor_width: float) -> Optional[Dict]:
        """Create corridor connecting two rooms"""
        c1, c2 = room1['centroid'], room2['centroid']
        
        return {
            'id': f"connect_{room1['id']}_{room2['id']}",
            'type': 'room_connector',
            'x': min(c1['x'], c2['x']),
            'y': min(c1['y'], c2['y']) - corridor_width / 2,
            'width': abs(c1['x'] - c2['x']),
            'height': corridor_width,
            'area': abs(c1['x'] - c2['x']) * corridor_width,
            'connects': [room1['id'], room2['id']],
            'direction': 'horizontal'
        }
    
    def _find_nearest_corridor(self, ilot: Dict, corridors: List[Dict]) -> Optional[Dict]:
        """Find nearest corridor to an ilot"""
        if not corridors:
            return None
            
        ilot_center = {'x': ilot['x'] + ilot['width']/2, 'y': ilot['y'] + ilot['height']/2}
        
        min_distance = float('inf')
        nearest = None
        
        for corridor in corridors:
            corridor_center = {
                'x': corridor['x'] + corridor['width'] / 2,
                'y': corridor['y'] + corridor['height'] / 2
            }
            
            distance = math.sqrt(
                (ilot_center['x'] - corridor_center['x'])**2 +
                (ilot_center['y'] - corridor_center['y'])**2
            )
            
            if distance < min_distance:
                min_distance = distance
                nearest = corridor
        
        return nearest
    
    def _find_nearest_corridor_to_point(self, point: Dict, corridors: List[Dict]) -> Optional[Dict]:
        """Find nearest corridor to a point"""
        if not corridors:
            return None
            
        return min(corridors, key=lambda c: math.sqrt(
            (point['x'] - (c['x'] + c['width']/2))**2 +
            (point['y'] - (c['y'] + c['height']/2))**2
        ))
    
    def _create_ilot_access_path(self, ilot: Dict, corridor: Dict, 
                               corridor_width: float) -> Dict:
        """Create access path from ilot to corridor"""
        ilot_center = {'x': ilot['x'] + ilot['width']/2, 'y': ilot['y'] + ilot['height']/2}
        corridor_center = {'x': corridor['x'] + corridor['width']/2, 'y': corridor['y'] + corridor['height']/2}
        
        return {
            'id': f"access_{ilot['id']}",
            'type': 'ilot_access',
            'x': min(ilot_center['x'], corridor_center['x']),
            'y': ilot_center['y'] - corridor_width / 2,
            'width': abs(ilot_center['x'] - corridor_center['x']),
            'height': corridor_width,
            'area': abs(ilot_center['x'] - corridor_center['x']) * corridor_width,
            'connects': ilot['id'],
            'direction': 'horizontal'
        }
    
    def _get_entrance_center(self, entrance: Dict) -> Optional[Dict]:
        """Get center point of entrance"""
        if 'center' in entrance:
            return entrance['center']
        
        if 'start' in entrance and 'end' in entrance:
            return {
                'x': (entrance['start']['x'] + entrance['end']['x']) / 2,
                'y': (entrance['start']['y'] + entrance['end']['y']) / 2
            }
        
        return None
    
    def _create_corridor_flow_lines(self, corridor: Dict) -> List[Dict]:
        """Create flow lines along corridor centerline"""
        flow_lines = []
        
        if corridor['direction'] == 'horizontal':
            # Horizontal flow line
            flow_lines.append({
                'type': 'flow_line',
                'x1': corridor['x'],
                'y1': corridor['y'] + corridor['height'] / 2,
                'x2': corridor['x'] + corridor['width'],
                'y2': corridor['y'] + corridor['height'] / 2,
                'color': 'red',
                'width': 2
            })
        else:
            # Vertical flow line
            flow_lines.append({
                'type': 'flow_line',
                'x1': corridor['x'] + corridor['width'] / 2,
                'y1': corridor['y'],
                'x2': corridor['x'] + corridor['width'] / 2,
                'y2': corridor['y'] + corridor['height'],
                'color': 'red',
                'width': 2
            })
        
        return flow_lines
    
    def _create_directional_arrows(self, corridor: Dict) -> List[Dict]:
        """Create directional arrows along corridor"""
        arrows = []
        
        if corridor['direction'] == 'horizontal':
            # Arrows pointing both ways
            num_arrows = max(2, int(corridor['width'] / 10))
            for i in range(num_arrows):
                x = corridor['x'] + (corridor['width'] * (i + 0.5) / num_arrows)
                y = corridor['y'] + corridor['height'] / 2
                
                arrows.extend([
                    {
                        'type': 'arrow',
                        'x': x, 'y': y - 0.3,
                        'direction': 'right',
                        'size': 0.8,
                        'color': 'red'
                    },
                    {
                        'type': 'arrow', 
                        'x': x, 'y': y + 0.3,
                        'direction': 'left',
                        'size': 0.8,
                        'color': 'red'
                    }
                ])
        
        return arrows
    
    def _create_entrance_flow_indicators(self, entrance: Dict, 
                                       corridors: List[Dict]) -> List[Dict]:
        """Create flow indicators from entrance"""
        indicators = []
        
        entrance_center = self._get_entrance_center(entrance)
        if not entrance_center or not corridors:
            return indicators
        
        nearest = self._find_nearest_corridor_to_point(entrance_center, corridors)
        if nearest:
            # Flow arrow from entrance toward corridor
            corridor_center = {
                'x': nearest['x'] + nearest['width'] / 2,
                'y': nearest['y'] + nearest['height'] / 2
            }
            
            indicators.append({
                'type': 'entrance_flow',
                'x1': entrance_center['x'],
                'y1': entrance_center['y'],
                'x2': corridor_center['x'],
                'y2': corridor_center['y'],
                'color': 'red',
                'width': 3,
                'arrow_head': True
            })
        
        return indicators

# Export the processor class for integration
def create_three_stage_processor():
    """Factory function to create processor instance"""
    return ThreeStageFloorPlanProcessor()

# Example usage and testing
if __name__ == "__main__":
    processor = ThreeStageFloorPlanProcessor()
    
    # Sample data matching your floor plan images
    sample_data = {
        "bounds": {"minX": 0, "minY": 0, "maxX": 60, "maxY": 40},
        "rooms": [
            {"id": "R01", "area": 19.5, "center": {"x": 8, "y": 8}, "type": "office"},
            {"id": "R02", "area": 19.5, "center": {"x": 8, "y": 20}, "type": "office"},
            {"id": "R03", "area": 24.5, "center": {"x": 8, "y": 32}, "type": "office"},
            {"id": "R04", "area": 20.0, "center": {"x": 20, "y": 8}, "type": "office"},
            {"id": "R05", "area": 15.0, "center": {"x": 20, "y": 20}, "type": "meeting"},
            {"id": "R06", "area": 13.0, "center": {"x": 20, "y": 32}, "type": "office"},
            {"id": "R07", "area": 30.0, "center": {"x": 35, "y": 15}, "type": "conference"},
            {"id": "R08", "area": 25.0, "center": {"x": 50, "y": 20}, "type": "meeting"}
        ],
        "entrances": [
            {"id": "main", "start": {"x": 0, "y": 18}, "end": {"x": 2, "y": 22}},
            {"id": "side", "start": {"x": 30, "y": 0}, "end": {"x": 34, "y": 2}}
        ],
        "forbidden_zones": []
    }
    
    print("🧪 Testing 3-Stage Processor with Sample Data")
    result = processor.process_complete_workflow(sample_data)
    
    print(f"\n📊 Processing Results:")
    print(f"Stage 1 - Rooms: {result['progression_summary']['stage1_rooms']}")
    print(f"Stage 2 - Ilots: {result['progression_summary']['stage2_ilots']}")  
    print(f"Stage 3 - Corridors: {result['progression_summary']['stage3_corridors']}")
    print(f"Total Area: {result['progression_summary']['total_area']} m²")
    print(f"✅ Ready for CAD Integration!")