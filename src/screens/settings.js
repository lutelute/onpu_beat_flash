// 設定：音名の呼び方・音・明るさ・MIDI・マイク（どのゲームにも効く）
import { h } from '../ui/dom.js';
import { settingsForm } from '../ui/form.js';
import { globalSettings, setGlobal } from '../core/store.js';
import { globalFields } from '../core/globals.js';
import { setVolume, playEvents } from '../render/audio.js';
import { applyTheme } from '../ui/theme.js';
import { enableMidi, midiStatus, onMidiStatus, onMidiNote } from '../ui/midi.js';
import { enableMic, micStatus, onMicStatus, onMicLevel, micFloor, measureRoom, hearing, listMics, micDeviceId, reopenMic, onMicDevices } from '../ui/mic.js';
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
    if (!globalSettings().midi) return; // マイクで聞こえた音は、マイクの項目の下のメーターに出る
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
  // 「周りの音を測る」で感度を選んだ：保存して、設定の札も選び直した形で作り直す
  const mic = micPanel(life, (step) => {
    setGlobal({ micSens: step });
    const fresh = makeForm();
    form.replaceWith(fresh);
    form = fresh;
  });
  // MIDI とマイクの様子は、それぞれをオンにする項目のすぐ下に出す（オンにしたところで、届いているか分かるように）
  const midiBox = h('div', { class: 'device-box' }, midiLine, midiNote);
  const makeForm = () => settingsForm({ fields: globalFields, values: globalSettings(), onChange, after: { midi: midiBox, mic: mic.el } });
  let form = makeForm();
  root.replaceChildren(
    h('section', { class: 'card' },
      form),
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
  // 聞こえ方を言葉で（静か・音が聞こえている・〇〇が聞こえている・音が止まっている・音が届いていない）
  const say2 = h('div', { class: 'field-note mic-say' }, '');
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

  // 使うマイク（Teams などの、ふだんは音の出ない入力が選ばれていると、音がまったく届かない）
  const pickMic = h('select', {
    class: 'mic-device', 'aria-label': '使うマイク',
    onchange: async () => {
      setGlobal({ micDevice: pickMic.value });
      await reopenMic();
      if (life.alive) fillMics();
    },
  });
  const deviceRow = h('label', { class: 'mic-device-row', hidden: true }, h('span', { class: 'field-label' }, '使うマイク'), pickMic);
  async function fillMics() {
    const list = await listMics();
    if (!life.alive) return;
    const saved = globalSettings().micDevice;
    const now = micDeviceId();
    const opts = [{ id: '', label: 'いつものマイク（端末の設定に合わせる）' }, ...list.filter((d) => d.id && d.id !== 'default')];
    pickMic.replaceChildren(...opts.map((d) => h('option', { value: d.id }, d.label)));
    // 選んだマイクが見つからない（外した）ときは「いつもの」を選んだ形に
    pickMic.value = opts.some((d) => d.id === saved) ? saved : '';
    pickMic.title = now ? `いま聞いているマイク: ${list.find((d) => d.id === now)?.label ?? now}` : '';
  }
  onMicDevices(fillMics, life);

  const show = (st) => {
    const on = globalSettings().mic;
    line.textContent = on ? st.text : '';
    const working = on && st.state === 'on';
    meter.hidden = !working;
    say2.hidden = !working;
    calibRow.hidden = !working;
    deviceRow.hidden = !working;
    if (working) fillMics();
    if (!working) say('');
  };
  let shown = '—';
  let told = '';
  onMicLevel((info) => {
    const { level, midi, gated, floor: f } = info;
    setFloor(f);
    bar.style.width = `${pos(level)}%`;
    meter.classList.toggle('loud', level >= f);
    meter.classList.toggle('heard', midi != null);
    meter.classList.toggle('gated', gated);
    const hr = hearing(info, globalSettings().naming);
    meter.dataset.kind = hr.kind;
    const text = gated ? 'アプリの音' : midi != null ? midiLabel(midi, globalSettings().naming) : hr.kind === 'paused' || hr.kind === 'nosignal' ? '音なし' : '—';
    if (text !== shown) note.textContent = shown = text;
    if (hr.long !== told) say2.textContent = told = hr.long;
  }, life);
  show(micStatus());
  onMicStatus(show, life);
  return { el: h('div', {}, line, deviceRow, meter, say2, calibRow), show, said: say };
}
