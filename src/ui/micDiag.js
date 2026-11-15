// マイクのくわしい様子（うまく聞こえないとき、どこで止まっているかを見る。開いているあいだだけ 0.5 秒ごとに書き直す）
//   ・マイク：許可・つながっているか、OS に止められていないか（ほかのアプリがマイクを使っている など）
//   ・音の処理：動いているか、時計が進んでいるか（止まっていると、マイクの波形が新しくならない）
//   ・音の速さ：音の処理とマイクの 1 秒あたりの点の数
//   ・届いている大きさ：無音とみなす下限より大きいか
import { h } from './dom.js';
import { micDiag } from './mic.js';

const db = (x) => (x > 0 ? `${Math.round(20 * Math.log10(x))} dB`.replace('-', '−') : '−∞ dB');
const CTX = {
  running: '動いている',
  suspended: '止まっている（画面に触れると動きます）',
  interrupted: '止められている（ほかのアプリが音を使っている）',
  closed: '閉じている',
};

/** d は micDiag()（peak は前に読んだとき、つまり 0.5 秒前からいちばん大きかった大きさ。peak と floor は rms）→ [[見出し, 様子]] */
export function diagRows(d) {
  if (d.state !== 'on') return [['マイク', d.state === 'denied' ? '許可されていない' : d.state === 'error' ? '使えない' : 'オフ']];
  const tr = d.track === 'live' ? (d.muted ? 'OS に止められている（ほかのアプリがマイクを使っているかもしれません）' : 'つながっている') : d.track ?? '—';
  const clock = d.clock == null ? '確かめています' : d.clock ? '進んでいる' : '止まっている';
  return [
    ['マイク', `${d.label || '名前なし'}・${tr}`],
    ['音の処理', d.ctxState ? `${CTX[d.ctxState] ?? d.ctxState}・時計は${clock}` : '—'],
    ['音の速さ', d.ctxRate ? `処理 ${d.ctxRate} Hz・マイク ${d.micRate ? `${d.micRate} Hz` : '不明'}` : '—'],
    ['届いている大きさ', d.peak == null ? '—' : `${db(d.peak)}（無音とみなす下限 ${db(d.floor)}）`],
    ['作り直した回数', `${d.restarts} 回${d.appleTouch ? '（iPhone・iPad）' : ''}`],
  ];
}

export function micDiagView(life) {
  const body = h('div', { class: 'mic-diag-body', 'aria-live': 'off' });
  const el = h('details', { class: 'mic-diag' }, h('summary', {}, 'うまく聞こえないとき：マイクのくわしい様子'), body);
  const render = () => {
    if (!el.open) return;
    body.replaceChildren(...diagRows(micDiag()).map(([k, v]) => h('div', { class: 'mic-diag-row' }, h('span', {}, k), h('b', {}, v))));
  };
  el.addEventListener('toggle', render);
  const timer = setInterval(render, 500);
  life?.signal.addEventListener('abort', () => clearInterval(timer), { once: true });
  return el;
}
