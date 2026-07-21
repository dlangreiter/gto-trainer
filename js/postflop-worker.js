// Web Worker: runs the flop solver off the main thread.
importScripts('postflop.js?v=17', 'postflop-solver.js?v=17');

self.onmessage = function (e) {
  const cfg = e.data;
  cfg.onProgress = function (frac) {
    self.postMessage({ type: 'progress', frac });
  };
  const sol = globalThis.GTOPostflopSolver.solveFlop(cfg);
  self.postMessage({ type: 'done', key: cfg.key, solution: sol });
};
