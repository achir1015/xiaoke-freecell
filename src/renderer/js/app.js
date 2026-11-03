// 小柯機器人接龍遊戲：主控流程（真人對 AI、AI 對 AI、遠端真人、單人練習、軍師接手、牌譜庫、重播）
// 比賽方式：雙方拿同一局牌同時開始，先把 52 張全部送上回收座的人贏；放棄或時間到時比回收座張數。
import { $, $$, h, toast, modal, sleep, errMsg, fmtDate, uid } from './util.js';
import {
  Game, CELL, FOUND, MAX_DEAL, UNSOLVABLE, cardName, cardSpeech, canStack, rankOf, suitOf, isRed,
  moveToText, movesToText, parseMoves, replayGame, describeMove, fmtTime, maxMoveCount, SUITS, RANKS,
} from './rules.js';
import { verify } from './solver.js';
import { SolverPool } from './engine.js';
import { Library } from './kb.js';
import { Table3D } from './table3d.js';
import { drawMini } from './miniboard.js';
import { Room, PROTOCOL } from './net.js';
import { MusicPlayer } from './music.js';
import { AdvisorPanel } from './advisor-ui.js';
import { sfx, setSfx, setSfxVolume, sfxVolume } from './sfx.js';
import { voice } from './voice.js';
import { loadPortraits, portraitUrl, pickProfile, pickAdvisor, randomProfile, validProfile, labelOf } from './portraits.js';
import { openGuide } from './guide.js';

const APP_NAME = '小柯機器人接龍遊戲';
const CREDIT = '遊戲開發：吳玉柱 先生 與 Claude AI Opus 5.5';
export const LEVELS = [
  { name: '入門', ms: 2600, profile: 'fast', think: 2600 },
  { name: '中級', ms: 1700, profile: 'normal', think: 2000 },
  { name: '高手', ms: 1100, profile: 'short', think: 1500 },
  { name: '大師', ms: 700, profile: 'best', think: 1200 },
];
const ADVISOR_PACE = { name: '軍師', ms: 900, profile: 'best', think: 600 };
const SPEEDS = [['fast', '快', 0.4], ['normal', '一般', 1], ['slow', '慢', 1.7]];
const ROUNDS = [[1, '1 局'], [3, '3 局'], [5, '5 局'], [7, '7 局']];
const LIMITS = [[0, '不限時'], [5, '5 分鐘'], [10, '10 分鐘'], [15, '15 分鐘']];
const COUNTDOWN = 3;

const S = {
  settings: null, info: null, screen: 'home',
  mode: null,          // ai | aivai | net | solo | replay
  players: [],         // { name, kind: me|ai|remote, level, profile, game, ms, done, resigned, proxy, token, left }
  me: -1, main: 0,
  match: null,         // { total, idx, wins:[0,0], draws, history, limitMs, cfg }
  round: null,         // { no, idx, total, limitMs, startAt, over, winner, started }
  matchId: '',
  paused: false, pauseAt: 0,
  sel: null,
  lib: null, pool: null,
  room: null, net: null,
  voice: { on: false, mic: null, calls: new Map() },
  replay: null,
  aivaiMul: 1,
};
let table, music, advisor;

const newMatchId = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + uid().slice(-6);
const myName = () => S.settings.playerName || '玩家';
const lvName = (i) => LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i ?? 1))].name;
const isAuthority = () => S.mode === 'ai' || S.mode === 'aivai' || S.mode === 'solo' || (S.mode === 'net' && S.net && S.net.role === 'host');
const nearIdx = () => (S.me >= 0 ? S.me : S.main);
const farIdx = () => (S.players.length > 1 ? 1 - nearIdx() : -1);
const me = () => (S.me >= 0 ? S.players[S.me] : null);
const randomDeal = () => { for (;;) { const n = 1 + Math.floor(Math.random() * MAX_DEAL); if (!UNSOLVABLE.has(n)) return n; } };

// ---------------- 啟動 ----------------
async function init() {
  S.settings = await xk.settings.get();
  S.info = await xk.sys.info();
  setSfx(S.settings.sfx);
  setSfxVolume(S.settings.sfxVolume ?? 0.8);
  voice.enabled = S.settings.voiceCall !== false;
  await loadPortraits();
  S.lib = new Library(await xk.kb.get());
  // 一進來就啟動速算引擎，不需要使用者做任何事
  S.pool = new SolverPool();

  table = new Table3D($('#board'), { onDrop, onClick: onBoardClick, onDouble: onBoardDouble, mobile: !!xk.mobile, touch: !!xk.touch });
  setView(S.settings.view || 'tilt', false);

  music = new MusicPlayer($('#musicPanel'), S.settings, (patch) => saveSettings(patch));
  await music.load();
  if (S.settings.music.autoplay && S.settings.music.enabled !== false) {
    const start = () => { music.play(); document.removeEventListener('pointerdown', start); };
    document.addEventListener('pointerdown', start);
  }
  music.renderState();

  advisor = new AdvisorPanel($('#advisorPanel'), () => {
    const p = me();
    return {
      game: p && p.game, opp: farIdx() >= 0 && S.players[farIdx()].game ? S.players[farIdx()].game.view() : null,
      names: [p ? p.name : '', farIdx() >= 0 ? S.players[farIdx()].name : ''],
      round: S.round && S.match ? { idx: S.round.idx, total: S.round.total, score: `${S.match.wins[S.me] ?? 0}：${S.match.wins[1 - S.me] ?? 0}` } : null,
      analyze: () => analyzeForMe(), showHint: (a) => showHint(a),
    };
  });
  advisor.setHasKey(S.settings.advisor.hasKey);
  if (S.settings.profile) advisor.setAdvisor(S.settings.profile.advisor);

  bindUI();
  if (xk.touch) $('.board-tip').textContent = '點一下牌選取、再點目的地；也可以拖曳．點兩下自動搬．兩指拖曳旋轉、捏合縮放';
  renderHome();
  showScreen('home');
  setInterval(tick, 250);
  tick();
  document.addEventListener('pointerdown', () => sfx.resume(), { once: true });
  window.__xkf = S; // 方便自動化測試
  window.__xkfTable = table;
  window.__xkfApi = { startAIGame, startAIvAI, startSolo, tryMove, nextRound: () => authNextRound(), openReplayByKey, endRound, solveAll: () => batchSolve(1, 100) };
  if (!validProfile(S.settings.profile)) await chooseProfile(true);
  if (S.settings.autoUpdate !== false && S.info.packaged && !S.info.profile) setTimeout(() => checkUpdate(false), 5000);
}

async function saveSettings(patch) {
  S.settings = await xk.settings.set(patch);
  return S.settings;
}

async function chooseProfile(required) {
  const pr = await pickProfile(S.settings.profile, { required });
  if (pr) { await saveSettings({ profile: pr }); advisor.setAdvisor(pr.advisor); renderHome(); }
}

// ---------------- 畫面切換 ----------------
function showScreen(name) {
  S.screen = name;
  setDrawer(false);
  $$('.screen').forEach((el) => el.classList.toggle('on', el.id === 'scr-' + name));
  if (name === 'game') setTimeout(() => table.resize(), 30);
  if (name === 'kb') renderKB();
}

function bindUI() {
  $('#btnHome').onclick = () => leaveGame();
  $('#viewTilt').onclick = () => setView('tilt');
  $('#viewTop').onclick = () => setView('top');
  $('#viewLow').onclick = () => setView('low');
  $('#viewWide').onclick = () => setView('wide');
  $('#btnHint').onclick = () => hint();
  $('#btnUndo').onclick = () => undo();
  $('#btnCollect').onclick = () => collectAll();
  $('#btnProxy').onclick = () => toggleProxy();
  $('#btnChangeAdv').onclick = () => changeAdvisor();
  $('#btnResign').onclick = () => resignMe();
  $('#btnSwap').onclick = () => { S.main = 1 - S.main; S.sel = null; renderAll(); };
  $('#btnPause').onclick = () => togglePause();
  $('#btnNext').onclick = () => onNextClick();
  $('#miniMusic').onclick = () => { selectTab('music'); music.toggle(); if (xk.mobile) setDrawer(true); };
  $('#btnDrawer').onclick = () => setDrawer(!document.documentElement.classList.contains('drawer-open'));
  $('#drawerShade').onclick = () => setDrawer(false);
  window.__xkbBack = onBackKey;
  $('#btnSfx').onclick = () => { const on = !S.settings.sfx; setSfx(on); saveSettings({ sfx: on }); renderVolume(); };
  const mv = $('#musicVol');
  mv.oninput = () => { music.cfg.volume = mv.value / 100; music.applyVolume(); music.persist(); };
  const sv = $('#sfxVol');
  sv.oninput = () => { setSfxVolume(sv.value / 100); sfx.select(); clearTimeout(sv._t); sv._t = setTimeout(() => saveSettings({ sfxVolume: sfxVolume() }), 400); };
  renderVolume();
  $$('.tab').forEach((t) => { t.onclick = () => { t.classList.remove('ping'); selectTab(t.dataset.tab); }; });
  $('#chatSend').onclick = () => sendChat();
  $('#chatInput').onkeydown = (e) => { if (e.key === 'Enter') sendChat(); };
  $('#btnVoice').onclick = () => toggleVoice();
  $('#btnMute').onclick = () => toggleMute();
  $('#rpStart').onclick = () => replayGo(0);
  $('#rpPrev').onclick = () => replayGo(S.replay.step - 1);
  $('#rpNext').onclick = () => replayGo(S.replay.step + 1);
  $('#rpEnd').onclick = () => replayGo(S.replay.total);
  $('#rpPlay').onclick = () => replayAuto();
  $('#rpAI').onclick = () => replayAI();
  document.addEventListener('keydown', (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.querySelector('.modal-back')) return;
    if (S.mode === 'replay') {
      if (e.key === 'ArrowLeft') replayGo(S.replay.step - 1);
      if (e.key === 'ArrowRight') replayGo(S.replay.step + 1);
      return;
    }
    if (S.screen !== 'game') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (e.key === 'Escape') { S.sel = null; table.setSelection(null); }
    else if (e.key.toLowerCase() === 'h') hint();
  });
}

function renderVolume() {
  $('#musicVol').value = Math.round((music ? music.cfg.volume : 0.45) * 100);
  $('#sfxVol').value = Math.round(sfxVolume() * 100);
  $('#btnSfx').textContent = S.settings.sfx ? '🔔' : '🔕';
}

function setDrawer(on) { document.documentElement.classList.toggle('drawer-open', !!on); }

// Android 返回鍵：先關對話框、抽屜，再離開牌桌；回傳 true 表示已處理
function onBackKey() {
  const back = [...document.querySelectorAll('.modal-back')].pop();
  if (back) { const btns = [...back.querySelectorAll('.modal-btns button')]; (btns.find((b) => !b.classList.contains('primary')) || btns[0])?.click(); return true; }
  if (document.documentElement.classList.contains('drawer-open')) { setDrawer(false); return true; }
  if (S.screen === 'guide') { document.querySelector('.gd-back')?.click(); return true; }
  if (S.screen === 'kb') { showScreen('home'); return true; }
  if (S.screen === 'game') { leaveGame(); return true; }
  return false;
}

function selectTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
  $$('.tabpane').forEach((p) => p.classList.toggle('on', p.id === 'pane-' + name));
}

function setView(v, save = true) {
  table.setView(v);
  $$('.viewbtn').forEach((b) => b.classList.toggle('on', b.id === 'view' + v[0].toUpperCase() + v.slice(1)));
  if (save) saveSettings({ view: v });
}

const WEEK = '日一二三四五六';
function tick() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const txt = `西元 ${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日（${WEEK[d.getDay()]}）${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const el = $('#clock');
  if (el) el.textContent = txt;
  const hc = $('#homeClock');
  if (hc) hc.textContent = txt;
  if (S.screen === 'game' && S.round && S.round.started) {
    renderClocks();
    // 時間到：比回收座張數
    if (isAuthority() && !S.round.over && S.round.limitMs && roundElapsed() >= S.round.limitMs) timeUp();
  }
}

// ---------------- 首頁 ----------------
function seg(options, value, onPick) {
  const el = h('div', { class: 'seg' }, ...options.map(([v, l]) => h('button', { class: 'segbtn' + (String(v) === String(value) ? ' on' : ''), 'data-v': v, onclick: () => { $$('.segbtn', el).forEach((b) => b.classList.toggle('on', b.dataset.v === String(v))); el.dataset.v = v; onPick && onPick(v); } }, l)));
  el.dataset.v = value;
  return el;
}
const sel = (id, list, val) => h('select', { class: 'lv', id }, list.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) }, l)));
const lvSelect = (id, val) => sel(id, LEVELS.map((l, i) => [i, l.name]), val);
const dealInput = (id, val) => h('input', { class: 'num-in deal-in', id, type: 'number', min: 1, max: MAX_DEAL, placeholder: '隨機', value: val || '' });

function renderHome() {
  const home = $('#homeBody');
  home.innerHTML = '';
  const pr = S.settings.profile || {};
  const mc = S.settings.match || {};
  const nameInput = h('input', { class: 'name-in', value: myName(), maxLength: 16, onchange: (e) => saveSettings({ playerName: e.target.value.trim() || '玩家' }) });

  const lvA = lvSelect('lvAI', mc.level ?? 1);
  const rdA = sel('rdAI', ROUNDS, mc.rounds || 3);
  const lmA = sel('lmAI', LIMITS, mc.limit || 0);
  const dlA = dealInput('dealAI', mc.deal);
  const cardAI = h('div', { class: 'card mode-card' },
    h('div', { class: 'card-icon' }, '🤖'),
    h('h2', {}, 'A　真人對 AI'),
    h('p', { class: 'muted' }, '不需要網路。您和 AI 拿同一局牌同時開始，先把 52 張全部送上回收座的人贏。AI 軍師在旁指點，也可以接手您的主位。'),
    h('div', { class: 'two-col' }, h('div', {}, h('label', {}, 'AI 難度：'), lvA), h('div', {}, h('label', {}, '局數：'), rdA)),
    h('div', { class: 'two-col' }, h('div', {}, h('label', {}, '每局時限：'), lmA), h('div', {}, h('label', {}, '第一局牌局號碼：'), dlA)),
    h('button', { class: 'primary big', id: 'startAI', onclick: () => {
      const cfg = { level: Number(lvA.value), rounds: Number(rdA.value), limit: Number(lmA.value), deal: Number(dlA.value) || 0 };
      saveSettings({ match: cfg });
      startAIGame(cfg);
    } }, '開始比賽'));

  const nc = S.settings.netCfg || {};
  const lvB = lvSelect('lvNet', nc.aiLevel ?? 1);
  const rdB = sel('rdNet', ROUNDS, nc.rounds || 3);
  const lmB = sel('lmNet', LIMITS, nc.limit || 0);
  const codeIn = h('input', { class: 'code-in', id: 'joinCode', placeholder: '輸入 6 位數房號', maxLength: 7, inputMode: 'numeric' });
  const cardNet = h('div', { class: 'card mode-card' },
    h('div', { class: 'card-icon' }, '🌐'),
    h('h2', {}, 'B　真人對真人（遠端）'),
    h('p', { class: 'muted' }, '建立房間、把房號告訴朋友，兩人同一局牌比快。沒有人加入時由 AI 補位；之後加入的人當觀眾。可以語音通話、文字聊天。'),
    h('div', { class: 'two-col' }, h('div', {}, h('label', {}, '局數：'), rdB), h('div', {}, h('label', {}, '每局時限：'), lmB)),
    h('div', { class: 'two-col' }, h('div', {}, h('label', {}, '補位 AI 難度：'), lvB), h('div', {})),
    h('button', { class: 'primary', id: 'btnHost', onclick: () => { const cfg = { aiLevel: Number(lvB.value), rounds: Number(rdB.value), limit: Number(lmB.value) }; saveSettings({ netCfg: cfg }); hostRoom(cfg); } }, '建立房間（我當房主）'),
    h('div', { class: 'net-or' }, '或'),
    h('div', { class: 'net-row' }, codeIn, h('button', { class: 'primary', id: 'btnJoin', onclick: () => joinRoom(codeIn.value) }, '加入房間')),
    h('div', { id: 'netWait', class: 'net-wait hidden' }));

  const av = S.settings.aivai || {};
  const lv1 = lvSelect('aivaiA', av.a ?? 2), lv2 = lvSelect('aivaiB', av.b ?? 3);
  const speedSel = seg(SPEEDS.map(([v, l]) => [v, l]), av.speed || 'normal');
  const rdC = sel('rdAivai', ROUNDS, av.rounds || 3);
  const cardAivai = h('div', { class: 'card mode-card' },
    h('div', { class: 'card-icon' }, '🎬'),
    h('h2', {}, 'C　AI 對 AI'),
    h('p', { class: 'muted' }, '坐下來觀戰，看兩位 AI 用速算解法搶快。可以隨時換主畫面、看全桌，每一局的解法都會累積到牌譜庫。'),
    h('div', { class: 'two-col' }, h('div', {}, h('label', {}, '甲方難度：'), lv1), h('div', {}, h('label', {}, '乙方難度：'), lv2)),
    h('div', { class: 'two-col' }, h('div', {}, h('label', {}, '每步速度：'), speedSel), h('div', {}, h('label', {}, '局數：'), rdC)),
    h('button', { class: 'primary big', id: 'startAivai', onclick: () => {
      const cfg = { a: Number(lv1.value), b: Number(lv2.value), speed: speedSel.dataset.v, rounds: Number(rdC.value) };
      saveSettings({ aivai: cfg });
      startAIvAI(cfg);
    } }, '開始觀戰'));

  const so = S.settings.solo || {};
  const dlD = dealInput('dealSolo', so.deal);
  const cardSolo = h('div', { class: 'card mode-card solo-card' },
    h('div', { class: 'card-icon' }, '🃏'),
    h('h2', {}, 'D　單人練習'),
    h('p', { class: 'muted' }, '自己慢慢玩，可以指定牌局號碼（1～1,000,000，與 Windows 新接龍相同）。軍師陪在旁邊，過關後和 AI 最短解比一比。'),
    h('div', { class: 'two-col' }, h('div', {}, h('label', {}, '牌局號碼：'), dlD), h('div', {})),
    h('button', { class: 'primary big', id: 'startSolo', onclick: () => { const cfg = { deal: Number(dlD.value) || 0 }; saveSettings({ solo: cfg }); startSolo(cfg); } }, '開始練習'));

  const profileCard = h('div', { class: 'profile-card' },
    h('img', { class: 'pc-avatar', src: portraitUrl(pr.avatar), title: '我的半身照' }),
    h('div', { class: 'pc-mid' },
      h('label', {}, '我的暱稱'), nameInput,
      h('div', { class: 'pc-adv' }, h('img', { src: portraitUrl(pr.advisor) }), h('span', {}, `AI 軍師：${labelOf(pr.advisor) || '未選擇'}`)),
      h('button', { class: 'small', onclick: () => chooseProfile(false) }, '更換半身照與軍師')));

  home.append(
    h('div', { class: 'home-hero' },
      h('img', { class: 'hero-icon', src: '../../build/icon.png', alt: '' }),
      h('div', {}, h('h1', {}, APP_NAME), h('p', { class: 'muted' }, '3D 新接龍．同局比快．速算解算器．AI 軍師．遠端連線＋語音'), h('div', { id: 'homeClock', class: 'clock home-clock' })),
      profileCard),
    h('div', { class: 'mode-grid four' }, cardAI, cardNet, cardAivai, cardSolo),
    h('div', { class: 'home-links' },
      h('button', { class: 'guide-btn', id: 'btnGuide', onclick: () => openGuide(guideCtx('teach')) }, '🎓 接龍教學'),
      h('button', { class: 'guide-btn', id: 'btnSysGuide', onclick: () => openGuide(guideCtx('system')) }, '📖 系統說明'),
      h('button', { id: 'btnKB', onclick: () => showScreen('kb') }, '📚 牌譜庫'),
      h('button', { onclick: () => openSettings() }, '⚙ 設定'),
      h('button', { onclick: () => { selectTab('music'); enterIdle(); setDrawer(true); } }, '♫ 背景音樂'),
      h('button', { id: 'btnAbout', onclick: () => openAbout() }, 'ℹ 關於與更新')),
    h('div', { class: 'credit muted small' }, `v${S.info.version}　${CREDIT}`),
  );
  tick();
}

function guideCtx(section) {
  return { section, voice, back: () => { renderHome(); showScreen('home'); }, show: () => showScreen('guide') };
}

function enterIdle() {
  if (!S.mode) {
    document.body.className = 'mode-idle';
    S.players = []; S.round = null;
    $('#turnBanner').textContent = '請回首頁選擇模式';
    $('#hudOpp').innerHTML = ''; $('#hudMe').innerHTML = ''; $('#scoreBadge').innerHTML = '';
    table.layout([null, null]);
  }
  showScreen('game');
}

// ---------------- 開局 ----------------
function aiPlayer(level, used) {
  const p = randomProfile(used);
  used.push(p.avatar, p.advisor);
  return newPlayer({ name: labelOf(p.avatar), kind: 'ai', level, profile: p });
}
function myProfile() { return S.settings.profile || randomProfile(); }
function newPlayer(o) { return { game: null, ms: 0, done: false, resigned: false, proxy: false, token: 0, ...o }; }

function setupMatch(mode, players, meIdx, cfg, matchId) {
  stopAllAI();
  S.mode = mode;
  S.players = players;
  S.me = meIdx;
  S.main = 0;
  S.matchId = matchId || newMatchId();
  S.match = { total: cfg.rounds || 1, idx: 0, wins: [0, 0], draws: 0, history: [], limitMs: (cfg.limit || 0) * 60000, cfg, over: false };
  S.round = null;
  S.paused = false;
  S.sel = null;
  document.body.className = 'mode-' + mode;
  $('#eventLog').innerHTML = '';
  $('#btnNext').classList.add('hidden');
  $('#btnPause').textContent = '⏸ 暫停';
  setProxyBtn(false);
  advisor.reset();
  if (meIdx >= 0) advisor.setAdvisor(players[meIdx].profile.advisor);
  showScreen('game');
}

function startAIGame(cfg) {
  const used = [S.settings.profile.avatar, S.settings.profile.advisor];
  setupMatch('ai', [newPlayer({ name: myName(), kind: 'me', profile: myProfile() }), aiPlayer(cfg.level, used)], 0, cfg);
  versus().then(() => authNextRound());
}

function startAIvAI(cfg) {
  const used = [];
  setupMatch('aivai', [aiPlayer(cfg.a, used), aiPlayer(cfg.b, used)], -1, cfg);
  S.aivaiMul = (SPEEDS.find(([v]) => v === cfg.speed) || SPEEDS[1])[2];
  selectTab('log');
  versus().then(() => authNextRound());
}

function startSolo(cfg) {
  setupMatch('solo', [newPlayer({ name: myName(), kind: 'me', profile: myProfile() })], 0, { rounds: 1, deal: cfg.deal });
  authNextRound();
}

async function versus() {
  if (S.players.length < 2) return;
  const wrap = h('div', { class: 'versus' },
    h('h2', {}, '同一局牌．比誰先全部歸位'),
    h('div', { class: 'vs-row two' }, S.players.map((st, i) => [
      i === 1 ? h('div', { class: 'vs-x' }, 'VS') : null,
      h('div', { class: 'vs-seat' + (i === S.me ? ' me' : '') },
        h('img', { src: portraitUrl(st.profile.avatar) }),
        h('b', {}, st.name + (st.kind === 'ai' ? `（AI ${lvName(st.level)}）` : '')),
        h('div', { class: 'vs-adv' }, h('img', { src: portraitUrl(st.profile.advisor) }), `軍師 ${labelOf(st.profile.advisor)}`)),
    ]).flat()));
  $('#boardWrap').append(wrap);
  sfx.shuffle();
  await sleep(S.info.fast ? 200 : 2000);
  wrap.remove();
}

// ---------------- 一局（持有比賽結果的一方） ----------------
function pickDeal() {
  const cfg = S.match.cfg || {};
  if (cfg.deal) return Math.min(MAX_DEAL, Math.max(1, cfg.deal + S.match.idx));
  return randomDeal();
}

function authNextRound() {
  if (!S.match || S.match.over) return;
  const no = pickDeal();
  S.match.idx++;
  const r = { no, idx: S.match.idx, total: S.match.total, limitMs: S.match.limitMs };
  if (S.mode === 'net' && S.room) S.room.send({ t: 'round', r, meta: metaInfo() });
  beginRound(r);
}

function beginRound(r) {
  stopAllAI();
  S.round = { ...r, startAt: 0, started: false, over: false, winner: -2, paused: 0 };
  S.sel = null;
  table.setHint(null);
  $('#btnNext').classList.add('hidden');
  advisor.reset();
  for (const p of S.players) Object.assign(p, { game: new Game(r.no), ms: 0, done: false, resigned: false });
  logLine(`── 第 ${r.idx}/${r.total} 局：牌局 #${r.no} ──`, 'sys');
  sfx.shuffle();
  renderAll({ deal: true });
  countdown(S.round).catch((e) => console.error(e));
}

async function countdown(R) {
  const box = h('div', { class: 'countdown' });
  $('#boardWrap').append(box);
  const fast = !!S.info.fast;
  for (let i = COUNTDOWN; i > 0; i--) {
    if (S.round !== R) { box.remove(); return; }
    box.textContent = String(i);
    box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop');
    sfx.select();
    await sleep(fast ? 120 : 1000);
  }
  if (S.round !== R) { box.remove(); return; }
  box.textContent = '開始！';
  box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop');
  sfx.turn();
  voice.call('開始');
  setTimeout(() => box.remove(), 700);
  R.startAt = Date.now();
  R.started = true;
  // 一開始就露出來的 A、2 先自動歸位
  S.players.forEach((p, i) => { if (isLocal(i)) { const autos = p.game.begin(); if (autos.length) sfx.found(); } });
  for (let i = 0; i < S.players.length; i++) if (isLocal(i)) pushState(i);
  renderAll();
  for (let i = 0; i < S.players.length; i++) maybeAI(i);
}

// 這位選手的牌局由本機執行（自己、或本機 AI）
function isLocal(i) {
  const p = S.players[i];
  if (!p) return false;
  if (S.mode === 'net') return i === S.me || (S.net && S.net.role === 'host' && p.kind === 'ai');
  return true;
}
function isAIControlled(i) { const p = S.players[i]; return !!p && isLocal(i) && (p.kind === 'ai' || p.proxy); }

function roundElapsed() {
  const R = S.round;
  if (!R || !R.started) return 0;
  const now = S.paused ? S.pauseAt : Date.now();
  return Math.max(0, now - R.startAt - R.paused);
}
function playerMs(p) { return p.done || p.resigned || (S.round && S.round.over) ? p.ms : roundElapsed(); }

function canPlay() {
  const p = me();
  return !!(p && S.round && S.round.started && !S.round.over && !S.paused && !p.proxy && !p.done && !p.resigned && S.mode !== 'replay');
}

// ---------------- 走牌 ----------------
function tryMove(from, to, n = 0, { quiet = false } = {}) {
  if (!canPlay()) return false;
  const p = me();
  const g = p.game;
  const k = g.moveSize(from, to, n);
  if (!k) { if (!quiet) { sfx.illegal(); const why = explainIllegal(g, from, to, n); if (why) toast(why, 'err', 2600); } renderAll(); return false; }
  const step = g.move(from, to, k);
  S.sel = null;
  afterMove(S.me, step);
  return true;
}

function afterMove(i, step) {
  const p = S.players[i];
  if (i === S.me) table.hint = null;
  if (step) {
    if (step.m && step.m.t === FOUND) sfx.found(); else sfx.card();
    if (step.autos.length) setTimeout(() => sfx.found(), 160);
  }
  pushState(i);
  renderAll();
  if (p.game.won && !p.done) { playerFinished(i); return; }
  if (i === S.me && !p.proxy && p.game.stuck()) toast('已經沒有可以走的步了：可以按「↶ 悔棋」退回，或按「🏳 放棄」', 'err', 5000);
}

function explainIllegal(g, from, to, n) {
  const k = n || (from < CELL ? g.runLength(from) : 1);
  const card = g.cardAt(from, from < CELL ? Math.max(1, n || 1) : 1);
  if (card < 0) return '';
  if (to === FOUND) {
    if (n > 1) return '回收座一次只能放一張';
    const s = suitOf(card);
    return `回收座要依花色從 A 排起：${SUITS[s]} 下一張是 ${g.found[s] < 13 ? RANKS[g.found[s]] : '（已滿）'}`;
  }
  if (to >= CELL) return g.cells[to - CELL] >= 0 ? '這個暫存格已經有牌了' : n > 1 ? '暫存格一格只能放一張' : '';
  const dst = g.cols[to];
  const cap = g.maxMove(!dst.length);
  if (from < CELL && n > 1) {
    const cards = g.cols[from].slice(-n);
    for (let i = 1; i < cards.length; i++) if (!canStack(cards[i - 1], cards[i])) return '這幾張不是紅黑交錯、由大到小的順序，不能一起搬';
  }
  if (!dst.length) return n > cap ? `一次最多只能搬 ${cap} 張（空暫存格 ${g.freeCells()} 格、可用空列 ${Math.max(0, g.emptyCols() - 1)} 列）` : '';
  const t = dst[dst.length - 1];
  const first = from < CELL ? g.cols[from][g.cols[from].length - (n || 1)] : card;
  if (!canStack(t, first)) return `${cardName(first)} 不能接在 ${cardName(t)} 下面：要點數小一、顏色相反`;
  if ((n || k) > g.maxMove(false)) return `一次最多只能搬 ${g.maxMove(false)} 張（空暫存格 ${g.freeCells()} 格、空列 ${g.emptyCols()} 列）`;
  return '';
}

// 點選：先選牌，再點目的地
function onBoardClick(hit) {
  if (!canPlay()) return;
  const g = me().game;
  if (!S.sel) {
    if (!hit || hit.card == null || hit.loc === FOUND) return;
    if (hit.loc < CELL) {
      const cards = g.cols[hit.loc].slice(hit.k);
      for (let i = 1; i < cards.length; i++) if (!canStack(cards[i - 1], cards[i])) { sfx.illegal(); toast('這幾張不是紅黑交錯、由大到小的順序，不能一起搬', 'err', 2400); return; }
    }
    S.sel = { loc: hit.loc, k: hit.loc < CELL ? hit.k : 0 };
    sfx.select();
    table.setSelection(S.sel);
    return;
  }
  const from = S.sel.loc;
  const n = from < CELL ? g.cols[from].length - S.sel.k : 1;
  if (!hit || hit.loc === from) { S.sel = null; table.setSelection(null); return; }
  const to = hit.loc;
  if (g.moveSize(from, to, n)) { tryMove(from, to, n); return; }
  // 點到別的牌而且不能接：改選那一張
  if (hit.card != null && to !== FOUND) {
    S.sel = null;
    table.setSelection(null);
    const why = explainIllegal(g, from, to, n);
    sfx.illegal();
    if (why) toast(why, 'err', 2600);
    return;
  }
  tryMove(from, to, n);
}

// 雙擊：自動找最好的去處（回收座 → 接得上的牌列 → 空列 → 暫存格）
function onBoardDouble(hit) {
  if (!canPlay() || !hit || hit.card == null || hit.loc === FOUND) return;
  const g = me().game;
  S.sel = null;
  const from = hit.loc;
  const n = from < CELL ? g.cols[from].length - hit.k : 1;
  const tries = [];
  if (n === 1) tries.push(FOUND);
  for (let t = 0; t < 8; t++) if (t !== from && g.cols[t].length) tries.push(t);
  for (let t = 0; t < 8; t++) if (t !== from && !g.cols[t].length && !(from < CELL && g.cols[from].length === n)) tries.push(t);
  if (n === 1 && from < CELL) for (let c = 0; c < 4; c++) tries.push(CELL + c);
  for (const t of tries) if (g.moveSize(from, t, n)) { tryMove(from, t, n); return; }
  sfx.illegal();
  table.setSelection(null);
}

function onDrop({ from, n, to }) {
  if (!canPlay()) return;
  S.sel = null;
  tryMove(from, to, n);
}

function undo() {
  if (!canPlay()) return;
  const p = me();
  if (!p.game.history.length) { toast('已經是第一步了', 'info', 1600); return; }
  p.game.undo();
  S.sel = null;
  sfx.select();
  logLine('悔棋一步', 'sys');
  pushState(S.me);
  renderAll();
}

function collectAll() {
  if (!canPlay()) return;
  const p = me();
  const step = p.game.collectAll();
  if (!step) { toast('目前沒有可以送上回收座的牌', 'info', 1800); return; }
  afterMove(S.me, step);
}

// ---------------- AI 與軍師接手 ----------------
function stopAllAI() { for (const p of S.players) p.token++; }

function maybeAI(i) {
  if (!S.round || !S.round.started || S.round.over) return;
  if (!isAIControlled(i)) return;
  const p = S.players[i];
  if (p.done || p.resigned) return;
  const tok = ++p.token;
  runAI(i, tok).catch((e) => { console.error('AI', e); toast('AI 發生錯誤：' + errMsg(e), 'err'); });
}

async function pauseGate(tok, p) { while (S.paused && tok === p.token) await sleep(150); }

async function planFor(p, lv) {
  const g = p.game;
  // 牌譜庫累積的最短解：開局時直接用（大師與軍師）
  if (g.moveCount === 0 && !g.history.length && lv.profile === 'best') {
    const b = S.lib.bestFor(g.deal);
    if (b) { try { const mv = parseMoves(b.moves); if (verify(g.deal, mv)) return { moves: mv, from: 'kb' }; } catch {} }
  }
  const r = lv.profile === 'best' ? await S.pool.best(g, { budgetMs: 2500 }) : await S.pool.solve(g, { profile: lv.profile });
  return r ? { moves: r.moves, from: 'solver', nodes: r.nodes, ms: r.ms } : null;
}

async function runAI(i, tok) {
  const p = S.players[i];
  const lv = p.proxy ? ADVISOR_PACE : LEVELS[p.level ?? 1];
  const mul = S.mode === 'aivai' ? S.aivaiMul : 1;
  const t0 = Date.now();
  let plan = await planFor(p, lv);
  if (tok !== p.token) return;
  // 解不出來（例如真人走到死局後才請軍師接手）：先往回悔棋直到有解
  let backs = 0;
  while (!plan && p.game.history.length && backs < 40 && tok === p.token) {
    p.game.undo(); backs++;
    plan = await S.pool.solve(p.game, { profile: 'fast', deadline: Date.now() + 4000 });
    plan = plan ? { moves: plan.moves } : null;
  }
  if (tok !== p.token) return;
  if (backs) { logLine(`${p.name}：退回 ${backs} 步重新規劃`, 'sys'); pushState(i); renderAll(); }
  if (!plan) { logLine(`${p.name}：這局找不到解法，只好放棄`, 'res'); resign(i); return; }
  if (plan.from === 'kb') logLine(`${p.name}：使用牌譜庫累積的最短解（${plan.moves.length} 步）`, 'sys');
  const think = (S.info.fast ? 100 : lv.think * mul) - (Date.now() - t0);
  if (think > 0) await sleep(think);
  for (const m of plan.moves) {
    await pauseGate(tok, p);
    if (tok !== p.token || !S.round || S.round.over) return;
    const step = p.game.move(m.f, m.t, m.n);
    if (!step) { maybeAI(i); return; } // 局面變了，重新規劃
    afterMove(i, step);
    if (p.game.won) return;
    const wait = S.info.fast ? 60 : lv.ms * mul * (0.7 + Math.random() * 0.6) + (step.autos.length ? 250 : 0);
    await sleep(wait);
  }
  if (tok === p.token && !p.game.won) maybeAI(i);
}

function setProxyBtn(on) {
  const btn = $('#btnProxy');
  btn.textContent = on ? '🙋 換回主位' : '🧙 軍師接手';
  btn.classList.toggle('on', on);
}

function toggleProxy() {
  const p = me();
  if (!p || !S.round || S.round.over || p.done || p.resigned) return;
  p.proxy = !p.proxy;
  S.sel = null;
  setProxyBtn(p.proxy);
  logLine(p.proxy ? `軍師 ${labelOf(p.profile.advisor)} 接手主位` : '已換回主位', 'sys');
  if (p.proxy) { voice.call(`軍師${labelOf(p.profile.advisor)}接手`); maybeAI(S.me); } else p.token++;
  pushState(S.me);
  renderAll();
}

async function changeAdvisor() {
  const p = me();
  if (!p) return;
  const id = await pickAdvisor(p.profile.advisor);
  if (!id || id === p.profile.advisor) return;
  p.profile = { ...p.profile, advisor: id };
  advisor.setAdvisor(id);
  await saveSettings({ profile: { ...S.settings.profile, advisor: id } });
  logLine(`更換軍師：${labelOf(id)}`, 'sys');
  if (S.mode === 'net') sendNet({ t: 'advisor', i: S.me, id });
  if (p.proxy) maybeAI(S.me);
  renderHud();
}

// ---------------- 提示與分析 ----------------
async function analyzeForMe() {
  const p = me();
  if (!p || !p.game) return null;
  const g = p.game;
  if (g.won) return { solvable: true, steps: 0, next: [] };
  const r = await S.pool.solve(g, { profile: 'fast', deadline: Date.now() + 8000 });
  if (!r) return { solvable: false, steps: 0, next: [] };
  const sim = g.clone();
  const next = [];
  for (const m of r.moves.slice(0, 6)) {
    next.push({ m, text: describeMove(sim, { ...m, c: sim.cardAt(m.f, m.n) }) });
    sim.move(m.f, m.t, m.n);
  }
  return { solvable: true, steps: r.moves.length, next };
}

async function hint() {
  if (!canPlay()) return;
  $('#btnHint').disabled = true;
  try {
    const a = await analyzeForMe();
    if (!a) return;
    if (!a.solvable) { toast('這個局面已經沒有解了，建議悔棋退回幾步', 'err', 4000); return; }
    if (a.next.length) { showHint(a); toast(`💡 ${a.next[0].text}（最快還要 ${a.steps} 步）`, 'ok', 4000); }
  } finally { renderButtons(); }
}
function showHint(a) { if (a && a.next && a.next[0]) table.setHint(a.next[0].m); }

// ---------------- 完成、放棄、時間到 ----------------
function playerFinished(i) {
  const p = S.players[i];
  p.done = true;
  p.ms = roundElapsed();
  p.token++;
  logLine(`${p.name} 全部歸位！${p.game.moveCount} 步、${fmtTime(p.ms)}`, 'res');
  voice.call(`${p.name}全部歸位`);
  table.celebrateWin(i === nearIdx() ? 0 : 1);
  if (S.mode === 'net') {
    pushState(i);
    if (S.net.role === 'guest') { S.room.send({ t: 'fin', i, ms: p.ms }); return; }
  }
  if (isAuthority()) endRound(i, 'done');
}

async function resignMe() {
  const p = me();
  if (!p || !S.round || S.round.over || p.done || p.resigned) return;
  const ok = await modal('放棄這一局', S.mode === 'solo' ? '要放棄這一局嗎？可以在牌譜庫看 AI 解答。' : '放棄的話這一局算對手贏，確定嗎？', [{ label: '繼續努力', value: false }, { label: '放棄', value: true, primary: true }]);
  if (!ok || !S.round || S.round.over) return;
  if (S.mode === 'net' && S.net.role === 'guest') { p.resigned = true; p.ms = roundElapsed(); p.token++; S.room.send({ t: 'resign', i: S.me }); renderAll(); return; }
  resign(S.me);
}

function resign(i) {
  const p = S.players[i];
  if (!S.round || S.round.over || p.done || p.resigned) return;
  p.resigned = true;
  p.ms = roundElapsed();
  p.token++;
  logLine(`${p.name} 放棄這一局`, 'res');
  if (S.mode === 'net' && S.net.role === 'guest') return;
  const others = S.players.map((_, j) => j).filter((j) => j !== i && !S.players[j].resigned);
  if (!others.length) endRound(byFound(), 'resign');
  else endRound(others[0], 'resign');
}

function byFound() {
  if (S.players.length < 2) return -1;
  const [a, b] = S.players.map((p) => p.game.foundCount);
  return a === b ? -1 : a > b ? 0 : 1;
}

function timeUp() {
  logLine('時間到！比回收座的張數', 'res');
  voice.call('時間到');
  for (const p of S.players) if (!p.done && !p.resigned) p.ms = S.round.limitMs;
  endRound(S.players.length > 1 ? byFound() : -1, 'time');
}

// 結束這一局（只有持有比賽結果的一方呼叫）
function endRound(winner, reason) {
  const R = S.round;
  if (!R || R.over) return;
  R.over = true;
  R.winner = winner;
  R.reason = reason;
  stopAllAI();
  for (const p of S.players) if (!p.done && !p.resigned) p.ms = roundElapsed();
  const rec = roundRecord(R);
  const M = S.match;
  if (winner >= 0) M.wins[winner]++; else if (S.players.length > 1) M.draws++;
  M.over = M.idx >= M.total || (S.players.length > 1 && Math.max(...M.wins) > M.total / 2);
  if (S.mode === 'net' && S.room) S.room.send({ t: 'result', rec, meta: metaInfo() });
  finishRound(rec, metaInfo());
}

function roundRecord(R) {
  return {
    no: R.no, idx: R.idx, total: R.total, winner: R.winner, reason: R.reason, date: new Date().toISOString(),
    res: S.players.map((p) => ({ name: p.name, kind: p.kind, level: p.level, n: p.game.moveCount, ms: p.ms, found: p.game.foundCount, done: p.done, resigned: p.resigned, moves: movesToText(p.game.history), profile: p.profile })),
  };
}

// 雙方都會執行：計分、累積牌譜、顯示結果
async function finishRound(rec, hostMeta = null) {
  const M = S.match;
  if (S.round) { S.round.over = true; S.round.winner = rec.winner; }
  if (hostMeta) Object.assign(M, { wins: hostMeta.wins.slice(), draws: hostMeta.draws, idx: hostMeta.idx, over: hostMeta.over });
  else {
    if (rec.winner >= 0) M.wins[rec.winner]++; else if (S.players.length > 1) M.draws++;
    M.over = M.idx >= M.total || (S.players.length > 1 && Math.max(...M.wins) > M.total / 2);
  }
  M.history.push(rec);
  learnRound(rec);
  await saveMatch();
  renderAll();
  if (rec.winner === S.me && S.me >= 0) sfx.win(); else if (rec.winner >= 0 && S.me >= 0) sfx.lose();
  if (S.mode === 'aivai') {
    await sleep(S.info.fast ? 300 : 2600 * S.aivaiMul + 800);
    if (S.mode === 'aivai' && S.match === M) { if (M.over) showFinal(); else authNextRound(); }
    return;
  }
  showRoundResult(rec);
}

function learnRound(rec) {
  const names = rec.res.map((r) => r.name);
  const k = `${S.matchId}#${rec.idx}`;
  S.lib.add({ k, m: S.matchId, no: rec.no, date: rec.date, mode: S.mode, names, kinds: rec.res.map((r) => r.kind), res: rec.res.map(({ n, ms, found, done, resigned }) => ({ n, ms, found, done, resigned })), winner: rec.winner, me: S.me });
  for (const r of rec.res) if (r.done && r.moves) S.lib.learn(rec.no, r.moves, r.n, r.name, rec.date);
  saveLib();
}
function saveLib() { clearTimeout(S._libT); S._libT = setTimeout(() => xk.kb.set(S.lib.toJSON()), 300); }

async function saveMatch() {
  if (!S.match.history.length) return;
  await xk.games.save({ id: S.matchId, date: new Date().toISOString(), mode: S.mode, names: S.players.map((x) => x.name), profiles: S.players.map((x) => x.profile), me: S.me, history: S.match.history, finished: S.match.over });
}

function resultBody(rec) {
  const rows = rec.res.map((r, i) => h('tr', { class: (i === rec.winner ? 'win ' : '') + (i === S.me ? 'me' : '') },
    h('td', {}, h('img', { class: 'mini-av', src: portraitUrl(r.profile && r.profile.avatar) }), r.name, i === rec.winner ? ' 🏆' : ''),
    h('td', {}, r.done ? '全部歸位' : r.resigned ? '放棄' : `回收 ${r.found} 張`),
    h('td', {}, `${r.n} 步`), h('td', {}, fmtTime(r.ms))));
  const best = S.lib.bestFor(rec.no);
  const reason = { done: '先全部歸位的人獲勝', resign: '對手放棄', time: '時間到，比回收座張數' }[rec.reason] || '';
  return h('div', { class: 'result' },
    h('div', { class: 'res-final' }, S.players.length < 2 ? (rec.res[0].done ? '🎉 恭喜過關！' : '這局沒有完成') : rec.winner < 0 ? '平手！' : `${rec.res[rec.winner].name} 獲勝！`),
    h('div', { class: 'muted' }, `牌局 #${rec.no}．${reason}`),
    h('table', { class: 'res-table' }, h('tr', {}, ['選手', '結果', '步數', '用時'].map((t) => h('th', {}, t))), rows),
    best ? h('div', { class: 'muted small' }, `牌譜庫目前最短解：${best.n} 步（${best.by}）`) : null,
    S.players.length > 1 ? h('div', { class: 'res-score' }, `比數 ${S.match.wins[0]}：${S.match.wins[1]}${S.match.draws ? `（平手 ${S.match.draws}）` : ''}`) : null);
}

async function showRoundResult(rec) {
  const over = S.match.over;
  const canNext = isAuthority();
  const btns = S.mode === 'solo'
    ? [{ label: '看 AI 解答', value: 'ai' }, { label: '重玩這局', value: 'again' }, { label: '下一局（隨機）', value: true, primary: true }]
    : canNext ? [{ label: '先看牌桌', value: false }, { label: over ? '看總成績' : '下一局 ▶', value: true, primary: true }] : [{ label: '關閉', value: false, primary: true }];
  const go = await modal(S.mode === 'solo' ? '練習結果' : `第 ${rec.idx} 局結果`, resultBody(rec), btns);
  if (S.mode === 'solo') {
    if (go === 'ai') { openReplayAI(rec.no); return; }
    if (go === 'again') { startSolo({ deal: rec.no }); return; }
    if (go) { startSolo({ deal: 0 }); return; }
    return;
  }
  if (!canNext) return;
  if (go) { if (over) showFinal(); else authNextRound(); } else { $('#btnNext').classList.remove('hidden'); $('#btnNext').textContent = over ? '看總成績' : '下一局 ▶'; }
}

function onNextClick() {
  $('#btnNext').classList.add('hidden');
  if (S.match && S.match.over) showFinal(); else authNextRound();
}

async function showFinal() {
  const M = S.match;
  const [a, b] = M.wins;
  const body = h('div', { class: 'final' },
    h('div', { class: 'res-final' }, a === b ? '雙方平手！' : `${S.players[a > b ? 0 : 1].name} 獲勝！`),
    h('table', { class: 'res-table' },
      h('tr', {}, h('th', {}, ''), S.players.map((p) => h('th', {}, p.name))),
      h('tr', {}, h('td', {}, '勝局'), M.wins.map((w) => h('td', {}, w))),
      h('tr', {}, h('td', {}, '總步數'), S.players.map((_, i) => h('td', {}, M.history.reduce((s, r) => s + r.res[i].n, 0)))),
      h('tr', {}, h('td', {}, '總用時'), S.players.map((_, i) => h('td', {}, fmtTime(M.history.reduce((s, r) => s + r.res[i].ms, 0)))))),
    h('div', { class: 'muted small' }, `本場 ${M.history.length} 局已存進牌譜庫${M.draws ? `，平手 ${M.draws} 局` : ''}。`));
  const again = await modal('比賽結束', body, [{ label: '回首頁', value: false }, { label: '再來一場', value: true, primary: true }]);
  if (again && S.mode === 'ai') startAIGame({ ...S.settings.match, deal: 0 });
  else if (again && S.mode === 'aivai') startAIvAI(S.settings.aivai);
  else leaveGame(true);
}

// ---------------- 畫面 ----------------
function renderAll(opts = {}) {
  const ni = nearIdx(), fi = farIdx();
  const nv = S.players[ni] && S.players[ni].game ? S.players[ni].game.view() : null;
  const fv = fi >= 0 && S.players[fi].game ? S.players[fi].game.view() : null;
  if (S.mode !== 'replay') {
    table.sel = S.sel;
    table.setInteractive(canPlay());
    table.layout([nv, fv], opts);
  }
  renderHud();
  renderBanner();
  renderButtons();
  renderScores();
}

function hudCard(i, side) {
  const p = S.players[i];
  if (!p) return null;
  const g = p.game;
  const tags = [];
  if (p.kind === 'ai') tags.push(h('span', { class: 'tag' }, `AI ${lvName(p.level)}`));
  if (p.kind === 'remote') tags.push(h('span', { class: 'tag remote' }, '遠端'));
  if (p.proxy) tags.push(h('span', { class: 'tag proxy' }, '軍師接手'));
  if (i === S.me) tags.push(h('span', { class: 'tag me' }, '我'));
  if (p.done) tags.push(h('span', { class: 'tag done' }, '全部歸位'));
  if (p.resigned) tags.push(h('span', { class: 'tag quit' }, '放棄'));
  const found = g ? g.foundCount : 0;
  const box = h('div', { class: 'hud-card' + (S.round && S.round.winner === i ? ' winner' : '') },
    h('div', { class: 'sc-av' }, h('img', { src: portraitUrl(p.profile.avatar) }), h('img', { class: 'sc-sub', src: portraitUrl(p.profile.advisor), title: `軍師：${labelOf(p.profile.advisor)}` })),
    h('div', { class: 'hud-info' },
      h('div', { class: 'sc-name' }, p.name, S.match && S.players.length > 1 ? h('span', { class: 'hud-wins' }, `勝 ${S.match.wins[i]}`) : null),
      h('div', { class: 'sc-tags' }, tags),
      h('div', { class: 'hud-bar' }, h('i', { style: { width: `${(found / 52) * 100}%` } }), h('em', {}, `回收 ${found}/52`)),
      h('div', { class: 'hud-stat' }, h('span', {}, `${g ? g.moveCount : 0} 步`), h('span', { class: 'hud-time', 'data-i': i }, fmtTime(playerMs(p))))));
  if (side === 'opp' && g) {
    const cv = h('canvas', { class: 'hud-mini', width: 300, height: 220 });
    drawMini(cv, g.view());
    box.append(cv);
  }
  return box;
}

function renderHud() {
  const ho = $('#hudOpp'), hm = $('#hudMe');
  ho.innerHTML = ''; hm.innerHTML = '';
  if (!S.players.length || S.mode === 'replay') return;
  const ni = nearIdx(), fi = farIdx();
  const a = hudCard(ni, 'me');
  if (a) hm.append(a);
  if (fi >= 0) { const b = hudCard(fi, 'opp'); if (b) ho.append(b); }
}

function renderClocks() {
  for (const el of $$('.hud-time')) { const p = S.players[Number(el.dataset.i)]; if (p) el.textContent = fmtTime(playerMs(p)); }
  const lim = S.round && S.round.limitMs;
  const b = $('#scoreBadge');
  if (b && S.round) {
    const left = lim ? Math.max(0, lim - roundElapsed()) : 0;
    const t = b.querySelector('.sb-time');
    if (t) { t.textContent = lim ? `剩 ${fmtTime(left)}` : `用時 ${fmtTime(roundElapsed())}`; t.classList.toggle('urgent', !!lim && left < 30000); }
  }
}

function renderScores() {
  const b = $('#scoreBadge');
  b.innerHTML = '';
  const box = $('#scoreBox');
  box.innerHTML = '';
  if (!S.round || S.mode === 'replay') return;
  b.append(h('div', { class: 'sb-deal' }, `牌局 #${S.round.no}`),
    S.players.length > 1 ? h('div', { class: 'sb-score' }, `第 ${S.round.idx}/${S.round.total} 局．${S.match.wins[0]}：${S.match.wins[1]}`) : null,
    h('div', { class: 'sb-time' }, ''));
  renderClocks();
  for (const [i, p] of S.players.entries()) box.append(h('div', { class: 'score-row' + (i === S.me ? ' me' : '') }, h('img', { src: portraitUrl(p.profile.avatar) }), h('span', {}, p.name), h('b', {}, S.players.length > 1 ? `勝 ${S.match.wins[i]} 局` : `${p.game ? p.game.foundCount : 0}/52`)));
}

function renderBanner() {
  const b = $('#turnBanner');
  let cls = '', text = '—';
  const p = me();
  if (S.mode === 'replay') { cls = 'replay'; text = S.replay ? S.replay.label : '牌譜重播'; }
  else if (S.net && S.mode === 'net' && S.net.status) { cls = 'over'; text = S.net.status; }
  else if (!S.round) text = '準備中…';
  else if (!S.round.started) { cls = 'watch'; text = '發牌中，準備開始…'; }
  else if (S.round.over) { cls = 'over'; text = S.players.length < 2 ? (S.players[0].done ? '恭喜過關！' : '本局結束') : S.round.winner < 0 ? '本局平手' : `本局由 ${S.players[S.round.winner].name} 獲勝`; }
  else if (S.paused) { cls = 'watch'; text = '已暫停'; }
  else if (S.me < 0) { cls = 'watch'; text = '觀戰中：兩位選手同時解同一局牌'; }
  else if (p.proxy) { cls = 'watch'; text = '軍師接手中，隨時可以換回主位'; }
  else if (p.done) { cls = 'watch'; text = '您已全部歸位，等待結算'; }
  else if (p.resigned) { cls = 'watch'; text = '您已放棄，換您觀牌'; }
  else { cls = 'mine'; text = '輪到您出牌：同一局牌，比誰先全部歸位'; }
  const was = b.classList.contains('mine');
  b.className = 'turn-banner ' + cls;
  b.textContent = text;
  if (cls === 'mine' && !was) sfx.turn();
}

function renderButtons() {
  const p = me();
  const playing = !!(p && S.round && S.round.started && !S.round.over && !p.done && !p.resigned);
  const can = canPlay();
  $('#btnHint').disabled = !can;
  $('#btnUndo').disabled = !can || !p.game.history.length;
  $('#btnCollect').disabled = !can;
  $('#btnProxy').disabled = !playing;
  $('#btnResign').disabled = !playing;
  $('#btnChangeAdv').disabled = !p;
  const pausable = S.mode === 'ai' || S.mode === 'aivai' || S.mode === 'solo';
  $('#btnPause').classList.toggle('hidden', !pausable);
  $('#btnPause').disabled = !(S.round && S.round.started && !S.round.over);
}

function togglePause() {
  if (!S.round || !S.round.started || S.round.over || S.mode === 'net') return;
  if (S.paused) { S.round.paused += Date.now() - S.pauseAt; S.paused = false; $('#btnPause').textContent = '⏸ 暫停'; }
  else { S.paused = true; S.pauseAt = Date.now(); S.sel = null; $('#btnPause').textContent = '▶ 繼續'; }
  renderAll();
}

function logLine(text, cls = '') {
  const log = $('#eventLog');
  if (!log) return;
  log.append(h('div', { class: 'ev ' + cls }, text));
  log.scrollTop = log.scrollHeight;
}

// ---------------- 離開 ----------------
async function leaveGame(force = false) {
  if (S.mode === 'replay') { stopReplayAuto(); S.mode = null; S.replay = null; document.body.className = ''; table.setHint(null); showScreen('kb'); return; }
  if (S.mode && !force && S.round && !S.round.over && !(S.match && S.match.over)) {
    if (!(await modal('離開比賽', '確定要離開這場比賽嗎？已完成的局都存在牌譜庫了。', [{ label: '繼續比賽', value: false }, { label: '離開', value: true, primary: true }]))) return;
  }
  stopAllAI();
  S.mode = null; S.round = null; S.match = null; S.players = []; S.paused = false; S.sel = null;
  closeNet();
  voice.stop();
  document.body.className = '';
  table.setHint(null);
  table.layout([null, null]);
  renderHome();
  showScreen('home');
}

// ---------------- 遠端對戰 ----------------
// 房主是玩家 0（甲方），第一位加入的人是玩家 1（乙方），其餘當觀眾。
// 每位玩家自己的牌局在自己電腦上跑，每走一步就把局面傳給大家；勝負由房主判定。
function metaInfo() {
  return {
    matchId: S.matchId, idx: S.match ? S.match.idx : 0, total: S.match ? S.match.total : 0, wins: S.match ? S.match.wins : [0, 0], draws: S.match ? S.match.draws : 0, over: S.match ? S.match.over : false,
    limitMs: S.match ? S.match.limitMs : 0,
    players: S.players.map(({ name, kind, level, profile, left, proxy }) => ({ name, kind, level, profile, left, proxy })),
  };
}

function pushState(i) {
  if (S.mode !== 'net' || !S.room) return;
  const p = S.players[i];
  const m = { t: 'st', i, snap: p.game.snapshot(), ms: p.done || p.resigned ? p.ms : roundElapsed(), proxy: p.proxy, done: p.done, resigned: p.resigned, no: S.round && S.round.no };
  S.room.send(m);
}

function sendNet(m) { if (S.room) S.room.send(m); }

function netWait(content) {
  const w = $('#netWait');
  if (!w) return;
  w.classList.toggle('hidden', !content);
  w.innerHTML = '';
  if (content) w.append(content);
}

function renderLobby() {
  if (!S.net || S.net.started || S.screen !== 'home') return;
  const host = S.net.role === 'host';
  const opp = S.net.members.find((m) => m.seat === 1);
  const hostM = S.net.members.find((m) => m.seat === 0);
  const row = (m, label, empty) => h('div', { class: 'seat-row' + (m ? '' : ' wait') },
    m && m.profile ? h('img', { class: 'mini-av', src: portraitUrl(m.profile.avatar) }) : h('span', { class: 'mini-av empty' }),
    h('span', { class: 'who' }, `${label}：${m ? m.name : '等待加入…'}`),
    h('span', { class: 'kind' }, m ? (m.id === S.room.myId ? '我' : '遠端') : empty));
  const watchers = S.net.members.filter((m) => m.seat < 0);
  const content = h('div', {},
    h('div', { class: 'lobby-head' }, h('b', {}, '房號'), h('span', { class: 'muted small' }, `${S.net.cfg.rounds || 3} 局${S.net.cfg.limit ? `．每局 ${S.net.cfg.limit} 分鐘` : ''}`)),
    h('div', { class: 'room-code' }, S.net.code.replace(/(\d{3})(\d{3})/, '$1 $2')),
    h('div', { class: 'seat-list' }, row(hostM, '甲方（房主）', ''), row(opp, '乙方', `開始時由 AI（${lvName(S.net.cfg.aiLevel)}）補位`)),
    watchers.length ? h('div', { class: 'muted small' }, `觀眾：${watchers.map((w) => w.name).join('、')}`) : null,
    host
      ? h('div', { class: 'net-row' },
        h('button', { onclick: () => { navigator.clipboard.writeText(S.net.code); toast('已複製房號', 'ok'); } }, '複製房號'),
        h('button', { onclick: () => { closeNet(); netWait(null); } }, '取消'),
        h('button', { class: 'primary', id: 'btnStartNet', onclick: () => hostStartGame() }, '開始比賽'))
      : h('div', { class: 'net-row' }, h('span', { class: 'muted small spin' }, '等待房主開始…'), h('button', { onclick: () => { closeNet(); netWait(null); } }, '離開')),
    host ? h('div', { class: 'muted small' }, '請把房號告訴朋友，對方在「加入房間」輸入即可。') : null);
  netWait(content);
}

function renderMembers() {
  const box = $('#memberList');
  if (!box || !S.net || !S.room) return;
  box.innerHTML = '';
  for (const m of S.net.members) {
    box.append(h('span', { class: 'member' + (m.voice ? ' voice' : '') },
      m.profile ? h('img', { src: portraitUrl(m.profile.avatar) }) : null, `${m.name}${m.seat < 0 ? '（觀眾）' : ''}${m.id === S.room.myId ? '（我）' : ''}`));
  }
  const n = S.net.members.filter((m) => m.voice).length;
  $('#voiceState').textContent = S.voice.on ? `🟢 語音中（${n} 人）` : n ? `語音：${n} 人通話中` : '語音：未通話';
}

async function hostRoom(cfg) {
  closeNet();
  netWait(h('span', {}, '正在建立房間…'));
  const room = new Room(S.settings);
  S.room = room;
  try {
    const code = await room.host();
    S.net = { role: 'host', code, cfg, started: false, members: [{ id: room.myId, name: myName(), seat: 0, voice: false, profile: myProfile() }] };
    room.on('member-msg', (id, m) => queueNet(() => onHostMsg(id, m)));
    room.on('member-lost', (id, reason) => queueNet(() => onMemberLost(id, reason)));
    room.on('call', (call) => onVoiceCall(call));
    renderLobby();
  } catch (e) {
    netWait(h('span', { class: 'err' }, '建立房間失敗：' + errMsg(e)));
    S.room = null;
  }
}

function broadcastRoster() {
  if (!S.net || S.net.role !== 'host') return;
  S.room.send({ t: 'roster', members: S.net.members.map(({ id, name, seat, voice: vo, profile }) => ({ id, name, seat, voice: vo, profile })), cfg: S.net.cfg, started: S.net.started });
  renderLobby();
  renderMembers();
}

function hostStartGame() {
  if (!S.net || S.net.role !== 'host') return;
  const cfg = S.net.cfg;
  const used = S.net.members.flatMap((m) => (m.profile ? [m.profile.avatar, m.profile.advisor] : []));
  const opp = S.net.members.find((m) => m.seat === 1);
  const players = [newPlayer({ name: myName(), kind: 'me', profile: myProfile() }), opp ? newPlayer({ name: opp.name, kind: 'remote', profile: opp.profile || randomProfile(used) }) : aiPlayer(cfg.aiLevel ?? 1, used)];
  S.net.started = true;
  setupMatch('net', players, 0, cfg);
  S.room.send({ t: 'start', meta: metaInfo() });
  broadcastRoster();
  chatSys('比賽開始！');
  versus().then(() => authNextRound());
}

let netChain = Promise.resolve();
function queueNet(fn) { netChain = netChain.then(fn).catch((e) => console.error('net msg', e)); }

function applyRemoteState(m) {
  const p = S.players[m.i];
  if (!p || !S.round || m.no !== S.round.no) return;
  p.game = Game.from(m.snap);
  p.proxy = !!m.proxy;
  if (m.done && !p.done) { p.done = true; p.ms = m.ms; table.celebrateWin(m.i === nearIdx() ? 0 : 1); logLine(`${p.name} 全部歸位！${p.game.moveCount} 步、${fmtTime(p.ms)}`, 'res'); }
  if (m.resigned && !p.resigned) { p.resigned = true; p.ms = m.ms; logLine(`${p.name} 放棄這一局`, 'res'); }
  if (m.ms) p.ms = m.ms;
  renderAll();
}

async function onHostMsg(id, m) {
  const mem = S.net.members.find((x) => x.id === id);
  switch (m.t) {
    case 'hello': {
      if (m.ver !== PROTOCOL) { S.room.sendTo(id, { t: 'old', text: '雙方程式版本不同，請先更新到最新版。' }); setTimeout(() => S.room.kick(id), 400); return; }
      const name = String(m.name || '玩家').slice(0, 16);
      const profile = validProfile(m.profile) ? m.profile : null;
      let seat = -1;
      if (!S.net.started) { if (!S.net.members.some((x) => x.seat === 1)) seat = 1; }
      else if (S.players[1] && S.players[1].left && S.players[1].leftName === name && !S.net.members.some((x) => x.seat === 1)) {
        // 斷線重連：拿回原本的座位
        seat = 1;
        Object.assign(S.players[1], { kind: 'remote', left: false, name });
        S.players[1].token++;
      }
      S.net.members.push({ id, name, seat, voice: false, profile });
      S.room.sendTo(id, { t: 'welcome', seat });
      if (S.net.started) {
        S.room.sendTo(id, { t: 'start', meta: metaInfo() });
        if (S.round) {
          S.room.sendTo(id, { t: 'round', r: { no: S.round.no, idx: S.round.idx, total: S.round.total, limitMs: S.round.limitMs }, meta: metaInfo(), resume: true, elapsed: roundElapsed() });
          for (let i = 0; i < S.players.length; i++) { const p = S.players[i]; S.room.sendTo(id, { t: 'st', i, snap: p.game.snapshot(), ms: playerMs(p), proxy: p.proxy, done: p.done, resigned: p.resigned, no: S.round.no }); }
        }
        chatSys(seat >= 0 ? `${name} 回來了，接回座位` : `${name} 加入觀戰`);
        renderAll();
      }
      broadcastRoster();
      break;
    }
    case 'st':
      if (!mem || mem.seat !== m.i) return;
      S.room.send(m, id); // 轉給觀眾
      applyRemoteState(m);
      break;
    case 'fin':
      if (!mem || mem.seat !== m.i || !S.round || S.round.over) return;
      S.players[m.i].done = true; S.players[m.i].ms = m.ms;
      endRound(m.i, 'done');
      break;
    case 'resign':
      if (!mem || mem.seat !== m.i) return;
      resign(m.i);
      break;
    case 'advisor':
      if (mem && mem.seat === m.i) { S.players[m.i].profile = { ...S.players[m.i].profile, advisor: String(m.id) }; S.room.send(m, id); renderHud(); }
      break;
    case 'chat': {
      if (!mem) return;
      const text = String(m.text || '').slice(0, 500);
      S.room.send({ t: 'chat', name: mem.name, seat: mem.seat, text }, id);
      chatLine(mem.name, mem.seat, text, false);
      break;
    }
    case 'voice':
      if (mem) { mem.voice = !!m.on; broadcastRoster(); }
      break;
  }
}

function onMemberLost(id, reason) {
  const i = S.net.members.findIndex((x) => x.id === id);
  if (i < 0) return;
  const mem = S.net.members[i];
  S.net.members.splice(i, 1);
  closeCall(id);
  if (S.net.started && mem.seat === 1 && S.mode === 'net' && !S.match.over) {
    const p = S.players[1];
    Object.assign(p, { kind: 'ai', left: true, leftName: mem.name, level: S.net.cfg.aiLevel ?? 1 });
    chatSys(`${mem.name}${reason}，暫時由 AI 代打`);
    renderAll();
    maybeAI(1);
  } else if (S.screen === 'game') chatSys(`${mem.name} 離開了`);
  broadcastRoster();
}

async function joinRoom(code) {
  closeNet();
  netWait(h('span', {}, '正在連線…'));
  const room = new Room(S.settings);
  S.room = room;
  S.net = { role: 'guest', code: String(code).replace(/\D/g, ''), members: [], started: false, mySeat: -1, cfg: {} };
  room.on('connected', () => room.send({ t: 'hello', name: myName(), ver: PROTOCOL, profile: myProfile() }));
  room.on('msg', (m) => queueNet(() => onGuestMsg(m)));
  room.on('lost', (reason) => {
    if (S.room !== room) return;
    endVoice();
    if (S.screen === 'game' && S.mode === 'net') {
      S.net.status = '⚠ ' + reason + '，比賽中斷';
      stopAllAI();
      chatSys(reason);
      renderAll();
      toast(reason, 'err', 6000);
    } else netWait(h('span', { class: 'err' }, reason));
  });
  room.on('call', (call) => onVoiceCall(call));
  try {
    await room.join(code);
  } catch (e) {
    netWait(h('span', { class: 'err' }, errMsg(e)));
    S.room = null;
    room.close();
  }
}

function applyMeta(meta) {
  if (!S.match) return;
  Object.assign(S.match, { idx: meta.idx, total: meta.total, wins: meta.wins.slice(), draws: meta.draws, over: meta.over, limitMs: meta.limitMs });
  meta.players.forEach((mp, i) => {
    const p = S.players[i];
    if (!p) return;
    Object.assign(p, { name: mp.name, level: mp.level, profile: mp.profile, kind: i === S.me ? 'me' : mp.kind === 'ai' ? 'ai' : 'remote' });
  });
}

async function onGuestMsg(m) {
  switch (m.t) {
    case 'full': netWait(h('span', { class: 'err' }, '這個房間人數已滿')); closeNet(); break;
    case 'old': netWait(h('span', { class: 'err' }, m.text || '版本不相容')); toast(m.text || '版本不相容', 'err', 8000); break;
    case 'end':
      if (S.mode === 'net') { S.net.status = '⚠ 房主已關閉房間'; stopAllAI(); chatSys('房主已關閉房間'); renderAll(); }
      else netWait(h('span', { class: 'err' }, '房主已關閉房間'));
      break;
    case 'welcome': S.net.mySeat = m.seat; renderLobby(); break;
    case 'roster':
      S.net.members = m.members || [];
      S.net.cfg = m.cfg || {};
      renderLobby();
      renderMembers();
      break;
    case 'start': {
      S.net.started = true;
      S.net.status = '';
      const mySeat = S.net.mySeat ?? -1;
      const players = m.meta.players.map((mp, i) => newPlayer({ name: mp.name, kind: i === mySeat ? 'me' : mp.kind === 'ai' ? 'ai' : 'remote', level: mp.level, profile: mp.profile }));
      setupMatch('net', players, mySeat, { rounds: m.meta.total, limit: m.meta.limitMs / 60000 }, m.meta.matchId);
      applyMeta(m.meta);
      netWait(null);
      renderMembers();
      chatSys(mySeat >= 0 ? '比賽開始！您是乙方。' : '比賽開始！您是觀眾。');
      xk.win.attention('比賽開始', '');
      if (mySeat >= 0) await versus();
      break;
    }
    case 'round': {
      if (S.mode !== 'net') return;
      applyMeta(m.meta);
      beginRound(m.r);
      if (m.resume) {
        // 中途加入：直接接上進行中的這一局
        S.round.startAt = Date.now() - (m.elapsed || 0);
        S.round.started = true;
        $$('.countdown').forEach((x) => x.remove());
        renderAll();
      }
      break;
    }
    case 'st': if (m.i !== S.me) applyRemoteState(m); break;
    case 'result': {
      if (S.mode !== 'net') return;
      stopAllAI();
      applyMeta(m.meta);
      // 勝負與比數以房主為準
      if (S.round) { S.round.over = true; S.round.winner = m.rec.winner; }
      await finishRound(m.rec, m.meta);
      break;
    }
    case 'advisor': if (S.players[m.i]) { S.players[m.i].profile = { ...S.players[m.i].profile, advisor: String(m.id) }; renderHud(); } break;
    case 'chat': chatLine(m.name, m.seat, String(m.text || '').slice(0, 500), false); break;
  }
}

function closeNet() {
  endVoice();
  if (S.room) {
    if (S.net && S.net.role === 'host') S.room.send({ t: 'end' });
    S.room.close();
    S.room = null;
  }
  if (S.net) S.net.started = false;
}

// ---------------- 文字聊天 ----------------
function chatLine(name, seat, text, mine) {
  const log = $('#chatLog');
  log.append(h('div', { class: 'chat-msg' + (mine ? ' me' : '') }, h('b', {}, mine ? '我' : `${name}${seat < 0 ? '（觀眾）' : ''}`), h('span', {}, text)));
  log.scrollTop = log.scrollHeight;
  if (!mine && !$('#pane-chat').classList.contains('on')) $('.tab[data-tab="chat"]').classList.add('ping');
}
function chatSys(text) {
  const log = $('#chatLog');
  log.append(h('div', { class: 'chat-msg sys' }, text));
  log.scrollTop = log.scrollHeight;
}
function sendChat() {
  const inp = $('#chatInput');
  const text = inp.value.trim();
  if (!text || !S.room || !S.room.connected) return;
  if (S.net.role === 'host') S.room.send({ t: 'chat', name: myName(), seat: 0, text });
  else S.room.send({ t: 'chat', text });
  chatLine(myName(), S.me, text, true);
  inp.value = '';
}

// ---------------- 語音通話（多人，兩兩直連） ----------------
async function getMic() {
  await xk.sys.askMicrophone();
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
}
function announceVoice(on) {
  if (!S.net || !S.room) return;
  if (S.net.role === 'host') {
    const m = S.net.members.find((x) => x.id === S.room.myId);
    if (m) m.voice = on;
    broadcastRoster();
  } else S.room.send({ t: 'voice', on });
}
function setVoiceUI() {
  $('#btnVoice').textContent = S.voice.on ? '⏹ 離開語音' : '🎤 加入語音';
  $('#btnMute').classList.toggle('hidden', !S.voice.on);
  $('#voiceBar').classList.toggle('on', S.voice.on);
  if (music) music.setDuck(S.voice.on && S.voice.calls.size > 0);
  renderMembers();
}
async function toggleVoice() {
  if (S.voice.on) { endVoice(); return; }
  if (!S.room || !S.room.connected) { toast('尚未連線', 'err'); return; }
  try { S.voice.mic = await getMic(); } catch (e) { toast('無法開啟麥克風：' + errMsg(e), 'err'); return; }
  S.voice.on = true;
  announceVoice(true);
  for (const m of S.net.members) if (m.voice && m.id !== S.room.myId && !S.voice.calls.has(m.id)) setupCall(m.id, S.room.call(m.id, S.voice.mic));
  setVoiceUI();
  chatSys('您已加入語音通話');
}
function onVoiceCall(call) {
  if (!S.voice.on || !S.voice.mic) { try { call.close(); } catch {} return; }
  if (S.voice.calls.has(call.peer)) closeCall(call.peer);
  call.answer(S.voice.mic);
  setupCall(call.peer, call);
}
function setupCall(id, call) {
  S.voice.calls.set(id, call);
  call.on('stream', (stream) => {
    let a = document.getElementById('aud-' + id);
    if (!a) { a = h('audio', { id: 'aud-' + id, autoplay: true }); $('#remoteAudios').append(a); }
    a.srcObject = stream;
    a.play().catch(() => {});
    setVoiceUI();
  });
  call.on('close', () => { if (S.voice.calls.get(id) === call) closeCall(id); });
  call.on('error', () => { if (S.voice.calls.get(id) === call) closeCall(id); });
}
function closeCall(id) {
  const c = S.voice.calls.get(id);
  S.voice.calls.delete(id);
  if (c) { try { c.close(); } catch {} }
  const a = document.getElementById('aud-' + id);
  if (a) { a.srcObject = null; a.remove(); }
  if (music) setVoiceUI();
}
function toggleMute() {
  if (!S.voice.mic) return;
  const t = S.voice.mic.getAudioTracks()[0];
  t.enabled = !t.enabled;
  $('#btnMute').textContent = t.enabled ? '🔇 靜音' : '🔈 取消靜音';
}
function endVoice() {
  const was = S.voice.on;
  for (const id of [...S.voice.calls.keys()]) closeCall(id);
  if (S.voice.mic) { S.voice.mic.getTracks().forEach((t) => t.stop()); S.voice.mic = null; }
  S.voice.on = false;
  if (was) { announceVoice(false); if (S.screen === 'game') chatSys('已離開語音通話'); }
  if (music) setVoiceUI();
}

// ---------------- 牌譜庫 ----------------
const MODE_NAME = { ai: '真人對 AI', net: '遠端真人', aivai: 'AI 對 AI', solo: '單人練習', import: '匯入' };
const KB = { q: '', result: 'all', mode: 'all', running: false, from: 1, to: 1000 };

function renderKB() {
  const box = $('#kbBody');
  box.innerHTML = '';
  const t0 = performance.now();
  const list = S.lib.filter(KB).slice().reverse();
  const st = S.lib.stats(S.lib.filter(KB));
  const ms = performance.now() - t0;
  const select = (key, opts) => h('select', { onchange: (e) => { KB[key] = e.target.value; renderKB(); } }, opts.map(([v, l]) => h('option', { value: v, selected: KB[key] === v }, l)));
  const q = h('input', { class: 'kb-q', placeholder: '搜尋牌局號碼或選手，例如 11982、承翰', value: KB.q, onkeydown: (e) => { if (e.key === 'Enter') { KB.q = e.target.value; renderKB(); } } });
  const stats = [
    [st.total, '累積局數'], [st.mine ? `${(st.rate * 100).toFixed(0)}%` : '—', '我的勝率'], [st.avgMs ? fmtTime(st.avgMs) : '—', '我的平均用時'],
    [st.fastest ? fmtTime(st.fastest) : '—', '我的最快紀錄'], [st.fewest || '—', '我的最少步數'], [`${st.solved}`, '已累積解法的牌局'], [st.avgBest ? st.avgBest.toFixed(1) : '—', '最短解平均步數'],
  ];
  const fromIn = h('input', { class: 'num-in', type: 'number', min: 1, max: MAX_DEAL, value: KB.from, onchange: (e) => { KB.from = Number(e.target.value) || 1; } });
  const toIn = h('input', { class: 'num-in', type: 'number', min: 1, max: MAX_DEAL, value: KB.to, onchange: (e) => { KB.to = Number(e.target.value) || KB.from; } });
  const progress = h('span', { class: 'muted small', id: 'kbProgress' });
  const dealIn = h('input', { class: 'num-in', type: 'number', min: 1, max: MAX_DEAL, placeholder: '牌局號碼', id: 'kbDeal' });
  box.append(
    h('div', { class: 'rec-head' },
      h('div', {}, h('h2', {}, '📚 牌譜庫'), h('p', { class: 'muted small' }, `每一局自動累積，並記住每個牌局號碼目前最短的解法（AI 會直接拿來用）。全部資料查詢 ${ms.toFixed(1)} 毫秒。`)),
      h('div', { class: 'rec-actions' },
        h('button', { onclick: () => importRecords() }, '📥 匯入牌譜'),
        h('button', { onclick: () => exportRecords() }, '📤 匯出牌譜'),
        h('button', { onclick: () => { renderHome(); showScreen('home'); } }, '回首頁'))),
    h('div', { class: 'kb-stats' }, stats.map(([a, b]) => h('div', { class: 'kb-card' }, h('b', {}, a), h('span', {}, b)))),
    h('div', { class: 'kb-grid2' },
      h('div', { class: 'kb-box' }, h('h4', {}, '⚡ 速算'), h('div', { class: 'kb-filter' }, h('span', {}, '牌局'), fromIn, h('span', {}, '到'), toIn,
        h('button', { class: 'primary', id: 'btnBatch', disabled: KB.running, onclick: () => batchSolve(KB.from, KB.to) }, '開始速算')),
        h('div', { class: 'kb-filter' }, dealIn, h('button', { onclick: () => { const n = Number(dealIn.value); if (n >= 1 && n <= MAX_DEAL) openReplayAI(n); } }, '🤖 看 AI 解答'), h('button', { onclick: () => { const n = Number(dealIn.value); if (n >= 1 && n <= MAX_DEAL) startSolo({ deal: n }); } }, '🃏 挑戰這局')),
        progress),
      h('div', { class: 'kb-box' }, h('h4', {}, '條件查詢'), h('div', { class: 'kb-filter' }, q,
        select('result', [['all', '全部結果'], ['win', '我贏'], ['lose', '我輸'], ['draw', '平手']]),
        select('mode', [['all', '全部模式'], ['ai', '真人對 AI'], ['net', '遠端真人'], ['aivai', 'AI 對 AI'], ['solo', '單人練習'], ['import', '匯入']]),
        h('button', { class: 'primary', onclick: () => { KB.q = q.value; renderKB(); } }, '查詢')))),
    list.length ? h('div', { class: 'rec-wrap' }, h('table', { class: 'rec-table' },
      h('tr', {}, ['日期', '模式', '牌局', '選手', '結果', '步數', '用時', '最短解', ''].map((t) => h('th', {}, t))),
      list.slice(0, 400).map((p) => {
        const best = S.lib.bestFor(p.no);
        const res = p.me >= 0 ? (p.winner === p.me ? '贏' : p.winner < 0 ? (p.names.length < 2 ? (p.res[0].done ? '過關' : '未完成') : '平') : '輸') : (p.winner >= 0 ? `${p.names[p.winner]} 贏` : '平');
        const who = p.me >= 0 ? p.me : Math.max(0, p.winner);
        const r = p.res[who] || p.res[0];
        return h('tr', {},
          h('td', {}, fmtDate(p.date)), h('td', {}, MODE_NAME[p.mode] || ''), h('td', {}, `#${p.no}`),
          h('td', { class: 'names' }, p.names.map((n, i) => h('span', { class: 'rec-name' + (i === p.me ? ' me' : '') }, n))),
          h('td', { class: res === '贏' || res === '過關' ? 'up' : res === '輸' ? 'down' : '' }, res),
          h('td', {}, r ? r.n : ''), h('td', {}, r ? fmtTime(r.ms) : ''), h('td', {}, best ? best.n : '—'),
          h('td', { class: 'ops' },
            h('button', { onclick: () => openReplayByKey(p.k) }, '重播'),
            h('button', { onclick: () => openReplayAI(p.no) }, 'AI 解答'),
            p.m && p.mode !== 'import' ? h('button', { class: 'danger', title: '刪除這場比賽', onclick: () => deleteMatch(p.m) }, '✕') : null));
      }))) : h('div', { class: 'empty' }, S.lib.plays.length ? '沒有符合條件的紀錄。' : '還沒有牌譜。打完一局就會自動存進來，也可以先用「速算」累積 AI 解法。'),
  );
}

async function deleteMatch(id) {
  const n = S.lib.plays.filter((p) => p.m === id).length;
  if (!(await modal('刪除比賽', `要刪除這場比賽的 ${n} 局紀錄嗎？（已累積的最短解法會保留）刪除後無法復原。`, [{ label: '取消', value: false }, { label: '刪除', value: true, primary: true }]))) return;
  await xk.games.delete(id);
  S.lib.removeMatch(id);
  await xk.kb.set(S.lib.toJSON());
  renderKB();
}

// 速算：多核心同時解一段牌局號碼，結果累積進牌譜庫
async function batchSolve(from, to) {
  from = Math.max(1, Math.min(MAX_DEAL, Math.floor(from))); to = Math.max(from, Math.min(MAX_DEAL, Math.floor(to)));
  if (to - from > 20000) { toast('一次最多速算 20,000 局', 'err'); return; }
  KB.running = true;
  if (S.screen === 'kb') renderKB();
  const t0 = performance.now();
  let done = 0, solved = 0, better = 0, steps = 0;
  const nos = [];
  for (let n = from; n <= to; n++) nos.push(n);
  await Promise.all(nos.map(async (no) => {
    const g = new Game(no);
    const r = await S.pool.solve(g, { profile: 'fast', front: false, deadline: Date.now() + 600000 });
    done++;
    if (r && verify(no, r.moves)) {
      solved++; steps += r.moves.length;
      const text = r.moves.map((m) => moveToText(m)).join(' ');
      if (S.lib.learn(no, text, r.moves.length, '速算 AI')) better++;
    } else if (UNSOLVABLE.has(no)) S.lib.markUnsolvable(no);
    const el = $('#kbProgress');
    if (el && (done % 10 === 0 || done === nos.length)) el.textContent = `速算中 ${done}/${nos.length}…`;
  }));
  await xk.kb.set(S.lib.toJSON());
  KB.running = false;
  const sec = (performance.now() - t0) / 1000;
  if (S.screen === 'kb') renderKB();
  const msg = `速算完成：${solved}/${nos.length} 局有解，平均 ${(steps / Math.max(1, solved)).toFixed(1)} 步，更新 ${better} 局最短解；用了 ${sec.toFixed(1)} 秒（${S.pool.size} 核心，每秒 ${(nos.length / sec).toFixed(0)} 局）`;
  toast(msg, 'ok', 8000);
  return { solved, total: nos.length, sec, better };
}

// 牌譜檔：
// [Deal "1"] [Player "承翰"] [Result "done"] [Time "123.4"] [Moves "3a 18 …"]
function recordsText(all) {
  const out = ['; 小柯機器人接龍遊戲牌譜（新接龍、微軟相容牌局號碼）', ''];
  for (const g of all) for (const r of g.history || []) for (const x of r.res) {
    out.push(`[Deal "${r.no}"]`, `[Date "${(r.date || g.date || '').slice(0, 10)}"]`, `[Player "${x.name}"]`, `[Result "${x.done ? 'done' : x.resigned ? 'resign' : 'unfinished'}"]`, `[Steps "${x.n}"]`, `[Time "${(x.ms / 1000).toFixed(1)}"]`, `[Moves "${x.moves}"]`, '');
  }
  for (const e of S.lib.deals.values()) if (e.best && e.best.by === '速算 AI') out.push(`[Deal "${e.no}"]`, '[Player "速算 AI"]', '[Result "done"]', `[Steps "${e.best.n}"]`, `[Moves "${e.best.moves}"]`, '');
  return out.join('\n');
}

export function parseRecords(text) {
  const recs = [];
  let cur = null;
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*\[(\w+)\s+"([^"]*)"\]\s*$/.exec(line);
    if (!m) { if (cur && cur.Deal && !line.trim()) { recs.push(cur); cur = null; } continue; }
    if (m[1] === 'Deal' && cur && cur.Deal) { recs.push(cur); cur = null; }
    cur ||= {};
    cur[m[1]] = m[2];
  }
  if (cur && cur.Deal) recs.push(cur);
  return recs.map((r) => ({ no: Number(r.Deal), player: r.Player || '匯入', moves: r.Moves || '', date: r.Date || '', ms: Math.round(Number(r.Time || 0) * 1000) })).filter((r) => r.no >= 1 && r.no <= MAX_DEAL);
}

async function importRecords() {
  const files = await xk.games.pickImport();
  let n = 0, learned = 0, bad = 0;
  for (const f of files) {
    if (f.error || !f.text) continue;
    for (const r of parseRecords(f.text)) {
      let mv;
      try { mv = parseMoves(r.moves); } catch { bad++; continue; }
      if (!mv.length || !verify(r.no, mv)) { bad++; continue; }
      const text = mv.map((m) => moveToText({ ...m, n: m.n || 1 })).join(' ');
      n++;
      if (S.lib.learn(r.no, r.moves, mv.length, r.player)) learned++;
      const k = `import-${r.no}-${text.length}-${uid()}`;
      S.lib.add({ k, m: '', no: r.no, date: r.date ? new Date(r.date).toISOString() : new Date().toISOString(), mode: 'import', names: [r.player], kinds: ['import'], res: [{ n: mv.length, ms: r.ms, found: 52, done: true, resigned: false }], winner: 0, me: -1, moves: r.moves });
    }
  }
  await xk.kb.set(S.lib.toJSON());
  toast(n ? `已匯入 ${n} 筆解法（更新 ${learned} 局最短解）${bad ? `，${bad} 筆無法驗證` : ''}` : '沒有可匯入的解法（要是小柯接龍牌譜格式）', n ? 'ok' : 'err', 6000);
  renderKB();
}

async function exportRecords() {
  const all = await xk.games.all();
  const text = recordsText(all);
  if (text.split('\n').length < 4) { toast('還沒有牌譜可以匯出', 'err'); return; }
  const p = await xk.games.export(`小柯接龍牌譜-${new Date().toISOString().slice(0, 10)}.txt`, text);
  if (p) toast('已匯出到 ' + p, 'ok');
}

// ---------------- 牌譜重播 ----------------
async function loadRecord(key) {
  const p = S.lib.plays.find((x) => x.k === key);
  if (p && p.mode === 'import') return { no: p.no, res: [{ name: p.names[0], moves: p.moves, profile: null }], g: { me: -1 } };
  const [m, idx] = key.split('#');
  const g = await xk.games.get(m);
  if (!g) return null;
  const rec = g.history.find((r) => String(r.idx) === idx);
  return rec ? { ...rec, g } : null;
}

async function openReplayByKey(key) {
  const r = await loadRecord(key);
  if (!r) { toast('找不到這一局的完整牌譜', 'err'); return; }
  const who = r.g.me >= 0 ? r.g.me : Math.max(0, r.winner ?? 0);
  const x = r.res[who] || r.res[0];
  let moves;
  try { moves = parseMoves(x.moves); } catch { toast('這一局的走法紀錄損壞', 'err'); return; }
  startReplay(r.no, moves, `重播：牌局 #${r.no}．${x.name}`, x.profile);
}

async function openReplayAI(no) {
  if (UNSOLVABLE.has(no)) { toast(`牌局 #${no} 是已知無解的牌局（一百萬局裡只有 8 局無解）`, 'err', 5000); return; }
  toast('AI 正在速算最短解…', 'info', 1500);
  const b = S.lib.bestFor(no);
  let moves = null, by = 'AI';
  const g = new Game(no);
  g.begin();
  const r = await S.pool.best(g, { budgetMs: 3000 });
  if (r) moves = r.moves;
  if (b) { try { const mv = parseMoves(b.moves); if (verify(no, mv) && (!moves || mv.length <= moves.length)) { moves = mv; by = b.by; } } catch {} }
  if (!moves) { toast(UNSOLVABLE.has(no) ? `牌局 #${no} 是已知無解的牌局` : '這一局 AI 算不出來', 'err', 5000); return; }
  if (r && (!b || r.moves.length < b.n)) { S.lib.learn(no, r.moves.map(moveToText).join(' '), r.moves.length, '速算 AI'); saveLib(); }
  startReplay(no, moves, `AI 解答：牌局 #${no}．${moves.length} 步（${by}）`, null);
}

function startReplay(no, moves, label, profile) {
  stopAllAI();
  closeNet();
  S.mode = 'replay';
  document.body.className = 'mode-replay';
  S.players = [];
  S.round = null;
  S.replay = { no, moves, step: 0, total: moves.length, label, timer: 0, profile };
  $('#eventLog').innerHTML = '';
  selectTab('log');
  logLine(label, 'sys');
  showScreen('game');
  table.setInteractive(false);
  replayGo(0, true);
}

function replayGo(step, deal = false) {
  const R = S.replay;
  if (!R) return;
  R.step = Math.max(0, Math.min(R.total, step));
  let g;
  try { g = replayGame(R.no, R.moves, R.step); } catch (e) { toast(errMsg(e), 'err'); return; }
  const m = R.moves[R.step];
  table.hint = m && R.step < R.total ? { ...m, n: m.n || 1 } : null;
  table.layout([g.view(), null], { deal });
  $('#rpInfo').textContent = `第 ${R.step} / ${R.total} 步．回收 ${g.foundCount}/52` + (m ? `．下一步：${describeMove(g, { ...m, n: m.n || g.moveSize(m.f, m.t), c: g.cardAt(m.f, m.n || 1) })}` : g.won ? '．全部歸位！' : '');
  if (R.step >= R.total && g.won) table.celebrateWin(0);
  renderBanner();
}

function replayAuto() {
  const R = S.replay;
  if (R.timer) { stopReplayAuto(); return; }
  $('#rpPlay').textContent = '⏸ 暫停';
  R.timer = setInterval(() => {
    if (!S.replay || R.step >= R.total) { stopReplayAuto(); return; }
    replayGo(R.step + 1);
    sfx.card();
  }, 800);
}
function stopReplayAuto() {
  const R = S.replay;
  if (R && R.timer) { clearInterval(R.timer); R.timer = 0; }
  $('#rpPlay').textContent = '▶ 播放';
}
function replayAI() { if (S.replay) { stopReplayAuto(); openReplayAI(S.replay.no); } }

// ---------------- 關於與版本更新 ----------------
async function openAbout() {
  const status = h('div', { class: 'upd-status muted' }, '正在檢查是否有新版本…');
  const body = h('div', { class: 'about' },
    h('div', { class: 'about-head' }, h('img', { class: 'hero-icon small', src: '../../build/icon.png' }),
      h('div', {}, h('h2', {}, APP_NAME), h('div', { class: 'muted' }, `版本 v${S.info.version}　（${{ darwin: 'macOS', win32: 'Windows', android: 'Android', ios: 'iPad／iPhone', web: '網頁版' }[S.info.platform] || S.info.platform}）`))),
    h('p', { class: 'credit-line' }, CREDIT),
    h('p', { class: 'muted small' }, '3D 新接龍（FreeCell，與 Windows 相同的一百萬局牌局號碼）：真人對 AI、AI 對 AI、遠端真人（AI 補位、觀戰、語音與文字聊天）、單人練習；AI 軍師指點與接手主位；牌譜庫（累積、查詢、重播、最短解學習、多核心速算）；20 首原創背景音樂；接龍教學與系統說明（動畫與語音）。'),
    h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: S.settings.autoUpdate !== false, onchange: (e) => saveSettings({ autoUpdate: e.target.checked }) }), ' 開啟程式時自動檢查新版本'),
    status);
  const p = modal('關於與更新', body, [{ label: '關閉', value: false, primary: true }]);
  checkUpdate(true, status);
  await p;
}

async function checkUpdate(manual, statusEl) {
  let info;
  try { info = await xk.update.check(); }
  catch (e) { if (statusEl) statusEl.textContent = '無法檢查更新：' + errMsg(e); return; }
  if (!info.newer) { if (statusEl) statusEl.textContent = `✅ 已經是最新版本（v${info.current}）`; return; }
  const go = () => startUpdate(info);
  if (statusEl) {
    statusEl.innerHTML = '';
    statusEl.append(h('span', {}, `🔔 有新版本 v${info.latest}（目前 v${info.current}）　`),
      h('button', { class: 'primary', id: 'btnDoUpdate', onclick: () => { $$('.modal-back').forEach((b) => b.remove()); go(); } }, '立即更新'));
    return;
  }
  const v = await modal(`發現新版本 v${info.latest}`, h('div', {},
    h('p', {}, `目前版本 v${info.current}，要更新到 v${info.latest} 嗎？`),
    info.notes ? h('pre', { class: 'upd-notes' }, info.notes) : null), [{ label: '稍後再說', value: false }, { label: '立即更新', value: true, primary: true }]);
  if (v) go();
}

async function startUpdate(info) {
  if (info.flavor === 'web') {
    if (await modal('線上版有新版本', h('p', {}, `要重新載入網頁更新到 v${info.latest} 嗎？牌譜和設定都會保留。`), [{ label: '稍後', value: false }, { label: '重新載入', value: true, primary: true }])) location.reload();
    return;
  }
  if (!info.canInstall) {
    const text = info.flavor === 'dev' ? '目前是開發版，請到 GitHub 下載安裝檔。' : info.flavor === 'ios' ? '會用 Safari 開啟 GitHub 安裝頁，按「安裝到這台 iPad／iPhone」就會更新（限開發者登記過的裝置）。' : '找不到這個平台的安裝檔，請到 GitHub 下載。';
    const v = await modal('下載新版本', h('p', {}, text), [{ label: '取消', value: false }, { label: info.flavor === 'ios' ? '開啟安裝頁' : '開啟下載頁', value: true, primary: true }]);
    if (v) xk.update.openPage();
    return;
  }
  const bar = h('div', { class: 'upd-bar' }, h('div', { class: 'upd-fill' }));
  const txt = h('div', { class: 'muted small' }, '準備下載…');
  const box = h('div', { class: 'upd-box' }, h('b', {}, `正在下載 v${info.latest}`), bar, txt);
  document.body.append(box);
  const off = xk.update.onProgress(({ got, total }) => {
    const pct = total ? Math.floor((got / total) * 100) : 0;
    bar.firstChild.style.width = pct + '%';
    txt.textContent = `${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB（${pct}%）`;
  });
  try {
    const file = await xk.update.download();
    off();
    txt.textContent = info.flavor === 'mac' ? '下載完成，正在開啟安裝檔…' : info.flavor === 'android' ? '下載完成，正在開啟安裝畫面…' : '下載完成，正在安裝，程式會自動重新開啟…';
    const r = await xk.update.install(file);
    if (r.manual) {
      box.remove();
      await modal('請完成安裝', h('div', {},
        info.flavor === 'android' ? h('p', {}, '請在 Android 的安裝畫面按「更新」或「安裝」，完成後重新開啟小柯接龍。') : h('p', {}, '新版安裝檔已開啟（也放在「下載」資料夾）。'),
        info.flavor === 'android' ? null : h('p', {}, info.flavor === 'mac' ? `請先結束本程式，再把「${APP_NAME}」拖到「應用程式」資料夾覆蓋舊版。` : '請依照畫面指示完成安裝。')));
    }
  } catch (e) {
    off();
    box.remove();
    toast('更新失敗：' + errMsg(e), 'err', 8000);
  }
}

// ---------------- 設定 ----------------
async function openSettings() {
  const s = S.settings;
  const f = {};
  const row = (label, el, tip) => h('div', { class: 'set-row' }, h('label', {}, label), el, tip ? h('div', { class: 'muted small' }, tip) : null);
  f.name = h('input', { value: s.playerName });
  f.sfx = h('input', { type: 'checkbox', checked: s.sfx });
  f.voiceCall = h('input', { type: 'checkbox', checked: s.voiceCall !== false });
  f.autoplay = h('input', { type: 'checkbox', checked: s.music.autoplay });
  f.autoUpdate = h('input', { type: 'checkbox', checked: s.autoUpdate !== false });
  f.key = h('input', { type: 'password', placeholder: s.advisor.hasKey ? '（已設定，留空表示不變更）' : 'sk-ant-…' });
  f.model = h('select', {}, ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].map((m) => h('option', { value: m, selected: s.advisor.model === m }, m)));
  f.effort = h('select', {}, [['low', '快速（low）'], ['medium', '一般（medium）'], ['high', '深入（high）']].map(([v, l]) => h('option', { value: v, selected: s.advisor.effort === v }, l)));
  f.srvMode = h('select', {}, h('option', { value: 'public', selected: s.server.mode !== 'custom' }, '公用配對伺服器（PeerJS Cloud）'), h('option', { value: 'custom', selected: s.server.mode === 'custom' }, '自架伺服器'));
  f.host = h('input', { value: s.server.host, placeholder: '例如 peer.example.com' });
  f.port = h('input', { value: s.server.port, type: 'number', style: { width: '90px' } });
  f.path = h('input', { value: s.server.path, style: { width: '90px' } });
  f.secure = h('input', { type: 'checkbox', checked: s.server.secure });
  f.stun = h('textarea', { rows: 2, value: s.stun });
  f.turnUrls = h('input', { value: s.turn.urls, placeholder: 'turn:turn.example.com:3478' });
  f.turnUser = h('input', { value: s.turn.username, placeholder: '帳號' });
  f.turnPass = h('input', { type: 'password', value: s.turn.credential, placeholder: '密碼' });
  const testOut = h('div', { class: 'muted small' });
  const body = h('div', { class: 'settings' },
    h('h4', {}, '一般'),
    row('我的暱稱', f.name),
    row('半身照與軍師', h('button', { onclick: () => chooseProfile(false) }, '更換半身照與 AI 軍師')),
    row('音效', h('label', { class: 'chk' }, f.sfx, ' 搬牌、歸位、洗牌音效')),
    row('語音播報', h('label', { class: 'chk' }, f.voiceCall, ' 唸出開始、完成、時間到'), voice.available ? `語音：${voice.voiceName}` : '這台電腦沒有中文語音，無法播報'),
    row('背景音樂', h('label', { class: 'chk' }, f.autoplay, ' 開啟程式後自動播放')),
    row('版本更新', h('label', { class: 'chk' }, f.autoUpdate, ' 開啟程式時自動檢查新版本')),
    h('h4', {}, 'AI 軍師（Claude）'),
    row('Anthropic API 金鑰', f.key, s.advisor.envKey && !s.advisor.hasKey ? '已偵測到環境變數 ANTHROPIC_API_KEY。' : '金鑰會加密存在本機，只用來呼叫 Claude。沒有金鑰時軍師仍會提供本機解算器的建議。'),
    row('模型', f.model),
    row('思考深度', f.effort),
    h('div', { class: 'set-row' }, h('label', {}, ''), h('button', { onclick: async () => { testOut.textContent = '測試中…'; await applySettings(f); const r = await xk.advisor.test(); testOut.textContent = r.ok ? `✅ ${r.text}` : `❌ ${r.error}`; } }, '測試金鑰'), testOut),
    h('h4', {}, '遠端連線'),
    row('配對伺服器', f.srvMode),
    row('自架伺服器', h('div', { class: 'inline' }, f.host, f.port, f.path, h('label', { class: 'chk' }, f.secure, ' HTTPS'))),
    row('STUN', f.stun),
    row('TURN（跨網路連不上時）', h('div', { class: 'inline' }, f.turnUrls, f.turnUser, f.turnPass)),
    h('h4', {}, '版本'),
    h('div', { class: 'set-row' }, h('label', {}, `目前 v${S.info.version}`), h('button', { onclick: () => { $$('.modal-back').forEach((b) => b.remove()); openAbout(); } }, '檢查更新')),
    h('p', { class: 'credit-line small' }, `${APP_NAME} v${S.info.version}．${CREDIT}`),
  );
  const ok = await modal('設定', body, [{ label: '取消', value: false }, { label: '儲存', value: true, primary: true }]);
  if (ok) { await applySettings(f); toast('設定已儲存', 'ok'); renderHome(); }
}

async function applySettings(f) {
  const patch = {
    playerName: f.name.value.trim() || '玩家',
    sfx: f.sfx.checked,
    voiceCall: f.voiceCall.checked,
    autoUpdate: f.autoUpdate.checked,
    music: { autoplay: f.autoplay.checked },
    advisor: { model: f.model.value, effort: f.effort.value },
    server: { mode: f.srvMode.value, host: f.host.value.trim(), port: Number(f.port.value) || 9000, path: f.path.value.trim() || '/', secure: f.secure.checked },
    stun: f.stun.value,
    turn: { urls: f.turnUrls.value.trim(), username: f.turnUser.value.trim(), credential: f.turnPass.value },
  };
  if (f.key.value.trim()) patch.advisor.apiKey = f.key.value.trim();
  await saveSettings(patch);
  f.key.value = '';
  setSfx(S.settings.sfx);
  voice.enabled = S.settings.voiceCall !== false;
  advisor.setHasKey(S.settings.advisor.hasKey);
  renderVolume();
}

window.addEventListener('beforeunload', () => { closeNet(); });
init().catch((e) => { console.error(e); document.body.append(h('pre', { class: 'fatal' }, '啟動失敗：' + (e.stack || e))); });

export { cardSpeech, isRed, rankOf, maxMoveCount };
