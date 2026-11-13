// ベンチマークの録音の一部を、20 ms ごとに追う（大きさ・高さ・はっきり具合・鳴っている音・知らせ）
//   node scripts/mic-bench/trace.mjs <組（cello など）> <ファイル名の一部> <から秒> <まで秒> [楽器]
import { SETS } from './manifest.mjs';
import { prepare, SR, N } from './lib.mjs';
import { rms, detectPitch, freqToMidi, makeNoteTracker, micInstrument, micTracker, sensFloor } from '../../src/core/pitch.js';

const [setId, part, from = '0', to = '999', instArg] = process.argv.slice(2);
const set = SETS.find((s) => s.id === setId);
const file = set.files.find((f) => f.includes(part));
const inst = instArg ?? set.inst;
const x = prepare(set, file);
const tracker = makeNoteTracker(micTracker(3, inst));
const spec = micInstrument(inst);
console.log(file, inst);
for (let end = N; end <= x.length; end += Math.round(SR * 0.02)) {
  const t = end / SR;
  const buf = x.subarray(end - N, end);
  const level = rms(buf);
  const p = level >= sensFloor(3) ? detectPitch(buf, SR, spec) : null;
  const before = tracker.note;
  const m = tracker.feed({ t, level, freq: p ? p.freq : null });
  if (t >= +from && t <= +to) {
    console.log(`${t.toFixed(2)} lv ${level.toFixed(4)} midi ${p ? freqToMidi(p.freq).toFixed(2) : '  -  '} cl ${p ? p.clarity.toFixed(2) : ' -  '} ${before ?? '-'}→${tracker.note ?? '-'}${m != null ? `  ★ ${m}` : ''}`);
  }
}
