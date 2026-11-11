// 記録：これまでの全部の答えから、苦手な音・時間のかかる音を見る
import { h, fmtSec } from '../ui/dom.js';
import { GENERATORS } from '../generators/index.js';
import { parseReadingKey } from '../generators/reading.js';
import { CLEFS, CLEF_ORDER, rangeSteps, letterIndex, spelledName } from '../core/music.js';
import { statsOf, resetStats, weakWeight, globalSettings, getSettings } from '../core/store.js';
import { staffSVG, COLOR } from '../render/staff.js';
import { rateColor, rateCell } from '../modes/common.js';
import { whereText, onAccount, account } from '../account/account.js';

/** 生成器が知っている key の成績だけ（古い版や壊れたデータの key は除く） */
function knownStats(gen, space = gen.space) {
  const all = new Set(gen.allKeys());
  return Object.entries(statsOf(space)).filter(([k, s]) => all.has(k) && s.n > 0);
}

export function mountStats(root, { life }) {
  const draw = () => {
    const g = globalSettings();
    const ears = ['rhythmPattern', 'pitch', 'interval', 'chord'].flatMap((id) => {
      const gen = GENERATORS[id];
      return (gen.spaces ?? [{ id: gen.space, title: gen.title }]).map((sp) => earSection(gen, sp, g.naming));
    });
    const sections = [readingSection(g.naming), ...ears].filter(Boolean);
    root.replaceChildren(
      h('p', { class: 'lead' }, `これまでに答えた全部の記録です。色は正答率、下の数字は正解までの平均時間（秒）。${whereText()}`),
      ...(sections.length ? sections : [h('section', { class: 'card' }, h('p', {}, 'まだ記録がありません。ゲームで遊ぶとここにたまります。'))]),
    );
  };

  // 消すボタン：1 回目で確認の表示、3 秒以内にもう 1 回で消す（ブラウザのダイアログは使わない）
  const resetBtn = (space) => {
    const b = h('button', { class: 'linkbtn danger' }, 'この記録を消す');
    let armed = false;
    b.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        b.textContent = 'もう一度押すと消えます';
        b.classList.add('danger');
        life.timeout(() => {
          armed = false;
          b.textContent = 'この記録を消す';
          b.classList.remove('danger');
        }, 3000);
        return;
      }
      resetStats(space);
      draw();
    });
    return b;
  };

  function readingSection(naming) {
    const gen = GENERATORS.reading;
    const entries = knownStats(gen);
    if (!entries.length) return null;
    const st = Object.fromEntries(entries);
    const parsed = entries.map(([k]) => ({ k, ...parseReadingKey(k) }));
    const clefs = CLEF_ORDER.filter((c) => parsed.some((x) => x.clef === c));
    const rows = clefs.map((clef) => {
      // 幹音は加線2本までの全部を並べ、臨時記号つきは出したものだけ横に添える
      const extra = parsed.filter((x) => x.clef === clef && x.acc !== 0);
      const used = parsed.filter((x) => x.clef === clef).map((x) => x.step);
      const staffSteps = rangeSteps(clef, 'staff');
      const lo = Math.min(staffSteps[0], ...used);
      const hi = Math.max(staffSteps.at(-1), ...used);
      const items = [];
      for (let step = lo; step <= hi; step++) {
        for (const acc of [-1, 0, 1]) {
          const key = `${clef}:${step}:${acc}`;
          const s = st[key];
          if (acc !== 0 && !extra.some((x) => x.k === key)) continue;
          items.push({
            step, acc,
            color: s ? rateColor(s.ok, s.n) : COLOR.mute,
            label: s ? `${Math.round((100 * s.ok) / s.n)}%` : '—',
            labelColor: s ? rateColor(s.ok, s.n) : COLOR.mute,
            sub: s?.msN ? `${(s.ms / s.msN / 1000).toFixed(1)}秒` : spelledName({ li: letterIndex(step), acc }, naming),
          });
        }
      }
      return h('div', { class: 'bd-staff' },
        h('div', { class: 'bd-title' }, CLEFS[clef].label),
        h('div', { class: 'score-scroll' }, h('div', { class: 'score', html: staffSVG({ clef, items, gap: 40 }) })));
    });
    const weak = entries
      .map(([k]) => k)
      .sort((a, b) => weakWeight(gen.space, b) - weakWeight(gen.space, a))
      .slice(0, 8);
    const gs = getSettings('gen', gen.id, gen.defaults, gen.fields);
    return h('section', { class: 'card' },
      h('h2', {}, '譜読み'),
      rows,
      h('h3', {}, '苦手な順'),
      h('div', { class: 'table-scroll' }, h('table', { class: 'bd-table' },
        h('thead', {}, h('tr', {}, h('th', {}, '音'), h('th', {}, '正解'), h('th', {}, '平均'))),
        h('tbody', {}, weak.map((k) => {
          const s = st[k];
          const label = clefs.length > 1 ? gen.keyLabel(k, gs, naming) : gen.keyLabel(k, gs, naming).replace(/^\S+ /, '');
          return h('tr', {}, h('th', {}, label), h('td', {}, rateCell(s.ok, s.n)), h('td', {}, s.msN ? fmtSec(s.ms / s.msN) : '—'));
        })))),
      h('p', { class: 'field-note' }, '「苦手な音を多めに出す」をオンにすると、この順に多く出ます。'),
      h('div', { class: 'card-foot' }, resetBtn(gen.space)));
  }

  function earSection(gen, sp, naming) {
    const entries = knownStats(gen, sp.id);
    if (!entries.length) return null;
    const gs = getSettings('gen', gen.id, gen.defaults, gen.fields);
    const order = gen.allKeys();
    entries.sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
    return h('section', { class: 'card' },
      h('h2', {}, sp.title),
      h('div', { class: 'table-scroll' }, h('table', { class: 'bd-table' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, '正解'), h('th', {}, '平均'), h('th', {}, '間違えた答え'))),
        h('tbody', {}, entries.map(([k, s]) => {
          const conf = Object.entries(s.conf).sort((x, y) => y[1] - x[1]).slice(0, 3)
            .map(([id, c]) => `${gen.answerLabel(id, gs, naming)}×${c}`).join('、');
          return h('tr', {},
            h('th', {}, gen.keyLabel(k, gs, naming)),
            h('td', {}, rateCell(s.ok, s.n)),
            h('td', {}, s.msN ? fmtSec(s.ms / s.msN) : '—'),
            h('td', { class: 'conf' }, conf || '—'));
        })))),
      h('div', { class: 'card-foot' }, resetBtn(sp.id)));
  }

  draw();
  // ログイン・ログアウトしたとき、ほかの端末の分を取り込んだときは、記録が入れ替わるので描き直す
  const mark = (s) => `${s.phase}|${s.uid}|${s.syncAt}`;
  let seen = mark(account());
  onAccount((s) => {
    if (mark(s) === seen) return;
    seen = mark(s);
    draw();
  }, life);
}
