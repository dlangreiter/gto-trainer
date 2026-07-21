// Dealing + card display helpers.
(function () {
  const GTO = globalThis.GTO;

  function dealHand() {
    const c1 = (Math.random() * 52) | 0;
    let c2 = (Math.random() * 52) | 0;
    while (c2 === c1) c2 = (Math.random() * 52) | 0;
    // display high card first
    if ((c2 >> 2) > (c1 >> 2)) return [c2, c1];
    return [c1, c2];
  }

  // Sample a specific 2-card hand from a 169-frequency range (for villain jams).
  function sampleFromRange(freqs, excludeCards) {
    const weights = [];
    let total = 0;
    for (let h = 0; h < 169; h++) {
      const w = freqs[h] * GTO.classComboCount(h);
      weights.push(w);
      total += w;
    }
    if (total <= 0) return null;
    let r = Math.random() * total;
    let cls = 168;
    for (let h = 0; h < 169; h++) { r -= weights[h]; if (r <= 0) { cls = h; break; } }
    return cls;
  }

  function cardHtml(card, big) {
    const r = card >> 2, s = card & 3;
    const suitClass = ['spade', 'heart', 'diamond', 'club'][s];
    return `<div class="card ${suitClass}${big ? ' big' : ''}">` +
      `<span class="card-rank">${GTO.RANKS[r]}</span>` +
      `<span class="card-suit">${GTO.SUIT_CHARS[s]}</span></div>`;
  }

  globalThis.GTODeck = { dealHand, sampleFromRange, cardHtml };
})();
