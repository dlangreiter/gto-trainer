import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.argv[2] || '.';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
for (const [w, h, name] of [[390, 844, 'mob'], [844, 700, 'mid'], [1200, 800, 'desk']]) {
  await page.setViewport({ width: w, height: h });
  await page.goto('http://127.0.0.1:8080/', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelectorAll('#controls button').length >= 2, { timeout: 120000 });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(name, 'h-overflow px:', over);
  await page.screenshot({ path: `${OUT}/hdr_${name}.png` });
}
await browser.close();
