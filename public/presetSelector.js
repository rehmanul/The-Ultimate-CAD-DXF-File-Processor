/**
 * Phase 2: Distribution Preset Selector Component
 * Professional UI for selecting and managing distribution presets
 */

class PresetSelector {
    constructor(container) {
        this.container = container;
        this.presets = null;
        this.categories = [];
        this.selectedPreset = null;
        this.customPresets = this.loadCustomPresetsFromStorage();
        this.onPresetSelected = null;
        this.init();
    }

    async init() {
        await this.loadPresets();
        this.render();
        this.attachEventListeners();
    }

    async loadPresets() {
        try {
            const response = await fetch('/api/presets');
            if (!response.ok) throw new Error('Failed to load presets');
            const data = await response.json();
            this.presets = data.presets;
            this.categories = data.categories;
        } catch (error) {
            console.error('Error loading presets:', error);
            this.presets = this.getDefaultPresets();
            this.categories = ['Office', 'Hospitality', 'Industrial', 'Retail', 'Residential'];
        }
    }

    render() {
        this.container.innerHTML = `
            <div class="preset-selector-panel">
                <div class="preset-header">
                    <h3><i class="fas fa-layer-group"></i> Distribution Presets</h3>
                    <button class="btn-icon" id="refreshPresets" title="Refresh">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                </div>

                <div class="preset-tabs">
                    <button class="preset-tab active" data-category="all">
                        <i class="fas fa-th"></i> All
                    </button>
                    ${this.categories.map(cat => `
                        <button class="preset-tab" data-category="${cat}">
                            <i class="${this.getCategoryIcon(cat)}"></i> ${cat}
                        </button>
                    `).join('')}
                    <button class="preset-tab" data-category="custom">
                        <i class="fas fa-star"></i> Custom
                    </button>
                </div>

                <div class="preset-search">
                    <input type="text" id="presetSearch" placeholder="Search presets...">
                    <i class="fas fa-search"></i>
                </div>

                <div class="preset-grid" id="presetGrid">
                    ${this.renderPresetCards()}
                </div>

                <div class="preset-actions">
                    <button class="btn-primary" id="createCustomPreset">
                        <i class="fas fa-plus"></i> Create Custom
                    </button>
                    <button class="btn-secondary" id="importPreset">
                        <i class="fas fa-file-import"></i> Import
                    </button>
                </div>

                <div id="presetDetailsModal" class="modal hidden">
                    <div class="modal-content">
                        <span class="modal-close">&times;</span>
                        <div id="presetDetailsContent"></div>
                    </div>
                </div>

                <div id="customPresetModal" class="modal hidden">
                    <div class="modal-content">
                        <span class="modal-close">&times;</span>
                        <div id="customPresetForm"></div>
                    </div>
                </div>
            </div>
        `;
    }

    renderPresetCards() {
        const allPresets = { ...this.presets, ...this.customPresets };
        return Object.values(allPresets).map(preset => `
            <div class="preset-card" data-preset-id="${preset.id}">
                <div class="preset-card-header">
                    <div class="preset-icon">
                        <i class="${this.getPresetIcon(preset.category)}"></i>
                    </div>
                    <div class="preset-category">${preset.category}</div>
                </div>
                <h4 class="preset-name">${preset.name}</h4>
                <p class="preset-description">${preset.description}</p>
                <div class="preset-stats">
                    <div class="preset-stat">
                        <i class="fas fa-cubes"></i>
                        <span>${Object.keys(preset.distribution).length} ranges</span>
                    </div>
                    <div class="preset-stat">
                        <i class="fas fa-road"></i>
                        <span>${preset.corridorWidth}m corridor</span>
                    </div>
                </div>
                <div class="preset-distribution-preview">
                    ${this.renderDistributionBars(preset.distribution)}
                </div>
                <div class="preset-actions">
                    <button class="btn-small btn-primary select-preset" data-preset-id="${preset.id}">
                        <i class="fas fa-check"></i> Select
                    </button>
                    <button class="btn-small btn-secondary view-details" data-preset-id="${preset.id}">
                        <i class="fas fa-info-circle"></i> Details
                    </button>
                    ${preset.metadata?.custom ? `
                        <button class="btn-small btn-danger delete-preset" data-preset-id="${preset.id}">
                            <i class="fas fa-trash"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        `).join('');
    }

    renderDistributionBars(distribution) {
        return Object.entries(distribution).map(([range, percentage]) => `
            <div class="distribution-bar" title="${range} m²: ${percentage}%">
                <div class="distribution-fill" style="width: ${percentage}%"></div>
                <span class="distribution-label">${range}m²</span>
                <span class="distribution-value">${percentage}%</span>
            </div>
        `).join('');
    }

    attachEventListeners() {
        // Tab switching
        document.querySelectorAll('.preset-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.preset-tab').forEach(t => t.classList.remove('active'));
                e.currentTarget.classList.add('active');
                this.filterByCategory(e.currentTarget.dataset.category);
            });
        });

        // Search
        document.getElementById('presetSearch')?.addEventListener('input', (e) => {
            this.filterBySearch(e.target.value);
        });

        // Preset selection
        document.querySelectorAll('.select-preset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const presetId = e.currentTarget.dataset.presetId;
                this.selectPreset(presetId);
            });
        });

        // View details
        document.querySelectorAll('.view-details').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const presetId = e.currentTarget.dataset.presetId;
                this.showPresetDetails(presetId);
            });
        });

        // Delete custom preset
        document.querySelectorAll('.delete-preset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const presetId = e.currentTarget.dataset.presetId;
                this.deleteCustomPreset(presetId);
            });
        });

        // Create custom preset
        document.getElementById('createCustomPreset')?.addEventListener('click', () => {
            this.showCustomPresetForm();
        });

        // Import preset
        document.getElementById('importPreset')?.addEventListener('click', () => {
            this.showImportDialog();
        });

        // Refresh
        document.getElementById('refreshPresets')?.addEventListener('click', () => {
            this.init();
        });

        // Modal close
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.target.closest('.modal').classList.add('hidden');
            });
        });
    }

    filterByCategory(category) {
        const cards = document.querySelectorAll('.preset-card');
        cards.forEach(card => {
            const presetId = card.dataset.presetId;
            const preset = this.presets[presetId] || this.customPresets[presetId];
            
            if (category === 'all') {
                card.style.display = 'block';
            } else if (category === 'custom') {
                card.style.display = preset.metadata?.custom ? 'block' : 'none';
            } else {
                card.style.display = preset.category === category ? 'block' : 'none';
            }
        });
    }

    filterBySearch(query) {
        const lowerQuery = query.toLowerCase();
        const cards = document.querySelectorAll('.preset-card');
        
        cards.forEach(card => {
            const presetId = card.dataset.presetId;
            const preset = this.presets[presetId] || this.customPresets[presetId];
            const searchText = `${preset.name} ${preset.description} ${preset.category}`.toLowerCase();
            card.style.display = searchText.includes(lowerQuery) ? 'block' : 'none';
        });
    }

    async selectPreset(presetId) {
        const preset = this.presets[presetId] || this.customPresets[presetId];
        if (!preset) return;

        this.selectedPreset = preset;
        
        // Highlight selected card
        document.querySelectorAll('.preset-card').forEach(card => {
            card.classList.remove('selected');
        });
        document.querySelector(`[data-preset-id="${presetId}"]`)?.classList.add('selected');

        // Notify parent component
        if (this.onPresetSelected) {
            this.onPresetSelected(preset);
        }

        // Apply preset to current floor plan
        await this.applyPreset(preset);
    }

    async applyPreset(preset) {
        try {
            const response = await fetch('/api/apply-preset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    preset: preset,
                    floorPlanId: window.currentFloorPlanId
                })
            });

            if (!response.ok) throw new Error('Failed to apply preset');
            
            const result = await response.json();
            console.log('Preset applied:', result);
            
            // Trigger UI update
            if (window.updateVisualization) {
                window.updateVisualization(result.layout);
            }
        } catch (error) {
            console.error('Error applying preset:', error);
            alert('Failed to apply preset. Please try again.');
        }
    }

    showPresetDetails(presetId) {
        const preset = this.presets[presetId] || this.customPresets[presetId];
        if (!preset) return;

        const modal = document.getElementById('presetDetailsModal');
        const content = document.getElementById('presetDetailsContent');
        
        content.innerHTML = `
            <h2>${preset.name}</h2>
            <p class="preset-category-badge">${preset.category}</p>
            <p>${preset.description}</p>
            
            <h3>Distribution</h3>
            <table class="distribution-table">
                <thead>
                    <tr>
                        <th>Area Range (m²)</th>
                        <th>Percentage</th>
                        <th>Visual</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(preset.distribution).map(([range, pct]) => `
                        <tr>
                            <td>${range}</td>
                            <td>${pct}%</td>
                            <td>
                                <div class="distribution-bar-inline">
                                    <div class="distribution-fill" style="width: ${pct}%"></div>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <h3>Configuration</h3>
            <table class="config-table">
                <tr>
                    <td>Corridor Width:</td>
                    <td>${preset.corridorWidth}m</td>
                </tr>
                <tr>
                    <td>Min Row Distance:</td>
                    <td>${preset.options?.minRowDistance || 'N/A'}m</td>
                </tr>
                <tr>
                    <td>Max Row Distance:</td>
                    <td>${preset.options?.maxRowDistance || 'N/A'}m</td>
                </tr>
                <tr>
                    <td>Min Overlap:</td>
                    <td>${preset.options?.minOverlap || 'N/A'}</td>
                </tr>
            </table>

            <h3>Metadata</h3>
            <table class="metadata-table">
                <tr>
                    <td>Author:</td>
                    <td>${preset.metadata?.author || 'Unknown'}</td>
                </tr>
                <tr>
                    <td>Created:</td>
                    <td>${preset.metadata?.created || 'Unknown'}</td>
                </tr>
                <tr>
                    <td>Version:</td>
                    <td>${preset.metadata?.version || 'N/A'}</td>
                </tr>
            </table>

            <div class="preset-detail-actions">
                <button class="btn-primary" onclick="presetSelector.selectPreset('${preset.id}')">
                    <i class="fas fa-check"></i> Apply This Preset
                </button>
                <button class="btn-secondary" onclick="presetSelector.clonePreset('${preset.id}')">
                    <i class="fas fa-clone"></i> Clone & Customize
                </button>
                <button class="btn-secondary" onclick="presetSelector.exportPreset('${preset.id}')">
                    <i class="fas fa-download"></i> Export JSON
                </button>
            </div>
        `;

        modal.classList.remove('hidden');
    }

    showCustomPresetForm(basePreset = null) {
        const modal = document.getElementById('customPresetModal');
        const form = document.getElementById('customPresetForm');
        
        const preset = basePreset || {
            name: '',
            description: '',
            category: 'Custom',
            distribution: { '0-10': 100 },
            corridorWidth: 1.8,
            options: {
                minRowDistance: 2.0,
                maxRowDistance: 8.0,
                minOverlap: 0.6
            }
        };

        form.innerHTML = `
            <h2>${basePreset ? 'Edit' : 'Create'} Custom Preset</h2>
            
            <div class="form-group">
                <label>Preset Name</label>
                <input type="text" id="presetName" value="${preset.name}" required>
            </div>

            <div class="form-group">
                <label>Description</label>
                <textarea id="presetDescription" required>${preset.description}</textarea>
            </div>

            <div class="form-group">
                <label>Category</label>
                <select id="presetCategory">
                    ${['Office', 'Hospitality', 'Industrial', 'Retail', 'Residential', 'Custom'].map(cat => `
                        <option value="${cat}" ${cat === preset.category ? 'selected' : ''}>${cat}</option>
                    `).join('')}
                </select>
            </div>

            <div class="form-group">
                <label>Corridor Width (m)</label>
                <input type="number" id="corridorWidth" value="${preset.corridorWidth}" step="0.1" min="1.0" max="5.0">
            </div>

            <h3>Distribution Ranges</h3>
            <div id="distributionRanges">
                ${Object.entries(preset.distribution).map(([range, pct], idx) => `
                    <div class="distribution-range-input" data-index="${idx}">
                        <input type="text" placeholder="0-10" value="${range}" class="range-input">
                        <input type="number" placeholder="%" value="${pct}" min="0" max="100" class="pct-input">
                        <button class="btn-icon remove-range" data-index="${idx}">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                `).join('')}
            </div>
            <button class="btn-secondary" id="addDistributionRange">
                <i class="fas fa-plus"></i> Add Range
            </button>
            <div class="distribution-total">Total: <span id="totalPercentage">100</span>%</div>

            <h3>Advanced Options</h3>
            <div class="form-group">
                <label>Min Row Distance (m)</label>
                <input type="number" id="minRowDistance" value="${preset.options.minRowDistance}" step="0.1">
            </div>
            <div class="form-group">
                <label>Max Row Distance (m)</label>
                <input type="number" id="maxRowDistance" value="${preset.options.maxRowDistance}" step="0.1">
            </div>
            <div class="form-group">
                <label>Min Overlap</label>
                <input type="number" id="minOverlap" value="${preset.options.minOverlap}" step="0.1" min="0" max="1">
            </div>

            <div class="form-actions">
                <button class="btn-primary" id="saveCustomPreset">
                    <i class="fas fa-save"></i> Save Preset
                </button>
                <button class="btn-secondary" onclick="document.getElementById('customPresetModal').classList.add('hidden')">
                    Cancel
                </button>
            </div>
        `;

        modal.classList.remove('hidden');
        this.attachCustomFormListeners();
    }

    attachCustomFormListeners() {
        // Add range
        document.getElementById('addDistributionRange')?.addEventListener('click', () => {
            const container = document.getElementById('distributionRanges');
            const idx = container.children.length;
            const div = document.createElement('div');
            div.className = 'distribution-range-input';
            div.dataset.index = idx;
            div.innerHTML = `
                <input type="text" placeholder="0-10" class="range-input">
                <input type="number" placeholder="%" min="0" max="100" class="pct-input">
                <button class="btn-icon remove-range" data-index="${idx}">
                    <i class="fas fa-times"></i>
                </button>
            `;
            container.appendChild(div);
            this.updateDistributionTotal();
        });

        // Remove range
        document.querySelectorAll('.remove-range').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.target.closest('.distribution-range-input').remove();
                this.updateDistributionTotal();
            });
        });

        // Update total on input
        document.querySelectorAll('.pct-input').forEach(input => {
            input.addEventListener('input', () => this.updateDistributionTotal());
        });

        // Save preset
        document.getElementById('saveCustomPreset')?.addEventListener('click', () => {
            this.saveCustomPreset();
        });
    }

    updateDistributionTotal() {
        const inputs = document.querySelectorAll('.pct-input');
        let total = 0;
        inputs.forEach(input => {
            total += parseFloat(input.value) || 0;
        });
        document.getElementById('totalPercentage').textContent = total.toFixed(1);
        document.getElementById('totalPercentage').style.color = 
            Math.abs(total - 100) < 0.1 ? 'green' : 'red';
    }

    async saveCustomPreset() {
        const name = document.getElementById('presetName').value;
        const description = document.getElementById('presetDescription').value;
        const category = document.getElementById('presetCategory').value;
        const corridorWidth = parseFloat(document.getElementById('corridorWidth').value);
        
        // Collect distribution
        const distribution = {};
        document.querySelectorAll('.distribution-range-input').forEach(div => {
            const range = div.querySelector('.range-input').value;
            const pct = parseFloat(div.querySelector('.pct-input').value);
            if (range && pct) {
                distribution[range] = pct;
            }
        });

        // Validate
        const total = Object.values(distribution).reduce((sum, val) => sum + val, 0);
        if (Math.abs(total - 100) > 0.1) {
            alert('Distribution percentages must total 100%');
            return;
        }

        const preset = {
            name,
            description,
            category,
            distribution,
            corridorWidth,
            options: {
                minRowDistance: parseFloat(document.getElementById('minRowDistance').value),
                maxRowDistance: parseFloat(document.getElementById('maxRowDistance').value),
                minOverlap: parseFloat(document.getElementById('minOverlap').value)
            },
            metadata: {
                custom: true,
                created: new Date().toISOString(),
                author: 'User'
            }
        };

        // Save locally
        const presetId = `custom-${Date.now()}`;
        preset.id = presetId;
        this.customPresets[presetId] = preset;
        this.saveCustomPresetsToStorage();

        // Close modal and refresh
        document.getElementById('customPresetModal').classList.add('hidden');
        this.render();
        this.attachEventListeners();
        
        alert('Custom preset saved successfully!');
    }

    clonePreset(presetId) {
        const preset = this.presets[presetId] || this.customPresets[presetId];
        if (!preset) return;

        const cloned = {
            ...JSON.parse(JSON.stringify(preset)),
            name: `${preset.name} (Copy)`,
            id: `custom-${Date.now()}`
        };
        
        this.showCustomPresetForm(cloned);
    }

    exportPreset(presetId) {
        const preset = this.presets[presetId] || this.customPresets[presetId];
        if (!preset) return;

        const json = JSON.stringify(preset, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${preset.id}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    showImportDialog() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const text = await file.text();
                const preset = JSON.parse(text);
                
                // Validate and add
                preset.id = `custom-${Date.now()}`;
                preset.metadata = preset.metadata || {};
                preset.metadata.custom = true;
                preset.metadata.imported = new Date().toISOString();
                
                this.customPresets[preset.id] = preset;
                this.saveCustomPresetsToStorage();
                
                this.render();
                this.attachEventListeners();
                alert('Preset imported successfully!');
            } catch (error) {
                alert('Failed to import preset: ' + error.message);
            }
        };
        input.click();
    }

    deleteCustomPreset(presetId) {
        if (!confirm('Are you sure you want to delete this custom preset?')) return;
        
        delete this.customPresets[presetId];
        this.saveCustomPresetsToStorage();
        this.render();
        this.attachEventListeners();
    }

    saveCustomPresetsToStorage() {
        localStorage.setItem('floorplan-custom-presets', JSON.stringify(this.customPresets));
    }

    loadCustomPresetsFromStorage() {
        try {
            const stored = localStorage.getItem('floorplan-custom-presets');
            return stored ? JSON.parse(stored) : {};
        } catch (error) {
            console.error('Failed to load custom presets:', error);
            return {};
        }
    }

    getCategoryIcon(category) {
        const icons = {
            'Office': 'fas fa-building',
            'Hospitality': 'fas fa-hotel',
            'Industrial': 'fas fa-industry',
            'Retail': 'fas fa-shopping-cart',
            'Residential': 'fas fa-home',
            'Custom': 'fas fa-star'
        };
        return icons[category] || 'fas fa-cube';
    }

    getPresetIcon(category) {
        return this.getCategoryIcon(category);
    }

    getDefaultPresets() {
        return {
            'modern-office': {
                id: 'modern-office',
                name: 'Modern Office',
                description: 'Typical office building with mix of private offices and open spaces',
                category: 'Office',
                distribution: { '0-2': 5, '2-4': 15, '4-8': 45, '8-15': 25, '15-30': 10 },
                corridorWidth: 1.8,
                options: { minRowDistance: 2.0, maxRowDistance: 8.0, minOverlap: 0.6 }
            }
        };
    }
}

// Export for use in main app
window.PresetSelector = PresetSelector;
