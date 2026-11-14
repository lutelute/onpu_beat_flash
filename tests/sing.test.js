import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MELODIES, KEYS, makeMelody, barBeats, parseScore } from '../src/core/melodies.js';
import { makeSingScorer, foldCents, frameCredit, adviceOf, STRICTNESS } from '../src/core/singScore.js';
import { detectMic, freqToMidi, rms } from '../src/core/pitch.js';
import { makeRng } from '../src/core/rng.js';
import { temperCents } from '../src/core/intonation.js';

const SR = 48000;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

test('曲：どの小節も 4 拍', () => {
  for (const m of MELODIES.filter((x) => x.kind === 'song')) {
    assert.ok(barBeats(m.id).every((b) => b === 4), `${m.label}: ${barBeats(m.id)}`);
  }
  assert.deepEqual(parseScore('C4 D#4:2 r:0.5 Bb3'), [{ midi: 60, beats: 1 }, { midi: 63, beats: 2 }, { midi: null, beats: 0.5 }, { midi: 58, beats: 1 }]);
  assert.throws(() => parseScore('H4'));
});

test('旋律：調に移し、楽器の音域のまん中あたりに置く。時刻は拍とテンポから', () => {
  for (const m of MELODIES) {
    for (const k of KEYS) {
      const mel = makeMelody({ id: m.id, key: k.id, bpm: 60, seed: 7 });
      assert.ok(mel.notes.length >= 7, `${m.id}`);
      assert.equal(mel.tonic, k.semi % 12);
      assert.equal(mel.beats % 4, 0, `${m.id} は小節の終わりで終わる`);
      // 主音で終わる
      assert.equal(mel.notes.at(-1).midi % 12, k.semi % 12, `${m.id}・${k.id} の終わり`);
      // 重ならず、時刻の順
      for (let i = 1; i < mel.notes.length; i++) assert.ok(mel.notes[i].t >= mel.notes[i - 1].t + mel.notes[i - 1].d - 1e-9);
    }
  }
  const twinkle = makeMelody({ id: 'twinkle', key: 'C', bpm: 120 });
  assert.equal(twinkle.notes[0].midi, 60);
  assert.equal(twinkle.notes[1].t, 0.5);
  assert.equal(twinkle.length, 24);
  // チェロなら 1 オクターブ下、バイオリンなら上
  assert.equal(makeMelody({ id: 'twinkle', inst: 'cello' }).notes[0].midi, 48);
  assert.equal(makeMelody({ id: 'twinkle', inst: 'violin' }).notes[0].midi, 72);
  assert.equal(makeMelody({ id: 'scale', key: 'D', inst: 'cello' }).notes[0].midi, 50);
  // 休みは音に入らない（かえるの合唱の「ケロ」のあいだ）
  const frog = makeMelody({ id: 'frog', bpm: 60 });
  assert.ok(frog.notes.some((n, i) => i > 0 && n.t > frog.notes[i - 1].t + frog.notes[i - 1].d + 0.5));
  // 毎回ちがう旋律は、種が同じなら同じ
  const a = makeMelody({ id: 'random', seed: 11 }).notes.map((n) => n.midi);
  assert.deepEqual(makeMelody({ id: 'random', seed: 11 }).notes.map((n) => n.midi), a);
  assert.notDeepEqual(makeMelody({ id: 'random', seed: 12 }).notes.map((n) => n.midi), a);
});

test('毎回ちがう旋律：音域の中で、となりの音へ動くことが多い', () => {
  let steps = 0;
  let moves = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const ns = makeMelody({ id: 'random', seed }).notes;
    const ms = ns.map((n) => n.midi);
    assert.ok(Math.max(...ms) - Math.min(...ms) <= 17, `種 ${seed} の音域`);
    for (let i = 1; i < ms.length; i++) {
      const d = Math.abs(ms[i] - ms[i - 1]);
      moves++;
      if (d <= 2) steps++;
      assert.ok(d <= 9, `種 ${seed} で ${d} 半音跳んだ`);
    }
  }
  assert.ok(steps / moves > 0.55, `2 度の動き ${steps}/${moves}`);
});

test('オクターブを問わないずれ', () => {
  assert.ok(Math.abs(foldCents(60.1, 60) - 10) < 1e-6);
  assert.ok(Math.abs(foldCents(48.1, 60) - 10) < 1e-6);
  assert.ok(Math.abs(foldCents(71.9, 60) + 10) < 1e-6);
  assert.ok(Math.abs(foldCents(66, 60) - 600) < 1e-6 || Math.abs(foldCents(66, 60) + 600) < 1e-6);
  assert.equal(frameCredit(null, 30), 0);
  assert.equal(frameCredit(25, 30), 1);
  assert.equal(frameCredit(-45, 30), 0.5);
  assert.equal(frameCredit(70, 30), 0);
});

/** 旋律を、高さの並び pitchAt(t, note) で 20 ms ごとに聞かせる（null は聞こえない） */
function sing(mel, pitchAt, opts = {}) {
  const sc = makeSingScorer({ notes: mel.notes, tonic: mel.tonic, ...opts });
  for (let t = 0; t < mel.length; t += 0.02) {
    const n = mel.notes.find((x) => t >= x.t && t < x.t + x.d);
    sc.feed(t, pitchAt(t, n));
  }
  return sc.result();
}

test('採点：ぴったり歌えば満点に近く、1 オクターブ下でも同じ', () => {
  const mel = makeMelody({ id: 'twinkle', bpm: 90 });
  const perfect = sing(mel, (t, n) => (n ? n.midi : null));
  assert.ok(perfect.total >= 99, `満点のはず ${perfect.total}`);
  assert.equal(perfect.pitch, 100);
  assert.equal(perfect.attack, 100);
  const low = sing(mel, (t, n) => (n ? n.midi - 12 : null));
  assert.equal(low.total, perfect.total);
  const none = sing(mel, () => null);
  assert.equal(none.total, 0);
  assert.equal(none.pitch, 0);
});

test('採点：高めのくせ・遅れた出だし・ふらつきが、それぞれの点に出る', () => {
  const mel = makeMelody({ id: 'scale', bpm: 80 });
  const rng = makeRng(4);
  // 全体に +20 セント：ふつうなら音程は満点、きびしいなら下がる
  const sharp = (t, n) => (n ? n.midi + 0.2 : null);
  assert.equal(sing(mel, sharp, { tol: STRICTNESS.normal.tol }).pitch, 100);
  const strict = sing(mel, sharp, { tol: STRICTNESS.strict.tol });
  assert.ok(strict.pitch < 75 && strict.pitch > 60, `きびしい ${strict.pitch}`);
  assert.ok(Math.abs(strict.bias - 20) < 0.5);
  // 出だしが 0.3 秒遅れる（そのあいだは前の音のまま）
  const late = sing(mel, (t, n) => {
    if (!n) return null;
    const i = mel.notes.indexOf(n);
    return t - n.t < 0.3 && i > 0 ? mel.notes[i - 1].midi : n.midi;
  });
  assert.ok(late.attack < 55, `出だし ${late.attack}`);
  // ゆっくりふらつく（±25 セントで 1.3 Hz）
  const wobbly = sing(mel, (t, n) => (n ? n.midi + 0.25 * Math.sin(2 * Math.PI * 1.3 * t) + 0.02 * rng.next() : null));
  assert.ok(wobbly.stable < 40, `安定 ${wobbly.stable}`);
  assert.ok(sing(mel, sharp).stable > 95);
});

test('採点：ビブラートは減点せず、少しだけ足す。どの音が高めかも分かる', () => {
  const mel = makeMelody({ id: 'longtone', bpm: 72 });
  const vib = sing(mel, (t, n) => (n ? n.midi + 0.3 * Math.sin(2 * Math.PI * 5.5 * t) : null), { tol: 50 });
  assert.equal(vib.vibrato.count, mel.notes.length);
  assert.ok(Math.abs(vib.vibrato.rate - 5.5) < 0.4);
  assert.ok(vib.stable > 90, `ビブラートは均してから見る ${vib.stable}`);
  assert.ok(vib.total >= 99);
  // ミだけ 25 セント高い
  const mel2 = makeMelody({ id: 'scale', bpm: 80 });
  const r = sing(mel2, (t, n) => (n ? n.midi + (n.midi % 12 === 4 ? 0.25 : 0) : null));
  const mi = r.byPitch.find((b) => b.midi % 12 === 4);
  assert.ok(Math.abs(mi.mean - 25) < 1);
  const advice = adviceOf(r, (m) => ['ド', '', 'レ', '', 'ミ'][m % 12] ?? '?');
  assert.ok(advice.some((a) => a.includes('ミ が高め')), advice.join('／'));
});

test('採点：純正律では、平均律のミは高すぎ（+13.7 セント）と数える', () => {
  const mel = makeMelody({ id: 'longtone', bpm: 80 });
  const r = sing(mel, (t, n) => (n ? n.midi : null), { temper: 'just', tol: 15 });
  const mi = r.byPitch.find((b) => b.midi % 12 === 4);
  assert.ok(Math.abs(mi.mean - 13.7) < 0.2, `${mi.mean}`);
  const ok = sing(mel, (t, n) => (n ? n.midi + temperCents(n.midi, 'just', mel.tonic) / 100 : null), { temper: 'just', tol: 15 });
  assert.ok(ok.pitch > 99);
});

test('マイクと同じ手順で、本物に近い音（倍音・ビブラート・息の音）を聞いて採点する', () => {
  const mel = makeMelody({ id: 'scale', key: 'D', bpm: 96, inst: 'cello' });
  const n = Math.round((mel.length + 0.1) * SR);
  const x = new Float32Array(n);
  const rng = makeRng(9);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const note = mel.notes.find((y) => t >= y.t && t < y.t + y.d);
    if (!note) continue;
    const into = t - note.t;
    const vib = into > 0.3 ? 0.2 * Math.sin(2 * Math.PI * 5.2 * t) : 0;
    const f = hz(note.midi + 0.06 + vib); // いつも 6 セント高め
    ph += (2 * Math.PI * f) / SR;
    const env = Math.min(1, into / 0.05) * Math.min(1, (note.t + note.d - t) / 0.03);
    x[i] = env * (0.25 * Math.sin(ph) + 0.4 * Math.sin(2 * ph + 1) + 0.3 * Math.sin(3 * ph + 2) + 0.15 * Math.sin(5 * ph)) + 0.004 * (rng.next() * 2 - 1);
  }
  const sc = makeSingScorer({ notes: mel.notes, tonic: mel.tonic, tol: 30 });
  for (let end = 4096; end <= n; end += SR * 0.02) {
    const buf = x.subarray(end - 4096, end);
    const p = rms(buf.subarray(2048)) >= 0.004 ? detectMic(buf, SR, { minFreq: 60, maxFreq: 900 }) : null;
    sc.feed(end / SR - 0.02, p ? freqToMidi(p.freq) : null);
  }
  const r = sc.result();
  assert.ok(r.pitch > 95, `音程 ${r.pitch}`);
  assert.ok(r.attack > 85, `出だし ${r.attack}`);
  assert.ok(Math.abs(r.bias - 6) < 3, `くせ ${r.bias}`);
  assert.ok(r.total > 93, `点数 ${r.total}`);
});
