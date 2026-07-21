// Smoke-check the live GitHub Pages deployment: app boots, solver runs,
// service worker registers, no console errors.
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'https://dlangreiter.github.io/gto-trainer/';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForFunction(
  () => !document.getElementById('solveOverlay').classList.contains('show') &&
    document.querySelectorAll('#controls button').length >= 2,
  { timeout: 90000 });
console.log('app booted + solver ran: OK');
console.log('tabs:', await page.$$eval('#sectionTabs .tab', els => els.map(e => e.textContent).join(' | ')));
const sw = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? 'registered (' + (reg.active ? 'active' : 'installing') + ')' : 'none';
});
console.log('service worker:', sw);
console.log('console errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
