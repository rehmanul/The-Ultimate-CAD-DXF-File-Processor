const GeometryHelpers = require('./lib/geometryHelpers.js');

// Test the geometry angle calculation with the provided values
console.log('Testing Geometry Angle Calculation');
console.log('=====================================');

// Provided values from user
const startX = 0.0000;
const startY = 0.0000;
const startZ = 10.0000;
const endX = 1.0000;
const endY = 0.0000;
const endZ = 0.0000;
const deltaX = 1.0000;
const deltaY = 10.0000;
const deltaZ = 10.0000;
const length = 1000;

// Check if applyGeometryAngle method exists
if (typeof GeometryHelpers.applyGeometryAngle === 'function') {
    const result = GeometryHelpers.applyGeometryAngle(
        startX, startY, startZ,
        endX, endY, endZ,
        deltaX, deltaY, deltaZ,
        length
    );

    console.log('Result:', JSON.stringify(result, null, 2));
} else {
    console.log('applyGeometryAngle method not found. Available methods:');
    console.log(Object.getOwnPropertyNames(GeometryHelpers).filter(name =>
        typeof GeometryHelpers[name] === 'function'
    ));

    // Test individual components
    console.log('\nTesting individual components:');
    const startPoint = { x: startX, y: startY, z: startZ };
    const endPoint = { x: endX, y: endY, z: endZ };

    if (typeof GeometryHelpers.calculateLineAngles === 'function') {
        const angles = GeometryHelpers.calculateLineAngles(startPoint, endPoint);
        console.log('Line angles:', angles);
    }

    if (typeof GeometryHelpers.distance3D === 'function') {
        const distance = GeometryHelpers.distance3D(startPoint, endPoint);
        console.log('3D distance:', distance);
    }
}
