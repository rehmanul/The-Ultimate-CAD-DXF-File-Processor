const fs = require('fs');
const file = 'lib/costoExports.js';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
    /circulation: rgb\(0\.82, 0\.12, 0\.12\), \/\/ Red circulation \(reference "ligne circulation"\)/g,
    `circulation: rgb(0.82, 0.12, 0.12), // Red circulation (reference "ligne circulation")
            circulationRef: rgb(0.91, 0.11, 0.38), // Pink/magenta for reference`
);

code = code.replace(
    /const flowArrowColor = options\.greenArrows \? rgb\(0\.35, 0\.05, 0\.08\) : COLORS\.circulation;/g,
    `const flowArrowColor = options.greenArrows ? rgb(0.35, 0.05, 0.08) : COLORS.circulationRef;`
);

fs.writeFileSync(file, code);
console.log('PDF patched.');
