// 新接龍（FreeCell）規則：微軟相容發牌、合法走法、一次搬多張、自動歸位、記譜
// 牌的編號：花色(0♠ 1♥ 2♦ 3♣)×13＋點數(0=A … 12=K)
// 位置編號：0～7 牌列、8～11 暫存格、12 回收座
export const SUITS = ['♠', '♥', '♦', '♣'];
export const SUIT_NAME = ['黑桃', '紅心', '方塊', '梅花'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const RANK_SPEECH = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const CELL = 8, FOUND = 12;
export const MAX_DEAL = 1000000;
// 一百萬局裡已知無解的牌局
export const UNSOLVABLE = new Set([11982, 146692, 186216, 455889, 495505, 512118, 517776, 781948]);

export const suitOf = (c) => (c / 13) | 0;
export const rankOf = (c) => c % 13;
export const isRed = (c) => { const s = (c / 13) | 0; return s === 1 || s === 2; };
export const cardName = (c) => SUITS[suitOf(c)] + RANKS[rankOf(c)];
export const cardSpeech = (c) => SUIT_NAME[suitOf(c)] + RANK_SPEECH[rankOf(c)];
// b 可以接在 a 下面：點數小一、顏色相反
export const canStack = (a, b) => rankOf(a) === rankOf(b) + 1 && isRed(a) !== isRed(b);

export function cardFromCode(code) {
  const m = /^([SHDC])(10|[2-9TJQKA])$/i.exec(String(code).trim());
  if (!m) throw new Error('牌的寫法不對：' + code);
  const r = { A: 0, T: 9, '10': 9, J: 10, Q: 11, K: 12 }[m[2].toUpperCase()] ?? Number(m[2]) - 1;
  return 'SHDC'.indexOf(m[1].toUpperCase()) * 13 + r;
}
export const cardCode = (c) => 'SHDC'[suitOf(c)] + 'A23456789TJQK'[rankOf(c)];

// 微軟 FreeCell 發牌（第 1～1,000,000 局，與 Windows 內建新接龍同一副牌）
export function msDeal(no) {
  let seed = no >>> 0;
  const rand = () => { seed = (seed * 214013 + 2531011) % 2147483648; return Math.floor(seed / 65536); };
  const deck = Array.from({ length: 52 }, (_, i) => i);
  const cols = [[], [], [], [], [], [], [], []];
  for (let i = 0; i < 52; i++) {
    const left = 52 - i;
    const j = rand() % left;
    const m = deck[j];
    deck[j] = deck[left - 1];
    // 微軟編號：點數 = m>>2，花色 0♣ 1♦ 2♥ 3♠
    cols[i % 8].push((3 - (m & 3)) * 13 + (m >> 2));
  }
  return cols;
}

export const locName = (l) => (l < CELL ? String(l + 1) : l < FOUND ? 'abcd'[l - CELL] : 'h');
export function locFromName(s) {
  s = String(s).toLowerCase();
  if (/^[1-8]$/.test(s)) return Number(s) - 1;
  if (/^[a-d]$/.test(s)) return CELL + 'abcd'.indexOf(s);
  if (s === 'h') return FOUND;
  return -1;
}
export const locLabel = (l) => (l < CELL ? `第 ${l + 1} 列` : l < FOUND ? `暫存格 ${'ABCD'[l - CELL]}` : '回收座');

// 一次可以搬幾張：(空暫存格＋1) × 2^(空列數)；搬到空列時那一列不算
export const maxMoveCount = (freeCells, emptyCols, toEmpty = false) => (freeCells + 1) * 2 ** Math.max(0, emptyCols - (toEmpty ? 1 : 0));

export class Game {
  constructor(deal = 1) {
    this.deal = deal;
    this.cols = typeof deal === 'number' ? msDeal(deal) : deal.map((c) => [...c]);
    this.cells = [-1, -1, -1, -1];
    this.found = [0, 0, 0, 0];
    this.history = []; // 每一步 { m, autos: [m...] }
    this.moveCount = 0;
  }

  static from(st) {
    const g = new Game(st.cols);
    g.deal = st.deal;
    g.cells = [...st.cells];
    g.found = [...st.found];
    g.moveCount = st.moveCount || 0;
    return g;
  }
  snapshot() { return { deal: this.deal, cols: this.cols.map((c) => [...c]), cells: [...this.cells], found: [...this.found], moveCount: this.moveCount }; }
  clone() { const g = Game.from(this.snapshot()); g.history = this.history.slice(); return g; }

  // 開局：先把一開始就露出來的 A、2 送上回收座（不算步數）
  begin() { return this.autoPlay(); }

  get foundCount() { return this.found[0] + this.found[1] + this.found[2] + this.found[3]; }
  get won() { return this.foundCount === 52; }
  freeCells() { let n = 0; for (const c of this.cells) if (c < 0) n++; return n; }
  emptyCols() { let n = 0; for (const c of this.cols) if (!c.length) n++; return n; }
  maxMove(toEmpty) { return maxMoveCount(this.freeCells(), this.emptyCols(), toEmpty); }

  // 牌列底部連續合法的長度
  runLength(i) {
    const c = this.cols[i];
    if (!c.length) return 0;
    let n = 1;
    while (n < c.length && canStack(c[c.length - n - 1], c[c.length - n])) n++;
    return n;
  }
  top(l) {
    if (l < CELL) { const c = this.cols[l]; return c.length ? c[c.length - 1] : -1; }
    if (l < FOUND) return this.cells[l - CELL];
    return -1;
  }
  // 從 from 位置拿起的第 n 張（n=1 最上面）
  cardAt(from, n = 1) {
    if (from < CELL) { const c = this.cols[from]; return c[c.length - n] ?? -1; }
    return n === 1 ? this.cells[from - CELL] : -1;
  }
  canFound(c) { return c >= 0 && this.found[suitOf(c)] === rankOf(c); }

  // from → to 要搬幾張才合法（0 = 不行）；n 指定張數時只檢查那個張數
  moveSize(from, to, n = 0) {
    if (from === to || from >= FOUND) return 0;
    if (from >= CELL) {
      const c = this.cells[from - CELL];
      if (c < 0 || (n && n !== 1)) return 0;
      if (to === FOUND) return this.canFound(c) ? 1 : 0;
      if (to >= CELL) return this.cells[to - CELL] < 0 ? 1 : 0;
      const t = this.top(to);
      return t < 0 || canStack(t, c) ? 1 : 0;
    }
    const col = this.cols[from];
    if (!col.length) return 0;
    if (to === FOUND) return (!n || n === 1) && this.canFound(col[col.length - 1]) ? 1 : 0;
    if (to >= CELL) return (!n || n === 1) && this.cells[to - CELL] < 0 ? 1 : 0;
    const run = this.runLength(from);
    const dst = this.cols[to];
    if (!dst.length) {
      const cap = Math.min(run, this.maxMove(true));
      if (n) return n <= cap ? n : 0;
      return cap;
    }
    const t = dst[dst.length - 1];
    // 必須搬到剛好接得上的那一張
    const need = rankOf(t) - rankOf(col[col.length - 1]);
    if (need < 1 || need > run) return 0;
    if (!canStack(t, col[col.length - need])) return 0;
    if (n && n !== need) return 0;
    return need <= this.maxMove(false) ? need : 0;
  }

  // 執行一步（不做合法檢查，請先呼叫 moveSize）
  rawMove(m) {
    const { f, t, n } = m;
    let cards;
    if (f < CELL) cards = this.cols[f].splice(this.cols[f].length - n, n);
    else { cards = [this.cells[f - CELL]]; this.cells[f - CELL] = -1; }
    if (t < CELL) this.cols[t].push(...cards);
    else if (t < FOUND) this.cells[t - CELL] = cards[0];
    else this.found[suitOf(cards[0])]++;
    return cards;
  }

  move(f, t, n = 0, { auto = true } = {}) {
    const k = this.moveSize(f, t, n);
    if (!k) return null;
    const m = { f, t, n: k, c: this.cardAt(f, k) };
    this.rawMove(m);
    this.moveCount++;
    const step = { m, autos: auto ? this.autoPlay() : [] };
    this.history.push(step);
    return step;
  }

  // 安全的自動歸位：A、2 一定可以；其他牌要等兩門異色花色都排到點數 -1 之後，這張牌已經不會再被用來接牌
  safeToFound(c) {
    if (!this.canFound(c)) return false;
    const r = rankOf(c);
    if (r <= 1) return true;
    const red = isRed(c);
    const opp = red ? [0, 3] : [1, 2];
    return this.found[opp[0]] >= r && this.found[opp[1]] >= r;
  }

  autoPlay(all = false) {
    const autos = [];
    for (let again = true; again;) {
      again = false;
      for (let l = 0; l < FOUND; l++) {
        const c = this.top(l);
        if (c >= 0 && (all ? this.canFound(c) : this.safeToFound(c))) {
          const m = { f: l, t: FOUND, n: 1, c };
          this.rawMove(m);
          autos.push(m);
          again = true;
        }
      }
    }
    return autos;
  }

  // 手動「全部歸位」：能送的都送上去（會記成一步）
  collectAll() {
    const autos = this.autoPlay(true);
    if (!autos.length) return null;
    const step = { m: null, autos };
    this.history.push(step);
    return step;
  }

  undo() {
    const step = this.history.pop();
    if (!step) return null;
    for (const a of [...step.autos].reverse()) this.unmove(a);
    if (step.m) { this.unmove(step.m); this.moveCount--; }
    return step;
  }
  // 把一步倒回去：從目的地拿回 n 張放回原處
  unmove(m) {
    let cards;
    if (m.t === FOUND) { this.found[suitOf(m.c)]--; cards = [m.c]; }
    else if (m.t >= CELL) { cards = [this.cells[m.t - CELL]]; this.cells[m.t - CELL] = -1; }
    else cards = this.cols[m.t].splice(this.cols[m.t].length - m.n, m.n);
    if (m.f < CELL) this.cols[m.f].push(...cards); else this.cells[m.f - CELL] = cards[0];
  }

  // 所有合法走法（給 UI 判斷卡死、給提示用）
  legalMoves() {
    const out = [];
    for (let f = 0; f < FOUND; f++) {
      if (this.top(f) < 0) continue;
      for (let t = 0; t <= FOUND; t++) {
        if (t >= CELL && t < FOUND && f >= CELL) continue; // 暫存格之間互搬沒有意義
        const n = this.moveSize(f, t);
        if (n) out.push({ f, t, n });
      }
    }
    return out;
  }
  stuck() { return !this.won && !this.legalMoves().some((m) => !(m.t >= CELL && m.t < FOUND && m.f < CELL && this.cols[m.f].length === 1)); }

  // 給畫面的資料
  view() { return { deal: this.deal, cols: this.cols, cells: this.cells, found: this.found, moveCount: this.moveCount, won: this.won }; }
}

// ---------------- 記譜 ----------------
// 標準寫法：3a（第 3 列 → 暫存格 a）、a4、18、3h；搬到空列且多張時寫成 18:3
export function moveToText(m) {
  return locName(m.f) + locName(m.t) + (m.t < CELL && m.n > 1 ? ':' + m.n : '');
}
export function movesToText(steps) { return steps.filter((s) => s.m).map((s) => moveToText(s.m)).join(' '); }

export function parseMoves(text) {
  const out = [];
  for (const tok of String(text).trim().split(/[\s,]+/).filter(Boolean)) {
    const m = /^([1-8a-dh])([1-8a-dh])(?::(\d+))?$/i.exec(tok);
    if (!m) throw new Error('看不懂的走法：' + tok);
    out.push({ f: locFromName(m[1]), t: locFromName(m[2]), n: m[3] ? Number(m[3]) : 0 });
  }
  return out;
}

// 依走法重播到第 k 步，回傳 Game
export function replayGame(deal, moves, k = moves.length) {
  const g = new Game(deal);
  g.begin();
  for (let i = 0; i < k && i < moves.length; i++) {
    const m = moves[i];
    if (!g.move(m.f, m.t, m.n)) throw new Error(`第 ${i + 1} 步不合法：${moveToText({ ...m, n: m.n || 1 })}`);
  }
  return g;
}

// 用白話說明一步
export function describeMove(g, m) {
  const c = m.c ?? g.cardAt(m.f, m.n);
  const what = m.n > 1 ? `${cardName(c)} 開頭的 ${m.n} 張` : cardName(c);
  if (m.t === FOUND) return `把 ${what} 送上回收座`;
  if (m.t >= CELL) return `把 ${what} 放進暫存格`;
  const dst = g.cols[m.t];
  if (!dst.length) return `把 ${what} 移到空的第 ${m.t + 1} 列`;
  return `把 ${what} 接到第 ${m.t + 1} 列的 ${cardName(dst[dst.length - 1])} 下面`;
}

export const fmtTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
