// Screenshot the session-exam flow: in-exam table + results recap.
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8080/index.html';
const OUT = process.argv[2] || '.';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 950 });
await page.goto(URL, { waitUntil: 'networkidle0' });

await page.waitForFunction(() => document.querySelectorAll('#controls button').length >= 2 ||
  document.getElementById('solveOverlay').classList.contains('show'), { timeout: 60000 });

await page.click('#btnSettings');
await page.waitForSelector('#settingsModal.show');
await page.select('#setMode', 'exam');
await page.select('#setExamHands', '10');
await page.click('#btnApplySettings');

let shotTaken = false;
for (let i = 0; i < 10; i++) {
  await page.waitForFunction(
    () => document.getElementById('examModal').classList.contains('show') ||
      (!document.getElementById('solveOverlay').classList.contains('show') &&
        document.querySelectorAll('#controls button:not([disabled])').length >= 2),
    { timeout: 120000 }
  );
  if (await page.$eval('#examModal', el => el.classList.contains('show'))) break;
  if (i === 2 && !shotTaken) {
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: `${OUT}/e1_exam_hand.png` });
    shotTaken = true;
  }
  const btns = await page.$$('#controls button:not([disabled])');
  await btns[i % btns.length].click();
}
await page.waitForFunction(
  () => document.getElementById('examModal').classList.contains('show'), { timeout: 120000 });
await new Promise(r => setTimeout(r, 200));
await page.screenshot({ path: `${OUT}/e2_exam_results.png`, fullPage: true });

await browser.close();
console.log('done');
