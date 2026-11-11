// 遊び方どうしで使う画面の部品（設定の画面・問題の見せ方・結果の画面と内訳）
import { h, fmtSec, pct, onControl } from '../ui/dom.js';
import { ensureAudio } from '../render/audio.js';
import { weakWeight } from '../core/store.js';
import { settingsForm } from '../ui/form.js';
import { shareURL, shareLink } from './share.js';
import { staffSVG, COLOR } from '../render/staff.js';
import { icon } from '../ui/icons.js';
import { CLEFS, CLEF_ORDER, letterIndex, spelledName } from '../core/music.js';

/** ゲームの中の場面。CSS が見た目を変える（run のときはヘッダーを隠して五線を大きく） */
export const phase = (p) => {
  document.body.dataset.phase = p;
};

/** 譜面の問題を SVG にする（color を付けると答え合わせの色） */
export function promptSVG(q, color) {
  const p = q.prompt;
  return staffSVG({ clef: p.clef, items: [{ step: p.step, acc: p.acc, color }], frame: p.frame });
}

/** 大きな数字のタイル。[ラベル, 値, 'ok'|'ng'|'dim'] */
export function tiles(list) {
  return h('div', { class: 'tiles' }, list.filter(Boolean).map(([label, value, cls]) =>
    h('div', { class: `tile ${cls || ''}` }, h('div', { class: 'tile-v' }, value), h('div', { class: 'tile-l' }, label))));
}

/** 正答率から色 */
export const rateColor = (ok, n) => (n === 0 ? COLOR.mute : ok / n >= 0.9 ? COLOR.ok : ok / n >= 0.7 ? COLOR.warn : COLOR.ng);

/** 正答率の横棒と「正解/出題」 */
export function rateCell(ok, n) {
  const c = rateColor(ok, n);
  return h('div', { class: 'rate' },
    h('span', { class: 'bar' }, h('i', { style: { width: `${n ? (100 * ok) / n : 0}%`, background: c } })),
    h('span', { style: { color: c, fontWeight: 700 } }, `${ok}/${n}`));
}

/**
 * 1 回分の内訳。譜面の問題は音部記号ごとに五線に並べ、音の問題は表にする
 * @param log [{ q, id, ok, ms }]
 */
export function breakdown(gen, gs, log, naming) {
  const by = new Map();
  for (const r of log) {
    const b = by.get(r.q.key) || { q: r.q, n: 0, ok: 0, ms: 0, msN: 0, conf: {} };
    b.n++;
    if (r.ok) {
      b.ok++;
      b.ms += r.ms;
      b.msN++;
    } else if (r.id != null) b.conf[r.id] = (b.conf[r.id] || 0) + 1;
    by.set(r.q.key, b);
  }
  const rows = [...by.values()];
  if (!rows.length) return null;

  if (rows[0].q.prompt.type === 'staff') {
    const byClef = {};
    for (const b of rows) (byClef[b.q.prompt.clef] ||= []).push(b);
    return h('div', { class: 'breakdown' },
      h('h3', {}, '音ごとの結果'),
      CLEF_ORDER.filter((c) => byClef[c]).map((clef) => {
        const items = byClef[clef]
          .sort((a, b) => a.q.prompt.step - b.q.prompt.step || (a.q.prompt.acc ?? 0) - (b.q.prompt.acc ?? 0))
          .map((b) => ({
            step: b.q.prompt.step,
            acc: b.q.prompt.acc,
            color: rateColor(b.ok, b.n),
            label: spelledName({ li: letterIndex(b.q.prompt.step), acc: b.q.prompt.acc ?? 0 }, naming),
            sub: `${b.ok}/${b.n}`,
          }));
        return h('div', { class: 'bd-staff' },
          Object.keys(byClef).length > 1 ? h('div', { class: 'bd-title' }, CLEFS[clef].label) : null,
          h('div', { class: 'score-scroll' }, h('div', { class: 'score', html: staffSVG({ clef, items, gap: 40 }) })));
      }),
      h('div', { class: 'legend' },
        h('span', { style: { color: COLOR.ok } }, '● 9割以上'),
        h('span', { style: { color: COLOR.warn } }, '● 7〜9割'),
        h('span', { style: { color: COLOR.ng } }, '● 7割未満'),
        h('span', {}, '数字は 正解/出題')));
  }

  rows.sort((a, b) => a.ok / a.n - b.ok / b.n || b.n - a.n);
  return h('div', { class: 'breakdown' },
    h('h3', {}, 'ひとつずつの結果'),
    h('div', { class: 'table-scroll' }, h('table', { class: 'bd-table' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, '正解'), h('th', {}, '平均'), h('th', {}, 'まちがえた答え'))),
      h('tbody', {}, rows.map((b) => h('tr', {},
        h('th', {}, gen.keyLabel(b.q.key, gs, naming)),
        h('td', {}, rateCell(b.ok, b.n)),
        h('td', {}, b.msN ? fmtSec(b.ms / b.msN) : '—'),
        h('td', { class: 'conf' }, Object.entries(b.conf).sort((x, y) => y[1] - x[1])
          .map(([id, c]) => `${gen.answerLabel(id, gs, naming)}×${c}`).join('、') || '—')))))));
}

export function summary(log) {
  const ok = log.filter((r) => r.ok).length;
  const okMs = log.filter((r) => r.ok).map((r) => r.ms);
  const avg = okMs.length ? okMs.reduce((s, x) => s + x, 0) / okMs.length : null;
  return { n: log.length, ok, ng: log.length - ok, rate: pct(ok, log.length), avg };
}

/**
 * 設定の画面（3 つの遊び方で共通）
 * @param o.get    () => ({ gs, ms })   いまの設定
 * @param o.set    (patch) => void      { gs } か { ms } を保存
 * @param o.info   () => string         自己ベストなどの一行
 * @param o.onStart () => void
 * @param o.sharedSeed                  共有リンクで来た問題番号（あれば知らせる）
 * @param o.modeFirst  遊び方の設定を出題より先に出す（遊び方で出題が変わるゲーム）
 * @param o.genView    (ms) => { hide: [出題の項目の key], note: 要素 } 遊び方の設定で、出題の項目を隠し・説明を添える
 * @param o.moreFields 細かい設定（出題のあとに別の札で出す。遊び方の設定と同じ ms に入る）
 */
export function setupScreen({ root, L, game, gen, modeTitle, modeFields, get, set, info, onStart, sharedSeed, modeFirst = false, genView = null, moreFields = null, moreTitle = '細かい設定' }) {
  phase('setup');
  const infoEl = h('div', { class: 'best' });
  const refresh = () => {
    infoEl.textContent = info();
  };
  refresh();
  const { gs, ms } = get();
  const start = () => {
    ensureAudio(); // 押した操作の中で音を起こす（iPhone はこうしないと鳴らない）
    L.end();
    onStart();
  };
  // 出題の札。遊び方によって、使わない項目を隠して説明を添える（genView）
  const genCard = h('section', { class: 'card' });
  const buildGen = () => {
    const view = genView?.(get().ms) ?? {};
    const hide = new Set(view.hide ?? []);
    const fields = hide.size ? (v) => gen.fields(v).filter((f) => !hide.has(f.key)) : gen.fields;
    genCard.replaceChildren(...[
      h('h2', {}, '出題'),
      view.note ?? null,
      settingsForm({ fields, presets: hide.size ? undefined : gen.presets, values: get().gs, onChange: (v) => { set({ gs: v }); refresh(); } }),
    ].filter(Boolean));
  };
  buildGen();
  // 遊び方の設定は 2 つの札に分けられる。それぞれ自分の項目だけを書き戻す（もう一方の変更を古い値で消さないように）
  const onMode = (fieldsOf) => (v) => {
    const keys = fieldsOf(v).map((f) => f.key);
    set({ ms: { ...get().ms, ...Object.fromEntries(keys.map((k) => [k, v[k]])) } });
    refresh();
    if (genView) buildGen();
  };
  const modeCard = h('section', { class: 'card' },
    h('h2', {}, modeTitle),
    settingsForm({ fields: modeFields, values: ms, onChange: onMode(modeFields) }));
  const moreCard = moreFields
    ? h('section', { class: 'card' }, h('h2', {}, moreTitle), settingsForm({ fields: moreFields, values: ms, onChange: onMode(moreFields) }))
    : null;
  root.replaceChildren(...[
    h('p', { class: 'lead' }, game.lead),
    sharedSeed ? h('p', { class: 'notice' }, `共有された設定と問題（問題番号 #${sharedSeed}）で開きました。「はじめる」でその問題が出ます。`) : null,
    ...(modeFirst ? [modeCard, genCard] : [genCard, modeCard]),
    moreCard,
    infoEl,
    h('div', { class: 'actions sticky' },
      h('button', { class: 'btn primary big', onclick: start }, 'はじめる', h('kbd', {}, 'Enter')),
      h('button', { class: 'iconbtn', 'aria-label': 'この設定を共有', title: 'この設定を共有', html: icon('share'), onclick: () => shareLink(shareURL(game, get().gs, get().ms), game.title) })),
  ].filter(Boolean));
  L.on(window, 'keydown', (e) => {
    if (e.key === 'Enter' && !onControl(e) && !e.repeat) {
      e.preventDefault();
      start();
    }
  });
}

/** 成績の置き場（生成器が設定ごとに分けているときはそれ） */
export const spaceOf = (gen, gs) => gen.spaceOf?.(gs) ?? gen.space;

/**
 * 苦手の重みを、はじめた時点の値で写しておく。
 * 「同じ問題でもう一度」で同じ並びになるように（途中で成績が変わっても並びは変わらない）
 * 苦手を多めに出さない設定なら null
 */
export function snapshotWeights(gen, gs) {
  if (!gs.weak) return null;
  const space = spaceOf(gen, gs);
  return Object.fromEntries(gen.pool(gs).map((x) => [x.key, weakWeight(space, x.key)]));
}
export const weightFn = (snap) => (snap ? (k) => snap[k] ?? 1 : undefined);

/** 結果の画面の下に置く「共有」の文字リンク */
export const shareButton = (game, gs, ms, seed) =>
  // 苦手を多めに出す設定では、並びが人ごとの記録で変わるので問題は配れない（設定だけ配る）
  gs.weak
    ? h('button', { class: 'linkbtn', onclick: () => shareLink(shareURL(game, gs, ms), game.title) }, '設定を共有')
    : h('button', { class: 'linkbtn', onclick: () => shareLink(shareURL(game, gs, ms, seed), `${game.title} 問題番号 #${seed}`) }, `この問題を共有（#${seed}）`);

/** 金のメダル（合格・全問正解） */
const medalSVG = () => `<svg class="medal" viewBox="0 0 84 84" aria-hidden="true">
  <path d="M28 4 L38 30 L30 34 L18 6 Z" fill="#c2462f"/><path d="M56 4 L46 30 L54 34 L66 6 Z" fill="#2b4c7e"/>
  <circle cx="42" cy="52" r="26" fill="#e3a11f"/><circle cx="42" cy="52" r="20" fill="none" stroke="#fff3cf" stroke-width="2.5" opacity="0.8"/>
  <path d="M42 38 l4.2 8.6 9.4 1.4 -6.8 6.6 1.6 9.4 -8.4 -4.4 -8.4 4.4 1.6 -9.4 -6.8 -6.6 9.4 -1.4 Z" fill="#fff8e6"/>
</svg>`;

/** 紙吹雪（合格・全問正解のとき 1 回だけ） */
export function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#f0a929', '#2b6cd6', '#1e9e5a', '#d8433b', '#6b4fc4', '#0b7d72'];
  const box = h('div', { class: 'confetti', 'aria-hidden': 'true' });
  for (let i = 0; i < 60; i++) {
    const dur = 1.6 + Math.random() * 1.4;
    box.append(h('i', {
      style: {
        left: `${Math.random() * 100}%`, background: colors[i % colors.length],
        animationDuration: `${dur}s`, animationDelay: `${Math.random() * 0.3}s`,
        '--dx': `${(Math.random() - 0.5) * 160}px`, '--rot': `${Math.random() * 720 - 360}deg`,
      },
    }));
  }
  // style オブジェクトの '--dx' は Object.assign では入らないので、ここで入れ直す
  [...box.children].forEach((el, i) => {
    el.style.setProperty('--dx', `${((i * 37) % 160) - 80}px`);
    el.style.setProperty('--rot', `${((i * 97) % 720) - 360}deg`);
  });
  document.body.append(box);
  setTimeout(() => box.remove(), 3500);
}

/**
 * 結果の画面（3 つの遊び方で共通の形）
 * @param o.pass      合格・全問正解などの「よくできた」とき（メダルと紙吹雪）
 * @param o.title     見出し
 * @param o.sub       見出しの下のひとこと
 * @param o.badge     見出しの横の札（自己ベスト更新など）
 * @param o.tiles     tiles() に渡す並び（大きく見せる主な数字。3〜4 個まで）
 * @param o.line      [[名前, 値], …] 主な数字の下に小さく並べる補足（任意）
 * @param o.body      内訳など（要素の並び）。続ける操作のあとに置く
 * @param o.primary   [文字, 関数] Enter でも押せる大きなボタン
 * @param o.secondary [[文字, 関数], …] 同じ幅で横に並べる
 * @param o.foot      いちばん下の小さな行（共有など）
 */
export function resultScreen({ root, L, pass, title, sub, badge, tiles: tl, line = [], body = [], primary, secondary = [], foot = [] }) {
  phase('result');
  const go = (fn) => () => { L.end(); fn(); };
  // 並び：見出し → 主な数字 → 続ける操作 → 内訳（内訳が長くても、続けるボタンが画面の下に追いやられないように）
  const details = body.filter(Boolean);
  const extra = line.filter(Boolean);
  root.replaceChildren(
    h('section', { class: `card result${pass ? ' pass' : ''}` },
      h('div', { class: 'result-hero' },
        pass ? h('div', { html: medalSVG() }) : null,
        h('h2', {}, title, badge ? h('span', { class: 'badge' }, badge) : null),
        sub ? h('p', {}, sub) : null),
      tl ? tiles(tl) : null,
      extra.length ? h('p', { class: 'result-line' }, extra.map(([k, v, cls]) => h('span', { dataset: { k }, class: cls || '' }, `${k} `, h('b', {}, v)))) : null),
    h('div', { class: 'result-actions' },
      h('button', { class: 'btn primary big block', onclick: go(primary[1]) }, primary[0], h('kbd', {}, 'Enter')),
      secondary.length ? h('div', { class: 'row' }, secondary.filter(Boolean).map(([label, fn]) => h('button', { class: 'btn', onclick: go(fn) }, label))) : null),
    details.length ? h('section', { class: 'card result-details' }, ...details) : null,
    h('div', { class: 'result-foot' }, foot.filter(Boolean)),
  );
  if (pass) confetti();
  L.on(window, 'keydown', (e) => {
    if (e.key === 'Enter' && !onControl(e) && !e.repeat) {
      e.preventDefault();
      L.end();
      primary[1]();
    }
  });
}
