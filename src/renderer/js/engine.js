// 主執行緒上的解算工作池：多個 Worker 同時速算
const GRACE_MS = 800;

const plain = (g) => ({ cols: g.cols.map((c) => [...c]), cells: [...g.cells], found: [...g.found] });

export class SolverPool {
  constructor(n = Math.max(1, Math.min(/Android|iPhone|iPad/.test(navigator.userAgent) ? 3 : 8, (navigator.hardwareConcurrency || 4) - 1))) {
    this.workers = Array.from({ length: n }, () => ({ w: new Worker(new URL('./solver.worker.js', import.meta.url), { type: 'module' }), job: null }));
    this.queue = [];
    this.seq = 0;
    for (const x of this.workers) {
      x.w.onmessage = (e) => {
        const j = x.job;
        x.job = null;
        if (j) { if (e.data.err) j.reject(new Error(e.data.err)); else j.resolve(e.data.r); }
        this.pump();
      };
      x.w.onerror = (e) => { const j = x.job; x.job = null; if (j) j.reject(new Error(e.message || '解算器錯誤')); this.pump(); };
    }
  }
  get size() { return this.workers.length; }

  pump() {
    for (const x of this.workers) {
      if (x.job) continue;
      let j = this.queue.shift();
      while (j && j.deadline && Date.now() > j.deadline) { j.resolve(null); j = this.queue.shift(); }
      if (!j) return;
      x.job = j;
      x.w.postMessage({ id: ++this.seq, op: j.op, a: j.a });
    }
  }

  run(op, a, { deadline = 0, front = false } = {}) {
    return new Promise((resolve, reject) => {
      const job = { op, a: deadline ? { ...a, deadline: deadline + GRACE_MS } : a, deadline, resolve, reject };
      if (front) this.queue.unshift(job); else this.queue.push(job);
      this.pump();
    });
  }

  // 解目前局面：game 是 Game（或 snapshot）
  solve(game, { profile = 'short', deadline = Date.now() + 15000, front = true } = {}) {
    return this.run('solve', { state: plain(game), profile }, { deadline, front }).catch(() => null);
  }
  // 時間內找最短解
  best(game, { budgetMs = 2500, deadline = Date.now() + budgetMs + 15000, front = true } = {}) {
    return this.run('best', { state: plain(game), budgetMs }, { deadline, front }).catch(() => null);
  }
  close() { for (const x of this.workers) x.w.terminate(); this.queue = []; }
}
