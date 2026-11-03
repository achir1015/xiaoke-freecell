// 牌譜庫：每一局自動累積（誰、幾步、多久、結果），每個牌局號碼記住目前最短的解法
// AI 下次遇到同一局就直接用累積的最短解（比自己現算還短時），使用者解得比 AI 短也會被學起來
export class Library {
  constructor(data) {
    const d = data || {};
    this.plays = Array.isArray(d.plays) ? d.plays : [];
    this.deals = new Map(Array.isArray(d.deals) ? d.deals.map((e) => [e.no, e]) : []);
    this.keys = new Set(this.plays.map((p) => p.k));
  }

  toJSON() { return { v: 1, plays: this.plays, deals: [...this.deals.values()] }; }

  deal(no) {
    let e = this.deals.get(no);
    if (!e) { e = { no, best: null, plays: 0, wins: 0, bestMs: 0, unsolvable: false }; this.deals.set(no, e); }
    return e;
  }

  // 記住解法：moves 是記譜文字（3a 18 …），n 是步數
  learn(no, moves, n, by, date = new Date().toISOString()) {
    if (!no || !moves) return false;
    const e = this.deal(no);
    if (e.best && e.best.n <= n) return false;
    e.best = { n, moves, by, date };
    e.unsolvable = false;
    return true;
  }
  bestFor(no) { const e = this.deals.get(no); return e && e.best ? e.best : null; }
  markUnsolvable(no) { this.deal(no).unsolvable = true; }

  // 一局的紀錄：{ k, m, no, date, mode, names, kinds, res:[{ n, ms, found, done, resigned }], winner, me }
  add(p) {
    if (!p || this.keys.has(p.k)) return false;
    this.plays.push(p);
    this.keys.add(p.k);
    const e = this.deal(p.no);
    e.plays++;
    if (p.me >= 0) {
      const r = p.res[p.me];
      if (p.winner === p.me) e.wins++;
      if (r && r.done && (!e.bestMs || r.ms < e.bestMs)) e.bestMs = r.ms;
    }
    return true;
  }

  removeMatch(m) {
    this.plays = this.plays.filter((p) => p.m !== m);
    this.keys = new Set(this.plays.map((p) => p.k));
  }

  // 條件查詢：q（牌局號碼或名字）、result（win/lose/draw/all）、mode
  filter({ q = '', result = 'all', mode = 'all' } = {}) {
    const qs = String(q).trim();
    const no = /^#?\d+$/.test(qs) ? Number(qs.replace('#', '')) : 0;
    return this.plays.filter((p) => {
      if (mode !== 'all' && p.mode !== mode) return false;
      if (no && p.no !== no) return false;
      if (qs && !no && !(p.names || []).some((n) => String(n).includes(qs))) return false;
      if (result !== 'all') {
        if (p.me < 0) return false;
        const r = p.winner === p.me ? 'win' : p.winner < 0 ? 'draw' : 'lose';
        if (r !== result) return false;
      }
      return true;
    });
  }

  stats(list = this.plays) {
    const mine = list.filter((p) => p.me >= 0);
    const wins = mine.filter((p) => p.winner === p.me).length;
    const done = mine.map((p) => p.res[p.me]).filter((r) => r && r.done);
    const avgMs = done.length ? done.reduce((a, r) => a + r.ms, 0) / done.length : 0;
    const fastest = done.length ? Math.min(...done.map((r) => r.ms)) : 0;
    const fewest = done.length ? Math.min(...done.map((r) => r.n)) : 0;
    let solved = 0, steps = 0;
    for (const e of this.deals.values()) if (e.best) { solved++; steps += e.best.n; }
    return {
      total: list.length, mine: mine.length, wins, rate: mine.length ? wins / mine.length : 0,
      avgMs, fastest, fewest, deals: this.deals.size, solved, avgBest: solved ? steps / solved : 0,
      unsolvable: [...this.deals.values()].filter((e) => e.unsolvable).length,
    };
  }
}
