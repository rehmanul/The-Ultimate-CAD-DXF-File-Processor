const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

class DWGConverter {
    constructor() {
        // ODA File Converter path from environment or default locations
        this.odaPath = process.env.ODA_CONVERTER_PATH || this.findODAConverter();
    }

    findODAConverter() {
        // Check project bin folder first (for bundled deployment)
        const projectBinWindows = path.join(__dirname, '..', 'bin', 'ODAFileConverter.exe');
        const projectBinUnix = path.join(__dirname, '..', 'bin', 'ODAFileConverter');
        
        if (fs.existsSync(projectBinWindows)) return projectBinWindows;
        if (fs.existsSync(projectBinUnix)) return projectBinUnix;
        
        // Check system paths
        const possiblePaths = [
            'C:\\Program Files\\ODA\\ODAFileConverter\\ODAFileConverter.exe',
            'C:\\Program Files (x86)\\ODA\\ODAFileConverter\\ODAFileConverter.exe',
            '/usr/bin/ODAFileConverter',
            '/usr/local/bin/ODAFileConverter',
            'ODAFileConverter' // Assume in PATH
        ];
        
        for (const p of possiblePaths) {
            if (p.includes(':\\') && fs.existsSync(p)) return p;
        }
        
        return null; // Not found
    }

    async convertDWGtoDXF(dwgFilePath, options = {}) {
        const format = options.format || 'ACAD2000';
        const outputType = options.outputType || 'DXF';
        try {
            // Check if ODA converter is available
            if (!this.odaPath) {
                throw new Error('ODA_NOT_INSTALLED');
            }
            
            const inputDir = path.dirname(dwgFilePath);
            const outputDir = inputDir;
            const dxfPath = dwgFilePath.replace(/\.dwg$/i, '.dxf');
            
            // ODA File Converter command line:
            // ODAFileConverter "input_folder" "output_folder" "ACAD2000" "DXF" "0" "1" "*.dwg"
            const args = [
                inputDir,
                outputDir,
                format,      // Format from options (ACAD2000, ACAD12, etc.)
                outputType,  // Output type (DXF)
                '0',         // Recursive (0=no)
                '1',         // Audit (1=yes)
                path.basename(dwgFilePath) // Specific file
            ];
            
            console.log(`Converting DWG with ODA: ${this.odaPath}`);
            console.log(`Format: ${format}, Type: ${outputType}`);
            console.log(`Input: ${dwgFilePath}`);
            console.log(`Output: ${dxfPath}`);
            console.log(`Args:`, args);
            
            const result = await execFileAsync(this.odaPath, args, { timeout: 30000 });
            console.log('ODA stdout:', result.stdout);
            console.log('ODA stderr:', result.stderr);
            
            // Check if DXF was created
            if (!fs.existsSync(dxfPath)) {
                throw new Error('DXF file not created by ODA converter');
            }
            
            const dxfSize = fs.statSync(dxfPath).size;
            console.log(`DWG converted to DXF: ${path.basename(dwgFilePath)} → ${path.basename(dxfPath)} (${dxfSize} bytes)`);
            
            // Verify it's ASCII DXF by checking first bytes
            const header = fs.readFileSync(dxfPath, 'utf8', { encoding: 'utf8' }).substring(0, 100);
            if (!header.includes('SECTION') && !header.includes('HEADER')) {
                console.warn('Warning: DXF may be binary format, parser might fail');
            }
            
            return dxfPath;
            
        } catch (error) {
            console.error('DWG conversion error:', error.message);
            
            if (error.message === 'ODA_NOT_INSTALLED' || error.code === 'ENOENT') {
                throw new Error('ODA File Converter not found. Place ODAFileConverter.exe in ./bin/ folder. See SETUP_DWG.md for instructions.');
            }
            
            throw new Error(`Failed to convert DWG to DXF: ${error.message}`);
        }
    }
}

module.exports = new DWGConverter();

// Check ODA availability on startup
const converter = module.exports;
if (converter.odaPath) {
    console.log('✅ ODA File Converter found:', converter.odaPath);
    console.log('✅ DWG files will be converted automatically');
} else {
    console.warn('⚠️  ODA File Converter not found');
    console.warn('⚠️  DWG files will be rejected. See SETUP_DWG.md to enable DWG support.');
}
