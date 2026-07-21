// Mobile screenshots: exam progress counter + exit-exam confirm.
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8080/index.html';
const OUT = process.argv[2] || '.';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: 'networkidle0' });

async function waitHand() {
  await page.waitForFunction(
    () => !document.getElementById('solveOverlay').classList.contains('show') &&
      document.querySelectorAll('#controls button:not([disabled])').length >= 2,
    { timeout: 120000 }
  );
}
await waitHand();

await page.evaluate(() => document.querySelectorAll('#quickBar .qchip')[0].click()); // Start exam
await waitHand();
// answer two hands so the bar shows progress
for (let i = 0; i < 2; i++) {
  const btns = await page.$$('#controls button:not([disabled])');
  await btns[0].click();
  await waitHand();
}
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: `${OUT}/x1_exam_counter.png` });

await page.click('header h1');
await page.waitForSelector('#exitExamModal.show');
await new Promise(r => setTimeout(r, 200));
await page.screenshot({ path: `${OUT}/x2_exit_confirm.png` });

await browser.close();
console.log('done');
