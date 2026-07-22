import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.argv[2] || '.';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
// iPhone SE / 14 / 15 Pro Max widths
for (const [w, h, name] of [[375, 667, 'se'], [390, 844, 'i14'], [430, 932, 'promax']]) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto('http://127.0.0.1:8080/', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelectorAll('#controls button').length >= 2, { timeout: 120000 });
  const over = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    btns: [...document.querySelectorAll('.header-btns .btn')].filter(b => b.offsetParent !== null &&
      (b.getBoundingClientRect().right > window.innerWidth + 1 || b.getBoundingClientRect().left < -1)).length,
  }));
  console.log(name, w + 'px', 'overflow:', over.page, 'clipped buttons:', over.btns);
  await page.screenshot({ path: `${OUT}/ip_${name}.png` });
}
await browser.close();
