// 實際更新：安裝版下載新版並執行安裝：node e2e/update-flow.mjs <exe>
import { _electron as electron } from 'playwright-core';
import path from 'path';
const app = await electron.launch({ executablePath: path.resolve(process.argv[2]), args: ['--profile=pkg'] });
const win = await app.firstWindow();
await new Promise((r) => setTimeout(r, 3000));
const r = await win.evaluate(async () => {
  const i = await xk.update.check();
  if (!i.newer) return { skip: i };
  const file = await xk.update.download();
  return { file, res: await xk.update.install(file) };
}).catch((e) => ({ closed: String(e.message || e).slice(0, 120) }));
console.log(JSON.stringify(r));
await app.close().catch(() => {});
