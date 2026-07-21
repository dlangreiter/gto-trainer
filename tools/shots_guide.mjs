// Screenshots: guide page (mobile) + full-hand mode mid-decision.
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.argv[2] || '.';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

await page.goto('http://127.0.0.1:8080/guide.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !/computing/.test(document.getElementById('texBoards').textContent), { timeout: 60000 });
await page.screenshot({ path: `${OUT}/g1_guide_top.png` });
await page.evaluate(() => document.getElementById('s4').scrollIntoView());
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: `${OUT}/g2_guide_rfi.png` });

await page.goto('http://127.0.0.1:8080/index.html?mode=pfhand', { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => !document.getElementById('solveOverlay').classList.contains('show') &&
    (document.getElementById('feedback').classList.contains('show') ||
      document.querySelectorAll('#controls button:not([disabled])').length >= 2),
  { timeout: 120000 });
await new Promise(r => setTimeout(r, 350));
await page.screenshot({ path: `${OUT}/g3_fullhand.png` });

await browser.close();
console.log('done');
