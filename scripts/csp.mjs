// 重算 index.html 內嵌 importmap 的 CSP 雜湊（改了 importmap 就要跑一次）
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const file = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer', 'index.html');
let html = fs.readFileSync(file, 'utf8');
const m = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
if (!m) throw new Error('找不到 importmap');
const hash = crypto.createHash('sha256').update(m[1], 'utf8').digest('base64');
html = html.replace(/script-src 'self'( 'wasm-unsafe-eval')? 'sha256-[^']*'/, `script-src 'self'$1 'sha256-${hash}'`);
fs.writeFileSync(file, html, 'utf8');
console.log('CSP importmap 雜湊：sha256-' + hash);
