// 設定：音名の呼び方・音・明るさ・MIDI・マイク（どのゲームにも効く）
import { h } from '../ui/dom.js';
import { settingsForm } from '../ui/form.js';
import { globalSettings, setGlobal } from '../core/store.js';
import { globalFields } from '../core/globals.js';
import { setVolume, playEvents } from '../render/audio.js';
import { applyTheme } from '../ui/theme.js';
import { enableMidi, midiStatus, onMidiStatus, onMidiNote } from '../ui/midi.js';
import { enableMic, micStatus, onMicStatus, onMicLevel, micFloor, measureRoom } from '../ui/mic.js';
import { midiLabel } from '../core/music.js';
import { pickSens, micSens } from '../core/pitch.js';

export function mountSettings(root, { life }) {
  const midiLine = h('div', { class: 'field-note midi-status', 'aria-live': 'polite' });
  // 鍵盤を押すと、受け取った音をここに出す（つないだ鍵盤がちゃんと届いているか確かめる用）
  const midiNote = h('div', { class: 'field-note midi-note', hidden: true });
  const showMidi = (st) => {
    midiLine.textContent = globalSettings().midi ? st.text : '';
    if (!globalSettings().midi) midiNote.hidden = true;
  };
  showMidi(midiStatus());
  onMidiStatus(showMidi, life);
  onMidiNote(life, (m) => {
    if (!globalSettings().midi && !globalSettings().mic) return;
    midiNote.hidden = false;
    midiNote.textContent = `受け取った音: ${midiLabel(m, globalSettings().naming)}（MIDI ${m}）`;
  });
  const onChange = (v) => {
    const old = { ...globalSettings() };
    setGlobal(v);
    setVolume(v.volume);
    if (v.volume !== old.volume) playEvents([{ midi: [60, 64, 67], t: 0, d: 0.6 }]);
    if (v.theme !== old.theme) applyTheme(v.theme);
    if (v.midi !== old.midi) enableMidi(v.midi).then(showMidi);
    if (v.mic !== old.mic) enableMic(v.mic).then(mic.show);
    if (v.micSens !== old.micSens) mic.said('');
  };
  const makeForm = () => settingsForm({ fields: globalFields, values: globalSettings(), onChange });
  let form = makeForm();
  // 「周りの音を測る」で感度を選んだ：保存して、設定の札も選び直した形で作り直す
  const mic = micPanel(life, (step) => {
    setGlobal({ micSens: step });
    const fresh = makeForm();
    form.replaceWith(fresh);
    form = fresh;
  });
  root.replaceChildren(
    h('section', { class: 'card' },
      form,
      midiLine,
      midiNote,
      mic.el),
    h('p', { class: 'field-note center' }, 'ゲームごとの設定（音部記号・範囲・速さなど）は、それぞれのゲームの始める前の画面で変えられます。'),
  );
}

/**
 * マイクのつながり具合と、聞こえている大きさ・音（ちゃんと聞こえているか確かめる用）
 * 音はゲームが受け取る高さで出る（ギター・コントラバスを選んでいれば、鳴った音の 1 オクターブ上）
 * 「周りの音を測る」で感度を選んだら onPick(段) を呼ぶ
 */
function micPanel(life, onPick) {
  const line = h('div', { class: 'field-note mic-status', 'aria-live': 'polite' });
  // 大きさは -60 dB〜0 dB を 0〜100% で。縦の線が聞き取る下限（感度で動く）
  const pos = (level) => {
    const db = level > 0 ? 20 * Math.log10(level) : -60;
    return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  };
  const bar = h('span', { class: 'mic-bar' });
  const floorLine = h('span', { class: 'mic-floor' });
  const note = h('span', { class: 'mic-note' }, '—'); // 最初の知らせ（20 ms 後）までも「聞こえていない」の印
  const meter = h('div', { class: 'mic-meter', hidden: true },
    h('span', { class: 'mic-track', 'aria-hidden': 'true' }, bar, floorLine),
    note);
  let floor = null;
  const setFloor = (f) => {
    if (f === floor) return;
    floor = f;
    floorLine.style.left = `${pos(f)}%`;
  };
  setFloor(micFloor());

  // 周りの音を測って感度を選ぶ（2 秒ほど。アプリの音が鳴っているあいだは数えない）
  const said = h('div', { class: 'field-note mic-calib-said', 'aria-live': 'polite' });
  const say = (text) => {
    said.textContent = text;
  };
  const calib = h('button', {
    type: 'button', class: 'btn small',
    onclick: async () => {
      calib.disabled = true;
      say('周りの音を測っています。2 秒ほど音を出さずに待ってください…');
      const r = pickSens(await measureRoom());
      calib.disabled = false;
      if (!life.alive) return;
      if (!globalSettings().mic) return say('');
      if (!r) return say('うまく測れませんでした。もう一度押してください');
      onPick(r.step);
      const name = micSens(r.step).name;
      say(r.ok
        ? `周りの音に合わせて『${name}』にしました`
        : `周りの音が大きく、いちばん低い『${name}』でも拾ってしまうかもしれません。マイクの近くで弾く（歌う）か、マイクつきのイヤホンを使ってみてください`);
    },
  }, '周りの音を測る');
  const calibRow = h('div', { class: 'mic-calib', hidden: true }, calib, said);

  const show = (st) => {
    const on = globalSettings().mic;
    line.textContent = on ? st.text : '';
    const working = on && st.state === 'on';
    meter.hidden = !working;
    calibRow.hidden = !working;
    if (!working) say('');
  };
  let shown = '—';
  onMicLevel(({ level, midi, gated, floor: f }) => {
    setFloor(f);
    bar.style.width = `${pos(level)}%`;
    meter.classList.toggle('loud', level >= f);
    meter.classList.toggle('heard', midi != null);
    meter.classList.toggle('gated', gated);
    const text = gated ? 'アプリの音' : midi != null ? midiLabel(midi, globalSettings().naming) : '—';
    if (text !== shown) note.textContent = shown = text;
  }, life);
  show(micStatus());
  onMicStatus(show, life);
  return { el: h('div', {}, line, meter, calibRow), show, said: say };
}
