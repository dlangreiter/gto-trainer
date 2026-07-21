// Mobile-viewport screenshots: table, feedback, builder, range modal, settings.
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8080/index.html';
const OUT = process.argv[2] || '.';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: 'networkidle0' });

async function applySettings(fn) {
  await page.click('#btnSettings');
  await page.waitForSelector('#settingsModal.show');
  await fn();
  await page.click('#btnApplySettings');
}
async function waitHand(n = 2) {
  await page.waitForFunction(
    (m) => !document.getElementById('solveOverlay').classList.contains('show') &&
      document.querySelectorAll('#controls button:not([disabled])').length >= m,
    { timeout: 60000 }, n
  );
}

await page.waitForFunction(() => document.querySelectorAll('#controls button').length >= 2 ||
  document.getElementById('solveOverlay').classList.contains('show'), { timeout: 60000 });

// 9-max jam/fold table
await applySettings(async () => {
  await page.select('#setPlayers', '9');
  await page.select('#setMode', 'pushfold');
  await page.click('#segFormat button[data-v="chip"]');
  await page.$eval('#setStacks', el => el.value = '10000');
});
await waitHand(2);
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: `${OUT}/m1_table.png` });

// feedback panel
await page.click('#controls .action-btn.fold');
await page.waitForSelector('#feedback.show');
await page.screenshot({ path: `${OUT}/m2_feedback.png` });

// range modal
await page.click('#btnShowRange');
await page.waitForSelector('#rangeModal.show');
await page.waitForFunction(() => document.querySelectorAll('#rangeGrid .range-cell').length === 169);
await page.screenshot({ path: `${OUT}/m3_range.png` });
await page.click('#btnCloseRange');

// builder + touch drag-paint across a row
await applySettings(async () => { await page.select('#setMode', 'builder'); });
await page.waitForFunction(() => document.querySelectorAll('#builderGrid .range-cell').length === 169, { timeout: 60000 });
const a = await page.$('#builderGrid [data-id="0"]');
const b = await page.$('#builderGrid [data-id="4"]');
const ba = await a.boundingBox(), bb = await b.boundingBox();
await page.touchscreen.touchStart(ba.x + ba.width / 2, ba.y + ba.height / 2);
for (let i = 1; i <= 8; i++) {
  const x = ba.x + (bb.x - ba.x) * i / 8 + ba.width / 2;
  await page.touchscreen.touchMove(x, ba.y + ba.height / 2);
  await new Promise(r => setTimeout(r, 30));
}
await page.touchscreen.touchEnd();
const painted = await page.$$eval('#builderGrid .painted', els => els.length);
console.log(`touch drag painted ${painted} cells (expect 5)`);
await page.screenshot({ path: `${OUT}/m4_builder.png` });

// settings modal
await page.click('#btnSettings');
await page.waitForSelector('#settingsModal.show');
await page.screenshot({ path: `${OUT}/m5_settings.png` });

await browser.close();
console.log('done');
