// 小牌桌（2D Canvas）：對手面板、牌譜庫預覽與教學畫面共用
import { suitOf, rankOf, isRed, RANKS, SUITS } from './rules.js';

const RED = '#c8102e', BLACK = '#14161f';

function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function miniCard(c, card, x, y, w, h, hl) {
  rr(c, x, y, w, h, Math.max(2, w * 0.12));
  c.fillStyle = hl ? '#fff3b8' : '#fffdf6'; c.fill();
  c.strokeStyle = hl ? '#e8b84a' : 'rgba(60,50,30,.45)'; c.lineWidth = hl ? 2 : 1; c.stroke();
  c.fillStyle = isRed(card) ? RED : BLACK;
  const fs = Math.max(8, Math.round(w * 0.36));
  c.font = `700 ${fs}px "Segoe UI",Arial,sans-serif`;
  c.textBaseline = 'top'; c.textAlign = 'left';
  c.fillText(RANKS[rankOf(card)] + SUITS[suitOf(card)], x + w * 0.08, y + w * 0.06);
}

function slot(c, x, y, w, h, text) {
  rr(c, x, y, w, h, Math.max(2, w * 0.12));
  c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1; c.stroke();
  if (text) {
    c.fillStyle = 'rgba(255,226,150,.5)'; c.font = `${Math.round(w * 0.5)}px "Segoe UI Symbol",serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, x + w / 2, y + h / 2);
  }
}

// view: { cols, cells, found }；hl: Set(牌) 要標亮的牌
export function drawMini(canvas, view, { hl = null, bg = '#155c3e' } = {}) {
  const c = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  c.clearRect(0, 0, W, H);
  rr(c, 0, 0, W, H, 10);
  c.fillStyle = bg; c.fill();
  if (!view) return;
  const pad = W * 0.03;
  const gap = W * 0.012;
  const cw = (W - pad * 2 - gap * 7) / 8;
  const ch = cw * 1.4;
  const x = (i) => pad + i * (cw + gap);
  for (let i = 0; i < 4; i++) {
    const cc = view.cells[i];
    if (cc >= 0) miniCard(c, cc, x(i), pad, cw, ch, hl && hl.has(cc)); else slot(c, x(i), pad, cw, ch, '');
    const f = view.found[i];
    if (f > 0) miniCard(c, i * 13 + f - 1, x(4 + i), pad, cw, ch, false); else slot(c, x(4 + i), pad, cw, ch, SUITS[i]);
  }
  const top = pad + ch + pad * 1.2;
  const maxLen = Math.max(1, ...view.cols.map((col) => col.length));
  const dy = Math.min(ch * 0.3, (H - top - pad - ch) / Math.max(1, maxLen - 1));
  view.cols.forEach((col, i) => {
    if (!col.length) slot(c, x(i), top, cw, ch, '');
    col.forEach((card, k) => miniCard(c, card, x(i), top + k * dy, cw, ch, hl && hl.has(card)));
  });
}
