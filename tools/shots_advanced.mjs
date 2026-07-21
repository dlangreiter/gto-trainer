// Screenshot the advanced guide's live-computed widgets.
import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.argv[2] || '.';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1000 });
await page.goto('http://127.0.0.1:8080/advanced.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelectorAll('#varTable tr').length > 3, { timeout: 120000 });
for (const [id, name] of [['a5', 'icm'], ['a6', 'multiway'], ['a9', 'turns'], ['a12', 'variance']]) {
  const el = await page.$('#' + id);
  await el.screenshot({ path: `${OUT}/adv_${name}.png` });
}
await browser.close();
console.log('done');
