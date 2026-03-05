#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const sharp = require('sharp');

const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.SMOKE_PORT || 3105);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TEST_DXF = path.join(ROOT, 'Samples', 'Test2.dxf');
const REFERENCE_DIR = path.join(ROOT, 'Reference Output Examples');
const REFERENCE_VISUAL_BASELINE = path.join(REFERENCE_DIR, 'Expected output MUST.jpg');

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

function classifyColors(samples) {
    const pixelCount = Math.floor(samples.length / 3);
    const counts = {
        green: 0,
        blue: 0,
        red: 0,
        black: 0,
        white: 0,
        nonWhite: 0
    };

    for (let i = 0; i < pixelCount * 3; i += 3) {
        const r = samples[i];
        const g = samples[i + 1];
        const b = samples[i + 2];

        if (g > 130 && r < 140 && b < 140) counts.green += 1;
        if (b > 130 && r < 140 && g < 160) counts.blue += 1;
        if (r > 140 && g < 120 && b < 120) counts.red += 1;
        if (r < 80 && g < 80 && b < 80) counts.black += 1;

        if (r > 230 && g > 230 && b > 230) {
            counts.white += 1;
        } else {
            counts.nonWhite += 1;
        }
    }

    const total = pixelCount > 0 ? pixelCount : 1;
    return {
        pixelCount,
        ratios: {
            green: counts.green / total,
            blue: counts.blue / total,
            red: counts.red / total,
            black: counts.black / total,
            white: counts.white / total,
            nonWhite: counts.nonWhite / total
        }
    };
}

function lumaAt(samples, idx) {
    return ((77 * samples[idx]) + (150 * samples[idx + 1]) + (29 * samples[idx + 2])) >> 8;
}

function estimateEdgeDensity(samples, width, height, step = 2, edgeThreshold = 28) {
    if (width <= step || height <= step) return 0;
    const stride = width * 3;
    let edges = 0;
    let comparisons = 0;

    for (let y = 0; y < height - step; y += step) {
        const row = y * stride;
        const rowDown = (y + step) * stride;
        for (let x = 0; x < width - step; x += step) {
            const idx = row + (x * 3);
            const idxRight = row + ((x + step) * 3);
            const idxDown = rowDown + (x * 3);
            const here = lumaAt(samples, idx);
            const right = lumaAt(samples, idxRight);
            const down = lumaAt(samples, idxDown);
            if (Math.abs(here - right) > edgeThreshold || Math.abs(here - down) > edgeThreshold) {
                edges += 1;
            }
            comparisons += 1;
        }
    }

    return comparisons > 0 ? (edges / comparisons) : 0;
}

async function readRawRgb(imagePath, width, height) {
    const { data, info } = await sharp(imagePath)
        .rotate()
        .resize(width, height, {
            fit: 'fill',
            kernel: sharp.kernel.lanczos3
        })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    return { data, width: info.width, height: info.height };
}

async function runReferenceVisualRegression(generatedImagePath, referenceImagePath, outputPath) {
    if (!fs.existsSync(referenceImagePath)) {
        throw new Error(`Reference visual baseline not found: ${referenceImagePath}`);
    }
    if (!fs.existsSync(generatedImagePath)) {
        throw new Error(`Generated screenshot not found: ${generatedImagePath}`);
    }

    const meta = await sharp(generatedImagePath).metadata();
    const width = Math.max(320, Number(meta.width) || 1600);
    const height = Math.max(240, Number(meta.height) || 900);

    const generated = await readRawRgb(generatedImagePath, width, height);
    const reference = await readRawRgb(referenceImagePath, width, height);

    let absSum = 0;
    let sqSum = 0;
    for (let i = 0; i < generated.data.length; i += 1) {
        const d = generated.data[i] - reference.data[i];
        absSum += Math.abs(d);
        sqSum += (d * d);
    }

    const totalChannels = generated.data.length || 1;
    const mae = absSum / totalChannels;
    const rmse = Math.sqrt(sqSum / totalChannels);
    const similarity = Math.max(0, 1 - (mae / 255));

    const generatedStats = classifyColors(generated.data);
    const referenceStats = classifyColors(reference.data);
    const generatedEdgeDensity = estimateEdgeDensity(generated.data, generated.width, generated.height);
    const referenceEdgeDensity = estimateEdgeDensity(reference.data, reference.width, reference.height);

    const thresholds = {
        // Intentionally broad: capture-source mismatch (canvas screenshot vs golden render) is tolerated,
        // while still failing gross visual breakage in CI.
        minSimilarity: 0.42,
        maxMae: 148,
        maxNonWhiteDelta: 0.36,
        maxEdgeDensityDelta: 0.14,
        minBlueRatio: 0.0008,
        minGreenRatio: 0.00002
    };

    const deltas = {
        nonWhiteDelta: Math.abs(generatedStats.ratios.nonWhite - referenceStats.ratios.nonWhite),
        edgeDensityDelta: Math.abs(generatedEdgeDensity - referenceEdgeDensity),
        blueRatioDelta: Math.abs(generatedStats.ratios.blue - referenceStats.ratios.blue),
        greenRatioDelta: Math.abs(generatedStats.ratios.green - referenceStats.ratios.green)
    };

    const checks = {
        similarityMinimum: similarity >= thresholds.minSimilarity,
        maeWithinLimit: mae <= thresholds.maxMae,
        nonWhiteDeltaWithinLimit: deltas.nonWhiteDelta <= thresholds.maxNonWhiteDelta,
        edgeDensityDeltaWithinLimit: deltas.edgeDensityDelta <= thresholds.maxEdgeDensityDelta,
        hasReferenceBlueStructure: generatedStats.ratios.blue >= thresholds.minBlueRatio,
        hasReferenceGreenBorderSignal: generatedStats.ratios.green >= thresholds.minGreenRatio
    };

    const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    const report = {
        referenceImagePath: path.resolve(referenceImagePath),
        generatedImagePath: path.resolve(generatedImagePath),
        width,
        height,
        metrics: {
            mae,
            rmse,
            similarity,
            generatedEdgeDensity,
            referenceEdgeDensity,
            ...deltas
        },
        generated: {
            colorRatios: generatedStats.ratios
        },
        reference: {
            colorRatios: referenceStats.ratios
        },
        thresholds,
        checks,
        aggregate: {
            passed: failedChecks.length === 0,
            failedChecks
        }
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    return report;
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
        await page.addStyleTag({ content: '*{animation:none !important; transition:none !important;}' }).catch(() => {});
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

        const referenceModeApplied = await page.evaluate(() => {
            if (typeof window.applyReferenceLayoutOverlay === 'function') {
                window.applyReferenceLayoutOverlay();
                return true;
            }
            return false;
        });
        if (!referenceModeApplied) {
            throw new Error('applyReferenceLayoutOverlay() not found; cannot run reference-mode visual regression');
        }
        await page.click('#fitViewBtn');
        await sleep(900);

        const referenceModeScreenshotPath = path.join(ROOT, 'Samples', 'Test2_Output', 'playwright_reference_mode_smoke.png');
        const visualRegressionReportPath = path.join(ROOT, 'exports', 'playwright_reference_visual_regression.json');
        fs.mkdirSync(path.dirname(referenceModeScreenshotPath), { recursive: true });
        await page.locator('#threeContainer').screenshot({ path: referenceModeScreenshotPath });

        const skipVisualAssert = process.env.SMOKE_SKIP_VISUAL_ASSERT === '1';
        let visualRegression = null;
        if (!skipVisualAssert) {
            visualRegression = await runReferenceVisualRegression(
                referenceModeScreenshotPath,
                REFERENCE_VISUAL_BASELINE,
                visualRegressionReportPath
            );
            if (!visualRegression.aggregate.passed) {
                throw new Error(`Reference visual regression failed: ${visualRegression.aggregate.failedChecks.join(', ')}`);
            }
        }

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
            screenshotPath,
            referenceModeScreenshotPath,
            visualRegressionReportPath,
            visualRegression,
            visualRegressionSkipped: skipVisualAssert
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
