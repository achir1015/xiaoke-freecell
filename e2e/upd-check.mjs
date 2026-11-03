// 安裝版檢查更新：node e2e/upd-check.mjs <exe>
import { _electron as electron } from 'playwright-core';
import path from 'path';
const app = await electron.launch({ executablePath: path.resolve(process.argv[2]), args: ['--profile=pkg'] });
const win = await app.firstWindow();
await win.waitForFunction(() => window.xk && window.__xkf, null, { timeout: 30000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 2000));
console.log(JSON.stringify(await win.evaluate(async () => { try { return await xk.update.check(); } catch (e) { return { error: String(e.message || e) }; } })));
await app.close();
