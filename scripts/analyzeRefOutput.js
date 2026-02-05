const fs = require('fs');
const path = require('path');

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/analyzeRefOutput.js <path to Expected output MUST.jpg>');
  process.exit(1);
}

const buffer = fs.readFileSync(target);

// Quick JPEG size scan
let width = null;
let height = null;
for (let i = 0; i < buffer.length - 9; i++) {
  if (buffer[i] === 0xFF && buffer[i+1] === 0xC0) {
    height = buffer.readUInt16BE(i + 5);
    width = buffer.readUInt16BE(i + 7);
    break;
  }
}

console.log(`JPEG size: ${width}x${height}`);

// Extract very small summary of frequency of colors by sampling pixels using sharp if available
let sharp = null;
try {
  sharp = require('sharp');
} catch (e) {}

if (!sharp) {
  console.log('sharp not available, skipping color summary');
  process.exit(0);
}

(async () => {
  const sample = await sharp(target)
    .resize(64, 64, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const data = sample.data;
  const info = sample.info;
  const counts = new Map();
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = `${r},${g},${b}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log('Top sampled colors (64x64):');
  sorted.forEach(([key, count]) => {
    console.log(`  ${key} -> ${count}`);
  });
})();
