// Shared constants + 169-hand-class utilities. Plain script: attaches to globalThis.GTO.
(function () {
  const RANKS = '23456789TJQKA';            // rank index 0=2 .. 12=A
  const RANKS_DESC = 'AKQJT98765432';
  const SUITS = ['s', 'h', 'd', 'c'];
  const SUIT_CHARS = ['♠', '♥', '♦', '♣'];

  // Grid convention: a = 12 - hiRank, b = 12 - loRank (a<=b, A first).
  // id: pair -> a*13+a ; suited -> a*13+b ; offsuit -> b*13+a.

  function classId(rank1, rank2, suited) {
    const hi = Math.max(rank1, rank2), lo = Math.min(rank1, rank2);
    const a = 12 - hi, b = 12 - lo;
    if (hi === lo) return a * 13 + a;
    return suited ? a * 13 + b : b * 13 + a;
  }

  function classIdOfCards(c1, c2) {
    return classId(c1 >> 2, c2 >> 2, (c1 & 3) === (c2 & 3));
  }

  function handLabel(id) {
    const a = Math.floor(id / 13), b = id % 13;
    if (a === b) return RANKS_DESC[a] + RANKS_DESC[a];
    if (a < b) return RANKS_DESC[a] + RANKS_DESC[b] + 's';
    return RANKS_DESC[b] + RANKS_DESC[a] + 'o';
  }

  function labelToId(label) {
    const r1 = RANKS.indexOf(label[0]), r2 = RANKS.indexOf(label[1]);
    if (r1 < 0 || r2 < 0) return -1;
    if (r1 === r2) return (12 - r1) * 13 + (12 - r1);
    return classId(r1, r2, label[2] === 's');
  }

  // combos in each class (no card removal)
  function classComboCount(id) {
    const a = Math.floor(id / 13), b = id % 13;
    if (a === b) return 6;
    return a < b ? 4 : 12;
  }

  // ranks used by a class: [hiRank, loRank]
  function classRanks(id) {
    const a = Math.floor(id / 13), b = id % 13;
    if (a === b) return [12 - a, 12 - a];
    if (a < b) return [12 - a, 12 - b];
    return [12 - b, 12 - a];
  }

  // Blocker-adjusted combo weight of villain class v given hero holds class h
  // (expected combos, averaged over hero's specific suits).
  function comboWeightGiven(hId, vId) {
    const [h1, h2] = classRanks(hId);
    const cnt = new Array(13).fill(0);
    cnt[h1]++; cnt[h2]++;
    const a = Math.floor(vId / 13), b = vId % 13;
    if (a === b) {
      const r = 12 - a, avail = 4 - cnt[r];
      return (avail * (avail - 1)) / 2;
    }
    const [x, y] = classRanks(vId);
    const ax = 4 - cnt[x], ay = 4 - cnt[y];
    const suited = (ax * ay) / 4;
    return a < b ? suited : ax * ay - suited;
  }

  // Precomputed 169x169 blocker weight matrix
  let W = null;
  function weightMatrix() {
    if (W) return W;
    W = new Array(169);
    for (let h = 0; h < 169; h++) {
      W[h] = new Float64Array(169);
      for (let v = 0; v < 169; v++) W[h][v] = comboWeightGiven(h, v);
    }
    return W;
  }

  // Position names in preflop acting order (first-to-act ... SB, BB).
  const POSITION_NAMES = {
    2: ['SB', 'BB'],
    3: ['BTN', 'SB', 'BB'],
    4: ['CO', 'BTN', 'SB', 'BB'],
    5: ['HJ', 'CO', 'BTN', 'SB', 'BB'],
    6: ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
    7: ['UTG', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
    8: ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
    9: ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  };

  globalThis.GTO = {
    RANKS, RANKS_DESC, SUITS, SUIT_CHARS,
    classId, classIdOfCards, handLabel, labelToId,
    classComboCount, classRanks, comboWeightGiven, weightMatrix,
    POSITION_NAMES,
  };
})();
