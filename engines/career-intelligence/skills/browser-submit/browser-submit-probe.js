#!/usr/bin/env node
// browser-submit-probe.js — kinetic probe for Playwright persistent-profile + screenshot pipeline
// Usage: node browser-submit-probe.js <url> [screenshot-name]
//   e.g. node browser-submit-probe.js https://httpbin.org/html probe-httpbin.png
//
// Uses ~/Library/Caches/twc-playwright-profile as the persistent user-data-dir.
// First run: empty profile; you'll need to log into ATS sites manually once.
// Subsequent runs: cookies + SSO tokens persist; Playwright is authenticated.

const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');

const USER_DATA_DIR = path.join(os.homedir(), 'Library/Caches/twc-playwright-profile');
const OUT_DIR = path.join(os.homedir(), 'cyborg/scripts/browser-probe-output');

async function main() {
  const url = process.argv[2];
  const name = process.argv[3] || `probe-${Date.now()}.png`;
  if (!url) {
    console.error('Usage: node browser-submit-probe.js <url> [screenshot-name]');
    process.exit(1);
  }

  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const started = Date.now();
  console.log(`[probe] launching Chromium with persistent profile at ${USER_DATA_DIR}`);

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = context.pages()[0] || await context.newPage();

  try {
    console.log(`[probe] navigating to ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000); // let SPA render

    const title = await page.title();
    const finalUrl = page.url();
    const screenshotPath = path.join(OUT_DIR, name);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const elapsed = Date.now() - started;
    const report = {
      ts: new Date().toISOString(),
      requested_url: url,
      final_url: finalUrl,
      title,
      screenshot: screenshotPath,
      elapsed_ms: elapsed,
      profile: USER_DATA_DIR,
      viewport: '1440x900',
    };
    console.log(JSON.stringify(report, null, 2));
  } catch (e) {
    console.error(`[probe] error: ${e.message}`);
    process.exitCode = 2;
  } finally {
    await context.close();
  }
}

main();
