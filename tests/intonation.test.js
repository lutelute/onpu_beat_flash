import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStrings, nearestString, TEMPERAMENTS, temperCents, harmonicCents, harmonics, analyzeVibrato } from '../src/core/intonation.js';
import { detectMic, freqToMidi } from '../src/core/pitch.js';
import { makeRng } from '../src/core/rng.js';

const SR = 48000;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

test('開放弦：純正な 5 度で合わせると、A から離れた弦ほど平均律からずれる', () => {
  assert.deepEqual(openStrings('cello', { pure: true }).map((s) => s.cents), [-5.9, -3.9, -2, 0]);
  assert.deepEqual(openStrings('violin', { pure: true }).map((s) => s.cents), [-3.9, -2, 0, 2]);
  assert.deepEqual(openStrings('viola', { pure: true }).map((s) => s.cents), [-5.9, -3.9, -2, 0]);
  // コントラバスは 4 度（狭い）。A より低い E は高めに、上の G は低めに
  assert.deepEqual(openStrings('bass', { pure: true }).map((s) => s.cents), [2, 0, -2, -3.9]);
  assert.deepEqual(openStrings('cello').map((s) => s.cents), [0, 0, 0, 0]);
  // ギターはフレットがあるので平均律のまま
  assert.ok(openStrings('guitar', { pure: true }).every((s) => s.cents === 0));
  assert.equal(openStrings('piano'), null);
});

test('いちばん近い弦と、その目標からのずれ', () => {
  const cello = openStrings('cello', { pure: true });
  const g = nearestString(43.1, cello);
  assert.equal(g.midi, 43);
  assert.ok(Math.abs(g.dev - 13.9) < 1e-9); // 10 セント高い ＋ 目標が 3.9 セント低い
  assert.equal(nearestString(45.5, cello).midi, 43); // 2.5 半音上は D 線より G 線に近い（G 線を締めすぎ）
  assert.equal(nearestString(64, cello), null); // どの弦からも遠い
  assert.equal(nearestString(NaN, cello), null);
});

test('音律：純正律とピタゴラスの、主音から見たずれ', () => {
  assert.deepEqual(TEMPERAMENTS.just.cents, [0, 11.7, 3.9, 15.6, -13.7, -2, -9.8, 2, 13.7, -15.6, 17.6, -11.7]);
  assert.deepEqual(TEMPERAMENTS.pythagorean.cents, [0, -9.8, 3.9, -5.9, 7.8, -2, 11.7, 2, -7.8, 5.9, -3.9, 9.8]);
  assert.equal(temperCents(64, 'just', 0), -13.7); // ハ長調のミ
  assert.equal(temperCents(66, 'just', 2), -13.7); // ニ長調のファ♯
  assert.equal(temperCents(73, 'pythagorean', 2), 9.8); // ニ長調の導音 ド♯
  assert.equal(temperCents(61, 'equal', 0), 0);
  assert.equal(temperCents(61, 'unknown', 0), 0);
});

test('自然倍音の平均律からのずれ', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(harmonicCents), [0, 0, 2, 0, -13.7, 2, -31.2, 0]);
});

function tone(f0, amps, len = 4096, noise = 0, seed = 3) {
  const rng = makeRng(seed);
  const b = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let v = 0;
    amps.forEach((a, k) => {
      v += a * Math.sin((2 * Math.PI * f0 * (k + 1) * i) / SR + k);
    });
    b[i] = v + noise * (rng.next() * 2 - 1);
  }
  return b;
}

test('倍音の強さ：作った音の強さの比が、ほぼそのまま出る', () => {
  for (const f0 of [65.4, 110, 196, 440]) {
    const hs = harmonics(tone(f0, [1, 0.5, 0.25, 0.1, 0.05]), SR, f0, { count: 5 });
    assert.equal(hs.length, 5);
    const want = [0, -6, -12, -20, -26];
    hs.forEach((x, i) => {
      assert.ok(Math.abs(x.db - want[i]) < 1.2, `${f0} Hz の ${x.k} 倍音 ${x.db} dB（${want[i]} のはず）`);
      assert.ok(Math.abs(1200 * Math.log2(x.freq / (f0 * x.k))) < 12, `${f0} Hz の ${x.k} 倍音の高さ ${x.freq}`);
    });
  }
  // 基音が弱い低い弦（2 倍音がいちばん強い）
  const low = harmonics(tone(65.4, [0.3, 1, 0.6]), SR, 65.4, { count: 3 });
  assert.equal(low[1].db, 0);
  assert.ok(low[0].db < -9);
  // ナイキストに近い倍音は出さない
  assert.ok(harmonics(tone(3000, [1]), SR, 3000, { count: 8 }).length <= 7);
  assert.deepEqual(harmonics(new Float32Array(4096), SR, 0), []);
});

/** 揺れ（rate Hz・幅 ±w セント）のある高さの並び。20 ms ごと */
function wobble(rate, w, { sec = 1.2, drift = 0, jitter = 1, seed = 5, center = 0 } = {}) {
  const rng = makeRng(seed);
  const pts = [];
  for (let t = 0; t <= sec; t += 0.02) pts.push({ t, c: center + w * Math.sin(2 * Math.PI * rate * t) + drift * t + jitter * (rng.next() * 2 - 1) });
  return pts;
}

test('ビブラート：速さと幅を当てる。小さなふらつき・ゆっくりした上がり下がりはビブラートと数えない', () => {
  for (const [rate, w] of [[5, 30], [6, 20], [7, 45], [4.5, 60]]) {
    const v = analyzeVibrato(wobble(rate, w, { sec: 1.5, center: 4 }));
    assert.ok(v, `${rate} Hz ±${w}`);
    assert.ok(Math.abs(v.rate - rate) < 0.5, `速さ ${v.rate}（${rate} のはず）`);
    assert.ok(Math.abs(v.width - w) < w * 0.15 + 2, `幅 ${v.width}（${w} のはず）`);
    assert.ok(Math.abs(v.center - 4) < 6);
  }
  // 傾き（だんだん高くなる）があっても、揺れは取れる
  const tilted = analyzeVibrato(wobble(5.5, 25, { drift: 40 }));
  assert.ok(tilted && Math.abs(tilted.rate - 5.5) < 0.5);
  assert.equal(analyzeVibrato(wobble(5, 2, { jitter: 3 })), null); // ふらつきだけ
  assert.equal(analyzeVibrato(wobble(1.2, 40, { sec: 2 })), null); // ゆっくりすぎる（揺れではなく、高さの迷い）
  assert.equal(analyzeVibrato(wobble(5, 30, { sec: 0.3 })), null); // 短すぎる
  assert.equal(analyzeVibrato(null), null);
});

test('ビブラートのある音を、マイクと同じ手順（20 ms ごと・2048 点）で聞いて、揺れを当てる', () => {
  // チェロの D3 を 5.5 Hz・±25 セントで揺らす（倍音つき）
  const f0 = hz(50);
  const sec = 1.6;
  const n = Math.round(sec * SR);
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f0 * 2 ** ((25 * Math.sin(2 * Math.PI * 5.5 * t)) / 1200);
    ph += (2 * Math.PI * f) / SR;
    x[i] = 0.3 * Math.sin(ph) + 0.5 * Math.sin(2 * ph + 1) + 0.3 * Math.sin(3 * ph + 2) + 0.15 * Math.sin(4 * ph);
  }
  const pts = [];
  for (let end = 4096; end <= n; end += SR * 0.02) {
    const p = detectMic(x.subarray(end - 4096, end), SR, {}, { short: 2048 });
    if (p) pts.push({ t: end / SR, c: (freqToMidi(p.freq) - 50) * 100 });
  }
  const v = analyzeVibrato(pts);
  assert.ok(v, 'ビブラートが取れない');
  assert.ok(Math.abs(v.rate - 5.5) < 0.5, `速さ ${v.rate}`);
  // 43 ms の窓で揺れが少し均されるので、幅は少し小さめに出る
  assert.ok(v.width > 17 && v.width < 29, `幅 ${v.width}`);
  assert.ok(Math.abs(v.center) < 5, `中心 ${v.center}`);
});
