// 答えの入力（ボタン・鍵盤）。生成器の answerPad(s) が返す PadSpec から作る
//   name7   7 つの音名        id = spec.ids[i]（既定は '0'〜'6'）   キー C D E F G A B(H) / 1〜7
//   piano   鍵盤で高さまで    id = MIDI 番号（spec.black で黒鍵も）  タップ・MIDI 鍵盤
//   chroma  1 オクターブ12音  id = 半音の位置 '0'〜'11'            キー C〜B、Shift で ♯（whiteOnly なら白鍵だけ）
//           grid: true なら鍵盤の形でなく、12 のボタンを 6 列 × 2 段に並べる（スマホで黒鍵が細すぎないように）
//   choices 選択肢            id = options[i].id                    キー 1〜9 0 - =
// どの形でも MIDI 鍵盤の音（handleMidi）で答えられる（choices を除く）

import { h } from './dom.js';
import { NAMINGS, LETTERS, WHITE_PCS, chromaName, letterIndex, octaveOf, sciName, noteName, midiOfStep } from '../core/music.js';

const LETTER_KEYS = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6, h: 6 };
// ドイツ音名では B は B♭、H が B（シ）。B キーは 12 音のときだけ B♭ に当てる
const isGermanB = (naming, k) => naming === 'german' && k === 'b';
const DIGIT_KEYS = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6 };
const CHOICE_KEYS = '1234567890-=';
const MIDDLE_C = 60;

export function makePad(spec, { naming, keyHints, onAnswer }) {
  const buttons = new Map(); // id → button
  let enabled = true;
  let keyOf = () => null; // KeyboardEvent → id
  let midiOf = () => null; // MIDI 番号 → id

  const press = (id) => {
    if (!enabled || !buttons.has(id)) return;
    const b = buttons.get(id);
    b.classList.remove('pressed');
    void b.offsetWidth;
    b.classList.add('pressed');
    onAnswer(id);
  };
  // 鍵盤は横にスクロールできるので、指を離したとき（click）に答える。スクロールしたら click は来ない。
  // ほかは速さが大事なので、触れた瞬間（pointerdown）に答える（CSS の touch-action: none でスクロールにならない）
  const onRelease = spec.type === 'piano';
  const btn = (id, cls, kids, hint, label) => {
    const b = h('button', {
      type: 'button', class: cls, dataset: { id }, 'aria-label': label,
      onpointerdown: onRelease ? null : (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        press(id);
      },
    }, kids, keyHints && hint ? h('kbd', { 'aria-hidden': 'true' }, hint) : null);
    // 鍵盤のタップと、キーボードの Enter/Space で押されたとき（pointerdown を通らない操作）
    b.addEventListener('click', (e) => { if (onRelease || e.detail === 0) press(id); });
    buttons.set(id, b);
    return b;
  };
  const letterHint = (li) => (naming === 'german' && li === 6 ? 'H' : LETTERS[li]);

  let el;
  if (spec.type === 'name7') {
    const names = NAMINGS[naming].names;
    const ids = spec.ids ?? names.map((_, i) => String(i));
    el = h('div', { class: 'pad pad-name7', role: 'group', 'aria-label': '音名' },
      names.map((n, i) => btn(ids[i], 'key', h('span', { class: 'lbl' }, n), letterHint(i), n)));
    keyOf = (e) => {
      const k = e.key.toLowerCase();
      if (isGermanB(naming, k)) return null; // 幹音のボタンに B♭ は無い
      const li = LETTER_KEYS[k] ?? DIGIT_KEYS[k];
      return li == null || e.shiftKey ? null : ids[li];
    };
    // 白鍵の音名に当てる（黒鍵は答えにしない）
    midiOf = (m) => {
      const li = WHITE_PCS.indexOf(m % 12);
      return li < 0 ? null : ids[li];
    };
  } else if (spec.type === 'piano') {
    const whites = [];
    for (let s = spec.lo; s <= spec.hi; s++) whites.push(s);
    const w = 100 / whites.length;
    const keys = whites.map((s) => {
      const midi = midiOfStep(s);
      const isC = letterIndex(s) === 0;
      return btn(String(midi), `wkey${midi === MIDDLE_C ? ' mid' : ''}`, [
        h('span', { class: 'nm' }, noteName(s, naming)),
        isC ? h('span', { class: 'oct' }, sciName(s)) : null,
      ], null, `${noteName(s, naming)} ${sciName(s)}`);
    });
    const blacks = [];
    whites.forEach((s, i) => {
      if (i === whites.length - 1 || ![0, 1, 3, 4, 5].includes(letterIndex(s))) return;
      const style = { left: `${(i + 1) * w - w * 0.3}%`, width: `${w * 0.6}%` };
      if (spec.black) {
        const midi = midiOfStep(s) + 1;
        const b = btn(String(midi), 'bkey', null, null, `${chromaName(midi % 12, naming).replace('\n', '／')} ${octaveOf(s)}`);
        Object.assign(b.style, style);
        blacks.push(b);
      } else blacks.push(h('span', { class: 'bkey deco', style, 'aria-hidden': 'true' }));
    });
    // 鍵は 30px より細くしない。入りきらなければ横にスクロールし、はじめは真ん中を見せる
    const scroller = h('div', { class: 'piano-scroll' }, h('div', { class: 'piano', style: { minWidth: `${whites.length * 30}px` } }, keys, blacks));
    requestAnimationFrame(() => { scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2; });
    el = h('div', { class: 'pad pad-piano', role: 'group', 'aria-label': '鍵盤' },
      scroller,
      h('div', { class: 'piano-note' }, whites.length * 30 > 360 ? '● の付いた鍵が中央のド（C4）。入りきらないときは横にずらせます' : '● の付いた鍵が中央のド（C4）'));
    midiOf = (m) => String(m);
  } else if (spec.type === 'chroma' && spec.grid) {
    // 半音の順に 6 つずつ（ド・ド♯・レ・レ♯・ミ・ファ／ファ♯・ソ・ソ♯・ラ・ラ♯・シ）
    el = h('div', { class: 'pad pad-grid12', role: 'group', 'aria-label': '12の音' },
      Array.from({ length: 12 }, (_, pc) => {
        const li = WHITE_PCS.indexOf(pc);
        const black = li < 0;
        const label = chromaName(pc, naming);
        const hint = black ? (pc === 10 && naming === 'german' ? 'B' : `⇧${letterHint(WHITE_PCS.indexOf(pc - 1))}`) : letterHint(li);
        return btn(String(pc), `key${black ? ' acc' : ''}`, h('span', { class: 'lbl' }, label), hint, label.replace('\n', '／'));
      }));
    keyOf = (e) => {
      const k = e.key.toLowerCase();
      if (isGermanB(naming, k) && !e.shiftKey) return '10';
      const li = LETTER_KEYS[k];
      if (li == null) return null;
      return String((WHITE_PCS[li] + (e.shiftKey ? 1 : 0)) % 12);
    };
    midiOf = (m) => String(m % 12);
  } else if (spec.type === 'chroma') {
    const whites = WHITE_PCS.map((pc, li) =>
      btn(String(pc), 'wkey', h('span', { class: 'nm' }, chromaName(pc, naming)), letterHint(li), chromaName(pc, naming)));
    const blacks = [1, 3, 6, 8, 10].map((pc) => {
      const leftWhite = WHITE_PCS.indexOf(pc - 1); // すぐ左の白鍵
      if (spec.whiteOnly) {
        // 白鍵だけで答えるときの黒鍵は飾り（押せない）
        return h('span', { class: 'bkey deco', 'aria-hidden': 'true', style: { left: `${((leftWhite + 1) * 100) / 7 - (100 / 7) * 0.32}%`, width: `${(100 / 7) * 0.64}%` } });
      }
      const label = chromaName(pc, naming);
      const hint = pc === 10 && naming === 'german' ? 'B' : `⇧${letterHint(leftWhite)}`;
      const b = btn(String(pc), 'bkey', h('span', { class: 'nm' }, label), hint, label.replace('\n', '／'));
      b.style.left = `${((leftWhite + 1) * 100) / 7 - (100 / 7) * 0.32}%`;
      b.style.width = `${(100 / 7) * 0.64}%`;
      return b;
    });
    el = h('div', { class: 'pad pad-chroma', role: 'group', 'aria-label': '12の音' }, h('div', { class: 'piano' }, whites, blacks));
    // 文字で幹音、Shift を押しながらで ♯（B♯ は C、E♯ は F）
    keyOf = (e) => {
      const k = e.key.toLowerCase();
      if (isGermanB(naming, k) && !e.shiftKey) return '10';
      const li = LETTER_KEYS[k];
      if (li == null) return null;
      return String((WHITE_PCS[li] + (e.shiftKey ? 1 : 0)) % 12);
    };
    midiOf = (m) => String(m % 12);
  } else if (spec.type === 'choices') {
    el = h('div', { class: `pad pad-choices n${spec.options.length}`, role: 'group', 'aria-label': '答え' },
      spec.options.map((o, i) => btn(o.id, 'key', [h('span', { class: 'lbl' }, o.label), o.hint ? h('small', {}, o.hint) : null], CHOICE_KEYS[i], o.label)));
    keyOf = (e) => (e.shiftKey ? null : spec.options[CHOICE_KEYS.indexOf(e.key)]?.id ?? null);
  } else {
    throw new Error(`未対応の入力: ${spec.type}`);
  }

  return {
    el,
    /** キーボードで押されたら true */
    handleKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return false;
      const id = keyOf(e);
      if (id == null || !buttons.has(id)) return false;
      press(id);
      return true;
    },
    /** MIDI 鍵盤の音で押されたら true */
    handleMidi(midi) {
      const id = midiOf(midi);
      if (id == null || !buttons.has(id)) return false;
      press(id);
      return true;
    },
    mark(id, cls) {
      buttons.get(String(id))?.classList.add(cls);
    },
    clear() {
      for (const b of buttons.values()) b.classList.remove('ok', 'ng', 'pressed');
    },
    setEnabled(v) {
      enabled = v;
      el.classList.toggle('disabled', !v);
    },
  };
}
