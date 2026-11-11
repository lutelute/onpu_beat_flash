// 画面づくりの小道具

/** h('div', { class: 'x', onclick }, '文字', 子要素…) */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/**
 * 画面 1 枚ぶんの寿命。画面を離れるときに end() すると、
 * 登録したキー操作・タイマー・待ち合わせがまとめて片づく。
 */
export function makeLife() {
  const ac = new AbortController();
  const timers = new Set();
  return {
    signal: ac.signal,
    get alive() {
      return !ac.signal.aborted;
    },
    on(target, type, fn, opts) {
      target.addEventListener(type, fn, { ...opts, signal: ac.signal });
    },
    timeout(fn, ms) {
      const id = setTimeout(() => {
        timers.delete(id);
        if (!ac.signal.aborted) fn();
      }, ms);
      timers.add(id);
      return id;
    },
    clear(id) {
      clearTimeout(id);
      timers.delete(id);
    },
    sleep(ms) {
      return new Promise((resolve) => {
        const id = setTimeout(() => {
          timers.delete(id);
          resolve(!ac.signal.aborted);
        }, ms);
        timers.add(id);
      });
    },
    /** 子の寿命（画面の中の 1 場面）。親が終われば子も終わる */
    child() {
      const c = makeLife();
      ac.signal.addEventListener('abort', () => c.end(), { once: true });
      return c;
    },
    end() {
      for (const id of timers) clearTimeout(id);
      timers.clear();
      ac.abort();
    },
  };
}

/** リンク・ボタン・入力欄にフォーカスがあるときの Enter / Space は、その部品のものなので横取りしない */
export const onControl = (e) =>
  e.target instanceof Element && !!e.target.closest('a, button, input, select, textarea, summary, [contenteditable], [role="radio"], [role="button"]');

/** 入力欄でのキー入力は横取りしない */
export const typingInField = (e) =>
  e.target instanceof HTMLElement && e.target.matches('input, textarea, select, [contenteditable]');

export const fmtSec = (ms) => `${(ms / 1000).toFixed(2)}秒`;
export const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
