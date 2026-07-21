// Sanity checks for the push/fold solver against well-known Nash numbers.
// Run: node tools/test_solver.mjs
import '../data/equity169.js';
import '../js/constants.js';
import '../js/solver.js';

const GTO = globalThis.GTO;
const { solvePushFold } = globalThis.GTOSolver;

function rangePct(freqs, hId) {
  let combos = 0, total = 0;
  for (let h = 0; h < 169; h++) {
    const c = GTO.classComboCount(h);
    total += c;
    combos += c * freqs[h];
  }
  return (100 * combos / total);
}

function freqOf(freqs, label) {
  return freqs[GTO.labelToId(label)];
}

function show(name, freqs, samples) {
  let s = `${name}: ${rangePct(freqs).toFixed(1)}%`;
  for (const lab of samples) s += `  ${lab}=${(freqOf(freqs, lab) * 100).toFixed(0)}%`;
  console.log(s);
}

console.log('--- HU 10bb (known: SB jams ~58%, BB calls ~37%) ---');
let t0 = Date.now();
let sol = solvePushFold({ stacks: [10, 10], anteMode: 'none', ante: 0, iterations: 300 });
console.log(`solved in ${Date.now() - t0}ms`);
show('SB push', sol.push[0], ['A2o', 'K7o', 'Q5s', 'T7o', '53s', '72o', '22']);
show('BB call', sol.call[1][0], ['A2o', 'KTo', 'Q9s', '55', 'J8s', 'K5o']);

console.log('\n--- HU 5bb (known: SB jams ~75-100% region, BB calls ~50%+) ---');
sol = solvePushFold({ stacks: [5, 5], anteMode: 'none', ante: 0, iterations: 300 });
show('SB push', sol.push[0], ['72o', '32o', 'J2o', 'T4o']);
show('BB call', sol.call[1][0], ['K2o', 'Q5o', 'J7o', 'T8s', '44']);

console.log('\n--- HU 20bb (known: SB jams ~30-40%) ---');
sol = solvePushFold({ stacks: [20, 20], anteMode: 'none', ante: 0, iterations: 300 });
show('SB push', sol.push[0], ['A2o', 'KTo', '66', 'Q9s', '76s']);
show('BB call', sol.call[1][0], ['AJo', '77', 'KQs', 'A8s']);

console.log('\n--- 9-max 10bb no ante, UTG (known: tight ~7-10%) ---');
t0 = Date.now();
sol = solvePushFold({
  stacks: [10, 10, 10, 10, 10, 10, 10, 10, 10],
  anteMode: 'none', ante: 0, iterations: 200,
});
console.log(`solved in ${Date.now() - t0}ms`);
show('UTG push', sol.push[0], ['66', 'ATs', 'AJo', 'KQs', '55', 'A9s']);
show('CO push', sol.push[5], ['22', 'A5o', 'KTs', 'QJs', 'K9o']);
show('BTN push', sol.push[6], ['A2o', 'K5s', 'Q8s', 'T8s', '44', 'J7s']);
show('SB push', sol.push[7], ['K2o', 'Q4o', 'J6s', '85s', '33']);
show('BB call vs BTN', sol.call[8][6], ['A7o', 'KTo', '55', 'QTs']);
show('BB call vs UTG', sol.call[8][0], ['AJo', '88', 'ATs', 'KQo']);

console.log('\n--- 9-max 10bb WITH BB ante (ranges should widen) ---');
sol = solvePushFold({
  stacks: [10, 10, 10, 10, 10, 10, 10, 10, 10],
  anteMode: 'bb', ante: 1, iterations: 200,
});
show('UTG push', sol.push[0], ['66', 'ATs', 'AJo', 'KQs', '55']);
show('BTN push', sol.push[6], ['A2o', 'K5s', 'Q8s', 'T8s', '44']);

// ============ ICM ============
const { icmEquities } = globalThis.GTOSolver;

console.log('\n--- ICM equity function ---');
let eq = icmEquities([5000, 5000], [70, 30]);
console.log('2p equal stacks, 70/30:', Array.from(eq, x => x.toFixed(1)).join(', '), '(expect 50.0, 50.0)');
eq = icmEquities([5000, 3000, 2000], [50, 30, 20]);
console.log('3p 50/30/20 stacks, 50/30/20 pay:', Array.from(eq, x => x.toFixed(2)).join(', '),
  `(sum=${Array.from(eq).reduce((s, x) => s + x, 0).toFixed(2)}, expect 100; big stack < 40)`);
eq = icmEquities([9000, 500, 500], [50, 30, 20]);
console.log('3p dominant stack:', Array.from(eq, x => x.toFixed(2)).join(', '));

console.log('\n--- Bubble: 4 players 20/20/20/3 bb, payouts 50/30/20 (3 paid) ---');
const stacksB = [20, 20, 20, 3];
const cevB = solvePushFold({ stacks: stacksB, anteMode: 'none', ante: 0, iterations: 300 });
const icmB = solvePushFold({ stacks: stacksB, anteMode: 'none', ante: 0, iterations: 300, icm: { payouts: [50, 30, 20] } });
// position order: CO, BTN, SB, BB(3bb short) — big stacks cover each other
show('cEV BTN push', cevB.push[1], ['A9o', 'KTs', '55', 'QJo']);
show('ICM BTN push', icmB.push[1], ['A9o', 'KTs', '55', 'QJo']);
show('cEV SB call vs BTN', cevB.call[2][1], ['A9o', 'KJo', '66', 'ATs']);
show('ICM SB call vs BTN', icmB.call[2][1], ['A9o', 'KJo', '66', 'ATs']);
const cevCall = rangePct(cevB.call[2][1]);
const icmCall = rangePct(icmB.call[2][1]);
console.log(`SB call range: cEV ${cevCall.toFixed(1)}% vs ICM ${icmCall.toFixed(1)}% — ` +
  (icmCall < cevCall * 0.75 ? 'PASS (ICM much tighter on bubble)' : 'FAIL (expected big tightening)'));

// ============ Raise tree ============
console.log('\n--- Raise tree: 6-max 25bb, BB ante ---');
let t1 = Date.now();
const rt = solvePushFold({
  stacks: [25, 25, 25, 25, 25, 25],
  anteMode: 'bb', ante: 1, iterations: 250,
  tree: 'raise',
});
console.log(`solved in ${Date.now() - t1}ms`);
show('LJ open', rt.open[0], ['AA', 'AJs', 'KQo', '76s', 'A2o']);
show('LJ jam', rt.push[0], ['AA', '77', 'AKo', 'A5s']);
show('BTN open', rt.open[2], ['A2s', 'K9o', 'QTo', '86s', 'J2s']);
show('BB reshove vs BTN open', rt.rsh[5][2], ['99', 'AJo', 'A5s', 'KQs', 'K2o']);
show('BTN call vs BB reshove', rt.c3b[2][5], ['QQ', 'AQs', 'AJo', '66', 'KQs']);
const totalFirstIn = rangePct(rt.open[2]) + rangePct(rt.push[2]);
console.log(`BTN total first-in (open+jam): ${totalFirstIn.toFixed(1)}% — ` +
  (totalFirstIn > 25 && totalFirstIn < 60 ? 'PASS (plausible)' : 'CHECK'));
console.log(`LJ opens ${rangePct(rt.open[0]).toFixed(1)}% + jams ${rangePct(rt.push[0]).toFixed(1)}% at 25bb — ` +
  (rangePct(rt.push[0]) < 8 ? 'PASS (few pure jams when deep)' : 'CHECK (too many open-jams)'));

console.log('\n--- Raise tree at 15bb (jamming should increase vs 25bb) ---');
const rt15 = solvePushFold({
  stacks: [15, 15, 15, 15, 15, 15],
  anteMode: 'bb', ante: 1, iterations: 250,
  tree: 'raise',
});
console.log(`LJ 15bb: open ${rangePct(rt15.open[0]).toFixed(1)}% jam ${rangePct(rt15.push[0]).toFixed(1)}%`);
console.log(`SB 15bb: open ${rangePct(rt15.open[4]).toFixed(1)}% jam ${rangePct(rt15.push[4]).toFixed(1)}%`);

// ============ PKO ============
console.log('\n--- PKO: 6-max 20bb, big bounty on short stack behind ---');
const noPko = solvePushFold({ stacks: [20, 20, 20, 20, 20, 5], anteMode: 'bb', ante: 1, iterations: 250 });
const pko = solvePushFold({
  stacks: [20, 20, 20, 20, 20, 5], anteMode: 'bb', ante: 1, iterations: 250,
  pko: { bounties: [2, 2, 2, 2, 2, 15], fraction: 0.65 },
});
const callNo = rangePct(noPko.call[4][3]); // SB calls BTN jam (both 20bb, no bounty capture)
const callPk = rangePct(pko.call[4][3]);
const bbCallNo = rangePct(noPko.call[5][3]); // 5bb BB w/ big bounty is the target, not collector
const sbCallVsBBno = rangePct(noPko.call[4][3]);
// covering players calling the 5bb BB's jam: bounty makes calls much wider
// BB(5bb) jams are index 5 as pusher? BB can't be first-in pusher... use SB(4) jam, BB(5) call? BB covers nobody.
// Instead: SB(20bb) calling a hypothetical BTN—use CO(3) jam, SB(4) call where CO has bounty 2:
console.log(`SB call vs BTN jam: no-PKO ${callNo.toFixed(1)}% vs PKO ${callPk.toFixed(1)}% — ` +
  (callPk >= callNo ? 'PASS (bounties never tighten calls)' : 'FAIL'));
const pkoBig = solvePushFold({
  stacks: [20, 20, 20, 20, 20, 5], anteMode: 'bb', ante: 1, iterations: 250,
  pko: { bounties: [2, 2, 2, 2, 15, 2], fraction: 0.65 }, // huge bounty on SB
});
const callVsSB = rangePct(pko.call[5][4]);
const bigCallVsSB = rangePct(pkoBig.call[5][4]); // BB(5bb) can't cover SB — bounty shouldn't matter for BB
console.log(`BB(5bb, covers nobody) call vs SB jam: bounty-on-SB ${bigCallVsSB.toFixed(1)}% vs small ${callVsSB.toFixed(1)}% — ` +
  (Math.abs(bigCallVsSB - callVsSB) < 3 ? 'PASS (uncoverable bounty ignored)' : 'CHECK'));
const btnCallVsCO_no = rangePct(noPko.call[3][2]);
const pkoShort = solvePushFold({
  stacks: [20, 20, 5, 20, 20, 20], anteMode: 'bb', ante: 1, iterations: 250,
  pko: { bounties: [2, 2, 15, 2, 2, 2], fraction: 0.65 }, // 5bb CO with huge bounty
});
const noShort = solvePushFold({ stacks: [20, 20, 5, 20, 20, 20], anteMode: 'bb', ante: 1, iterations: 250 });
const btnCallBounty = rangePct(pkoShort.call[3][2]);
const btnCallPlain = rangePct(noShort.call[3][2]);
console.log(`BTN call vs 5bb CO jam (CO has 15bb-worth bounty): plain ${btnCallPlain.toFixed(1)}% vs PKO ${btnCallBounty.toFixed(1)}% — ` +
  (btnCallBounty > btnCallPlain * 1.5 ? 'PASS (bounty hunting widens calls a lot)' : 'FAIL'));
