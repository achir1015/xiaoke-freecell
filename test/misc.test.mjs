import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import { SYSTEM, buildParams } from '../src/renderer/js/advisor-core.js';
import { Library } from '../src/renderer/js/kb.js';
import { LESSONS, SYS_LESSONS, PRACTICE, practiceAnswer, demoGame } from '../src/renderer/js/guide.js';
import { cardFromCode, locFromName, CELL } from '../src/renderer/js/rules.js';

const require = createRequire(import.meta.url);

test('手機版與桌面版的軍師提示詞一致', () => {
  const desktop = require('../src/main/advisor.js').SYSTEM;
  assert.equal(SYSTEM, desktop);
  assert.ok(SYSTEM.includes('新接龍'));
});

test('軍師請求參數', () => {
  const p = buildParams({ model: 'claude-opus-5-5', effort: 'low' }, [{ role: 'user', content: 'hi' }], 4000);
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.output_config.effort, 'low');
  assert.equal(p.fallbacks, 'default');
});

test('牌譜庫：累積、學最短解、查詢與統計', () => {
  const lib = new Library(null);
  lib.add({ k: 'm1#1', m: 'm1', no: 5, date: '2026-11-04T00:00:00Z', mode: 'ai', names: ['承翰', '思妤'], kinds: ['me', 'ai'], res: [{ n: 80, ms: 200000, found: 52, done: true }, { n: 60, ms: 210000, found: 40, done: false }], winner: 0, me: 0 });
  lib.add({ k: 'm1#2', m: 'm1', no: 9, date: '2026-11-04T00:10:00Z', mode: 'ai', names: ['承翰', '思妤'], kinds: ['me', 'ai'], res: [{ n: 70, ms: 150000, found: 30, done: false }, { n: 55, ms: 120000, found: 52, done: true }], winner: 1, me: 0 });
  assert.equal(lib.add({ k: 'm1#2' }), false, '同一局不重複');
  assert.ok(lib.learn(5, '1a 2b', 80, '承翰'));
  assert.ok(lib.learn(5, '1a', 50, 'AI'), '更短的解要取代');
  assert.ok(!lib.learn(5, '1a 2b 3c', 90, 'X'), '較長的解不取代');
  assert.equal(lib.bestFor(5).n, 50);
  assert.equal(lib.filter({ q: '5' }).length, 1);
  assert.equal(lib.filter({ result: 'win' }).length, 1);
  assert.equal(lib.filter({ q: '思妤' }).length, 2);
  const st = lib.stats();
  assert.equal(st.total, 2);
  assert.equal(st.rate, 0.5);
  assert.equal(st.fastest, 200000);
  const again = new Library(JSON.parse(JSON.stringify(lib.toJSON())));
  assert.equal(again.bestFor(5).n, 50);
  assert.equal(again.plays.length, 2);
});

test('教學示範：每一步動畫都是合法走法', () => {
  for (const L of [...LESSONS, ...SYS_LESSONS]) {
    for (const st of L.steps) {
      assert.ok(st.say && st.say.length > 8, `${L.title} 要有講解`);
      const show = st.show;
      if (!show || show.t !== 'board') continue;
      const g = demoGame(show);
      const all = [...g.cols.flat(), ...g.cells.filter((c) => c >= 0)];
      assert.equal(new Set(all).size, all.length, `${L.title}：牌不能重複`);
      for (const mv of show.moves || []) {
        const f = locFromName(mv[0]), t = locFromName(mv[1]);
        const n = g.moveSize(f, t);
        assert.ok(n, `${L.title}：${mv} 要合法`);
        g.move(f, t, n, { auto: false });
      }
    }
  }
});

test('練習題的答案由規則算出且在選項裡', () => {
  for (const p of PRACTICE) {
    const a = practiceAnswer(p);
    assert.ok(a !== undefined && a !== null, p.q);
    if (p.kind !== 'max') {
      const opts = p.opts.split(' ').map(cardFromCode);
      assert.equal(opts.filter((c) => c === a).length, 1, p.q);
    }
  }
  assert.equal(CELL, 8);
});
