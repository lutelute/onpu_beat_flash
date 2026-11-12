// MIDI 鍵盤（Web MIDI。Chrome・Edge など）。いま答えを待っている入力 1 つにだけ音を渡す
// マイクで聞き取った音も emitNote で同じところへ渡るので、onMidiNote の受け手はどちらも区別しない
let access = null;
let target = null;
const listeners = new Set(); // つながり具合が変わったら知らせる先

export const midiSupported = () => typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess;

/** 鳴った音（MIDI 番号）を、いま答えを待っている入力へ渡す。マイク（mic.js）もここを通す */
export function emitNote(midi) {
  target?.(midi);
}

function onMessage(e) {
  const [status, note, vel] = e.data;
  if ((status & 0xf0) === 0x90 && vel > 0) emitNote(note);
}
function attach() {
  if (!access) return;
  for (const input of access.inputs.values()) input.onmidimessage = onMessage;
  for (const fn of listeners) fn(midiStatus());
}

/** MIDI を使う・やめる。戻り値は midiStatus() */
export async function enableMidi(on) {
  if (!on) {
    if (access) for (const input of access.inputs.values()) input.onmidimessage = null;
    access = null;
    attach();
    for (const fn of listeners) fn(midiStatus());
    return midiStatus();
  }
  if (!midiSupported()) return midiStatus();
  try {
    access = await navigator.requestMIDIAccess();
    access.onstatechange = attach;
    attach();
  } catch {
    access = null;
  }
  for (const fn of listeners) fn(midiStatus());
  return midiStatus();
}

/** iPhone・iPad か（iPad の Safari は Mac のふりをするので、触れる画面の Mac も iPad とみなす） */
const isIOS = () =>
  typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export function midiStatus() {
  if (!midiSupported()) {
    return isIOS()
      ? { state: 'unsupported', text: 'iPhone・iPad では MIDI 鍵盤は使えません（どのブラウザも Safari と同じしくみで、MIDI に対応していません）。マイクで答えられます' }
      : { state: 'unsupported', text: 'このブラウザは MIDI に対応していません（Chrome・Edge で使えます）' };
  }
  if (!access) return { state: 'off', text: '' };
  const names = [...access.inputs.values()].map((i) => i.name).filter(Boolean);
  return names.length
    ? { state: 'on', text: `つながっている鍵盤: ${names.join('、')}。押すと、下に受け取った音が出ます` }
    : { state: 'none', text: '鍵盤が見つかりません。USB（または Bluetooth）でつなげば、そのまま使えるようになります' };
}

export function onMidiStatus(fn, life) {
  listeners.add(fn);
  life?.signal.addEventListener('abort', () => listeners.delete(fn), { once: true });
}

/** 画面の場面（life）が続くあいだ、鍵盤（とマイク）の音を fn(midi) に渡す */
export function onMidiNote(life, fn) {
  target = fn;
  life.signal.addEventListener('abort', () => { if (target === fn) target = null; }, { once: true });
}
