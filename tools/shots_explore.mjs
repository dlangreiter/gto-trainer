// Screenshots: spot explorer (desktop + mobile) with an action history built.
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8080/index.html';
const OUT = process.argv[2] || '.';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });

async function drive(page, tag) {
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelectorAll('#sectionTabs .tab').length >= 4, { timeout: 60000 });
  await page.click('#sectionTabs [data-sec="explore"]');
  await page.waitForFunction(() => document.querySelectorAll('#xGrid .range-cell').length === 169 ||
    document.getElementById('xTitle').textContent.length > 5, { timeout: 120000 });
  await page.click('#xReset'); // clear any persisted action history
  await page.waitForFunction(() => document.querySelectorAll('#xGrid .range-cell').length === 169, { timeout: 120000 });
  // CO opens, BTN jams → opener's call chart
  await page.click('#xSeats .xs-btn.open[data-seat="2"]');
  await page.waitForFunction(() => /reshove/i.test(document.getElementById('xTitle').textContent), { timeout: 120000 });
  await page.click('#xSeats .xs-btn.jam[data-seat="3"]');
  await page.waitForFunction(() => /call or fold/.test(document.getElementById('xTitle').textContent) &&
    document.querySelectorAll('#xGrid .range-cell').length === 169, { timeout: 120000 });
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: `${OUT}/explore_${tag}.png`, fullPage: true });
}

const desktop = await browser.newPage();
await desktop.setViewport({ width: 1280, height: 950 });
await drive(desktop, 'desktop');

const mobile = await browser.newPage();
await mobile.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await drive(mobile, 'mobile');

await browser.close();
console.log('done');
