// 解算工作執行緒：每個 Worker 一個解算器，可以同時算很多局
import { Solver, ABORT } from './solver.js';

const solver = new Solver();

self.onmessage = (e) => {
  const { id, op, a } = e.data;
  try {
    solver.deadline = a.deadline || 0;
    let r;
    if (op === 'solve') r = solver.solve(a.state, a.profile || 'short', { nodes: a.nodes });
    else if (op === 'best') r = solver.best(a.state, { budgetMs: a.budgetMs || 2500, profiles: a.profiles });
    else throw new Error('未知工作');
    self.postMessage({ id, r });
  } catch (err) {
    if (err === ABORT) self.postMessage({ id, r: null });
    else self.postMessage({ id, err: String((err && err.message) || err) });
  }
};
