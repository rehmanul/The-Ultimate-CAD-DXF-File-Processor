/**
 * COSTO Project Manager - V1
 * Manages project format: JSON + DWG references + exports
 * Based on COSTO V1 specifications
 */

const fs = require('fs');
const path = require('path');

class CostoProjectManager {
    constructor() {
        // Try multiple directory locations in order of preference
        const possibleDirs = [
            path.join(__dirname, '..', 'projects'),
            path.join(process.cwd(), 'projects'),
            path.join('/tmp', 'costo-projects'),
            path.join(require('os').tmpdir(), 'costo-projects')
        ];
        
        this.projectsDir = null;
        for (const dir of possibleDirs) {
            try {
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                // Test write access
                const testFile = path.join(dir, '.test');
                try {
                    fs.writeFileSync(testFile, 'test');
                    fs.unlinkSync(testFile);
                    this.projectsDir = dir;
                    break;
                } catch (writeError) {
                    // Can't write here, try next
                    continue;
                }
            } catch (error) {
                // Can't create here, try next
                continue;
            }
        }
        
        if (!this.projectsDir) {
            console.warn('[CostoProjectManager] Could not create projects directory, operations will fail');
            this.projectsDir = possibleDirs[0]; // Use first as fallback even if not writable
        } else {
            console.log(`[CostoProjectManager] Using projects directory: ${this.projectsDir}`);
        }
    }


    /**
     * Save project
     * @param {string} projectId - Project identifier
     * @param {Object} projectData - Project data
     * @returns {string} - Project file path
     */
    saveProject(projectId, projectData) {
        const projectFile = path.join(this.projectsDir, `${projectId}.json`);
        
        const project = {
            id: projectId,
            version: '1.0',
            createdAt: projectData.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metadata: projectData.metadata || {},
            floorPlan: projectData.floorPlan || {},
            unitMix: projectData.unitMix || {},
            rules: projectData.rules || {},
            solution: projectData.solution || {},
            exports: projectData.exports || {},
            dwgReference: projectData.dwgReference || null,
            layerMapping: projectData.layerMapping || {},
            catalog: projectData.catalog || null
        };

        fs.writeFileSync(projectFile, JSON.stringify(project, null, 2));
        return projectFile;
    }

    /**
     * Load project
     * @param {string} projectId - Project identifier
     * @returns {Object|null} - Project data
     */
    loadProject(projectId) {
        const projectFile = path.join(this.projectsDir, `${projectId}.json`);
        
        if (!fs.existsSync(projectFile)) {
            return null;
        }

        const content = fs.readFileSync(projectFile, 'utf-8');
        return JSON.parse(content);
    }

    /**
     * List all projects
     * @returns {Array<Object>} - List of project metadata
     */
    listProjects() {
        if (!fs.existsSync(this.projectsDir)) {
            return [];
        }

        const files = fs.readdirSync(this.projectsDir)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                const projectId = f.replace('.json', '');
                const project = this.loadProject(projectId);
                return {
                    id: projectId,
                    name: project?.metadata?.name || projectId,
                    createdAt: project?.createdAt,
                    updatedAt: project?.updatedAt,
                    version: project?.version
                };
            });

        return files.sort((a, b) => 
            new Date(b.updatedAt) - new Date(a.updatedAt)
        );
    }

    /**
     * Delete project
     * @param {string} projectId - Project identifier
     * @returns {boolean} - Success
     */
    deleteProject(projectId) {
        const projectFile = path.join(this.projectsDir, `${projectId}.json`);
        
        if (fs.existsSync(projectFile)) {
            fs.unlinkSync(projectFile);
            return true;
        }
        return false;
    }

    /**
     * Export project (including referenced files)
     * @param {string} projectId - Project identifier
     * @param {string} exportPath - Export directory
     * @returns {Object} - Export manifest
     */
    exportProject(projectId, exportPath) {
        const project = this.loadProject(projectId);
        if (!project) {
            throw new Error(`Project ${projectId} not found`);
        }

        if (!fs.existsSync(exportPath)) {
            fs.mkdirSync(exportPath, { recursive: true });
        }

        // Copy project JSON
        const projectFile = path.join(exportPath, `${projectId}.json`);
        fs.writeFileSync(projectFile, JSON.stringify(project, null, 2));

        // Copy DWG reference if exists
        const manifest = {
            projectId,
            exportedAt: new Date().toISOString(),
            files: [`${projectId}.json`]
        };

        if (project.dwgReference && fs.existsSync(project.dwgReference)) {
            const dwgFileName = path.basename(project.dwgReference);
            const dwgDest = path.join(exportPath, dwgFileName);
            fs.copyFileSync(project.dwgReference, dwgDest);
            manifest.files.push(dwgFileName);
        }

        // Copy exports if they exist
        if (project.exports) {
            Object.entries(project.exports).forEach(([type, filePath]) => {
                if (fs.existsSync(filePath)) {
                    const fileName = path.basename(filePath);
                    const dest = path.join(exportPath, fileName);
                    fs.copyFileSync(filePath, dest);
                    manifest.files.push(fileName);
                }
            });
        }

        // Write manifest
        const manifestFile = path.join(exportPath, 'manifest.json');
        fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

        return manifest;
    }

    /**
     * Import project
     * @param {string} importPath - Import directory
     * @param {string} projectId - New project ID (optional)
     * @returns {Object} - Imported project
     */
    importProject(importPath, projectId = null) {
        const manifestFile = path.join(importPath, 'manifest.json');
        
        if (!fs.existsSync(manifestFile)) {
            throw new Error('Manifest file not found');
        }

        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
        const projectFile = path.join(importPath, manifest.files[0]);
        
        if (!fs.existsSync(projectFile)) {
            throw new Error('Project file not found');
        }

        const project = JSON.parse(fs.readFileSync(projectFile, 'utf-8'));
        
        // Update project ID if provided
        if (projectId) {
            project.id = projectId;
        }

        // Update file references
        manifest.files.slice(1).forEach(fileName => {
            const sourceFile = path.join(importPath, fileName);
            const destFile = path.join(this.projectsDir, fileName);
            
            if (fs.existsSync(sourceFile)) {
                fs.copyFileSync(sourceFile, destFile);
                
                // Update project references
                if (fileName.endsWith('.dwg') || fileName.endsWith('.dxf')) {
                    project.dwgReference = destFile;
                } else {
                    const exportType = path.extname(fileName).substring(1);
                    if (!project.exports) project.exports = {};
                    project.exports[exportType] = destFile;
                }
            }
        });

        // Save imported project
        const newProjectId = projectId || project.id || `imported_${Date.now()}`;
        this.saveProject(newProjectId, project);

        return project;
    }

    /**
     * Get project statistics
     * @param {string} projectId - Project identifier
     * @returns {Object} - Project statistics
     */
    getProjectStats(projectId) {
        const project = this.loadProject(projectId);
        if (!project) {
            return null;
        }

        const solution = project.solution || {};
        const boxes = solution.boxes || [];
        const corridors = solution.corridors || [];

        return {
            projectId,
            boxCount: boxes.length,
            corridorCount: corridors.length,
            totalArea: boxes.reduce((sum, b) => sum + (b.area || b.width * b.height || 0), 0),
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
            hasDWG: !!project.dwgReference,
            exportCount: Object.keys(project.exports || {}).length
        };
    }
}

// Lazy initialization to avoid startup crashes
let projectManagerInstance = null;

function getProjectManager() {
    if (!projectManagerInstance) {
        try {
            projectManagerInstance = new CostoProjectManager();
        } catch (error) {
            console.error('[CostoProjectManager] Initialization failed:', error.message);
            // Return a stub that won't crash the server
            projectManagerInstance = {
                saveProject: () => { throw new Error('Project manager not available'); },
                loadProject: () => { throw new Error('Project manager not available'); },
                listProjects: () => [],
                deleteProject: () => { throw new Error('Project manager not available'); },
                getProjectStats: () => null
            };
        }
    }
    return projectManagerInstance;
}

// Export with lazy initialization
module.exports = {
    saveProject: (...args) => getProjectManager().saveProject(...args),
    loadProject: (...args) => getProjectManager().loadProject(...args),
    listProjects: (...args) => getProjectManager().listProjects(...args),
    deleteProject: (...args) => getProjectManager().deleteProject(...args),
    getProjectStats: (...args) => getProjectManager().getProjectStats(...args)
};
