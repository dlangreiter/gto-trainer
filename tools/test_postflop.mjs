// Postflop engine + solver sanity tests. Run: node tools/test_postflop.mjs
import '../js/constants.js';
import '../js/ranges.js';
import '../js/postflop.js';

const PF = globalThis.GTOPostflop;
const GTO = globalThis.GTO;
const Ranges = globalThis.GTORanges;

let failed = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? ` (${extra})` : ''));
  if (!cond) failed++;
}

// card helper: 'As' -> int
const RANKS = '23456789TJQKA', SUITS = 'shdc';
const C = (s) => (RANKS.indexOf(s[0]) << 2) | SUITS.indexOf(s[1]);

// ---- evaluator ----
const b = ['2c', '7d', '9s', 'Jh', '3c'].map(C);
const vAA = PF.eval7(C('As'), C('Ad'), ...b);
const vKK = PF.eval7(C('Ks'), C('Kd'), ...b);
const v72 = PF.eval7(C('7s'), C('2d'), ...b); // two pair 7s and 2s
check('AA beats KK on blank board', vAA > vKK);
check('two pair beats one pair', v72 > vAA);
const straight = PF.eval7(C('8s'), C('Td'), C('9s'), C('Jh'), C('7c'), C('2d'), C('3c'));
check('straight beats two pair', straight > v72);
const flush = PF.eval7(C('Ah'), C('2h'), C('9h'), C('Jh'), C('7h'), C('8s'), C('8d'));
check('flush beats straight', flush > straight);
const wheel = PF.eval7(C('As'), C('2d'), C('3c'), C('4h'), C('5s'), C('Kd'), C('Kc'));
check('wheel counts as a straight', (wheel >> 20) === 4);

// ---- combos / dead cards ----
const allAA = PF.classCombos(0);
check('AA has 6 combos', allAA.length === 6);
const full = new Array(169).fill(1);
const combos = PF.rangeCombos(full, [C('As'), C('Kd')]);
check('full range minus 2 dead cards', combos.length === (50 * 49) / 2, combos.length);

// ---- equity vs range ----
// AA vs {KK} preflop-ish: on a low flop AA should be ~90%+
const kkOnly = new Array(169).fill(0); kkOnly[GTO.labelToId('KK')] = 1;
const kkCombos = PF.rangeCombos(kkOnly, []);
const eqAA = PF.equityVsRange([C('As'), C('Ad')], kkCombos, ['2c', '7d', '9s'].map(C), 40000, 42);
check('AA vs KK on 972r ~0.92', Math.abs(eqAA - 0.92) < 0.025, eqAA.toFixed(3));

// river exact: AhKh on Qh Jh Th 2c 2d = royal flush → 100% vs anything
const anyR = PF.rangeCombos(full, []);
const eqRoyal = PF.equityVsRange([C('Ah'), C('Kh')], anyR, ['Qh', 'Jh', 'Th', '2c', '2d'].map(C), 0, 1);
check('royal flush has 100% river equity', eqRoyal > 0.999, eqRoyal.toFixed(4));

// symmetric ranges → 50%
const sym = PF.rangeVsRange(anyR, anyR, ['5c', '9d', 'Kh'].map(C), 40000, 7);
check('identical ranges split a flop ~50/50', Math.abs(sym - 0.5) < 0.01, sym.toFixed(3));

// ---- texture sanity: BTN open range vs BB defend on ace-high vs low board ----
const btn = Ranges.RFI.BTN;
const bbDef = Ranges.VSRFI.BB_vs_BTN.call;
const btnC = PF.rangeCombos(btn, []);
const bbC = PF.rangeCombos(bbDef, []);
const eqAceHigh = PF.rangeVsRange(btnC, bbC, ['As', '7d', '2c'].map(C), 40000, 3);
const eqLow = PF.rangeVsRange(btnC, bbC, ['6s', '5d', '4c'].map(C), 40000, 3);
check('BTN range favored on A72r', eqAceHigh > 0.52, eqAceHigh.toFixed(3));
check('BTN edge shrinks on 654', eqLow < eqAceHigh - 0.03, `${eqLow.toFixed(3)} vs ${eqAceHigh.toFixed(3)}`);

// ---- polar jam range ----
const board5 = ['Ks', '8d', '4c', 'Jh', '2s'].map(C);
const polar = PF.polarRange(btnC, board5, 0.2, 0.1);
const vals = polar.map(cb => PF.eval7(cb.c1, cb.c2, ...board5));
const sorted = [...vals].sort((a, b2) => b2 - a);
check('polar range is value + air (no middle)', new Set(polar.map(p => p.v !== undefined)).size === 1 &&
  vals.every(v => v >= sorted[Math.floor(sorted.length * 0.45)] || v <= sorted[Math.floor(sorted.length * 0.55)]));
const wPolar = polar.reduce((s, cb) => s + cb.w, 0);
const liveBtn = btnC.filter(cb => !board5.includes(cb.c1) && !board5.includes(cb.c2));
const wAll = liveBtn.reduce((s, cb) => s + cb.w, 0);
check('polar range is ~30% of the live range', Math.abs(wPolar / wAll - 0.3) < 0.03, (wPolar / wAll).toFixed(3));

// ---- flop solver ----
await import('../js/postflop-solver.js');
const Solver = globalThis.GTOPostflopSolver;

console.log('\n--- flop solver: BTN vs BB on A72r (pot 5.9, stacks 37.8) ---');
let t0 = Date.now();
const sol = Solver.solveFlop({
  ipRange: btn, bbRange: bbDef,
  board: ['As', '7d', '2c'].map(C),
  pot: 5.9, stack: 37.8, iterations: 250, runouts: 120, seed: 11,
});
console.log(`solved in ${Date.now() - t0}ms · ${sol.ip.length} IP combos vs ${sol.bb.length} BB combos`);
const cbetTotal = sol.aggRoot[1] + sol.aggRoot[2];
check('IP c-bets a lot on A72r', cbetTotal > 0.45 && cbetTotal < 0.98, (cbetTotal * 100).toFixed(1) + '%');
check('BB folds more vs the big size', sol.aggBB[1][0] > sol.aggBB[0][0],
  `${(sol.aggBB[0][0] * 100).toFixed(0)}% vs 33% · ${(sol.aggBB[1][0] * 100).toFixed(0)}% vs 75%`);

// bottom set (22) never folds to a check-raise
const AI = 1 + sol.sizes.length;
let setCall = 0, setW = 0;
for (let i = 0; i < sol.ip.length; i++) {
  if ((sol.ip[i].c1 >> 2) === 0 && (sol.ip[i].c2 >> 2) === 0) { // 22 -> bottom set
    setCall += sol.ip[i].w * sol.ipVsR[0][i * 2 + 1];
    setW += sol.ip[i].w;
  }
}
check('bottom set continues vs raise', setW > 0 && setCall / setW > 0.85, (setCall / setW * 100).toFixed(0) + '%');

// per-combo strategies are distributions; IP EVs are within (0, pot+stack)
let sane = true;
for (let i = 0; i < sol.ip.length; i++) {
  let sum = 0, bestEv = -1e9;
  for (let a = 0; a < AI; a++) { sum += sol.ipRoot[i * AI + a]; bestEv = Math.max(bestEv, sol.evIpRoot[i * AI + a]); }
  if (Math.abs(sum - 1) > 0.01 || bestEv < -0.01 || bestEv > sol.pot + sol.stack) sane = false;
}
check('IP strategies are distributions with sane EVs', sane);

// aggregate IP EV should be more than half the pot on an ace-high board
let ipEv = 0, ipW = 0;
for (let i = 0; i < sol.ip.length; i++) {
  let ev = 0;
  for (let a = 0; a < AI; a++) ev += sol.ipRoot[i * AI + a] * sol.evIpRoot[i * AI + a];
  ipEv += sol.ip[i].w * ev;
  ipW += sol.ip[i].w;
}
check('IP captures over half the pot on A72r', ipEv / ipW > sol.pot / 2, (ipEv / ipW).toFixed(2) + ' bb of ' + sol.pot);

// ---- turn + river solves (multi-street support) ----
t0 = Date.now();
const turnSol = Solver.solveFlop({
  ipCombos: sol.ip, bbCombos: sol.bb,
  board: ['As', '7d', '2c', 'Kh'].map(C), pot: 9.7, stack: 33.9, iterations: 200, seed: 5,
});
console.log(`turn solved in ${Date.now() - t0}ms · ${turnSol.ip.length}x${turnSol.bb.length} combos`);
check('turn solve: strategy distributions sum to 1', (() => {
  const AI2 = 1 + turnSol.sizes.length;
  for (let i = 0; i < turnSol.ip.length; i++) {
    let s = 0;
    for (let a = 0; a < AI2; a++) s += turnSol.ipRoot[i * AI2 + a];
    if (Math.abs(s - 1) > 0.01) return false;
  }
  return true;
})());
check('turn solve exposes vs-raise EVs', Array.isArray(turnSol.evIpVsR) && turnSol.evIpVsR[0].length === turnSol.ip.length * 2);

t0 = Date.now();
const rivSol = Solver.solveFlop({
  ipCombos: turnSol.ip, bbCombos: turnSol.bb,
  board: ['As', '7d', '2c', 'Kh', '9s'].map(C), pot: 9.7, stack: 33.9, iterations: 200, seed: 6,
});
console.log(`river solved in ${Date.now() - t0}ms`);
// the strongest river combo should never fold to a check-raise
const rBoard = ['As', '7d', '2c', 'Kh', '9s'].map(C);
let bestI = 0, bestV = -1;
for (let i = 0; i < rivSol.ip.length; i++) {
  const v = PF.eval7(rivSol.ip[i].c1, rivSol.ip[i].c2, ...rBoard);
  if (v > bestV) { bestV = v; bestI = i; }
}
check('river: nut combo never folds to a raise',
  rivSol.ipVsR[0][bestI * 2 + 1] > 0.9 && rivSol.ipVsR[1][bestI * 2 + 1] > 0.9);
check('river: nut combo bets a lot', (() => {
  const AI2 = 1 + rivSol.sizes.length;
  return rivSol.ipRoot[bestI * AI2 + 1] + rivSol.ipRoot[bestI * AI2 + 2] > 0.5;
})());

// ---- call-vs-3-bet range model ----
await import('../data/equity169.js');
const tb3 = Ranges.VSRFI.IP_vs_CO.threebet;
const cvr = PF.callVs3betRange(Ranges.RFI.CO, tb3);
const idOf = (l) => GTO.labelToId(l);
check('AA/KK 4-bet (excluded from the call range)', cvr[idOf('AA')] === 0 && cvr[idOf('KK')] === 0);
check('medium-strength opens call the 3-bet', cvr[idOf('88')] > 0.5 && cvr[idOf('AJs')] > 0.5);
const weakFolds = (() => {
  let folds = 0;
  for (let h = 0; h < 169; h++) if ((Ranges.RFI.CO[h] || 0) > 0.5 && cvr[h] === 0) folds++;
  return folds;
})();
check('weak opens fold to the 3-bet (' + weakFolds + ' classes)', weakFolds > 15);
const defendFrac = (() => {
  let o = 0, c = 0;
  for (let h = 0; h < 169; h++) {
    o += (Ranges.RFI.CO[h] || 0) * PF.classCombos(h).length;
    c += (cvr[h] || 0) * PF.classCombos(h).length;
  }
  return c / o;
})();
check('opener defends ~48% of opens', Math.abs(defendFrac - 0.48) < 0.02, defendFrac.toFixed(3));

// 3-bet pot solve sanity: SPR ~1.9, big bets go (nearly) all-in via the raise cap
const sol3 = Solver.solveFlop({
  ipRange: tb3, bbRange: cvr,
  board: ['Ks', '8d', '4c'].map(C), pot: 17.5, stack: 32.5, iterations: 200, seed: 21,
});
check('3-bet pot solves', sol3.ip.length > 50 && sol3.bb.length > 50,
  `${sol3.ip.length}x${sol3.bb.length}`);
check('3-bet pot raises are capped by the stack', sol3.raises.every(r => r <= 32.5));

console.log(failed === 0 ? '\nALL POSTFLOP ENGINE TESTS PASSED' : `\n${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
