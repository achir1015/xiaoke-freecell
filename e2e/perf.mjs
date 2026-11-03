// 速算效能：比較工作池不同權重的速度
import { launch } from './lib.mjs';

const { app, win, waitFor, pickProfile } = await launch('perf');
await waitFor(() => !!document.querySelector('#homeBody .mode-grid'));
await pickProfile();
const r = await win.evaluate(async () => {
  const { Game } = await import('./js/rules.js');
  const S = window.__xkf;
  const out = {};
  for (const prof of ['fast', 'short', 'fast']) {
    const t0 = performance.now();
    const res = await Promise.all(Array.from({ length: 300 }, (_, i) => S.pool.solve(new Game(1000 + i), { profile: prof, front: false, deadline: Date.now() + 600000 })));
    out[prof + (out[prof] ? '2' : '')] = { ms: Math.round(performance.now() - t0), ok: res.filter(Boolean).length };
  }
  out.cores = S.pool.size;
  out.hc = navigator.hardwareConcurrency;
  return out;
});
console.log(r);
await app.close();
