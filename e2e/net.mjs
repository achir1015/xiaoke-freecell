// 遠端對賽測試：本機配對伺服器＋三個實例（房主、乙方、觀眾）
// 同一局牌、局面同步、先完成者勝、聊天、軍師接手、斷線由 AI 補位
// 用法：node e2e/net.mjs
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
import { PeerServer } from 'peer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { checker, sleep } from './lib.mjs';

const require = createRequire(import.meta.url);
const PORT = 9171;
const server = PeerServer({ port: PORT, path: '/', key: 'peerjs' });
await sleep(500);
const appData = process.env.APPDATA || path.join(os.homedir(), 'Library', 'Application Support');
const C = checker();
const { check } = C;

async function open(name) {
  fs.rmSync(path.join(appData, 'xiaoke-freecell-' + name), { recursive: true, force: true });
  const app = await electron.launch({ executablePath: require('electron'), args: ['.', `--profile=${name}`, '--hidden', '--autoplay-policy=no-user-gesture-required'] });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  const waitFor = async (fn, arg, ms = 30000) => {
    const t = Date.now();
    for (;;) {
      const v = await win.evaluate(fn, arg).catch(() => false);
      if (v) return v;
      if (Date.now() - t > ms) throw new Error(`${name} 等待逾時：` + fn);
      await sleep(120);
    }
  };
  await waitFor(() => !!document.querySelector('.modal .pf'));
  await win.evaluate(async ({ PORT, name }) => {
    document.querySelectorAll('.pf-pane')[0].querySelectorAll('.pf-item')[name.length % 7].click();
    document.querySelectorAll('.pf-pane')[2].querySelector('.pf-item').click();
    document.querySelector('.pf-ok').click();
    await xk.settings.set({ playerName: name, server: { mode: 'custom', host: '127.0.0.1', port: PORT, path: '/', secure: false } });
    window.__xkf.settings = await xk.settings.get();
  }, { PORT, name });
  return { app, win, waitFor, errors, name };
}

const A = await open('netHost'), B = await open('netGuest'), W = await open('netWatch');
await A.win.evaluate(() => { document.querySelector('#rdNet').value = '3'; document.querySelector('#lvNet').value = '0'; document.querySelector('#btnHost').click(); });
await A.waitFor(() => !!document.querySelector('.room-code'));
const code = await A.win.evaluate(() => window.__xkf.net.code);
check('建立房間得到 6 位數房號', /^\d{6}$/.test(code), code);
await B.win.evaluate((c) => { document.querySelector('#joinCode').value = c; document.querySelector('#btnJoin').click(); }, code);
await B.waitFor(() => window.__xkf.net && window.__xkf.net.mySeat === 1);
await W.win.evaluate((c) => { document.querySelector('#joinCode').value = c; document.querySelector('#btnJoin').click(); }, code);
await W.waitFor(() => window.__xkf.net && window.__xkf.net.members.length === 3);
check('第二位加入的是乙方、第三位是觀眾', await W.win.evaluate(() => window.__xkf.net.mySeat === -1) && await A.win.evaluate(() => window.__xkf.net.members.filter((m) => m.seat < 0).length === 1));

await A.win.evaluate(() => document.querySelector('#btnStartNet').click());
for (const X of [A, B, W]) await X.waitFor(() => window.__xkf.mode === 'net' && window.__xkf.round && window.__xkf.round.started, null, 20000);
const nos = await Promise.all([A, B, W].map((X) => X.win.evaluate(() => window.__xkf.round.no)));
check('三台都是同一局牌', nos[0] === nos[1] && nos[1] === nos[2], nos.join(','));
check('房主是甲方、對手是遠端真人', await A.win.evaluate(() => window.__xkf.me === 0 && window.__xkf.players[1].kind === 'remote'));
check('觀眾不能操作', await W.win.evaluate(() => window.__xkf.me === -1 && !window.__xkfTable.interactive));

// 乙方走三步，房主與觀眾看到同步
await B.win.evaluate(async () => {
  const S = window.__xkf;
  const r = await S.pool.solve(S.players[1].game, { profile: 'fast' });
  for (const m of r.moves.slice(0, 3)) window.__xkfApi.tryMove(m.f, m.t, m.n, { quiet: true });
});
await A.waitFor(() => window.__xkf.players[1].game.moveCount === 3, null, 10000);
check('房主看到乙方的局面', true);
await W.waitFor(() => window.__xkf.players[1].game.moveCount === 3, null, 10000);
check('觀眾也看到乙方的局面', await W.win.evaluate(() => window.__xkf.players[1].game.cols.flat().length + window.__xkf.players[1].game.cells.filter((c) => c >= 0).length + window.__xkf.players[1].game.foundCount === 52));

// 聊天
await B.win.evaluate(() => { document.querySelector('#chatInput').value = '加油！'; document.querySelector('#chatSend').click(); });
await A.waitFor(() => [...document.querySelectorAll('.chat-msg')].some((m) => m.textContent.includes('加油！')), null, 8000);
check('文字聊天', await W.waitFor(() => [...document.querySelectorAll('.chat-msg')].some((m) => m.textContent.includes('加油！')), null, 8000));

// 乙方請軍師接手：房主看到「軍師接手」
await B.win.evaluate(() => document.querySelector('#btnProxy').click());
await A.waitFor(() => window.__xkf.players[1].proxy === true, null, 8000);
check('軍師接手會同步給對手', true);
// 軍師打完 → 乙方贏第一局
await A.waitFor(() => window.__xkf.round.over, null, 40000);
check('乙方先完成，第一局乙方贏', await A.win.evaluate(() => window.__xkf.round.winner === 1 && window.__xkf.match.wins[1] === 1));
await B.waitFor(() => window.__xkf.match.history.length === 1 && window.__xkf.match.wins[1] === 1, null, 10000);
check('乙方收到結果與比數', true);
check('觀眾收到結果', await W.waitFor(() => window.__xkf.match.history.length === 1, null, 10000));
check('三台的牌譜庫都累積這一局', await Promise.all([A, B, W].map((X) => X.win.evaluate(() => window.__xkf.lib.plays.length === 1))).then((r) => r.every(Boolean)));

// 第二局：乙方離線 → AI 補位
await A.win.evaluate(() => { document.querySelector('.modal .modal-btns .primary').click(); });
await A.waitFor(() => window.__xkf.round.idx === 2 && window.__xkf.round.started, null, 20000);
await B.waitFor(() => window.__xkf.round.idx === 2 && window.__xkf.round.started, null, 20000);
check('第二局同步開始', await B.win.evaluate(() => window.__xkf.round.no) === await A.win.evaluate(() => window.__xkf.round.no));
await B.app.close();
await A.waitFor(() => window.__xkf.players[1].kind === 'ai', null, 30000);
check('乙方離線後由 AI 補位', true);
await A.waitFor(() => window.__xkf.round.over, null, 60000);
check('補位 AI 完成這一局', await A.win.evaluate(() => window.__xkf.round.winner === 1));
check('觀眾看到 AI 補位的進度', await W.waitFor(() => window.__xkf.players[1].game.foundCount === 52 || window.__xkf.round.over, null, 15000));

const errs = [...A.errors, ...W.errors].filter((e) => !/peerjs|Could not connect/.test(e));
check('沒有頁面錯誤', errs.length === 0, errs.join('\n'));
console.log(`\n通過 ${C.pass}，失敗 ${C.fail}`);
await A.app.close(); await W.app.close();
server.close?.();
process.exit(C.fail ? 1 : 0);
