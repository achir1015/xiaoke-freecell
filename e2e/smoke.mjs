// 單機端對端測試：首頁、半身照、真人對 AI（滑鼠拖曳、點選、雙擊、悔棋、提示、軍師接手、換軍師、過關）、
// 牌譜庫（累積、最短解、重播、AI 解答、速算）、教學、AI 對 AI、單人練習、設定與關於
// 用法：node e2e/smoke.mjs [截圖資料夾]
import { launch, sleep, checker } from './lib.mjs';

const outDir = process.argv[2] || 'e2e/out';
const C = checker();
const { check } = C;
const { app, win, errors, waitFor, shot, pickProfile } = await launch('e2eSmoke', { outDir });

await waitFor(() => !!document.querySelector('#homeBody .mode-grid'));
check('首頁顯示四種模式', await win.evaluate(() => document.querySelectorAll('.mode-card').length === 4));
check('第一次要選半身照與軍師', await win.evaluate(() => !!document.querySelector('.modal .pf')));
check('半身照 男 20 女 20', await win.evaluate(() => document.querySelectorAll('.pf-pane')[0].querySelectorAll('.pf-item').length === 20 && document.querySelectorAll('.pf-pane')[1].querySelectorAll('.pf-item').length === 20));
check('軍師 30 位', await win.evaluate(() => document.querySelectorAll('.pf-pane')[2].querySelectorAll('.pf-item').length === 30));
check('沒選好不能確定', await win.evaluate(() => document.querySelector('.pf-ok').disabled));
await pickProfile();
await shot('01-home');
check('背景音樂 20 首、每首 3 分多鐘', await win.evaluate(async () => { const l = await xk.music.list(); return l.length === 20 && l.every((t) => t.seconds >= 180 && t.seconds < 240); }));

// ---------------- A：真人對 AI（第 1 局固定牌局 #1，AI 入門） ----------------
await win.evaluate(() => { document.querySelector('#lvAI').value = '0'; document.querySelector('#rdAI').value = '3'; document.querySelector('#dealAI').value = '1'; document.querySelector('#startAI').click(); });
await waitFor(() => window.__xkf.mode === 'ai' && window.__xkf.round && window.__xkf.round.started, null, 20000);
check('第一局是牌局 #1', await win.evaluate(() => window.__xkf.round.no === 1));
check('雙方拿到同一局牌', await win.evaluate(() => window.__xkf.players.every((p) => p.game.deal === 1)));
// 先暫停，讓 AI 別搶先完成
await win.evaluate(() => document.querySelector('#btnPause').click());
check('暫停後 AI 不動', await (async () => { const a = await win.evaluate(() => window.__xkf.players[1].game.moveCount); await sleep(800); return a === await win.evaluate(() => window.__xkf.players[1].game.moveCount); })());
check('暫停時不能操作', await win.evaluate(() => !window.__xkfTable.interactive));
await win.evaluate(() => document.querySelector('#btnPause').click());
await sleep(300);
await win.evaluate(() => { window.__xkf.players[1].token++; window.__xkf.players[1].level = 0; }); // 停住 AI，等一下再放它跑
await sleep(500);
await shot('02-game');

// 用滑鼠實際拖曳：找一步「牌列 → 牌列」或「牌列 → 暫存格」的合法走法
const drag = await win.evaluate(() => {
  const g = window.__xkf.players[0].game;
  for (let f = 0; f < 8; f++) for (let t = 0; t < 8; t++) if (f !== t && g.cols[t].length && g.moveSize(f, t) === 1) return { f, t, card: g.cols[f][g.cols[f].length - 1], dst: g.cols[t][g.cols[t].length - 1] };
  return { f: 0, t: 8, card: g.cols[0][g.cols[0].length - 1], dst: -1 };
});
const from = await win.evaluate((d) => window.__xkfTable.screenOf(0, d.card), drag);
const to = await win.evaluate((d) => (d.dst >= 0 ? window.__xkfTable.screenOf(0, d.dst) : window.__xkfTable.screenOf(0, null, 8)), drag);
await win.mouse.move(from.x, from.y);
await win.mouse.down();
for (let i = 1; i <= 12; i++) { await win.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12 + 6); await sleep(16); }
await shot('03-drag');
await win.mouse.up();
await sleep(400);
check('滑鼠拖曳搬牌', await win.evaluate((d) => { const g = window.__xkf.players[0].game; return g.moveCount === 1 && (d.t < 8 ? g.cols[d.t][g.cols[d.t].length - 1] === d.card : g.cells.includes(d.card)); }, drag));

// 悔棋
await win.evaluate(() => document.querySelector('#btnUndo').click());
await sleep(200);
check('悔棋退回', await win.evaluate(() => window.__xkf.players[0].game.moveCount === 0));

// 點選：點牌 → 點暫存格
const card0 = await win.evaluate(() => { const g = window.__xkf.players[0].game; return g.cols[2][g.cols[2].length - 1]; });
let p = await win.evaluate((c) => window.__xkfTable.screenOf(0, c), card0);
await win.mouse.click(p.x, p.y);
await sleep(250);
check('點一下選起來', await win.evaluate(() => !!window.__xkf.sel && window.__xkf.sel.loc === 2));
p = await win.evaluate(() => window.__xkfTable.screenOf(0, null, 9));
await win.mouse.click(p.x, p.y);
await sleep(300);
check('再點目的地就搬過去', await win.evaluate((c) => window.__xkf.players[0].game.cells[1] === c, card0));

// 雙擊：暫存格的牌自動找去處（或留著）；再測一次不合法搬動會提示原因
await win.evaluate(() => { const g = window.__xkf.players[0].game; return window.__xkfApi.tryMove(9, g.cols.findIndex((c) => c.length === 0) >= 0 ? 0 : 0, 1, { quiet: true }); });
const illegal = await win.evaluate(() => {
  const g = window.__xkf.players[0].game;
  for (let f = 0; f < 8; f++) for (let t = 0; t < 8; t++) if (f !== t && g.cols[t].length && g.cols[f].length && !g.moveSize(f, t, 1)) { window.__xkfApi.tryMove(f, t, 1); return true; }
  return false;
});
await sleep(200);
check('不合法的搬法會說明原因', illegal && await win.evaluate(() => [...document.querySelectorAll('.toast.err')].some((t) => /不能接在|最多只能搬|回收座/.test(t.textContent))));

// 提示
await win.evaluate(() => document.querySelector('#btnHint').click());
await waitFor(() => !!window.__xkfTable.hint, null, 10000);
check('提示標出下一步', await win.evaluate(() => { const m = window.__xkfTable.hint; return window.__xkf.players[0].game.moveSize(m.f, m.t, m.n) > 0; }));
await shot('04-hint');

// 軍師面板
await win.evaluate(() => document.querySelector('.adv-quick .chip').click());
await waitFor(() => { const m = [...document.querySelectorAll('.adv-msg.ai')].pop(); return m && !m.classList.contains('thinking') && /建議|沒有解/.test(m.textContent); }, null, 15000);
check('軍師（離線）給出建議與步數', await win.evaluate(() => /最快還要約 \d+ 步/.test([...document.querySelectorAll('.adv-msg.ai')].pop().textContent)));

// 換軍師
await win.evaluate(() => document.querySelector('#btnChangeAdv').click());
await waitFor(() => !!document.querySelector('.modal .pf-grid'));
const advBefore = await win.evaluate(() => window.__xkf.players[0].profile.advisor);
await win.evaluate(() => { document.querySelectorAll('.modal .pf-item')[5].click(); document.querySelector('.modal .modal-btns .primary').click(); });
await sleep(300);
check('比賽中換軍師', await win.evaluate((a) => window.__xkf.players[0].profile.advisor !== a, advBefore));

// 軍師接手：替我把這局打完（AI 對手先停著）
await win.evaluate(() => document.querySelector('#btnProxy').click());
check('軍師接手後不能自己操作', await win.evaluate(() => !window.__xkfTable.interactive && window.__xkf.players[0].proxy));
await waitFor(() => window.__xkf.players[0].game.moveCount >= 5, null, 20000);
await win.evaluate(() => document.querySelector('#btnProxy').click());
check('換回主位', await win.evaluate(() => !window.__xkf.players[0].proxy && window.__xkfTable.interactive));
// 自己照解算器走完（模擬真人）
const solved = await win.evaluate(async () => {
  const S = window.__xkf;
  const r = await S.pool.solve(S.players[0].game, { profile: 'fast' });
  if (!r) return false;
  for (const m of r.moves) if (!window.__xkfApi.tryMove(m.f, m.t, m.n, { quiet: true })) return false;
  return S.players[0].game.won;
});
check('照解法走完全部歸位', solved);
await waitFor(() => !!document.querySelector('.modal .res-table'), null, 8000);
await shot('05-result');
check('第 1 局由我獲勝', await win.evaluate(() => window.__xkf.match.wins[0] === 1 && window.__xkf.round.winner === 0));
check('牌譜庫記下最短解', await win.evaluate(() => !!window.__xkf.lib.bestFor(1)));
// 第 2 局：讓 AI 先完成
await win.evaluate(() => document.querySelector('.modal .modal-btns .primary').click());
await waitFor(() => window.__xkf.round.idx === 2 && window.__xkf.round.started, null, 15000);
check('第 2 局換下一個牌局號碼', await win.evaluate(() => window.__xkf.round.no === 2));
await waitFor(() => !!document.querySelector('.modal .res-table'), null, 30000);
check('AI 先完成就是 AI 贏', await win.evaluate(() => window.__xkf.round.winner === 1 && window.__xkf.match.wins[1] === 1));
await win.evaluate(() => document.querySelector('.modal .modal-btns .primary').click());
// 第 3 局：我放棄
await waitFor(() => window.__xkf.round.idx === 3 && window.__xkf.round.started, null, 15000);
await win.evaluate(() => { window.__xkf.players[1].token++; document.querySelector('#btnResign').click(); });
await waitFor(() => !!document.querySelector('.modal'));
await win.evaluate(() => document.querySelector('.modal .modal-btns .primary').click());
await waitFor(() => !!document.querySelector('.modal .res-table'), null, 8000);
check('放棄就是對手贏', await win.evaluate(() => window.__xkf.round.winner === 1 && window.__xkf.round.reason === 'resign'));
await win.evaluate(() => document.querySelector('.modal .modal-btns .primary').click());
await waitFor(() => !!document.querySelector('.modal .final'), null, 8000);
await shot('06-final');
check('比賽結束顯示總成績', await win.evaluate(() => window.__xkf.match.over && /獲勝|平手/.test(document.querySelector('.modal .final').textContent)));
await win.evaluate(() => document.querySelector('.modal .modal-btns button').click()); // 回首頁
await waitFor(() => window.__xkf.screen === 'home');

// ---------------- 牌譜庫 ----------------
await win.evaluate(() => document.querySelector('#btnKB').click());
await waitFor(() => !!document.querySelector('#kbBody .kb-stats'));
check('牌譜庫累積 3 局', await win.evaluate(() => window.__xkf.lib.plays.length === 3 && document.querySelectorAll('.rec-table tr').length === 4));
check('牌譜存檔可以讀回', await win.evaluate(async () => { const all = await xk.games.all(); return all.length === 1 && all[0].history.length === 3; }));
const t0 = Date.now();
await win.evaluate(() => { document.querySelectorAll('.kb-box input')[0].value = '1'; document.querySelectorAll('.kb-box input')[0].dispatchEvent(new Event('change')); document.querySelectorAll('.kb-box input')[1].value = '300'; document.querySelectorAll('.kb-box input')[1].dispatchEvent(new Event('change')); document.querySelector('#btnBatch').click(); });
await waitFor(() => !window.__xkf.lib || (window.__xkf.lib.deals.size >= 300 && !document.querySelector('#btnBatch').disabled), null, 120000);
const sec = (Date.now() - t0) / 1000;
check(`速算 300 局（${sec.toFixed(1)} 秒）`, await win.evaluate(() => [...Array(300)].every((_, i) => window.__xkf.lib.bestFor(i + 1))) && sec < 60);
await shot('07-kb');
// 重播第一筆
await win.evaluate(() => { const k = window.__xkf.lib.plays[0].k; window.__xkfApi.openReplayByKey(k); });
await waitFor(() => window.__xkf.mode === 'replay' && window.__xkf.replay);
await win.evaluate(() => document.querySelector('#rpEnd').click());
await sleep(600);
check('重播到最後全部歸位', await win.evaluate(() => /全部歸位/.test(document.querySelector('#rpInfo').textContent)));
await win.evaluate(() => document.querySelector('#rpAI').click());
await waitFor(() => window.__xkf.replay && /AI 解答/.test(window.__xkf.replay.label), null, 15000);
await win.evaluate(() => document.querySelector('#rpNext').click());
await sleep(700);
await shot('08-replay');
check('AI 解答可以逐步播放', await win.evaluate(() => window.__xkf.replay.step === 1 && window.__xkf.replay.total > 20));
await win.evaluate(() => document.querySelector('#btnHome').click());
await waitFor(() => window.__xkf.screen === 'kb');
await win.evaluate(() => document.querySelector('.rec-actions button:last-child').click());

// ---------------- 教學 ----------------
await win.evaluate(() => document.querySelector('#btnGuide').click());
await waitFor(() => window.__xkf.screen === 'guide' && !!document.querySelector('.gb-board, .gs-kv, .gs-text'));
check('接龍教學有 8 課', await win.evaluate(() => document.querySelectorAll('.gd-item:not(.practice)').length === 8));
await win.evaluate(() => document.querySelectorAll('.gd-item')[2].click());
await sleep(3800);
await shot('09-guide');
check('教學動畫：牌移到目的地', await win.evaluate(() => document.querySelectorAll('.gb-card').length >= 7));
await win.evaluate(() => document.querySelector('.gd-item.practice').click());
await sleep(300);
check('練習題可以作答', await win.evaluate(() => { const b = [...document.querySelectorAll('.gd-choices button')]; b[0].click(); return !!document.querySelector('.gd-result.ok, .gd-result.bad'); }));
await win.evaluate(() => document.querySelector('.gd-section button[data-s="system"]').click());
check('系統說明有 7 課', await win.evaluate(() => document.querySelectorAll('.gd-item').length === 7));
await win.evaluate(() => document.querySelector('.gd-back').click());

// ---------------- AI 對 AI ----------------
await win.evaluate(() => { document.querySelector('#aivaiA').value = '1'; document.querySelector('#aivaiB').value = '3'; document.querySelector('#rdAivai').value = '1'; document.querySelector('#startAivai').click(); });
await waitFor(() => window.__xkf.mode === 'aivai' && window.__xkf.round && window.__xkf.round.started, null, 20000);
await sleep(600);
await win.evaluate(() => document.querySelector('#btnSwap').click());
await sleep(500);
check('AI 對 AI 可以換主畫面', await win.evaluate(() => window.__xkf.main === 1));
await shot('10-aivai');
await waitFor(() => window.__xkf.round.over, null, 40000);
check('AI 對 AI 分出勝負', await win.evaluate(() => window.__xkf.round.winner >= 0));
await waitFor(() => !!document.querySelector('.modal .final'), null, 20000);
await win.evaluate(() => document.querySelector('.modal .modal-btns button').click());
await waitFor(() => window.__xkf.screen === 'home');

// ---------------- 單人練習 ----------------
await win.evaluate(() => { document.querySelector('#dealSolo').value = '11982'; document.querySelector('#startSolo').click(); });
await waitFor(() => window.__xkf.mode === 'solo' && window.__xkf.round && window.__xkf.round.started, null, 15000);
check('單人練習可以指定牌局號碼', await win.evaluate(() => window.__xkf.round.no === 11982 && window.__xkf.players.length === 1));
await shot('11-solo');
await win.evaluate(() => document.querySelector('#btnResign').click());
await waitFor(() => !!document.querySelector('.modal'));
await win.evaluate(() => document.querySelector('.modal .modal-btns .primary').click());
await waitFor(() => !!document.querySelector('.modal .res-table'), null, 8000);
check('單人放棄顯示練習結果', await win.evaluate(() => /練習結果/.test(document.querySelector('.modal h3').textContent)));
await win.evaluate(() => [...document.querySelectorAll('.modal .modal-btns button')].find((b) => /AI 解答/.test(b.textContent)).click());
await sleep(4000);
check('無解的牌局會說明', await win.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => /無解|算不出來/.test(t.textContent))));
await win.evaluate(() => document.querySelector('#btnHome').click());
await sleep(300);
if (await win.evaluate(() => !!document.querySelector('.modal'))) await win.evaluate(() => document.querySelector('.modal .modal-btns .primary').click());
await waitFor(() => window.__xkf.screen === 'home');

// ---------------- 設定與關於 ----------------
await win.evaluate(() => [...document.querySelectorAll('.home-links button')].find((b) => /設定/.test(b.textContent)).click());
await waitFor(() => !!document.querySelector('.modal .settings'));
check('設定畫面有 API 金鑰與連線設定', await win.evaluate(() => /Anthropic API 金鑰/.test(document.querySelector('.modal').textContent) && /配對伺服器/.test(document.querySelector('.modal').textContent)));
await win.evaluate(() => document.querySelector('.modal .modal-btns button').click());
await win.evaluate(() => document.querySelector('#btnAbout').click());
await waitFor(() => !!document.querySelector('.modal .about'));
check('關於顯示開發者署名', await win.evaluate(() => /吳玉柱 先生 與 Claude AI Opus 5\.5/.test(document.querySelector('.modal .about').textContent)));
await waitFor(() => /最新版本|無法檢查|新版本/.test(document.querySelector('.upd-status').textContent), null, 20000);
await shot('12-about');
await win.evaluate(() => document.querySelector('.modal .modal-btns button').click());

check('沒有頁面錯誤', errors.filter((e) => !/peerjs|favicon|net::ERR/.test(e)).length === 0, errors.join('\n'));
console.log(`\n通過 ${C.pass}，失敗 ${C.fail}`);
await app.close();
process.exit(C.fail ? 1 : 0);
