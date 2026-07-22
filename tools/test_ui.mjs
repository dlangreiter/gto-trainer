// End-to-end UI smoke test: loads the app, waits for the solver, plays hands in
// every mode, opens the range viewer and settings, and reports console errors.
// Run: node tools/test_ui.mjs
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8080/index.html';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 950 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

let failed = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) failed++;
}

await page.goto(URL, { waitUntil: 'networkidle0' });

// wait for solver to finish and first hand to be dealt
await page.waitForFunction(
  () => !document.getElementById('solveOverlay').classList.contains('show') &&
        document.querySelectorAll('#controls button').length >= 2,
  { timeout: 30000 }
);
check('solver finished + hand dealt', true);

const seats = await page.$$eval('#seats .seat', els => els.length);
check('9 seats rendered', seats === 9);
const cards = await page.$$eval('#heroCards .card', els => els.length);
check('2 hero cards', cards === 2);

// play 30 hands: alternate fold / aggressive
for (let i = 0; i < 30; i++) {
  const btns = await page.$$('#controls button:not([disabled])');
  if (btns.length < 2) { check('action buttons present (hand ' + i + ')', false); break; }
  await btns[i % 2].click();
  await page.waitForSelector('#feedback.show', { timeout: 5000 });
  await page.click('#btnNext');
  await page.waitForFunction(
    () => !document.getElementById('feedback').classList.contains('show'),
    { timeout: 5000 }
  );
}
const hands = await page.evaluate(() => JSON.parse(localStorage.getItem('gto_stats')).hands);
check('30 hands recorded (got ' + hands + ')', hands === 30);

const headerTxt = await page.$eval('#headerStats', el => el.textContent);
check('header stats updated', /Hands 30/.test(headerTxt));

// answer one more hand, then open scenario range viewer
const btns = await page.$$('#controls button:not([disabled])');
await btns[1].click();
await page.waitForSelector('#feedback.show');
await page.click('#btnShowRange');
await page.waitForSelector('#rangeModal.show');
const cellCount = await page.$$eval('#rangeGrid .range-cell', els => els.length);
check('range grid has 169 cells', cellCount === 169);
const hl = await page.$$eval('#rangeGrid .range-cell.hl', els => els.length);
check('hero hand highlighted in grid', hl === 1);
const statsTxt = await page.$eval('#rangeStats', el => el.textContent);
check('range % shown: "' + statsTxt + '"', /%/.test(statsTxt));
await page.click('#btnCloseRange');

// range browser via header button
await page.click('#btnRanges');
await page.waitForSelector('#rangeModal.show');
const title = await page.$eval('#rangeTitle', el => el.textContent);
check('range browser title: "' + title + '"', title.length > 5);
// switch to call-vs-jam view
await page.click('#rvType button[data-v="call"]');
await new Promise(r => setTimeout(r, 200));
const title2 = await page.$eval('#rangeTitle', el => el.textContent);
check('call range view: "' + title2 + '"', /calling range/.test(title2));
await page.click('#btnCloseRange');

// settings: switch to HU 10bb, jam/fold mode
await page.click('#btnSettings');
await page.waitForSelector('#settingsModal.show');
await page.select('#setPlayers', '2');
await page.select('#setMode', 'pushfold');
await page.click('#btnApplySettings');
await page.waitForFunction(
  () => !document.getElementById('solveOverlay').classList.contains('show') &&
        document.querySelectorAll('#controls button').length >= 2,
  { timeout: 30000 }
);
const seats2 = await page.$$eval('#seats .seat', els => els.length);
check('HU: 2 seats rendered', seats2 === 2);
const jamBtn = await page.$$eval('#controls button', els => els.map(e => e.textContent).join('|'));
check('HU jam/fold buttons: "' + jamBtn + '"', /All-In/.test(jamBtn));

// keyboard: jam via key J, next via Space
await page.keyboard.press('j');
await page.waitForSelector('#feedback.show');
const verdict = await page.$eval('#fbVerdict', el => el.textContent);
check('keyboard jam graded: "' + verdict + '"', verdict.length > 2);
const detail = await page.$eval('#fbDetail', el => el.textContent);
check('EV shown in feedback', /EV\(Jam\)/.test(detail));
await page.keyboard.press(' ');
await page.waitForFunction(() => !document.getElementById('feedback').classList.contains('show'));
check('space deals next hand', true);

// settings: 6-max classic ante, call-vs-jam
await page.click('#btnSettings');
await page.select('#setPlayers', '6');
await page.select('#setMode', 'callvjam');
await page.click('#segAnte button[data-v="classic"]');
await page.$eval('#setAnte', el => el.value = '125');
await page.$eval('#setStacks', el => el.value = '8000, 12000, 6000, 10000, 9000, 15000');
await page.click('#btnApplySettings');
await page.waitForFunction(
  () => !document.getElementById('solveOverlay').classList.contains('show') &&
        document.querySelectorAll('#controls button').length >= 2,
  { timeout: 30000 }
);
const jammer = await page.$$eval('#seats .seat.jammer', els => els.length);
check('call-vs-jam: jammer seat shown', jammer === 1);
const callBtn = await page.$$eval('#controls button', els => els.map(e => e.textContent).join('|'));
check('call button present: "' + callBtn + '"', /Call/.test(callBtn));
const seats6 = await page.$$eval('#seats .seat', els => els.length);
check('6 seats with per-seat stacks', seats6 === 6);

// reload: settings + stats persist, cached solution loads instantly
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelectorAll('#controls button').length >= 2,
  { timeout: 30000 }
);
const handsAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('gto_stats')).hands);
check('stats persist after reload (' + handsAfter + ')', handsAfter >= 31);

// --- facing-a-raise (vs RFI) mode ---
await page.click('#btnSettings');
await page.waitForSelector('#settingsModal.show');
await page.select('#setPlayers', '9');
await page.select('#setMode', 'vsrfi');
await page.$eval('#setStacks', el => el.value = '50000');
await page.click('#btnApplySettings');
await page.waitForFunction(
  () => document.querySelectorAll('#controls button').length >= 3,
  { timeout: 30000 }
);
const vsBtns = await page.$$eval('#controls button', els => els.map(e => e.textContent).join('|'));
check('vsrfi: 3 action buttons: "' + vsBtns + '"', /3-Bet/.test(vsBtns) && /Call/.test(vsBtns));
const opener = await page.$$eval('#seats .seat.opener', els => els.length);
check('vsrfi: opener seat shown', opener === 1);
await page.click('#controls button.threebet');
await page.waitForSelector('#feedback.show');
const vsDetail = await page.$eval('#fbDetail', el => el.textContent);
check('vsrfi chart feedback: "' + vsDetail.slice(0, 60) + '…"', /3-bet/.test(vsDetail) && /Chart/.test(vsDetail));
await page.click('#btnShowRange');
await page.waitForSelector('#rangeModal.show');
const vsTitle = await page.$eval('#rangeTitle', el => el.textContent);
check('vsrfi range title: "' + vsTitle + '"', /open/.test(vsTitle));
const vsStats = await page.$eval('#rangeStats', el => el.textContent);
check('vsrfi dual stats: "' + vsStats + '"', /3-Bet/.test(vsStats) && /Call/.test(vsStats));
await page.click('#btnCloseRange');
await page.keyboard.press(' ');

// --- ICM mode ---
await page.click('#btnSettings');
await page.waitForSelector('#settingsModal.show');
await page.select('#setPlayers', '4');
await page.select('#setMode', 'pushfold');
await page.$eval('#setStacks', el => el.value = '20000, 20000, 20000, 3000');
await page.click('#segFormat button[data-v="icm"]');
await page.$eval('#setPayouts', el => el.value = '50, 30, 20');
await page.click('#btnApplySettings');
await page.waitForFunction(
  () => !document.getElementById('solveOverlay').classList.contains('show') &&
        document.querySelectorAll('#controls button').length >= 2,
  { timeout: 30000 }
);
const modeTag = await page.$eval('#tableCenter', el => el.textContent);
check('ICM tag on table: "' + modeTag.slice(-20) + '"', /ICM/.test(modeTag));
await page.keyboard.press('j');
await page.waitForSelector('#feedback.show');
const icmDetail = await page.$eval('#fbDetail', el => el.textContent);
check('ICM feedback in pool units: "' + icmDetail.slice(0, 80) + '…"', /pool/.test(icmDetail));

// --- raise tree: open strategy mode ---
async function applySettings(fn) {
  await page.click('#btnSettings');
  await page.waitForSelector('#settingsModal.show');
  await fn();
  await page.click('#btnApplySettings');
}
async function waitHand(minBtns = 2) {
  await page.waitForFunction(
    (n) => !document.getElementById('solveOverlay').classList.contains('show') &&
      document.querySelectorAll('#controls button:not([disabled])').length >= n &&
      !document.getElementById('feedback').classList.contains('show'),
    { timeout: 60000 }, minBtns
  );
}

await applySettings(async () => {
  await page.select('#setPlayers', '6');
  await page.select('#setMode', 'opentree');
  await page.click('#segFormat button[data-v="chip"]');
  await page.$eval('#setStacks', el => el.value = '25000');
});
await waitHand(3);
const otBtns = await page.$$eval('#controls button', els => els.map(e => e.textContent).join('|'));
check('opentree: 3 buttons: "' + otBtns + '"', /Raise/.test(otBtns) && /All-In/.test(otBtns));
await page.click('#controls button.threebet');
await page.waitForSelector('#feedback.show');
const otDetail = await page.$eval('#fbDetail', el => el.textContent);
check('opentree EV feedback: "' + otDetail.slice(0, 70) + '…"', /EV\(raise\)/.test(otDetail) && /EV\(jam\)/.test(otDetail));

// --- vsopen (reshove or fold) ---
await applySettings(async () => { await page.select('#setMode', 'vsopen'); });
await waitHand(2);
const voOpener = await page.$$eval('#seats .seat.opener', els => els.length);
check('vsopen: opener seat shown', voOpener === 1);
await page.keyboard.press('j');
await page.waitForSelector('#feedback.show');
const voDetail = await page.$eval('#fbDetail', el => el.textContent);
check('vsopen reshove feedback: "' + voDetail.slice(0, 60) + '…"', /eshove/.test(voDetail));

// --- vs3bet (opened, facing jam) ---
await applySettings(async () => { await page.select('#setMode', 'vs3bet'); });
await waitHand(2);
const v3Jammer = await page.$$eval('#seats .seat.jammer', els => els.length);
check('vs3bet: reshover seat shown', v3Jammer === 1);
const v3Hero = await page.$eval('#seats .seat.hero', el => el.textContent);
check('vs3bet: hero shows opened tag: "' + v3Hero.replace(/\s+/g, ' ') + '"', /OPENED/.test(v3Hero));
await page.keyboard.press('c');
await page.waitForSelector('#feedback.show');
const v3Detail = await page.$eval('#fbDetail', el => el.textContent);
check('vs3bet feedback: "' + v3Detail.slice(0, 60) + '…"', /You opened/.test(v3Detail));

// --- range viewer: open tree dual view ---
await page.click('#btnRanges');
await page.waitForSelector('#rangeModal.show');
await page.click('#rvType button[data-v="open"]');
await page.waitForFunction(
  () => document.querySelectorAll('#rangeGrid .range-cell').length === 169,
  { timeout: 60000 }
);
const otTitle = await page.$eval('#rangeTitle', el => el.textContent);
check('viewer open-tree title: "' + otTitle + '"', /raise tree/.test(otTitle));
const otStats = await page.$eval('#rangeStats', el => el.textContent);
check('viewer open-tree stats: "' + otStats + '"', /Raise/.test(otStats) && /Jam/.test(otStats));
await page.click('#btnCloseRange');

// --- PKO ---
await applySettings(async () => {
  await page.select('#setMode', 'pushfold');
  await page.$eval('#setStacks', el => el.value = '20000');
  await page.click('#segFormat button[data-v="pko"]');
  await page.$eval('#setBounties', el => el.value = '8');
});
await waitHand(2);
const pkoTag = await page.$eval('#tableCenter', el => el.textContent);
check('PKO tag on table: "' + pkoTag.slice(-25) + '"', /PKO/.test(pkoTag));
await page.keyboard.press('j');
await page.waitForSelector('#feedback.show');
const pkoDetail = await page.$eval('#fbDetail', el => el.textContent);
check('PKO feedback mentions bounties', /PKO/.test(pkoDetail));

// --- range builder quiz ---
await applySettings(async () => { await page.select('#setMode', 'builder'); });
await page.waitForFunction(
  () => document.querySelectorAll('#builderGrid .range-cell').length === 169,
  { timeout: 60000 }
);
check('builder: grid shown, table hidden',
  await page.$eval('#tableWrap', el => el.style.display === 'none'));
// paint a few premium cells (AA at id 0, AKs id 1, AKo id 13)
await page.click('#builderGrid [data-id="0"]');
await page.click('#builderGrid [data-id="1"]');
await page.click('#builderGrid [data-id="13"]');
const paintedN = await page.$$eval('#builderGrid .painted', els => els.length);
check('builder: painting works (3 painted)', paintedN === 3);
await page.click('#btnBuilderSubmit');
await page.waitForSelector('#feedback.show');
const bScore = await page.$eval('#fbVerdict', el => el.textContent);
check('builder scored: "' + bScore + '"', /% of the range correct/.test(bScore));
await page.keyboard.press(' ');
await page.waitForFunction(
  () => document.querySelectorAll('#builderGrid .range-cell').length === 169 &&
    !document.getElementById('feedback').classList.contains('show'),
  { timeout: 60000 }
);
check('builder: next spot deals', true);

// --- review + stats ---
const reviewVisible = await page.$eval('#btnReview', el => el.style.display !== 'none' && /Review \(\d+\)/.test(el.textContent));
check('review button shows mistake count', reviewVisible);
await page.click('#btnReview');
await page.waitForFunction(
  () => document.getElementById('tableCenter').textContent.includes('REVIEW') &&
    document.querySelectorAll('#controls button:not([disabled])').length >= 2,
  { timeout: 60000 }
);
check('review replays a mistake spot', true);
const beforeCount = await page.$eval('#btnReview', el => el.textContent);
const revBtns = await page.$$('#controls button:not([disabled])');
await revBtns[0].click(); // answer it (fold)
await page.waitForSelector('#feedback.show');
const revDetail = await page.$eval('#fbDetail', el => el.textContent);
check('review feedback shows remaining count: "' + revDetail.slice(-40) + '"', /mistake/.test(revDetail));

await page.click('#btnStats');
await page.waitForSelector('#statsModal.show');
const statsBody = await page.$eval('#statsBody', el => el.textContent);
check('stats dashboard has drill breakdown', /By drill/.test(statsBody) && /By position/.test(statsBody));
check('stats dashboard has position breakdown', /Hands/.test(statsBody));
await page.click('#btnCloseStats');

// --- session exam ---
await applySettings(async () => {
  await page.select('#setMode', 'exam');
  await page.select('#setExamHands', '10');
});
// exam deals across randomized configs with no per-hand feedback; alternate
// fold / aggressive so the recap has material
for (let i = 0; i < 10; i++) {
  await page.waitForFunction(
    () => document.getElementById('examModal').classList.contains('show') ||
      (!document.getElementById('solveOverlay').classList.contains('show') &&
        document.querySelectorAll('#controls button:not([disabled])').length >= 2),
    { timeout: 120000 }
  );
  if (await page.$eval('#examModal', el => el.classList.contains('show'))) break;
  if (i === 0) {
    const tag = await page.$eval('#tableCenter', el => el.textContent);
    check('exam progress tag: "' + tag.slice(-12) + '"', /EXAM 1\/10/.test(tag));
    check('exam hides per-hand feedback',
      !(await page.$eval('#feedback', el => el.classList.contains('show'))));
  }
  const ebtns = await page.$$('#controls button:not([disabled])');
  await ebtns[i % ebtns.length].click();
}
await page.waitForFunction(
  () => document.getElementById('examModal').classList.contains('show'), { timeout: 120000 });
check('exam finishes with results modal', true);
const examBody = await page.$eval('#examBody', el => el.textContent);
check('exam shows score + grade',
  await page.$eval('#examBody .exam-score', el => /\d/.test(el.textContent)));
check('exam summary line', /correct/.test(examBody) && /EV lost/.test(examBody));
const nMistakes = await page.$$eval('#examBody .exam-mistake', els => els.length);
check('exam explains mistakes (' + nMistakes + ' shown)',
  nMistakes > 0
    ? await page.$eval('#examBody .exam-mistake .em-why', el => el.textContent.length > 20)
    : /Flawless/.test(examBody));
check('exam adaptive focus line', /next exam will deal more/.test(examBody));
const examModes = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('gto_log')).items.slice(-10).map(e => e.mode));
check('exam includes multi-decision drills (' + [...new Set(examModes)].join(', ') + ')',
  examModes.some(m => ['opentree', 'vsopen', 'vs3bet', 'pfcbet', 'pfdefend'].includes(m)));
await page.click('#btnCloseExam');

// --- quick presets + history explanations ---
check('nav: 4 section tabs + drill/level menus', await page.evaluate(() =>
  document.querySelectorAll('#sectionTabs .tab').length === 4 &&
  !!document.getElementById('qDrill') && !!document.getElementById('qLevel')));

// two-level preflop picker: depth categories → drills, with auto-depth
check('preflop: 5 depth-category chips',
  await page.$$eval('#quickBar .qchip.cat', els => els.length) === 5);
await page.click('#quickBar .qchip.cat[data-cat="mid"]');
await waitHand(3);
check('mid category → open-strategy drill at mid depth',
  /Open Strategy/i.test(await page.$eval('#tableCenter', el => el.textContent)));
check('mid category shows its 3 sub-drills',
  await page.$$eval('#quickBar [data-premode]', els => els.length) === 3);
await page.click('#quickBar [data-premode="vsopen"]');
await waitHand(2);
check('sub-drill switch → reshove vs open',
  /Reshove/i.test(await page.$eval('#tableCenter', el => el.textContent)));
await page.click('#quickBar .qchip.cat[data-cat="deep"]');
await waitHand(2);
check('deep category auto-sets a deep stack',
  await page.evaluate(() => parseFloat(JSON.parse(localStorage.getItem('gto_settings')).stacksText) >= 40000));
const drillCount = await page.$$eval('#qDrill option', els => els.length);
check('drill menu holds the presets (' + (drillCount - 1) + ')', drillCount >= 7);
await page.select('#qDrill', '1'); // Short-stack UTG
await waitHand(2);
const heroName = await page.$eval('.seat.hero .pos-name', el => el.textContent);
check('preset: hero seated UTG', heroName === 'UTG');
check('preset: jam/fold drill',
  /Jam or Fold/.test(await page.$eval('#tableCenter', el => el.textContent)));

// blind-level dropdown: L7 = 250/500 on 10k → 20bb → raise-tree territory
await page.select('#qLevel', '6');
await waitHand(2);
const lvlTxt = await page.$eval('#tableCenter', el => el.textContent);
check('level menu sets blinds: "' + lvlTxt.slice(0, 34) + '"', /Blinds 250\/500/.test(lvlTxt));
check('level depth picks the drill', /(Open Strategy|Reshove|3-Bet)/i.test(lvlTxt));
// early level: L1 = 25/50 → 200bb deep → chart drills
await page.select('#qLevel', '0');
await waitHand(2);
const lvl1Txt = await page.$eval('#tableCenter', el => el.textContent);
check('early level plays deep: "' + lvl1Txt.slice(0, 30) + '"',
  /Blinds 25\/50/.test(lvl1Txt) && /(Open \(RFI\)|Facing a Raise)/i.test(lvl1Txt));
check('level menu remembers selection', await page.$eval('#qLevel', el => el.value === '0'));
// back to a mid drill for the rest of the suite
await page.select('#qDrill', '1');
await waitHand(2);
const pbtns = await page.$$('#controls button:not([disabled])');
await pbtns[0].click();
await page.waitForSelector('#feedback.show');
const histChips = await page.$$('#history [data-hid]');
check('history chips are tappable', histChips.length > 0);
await histChips[histChips.length - 1].click();
const hdTxt = await page.$eval('#histDetail', el =>
  el.style.display !== 'none' ? el.textContent : '');
check('history chip opens explanation: "' + hdTxt.slice(0, 50) + '…"',
  hdTxt.length > 30 && /Solver|Chart|chose/i.test(hdTxt));
await histChips[histChips.length - 1].click();
check('second tap closes explanation',
  await page.$eval('#histDetail', el => el.style.display === 'none'));

// --- postflop drills ---
await page.click('#sectionTabs [data-sec="postflop"]'); // opens last-used pf drill (c-bet)
await page.waitForFunction(
  () => !document.getElementById('solveOverlay').classList.contains('show') &&
    document.querySelectorAll('#controls button:not([disabled])').length >= 2,
  { timeout: 120000 });
check('postflop tab shows 6 drill chips',
  await page.$$eval('#quickBar [data-pfmode]', els => els.length) === 6);
check('postflop table shows the full ring',
  await page.$$eval('#seats .seat', els => els.length) === 9 &&
  await page.$$eval('#seats .seat.folded', els => els.length) === 7);
check('postflop tab is highlighted', await page.$eval('#sectionTabs [data-sec="postflop"]',
  el => el.classList.contains('on')));
await page.click('#quickBar [data-pfmode="pftexture"]');
await waitHand(3);
check('texture quiz: 3 board cards on felt',
  await page.$$eval('#tableCenter .board-cards .card', els => els.length) === 3);
check('texture quiz: 3 choices',
  (await page.$$('#controls button:not([disabled])')).length === 3);
await page.keyboard.press('2'); // number-key answer
await page.waitForSelector('#feedback.show');
check('texture quiz graded with range equity',
  /equity/.test(await page.$eval('#fbDetail', el => el.textContent)));
await page.keyboard.press(' ');
await waitHand(3);

await page.click('#quickBar [data-pfmode="pfequity"]');
await waitHand(4);
check('equity drill: hero cards + board',
  await page.$$eval('#heroCards .card', els => els.length) === 2 &&
  await page.$$eval('.board-cards .card', els => els.length) >= 3);
const eqBtns = await page.$$('#controls button:not([disabled])');
await eqBtns[1].click();
await page.waitForSelector('#feedback.show');
check('equity drill graded with exact number',
  /% equity/.test(await page.$eval('#fbDetail', el => el.textContent)));

await page.click('#quickBar [data-pfmode="pfrivercall"]');
await waitHand(2);
check('river drill: full 5-card board',
  await page.$$eval('.board-cards .card', els => els.length) === 5);
const rcBtns = await page.$$('#controls button:not([disabled])');
await rcBtns[0].click();
await page.waitForSelector('#feedback.show');
const rcDetail = await page.$eval('#fbDetail', el => el.textContent);
check('river drill shows pot odds + EV', /You need/.test(rcDetail) && /EV\(call\)/.test(rcDetail));

await page.click('#quickBar [data-pfmode="pfcbet"]');
await page.waitForFunction(
  () => !document.getElementById('solveOverlay').classList.contains('show') &&
    document.querySelectorAll('#controls button:not([disabled])').length >= 3,
  { timeout: 120000 });
check('cbet drill: flop + hero cards',
  await page.$$eval('.board-cards .card', els => els.length) === 3 &&
  await page.$$eval('#heroCards .card', els => els.length) === 2);
const cbBtns = await page.$$('#controls button:not([disabled])');
await cbBtns[1].click();
await page.waitForSelector('#feedback.show');
const cbDetail = await page.$eval('#fbDetail', el => el.textContent);
check('cbet graded by flop solver: "' + cbDetail.slice(0, 44) + '…"',
  /Solver plays/.test(cbDetail) && /EV/.test(cbDetail) && /Range c-bets/.test(cbDetail));
// strategy viewer: how the solver plays the whole range on this board
await page.click('#btnShowRange');
await page.waitForSelector('#rangeModal.show');
check('postflop strategy viewer grid',
  await page.$$eval('#rangeGrid .range-cell', els => els.length) === 169 &&
  /Check/.test(await page.$eval('#legendItems', el => el.textContent)) &&
  /%/.test(await page.$eval('#rangeStats', el => el.textContent)));
await page.click('#btnCloseRange');

// full hand vs solver: play until the hand completes
await page.click('#quickBar [data-pfmode="pfhand"]');
let handDone = false;
for (let step = 0; step < 14 && !handDone; step++) {
  await page.waitForFunction(() =>
    !document.getElementById('solveOverlay').classList.contains('show') &&
    (document.getElementById('feedback').classList.contains('show') ||
      document.querySelectorAll('#controls button:not([disabled])').length >= 2),
    { timeout: 120000 });
  const st = await page.evaluate(() => ({
    fb: document.getElementById('feedback').classList.contains('show'),
    next: document.getElementById('btnNext').textContent,
    btns: document.querySelectorAll('#controls button:not([disabled])').length,
  }));
  if (st.fb) {
    if (/Next hand/.test(st.next)) { handDone = true; break; }
    await page.click('#btnNext'); // Continue to the next street/decision
  } else if (st.btns >= 2) {
    const bs = await page.$$('#controls button:not([disabled])');
    await bs[1].click();
  }
}
check('full hand plays to completion', handDone);
check('full-hand summary: "' + (await page.$eval('#fbVerdict', el => el.textContent)).slice(0, 40) + '"',
  /Hand (complete|checked)/.test(await page.$eval('#fbVerdict', el => el.textContent)));
await page.keyboard.press(' '); // next hand
await page.waitForFunction(() =>
  !document.getElementById('feedback').classList.contains('show') ||
  document.getElementById('solveOverlay').classList.contains('show'), { timeout: 120000 });

await page.click('#quickBar [data-pfmode="pfdefend"]');
await page.waitForFunction(
  () => !document.getElementById('solveOverlay').classList.contains('show') &&
    document.querySelectorAll('#controls button:not([disabled])').length >= 3,
  { timeout: 120000 });
const dfBtns = await page.$$('#controls button:not([disabled])');
await dfBtns[1].click();
await page.waitForSelector('#feedback.show');
const dfDetail = await page.$eval('#fbDetail', el => el.textContent);
check('defend drill graded with MDF context', /MDF/.test(dfDetail) && /Solver plays/.test(dfDetail));

// --- 3-bet pot toggle ---
await page.click('#quickBar [data-pfmode="pfcbet"]');
await page.waitForFunction(() => !document.getElementById('solveOverlay').classList.contains('show') &&
  document.querySelectorAll('#controls button:not([disabled])').length >= 3, { timeout: 120000 });
await page.click('#qPotType'); // switch to 3-bet pot
await page.waitForFunction(() => !document.getElementById('solveOverlay').classList.contains('show') &&
  document.querySelectorAll('#controls button:not([disabled])').length >= 3, { timeout: 120000 });
const tbCtx = await page.$eval('#tableCenter', el => el.textContent);
check('3-bet pot spot dealt: "' + tbCtx.slice(0, 44) + '…"',
  /3-bet/.test(tbCtx) && /17\.5/.test(tbCtx));
const tbBtns = await page.$$('#controls button:not([disabled])');
await tbBtns[1].click();
await page.waitForSelector('#feedback.show');
check('3-bet pot c-bet graded',
  /Solver plays/.test(await page.$eval('#fbDetail', el => el.textContent)));
check('pot toggle chip shows state',
  /3-bet pot/.test(await page.$eval('#qPotType', el => el.textContent)));
await page.click('#qPotType'); // back to single-raised for the rest of the suite
await page.waitForFunction(() => !document.getElementById('solveOverlay').classList.contains('show') &&
  document.querySelectorAll('#controls button:not([disabled])').length >= 2, { timeout: 120000 });

// --- postflop mistakes replay in Review ---
check('postflop spots store replay data', await page.evaluate(() =>
  JSON.parse(localStorage.getItem('gto_log')).items.some(e => e.pf)));
let pfBad = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('gto_log')).items.some(e => e.pf && e.v === 'bad' && !e.fixed));
for (let t = 0; t < 6 && !pfBad; t++) {
  await page.click('#quickBar [data-pfmode="pfrivercall"]');
  await waitHand(2);
  const bs = await page.$$('#controls button:not([disabled])');
  await bs[t % 2].click();
  await page.waitForSelector('#feedback.show');
  pfBad = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('gto_log')).items.some(e => e.pf && e.v === 'bad' && !e.fixed));
}
check('postflop mistake logged for review', pfBad);
await page.click('#btnReview');
await page.waitForFunction(() =>
  document.getElementById('tableCenter').textContent.includes('REVIEW') &&
  !document.getElementById('solveOverlay').classList.contains('show') &&
  document.querySelectorAll('#controls button:not([disabled])').length >= 2, { timeout: 120000 });
check('review replays a postflop spot (board on felt)',
  await page.$$eval('.board-cards .card', els => els.length) >= 3);
const rvb = await page.$$('#controls button:not([disabled])');
await rvb[0].click();
await page.waitForSelector('#feedback.show');
check('pf review shows remaining count',
  /Review ·/.test(await page.$eval('#fbDetail', el => el.textContent)));

// stats: missed-hand rotation list
await page.click('#btnStats');
await page.waitForSelector('#statsModal.show');
check('stats shows missed-hand rotation',
  /In rotation/.test(await page.$eval('#statsBody', el => el.textContent)));
await page.click('#btnCloseStats');

// --- spot explorer ---
await page.click('#sectionTabs [data-sec="explore"]');
await page.waitForFunction(() => document.getElementById('explorePanel').style.display !== 'none',
  { timeout: 30000 });
check('explorer panel opens', true);
await page.waitForFunction(() => document.querySelectorAll('#xGrid .range-cell').length === 169,
  { timeout: 120000 });
check('explorer: first-in chart renders',
  /first-in/.test(await page.$eval('#xTitle', el => el.textContent)));
check('explorer: acting seat highlighted',
  await page.$$eval('#xSeats .xseat.act', els => els.length) === 1);
await page.click('#xSeats .xs-btn.open[data-seat="0"]');
await page.waitForFunction(() => /reshove/i.test(document.getElementById('xTitle').textContent) &&
  document.querySelectorAll('#xGrid .range-cell').length === 169, { timeout: 120000 });
check('explorer: open → reshove chart', true);
await page.click('#xSeats .xs-btn.jam[data-seat="3"]');
await page.waitForFunction(() => /call or fold/.test(document.getElementById('xTitle').textContent) &&
  document.querySelectorAll('#xGrid .range-cell').length === 169, { timeout: 120000 });
check('explorer: jam over open → opener call-vs-jam chart', true);
check('explorer: folds auto-filled between actions', await page.evaluate(() =>
  JSON.parse(localStorage.getItem('gto_explorer')).actions.slice(1, 3).every(a => a === 'fold')));
const xStats = await page.$eval('#xStats', el => el.textContent);
check('explorer stats: "' + xStats + '"', /%/.test(xStats));
await page.$eval('#xStacks', el => { el.value = '18'; el.dispatchEvent(new Event('change')); });
await page.waitForFunction(() => document.querySelectorAll('#xGrid .range-cell').length === 169 &&
  !document.getElementById('xTitle').textContent.includes('Solving'), { timeout: 120000 });
check('explorer: stack change re-solves at new depth',
  /18 bb/.test(await page.$eval('#xTitle', el => el.textContent)));
await page.click('#xReset');
await page.waitForFunction(() => /first-in/.test(document.getElementById('xTitle').textContent),
  { timeout: 120000 });
check('explorer: reset returns to first-in chart', true);

// postflop explorer: fixed flop → c-bet chart → bet → BB response → call → turn
await page.click('#xSub button[data-v="post"]');
// regression: the 🎲 random-flop button must produce a parseable board
await page.click('#xpfRandom');
await page.waitForFunction(() => document.querySelectorAll('#xGrid .range-cell').length === 169 &&
  /strategy/.test(document.getElementById('xTitle').textContent), { timeout: 120000 });
check('pf explorer: random flop parses and solves', true);
// symbol-suit input must parse too (what mobile users paste/see)
await page.$eval('#xpfFlop', el => { el.value = 'K♠ 7♦ 2♣'; el.dispatchEvent(new Event('change')); });
await page.waitForFunction(() => /K♠ 7♦ 2♣/.test(document.getElementById('xTitle').textContent) &&
  document.querySelectorAll('#xGrid .range-cell').length === 169, { timeout: 120000 });
check('pf explorer: symbol-suit flop input parses', true);
await page.$eval('#xpfFlop', el => { el.value = 'Ks 7d 2c'; el.dispatchEvent(new Event('change')); });
await page.waitForFunction(() => document.querySelectorAll('#xGrid .range-cell').length === 169 &&
  /strategy/.test(document.getElementById('xTitle').textContent), { timeout: 120000 });
check('pf explorer: IP strategy chart on typed flop',
  /K♠ 7♦ 2♣/.test(await page.$eval('#xTitle', el => el.textContent)));
await page.click('#xSeats [data-xpf="bet0"]');
await page.waitForFunction(() => /vs .* bet/.test(document.getElementById('xTitle').textContent) &&
  document.querySelectorAll('#xGrid .range-cell').length === 169, { timeout: 120000 });
check('pf explorer: bet → defender response chart', true);
await page.click('#xSeats [data-xpf="call"]');
await page.waitForFunction(() => !!document.getElementById('xpfCardRnd'), { timeout: 60000 });
check('pf explorer: call closes street, asks for turn card', true);
await page.click('#xpfCardRnd');
await page.waitForFunction(() => /Turn/.test(document.getElementById('xTitle').textContent) &&
  document.querySelectorAll('#xGrid .range-cell').length === 169, { timeout: 180000 });
check('pf explorer: turn re-solved with updated ranges: "' +
  (await page.$eval('#xTitle', el => el.textContent)).slice(0, 40) + '…"', true);
await page.click('#xpfUndo');
await page.waitForFunction(() => !!document.getElementById('xpfCardRnd'), { timeout: 60000 });
check('pf explorer: undo steps back to card pick', true);
await page.click('#xReset');
await page.click('#xSub button[data-v="pre"]'); // restore for later tests

// --- charts-included exam ---
await applySettings(async () => {
  await page.select('#setMode', 'exam');
  await page.select('#setExamHands', '10');
  await page.click('#segExamCharts button[data-v="on"]');
});
let hasChart = false, hasPf = false;
for (let t = 0; t < 8 && !(hasChart && hasPf); t++) {
  if (t > 0) await applySettings(async () => {}); // reroll the plan
  await page.waitForFunction(() => globalThis.__examPlan && globalThis.__examPlan.length === 10,
    { timeout: 60000 });
  [hasChart, hasPf] = await page.evaluate(() => [
    globalThis.__examPlan.some(p => p.mode === 'rfi' || p.mode === 'vsrfi'),
    globalThis.__examPlan.some(p => p.mode.startsWith('pf')),
  ]);
}
check('charts exam plan includes chart spots', hasChart);
check('exam plan includes postflop drills', hasPf);
for (let i = 0; i < 10; i++) {
  await page.waitForFunction(
    () => document.getElementById('examModal').classList.contains('show') ||
      (!document.getElementById('solveOverlay').classList.contains('show') &&
        document.querySelectorAll('#controls button:not([disabled])').length >= 2),
    { timeout: 120000 }
  );
  if (await page.$eval('#examModal', el => el.classList.contains('show'))) break;
  if (i === 0) {
    check('quick bar hidden during exam', await page.evaluate(() =>
      document.getElementById('quickBar').style.display === 'none'));
  }
  const eb = await page.$$('#controls button:not([disabled])');
  await eb[i % eb.length].click();
}
await page.waitForFunction(
  () => document.getElementById('examModal').classList.contains('show'), { timeout: 120000 });
check('charts exam completes', true);
await page.click('#btnCloseExam');

// exam tab (mobile entry point)
await page.click('#sectionTabs [data-sec="exam"]');
await page.waitForFunction(
  () => document.getElementById('tableCenter').textContent.includes('EXAM') ||
    document.getElementById('solveOverlay').classList.contains('show'),
  { timeout: 120000 });
check('exam tab starts an exam', true);

// --- exam progress counter + title-click exit with confirm ---
await page.waitForFunction(
  () => !document.getElementById('solveOverlay').classList.contains('show') &&
    document.querySelectorAll('#controls button:not([disabled])').length >= 2,
  { timeout: 120000 });
const progTxt = await page.$eval('#examProgLabel', el => el.textContent);
check('exam progress counter shown: "' + progTxt + '"', /hand 1 of 10/.test(progTxt));
check('title marked as exit control',
  await page.$eval('header h1', el => el.classList.contains('exam-live')));
await page.click('header h1');
await page.waitForSelector('#exitExamModal.show');
check('title click asks to confirm exit', true);
await page.click('#btnKeepExam');
check('keep playing stays in exam', await page.evaluate(() =>
  !document.getElementById('exitExamModal').classList.contains('show') &&
  document.getElementById('examProgress').style.display !== 'none'));
await page.click('header h1');
await page.waitForSelector('#exitExamModal.show');
await page.click('#btnExitExam');
await page.waitForFunction(
  () => !document.getElementById('tableCenter').textContent.includes('EXAM') &&
    !document.getElementById('solveOverlay').classList.contains('show') &&
    document.querySelectorAll('#controls button:not([disabled])').length >= 2,
  { timeout: 120000 });
check('exit exam returns to free play', await page.evaluate(() =>
  document.getElementById('examProgress').style.display === 'none' &&
  document.getElementById('quickBar').style.display !== 'none' &&
  !document.querySelector('header h1').classList.contains('exam-live')));

// restore a normal mode so later runs start clean (the exam row is only
// visible while the mode select reads 'exam', so toggle charts off in between)
await applySettings(async () => {
  await page.select('#setMode', 'exam');
  await page.click('#segExamCharts button[data-v="off"]');
  await page.select('#setMode', 'auto');
  await page.click('#segFormat button[data-v="chip"]');
  await page.$eval('#setStacks', el => el.value = '10000');
});
await waitHand(2);

// --- the guide ---
check('header has a Guide link', await page.$eval('#btnGuide', el => /guide\.html/.test(el.href)));
await page.goto('http://127.0.0.1:8080/guide.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !/computing/.test(document.getElementById('texBoards').textContent), { timeout: 60000 });
const guideTxt = await page.$eval('.guide', el => el.textContent);
check('guide has all 17 numbered sections',
  await page.$$eval('.gsec[id]', els => els.length) === 17 && /17\./.test(guideTxt));
check('guide renders live range grids',
  await page.$$eval('#gridBTN .range-cell', els => els.length) === 169 &&
  await page.$$eval('#gridUTG .range-cell', els => els.length) === 169);
check('guide computes live texture equities',
  /BTN \d\d\.\d%/.test(await page.$eval('#texBoards', el => el.textContent)));
check('guide has try-it deep links',
  await page.$$eval('.tryit', els => els.length) >= 12);
check('guide position diagram drawn',
  await page.$$eval('#posSvg text', els => els.length) > 9);
// deep link drops into the right drill
await page.goto('http://127.0.0.1:8080/index.html?mode=pfcbet', { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => !document.getElementById('solveOverlay').classList.contains('show') &&
    document.querySelectorAll('#controls button:not([disabled])').length >= 3,
  { timeout: 120000 });
check('guide deep link starts the drill',
  /C-bet flop/i.test(await page.$eval('#tableCenter', el => el.textContent)));

// --- the advanced guide ---
check('header has an Advanced link',
  await page.$eval('#btnAdvanced', el => /advanced\.html/.test(el.href)));
await page.goto('http://127.0.0.1:8080/advanced.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() =>
  document.querySelectorAll('#varTable tr').length > 3 &&
  document.querySelectorAll('#turnTable tr').length > 3, { timeout: 120000 });
check('advanced guide has 12 numbered sections',
  await page.$$eval('.gsec[id]', els => els.length) === 12);
check('advanced: blocker demo computed',
  /combos/.test(await page.$eval('#blockerDemo', el => el.textContent)));
check('advanced: polar + condensed grids render',
  await page.$$eval('#gridPolar .range-cell', els => els.length) === 169 &&
  await page.$$eval('#gridCondensed .range-cell', els => els.length) === 169);
check('advanced: live ICM bubble matrix',
  /needs/.test(await page.$eval('#bubbleMatrix', el => el.textContent)) &&
  /premium/.test(await page.$eval('#bubbleMatrix', el => el.textContent)));
check('advanced: multiway equity dilution table',
  /AA/.test(await page.$eval('#mwTable', el => el.textContent)));
check('advanced: turn equity shifts computed',
  /barrel wide|slow down|mixed/.test(await page.$eval('#turnTable', el => el.textContent)));
check('advanced: geometric sizing computed',
  /geometric size/.test(await page.$eval('#geoDemo', el => el.textContent)));
check('advanced: variance simulation ran',
  /DOWN after 500/.test(await page.$eval('#varTable', el => el.textContent)));
check('advanced: pro benchmarks present',
  await page.$$eval('.probox', els => els.length) === 12);
await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelectorAll('#controls button').length >= 2 ||
  document.getElementById('solveOverlay').classList.contains('show'), { timeout: 60000 });
// restore for future runs
await applySettings(async () => {
  await page.select('#setMode', 'auto');
  await page.$eval('#setStacks', el => el.value = '10000');
});
await waitHand(2);

// --- session tracker (bankroll) ---
await page.click('#btnSessions');
await page.waitForSelector('#sessModal.show');
check('sessions modal opens with empty state',
  /No sessions logged/.test(await page.$eval('#sessList', el => el.textContent)));
await page.$eval('#sessVenue', el => el.value = 'The Star');
await page.$eval('#sessGtd', el => el.value = '$20K GTD');
await page.$eval('#sessBuyin', el => el.value = '150');
await page.$eval('#sessCashout', el => el.value = '480');
await page.$eval('#sessPlace', el => el.value = '3 / 142');
await page.$eval('#sessNotes', el => el.value = '2 KOs, won flip vs AK');
await page.click('#btnSessSave');
const sRow = await page.$eval('#sessList', el => el.textContent);
check('session logged with all fields',
  /The Star/.test(sRow) && /\$20K GTD/.test(sRow) && /3 \/ 142/.test(sRow) && /2 KOs/.test(sRow));
const sSum = await page.$eval('#sessSummary', el => el.textContent);
check('summary shows net +$330 and ROI +220%', /\+\$330/.test(sSum) && /\+220%/.test(sSum));
// a losing session on an earlier date
await page.$eval('#sessDate', el => el.value = '2026-07-10');
await page.$eval('#sessVenue', el => el.value = 'GGPoker');
await page.$eval('#sessBuyin', el => el.value = '100');
await page.click('#btnSessSave');
const sSum2 = await page.$eval('#sessSummary', el => el.textContent);
check('two sessions: net +$230, ITM 50%', /\+\$230/.test(sSum2) && /50%/.test(sSum2));
check('bankroll chart renders (2 bars + line)',
  await page.$$eval('#sessChart rect', els => els.length) === 2 &&
  await page.$$eval('#sessChart path', els => els.length) === 1);
// edit the losing session (older date -> listed second)
await page.click('#sessList .sess-row:nth-child(2) button[data-act="edit"]');
check('edit prefills the form',
  await page.$eval('#sessBuyin', el => el.value) === '100' &&
  /Save changes/.test(await page.$eval('#btnSessSave', el => el.textContent)));
await page.$eval('#sessCashout', el => el.value = '50');
await page.click('#btnSessSave');
check('edit updates the totals (+$280)',
  /\+\$280/.test(await page.$eval('#sessSummary', el => el.textContent)));
// two-tap delete (no browser confirm dialog)
await page.click('#sessList .sess-row:nth-child(1) button[data-act="del"]');
check('delete arms first ("Sure?")',
  /Sure\?/.test(await page.$eval('#sessList .sess-row:nth-child(1)', el => el.textContent)) &&
  await page.$$eval('#sessList .sess-row', els => els.length) === 2);
await page.click('#sessList .sess-row:nth-child(1) button[data-act="del"]');
check('second tap deletes the session',
  await page.$$eval('#sessList .sess-row', els => els.length) === 1);
const sStore = await page.evaluate(() => JSON.parse(localStorage.getItem('gto_sessions')).items);
check('sessions persist to localStorage',
  sStore.length === 1 && sStore[0].venue === 'GGPoker' && sStore[0].cashout === 50);
await page.click('#btnCloseSess');
await page.evaluate(() => localStorage.removeItem('gto_sessions')); // leave storage clean

// --- mobile layout: 7 header buttons must not widen the page ---
await page.setViewport({ width: 390, height: 844 });
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelectorAll('#controls button').length >= 2 ||
  document.getElementById('solveOverlay').classList.contains('show'), { timeout: 120000 });
check('phone width: no horizontal page overflow', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth));
check('phone width: every header button fully visible', await page.evaluate(() =>
  [...document.querySelectorAll('.header-btns .btn')].every(b => {
    const r = b.getBoundingClientRect();
    return b.offsetParent === null || (r.left >= -1 && r.right <= window.innerWidth + 1);
  })));
await page.setViewport({ width: 1280, height: 950 });
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelectorAll('#controls button').length >= 2 ||
  document.getElementById('solveOverlay').classList.contains('show'), { timeout: 120000 });

// --- PWA plumbing ---
check('manifest linked', await page.evaluate(() =>
  !!document.querySelector('link[rel="manifest"]')));
const pwaBits = await page.evaluate(async () => {
  const m = await fetch('manifest.webmanifest');
  const s = await fetch('sw.js');
  const i = await fetch('icons/icon-192.png');
  return [m.status, s.status, i.status];
});
check('manifest + sw + icon served (' + pwaBits.join(',') + ')', pwaBits.every(s => s === 200));
check('service worker registered', await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!reg;
}));

console.log('\nConsole errors: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
if (errors.length) failed++;

await page.screenshot({ path: process.env.SHOT || 'tools/ui_final.png' });
await browser.close();
console.log(failed === 0 ? '\nALL TESTS PASSED' : `\n${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
