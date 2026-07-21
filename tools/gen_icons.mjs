// Generates PWA icons (icons/icon-512.png, icon-192.png) via headless Chrome.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'icons');
mkdirSync(outDir, { recursive: true });

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();

const html = (size) => `<!doctype html><html><body style="margin:0">
<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;flex-direction:column;
  background:radial-gradient(circle at 50% 32%, #1c2736 0%, #0f1319 78%);font-family:'Segoe UI',sans-serif;">
  <div style="font-size:${size * 0.44}px;line-height:1;">♠</div>
  <div style="font-size:${size * 0.11}px;font-weight:800;color:#4f9cf9;letter-spacing:${size * 0.006}px;margin-top:${size * 0.02}px">GTO</div>
</div></body></html>`;

for (const size of [512, 192]) {
  await page.setViewport({ width: size, height: size });
  await page.setContent(html(size));
  await new Promise(r => setTimeout(r, 150));
  await page.screenshot({ path: join(outDir, `icon-${size}.png`) });
  console.log(`icon-${size}.png written`);
}
await browser.close();
