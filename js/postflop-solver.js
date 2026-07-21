// Heads-up flop solver: fictitious play over combo-level ranges on a fixed
// flop, single street of betting, equity-rollout terminal values.
//
// Tree (single-raised pot, BB has checked dark):
//   IP: check | bet sizes[0] | bet sizes[1]        (fractions of pot)
//     check          -> showdown for pot
//     bet b -> BB: fold | call | raise (to r, capped by stack)
//       fold         -> IP wins pot
//       call         -> showdown for pot + 2b
//       raise -> IP: fold | call
//         fold       -> BB wins pot + b
//         call       -> showdown for pot + 2r
//
// All amounts in bb. EVs are each player's expected net chips from the start
// of the flop (folding as first action = 0).
(function () {
  const PF = globalThis.GTOPostflop;

  // cfg: {ipRange, bbRange (169 freq arrays) OR ipCombos, bbCombos (weighted
  //       combo lists), board [3-5 cards], pot, stack, sizes:[0.33,0.75],
  //       raiseMult:3.6, iterations:250, runouts:120, onProgress, seed}
  // Works on any street: flop uses sampled turn+river runouts, turn enumerates
  // every river exactly, river compares showdown values directly.
  function solveFlop(cfg) {
    const board = cfg.board;
    const P = cfg.pot;
    const stack = cfg.stack;
    const sizes = cfg.sizes || [0.33, 0.75];
    const S = sizes.length;
    const iters = cfg.iterations || 250;
    const rnd = PF.makeRng(cfg.seed);
    const prog = cfg.onProgress || (() => {});

    const bets = sizes.map(x => Math.max(0.5, Math.min(stack, Math.round(P * x * 10) / 10)));
    const raises = bets.map(b => Math.min(stack, Math.round(b * 3.6 * 10) / 10));

    const clean = (list) => list
      .filter(c => c.w >= 0.005 && !board.includes(c.c1) && !board.includes(c.c2))
      .map(c => ({ c1: c.c1, c2: c.c2, w: c.w, cls: c.cls }));
    const ip = cfg.ipCombos ? clean(cfg.ipCombos) : PF.rangeCombos(cfg.ipRange, board).filter(c => c.w >= 0.02);
    const bb = cfg.bbCombos ? clean(cfg.bbCombos) : PF.rangeCombos(cfg.bbRange, board).filter(c => c.w >= 0.02);
    const nI = ip.length, nJ = bb.length;

    // ---- shared runouts + per-combo hand values ----
    const used = new Uint8Array(52);
    for (const c of board) used[c] = 1;
    const deckLeft = [];
    for (let c = 0; c < 52; c++) if (!used[c]) deckLeft.push(c);
    const need = 5 - board.length; // 2 on the flop, 1 on the turn, 0 on the river
    let T, runout;
    if (need === 2) {
      T = cfg.runouts || 120;
      runout = new Int8Array(T * 2);
      for (let t = 0; t < T; t++) {
        const a = (rnd() * deckLeft.length) | 0;
        let b2 = (rnd() * deckLeft.length) | 0;
        while (b2 === a) b2 = (rnd() * deckLeft.length) | 0;
        runout[t * 2] = deckLeft[a];
        runout[t * 2 + 1] = deckLeft[b2];
      }
    } else if (need === 1) {
      T = deckLeft.length; // exact: every river card once
      runout = new Int8Array(T * 2);
      for (let t = 0; t < T; t++) { runout[t * 2] = deckLeft[t]; runout[t * 2 + 1] = -1; }
    } else {
      T = 1;
      runout = new Int8Array([-1, -1]);
    }

    function comboVals(list) {
      const vals = new Int32Array(list.length * T);
      for (let i = 0; i < list.length; i++) {
        const { c1, c2 } = list[i];
        for (let t = 0; t < T; t++) {
          let v;
          if (need === 0) v = PF.eval7(c1, c2, board[0], board[1], board[2], board[3], board[4]);
          else if (need === 1) {
            const rc = runout[t * 2];
            v = (rc === c1 || rc === c2) ? -1
              : PF.eval7(c1, c2, board[0], board[1], board[2], board[3], rc);
          } else {
            const r1 = runout[t * 2], r2 = runout[t * 2 + 1];
            v = (r1 === c1 || r1 === c2 || r2 === c1 || r2 === c2) ? -1
              : PF.eval7(c1, c2, board[0], board[1], board[2], r1, r2);
          }
          vals[i * T + t] = v;
        }
      }
      return vals;
    }
    const ipVals = comboVals(ip);
    prog(0.1);
    const bbVals = comboVals(bb);
    prog(0.2);

    // ---- pairwise IP win probability ----
    const W = new Float32Array(nI * nJ);
    const ok = new Uint8Array(nI * nJ); // 0 = combos share a card
    for (let i = 0; i < nI; i++) {
      const a1 = ip[i].c1, a2 = ip[i].c2;
      const base = i * nJ;
      const iv = i * T;
      for (let j = 0; j < nJ; j++) {
        const b1 = bb[j].c1, b2 = bb[j].c2;
        if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
        ok[base + j] = 1;
        let score = 0, n = 0;
        const jv = j * T;
        for (let t = 0; t < T; t++) {
          const va = ipVals[iv + t];
          if (va < 0) continue;
          const vb = bbVals[jv + t];
          if (vb < 0) continue;
          score += va > vb ? 2 : va === vb ? 1 : 0;
          n++;
        }
        W[base + j] = n > 0 ? score / (2 * n) : 0.5;
      }
      if ((i & 31) === 0) prog(0.2 + 0.3 * (i / nI));
    }
    prog(0.5);

    // pair-weight sums (constant): opponents' live weight vs each combo
    const sumWvsI = new Float64Array(nI);
    for (let i = 0; i < nI; i++) {
      let s = 0;
      for (let j = 0; j < nJ; j++) if (ok[i * nJ + j]) s += bb[j].w;
      sumWvsI[i] = s || 1;
    }

    // ---- strategies (averaged) ----
    const AI = 1 + S; // IP root actions: check, bet0, bet1...
    const ipRoot = new Float64Array(nI * AI).fill(1 / AI);
    const ipVsR = sizes.map(() => new Float64Array(nI * 2).fill(0.5)); // fold, call
    const bbResp = sizes.map(() => new Float64Array(nJ * 3).fill(1 / 3)); // fold, call, raise

    const brRoot = new Int8Array(nI);
    const brVsR = sizes.map(() => new Int8Array(nI));
    const brBB = sizes.map(() => new Int8Array(nJ));

    for (let it = 1; it <= iters; it++) {
      // ---- IP best response vs BB average ----
      for (let i = 0; i < nI; i++) {
        const base = i * nJ;
        let best = 0, bestEv = 0;
        // check -> showdown
        let ev = 0;
        for (let j = 0; j < nJ; j++) {
          if (!ok[base + j]) continue;
          ev += bb[j].w * W[base + j];
        }
        const evCheck = (ev / sumWvsI[i]) * P;
        bestEv = evCheck;
        for (let s = 0; s < S; s++) {
          const b = bets[s], r = raises[s];
          const resp = bbResp[s];
          let evF = 0, evCallSum = 0, wCall = 0, evRaiseCallSum = 0, wRaise = 0;
          for (let j = 0; j < nJ; j++) {
            if (!ok[base + j]) continue;
            const wj = bb[j].w, o = j * 3;
            const wij = W[base + j];
            evF += wj * resp[o];
            wCall += wj * resp[o + 1];
            evCallSum += wj * resp[o + 1] * (wij * (P + 2 * b) - b);
            wRaise += wj * resp[o + 2];
            evRaiseCallSum += wj * resp[o + 2] * (wij * (P + 2 * r) - r);
          }
          // IP's continuation vs the raise
          const evCallRaise = wRaise > 1e-9 ? evRaiseCallSum / wRaise : 0;
          const vVsRaise = Math.max(-b, evCallRaise);
          brVsR[s][i] = evCallRaise > -b ? 1 : 0;
          const evBet = (evF * P + evCallSum + wRaise * vVsRaise) / sumWvsI[i];
          if (evBet > bestEv) { bestEv = evBet; best = 1 + s; }
        }
        brRoot[i] = best;
      }

      // ---- BB best response vs IP average ----
      for (let s = 0; s < S; s++) {
        const b = bets[s], r = raises[s];
        const vsr = ipVsR[s];
        for (let j = 0; j < nJ; j++) {
          let wSum = 0, evCall = 0, evRaise = 0;
          for (let i = 0; i < nI; i++) {
            if (!ok[i * nJ + j]) continue;
            const betting = ipRoot[i * AI + 1 + s];
            if (betting < 1e-9) continue;
            const wi = ip[i].w * betting;
            const wbb = 1 - W[i * nJ + j];
            wSum += wi;
            evCall += wi * (wbb * (P + 2 * b) - b);
            evRaise += wi * (vsr[i * 2] * (P + b) + vsr[i * 2 + 1] * (wbb * (P + 2 * r) - r));
          }
          if (wSum < 1e-9) { brBB[s][j] = 0; continue; }
          evCall /= wSum;
          evRaise /= wSum;
          brBB[s][j] = evRaise > evCall && evRaise > 0 ? 2 : evCall > 0 ? 1 : 0;
        }
      }

      // ---- mix best responses into the averages ----
      const lr = 1 / (it + 1);
      for (let i = 0; i < nI; i++) {
        for (let a = 0; a < AI; a++) {
          ipRoot[i * AI + a] += ((brRoot[i] === a ? 1 : 0) - ipRoot[i * AI + a]) * lr;
        }
        for (let s = 0; s < S; s++) {
          const v = ipVsR[s];
          v[i * 2] += ((brVsR[s][i] === 0 ? 1 : 0) - v[i * 2]) * lr;
          v[i * 2 + 1] += ((brVsR[s][i] === 1 ? 1 : 0) - v[i * 2 + 1]) * lr;
        }
      }
      for (let s = 0; s < S; s++) {
        const resp = bbResp[s];
        for (let j = 0; j < nJ; j++) {
          for (let a = 0; a < 3; a++) {
            resp[j * 3 + a] += ((brBB[s][j] === a ? 1 : 0) - resp[j * 3 + a]) * lr;
          }
        }
      }
      if ((it & 15) === 0) prog(0.5 + 0.5 * (it / iters));
    }

    // ---- final EVs vs the average strategies ----
    const evIpRoot = new Float64Array(nI * AI);
    const evIpVsR = sizes.map(() => new Float64Array(nI * 2));
    for (let i = 0; i < nI; i++) {
      const base = i * nJ;
      let ev = 0;
      for (let j = 0; j < nJ; j++) if (ok[base + j]) ev += bb[j].w * W[base + j];
      evIpRoot[i * AI] = (ev / sumWvsI[i]) * P;
      for (let s = 0; s < S; s++) {
        const b = bets[s], r = raises[s];
        const resp = bbResp[s];
        let evF = 0, evCallSum = 0, evRaiseCallSum = 0, wRaise = 0;
        for (let j = 0; j < nJ; j++) {
          if (!ok[base + j]) continue;
          const wj = bb[j].w, o = j * 3, wij = W[base + j];
          evF += wj * resp[o];
          evCallSum += wj * resp[o + 1] * (wij * (P + 2 * b) - b);
          wRaise += wj * resp[o + 2];
          evRaiseCallSum += wj * resp[o + 2] * (wij * (P + 2 * r) - r);
        }
        const evCallRaise = wRaise > 1e-9 ? evRaiseCallSum / wRaise : 0;
        evIpVsR[s][i * 2] = -b;
        evIpVsR[s][i * 2 + 1] = evCallRaise;
        const vVsRaise = ipVsR[s][i * 2] * -b + ipVsR[s][i * 2 + 1] * evCallRaise;
        evIpRoot[i * AI + 1 + s] = (evF * P + evCallSum + wRaise * vVsRaise) / sumWvsI[i];
      }
    }
    const evBbResp = sizes.map(() => new Float64Array(nJ * 3));
    for (let s = 0; s < S; s++) {
      const b = bets[s], r = raises[s];
      const vsr = ipVsR[s], out = evBbResp[s];
      for (let j = 0; j < nJ; j++) {
        let wSum = 0, evCall = 0, evRaise = 0;
        for (let i = 0; i < nI; i++) {
          if (!ok[i * nJ + j]) continue;
          const betting = ipRoot[i * AI + 1 + s];
          if (betting < 1e-9) continue;
          const wi = ip[i].w * betting;
          const wbb = 1 - W[i * nJ + j];
          wSum += wi;
          evCall += wi * (wbb * (P + 2 * b) - b);
          evRaise += wi * (vsr[i * 2] * (P + b) + vsr[i * 2 + 1] * (wbb * (P + 2 * r) - r));
        }
        out[j * 3] = 0;
        out[j * 3 + 1] = wSum > 1e-9 ? evCall / wSum : 0;
        out[j * 3 + 2] = wSum > 1e-9 ? evRaise / wSum : 0;
      }
    }

    // range-weighted aggregates
    let wIp = 0;
    const aggRoot = new Array(AI).fill(0);
    for (let i = 0; i < nI; i++) {
      wIp += ip[i].w;
      for (let a = 0; a < AI; a++) aggRoot[a] += ip[i].w * ipRoot[i * AI + a];
    }
    for (let a = 0; a < AI; a++) aggRoot[a] /= wIp || 1;
    const aggBB = sizes.map((_, s) => {
      const agg = [0, 0, 0];
      let wSum = 0;
      for (let j = 0; j < nJ; j++) {
        // weight by how often this combo actually faces the bet
        let faceW = 0;
        for (let i = 0; i < nI; i++) {
          if (ok[i * nJ + j]) faceW += ip[i].w * ipRoot[i * AI + 1 + s];
        }
        const w = bb[j].w * faceW;
        wSum += w;
        for (let a = 0; a < 3; a++) agg[a] += w * bbResp[s][j * 3 + a];
      }
      for (let a = 0; a < 3; a++) agg[a] /= wSum || 1;
      return agg;
    });
    prog(1);

    return {
      ip: ip.map(c => ({ c1: c.c1, c2: c.c2, cls: c.cls, w: c.w })),
      bb: bb.map(c => ({ c1: c.c1, c2: c.c2, cls: c.cls, w: c.w })),
      pot: P, stack, sizes, bets, raises,
      ipRoot: Array.from(ipRoot), evIpRoot: Array.from(evIpRoot),
      bbResp: bbResp.map(a => Array.from(a)), evBbResp: evBbResp.map(a => Array.from(a)),
      ipVsR: ipVsR.map(a => Array.from(a)), evIpVsR: evIpVsR.map(a => Array.from(a)),
      aggRoot, aggBB,
    };
  }

  globalThis.GTOPostflopSolver = { solveFlop };
})();
