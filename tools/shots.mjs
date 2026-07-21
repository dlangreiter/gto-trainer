// Capture screenshots of the main app states for visual review.
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8080/index.html';
const OUT = process.argv[2] || 'tools';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 950 });
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => !document.getElementById('solveOverlay').classList.contains('show') &&
        document.querySelectorAll('#controls button').length >= 2,
  { timeout: 30000 }
);
await page.screenshot({ path: `${OUT}/shot1_table.png` });

// answer a hand -> feedback
const btns = await page.$$('#controls button:not([disabled])');
await btns[1].click();
await page.waitForSelector('#feedback.show');
await page.screenshot({ path: `${OUT}/shot2_feedback.png` });

// range viewer
await page.click('#btnShowRange');
await page.waitForSelector('#rangeModal.show');
await page.screenshot({ path: `${OUT}/shot3_range.png` });
await page.click('#btnCloseRange');

// settings
await page.click('#btnSettings');
await page.waitForSelector('#settingsModal.show');
await page.screenshot({ path: `${OUT}/shot4_settings.png` });

await browser.close();
console.log('done');
