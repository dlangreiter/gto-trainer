# GTO Trainer — Tournament Poker

An interactive preflop GTO trainer for tournament poker with a built-in Nash equilibrium
solver. Pure static web app — no build step, no dependencies, hostable anywhere
(GitHub Pages, Netlify, any static file server).

## Run locally

```
python -m http.server 8080
```
then open http://localhost:8080 — or just double-click `start.bat`.

(Opening `index.html` directly also works: the solver falls back to the main thread
when Web Workers are blocked on `file://`.)

## Features

- **Built-in push/fold solver** — computes Nash equilibrium jam/fold and call-vs-jam
  ranges via fictitious play, live in your browser (~0.5 s for a 9-max table).
  Fully parameterized: 2–9 players, per-seat stacks, blinds, BB ante / classic ante.
- **ICM ($EV) mode** — switch the solver from chip EV to tournament equity
  (Malmuth-Harville). Enter the remaining payouts and it solves final-table /
  bubble spots: covering stacks jam wider, calling ranges collapse. EV feedback is
  shown in % of the prize pool (or your currency).
- **Solved raise trees (15–30 bb)** — beyond jam-or-fold, the solver handles a
  min-raise tree: open 2.2x / jam / fold first-in, opponents reshove-jam or fold,
  opener calls or folds the reshove. All solved per stack/ante/EV-model config.
- **PKO bounty mode** — progressive-knockout EV: busting a covered player earns
  their bounty (per-seat bounty values in bb, adjustable capture fraction).
  Watch calling ranges explode when a big bounty shoves.
- **Session exam** — a scored run of 10/20/30 hands dealt from randomized table
  configs (table size, stack depths incl. ragged stacks, ante types, open sizes,
  positions). No feedback during the run; at the end you get a score, a letter
  grade, EV lost — and a walkthrough of every mistake with a plain-English
  explanation plus the solver's frequencies and EVs. One tap replays the
  mistakes through the Review engine. **Adaptive**: the plan is weighted by your
  hand log, so drills and positions you've been missing are dealt more often
  next time (corrected mistakes count less), and the multi-decision raise-tree
  spots (raise 2.2x / jam / fold, reshove, call-vs-3-bet) always get an
  outsized base share over plain push/fold. **Postflop spots are dealt too** —
  c-bet, defend-vs-c-bet, river calls, plus the texture/equity quizzes at a
  lighter weight — so an exam tests your whole game. An optional
  **"+ deep charts"** toggle also mixes in 40–60 bb opening-range and
  facing-a-raise chart spots (quiz-style spots score by agreement, no EV).
- **Quick-drill bar** — under the action buttons: a Start-exam button, a
  "Quick drills" menu of one-tap presets (short-stack UTG jam, BB call vs jam,
  20 bb open tree, reshove, deep call-vs-raise, bubble ICM), and a **blind
  level** menu — a standard 20-minute MTT structure on a 10k stack (Level 1
  25/50 ≈ 200 bb deep through Level 12 1000/2000 = 5 bb). Pick a level and the
  drill type follows the depth: charts early, raise trees in the middle,
  jam/fold late.
- **Tappable history** — the recent-hands chips expand into a panel showing
  the spot, what you chose, and the full solver explanation for that hand.
- **Postflop section** (heads-up, ~40 bb). Two pot types, toggled from the
  quick bar: **single-raised** (2.2x open + BB call, 5.9 bb pot) and
  **3-bet pots** (open → in-position 3-bet to 7.5 → call, 17.5 bb pot,
  SPR ~1.9). The 3-bettor's range comes from the vs-RFI charts; the opener's
  continue range is modeled by equity vs the 3-bet range (top ~6% four-bets,
  next ~48% calls). All postflop drills support both pot types; exams mix them.
  Six drills:
  - *C-bet flop* / *Defend vs c-bet* — a real flop solver runs in your browser
    (fictitious play over combo-level ranges, ⅓-pot and ¾-pot sizes, check-raise
    included, equity-rollout terminal values; ~1 s per flop in a worker). Your
    exact combo is graded by EV loss with the solver's mixed frequencies shown.
  - *Flop texture quiz* — whose range does this flop favor? Graded by exact
    range-vs-range equity.
  - *Equity estimate* — bucket your hand's equity vs the opponent's real range
    on a flop or turn.
  - *River call vs jam* — pot odds vs a stated polarized jam model (top X%
    value + bottom Y% bluffs); graded by exact showdown equity with real EV.
  - *Play a full hand* — flop → turn → river against the solver: each street
    is re-solved with Bayes-updated ranges after every action, villain actions
    are sampled from the solver's mixed strategy, every decision is EV-graded,
    and showdowns reveal a hand drawn from the villain's final range.
  - *Strategy viewer* — after any solver drill, "View solver range" shows the
    13×13 action-mix grid for the whole range on that exact board.
  - Postflop mistakes replay in **Review** (exact board, combo, and sizing);
    full-hand street decisions are stats-only.
  - Note: each street is a single-street solve (later streets realized as
    all-in equity) — honest c-bet/defend/barreling fundamentals, not a full
    multi-street tree.
- **🔍 Spot explorer** — a GTO-Wizard-style solution browser: pick table size
  (2–9), per-seat stack depths in bb, ante type, open size (2.0x–3.0x) and EV
  model (chip/ICM/PKO), then click in each player's action — fold, open, jam,
  reshove — and the 13×13 chart always shows the solver's full strategy
  (frequencies + EVs per hand) for the player whose turn it is, solved live at
  your exact stacks. Tap a chosen action again to rewind the hand from there.
  The tree is open/jam/fold with reshove-or-fold behind — honest for ≤30 bb;
  deeper it understates options (no flats or 4-bet sizes). A **Postflop spots**
  sub-mode does the same for postflop: pick the matchup (SRP or 3-bet pot),
  type or roll any flop, click through the betting line node by node (check /
  bet ⅓ / bet ¾ / fold / call / check-raise), add turn and river cards, and
  every chart shows the acting player's 13×13 action mix with ranges
  Bayes-updated by everything that happened — each street solved live.
- **Progress trends** — the Stats panel charts daily accuracy, marks per-drill
  trend arrows (last 40 vs prior 40 hands), and runs **spaced repetition**:
  hand classes you've missed are re-dealt ~25% of the time (tagged 🎯) until
  you answer each correctly twice.
- **📖 The Guide** — `guide.html`: a complete 17-section GTO curriculum in
  learning order (positions → the grid → RFI → defending → pot odds →
  push/fold → antes → raise trees → ICM → PKO → MDF → textures → c-betting →
  rivers → study plan) with live range grids and equity numbers computed from
  the app's own data, diagrams, and deep links into the matching drills
  (`index.html?mode=<drill>`).
- **Nine trainer modes**
  - *Jam or Fold* / *Call vs Jam* — classic short-stack drills (solver-graded)
  - *Open strategy* — fold / raise 2.2x / jam first-in at 15–30 bb (solver, 3-way EV)
  - *Reshove vs open* / *Facing a 3-bet jam* — both sides of the raise tree
    (in the 3-bet drill your dealt hand is conditioned on your solved opening range)
  - *Opening ranges* / *Facing a raise* — deep-stack chart drills
  - *Range builder quiz* — paint the whole 13×13 grid for a random spot and get
    scored cell-by-cell against the solver (mixed-frequency hands count either way)
  - *Auto* — picks the drill from stack depth (≤15 bb jam tree, 15–30 bb raise tree,
    deeper → charts)
- **Mistake review & leak stats** — every hand is logged; the Review button replays
  your mistakes (exact hand, seat, and table config re-solved on demand) until you
  get them right, and the Stats panel breaks down accuracy and EV lost by drill and
  position, plus your most-missed hands.
- **Range viewer** — browse any solved jam/call range, RFI chart, or vs-open defense
  chart (dual-color 3-bet/call) as a 13×13 grid with per-hand frequencies and EVs;
  your last hand is highlighted.
- **Customisable table** — players, positions (fixed or random hero seat), blind level
  in chips, ante type, uniform or per-seat stacks.
- **Stats** — hands, accuracy, and total EV lost persist across sessions
  (localStorage), plus a recent-hands strip.
- Keyboard: `F` fold · `J`/`A` jam · `C` call · `R` raise · `Space` next hand.

## How the solver works

- `tools/gen_equity.mjs` precomputes a 169×169 preflop all-in equity matrix
  (Monte Carlo, 12 000 boards per matchup) → `data/equity169.js`.
- `js/solver.js` runs fictitious play over jam/fold strategies for every position and
  call/fold strategies vs every possible jammer, with blocker-adjusted combo weights.
  EV model: antes and folded blinds as dead money, exact heads-up showdowns, two-caller
  all-ins via a normalized-product 3-way equity approximation (3+ callers are ignored —
  vanishingly rare at equilibrium).
- Validated against published Nash numbers, e.g. HU 10 bb: SB jams 58.2%
  (known 58.3%), BB calls 37.3% (known ~37%).
- **Raise tree** (`tree: 'raise'`): the opener's first action best-responds with its
  optimal continuation vs each reshove (computed the same iteration), so open EVs
  include realize-when-called value. Behind-the-opener flatting is not modeled
  (reshove-or-fold), the standard mid-stack simplification.
- **PKO**: bounty capture is an additive hand-independent constant per
  (winner, victim) pair — only applied when the winner covers the victim.
- **ICM mode**: outcome stack vectors are hand-independent, so all Malmuth-Harville
  evaluations (subset-DP, pruned to paid places) are precomputed once per config;
  the fictitious-play loop then mixes $-payoff constants instead of chips. The ICM
  equity function reproduces the classic 3-player example (50/30/20 stacks,
  50/30/20 payouts → 38.4 / 32.7 / 28.9).
- Solutions are cached (memory + localStorage) per table configuration.

## Accuracy notes / limitations

- Preflop only; jam/fold model (no limp/min-raise trees at short stacks).
- Opening-range and vs-open charts are curated baselines (~40 bb+), not per-stack
  solves; heads-up "SB" uses the 8/9-max SB chart, which is tighter than true HU opens.
- Callers are assumed not to factor in players behind them overcalling.
- ICM: busted players in hypothetical outcomes are valued at 0 (fine for top-heavy
  payouts); ties are folded into win probability; 3+ caller all-ins approximated.
- Keys: `F` fold · `J` jam · `C` call · `R`/`3` raise/3-bet · `Space` next.
- Regenerate the equity matrix with more samples if desired:
  `node tools/gen_equity.mjs 20000`.
- Solver self-checks: `node tools/test_solver.mjs`.

## Deploy

Copy the folder (minus `tools/`) to any static host. Nothing else needed.
