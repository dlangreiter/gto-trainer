// Mobile screenshots: quick-drill bar + tappable history explanation.
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8080/index.html';
const OUT = process.argv[2] || '.';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: 'networkidle0' });

async function waitHand(n = 2) {
  await page.waitForFunction(
    (m) => !document.getElementById('solveOverlay').classList.contains('show') &&
      document.querySelectorAll('#controls button:not([disabled])').length >= m,
    { timeout: 60000 }, n
  );
}
await waitHand(2);

// answer two hands so history chips exist
for (let i = 0; i < 2; i++) {
  const btns = await page.$$('#controls button:not([disabled])');
  await btns[i % btns.length].click();
  await page.waitForSelector('#feedback.show');
  await page.click('#btnNext');
  await waitHand(2);
}
// answer one more and open its history explanation
const btns = await page.$$('#controls button:not([disabled])');
await btns[1].click();
await page.waitForSelector('#feedback.show');
const chips = await page.$$('#history [data-hid]');
await chips[chips.length - 1].click();
await new Promise(r => setTimeout(r, 200));
await page.screenshot({ path: `${OUT}/q1_mobile_bottom.png`, fullPage: true });

await browser.close();
console.log('done');
