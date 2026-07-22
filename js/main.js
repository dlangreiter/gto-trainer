// GTO Trainer — app controller: settings, solver management, scenarios, grading, UI.
(function () {
  const GTO = globalThis.GTO;
  const Ranges = globalThis.GTORanges;
  const Deck = globalThis.GTODeck;

  const $ = (id) => document.getElementById(id);

  // ---------------- settings ----------------
  const DEFAULT_SETTINGS = {
    players: 9,
    sbChips: 500,
    bbChips: 1000,
    anteMode: 'bb',      // 'none' | 'bb' | 'classic'
    anteChips: 1000,
    stacksText: '10000',
    heroPos: 'random',
    mode: 'auto',
    iterations: 300,
    evFormat: 'chip',     // 'chip' | 'icm' | 'pko'
    payoutsText: '50, 30, 20',
    bountiesText: '5',    // bounty value per seat, in big blinds of value
    bountyFraction: 0.65, // effective share of a bounty you capture
    examHands: 20,        // session-exam length
    examCharts: false,    // exam also deals 40-60bb chart spots
    openSize: 2.2,        // opener raise size in bb (exam configs vary it)
    lastPfMode: 'pfcbet', // last-used postflop drill (section tab memory)
    pfPot: 'srp',         // postflop pot type: 'srp' (single-raised) | '3bp' (3-bet pot)
  };

  const OPEN_SIZE = 2.2; // default opener raise size (bb)

  let settings = loadJson('gto_settings', DEFAULT_SETTINGS);
  globalThis.__gtoSettings = settings; // default source for tableConfig()

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return Object.assign({}, fallback, JSON.parse(raw));
    } catch (e) { /* ignore */ }
    return JSON.parse(JSON.stringify(fallback));
  }
  function saveJson(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { /* ignore */ }
  }

  // derived config (BB units); src defaults to live settings but review mode
  // passes a stored snapshot
  function tableConfig(src) {
    const settings = src || globalThis.__gtoSettings;
    const n = settings.players;
    const bb = Math.max(1, settings.bbChips);
    const parts = String(settings.stacksText).split(',').map(s => parseFloat(s.trim())).filter(x => !isNaN(x) && x > 0);
    const stacks = [];
    for (let i = 0; i < n; i++) {
      const chips = parts.length === 0 ? 10 * bb : parts[Math.min(i, parts.length - 1)];
      stacks.push(Math.max(1, chips / bb));
    }
    let ante = 0;
    if (settings.anteMode === 'bb') ante = settings.anteChips / bb;
    else if (settings.anteMode === 'classic') ante = settings.anteChips / bb;
    let icm = null, pko = null;
    if (settings.evFormat === 'icm') {
      const payouts = String(settings.payoutsText).split(',')
        .map(s => parseFloat(s.trim())).filter(x => !isNaN(x) && x > 0);
      if (payouts.length > 0) icm = { payouts };
    } else if (settings.evFormat === 'pko') {
      const parts = String(settings.bountiesText).split(',')
        .map(s => parseFloat(s.trim())).filter(x => !isNaN(x) && x >= 0);
      if (parts.length > 0) {
        const bounties = [];
        for (let i = 0; i < n; i++) bounties.push(parts[Math.min(i, parts.length - 1)]);
        pko = { bounties, fraction: settings.bountyFraction };
      }
    }
    return {
      n,
      stacks,
      anteMode: settings.anteMode,
      ante,
      sb: settings.sbChips / bb,
      posNames: GTO.POSITION_NAMES[n],
      icm,
      pko,
      openSize: parseFloat(settings.openSize) || OPEN_SIZE,
    };
  }

  // unit info for solver EVs under the active config
  function evUnit(cfg) {
    if (!cfg.icm) return { suffix: ' bb', threshold: 0.05 };
    const total = cfg.icm.payouts.reduce((s, x) => s + x, 0);
    const pct = total > 95 && total < 105;
    return { suffix: pct ? '% of pool' : ' $', threshold: total * 0.0005 };
  }

  // ---------------- stats ----------------
  let stats = loadJson('gto_stats', { hands: 0, correct: 0, wrong: 0, evLost: 0, evLostIcm: 0 });
  let history = loadJson('gto_history', { items: [] }).items || [];
  let handLog = loadJson('gto_log', { items: [] }).items || [];
  let sessions = loadJson('gto_sessions', { items: [] }).items || [];

  function saveStats() {
    saveJson('gto_stats', stats);
    saveJson('gto_history', { items: history.slice(-24) });
    saveJson('gto_log', { items: handLog.slice(-400) });
  }

  function remainingMistakes() {
    // preflop mistakes replay from settings snapshots, postflop from stored
    // pf spot params; full-hand street decisions carry neither (range state)
    return handLog.filter(e => e.v === 'bad' && !e.fixed && e.mode !== 'builder' && (e.snap || e.pf));
  }

  function renderHeaderStats() {
    const acc = stats.hands ? (100 * stats.correct / stats.hands).toFixed(1) : '—';
    const icmPart = stats.evLostIcm > 0
      ? `<span class="stat-bad">ICM lost <b>${stats.evLostIcm.toFixed(2)}</b></span>` : '';
    $('headerStats').innerHTML =
      `<span>Hands <b>${stats.hands}</b></span>` +
      `<span class="stat-good">Accuracy <b>${acc}${stats.hands ? '%' : ''}</b></span>` +
      `<span class="stat-bad">EV lost <b>${stats.evLost.toFixed(2)} bb</b></span>` + icmPart;
    const nm = remainingMistakes().length;
    const rb = $('btnReview');
    if (rb) {
      rb.style.display = nm ? '' : 'none';
      rb.textContent = `Review (${nm})`;
    }
  }

  function renderHistory() {
    $('history').innerHTML = history.slice(-24).map(h =>
      `<button class="chip ${h.v}"${h.id ? ` data-hid="${h.id}"` : ''}>${h.label}</button>`).join('');
    $('history').querySelectorAll('[data-hid]').forEach(b =>
      b.addEventListener('click', () => toggleHistDetail(b)));
  }

  // tap a history chip to see what the spot was and why the answer was graded
  function toggleHistDetail(chip) {
    const panel = $('histDetail');
    const open = chip.classList.contains('open');
    $('history').querySelectorAll('.chip.open').forEach(c => c.classList.remove('open'));
    if (open) { panel.style.display = 'none'; return; }
    const e = handLog.find(x => x.id === chip.dataset.hid);
    if (!e || !e.detail) { panel.style.display = 'none'; return; }
    chip.classList.add('open');
    const vTxt = e.v === 'good' ? '✓ correct' : e.v === 'mixed' ? '≈ close' : '✗ mistake';
    panel.innerHTML =
      `<div class="hd-head">${e.label} · ${e.posName || ''} · ${MODE_LABELS[e.mode] || e.mode} — ` +
      `you chose ${e.actLabel || actionLabel(e.action, e.mode)} <span class="v-${e.v}">(${vTxt}` +
      `${e.evLost ? `, lost ${e.evLost} ${e.suffix || 'bb'}` : ''})</span></div>` +
      `<div class="hd-body">${e.detail}</div>`;
    panel.style.display = '';
  }

  // ---------------- solver manager ----------------
  // Solutions are cached per (config, tree). tree: 'jam' = jam-or-fold Nash,
  // 'raise' = open/jam/fold tree with reshove-or-fold responses.
  const memCache = new Map();
  let worker = null;
  let workerBroken = false;
  let pendingKey = null;      // key currently being solved
  let pendingCfg = null;      // its config + tree (for sync fallback / retry)
  let pendingFn = null;       // continuation to run once the pending solve lands

  function configKey(cfg, tree) {
    return JSON.stringify({
      s: cfg.stacks.map(x => Math.round(x * 10) / 10),
      am: cfg.anteMode,
      a: Math.round(cfg.ante * 100) / 100,
      it: settings.iterations,
      icm: cfg.icm ? cfg.icm.payouts : null,
      pko: cfg.pko ? [cfg.pko.bounties, cfg.pko.fraction] : null,
      os: tree === 'raise' ? cfg.openSize : 0,
      tr: tree,
    });
  }

  function getSolution(cfg, tree) {
    const key = configKey(cfg, tree);
    if (memCache.has(key)) return memCache.get(key);
    const stored = lsCacheGet(key);
    if (stored) { memCache.set(key, stored); return stored; }
    return null;
  }

  function getWorker() {
    if (worker || workerBroken) return worker;
    try {
      worker = new Worker('js/solver-worker.js?v=20');
      worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'progress') {
          $('solveFill').style.width = (msg.frac * 100).toFixed(0) + '%';
        } else if (msg.type === 'done') {
          onSolved(msg.key, msg.solution);
        }
      };
      worker.onerror = () => {
        workerBroken = true;
        worker = null;
        if (pendingCfg) setTimeout(() => solveSync(), 30);
      };
    } catch (e) {
      workerBroken = true;
      worker = null;
    }
    return worker;
  }

  // Returns true if the solution is ready; otherwise kicks off a solve.
  function ensureSolved(cfg, tree) {
    if (getSolution(cfg, tree)) return true;
    const key = configKey(cfg, tree);
    if (key === pendingKey) return false; // already solving
    pendingKey = key;
    pendingCfg = { cfg, tree };
    showSolveOverlay();
    const w = getWorker();
    if (w) {
      w.postMessage({
        key, stacks: cfg.stacks, anteMode: cfg.anteMode, ante: cfg.ante,
        iterations: settings.iterations, icm: cfg.icm, pko: cfg.pko,
        tree: tree === 'raise' ? 'raise' : undefined,
        openSize: cfg.openSize,
      });
    } else {
      setTimeout(() => solveSync(), 30); // let overlay paint
    }
    return false;
  }

  function solveSync() {
    if (!pendingCfg) return;
    const { cfg, tree } = pendingCfg;
    const sol = globalThis.GTOSolver.solvePushFold({
      stacks: cfg.stacks, anteMode: cfg.anteMode, ante: cfg.ante,
      iterations: settings.iterations, icm: cfg.icm, pko: cfg.pko,
      tree: tree === 'raise' ? 'raise' : undefined,
      openSize: cfg.openSize,
    });
    const pack = (a) => Array.from(a);
    const packed = {
      n: sol.n,
      push: sol.push.map(pack),
      call: sol.call.map(r => r.map(a => a ? pack(a) : null)),
      evPush: sol.evPush.map(pack),
      evCall: sol.evCall.map(r => r.map(a => a ? pack(a) : null)),
    };
    if (sol.open) {
      packed.open = sol.open.map(pack);
      packed.evOpen = sol.evOpen.map(pack);
      packed.rsh = sol.rsh.map(r => r.map(a => a ? pack(a) : null));
      packed.evRsh = sol.evRsh.map(r => r.map(a => a ? pack(a) : null));
      packed.c3b = sol.c3b.map(r => r.map(a => a ? pack(a) : null));
      packed.evC3b = sol.evC3b.map(r => r.map(a => a ? pack(a) : null));
      packed.openSize = sol.openSize;
    }
    onSolved(configKey(cfg, tree), packed);
  }

  function onSolved(key, sol) {
    memCache.set(key, sol);
    lsCachePut(key, sol);
    if (key !== pendingKey) return; // stale
    pendingKey = null;
    pendingCfg = null;
    hideSolveOverlay();
    if (pendingFn) { const f = pendingFn; pendingFn = null; f(); }
    else if (!scenario) newHand();
    else if ($('rangeModal').classList.contains('show')) renderRangeModal(-1);
  }

  // localStorage LRU cache of solved configs
  function lsCacheGet(key) {
    try {
      const raw = localStorage.getItem('gto_sol_' + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function lsCachePut(key, sol) {
    try {
      const idxRaw = localStorage.getItem('gto_sol_index');
      let idx = idxRaw ? JSON.parse(idxRaw) : [];
      idx = idx.filter(k => k !== key);
      idx.push(key);
      while (idx.length > 4) {
        localStorage.removeItem('gto_sol_' + idx.shift());
      }
      localStorage.setItem('gto_sol_' + key, JSON.stringify(sol));
      localStorage.setItem('gto_sol_index', JSON.stringify(idx));
    } catch (e) { /* quota — skip */ }
  }

  function showSolveOverlay() {
    $('solveFill').style.width = '0%';
    $('solveOverlay').classList.add('show');
  }
  function hideSolveOverlay() {
    $('solveOverlay').classList.remove('show');
  }

  // ---------------- scenario ----------------
  let scenario = null; // {mode, heroPos, pusherPos, hand:[c1,c2], handId, answered}

  function pickHeroPos(cfg, mode, ignoreFixed) {
    if (!ignoreFixed && settings.heroPos !== 'random') {
      const fixed = parseInt(settings.heroPos, 10);
      if (!isNaN(fixed) && fixed >= 0 && fixed < cfg.n) return fixed;
    }
    if (mode === 'callvjam' || mode === 'vsrfi' || mode === 'vsopen') return 1 + ((Math.random() * (cfg.n - 1)) | 0); // needs someone before
    if (mode === 'pushfold' || mode === 'rfi' || mode === 'opentree' || mode === 'vs3bet') return (Math.random() * (cfg.n - 1)) | 0; // not BB
    return (Math.random() * cfg.n) | 0;
  }

  function treeForMode(mode) {
    if (mode === 'pushfold' || mode === 'callvjam') return 'jam';
    if (mode === 'opentree' || mode === 'vsopen' || mode === 'vs3bet') return 'raise';
    return null;
  }

  function newHand() {
    // leaving postflop mid-solve: orphan the continuation so the stale result
    // can't clobber whatever we deal next (it still lands in the cache)
    if (pfPendingKey && !PF_MODES.has(settings.mode) && settings.mode !== 'exam') {
      pfPendingFn = null;
      hideSolveOverlay();
    }
    if (settings.mode === 'exam') { examNext(); return; }
    if (settings.mode === 'explore') { showExplorer(); return; }
    if (PF_MODES.has(settings.mode)) { newPostflopHand(settings.mode); return; }
    const cfg = tableConfig();
    if (settings.mode === 'builder') { newBuilderSpot(cfg); return; }
    dealSpot(cfg, settings.mode, newHand, null);
  }

  // Deal one spot for cfg. modeSel may be 'auto'. examSnap (a settings
  // snapshot, optionally with a pre-picked heroSeat) marks the hand as part
  // of a session exam.
  function dealSpot(cfg, modeSel, retryFn, examSnap) {
    let mode = modeSel;
    let heroPos = (examSnap && examSnap.heroSeat != null && examSnap.heroSeat < cfg.n)
      ? examSnap.heroSeat
      : pickHeroPos(cfg, mode === 'auto' ? 'any' : mode, !!examSnap);

    if (mode === 'auto') {
      const heroStack = cfg.stacks[heroPos];
      if (heroStack <= 15) {
        mode = (heroPos > 0 && Math.random() < 0.35) ? 'callvjam' : 'pushfold';
      } else if (heroStack <= 30 || examSnap) {
        const r = Math.random();
        if (r < 0.5) mode = 'opentree';
        else if (r < 0.75 && heroPos > 0) mode = 'vsopen';
        else mode = 'vs3bet';
      } else {
        mode = (heroPos > 0 && Math.random() < 0.45) ? 'vsrfi' : 'rfi';
      }
    }
    // fix invalid position/mode combos (BB can't open; UTG can't face a raise)
    if ((mode === 'pushfold' || mode === 'opentree' || mode === 'vs3bet') && heroPos === cfg.n - 1) {
      mode = mode === 'pushfold' ? 'callvjam' : 'vsopen';
    }
    if (mode === 'rfi' && heroPos === cfg.n - 1) heroPos = pickHeroPos(cfg, 'rfi', true);
    if ((mode === 'callvjam' || mode === 'vsrfi' || mode === 'vsopen') && heroPos === 0) heroPos = pickHeroPos(cfg, mode, true);

    // make sure the needed Nash solution exists before dealing
    const tree = treeForMode(mode);
    let sol = null;
    if (tree) {
      sol = getSolution(cfg, tree);
      if (!sol) { pendingFn = retryFn; ensureSolved(cfg, tree); return; }
    }

    let pusherPos = -1, openerPos = -1, reshoverPos = -1;
    if (mode === 'callvjam') pusherPos = (Math.random() * heroPos) | 0;
    if (mode === 'vsrfi' || mode === 'vsopen') openerPos = (Math.random() * heroPos) | 0;
    if (mode === 'vs3bet') reshoverPos = heroPos + 1 + ((Math.random() * (cfg.n - 1 - heroPos)) | 0);

    let hand = Deck.dealHand();
    let targeted = false;
    // spaced repetition: ~25% of free-play deals revisit hand classes you've
    // missed, until each is answered correctly twice
    if (!examSnap && mode !== 'vs3bet' && Math.random() < 0.25) {
      const targets = missedTargets();
      if (targets.length) {
        const lbl = wpick(targets.map(t => t.label), targets.map(t => t.w));
        const id = GTO.labelToId(lbl);
        if (id >= 0) {
          const combos = PF.classCombos(id);
          const cb = combos[(Math.random() * combos.length) | 0];
          hand = (cb[0] >> 2) >= (cb[1] >> 2) ? [cb[0], cb[1]] : [cb[1], cb[0]];
          targeted = true;
        }
      }
    }
    if (mode === 'vs3bet') {
      // hero already opened: condition the dealt hand on hero's opening range
      const openFreqs = sol.open[heroPos];
      let total = 0;
      for (let h = 0; h < 169; h++) total += openFreqs[h] * GTO.classComboCount(h);
      if (total < 1) { startScenario(cfg, 'opentree', heroPos, -1, -1, -1, hand, null, examSnap); return; }
      for (let tries = 0; tries < 500; tries++) {
        const id = GTO.classIdOfCards(hand[0], hand[1]);
        if (Math.random() < openFreqs[id]) break;
        hand = Deck.dealHand();
      }
    }
    startScenario(cfg, mode, heroPos, pusherPos, openerPos, reshoverPos, hand, null, examSnap);
    if (targeted) scenario.targeted = true;
  }

  // hand classes with un-cleared mistakes (cleared by 2 correct answers since)
  function missedTargets() {
    const st = new Map();
    for (const e of handLog) {
      if (e.mode === 'builder' || !e.label || e.label.length > 3) continue;
      const s = st.get(e.label) || { m: 0, c: 0 };
      if (e.v === 'bad') { s.m++; s.c = 0; }
      else if (s.m > 0) s.c++;
      st.set(e.label, s);
    }
    const out = [];
    for (const [label, s] of st) if (s.m >= 1 && s.c < 2) out.push({ label, w: s.m });
    return out;
  }

  function startScenario(cfg, mode, heroPos, pusherPos, openerPos, reshoverPos, hand, review, examSnap) {
    scenario = {
      mode, heroPos, pusherPos, openerPos, reshoverPos,
      hand,
      handId: GTO.classIdOfCards(hand[0], hand[1]),
      answered: false,
      cfg,
      review: review || null,
      exam: !!examSnap,
      snap: examSnap || null,
    };
    $('quickBar').style.display = examSnap ? 'none' : ''; // no mid-exam mode hopping
    $('histDetail').style.display = 'none';
    $('explorePanel').style.display = 'none';
    updateExamProgress();
    $('feedback').classList.remove('show');
    if ($('builderPanel')) $('builderPanel').style.display = 'none';
    $('tableWrap').style.display = '';
    renderTable();
    renderControls();
  }

  // ---------------- table rendering ----------------
  function seatXY(rel, n) {
    const theta = (Math.PI / 180) * (90 + 360 * rel / n);
    return { x: 50 + 43 * Math.cos(theta), y: 46 + 38 * Math.sin(theta) };
  }

  function renderTable() {
    const s = scenario;
    const cfg = s.cfg;
    $('tableWrap').classList.remove('pf');
    const osz = cfg.openSize || OPEN_SIZE;
    const n = cfg.n;
    const btnIdx = n === 2 ? 0 : n - 3;
    const seatsEl = $('seats');
    let html = '';

    for (let i = 0; i < n; i++) {
      const rel = ((i - s.heroPos) % n + n) % n;
      const { x, y } = seatXY(rel, n);
      const isHero = i === s.heroPos;
      const isJammer = i === s.pusherPos || i === s.reshoverPos;
      const isOpener = i === s.openerPos;
      const foldedBefore = (i < s.heroPos && !isJammer && !isOpener) ||
        (s.mode === 'vs3bet' && i > s.heroPos && i !== s.reshoverPos);
      const cls = ['seat'];
      if (isHero) cls.push('hero');
      if (isJammer) cls.push('jammer');
      if (isOpener) cls.push('opener');
      if (foldedBefore) cls.push('folded');

      const posName = cfg.posNames[i];
      const stackBB = cfg.stacks[i];
      let tag = '';
      if (isJammer) tag = `<div class="action-tag">ALL-IN ${fmtBB(Math.min(stackBB, 999))}</div>`;
      else if (isOpener) tag = `<div class="action-tag">RAISE ${fmtBB(osz)}</div>`;
      else if (foldedBefore) tag = '<div class="action-tag">FOLD</div>';
      else if (isHero && s.mode === 'vs3bet') tag = `<div class="action-tag" style="color:var(--accent)">OPENED ${fmtBB(osz)}</div>`;
      else if (isHero) tag = '<div class="action-tag" style="color:var(--accent)">HERO</div>';

      let posted = '';
      if (i === n - 2 || (n === 2 && i === 0)) posted = `<div class="posted">SB ${fmtBB(cfg.sb)}</div>`;
      if (i === n - 1) {
        posted = `<div class="posted">BB 1${cfg.anteMode === 'bb' && cfg.ante > 0 ? ' + ante ' + fmtBB(cfg.ante) : ''}</div>`;
      }

      html += `<div class="${cls.join(' ')}" style="left:${x}%;top:${y}%">` +
        `<div class="seat-box"><div class="pos-name">${posName}</div>` +
        `<div class="stack">${fmtBB(stackBB)}</div>${tag}${posted}</div></div>`;
    }

    // dealer button
    const relBtn = ((btnIdx - s.heroPos) % n + n) % n;
    const bxy = seatXY(relBtn, n);
    const cx = 50, cy = 46;
    const dx = cx + (bxy.x - cx) * 0.68, dy = cy + (bxy.y - cy) * 0.68;
    html += `<div class="dealer-btn" style="left:${dx}%;top:${dy}%">D</div>`;

    seatsEl.innerHTML = html;

    // center info (exam hands are dealt from a snapshot, not live settings)
    const src = s.snap || settings;
    const anteTxt = cfg.anteMode === 'none' || cfg.ante <= 0 ? '' :
      cfg.anteMode === 'bb' ? ` · BB ante ${src.anteChips}` : ` · ante ${src.anteChips}`;
    const solverMode = !!treeForMode(s.mode);
    const modeName = {
      pushfold: 'Jam or Fold', callvjam: 'Call vs Jam',
      rfi: 'Open (RFI)', vsrfi: 'Facing a Raise',
      opentree: 'Open Strategy', vsopen: 'Reshove or Fold', vs3bet: 'Facing a 3-Bet Jam',
    }[s.mode] +
      (cfg.icm && solverMode ? ' · ICM' : '') +
      (cfg.pko && solverMode ? ' · PKO' : '') +
      (s.review ? ' · REVIEW' : '') +
      (s.exam && exam ? ` · EXAM ${Math.min(exam.idx + 1, exam.total)}/${exam.total}` : '');
    let potBB = 1 + cfg.sb + (cfg.anteMode === 'bb' ? cfg.ante : cfg.anteMode === 'classic' ? cfg.ante * cfg.n : 0);
    if (s.mode === 'callvjam') potBB += Math.min(cfg.stacks[s.pusherPos], 999);
    if (s.mode === 'vsrfi' || s.mode === 'vsopen') potBB += osz;
    if (s.mode === 'vs3bet') potBB += osz + Math.min(cfg.stacks[s.reshoverPos], 999);
    $('tableCenter').innerHTML =
      `<div class="level">Blinds ${src.sbChips}/${src.bbChips}${anteTxt}</div>` +
      `<div class="pot">Pot: ${fmtBB(potBB)}</div>` +
      `<div class="mode-tag">${modeName}</div>`;

    // hero cards
    $('heroCards').innerHTML = Deck.cardHtml(s.hand[0], true) + Deck.cardHtml(s.hand[1], true);
  }

  function fmtBB(x) {
    return (Math.round(x * 10) / 10) + ' bb';
  }

  // ---------------- controls / actions ----------------
  function renderControls() {
    const s = scenario;
    const el = $('controls');
    const heroStack = s.cfg.stacks[s.heroPos];
    const osz = s.cfg.openSize || OPEN_SIZE;
    let html = '';
    if (s.mode === 'pushfold') {
      html = actionBtn('fold', 'Fold', 'F') + actionBtn('jam', `All-In ${fmtBB(heroStack)}`, 'J');
    } else if (s.mode === 'callvjam') {
      const callAmt = Math.min(heroStack, s.cfg.stacks[s.pusherPos]);
      html = actionBtn('fold', 'Fold', 'F') + actionBtn('call', `Call ${fmtBB(callAmt)}`, 'C');
    } else if (s.mode === 'vsrfi') {
      html = actionBtn('fold', 'Fold', 'F') + actionBtn('call', 'Call', 'C') + actionBtn('threebet', '3-Bet', 'R');
    } else if (s.mode === 'opentree') {
      html = actionBtn('fold', 'Fold', 'F') + actionBtn('threebet', `Raise ${fmtBB(osz)}`, 'R') +
        actionBtn('jam', `All-In ${fmtBB(heroStack)}`, 'J');
    } else if (s.mode === 'vsopen') {
      html = actionBtn('fold', 'Fold', 'F') + actionBtn('jam', `All-In ${fmtBB(heroStack)}`, 'J');
    } else if (s.mode === 'vs3bet') {
      const callAmt = Math.min(heroStack, s.cfg.stacks[s.reshoverPos]) - osz;
      html = actionBtn('fold', 'Fold', 'F') + actionBtn('call', `Call ${fmtBB(Math.max(0, callAmt))}`, 'C');
    } else {
      html = actionBtn('fold', 'Fold', 'F') + actionBtn('raise', 'Raise', 'R');
    }
    el.innerHTML = html;
    el.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => answer(b.dataset.action));
    });
  }

  function actionBtn(kind, label, key) {
    return `<button class="action-btn ${kind}" data-action="${kind}">${label} <kbd>${key}</kbd></button>`;
  }

  // grading — action is 'fold' | 'jam' | 'call' | 'raise' | 'threebet'
  function answer(action) {
    const s = scenario;
    if (!s || s.answered) return;
    const tree = treeForMode(s.mode);
    const sol = tree ? getSolution(s.cfg, tree) : null;
    if (tree && !sol) return; // still solving
    s.answered = true;

    let verdictCls, verdictTxt, evLost = 0, detail;
    let examCtx = null; // grading numbers, kept for the exam recap's explanations
    const label = GTO.handLabel(s.handId);
    const osz = s.cfg.openSize || OPEN_SIZE;
    const usedIcm = !!s.cfg.icm && !!tree;
    const unit = usedIcm ? evUnit(s.cfg) : { suffix: ' bb', threshold: 0.05 };

    if (s.mode === 'opentree') {
      // three actions with solver EVs (relative to folding)
      const fO = sol.open[s.heroPos][s.handId], fJ = sol.push[s.heroPos][s.handId];
      const eO = sol.evOpen[s.heroPos][s.handId], eJ = sol.evPush[s.heroPos][s.handId];
      const vals = { fold: 0, threebet: eO, jam: eJ };
      const freqs = { fold: Math.max(0, 1 - fO - fJ), threebet: fO, jam: fJ };
      const chosen = vals[action] ?? 0;
      const best = Math.max(0, eO, eJ);
      evLost = Math.max(0, best - chosen);
      examCtx = { kind: 'tree', fO, fJ, eO, eJ };
      if (evLost <= unit.threshold) { verdictCls = 'good'; verdictTxt = '✓ Correct'; evLost = 0; }
      else if (evLost <= unit.threshold * 5 || (freqs[action] ?? 0) >= 0.25) { verdictCls = 'mixed'; verdictTxt = '≈ Close'; }
      else { verdictCls = 'bad'; verdictTxt = '✗ Mistake'; }
      const pct = (x) => (x * 100).toFixed(0);
      const fx = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
      detail = `Solver plays <b>${label}</b>: raise <b>${pct(fO)}%</b> · jam <b>${pct(fJ)}%</b> · fold <b>${pct(freqs.fold)}%</b>` +
        `<br>EV(raise) <b>${fx(eO)}</b> · EV(jam) <b>${fx(eJ)}</b> · EV(fold) <b>0</b>${unit.suffix}` +
        (evLost > 0 ? ` · you lost <b>${evLost.toFixed(2)}${unit.suffix}</b>` : '');
    } else if (s.mode === 'vsrfi') {
      // three-way chart grading
      const key = Ranges.vsrfiKey(s.cfg.posNames[s.heroPos], s.cfg.posNames[s.openerPos]);
      const chart = Ranges.VSRFI[key];
      const r = chart.threebet[s.handId], c = chart.call[s.handId];
      const f = Math.max(0, 1 - r - c);
      const freqs = { fold: f, call: c, threebet: r };
      examCtx = { kind: 'chart', r, c, f };
      const chosen = freqs[action] ?? 0;
      const best = Math.max(f, c, r);
      if (chosen >= best - 0.001) { verdictCls = 'good'; verdictTxt = '✓ Correct'; }
      else if (chosen >= 0.2) { verdictCls = 'mixed'; verdictTxt = '≈ Close — mixed spot'; }
      else { verdictCls = 'bad'; verdictTxt = '✗ Mistake'; }
      detail = `Chart for <b>${label}</b>: 3-bet <b>${(r * 100).toFixed(0)}%</b> · ` +
        `call <b>${(c * 100).toFixed(0)}%</b> · fold <b>${(f * 100).toFixed(0)}%</b>` +
        `<br><span style="opacity:0.8">${Ranges.VSRFI_LABELS[key]} (${fmtBB(OPEN_SIZE)} open) — ` +
        `${s.cfg.posNames[s.openerPos]} raised, folds to you in ${s.cfg.posNames[s.heroPos]}</span>`;
    } else {
      const aggressive = action !== 'fold';
      let freq = 0, evDiff = null, aggrName = 'Raise';
      if (s.mode === 'pushfold') {
        freq = sol.push[s.heroPos][s.handId];
        evDiff = sol.evPush[s.heroPos][s.handId];
        aggrName = 'Jam';
      } else if (s.mode === 'callvjam') {
        freq = sol.call[s.heroPos][s.pusherPos][s.handId];
        evDiff = sol.evCall[s.heroPos][s.pusherPos][s.handId];
        aggrName = 'Call';
      } else if (s.mode === 'vsopen') {
        freq = sol.rsh[s.heroPos][s.openerPos][s.handId];
        evDiff = sol.evRsh[s.heroPos][s.openerPos][s.handId];
        aggrName = 'Reshove';
      } else if (s.mode === 'vs3bet') {
        freq = sol.c3b[s.heroPos][s.reshoverPos][s.handId];
        evDiff = sol.evC3b[s.heroPos][s.reshoverPos][s.handId];
        aggrName = 'Call';
      } else {
        const chart = Ranges.RFI[s.cfg.posNames[s.heroPos]];
        freq = chart ? chart[s.handId] : 0;
      }

      const mixedZone = freq > 0.3 && freq < 0.7;
      const marginal = evDiff !== null && Math.abs(evDiff) < unit.threshold;
      const agrees = aggressive === (freq >= 0.5);
      examCtx = { kind: 'two', freq, evDiff, aggrName };

      if (agrees) { verdictCls = 'good'; verdictTxt = '✓ Correct'; }
      else if (mixedZone || marginal) { verdictCls = 'mixed'; verdictTxt = '≈ Close — mixed spot'; }
      else { verdictCls = 'bad'; verdictTxt = '✗ Mistake'; }
      if (!agrees && evDiff !== null) {
        evLost = aggressive ? Math.max(0, -evDiff) : Math.max(0, evDiff);
        if (evLost < unit.threshold * 1.02 && verdictCls === 'bad') { verdictCls = 'mixed'; verdictTxt = '≈ Close'; }
      }

      detail = `Solver ${aggrName.toLowerCase()}s <b>${label}</b> ` +
        `<b>${(freq * 100).toFixed(0)}%</b> of the time here`;
      if (evDiff !== null) {
        const sign = evDiff >= 0 ? '+' : '';
        detail += ` · EV(${aggrName}) − EV(Fold) = <b>${sign}${evDiff.toFixed(2)}${unit.suffix}</b>`;
      }
      if (evLost > 0) detail += ` · you lost <b>${evLost.toFixed(2)}${unit.suffix}</b>`;
      if (usedIcm) detail += `<br><span style="opacity:0.8">ICM · payouts ${s.cfg.icm.payouts.join(' / ')}</span>`;
      if (s.cfg.pko && tree) detail += `<br><span style="opacity:0.8">PKO · bounties (bb-value) ${s.cfg.pko.bounties.join(' / ')}</span>`;
      if (s.mode === 'rfi') detail += `<br><span style="opacity:0.8">Chart: ${s.cfg.posNames[s.heroPos]} first-in opening range</span>`;
      if (s.mode === 'callvjam') detail += `<br><span style="opacity:0.8">${s.cfg.posNames[s.pusherPos]} jammed ${fmtBB(Math.min(s.cfg.stacks[s.pusherPos], 999))} — folds to you in ${s.cfg.posNames[s.heroPos]}</span>`;
      if (s.mode === 'vsopen') detail += `<br><span style="opacity:0.8">${s.cfg.posNames[s.openerPos]} opened ${fmtBB(osz)} — reshove all-in or fold (no flatting in this tree)</span>`;
      if (s.mode === 'vs3bet') detail += `<br><span style="opacity:0.8">You opened ${fmtBB(osz)} in ${s.cfg.posNames[s.heroPos]}, ${s.cfg.posNames[s.reshoverPos]} jammed ${fmtBB(Math.min(s.cfg.stacks[s.reshoverPos], 999))}</span>`;
    }

    if (s.targeted) detail += `<br><span style="opacity:0.8">🎯 Targeted repeat — you've missed ${label} before; answer it right twice to clear it</span>`;

    // stats
    stats.hands++;
    if (verdictCls === 'good' || verdictCls === 'mixed') stats.correct++;
    else stats.wrong++;
    if (usedIcm) stats.evLostIcm += evLost; else stats.evLost += evLost;
    // hand log (feeds leak stats + mistake review + history explanations)
    let histId = null;
    if (s.review) {
      const entry = handLog.find(e => e.id === s.review);
      if (entry && (verdictCls === 'good' || verdictCls === 'mixed')) entry.fixed = true;
      histId = s.review;
      detail += `<br><span style="opacity:0.8">Review · ${remainingMistakes().length} mistake${remainingMistakes().length === 1 ? '' : 's'} left</span>`;
    } else {
      histId = 'h' + Date.now() + Math.floor(Math.random() * 1000);
      handLog.push({
        id: histId,
        t: Date.now(),
        detail: detail.slice(0, 700),
        mode: s.mode, heroPos: s.heroPos,
        pusherPos: s.pusherPos, openerPos: s.openerPos, reshoverPos: s.reshoverPos,
        hand: s.hand, label, action, v: verdictCls,
        evLost: Math.round(evLost * 100) / 100, suffix: unit.suffix.trim(),
        posName: s.cfg.posNames[s.heroPos],
        snap: s.snap || {
          players: settings.players, sbChips: settings.sbChips, bbChips: settings.bbChips,
          anteMode: settings.anteMode, anteChips: settings.anteChips, stacksText: settings.stacksText,
          evFormat: settings.evFormat, payoutsText: settings.payoutsText,
          bountiesText: settings.bountiesText, bountyFraction: settings.bountyFraction,
          openSize: settings.openSize,
        },
      });
      if (handLog.length > 400) handLog = handLog.slice(-400);
    }
    history.push({ label, v: verdictCls, id: histId });
    history = history.slice(-24);
    saveStats();
    renderHeaderStats();
    renderHistory();

    // disable action buttons
    $('controls').querySelectorAll('button').forEach(b => b.disabled = true);

    // exam hands: no per-hand feedback — record the result and auto-advance
    if (s.exam && exam) {
      exam.results.push({
        i: exam.idx, label, v: verdictCls, mode: s.mode,
        evLost: Math.round(evLost * 100) / 100,
        spot: `<b>${label}</b> · ${s.cfg.posNames[s.heroPos]} ${fmtBB(s.cfg.stacks[s.heroPos])} · ${MODE_LABELS[s.mode] || s.mode}`,
        actionLabel: actionLabel(action, s.mode),
        why: verdictCls === 'bad' ? examWhy(s, examCtx, action) : '',
        detail,
      });
      exam.idx++;
      setTimeout(() => {
        if (!exam) return;
        if (exam.idx >= exam.total) finishExam();
        else examDeal();
      }, 350);
      return;
    }

    $('btnShowRange').style.display = '';
    $('btnNext').innerHTML = 'Next hand <kbd>Space</kbd>';
    $('fbVerdict').className = 'verdict ' + verdictCls;
    $('fbVerdict').textContent = verdictTxt;
    $('fbDetail').innerHTML = detail;
    $('feedback').classList.add('show');
  }

  function actionLabel(action, mode) {
    if (action === 'fold') return 'Fold';
    if (action === 'jam') return 'All-in';
    if (action === 'call') return 'Call';
    if (action === 'threebet') return mode === 'opentree' ? 'Raise' : '3-Bet';
    return 'Raise';
  }

  // ---------------- range viewer ----------------
  let rangeCtx = null; // what to display

  function openRangeForScenario() {
    const s = scenario;
    if (!s) return;
    if (s.pf && s.pf.sol) { openPfStrategy(); return; }
    if (s.mode === 'pushfold') rangeCtx = { type: 'push', pos: s.heroPos };
    else if (s.mode === 'callvjam') rangeCtx = { type: 'call', pos: s.heroPos, vs: s.pusherPos };
    else if (s.mode === 'opentree') rangeCtx = { type: 'open', pos: s.heroPos };
    else if (s.mode === 'vsopen') rangeCtx = { type: 'rshv', pos: s.heroPos, vs: s.openerPos };
    else if (s.mode === 'vs3bet') rangeCtx = { type: 'c3bv', pos: s.heroPos, vs: s.reshoverPos };
    else if (s.mode === 'vsrfi') rangeCtx = {
      type: 'vsrfi',
      key: Ranges.vsrfiKey(s.cfg.posNames[s.heroPos], s.cfg.posNames[s.openerPos]),
    };
    else rangeCtx = { type: 'rfi', pos: s.heroPos };
    renderRangeModal(s.handId);
    $('rangeModal').classList.add('show');
  }

  function openRangeBrowser() {
    const cfg = tableConfig();
    if (!rangeCtx) rangeCtx = { type: 'push', pos: 0 };
    if (rangeCtx.pos >= cfg.n) rangeCtx.pos = 0;
    renderRangeModal(scenario && scenario.answered ? scenario.handId : -1);
    $('rangeModal').classList.add('show');
  }

  function renderRangeModal(hlId) {
    const cfg = tableConfig();
    const ctx = rangeCtx;

    // controls
    const TYPE_LABELS = {
      push: 'Jam', call: 'Call vs jam', open: 'Open tree', rshv: 'Reshove', c3bv: 'Call 3-bet',
      rfi: 'RFI chart', vsrfi: 'Vs open (chart)',
    };
    let ctrl = `<div class="seg" id="rvType">` +
      Object.keys(TYPE_LABELS).map(t =>
        `<button data-v="${t}" class="${ctx.type === t ? 'on' : ''}">${TYPE_LABELS[t]}</button>`).join('') +
      `</div>`;

    // rshv: pos = reshover (needs opener before); c3bv: pos = opener (needs reshover behind)
    const needsVs = ctx.type === 'call' || ctx.type === 'rshv' || ctx.type === 'c3bv';
    if (ctx.type === 'vsrfi') {
      if (!Ranges.VSRFI[ctx.key]) ctx.key = 'BB_vs_BTN';
      ctrl += ` <select id="rvKey">`;
      for (const key in Ranges.VSRFI) {
        ctrl += `<option value="${key}" ${key === ctx.key ? 'selected' : ''}>${Ranges.VSRFI_LABELS[key]}</option>`;
      }
      ctrl += `</select>`;
    } else {
      if (typeof ctx.pos !== 'number' || ctx.pos >= cfg.n) ctx.pos = 0;
      const posStart = (ctx.type === 'call' || ctx.type === 'rshv') ? 1 : 0;
      const posLimit = (ctx.type === 'call' || ctx.type === 'rshv') ? cfg.n : cfg.n - 1;
      if (ctx.pos < posStart) ctx.pos = posStart;
      if (ctx.pos >= posLimit) ctx.pos = posLimit - 1;
      ctrl += ` <select id="rvPos">`;
      for (let i = posStart; i < posLimit; i++) {
        ctrl += `<option value="${i}" ${i === ctx.pos ? 'selected' : ''}>${cfg.posNames[i]}</option>`;
      }
      ctrl += `</select>`;
      if (needsVs) {
        if (ctx.type === 'c3bv') {
          // vs = reshover behind the opener
          ctx.vs = Math.min(Math.max(ctx.vs ?? cfg.n - 1, ctx.pos + 1), cfg.n - 1);
          ctrl += ` vs <select id="rvVs">`;
          for (let j = ctx.pos + 1; j < cfg.n; j++) {
            ctrl += `<option value="${j}" ${j === ctx.vs ? 'selected' : ''}>${cfg.posNames[j]} reshove</option>`;
          }
          ctrl += `</select>`;
        } else {
          ctx.vs = Math.max(0, Math.min(ctx.vs ?? 0, ctx.pos - 1));
          const verb = ctx.type === 'call' ? 'jam' : 'open';
          ctrl += ` vs <select id="rvVs">`;
          for (let j = 0; j < ctx.pos; j++) {
            ctrl += `<option value="${j}" ${j === ctx.vs ? 'selected' : ''}>${cfg.posNames[j]} ${verb}</option>`;
          }
          ctrl += `</select>`;
        }
      }
    }
    $('rangeControls').innerHTML = ctrl;

    $('rangeControls').querySelectorAll('#rvType button').forEach(b => {
      b.addEventListener('click', () => {
        const t = b.dataset.v;
        if (t === 'vsrfi') rangeCtx = { type: 'vsrfi', key: rangeCtx.key || 'BB_vs_BTN' };
        else if (t === 'c3bv') rangeCtx = { type: t, pos: 0, vs: cfg.n - 1 };
        else if (t === 'call' || t === 'rshv') rangeCtx = { type: t, pos: Math.max(1, ctx.pos || 1), vs: 0 };
        else rangeCtx = { type: t, pos: Math.min(ctx.pos || 0, cfg.n - 2), vs: 0 };
        renderRangeModal(hlId);
      });
    });
    const keySel = $('rangeControls').querySelector('#rvKey');
    if (keySel) keySel.addEventListener('change', () => {
      ctx.key = keySel.value;
      renderRangeModal(hlId);
    });
    const posSel = $('rangeControls').querySelector('#rvPos');
    if (posSel) posSel.addEventListener('change', () => {
      ctx.pos = parseInt(posSel.value, 10);
      if (ctx.type === 'call') ctx.vs = Math.min(ctx.vs || 0, ctx.pos - 1);
      renderRangeModal(hlId);
    });
    const vsSel = $('rangeControls').querySelector('#rvVs');
    if (vsSel) vsSel.addEventListener('change', () => {
      ctx.vs = parseInt(vsSel.value, 10);
      renderRangeModal(hlId);
    });

    // pick data
    const unit = evUnit(cfg);
    const tag = (cfg.icm ? ' · ICM' : '') + (cfg.pko ? ' · PKO' : '');
    const solverType = ['push', 'call', 'open', 'rshv', 'c3bv'].includes(ctx.type);
    const tree = (ctx.type === 'open' || ctx.type === 'rshv' || ctx.type === 'c3bv') ? 'raise' : 'jam';
    const sol = solverType ? getSolution(cfg, tree) : null;
    let freqs = null, freqs2 = null, evs = null, evs2 = null, title = '', aggr = 'Jam', aggr2 = null;
    let color2 = 'var(--call)';
    if (ctx.type === 'push') {
      title = `${cfg.posNames[ctx.pos]} first-in jam range${tag}`;
      if (sol) { freqs = sol.push[ctx.pos]; evs = sol.evPush[ctx.pos]; }
    } else if (ctx.type === 'call') {
      title = `${cfg.posNames[ctx.pos]} calling range vs ${cfg.posNames[ctx.vs]} jam${tag}`;
      if (sol && sol.call[ctx.pos] && sol.call[ctx.pos][ctx.vs]) {
        freqs = sol.call[ctx.pos][ctx.vs];
        evs = sol.evCall[ctx.pos][ctx.vs];
      }
      aggr = 'Call';
    } else if (ctx.type === 'open') {
      title = `${cfg.posNames[ctx.pos]} first-in strategy (raise tree)${tag}`;
      if (sol && sol.open) {
        freqs = sol.push[ctx.pos]; evs = sol.evPush[ctx.pos];
        freqs2 = sol.open[ctx.pos]; evs2 = sol.evOpen[ctx.pos];
      }
      aggr = 'Jam'; aggr2 = 'Raise'; color2 = '#d97a2b';
    } else if (ctx.type === 'rshv') {
      title = `${cfg.posNames[ctx.pos]} reshove range vs ${cfg.posNames[ctx.vs]} open${tag}`;
      if (sol && sol.rsh && sol.rsh[ctx.pos] && sol.rsh[ctx.pos][ctx.vs]) {
        freqs = sol.rsh[ctx.pos][ctx.vs];
        evs = sol.evRsh[ctx.pos][ctx.vs];
      }
      aggr = 'Reshove';
    } else if (ctx.type === 'c3bv') {
      title = `${cfg.posNames[ctx.pos]} call vs ${cfg.posNames[ctx.vs]} reshove (after opening)${tag}`;
      if (sol && sol.c3b && sol.c3b[ctx.pos] && sol.c3b[ctx.pos][ctx.vs]) {
        freqs = sol.c3b[ctx.pos][ctx.vs];
        evs = sol.evC3b[ctx.pos][ctx.vs];
      }
      aggr = 'Call';
    } else if (ctx.type === 'vsrfi') {
      title = `${Ranges.VSRFI_LABELS[ctx.key]} (chart)`;
      freqs = Ranges.VSRFI[ctx.key].threebet;
      freqs2 = Ranges.VSRFI[ctx.key].call;
      aggr = '3-Bet';
      aggr2 = 'Call';
    } else {
      const name = cfg.posNames[ctx.pos];
      title = `${name} opening range (chart)`;
      freqs = Ranges.RFI[name] || null;
      aggr = 'Raise';
    }

    $('rangeTitle').textContent = title;
    let legend = `<span class="swatch" style="background:var(--jam)"></span>${aggr}`;
    if (aggr2) legend += ` &nbsp; <span class="swatch" style="background:${color2}"></span>${aggr2}`;
    $('legendItems').innerHTML = legend;

    const grid = $('rangeGrid');
    if (!freqs) {
      if (solverType) ensureSolved(cfg, tree); // re-renders when done
      grid.innerHTML = `<div style="grid-column:1/-1;padding:30px;text-align:center;color:var(--text-dim)">` +
        (solverType ? 'Solving this tree…' : 'No chart for this position.') + `</div>`;
      $('rangeStats').textContent = '';
      return;
    }

    let cells = '';
    for (let id = 0; id < 169; id++) {
      const f = freqs[id];
      const f2 = freqs2 ? freqs2[id] : 0;
      const label = GTO.handLabel(id);
      const pct = Math.round(f * 100);
      const pct2 = Math.round(Math.min(100, (f + f2) * 100));
      let style = '';
      if (f >= 0.995) style = `background:var(--jam);color:#fff`;
      else if (f2 > 0.005 && f + f2 >= 0.995) style = `background:linear-gradient(to top, var(--jam) ${pct}%, ${color2} ${pct}%);color:#fff`;
      else if (f > 0.005 || f2 > 0.005) {
        style = `background:linear-gradient(to top, var(--jam) ${pct}%, ` +
          (f2 > 0.005 ? `${color2} ${pct}%, ${color2} ${pct2}%, ` : '') +
          `var(--fold-cell) ${pct2}%);color:#dfe6ef`;
      }
      let tip = `${label}: ${aggr.toLowerCase()} ${pct}%`;
      if (freqs2) tip += ` · ${(aggr2 || 'call').toLowerCase()} ${Math.round(f2 * 100)}%`;
      if (evs) tip += ` · EV(${aggr.toLowerCase()}) ${evs[id] >= 0 ? '+' : ''}${evs[id].toFixed(2)}${unit.suffix}`;
      if (evs2) tip += ` · EV(${(aggr2 || '').toLowerCase()}) ${evs2[id] >= 0 ? '+' : ''}${evs2[id].toFixed(2)}${unit.suffix}`;
      cells += `<div class="range-cell ${id === hlId ? 'hl' : ''}" style="${style}" title="${tip}">${label}</div>`;
    }
    grid.innerHTML = cells;
    let statTxt = `${aggr} ${Ranges.rangePercent(freqs).toFixed(1)}%`;
    if (freqs2) statTxt += ` · ${aggr2} ${Ranges.rangePercent(freqs2).toFixed(1)}%`;
    $('rangeStats').textContent = statTxt + ' of hands';
  }

  // ---------------- settings modal ----------------
  function openSettings() {
    $('setPlayers').value = settings.players;
    $('setSB').value = settings.sbChips;
    $('setBB').value = settings.bbChips;
    $('setAnte').value = settings.anteChips;
    $('setStacks').value = settings.stacksText;
    $('setMode').value = settings.mode;
    $('setExamHands').value = settings.examHands;
    $('setIters').value = settings.iterations;
    $('setPayouts').value = settings.payoutsText;
    $('setBounties').value = settings.bountiesText;
    $('setBountyFrac').value = settings.bountyFraction;
    document.querySelectorAll('#segAnte button').forEach(b =>
      b.classList.toggle('on', b.dataset.v === settings.anteMode));
    document.querySelectorAll('#segFormat button').forEach(b =>
      b.classList.toggle('on', b.dataset.v === settings.evFormat));
    document.querySelectorAll('#segExamCharts button').forEach(b =>
      b.classList.toggle('on', b.dataset.v === (settings.examCharts ? 'on' : 'off')));
    updatePayoutsVisibility();
    updateExamVisibility();
    rebuildHeroPosSelect();
    $('settingsModal').classList.add('show');
  }

  function updatePayoutsVisibility() {
    const icm = settings.evFormat === 'icm';
    const pko = settings.evFormat === 'pko';
    $('rowPayouts').style.display = icm ? '' : 'none';
    $('hintPayouts').style.display = icm ? '' : 'none';
    $('rowBounties').style.display = pko ? '' : 'none';
    $('hintBounties').style.display = pko ? '' : 'none';
  }

  function updateExamVisibility() {
    const ex = $('setMode').value === 'exam';
    $('rowExam').style.display = ex ? '' : 'none';
    $('hintExam').style.display = ex ? '' : 'none';
  }

  function rebuildHeroPosSelect() {
    const n = parseInt($('setPlayers').value, 10);
    const names = GTO.POSITION_NAMES[n];
    const sel = $('setHeroPos');
    let html = '<option value="random">Random</option>';
    for (let i = 0; i < n; i++) html += `<option value="${i}">${names[i]}</option>`;
    sel.innerHTML = html;
    sel.value = settings.heroPos;
    if (sel.selectedIndex < 0) sel.value = 'random';
  }

  function applySettings() {
    settings.players = parseInt($('setPlayers').value, 10);
    settings.sbChips = parseFloat($('setSB').value) || 500;
    settings.bbChips = parseFloat($('setBB').value) || 1000;
    settings.anteChips = parseFloat($('setAnte').value) || 0;
    settings.stacksText = $('setStacks').value;
    settings.heroPos = $('setHeroPos').value;
    settings.mode = $('setMode').value;
    settings.examHands = parseInt($('setExamHands').value, 10) || 20;
    settings.iterations = parseInt($('setIters').value, 10);
    settings.payoutsText = $('setPayouts').value;
    settings.bountiesText = $('setBounties').value;
    settings.bountyFraction = Math.min(1, Math.max(0, parseFloat($('setBountyFrac').value) || 0.65));
    saveJson('gto_settings', settings);
    $('settingsModal').classList.remove('show');
    scenario = null;
    reviewQueue = null;
    exam = null;
    renderNav();
    newHand();
  }

  // ---------------- mistake review ----------------
  let reviewQueue = null, reviewIdx = 0;

  function startReview() {
    const q = remainingMistakes();
    if (!q.length) return;
    exam = null; // reviewing aborts any exam in progress
    reviewQueue = q.slice(-60).reverse(); // newest mistakes first
    reviewIdx = 0;
    nextReviewHand();
  }

  function nextReviewHand() {
    if (!reviewQueue || reviewIdx >= reviewQueue.length) { exitReview(); return; }
    const e = reviewQueue[reviewIdx];
    if (e.pf) {
      reviewIdx++;
      newPostflopHand(e.pf.m, false, e);
      return;
    }
    const cfg = tableConfig(Object.assign({}, DEFAULT_SETTINGS, e.snap));
    const tree = treeForMode(e.mode);
    if (tree && !getSolution(cfg, tree)) {
      pendingFn = nextReviewHand;
      ensureSolved(cfg, tree);
      return;
    }
    reviewIdx++;
    startScenario(cfg, e.mode, e.heroPos,
      e.pusherPos ?? -1, e.openerPos ?? -1, e.reshoverPos ?? -1, e.hand, e.id);
  }

  function exitReview() {
    reviewQueue = null;
    newHand();
  }

  function nextHand() {
    if (scenario && scenario.exam && exam) return; // exam auto-advances
    if (scenario && scenario.mode === 'pfhand' && scenario.pf && !scenario.pf.finished && scenario.answered) {
      continuePfHand();
      return;
    }
    if (reviewQueue) nextReviewHand();
    else newHand();
  }

  // ---------------- session exam ----------------
  // A scored run of solver spots dealt from randomized table configs
  // (players, depths, antes, open sizes); feedback is withheld until the
  // final recap, which explains every mistake. The plan is adaptive: drills
  // and positions you've been missing are dealt more often, and the
  // multi-decision raise-tree spots always get an outsized base share.
  let exam = null; // {total, idx, results[], plan[]}

  const EXAM_MODES = ['pushfold', 'callvjam', 'opentree', 'vsopen', 'vs3bet'];
  const EXAM_DEEP = ['rfi', 'vsrfi']; // 40-60bb chart drills (optional)
  const EXAM_PF = ['pfcbet', 'pfdefend', 'pfrivercall', 'pftexture', 'pfequity'];
  const EXAM_BASE_W = {
    pushfold: 1, callvjam: 1, opentree: 1.6, vsopen: 1.3, vs3bet: 1.3, rfi: 0.8, vsrfi: 1.1,
    pfcbet: 1.0, pfdefend: 1.0, pfrivercall: 0.7, pftexture: 0.4, pfequity: 0.4,
  };
  const EXAM_SHORT = ['pushfold', 'callvjam']; // jam-tree drills → ≤15bb configs

  // recency-weighted mistake mass per drill and position, from the hand log
  function examWeakness() {
    const byMode = {}, byPos = {};
    const all = EXAM_MODES.concat(EXAM_DEEP, EXAM_PF);
    const recent = handLog.filter(e => all.includes(e.mode)).slice(-150);
    recent.forEach((e, i) => {
      const decay = 0.5 + 0.5 * (i + 1) / recent.length; // newer counts more
      // mistakes already corrected in review still count, but less
      const w = (e.v === 'bad' ? 1 : e.v === 'mixed' ? 0.25 : 0) * (e.fixed ? 0.4 : 1);
      if (!w) return;
      byMode[e.mode] = (byMode[e.mode] || 0) + w * decay;
      if (e.posName) byPos[e.posName] = (byPos[e.posName] || 0) + w * decay;
    });
    return { byMode, byPos };
  }

  function wpick(items, weights) {
    let sum = 0;
    for (const w of weights) sum += w;
    let r = Math.random() * sum;
    for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }

  // per-session table configs, split by stack band so a forced drill always
  // lands on a compatible depth
  function examSpecPool() {
    const ri = (a, b) => a + ((Math.random() * (b - a + 1)) | 0);
    const pick = (arr) => arr[(Math.random() * arr.length) | 0];
    const snap = (players, anteMode, stacksText, openSize) => ({
      players, sbChips: 500, bbChips: 1000,
      anteMode, anteChips: anteMode === 'classic' ? 125 : 1000,
      stacksText, heroPos: 'random', evFormat: 'chip',
      openSize: openSize || OPEN_SIZE,
    });
    const ragged = (n, lo, hi) => new Array(n).fill(0).map(() => ri(lo, hi) * 1000).join(', ');
    const nS = pick([6, 9]), nM = pick([6, 9]);
    return {
      short: [
        snap(pick([8, 9]), pick(['bb', 'none']), String(ri(5, 12) * 1000)),
        snap(nS, pick(['bb', 'classic']), ragged(nS, 5, 14)),
        snap(pick([2, 3]), pick(['none', 'bb']), String(ri(6, 14) * 1000)),
      ],
      mid: [
        snap(pick([6, 7, 8]), 'bb', String(ri(16, 28) * 1000), pick([2.0, 2.2, 2.5])),
        snap(nM, pick(['bb', 'classic']), ragged(nM, 16, 30), pick([2.0, 2.2, 2.5])),
      ],
      deep: [
        snap(pick([8, 9]), 'bb', String(ri(40, 60) * 1000)),
        snap(pick([6, 7]), pick(['bb', 'none']), String(ri(40, 60) * 1000)),
      ],
    };
  }

  function startExam() {
    const pool = examSpecPool();
    const pick = (arr) => arr[(Math.random() * arr.length) | 0];
    const total = parseInt(settings.examHands, 10) || 20;
    let modes = EXAM_MODES.concat(EXAM_PF);
    if (settings.examCharts) modes = modes.concat(EXAM_DEEP);
    const weak = examWeakness();
    const errSum = modes.reduce((s, m) => s + (weak.byMode[m] || 0), 0);
    const modeW = modes.map(m =>
      EXAM_BASE_W[m] * (1 + (errSum ? 2.5 * (weak.byMode[m] || 0) / errSum : 0)));
    const posSum = Object.values(weak.byPos).reduce((a, b) => a + b, 0);

    const plan = [];
    for (let i = 0; i < total; i++) {
      const mode = wpick(modes, modeW);
      if (EXAM_PF.includes(mode)) { plan.push({ mode, snap: null }); continue; }
      const cfgSnap = pick(EXAM_SHORT.includes(mode) ? pool.short :
        EXAM_DEEP.includes(mode) ? pool.deep : pool.mid);
      const n = cfgSnap.players;
      const names = GTO.POSITION_NAMES[n];
      // seats compatible with the drill (BB can't be first in; someone must act before a defender)
      const defends = mode === 'callvjam' || mode === 'vsopen' || mode === 'vsrfi';
      const lo = defends ? 1 : 0;
      const hi = defends ? n : n - 1;
      const seats = [], seatW = [];
      for (let p = lo; p < hi; p++) {
        seats.push(p);
        seatW.push(1 + (posSum ? 3 * (weak.byPos[names[p]] || 0) / posSum : 0));
      }
      plan.push({ mode, snap: Object.assign({}, cfgSnap, { heroSeat: wpick(seats, seatW) }) });
    }
    exam = { total, idx: 0, results: [], plan };
    globalThis.__examPlan = plan; // debug/test hook
    $('examModal').classList.remove('show');
    examDeal();
  }

  function examDeal() {
    if (!exam) return;
    const p = exam.plan[exam.idx];
    if (PF_MODES.has(p.mode)) { newPostflopHand(p.mode, true); return; }
    const cfg = tableConfig(Object.assign({}, DEFAULT_SETTINGS, p.snap));
    dealSpot(cfg, p.mode, examDeal, p.snap);
  }

  function examNext() {
    if (!exam) { startExam(); return; }
    if (exam.idx >= exam.total) { finishExam(); return; }
    examDeal();
  }

  // header counter + progress bar while an exam is live; the title doubles
  // as the exit button
  function updateExamProgress() {
    const active = !!(exam && scenario && scenario.exam);
    $('examProgress').style.display = active ? '' : 'none';
    const h1 = document.querySelector('header h1');
    h1.classList.toggle('exam-live', active);
    h1.title = active ? 'Exit exam' : '';
    if (!active) return;
    $('examProgLabel').innerHTML =
      `Exam · hand <b>${Math.min(exam.idx + 1, exam.total)}</b> of ${exam.total}`;
    $('examProgFill').style.width = (100 * exam.idx / exam.total).toFixed(0) + '%';
  }

  function exitExam() {
    $('exitExamModal').classList.remove('show');
    if (!exam) return;
    exam = null;
    settings.mode = 'auto'; // back to free play, not straight into a new exam
    saveJson('gto_settings', settings);
    scenario = null;
    updateExamProgress();
    renderNav();
    newHand();
  }

  // plain-English reason for a mistake, grounded in the solver numbers
  function examWhy(s, ctx, action) {
    if (!ctx) return '';
    const label = GTO.handLabel(s.handId);
    const depth = fmtBB(s.cfg.stacks[s.heroPos]);
    const pos = s.cfg.posNames[s.heroPos];
    const fx = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
    if (ctx.kind === 'tree') {
      const { eO, eJ } = ctx;
      if (action === 'fold') {
        return eJ > eO
          ? `${label} is a profitable all-in from ${pos} at ${depth} — jamming earns ${fx(eJ)} bb on average, mostly by picking up the blinds and antes uncontested.`
          : `${label} is a profitable open from ${pos} at ${depth} — the small raise earns ${fx(eO)} bb on average; folding gives all of that up.`;
      }
      if (eO <= 0 && eJ <= 0) {
        return `${label} is simply a fold from ${pos} at this depth — both raising (${fx(eO)} bb) and jamming (${fx(eJ)} bb) lose chips against the ranges behind you.`;
      }
      return action === 'jam'
        ? `Too much risk for the reward — the small raise gets similar folds far more cheaply, and you keep the option to fold to a reshove (EV ${fx(eO)} bb raising vs ${fx(eJ)} bb jamming).`
        : `This hand prefers the all-in — after a small raise you often face a reshove you can't call profitably, so jamming captures more of the hand's value (EV ${fx(eJ)} bb vs ${fx(eO)} bb raising).`;
    }
    if (ctx.kind === 'chart') {
      const { r, c, f } = ctx;
      const best = r >= c && r >= f ? '3-betting' : c >= f ? 'flat-calling' : 'folding';
      return `Deep chart spot: the baseline defense with ${label} here is mostly ${best} ` +
        `(3-bet ${(r * 100).toFixed(0)}% · call ${(c * 100).toFixed(0)}% · fold ${(f * 100).toFixed(0)}%) — ` +
        `at 40 bb+ it's position and the opener's range that set the mix, not stack pressure.`;
    }
    if (ctx.kind === 'two') {
      const { freq, evDiff } = ctx;
      const m = s.mode;
      if (m === 'rfi') {
        return action === 'fold'
          ? `${label} is a standard open from ${pos} at deep stacks — the baseline chart opens it ${(freq * 100).toFixed(0)}% of the time.`
          : `${label} isn't in the ${pos} opening chart — too weak to open first-in from this seat at deep stacks.`;
      }
      if (action === 'fold') {
        const fw = freq >= 0.995 ? 'a pure (always)' : freq >= 0.7 ? 'a standard' : 'a frequent';
        if (m === 'pushfold') return `${label} is ${fw} jam from ${pos} at ${depth} — the blinds and antes you pick up when everyone folds outweigh the times you're called, worth ${fx(evDiff)} bb over folding.`;
        if (m === 'callvjam') return `${label} is ${fw} call — against the range that jams here you have enough equity for the price you're being offered, worth ${fx(evDiff)} bb over folding.`;
        if (m === 'vsopen') return `${label} is ${fw} reshove — fold equity against the open plus your showdown equity when called make the jam worth ${fx(evDiff)} bb.`;
        if (m === 'vs3bet') return `Having already opened, you're getting a strong price on the call — ${label} has the equity to stack off, worth ${fx(evDiff)} bb over surrendering your open.`;
      } else {
        const fw = freq <= 0.005 ? 'never' : `only ${(freq * 100).toFixed(0)}% of the time`;
        const cost = Math.max(0, -evDiff).toFixed(2);
        if (m === 'pushfold') return `The solver jams ${label} ${fw} here — the calling ranges behind you dominate it too often, so jamming loses ${cost} bb vs folding.`;
        if (m === 'callvjam') return `The solver calls ${label} ${fw} — you'd be putting in too big a share of your stack without the equity against the jamming range (${cost} bb worse than folding).`;
        if (m === 'vsopen') return `The solver reshoves ${label} ${fw} — the opener continues often enough that the jam loses ${cost} bb vs folding.`;
        if (m === 'vs3bet') return `The solver calls off ${label} ${fw} after this open — you're behind the reshoving range, so calling costs ${cost} bb more than letting the open go.`;
      }
    }
    return '';
  }

  function finishExam() {
    if (!exam) return;
    const res = exam.results;
    const nGood = res.filter(r => r.v === 'good').length;
    const nMixed = res.filter(r => r.v === 'mixed').length;
    const nBad = res.filter(r => r.v === 'bad').length;
    const evLost = res.reduce((sum, r) => sum + (r.evLost || 0), 0);
    const score = res.length ? Math.round(100 * (nGood + 0.6 * nMixed) / res.length) : 0;
    const grade = score >= 95 ? 'A+' : score >= 90 ? 'A' : score >= 80 ? 'B' :
      score >= 70 ? 'C' : score >= 55 ? 'D' : 'F';
    const gradeCls = score >= 80 ? 'good' : score >= 60 ? 'mixed' : 'bad';

    let html = `<div class="exam-score"><span class="num ${gradeCls}">${score}</span>` +
      `<span class="grade ${gradeCls}">${grade}</span></div>` +
      `<div class="exam-sub"><b>${nGood}</b> correct · <b>${nMixed}</b> close · ` +
      `<b>${nBad}</b> mistake${nBad === 1 ? '' : 's'} · EV lost <b>${evLost.toFixed(2)} bb</b> ` +
      `over ${res.length} hands` +
      (res.some(r => EXAM_DEEP.includes(r.mode) || r.mode === 'pftexture' || r.mode === 'pfequity')
        ? ' <span style="opacity:0.75">(chart/quiz spots score by agreement, no EV)</span>' : '') +
      `</div>`;

    const bad = res.filter(r => r.v === 'bad');
    if (bad.length) {
      html += `<h3 style="font-size:13px;color:var(--text-dim);margin:10px 0 6px">Every mistake, explained</h3>`;
      for (const r of bad) {
        html += `<div class="exam-mistake">` +
          `<div class="em-head"><span class="em-num">#${r.i + 1}</span> ${r.spot} — ` +
          `you chose <span class="em-act">${r.actionLabel}</span></div>` +
          (r.why ? `<div class="em-why">${r.why}</div>` : '') +
          `<div class="em-detail">${r.detail}</div></div>`;
      }
    } else if (res.length) {
      html += `<p style="text-align:center;color:var(--green);font-weight:600;margin:8px 0">Flawless — no outright mistakes.</p>`;
    }
    const close = res.filter(r => r.v === 'mixed');
    if (close.length) {
      html += `<h3 style="font-size:13px;color:var(--text-dim);margin:12px 0 4px">Close spots (either action is fine)</h3>` +
        `<div class="exam-close-list">` +
        close.map(r => `<span class="chip">#${r.i + 1} ${r.spot.replace(/<\/?b>/g, '')}</span>`).join('') +
        `</div>`;
    }
    // adaptive preview: what the next exam will lean toward (includes this run)
    const weakNow = examWeakness();
    const focus = Object.entries(weakNow.byMode).sort((a, b) => b[1] - a[1]).filter(x => x[1] > 0);
    if (focus.length) {
      const posFocus = Object.entries(weakNow.byPos).sort((a, b) => b[1] - a[1]).filter(x => x[1] > 0);
      html += `<div class="exam-sub" style="margin-top:12px">Adaptive: your next exam will deal more ` +
        `<b>${focus.slice(0, 2).map(x => MODE_LABELS[x[0]] || x[0]).join('</b> and <b>')}</b> spots` +
        (posFocus.length ? `, favouring <b>${posFocus.slice(0, 2).map(x => x[0]).join('</b> and <b>')}</b>` : '') +
        `.</div>`;
    }
    $('examBody').innerHTML = html;
    $('btnExamReview').style.display = bad.length ? '' : 'none';
    $('examModal').classList.add('show');
    $('quickBar').style.display = '';
    exam = null;
    updateExamProgress();
  }

  // ---------------- postflop drills ----------------
  // Heads-up single-raised pots: an IP opener vs the BB caller. Pot/stacks
  // model a 40bb tournament spot: 2.2x open + call + SB + BB ante.
  const PF = globalThis.GTOPostflop;
  const PF_MODES = new Set(['pftexture', 'pfequity', 'pfrivercall', 'pfcbet', 'pfdefend', 'pfhand']);
  const PF_POT = 5.9, PF_STACK = 37.8;
  const PF_IPS = ['UTG', 'LJ', 'CO', 'BTN'];

  function pfPick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  // 3-bet pots: opener (OOP) called an in-position 3-bet — 2.2 open, 7.5
  // 3-bet, call → 17.5 pot with 32.5 behind (SPR ~1.9)
  const PF_3BP = { pot: 17.5, stack: 32.5, three: 7.5 };
  const PF_3BP_PAIRS = [['CO', 'BTN'], ['HJ', 'BTN'], ['HJ', 'CO'], ['LJ', 'BTN'], ['UTG', 'BTN'], ['UTG', 'CO']];

  function pfMatchup(potType) {
    const pt = potType || settings.pfPot || 'srp';
    if (pt === '3bp') {
      const [oop, ip] = pfPick(PF_3BP_PAIRS);
      return pfMatchupFor(ip, oop);
    }
    return pfMatchupFor(pfPick(PF_IPS));
  }

  // sample a specific combo from a weighted combo list
  function pfSampleCombo(combos) {
    let total = 0;
    for (const cb of combos) total += cb.w;
    let r = Math.random() * total;
    for (const cb of combos) { r -= cb.w; if (r <= 0) return cb; }
    return combos[combos.length - 1];
  }

  function pfCardsHtml(cards) {
    return cards.map(c => Deck.cardHtml(c)).join('');
  }
  function pfComboLabel(cb) {
    const name = (c) => GTO.RANKS[c >> 2] + GTO.SUIT_CHARS[c & 3];
    return `${name(cb.c1)}${name(cb.c2)}`;
  }
  function fx1(x) { return (x >= 0 ? '+' : '') + x.toFixed(2); }

  // ---- rendering: full-ring postflop table, everyone else folded ----
  function renderPostflopTable(spot) {
    $('tableWrap').classList.add('pf');
    const n = 9;
    const names = GTO.POSITION_NAMES[n];
    const oopNm = pfOopName(spot.matchup);
    const heroName = spot.heroIsIp ? spot.matchup.ip : oopNm;
    const vilName = spot.heroIsIp ? oopNm : spot.matchup.ip;
    const heroIdx = names.indexOf(heroName);
    const vilIdx = names.indexOf(vilName);
    let html = '';
    for (let i = 0; i < n; i++) {
      const rel = ((i - heroIdx) % n + n) % n;
      const { x, y } = seatXY(rel, n);
      const isHero = i === heroIdx, isVil = i === vilIdx;
      const cls = ['seat'];
      if (isHero) cls.push('hero');
      if (isVil) cls.push(/ALL-IN/.test(spot.vilTag || '') ? 'jammer' : 'opener');
      if (!isHero && !isVil) cls.push('folded');
      let tag;
      if (isHero) {
        const heroTag = spot.heroIsIp
          ? (spot.matchup.threeBP ? `3-BET ${fmtBB(PF_3BP.three)}` : 'OPENED 2.2 bb')
          : 'HERO';
        tag = `<div class="action-tag" style="color:var(--accent)">${heroTag}</div>`;
      } else if (isVil) {
        tag = `<div class="action-tag">${spot.vilTag || pfPreTag(spot.matchup, vilName === spot.matchup.ip)}</div>`;
      } else {
        tag = '<div class="action-tag">FOLD</div>';
      }
      const stackTxt = (isHero || isVil) ? fmtBB(spot.stack ?? PF_STACK) : fmtBB(40);
      html += `<div class="${cls.join(' ')}" style="left:${x}%;top:${y}%">` +
        `<div class="seat-box"><div class="pos-name">${names[i]}</div>` +
        `<div class="stack">${stackTxt}</div>${tag}</div></div>`;
    }
    // dealer button on the BTN seat
    const relBtn = ((n - 3 - heroIdx) % n + n) % n;
    const bxy = seatXY(relBtn, n);
    html += `<div class="dealer-btn" style="left:${50 + (bxy.x - 50) * 0.68}%;top:${46 + (bxy.y - 46) * 0.68}%">D</div>`;
    $('seats').innerHTML = html;
    const streets = ['', '', '', 'Flop', 'Turn', 'River'];
    const examTag = (scenario && scenario.exam && exam
      ? ` · EXAM ${Math.min(exam.idx + 1, exam.total)}/${exam.total}` : '') +
      (scenario && scenario.review ? ' · REVIEW' : '');
    $('tableCenter').innerHTML =
      `<div class="level">${spot.context}</div>` +
      `<div class="pot">Pot: ${fmtBB(spot.pot)}</div>` +
      `<div class="board-cards">${pfCardsHtml(spot.board)}</div>` +
      `<div class="mode-tag">${MODE_LABELS[spot.mode]} · ${streets[spot.board.length]}${examTag}</div>`;
    $('heroCards').innerHTML = spot.hand ? Deck.cardHtml(spot.hand[0], true) + Deck.cardHtml(spot.hand[1], true) : '';
    $('tableWrap').style.display = '';
    if ($('builderPanel')) $('builderPanel').style.display = 'none';
    $('quickBar').style.display = scenario && scenario.exam ? 'none' : '';
    $('histDetail').style.display = 'none';
    $('explorePanel').style.display = 'none';
    updateExamProgress();
    $('feedback').classList.remove('show');
  }

  function renderPostflopControls(options) {
    const el = $('controls');
    el.innerHTML = options.map((o, i) =>
      `<button class="action-btn ${o.cls}" data-pf="${o.id}">${o.label} <kbd>${i + 1}</kbd></button>`).join('');
    el.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () =>
        (scenario && scenario.mode === 'pfhand' ? answerPfHand : answerPostflop)(b.dataset.pf));
    });
  }

  // ---- spot builders ----
  // replay = a handLog entry with stored pf spot params (mistake review)
  function newPostflopHand(mode, isExam, replay) {
    // orphan any in-flight solve continuation (mode may have changed mid-solve);
    // the result still lands in the cache when it arrives
    if (pfPendingKey) { pfPendingFn = null; hideSolveOverlay(); }
    if (mode === 'pfhand') { startPfHand(); return; }
    if (mode === 'pfcbet' || mode === 'pfdefend') { newPfSolverSpot(mode, isExam, replay) ; return; }
    const rp = replay && replay.pf;
    const m = rp ? pfMatchupFor(rp.ip, rp.oop)
      : pfMatchup(isExam ? (Math.random() < 0.35 ? '3bp' : 'srp') : undefined);
    const spot = { mode, matchup: m, pot: m.pot0, heroIsIp: false };

    if (mode === 'pftexture') {
      spot.board = rp ? rp.board : PF.dealBoard(3, []);
      spot.hand = null;
      spot.heroIsIp = true; // cosmetic: hero box shows the aggressor
      const ipC = PF.rangeCombos(m.ipRange, spot.board);
      const bbC = PF.rangeCombos(m.bbRange, spot.board);
      spot.eq = PF.rangeVsRange(ipC, bbC, spot.board, 30000);
      spot.context = `${pfStory(m)} — whose range hit this flop?`;
      spot.options = [
        { id: 'raiser', label: `${m.threeBP ? '3-bettor' : 'Raiser'} (${m.ip})`, cls: 'threebet' },
        { id: 'even', label: 'About even', cls: 'fold' },
        { id: 'caller', label: `Caller (${pfOopName(m)})`, cls: 'call' },
      ];
    } else if (mode === 'pfequity') {
      spot.heroIsIp = rp ? !!rp.heroIsIp : Math.random() < 0.5;
      spot.board = rp ? rp.board : PF.dealBoard(Math.random() < 0.6 ? 3 : 4, []);
      const heroRange = spot.heroIsIp ? m.ipRange : m.bbRange;
      const vilRange = spot.heroIsIp ? m.bbRange : m.ipRange;
      if (rp) spot.hand = rp.hand;
      else {
        const heroCombos = PF.rangeCombos(heroRange, spot.board);
        if (!heroCombos.length) { newPostflopHand(mode); return; }
        const cb = pfSampleCombo(heroCombos);
        spot.hand = [cb.c1, cb.c2];
      }
      spot.eq = PF.equityVsRange(spot.hand, PF.rangeCombos(vilRange, spot.board.concat(spot.hand)), spot.board, 25000);
      spot.context = m.threeBP
        ? (spot.heroIsIp
          ? `You 3-bet ${m.ip} vs ${m.oop}'s open, they called — estimate your equity`
          : `You opened ${m.oop} and called ${m.ip}'s 3-bet — estimate your equity`)
        : (spot.heroIsIp
          ? `You opened ${m.ip}, BB called — estimate your equity vs their range`
          : `You defended BB vs ${m.ip} — estimate your equity vs their opening range`);
      spot.options = [
        { id: 'b0', label: 'Under 35%', cls: 'fold' },
        { id: 'b1', label: '35–50%', cls: 'threebet' },
        { id: 'b2', label: '50–65%', cls: 'call' },
        { id: 'b3', label: 'Over 65%', cls: 'jam' },
      ];
    } else { // pfrivercall
      spot.heroIsIp = false;
      if (rp) {
        spot.hand = rp.hand;
        spot.board = rp.board;
        spot.pot = rp.pot;
        spot.bet = rp.bet;
        spot.valuePct = rp.valuePct;
        spot.bluffPct = rp.bluffPct;
      } else {
        const heroCombos = PF.rangeCombos(m.bbRange, []);
        const cb = pfSampleCombo(heroCombos);
        spot.hand = [cb.c1, cb.c2];
        spot.board = PF.dealBoard(5, spot.hand);
        spot.pot = pfPick(m.threeBP ? [17.5, 26, 34] : [5.9, 9.5, 14]);
        spot.bet = Math.round(spot.pot * pfPick([0.6, 0.8, 1.0, 1.33]) * 10) / 10;
        spot.valuePct = pfPick([0.18, 0.22, 0.28]);
        spot.bluffPct = pfPick([0.08, 0.12, 0.16]);
      }
      const vilCombos = PF.rangeCombos(m.ipRange, spot.board.concat(spot.hand));
      spot.jamRange = PF.polarRange(vilCombos, spot.board, spot.valuePct, spot.bluffPct);
      spot.eq = PF.equityVsRange(spot.hand, spot.jamRange, spot.board, 0);
      spot.need = spot.bet / (spot.pot + 2 * spot.bet);
      spot.vilTag = `ALL-IN ${fmtBB(spot.bet)}`;
      spot.context = `${m.ip} barreled off${m.threeBP ? ' the 3-bet pot' : ''} — river jam ${fmtBB(spot.bet)} into ${fmtBB(spot.pot)}. ` +
        `Model: top ${Math.round(spot.valuePct * 100)}% value + bottom ${Math.round(spot.bluffPct * 100)}% bluffs`;
      spot.options = [
        { id: 'fold', label: 'Fold', cls: 'fold' },
        { id: 'call', label: `Call ${fmtBB(spot.bet)}`, cls: 'call' },
      ];
    }
    scenario = { mode, pf: spot, answered: false, exam: !!isExam, snap: null, review: replay ? replay.id : null };
    renderPostflopTable(spot);
    renderPostflopControls(spot.options);
  }

  function pfMatchupFor(ip, oop) {
    if (oop) {
      // 3-bet pot: ip = the in-position 3-bettor, oop = the opener who called
      const key = Ranges.vsrfiKey(ip, oop);
      const tb = Ranges.VSRFI[key].threebet;
      return {
        ip, oop, threeBP: true,
        ipRange: tb,
        bbRange: PF.callVs3betRange(Ranges.RFI[oop], tb),
        pot0: PF_3BP.pot, stack0: PF_3BP.stack,
      };
    }
    const key = Ranges.vsrfiKey('BB', ip);
    return { ip, key, ipRange: Ranges.RFI[ip], bbRange: Ranges.VSRFI[key].call, pot0: PF_POT, stack0: PF_STACK };
  }

  function pfOopName(m) { return m.oop || 'BB'; }
  function pfPreTag(m, isIpSeat) {
    if (m.threeBP) return isIpSeat ? `3-BET ${fmtBB(PF_3BP.three)}` : `CALLED ${fmtBB(PF_3BP.three)}`;
    return isIpSeat ? 'RAISED 2.2 bb' : 'CALLED 2.2 bb';
  }
  function pfStory(m) {
    return m.threeBP
      ? `${m.oop} opened, ${m.ip} 3-bet to ${fmtBB(PF_3BP.three)}, ${m.oop} called`
      : `${m.ip} opened 2.2, BB called`;
  }

  // ---- flop-solver spots (c-bet / defend) ----
  let pfWorker = null, pfWorkerBroken = false, pfPendingKey = null, pfPendingCfg = null, pfPendingFn = null;
  const pfCache = new Map();

  function getPfWorker() {
    if (pfWorker || pfWorkerBroken) return pfWorker;
    try {
      pfWorker = new Worker('js/postflop-worker.js?v=20');
      pfWorker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'progress') $('solveFill').style.width = (msg.frac * 100).toFixed(0) + '%';
        else if (msg.type === 'done') onPfSolved(msg.key, msg.solution);
      };
      pfWorker.onerror = () => {
        pfWorkerBroken = true;
        pfWorker = null;
        if (pfPendingCfg) setTimeout(pfSolveSync, 30);
      };
    } catch (e) { pfWorkerBroken = true; pfWorker = null; }
    return pfWorker;
  }

  function pfSolveSync() {
    if (!pfPendingCfg) return;
    const sol = globalThis.GTOPostflopSolver.solveFlop(pfPendingCfg);
    onPfSolved(pfPendingCfg.key, sol);
  }

  function onPfSolved(key, sol) {
    pfCache.set(key, sol);
    if (pfCache.size > 24) pfCache.delete(pfCache.keys().next().value);
    if (key !== pfPendingKey) return;
    pfPendingKey = null;
    pfPendingCfg = null;
    hideSolveOverlay();
    $('solveMsg').textContent = 'Solving Nash equilibrium…';
    if (pfPendingFn) { const f = pfPendingFn; pfPendingFn = null; f(); }
  }

  function pfFlopKey(m, board) {
    return (m.oop ? m.oop + '>' : '') + m.ip + '|' + board.slice().sort((a, b) => a - b).join(',');
  }

  function ensurePfSolved(key, m, board) {
    if (pfCache.has(key)) return true;
    if (key === pfPendingKey) { showSolveOverlay(); return false; } // already solving
    pfPendingKey = key;
    pfPendingCfg = {
      key, ipRange: Array.from(m.ipRange), bbRange: Array.from(m.bbRange),
      board, pot: m.pot0 || PF_POT, stack: m.stack0 || PF_STACK, iterations: 250, runouts: 120,
    };
    $('solveMsg').textContent = `Solving flop (${m.ip} vs ${pfOopName(m)}${m.threeBP ? ', 3-bet pot' : ''})…`;
    showSolveOverlay();
    const w = getPfWorker();
    if (w) w.postMessage(pfPendingCfg);
    else setTimeout(pfSolveSync, 30);
    return false;
  }

  function newPfSolverSpot(mode, isExam, replay) {
    const rp = replay && replay.pf;
    const m = rp ? pfMatchupFor(rp.ip, rp.oop)
      : pfMatchup(isExam ? (Math.random() < 0.35 ? '3bp' : 'srp') : undefined);
    const board = rp ? rp.board : PF.dealBoard(3, []);
    const key = pfFlopKey(m, board);
    if (!ensurePfSolved(key, m, board)) {
      pfPendingFn = () => finishPfSolverSpot(mode, m, board, key, isExam, replay);
      return;
    }
    finishPfSolverSpot(mode, m, board, key, isExam, replay);
  }

  function finishPfSolverSpot(mode, m, board, key, isExam, replay) {
    if (isExam && !exam) return; // exam was abandoned while solving
    const sol = pfCache.get(key);
    if (!sol) { newPfSolverSpot(mode, isExam, replay); return; }
    const rp = replay && replay.pf;
    const AI = 1 + sol.sizes.length;
    const spot = { mode, matchup: m, board, sol, pot: sol.pot, stack: sol.stack, context: '' };

    if (mode === 'pfcbet') {
      if (!sol.ip.length) { newPfSolverSpot(mode); return; }
      spot.heroIsIp = true;
      const idx = rp ? findComboIdx(sol.ip, rp.hand) : pfSampleIdx(sol.ip);
      if (idx < 0) { if (reviewQueue) nextReviewHand(); else newPfSolverSpot(mode); return; }
      spot.comboIdx = idx;
      spot.hand = [sol.ip[idx].c1, sol.ip[idx].c2];
      spot.vilTag = 'CHECK';
      spot.context = m.threeBP
        ? `You 3-bet ${m.ip} vs ${m.oop}'s open — ${m.oop} called and checks (3-bet pot)`
        : `You opened ${m.ip} 2.2, BB called and checks to you`;
      spot.options = [
        { id: 'check', label: 'Check', cls: 'fold' },
        { id: 'bet0', label: `Bet ${fmtBB(sol.bets[0])} (⅓ pot)`, cls: 'threebet' },
        { id: 'bet1', label: `Bet ${fmtBB(sol.bets[1])} (¾ pot)`, cls: 'jam' },
      ];
    } else { // pfdefend
      if (!sol.bb.length) { newPfSolverSpot(mode); return; }
      spot.heroIsIp = false;
      const idx = rp ? findComboIdx(sol.bb, rp.hand) : pfSampleIdx(sol.bb);
      if (idx < 0) { if (reviewQueue) nextReviewHand(); else newPfSolverSpot(mode); return; }
      spot.comboIdx = idx;
      spot.hand = [sol.bb[idx].c1, sol.bb[idx].c2];
      // face the size the solver actually uses more
      const w0 = sol.aggRoot[1], w1 = sol.aggRoot[2];
      spot.sizeIdx = rp ? (rp.sizeIdx || 0)
        : (w0 + w1) < 0.02 ? 0 : (Math.random() * (w0 + w1) < w0 ? 0 : 1);
      const b = sol.bets[spot.sizeIdx];
      spot.vilTag = `BET ${fmtBB(b)}`;
      spot.context = m.threeBP
        ? `You opened ${m.oop}, called ${m.ip}'s 3-bet, checked — they c-bet ${fmtBB(b)} (3-bet pot)`
        : `You defended BB vs ${m.ip}'s 2.2 open, checked — ${m.ip} bets ${fmtBB(b)}`;
      spot.options = [
        { id: 'fold', label: 'Fold', cls: 'fold' },
        { id: 'call', label: `Call ${fmtBB(b)}`, cls: 'call' },
        { id: 'raise', label: `Raise to ${fmtBB(sol.raises[spot.sizeIdx])}`, cls: 'jam' },
      ];
    }
    scenario = { mode, pf: spot, answered: false, exam: !!isExam, snap: null, review: replay ? replay.id : null };
    renderPostflopTable(spot);
    renderPostflopControls(spot.options);
  }

  function pfSampleIdx(combos) {
    let total = 0;
    for (const cb of combos) total += cb.w;
    let r = Math.random() * total;
    for (let i = 0; i < combos.length; i++) { r -= combos[i].w; if (r <= 0) return i; }
    return combos.length - 1;
  }

  // ---- full hand vs the solver (flop → turn → river) ----
  // Each street is solved fresh with Bayes-updated ranges: every observed
  // action multiplies each combo's weight by the probability the solver takes
  // that action with it. Villain actions are sampled from the range-weighted
  // strategy; villain's actual cards are only drawn at showdown.
  let pfHandNonce = 0;

  function findComboIdx(list, hand) {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if ((c.c1 === hand[0] && c.c2 === hand[1]) || (c.c1 === hand[1] && c.c2 === hand[0])) return i;
    }
    return -1;
  }

  function samplePfResp(combos, strat, stride, heroHand) {
    const probs = new Array(stride).fill(0);
    for (let i = 0; i < combos.length; i++) {
      const c = combos[i];
      if (c.w <= 0 || heroHand.includes(c.c1) || heroHand.includes(c.c2)) continue;
      for (let a = 0; a < stride; a++) probs[a] += c.w * strat[i * stride + a];
    }
    let tot = 0;
    for (const p of probs) tot += p;
    if (tot <= 0) return 0;
    let r = Math.random() * tot;
    for (let a = 0; a < stride; a++) { r -= probs[a]; if (r <= 0) return a; }
    return stride - 1;
  }

  function applyBayesCur(spot, side, strat, stride, actIdx) {
    const key = side === 'ip' ? 'curIp' : 'curBb';
    spot[key] = spot[key].map((c, i) =>
      ({ c1: c.c1, c2: c.c2, cls: c.cls, w: c.w * strat[i * stride + actIdx] }));
  }

  function startPfHand() {
    const m = pfMatchup();
    const heroIsIp = Math.random() < 0.5;
    const board = PF.dealBoard(3, []);
    const key = pfFlopKey(m, board);
    const spot = {
      mode: 'pfhand', matchup: m, heroIsIp, board,
      pot: m.pot0, stack: m.stack0, hand: null,
      sol: null, curIp: null, curBb: null, comboIdx: -1,
      node: 'root', sizeIdx: -1, history: [], totalLost: 0,
      finished: false, next: null, vilTag: '', context: '', note: '',
    };
    if (!ensurePfSolved(key, m, board)) {
      pfPendingFn = () => beginPfHandFlop(spot, key);
      return;
    }
    beginPfHandFlop(spot, key);
  }

  function beginPfHandFlop(spot, key) {
    const sol = pfCache.get(key);
    if (!sol || !sol.ip.length || !sol.bb.length) { startPfHand(); return; }
    spot.sol = sol;
    spot.curIp = sol.ip.map(c => ({ c1: c.c1, c2: c.c2, cls: c.cls, w: c.w }));
    spot.curBb = sol.bb.map(c => ({ c1: c.c1, c2: c.c2, cls: c.cls, w: c.w }));
    const mine = spot.heroIsIp ? spot.curIp : spot.curBb;
    const idx = pfSampleIdx(mine);
    spot.hand = [mine[idx].c1, mine[idx].c2];
    scenario = { mode: 'pfhand', pf: spot, answered: true, exam: false, snap: null, review: null };
    beginPfHandStreet(spot);
  }

  function pfStreetName(spot) {
    return ['Flop', 'Turn', 'River'][spot.board.length - 3];
  }
  function pfBetLabel(b, stack) {
    return b >= stack - 0.05 ? `All-in ${fmtBB(b)}` : `Bet ${fmtBB(b)}`;
  }

  function beginPfHandStreet(spot) {
    const sol = spot.sol;
    const street = pfStreetName(spot);
    const pre = spot.note ? spot.note + ' — ' : '';
    spot.note = '';
    spot.node = 'root';
    spot.comboIdx = findComboIdx(spot.heroIsIp ? sol.ip : sol.bb, spot.hand);
    if (spot.comboIdx < 0) { pfHandAdvance(spot, 'checked through'); return; }
    const oopName = pfOopName(spot.matchup);
    if (spot.heroIsIp) {
      spot.vilTag = 'CHECK';
      spot.context = `${pre}${street}: ${oopName} checks — pot ${fmtBB(spot.pot)}, ${fmtBB(spot.stack)} behind`;
      spot.options = [{ id: 'check', label: 'Check', cls: 'fold' },
        { id: 'bet0', label: pfBetLabel(sol.bets[0], sol.stack), cls: 'threebet' }];
      if (sol.bets[1] > sol.bets[0] + 0.05) {
        spot.options.push({ id: 'bet1', label: pfBetLabel(sol.bets[1], sol.stack), cls: 'jam' });
      }
    } else {
      // hero (BB) checks dark; the solver villain acts from its mixed strategy
      const AI = 1 + sol.sizes.length;
      const a = samplePfResp(spot.curIp, sol.ipRoot, AI, spot.hand);
      applyBayesCur(spot, 'ip', sol.ipRoot, AI, a);
      if (a === 0) { pfHandAdvance(spot, `${street.toLowerCase()} checks through`); return; }
      spot.sizeIdx = a - 1;
      const b = sol.bets[spot.sizeIdx];
      spot.node = 'resp';
      spot.vilTag = `BET ${fmtBB(b)}`;
      spot.context = `${pre}${street}: you check, ${spot.matchup.ip} bets ${fmtBB(b)} into ${fmtBB(spot.pot)}`;
      const r = sol.raises[spot.sizeIdx];
      spot.options = [
        { id: 'fold', label: 'Fold', cls: 'fold' },
        { id: 'call', label: `Call ${fmtBB(b)}`, cls: 'call' },
        { id: 'raise', label: r >= sol.stack - 0.05 ? `Raise all-in ${fmtBB(r)}` : `Raise to ${fmtBB(r)}`, cls: 'jam' },
      ];
    }
    scenario.answered = false;
    renderPostflopTable(spot);
    renderPostflopControls(spot.options);
  }

  function answerPfHand(action) {
    const s = scenario;
    if (!s || s.answered || !s.pf || s.pf.finished) return;
    const spot = s.pf, sol = spot.sol;
    s.answered = true;
    $('controls').querySelectorAll('button').forEach(b => b.disabled = true);
    const street = pfStreetName(spot);
    const AI = 1 + sol.sizes.length;
    const i = spot.comboIdx;
    let freqs, evs, aIdx, names;
    if (spot.node === 'root') {
      freqs = [sol.ipRoot[i * AI], sol.ipRoot[i * AI + 1], sol.ipRoot[i * AI + 2]];
      evs = [sol.evIpRoot[i * AI], sol.evIpRoot[i * AI + 1], sol.evIpRoot[i * AI + 2]];
      aIdx = action === 'check' ? 0 : action === 'bet0' ? 1 : 2;
      names = ['check', `bet ${fmtBB(sol.bets[0])}`, `bet ${fmtBB(sol.bets[1])}`];
    } else if (spot.node === 'resp') {
      const sz = spot.sizeIdx, resp = sol.bbResp[sz], evr = sol.evBbResp[sz];
      freqs = [resp[i * 3], resp[i * 3 + 1], resp[i * 3 + 2]];
      evs = [evr[i * 3], evr[i * 3 + 1], evr[i * 3 + 2]];
      aIdx = action === 'fold' ? 0 : action === 'call' ? 1 : 2;
      names = ['fold', 'call', `raise to ${fmtBB(sol.raises[sz])}`];
    } else { // vsraise
      const sz = spot.sizeIdx, v = sol.ipVsR[sz], ev = sol.evIpVsR[sz];
      freqs = [v[i * 2], v[i * 2 + 1]];
      evs = [ev[i * 2], ev[i * 2 + 1]];
      aIdx = action === 'fold' ? 0 : 1;
      names = ['fold', 'call'];
    }
    const best = Math.max(...evs);
    let evLost = Math.max(0, best - evs[aIdx]);
    let verdictCls, verdictTxt;
    if (evLost <= 0.1) { verdictCls = 'good'; verdictTxt = '✓ Correct'; evLost = 0; }
    else if (evLost <= 0.5 || freqs[aIdx] >= 0.25) { verdictCls = 'mixed'; verdictTxt = '≈ Close'; }
    else { verdictCls = 'bad'; verdictTxt = '✗ Mistake'; }
    spot.totalLost += evLost;
    const p0 = (x) => (x * 100).toFixed(0);
    let detail = `${street} — solver plays <b>${pfComboLabel({ c1: spot.hand[0], c2: spot.hand[1] })}</b>: ` +
      names.map((nm, k) => `${nm} <b>${p0(freqs[k])}%</b>`).join(' · ') +
      `<br>EV: ` + names.map((nm, k) => `${nm} <b>${fx1(evs[k])}</b>`).join(' · ') + ' bb' +
      (evLost > 0 ? ` · you lost <b>${evLost.toFixed(2)} bb</b>` : '');
    spot.history.push({ street, act: names[aIdx], v: verdictCls, evLost });

    // stats + log (one entry per decision)
    stats.hands++;
    if (verdictCls === 'good' || verdictCls === 'mixed') stats.correct++;
    else stats.wrong++;
    stats.evLost += evLost;
    const label = GTO.handLabel(GTO.classIdOfCards(spot.hand[0], spot.hand[1]));
    const histId = 'h' + Date.now() + Math.floor(Math.random() * 1000);
    handLog.push({
      id: histId, t: Date.now(), detail: detail.slice(0, 700),
      mode: 'pfhand', heroPos: 0, hand: spot.hand, label, action, v: verdictCls,
      actLabel: names[aIdx],
      evLost: Math.round(evLost * 100) / 100, suffix: 'bb',
      posName: spot.heroIsIp ? spot.matchup.ip : pfOopName(spot.matchup),
      snap: null,
    });
    if (handLog.length > 400) handLog = handLog.slice(-400);
    history.push({ label, v: verdictCls, id: histId });
    history = history.slice(-24);
    saveStats();
    renderHeaderStats();
    renderHistory();

    resolvePfHand(spot, action, detail, verdictCls, verdictTxt);
  }

  // apply consequences of the hero action: sample villain, update ranges,
  // queue the next step, and show the graded feedback
  function resolvePfHand(spot, action, detail, verdictCls, verdictTxt) {
    const sol = spot.sol;
    const AI = 1 + sol.sizes.length;
    const street = pfStreetName(spot);
    let endInfo = null;

    if (spot.node === 'root') {
      if (action === 'check') {
        applyBayesCur(spot, 'ip', sol.ipRoot, AI, 0);
        spot.next = { type: 'advance', note: `${street.toLowerCase()} checks through` };
      } else {
        const sz = action === 'bet0' ? 0 : 1;
        spot.sizeIdx = sz;
        applyBayesCur(spot, 'ip', sol.ipRoot, AI, 1 + sz);
        const rAct = samplePfResp(spot.curBb, sol.bbResp[sz], 3, spot.hand);
        if (rAct === 0) {
          detail += `<br><b>${pfOopName(spot.matchup)} folds</b> — you take the pot (${fmtBB(spot.pot)}).`;
          endInfo = { result: 'win-fold' };
        } else if (rAct === 1) {
          applyBayesCur(spot, 'bb', sol.bbResp[sz], 3, 1);
          spot.pot += 2 * sol.bets[sz];
          spot.stack -= sol.bets[sz];
          detail += `<br>${pfOopName(spot.matchup)} calls ${fmtBB(sol.bets[sz])}.`;
          spot.next = { type: 'advance', note: `BB called the ${street.toLowerCase()}` };
        } else {
          applyBayesCur(spot, 'bb', sol.bbResp[sz], 3, 2);
          detail += `<br><b>${pfOopName(spot.matchup)} check-raises to ${fmtBB(sol.raises[sz])}</b>.`;
          spot.next = { type: 'vsraise' };
        }
      }
    } else if (spot.node === 'resp') {
      const sz = spot.sizeIdx;
      if (action === 'fold') {
        detail += `<br>You fold — ${spot.matchup.ip} takes the pot.`;
        endInfo = { result: 'lose-fold' };
      } else if (action === 'call') {
        applyBayesCur(spot, 'bb', sol.bbResp[sz], 3, 1);
        spot.pot += 2 * sol.bets[sz];
        spot.stack -= sol.bets[sz];
        spot.next = { type: 'advance', note: `you called the ${street.toLowerCase()}` };
      } else {
        applyBayesCur(spot, 'bb', sol.bbResp[sz], 3, 2);
        const vAct = samplePfResp(spot.curIp, sol.ipVsR[sz], 2, spot.hand);
        if (vAct === 0) {
          detail += `<br><b>${spot.matchup.ip} folds</b> — you take the pot (${fmtBB(spot.pot + sol.bets[sz])}).`;
          endInfo = { result: 'win-fold' };
        } else {
          applyBayesCur(spot, 'ip', sol.ipVsR[sz], 2, 1);
          spot.pot += 2 * sol.raises[sz];
          spot.stack -= sol.raises[sz];
          detail += `<br>${spot.matchup.ip} calls your raise.`;
          spot.next = { type: 'advance', note: 'raise called' };
        }
      }
    } else { // vsraise
      const sz = spot.sizeIdx;
      if (action === 'fold') {
        detail += `<br>You fold to the check-raise — BB takes the pot.`;
        endInfo = { result: 'lose-fold' };
      } else {
        applyBayesCur(spot, 'ip', sol.ipVsR[sz], 2, 1);
        spot.pot += 2 * sol.raises[sz];
        spot.stack -= sol.raises[sz];
        detail += `<br>You call the raise.`;
        spot.next = { type: 'advance', note: 'check-raise called' };
      }
    }

    // hands that end now (fold, river action, or all-in) finish in one panel
    const advancing = spot.next && spot.next.type === 'advance';
    if (endInfo) {
      pfHandFinish(spot, detail, endInfo);
      return;
    }
    if (advancing && (spot.board.length >= 5 || spot.stack <= 0.05)) {
      if (spot.board.length < 5) { // all-in: run it out
        while (spot.board.length < 5) {
          spot.board = spot.board.concat(PF.dealBoard(1, spot.board.concat(spot.hand)));
        }
        renderPostflopTable(spot);
        $('controls').querySelectorAll('button').forEach(b => b.disabled = true);
      }
      pfHandFinish(spot, detail, { result: 'showdown' });
      return;
    }
    showPfHandFeedback(verdictCls, verdictTxt, detail, true);
  }

  function showPfHandFeedback(cls, txt, detail, continues) {
    $('btnShowRange').style.display = '';
    $('btnNext').innerHTML = (continues ? 'Continue' : 'Next hand') + ' <kbd>Space</kbd>';
    $('fbVerdict').className = 'verdict ' + cls;
    $('fbVerdict').textContent = txt;
    $('fbDetail').innerHTML = detail;
    $('feedback').classList.add('show');
  }

  function continuePfHand() {
    const spot = scenario && scenario.pf;
    if (!spot || spot.finished) { newHand(); return; }
    const nx = spot.next;
    spot.next = null;
    $('feedback').classList.remove('show');
    if (!nx) { newHand(); return; }
    if (nx.type === 'vsraise') {
      const sz = spot.sizeIdx, r = spot.sol.raises[sz], b = spot.sol.bets[sz];
      spot.node = 'vsraise';
      spot.vilTag = `RAISE ${fmtBB(r)}`;
      spot.context = `${pfStreetName(spot)}: ${pfOopName(spot.matchup)} check-raises your ${fmtBB(b)} to ${fmtBB(r)}`;
      spot.options = [
        { id: 'fold', label: 'Fold', cls: 'fold' },
        { id: 'call', label: `Call ${fmtBB(Math.max(0, r - b))} more`, cls: 'call' },
      ];
      scenario.answered = false;
      renderPostflopTable(spot);
      renderPostflopControls(spot.options);
      return;
    }
    pfHandAdvance(spot, nx.note);
  }

  function pfHandAdvance(spot, note) {
    if (spot.board.length >= 5 || spot.stack <= 0.05) {
      if (spot.board.length < 5) {
        while (spot.board.length < 5) {
          spot.board = spot.board.concat(PF.dealBoard(1, spot.board.concat(spot.hand)));
        }
      }
      renderPostflopTable(spot);
      pfHandFinish(spot, '', { result: 'showdown' });
      return;
    }
    spot.board = spot.board.concat(PF.dealBoard(1, spot.board.concat(spot.hand)));
    spot.note = note || '';
    spot.vilTag = '';
    spot.context = `${pfStreetName(spot)} — solving…`;
    renderPostflopTable(spot);
    // hero's exact combo must survive pruning so we can grade it
    const heroSide = spot.heroIsIp ? 'curIp' : 'curBb';
    const hi = findComboIdx(spot[heroSide], spot.hand);
    if (hi >= 0) spot[heroSide][hi].w = Math.max(spot[heroSide][hi].w, 0.01);
    const cfg = {
      ipCombos: spot.curIp, bbCombos: spot.curBb,
      board: spot.board, pot: spot.pot, stack: spot.stack, iterations: 200,
    };
    const foeKey = spot.heroIsIp ? 'bbCombos' : 'ipCombos';
    cfg[foeKey] = cfg[foeKey].filter(c => !spot.hand.includes(c.c1) && !spot.hand.includes(c.c2));
    const key = 'pfh' + (pfHandNonce++);
    pfPendingKey = key;
    pfPendingCfg = Object.assign({ key }, cfg);
    pfPendingFn = () => {
      const sol = pfCache.get(key);
      if (!sol || !sol.ip.length || !sol.bb.length) { pfHandFinish(spot, '', { result: 'showdown' }); return; }
      spot.sol = sol;
      spot.curIp = sol.ip.map(c => ({ c1: c.c1, c2: c.c2, cls: c.cls, w: c.w }));
      spot.curBb = sol.bb.map(c => ({ c1: c.c1, c2: c.c2, cls: c.cls, w: c.w }));
      beginPfHandStreet(spot);
    };
    $('solveMsg').textContent = `Solving the ${pfStreetName(spot).toLowerCase()}…`;
    showSolveOverlay();
    const w = getPfWorker();
    if (w) w.postMessage(pfPendingCfg);
    else setTimeout(pfSolveSync, 30);
  }

  function pfHandFinish(spot, detail, info) {
    spot.finished = true;
    let resultTxt = '';
    if (info.result === 'showdown') {
      const foe = (spot.heroIsIp ? spot.curBb : spot.curIp).filter(c =>
        c.w > 0.001 && !spot.hand.includes(c.c1) && !spot.hand.includes(c.c2) &&
        !spot.board.includes(c.c1) && !spot.board.includes(c.c2));
      const vilName = spot.heroIsIp ? pfOopName(spot.matchup) : spot.matchup.ip;
      if (foe.length) {
        const vc = pfSampleCombo(foe);
        const hv = PF.eval7(spot.hand[0], spot.hand[1], ...spot.board);
        const vv = PF.eval7(vc.c1, vc.c2, ...spot.board);
        const outcome = hv > vv ? `<b style="color:var(--green)">you win ${fmtBB(spot.pot)}</b>`
          : hv === vv ? 'you chop the pot' : `<b style="color:var(--red)">you lose the pot</b>`;
        resultTxt = `Showdown: ${vilName} shows <b>${pfComboLabel(vc)}</b> — ${outcome}.`;
      } else {
        resultTxt = `${vilName}'s range is empty — you take the pot.`;
      }
    }
    const nDec = spot.history.length;
    const lines = spot.history.map(h =>
      `${h.street}: ${h.act} ${h.v === 'good' ? '✓' : h.v === 'mixed' ? '≈' : '✗'}` +
      (h.evLost > 0 ? ` (−${h.evLost.toFixed(2)})` : '')).join(' · ');
    const cls = spot.totalLost <= 0.15 ? 'good' : spot.totalLost <= 1 ? 'mixed' : 'bad';
    const txt = nDec === 0 ? 'Hand checked through'
      : `Hand complete — EV lost ${spot.totalLost.toFixed(2)} bb over ${nDec} decision${nDec === 1 ? '' : 's'}`;
    const full = (detail ? detail + '<br>' : '') +
      (resultTxt ? resultTxt + '<br>' : '') +
      (lines ? `<span style="opacity:0.8">${lines}</span>` : '');
    showPfHandFeedback(cls, txt, full, false);
  }

  // ---- postflop strategy viewer (13x13 aggregated action mix) ----
  function openPfStrategy() {
    const s = scenario;
    if (!s || !s.pf || !s.pf.sol) return;
    const spot = s.pf, sol = spot.sol;
    const heroCls = spot.hand ? GTO.classIdOfCards(spot.hand[0], spot.hand[1]) : -1;
    const boardTxt = spot.board.map(c => GTO.RANKS[c >> 2] + GTO.SUIT_CHARS[c & 3]).join(' ');
    let combos, strat, stride, actNames, actColors, title;
    if (spot.mode === 'pfdefend' || (spot.mode === 'pfhand' && spot.node === 'resp')) {
      const sz = spot.sizeIdx;
      combos = sol.bb; strat = sol.bbResp[sz]; stride = 3;
      actNames = ['Fold', 'Call', 'Raise'];
      actColors = ['#232b37', 'var(--call)', 'var(--jam)'];
      title = `${pfOopName(spot.matchup)} vs ${fmtBB(sol.bets[sz])} bet · ${boardTxt}`;
    } else if (spot.mode === 'pfhand' && spot.node === 'vsraise') {
      combos = sol.ip; strat = sol.ipVsR[spot.sizeIdx]; stride = 2;
      actNames = ['Fold', 'Call'];
      actColors = ['#232b37', 'var(--call)'];
      title = `${spot.matchup.ip} vs check-raise · ${boardTxt}`;
    } else {
      combos = sol.ip; strat = sol.ipRoot; stride = 1 + sol.sizes.length;
      actNames = ['Check', `Bet ${fmtBB(sol.bets[0])}`, `Bet ${fmtBB(sol.bets[1])}`];
      actColors = ['#46628a', '#d97a2b', 'var(--jam)'];
      title = `${spot.matchup.ip} strategy · ${boardTxt}`;
    }
    const g = pfStrategyGrid(combos, strat, stride, actNames, actColors, heroCls);
    $('rangeTitle').textContent = title;
    $('rangeControls').innerHTML = '';
    $('rangeGrid').innerHTML = g.cells;
    $('legendItems').innerHTML = g.legend;
    $('rangeStats').textContent = g.stats;
    $('rangeModal').classList.add('show');
  }

  // aggregate combo-level postflop strategy into a 13×13 action-mix grid
  function pfStrategyGrid(combos, strat, stride, actNames, actColors, heroCls) {
    const agg = new Array(169).fill(null);
    const overall = new Array(stride).fill(0);
    let overallW = 0;
    combos.forEach((c, i) => {
      const a = agg[c.cls] || (agg[c.cls] = { w: 0, f: new Array(stride).fill(0) });
      a.w += c.w;
      overallW += c.w;
      for (let k = 0; k < stride; k++) {
        a.f[k] += c.w * strat[i * stride + k];
        overall[k] += c.w * strat[i * stride + k];
      }
    });
    let cells = '';
    for (let id = 0; id < 169; id++) {
      const a = agg[id];
      const label = GTO.handLabel(id);
      let style = 'opacity:0.25';
      let tip = `${label}: not in range`;
      if (a && a.w > 0.003) {
        const f = a.f.map(x => x / a.w);
        const stops = [];
        let acc = 0;
        for (let k = stride - 1; k >= 0; k--) {
          const from = acc, to = acc + f[k] * 100;
          stops.push(`${actColors[k]} ${from.toFixed(1)}% ${to.toFixed(1)}%`);
          acc = to;
        }
        style = `background:linear-gradient(to top, ${stops.join(', ')});color:#e8eef6`;
        tip = label + ': ' + actNames.map((nm, k) => `${nm} ${(f[k] * 100).toFixed(0)}%`).join(' · ');
      }
      cells += `<div class="range-cell ${id === heroCls ? 'hl' : ''}" style="${style}" title="${tip}">${label}</div>`;
    }
    return {
      cells,
      legend: actNames.map((nm, k) =>
        `<span class="swatch" style="background:${actColors[k]}"></span>${nm}&nbsp;&nbsp;`).join(''),
      stats: actNames.map((nm, k) =>
        `${nm} ${(overall[k] / (overallW || 1) * 100).toFixed(0)}%`).join(' · '),
    };
  }

  // ---- grading ----
  function answerPostflop(action) {
    const s = scenario;
    if (!s || s.answered || !s.pf) return;
    s.answered = true;
    const spot = s.pf;
    let verdictCls, verdictTxt, detail, evLost = 0, why = '';
    const pct = (x) => (x * 100).toFixed(1);
    const actLabel = (spot.options.find(o => o.id === action) || {}).label || action;

    if (spot.mode === 'pftexture') {
      const eq = spot.eq;
      const truth = eq > 0.52 ? 'raiser' : eq < 0.48 ? 'caller' : 'even';
      const nearEdge = Math.min(Math.abs(eq - 0.52), Math.abs(eq - 0.48)) < 0.015;
      if (action === truth) { verdictCls = 'good'; verdictTxt = '✓ Correct'; }
      else if (nearEdge) { verdictCls = 'mixed'; verdictTxt = '≈ Close — borderline board'; }
      else { verdictCls = 'bad'; verdictTxt = '✗ Mistake'; }
      const mm = spot.matchup;
      const who = eq > 0.5
        ? `${mm.ip}'s ${mm.threeBP ? '3-betting' : 'opening'} range`
        : `${pfOopName(mm)}'s ${mm.threeBP ? 'calling' : 'defending'} range`;
      why = m2Text(eq);
      detail = `${who} has <b>${pct(Math.max(eq, 1 - eq))}%</b> equity on this flop ` +
        `(${mm.threeBP ? '3-bettor' : 'raiser'} ${pct(eq)}% vs caller ${pct(1 - eq)}%).` +
        `<br><span style="opacity:0.8">${why}</span>`;
    } else if (spot.mode === 'pfequity') {
      const eq = spot.eq;
      const bounds = [0.35, 0.50, 0.65];
      const truth = eq < 0.35 ? 0 : eq < 0.50 ? 1 : eq < 0.65 ? 2 : 3;
      const chosen = parseInt(action.slice(1), 10);
      const nearEdge = bounds.some(b => Math.abs(eq - b) < 0.04);
      if (chosen === truth) { verdictCls = 'good'; verdictTxt = '✓ Correct'; }
      else if (Math.abs(chosen - truth) === 1 && nearEdge) { verdictCls = 'mixed'; verdictTxt = '≈ Close'; }
      else { verdictCls = 'bad'; verdictTxt = '✗ Off the mark'; }
      const mq = spot.matchup;
      const vsTxt = spot.heroIsIp
        ? `${pfOopName(mq)} ${mq.threeBP ? 'calling' : 'defending'}`
        : `${mq.ip} ${mq.threeBP ? '3-betting' : 'opening'}`;
      detail = `<b>${pfComboLabel({ c1: spot.hand[0], c2: spot.hand[1] })}</b> has ` +
        `<b>${pct(eq)}%</b> equity vs the ${vsTxt} range here.`;
      why = `The exact number is ${pct(eq)}%.`;
    } else if (spot.mode === 'pfrivercall') {
      const evDiff = spot.eq * (spot.pot + 2 * spot.bet) - spot.bet; // EV(call) − EV(fold), bb
      const truth = evDiff > 0 ? 'call' : 'fold';
      if (action === truth) { verdictCls = 'good'; verdictTxt = '✓ Correct'; }
      else if (Math.abs(evDiff) < 0.35) { verdictCls = 'mixed'; verdictTxt = '≈ Close — thin either way'; }
      else { verdictCls = 'bad'; verdictTxt = '✗ Mistake'; evLost = Math.abs(evDiff); }
      why = `You need ${pct(spot.need)}% and have ${pct(spot.eq)}% vs the stated jam model — ` +
        `${truth === 'call' ? 'calling' : 'folding'} is right by ${Math.abs(evDiff).toFixed(2)} bb.`;
      detail = `You need <b>${pct(spot.need)}%</b> equity (calling ${fmtBB(spot.bet)} to win ${fmtBB(spot.pot + spot.bet)}). ` +
        `Vs the stated jam range you have <b>${pct(spot.eq)}%</b>` +
        ` · EV(call) − EV(fold) = <b>${fx1(evDiff)} bb</b>` +
        (evLost > 0 ? ` · you lost <b>${evLost.toFixed(2)} bb</b>` : '') +
        `<br><span style="opacity:0.8">Villain model: top ${Math.round(spot.valuePct * 100)}% of ` +
        `${spot.matchup.ip}'s range for value + bottom ${Math.round(spot.bluffPct * 100)}% as bluffs — a stated model, not a solve</span>`;
    } else if (spot.mode === 'pfcbet') {
      const sol = spot.sol, AI = 1 + sol.sizes.length, i = spot.comboIdx;
      const freqs = [sol.ipRoot[i * AI], sol.ipRoot[i * AI + 1], sol.ipRoot[i * AI + 2]];
      const evs = [sol.evIpRoot[i * AI], sol.evIpRoot[i * AI + 1], sol.evIpRoot[i * AI + 2]];
      const aIdx = action === 'check' ? 0 : action === 'bet0' ? 1 : 2;
      const best = Math.max(...evs);
      evLost = Math.max(0, best - evs[aIdx]);
      if (evLost <= 0.1) { verdictCls = 'good'; verdictTxt = '✓ Correct'; evLost = 0; }
      else if (evLost <= 0.5 || freqs[aIdx] >= 0.25) { verdictCls = 'mixed'; verdictTxt = '≈ Close'; }
      else { verdictCls = 'bad'; verdictTxt = '✗ Mistake'; }
      const p0 = (x) => (x * 100).toFixed(0);
      const bestIdx = evs.indexOf(best);
      const acts = ['checking', `the ${fmtBB(sol.bets[0])} bet`, `the ${fmtBB(sol.bets[1])} bet`];
      why = `The solver's main line with this combo is ${acts[bestIdx]} (${p0(freqs[bestIdx])}%) — ` +
        `your choice gives up ${evLost.toFixed(2)} bb against a balanced defence.`;
      detail = `Solver plays <b>${pfComboLabel({ c1: spot.hand[0], c2: spot.hand[1] })}</b>: ` +
        `check <b>${p0(freqs[0])}%</b> · bet ${fmtBB(sol.bets[0])} <b>${p0(freqs[1])}%</b> · bet ${fmtBB(sol.bets[1])} <b>${p0(freqs[2])}%</b>` +
        `<br>EV: check <b>${fx1(evs[0])}</b> · small <b>${fx1(evs[1])}</b> · big <b>${fx1(evs[2])}</b> bb` +
        (evLost > 0 ? ` · you lost <b>${evLost.toFixed(2)} bb</b>` : '') +
        `<br><span style="opacity:0.8">Range c-bets ${p0(sol.aggRoot[1])}% small + ${p0(sol.aggRoot[2])}% big overall on this flop</span>`;
    } else { // pfdefend
      const sol = spot.sol, i = spot.comboIdx, sIdx = spot.sizeIdx;
      const resp = sol.bbResp[sIdx], evr = sol.evBbResp[sIdx];
      const freqs = [resp[i * 3], resp[i * 3 + 1], resp[i * 3 + 2]];
      const evs = [evr[i * 3], evr[i * 3 + 1], evr[i * 3 + 2]];
      const aIdx = action === 'fold' ? 0 : action === 'call' ? 1 : 2;
      const best = Math.max(...evs);
      evLost = Math.max(0, best - evs[aIdx]);
      if (evLost <= 0.1) { verdictCls = 'good'; verdictTxt = '✓ Correct'; evLost = 0; }
      else if (evLost <= 0.5 || freqs[aIdx] >= 0.25) { verdictCls = 'mixed'; verdictTxt = '≈ Close'; }
      else { verdictCls = 'bad'; verdictTxt = '✗ Mistake'; }
      const p0 = (x) => (x * 100).toFixed(0);
      const b = sol.bets[sIdx];
      const mdf = spot.pot / (spot.pot + b);
      const bestIdx = evs.indexOf(best);
      const acts = ['folding', 'calling', 'raising'];
      why = `Facing ${fmtBB(b)} into ${fmtBB(spot.pot)}, this combo's main line is ` +
        `${acts[bestIdx]} (${p0(freqs[bestIdx])}%) — your choice costs ${evLost.toFixed(2)} bb.`;
      detail = `Solver plays <b>${pfComboLabel({ c1: spot.hand[0], c2: spot.hand[1] })}</b>: ` +
        `fold <b>${p0(freqs[0])}%</b> · call <b>${p0(freqs[1])}%</b> · raise <b>${p0(freqs[2])}%</b>` +
        `<br>EV: fold <b>0</b> · call <b>${fx1(evs[1])}</b> · raise <b>${fx1(evs[2])}</b> bb` +
        (evLost > 0 ? ` · you lost <b>${evLost.toFixed(2)} bb</b>` : '') +
        `<br><span style="opacity:0.8">MDF vs ${fmtBB(b)} into ${fmtBB(spot.pot)} ≈ ${p0(mdf)}% — ` +
        `range defends ${p0(sol.aggBB[sIdx][1] + sol.aggBB[sIdx][2])}% here</span>`;
    }

    // stats + log (postflop mistakes are excluded from Review replay)
    stats.hands++;
    if (verdictCls === 'good' || verdictCls === 'mixed') stats.correct++;
    else stats.wrong++;
    stats.evLost += evLost;
    const label = spot.hand
      ? GTO.handLabel(GTO.classIdOfCards(spot.hand[0], spot.hand[1]))
      : spot.board.slice(0, 3).map(c => GTO.RANKS[c >> 2]).join('');
    let histId;
    if (s.review) {
      const entry = handLog.find(x => x.id === s.review);
      if (entry && (verdictCls === 'good' || verdictCls === 'mixed')) entry.fixed = true;
      histId = s.review;
      detail += `<br><span style="opacity:0.8">Review · ${remainingMistakes().length} mistake${remainingMistakes().length === 1 ? '' : 's'} left</span>`;
    } else {
      histId = 'h' + Date.now() + Math.floor(Math.random() * 1000);
      handLog.push({
        id: histId, t: Date.now(), detail: detail.slice(0, 700),
        mode: spot.mode, heroPos: 0, hand: spot.hand || [0, 1], label, action, v: verdictCls,
        actLabel,
        evLost: Math.round(evLost * 100) / 100, suffix: 'bb',
        posName: spot.heroIsIp ? spot.matchup.ip : pfOopName(spot.matchup),
        snap: null,
        pf: { // enough to re-deal this exact spot in Review
          m: spot.mode, ip: spot.matchup.ip, oop: spot.matchup.oop, board: spot.board, hand: spot.hand,
          heroIsIp: spot.heroIsIp, sizeIdx: spot.sizeIdx,
          pot: spot.pot, bet: spot.bet, valuePct: spot.valuePct, bluffPct: spot.bluffPct,
        },
      });
      if (handLog.length > 400) handLog = handLog.slice(-400);
    }
    history.push({ label, v: verdictCls, id: histId });
    history = history.slice(-24);
    saveStats();
    renderHeaderStats();
    renderHistory();

    $('controls').querySelectorAll('button').forEach(b => b.disabled = true);

    // exam hands: record the result and auto-advance, feedback withheld
    if (s.exam && exam) {
      exam.results.push({
        i: exam.idx, label, v: verdictCls, mode: spot.mode,
        evLost: Math.round(evLost * 100) / 100,
        spot: `<b>${label}</b> · ${spot.heroIsIp ? spot.matchup.ip : pfOopName(spot.matchup)} · ${MODE_LABELS[spot.mode]}`,
        actionLabel: actLabel,
        why: verdictCls === 'bad' ? why : '',
        detail,
      });
      exam.idx++;
      setTimeout(() => {
        if (!exam) return;
        if (exam.idx >= exam.total) finishExam();
        else examDeal();
      }, 350);
      return;
    }

    // solver drills expose the full-board strategy grid
    $('btnShowRange').style.display = (spot.mode === 'pfcbet' || spot.mode === 'pfdefend') ? '' : 'none';
    $('btnNext').innerHTML = 'Next hand <kbd>Space</kbd>';
    $('fbVerdict').className = 'verdict ' + verdictCls;
    $('fbVerdict').textContent = verdictTxt;
    $('fbDetail').innerHTML = detail;
    $('feedback').classList.add('show');
  }

  function m2Text(eq) {
    if (eq > 0.56) return 'Boards with big cards hit the opener\'s range — expect lots of betting.';
    if (eq > 0.52) return 'The raiser keeps an edge, but not enough to bet everything.';
    if (eq < 0.44) return 'Low, connected boards smash the caller\'s range — the raiser should slow down.';
    if (eq < 0.48) return 'This texture leans toward the defender — check back more.';
    return 'Neither range clearly owns this board — expect mixed, smaller betting.';
  }

  // ---------------- quick-drill presets ----------------
  const PRESETS = [
    { label: '📝 Start exam', cls: 'exam', patch: { mode: 'exam' } },
    { label: 'Short-stack UTG', patch: { mode: 'pushfold', players: 9, sbChips: 500, bbChips: 1000, stacksText: '8000', heroPos: '0', anteMode: 'bb', anteChips: 1000, evFormat: 'chip' } },
    { label: 'BB call vs jam', patch: { mode: 'callvjam', players: 9, sbChips: 500, bbChips: 1000, stacksText: '8000', heroPos: '8', anteMode: 'bb', anteChips: 1000, evFormat: 'chip' } },
    { label: '20bb open tree', patch: { mode: 'opentree', players: 6, sbChips: 500, bbChips: 1000, stacksText: '20000', heroPos: 'random', anteMode: 'bb', anteChips: 1000, evFormat: 'chip' } },
    { label: 'Reshove vs open', patch: { mode: 'vsopen', players: 6, sbChips: 500, bbChips: 1000, stacksText: '20000', heroPos: 'random', anteMode: 'bb', anteChips: 1000, evFormat: 'chip' } },
    { label: 'Deep call vs raise', patch: { mode: 'vsrfi', players: 9, sbChips: 500, bbChips: 1000, stacksText: '50000', heroPos: 'random', anteMode: 'bb', anteChips: 1000, evFormat: 'chip' } },
    { label: 'Bubble ICM', patch: { mode: 'pushfold', players: 4, sbChips: 500, bbChips: 1000, stacksText: '20000, 20000, 20000, 4000', heroPos: 'random', anteMode: 'bb', anteChips: 1000, evFormat: 'icm', payoutsText: '50, 30, 20' } },
  ];

  // 20-minute MTT blind structure on a 10k starting stack — early levels play
  // deep (chart territory), late levels collapse into the jam/fold zone
  const START_STACK = 10000;
  const LEVELS = [
    { sb: 25, bb: 50, ante: 0 },
    { sb: 50, bb: 100, ante: 0 },
    { sb: 75, bb: 150, ante: 150 },
    { sb: 100, bb: 200, ante: 200 },
    { sb: 150, bb: 300, ante: 300 },
    { sb: 200, bb: 400, ante: 400 },
    { sb: 250, bb: 500, ante: 500 },
    { sb: 300, bb: 600, ante: 600 },
    { sb: 400, bb: 800, ante: 800 },
    { sb: 500, bb: 1000, ante: 1000 },
    { sb: 700, bb: 1400, ante: 1400 },
    { sb: 1000, bb: 2000, ante: 2000 },
  ];

  const PF_LIST = ['pfhand', 'pfcbet', 'pfdefend', 'pftexture', 'pfequity', 'pfrivercall'];

  // preflop drill taxonomy: spots grouped by stack depth, so picking a drill
  // also configures a table depth that makes sense for it
  const PRE_CATS = [
    { id: 'auto', label: '✨ Auto', modes: ['auto'] },
    { id: 'short', label: '🔥 Short ≤15bb', modes: ['pushfold', 'callvjam'], stacks: '10000', band: [1, 15] },
    { id: 'mid', label: '⚔️ Mid 15–30bb', modes: ['opentree', 'vsopen', 'vs3bet'], stacks: '25000', band: [16, 30] },
    { id: 'deep', label: '🌊 Deep 40bb+', modes: ['rfi', 'vsrfi'], stacks: '50000', band: [40, 9999] },
    { id: 'quiz', label: '🎨 Range quiz', modes: ['builder'] },
  ];

  function preCatOf(mode) {
    return PRE_CATS.find(c => c.modes.includes(mode)) || null;
  }

  function heroDepthBB() {
    const first = parseFloat(String(settings.stacksText).split(',')[0]);
    return isNaN(first) ? 10 : first / Math.max(1, settings.bbChips);
  }

  function pickPreflopDrill(mode) {
    const cat = preCatOf(mode);
    settings.mode = mode;
    // if the current table depth doesn't fit the drill, move to its home depth
    if (cat && cat.band) {
      const d = heroDepthBB();
      if (d < cat.band[0] || d > cat.band[1]) settings.stacksText = cat.stacks;
    }
    saveJson('gto_settings', settings);
    scenario = null;
    reviewQueue = null;
    exam = null;
    renderNav();
    newHand();
  }

  function currentSection() {
    if (settings.mode === 'exam') return 'exam';
    if (settings.mode === 'explore') return 'explore';
    if (PF_MODES.has(settings.mode)) return 'postflop';
    return 'preflop';
  }

  // top-level navigation: section tabs + a contextual quick bar
  function renderNav() {
    const sec = currentSection();
    $('sectionTabs').innerHTML = [
      ['preflop', '♠ Preflop'], ['postflop', '🃏 Postflop'], ['explore', '🔍 Explore'], ['exam', '📝 Exam'],
    ].map(([id, label]) =>
      `<button class="tab${sec === id ? ' on' : ''}" data-sec="${id}">${label}</button>`).join('');
    $('sectionTabs').querySelectorAll('.tab').forEach(b =>
      b.addEventListener('click', () => switchSection(b.dataset.sec)));

    if (sec === 'explore') {
      $('quickBar').innerHTML = '';
      return;
    }

    if (sec === 'postflop') {
      const pt = settings.pfPot === '3bp';
      const chip = (m) =>
        `<button class="qchip${settings.mode === m ? ' on' : ''}" data-pfmode="${m}">${MODE_LABELS[m]}</button>`;
      $('quickBar').innerHTML =
        `<div class="q-row"><span class="qlabel">Play</span>${chip('pfhand')}` +
        `<button class="qchip" id="qPotType" title="Toggle pot type">⇄ ${pt ? '3-bet pot' : 'Single-raised'}</button></div>` +
        `<div class="q-row"><span class="qlabel">Flop</span>${chip('pfcbet')}${chip('pfdefend')}</div>` +
        `<div class="q-row"><span class="qlabel">Quiz</span>${chip('pftexture')}${chip('pfequity')}${chip('pfrivercall')}</div>`;
      $('qPotType').addEventListener('click', () => {
        settings.pfPot = settings.pfPot === '3bp' ? 'srp' : '3bp';
        saveJson('gto_settings', settings);
        scenario = null;
        renderNav();
        newHand();
      });
      $('quickBar').querySelectorAll('[data-pfmode]').forEach(b => {
        b.addEventListener('click', () => {
          settings.mode = b.dataset.pfmode;
          settings.lastPfMode = settings.mode;
          saveJson('gto_settings', settings);
          scenario = null;
          reviewQueue = null;
          exam = null;
          renderNav();
          newHand();
        });
      });
      return;
    }

    // two-level picker: depth category → drills within it
    const activeCat = preCatOf(settings.mode);
    let bar = `<div class="q-row">` + PRE_CATS.map(c =>
      `<button class="qchip cat${activeCat && activeCat.id === c.id ? ' on' : ''}" data-cat="${c.id}">${c.label}</button>`).join('') +
      `</div>`;
    if (activeCat && activeCat.modes.length > 1) {
      bar += `<div class="q-row">` + activeCat.modes.map(mm =>
        `<button class="qchip${settings.mode === mm ? ' on' : ''}" data-premode="${mm}">${MODE_LABELS[mm]}</button>`).join('') +
        `</div>`;
    }
    const drillOpts = PRESETS.map((p, i) => i === 0 ? '' :
      `<option value="${i}">${p.label}</option>`).join('');
    const curLevel = LEVELS.findIndex(l =>
      l.sb === settings.sbChips && l.bb === settings.bbChips &&
      String(settings.stacksText).trim() === String(START_STACK));
    const levelOpts = LEVELS.map((l, i) => {
      const depth = Math.round(START_STACK / l.bb * 10) / 10;
      return `<option value="${i}"${i === curLevel ? ' selected' : ''}>` +
        `Level ${i + 1} · ${l.sb}/${l.bb}${l.ante ? ' +ante' : ''} · ${depth} bb deep</option>`;
    }).join('');
    bar += `<div class="q-row">` +
      `<select class="qsel" id="qDrill"><option value="">💰 Scenarios…</option>${drillOpts}</select>` +
      `<select class="qsel" id="qLevel"><option value="">🕒 Blind level (20-min · 10k)…</option>${levelOpts}</select>` +
      `</div>`;
    $('quickBar').innerHTML = bar;
    $('quickBar').querySelectorAll('[data-cat]').forEach(b => {
      b.addEventListener('click', () => {
        const cat = PRE_CATS.find(c => c.id === b.dataset.cat);
        if (activeCat && activeCat.id === cat.id) return; // already there
        pickPreflopDrill(cat.modes[0]);
      });
    });
    $('quickBar').querySelectorAll('[data-premode]').forEach(b => {
      b.addEventListener('click', () => {
        if (settings.mode !== b.dataset.premode) pickPreflopDrill(b.dataset.premode);
      });
    });
    $('qDrill').addEventListener('change', () => {
      const i = parseInt($('qDrill').value, 10);
      if (!isNaN(i)) applyPreset(i);
    });
    $('qLevel').addEventListener('change', () => {
      const i = parseInt($('qLevel').value, 10);
      if (!isNaN(i)) applyLevel(i);
    });
  }

  function switchSection(sec) {
    if (exam) {
      // an exam is live — confirm before abandoning it
      if (sec !== 'exam') $('exitExamModal').classList.add('show');
      return;
    }
    if (sec === currentSection() && scenario && sec !== 'exam') return;
    if (sec === 'exam') {
      settings.mode = 'exam';
      saveJson('gto_settings', settings);
      scenario = null;
      reviewQueue = null;
      renderNav();
      startExam();
      return;
    }
    settings.mode = sec === 'postflop' ? (settings.lastPfMode || 'pfcbet')
      : sec === 'explore' ? 'explore' : 'auto';
    saveJson('gto_settings', settings);
    scenario = null;
    reviewQueue = null;
    renderNav();
    newHand();
  }

  function applyPreset(i) {
    Object.assign(settings, PRESETS[i].patch);
    saveJson('gto_settings', settings);
    scenario = null;
    reviewQueue = null;
    exam = null;
    renderNav(); // resync the level dropdown with the new stakes
    newHand();
  }

  function applyLevel(i) {
    const l = LEVELS[i];
    Object.assign(settings, {
      sbChips: l.sb, bbChips: l.bb,
      anteMode: l.ante ? 'bb' : 'none', anteChips: l.ante,
      stacksText: String(START_STACK),
      mode: 'auto', // the depth at this level decides the drill
    });
    saveJson('gto_settings', settings);
    scenario = null;
    reviewQueue = null;
    exam = null;
    renderNav();
    newHand();
  }

  // ---------------- spot explorer ----------------
  // GTO-Wizard-style browser: configure any table (players, per-seat depths in
  // bb, antes, open size, EV model), click in each player's action, and see
  // the acting player's full strategy chart from the solver's raise tree.
  let explorer = loadJson('gto_explorer', {
    sub: 'pre', // 'pre' (preflop spots) | 'post' (postflop spots)
    players: 6, stacksText: '25', anteMode: 'bb', openSize: 2.2, evFormat: 'chip', actions: [],
    pfPotType: 'srp', pfIp: 'BTN', pfPair: 'CO,BTN', pfBoardText: '',
    pfStreets: [{ acts: [] }], // [{card?, acts:[tokens]}] — first street's cards come from pfBoardText
  });

  function saveExplorer() { saveJson('gto_explorer', explorer); }

  function explorerCfg() {
    const n = explorer.players;
    const parts = String(explorer.stacksText).split(',')
      .map(s => parseFloat(s.trim())).filter(x => !isNaN(x) && x > 0);
    const stacks = [];
    for (let i = 0; i < n; i++) {
      stacks.push(Math.max(1, Math.min(200, parts.length ? parts[Math.min(i, parts.length - 1)] : 25)));
    }
    let icm = null, pko = null;
    if (explorer.evFormat === 'icm') {
      const payouts = String(settings.payoutsText).split(',')
        .map(s => parseFloat(s.trim())).filter(x => !isNaN(x) && x > 0);
      if (payouts.length) icm = { payouts };
    } else if (explorer.evFormat === 'pko') {
      const bp = String(settings.bountiesText).split(',')
        .map(s => parseFloat(s.trim())).filter(x => !isNaN(x) && x >= 0);
      if (bp.length) {
        const bounties = [];
        for (let i = 0; i < n; i++) bounties.push(bp[Math.min(i, bp.length - 1)]);
        pko = { bounties, fraction: settings.bountyFraction };
      }
    }
    return {
      n, stacks,
      anteMode: explorer.anteMode,
      ante: explorer.anteMode === 'none' ? 0 : explorer.anteMode === 'bb' ? 1 : 0.125,
      sb: 0.5,
      posNames: GTO.POSITION_NAMES[n],
      icm, pko,
      openSize: parseFloat(explorer.openSize) || 2.2,
    };
  }

  // Walk the action history → who opened/jammed/reshoved and whose chart to show.
  function explorerSpot(cfg) {
    const acts = explorer.actions;
    let opener = -1, jammer = -1, reshover = -1, chartSeat = -1;
    for (let i = 0; i < cfg.n; i++) {
      if (reshover >= 0) break; // action is back on the opener
      const a = acts[i];
      if (!a) { chartSeat = i; break; }
      if (a === 'open') opener = i;
      else if (a === 'jam') { if (opener >= 0) reshover = i; else jammer = i; }
    }
    if (reshover >= 0) return { type: 'c3bv', pos: opener, vs: reshover, opener, jammer, reshover };
    if (chartSeat < 0) return { type: 'walk', opener, jammer, reshover };
    if (jammer >= 0) return { type: 'call', pos: chartSeat, vs: jammer, opener, jammer, reshover };
    if (opener >= 0) return { type: 'rshv', pos: chartSeat, vs: opener, opener, jammer, reshover };
    if (chartSeat === cfg.n - 1) return { type: 'walk', opener, jammer, reshover };
    return { type: 'open', pos: chartSeat, opener, jammer, reshover };
  }

  // allowed actions for seat i given everything assigned before it
  function explorerAllowed(cfg, i) {
    let opener = -1, jammer = -1, reshover = -1;
    for (let k = 0; k < i; k++) {
      const a = explorer.actions[k];
      if (a === 'open') opener = k;
      else if (a === 'jam') { if (opener >= 0) reshover = k; else jammer = k; }
    }
    if (reshover >= 0) return []; // hand is heads-up back on the opener
    if (jammer >= 0) return ['fold'];
    if (opener >= 0) return ['fold', 'jam'];
    if (i === cfg.n - 1) return []; // folded to the BB = walk
    return ['fold', 'open', 'jam'];
  }

  function explorerAct(i, a) {
    for (let k = 0; k < i; k++) if (!explorer.actions[k]) explorer.actions[k] = 'fold';
    if (explorer.actions[i] === a) {
      explorer.actions.length = i; // tap again to undo from this seat on
    } else {
      explorer.actions[i] = a;
      explorer.actions.length = i + 1;
    }
    saveExplorer();
    renderExplorer();
  }

  function showExplorer() {
    $('tableWrap').style.display = 'none';
    $('controls').innerHTML = '';
    $('feedback').classList.remove('show');
    if ($('builderPanel')) $('builderPanel').style.display = 'none';
    $('histDetail').style.display = 'none';
    $('explorePanel').style.display = '';
    $('quickBar').style.display = '';
    updateExamProgress();
    renderExplorer();
  }

  function renderExplorer() {
    if (settings.mode !== 'explore') return; // stale solve continuation
    $('xSub').innerHTML =
      `<div class="seg"><button data-v="pre" class="${explorer.sub !== 'post' ? 'on' : ''}">♠ Preflop spots</button>` +
      `<button data-v="post" class="${explorer.sub === 'post' ? 'on' : ''}">🃏 Postflop spots</button></div>`;
    $('xSub').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      explorer.sub = b.dataset.v;
      saveExplorer();
      renderExplorer();
    }));
    if (explorer.sub === 'post') { renderExplorerPost(); return; }
    const cfg = explorerCfg();
    if (explorer.actions.length > cfg.n) explorer.actions.length = 0;

    // config controls
    const playersOpts = [2, 3, 4, 5, 6, 7, 8, 9].map(p =>
      `<option value="${p}"${explorer.players === p ? ' selected' : ''}>${p}-max</option>`).join('');
    const sizeOpts = [2.0, 2.2, 2.5, 3.0].map(sz =>
      `<option value="${sz}"${parseFloat(explorer.openSize) === sz ? ' selected' : ''}>${sz}x open</option>`).join('');
    $('xConfig').innerHTML =
      `<select id="xPlayers">${playersOpts}</select>` +
      `<input type="text" id="xStacks" value="${explorer.stacksText}" title="Stacks in bb — one value or per-seat CSV (UTG first)">` +
      `<div class="seg" id="xAnte">` +
      `<button data-v="none" class="${explorer.anteMode === 'none' ? 'on' : ''}">No ante</button>` +
      `<button data-v="bb" class="${explorer.anteMode === 'bb' ? 'on' : ''}">BB ante</button>` +
      `<button data-v="classic" class="${explorer.anteMode === 'classic' ? 'on' : ''}">Classic</button></div>` +
      `<select id="xSize">${sizeOpts}</select>` +
      `<div class="seg" id="xEv">` +
      `<button data-v="chip" class="${explorer.evFormat === 'chip' ? 'on' : ''}">Chip</button>` +
      `<button data-v="icm" class="${explorer.evFormat === 'icm' ? 'on' : ''}">ICM</button>` +
      `<button data-v="pko" class="${explorer.evFormat === 'pko' ? 'on' : ''}">PKO</button></div>` +
      `<button class="btn" id="xReset">Reset actions</button>`;
    $('xPlayers').addEventListener('change', () => {
      explorer.players = parseInt($('xPlayers').value, 10);
      explorer.actions = [];
      saveExplorer(); renderExplorer();
    });
    $('xStacks').addEventListener('change', () => {
      explorer.stacksText = $('xStacks').value;
      saveExplorer(); renderExplorer();
    });
    $('xSize').addEventListener('change', () => {
      explorer.openSize = parseFloat($('xSize').value);
      saveExplorer(); renderExplorer();
    });
    $('xAnte').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      explorer.anteMode = b.dataset.v;
      saveExplorer(); renderExplorer();
    }));
    $('xEv').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      explorer.evFormat = b.dataset.v;
      saveExplorer(); renderExplorer();
    }));
    $('xReset').addEventListener('click', () => {
      explorer.actions = [];
      saveExplorer(); renderExplorer();
    });

    const spot = explorerSpot(cfg);

    // seat strip
    const ACT_LABEL = { fold: 'Fold', open: `${cfg.openSize}x`, jam: 'Jam' };
    let seatsHtml = '';
    for (let i = 0; i < cfg.n; i++) {
      const allowed = explorerAllowed(cfg, i);
      const chosen = explorer.actions[i] || null;
      const isChart = spot.pos === i && spot.type !== 'walk';
      const cls = ['xseat'];
      if (isChart) cls.push('act');
      if (chosen === 'fold') cls.push('dim');
      seatsHtml += `<div class="${cls.join(' ')}">` +
        `<div class="xs-name">${cfg.posNames[i]} <span class="xs-stack">${cfg.stacks[i]} bb</span></div>` +
        (isChart ? `<div class="xs-turn">to act ▾</div>` : '') +
        `<div class="xs-btns">` +
        allowed.map(a =>
          `<button class="xs-btn ${a}${chosen === a ? ' on' : ''}" data-seat="${i}" data-act="${a}">${ACT_LABEL[a]}</button>`).join('') +
        (allowed.length === 0 && !isChart ? '<span class="xs-none">—</span>' : '') +
        `</div></div>`;
    }
    $('xSeats').innerHTML = seatsHtml;
    $('xSeats').querySelectorAll('.xs-btn').forEach(b =>
      b.addEventListener('click', () => explorerAct(parseInt(b.dataset.seat, 10), b.dataset.act)));

    // chart
    const grid = $('xGrid');
    const unit = evUnit(cfg);
    const tag = (cfg.icm ? ' · ICM' : '') + (cfg.pko ? ' · PKO' : '');
    if (spot.type === 'walk') {
      $('xTitle').textContent = spot.jammer >= 0
        ? `Everyone folds — ${cfg.posNames[spot.jammer]}'s jam takes the pot.`
        : spot.opener >= 0
          ? `Everyone folds — ${cfg.posNames[spot.opener]}'s open takes the pot.`
          : 'Folded to the BB — no decision left. Reset or change an action.';
      grid.innerHTML = '';
      $('xLegend').innerHTML = '';
      $('xStats').textContent = '';
      $('xNote').textContent = '';
      return;
    }
    const sol = getSolution(cfg, 'raise');
    if (!sol) {
      pendingFn = renderExplorer;
      ensureSolved(cfg, 'raise');
      $('xTitle').textContent = 'Solving this spot…';
      grid.innerHTML = `<div style="grid-column:1/-1;padding:30px;text-align:center;color:var(--text-dim)">` +
        `Solving Nash equilibrium for your exact stacks…</div>`;
      $('xLegend').innerHTML = '';
      $('xStats').textContent = '';
      return;
    }

    let freqs = null, freqs2 = null, evs = null, evs2 = null, aggr = 'Jam', aggr2 = null, title = '';
    const color2 = '#d97a2b';
    const names = cfg.posNames;
    if (spot.type === 'open') {
      freqs = sol.push[spot.pos]; evs = sol.evPush[spot.pos];
      freqs2 = sol.open[spot.pos]; evs2 = sol.evOpen[spot.pos];
      aggr = 'Jam'; aggr2 = `Raise ${cfg.openSize}x`;
      title = `${names[spot.pos]} first-in strategy · ${cfg.stacks[spot.pos]} bb`;
    } else if (spot.type === 'rshv') {
      freqs = sol.rsh[spot.pos] && sol.rsh[spot.pos][spot.vs];
      evs = sol.evRsh[spot.pos] && sol.evRsh[spot.pos][spot.vs];
      aggr = 'Reshove';
      title = `${names[spot.pos]} vs ${names[spot.vs]}'s ${cfg.openSize}x open · reshove-jam or fold`;
    } else if (spot.type === 'call') {
      freqs = sol.call[spot.pos] && sol.call[spot.pos][spot.vs];
      evs = sol.evCall[spot.pos] && sol.evCall[spot.pos][spot.vs];
      aggr = 'Call';
      title = `${names[spot.pos]} vs ${names[spot.vs]}'s ${cfg.stacks[spot.vs]} bb jam · call or fold`;
    } else { // c3bv
      freqs = sol.c3b[spot.pos] && sol.c3b[spot.pos][spot.vs];
      evs = sol.evC3b[spot.pos] && sol.evC3b[spot.pos][spot.vs];
      aggr = 'Call';
      title = `${names[spot.pos]} opened ${cfg.openSize}x, ${names[spot.vs]} jammed ${cfg.stacks[spot.vs]} bb · call or fold`;
    }
    $('xTitle').textContent = title + tag;
    if (!freqs) {
      grid.innerHTML = `<div style="grid-column:1/-1;padding:30px;text-align:center;color:var(--text-dim)">No strategy for this pairing.</div>`;
      $('xLegend').innerHTML = ''; $('xStats').textContent = ''; $('xNote').textContent = '';
      return;
    }

    let legend = `<span class="swatch" style="background:var(--jam)"></span>${aggr}`;
    if (aggr2) legend += ` &nbsp; <span class="swatch" style="background:${color2}"></span>${aggr2}`;
    legend += ` &nbsp; <span class="swatch" style="background:var(--fold-cell)"></span>Fold`;
    $('xLegend').innerHTML = legend;

    let cells = '';
    for (let id = 0; id < 169; id++) {
      const f = freqs[id];
      const f2 = freqs2 ? freqs2[id] : 0;
      const label = GTO.handLabel(id);
      const pct = Math.round(f * 100);
      const pct2 = Math.round(Math.min(100, (f + f2) * 100));
      let style = '';
      if (f >= 0.995) style = `background:var(--jam);color:#fff`;
      else if (f2 > 0.005 && f + f2 >= 0.995) style = `background:linear-gradient(to top, var(--jam) ${pct}%, ${color2} ${pct}%);color:#fff`;
      else if (f > 0.005 || f2 > 0.005) {
        style = `background:linear-gradient(to top, var(--jam) ${pct}%, ` +
          (f2 > 0.005 ? `${color2} ${pct}%, ${color2} ${pct2}%, ` : '') +
          `var(--fold-cell) ${pct2}%);color:#dfe6ef`;
      }
      let tip = `${label}: ${aggr.toLowerCase()} ${pct}%`;
      if (freqs2) tip += ` · ${(aggr2 || '').toLowerCase()} ${Math.round(f2 * 100)}%`;
      if (evs) tip += ` · EV(${aggr.toLowerCase()}) ${evs[id] >= 0 ? '+' : ''}${evs[id].toFixed(2)}${unit.suffix}`;
      if (evs2) tip += ` · EV(raise) ${evs2[id] >= 0 ? '+' : ''}${evs2[id].toFixed(2)}${unit.suffix}`;
      cells += `<div class="range-cell" style="${style}" title="${tip}">${label}</div>`;
    }
    grid.innerHTML = cells;
    let statTxt = `${aggr} ${Ranges.rangePercent(freqs).toFixed(1)}%`;
    if (freqs2) statTxt += ` · Raise ${Ranges.rangePercent(freqs2).toFixed(1)}%`;
    $('xStats').textContent = statTxt + ' of hands';
    $('xNote').textContent = `Model: open ${cfg.openSize}x / jam / fold, reshove-jam-or-fold behind ` +
      `(no flats or 4-bet sizes) — solved live at your exact stacks and antes` +
      (cfg.icm ? `, ICM payouts from Settings` : cfg.pko ? `, PKO bounties from Settings` : '') +
      `. Beyond ~30 bb this tree understates deep-stack options.`;
  }

  // ---- postflop spot explorer ----
  // Type any board, click through the betting line node by node; each new
  // street is re-solved with Bayes-updated ranges (same engine as the
  // full-hand drill). The chart shows the acting player's strategy mix.
  function parseCards(txt, need) {
    // accept letter suits (Ks 7d 2c) and symbol suits (K♠ 7♦ 2♣)
    const norm = String(txt || '').toUpperCase()
      .replace(/♠/g, 'S').replace(/♥/g, 'H').replace(/♦/g, 'D').replace(/♣/g, 'C');
    const toks = norm.match(/(10|[2-9TJQKA])\s*([SHDC])/g);
    if (!toks) return null;
    const cards = toks.map(t => {
      const c = t.replace(/\s+/g, '').replace(/^10/, 'T');
      return (GTO.RANKS.indexOf(c[0]) << 2) | 'SHDC'.indexOf(c[1]);
    });
    if (need && cards.length !== need) return null;
    if (new Set(cards).size !== cards.length) return null;
    return cards;
  }
  function cardTxt(c) { return GTO.RANKS[c >> 2] + GTO.SUIT_CHARS[c & 3]; }
  // letter notation for input fields — must round-trip through parseCards
  function cardInTxt(c) { return GTO.RANKS[c >> 2] + 'shdc'[c & 3]; }

  function xpfBayes(list, strat, stride, idx) {
    return list.map((c, i) => ({ c1: c.c1, c2: c.c2, cls: c.cls, w: c.w * strat[i * stride + idx] }));
  }

  function xpfMatchup() {
    if (explorer.pfPotType === '3bp') {
      const [oop, ip] = String(explorer.pfPair || 'CO,BTN').split(',');
      return pfMatchupFor(ip, oop);
    }
    return pfMatchupFor(explorer.pfIp || 'BTN');
  }

  function xpfSolve(key, cfg) {
    if (key === pfPendingKey) return;
    pfPendingKey = key;
    pfPendingCfg = Object.assign({ key }, cfg);
    pfPendingFn = renderExplorer;
    const w = getPfWorker();
    if (w) w.postMessage(pfPendingCfg);
    else setTimeout(pfSolveSync, 30);
  }

  // Walk the streets: solve each, Bayes-update on closed streets, and report
  // where the line currently stands.
  function xpfResolve(m, flop) {
    let board = flop.slice();
    let key = pfFlopKey(m, board);
    let sol = pfCache.get(key);
    if (!sol) {
      if (!ensurePfSolved(key, m, flop)) {
        pfPendingFn = renderExplorer;
        return { status: 'solving', street: 'flop' };
      }
      sol = pfCache.get(key);
    }
    let curIp = sol.ip.map(c => ({ c1: c.c1, c2: c.c2, cls: c.cls, w: c.w }));
    let curBb = sol.bb.map(c => ({ c1: c.c1, c2: c.c2, cls: c.cls, w: c.w }));
    const line = [];

    for (let sIdx = 0; sIdx < explorer.pfStreets.length; sIdx++) {
      const seg = explorer.pfStreets[sIdx];
      const AI = 1 + sol.sizes.length;
      let node = 'root', sizeIdx = -1, closedBy = null, over = null;
      for (const act of seg.acts) {
        if (node === 'root') {
          if (act === 'check') closedBy = 'check';
          else { sizeIdx = act === 'bet0' ? 0 : 1; node = 'resp'; }
        } else if (node === 'resp') {
          if (act === 'fold') over = `${pfOopName(m)} folds — ${m.ip} takes ${fmtBB(sol.pot)}`;
          else if (act === 'call') closedBy = 'call';
          else node = 'vsraise';
        } else if (node === 'vsraise') {
          if (act === 'xfold') over = `${m.ip} folds to the raise — ${pfOopName(m)} takes the pot`;
          else closedBy = 'raisecall';
        }
      }
      if (over) return { status: 'over', msg: over, line, sol, board };
      if (!closedBy) {
        return { status: 'ready', sol, node, sizeIdx, board, line, streetIdx: sIdx };
      }
      // street closed → Bayes-update ranges with every observed action
      const rootIdx = closedBy === 'check' ? 0 : 1 + sizeIdx;
      curIp = xpfBayes(curIp, sol.ipRoot, AI, rootIdx);
      let pot = sol.pot, stack = sol.stack;
      if (closedBy === 'call') {
        curBb = xpfBayes(curBb, sol.bbResp[sizeIdx], 3, 1);
        pot += 2 * sol.bets[sizeIdx];
        stack -= sol.bets[sizeIdx];
      } else if (closedBy === 'raisecall') {
        curBb = xpfBayes(curBb, sol.bbResp[sizeIdx], 3, 2);
        curIp = xpfBayes(curIp, sol.ipVsR[sizeIdx], 2, 1);
        pot += 2 * sol.raises[sizeIdx];
        stack -= sol.raises[sizeIdx];
      }
      line.push({ board: board.slice(), closedBy, sizeIdx, sol });
      if (board.length >= 5) return { status: 'end', msg: `River action complete — showdown for ${fmtBB(pot)}`, line, board };
      if (stack <= 0.05) return { status: 'end', msg: `Stacks are in — showdown for ${fmtBB(pot)} after the runout`, line, board };
      const next = explorer.pfStreets[sIdx + 1];
      if (!next || next.card == null) {
        return { status: 'need-card', board, pot, stack, line, streetIdx: sIdx };
      }
      // solve the next street with the conditioned ranges
      board = board.concat([next.card]);
      const flat = explorer.pfStreets.slice(0, sIdx + 1).map(sg => sg.acts.join('.')).join('/');
      key = `xpf|${pfFlopKey(m, flop)}|${board.join(',')}|${flat}`;
      sol = pfCache.get(key);
      if (!sol) {
        xpfSolve(key, {
          ipCombos: curIp.filter(c => c.w > 0.001),
          bbCombos: curBb.filter(c => c.w > 0.001),
          board, pot, stack, iterations: 200,
        });
        return { status: 'solving', street: board.length === 4 ? 'turn' : 'river' };
      }
      if (!sol.ip.length || !sol.bb.length) {
        return { status: 'end', msg: 'A range emptied out — no meaningful strategy left here.', line, board };
      }
      curIp = sol.ip.map(c => ({ c1: c.c1, c2: c.c2, cls: c.cls, w: c.w }));
      curBb = sol.bb.map(c => ({ c1: c.c1, c2: c.c2, cls: c.cls, w: c.w }));
    }
    return { status: 'ready', sol, node: 'root', sizeIdx: -1, board, line, streetIdx: explorer.pfStreets.length - 1 };
  }

  function xpfAct(token) {
    explorer.pfStreets[explorer.pfStreets.length - 1].acts.push(token);
    saveExplorer();
    renderExplorer();
  }

  function xpfUndo() {
    const last = explorer.pfStreets[explorer.pfStreets.length - 1];
    if (last.acts.length) last.acts.pop();
    else if (explorer.pfStreets.length > 1) explorer.pfStreets.pop();
    saveExplorer();
    renderExplorer();
  }

  function renderExplorerPost() {
    const srpOpts = PF_IPS.map(p =>
      `<option value="srp:${p}"${explorer.pfPotType === 'srp' && explorer.pfIp === p ? ' selected' : ''}>SRP · ${p} opens, BB calls</option>`).join('');
    const bpOpts = PF_3BP_PAIRS.map(([oop, ip]) =>
      `<option value="3bp:${oop},${ip}"${explorer.pfPotType === '3bp' && explorer.pfPair === oop + ',' + ip ? ' selected' : ''}>3BP · ${oop} opens, ${ip} 3-bets</option>`).join('');
    $('xConfig').innerHTML =
      `<select id="xpfMatch">${srpOpts}${bpOpts}</select>` +
      `<input type="text" id="xpfFlop" value="${explorer.pfBoardText}" placeholder="Flop, e.g. Ks 7d 2c">` +
      `<button class="btn" id="xpfRandom">🎲 Random flop</button>` +
      `<button class="btn" id="xReset">Reset actions</button>`;
    $('xpfMatch').addEventListener('change', () => {
      const v = $('xpfMatch').value;
      if (v.startsWith('3bp:')) { explorer.pfPotType = '3bp'; explorer.pfPair = v.slice(4); }
      else { explorer.pfPotType = 'srp'; explorer.pfIp = v.slice(4); }
      explorer.pfStreets = [{ acts: [] }];
      saveExplorer(); renderExplorer();
    });
    $('xpfFlop').addEventListener('change', () => {
      explorer.pfBoardText = $('xpfFlop').value;
      explorer.pfStreets = [{ acts: [] }];
      saveExplorer(); renderExplorer();
    });
    $('xpfRandom').addEventListener('click', () => {
      explorer.pfBoardText = PF.dealBoard(3, []).map(cardInTxt).join(' ');
      explorer.pfStreets = [{ acts: [] }];
      saveExplorer(); renderExplorer();
    });
    $('xReset').addEventListener('click', () => {
      explorer.pfStreets = [{ acts: [] }];
      saveExplorer(); renderExplorer();
    });

    const m = xpfMatchup();
    const clearChart = () => {
      $('xGrid').innerHTML = ''; $('xLegend').innerHTML = ''; $('xStats').textContent = ''; $('xNote').textContent = '';
    };
    const flop = parseCards(explorer.pfBoardText, 3);
    $('xSeats').innerHTML = '';
    if (!flop) {
      $('xTitle').textContent = 'Enter a flop (e.g. "Ks 7d 2c") or hit 🎲 to deal one.';
      clearChart();
      return;
    }
    const res = xpfResolve(m, flop);

    // the story so far
    const ACT_TXT = (seg, solX) => seg.acts.map(a => ({
      check: 'check', bet0: `bet ${fmtBB(solX.bets[0])}`, bet1: `bet ${fmtBB(solX.bets[1])}`,
      fold: 'fold', call: 'call', raise: `raise ${fmtBB(solX.raises[Math.max(0, seg.sizeIdx)])}`,
      xfold: 'fold', xcall: 'call',
    })[a] || a);
    let lineHtml = `<div class="x-line"><b>${pfStory(m)}</b> · pot ${fmtBB(m.pot0)}</div>`;
    const streets = ['Flop', 'Turn', 'River'];
    explorer.pfStreets.forEach((seg, i) => {
      const segSol = (res.line && res.line[i] && res.line[i].sol) || res.sol;
      const cards = i === 0 ? flop.map(cardTxt).join(' ') : (seg.card != null ? cardTxt(seg.card) : '');
      const solRef = segSol || { bets: [0, 0], raises: [0, 0] };
      const segCopy = { acts: seg.acts, sizeIdx: seg.acts.find(a => a === 'bet1') ? 1 : 0 };
      const actsTxt = seg.acts.length ? seg.acts.map((a, k) => ACT_TXT({ acts: [a], sizeIdx: segCopy.sizeIdx }, solRef)[0]).join(' — ') : '…';
      lineHtml += `<div class="x-line">${streets[i]} <b>${cards}</b>: ${actsTxt}</div>`;
    });
    if (explorer.pfStreets.some(sg => sg.acts.length) || explorer.pfStreets.length > 1) {
      lineHtml += `<button class="btn" id="xpfUndo" style="margin-top:4px">↩ Undo</button>`;
    }
    $('xSeats').innerHTML = lineHtml;
    const ub = $('xpfUndo');
    if (ub) ub.addEventListener('click', xpfUndo);

    if (res.status === 'solving') {
      $('xTitle').textContent = `Solving the ${res.street} with updated ranges…`;
      $('xGrid').innerHTML = `<div style="grid-column:1/-1;padding:30px;text-align:center;color:var(--text-dim)">Running the solver…</div>`;
      $('xLegend').innerHTML = ''; $('xStats').textContent = ''; $('xNote').textContent = '';
      return;
    }
    if (res.status === 'over' || res.status === 'end') {
      $('xTitle').textContent = res.msg;
      clearChart();
      $('xNote').textContent = 'Use ↩ Undo to step back, or Reset actions to start over.';
      return;
    }
    if (res.status === 'need-card') {
      const street = res.board.length === 3 ? 'turn' : 'river';
      $('xTitle').textContent = `Street complete — pick the ${street} card (pot ${fmtBB(res.pot)}, ${fmtBB(res.stack)} behind).`;
      clearChart();
      $('xSeats').innerHTML += `<div class="x-line" style="margin-top:6px">` +
        `<input type="text" id="xpfCard" placeholder="${street} card, e.g. 9h" style="width:130px">` +
        `<button class="btn" id="xpfCardGo">Add ${street}</button>` +
        `<button class="btn" id="xpfCardRnd">🎲</button></div>`;
      const addCard = (card) => {
        explorer.pfStreets.push({ card, acts: [] });
        saveExplorer(); renderExplorer();
      };
      $('xpfCardGo').addEventListener('click', () => {
        const c = parseCards($('xpfCard').value, 1);
        if (!c || res.board.includes(c[0])) { $('xpfCard').value = ''; $('xpfCard').placeholder = 'invalid / already out'; return; }
        addCard(c[0]);
      });
      $('xpfCardRnd').addEventListener('click', () => addCard(PF.dealBoard(1, res.board)[0]));
      const ub2 = $('xpfUndo');
      if (ub2) ub2.addEventListener('click', xpfUndo);
      return;
    }

    // ready: chart for the acting player + this node's actions
    const sol = res.sol;
    const street = streets[res.board.length - 3];
    const boardTxt = res.board.map(cardTxt).join(' ');
    let combos, strat, stride, actNames, actColors, title, options;
    if (res.node === 'root') {
      combos = sol.ip; strat = sol.ipRoot; stride = 1 + sol.sizes.length;
      actNames = ['Check', `Bet ${fmtBB(sol.bets[0])}`, `Bet ${fmtBB(sol.bets[1])}`];
      actColors = ['#46628a', '#d97a2b', 'var(--jam)'];
      title = `${m.ip} strategy · ${street} ${boardTxt} · pot ${fmtBB(sol.pot)}, ${fmtBB(sol.stack)} behind`;
      options = [{ t: 'check', l: 'Check', c: 'fold' }, { t: 'bet0', l: `Bet ${fmtBB(sol.bets[0])}`, c: 'threebet' }];
      if (sol.bets[1] > sol.bets[0] + 0.05) options.push({ t: 'bet1', l: `Bet ${fmtBB(sol.bets[1])}`, c: 'jam' });
    } else if (res.node === 'resp') {
      const sz = res.sizeIdx;
      combos = sol.bb; strat = sol.bbResp[sz]; stride = 3;
      actNames = ['Fold', 'Call', `Raise ${fmtBB(sol.raises[sz])}`];
      actColors = ['#232b37', 'var(--call)', 'var(--jam)'];
      title = `${pfOopName(m)} vs ${fmtBB(sol.bets[sz])} bet · ${street} ${boardTxt} · pot ${fmtBB(sol.pot)}`;
      options = [{ t: 'fold', l: 'Fold', c: 'fold' }, { t: 'call', l: `Call ${fmtBB(sol.bets[sz])}`, c: 'call' },
        { t: 'raise', l: `Raise to ${fmtBB(sol.raises[sz])}`, c: 'jam' }];
    } else {
      const sz = res.sizeIdx;
      combos = sol.ip; strat = sol.ipVsR[sz]; stride = 2;
      actNames = ['Fold', 'Call'];
      actColors = ['#232b37', 'var(--call)'];
      title = `${m.ip} vs check-raise to ${fmtBB(sol.raises[sz])} · ${street} ${boardTxt}`;
      options = [{ t: 'xfold', l: 'Fold', c: 'fold' },
        { t: 'xcall', l: `Call ${fmtBB(Math.max(0, sol.raises[sz] - sol.bets[sz]))} more`, c: 'call' }];
    }
    $('xSeats').innerHTML += `<div class="x-line" style="margin-top:6px">` +
      options.map(o => `<button class="xs-btn ${o.c}" data-xpf="${o.t}">${o.l}</button>`).join(' ') + `</div>`;
    $('xSeats').querySelectorAll('[data-xpf]').forEach(b =>
      b.addEventListener('click', () => xpfAct(b.dataset.xpf)));
    const ub3 = $('xpfUndo');
    if (ub3) ub3.addEventListener('click', xpfUndo);

    const g = pfStrategyGrid(combos, strat, stride, actNames, actColors, -1);
    $('xTitle').textContent = title;
    $('xGrid').innerHTML = g.cells;
    $('xLegend').innerHTML = g.legend;
    $('xStats').textContent = g.stats;
    $('xNote').textContent = `Heads-up ${m.threeBP ? '3-bet pot' : 'single-raised pot'} · ranges Bayes-updated by every ` +
      `earlier action · each street is a single-street solve with equity rollouts (⅓ and ¾ pot sizes, one raise size).`;
  }

  // ---------------- range builder quiz ----------------
  let paintDown = false, paintOn = true;

  function newBuilderSpot(cfg) {
    const sol = getSolution(cfg, 'jam');
    if (!sol) { pendingFn = newHand; ensureSolved(cfg, 'jam'); return; }
    const type = ['push', 'call', 'rfi'][(Math.random() * 3) | 0];
    let pos, vs = -1, target, title, aggr = 'Jam';
    if (type === 'push') {
      pos = (Math.random() * (cfg.n - 1)) | 0;
      target = sol.push[pos];
      title = `${cfg.posNames[pos]} first-in JAM range · ${cfg.n}-max, ${fmtBB(cfg.stacks[pos])}`;
    } else if (type === 'call') {
      pos = 1 + ((Math.random() * (cfg.n - 1)) | 0);
      vs = (Math.random() * pos) | 0;
      target = sol.call[pos][vs];
      title = `${cfg.posNames[pos]} CALL range vs ${cfg.posNames[vs]} jam · ${cfg.n}-max, ${fmtBB(cfg.stacks[pos])}`;
      aggr = 'Call';
    } else {
      pos = (Math.random() * (cfg.n - 1)) | 0;
      target = Ranges.RFI[cfg.posNames[pos]];
      title = `${cfg.posNames[pos]} OPENING range (chart, 40bb+)`;
      aggr = 'Raise';
      if (!target) { newBuilderSpot(cfg); return; }
    }
    scenario = {
      mode: 'builder', cfg, target: Array.from(target), title, aggr,
      painted: new Array(169).fill(false), answered: false,
    };
    $('feedback').classList.remove('show');
    $('histDetail').style.display = 'none';
    $('explorePanel').style.display = 'none';
    updateExamProgress();
    $('tableWrap').style.display = 'none';
    $('controls').innerHTML = '';
    renderBuilder();
  }

  function renderBuilder() {
    const s = scenario;
    const panel = $('builderPanel');
    panel.style.display = '';
    let cells = '';
    for (let id = 0; id < 169; id++) {
      cells += `<div class="range-cell${s.painted[id] ? ' painted' : ''}" data-id="${id}">${GTO.handLabel(id)}</div>`;
    }
    panel.innerHTML =
      `<h2>${s.title}</h2>` +
      `<div class="hint" style="margin:6px 0 10px">Paint every hand you would <b>${s.aggr.toLowerCase()}</b> (click or drag), then submit. ` +
      `Mixed-frequency hands (30–70%) count either way.</div>` +
      `<div class="range-grid" id="builderGrid">${cells}</div>` +
      `<div class="modal-btns" style="justify-content:center">` +
      `<button class="btn" id="btnBuilderClear">Clear</button>` +
      `<button class="btn primary" id="btnBuilderSubmit">Submit range</button></div>`;

    const grid = $('builderGrid');
    grid.addEventListener('pointerdown', (ev) => {
      const cell = ev.target.closest('.range-cell');
      if (!cell || s.answered) return;
      ev.preventDefault();
      const id = +cell.dataset.id;
      paintDown = true;
      paintOn = !s.painted[id];
      s.painted[id] = paintOn;
      cell.classList.toggle('painted', paintOn);
    });
    // touch pointers are implicitly captured by the pointerdown cell, so
    // resolve the cell under the finger via elementFromPoint
    grid.addEventListener('pointermove', (ev) => {
      if (!paintDown || s.answered) return;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const cell = el && el.closest('.range-cell');
      if (!cell || !grid.contains(cell)) return;
      const id = +cell.dataset.id;
      s.painted[id] = paintOn;
      cell.classList.toggle('painted', paintOn);
    });
    $('btnBuilderClear').addEventListener('click', () => {
      if (s.answered) return;
      s.painted.fill(false);
      grid.querySelectorAll('.painted').forEach(c => c.classList.remove('painted'));
    });
    $('btnBuilderSubmit').addEventListener('click', submitBuilder);
  }

  function submitBuilder() {
    const s = scenario;
    if (!s || s.answered) return;
    s.answered = true;
    let scored = 0, right = 0;
    const grid = $('builderGrid');
    for (let id = 0; id < 169; id++) {
      const f = s.target[id];
      const cell = grid.querySelector(`[data-id="${id}"]`);
      const pct = Math.round(f * 100);
      // repaint with solver truth
      let style = '';
      if (f >= 0.995) style = 'background:var(--jam);color:#fff';
      else if (f > 0.005) style = `background:linear-gradient(to top, var(--jam) ${pct}%, var(--fold-cell) ${pct}%);color:#dfe6ef`;
      cell.style.cssText = style;
      cell.title = `${GTO.handLabel(id)}: ${s.aggr.toLowerCase()} ${pct}%`;
      if (f > 0.3 && f < 0.7) continue; // mixed: free
      scored++;
      const should = f >= 0.5;
      if (s.painted[id] === should) right++;
      else {
        cell.classList.add(s.painted[id] ? 'err-extra' : 'err-missed');
        cell.title += s.painted[id] ? ' — you painted this (fold it)' : ' — you missed this';
      }
    }
    const score = scored ? right / scored : 1;
    const pctScore = Math.round(score * 100);
    const verdictCls = score >= 0.93 ? 'good' : score >= 0.85 ? 'mixed' : 'bad';
    stats.hands++;
    if (verdictCls === 'bad') stats.wrong++; else stats.correct++;
    history.push({ label: pctScore + '%', v: verdictCls });
    history = history.slice(-24);
    saveStats();
    renderHeaderStats();
    renderHistory();
    $('fbVerdict').className = 'verdict ' + verdictCls;
    $('fbVerdict').textContent = `${pctScore}% of the range correct`;
    $('fbDetail').innerHTML = `${right}/${scored} decisive hands right · red-ringed cells were wrongly painted, yellow-ringed were missed`;
    $('feedback').classList.add('show');
    $('btnBuilderSubmit').disabled = true;
  }

  document.addEventListener('pointerup', () => { paintDown = false; });
  document.addEventListener('pointercancel', () => { paintDown = false; });

  // ---------------- leak dashboard ----------------
  const MODE_LABELS = {
    pushfold: 'Jam or Fold', callvjam: 'Call vs Jam', rfi: 'Open (RFI)', vsrfi: 'Facing a raise',
    opentree: 'Open strategy', vsopen: 'Reshove vs open', vs3bet: 'Vs 3-bet jam', builder: 'Range builder',
    pftexture: 'Flop texture', pfequity: 'Equity estimate', pfrivercall: 'River call',
    pfcbet: 'C-bet flop', pfdefend: 'Defend vs c-bet', pfhand: 'Full hand',
  };

  // daily accuracy chart (inline SVG, last 14 active days)
  function trendChartHtml() {
    const days = new Map();
    for (const e of handLog) {
      if (!e.t || e.mode === 'builder') continue;
      const d = new Date(e.t);
      const k = `${d.getMonth() + 1}/${d.getDate()}`;
      const s = days.get(k) || { day: k, n: 0, ok: 0, ev: 0 };
      s.n++; if (e.v !== 'bad') s.ok++; s.ev += e.evLost || 0;
      days.set(k, s);
    }
    const list = [...days.values()].slice(-14);
    if (list.length < 2) return '';
    const w = 480, h = 130, pad = 14;
    const bw = (w - pad * 2) / list.length;
    let bars = '';
    list.forEach((d, i) => {
      const acc = d.ok / d.n;
      const bh = Math.max(3, acc * (h - 48));
      const x = pad + i * bw + 3;
      bars += `<rect x="${x.toFixed(1)}" y="${(h - 24 - bh).toFixed(1)}" width="${(bw - 6).toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="#4f9cf9" opacity="0.85"><title>${d.day}: ${(acc * 100).toFixed(0)}% of ${d.n} hands · ${d.ev.toFixed(1)} bb lost</title></rect>` +
        `<text x="${(x + (bw - 6) / 2).toFixed(1)}" y="${(h - 29 - bh).toFixed(1)}" font-size="9" fill="#94a3b8" text-anchor="middle">${(acc * 100).toFixed(0)}%</text>` +
        `<text x="${(x + (bw - 6) / 2).toFixed(1)}" y="${h - 10}" font-size="9" fill="#7b8798" text-anchor="middle">${d.day}</text>`;
    });
    return '<h3>Accuracy by day</h3>' +
      `<svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:560px;display:block">${bars}</svg>`;
  }

  // per-drill trend: accuracy in the last 40 hands vs the 40 before
  function modeTrend(modeKey) {
    const list = handLog.filter(e => e.mode === modeKey);
    if (list.length < 30) return '';
    const recent = list.slice(-40);
    const prior = list.slice(-80, -40);
    if (prior.length < 15) return '';
    const acc = (a) => a.filter(e => e.v !== 'bad').length / a.length;
    const diff = acc(recent) - acc(prior);
    if (diff > 0.05) return ' <span style="color:var(--green)">▲</span>';
    if (diff < -0.05) return ' <span style="color:var(--red)">▼</span>';
    return ' <span style="color:var(--text-dim)">→</span>';
  }

  function openStats() {
    const byMode = {}, byPos = {}, missed = {};
    for (const e of handLog) {
      if (e.mode === 'builder') continue;
      const m = byMode[e.mode] || (byMode[e.mode] = { n: 0, ok: 0, ev: 0 });
      m.n++; if (e.v !== 'bad') m.ok++; m.ev += e.evLost || 0;
      const pn = e.posName || '?';
      const p = byPos[pn] || (byPos[pn] = { n: 0, ok: 0, ev: 0 });
      p.n++; if (e.v !== 'bad') p.ok++; p.ev += e.evLost || 0;
      if (e.v === 'bad') missed[e.label] = (missed[e.label] || 0) + 1;
    }
    const row = (name, d, trend) =>
      `<tr><td>${name}${trend || ''}</td><td>${d.n}</td><td>${(100 * d.ok / d.n).toFixed(0)}%</td><td>${d.ev.toFixed(2)}</td></tr>`;
    let html = trendChartHtml();
    html += '<h3>By drill</h3><table class="stat-table"><tr><th></th><th>Hands</th><th>Acc</th><th>EV lost</th></tr>';
    for (const k in byMode) html += row(MODE_LABELS[k] || k, byMode[k], modeTrend(k));
    html += '</table><h3>By position</h3><table class="stat-table"><tr><th></th><th>Hands</th><th>Acc</th><th>EV lost</th></tr>';
    const posOrder = Object.keys(byPos).sort((a, b) => byPos[b].n - byPos[a].n);
    for (const k of posOrder) html += row(k, byPos[k]);
    html += '</table>';
    const targets = missedTargets();
    if (targets.length) {
      html += '<h3>🎯 In rotation (missed hands, cleared by 2 correct answers)</h3><div class="miss-chips">' +
        targets.slice(0, 14).map(t => `<span class="chip bad">${t.label}${t.w > 1 ? ' ×' + t.w : ''}</span>`).join(' ') + '</div>';
    }
    const worst = Object.entries(missed).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (worst.length) {
      html += '<h3>Most-missed hands</h3><div class="miss-chips">' +
        worst.map(([lab, c]) => `<span class="chip bad">${lab} ×${c}</span>`).join(' ') + '</div>';
    }
    if (!handLog.length) html = '<p style="color:var(--text-dim)">No hands logged yet — play some spots first.</p>';
    $('statsBody').innerHTML = html;
    $('statsModal').classList.add('show');
  }

  // ---------------- tournament session tracker ----------------
  // entries: {id, date 'YYYY-MM-DD', venue, gtd, buyin, cashout, place, notes}
  let sessEditId = null;

  function saveSessions() { saveJson('gto_sessions', { items: sessions }); }
  const sessEsc = (s) => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtMoney = (x) => (x < 0 ? '−$' : '$') +
    Math.abs(x).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const sessSorted = () => [...sessions].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id);

  function fmtSessDate(iso) {
    const d = new Date(iso + 'T12:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' });
  }

  function sessSummaryHtml() {
    const buy = sessions.reduce((s, e) => s + e.buyin, 0);
    const cash = sessions.reduce((s, e) => s + e.cashout, 0);
    const net = cash - buy;
    const itm = sessions.filter(e => e.cashout > 0).length;
    const tile = (v, k, cls) => `<div class="tile"><div class="v ${cls || ''}">${v}</div><div class="k">${k}</div></div>`;
    return '<div class="sess-sum">' +
      tile(sessions.length, 'sessions') +
      tile(fmtMoney(buy), 'buy-ins') +
      tile(fmtMoney(cash), 'cashouts') +
      tile((net > 0 ? '+' : '') + fmtMoney(net), 'net', net > 0 ? 'pos' : net < 0 ? 'neg' : '') +
      tile(buy > 0 ? ((net >= 0 ? '+' : '') + (100 * net / buy).toFixed(0) + '%') : '—', 'roi', net > 0 ? 'pos' : net < 0 ? 'neg' : '') +
      tile(sessions.length ? (100 * itm / sessions.length).toFixed(0) + '%' : '—', 'in the money') +
      '</div>';
  }

  // cumulative-profit chart: per-session net bars + running total line
  function sessChartHtml() {
    const list = sessSorted().slice(-30);
    if (list.length < 2) return '';
    const w = 480, h = 140, pad = 14, base = h - 22;
    let cum = 0;
    const pts = list.map(e => ({ e, net: e.cashout - e.buyin, cum: (cum += e.cashout - e.buyin) }));
    const lo = Math.min(0, ...pts.map(p => p.cum), ...pts.map(p => p.net));
    const hi = Math.max(1, ...pts.map(p => p.cum), ...pts.map(p => p.net));
    const y = (v) => base - (v - lo) / (hi - lo) * (base - 12);
    const bw = (w - pad * 2) / list.length;
    let bars = '', line = '';
    pts.forEach((p, i) => {
      const x = pad + i * bw + 2;
      const y0 = y(0), y1 = y(p.net);
      bars += `<rect x="${x.toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${Math.max(2, bw - 4).toFixed(1)}" height="${Math.max(1.5, Math.abs(y0 - y1)).toFixed(1)}" rx="2" fill="${p.net >= 0 ? '#34d399' : '#f87171'}" opacity="0.55"><title>${fmtSessDate(p.e.date)} ${sessEsc(p.e.venue)}: ${(p.net >= 0 ? '+' : '') + fmtMoney(p.net)} (total ${(p.cum >= 0 ? '+' : '') + fmtMoney(p.cum)})</title></rect>`;
      line += `${i ? 'L' : 'M'}${(x + bw / 2 - 2).toFixed(1)},${y(p.cum).toFixed(1)}`;
    });
    const zero = `<line x1="${pad}" y1="${y(0).toFixed(1)}" x2="${w - pad}" y2="${y(0).toFixed(1)}" stroke="#7b8798" stroke-width="0.6" stroke-dasharray="3 3"/>`;
    return '<h3 style="margin:12px 0 4px">Bankroll (per-session net + running total)</h3>' +
      `<svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:560px;display:block">${zero}${bars}` +
      `<path d="${line}" fill="none" stroke="#4f9cf9" stroke-width="2"/></svg>`;
  }

  function sessListHtml() {
    const list = sessSorted().reverse();
    if (!list.length) return '<p style="color:var(--text-dim);margin:4px 0">No sessions logged yet — add your first one above.</p>';
    return list.map(e => {
      const net = e.cashout - e.buyin;
      return `<div class="sess-row" data-sid="${e.id}">
        <div class="sess-l1"><b>${sessEsc(e.venue) || 'Session'}</b>${e.gtd ? ` <span class="sess-gtd">${sessEsc(e.gtd)}</span>` : ''}<span class="sess-date">${fmtSessDate(e.date)}</span></div>
        <div class="sess-l2"><span>In ${fmtMoney(e.buyin)}</span><span>Out ${fmtMoney(e.cashout)}</span><span class="${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}">${(net > 0 ? '+' : '') + fmtMoney(net)}</span>${e.place ? `<span>🏁 ${sessEsc(e.place)}</span>` : ''}
          <span class="sess-acts"><button class="btn mini" data-act="edit">✏️</button><button class="btn mini" data-act="del">🗑️</button></span></div>
        ${e.notes ? `<div class="sess-notes">${sessEsc(e.notes)}</div>` : ''}
      </div>`;
    }).join('');
  }

  function renderSessions() {
    $('sessSummary').innerHTML = sessSummaryHtml();
    $('sessChart').innerHTML = sessChartHtml();
    $('sessList').innerHTML = sessListHtml();
  }

  function resetSessForm() {
    sessEditId = null;
    const d = new Date();
    $('sessDate').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    for (const id of ['sessVenue', 'sessGtd', 'sessBuyin', 'sessCashout', 'sessPlace', 'sessNotes']) $(id).value = '';
    $('sessFormTitle').textContent = 'Log a session';
    $('btnSessSave').textContent = 'Add session';
    $('btnSessCancel').style.display = 'none';
  }

  function openSessions() {
    resetSessForm();
    renderSessions();
    $('sessModal').classList.add('show');
  }

  function saveSessionForm() {
    const entry = {
      id: sessEditId ?? Date.now(),
      date: $('sessDate').value || new Date().toISOString().slice(0, 10),
      venue: $('sessVenue').value.trim(),
      gtd: $('sessGtd').value.trim(),
      buyin: Math.max(0, parseFloat($('sessBuyin').value) || 0),
      cashout: Math.max(0, parseFloat($('sessCashout').value) || 0),
      place: $('sessPlace').value.trim(),
      notes: $('sessNotes').value.trim(),
    };
    if (!entry.venue && !entry.gtd && !entry.buyin && !entry.cashout) return; // nothing to log
    const i = sessions.findIndex(e => e.id === sessEditId);
    if (i >= 0) sessions[i] = entry; else sessions.push(entry);
    saveSessions();
    resetSessForm();
    renderSessions();
  }

  function sessListClick(ev) {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const row = btn.closest('.sess-row');
    const id = Number(row.dataset.sid);
    const e = sessions.find(s => s.id === id);
    if (!e) return;
    if (btn.dataset.act === 'edit') {
      sessEditId = id;
      $('sessDate').value = e.date;
      $('sessVenue').value = e.venue;
      $('sessGtd').value = e.gtd;
      $('sessBuyin').value = e.buyin || '';
      $('sessCashout').value = e.cashout || '';
      $('sessPlace').value = e.place;
      $('sessNotes').value = e.notes;
      $('sessFormTitle').textContent = `Editing — ${e.venue || fmtSessDate(e.date)}`;
      $('btnSessSave').textContent = 'Save changes';
      $('btnSessCancel').style.display = '';
      $('sessModal').querySelector('.modal').scrollTop = 0;
    } else if (btn.dataset.act === 'del') {
      if (btn.dataset.armed) { // two-tap delete, no browser confirm dialog
        sessions = sessions.filter(s => s.id !== id);
        saveSessions();
        if (sessEditId === id) resetSessForm();
        renderSessions();
      } else {
        btn.dataset.armed = '1';
        btn.textContent = 'Sure?';
        setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = '🗑️'; } }, 2500);
      }
    }
  }

  function exportSessionsCsv() {
    const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const rows = [['date', 'venue', 'event_gtd', 'buyin', 'cashout', 'net', 'place', 'notes']];
    for (const e of sessSorted()) rows.push([e.date, e.venue, e.gtd, e.buyin, e.cashout, e.cashout - e.buyin, e.place, e.notes]);
    const blob = new Blob([rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'poker-sessions.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------------- wiring ----------------
  $('btnSettings').addEventListener('click', openSettings);
  $('btnApplySettings').addEventListener('click', applySettings);
  $('btnResetStats').addEventListener('click', () => {
    stats = { hands: 0, correct: 0, wrong: 0, evLost: 0, evLostIcm: 0 };
    history = [];
    handLog = [];
    saveStats();
    renderHeaderStats();
    renderHistory();
  });
  $('setPlayers').addEventListener('change', rebuildHeroPosSelect);
  $('setMode').addEventListener('change', updateExamVisibility);
  document.querySelectorAll('#segAnte button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#segAnte button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      settings.anteMode = b.dataset.v;
    });
  });
  document.querySelectorAll('#segFormat button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#segFormat button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      settings.evFormat = b.dataset.v;
      updatePayoutsVisibility();
    });
  });
  document.querySelectorAll('#segExamCharts button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#segExamCharts button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      settings.examCharts = b.dataset.v === 'on';
    });
  });
  $('settingsModal').addEventListener('click', (e) => {
    if (e.target === $('settingsModal')) $('settingsModal').classList.remove('show');
  });

  $('btnRanges').addEventListener('click', openRangeBrowser);
  $('btnShowRange').addEventListener('click', openRangeForScenario);
  $('btnCloseRange').addEventListener('click', () => $('rangeModal').classList.remove('show'));
  $('rangeModal').addEventListener('click', (e) => {
    if (e.target === $('rangeModal')) $('rangeModal').classList.remove('show');
  });
  $('btnStats').addEventListener('click', openStats);
  $('btnSessions').addEventListener('click', openSessions);
  $('btnCloseSess').addEventListener('click', () => $('sessModal').classList.remove('show'));
  $('sessModal').addEventListener('click', (e) => {
    if (e.target === $('sessModal')) $('sessModal').classList.remove('show');
  });
  $('btnSessSave').addEventListener('click', saveSessionForm);
  $('btnSessCancel').addEventListener('click', resetSessForm);
  $('btnSessExport').addEventListener('click', exportSessionsCsv);
  $('sessList').addEventListener('click', sessListClick);
  $('btnCloseStats').addEventListener('click', () => $('statsModal').classList.remove('show'));
  $('statsModal').addEventListener('click', (e) => {
    if (e.target === $('statsModal')) $('statsModal').classList.remove('show');
  });
  $('btnReview').addEventListener('click', startReview);

  document.querySelector('header h1').addEventListener('click', () => {
    if (exam) $('exitExamModal').classList.add('show');
  });
  $('btnKeepExam').addEventListener('click', () => $('exitExamModal').classList.remove('show'));
  $('btnExitExam').addEventListener('click', exitExam);
  $('exitExamModal').addEventListener('click', (e) => {
    if (e.target === $('exitExamModal')) $('exitExamModal').classList.remove('show');
  });

  $('btnCloseExam').addEventListener('click', () => $('examModal').classList.remove('show'));
  $('btnExamAgain').addEventListener('click', startExam);
  $('btnExamReview').addEventListener('click', () => {
    $('examModal').classList.remove('show');
    startReview();
  });
  $('examModal').addEventListener('click', (e) => {
    if (e.target === $('examModal')) $('examModal').classList.remove('show');
  });

  $('btnNext').addEventListener('click', nextHand);

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if ($('settingsModal').classList.contains('show')) return;
    if ($('examModal').classList.contains('show')) return;
    if ($('exitExamModal').classList.contains('show')) return;
    const k = e.key.toLowerCase();
    if (k === ' ') {
      e.preventDefault();
      if (scenario && scenario.answered) nextHand();
      return;
    }
    if (!scenario || scenario.answered) return;
    const s = scenario;
    if (s.mode === 'builder') return;
    if (PF_MODES.has(s.mode)) {
      const n = parseInt(k, 10);
      if (n >= 1 && n <= 4) {
        const btn = $('controls').querySelectorAll('button:not([disabled])')[n - 1];
        if (btn) (s.mode === 'pfhand' ? answerPfHand : answerPostflop)(btn.dataset.pf);
      }
      return;
    }
    if (k === 'f') answer('fold');
    else if (s.mode === 'pushfold' && (k === 'j' || k === 'a')) answer('jam');
    else if (s.mode === 'callvjam' && (k === 'c' || k === 'a')) answer('call');
    else if (s.mode === 'rfi' && (k === 'r' || k === 'a')) answer('raise');
    else if (s.mode === 'vsrfi' && k === 'c') answer('call');
    else if (s.mode === 'vsrfi' && (k === 'r' || k === '3')) answer('threebet');
    else if (s.mode === 'opentree' && k === 'r') answer('threebet');
    else if (s.mode === 'opentree' && (k === 'j' || k === 'a')) answer('jam');
    else if (s.mode === 'vsopen' && (k === 'j' || k === 'a')) answer('jam');
    else if (s.mode === 'vs3bet' && (k === 'c' || k === 'a')) answer('call');
  });

  // ---------------- boot ----------------
  // deep links from the guide: index.html?mode=<drill>
  const urlMode = new URLSearchParams(location.search).get('mode');
  if (urlMode && (PF_MODES.has(urlMode) ||
    ['auto', 'pushfold', 'callvjam', 'opentree', 'vsopen', 'vs3bet', 'rfi', 'vsrfi', 'builder', 'exam', 'explore'].includes(urlMode))) {
    settings.mode = urlMode;
    if (PF_MODES.has(urlMode)) settings.lastPfMode = urlMode;
    saveJson('gto_settings', settings);
    window.history.replaceState(null, '', location.pathname);
  }
  renderHeaderStats();
  renderHistory();
  renderNav();
  newHand();
})();
