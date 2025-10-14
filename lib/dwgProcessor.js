const fs = require('fs');
const path = require('path');

/**
 * DWG Processor - Converts DWG to DXF using libdxfrw-web
 */
class DWGProcessor {
    async processDWG(dwgFilePath) {
        try {
            const { LibDxfrw } = require('@mlightcad/libdxfrw-web');
            
            // Read DWG file
            const dwgBuffer = fs.readFileSync(dwgFilePath);
            
            // Initialize libdxfrw
            const libdxfrw = await LibDxfrw.create();
            
            // Convert DWG to DXF
            const dxfData = await libdxfrw.readDWG(new Uint8Array(dwgBuffer));
            
            // Save as temporary DXF file
            const dxfPath = dwgFilePath.replace(/\.dwg$/i, '_converted.dxf');
            fs.writeFileSync(dxfPath, dxfData);
            
            console.log(`[DWG Processor] Converted ${path.basename(dwgFilePath)} to DXF`);
            
            return dxfPath;
        } catch (error) {
            console.error('[DWG Processor] Conversion failed:', error.message);
            throw new Error(`DWG conversion failed: ${error.message}`);
        }
    }
}

module.exports = DWGProcessor;
