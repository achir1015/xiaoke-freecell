// 用真實視窗（最大化、不模擬尺寸、正常速度）檢查版面與 AI 節奏：node e2e/real-window.mjs
import { launch, sleep, checker } from './lib.mjs';

const C = checker();
const { app, win, errors, waitFor, shot, pickProfile } = await launch('e2eReal', { args: ['--realtime'] });
await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.maximize(); });
await waitFor(() => !!document.querySelector('#homeBody .mode-grid'));
await sleep(900);
const info = await win.evaluate(() => ({ dpr: devicePixelRatio, inner: [innerWidth, innerHeight] }));
const wb = await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0]; return { content: w.getContentSize(), zoom: w.webContents.getZoomFactor(), wa: screen.getPrimaryDisplay().workAreaSize, scale: screen.getPrimaryDisplay().scaleFactor }; });
console.log(JSON.stringify({ ...info, ...wb }));
await pickProfile();
await shot('real-home');
const inside = (sels) => win.evaluate((sels) => {
  const vw = innerWidth, vh = innerHeight, out = [];
  for (const sel of sels) {
    for (const e of document.querySelectorAll(sel)) {
      const r = e.getBoundingClientRect();
      if (r.width && (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1)) out.push(`${sel} ${[r.left, r.top, r.right, r.bottom].map(Math.round)}`);
    }
  }
  return out;
}, sels);
await win.evaluate(() => { document.querySelector('#lvAI').value = '0'; document.querySelector('#startAI').click(); });
await waitFor(() => window.__xkf.round && window.__xkf.round.started, null, 20000);
const t0 = Date.now();
const m0 = await win.evaluate(() => window.__xkf.players[1].game.moveCount);
await sleep(12000);
const m1 = await win.evaluate(() => window.__xkf.players[1].game.moveCount);
const pace = (Date.now() - t0) / Math.max(1, m1 - m0);
C.check(`AI 入門每步約 2～3 秒（實測 ${(pace / 1000).toFixed(1)} 秒，${m1 - m0} 步）`, pace > 1600 && pace < 6000);
await shot('real-game');
const bad = await inside(['.topbar', '.right', '.board-wrap', '.table-btns', '.hud-card', '.score-badge']);
C.check('牌桌畫面元件都在視窗內', bad.length === 0, bad.join('; '));
// 模擬使用者螢幕縮放（視窗變小）
await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setContentSize(1100, 640); });
await sleep(1200);
await shot('real-small');
const bad2 = await inside(['.topbar', '.right', '.board-wrap', '.table-btns', '.hud-card', '.score-badge']);
C.check('小視窗時元件也在視窗內', bad2.length === 0, bad2.join('; '));
await win.evaluate(() => document.querySelector('#btnHome').click());
await sleep(300);
await win.evaluate(() => document.querySelector('.modal .modal-btns .primary')?.click());
await waitFor(() => window.__xkf.screen === 'home');
await sleep(500);
await shot('real-home-small');
await win.evaluate(() => document.querySelector('#btnGuide').click());
await sleep(2500);
await shot('real-guide-small');
C.check('沒有頁面錯誤', errors.length === 0, errors.join('\n'));
console.log(`\n通過 ${C.pass}，失敗 ${C.fail}`);
await app.close();
