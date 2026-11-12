// 設定項目の定義（Field[]）から設定画面を組み立てる
//
// Field = { key, type, label, note?, show?(s), ... }
//   multi     { options:[{id,label,hint?}], min? }   いくつでも選べる札
//   segmented { options:[{id,label}] }               1 つ選ぶ札
//   select    { options:[{id,label}] }
//   toggle    {}
//   slider    { min, max, step, format(v) }
//   stepper   { min, max, step?, format?(v) }

import { h } from './dom.js';

const sameValue = (a, b) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((x) => b.includes(x))
    : a === b;

/**
 * @param {object} o
 * @param {(s)=>Array} o.fields
 * @param {Array} [o.presets]
 * @param {object} o.values
 * @param {(v)=>void} o.onChange
 * @param {Object<string, Element>} [o.after] 項目のすぐ下に置くもの（キー → 要素。その項目が出ているときだけ）
 */
export function settingsForm({ fields, presets, values, onChange, after = {} }) {
  const root = h('div', { class: 'form' });
  let v = { ...values };
  const set = (patch) => {
    v = { ...v, ...patch };
    onChange(v);
    draw();
  };

  function draw() {
    // 作り直す前にフォーカスのある部品を覚えておき、あとで戻す（矢印キーで続けて操作できるように）
    const a = document.activeElement;
    const keep = a && root.contains(a) ? { fk: a.dataset.fk, oid: a.dataset.oid ?? '' } : null;
    root.replaceChildren();
    if (presets?.length) {
      const chips = presets.map((p) => {
        const on = Object.entries(p.values).every(([k, x]) => sameValue(v[k], x));
        return h('button', { type: 'button', class: `chip preset${on ? ' on' : ''}`, 'aria-pressed': String(on), onclick: () => set(p.values) }, p.label);
      });
      root.append(wrap({ label: 'おすすめの組み合わせ' }, h('div', { class: 'chips' }, chips)));
    }
    for (const f of fields(v)) {
      if (f.show && !f.show(v)) continue;
      root.append(wrap(f, control(f)));
      if (after[f.key]) root.append(after[f.key]);
    }
    if (keep?.fk) {
      const sel = `[data-fk="${CSS.escape(keep.fk)}"]${keep.oid ? `[data-oid="${CSS.escape(keep.oid)}"]` : ''}`;
      root.querySelector(sel)?.focus();
    }
  }

  function control(f) {
    const cur = v[f.key];
    switch (f.type) {
      case 'multi':
        return h('div', { class: 'chips' }, f.options.map((o) => {
          const on = cur.includes(o.id);
          return h('button', {
            type: 'button', class: `chip${on ? ' on' : ''}`, 'aria-pressed': String(on), title: o.hint, dataset: { fk: f.key, oid: o.id },
            onclick: () => {
              const next = on ? cur.filter((x) => x !== o.id) : [...cur, o.id];
              if (next.length < (f.min ?? 1)) return;
              set({ [f.key]: f.options.map((x) => x.id).filter((id) => next.includes(id)) });
            },
          }, o.label, o.hint ? h('small', {}, o.hint) : null);
        }));
      case 'segmented': {
        // 横に並べて窮屈なもの（長い名前・数が多い）は縦の一覧にする
        const longest = Math.max(...f.options.map((o) => o.label.length));
        const list = f.options.length > 5 || longest > 9 || f.options.length * longest > 28;
        return h('div', { class: `seg${list ? ' seg-list' : ''}`, role: 'radiogroup', 'aria-label': f.label }, f.options.map((o) =>
          h('button', {
            type: 'button', role: 'radio', 'aria-checked': String(cur === o.id), dataset: { fk: f.key, oid: o.id },
            class: cur === o.id ? 'on' : '', onclick: () => set({ [f.key]: o.id }),
          }, o.label)));
      }
      case 'select':
        return h('select', { dataset: { fk: f.key }, 'aria-label': f.label, onchange: (e) => set({ [f.key]: e.target.value }) },
          f.options.map((o) => h('option', { value: o.id, selected: o.id === cur }, o.label)));
      case 'toggle':
        return h('label', { class: 'switch' },
          h('input', { type: 'checkbox', checked: !!cur, dataset: { fk: f.key }, 'aria-label': f.label, onchange: (e) => set({ [f.key]: e.target.checked }) }),
          h('span', { class: 'knob' }),
          h('span', {}, cur ? 'オン' : 'オフ'));
      case 'slider': {
        const out = h('output', {}, f.format(cur));
        return h('div', { class: 'slider' },
          h('input', {
            type: 'range', min: f.min, max: f.max, step: f.step, value: cur, dataset: { fk: f.key }, 'aria-label': f.label,
            oninput: (e) => { out.textContent = f.format(Number(e.target.value)); },
            onchange: (e) => set({ [f.key]: Number(e.target.value) }),
          }), out);
      }
      case 'stepper': {
        const step = f.step ?? 1;
        const fmt = f.format ?? String;
        return h('div', { class: 'stepper' },
          h('button', { type: 'button', 'aria-label': `${f.label}を減らす`, dataset: { fk: f.key, oid: 'minus' }, disabled: cur <= f.min, onclick: () => set({ [f.key]: Math.max(f.min, cur - step) }) }, '−'),
          h('output', { 'aria-live': 'polite' }, fmt(cur)),
          h('button', { type: 'button', 'aria-label': `${f.label}を増やす`, dataset: { fk: f.key, oid: 'plus' }, disabled: cur >= f.max, onclick: () => set({ [f.key]: Math.min(f.max, cur + step) }) }, '＋'));
      }
      default:
        return h('span', {}, `未対応の項目: ${f.type}`);
    }
  }

  draw();
  return root;
}

function wrap(f, ctrl) {
  return h('div', { class: 'field' },
    h('div', { class: 'field-label' }, f.label),
    ctrl,
    f.note ? h('div', { class: 'field-note' }, f.note) : null);
}
