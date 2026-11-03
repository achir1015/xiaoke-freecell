// e2e 共用：啟動 Electron、等待條件、截圖
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function checker() {
  const c = { pass: 0, fail: 0 };
  c.check = (name, ok, extra = '') => { if (ok) { c.pass++; console.log('✔', name); } else { c.fail++; console.log('✘', name, extra); } };
  return c;
}

export async function launch(profile, { outDir = 'e2e/out', fresh = true, args = [] } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const appData = process.env.APPDATA || path.join(os.homedir(), 'Library', 'Application Support');
  if (fresh) fs.rmSync(path.join(appData, 'xiaoke-freecell-' + profile), { recursive: true, force: true });
  const app = await electron.launch({ executablePath: require('electron'), args: ['.', `--profile=${profile}`, '--autoplay-policy=no-user-gesture-required', ...args] });
  const win = await app.firstWindow();
  const errors = [];
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  win.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  const waitFor = async (fn, arg, ms = 30000) => {
    const t = Date.now();
    for (;;) {
      const v = await win.evaluate(fn, arg).catch(() => false);
      if (v) return v;
      if (Date.now() - t > ms) throw new Error('等待逾時：' + fn);
      await sleep(150);
    }
  };
  const shot = async (name) => {
    const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(b64, 'base64'));
  };
  // 第一次開啟要選半身照與軍師
  const pickProfile = async () => {
    await waitFor(() => !!document.querySelector('.modal .pf'));
    await win.evaluate(() => {
      document.querySelectorAll('.pf-pane')[0].querySelector('.pf-item').click();
      document.querySelectorAll('.pf-pane')[2].querySelector('.pf-item').click();
      document.querySelector('.pf-ok').click();
    });
    await waitFor(() => !document.querySelector('.modal'));
  };
  return { app, win, errors, waitFor, shot, pickProfile };
}
