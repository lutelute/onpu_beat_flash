import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identifyChord, chordFromMidi, multiPitch, makeChordTracker } from '../src/core/chordListen.js';
import { CHORDS } from '../src/core/music.js';
import { voicing } from '../src/generators/chord.js';
import { rms } from '../src/core/pitch.js';

const SR = 48000;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
// ピアノのような倍音（だんだん弱く、少しずつ高くずれる）
const PIANO = Array.from({ length: 10 }, (_, k) => (0.35 + 0.65 * Math.abs(Math.sin((Math.PI * (k + 1)) / 8.3))) / (k + 1) ** 1.15);
function render(notes, seconds, { amp = 0.05 } = {}) {
  const out = new Float32Array(Math.ceil(seconds * SR));
  for (const { midi, t0 = 0.2 } of notes) {
    const f = hz(midi);
    const B = 0.00012 * 2 ** ((midi - 60) / 12);
    const i0 = Math.floor(t0 * SR);
    PIANO.forEach((a, k) => {
      const n = k + 1;
      const fn = n * f * Math.sqrt(1 + B * n * n);
      if (fn > SR / 2.2) return;
      const ph = k * 1.3 + midi;
      for (let i = i0; i < out.length; i++) {
        const t = (i - i0) / SR;
        out[i] += amp * a * Math.min(1, t / 0.004) * Math.exp(-t / (1.6 / (1 + 0.4 * k))) * Math.sin(2 * Math.PI * fn * t + ph);
      }
    });
  }
  return out;
}
/** アプリと同じ手順で聞く（20 ms ごと・40 ms ごとに 8192 点で音を探す） */
function listen(sig, opts = {}) {
  const tr = makeChordTracker({ minLevel: 0.004, ...opts });
  const out = [];
  let k = 0;
  for (let end = 8192; end <= sig.length; end += SR * 0.02) {
    const level = rms(sig.subarray(end - 2048, end));
    const ns = k++ % 2 === 0 && level >= 0.004 ? multiPitch(sig.subarray(end - 8192, end), SR) : null;
    const c = tr.feed({ t: end / SR, level, notes: ns });
    if (c) out.push(c);
  }
  return out;
}

test('コードの見分け：どの種類・根音・転回形でも、音の組み合わせから正しい種類（そろっている）', () => {
  for (const c of CHORDS) {
    for (let r = 0; r < 12; r++) {
      const w = new Array(12).fill(0);
      for (const t of c.tones) w[(r + t) % 12] = 1;
      const got = identifyChord(w);
      assert.ok(got.complete, `${c.id} 根音 ${r}`);
      assert.ok(got.alts.includes(c.id), `${c.id} 根音 ${r}: ${got.quality} ${got.alts}`);
    }
  }
});

test('MIDI 鍵盤の和音：転回形・同じ音の重ね・セブンスで 5 の音を省いても分かる。2 音では答えない', () => {
  for (const c of CHORDS) {
    for (let inv = 0; inv < c.tones.length; inv++) {
      const v = voicing(52, c.tones, inv);
      assert.ok(chordFromMidi(v).alts.includes(c.id), `${c.id} 転回 ${inv}`);
      assert.ok(chordFromMidi([...v, v[0] - 12]).alts.includes(c.id), `${c.id} 重ね`);
    }
  }
  // C7 を 5 の音なしで（ド・ミ・シ♭）
  const c7 = chordFromMidi([48, 52, 58]);
  assert.equal(c7.quality, 'dom7');
  assert.ok(c7.complete);
  // ド・ミだけ：メジャーかマイナーか決まらないので、そろっていない
  assert.equal(chordFromMidi([60, 64]).complete, false);
  // 出す種類を絞れば、その中から選ぶ
  assert.equal(chordFromMidi([60, 63, 67], { allow: ['maj', 'min'] }).quality, 'min');
});

test('鳴っている音を探す：ピアノのような和音（ド・ミ・ソ、低いミの短三和音、セブンス）', () => {
  for (const chord of [[60, 64, 67], [40, 43, 47], [55, 59, 62, 65], [62, 66, 69, 73]]) {
    const sig = render(chord.map((midi) => ({ midi })), 0.6);
    const found = multiPitch(sig.subarray(sig.length - 8192), SR).map((n) => n.midi);
    for (const m of chord) assert.ok(found.includes(m), `${chord} の ${m} が無い（見つけた音 ${found}）`);
    // まぼろしの音（倍音から出る低い音）は出ない
    assert.ok(found.every((m) => m >= Math.min(...chord)), `${chord}：低いまぼろしの音 ${found}`);
  }
});

test('和音を弾くと 1 回だけ答える。分散和音（1 音ずつ）でも、そろったところで答える', () => {
  const block = render([60, 64, 67].map((midi) => ({ midi })), 1.5);
  const a = listen(block);
  assert.equal(a.length, 1);
  assert.equal(a[0].quality, 'maj');
  assert.equal(a[0].root, 0);
  const arp = render([57, 60, 64].map((midi, i) => ({ midi, t0: 0.2 + i * 0.08 })), 1.5);
  const b = listen(arp);
  assert.equal(b.length, 1);
  assert.equal(b[0].quality, 'min');
  // 何も鳴っていなければ答えない
  assert.deepEqual(listen(new Float32Array(SR)), []);
});

test('同じ和音をもう一度弾くと、もう一度答える（間をあけて）', () => {
  const sig = render([{ midi: 62, t0: 0.2 }, { midi: 65, t0: 0.2 }, { midi: 69, t0: 0.2 }, { midi: 62, t0: 1.4 }, { midi: 65, t0: 1.4 }, { midi: 69, t0: 1.4 }], 2.6);
  // 2 回めの前で、1 回めの音が消えるように
  for (let i = Math.floor(1.2 * SR); i < Math.floor(1.4 * SR); i++) sig[i] *= Math.max(0, 1 - (i - 1.2 * SR) / (0.05 * SR));
  const got = listen(sig).map((c) => c.quality);
  assert.deepEqual(got, ['min', 'min']);
});
