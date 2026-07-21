// Screenshots: postflop drills (c-bet solver spot + river call), desktop + mobile.
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8080/index.html';
const OUT = process.argv[2] || '.';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });

async function drive(page, mobile) {
  const tag = mobile ? 'm' : 'd';
  async function waitBtns(n) {
    await page.waitForFunction(
      (m) => !document.getElementById('solveOverlay').classList.contains('show') &&
        document.querySelectorAll('#controls button:not([disabled])').length >= m,
      { timeout: 120000 }, n);
  }
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await waitBtns(2);

  await page.select('#qPostflop', 'pfcbet');
  await waitBtns(3);
  await new Promise(r => setTimeout(r, 350));
  await page.screenshot({ path: `${OUT}/pf1_${tag}_cbet.png` });
  const btns = await page.$$('#controls button:not([disabled])');
  await btns[1].click();
  await page.waitForSelector('#feedback.show');
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: `${OUT}/pf2_${tag}_cbet_fb.png` });

  await page.select('#qPostflop', 'pfrivercall');
  await waitBtns(2);
  await new Promise(r => setTimeout(r, 350));
  await page.screenshot({ path: `${OUT}/pf3_${tag}_river.png` });
}

const desktop = await browser.newPage();
await desktop.setViewport({ width: 1280, height: 950 });
await drive(desktop, false);

const mobile = await browser.newPage();
await mobile.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await drive(mobile, true);

await browser.close();
console.log('done');
