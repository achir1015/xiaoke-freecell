// AI 軍師面板：本機 AI 分析＋（有金鑰時）Claude 白話解說
import { h, uid } from './util.js';
import { cardName, SUITS, RANKS } from './rules.js';
import { portraitUrl, labelOf } from './portraits.js';

const QUICK = [
  ['下一步怎麼走？', '現在下一步該怎麼走比較好？'],
  ['還有解嗎？', '這個局面還有解嗎？大概還要幾步？'],
  ['整體策略', '請告訴我這一局的整體策略：先解放哪幾張 A、哪一列最容易清空？'],
  ['教我技巧', '有什麼實用的新接龍技巧？請配合目前的牌局說明。'],
];

export class AdvisorPanel {
  // ctx(): { game, opp, names, round, analyze():Promise<{solvable, steps, next:[{m,text}]}>, showHint(a) }
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.history = [];
    this.busy = null;
    this.hasKey = false;
    this.build();
    xk.advisor.onDelta((d) => { if (this.busy && d.id === this.busy.id) { this.busy.text += d.text; this.busy.el.textContent = this.busy.text; this.scroll(); } });
    xk.advisor.onDone((d) => this.onDone(d));
  }

  setHasKey(v) {
    this.hasKey = v;
    this.modeEl.textContent = v ? '🟢 Claude 軍師（線上）' : '⚪ 離線軍師（本機 AI）';
    this.modeEl.title = v ? '使用 Claude 以白話解說 AI 分析' : '尚未設定 Anthropic API 金鑰，只提供 AI 建議。可到「設定」輸入金鑰。';
  }

  setAdvisor(id) {
    this.avatar.innerHTML = '';
    if (id) { this.avatar.append(h('img', { src: portraitUrl(id), alt: '' })); this.nameEl.textContent = `${labelOf(id)}（AI 軍師）`; }
    else { this.avatar.textContent = '🧙'; this.nameEl.textContent = '小柯軍師'; }
  }

  build() {
    this.modeEl = h('div', { class: 'adv-mode' });
    this.avatar = h('span', { class: 'adv-avatar' }, '🧙');
    this.nameEl = h('b', {}, '小柯軍師');
    this.log = h('div', { class: 'adv-log' });
    this.input = h('textarea', { class: 'adv-input', rows: 2, placeholder: '問軍師，例如：下一步怎麼走？（Enter 送出）', onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } } });
    this.btnSend = h('button', { class: 'primary', onclick: () => this.send() }, '請教');
    this.root.append(
      h('div', { class: 'adv-head' }, this.avatar, h('div', {}, this.nameEl, this.modeEl)),
      this.log,
      h('div', { class: 'adv-quick' }, QUICK.map(([label, q]) => h('button', { class: 'chip', onclick: () => this.send(q) }, label))),
      h('div', { class: 'adv-send' }, this.input, this.btnSend),
    );
    this.say('ai', '您好！我是您的 AI 軍師。比賽中有任何疑問都可以問我，我會先用解算器算過這個局面還有沒有解、最快還要幾步，再告訴您建議和理由。需要時也可以按「軍師接手」讓我上場。');
  }

  reset() {
    this.history = [];
    this.log.innerHTML = '';
    this.say('ai', '新的一局開始了，需要建議隨時叫我！');
  }

  say(who, text) {
    const el = h('div', { class: 'adv-msg ' + who }, text);
    this.log.append(el);
    this.scroll();
    return el;
  }
  scroll() { this.log.scrollTop = this.log.scrollHeight; }

  describe(ana) {
    const { game, opp, names, round } = this.ctx();
    const v = game;
    const lines = ['【牌局資訊】'];
    lines.push(`牌局 #${v.deal}${round ? `，第 ${round.idx}/${round.total} 局，比數 ${round.score}` : ''}。您是 ${names[0] || '玩家'}，已走 ${v.moveCount} 步，回收座 ${v.foundCount}/52 張。`);
    lines.push('暫存格：' + v.cells.map((c) => (c < 0 ? '空' : cardName(c))).join(' '));
    lines.push('回收座：' + v.found.map((n, s) => `${SUITS[s]}${n ? RANKS[n - 1] : '－'}`).join(' '));
    v.cols.forEach((col, i) => lines.push(`第 ${i + 1} 列（由下往上，最後一張可以拿）：${col.map(cardName).join(' ') || '空'}`));
    if (opp) lines.push(`對手 ${names[1] || ''}：回收座 ${opp.found.reduce((a, b) => a + b, 0)}/52 張、已走 ${opp.moveCount || 0} 步${opp.won ? '（已完成）' : ''}。`);
    if (ana) {
      if (!ana.solvable) lines.push('解算器：這個局面已經沒有解了，建議悔棋回到前幾步。');
      else {
        lines.push(`解算器：有解，最快還要約 ${ana.steps} 步。`);
        if (ana.next.length) lines.push('建議接下來：' + ana.next.slice(0, 5).map((x, i) => `${i + 1}. ${x.text}`).join('；'));
      }
    }
    return lines.join('\n');
  }

  offline(ana) {
    const { game } = this.ctx();
    if (game.won) return '這一局已經全部歸位了，恭喜！可以到「牌譜庫」重播，或看 AI 的最短解答。';
    if (!ana) return '軍師暫時算不出來，請再按一次「請教」。';
    if (!ana.solvable) return '這個局面已經沒有解了 😥\n建議按「↶ 悔棋」退回幾步再試，或按「🏳 放棄」進下一局。';
    const parts = [`建議：${ana.next[0].text}。`];
    parts.push(`照解算器的走法，最快還要約 ${ana.steps} 步就能全部歸位。`);
    if (ana.next.length > 1) parts.push('接下來可以：' + ana.next.slice(1, 4).map((x) => x.text).join('；') + '。');
    const free = game.cells.filter((c) => c < 0).length;
    if (free <= 1) parts.push('提醒：暫存格快滿了，盡量先清出空格或空列，才搬得動長串的牌。');
    parts.push('（亮綠色的就是建議搬動的牌和目的地）');
    return parts.join('\n');
  }

  async send(q) {
    const question = (q || this.input.value).trim();
    if (!question || this.busy) return;
    const c0 = this.ctx();
    if (!c0.game) { this.say('ai', '目前沒有進行中的牌局，開一局之後再問我吧！'); return; }
    this.input.value = '';
    this.say('me', question);
    const pending = this.say('ai thinking', '軍師正在速算…');
    let ana = null;
    try { ana = await c0.analyze(); } catch (e) { console.warn(e); }
    if (ana && ana.solvable && ana.next.length) c0.showHint(ana);
    if (!this.hasKey) {
      pending.classList.remove('thinking');
      pending.textContent = this.offline(ana);
      this.scroll();
      return;
    }
    pending.textContent = '';
    pending.classList.add('streaming');
    const id = uid();
    this.busy = { id, el: pending, text: '', question };
    this.btnSend.textContent = '停止';
    this.btnSend.onclick = () => xk.advisor.cancel(id);
    const userMsg = { role: 'user', content: `${this.describe(ana)}\n\n【我的問題】${question}` };
    this.busy.userMsg = userMsg;
    this.busy.offline = this.offline(ana);
    xk.advisor.ask(id, { messages: [...this.history.slice(-12), userMsg] });
  }

  onDone(d) {
    const b = this.busy;
    if (!b || d.id !== b.id) return;
    this.busy = null;
    this.btnSend.textContent = '請教';
    this.btnSend.onclick = () => this.send();
    b.el.classList.remove('thinking', 'streaming');
    if (d.error) {
      if (d.error === 'cancelled') { b.el.textContent = (b.text || '') + '（已停止）'; return; }
      if (d.error === 'nokey') { this.setHasKey(false); b.el.textContent = b.offline; return; }
      b.el.textContent = `${b.offline}\n\n⚠ ${d.error}`;
      return;
    }
    const text = d.text || b.text;
    b.el.textContent = text + (d.truncated ? '…' : '');
    this.history.push(b.userMsg, { role: 'assistant', content: text });
    this.scroll();
  }
}
