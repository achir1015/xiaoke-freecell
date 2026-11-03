// 新接龍速算解算器：加權最佳優先搜尋（A* 變形）
// 牌列用不可變陣列＋結構共用，每個節點只複製被動到的兩列；重複局面用「排序後的牌列字串」判斷（牌列互換視為同一局面）
import { Game, canStack, suitOf, rankOf, isRed, CELL, FOUND } from './rules.js';

export const ABORT = { abort: true };

// 權重組合：w 是啟發值權重、g 是已走步數權重（越大解越短、搜得越久）
export const PROFILES = {
  fast: { w: 1, g: 0.6, nodes: 300000 },      // 1000 局平均約 10 毫秒、50 步
  normal: { w: 1, g: 0.8, nodes: 300000 },    // 約 16 毫秒、48 步
  short: { w: 1, g: 1.0, nodes: 300000 },     // 約 32 毫秒、45 步
  shortest: { w: 1, g: 1.3, nodes: 300000 },  // 約 140 毫秒、42 步
  greedy: { w: 1, g: 0.35, nodes: 600000 },   // 備援：最不容易卡住
};

const red = new Uint8Array(52), rk = new Uint8Array(52), st = new Uint8Array(52);
for (let c = 0; c < 52; c++) { rk[c] = c % 13; st[c] = (c / 13) | 0; red[c] = st[c] === 1 || st[c] === 2 ? 1 : 0; }
const stack = (a, b) => rk[a] === rk[b] + 1 && red[a] !== red[b];

function safe(found, c) {
  const r = rk[c];
  if (found[st[c]] !== r) return false;
  if (r <= 1) return true;
  return red[c] ? found[0] >= r && found[3] >= r : found[1] >= r && found[2] >= r;
}

// 局面：{ cols: Array(8) of Array, cells: Array(4), found: Array(4) }
function autoPlay(s) {
  let moved = true;
  while (moved) {
    moved = false;
    for (let i = 0; i < 8; i++) {
      const col = s.cols[i];
      if (!col.length) continue;
      const c = col[col.length - 1];
      if (safe(s.found, c)) { s.cols[i] = col.slice(0, -1); s.found[st[c]]++; moved = true; }
    }
    for (let i = 0; i < 4; i++) {
      const c = s.cells[i];
      if (c >= 0 && safe(s.found, c)) { s.cells[i] = -1; s.found[st[c]]++; moved = true; }
    }
  }
}

function keyOf(s) {
  const parts = new Array(8);
  for (let i = 0; i < 8; i++) parts[i] = String.fromCharCode.apply(null, s.cols[i].map((c) => c + 40));
  parts.sort();
  const cells = s.cells.filter((c) => c >= 0).sort((a, b) => a - b).map((c) => String.fromCharCode(c + 40)).join('');
  return cells + '|' + parts.join(',');
}

function runLen(col) {
  let n = col.length ? 1 : 0;
  while (n < col.length && stack(col[col.length - n - 1], col[col.length - n])) n++;
  return n;
}

// 啟發值：還沒歸位的牌數＋「壓在更小的牌上面」的牌（每張至少還要搬一次）＋下一張要歸位的牌被壓多深
export const HW = { block: 1.0, depth: 0.25, cell: 0.45, empty: 0.9, brk: 0.3 };
function heur(s) {
  const f = s.found;
  let h = 52 - f[0] - f[1] - f[2] - f[3];
  let free = 0;
  for (let i = 0; i < 4; i++) if (s.cells[i] < 0) free++;
  let empty = 0, block = 0, depth = 0, brk = 0;
  for (let i = 0; i < 8; i++) {
    const col = s.cols[i];
    const n = col.length;
    if (!n) { empty++; continue; }
    let minR = 99;
    for (let k = 0; k < n; k++) {
      const c = col[k];
      const r = rk[c];
      if (r > minR) block++;
      else minR = r;
      if (k && !stack(col[k - 1], c)) brk++;
      if (r === f[st[c]]) depth += n - 1 - k;
    }
  }
  return h + block * HW.block + depth * HW.depth + brk * HW.brk + (4 - free) * HW.cell - empty * HW.empty;
}

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop(), lv = v.pop();
    const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

function children(s, out) {
  const cols = s.cols, cells = s.cells, found = s.found;
  let free = 0, firstFree = -1, empty = 0, firstEmpty = -1;
  for (let i = 0; i < 4; i++) if (cells[i] < 0) { free++; if (firstFree < 0) firstFree = i; }
  for (let i = 0; i < 8; i++) if (!cols[i].length) { empty++; if (firstEmpty < 0) firstEmpty = i; }
  const cap = (free + 1) << empty;
  const capEmpty = (free + 1) << Math.max(0, empty - 1);
  out.length = 0;
  // 送上回收座（安全的已自動處理，這裡是不安全但可行的）
  for (let i = 0; i < 8; i++) { const col = cols[i]; if (col.length && found[st[col[col.length - 1]]] === rk[col[col.length - 1]]) out.push(i, FOUND, 1); }
  for (let i = 0; i < 4; i++) { const c = cells[i]; if (c >= 0 && found[st[c]] === rk[c]) out.push(CELL + i, FOUND, 1); }
  // 暫存格 → 牌列
  for (let i = 0; i < 4; i++) {
    const c = cells[i];
    if (c < 0) continue;
    for (let j = 0; j < 8; j++) { const d = cols[j]; if (d.length && stack(d[d.length - 1], c)) out.push(CELL + i, j, 1); }
    if (firstEmpty >= 0) out.push(CELL + i, firstEmpty, 1);
  }
  // 牌列 → 牌列
  for (let i = 0; i < 8; i++) {
    const col = cols[i];
    const n = col.length;
    if (!n) continue;
    const run = runLen(col);
    const b = col[n - 1];
    for (let j = 0; j < 8; j++) {
      if (j === i) continue;
      const d = cols[j];
      if (!d.length) continue;
      const t = d[d.length - 1];
      const need = rk[t] - rk[b];
      if (need >= 1 && need <= run && need <= cap && stack(t, col[n - need])) out.push(i, j, need);
    }
    if (firstEmpty >= 0 && n > 1) {
      const k = Math.min(run, capEmpty);
      if (k < n) out.push(i, firstEmpty, k);
      // 也試試只搬一張到空列
      if (k > 1) out.push(i, firstEmpty, 1);
    }
  }
  // 牌列 → 暫存格
  if (firstFree >= 0) for (let i = 0; i < 8; i++) if (cols[i].length) out.push(i, CELL + firstFree, 1);
  return out;
}

function apply(s, f, t, n) {
  const ns = { cols: s.cols.slice(), cells: s.cells.slice(), found: s.found.slice() };
  let cards;
  if (f < CELL) { const col = ns.cols[f]; cards = col.slice(col.length - n); ns.cols[f] = col.slice(0, col.length - n); }
  else { cards = [ns.cells[f - CELL]]; ns.cells[f - CELL] = -1; }
  if (t < CELL) ns.cols[t] = ns.cols[t].concat(cards);
  else if (t < FOUND) ns.cells[t - CELL] = cards[0];
  else ns.found[st[cards[0]]]++;
  autoPlay(ns);
  return ns;
}

const done = (s) => s.found[0] + s.found[1] + s.found[2] + s.found[3] === 52;

export class Solver {
  constructor() { this.deadline = 0; }

  // game：Game 或 snapshot；回傳 { moves:[{f,t,n}], nodes, ms } 或 null（無解／超過上限）
  solve(game, profile = 'fast', opts = {}) {
    const P = typeof profile === 'string' ? PROFILES[profile] : profile;
    const maxNodes = opts.nodes || P.nodes;
    const t0 = Date.now();
    const root = { cols: game.cols.map((c) => c.slice()), cells: game.cells.slice(), found: game.found.slice() };
    autoPlay(root);
    if (done(root)) return { moves: [], nodes: 1, ms: 0 };
    const seen = new Map();
    const par = [-1], mv = [0], gs = [0], states = [root];
    seen.set(keyOf(root), 0);
    const heap = new Heap();
    heap.push(heur(root) * P.w, 0);
    const buf = [];
    let expanded = 0;
    while (heap.size) {
      const id = heap.pop();
      const s = states[id];
      if (++expanded > maxNodes || states.length > 1500000) return null;
      if ((expanded & 1023) === 0 && this.deadline && Date.now() > this.deadline) throw ABORT;
      children(s, buf);
      const g1 = gs[id] + 1;
      for (let i = 0; i < buf.length; i += 3) {
        const f = buf[i], t = buf[i + 1], n = buf[i + 2];
        const ns = apply(s, f, t, n);
        const k = keyOf(ns);
        const old = seen.get(k);
        if (old !== undefined && gs[old] <= g1) continue;
        const nid = states.length;
        states.push(ns); par.push(id); mv.push(f | (t << 4) | (n << 8)); gs.push(g1);
        seen.set(k, nid);
        if (done(ns)) return { moves: this.path(nid, par, mv), nodes: expanded, ms: Date.now() - t0 };
        heap.push(heur(ns) * P.w + g1 * P.g, nid);
      }
      // 已展開的節點局面可以丟掉（只留路徑），省記憶體
      if (id) states[id] = null;
    }
    return null;
  }

  path(id, par, mv) {
    const out = [];
    for (let i = id; i > 0; i = par[i]) { const x = mv[i]; out.push({ f: x & 15, t: (x >> 4) & 15, n: x >> 8 }); }
    return out.reverse();
  }

  // 依序試不同權重，在時間內找最短的解
  best(game, { budgetMs = 3000, profiles = ['fast', 'short', 'shortest'] } = {}) {
    const stop = Date.now() + budgetMs;
    let best = null;
    const saved = this.deadline;
    for (const p of profiles) {
      this.deadline = saved ? Math.min(saved, stop) : stop;
      let r = null;
      try { r = this.solve(game, p); } catch (e) { if (e !== ABORT) throw e; }
      if (r && (!best || r.moves.length < best.moves.length)) best = { ...r, profile: p };
      if (Date.now() > stop) break;
    }
    this.deadline = saved;
    if (!best && Date.now() < (saved || Infinity)) {
      // 最後再用貪婪法撐一下
      try { const r = this.solve(game, 'greedy'); if (r) best = { ...r, profile: 'greedy' }; } catch (e) { if (e !== ABORT) throw e; }
    }
    return best;
  }
}

// 驗證解法：在 Game 上逐步執行，確認真的能全部歸位
export function verify(deal, moves) {
  const g = typeof deal === 'number' ? new Game(deal) : Game.from(deal);
  g.begin();
  for (const m of moves) if (!g.move(m.f, m.t, m.n)) return false;
  return g.won;
}

export { canStack, suitOf, rankOf, isRed };
