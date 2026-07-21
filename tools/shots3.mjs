// Screenshots: open-strategy mode, open-tree range grid, builder quiz, stats modal.
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8080/index.html';
const OUT = process.argv[2] || 'tools';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 950 });
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

// open strategy at 25bb
await applySettings(async () => {
  await page.select('#setPlayers', '6');
  await page.select('#setMode', 'opentree');
  await page.click('#segFormat button[data-v="chip"]');
  await page.$eval('#setStacks', el => el.value = '25000');
});
await waitHand(3);
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: `${OUT}/shot7_opentree.png` });

// open-tree range grid
await page.click('#btnRanges');
await page.waitForSelector('#rangeModal.show');
await page.click('#rvType button[data-v="open"]');
await page.waitForFunction(() => document.querySelectorAll('#rangeGrid .range-cell').length === 169, { timeout: 60000 });
await page.screenshot({ path: `${OUT}/shot8_opentree_grid.png` });
await page.click('#btnCloseRange');

// builder
await applySettings(async () => { await page.select('#setMode', 'builder'); });
await page.waitForFunction(() => document.querySelectorAll('#builderGrid .range-cell').length === 169, { timeout: 60000 });
for (const id of [0, 1, 13, 14, 26, 2, 27]) await page.click(`#builderGrid [data-id="${id}"]`);
await page.click('#btnBuilderSubmit');
await page.waitForSelector('#feedback.show');
await page.screenshot({ path: `${OUT}/shot9_builder.png` });

// stats modal
await page.click('#btnStats');
await page.waitForSelector('#statsModal.show');
await page.screenshot({ path: `${OUT}/shot10_stats.png` });

await browser.close();
console.log('done');
