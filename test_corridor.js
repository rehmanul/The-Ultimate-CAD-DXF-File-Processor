const ProductionCorridorGenerator = require('./lib/productionCorridorGenerator');

// Test with sample ilots arranged in columns
const mockIlots = [
  { x: 0, y: 0, width: 2, height: 3, id: 'ilot1' },
  { x: 0, y: 5, width: 2, height: 3, id: 'ilot2' },
  { x: 5, y: 0, width: 2, height: 3, id: 'ilot3' },
  { x: 5, y: 5, width: 2, height: 3, id: 'ilot4' }
];

const generator = new ProductionCorridorGenerator(null, mockIlots);
const corridors = generator.generateCorridors();

console.log('Generated corridors:');
corridors.forEach(corridor => {
  console.log(`ID: ${corridor.id}, Width: ${corridor.width}, Height: ${corridor.height}, Area: ${corridor.area}`);
  console.log(`Position: (${corridor.x}, ${corridor.y})`);
  console.log(`Polygon: ${JSON.stringify(corridor.polygon)}`);
  console.log('---');
});
