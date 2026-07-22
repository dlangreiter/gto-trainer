// Web Worker: runs the push/fold solver off the main thread.
importScripts('../data/equity169.js?v=20', 'constants.js?v=20', 'solver.js?v=20');

self.onmessage = function (e) {
  const cfg = e.data;
  cfg.onProgress = function (frac) {
    self.postMessage({ type: 'progress', frac });
  };
  const sol = globalThis.GTOSolver.solvePushFold(cfg);
  // Float64Arrays -> plain arrays for structured clone friendliness
  const pack = (arr) => arr ? Array.from(arr) : null;
  const solution = {
    n: sol.n,
    push: sol.push.map(pack),
    call: sol.call.map(row => row.map(pack)),
    evPush: sol.evPush.map(pack),
    evCall: sol.evCall.map(row => row.map(pack)),
  };
  if (sol.open) {
    solution.open = sol.open.map(pack);
    solution.evOpen = sol.evOpen.map(pack);
    solution.rsh = sol.rsh.map(row => row.map(pack));
    solution.evRsh = sol.evRsh.map(row => row.map(pack));
    solution.c3b = sol.c3b.map(row => row.map(pack));
    solution.evC3b = sol.evC3b.map(row => row.map(pack));
    solution.openSize = sol.openSize;
  }
  self.postMessage({ type: 'done', key: cfg.key, solution });
};
