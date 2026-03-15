const fs = require('fs');
const file = 'lib/ProfessionalGridLayoutEngine.js';
let code = fs.readFileSync(file, 'utf8');

// Fix density
code = code.replace(
    /\/\/ 3c\. Vertical spine corridors — every 5 columns for max density[\s\S]*?const spineEvery = 5;[\s\S]*?for \(let col = spineEvery; col < numCols; col \+= spineEvery\) \{[\s\S]*?const sx = b\.minX \+ col \* \(bw \+ this\.boxSpacing\) - cw \/ 2;[\s\S]*?rawCorridors\.push\(\{[\s\S]*?id: \`spine_\$\{col\} \`, type: 'SPINE', direction: 'vertical',[\s\S]*?x: sx, y: b\.minY, width: cw, height: this\.planH,[\s\S]*?isSpine: true[\s\S]*?\}\);[\s\S]*?\}/m,
    `// 3c. Vertical corridors at EVERY column gap (COSTO V1 reference style)
        for (let col = 1; col < numCols; col++) {
            const sx = b.minX + col * (bw + this.boxSpacing) - (this.boxSpacing + cw) / 2;
            rawCorridors.push({
                id: \`vertical_\${col}\`, type: 'SPINE', direction: 'vertical',
                x: sx, y: b.minY, width: cw, height: this.planH,
                isSpine: true
            });
        }`
);

// Fix A* to use straight centerlines
code = code.replace(
    /const path = astarFind[\s\S]*?if \(path\) \{[\s\S]*?circulationPaths\.push\(\{[\s\S]*?type: c\.type \|\| 'ACCESS',[\s\S]*?direction: 'horizontal',[\s\S]*?points: simplifyPath\(path\)[\s\S]*?\}\);[\s\S]*?\} else \{[\s\S]*?circulationPaths\.push\(\{[\s\S]*?type: c\.type \|\| 'ACCESS',[\s\S]*?direction: 'horizontal',[\s\S]*?points: \[[\s\S]*?\{ x: c\.x, y: cy \},[\s\S]*?\{ x: c\.x \+ c\.width, y: cy \}[\s\S]*?\][\s\S]*?\}\);[\s\S]*?\}/m,
    `circulationPaths.push({
                    type: c.type || 'ACCESS',
                    direction: 'horizontal',
                    points: [
                        { x: c.x, y: cy },
                        { x: c.x + c.width, y: cy }
                    ]
                });`
);

code = code.replace(
    /const path = astarFind[\s\S]*?if \(path\) \{[\s\S]*?circulationPaths\.push\(\{[\s\S]*?type: c\.type \|\| 'SPINE',[\s\S]*?direction: 'vertical',[\s\S]*?points: simplifyPath\(path\)[\s\S]*?\}\);[\s\S]*?\} else \{[\s\S]*?circulationPaths\.push\(\{[\s\S]*?type: c\.type \|\| 'SPINE',[\s\S]*?direction: 'vertical',[\s\S]*?points: \[[\s\S]*?\{ x: cx, y: c\.y \},[\s\S]*?\{ x: cx, y: c\.y \+ c\.height \}[\s\S]*?\][\s\S]*?\}\);[\s\S]*?\}/m,
    `circulationPaths.push({
                    type: c.type || 'SPINE',
                    direction: 'vertical',
                    points: [
                        { x: cx, y: c.y },
                        { x: cx, y: c.y + c.height }
                    ]
                });`
);

fs.writeFileSync(file, code);
console.log('Engine patched.');
