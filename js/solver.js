// Push/fold Nash solver via fictitious play.
// Model: first-in shove or fold; players behind call all-in or fold.
// Up to two callers are considered (3+ way all-ins are vanishingly rare at equilibrium).
// All amounts in big blinds. Requires globalThis.EQUITY169 and globalThis.GTO.
(function () {
  const NUM_HANDS = 169;

  // Malmuth-Harville ICM: expected payout per player for a stack vector.
  // Subset DP over "which players occupy the top |S| places", pruned to paid places.
  function icmEquities(stacksIn, payouts) {
    const n = stacksIn.length;
    const stacks = stacksIn.map(x => Math.max(x, 1e-9));
    const m = Math.min(payouts.length, n);
    const size = 1 << n;
    const total = stacks.reduce((s, x) => s + x, 0);
    const bitIdx = new Int8Array(size);
    for (let i = 0; i < n; i++) bitIdx[1 << i] = i;
    const sumS = new Float64Array(size);
    const pc = new Uint8Array(size);
    for (let S = 1; S < size; S++) {
      const lsb = S & -S;
      sumS[S] = sumS[S ^ lsb] + stacks[bitIdx[lsb]];
      pc[S] = pc[S >> 1] + (S & 1);
    }
    const h = new Float64Array(size);
    h[0] = 1;
    const eq = new Float64Array(n);
    for (let S = 1; S < size; S++) {
      const places = pc[S];
      if (places > m) continue;
      let acc = 0, rem = S;
      while (rem) {
        const lsb = rem & -rem; rem ^= lsb;
        const i = bitIdx[lsb];
        const Sp = S ^ lsb;
        if (h[Sp] === 0) continue;
        const w = h[Sp] * stacks[i] / (total - sumS[Sp]);
        acc += w;
        eq[i] += payouts[places - 1] * w;
      }
      h[S] = acc;
    }
    return eq;
  }

  // cfg: {
  //   stacks: number[]            stacks in BB, indexed by acting order (last two = SB, BB; HU: [SB, BB])
  //   anteMode: 'none'|'bb'|'classic'
  //   ante: number                per-player ante in BB (classic mode) or total (bb mode = 1 typically)
  //   iterations: number
  //   onProgress: (frac) => void  optional
  // }
  // Returns {
  //   push: Float64Array[nPos][169]        first-in shove frequency
  //   call: call[caller][pusher] -> Float64Array(169)   call-vs-shove frequency
  //   evPush: [pos][169] EV(shove) - EV(fold) in BB
  //   evCall: [caller][pusher][169] EV(call) - EV(fold) in BB
  // }
  function solvePushFold(cfg) {
    const GTO = globalThis.GTO;
    const E = globalThis.EQUITY169;
    const W = GTO.weightMatrix();
    const n = cfg.stacks.length;
    const iterations = cfg.iterations || 200;
    // tree: 'jam' (default, jam-or-fold) | 'raise' (open 2.2x / jam / fold; behind:
    // reshove-jam or fold vs the open; opener calls or folds vs a reshove)
    const RAISE = cfg.tree === 'raise';
    const openSize = cfg.openSize || 2.2;

    // per-player posted blind and ante (BB units)
    const blind = new Array(n).fill(0);
    blind[n - 2] = 0.5;
    blind[n - 1] = 1.0;
    if (n === 2) { blind[0] = 0.5; blind[1] = 1.0; }

    const ante = new Array(n).fill(0);
    if (cfg.anteMode === 'classic') ante.fill(cfg.ante || 0);
    else if (cfg.anteMode === 'bb') ante[n - 1] = cfg.ante || 1;
    const totalAnte = ante.reduce((s, x) => s + x, 0);

    // playable stack (post-ante); blind is posted from this and part of any all-in
    const p = cfg.stacks.map((s, i) => Math.max(0.01, s - ante[i]));

    // ---- ICM mode: precompute $-payoff constants for every terminal outcome ----
    // Outcome stack vectors don't depend on hole cards, so all Malmuth-Harville
    // evaluations happen once here; the fictitious-play loop just mixes constants.
    let ICM = null;
    if (cfg.icm && Array.isArray(cfg.icm.payouts) && cfg.icm.payouts.length > 0) {
      const payouts = cfg.icm.payouts;
      const potAll = totalAnte + blind.reduce((s, x) => s + x, 0);
      const base = p.map((x, k) => Math.max(0, x - blind[k])); // blinds posted, pot pending
      const deadFor = (parts) => {
        let d = totalAnte;
        for (let k = 0; k < n; k++) if (!parts.includes(k)) d += blind[k];
        return d;
      };
      // everyone folds through: BB collects blinds + antes
      const foldVec = base.slice();
      foldVec[n - 1] += potAll;
      const foldEq = icmEquities(foldVec, payouts);
      // pusher j jams, all fold
      const stealEq = [];
      for (let j = 0; j < n; j++) {
        const v = base.slice();
        v[j] += potAll;
        stealEq.push(icmEquities(v, payouts));
      }
      // heads-up showdown: w beats l (same vector whether w pushed or called)
      const winEq = [];
      for (let w = 0; w < n; w++) {
        winEq.push(new Array(n).fill(null));
        for (let l = 0; l < n; l++) {
          if (l === w) continue;
          const m = Math.min(p[w], p[l]);
          const v = base.slice();
          v[w] = p[w] + m + deadFor([w, l]);
          v[l] = Math.max(0, p[l] - m);
          winEq[w][l] = icmEquities(v, payouts);
        }
      }
      // three-way all-in: winner scoops what they cover from each opponent
      const win3 = (w, a, b) => {
        const ma = Math.min(p[w], p[a]), mb = Math.min(p[w], p[b]);
        const v = base.slice();
        v[w] = p[w] + ma + mb + deadFor([w, a, b]);
        v[a] = Math.max(0, p[a] - ma);
        v[b] = Math.max(0, p[b] - mb);
        return icmEquities(v, payouts);
      };
      const tri = new Map(); // pusher i, callers j<k — payoffs from i's seat
      for (let i = 0; i < n - 1; i++) {
        for (let j = i + 1; j < n; j++) {
          for (let k = j + 1; k < n; k++) {
            tri.set(i + '|' + j + '|' + k, {
              wi: win3(i, j, k)[i],
              wj: win3(j, i, k)[i],
              wk: win3(k, i, j)[i],
            });
          }
        }
      }
      // raise tree: opener i folds their open to j's reshove (loses openSize to j)
      let openFoldEq = null;
      if (RAISE) {
        openFoldEq = [];
        for (let i = 0; i < n; i++) {
          openFoldEq.push(new Array(n).fill(null));
          for (let j = i + 1; j < n; j++) {
            const v = base.slice();
            v[i] = Math.max(0, p[i] - openSize);
            v[j] = p[j] + openSize + deadFor([i, j]); // antes + open + other blinds
            openFoldEq[i][j] = icmEquities(v, payouts);
          }
        }
      }
      ICM = { foldEq, stealEq, winEq, tri, openFoldEq };
    }

    // ---- PKO mode: bounty bonus (in bb) for busting a covered player ----
    // PKO[w][l] = bounty value w collects when beating l all-in (0 if l survives).
    let PKO = null;
    if (!ICM && cfg.pko && Array.isArray(cfg.pko.bounties) && cfg.pko.bounties.length > 0) {
      const frac = typeof cfg.pko.fraction === 'number' ? cfg.pko.fraction : 0.65;
      const bounties = cfg.pko.bounties;
      PKO = [];
      for (let w = 0; w < n; w++) {
        const row = new Float64Array(n);
        for (let l = 0; l < n; l++) {
          if (l !== w && p[l] <= p[w] + 1e-9) row[l] = frac * (bounties[Math.min(l, bounties.length - 1)] || 0);
        }
        PKO.push(row);
      }
    }

    // strategies (average): push[i][h], call[i][j][h] for caller i vs pusher j (i > j)
    const push = [], call = [];
    for (let i = 0; i < n; i++) {
      push.push(new Float64Array(NUM_HANDS));
      const ci = [];
      for (let j = 0; j < n; j++) ci.push(j < i ? new Float64Array(NUM_HANDS) : null);
      call.push(ci);
    }
    // initialize with a loose heuristic so early best-responses aren't vs empty ranges
    for (let i = 0; i < n - 1; i++) push[i].fill(RAISE ? 0.2 : 0.5);
    for (let i = 1; i < n; i++) for (let j = 0; j < i; j++) if (call[i][j]) call[i][j].fill(0.3);

    // raise-tree strategies: openR[i] open freq; rsh[j][i] reshove-vs-open (j>i... j acts
    // after i); c3b[i][j] opener i calls j's reshove. Stored like call[][]: outer = actor.
    let openR = null, rsh = null, c3b = null, evOpen = null, evRsh = null, evC3b = null;
    let brOpenArr = null, brRshArr = null, brC3bArr = null, c3bIter = null;
    if (RAISE) {
      openR = []; evOpen = []; brOpenArr = [];
      rsh = []; evRsh = []; brRshArr = [];
      c3b = []; evC3b = []; brC3bArr = []; c3bIter = [];
      for (let i = 0; i < n; i++) {
        openR.push(new Float64Array(NUM_HANDS).fill(i < n - 1 ? 0.25 : 0));
        evOpen.push(new Float64Array(NUM_HANDS));
        brOpenArr.push(new Float64Array(NUM_HANDS));
        const r = [], er = [], br = [], c = [], ec = [], bc = [], ci = [];
        for (let j = 0; j < n; j++) {
          r.push(j < i ? new Float64Array(NUM_HANDS).fill(0.12) : null);   // rsh[i][j]: i reshoves vs j's open (j<i)
          er.push(j < i ? new Float64Array(NUM_HANDS) : null);
          br.push(j < i ? new Float64Array(NUM_HANDS) : null);
          c.push(j > i ? new Float64Array(NUM_HANDS).fill(0.35) : null);   // c3b[i][j]: opener i calls j's reshove (j>i)
          ec.push(j > i ? new Float64Array(NUM_HANDS) : null);
          bc.push(j > i ? new Float64Array(NUM_HANDS) : null);
          ci.push(j > i ? new Float64Array(NUM_HANDS) : null);
        }
        rsh.push(r); evRsh.push(er); brRshArr.push(br);
        c3b.push(c); evC3b.push(ec); brC3bArr.push(bc); c3bIter.push(ci);
      }
    }

    const evPush = [], evCall = [];
    for (let i = 0; i < n; i++) {
      evPush.push(new Float64Array(NUM_HANDS));
      const ei = [];
      for (let j = 0; j < n; j++) ei.push(j < i ? new Float64Array(NUM_HANDS) : null);
      evCall.push(ei);
    }

    // scratch
    const brPush = [], brCall = [];
    for (let i = 0; i < n; i++) {
      brPush.push(new Float64Array(NUM_HANDS));
      const bi = [];
      for (let j = 0; j < n; j++) bi.push(j < i ? new Float64Array(NUM_HANDS) : null);
      brCall.push(bi);
    }

    // dead money in a showdown pot: antes + blinds of players not in {participants}
    function deadMoney(participants) {
      let d = totalAnte;
      for (let k = 0; k < n; k++) {
        if (!participants.includes(k)) d += blind[k];
      }
      return d;
    }

    // EV(shove) - EV(fold) for pusher i holding hand h.
    // cProb[j][h], cEq[j][h] precomputed: call prob & avg equity vs j's calling range.
    function pushEvAll(i, cProb, cEq, out) {
      const opps = [];
      for (let j = i + 1; j < n; j++) opps.push(j);
      // if everyone folds, pusher collects all antes + all blinds behind (blinds are
      // always behind a first-in pusher) and keeps his own posted blind
      const foldAllGain = ICM ? ICM.stealEq[i][i]
        : totalAnte - ante[i] + opps.reduce((s, j) => s + blind[j], 0);
      const evFold = ICM ? ICM.foldEq[i]
        : -blind[i]; // relative to (stack - ante); ante is sunk either way

      for (let h = 0; h < NUM_HANDS; h++) {
        // gather per-opponent call prob and equity for this hand
        const cp = [], ce = [];
        for (let oi = 0; oi < opps.length; oi++) {
          const j = opps[oi];
          cp.push(cProb[j][h]);
          ce.push(cEq[j][h]);
        }
        // P(all fold)
        let pAllFold = 1;
        for (let oi = 0; oi < cp.length; oi++) pAllFold *= (1 - cp[oi]);
        let ev = pAllFold * foldAllGain;

        // exactly one caller
        let probMass = pAllFold;
        for (let oi = 0; oi < cp.length; oi++) {
          if (cp[oi] <= 0) continue;
          let pr = cp[oi];
          for (let ok = 0; ok < cp.length; ok++) if (ok !== oi) pr *= (1 - cp[ok]);
          if (pr <= 0) continue;
          probMass += pr;
          const j = opps[oi];
          const eq = ce[oi];
          if (ICM) {
            ev += pr * (eq * ICM.winEq[i][j][i] + (1 - eq) * ICM.winEq[j][i][i]);
          } else {
            const m = Math.min(p[i], p[j]);
            const dead = deadMoney([i, j]);
            ev += pr * (-m + eq * (2 * m + dead));
            if (PKO) ev += pr * eq * PKO[i][j];
          }
        }

        // exactly two callers (approximate 3-way equity from pairwise)
        for (let o1 = 0; o1 < cp.length; o1++) {
          if (cp[o1] <= 0) continue;
          for (let o2 = o1 + 1; o2 < cp.length; o2++) {
            if (cp[o2] <= 0) continue;
            let pr = cp[o1] * cp[o2];
            for (let ok = 0; ok < cp.length; ok++) if (ok !== o1 && ok !== o2) pr *= (1 - cp[ok]);
            if (pr <= 1e-9) continue;
            probMass += pr;
            const j = opps[o1], k = opps[o2];
            const eqJ = ce[o1], eqK = ce[o2];
            // 3-way equity: normalized product approximation from pairwise equities
            const eq3 = eqJ * eqK /
              (eqJ * eqK + (1 - eqJ) * (1 - eqK) + ((1 - eqJ) * eqK + eqJ * (1 - eqK)) * 0.5 + 1e-9);
            if (ICM) {
              const t = ICM.tri.get(i + '|' + j + '|' + k);
              ev += pr * (eq3 * t.wi + (1 - eq3) * 0.5 * (t.wj + t.wk));
            } else {
              const q1 = Math.min(p[i], p[j], p[k]);          // main pot per-player
              const q2 = Math.min(p[i], Math.max(p[j], p[k])); // pusher's total commitment
              const dead = deadMoney([i, j, k]);
              let dv = -q2 + eq3 * (3 * q1 + dead);
              // side pot vs the deeper caller, if stacks differ
              if (q2 > q1) {
                const eqSide = p[j] >= p[k] ? eqJ : eqK;
                dv += eqSide * 2 * (q2 - q1);
              }
              if (PKO) dv += eq3 * (PKO[i][j] + PKO[i][k]);
              ev += pr * dv;
            }
          }
        }

        // normalize tiny truncation (3+ callers ignored)
        if (probMass < 0.9999 && probMass > 0) ev /= probMass;
        out[h] = ev - evFold;
      }
    }

    // EV(call) - EV(fold) for caller i vs pusher j, all hands. Assumes others fold.
    function callEvAll(i, j, out) {
      const pushJ = push[j];
      const m = Math.min(p[i], p[j]);
      const dead = deadMoney([i, j]);
      const evFold = ICM ? ICM.stealEq[j][i] : -blind[i];
      for (let h = 0; h < NUM_HANDS; h++) {
        const Wh = W[h], Eh = E[h];
        let wSum = 0, eqSum = 0;
        for (let v = 0; v < NUM_HANDS; v++) {
          const w = Wh[v] * pushJ[v];
          if (w > 0) { wSum += w; eqSum += w * Eh[v]; }
        }
        if (wSum <= 0) { out[h] = -1; continue; }
        const eq = eqSum / wSum;
        if (ICM) {
          out[h] = (eq * ICM.winEq[i][j][i] + (1 - eq) * ICM.winEq[j][i][i]) - evFold;
        } else {
          out[h] = (-m + eq * (2 * m + dead)) - evFold;
          if (PKO) out[h] += eq * PKO[i][j];
        }
      }
    }

    // ---- raise-tree EV functions ----

    // opener i facing a reshove from j (j > i): EV(call) - EV(fold-losing-open)
    function c3bEvAll(i, j, out) {
      const rshJ = rsh[j][i];
      const m = Math.min(p[i], p[j]);
      const dead = deadMoney([i, j]);
      for (let h = 0; h < NUM_HANDS; h++) {
        const Wh = W[h], Eh = E[h];
        let wSum = 0, eqSum = 0;
        for (let v = 0; v < NUM_HANDS; v++) {
          const w = Wh[v] * rshJ[v];
          if (w > 0) { wSum += w; eqSum += w * Eh[v]; }
        }
        if (wSum <= 0) { out[h] = -1; continue; }
        const eq = eqSum / wSum;
        if (ICM) {
          out[h] = (eq * ICM.winEq[i][j][i] + (1 - eq) * ICM.winEq[j][i][i]) - ICM.openFoldEq[i][j][i];
        } else {
          out[h] = (-m + eq * (2 * m + dead)) - (-openSize);
          if (PKO) out[h] += eq * PKO[i][j];
        }
      }
    }

    // player i reshoving all-in over opener j's open (j < i): EV(reshove) - EV(fold)
    function rshEvAll(i, j, out) {
      const openJ = openR[j], c3bJ = c3b[j][i];
      const m = Math.min(p[i], p[j]);
      const dead = deadMoney([i, j]);
      const uncalled = totalAnte - ante[i] + openSize + (dead - totalAnte); // antes + open + other blinds
      for (let h = 0; h < NUM_HANDS; h++) {
        const Wh = W[h], Eh = E[h];
        let wTot = 0, wCall = 0, eqSum = 0;
        for (let v = 0; v < NUM_HANDS; v++) {
          const w = Wh[v] * openJ[v];
          if (w > 0) {
            wTot += w;
            const wc = w * c3bJ[v];
            if (wc > 0) { wCall += wc; eqSum += wc * Eh[v]; }
          }
        }
        if (wTot <= 0) { out[h] = 0; continue; }
        const pcall = wCall / wTot;
        const eq = wCall > 0 ? eqSum / wCall : 0.5;
        if (ICM) {
          out[h] = (1 - pcall) * ICM.openFoldEq[j][i][i] +
            pcall * (eq * ICM.winEq[i][j][i] + (1 - eq) * ICM.winEq[j][i][i]) -
            ICM.stealEq[j][i];
        } else {
          out[h] = (1 - pcall) * uncalled + pcall * (-m + eq * (2 * m + dead)) - (-blind[i]);
          if (PKO) out[h] += pcall * eq * PKO[i][j];
        }
      }
    }

    // opener i's EV(open 2.2x) - EV(fold), given reshove ranges behind and i's own
    // best continuation vs each reshove (this iteration's c3bIter values)
    const rProb = [];
    for (let j = 0; j < n; j++) rProb.push(new Float64Array(NUM_HANDS));

    function openEvAll(i, out) {
      const opps = [];
      for (let j = i + 1; j < n; j++) opps.push(j);
      // reshove prob per opponent per hero hand (blocker-weighted)
      for (const j of opps) {
        const rj = rsh[j][i], pj = rProb[j];
        for (let h = 0; h < NUM_HANDS; h++) {
          const Wh = W[h];
          let wTot = 0, wR = 0;
          for (let v = 0; v < NUM_HANDS; v++) {
            const w = Wh[v];
            wTot += w;
            wR += w * rj[v];
          }
          pj[h] = wTot > 0 ? wR / wTot : 0;
        }
      }
      const stealGain = ICM ? ICM.stealEq[i][i]
        : totalAnte - ante[i] + opps.reduce((s, j) => s + blind[j], 0);
      const evFold = ICM ? ICM.foldEq[i] : -blind[i];
      for (let h = 0; h < NUM_HANDS; h++) {
        let ev = 0, cum = 1;
        for (const j of opps) {
          const rj = rProb[j][h];
          if (rj > 0) {
            const foldVal = ICM ? ICM.openFoldEq[i][j][i] : -openSize;
            const cont = foldVal + Math.max(0, c3bIter[i][j][h]);
            ev += cum * rj * cont;
          }
          cum *= (1 - rj);
        }
        ev += cum * stealGain;
        out[h] = ev - evFold;
      }
    }

    // precompute per-opponent call prob / avg equity arrays vs pusher i
    // cProb[j][h] = P(j calls i's shove | hero holds h), cEq[j][h] = avg equity of h vs j's calls
    const cProb = [], cEq = [];
    for (let j = 0; j < n; j++) { cProb.push(new Float64Array(NUM_HANDS)); cEq.push(new Float64Array(NUM_HANDS)); }

    function computeCallStats(i) {
      for (let j = i + 1; j < n; j++) {
        const cj = call[j][i];
        const pj = cProb[j], ej = cEq[j];
        for (let h = 0; h < NUM_HANDS; h++) {
          const Wh = W[h], Eh = E[h];
          let wTot = 0, wCall = 0, eqSum = 0;
          for (let v = 0; v < NUM_HANDS; v++) {
            const w = Wh[v];
            wTot += w;
            const wc = w * cj[v];
            if (wc > 0) { wCall += wc; eqSum += wc * Eh[v]; }
          }
          pj[h] = wTot > 0 ? wCall / wTot : 0;
          ej[h] = wCall > 0 ? eqSum / wCall : 0.5;
        }
      }
    }

    const scratchEv = new Float64Array(NUM_HANDS);
    const scratchEv2 = new Float64Array(NUM_HANDS);

    for (let t = 1; t <= iterations; t++) {
      if (RAISE) {
        // opener's continuation vs each reshover (also feeds openEvAll this iteration)
        for (let i = 0; i < n - 1; i++) {
          for (let j = i + 1; j < n; j++) {
            const iter = c3bIter[i][j];
            c3bEvAll(i, j, iter);
            const br = brC3bArr[i][j], evc = evC3b[i][j];
            for (let h = 0; h < NUM_HANDS; h++) {
              br[h] = iter[h] > 0 ? 1 : 0;
              evc[h] += (iter[h] - evc[h]) / t;
            }
          }
        }
        // reshove-or-fold vs each opener
        for (let i = 1; i < n; i++) {
          for (let j = 0; j < i; j++) {
            rshEvAll(i, j, scratchEv);
            const br = brRshArr[i][j], evr = evRsh[i][j];
            for (let h = 0; h < NUM_HANDS; h++) {
              br[h] = scratchEv[h] > 0 ? 1 : 0;
              evr[h] += (scratchEv[h] - evr[h]) / t;
            }
          }
        }
      }
      // best response for each first-in player: fold / (open) / jam
      for (let i = 0; i < n - 1; i++) {
        computeCallStats(i);
        pushEvAll(i, cProb, cEq, scratchEv);
        const brP = brPush[i], evp = evPush[i];
        if (RAISE) {
          openEvAll(i, scratchEv2);
          const brO = brOpenArr[i], evo = evOpen[i];
          for (let h = 0; h < NUM_HANDS; h++) {
            const evJ = scratchEv[h], evO = scratchEv2[h];
            brP[h] = (evJ > 0 && evJ >= evO) ? 1 : 0;
            brO[h] = (evO > 0 && evO > evJ) ? 1 : 0;
            evp[h] += (evJ - evp[h]) / t;
            evo[h] += (evO - evo[h]) / t;
          }
        } else {
          for (let h = 0; h < NUM_HANDS; h++) {
            brP[h] = scratchEv[h] > 0 ? 1 : 0;
            evp[h] += (scratchEv[h] - evp[h]) / t;
          }
        }
      }
      // best response for each caller vs each all-in
      for (let i = 1; i < n; i++) {
        for (let j = 0; j < i; j++) {
          callEvAll(i, j, scratchEv);
          const br = brCall[i][j], evc = evCall[i][j];
          for (let h = 0; h < NUM_HANDS; h++) {
            br[h] = scratchEv[h] > 0 ? 1 : 0;
            evc[h] += (scratchEv[h] - evc[h]) / t;
          }
        }
      }
      // fictitious play averaging
      const lr = 1 / (t + 1);
      const avg = (s, br) => { for (let h = 0; h < NUM_HANDS; h++) s[h] += (br[h] - s[h]) * lr; };
      for (let i = 0; i < n - 1; i++) {
        avg(push[i], brPush[i]);
        if (RAISE) avg(openR[i], brOpenArr[i]);
      }
      for (let i = 1; i < n; i++) for (let j = 0; j < i; j++) {
        avg(call[i][j], brCall[i][j]);
        if (RAISE) avg(rsh[i][j], brRshArr[i][j]);
      }
      if (RAISE) for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) avg(c3b[i][j], brC3bArr[i][j]);
      if (cfg.onProgress && (t % 10 === 0 || t === iterations)) cfg.onProgress(t / iterations);
    }

    // Recompute final EVs against the converged average strategies (more meaningful for grading)
    if (RAISE) {
      for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) {
        c3bEvAll(i, j, evC3b[i][j]);
        c3bIter[i][j].set(evC3b[i][j]);
      }
      for (let i = 1; i < n; i++) for (let j = 0; j < i; j++) rshEvAll(i, j, evRsh[i][j]);
    }
    for (let i = 0; i < n - 1; i++) {
      computeCallStats(i);
      pushEvAll(i, cProb, cEq, evPush[i]);
      if (RAISE) openEvAll(i, evOpen[i]);
    }
    for (let i = 1; i < n; i++) for (let j = 0; j < i; j++) callEvAll(i, j, evCall[i][j]);

    const result = { push, call, evPush, evCall, n };
    if (RAISE) {
      result.open = openR;
      result.evOpen = evOpen;
      result.rsh = rsh;
      result.evRsh = evRsh;
      result.c3b = c3b;
      result.evC3b = evC3b;
      result.openSize = openSize;
    }
    return result;
  }

  globalThis.GTOSolver = { solvePushFold, icmEquities };
})();
