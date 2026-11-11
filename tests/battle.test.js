import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, stageParams, multiplier, BATTLE } from '../src/core/battleEngine.js';
import { makeRng } from '../src/core/rng.js';

// 生成器の代わり：答え '0'〜'6' の問題を出す
function setup(o = {}) {
  const rng = makeRng(o.seed ?? 7);
  let n = 0;
  const make = () => ({ key: `k${n}`, answer: String(n++ % 7), prompt: {} });
  const makePhrase = (k) => Array.from({ length: k }, make);
  return makeBattle({ rng, make, makePhrase, cols: 4, rowH: 0.22, bossH: 0.3, ...o });
}
const run = (b, sec, fn) => {
  for (let t = 0; t < sec; t += 1 / 60) {
    b.step(1 / 60);
    fn?.(b);
    if (b.s.phase === 'over' || b.s.phase === 'won') break;
  }
};
// いちばん下の敵を答える（見えてから少し待つ）
const bot = (b, wait = 0.25) => {
  const s = b.s;
  if (s.phase === 'boss' && s.boss && s.boss.y > 0.05) {
    const low = s.enemies.reduce((m, e) => (!m || e.y > m.y ? e : m), null);
    if (low && low.y > s.boss.y) b.press(low.q.answer);
    else b.press(s.boss.phrase[s.boss.idx].answer);
    return;
  }
  const e = s.enemies.filter((x) => x.y > wait).sort((a, c) => c.y - a.y)[0];
  if (e) b.press(e.q.answer);
};

test('はじめは見出し。そのあと敵が上から出てくる', () => {
  const b = setup();
  assert.equal(b.s.phase, 'intro');
  assert.deepEqual(b.take().map((e) => e.type), ['phase']);
  run(b, BATTLE.intro + 0.1);
  assert.equal(b.s.phase, 'wave');
  run(b, 1);
  assert.ok(b.s.enemies.length >= 1);
  assert.ok(b.s.enemies.every((e) => e.y >= 0 && e.y < 0.2));
});

test('答えた音の敵のうち、砦にいちばん近いものを撃つ', () => {
  const b = setup();
  run(b, BATTLE.intro + 0.1);
  b.s.enemies.length = 0;
  const q = (answer, key) => ({ answer, key, prompt: {} });
  b.s.enemies.push(
    { id: 101, q: q('3', 'a'), kind: 'drop', x: 0.2, cx: 0.2, y: 0.3, born: 0, alive: true, sway: 0 },
    { id: 102, q: q('3', 'b'), kind: 'drop', x: 0.5, cx: 0.5, y: 0.6, born: 0, alive: true, sway: 0 },
    { id: 103, q: q('5', 'c'), kind: 'drop', x: 0.8, cx: 0.8, y: 0.9, born: 0, alive: true, sway: 0 },
  );
  const r = b.press('3');
  assert.equal(r.type, 'hit');
  assert.equal(r.e.id, 102);
  assert.equal(b.s.combo, 1);
  assert.deepEqual(b.s.enemies.map((e) => e.id), [101, 103]);
  assert.equal(b.s.log.at(-1).ok, true);
});

test('外すと少しのあいだ撃てない。そのあいだの入力は数えない', () => {
  const b = setup();
  run(b, BATTLE.intro + 1.5);
  const e = b.s.enemies[0];
  const wrong = String((Number(e.q.answer) + 1) % 7);
  // 画面にいない音を答える
  const absent = ['0', '1', '2', '3', '4', '5', '6'].find((a) => !b.s.enemies.some((x) => x.q.answer === a));
  const r = b.press(absent ?? wrong);
  assert.equal(r.type, 'miss');
  assert.equal(b.s.combo, 0);
  const logged = b.s.log.length;
  assert.equal(b.press(e.q.answer).type, 'jammed', '外した直後は撃てない');
  assert.equal(b.s.log.length, logged, '撃てないあいだの入力は記録しない');
  run(b, BATTLE.jam + 0.05);
  const target = b.s.enemies.find((x) => x.q.answer === e.q.answer);
  if (target) assert.equal(b.press(e.q.answer).type, 'hit');
  // まちがいの記録は、いちばん近い敵に付く
  const m = b.s.log.find((l) => l.how === 'miss');
  assert.ok(m.q, 'まちがえた問題が記録に残る');
});

test('砦に届かれるとハートが減り、0 で終わり', () => {
  const b = setup();
  run(b, 200);
  assert.equal(b.s.phase, 'over');
  assert.equal(b.s.hearts, 0);
  assert.equal(b.s.breaches, BATTLE.hearts);
  assert.ok(b.s.log.every((l) => !l.ok && l.how === 'breach'));
});

test('ちゃんと答えれば、ウェーブ 3 つとボスを越えてステージクリア → 指定のステージで勝ち', () => {
  const b = setup({ stages: 2 });
  const seen = [];
  run(b, 600, (bb) => {
    bot(bb);
    for (const e of bb.take()) seen.push(e);
  });
  assert.equal(b.s.phase, 'won');
  assert.equal(b.s.breaches, 0);
  assert.equal(b.s.misses, 0);
  const phases = seen.filter((e) => e.type === 'phase').map((e) => `${e.stage}:${e.phase}`);
  assert.deepEqual(phases.slice(0, 8), ['1:intro', '1:wave', '1:between', '1:wave', '1:between', '1:wave', '1:bossIntro', '1:boss']);
  assert.equal(seen.filter((e) => e.type === 'stageClear').length, 2);
  assert.equal(seen.filter((e) => e.type === 'bossDown').length, 2);
  const P = stageParams(1);
  const bossNotes = seen.filter((e) => e.type === 'boss' && e.idx === 0 && e.q).length;
  assert.ok(bossNotes >= P.bossHp, 'フレーズを何度か弾いた');
  assert.equal(seen.filter((e) => e.type === 'spawn' && e.e.kind === 'row').length > 0, true, '隊列も出た');
  assert.ok(b.s.score > 0 && b.s.maxCombo > 20);
});

// パネルどうしが重なっていないか（種類・列を問わず）。横はパネルの幅 ≒ 列の幅 − 揺れ 2 つぶん
function overlaps(b) {
  const { s } = b;
  const w = 1 / s.cols - 2 * s.sway - 1e-9;
  const es = s.enemies;
  for (let i = 0; i < es.length; i++) {
    for (let j = i + 1; j < es.length; j++) {
      if (Math.abs(es[i].x - es[j].x) < w && Math.abs(es[i].y - es[j].y) < s.rowH - 1e-9) return `${es[i].kind}@${es[i].x.toFixed(3)},${es[i].y.toFixed(3)} と ${es[j].kind}@${es[j].x.toFixed(3)},${es[j].y.toFixed(3)}`;
    }
  }
  return null;
}

for (const [cols, rowH] of [[3, 0.25], [4, 0.22], [5, 0.2], [6, 0.3]]) {
  test(`敵のパネルは重ならない（${cols} 列・高さ ${rowH}・隊列も）`, () => {
    for (const seed of [1, 2, 3]) {
      const b = setup({ seed, cols, rowH, sway: 0.02 / cols });
      let bad = null;
      let rows = 0;
      run(b, 160, (bb) => {
        bot(bb, 0.55);
        for (const e of bb.take()) if (e.type === 'spawn' && e.e.kind === 'row') rows++;
        bad ??= overlaps(bb);
      });
      assert.equal(bad, null, `種 ${seed}: ${bad}`);
      assert.ok(rows > 0, '隊列が出ていない');
    }
  });
}

test('画面の列の数が変わったら、いる敵を新しい列に合わせ直す', () => {
  const b = setup({ cols: 6 });
  run(b, BATTLE.intro + 6);
  assert.ok(b.s.enemies.length >= 2);
  b.setLayout({ cols: 3 });
  for (const e of b.s.enemies) {
    const i = e.cx * 3 - 0.5;
    assert.ok(e.kind === 'row' || Math.abs(i - Math.round(i)) < 1e-9, `列の真ん中にいない ${e.cx}`);
    assert.ok(e.cx > 0 && e.cx < 1);
  }
});

test('近づいた敵に音名を出す設定：出たあとの得点は半分', () => {
  const b = setup({ hint: true });
  run(b, BATTLE.intro + 0.6);
  const e = b.s.enemies[0];
  run(b, 30, () => {
    if (e.hinted && e.alive) b.press(e.q.answer);
  });
  const rec = b.s.log.find((l) => l.q === e.q);
  assert.equal(rec.ok, true);
  assert.equal(rec.hinted, true);
});

test('難しさはステージとともに上がる・速さの設定で時間が伸び縮みする', () => {
  const a = stageParams(1);
  const c = stageParams(4);
  assert.ok(c.fall < a.fall && c.quota > a.quota && c.phrase >= a.phrase);
  assert.ok(stageParams(1, 1.4).fall > a.fall);
  assert.equal(multiplier(0), 1);
  assert.equal(multiplier(10), 2);
  assert.equal(multiplier(99), 4);
});

test('同じ種なら同じ展開になる', () => {
  const trace = (seed) => {
    const b = setup({ seed });
    const xs = [];
    run(b, 30, (bb) => {
      for (const e of bb.take()) if (e.type === 'spawn') xs.push(`${e.e.kind}@${e.e.cx.toFixed(3)}`);
    });
    return xs.join(' ');
  };
  assert.equal(trace(11), trace(11));
  assert.notEqual(trace(11), trace(12));
});

// ---- 四方から（もとのオトバトルの戦い方）----
import { battleGeometry, engineLayout } from '../src/core/battleLayout.js';
import { staffSpan } from '../src/render/notation.js';
import { RANGES } from '../src/core/music.js';

/** 画面の大きさ（px）から、絵の側とまったく同じ計算で並べ方を作る */
function aroundGeoOf(W, H, { range = 'near', clefs = ['tenor'] } = {}) {
  const G = battleGeometry({ W, H, span: staffSpan(RANGES[range], clefs), maxPhrase: 6, field: 'around' });
  return { px: G.geo, cols: G.cols, geo: engineLayout(G).geo, G };
}
const boxesOverlap = (a, b, G) => Math.abs(a.px - b.px) < 2 * G.hw && Math.abs(a.py - b.py) < 2 * G.hh;

test('四方から：通り道は砦の輪の外で止まり、縦長の画面では短すぎる左右の道を使わない', () => {
  for (const [W, H, range] of [[375, 430, 'near'], [375, 430, 'ledger3'], [1200, 600, 'near'], [700, 240, 'staff']]) {
    const { px } = aroundGeoOf(W, H, { range });
    assert.ok(px.lanes.length >= 2, `${W}x${H}: 通り道がある`);
    for (const L of px.lanes) {
      const dEnd = Math.hypot(L.x1 - px.fx, L.y1 - px.fy);
      assert.ok(dEnd > px.ring, '終わりは輪の外');
      assert.ok(Math.hypot(L.x1 - L.x0, L.y1 - L.y0) >= 35, '短すぎない');
    }
  }
  // 縦長：左右の真横から来る道はない（真横だと砦までが近すぎる）
  const { px } = aroundGeoOf(375, 430);
  assert.ok(px.lanes.every((L) => Math.abs(L.y0 - px.fy) > 1 || Math.abs(L.x0 - px.fx) < 1));
});

test('四方から：敵・隊列・ボスがいつも重ならない（いろいろな画面と種で）', () => {
  for (const [W, H, range] of [[375, 430, 'near'], [375, 430, 'ledger3'], [727, 400, 'ledger1'], [1200, 600, 'near'], [700, 240, 'staff']]) {
    const { geo, cols } = aroundGeoOf(W, H, { range });
    for (const seed of [1, 2, 3]) {
      const b = setup({ seed, field: 'around', geo, cols, stages: 2 });
      let bad = 0;
      let rows = 0;
      let last = 0;
      run(b, 150, (bb) => {
        const s = bb.s;
        const L = s.enemies;
        if (L.some((e) => e.kind === 'row')) rows++;
        for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) if (boxesOverlap(L[i], L[j], geo)) bad++;
        if (s.boss) {
          const top = geo.boss.y0 + (geo.boss.y1 - geo.boss.y0) * Math.min(1, s.boss.y);
          const by = top + geo.boss.h / 2;
          for (const e of L) if (Math.abs(e.px - 0.5) < geo.hw + geo.boss.w / 2 && Math.abs(e.py - by) < geo.hh + geo.boss.h / 2) bad++;
        }
        // 敵がたまるように、ゆっくりめに撃つ
        if (s.t - last > 0.9) {
          last = s.t;
          bot(bb, 0.55);
        }
      });
      assert.equal(bad, 0, `${W}x${H} seed ${seed}`);
      if (geo.rows) assert.ok(rows > 0, `${W}x${H}: 隊列も出る`);
      assert.ok(b.s.stage >= 1 && b.s.kills > 10);
    }
  }
});

test('四方から：敵は通り道を進み、砦に届くとハートが減る', () => {
  const { geo, cols } = aroundGeoOf(375, 430);
  const b = setup({ field: 'around', geo, cols });
  run(b, BATTLE.intro + 2.6);
  const e = b.s.enemies[0];
  const L = geo.lanes[e.lane];
  const k = e.y;
  assert.ok(Math.abs(e.px - (L.x0 + (L.x1 - L.x0) * k)) < 1e-9 && Math.abs(e.py - (L.y0 + (L.y1 - L.y0) * k)) < 1e-9);
  run(b, 40);
  assert.ok(b.s.breaches > 0 && b.s.hearts < BATTLE.hearts);
});

test('届かれた直後は守られる：続けて届かれてもハートは 1 つだけ減る', () => {
  const b = setup();
  run(b, BATTLE.intro + 0.1);
  b.s.enemies.length = 0;
  const q = (answer, key) => ({ answer, key, prompt: {} });
  for (let i = 0; i < 3; i++) b.s.enemies.push({ id: 200 + i, q: q(String(i), `g${i}`), kind: 'drop', x: 0.2 + i * 0.3, cx: 0.2 + i * 0.3, y: 0.999, born: 0, alive: true, sway: 0 });
  b.step(1 / 60);
  const ev = b.take().filter((x) => x.type === 'breach');
  assert.equal(ev.length, 3);
  assert.deepEqual(ev.map((x) => x.guarded), [false, true, true]);
  assert.equal(b.s.hearts, BATTLE.hearts - 1);
  assert.equal(b.s.breaches, 3);
  // 守りが切れたら、また減る
  run(b, BATTLE.guard + 0.1);
  b.s.enemies.length = 0;
  b.s.enemies.push({ id: 300, q: q('1', 'h'), kind: 'drop', x: 0.5, cx: 0.5, y: 0.999, born: 0, alive: true, sway: 0 });
  b.step(1 / 60);
  assert.equal(b.s.hearts, BATTLE.hearts - 2);
});

test('照準：同じ音の敵が 2 つなら、rank の小さいほう（照準に近いほう）を撃つ。ボスも的になる', () => {
  const b = setup();
  run(b, BATTLE.intro + 0.1);
  b.s.enemies.length = 0;
  const q = (answer, key) => ({ answer, key, prompt: {} });
  b.s.enemies.push(
    { id: 1, q: q('3', 'a'), kind: 'drop', x: 0.2, cx: 0.2, y: 0.8, born: 0, alive: true, sway: 0 },
    { id: 2, q: q('3', 'b'), kind: 'drop', x: 0.8, cx: 0.8, y: 0.2, born: 0, alive: true, sway: 0 },
  );
  const near = (x) => (c) => (c === 'boss' ? 9 : Math.abs(c.x - x));
  assert.equal(b.press('3', near(0.75)).e.id, 2); // 照準が右 → 遠いほうでも右の敵
  assert.equal(b.press('3').e.id, 1);
  // ボス：照準がボスに近ければボスの音を撃つ
  const b2 = setup();
  for (let t = 0; t < 200 && b2.s.phase !== 'boss'; t += 1 / 60) {
    b2.step(1 / 60);
    bot(b2);
  }
  assert.equal(b2.s.phase, 'boss');
  const note = b2.s.boss.phrase[b2.s.boss.idx].answer;
  b2.s.enemies.length = 0;
  b2.s.enemies.push({ id: 9, q: q(note, 'z'), kind: 'drop', x: 0.5, cx: 0.5, y: 0.95, born: 0, alive: true, sway: 0 });
  assert.equal(b2.press(note, (c) => (c === 'boss' ? 0 : 5)).type, 'boss');
  assert.equal(b2.s.enemies.length, 1);
});

test('問題はステージの番号つきで作る（「だんだん広がる」用）', () => {
  const seen = [];
  let n = 0;
  const make = (stage) => {
    seen.push(stage);
    return { key: `k${n}`, answer: String(n++ % 7), prompt: {} };
  };
  const phr = [];
  const makePhrase = (k, stage) => {
    phr.push(stage);
    return Array.from({ length: k }, () => make(stage));
  };
  const b = makeBattle({ rng: makeRng(5), make, makePhrase, cols: 4, rowH: 0.22, bossH: 0.3, stages: 2 });
  run(b, 400, (bb) => bot(bb));
  assert.ok(seen.includes(1) && seen.includes(2));
  assert.ok(phr.includes(1) && phr.includes(2));
  assert.ok(seen.every((x) => x === 1 || x === 2));
});

// ---- フラッシュ表示・おまかせの速さ ----
import { nextPace, PACE } from '../src/core/battleEngine.js';

test('もう一度見る：時刻を残し、コンボを切る。ボスは今の音から順に光り直す', () => {
  const b = setup();
  assert.equal(b.peek(), false); // 見出しのあいだは受け付けない
  run(b, BATTLE.intro + 3);
  b.s.combo = 5;
  assert.equal(b.peek(), true);
  assert.equal(b.s.peekAt, b.s.t);
  assert.equal(b.s.peeks, 1);
  assert.equal(b.s.combo, 0);
  assert.ok(b.take().some((e) => e.type === 'peek'));
  const b2 = setup();
  for (let t = 0; t < 200 && b2.s.phase !== 'boss'; t += 1 / 60) {
    b2.step(1 / 60);
    bot(b2);
  }
  const boss = b2.s.boss;
  assert.deepEqual(boss.seq, { t0: boss.seq.t0, from: 0 });
  b2.press(boss.phrase[0].answer);
  run(b2, 0.5);
  b2.peek();
  assert.equal(b2.s.boss.seq.from, 1);
  assert.equal(b2.s.boss.seq.t0, b2.s.t);
});

test('おまかせの速さ：届かれたらゆっくり、早めに外さず倒せたら速く。範囲の中に収まる', () => {
  const w = (o) => ({ kills: 6, breaches: 0, misses: 0, prog: [0.3, 0.3], ...o });
  assert.ok(nextPace(1, w({ breaches: 2 })) > 1.1);
  assert.ok(nextPace(1, w({ breaches: 1 })) > 1);
  assert.ok(nextPace(1, w({})) < 0.9);
  assert.ok(nextPace(1, w({ prog: [0.5, 0.55] })) < 1);
  assert.equal(nextPace(1, w({ prog: [0.8, 0.9] })), 1);
  assert.equal(nextPace(PACE.min, w({})), PACE.min);
  assert.equal(nextPace(PACE.max, w({ breaches: 3 })), PACE.max);
  // うまい人が続けると速くなり、敵の降りる時間が短くなる
  const b = setup({ adapt: true, stages: 3 });
  const falls = [];
  run(b, 400, (bb) => {
    bot(bb, 0.12);
    if (bb.s.phase === 'wave' && falls.at(-1) !== bb.params().fall) falls.push(bb.params().fall);
  });
  assert.ok(b.s.pace < 1, `pace ${b.s.pace}`);
  assert.ok(b.take().length >= 0);
  // 何もしない人は届かれ続けるので、ゆっくりになっていく
  const lazy = setup({ adapt: true, hearts: 99 });
  run(lazy, 120);
  assert.ok(lazy.s.pace > 1, `pace ${lazy.s.pace}`);
});

test('並べ方：怪物ごと画面に収まり、列が横に入り、ボスの頭も切れない（上から・四方から）', async () => {
  const { MONSTER } = await import('../src/core/battleLayout.js');
  for (const field of ['fall', 'around']) {
    for (const [W, H] of [[360, 380], [375, 430], [727, 400], [1200, 600], [700, 240]]) {
      for (const range of ['staff', 'near', 'ledger3']) {
        const G = battleGeometry({ W, H, span: staffSpan(RANGES[range], ['tenor', 'treble']), maxPhrase: 6, field });
        const L = engineLayout(G);
        assert.ok(G.g >= (H < 320 ? 6 : 8) && G.g <= 13);
        assert.ok(G.topY >= 0 && G.topB - MONSTER.bossHead * G.g >= 0, 'ボスの頭が上で切れない');
        assert.ok(G.cols >= 2 && G.bossW <= W);
        if (field === 'fall') {
          assert.ok(G.cols * (G.unitW + 8) <= W + G.unitW, `${W}: 列が入る`);
          // 降りる距離がある（とても低い画面に加線 3 本の札は窮屈なので、ふつうの高さでだけ確かめる）
          assert.ok(L.rowH > 0 && (H < 320 || L.rowH < 0.8), `${W}x${H} ${range}: 降りる距離がある (${L.rowH.toFixed(2)})`);
          assert.ok(L.sway >= 0);
        } else {
          assert.ok(L.geo.lanes.length >= 2);
          for (const ln of G.geo.lanes) {
            assert.ok(ln.x0 - G.unitW / 2 >= -1 && ln.x0 + G.unitW / 2 <= W + 1 && ln.y0 - G.unitH / 2 >= -1 && ln.y0 + G.unitH / 2 <= H + 1, '出てくるところで画面に収まる');
          }
        }
      }
    }
  }
});
