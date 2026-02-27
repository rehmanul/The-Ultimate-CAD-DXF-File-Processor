#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.SMOKE_PORT || 3105);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TEST_DXF = path.join(ROOT, 'Samples', 'Test2.dxf');

function resolveChromiumExecutable() {
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE && fs.existsSync(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)) {
        return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
    }
    const base = process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'ms-playwright')
        : null;
    if (!base || !fs.existsSync(base)) return null;
    const candidates = fs.readdirSync(base)
        .filter((name) => name.startsWith('chromium-'))
        .sort((a, b) => b.localeCompare(a));
    for (const candidate of candidates) {
        const exe = path.join(base, candidate, 'chrome-win64', 'chrome.exe');
        if (fs.existsSync(exe)) return exe;
    }
    return null;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 120000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(`${url}/health`);
            if (res.ok) return;
        } catch (err) {
            // retry
        }
        await sleep(1000);
    }
    throw new Error(`Server not ready at ${url} within ${timeoutMs}ms`);
}

async function waitForNonZeroValue(page, getterExpr, timeoutMs = 300000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const numeric = await page.evaluate(getterExpr);
        if (Number.isFinite(numeric) && numeric > 0) return numeric;
        await sleep(1000);
    }
    throw new Error('Timed out waiting for non-zero numeric value');
}

async function runSmoke() {
    const server = spawn('node', ['server.js'], {
        cwd: ROOT,
        env: {
            ...process.env,
            PORT: String(PORT),
            NODE_ENV: 'production'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    server.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
    server.stderr.on('data', (chunk) => process.stderr.write(`[server-err] ${chunk}`));

    let browser;
    let context;

    try {
        await waitForServer(BASE_URL, 120000);

        const chromiumExecutable = resolveChromiumExecutable();
        browser = await chromium.launch({
            headless: true,
            executablePath: chromiumExecutable || undefined
        });
        context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
        const page = await context.newPage();

        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#uploadBtn', { timeout: 60000 });
        await page.waitForSelector('#fileInput', { state: 'attached', timeout: 60000 });
        await page.setInputFiles('#fileInput', TEST_DXF);

        await page.waitForFunction(() => {
            const debug = window.__floorplanDebug;
            return !!debug && debug.hasFloorPlan && debug.hasFloorPlan();
        }, { timeout: 300000 });

        await page.click('#generateIlotsBtn');
        const ilotCount = await waitForNonZeroValue(page, () => {
            const debug = window.__floorplanDebug;
            if (!debug || typeof debug.ilotCount !== 'function') return 0;
            return Number(debug.ilotCount()) || 0;
        }, 300000);

        const fitClicked = await page.evaluate(() => {
            const btn = document.getElementById('fitViewBtn');
            if (!btn) return false;
            btn.click();
            return true;
        });
        if (!fitClicked) {
            throw new Error('fitViewBtn not found/clickable');
        }

        const gridState1 = await page.evaluate(() => (window.__floorplanDebug ? window.__floorplanDebug.isGridVisible() : null));
        await page.click('#gridToggleBtn');
        await sleep(300);
        const gridState2 = await page.evaluate(() => (window.__floorplanDebug ? window.__floorplanDebug.isGridVisible() : null));
        await page.click('#gridToggleBtn');
        await sleep(300);
        const gridState3 = await page.evaluate(() => (window.__floorplanDebug ? window.__floorplanDebug.isGridVisible() : null));

        const modeBefore = await page.evaluate(() => (window.__floorplanDebug ? window.__floorplanDebug.is3DMode() : null));
        await page.click('#toggle3DBtn');
        await sleep(400);
        const modeAfter = await page.evaluate(() => (window.__floorplanDebug ? window.__floorplanDebug.is3DMode() : null));

        if (modeBefore === modeAfter) {
            throw new Error(`3D toggle did not change mode (before=${modeBefore}, after=${modeAfter})`);
        }
        const gridChangedAtLeastOnce = (gridState2 !== gridState1) || (gridState3 !== gridState2);
        if (!gridChangedAtLeastOnce) {
            throw new Error(`Grid toggle did not change state across two clicks (s1=${gridState1}, s2=${gridState2}, s3=${gridState3})`);
        }

        // Return to 2D and fit before snapshot.
        if (modeAfter === true) {
            await page.click('#toggle3DBtn');
            await sleep(300);
        }
        await page.click('#fitViewBtn');
        await sleep(300);

        const rendererInfo = await page.evaluate(() => (window.__floorplanDebug ? window.__floorplanDebug.getRendererInfo() : null));
        const corridorCount = await page.evaluate(() => (window.__floorplanDebug ? window.__floorplanDebug.corridorCount() : null));
        const flowPathCount = await page.evaluate(() => (window.__floorplanDebug ? window.__floorplanDebug.flowPathCount() : null));
        const flowArrowCount = await page.evaluate(() => (window.__floorplanDebug ? window.__floorplanDebug.flowArrowCount() : null));
        const renderedFlowStats = await page.evaluate(() => (window.__floorplanDebug ? window.__floorplanDebug.renderedFlowStats() : null));
        const screenshotPath = path.join(ROOT, 'Samples', 'Test2_Output', 'playwright_smoke_after_patch.png');
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
        await page.screenshot({ path: screenshotPath, fullPage: true });

        console.log(JSON.stringify({
            success: true,
            baseUrl: BASE_URL,
            ilotCount,
            corridorCount,
            modeBefore,
            modeAfter,
            gridStateBefore: gridState1,
            gridStateAfterFirstToggle: gridState2,
            gridStateAfterSecondToggle: gridState3,
            flowPathCount,
            flowArrowCount,
            renderedFlowStats,
            rendererInfo,
            screenshotPath
        }, null, 2));
    } finally {
        if (context) await context.close().catch(() => {});
        if (browser) await browser.close().catch(() => {});
        if (server && !server.killed) {
            server.kill('SIGTERM');
        }
    }
}

runSmoke().catch((error) => {
    console.error(JSON.stringify({
        success: false,
        error: error && error.message ? error.message : String(error)
    }, null, 2));
    process.exit(1);
});
