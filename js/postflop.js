// Postflop engine: 7-card evaluator, combo-level ranges, board equities.
// Cards are 0..51 with rank = c >> 2 (0=deuce .. 12=ace), suit = c & 3 —
// the same encoding as deck.js and tools/gen_equity.mjs.
(function () {
  // ---- 7-card evaluator (ported from tools/gen_equity.mjs) ----
  // Returns a comparable integer (bigger = better):
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

    let quad = -1;
    const trips = [], pairs = [];
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
      let v = 5 << 20, got = 0;
      const bits = suitRanks[flushSuit];
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
    if ((bits & 0b1000000001111) === 0b1000000001111) return 3; // wheel
    return -1;
  }

  // ---- combos ----
  // Grid convention matches js/constants.js: a = 12-hiRank, b = 12-loRank;
  // pair a*13+a, suited a*13+b (upper triangle), offsuit b*13+a.
  const CLASS_COMBOS = [];
  for (let id = 0; id < 169; id++) {
    const a = Math.floor(id / 13), b = id % 13;
    const combos = [];
    if (a === b) {
      const r = 12 - a;
      for (let s1 = 0; s1 < 4; s1++)
        for (let s2 = s1 + 1; s2 < 4; s2++) combos.push([(r << 2) | s1, (r << 2) | s2]);
    } else if (a < b) {
      const hi = 12 - a, lo = 12 - b;
      for (let s = 0; s < 4; s++) combos.push([(hi << 2) | s, (lo << 2) | s]);
    } else {
      const hi = 12 - b, lo = 12 - a;
      for (let s1 = 0; s1 < 4; s1++)
        for (let s2 = 0; s2 < 4; s2++) if (s1 !== s2) combos.push([(hi << 2) | s1, (lo << 2) | s2]);
    }
    CLASS_COMBOS.push(combos);
  }

  // Expand a 169-class frequency range into weighted combos, excluding dead cards.
  // Returns [{c1, c2, w, cls}] — w is the class frequency (0..1].
  function rangeCombos(freqs, dead) {
    const deadMask = new Uint8Array(52);
    for (const c of dead || []) deadMask[c] = 1;
    const out = [];
    for (let id = 0; id < 169; id++) {
      const f = freqs[id];
      if (!f || f <= 0.001) continue;
      for (const [c1, c2] of CLASS_COMBOS[id]) {
        if (deadMask[c1] || deadMask[c2]) continue;
        out.push({ c1, c2, w: f, cls: id });
      }
    }
    return out;
  }

  // deterministic xorshift RNG (seedable for tests)
  function makeRng(seed) {
    let s = (seed || ((Math.random() * 0xFFFFFFFF) >>> 0) || 0x9E3779B9) >>> 0;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  // ---- hand vs range equity on a board ----
  // board: 3, 4 or 5 cards. River is exact; flop/turn use Monte Carlo runouts.
  function equityVsRange(hand, combos, board, samples, seed) {
    const used = new Uint8Array(52);
    used[hand[0]] = used[hand[1]] = 1;
    for (const c of board) used[c] = 1;

    if (board.length === 5) {
      const hv = eval7(hand[0], hand[1], board[0], board[1], board[2], board[3], board[4]);
      let score = 0, total = 0;
      for (const cb of combos) {
        if (used[cb.c1] || used[cb.c2]) continue;
        const vv = eval7(cb.c1, cb.c2, board[0], board[1], board[2], board[3], board[4]);
        score += cb.w * (hv > vv ? 1 : hv === vv ? 0.5 : 0);
        total += cb.w;
      }
      return total > 0 ? score / total : 0.5;
    }

    // flop/turn: Monte Carlo over villain combos and runouts
    const rnd = makeRng(seed);
    const live = combos.filter(cb => !used[cb.c1] && !used[cb.c2]);
    if (!live.length) return 0.5;
    let totalW = 0;
    for (const cb of live) totalW += cb.w;
    const need = 5 - board.length;
    const n = samples || 20000;
    let score = 0, counted = 0;
    for (let t = 0; t < n; t++) {
      // weighted villain combo
      let r = rnd() * totalW, cb = live[live.length - 1];
      for (let i = 0; i < live.length; i++) { r -= live[i].w; if (r <= 0) { cb = live[i]; break; } }
      used[cb.c1] = used[cb.c2] = 2;
      const extra = [];
      while (extra.length < need) {
        const c = (rnd() * 52) | 0;
        if (!used[c]) { used[c] = 3; extra.push(c); }
      }
      const b3 = board[0], b4 = board[1], b5 = board[2];
      const t4 = board.length >= 4 ? board[3] : extra[0];
      const t5 = board.length >= 4 ? extra[0] : extra[1];
      const hv = eval7(hand[0], hand[1], b3, b4, b5, t4, t5);
      const vv = eval7(cb.c1, cb.c2, b3, b4, b5, t4, t5);
      score += hv > vv ? 1 : hv === vv ? 0.5 : 0;
      counted++;
      used[cb.c1] = used[cb.c2] = 0;
      for (const c of extra) used[c] = 0;
    }
    return counted > 0 ? score / counted : 0.5;
  }

  // ---- range vs range equity on a board (Monte Carlo) ----
  function rangeVsRange(combosA, combosB, board, samples, seed) {
    const rnd = makeRng(seed);
    const used = new Uint8Array(52);
    for (const c of board) used[c] = 1;
    const liveA = combosA.filter(cb => !used[cb.c1] && !used[cb.c2]);
    const liveB = combosB.filter(cb => !used[cb.c1] && !used[cb.c2]);
    if (!liveA.length || !liveB.length) return 0.5;
    let wA = 0, wB = 0;
    for (const cb of liveA) wA += cb.w;
    for (const cb of liveB) wB += cb.w;
    const need = 5 - board.length;
    const n = samples || 30000;
    let score = 0, counted = 0;
    for (let t = 0; t < n; t++) {
      let r = rnd() * wA, ca = liveA[liveA.length - 1];
      for (let i = 0; i < liveA.length; i++) { r -= liveA[i].w; if (r <= 0) { ca = liveA[i]; break; } }
      r = rnd() * wB;
      let cbv = liveB[liveB.length - 1];
      for (let i = 0; i < liveB.length; i++) { r -= liveB[i].w; if (r <= 0) { cbv = liveB[i]; break; } }
      if (ca.c1 === cbv.c1 || ca.c1 === cbv.c2 || ca.c2 === cbv.c1 || ca.c2 === cbv.c2) continue;
      used[ca.c1] = used[ca.c2] = used[cbv.c1] = used[cbv.c2] = 2;
      const extra = [];
      while (extra.length < need) {
        const c = (rnd() * 52) | 0;
        if (!used[c]) { used[c] = 3; extra.push(c); }
      }
      const full = board.concat(extra);
      const va = eval7(ca.c1, ca.c2, full[0], full[1], full[2], full[3], full[4]);
      const vb = eval7(cbv.c1, cbv.c2, full[0], full[1], full[2], full[3], full[4]);
      score += va > vb ? 1 : va === vb ? 0.5 : 0;
      counted++;
      used[ca.c1] = used[ca.c2] = used[cbv.c1] = used[cbv.c2] = 0;
      for (const c of extra) used[c] = 0;
    }
    return counted > 0 ? score / counted : 0.5;
  }

  // ---- polarized jam-range model (river drills) ----
  // Rank a range's combos by exact showdown strength on a 5-card board and
  // return the top valuePct (by weight) plus the bottom bluffPct as the
  // betting range. A simple, stated model — not a solver output.
  function polarRange(combos, board5, valuePct, bluffPct) {
    const used = new Uint8Array(52);
    for (const c of board5) used[c] = 1;
    const scored = [];
    for (const cb of combos) {
      if (used[cb.c1] || used[cb.c2]) continue;
      scored.push({
        c1: cb.c1, c2: cb.c2, w: cb.w, cls: cb.cls,
        v: eval7(cb.c1, cb.c2, board5[0], board5[1], board5[2], board5[3], board5[4]),
      });
    }
    scored.sort((a, b) => b.v - a.v);
    let totalW = 0;
    for (const cb of scored) totalW += cb.w;
    const out = [];
    let acc = 0;
    for (let i = 0; i < scored.length && acc < valuePct * totalW; i++) {
      out.push(scored[i]);
      acc += scored[i].w;
    }
    acc = 0;
    for (let i = scored.length - 1; i >= 0 && acc < bluffPct * totalW; i--) {
      out.push(scored[i]);
      acc += scored[i].w;
    }
    return out;
  }

  // ---- call-vs-3-bet range model ----
  // The opener continues vs a 3-bet with the strongest part of its opening
  // range by preflop equity against the 3-bettor's range: the top fourBetPct
  // (by weight) 4-bets and is removed, the slice up to defendPct calls.
  // Needs globalThis.EQUITY169 (the preflop equity matrix) to be loaded.
  function callVs3betRange(open, tb, fourBetPct, defendPct) {
    const E = globalThis.EQUITY169;
    const loCut = fourBetPct ?? 0.06;
    const hiCut = defendPct ?? 0.54;
    const tbW = new Array(169).fill(0);
    let tbTot = 0;
    for (let v = 0; v < 169; v++) {
      const w = (tb[v] || 0) * CLASS_COMBOS[v].length;
      tbW[v] = w;
      tbTot += w;
    }
    const scored = [];
    let total = 0;
    for (let h = 0; h < 169; h++) {
      const f = open[h] || 0;
      if (f <= 0.01) continue;
      let eq = 0;
      for (let v = 0; v < 169; v++) if (tbW[v] > 0) eq += E[h][v] * tbW[v];
      const w = f * CLASS_COMBOS[h].length;
      scored.push({ h, eq: eq / (tbTot || 1), w, f });
      total += w;
    }
    scored.sort((a, b) => b.eq - a.eq);
    const out = new Array(169).fill(0);
    let acc = 0;
    for (const x of scored) {
      const before = acc;
      acc += x.w;
      const kept = Math.max(0, Math.min(acc, hiCut * total) - Math.max(before, loCut * total));
      out[x.h] = x.f * (kept / x.w);
    }
    return out;
  }

  // dealt-board helper: n random cards avoiding `dead`
  function dealBoard(n, dead) {
    const used = new Uint8Array(52);
    for (const c of dead || []) used[c] = 1;
    const out = [];
    while (out.length < n) {
      const c = (Math.random() * 52) | 0;
      if (!used[c]) { used[c] = 1; out.push(c); }
    }
    return out;
  }

  globalThis.GTOPostflop = {
    eval7, rangeCombos, equityVsRange, rangeVsRange, polarRange, dealBoard,
    callVs3betRange,
    classCombos: (id) => CLASS_COMBOS[id],
    makeRng,
  };
})();
