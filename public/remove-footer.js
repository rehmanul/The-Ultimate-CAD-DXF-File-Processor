// REMOVE FOOTER IMMEDIATELY
document.addEventListener('DOMContentLoaded', () => {
    const processingStatus = document.getElementById('processingStatus');
    const processingStatusH4 = document.querySelector('h4:has(+ #processingStatus)');
    
    if (processingStatus) processingStatus.remove();
    if (processingStatusH4 && processingStatusH4.textContent.includes('Processing Status')) {
        processingStatusH4.remove();
    }
    
    // Also hide via CSS
    const style = document.createElement('style');
    style.textContent = `
        #processingStatus,
        .processing-status,
        .circular-progress-small,
        h4:has(+ .processing-status) {
            display: none !important;
            visibility: hidden !important;
            height: 0 !important;
            overflow: hidden !important;
        }
    `;
    document.head.appendChild(style);
});
