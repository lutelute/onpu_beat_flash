// マイク（楽器・声）で答える。聞こえた音の高さを MIDI 番号にして、MIDI 鍵盤と同じ道（emitNote）で渡す
//   ・アプリ自身の音（問題の音・答え合わせの音・効果音）が鳴っているあいだは聞かない（audioQuietAt）
//   ・雑音消し・自動の音量合わせ・エコー消しは切る（伸ばした楽器の音を雑音として消してしまうため）
//   ・20 ms ごとに、直前の 2048 点（約 43 ms）の波形を見る。高さの当て方は core/pitch.js
//   ・設定で楽器を選ぶと、その音域だけを聞く。ギターとコントラバス・ベースは 1 オクターブ上げて（楽譜に書く高さで）渡す
//   ・設定の「マイクの感度」で、無音とみなす下限が 5 段に変わる（core/pitch.js の MIC_SENS）
import { ensureAudio, audioNow, audioQuietAt } from '../render/audio.js';
import { emitNote } from './midi.js';
import { globalSettings } from '../core/store.js';
import { midiLabel } from '../core/music.js';
import { rms, detectPitch, makeNoteTracker, micInstrument, writtenNote, MIC_FLOOR, sensFloor, micTracker } from '../core/pitch.js';

const POLL_MS = 20;
// 感度「ふつう」の下限（今までの値）。いまの下限は micFloor()。これより小さい音は無音とみなす（高さも調べない）
export const MIC_MIN_LEVEL = MIC_FLOOR;

let stream = null;
let nodes = null; // { ac, source, analyser, sink, buf, bytes }
let timer = 0;
let opening = null; // 許可を待っているあいだの Promise
let wanted = false;
let state = 'off'; // off | on | denied | error
let why = '';
let label = '';
let sens = globalSettings().micSens; // いまの音の区切り（tracker）を作ったときの感度
let inst = globalSettings().micInstrument; // 同じく楽器（声は落ち着くまで少し長く待つ）
let tracker = makeNoteTracker(micTracker(sens, inst));
let measure = null; // 周りの音を測っているあいだ { levels, need, done }
let lostHidden = false; // 裏に回っているあいだにマイクが切れた（iPhone・iPad）
let zeroSince = null; // マイクから届く波形が 0 ばかりになった時刻（OS でマイクが切られている・音の出ない機器を選んでいる）
const NO_SIGNAL_SEC = 1.5;
const statusFns = new Set();
const levelFns = new Set();
const deviceFns = new Set();

/** いまの感度の下限（rms）。これより小さい音は無音とみなす */
export const micFloor = () => sensFloor(globalSettings().micSens);

export const micSupported = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);

export function micStatus() {
  if (!micSupported()) {
    return typeof window !== 'undefined' && window.isSecureContext === false
      ? { state: 'unsupported', text: 'マイクは https のページでだけ使えます' }
      : { state: 'unsupported', text: 'このブラウザではマイクが使えません' };
  }
  if (state === 'on') return { state, text: `マイクで聞いています${label ? `（${label}）` : ''}` };
  if (state === 'denied') {
    return { state, text: 'マイクが許可されていません。アドレス欄のそばにあるサイトの設定から、このページのマイクを許可してください。Mac では、システム設定の「プライバシーとセキュリティ」→「マイク」で、このブラウザもオンにしてください' };
  }
  if (state === 'error') return { state, text: why || 'マイクを使えませんでした' };
  return { state: 'off', text: opening ? 'マイクの使用を許可してください…' : '' };
}

const notify = () => {
  const st = micStatus();
  for (const fn of statusFns) fn(st);
};

/** マイクを使う・やめる。戻り値は micStatus() */
export async function enableMic(on) {
  wanted = !!on;
  if (!on) {
    close();
    state = 'off';
    notify();
    return micStatus();
  }
  if (!micSupported() || stream) return micStatus();
  opening ??= open().finally(() => {
    opening = null;
    notify();
  });
  notify();
  await opening;
  return micStatus();
}

async function open() {
  const ac = ensureAudio();
  if (!ac) {
    state = 'error';
    why = 'このブラウザでは音を扱えません';
    return;
  }
  let s;
  // 選んだマイクがあれば、それを使う（見つからなければ、いつものマイクに戻す）
  const pick = globalSettings().micDevice;
  const ask = (id) => navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, ...(id ? { deviceId: { exact: id } } : {}) },
    video: false,
  });
  try {
    try {
      s = await ask(pick);
    } catch (e) {
      if (!pick || !['OverconstrainedError', 'NotFoundError'].includes(e?.name)) throw e;
      s = await ask('');
    }
  } catch (e) {
    const name = e?.name || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') state = 'denied';
    else {
      state = 'error';
      why = name === 'NotFoundError' || name === 'OverconstrainedError'
        ? 'マイクが見つかりません'
        : name === 'NotReadableError' || name === 'AbortError'
          ? 'マイクを開けませんでした（ほかのアプリが使っているかもしれません）'
          : 'マイクを使えませんでした';
    }
    return;
  }
  if (!wanted) {
    // 許可を待つあいだにオフにされた
    for (const t of s.getTracks()) t.stop();
    return;
  }
  start(ac, s);
}

function start(ac, s) {
  stream = s;
  const source = ac.createMediaStreamSource(s);
  const analyser = ac.createAnalyser();
  analyser.fftSize = ac.sampleRate > 64000 ? 4096 : 2048; // どちらも約 43 ms
  analyser.smoothingTimeConstant = 0;
  // 出口までつながっていないと波形が流れないブラウザがあるので、音量 0 で出口へ（スピーカーからは鳴らない）
  const sink = ac.createGain();
  sink.gain.value = 0;
  source.connect(analyser);
  analyser.connect(sink).connect(ac.destination);
  nodes = { ac, source, analyser, sink, buf: new Float32Array(analyser.fftSize), bytes: null };
  sens = globalSettings().micSens;
  inst = globalSettings().micInstrument;
  tracker = makeNoteTracker(micTracker(sens, inst));
  const track = s.getAudioTracks()[0];
  label = track?.label || '';
  track?.addEventListener('ended', () => {
    if (stream !== s) return;
    close();
    // iPhone・iPad は、ほかのアプリに切り替えるとマイクを切ることがある。そのときは戻ってきたらつなぎ直す
    lostHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    state = 'error';
    why = lostHidden ? 'マイクが切れました。この画面に戻ると、つなぎ直します' : 'マイクが外れました。つなぎ直してから、もう一度オンにしてください';
    notify();
  });
  timer = setInterval(poll, POLL_MS);
  state = 'on';
  why = '';
}

function close() {
  clearInterval(timer);
  timer = 0;
  if (nodes) {
    try {
      nodes.source.disconnect();
      nodes.sink.disconnect();
    } catch {
      /* 外し済み */
    }
    nodes = null;
  }
  if (stream) for (const t of stream.getTracks()) t.stop();
  stream = null;
  label = '';
  zeroSince = null;
  tracker.reset();
  measure?.done();
  sendLevel(0, null, false);
}

/** extra：paused（ブラウザが音を止めている。画面に触れると動く）・noSignal（マイクから音がまったく届かない） */
function sendLevel(level, midi, gated, extra = {}) {
  if (!levelFns.size) return;
  const info = { level, midi, gated, floor: sensFloor(sens), paused: false, noSignal: false, ...extra };
  for (const fn of levelFns) fn(info);
}

/**
 * 聞こえ方の一言（設定のメーターと、ゲーム中のマイクの印で使う）
 * @param info onMicLevel で受け取ったもの
 * @returns {{ kind: string, short: string, long: string }} kind：paused・nosignal・gated・heard・loud・quiet
 */
export function hearing(info, naming) {
  if (info.paused) return { kind: 'paused', short: '止', long: '音が止まっています。画面のどこかをクリック（タップ）すると聞き始めます' };
  if (info.noSignal) {
    return {
      kind: 'nosignal', short: '無音',
      long: 'マイクから音がまったく届いていません。設定の画面の「使うマイク」で別のマイク（MacBook のマイクなど）を選んでみてください。Mac なら、システム設定の「プライバシーとセキュリティ」→「マイク」でこのブラウザがオンかも確かめてください',
    };
  }
  if (info.gated) return { kind: 'gated', short: '待', long: 'アプリの音が鳴っているあいだは聞きません' };
  if (info.midi != null) {
    const name = midiLabel(info.midi, naming);
    return { kind: 'heard', short: name, long: `${name} が聞こえています` };
  }
  if (info.level >= info.floor) return { kind: 'loud', short: '♪', long: '音は聞こえています。高さを調べています（同じ高さで少し伸ばしてください）' };
  return { kind: 'quiet', short: '—', long: '静かです。弾くか歌うと、ここに音名が出ます' };
}

function poll() {
  if (!nodes) return;
  const g = globalSettings();
  if (g.micSens !== sens || g.micInstrument !== inst) {
    // 感度か楽器が変わった。音の区切りを作り直す。鳴っている途中で変えても、その音を新しい音と数えない
    sens = g.micSens;
    inst = g.micInstrument;
    tracker = makeNoteTracker(micTracker(sens, inst));
    tracker.reset(true);
  }
  const { ac, analyser, buf } = nodes;
  if (ac.state !== 'running') return sendLevel(0, null, false, { paused: true }); // 画面に触れるまで音は動かない
  if (analyser.getFloatTimeDomainData) analyser.getFloatTimeDomainData(buf);
  else {
    // 古い Safari
    nodes.bytes ??= new Uint8Array(buf.length);
    analyser.getByteTimeDomainData(nodes.bytes);
    for (let i = 0; i < buf.length; i++) buf[i] = (nodes.bytes[i] - 128) / 128;
  }
  const t = audioNow();
  const level = rms(buf);
  // 波形が 0 ばかり（どんな静かな部屋でも、マイクには少しは音が入る）
  if (level < 1e-6) zeroSince ??= t;
  else zeroSince = null;
  const noSignal = zeroSince != null && t - zeroSince >= NO_SIGNAL_SEC;
  const quiet = t >= audioQuietAt();
  // 周りの音を測っているあいだは、アプリの音が鳴っていない枚だけを集める（イヤホンでも、もれた音を数えないように）
  if (measure && quiet) {
    measure.levels.push(level);
    if (measure.levels.length >= measure.need) measure.done();
  }
  // イヤホンで聞いているときは、アプリの音がマイクに入らないので止めない
  if (!quiet && !g.micPhones) {
    // アプリの音が鳴っている。鳴り終わったときに残っている音（その残りや、伸ばしたままの音）も新しい音と数えない
    tracker.reset(true);
    return sendLevel(level, null, true, { noSignal });
  }
  // 選んだ楽器の音域（minFreq・maxFreq）の中だけで当てる。ゲームと設定画面には楽譜に書く高さで渡す
  const p = level >= sensFloor(sens) ? detectPitch(buf, ac.sampleRate, micInstrument(g.micInstrument)) : null;
  const m = tracker.feed({ t, level, freq: p ? p.freq : null });
  if (m != null) emitNote(writtenNote(m, g.micInstrument));
  sendLevel(level, writtenNote(tracker.note, g.micInstrument), false, { noSignal });
}

// 裏に回っているあいだにマイクが切れたら、戻ってきたときにつなぎ直す
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !wanted || stream || !lostHidden) return;
    lostHidden = false;
    enableMic(true);
  });
}

/** 使えるマイクの一覧 [{ id, label }]（マイクを許可したあとでないと、名前が分からないことがある） */
export async function listMics() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const ds = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  return ds.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || `マイク ${i + 1}` }));
}

/** いま聞いているマイクの id（聞いていなければ ''） */
export function micDeviceId() {
  return stream?.getAudioTracks()[0]?.getSettings?.().deviceId ?? '';
}

/** 使うマイクを変えたとき：聞いているなら、つなぎ直す */
export async function reopenMic() {
  if (!wanted) return micStatus();
  close();
  state = 'off';
  notify();
  return enableMic(true);
}

/** マイクの抜き差しなどで、使えるマイクが変わったら fn() */
export function onMicDevices(fn, life) {
  deviceFns.add(fn);
  life?.signal.addEventListener('abort', () => deviceFns.delete(fn), { once: true });
}
if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    for (const fn of [...deviceFns]) fn();
  });
}

export function onMicStatus(fn, life) {
  statusFns.add(fn);
  life?.signal.addEventListener('abort', () => statusFns.delete(fn), { once: true });
}

/**
 * 聞こえている大きさと音（設定画面の確かめ用）
 * fn({ level: 0〜1, midi: ゲームに渡す MIDI 番号か null, gated: アプリの音で止めているか, floor: いまの感度の下限 })
 */
export function onMicLevel(fn, life) {
  levelFns.add(fn);
  life?.signal.addEventListener('abort', () => levelFns.delete(fn), { once: true });
}

/**
 * 周りの音の大きさを測る（設定の「周りの音を測る」）。アプリの音が鳴っていないあいだの 1 枚ごとの大きさを、
 * ms ミリ秒ぶん（20 ms ごとに 1 枚）集める。アプリの音のあいだは数えず、長くても limit ミリ秒で切り上げる
 * 選び方は core/pitch.js の pickSens
 * @returns {Promise<number[]>} 大きさ（rms）の並び。マイクを使っていなければ空
 */
export function measureRoom(ms = 2000, limit = 6000) {
  measure?.done(); // 前の測りかけは、そこまでで終わり
  if (!nodes) return Promise.resolve([]);
  return new Promise((resolve) => {
    const m = { levels: [], need: Math.round(ms / POLL_MS), done: null };
    const until = setTimeout(() => m.done(), limit);
    m.done = () => {
      clearTimeout(until);
      if (measure === m) measure = null;
      resolve(m.levels);
    };
    measure = m;
  });
}
