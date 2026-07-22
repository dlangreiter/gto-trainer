// Screenshot the session tracker modal with sample data (desktop + mobile).
import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.argv[2] || '.';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:8080/', { waitUntil: 'networkidle0' });
await page.evaluate(() => {
  localStorage.setItem('gto_sessions', JSON.stringify({ items: [
    { id: 1, date: '2026-06-27', venue: 'The Star', gtd: 'Friday $20K GTD', buyin: 150, cashout: 0, place: '38 / 141', notes: 'busted TT < AQ flip' },
    { id: 2, date: '2026-07-03', venue: 'GGPoker', gtd: '$50K GTD Bounty Hunter', buyin: 55, cashout: 210, place: '9 / 480', notes: '4 KOs ($80 bounties)' },
    { id: 3, date: '2026-07-10', venue: 'The Star', gtd: '$20K GTD', buyin: 150, cashout: 620, place: '2 / 156', notes: 'chop deal HU, 1 KO' },
    { id: 4, date: '2026-07-17', venue: 'Home game', gtd: '', buyin: 100, cashout: 0, place: '', notes: 'deep run, bubbled' },
  ] }));
});
for (const [w, h, name] of [[1100, 900, 'desktop'], [390, 844, 'mobile']]) {
  await page.setViewport({ width: w, height: h });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.click('#btnSessions');
  await page.waitForSelector('#sessModal.show');
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: `${OUT}/sess_${name}.png` });
}
await browser.close();
console.log('done');
