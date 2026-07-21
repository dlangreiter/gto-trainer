// Screenshots of the new modes: facing-a-raise table + dual-color vs-open grid.
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8080/index.html';
const OUT = process.argv[2] || 'tools';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 950 });
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelectorAll('#controls button').length >= 2, { timeout: 30000 });

// switch to vsrfi
await page.click('#btnSettings');
await page.waitForSelector('#settingsModal.show');
await page.select('#setMode', 'vsrfi');
await page.click('#btnApplySettings');
await page.waitForFunction(() => document.querySelectorAll('#controls button').length >= 3, { timeout: 30000 });
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: `${OUT}/shot5_vsrfi.png` });

// vs-open range grid (BB vs BTN)
await page.click('#btnRanges');
await page.waitForSelector('#rangeModal.show');
await page.click('#rvType button[data-v="vsrfi"]');
await new Promise(r => setTimeout(r, 200));
await page.select('#rvKey', 'BB_vs_BTN');
await new Promise(r => setTimeout(r, 200));
await page.screenshot({ path: `${OUT}/shot6_vsopen_grid.png` });

await browser.close();
console.log('done');
