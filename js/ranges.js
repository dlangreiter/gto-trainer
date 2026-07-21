// Range-string parser ("55+, ATs+, KQs, AJo+, T9s-76s") and curated RFI charts.
(function () {
  const GTO = globalThis.GTO;
  const RANKS = GTO.RANKS;

  // Parse a range string into Float64Array(169) of frequencies.
  // Supports: "AA", "TT+", "ATs+", "A5s-A2s", "T9s-54s" (connector runs), "AJo+",
  // and weighted entries like "K9s:0.5".
  function parseRange(str) {
    const out = new Float64Array(169);
    if (!str) return out;
    for (let tokenRaw of str.split(',')) {
      let token = tokenRaw.trim();
      if (!token) continue;
      let weight = 1;
      const wi = token.indexOf(':');
      if (wi >= 0) { weight = parseFloat(token.slice(wi + 1)); token = token.slice(0, wi).trim(); }
      applyToken(token, weight, out);
    }
    return out;
  }

  function setClass(out, hi, lo, suited, weight) {
    const id = hi === lo ? GTO.classId(hi, hi, false) : GTO.classId(hi, lo, suited);
    out[id] = Math.max(out[id], weight);
  }

  function applyToken(token, weight, out) {
    const plus = token.endsWith('+');
    if (plus) token = token.slice(0, -1);

    const dash = token.indexOf('-');
    if (dash >= 0) {
      const a = token.slice(0, dash).trim(), b = token.slice(dash + 1).trim();
      const r1a = RANKS.indexOf(a[0]), r2a = RANKS.indexOf(a[1]);
      const r1b = RANKS.indexOf(b[0]), r2b = RANKS.indexOf(b[1]);
      if (a.length === 2 && b.length === 2) { // pair run: TT-66
        for (let r = Math.min(r1a, r1b); r <= Math.max(r1a, r1b); r++) setClass(out, r, r, false, weight);
        return;
      }
      const suited = a[2] === 's';
      if (r1a === r1b) { // same high card: A5s-A2s
        for (let r = Math.min(r2a, r2b); r <= Math.max(r2a, r2b); r++) setClass(out, r1a, r, suited, weight);
      } else { // connector run: T9s-54s (constant gap)
        const gap = r1a - r2a;
        for (let hi = Math.min(r1a, r1b); hi <= Math.max(r1a, r1b); hi++) setClass(out, hi, hi - gap, suited, weight);
      }
      return;
    }

    if (token.length === 2 && token[0] === token[1]) { // pair
      const r = RANKS.indexOf(token[0]);
      const top = plus ? 12 : r;
      for (let x = r; x <= top; x++) setClass(out, x, x, false, weight);
      return;
    }

    const hi = RANKS.indexOf(token[0]), lo = RANKS.indexOf(token[1]);
    const suited = token[2] === 's';
    if (plus) {
      // ATs+ : raise the low card up to just below the high card
      for (let x = lo; x < hi; x++) setClass(out, hi, x, suited, weight);
    } else {
      setClass(out, hi, lo, suited, weight);
    }
  }

  function rangePercent(freqs) {
    let combos = 0;
    for (let h = 0; h < 169; h++) combos += GTO.classComboCount(h) * freqs[h];
    return 100 * combos / 1326;
  }

  // ---- Curated MTT RFI (first-in raise) charts, ~40bb+ ----
  // Solid baseline ranges in the style of modern MTT solver outputs.
  const RFI_STRINGS = {
    'UTG':   '55+, ATs+, A5s-A4s, KTs+, QTs+, JTs, T9s, AJo+, KQo',
    'UTG+1': '44+, A9s+, A5s-A3s, KTs+, QTs+, JTs, T9s, 98s, ATo+, KQo',
    'UTG+2': '33+, A8s+, A5s-A2s, K9s+, Q9s+, J9s+, T9s, 98s, 87s, ATo+, KJo+',
    'LJ':    '22+, A7s+, A5s-A2s, K9s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, ATo+, KJo+, QJo',
    'HJ':    '22+, A2s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, 65s, A9o+, KTo+, QTo+, JTo',
    'CO':    '22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 76s, 65s, 54s, A8o+, A5o, KTo+, QTo+, JTo, T9o',
    'BTN':   '22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 75s+, 64s+, 54s, 43s, A2o+, K8o+, Q9o+, J9o+, T9o, 98o',
    'SB':    '22+, A2s+, K2s+, Q4s+, J7s+, T7s+, 96s+, 86s+, 75s+, 65s, 54s, A2o+, K9o+, Q9o+, J9o+, T9o',
  };

  const RFI = {};
  for (const pos in RFI_STRINGS) RFI[pos] = parseRange(RFI_STRINGS[pos]);

  // ---- Facing an open raise (~2.2x, 40bb+): 3-bet / call / fold charts ----
  // Opener buckets: EP (UTG..UTG+2), MP (LJ/HJ), CO, BTN, SB.
  // Hero contexts: BB, SB, or IP (a non-blind seat behind the opener).
  const VSRFI_STRINGS = {
    BB_vs_EP: {
      threebet: 'QQ+, AKs, AKo:0.5, A5s:0.35, KQs:0.2',
      call: '22-JJ, A2s-AQs, AKo:0.5, K9s+, Q9s+, J9s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, ATo-AJo, KJo+, QJo, JTo:0.5',
    },
    BB_vs_MP: {
      threebet: 'JJ+, AQs+, AKo, A5s-A4s:0.5, KJs:0.25, 76s:0.25',
      call: '22-TT, A2s-AJs, K9s+, Q9s+, J8s+, T8s+, 97s+, 86s+, 75s+, 64s+, 54s, 43s:0.5, ATo-AQo, KTo+, QTo+, JTo, T9o:0.5',
    },
    BB_vs_CO: {
      threebet: 'TT+, AJs+, AQo+, A5s-A2s:0.5, KQs:0.5, K5s:0.3, 76s:0.3, 65s:0.3',
      call: '22-99, A2s-ATs, K6s+, Q8s+, J8s+, T7s+, 96s+, 86s+, 75s+, 64s+, 53s+, 43s, A5o+, K9o+, Q9o+, J9o+, T9o, 98o:0.5',
    },
    BB_vs_BTN: {
      threebet: '99+, ATs+, AJo+, KQs, A5s-A2s, K9s:0.5, Q9s:0.5, J9s:0.5, T8s:0.4, 87s:0.4, KQo:0.5',
      call: '22-88, A2s-A9s, K2s+, Q4s+, J7s+, T6s+, 96s+, 85s+, 74s+, 64s+, 53s+, 43s, A2o+, K8o+, Q9o+, J8o+, T8o+, 98o, 87o:0.5',
    },
    BB_vs_SB: {
      threebet: '88+, A9s+, ATo+, KJs+, KQo, A5s-A2s, K9s:0.5, T9s:0.5, 98s:0.5, 87s:0.5',
      call: '22-77, A2s-A8s, K2s+, Q2s+, J4s+, T6s+, 95s+, 84s+, 74s+, 63s+, 53s+, 43s, A2o+, K5o+, Q8o+, J8o+, T8o+, 97o+, 87o',
    },
    SB_vs_EP: {
      threebet: 'JJ+, AQs+, AKo, A5s:0.4, KQs:0.4',
      call: '99-TT:0.5, AJs:0.5, ATs:0.25, KJs:0.25',
    },
    SB_vs_MP: {
      threebet: 'TT+, AJs+, AQo+, A5s-A4s:0.5, KQs, KJs:0.4, 76s:0.25',
      call: '77-99:0.5, ATs:0.5, KTs:0.4, QJs:0.4, JTs:0.3',
    },
    SB_vs_CO: {
      threebet: '99+, ATs+, AJo+, KTs+, KQo:0.5, A5s-A2s, QJs, 87s:0.4, 76s:0.4',
      call: '44-88:0.5, A8s-A9s:0.5, QTs:0.4, JTs:0.4, T9s:0.4',
    },
    SB_vs_BTN: {
      threebet: '77+, A8s+, ATo+, KTs+, KQo, QTs+, JTs, A5s-A2s, K9s:0.5, T9s:0.5, 98s:0.5, 65s:0.4, 54s:0.4',
      call: '22-66:0.5, A6s-A7s:0.5, KJo:0.4, QJo:0.3, 87s:0.5',
    },
    IP_vs_EP: {
      threebet: 'QQ+, AKs, AKo:0.6, A5s:0.3',
      call: '66-JJ, AQs, AJs:0.5, ATs:0.25, KQs:0.5, KJs:0.25, QJs:0.4, JTs:0.4, T9s:0.4, 98s:0.25',
    },
    IP_vs_MP: {
      threebet: 'JJ+, AQs+, AKo, A5s-A4s:0.4, KJs:0.25',
      call: '55-TT, ATs-AJs, KTs+, QTs+, JTs, T9s:0.5, 98s:0.4, 87s:0.3, AQo:0.5, KQo:0.4',
    },
    IP_vs_CO: {
      threebet: 'TT+, AJs+, AQo+, A5s-A3s:0.5, KQs:0.6, KJs:0.4, 76s:0.25, 65s:0.25',
      call: '22-99, ATs, K9s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s:0.5, AJo:0.6, KQo:0.6, KJo:0.3, QJo:0.3',
    },
  };

  const VSRFI = {};
  for (const key in VSRFI_STRINGS) {
    const threebet = parseRange(VSRFI_STRINGS[key].threebet);
    const call = parseRange(VSRFI_STRINGS[key].call);
    // 3-bet takes priority where the ranges overlap; the remainder flats
    for (let h = 0; h < 169; h++) call[h] = Math.max(0, Math.min(call[h], 1 - threebet[h]));
    VSRFI[key] = { threebet, call };
  }

  const VSRFI_LABELS = {
    BB_vs_EP: 'BB vs EP open', BB_vs_MP: 'BB vs LJ/HJ open', BB_vs_CO: 'BB vs CO open',
    BB_vs_BTN: 'BB vs BTN open', BB_vs_SB: 'BB vs SB open',
    SB_vs_EP: 'SB vs EP open', SB_vs_MP: 'SB vs LJ/HJ open', SB_vs_CO: 'SB vs CO open',
    SB_vs_BTN: 'SB vs BTN open',
    IP_vs_EP: 'In position vs EP open', IP_vs_MP: 'In position vs LJ/HJ open',
    IP_vs_CO: 'BTN vs CO open',
  };

  function openerBucket(posName) {
    if (posName.indexOf('UTG') === 0) return 'EP';
    if (posName === 'LJ' || posName === 'HJ') return 'MP';
    if (posName === 'CO') return 'CO';
    if (posName === 'BTN') return 'BTN';
    if (posName === 'SB') return 'SB';
    return 'EP';
  }

  // chart key for hero facing an open; IP heroes only ever face EP/MP/CO opens
  function vsrfiKey(heroName, openerName) {
    const b = openerBucket(openerName);
    if (heroName === 'BB') return 'BB_vs_' + b;
    if (heroName === 'SB') return 'SB_vs_' + b;
    return 'IP_vs_' + (b === 'BTN' || b === 'SB' ? 'CO' : b);
  }

  globalThis.GTORanges = {
    parseRange, rangePercent, RFI, RFI_STRINGS,
    VSRFI, VSRFI_LABELS, vsrfiKey, openerBucket,
  };
})();
