// 接龍教學與系統說明：動畫示範牌桌＋語音講解＋練習題
import { $, $$, h, toast } from './util.js';
import { Game, cardFromCode, cardName, canStack, maxMoveCount, locFromName, suitOf, rankOf, SUITS, RANKS, CELL, FOUND } from './rules.js';
import { cardUrl } from './cards.js';

// 牌的寫法：'SK HQ C9'（S♠ H♥ D♦ C♣，T=10）
export const C = (str) => String(str || '').trim().split(/\s+/).filter(Boolean).map(cardFromCode);

const text = (s) => ({ t: 'text', s });
const kv = (rows) => ({ t: 'kv', rows });
// 示範牌桌：cols 每列由上往下；cells 四格；found 各花色已排到第幾張；moves 依序動畫（'1a' 第 1 列→暫存格 a、'12'、'1h'、'a3'）
const board = (o) => ({ t: 'board', ...o });

export const LESSONS = [
  {
    id: 'intro', title: '認識新接龍', steps: [
      { say: '新接龍又叫 FreeCell，是一個人就能玩的紙牌遊戲。52 張牌一開始全部翻開，發成 8 列：前 4 列每列 7 張，後 4 列每列 6 張。', show: board({ cols: ['SK HQ C9 D8 S4 H6 CJ', 'DK S9 H8 C3 D2 SA C5', 'HK DQ S7 C6 D9 HJ H2', 'CK SQ DJ H9 S5 D3 C4', 'S8 H7 C8 DA ST S6', 'CQ D5 HT S3 C2 H4', 'DT S2 H5 SJ CT D6', 'HA C7 D4 H3 CA D7'], note: '8 列、52 張全部看得到' }) },
      { say: '左上角是 4 個暫存格，每一格可以暫時放一張牌；右上角是 4 個回收座，要依照花色，從 A 一路排到 K。', show: board({ cols: ['', '', '', '', '', '', '', ''], cells: ['', 'H9', '', ''], found: [3, 0, 1, 0], note: '左：暫存格　右：回收座' }) },
      { say: '目標只有一個：把 52 張牌全部送上回收座。新接龍幾乎每一局都有解，只要一步一步想清楚就能過關。', show: kv([['牌數', '52 張全部翻開'], ['暫存格', '4 格，各放 1 張'], ['回收座', '依花色 A → K'], ['過關', '52 張全部歸位']]) },
    ],
  },
  {
    id: 'found', title: '送上回收座', steps: [
      { say: '每個回收座只收一種花色，而且一定要從 A 開始，接著是 2、3，一直到 K。看到 A 露出來，就先把它送上去。', show: board({ cols: ['C7 HA', 'D9 S3 H2', 'S6', 'CQ'], found: [0, 0, 0, 0], moves: ['1h', '2h'], cols4: true, note: '先送紅心 A，再送紅心 2' }) },
      { say: '順序不能跳：紅心回收座上是 2，下一張就只能放紅心 3。', show: board({ cols: ['C7 H3', 'D9 S3', 'H5', 'CQ'], found: [0, 2, 0, 0], moves: ['1h'], cols4: true, note: '紅心 3 接著紅心 2' }) },
      { say: '程式會自動把「已經安全」的牌送上回收座，例如 A 和 2；其他的牌可以點兩下、或按「全部歸位」送上去。', show: text('A、2 會自動歸位\n其他牌：點兩下或按 ⚡ 全部歸位') },
    ],
  },
  {
    id: 'stack', title: '牌列怎麼接', steps: [
      { say: '牌列裡只能把「點數小一、顏色相反」的牌接在下面。例如黑桃 6 可以接在紅心 7 或方塊 7 下面。', show: board({ cols: ['C9 H7', 'D4 S6', 'SJ D8', 'CK'], moves: ['21'], cols4: true, note: '黑 6 接在紅 7 下面' }) },
      { say: '同顏色不行，點數差兩點也不行。紅心 6 不能接在方塊 7 下面，黑桃 5 也不能接在紅心 7 下面。', show: { t: 'cards', rows: [{ label: '可以：紅 7 → 黑 6 → 紅 5', cards: 'H7 S6 D5', hl: [0, 1, 2] }, { label: '不行：同色', cards: 'D7 H6', dim: [1] }, { label: '不行：差兩點', cards: 'H7 S5', dim: [1] }] } },
      { say: '接好的一串紅黑交錯、由大到小的牌，可以整串一起搬到另一列。', show: board({ cols: ['C9 H8 S7 D6', 'D4 S9', 'SJ', 'CK'], cells: ['', '', '', ''], moves: ['12'], cols4: true, note: '紅 8、黑 7、紅 6 整串接到黑 9 下面' }) },
    ],
  },
  {
    id: 'cells', title: '暫存格', steps: [
      { say: '暫存格可以暫時放任何一張牌，讓壓在下面的牌露出來。', show: board({ cols: ['D9 HA C5', 'S8', 'HT', 'CK'], moves: ['1a', '1h'], cols4: true, note: '梅花 5 先放暫存格，紅心 A 就能歸位' }) },
      { say: '暫存格裡的牌，之後可以再接回牌列，或直接送上回收座。', show: board({ cols: ['D9', 'S8', 'H6', 'CK'], cells: ['C5', '', '', ''], moves: ['a3'], cols4: true, note: '梅花 5 接到紅心 6 下面' }) },
      { say: '但暫存格只有四格，塞滿了就很難動。好習慣是：能接回牌列就盡快接回去，留空格給關鍵的時候用。', show: text('暫存格是救命用的\n不要隨便塞滿') },
    ],
  },
  {
    id: 'empty', title: '空列的威力', steps: [
      { say: '某一列的牌全部搬走以後，就變成空列。空列可以放任何一張牌，或一整串接好的牌。', show: board({ cols: ['SQ', 'H4', 'D9 C8', ''], moves: ['24'], cols4: true, note: '空列放什麼都可以' }) },
      { say: '空列比暫存格更好用：暫存格只能放一張，空列卻能放一整串。所以清出一個空列，常常就是過關的關鍵。', show: text('清空一列 = 多一個大暫存格') },
      { say: '空列最適合放 K 開頭的一串，因為 K 不能接在任何牌下面。', show: board({ cols: ['D3 SK HQ', 'H4', 'C9', ''], moves: ['14'], cols4: true, note: 'K 開頭的一串移到空列' }) },
    ],
  },
  {
    id: 'super', title: '一次搬幾張', steps: [
      { say: '其實規則上一次只能搬一張，但只要有空的暫存格或空列幫忙中轉，就能一口氣把一串牌搬過去。', show: text('一次可以搬的張數\n=（空暫存格 + 1）× 2 的（空列數）次方') },
      { say: '例如有兩個空暫存格、沒有空列，就是二加一，一次最多搬三張。', show: board({ cols: ['C9 H8 S7 D6', 'S9', 'HT', 'CK'], cells: ['D2', '', '', 'S3'], moves: ['12'], cols4: true, note: '空暫存格 2 格 → 最多 3 張' }) },
      { say: '再多一個空列，張數就加倍：兩個空暫存格加一個空列，可以搬六張。要搬到空列的時候，那一列本身不算。', show: kv([['暫存格 0、空列 0', maxMoveCount(0, 0)], ['暫存格 2、空列 0', maxMoveCount(2, 0)], ['暫存格 2、空列 1', maxMoveCount(2, 1)], ['暫存格 4、空列 2', maxMoveCount(4, 2)]]) },
    ],
  },
  {
    id: 'tips', title: '致勝技巧', steps: [
      { say: '第一招：開局先看清楚四張 A 和 2 壓在哪裡，優先處理壓得最淺的。', show: text('先找 A 和 2') },
      { say: '第二招：盡量不要用暫存格，先用牌列互接來移動；真的要用，也要確定接下來能把它接回去。', show: text('能接就接，少用暫存格') },
      { say: '第三招：牌少的那一列最容易清空，清出空列之後局面就會變得很輕鬆。', show: text('優先清空最短的一列') },
      { say: '第四招：卡住的時候不要慌，按「悔棋」退回幾步，或請軍師提示。軍師會用速算解算器幫您算出還有沒有解。', show: text('↶ 悔棋　💡 提示　🧙 軍師') },
    ],
  },
  {
    id: 'race', title: '比賽規則', steps: [
      { say: '小柯接龍的比賽是：雙方拿同一局牌、同時開始，誰先把 52 張全部送上回收座，誰就贏這一局。', show: text('同一局牌．同時開始．先完成的贏') },
      { say: '如果有人放棄，就算對手贏；設定了時限的話，時間到時比回收座上的張數，多的人贏，一樣多就平手。', show: kv([['先全部歸位', '獲勝'], ['對手放棄', '獲勝'], ['時間到', '比回收座張數'], ['張數一樣', '平手']]) },
      { say: '每一局都有牌局號碼，和 Windows 內建的新接龍是同一套，從 1 號到 100 萬號，可以約朋友挑戰同一局。', show: text('牌局 #1 ～ #1,000,000') },
    ],
  },
];

export const SYS_LESSONS = [
  {
    id: 's-start', title: '開始比賽', steps: [
      { say: '首頁有四種玩法：真人對 AI、遠端真人對真人、AI 對 AI，以及單人練習。選好難度、局數和時限，按下開始就可以了。速算引擎一打開程式就自動準備好。', show: kv([['A 真人對 AI', '和 AI 比快'], ['B 真人對真人', '開房間、邀朋友'], ['C AI 對 AI', '觀戰'], ['D 單人練習', '自選牌局號碼']]) },
      { say: 'AI 難度有入門、中級、高手、大師四級，等級越高、每步越快，解法也越短。大師還會直接使用牌譜庫累積的最短解。', show: kv([['入門', '每步約 2.6 秒'], ['中級', '每步約 1.7 秒'], ['高手', '每步約 1.1 秒'], ['大師', '每步約 0.7 秒＋最短解']]) },
    ],
  },
  {
    id: 's-profile', title: '半身照與軍師', steps: [
      { say: '第一次使用要選半身照和 AI 軍師：20 位男性、20 位女性玩家，以及 30 位男女軍師。首頁按「更換半身照與軍師」隨時可以改，比賽中也能按「換軍師」。', show: kv([['男性玩家', '20 位'], ['女性玩家', '20 位'], ['AI 軍師', '30 位']]) },
    ],
  },
  {
    id: 's-play', title: '操作方式', steps: [
      { say: '點一下牌就選起來，再點想放的位置就搬過去；也可以直接用滑鼠拖曳。點一下一串牌的最上面那張，就會整串一起選起來。', show: text('點選 → 點目的地\n或直接拖曳') },
      { say: '點兩下牌，程式會自動幫您找最好的去處：能歸位就歸位，不然就接到牌列或放暫存格。', show: text('點兩下 = 自動搬') },
      { say: '按「悔棋」可以退回一步，鍵盤 Ctrl 加 Z 也可以；按「全部歸位」把能送的牌都送上回收座。滑鼠右鍵拖曳可以旋轉牌桌，滾輪縮放；右上角可以切換斜視、俯視、立體和全桌。', show: text('↶ 悔棋　⚡ 全部歸位\n斜視　俯視　立體　全桌') },
    ],
  },
  {
    id: 's-adv', title: 'AI 軍師', steps: [
      { say: '按「提示」，軍師會把建議搬的牌標成亮綠色，目的地也會發亮。右邊的軍師分頁可以問問題，軍師會算出這局還有沒有解、還要幾步。', show: text('💡 提示') },
      { say: '按「軍師接手」，軍師就坐上主位替您比賽；想自己玩時按「換回主位」。在設定輸入 Anthropic API 金鑰之後，軍師還會用白話解說。', show: text('🧙 軍師接手　🙋 換回主位　🔄 換軍師') },
    ],
  },
  {
    id: 's-net', title: '遠端對賽', steps: [
      { say: '在首頁按「建立房間」會得到一組六位數房號，把房號告訴朋友，朋友按「加入房間」輸入就好。沒有人加入時，由 AI 補位；之後加入的人當觀眾。', show: text('房號 123 456') },
      { say: '比賽中上方會顯示對手的半身照、回收進度和小牌桌，遠處的牌桌也會同步。聊天分頁可以打字，也可以按「加入語音」通話。', show: text('🎤 加入語音　💬 聊天') },
    ],
  },
  {
    id: 's-kb', title: '牌譜庫與速算', steps: [
      { say: '每打完一局，紀錄就自動累積到牌譜庫：誰、走幾步、用多久、結果如何，並記住每一局目前最短的解法。', show: kv([['自動累積', '每局都存'], ['最短解', '誰解得短就記誰'], ['重播', '一步一步看'], ['AI 解答', '速算最短解']]) },
      { say: '「速算」可以一次用全部核心解一大段牌局號碼，一千局只要幾秒鐘。也可以匯入、匯出牌譜檔。', show: text('⚡ 速算　📥 匯入　📤 匯出') },
    ],
  },
  {
    id: 's-sys', title: '音樂與更新', steps: [
      { say: '內建 20 首原創背景音樂，每首三分多鐘。上方的直立滑桿可以調音樂和音效的大小聲，往上是大聲。音樂分頁可以選歌，也能加入自己的音樂。', show: text('♫ 背景音樂 20 首') },
      { say: '首頁的「關於與更新」可以檢查新版本。電腦版與 Android 會下載並安裝；iPad、iPhone 會打開 GitHub 安裝頁；線上版重新載入網頁就好。', show: kv([['Windows、Mac', '下載並安裝'], ['Android', '下載 APK 安裝'], ['iPad、iPhone', 'GitHub 安裝頁'], ['線上版', '重新載入']]) },
    ],
  },
];

// 練習題：答案都由規則引擎算出來
export const PRACTICE = [
  { q: '有 2 個空暫存格、沒有空列，一次最多可以搬幾張？', kind: 'max', free: 2, empty: 0 },
  { q: '有 1 個空暫存格、1 個空列（不是搬到空列），一次最多可以搬幾張？', kind: 'max', free: 1, empty: 1 },
  { q: '有 3 個空暫存格、2 個空列，要搬到其中一個空列，一次最多可以搬幾張？', kind: 'max', free: 3, empty: 2, toEmpty: true },
  { q: '哪一張可以接在紅心 8 下面？', kind: 'stack', base: 'H8', opts: 'D7 S7 H7 C6' },
  { q: '哪一張可以接在黑桃 Q 下面？', kind: 'stack', base: 'SQ', opts: 'CJ DJ ST HK' },
  { q: '哪一張可以接在方塊 4 下面？', kind: 'stack', base: 'D4', opts: 'H3 C3 D3 S2' },
  { q: '回收座是 ♠2、♥A、♦空、♣3，哪一張現在可以送上回收座？', kind: 'found', found: [2, 1, 0, 3], opts: 'S4 H3 D2 C4' },
  { q: '回收座是 ♠5、♥4、♦4、♣空，哪一張現在可以送上回收座？', kind: 'found', found: [5, 4, 4, 0], opts: 'CA S7 H6 D6' },
];

export function practiceAnswer(p) {
  if (p.kind === 'max') return maxMoveCount(p.free, p.empty, !!p.toEmpty);
  if (p.kind === 'stack') { const b = cardFromCode(p.base); return C(p.opts).find((c) => canStack(b, c)); }
  if (p.kind === 'found') return C(p.opts).find((c) => p.found[suitOf(c)] === rankOf(c));
  return null;
}

let G = null;

export function openGuide(ctx) {
  const root = $('#guideBody');
  root.innerHTML = '';
  G = { ctx, section: ctx.section || 'teach', li: 0, si: 0, playing: false, token: 0, practice: false, pi: 0 };
  G.stage = h('div', { class: 'gd-stage' });
  G.caption = h('div', { class: 'gd-caption' });
  G.list = h('div', { class: 'gd-list' });
  G.ctrl = h('div', { class: 'gd-ctrl' },
    h('button', { onclick: () => { stopPlay(); step(-1); } }, '◀ 上一步'),
    h('button', { class: 'primary', id: 'gdPlay', onclick: () => togglePlay() }, '▶ 播放講解'),
    h('button', { onclick: () => { stopPlay(); step(1); } }, '下一步 ▶'));
  G.secBtns = h('div', { class: 'gd-section' },
    h('button', { 'data-s': 'teach', onclick: () => setSection('teach') }, '🎓 接龍教學'),
    h('button', { 'data-s': 'system', onclick: () => setSection('system') }, '📖 系統說明'));
  root.append(
    h('div', { class: 'gd-head' }, h('h2', {}, '接龍教學與系統說明'), G.secBtns, h('span', { class: 'muted small' }, ctx.voice.available ? `語音：${ctx.voice.voiceName}` : '這台電腦沒有中文語音，改用文字'),
      h('button', { class: 'gd-back', onclick: () => { stopPlay(); ctx.back(); } }, '⟵ 回首頁')),
    h('div', { class: 'gd-body' }, G.list, h('div', { class: 'gd-main' }, G.stage, h('div', { class: 'gd-side' }, G.caption, G.ctrl))));
  ctx.show();
  setSection(G.section);
  startPlay();
}

const lessons = () => (G.section === 'system' ? SYS_LESSONS : LESSONS);

function setSection(s) {
  stopPlay();
  G.section = s;
  G.li = 0; G.si = 0; G.practice = false;
  $$('button', G.secBtns).forEach((b) => b.classList.toggle('on', b.dataset.s === s));
  G.list.innerHTML = '';
  lessons().forEach((l, i) => G.list.append(h('button', { class: 'gd-item' + (i === 0 ? ' on' : ''), 'data-i': i, onclick: () => goLesson(i) }, h('span', { class: 'n' }, i + 1), l.title)));
  if (s === 'teach') G.list.append(h('button', { class: 'gd-item practice', 'data-i': 'p', onclick: () => openPractice(0) }, h('span', { class: 'n' }, '✎'), '練習題'));
  renderStep();
}

function goLesson(i) {
  stopPlay();
  G.li = i; G.si = 0; G.practice = false;
  $$('.gd-item', G.list).forEach((b) => b.classList.toggle('on', b.dataset.i === String(i)));
  renderStep();
  startPlay();
}

// ---------------- 示範牌桌（DOM 動畫） ----------------
export function demoGame(show) {
  const ncol = show.cols4 ? 4 : 8;
  const g = new Game(Array.from({ length: ncol }, (_, i) => C(show.cols[i] || '')));
  g.cells = (show.cells || ['', '', '', '']).map((x) => (x ? cardFromCode(x) : -1));
  g.found = (show.found || [0, 0, 0, 0]).slice();
  return g;
}

function renderBoard(show, token) {
  const ncol = show.cols4 ? 4 : 8;
  const box = h('div', { class: 'gb-board' });
  const slotEls = [];
  const mk = (cls, label) => { const el = h('div', { class: 'gb-slot ' + cls }, label); box.append(el); slotEls.push(el); return el; };
  for (let i = 0; i < 4; i++) mk('cell', 'ABCD'[i]);
  for (let i = 0; i < 4; i++) mk('found', SUITS[i]);
  for (let i = 0; i < ncol; i++) mk('col', String(i + 1));
  const layer = h('div', { class: 'gb-layer' });
  box.append(layer);
  if (show.note) box.append(h('div', { class: 'gb-note' }, show.note));
  G.stage.append(box);
  const g = demoGame(show);
  const imgs = new Map();
  const place = (hl) => {
    const W = box.clientWidth || 600, H = box.clientHeight || 420;
    const unit = Math.min(W / 8.4, (H - 40) / 4.2);
    const cw = unit * 0.86, ch = cw * 1.4;
    const x0 = (W - unit * 8) / 2 + unit * 0.07;
    const slotX = (j) => x0 + j * unit;
    const colX = (i) => (show.cols4 ? x0 + (i * 2 + 0.5) * unit : slotX(i));
    const topY = 8, colY = topY + ch + 16;
    const maxLen = Math.max(1, ...g.cols.map((c) => c.length));
    const dy = Math.min(ch * 0.28, (H - colY - ch - 34) / Math.max(1, maxLen - 1));
    const at = (el, x, y) => { el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.width = `${cw}px`; el.style.height = `${ch}px`; };
    slotEls.forEach((el, j) => (j < 8 ? at(el, slotX(j), topY) : at(el, colX(j - 8), colY)));
    const pos = new Map();
    g.cols.forEach((col, i) => col.forEach((c, k) => pos.set(c, [colX(i), colY + k * dy, k + 1])));
    g.cells.forEach((c, i) => { if (c >= 0) pos.set(c, [slotX(i), topY, 1]); });
    for (let s = 0; s < 4; s++) for (let r = 0; r < g.found[s]; r++) pos.set(s * 13 + r, [slotX(4 + s), topY, r + 1]);
    for (const [c, [x, y, z]] of pos) {
      let img = imgs.get(c);
      if (!img) { img = h('img', { class: 'gb-card', src: cardUrl(c), alt: cardName(c) }); layer.append(img); imgs.set(c, img); }
      img.style.width = `${cw}px`;
      img.style.left = `${x}px`; img.style.top = `${y}px`; img.style.zIndex = String(z + (hl && hl.has(c) ? 60 : 0));
      img.classList.toggle('hl', !!(hl && hl.has(c)));
    }
    for (const [c, img] of imgs) if (!pos.has(c)) { img.remove(); imgs.delete(c); }
  };
  requestAnimationFrame(() => place());
  (show.moves || []).forEach((mv, i) => {
    setTimeout(() => {
      if (token !== G.renderToken) return;
      const f = locFromName(mv[0]), t = locFromName(mv[1]);
      const n = g.moveSize(f, t);
      if (!n) return;
      const moving = new Set(f < CELL ? g.cols[f].slice(-n) : [g.cells[f - CELL]]);
      place(moving);
      setTimeout(() => {
        if (token !== G.renderToken) return;
        g.move(f, t, n, { auto: false });
        place(moving);
        setTimeout(() => { if (token === G.renderToken) place(); }, 650);
      }, 450);
    }, 900 + i * 1500);
  });
}

function renderCards(show) {
  for (const r of show.rows) {
    const list = C(r.cards);
    G.stage.append(h('div', { class: 'gd-row' }, r.label ? h('div', { class: 'gd-label' }, r.label) : null,
      h('div', { class: 'gs-row' }, list.map((c, i) => {
        const img = h('img', { src: cardUrl(c), alt: cardName(c), class: (r.hl || []).includes(i) ? 'hl' : (r.dim || []).includes(i) ? 'dim' : '' });
        img.style.animationDelay = `${i * 40}ms`;
        return img;
      }))));
  }
}

function renderStep() {
  G.renderToken = (G.renderToken || 0) + 1;
  const L = lessons()[G.li];
  const st = L.steps[G.si];
  G.caption.className = 'gd-caption';
  G.caption.innerHTML = '';
  G.caption.append(h('div', { class: 'gd-step muted small' }, `${L.title}　${G.si + 1} / ${L.steps.length}`), h('div', {}, st.say));
  G.stage.innerHTML = '';
  const show = st.show || {};
  if (show.t === 'board') renderBoard(show, G.renderToken);
  else if (show.t === 'cards') renderCards(show);
  else if (show.t === 'kv') G.stage.append(h('div', { class: 'gs-kv' }, show.rows.flatMap(([k, v]) => [h('div', {}, k), h('b', {}, String(v))])));
  else if (show.t === 'text') G.stage.append(h('div', { class: 'gs-text', style: { whiteSpace: 'pre-line' } }, show.s));
}

function step(d) {
  const ls = lessons(), L = ls[G.li];
  let si = G.si + d, li = G.li;
  if (si >= L.steps.length) { if (li + 1 >= ls.length) { if (G.section === 'teach') openPractice(0); return false; } li++; si = 0; }
  if (si < 0) { if (li === 0) return false; li--; si = ls[li].steps.length - 1; }
  G.li = li; G.si = si;
  $$('.gd-item', G.list).forEach((b) => b.classList.toggle('on', b.dataset.i === String(li)));
  renderStep();
  return true;
}

function startPlay() { if (G && !G.playing) togglePlay(); }

// 語音要把符號念成中文
export function speechText(s) {
  return String(s).replace(/♠/g, '黑桃').replace(/♥/g, '紅心').replace(/♦/g, '方塊').replace(/♣/g, '梅花').replace(/×/g, '乘').replace(/Ctrl/g, 'Control');
}

async function togglePlay() {
  if (G.playing) { stopPlay(); return; }
  G.playing = true;
  const token = ++G.token;
  const b = $('#gdPlay');
  if (b) b.textContent = '⏸ 暫停';
  for (;;) {
    const st = lessons()[G.li].steps[G.si];
    G.caption.classList.add('speaking');
    const show = st.show || {};
    const minWait = show.t === 'board' && show.moves ? 900 + show.moves.length * 1500 + 600 : 0;
    const t0 = Date.now();
    await G.ctx.voice.speak(speechText(st.say));
    G.caption.classList.remove('speaking');
    if (token !== G.token || !G.playing) return;
    const left = minWait - (Date.now() - t0);
    await new Promise((r) => setTimeout(r, Math.max(700, left)));
    if (token !== G.token || !G.playing) return;
    const ls = lessons();
    const lastOfLesson = G.si === ls[G.li].steps.length - 1;
    if (lastOfLesson && G.li === ls.length - 1) { stopPlay(); toast(G.section === 'teach' ? '全部講完了，來做練習題吧！' : '系統說明講完了', 'ok'); return; }
    step(1); // 一課講完自動接下一課
  }
}

function stopPlay() {
  if (!G) return;
  G.playing = false;
  G.token++;
  G.ctx.voice.stop();
  const b = $('#gdPlay');
  if (b) b.textContent = '▶ 播放講解';
}

function openPractice(i) {
  stopPlay();
  G.practice = true;
  G.pi = (i + PRACTICE.length) % PRACTICE.length;
  G.renderToken = (G.renderToken || 0) + 1;
  $$('.gd-item', G.list).forEach((b) => b.classList.toggle('on', b.dataset.i === 'p'));
  const p = PRACTICE[G.pi];
  const answer = practiceAnswer(p);
  G.caption.className = 'gd-caption practice';
  G.caption.innerHTML = '';
  G.caption.append(h('div', { class: 'gd-step muted small' }, `練習題 ${G.pi + 1} / ${PRACTICE.length}`), h('div', {}, p.q));
  G.stage.innerHTML = '';
  const result = h('div', { class: 'gd-result' });
  const check = (ok, msg) => {
    result.className = 'gd-result ' + (ok ? 'ok' : 'bad');
    result.textContent = msg;
    G.ctx.voice.stop();
    G.ctx.voice.speak(ok ? '答對了！' : '再想想看。');
  };
  let opts = [];
  if (p.kind === 'max') {
    G.stage.append(h('div', { class: 'gs-kv' }, h('div', {}, '空暫存格'), h('b', {}, `${p.free} 格`), h('div', {}, '空列'), h('b', {}, `${p.empty} 列`), h('div', {}, '搬到空列'), h('b', {}, p.toEmpty ? '是' : '否')));
    const set = new Set([answer, answer - 1, answer + 1, answer * 2, Math.max(1, answer - 2)]);
    opts = [...set].filter((n) => n >= 1).sort((a, b) => a - b).slice(0, 5).map((n) => [n, `${n} 張`]);
  } else {
    if (p.kind === 'stack') renderCards({ rows: [{ label: '上面那張', cards: p.base, hl: [0] }] });
    else G.stage.append(h('div', { class: 'gs-kv' }, p.found.flatMap((n, s) => [h('div', {}, `回收座 ${SUITS[s]}`), h('b', {}, n ? RANKS[n - 1] : '空')])));
    opts = C(p.opts).map((c) => [c, h('img', { class: 'gd-opt', src: cardUrl(c), alt: cardName(c) })]);
  }
  G.stage.append(h('div', { class: 'gd-choices' }, opts.map(([v, l]) => h('button', { 'data-v': v, onclick: () => check(v === answer, v === answer ? `答對了！答案是 ${typeof l === 'string' ? l : cardName(v)}。` : '不對喔，再想想看。') }, l))), result);
  G.stage.append(h('div', { class: 'gd-ctrl' }, h('button', { onclick: () => openPractice(G.pi - 1) }, '◀ 上一題'), h('button', { class: 'primary', onclick: () => openPractice(G.pi + 1) }, '下一題 ▶')));
  G.ctx.voice.stop();
  G.ctx.voice.speak(speechText(p.q));
}

export { FOUND };
