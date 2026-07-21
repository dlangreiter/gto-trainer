// Screenshot: postflop spot explorer mid-line (turn strategy after flop bet-call).
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8080/index.html';
const OUT = process.argv[2] || '.';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 900, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelectorAll('#sectionTabs .tab').length >= 4, { timeout: 60000 });
await page.click('#sectionTabs [data-sec="explore"]');
await page.waitForFunction(() => document.getElementById('explorePanel').style.display !== 'none', { timeout: 60000 });
await page.click('#xSub button[data-v="post"]');
await page.$eval('#xpfFlop', el => { el.value = 'Ks 7d 2c'; el.dispatchEvent(new Event('change')); });
await page.waitForFunction(() => document.querySelectorAll('#xGrid .range-cell').length === 169, { timeout: 120000 });
await page.click('#xSeats [data-xpf="bet0"]');
await page.waitForFunction(() => /vs .* bet/.test(document.getElementById('xTitle').textContent), { timeout: 120000 });
await page.click('#xSeats [data-xpf="call"]');
await page.waitForFunction(() => !!document.getElementById('xpfCard'), { timeout: 60000 });
await page.$eval('#xpfCard', el => { el.value = '9h'; });
await page.click('#xpfCardGo');
await page.waitForFunction(() => /Turn/.test(document.getElementById('xTitle').textContent) &&
  document.querySelectorAll('#xGrid .range-cell').length === 169, { timeout: 180000 });
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: `${OUT}/xpf_turn.png`, fullPage: true });
await browser.close();
console.log('done');
