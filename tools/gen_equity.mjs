// Generates data/equity169.js — preflop all-in equity matrix for the 169 starting hand classes.
// Monte Carlo: for each pair of classes, sample suit-consistent combos + random boards.
// Run: node tools/gen_equity.mjs [samples]   (default 2000 per pair)

import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES = parseInt(process.argv[2] || '2000', 10);

// ---- cards: 0..51, rank = c >> 2 (0=deuce .. 12=ace), suit = c & 3 ----

// 7-card evaluator. Returns comparable integer (bigger = better).
// category << 20 | five 4-bit tiebreak nibbles (high to low).
function eval7(c0, c1, c2, c3, c4, c5, c6) {
  const cards = [c0, c1, c2, c3, c4, c5, c6];
  const rankCount = new Array(13).fill(0);
  const suitCount = [0, 0, 0, 0];
  const suitRanks = [0, 0, 0, 0];
  let rankBits = 0;
  for (let i = 0; i < 7; i++) {
    const c = cards[i], r = c >> 2, s = c & 3;
    rankCount[r]++;
    suitCount[s]++;
    suitRanks[s] |= 1 << r;
    rankBits |= 1 << r;
  }

  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (suitCount[s] >= 5) flushSuit = s;

  if (flushSuit >= 0) {
    const sf = straightHigh(suitRanks[flushSuit]);
    if (sf >= 0) return (8 << 20) | (sf << 16);
  }

  // collect multiples
  let quad = -1, trips = [], pairs = [];
  for (let r = 12; r >= 0; r--) {
    if (rankCount[r] === 4) quad = r;
    else if (rankCount[r] === 3) trips.push(r);
    else if (rankCount[r] === 2) pairs.push(r);
  }

  if (quad >= 0) {
    let k = -1;
    for (let r = 12; r >= 0; r--) if (r !== quad && rankCount[r] > 0) { k = r; break; }
    return (7 << 20) | (quad << 16) | (k << 12);
  }

  if (trips.length >= 2) return (6 << 20) | (trips[0] << 16) | (trips[1] << 12);
  if (trips.length === 1 && pairs.length >= 1) return (6 << 20) | (trips[0] << 16) | (pairs[0] << 12);

  if (flushSuit >= 0) {
    let v = 5 << 20, got = 0, bits = suitRanks[flushSuit];
    for (let r = 12; r >= 0 && got < 5; r--) if (bits & (1 << r)) { v |= r << (16 - 4 * got); got++; }
    return v;
  }

  const st = straightHigh(rankBits);
  if (st >= 0) return (4 << 20) | (st << 16);

  if (trips.length === 1) {
    let v = (3 << 20) | (trips[0] << 16), got = 0;
    for (let r = 12; r >= 0 && got < 2; r--) if (rankCount[r] > 0 && r !== trips[0]) { v |= r << (12 - 4 * got); got++; }
    return v;
  }

  if (pairs.length >= 2) {
    let v = (2 << 20) | (pairs[0] << 16) | (pairs[1] << 12);
    for (let r = 12; r >= 0; r--) if (rankCount[r] > 0 && r !== pairs[0] && r !== pairs[1]) { v |= r << 8; break; }
    return v;
  }

  if (pairs.length === 1) {
    let v = (1 << 20) | (pairs[0] << 16), got = 0;
    for (let r = 12; r >= 0 && got < 3; r--) if (rankCount[r] > 0 && r !== pairs[0]) { v |= r << (12 - 4 * got); got++; }
    return v;
  }

  let v = 0, got = 0;
  for (let r = 12; r >= 0 && got < 5; r--) if (rankCount[r] > 0) { v |= r << (16 - 4 * got); got++; }
  return v;
}

function straightHigh(bits) {
  for (let hi = 12; hi >= 4; hi--) {
    const mask = 0b11111 << (hi - 4);
    if ((bits & mask) === mask) return hi;
  }
  // wheel A-2-3-4-5
  if ((bits & 0b1000000001111) === 0b1000000001111) return 3;
  return -1;
}

// ---- 169 hand classes ----
// Grid convention: a = 12 - hiRank, b = 12 - loRank  (so a<=b, A is 0).
// id: pair -> a*13+a ; suited -> a*13+b (upper triangle) ; offsuit -> b*13+a.

function classCombos(id) {
  const a = Math.floor(id / 13), b = id % 13;
  const combos = [];
  if (a === b) {
    const r = 12 - a;
    for (let s1 = 0; s1 < 4; s1++)
      for (let s2 = s1 + 1; s2 < 4; s2++)
        combos.push([(r << 2) | s1, (r << 2) | s2]);
  } else if (a < b) { // suited
    const hi = 12 - a, lo = 12 - b;
    for (let s = 0; s < 4; s++) combos.push([(hi << 2) | s, (lo << 2) | s]);
  } else { // offsuit
    const hi = 12 - b, lo = 12 - a;
    for (let s1 = 0; s1 < 4; s1++)
      for (let s2 = 0; s2 < 4; s2++)
        if (s1 !== s2) combos.push([(hi << 2) | s1, (lo << 2) | s2]);
  }
  return combos;
}

const COMBOS = [];
for (let id = 0; id < 169; id++) COMBOS.push(classCombos(id));

// xorshift RNG (fast, deterministic)
let rngState = 0x9E3779B9 >>> 0;
function rnd() {
  rngState ^= rngState << 13; rngState >>>= 0;
  rngState ^= rngState >> 17;
  rngState ^= rngState << 5; rngState >>>= 0;
  return rngState / 4294967296;
}

function pairEquity(idA, idB, n) {
  const cA = COMBOS[idA], cB = COMBOS[idB];
  const used = new Uint8Array(52);
  let score = 0, valid = 0;
  for (let t = 0; t < n; t++) {
    const ha = cA[(rnd() * cA.length) | 0];
    const hb = cB[(rnd() * cB.length) | 0];
    if (ha[0] === hb[0] || ha[0] === hb[1] || ha[1] === hb[0] || ha[1] === hb[1]) { t--; continue; }
    used.fill(0);
    used[ha[0]] = used[ha[1]] = used[hb[0]] = used[hb[1]] = 1;
    const board = [];
    while (board.length < 5) {
      const c = (rnd() * 52) | 0;
      if (!used[c]) { used[c] = 1; board.push(c); }
    }
    const va = eval7(ha[0], ha[1], board[0], board[1], board[2], board[3], board[4]);
    const vb = eval7(hb[0], hb[1], board[0], board[1], board[2], board[3], board[4]);
    if (va > vb) score += 2; else if (va === vb) score += 1;
    valid++;
  }
  return score / (2 * valid);
}

console.log(`Generating 169x169 equity matrix, ${SAMPLES} samples/pair...`);
const start = Date.now();
const E = Array.from({ length: 169 }, () => new Array(169).fill(0));
let done = 0;
for (let a = 0; a < 169; a++) {
  for (let b = a; b < 169; b++) {
    const eq = pairEquity(a, b, SAMPLES);
    E[a][b] = Math.round(eq * 10000) / 10000;
    E[b][a] = Math.round((1 - eq) * 10000) / 10000;
    done++;
  }
  if (a % 20 === 0) console.log(`  row ${a}/169 (${done} pairs, ${((Date.now() - start) / 1000).toFixed(1)}s)`);
}
console.log(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);

// sanity checks
const RANKS = '23456789TJQKA';
function idOf(label) {
  const r1 = RANKS.indexOf(label[0]), r2 = RANKS.indexOf(label[1]);
  const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
  const a = 12 - hi, b = 12 - lo;
  if (r1 === r2) return a * 13 + a;
  return label[2] === 's' ? a * 13 + b : b * 13 + a;
}
console.log('AA vs KK:', E[idOf('AA')][idOf('KK')], '(expect ~0.82)');
console.log('AKs vs QQ:', E[idOf('AKs')][idOf('QQ')], '(expect ~0.46)');
console.log('AKo vs 22:', E[idOf('AKo')][idOf('22')], '(expect ~0.47)');
console.log('72o vs AA:', E[idOf('72o')][idOf('AA')], '(expect ~0.12)');

mkdirSync(join(__dirname, '..', 'data'), { recursive: true });
const out = 'globalThis.EQUITY169 = ' + JSON.stringify(E) + ';\n';
writeFileSync(join(__dirname, '..', 'data', 'equity169.js'), out);
console.log('Wrote data/equity169.js (' + (out.length / 1024).toFixed(0) + ' KB)');
