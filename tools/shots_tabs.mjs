// Mobile screenshot: section tabs + postflop drill chips.
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8080/index.html';
const OUT = process.argv[2] || '.';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: 'networkidle0' });

async function waitBtns(n) {
  await page.waitForFunction(
    (m) => !document.getElementById('solveOverlay').classList.contains('show') &&
      document.querySelectorAll('#controls button:not([disabled])').length >= m,
    { timeout: 120000 }, n);
}
await waitBtns(2);
await page.click('#sectionTabs [data-sec="postflop"]');
await waitBtns(2);
await new Promise(r => setTimeout(r, 350));
await page.screenshot({ path: `${OUT}/tabs_postflop.png` });
await browser.close();
console.log('done');
