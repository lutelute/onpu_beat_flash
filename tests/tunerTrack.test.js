import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTunerTrack, easeNeedle } from '../src/core/tunerTrack.js';
import { openStrings } from '../src/core/intonation.js';

const hz = (m) => 440 * 2 ** ((m - 69) / 12);
/** 20 ms ごとの枚。fn(t) → { m（MIDI の小数か null）, clarity?, weak? } */
function feedAll(tt, from, to, fn) {
  const out = [];
  for (let t = from; t < to - 1e-9; t += 0.02) {
    const x = fn(t);
    tt.feed({ t, freq: x.m == null ? null : hz(x.m), clarity: x.clarity ?? 0.95, weak: !!x.weak, gated: !!x.gated });
    out.push({ t, ...tt.read() });
  }
  return out;
}

test('チューナーの針：はっきりしない枚・小さい枚がまじっても、鳴っている音の続きなら途切れない', () => {
  const tt = makeTunerTrack();
  // ラ（A3）を +4 セントで 2 秒。5 枚に 1 枚ははっきり具合 0.72、7 枚に 1 枚は下限より小さい、11 枚に 1 枚は聞こえない
  let i = 0;
  const rs = feedAll(tt, 0, 2, () => {
    i++;
    if (i % 11 === 0) return { m: null };
    return { m: 57.04, clarity: i % 5 === 0 ? 0.72 : 0.95, weak: i % 7 === 0 };
  });
  const after = rs.filter((r) => r.t > 0.1);
  assert.ok(after.every((r) => r.state === 'live'), '途中で live でなくなった');
  assert.ok(after.every((r) => r.ref.midi === 57 && Math.abs(r.value - 4) < 0.5), `針: ${after.map((r) => r.value?.toFixed(1)).join(' ')}`);
});

test('チューナーの針：新しい音は、はっきりした枚・下限より大きい枚でしか始まらない', () => {
  const tt = makeTunerTrack();
  feedAll(tt, 0, 0.5, () => ({ m: 64, clarity: 0.75 }));
  assert.equal(tt.read().state, 'idle', 'はっきりしない枚で始まった');
  feedAll(tt, 0.5, 1, () => ({ m: 64, clarity: 0.95, weak: true }));
  assert.equal(tt.read().state, 'idle', '小さい枚で始まった');
  feedAll(tt, 1, 1.2, () => ({ m: 64, clarity: 0.95 }));
  assert.equal(tt.read().state, 'live');
});

test('チューナーの針：1〜2 枚だけの飛び（倍音・オクターブ）は受け取らず、3 枚続けば移る', () => {
  const tt = makeTunerTrack();
  feedAll(tt, 0, 1, () => ({ m: 50.02 }));
  // 2 枚だけ 1 オクターブ上（とても はっきり）
  feedAll(tt, 1, 1.04, () => ({ m: 62.02, clarity: 0.99 }));
  let r = tt.read();
  assert.equal(r.ref.midi, 50);
  assert.ok(Math.abs(r.value - 2) < 0.5, `針 ${r.value}`);
  feedAll(tt, 1.04, 1.5, () => ({ m: 50.02 }));
  // 次の音（ミ）へ移る：3 枚で移る
  feedAll(tt, 1.5, 1.56, () => ({ m: 52.1 }));
  r = tt.read();
  assert.equal(r.ref.midi, 52, `比べる音 ${r.ref.midi}`);
});

test('チューナーの針：聞こえなくなっても 1 秒までは最後の針を残し、そのあと消える', () => {
  const tt = makeTunerTrack();
  feedAll(tt, 0, 1, () => ({ m: 69.1 }));
  const rs = feedAll(tt, 1, 2.4, () => ({ m: null }));
  const at = (t) => rs.find((r) => r.t >= t - 1e-9);
  assert.equal(at(1.1).state, 'live');
  assert.equal(at(1.5).state, 'hold');
  assert.ok(Math.abs(at(1.5).value - 10) < 0.5, '残した針がずれた');
  assert.equal(at(2.2).state, 'idle');
});

test('チューナーの針：ビブラートは揺れの中心。開放弦は純正な目標から測る', () => {
  const tt = makeTunerTrack({ strings: openStrings('cello', { pure: true }) });
  // D 線（D3。純正の目標は −2 セント）を −2 セントの中心で、5.5 Hz・±20 セント
  const rs = feedAll(tt, 0, 2.5, (t) => ({ m: 50 + (-2 + 20 * Math.sin(2 * Math.PI * 5.5 * t)) / 100 }));
  const r = rs.at(-1);
  assert.equal(r.ref.string, 2);
  assert.ok(r.vib && Math.abs(r.vib.rate - 5.5) < 0.4, `ビブラート ${JSON.stringify(r.vib)}`);
  assert.ok(Math.abs(r.value) < 2.5, `針 ${r.value}`);
});

test('針の動き：画面の更新の速さによらない（60 Hz で 2 回 ≒ 30 Hz で 1 回）', () => {
  const a = easeNeedle(easeNeedle(0, 10, 1 / 60), 10, 1 / 60);
  const b = easeNeedle(0, 10, 1 / 30);
  assert.ok(Math.abs(a - b) < 1e-9);
  assert.ok(b > 1 && b < 3, `1/30 秒で ${b}`);
  // 音が変わったとき（20 セントより離れている）は速く追う
  assert.ok(easeNeedle(0, 40, 1 / 30) / 40 > b / 10);
});
