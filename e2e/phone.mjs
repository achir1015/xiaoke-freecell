// 實機測試：透過 adb 連到手機上小柯接龍（除錯版 APK）的 WebView，用 DevTools 協定檢查功能
// 用法：python android/build.py debug install，手機解鎖後執行 node e2e/phone.mjs [手機序號]
import { chromium } from 'playwright-core';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ADB = process.env.ADB || 'E:/小米觸控音箱/tools/android-sdk/platform-tools/adb.exe';
const SERIAL = process.argv[2] || process.env.ANDROID_SERIAL || 'R5CY236CQ3B';
const outDir = 'e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const adb = (...a) => execFileSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
const shotPhone = (name) => fs.writeFileSync(path.join(outDir, 'ph-' + name + '.png'), execFileSync(ADB, ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 }));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };

const focus = adb('shell', 'dumpsys', 'window');
if (/isKeyguardShowing=true/.test(focus)) { console.log('手機鎖著，請先解鎖'); process.exit(2); }
const fm = focus.match(/mCurrentFocus=[^\r\n]*/g) || [];
if (!fm.some((f) => f.includes('com.achir.xiaokefreecell'))) { console.log('前景不是小柯接龍：', fm.join(' ')); process.exit(2); }
const sock = /@?(webview_devtools_remote_\d+)/.exec(adb('shell', 'cat', '/proc/net/unix'));
if (!sock) { console.log('找不到 WebView 偵錯通道（要用 python android/build.py debug 建置）'); process.exit(2); }
execFileSync(ADB, ['-s', SERIAL, 'forward', 'tcp:9336', 'localabstract:' + sock[1]]);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9336');
const page = browser.contexts()[0].pages().find((p) => p.url().includes('appassets')) || browser.contexts()[0].pages()[0];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const waitFor = async (fn, arg, ms = 30000) => { const t = Date.now(); for (;;) { const v = await page.evaluate(fn, arg).catch(() => false); if (v) return v; if (Date.now() - t > ms) throw new Error('等待逾時：' + fn); await new Promise((r) => setTimeout(r, 200)); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 用 adb 在手機上點螢幕（CSS 座標換成實體像素）
const tap = async (x, y) => { const dpr = await page.evaluate(() => devicePixelRatio); adb('shell', 'input', 'tap', String(Math.round(x * dpr)), String(Math.round(y * dpr))); await sleep(450); };

try {
  const info = await page.evaluate(() => ({ android: !!window.XiaokeAndroid, mobile: document.documentElement.classList.contains('mobile'), w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ver: JSON.parse(window.XiaokeAndroid.appInfo()).version, webgl: !!document.createElement('canvas').getContext('webgl2'), cores: navigator.hardwareConcurrency }));
  console.log('  ', JSON.stringify(info));
  check('在 Android App 裡執行（原生橋接）', info.android && info.mobile);
  check('WebGL2（3D 牌桌）可用', info.webgl);
  check('橫向畫面', info.w > info.h);
  await page.reload();
  await waitFor(() => window.__xkf && window.__xkfTable);
  if (await page.evaluate(() => !!document.querySelector('.pf'))) {
    check('第一次開啟要選半身照', true);
    await page.evaluate(() => { document.querySelector('.pf-item[data-id="m02"]').click(); document.querySelector('.pf-tab[data-k="advisor"]').click(); document.querySelector('.pf-item[data-id="af03"]').click(); document.querySelector('.modal .pf-ok').click(); });
  }
  await page.evaluate(async () => { await window.xk.settings.set({ music: { autoplay: false } }); });
  await sleep(800);
  shotPhone('1-home');
  const tts = await waitFor(() => window.xk.tts && window.xk.tts.available() && window.xk.tts.voiceName(), null, 15000).catch(() => '');
  check('手機語音可用', !!tts, tts);
  check('內建音樂 20 首', (await page.evaluate(() => window.xk.music.list().then((l) => l.length))) === 20);
  // 速算：手機多核心
  const sp = await page.evaluate(async () => {
    const { Game } = await import('./js/rules.js');
    const S = window.__xkf;
    const t0 = performance.now();
    const r = await Promise.all(Array.from({ length: 60 }, (_, i) => S.pool.solve(new Game(i + 1), { profile: 'fast', front: false, deadline: Date.now() + 120000 })));
    return { ms: Math.round(performance.now() - t0), ok: r.filter(Boolean).length, cores: S.pool.size };
  });
  console.log('   速算', JSON.stringify(sp));
  check(`手機速算 60 局（${sp.ms} 毫秒、${sp.cores} 核心）`, sp.ok === 60 && sp.ms < 30000);

  // 真人對 AI：牌局 #1
  await page.evaluate(() => { document.querySelector('#lvAI').value = '0'; document.querySelector('#dealAI').value = '1'; document.querySelector('#startAI').click(); });
  await waitFor(() => window.__xkf.round && window.__xkf.round.started, null, 20000);
  await page.evaluate(() => { window.__xkf.players[1].token++; });
  await sleep(1500);
  shotPhone('2-game');
  // 用手指點：點一張牌、再點暫存格
  const card = await page.evaluate(() => { const g = window.__xkf.players[0].game; return g.cols[2][g.cols[2].length - 1]; });
  let p = await page.evaluate((c) => window.__xkfTable.screenOf(0, c), card);
  await tap(p.x, p.y);
  check('手指點一下選起牌', await page.evaluate(() => !!window.__xkf.sel));
  p = await page.evaluate(() => window.__xkfTable.screenOf(0, null, 9));
  await tap(p.x, p.y);
  check('再點暫存格就搬過去', await page.evaluate((c) => window.__xkf.players[0].game.cells.includes(c), card));
  shotPhone('3-moved');
  // 提示與軍師接手
  await page.evaluate(() => document.querySelector('#btnHint').click());
  await waitFor(() => !!window.__xkfTable.hint, null, 15000);
  check('提示', true);
  await page.evaluate(() => document.querySelector('#btnProxy').click());
  await waitFor(() => window.__xkf.round.over, null, 120000);
  check('軍師接手打完這局', await page.evaluate(() => window.__xkf.round.winner === 0));
  await sleep(800);
  shotPhone('4-result');
  await page.evaluate(() => document.querySelector('.modal .modal-btns button').click());
  // 手機返回鍵
  adb('shell', 'input', 'keyevent', '4');
  await sleep(800);
  if (await page.evaluate(() => !!document.querySelector('.modal'))) await page.evaluate(() => document.querySelector('.modal .modal-btns .primary').click());
  await sleep(500);
  check('返回鍵回到首頁', await page.evaluate(() => window.__xkf.screen === 'home'));
  // 教學語音
  await page.evaluate(() => document.querySelector('#btnGuide').click());
  await sleep(3500);
  shotPhone('5-guide');
  check('教學畫面', await page.evaluate(() => window.__xkf.screen === 'guide' && !!document.querySelector('.gb-board, .gs-kv')));
  await page.evaluate(() => document.querySelector('.gd-back').click());
  check('檢查更新', await page.evaluate(async () => { try { const i = await xk.update.check(); return !!i.current; } catch (e) { return /查詢失敗|無法連線|還沒有/.test(e.message); } }));
  check('沒有頁面錯誤', errors.length === 0, errors.join('\n'));
} catch (e) {
  fail++;
  console.log('✘ 測試中斷：', e.message);
  shotPhone('error');
}
console.log(`\n通過 ${pass}，失敗 ${fail}`);
await browser.close();
process.exit(fail ? 1 : 0);
