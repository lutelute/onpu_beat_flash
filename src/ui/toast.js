// 画面の下に短く出る知らせ（ブラウザのダイアログは使わない）
import { h } from './dom.js';

let box = null;
let timer = 0;

export function toast(message, { ms = 2600, action } = {}) {
  if (!box) {
    box = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  box.replaceChildren(...[
    h('span', {}, message),
    action ? h('button', { class: 'btn small', onclick: () => { hide(); action.run(); } }, action.label) : null,
  ].filter(Boolean)); // replaceChildren は null を「null」という文字にしてしまうので除く
  box.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(hide, action ? Math.max(ms, 8000) : ms);
}

function hide() {
  box?.classList.remove('show');
}
