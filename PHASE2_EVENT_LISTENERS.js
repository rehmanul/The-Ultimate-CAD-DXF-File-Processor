/**
 * Phase 2: Additional Event Listeners for Distribution System
 * Add this to the end of initializeModules() function in app.js
 */

// Phase 2: Distribution input event listeners
document.querySelectorAll('.distribution-input').forEach(input => {
    input.addEventListener('input', () => {
        updateDistributionTotal();
    });
});

// Apply distribution button
const applyDistributionBtn = document.getElementById('applyDistributionBtn');
if (applyDistributionBtn) {
    applyDistributionBtn.addEventListener('click', () => {
        if (currentFloorPlan) {
            showNotification('Distribution updated. Regenerate îlots to apply changes.', 'info');
        } else {
            showNotification('Please upload a floor plan first.', 'warning');
        }
    });
}

// Corridor width slider
const corridorWidthSlider = document.getElementById('corridorWidthSlider');
const corridorWidthValue = document.getElementById('corridorWidthValue');
if (corridorWidthSlider && corridorWidthValue) {
    corridorWidthSlider.addEventListener('input', (e) => {
        corridorWidthValue.textContent = e.target.value + 'm';
    });
}

// Initialize distribution total on load
updateDistributionTotal();
