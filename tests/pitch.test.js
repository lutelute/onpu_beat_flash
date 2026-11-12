import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rms, freqToMidi, detectPitch, makeNoteTracker, MIC_INSTRUMENTS, micInstrument, writtenNote,
  MIC_FLOOR, MIC_SENS, micSens, sensFloor, sensTracker, pickSens,
} from '../src/core/pitch.js';
import { makeRng } from '../src/core/rng.js';

const N = 2048;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const cents = (f, m) => (freqToMidi(f) - m) * 100;

/** 倍音を重ねた 1 枚（amps[k] が k+1 倍音。B は不協和性：n 倍音が n·f·√(1+B n²) にずれる） */
function frame(f, sr, amps, { B = 0, phase = 0.3, len = N } = {}) {
  const b = new Float32Array(len);
  amps.forEach((a, k) => {
    const n = k + 1;
    const fn = n * f * Math.sqrt(1 + B * n * n);
    if (fn > sr / 2.2) return;
    for (let i = 0; i < len; i++) b[i] += a * Math.sin((2 * Math.PI * fn * i) / sr + phase * n * 1.7);
  });
  return b;
}
// ピアノに似た倍音（ハンマーの位置で 8 倍音あたりが弱い・上ほど弱い）
const PIANO = Array.from({ length: 12 }, (_, k) => (0.35 + 0.65 * Math.abs(Math.sin((Math.PI * (k + 1)) / 8.3))) / (k + 1) ** 1.15);

test('rms と freqToMidi', () => {
  assert.equal(rms(new Float32Array(8)), 0);
  assert.ok(Math.abs(rms(frame(440, 48000, [1])) - Math.SQRT1_2) < 0.01);
  assert.equal(freqToMidi(440), 69);
  assert.ok(Math.abs(freqToMidi(261.6256) - 60) < 1e-4);
});

test('正弦波：A1〜G6 のどの音も ±10 セント以内', () => {
  for (const sr of [44100, 48000]) {
    for (let m = 33; m <= 91; m++) {
      for (const phase of [0, 0.7, 2.1]) {
        const r = detectPitch(frame(hz(m), sr, [0.3], { phase }), sr);
        assert.ok(r, `${sr} Hz・MIDI ${m} が取れない`);
        assert.ok(Math.abs(cents(r.freq, m)) <= 10, `${sr} Hz・MIDI ${m}: ${cents(r.freq, m).toFixed(1)} セント`);
        assert.ok(r.clarity > 0.9);
      }
    }
  }
});

test('基音が 2 倍音より弱い音でもオクターブを取りちがえない', () => {
  const sets = [
    [0.3, 1, 0.7, 0.5, 0.35, 0.25, 0.15, 0.1],
    [0.15, 1, 0.8, 0.6, 0.3, 0.2],
    [0.2, 0.6, 1, 0.5, 0.4, 0.3, 0.2], // 3 倍音がいちばん強い
  ];
  for (const sr of [44100, 48000]) {
    for (const amps of sets) {
      for (let m = 36; m <= 88; m += 2) {
        const r = detectPitch(frame(hz(m), sr, amps), sr);
        assert.ok(r, `MIDI ${m} が取れない`);
        assert.ok(Math.abs(cents(r.freq, m)) <= 10, `MIDI ${m}・${amps}: ${cents(r.freq, m).toFixed(1)} セント`);
      }
    }
  }
});

test('ピアノのように倍音が少しずつ高くずれる音でも、半音はまちがえない', () => {
  for (let m = 36; m <= 88; m++) {
    const B = 0.0004 * 2 ** ((m - 60) / 24); // 高い音ほどずれが大きい
    const r = detectPitch(frame(hz(m), 48000, PIANO, { B }), 48000);
    assert.ok(r, `MIDI ${m} が取れない`);
    assert.equal(Math.round(freqToMidi(r.freq)), m, `MIDI ${m}: ${cents(r.freq, m).toFixed(1)} セント`);
    assert.ok(Math.abs(cents(r.freq, m)) <= 25, `MIDI ${m}: ${cents(r.freq, m).toFixed(1)} セント`);
  }
});

test('雑音・無音・範囲の外は null', () => {
  const rng = makeRng(7);
  for (let k = 0; k < 50; k++) {
    const b = new Float32Array(N);
    for (let i = 0; i < N; i++) b[i] = (rng.next() * 2 - 1) * 0.3;
    assert.equal(detectPitch(b, 48000), null, `白色雑音 ${k}`);
  }
  assert.equal(detectPitch(new Float32Array(N), 48000), null);
  assert.equal(detectPitch(new Float32Array(N).fill(0.2), 48000), null); // 直流だけ
  assert.equal(detectPitch(frame(3000, 48000, [0.3]), 48000), null); // 高すぎる
  assert.equal(detectPitch(frame(30, 48000, [0.3]), 48000), null); // 低すぎる
});

// ---- 楽器ごとの聞く範囲 ----
const LOW = [0.3, 1, 0.7, 0.5, 0.35, 0.25, 0.15, 0.1]; // 基音が弱い（低い弦・ピアノの低い音）
const MID = [0.5, 1, 0.6, 0.4, 0.25, 0.15];
const TOP = [1, 0.4, 0.15]; // 高い音は倍音が少ない
const near = (r, m) => r && Math.abs(freqToMidi(r.freq) - m) < 0.3;

test('指定なしは今までと同じ（50〜1600 Hz、そのまま渡す）。知らない id も指定なし', () => {
  const any = micInstrument('any');
  assert.equal(MIC_INSTRUMENTS[0], any);
  assert.equal(any.minFreq, 50);
  assert.equal(any.maxFreq, 1600);
  assert.equal(micInstrument(undefined), any);
  assert.equal(micInstrument('zzz'), any);
  for (const sr of [44100, 48000]) {
    for (let m = 26; m <= 100; m += 2) {
      for (const amps of [[0.3], LOW, PIANO]) {
        const f = frame(hz(m), sr, amps);
        assert.deepEqual(detectPitch(f, sr, any), detectPitch(f, sr), `${sr} Hz・MIDI ${m}`);
      }
    }
  }
});

test('楽器の音域の中の音は聞く（いちばん低い音から高い音まで）', () => {
  for (const sr of [44100, 48000]) {
    for (const it of MIC_INSTRUMENTS.slice(1)) {
      for (let m = it.low; m <= it.high; m++) {
        // 倍音の多い音は C7 まで（それより上は周期が短く、範囲に関係なく 1 オクターブ下に取ることがある）
        const sets = m <= 96 ? [TOP, MID, LOW] : [TOP, [0.3]];
        for (const amps of sets) {
          for (const phase of [0, 2.1]) {
            const r = detectPitch(frame(hz(m), sr, amps, { phase }), sr, it);
            assert.ok(near(r, m), `${sr} Hz・${it.id}・MIDI ${m}: ${r ? freqToMidi(r.freq).toFixed(2) : 'null'}`);
          }
        }
      }
    }
  }
});

test('楽器の音域から 2 半音以上外れた音は聞かない', () => {
  for (const sr of [44100, 48000]) {
    for (const it of MIC_INSTRUMENTS.slice(1)) {
      for (const d of [2, 3, 12]) {
        for (const m of [it.low - d, it.high + d]) {
          const sets = m <= 96 ? [TOP, MID, LOW, [0.3]] : [TOP, [0.3]];
          for (const amps of sets) {
            for (const phase of [0, 2.1]) {
              const r = detectPitch(frame(hz(m), sr, amps, { phase }), sr, it);
              assert.equal(r, null, `${sr} Hz・${it.id}・MIDI ${m}: ${r ? freqToMidi(r.freq).toFixed(2) : ''}`);
            }
          }
        }
      }
    }
  }
});

test('楽器を選ぶと、楽器に出せない低い音へ 1 オクターブ下に飛ばない', () => {
  // 1 オクターブ下に弱い音がまざった音（f/2 の倍音列で、f/2・3f/2… が弱い）。指定なしだと 1 オクターブ下に取る
  const SUB = [0.3, 1, 0.15, 0.5, 0.15, 0.3, 0.15, 0.2];
  for (const sr of [44100, 48000]) {
    for (const [id, m] of [['flute', 64], ['violin', 57], ['viola', 55], ['cello', 45]]) {
      const f = frame(hz(m) / 2, sr, SUB);
      const any = detectPitch(f, sr);
      assert.ok(near(any, m - 12), `${sr} Hz・指定なし・MIDI ${m}: ${any && freqToMidi(any.freq).toFixed(2)}`); // 確かめ：指定なしでは飛ぶ
      const r = detectPitch(f, sr, micInstrument(id));
      assert.ok(near(r, m), `${sr} Hz・${id}・MIDI ${m}: ${r && freqToMidi(r.freq).toFixed(2)}`);
    }
  }
  // 指定なしより広げたところ：E1（41 Hz）はピアノ・コントラバスなら聞く。G2 はチェロなら聞くがフルートでは聞かない
  const e1 = frame(hz(28), 48000, LOW);
  assert.equal(detectPitch(e1, 48000), null);
  for (const id of ['piano', 'bass']) assert.ok(near(detectPitch(e1, 48000, micInstrument(id)), 28), id);
  const g2 = frame(hz(43), 48000, MID);
  assert.ok(near(detectPitch(g2, 48000, micInstrument('cello')), 43));
  assert.equal(detectPitch(g2, 48000, micInstrument('flute')), null);
});

test('ギターとコントラバス・ベースだけ、1 オクターブ上げて（楽譜に書く高さで）受け取る', () => {
  assert.deepEqual(MIC_INSTRUMENTS.map((x) => x.id), ['any', 'piano', 'violin', 'viola', 'cello', 'bass', 'guitar', 'flute', 'voice']);
  for (const it of MIC_INSTRUMENTS) {
    const up = it.id === 'guitar' || it.id === 'bass' ? 12 : 0;
    assert.equal(writtenNote(52, it.id), 52 + up, it.id);
  }
  assert.equal(writtenNote(52, 'guitar'), 64); // 鳴った E3 は、五線の E4
  assert.equal(writtenNote(null, 'guitar'), null);
  assert.equal(writtenNote(60, 'zzz'), 60);
});

// ---- 音の並び → 1 枚ずつ（マイクと同じく 20 ms ごとに、直前の 2048 点を見る） ----
const SR = 48000;
/**
 * notes = [{ midi, t0, t1, amp?, env?(t), vib?: { cents, hz }, amps? }]
 * env は音の始まりからの秒 → 倍率
 */
function render(notes, seconds) {
  const out = new Float32Array(Math.ceil(seconds * SR));
  for (const nt of notes) {
    const amps = nt.amps ?? [0.5, 1, 0.6, 0.4, 0.25, 0.15];
    const amp = nt.amp ?? 0.08;
    const i0 = Math.floor(nt.t0 * SR);
    const i1 = Math.min(out.length, Math.floor((nt.t1 + 0.3) * SR));
    const phases = amps.map((_, k) => k * 0.9);
    for (let i = i0; i < i1; i++) {
      const t = (i - i0) / SR;
      const rel = i / SR - nt.t1;
      let g = Math.min(1, t / 0.006) * (nt.env ? nt.env(t) : Math.exp(-t / 1.5));
      if (rel > 0) g *= Math.exp(-rel / 0.04); // 離したら消える
      const f = hz(nt.midi) * (nt.vib ? 2 ** ((nt.vib.cents / 1200) * Math.sin(2 * Math.PI * nt.vib.hz * t)) : 1);
      let s = 0;
      for (let k = 0; k < amps.length; k++) {
        phases[k] += (2 * Math.PI * f * (k + 1)) / SR;
        s += amps[k] * Math.sin(phases[k]);
      }
      out[i] += amp * g * s;
    }
  }
  return out;
}
function track(signal, tracker = makeNoteTracker(), hop = 0.02, floor = 0.004) {
  const events = [];
  for (let t = N / SR; t <= signal.length / SR; t += hop) {
    const end = Math.floor(t * SR);
    const win = signal.subarray(end - N, end);
    const level = rms(win);
    const p = level >= floor ? detectPitch(win, SR) : null;
    const m = tracker.feed({ t, level, freq: p?.freq ?? null });
    if (m != null) events.push({ m, t });
  }
  return events;
}
const midis = (ev) => ev.map((e) => e.m);

test('伸ばした音は 1 回だけ', () => {
  const ev = track(render([{ midi: 60, t0: 0.1, t1: 1.3 }], 1.8));
  assert.deepEqual(midis(ev), [60]);
  assert.ok(ev[0].t - 0.1 < 0.12, `知らせが遅い: ${ev[0].t}`);
});

test('同じ音の弾き直し（いったん小さくなって、また大きくなる）は 2 回', () => {
  const env = (t) => (t < 0.45 ? Math.exp(-t / 1.5) : t < 0.55 ? 0.12 : 1);
  const ev = track(render([{ midi: 60, t0: 0.1, t1: 1.2, env }], 1.6));
  assert.deepEqual(midis(ev), [60, 60]);
  assert.ok(ev[1].t > 0.64 && ev[1].t < 0.8, `弾き直しの時刻: ${ev[1].t}`);
});

test('ビブラート（±35 セント）と少しの揺れは 1 回', () => {
  const env = (t) => 1 + 0.12 * Math.sin(2 * Math.PI * 5.5 * t + 1); // 大きさの揺れも少し
  for (const m of [45, 60, 76]) {
    const ev = track(render([{ midi: m, t0: 0.1, t1: 1.9, env, vib: { cents: 35, hz: 5.5 } }], 2.2));
    assert.deepEqual(midis(ev), [m], `MIDI ${m}`);
  }
});

test('ド→ミ→ソは順に 3 回（間をあけても、つなげても）', () => {
  const gaps = render([60, 64, 67].map((midi, i) => ({ midi, t0: 0.1 + i * 0.4, t1: 0.1 + i * 0.4 + 0.28 })), 1.6);
  assert.deepEqual(midis(track(gaps)), [60, 64, 67]);
  const legato = render([60, 64, 67].map((midi, i) => ({ midi, t0: 0.1 + i * 0.3, t1: 0.1 + i * 0.3 + 0.3, env: () => 1 })), 1.3);
  assert.deepEqual(midis(track(legato)), [60, 64, 67]);
});

test('すぐ消える音（拍子木のような音とその残り）は数えない', () => {
  const click = (t) => Math.exp(-t / 0.0125);
  const sig = render([{ midi: 85, t0: 0.1, t1: 0.3, env: click, amps: [1, 0, 0.3], amp: 0.3 }, { midi: 72, t0: 0.6, t1: 0.7, env: click, amp: 0.3 }], 1.2);
  assert.deepEqual(midis(track(sig)), []);
});

// ピアノの高い音：はじめの音はすぐ小さくなり、あとに残る音（山の 2 割くらいまで）は弦どうしのずれで「うなり」、
// 打ち消し合うところでは下限を下回ってから、ゆっくり戻る（アイオワ大学のピアノの録音で、ラ5・ミ♭5・ファ6 がこうなる）
const pianoHigh = (t) => 0.8 * Math.exp(-t / 0.08) + 0.2 * Math.exp(-t / 1.5) * Math.abs(Math.cos(2 * Math.PI * 1.4 * t + 0.4));

test('ピアノの高い音のうなり（小さくなってはゆっくり戻る・下限を下回ってまた戻る）は 1 回', () => {
  for (const m of [72, 81, 89]) {
    const ev = track(render([{ midi: m, t0: 0.1, t1: 2.2, env: pianoHigh, amp: 0.12 }], 2.6));
    assert.deepEqual(midis(ev), [m], `MIDI ${m}`);
  }
});

test('うなりのあるピアノの音でも、鍵盤を離して弾き直せば 2 回', () => {
  const sig = render([{ midi: 81, t0: 0.1, t1: 0.5, env: pianoHigh, amp: 0.12 }, { midi: 81, t0: 0.6, t1: 1.3, env: pianoHigh, amp: 0.12 }], 1.7);
  assert.deepEqual(midis(track(sig)), [81, 81]);
});

test('ピアノのいちばん上のあたり（0.1 秒たらずで半分になる音）も数える（拍子木の音は数えない）', () => {
  const quick = (t) => Math.exp(-t / 0.07);
  for (const m of [84, 89]) assert.deepEqual(midis(track(render([{ midi: m, t0: 0.1, t1: 0.8, env: quick, amp: 0.2 }], 1.2))), [m], `MIDI ${m}`);
});

test('低い音が鳴っている途中から高い音を弾き、低い音を離しても、高い音を数える', () => {
  // ピアノのように、低い音（ド3）は少しずつ小さくなり、高い音（ファ6）を弾いた 60 ms あとに離す
  const quick = (t) => Math.exp(-t / 0.07);
  const piano = (t) => Math.exp(-t / 0.4);
  for (const [lo, hi] of [[48, 89], [43, 84], [55, 81]]) {
    const sig = render([{ midi: lo, t0: 0.1, t1: 0.66, env: piano, amp: 0.12 }, { midi: hi, t0: 0.6, t1: 1.2, env: quick, amp: 0.2 }], 1.5);
    assert.deepEqual(midis(track(sig)), [lo, hi], `${lo} → ${hi}`);
  }
});

test('reset(true) のあとは、鳴り続けている音を新しい音と数えない', () => {
  const sig = render([{ midi: 60, t0: 0.1, t1: 1.0, env: () => 1 }, { midi: 64, t0: 1.0, t1: 1.4, env: () => 1 }], 1.8);
  const tr = makeNoteTracker();
  const ev = [];
  for (let t = N / SR; t <= sig.length / SR; t += 0.02) {
    const end = Math.floor(t * SR);
    const win = sig.subarray(end - N, end);
    if (t < 0.5) {
      tr.reset(true); // アプリの音が鳴っているあいだ
      continue;
    }
    const p = detectPitch(win, SR);
    const m = tr.feed({ t, level: rms(win), freq: p?.freq ?? null });
    if (m != null) ev.push(m);
  }
  assert.deepEqual(ev, [64]);
});

// ---- マイクの感度 ----
/** 感度の段を選んだときのマイクと同じ（下限より小さい枚は高さを調べない・音の区切りも同じ下限） */
const trackAt = (signal, step) => track(signal, makeNoteTracker(sensTracker(step)), 0.02, sensFloor(step));
const scaled = (sig, k) => sig.map((x) => x * k);
const RENDER_RMS = 0.08 * Math.sqrt([0.5, 1, 0.6, 0.4, 0.25, 0.15].reduce((a, x) => a + x * x, 0) / 2); // render の amp 0.08 の大きさ

test('感度「ふつう」は今までと同じ（下限 0.004・音の区切りの決まりも同じ）。知らない段もふつう', () => {
  assert.equal(MIC_FLOOR, 0.004);
  assert.equal(sensFloor(3), 0.004);
  assert.deepEqual(sensTracker(3), { minLevel: 0.004 });
  assert.equal(micSens(3).name, 'ふつう');
  for (const bad of [undefined, null, 0, 6, '3', 2.5]) assert.equal(micSens(bad), micSens(3), String(bad));
  const sigs = [
    render([60, 64, 67].map((midi, i) => ({ midi, t0: 0.1 + i * 0.4, t1: 0.1 + i * 0.4 + 0.28 })), 1.6),
    render([{ midi: 60, t0: 0.1, t1: 1.2, env: (t) => (t < 0.45 ? Math.exp(-t / 1.5) : t < 0.55 ? 0.12 : 1) }], 1.6),
    render([{ midi: 85, t0: 0.1, t1: 0.3, env: (t) => Math.exp(-t / 0.0125), amps: [1, 0, 0.3], amp: 0.3 }, { midi: 60, t0: 0.6, t1: 1.4 }], 1.8),
  ];
  for (const sig of sigs) assert.deepEqual(trackAt(sig, 3), track(sig));
});

test('感度の段：1 段で下限が 5 dB ずつ、高い段ほど小さい音を拾う', () => {
  assert.deepEqual(MIC_SENS.map((x) => x.id), [1, 2, 3, 4, 5]);
  assert.equal(new Set(MIC_SENS.map((x) => x.label)).size, 5);
  for (let i = 1; i < MIC_SENS.length; i++) {
    const r = sensFloor(MIC_SENS[i - 1].id) / sensFloor(MIC_SENS[i].id);
    assert.ok(Math.abs(r - 10 ** (5 / 20)) < 1e-9, `段 ${i}→${i + 1}: ${r}`);
  }
  assert.ok(Math.abs(sensFloor(1) / MIC_FLOOR - 3.1623) < 1e-3);
  assert.ok(Math.abs(sensFloor(5) / MIC_FLOOR - 0.31623) < 1e-4);
  // どの段の下限も、設定画面のメーター（-60〜0 dB）の中
  for (const s of MIC_SENS) assert.ok(sensFloor(s.id) > 0.001 && sensFloor(s.id) < 1, s.name);
});

test('下限の倍率と同じだけ大きく（小さく）した音は、どの段でも「ふつう」と同じに区切れる', () => {
  // 間をあけた音・つなげた音・弾き直し・同じ音のくり返し・すぐ消える音。無音で止む・弾き直しの数え直しが、どの下限でも同じに働く
  const sigs = [
    render([60, 64, 67].map((midi, i) => ({ midi, t0: 0.1 + i * 0.4, t1: 0.1 + i * 0.4 + 0.28 })), 1.6),
    render([60, 64, 67].map((midi, i) => ({ midi, t0: 0.1 + i * 0.3, t1: 0.1 + i * 0.3 + 0.3, env: () => 1 })), 1.3),
    render([{ midi: 60, t0: 0.1, t1: 1.2, env: (t) => (t < 0.45 ? Math.exp(-t / 1.5) : t < 0.55 ? 0.12 : 1) }], 1.6),
    render([0, 1, 2].map((i) => ({ midi: 62, t0: 0.1 + i * 0.5, t1: 0.1 + i * 0.5 + 0.25 })), 1.8),
    render([{ midi: 85, t0: 0.1, t1: 0.3, env: (t) => Math.exp(-t / 0.0125), amps: [1, 0, 0.3], amp: 0.3 }, { midi: 72, t0: 0.6, t1: 0.7, env: (t) => Math.exp(-t / 0.0125), amp: 0.3 }], 1.2),
  ];
  for (const sig of sigs) {
    const want = track(sig);
    for (const s of MIC_SENS) {
      assert.deepEqual(trackAt(scaled(sig, sensFloor(s.id) / MIC_FLOOR), s.id), want, `${s.name}: ${midis(want)}`);
    }
  }
});

test('感度を低くすると小さな音を聞かず、高くすると「ふつう」で聞こえない小さな音も聞く', () => {
  const at = (rmsLevel) => render([{ midi: 60, t0: 0.1, t1: 1.0, env: () => 1, amp: (0.08 * rmsLevel) / RENDER_RMS }], 1.4);
  const soft = at(0.008); // ふつうの下限の 2 倍
  assert.deepEqual(midis(trackAt(soft, 3)), [60]);
  assert.deepEqual(midis(trackAt(soft, 2)), [60]);
  assert.deepEqual(midis(trackAt(soft, 1)), []);
  const faint = at(0.003); // ふつうの下限より小さい
  assert.deepEqual(midis(trackAt(faint, 3)), []);
  assert.deepEqual(midis(trackAt(faint, 4)), [60]);
  assert.deepEqual(midis(trackAt(faint, 5)), [60]);
});

test('ざわざわした部屋：測った周りの音で選んだ段なら、雑音は音にならず、弾き終わると無音で止む', () => {
  const rng = makeRng(11);
  const noise = (sec, r) => Float32Array.from({ length: Math.ceil(sec * SR) }, () => (rng.next() * 2 - 1) * r * Math.sqrt(3));
  const levelsOf = (sig) => {
    const out = [];
    for (let t = N / SR; t <= sig.length / SR; t += 0.02) out.push(rms(sig.subarray(Math.floor(t * SR) - N, Math.floor(t * SR))));
    return out;
  };
  // 周りの音 0.003（ふつうの下限 0.004 に近い）を 2 秒測る → ふつうでは近すぎるので「低い」
  const room = noise(2.1, 0.003);
  const pick = pickSens(levelsOf(room));
  assert.equal(pick.step, 2);
  assert.ok(pick.ok);
  assert.ok(Math.abs(pick.room - 0.003) < 0.0003, `周りの音: ${pick.room}`);
  assert.deepEqual(trackAt(room, pick.step), []);
  // 同じ音を 3 回。音と音のあいだは周りの音だけになる
  const notes = render([0, 1, 2].map((i) => ({ midi: 60, t0: 0.1 + i * 0.6, t1: 0.1 + i * 0.6 + 0.3, env: () => 1 })), 2.1);
  const sig = noise(2.1, 0.003).map((x, i) => x + notes[i]);
  const tr = makeNoteTracker(sensTracker(pick.step));
  const floor = sensFloor(pick.step);
  const ev = [];
  const held = new Map();
  for (let t = N / SR; t <= sig.length / SR; t += 0.02) {
    const end = Math.floor(t * SR);
    const win = sig.subarray(end - N, end);
    const level = rms(win);
    const p = level >= floor ? detectPitch(win, SR) : null;
    const m = tr.feed({ t, level, freq: p?.freq ?? null });
    if (m != null) ev.push(m);
    held.set(Math.round(t * 50), tr.note);
  }
  assert.deepEqual(ev, [60, 60, 60]);
  // 離して 0.25 秒後（次の音の前）には、もう止んでいる
  for (const i of [0, 1]) assert.equal(held.get(Math.round((0.1 + i * 0.6 + 0.3 + 0.25) * 50)), null, `${i + 1} つめの音のあと`);
});

test('周りの音を測って選ぶ：下限が周りの音の 2 倍以上ある段のうち、いちばん感度の高い段', () => {
  const flat = (x, n = 100) => Array(n).fill(x);
  assert.deepEqual(pickSens(flat(0.0005)), { step: 5, room: 0.0005, ok: true }); // とても静か
  assert.equal(pickSens(flat(0.0011)).step, 4); // 2 倍 0.0022 ≤ 0.00225
  assert.equal(pickSens(flat(0.0015)).step, 3); // ふつう
  assert.equal(pickSens(flat(0.002)).step, 3); // 2 倍がちょうど 0.004 でもふつう
  assert.equal(pickSens(flat(0.003)).step, 2);
  assert.equal(pickSens(flat(0.005)).step, 1);
  // いちばん低い段でも足りない：いちばん低い段で ok: false
  assert.deepEqual(pickSens(flat(0.007)), { step: 1, room: 0.007, ok: false });
  assert.deepEqual(pickSens(flat(0.2)), { step: 1, room: 0.2, ok: false });
  // ときどきの物音（1 割まで）では下げない。1 割を超えて続く音は数える
  const bumps = (k) => [...flat(0.0005, 100 - k), ...flat(0.05, k)];
  assert.equal(pickSens(bumps(10)).step, 5);
  assert.equal(pickSens(bumps(11)).step, 1);
  assert.equal(pickSens(bumps(11)).ok, false);
  // 並び順によらない
  assert.deepEqual(pickSens(bumps(10).reverse()), pickSens(bumps(10)));
  // 測れた枚数が少なすぎる・壊れた値
  assert.equal(pickSens([]), null);
  assert.equal(pickSens(null), null);
  assert.equal(pickSens(flat(0.001, 24)), null);
  assert.equal(pickSens([...flat(0.001, 24), NaN, -1, Infinity]), null);
  assert.equal(pickSens(flat(0.001, 25)).step, 4);
  // どんな部屋でも：選んだ段の下限は 2 倍以上、ひとつ感度の高い段の下限は 2 倍より小さい
  const rng = makeRng(3);
  for (let k = 0; k < 300; k++) {
    const base = 10 ** (-4 + rng.next() * 2.5);
    const r = pickSens(Array.from({ length: 100 }, () => base * (0.5 + rng.next())));
    if (r.ok) {
      assert.ok(sensFloor(r.step) >= 2 * r.room);
      if (r.step < 5) assert.ok(sensFloor(r.step + 1) < 2 * r.room);
    } else {
      assert.ok(sensFloor(1) < 2 * r.room);
    }
  }
});
