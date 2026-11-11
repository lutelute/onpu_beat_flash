// 読み方ガイド：音部記号ごとの早見表と、ほかの記号からの読み替え
import { h } from '../ui/dom.js';
import { CLEFS, CLEF_ORDER, rangeSteps, noteName, sciName, stepOf } from '../core/music.js';
import { globalSettings } from '../core/store.js';
import { staffSVG } from '../render/staff.js';

const USE = {
  tenor: 'チェロ・ファゴット・トロンボーン・ユーフォニアムの高い音域',
  alto: 'ヴィオラ（ほぼこの記号）、トロンボーンの一部',
  soprano: '古い声楽の楽譜',
  mezzo: '古い声楽の楽譜',
  baritone: '古い声楽の楽譜',
  treble: 'ヴァイオリン・フルート・ピアノの右手・高い声',
  bass: 'チェロ・コントラバス・ファゴット・ピアノの左手・低い声',
};

/** 記号 a の読みを記号 b の読みから導く言い方。例: 「ト音記号の読みから 1つ下、1オクターブ下」 */
function shiftText(from, to) {
  const d = CLEFS[to].bottom - CLEFS[from].bottom; // 同じ位置の音の差（幹音の数）
  // ずれが小さければ（5度まで）そのまま数え、大きければ近い音名＋オクターブで言う
  const m = ((d % 7) + 7) % 7;
  const s = Math.abs(d) <= 4 ? d : m <= 3 ? m : m - 7;
  const oct = (d - s) / 7;
  const name = s === 0 ? '同じ音名' : `${Math.abs(s)}つ${s > 0 ? '上' : '下'}の音名`;
  const height = oct === 0 ? '' : `、高さは${Math.abs(oct)}オクターブ${oct > 0 ? '上' : '下'}`;
  return `${CLEFS[from].label}として読んだ音から ${name}${height}`;
}

export function mountGuide(root) {
  const naming = globalSettings().naming;
  const card = (clef) => {
    const c = CLEFS[clef];
    const lines = [0, 2, 4, 6, 8].map((p) => noteName(c.bottom + p, naming));
    const spaces = [1, 3, 5, 7].map((p) => noteName(c.bottom + p, naming));
    const items = rangeSteps(clef, 'ledger1').map((step) => ({
      step,
      label: noteName(step, naming),
      sub: sciName(step),
      color: step === stepOf('C', 4) ? '#2b6cd6' : undefined,
    }));
    const others = ['treble', 'bass', 'alto'].filter((x) => x !== clef).slice(0, 2);
    return h('section', { class: 'card guide', id: `clef-${clef}` },
      h('h2', {}, c.label, h('small', {}, c.kind)),
      h('p', { class: 'field-note' }, `使われるところ: ${USE[clef]}`),
      h('div', { class: 'score-scroll' }, h('div', { class: 'score', html: staffSVG({ clef, items, gap: 36 }) })),
      h('dl', { class: 'facts' },
        h('dt', {}, '線（下から）'), h('dd', {}, lines.join('・')),
        h('dt', {}, '間（下から）'), h('dd', {}, spaces.join('・')),
        h('dt', {}, '読み替え'), h('dd', {}, others.map((o) => h('div', {}, shiftText(o, clef))))),
    );
  };

  root.replaceChildren(
    h('p', { class: 'lead' }, '音部記号は「どの線が何の音か」を決める記号です。ハ音記号は、記号の真ん中が指している線が中央のド（C4、青い音符）になります。'),
    h('section', { class: 'card' },
      h('h2', {}, 'テノール記号を読むコツ'),
      h('ol', { class: 'tips' },
        h('li', {}, h('b', {}, '上から2本目の線（第4線）が中央のド'), '。まずこの線を見つけ、そこから上下に数えます。'),
        h('li', {}, h('b', {}, 'ヘ音記号として読み、4つ上の音名にする'), '（5度上）。高さはほぼ同じ音域なので、チェロやファゴットの人はこの読み替えが速い。'),
        h('li', {}, h('b', {}, 'ト音記号として読み、1つ下の音名にして1オクターブ下げる'), '。ト音記号に慣れている人向け。'),
        h('li', {}, h('b', {}, '線の音を覚える'), `: 下から ${[0, 2, 4, 6, 8].map((p) => noteName(CLEFS.tenor.bottom + p, naming)).join('・')}。間は ${[1, 3, 5, 7].map((p) => noteName(CLEFS.tenor.bottom + p, naming)).join('・')}。`),
        h('li', {}, '慣れたら、譜読みフラッシュの「検定」で級を上げ、範囲を「加線1本まで」に広げます。音の高さ（オクターブ）を間違えやすい人は、答え方を「鍵盤で」にします。')),
      h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: '#/game/flash' }, '譜読みフラッシュで練習する'))),
    h('nav', { class: 'chips toc', 'aria-label': '音部記号' }, CLEF_ORDER.map((c) => h('a', { class: 'chip', href: `#/guide`, onclick: (e) => { e.preventDefault(); document.getElementById(`clef-${c}`)?.scrollIntoView({ behavior: 'smooth' }); } }, CLEFS[c].label))),
    ...CLEF_ORDER.map(card),
  );
}
