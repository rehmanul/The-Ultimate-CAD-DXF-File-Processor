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
        this.preferencesKey = 'fp-preset-preferences';
        this.preferences = this.loadPreferences();
        this.sortOption = this.preferences.sortOption || 'recommended';
        this.activeCategory = this.preferences.activeCategory || 'all';
        this.lastUsedPresetId = this.preferences.lastUsedPresetId || null;
        this.usageHistory = this.preferences.usageHistory || {};
        this.searchQuery = '';
        this.gridEl = null;
        this.searchInput = null;
        this.sortSelect = null;
        this.countEl = null;
        this.tabEls = [];
        this.init();
    }

    async init() {
        await this.loadPresets();
        this.render();
        this.attachEventListeners();
        this.updatePresetGrid();
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
        this.ensureValidCategory();
        const sortOptions = [
            { value: 'recommended', label: 'Recommended' },
            { value: 'name', label: 'Name (A-Z)' },
            { value: 'category', label: 'Category' },
            { value: 'usage', label: 'Recently used' }
        ];

        this.container.innerHTML = `
            <div class="preset-selector-panel">
                <div class="preset-header">
                    <div class="preset-header-title">
                        <h3><i class="fas fa-layer-group"></i> Distribution Presets</h3>
                        <p>Dial in deterministic îlot mixes, corridor widths, and layout heuristics by program type.</p>
                    </div>
                    <div class="preset-header-actions">
                        <span class="preset-count" id="presetCount">0 presets</span>
                        <div class="preset-header-buttons">
                            <button class="btn-icon" id="refreshPresets" title="Refresh presets">
                                <i class="fas fa-sync-alt"></i>
                            </button>
                        </div>
                    </div>
                </div>

                <div class="preset-tabs" role="tablist">
                    <button class="preset-tab ${this.activeCategory === 'all' ? 'active' : ''}" data-category="all" role="tab">
                        <i class="fas fa-th"></i> All
                    </button>
                    ${this.categories.map(cat => `
                        <button class="preset-tab ${this.activeCategory === cat ? 'active' : ''}" data-category="${cat}" role="tab">
                            <i class="${this.getCategoryIcon(cat)}"></i> ${cat}
                        </button>
                    `).join('')}
                    <button class="preset-tab ${this.activeCategory === 'custom' ? 'active' : ''}" data-category="custom" role="tab">
                        <i class="fas fa-star"></i> Custom
                    </button>
                </div>

                <div class="preset-toolbar">
                    <div class="preset-search">
                        <input type="text" id="presetSearch" placeholder="Search presets..." value="${this.escapeHtml(this.searchQuery)}">
                        <i class="fas fa-search"></i>
                    </div>
                    <div class="preset-sort">
                        <label for="presetSort">Sort</label>
                        <select id="presetSort">
                            ${sortOptions.map(option => `
                                <option value="${option.value}" ${this.sortOption === option.value ? 'selected' : ''}>${option.label}</option>
                            `).join('')}
                        </select>
                    </div>
                </div>

                <div class="preset-viewport">
                    <div class="preset-grid" id="presetGrid"></div>
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

        this.cacheDomReferences();
    }

    renderPresetCards(presets = []) {
        if (!Array.isArray(presets) || presets.length === 0) {
            return this.renderEmptyState();
        }

        return presets.map(preset => {
            const isSelected = this.selectedPreset?.id === preset.id;
            const isCustom = !!preset.metadata?.custom;
            const isLastUsed = this.lastUsedPresetId === preset.id;
            const usageTimestamp = this.usageHistory?.[preset.id];
            const usageLabel = usageTimestamp ? this.formatRelativeTime(usageTimestamp) : null;
            const distributionStats = Object.keys(preset.distribution || {}).length;
            const corridorWidth = typeof preset.corridorWidth === 'number' ? `${preset.corridorWidth}m corridor` : 'Corridor tuned';

            return `
                <div class="preset-card${isSelected ? ' selected' : ''}${isCustom ? ' preset-card--custom' : ''}${isLastUsed ? ' preset-card--recent' : ''}" data-preset-id="${preset.id}">
                    <div class="preset-card-badges">
                        ${isLastUsed ? `<span class="preset-tag preset-tag--active"><i class="fas fa-clock"></i> Last used ${usageLabel || 'just now'}</span>` : ''}
                        ${isCustom ? `<span class="preset-tag preset-tag--custom"><i class="fas fa-star"></i> Custom</span>` : ''}
                        ${isSelected ? `<span class="preset-tag preset-tag--selected"><i class="fas fa-check"></i> Active</span>` : ''}
                    </div>
                    <div class="preset-card-header">
                        <div class="preset-icon">
                            <i class="${this.getPresetIcon(preset.category)}"></i>
                        </div>
                        <div class="preset-card-title">
                            <h4 class="preset-name">${preset.name}</h4>
                            <span class="preset-category">${preset.category}</span>
                        </div>
                    </div>
                    <p class="preset-description">${preset.description}</p>
                    <div class="preset-stats">
                        <div class="preset-stat">
                            <i class="fas fa-cubes"></i>
                            <span>${distributionStats} ranges</span>
                        </div>
                        <div class="preset-stat">
                            <i class="fas fa-road"></i>
                            <span>${corridorWidth}</span>
                        </div>
                    </div>
                    <div class="preset-distribution-preview">
                        ${this.renderDistributionBars(preset.distribution)}
                    </div>
                    <div class="preset-meta">
                        ${usageLabel ? `<span class="preset-meta-item"><i class="fas fa-history"></i> ${usageLabel}</span>` : ''}
                        ${preset.metadata?.author ? `<span class="preset-meta-item"><i class="fas fa-user"></i> ${preset.metadata.author}</span>` : ''}
                    </div>
                    <div class="preset-actions">
                        <button class="btn-small btn-primary select-preset" data-preset-id="${preset.id}">
                            <i class="fas fa-check"></i> Select
                        </button>
                        <button class="btn-small btn-secondary view-details" data-preset-id="${preset.id}">
                            <i class="fas fa-info-circle"></i> Details
                        </button>
                        ${isCustom ? `
                            <button class="btn-small btn-danger delete-preset" data-preset-id="${preset.id}">
                                <i class="fas fa-trash"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    renderDistributionBars(distribution = {}) {
        const entries = Object.entries(distribution);
        if (!entries.length) {
            return `<div class="distribution-empty">No ranges defined</div>`;
        }

        const normalized = entries.map(([range, value]) => {
            let percentage = Number(value);
            if (Number.isNaN(percentage)) percentage = 0;
            if (percentage <= 1.05) {
                percentage = percentage * 100;
            }
            return {
                range,
                percentage: Math.max(0, Math.round(percentage))
            };
        }).sort((a, b) => {
            const aMin = parseFloat(a.range.split('-')[0]);
            const bMin = parseFloat(b.range.split('-')[0]);
            return aMin - bMin;
        });

        const maxValue = normalized.reduce((max, item) => Math.max(max, item.percentage), 0);

        return normalized.map(({ range, percentage }) => {
            const width = Math.min(Math.max(percentage, 4), 100);
            const dominantClass = percentage === maxValue ? ' dominant' : '';
            return `
                <div class="distribution-bar${dominantClass}" title="${range} m²: ${percentage}%">
                    <div class="distribution-bar-track">
                        <div class="distribution-fill${dominantClass}" style="width: ${width}%"></div>
                    </div>
                    <span class="distribution-label">${range} m²</span>
                    <span class="distribution-value">${percentage}%</span>
                </div>
            `;
        }).join('');
    }

    cacheDomReferences() {
        this.gridEl = this.container.querySelector('#presetGrid');
        this.searchInput = this.container.querySelector('#presetSearch');
        this.sortSelect = this.container.querySelector('#presetSort');
        this.countEl = this.container.querySelector('#presetCount');
        this.tabEls = Array.from(this.container.querySelectorAll('.preset-tab'));
    }

    attachEventListeners() {
        this.tabEls.forEach(tab => {
            tab.addEventListener('click', (event) => {
                event.preventDefault();
                const category = event.currentTarget.dataset.category;
                this.filterByCategory(category);
            });
        });

        if (this.searchInput) {
            this.searchInput.addEventListener('input', (event) => {
                this.filterBySearch(event.target.value || '');
            });
        }

        if (this.sortSelect) {
            this.sortSelect.addEventListener('change', (event) => {
                this.sortOption = event.target.value || 'recommended';
                this.savePreferences({ sortOption: this.sortOption });
                this.updatePresetGrid();
            });
        }

        const refreshBtn = this.container.querySelector('#refreshPresets');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.classList.add('is-rotating');
                try {
                    await this.loadPresets();
                    this.render();
                    this.attachEventListeners();
                    this.updatePresetGrid();
                } finally {
                    setTimeout(() => refreshBtn.classList.remove('is-rotating'), 600);
                }
            });
        }

        this.container.querySelector('#createCustomPreset')?.addEventListener('click', () => {
            this.showCustomPresetForm();
        });

        this.container.querySelector('#importPreset')?.addEventListener('click', () => {
            this.showImportDialog();
        });

        this.container.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', (event) => {
                event.preventDefault();
                event.currentTarget.closest('.modal')?.classList.add('hidden');
            });
        });
    }

    updatePresetGrid() {
        if (!this.gridEl) return;
        const presets = this.getVisiblePresets();
        this.gridEl.innerHTML = this.renderPresetCards(presets);
        this.updatePresetMetrics(presets.length);
        this.bindCardEventHandlers();
    }

    getVisiblePresets() {
        const allPresets = { ...(this.presets || {}), ...(this.customPresets || {}) };
        let list = Object.values(allPresets);

        if (this.activeCategory === 'custom') {
            list = list.filter(preset => preset.metadata?.custom);
        } else if (this.activeCategory !== 'all') {
            list = list.filter(preset => preset.category === this.activeCategory);
        }

        const normalizedQuery = (this.searchQuery || '').trim().toLowerCase();
        if (normalizedQuery) {
            list = list.filter(preset => {
                const haystack = `${preset.name} ${preset.description} ${preset.category}`.toLowerCase();
                return haystack.includes(normalizedQuery);
            });
        }

        return this.sortPresets(list);
    }

    sortPresets(presets) {
        const list = Array.isArray(presets) ? [...presets] : [];
        const categoryOrder = this.categories || [];
        switch (this.sortOption) {
            case 'name':
                return list.sort((a, b) => a.name.localeCompare(b.name));
            case 'category':
                return list.sort((a, b) => {
                    const aIndex = categoryOrder.indexOf(a.category);
                    const bIndex = categoryOrder.indexOf(b.category);
                    if (aIndex !== bIndex) {
                        if (aIndex === -1) return 1;
                        if (bIndex === -1) return -1;
                        return aIndex - bIndex;
                    }
                    return a.name.localeCompare(b.name);
                });
            case 'usage':
                return list.sort((a, b) => {
                    const usageA = this.usageHistory?.[a.id] || 0;
                    const usageB = this.usageHistory?.[b.id] || 0;
                    if (usageA === usageB) {
                        return a.name.localeCompare(b.name);
                    }
                    return usageB - usageA;
                });
            case 'recommended':
            default:
                return list.sort((a, b) => {
                    const lastUsedA = a.id === this.lastUsedPresetId ? 1 : 0;
                    const lastUsedB = b.id === this.lastUsedPresetId ? 1 : 0;
                    if (lastUsedA !== lastUsedB) return lastUsedB - lastUsedA;

                    const customA = a.metadata?.custom ? 1 : 0;
                    const customB = b.metadata?.custom ? 1 : 0;
                    if (customA !== customB) return customA - customB;

                    const priorityA = a.metadata?.priority ?? 999;
                    const priorityB = b.metadata?.priority ?? 999;
                    if (priorityA !== priorityB) return priorityA - priorityB;

                    const updatedA = Date.parse(a.metadata?.updated || a.metadata?.created || 0) || 0;
                    const updatedB = Date.parse(b.metadata?.updated || b.metadata?.created || 0) || 0;
                    if (updatedA !== updatedB) return updatedB - updatedA;

                    return a.name.localeCompare(b.name);
                });
        }
    }

    updatePresetMetrics(count) {
        if (!this.countEl) return;
        const noun = count === 1 ? 'preset' : 'presets';
        const label = this.getSortLabel();
        this.countEl.textContent = `${count} ${noun} · ${label}`;
    }

    getSortLabel() {
        switch (this.sortOption) {
            case 'name':
                return 'Name A–Z';
            case 'category':
                return 'Grouped by category';
            case 'usage':
                return 'Recently used';
            case 'recommended':
            default:
                return 'Recommended';
        }
    }

    bindCardEventHandlers() {
        this.container.querySelectorAll('.select-preset').forEach(btn => {
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                const presetId = event.currentTarget.dataset.presetId;
                this.selectPreset(presetId);
            });
        });

        this.container.querySelectorAll('.view-details').forEach(btn => {
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                const presetId = event.currentTarget.dataset.presetId;
                this.showPresetDetails(presetId);
            });
        });

        this.container.querySelectorAll('.delete-preset').forEach(btn => {
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                const presetId = event.currentTarget.dataset.presetId;
                this.deleteCustomPreset(presetId);
            });
        });
    }

    filterByCategory(category) {
        this.activeCategory = category || 'all';
        this.savePreferences({ activeCategory: this.activeCategory });
        this.updateActiveTab();
        this.updatePresetGrid();
    }

    filterBySearch(query) {
        this.searchQuery = query;
        this.updatePresetGrid();
    }

    updateActiveTab() {
        this.tabEls.forEach(tab => {
            const isActive = tab.dataset.category === this.activeCategory;
            tab.classList.toggle('active', isActive);
        });
    }

    renderEmptyState() {
        return `
            <div class="preset-empty">
                <i class="fas fa-inbox"></i>
                <h4>No presets match the current filters</h4>
                <p>Try a different category or clear the search to see more options.</p>
            </div>
        `;
    }

    formatRelativeTime(timestamp) {
        if (!timestamp) return '';
        const diff = Date.now() - timestamp;
        if (diff <= 0) return 'just now';
        const minutes = Math.round(diff / 60000);
        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes} min ago`;
        const hours = Math.round(minutes / 60);
        if (hours < 24) return `${hours} h ago`;
        const days = Math.round(hours / 24);
        if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`;
        const months = Math.round(days / 30);
        if (months < 12) return `${months} mo ago`;
        const years = Math.round(months / 12);
        return `${years} yr${years > 1 ? 's' : ''} ago`;
    }

    ensureValidCategory() {
        if (
            this.activeCategory !== 'all' &&
            this.activeCategory !== 'custom' &&
            !this.categories.includes(this.activeCategory)
        ) {
            this.activeCategory = 'all';
        }
    }

    escapeHtml(value) {
        if (typeof value !== 'string') return '';
        return value.replace(/[&<>"']/g, (char) => {
            const map = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                '\'': '&#039;'
            };
            return map[char] || char;
        });
    }

    loadPreferences() {
        if (typeof window === 'undefined') {
            return {};
        }
        try {
            const raw = window.localStorage.getItem(this.preferencesKey);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return typeof parsed === 'object' && parsed !== null ? parsed : {};
        } catch (error) {
            console.warn('Failed to load preset preferences', error);
            return {};
        }
    }

    savePreferences(patch) {
        this.preferences = {
            ...(this.preferences || {}),
            ...(patch || {})
        };
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(this.preferencesKey, JSON.stringify(this.preferences));
        } catch (error) {
            console.warn('Failed to persist preset preferences', error);
        }
    }

    recordPresetUsage(presetId) {
        if (!presetId) return;
        const usageHistory = { ...(this.preferences?.usageHistory || {}) };
        usageHistory[presetId] = Date.now();
        this.lastUsedPresetId = presetId;
        this.usageHistory = usageHistory;
        this.savePreferences({
            lastUsedPresetId: presetId,
            usageHistory
        });
    }

    hydrateSelection(presetId) {
        if (!presetId) return;
        const preset = (this.presets && this.presets[presetId]) || this.customPresets[presetId];
        if (!preset) return;
        this.selectedPreset = preset;
        this.updatePresetGrid();
    }

    }

    async selectPreset(presetId) {
        const preset = (this.presets && this.presets[presetId]) || this.customPresets[presetId];
        if (!preset) return;

        this.selectedPreset = preset;
        this.recordPresetUsage(preset.id);
        this.updatePresetGrid();

        if (this.onPresetSelected) {
            this.onPresetSelected(preset);
        }

        await this.applyPreset(preset);
    }

    async applyPreset() {
        // API-based preset application is not wired yet; local regeneration handles the change.
        console.info('[PresetSelector] Preset applied locally (server sync skipped).');
        return;
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
        this.activeCategory = 'custom';
        this.selectedPreset = preset;
        this.recordPresetUsage(presetId);
        this.savePreferences({ activeCategory: 'custom' });
        this.render();
        this.attachEventListeners();
        this.updatePresetGrid();

        if (typeof window !== 'undefined' && typeof window.showNotification === 'function') {
            window.showNotification(`Preset "${preset.name}" saved`, 'success');
        } else {
            alert('Custom preset saved successfully!');
        }
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
                this.updatePresetGrid();
                if (typeof window !== 'undefined' && typeof window.showNotification === 'function') {
                    window.showNotification(`Preset "${preset.name}" imported`, 'success');
                } else {
                    alert('Preset imported successfully!');
                }
            } catch (error) {
                const message = 'Failed to import preset: ' + error.message;
                if (typeof window !== 'undefined' && typeof window.showNotification === 'function') {
                    window.showNotification(message, 'error');
                } else {
                    alert(message);
                }
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
        this.updatePresetGrid();
        if (typeof window !== 'undefined' && typeof window.showNotification === 'function') {
            window.showNotification('Custom preset removed.', 'info');
        }
    }

    saveCustomPresetsToStorage() {
        if (typeof window === 'undefined' || !window.localStorage) return;
        window.localStorage.setItem('floorplan-custom-presets', JSON.stringify(this.customPresets));
    }

    loadCustomPresetsFromStorage() {
        if (typeof window === 'undefined' || !window.localStorage) {
            return {};
        }
        try {
            const stored = window.localStorage.getItem('floorplan-custom-presets');
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
