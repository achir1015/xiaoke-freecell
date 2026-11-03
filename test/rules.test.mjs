import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, msDeal, cardName, cardFromCode, canStack, maxMoveCount, moveToText, parseMoves, replayGame, CELL, FOUND, locFromName } from '../src/renderer/js/rules.js';
import { Solver, verify } from '../src/renderer/js/solver.js';

const C = (s) => s.split(' ').map(cardFromCode);

test('微軟第 1 局的發牌完全相同', () => {
  const cols = msDeal(1);
  const row = (r) => cols.map((c) => (c[r] === undefined ? '' : cardName(c[r]))).join(' ').trim();
  assert.equal(row(0), '♦J ♦2 ♥9 ♣J ♦5 ♥7 ♣7 ♥5');
  assert.equal(row(1), '♦K ♣K ♠9 ♠5 ♦A ♣Q ♥K ♥3');
  assert.equal(row(6), '♠6 ♣9 ♥2 ♥6');
  assert.deepEqual(cols.map((c) => c.length), [7, 7, 7, 7, 6, 6, 6, 6]);
  assert.equal(new Set(cols.flat()).size, 52);
});

test('微軟第 617 局（常見測試局）也相同', () => {
  const cols = msDeal(617);
  assert.equal(cols.map((c) => cardName(c[0])).join(' '), '♦7 ♦A ♣5 ♠3 ♠5 ♣8 ♦2 ♥A');
});

test('紅黑交錯、小一點才能接', () => {
  assert.ok(canStack(cardFromCode('H7'), cardFromCode('S6')));
  assert.ok(canStack(cardFromCode('SK'), cardFromCode('DQ')));
  assert.ok(!canStack(cardFromCode('D7'), cardFromCode('H6')));
  assert.ok(!canStack(cardFromCode('H7'), cardFromCode('S5')));
  assert.ok(!canStack(cardFromCode('S6'), cardFromCode('H7')));
});

test('一次搬多張的上限', () => {
  assert.equal(maxMoveCount(0, 0), 1);
  assert.equal(maxMoveCount(4, 0), 5);
  assert.equal(maxMoveCount(2, 1), 6);
  assert.equal(maxMoveCount(4, 2), 20);
  assert.equal(maxMoveCount(4, 2, true), 10);
  assert.equal(maxMoveCount(1, 1, true), 2);
});

test('走法、悔棋與自動歸位', () => {
  const g = new Game([C('C9 H8 S7'), C('S9'), C('HA'), [], [], [], [], []]);
  g.found = [0, 0, 0, 0];
  // 其他牌不重要，只測移動
  assert.equal(g.moveSize(0, 1), 2, '紅 8 開頭的兩張接到黑 9');
  assert.equal(g.runLength(0), 3);
  const st = g.move(0, 1);
  assert.ok(st);
  assert.deepEqual(g.cols[1].map(cardName), ['♠9', '♥8', '♠7']);
  assert.equal(st.autos.length, 1, '紅心 A 自動歸位');
  assert.equal(g.found[1], 1);
  g.undo();
  assert.deepEqual(g.cols[0].map(cardName), ['♣9', '♥8', '♠7']);
  assert.equal(g.found[1], 0);
  assert.deepEqual(g.cols[2].map(cardName), ['♥A']);
});

test('暫存格與回收座的限制', () => {
  const g = new Game(1);
  assert.equal(g.moveSize(0, CELL), 1);
  g.move(0, CELL, 1, { auto: false });
  assert.equal(g.moveSize(1, CELL), 0, '暫存格已經有牌');
  assert.equal(g.moveSize(CELL, CELL + 1), 1);
  assert.equal(g.moveSize(0, FOUND), 0);
});

test('記譜可以來回轉換', () => {
  assert.equal(moveToText({ f: 2, t: CELL, n: 1 }), '3a');
  assert.equal(moveToText({ f: CELL + 1, t: 4, n: 1 }), 'b5');
  assert.equal(moveToText({ f: 0, t: 7, n: 3 }), '18:3');
  assert.equal(moveToText({ f: 5, t: FOUND, n: 1 }), '6h');
  assert.deepEqual(parseMoves('3a b5 18:3 6h'), [{ f: 2, t: CELL, n: 0 }, { f: CELL + 1, t: 4, n: 0 }, { f: 0, t: 7, n: 3 }, { f: 5, t: FOUND, n: 0 }]);
  assert.equal(locFromName('d'), CELL + 3);
});

test('解算器：前 200 局全部解出並且驗證正確', () => {
  const s = new Solver();
  const t0 = Date.now();
  for (let no = 1; no <= 200; no++) {
    const r = s.solve(new Game(no), 'fast');
    assert.ok(r, `第 ${no} 局要有解`);
    assert.ok(verify(no, r.moves), `第 ${no} 局的解要能執行`);
    const text = r.moves.map(moveToText).join(' ');
    assert.ok(replayGame(no, parseMoves(text)).won, `第 ${no} 局記譜重播要過關`);
  }
  assert.ok(Date.now() - t0 < 30000, '速算要夠快');
});

test('解算器：最短模式比快速模式短', () => {
  const s = new Solver();
  let a = 0, b = 0;
  for (let no = 1; no <= 30; no++) { a += s.solve(new Game(no), 'fast').moves.length; b += s.best(new Game(no), { budgetMs: 2000 }).moves.length; }
  assert.ok(b <= a, `${b} ≤ ${a}`);
});

test('已知無解的第 11982 局解不出來', () => {
  const s = new Solver();
  const r = s.solve(new Game(11982), { w: 1, g: 0.6, nodes: 60000 });
  assert.equal(r, null);
});
