// オトバトルの上の表示（ハート・どこまで進んだか・点数とコンボ・一時停止のボタン）と、
// 戦場に重ねる見出し・一時停止の札（DOM）。何を出すかは呼ぶ側（modes/battle.js）が渡すだけで、ここは見せるだけ。
import { h } from './dom.js';
import { icon } from './icons.js';
import { multiplier } from '../core/battleEngine.js';

const heartSVG = (on) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" class="${on ? 'on' : 'off'}"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.2 0 3.6 1.2 5.3 3.1 1.7-1.9 3.1-3.1 5.3-3.1 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z"/></svg>`;

/**
 * @param o.onPause  一時停止のボタン
 * @param o.onResume 「続ける」
 * @param o.onQuit   「やめる」
 * @returns { bar, banner, pauseBox, notice, update, show, say, tick, setPaused }
 */
export function makeBattleHud({ onPause, onResume, onQuit }) {
  const hearts = h('div', { class: 'hearts', role: 'img' });
  const where = h('div', { class: 'progress' });
  const scoreEl = h('div', { class: 'scoreline' });
  const pauseBtn = h('button', { class: 'btn ghost small pausebtn', 'aria-label': '一時停止', title: '一時停止（Esc）', onclick: onPause },
    h('span', { class: 'ico', html: icon('pause') }), h('kbd', {}, 'Esc'));
  const bar = h('div', { class: 'runbar battlebar' }, hearts, where, scoreEl, pauseBtn);
  const banner = h('div', { class: 'battle-banner', 'aria-live': 'polite' });
  const pauseBox = h('div', { class: 'battle-pause', hidden: true },
    h('div', { class: 'card' },
      h('h2', {}, '一時停止'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: onResume }, '続ける', h('kbd', {}, 'Enter')),
        h('button', { class: 'btn', onclick: onQuit }, 'やめる'))));
  // 戦場の下の知らせの行（「ラ（A4）だった」など）。戦場の楽譜に文字を重ねないよう、ここに出す
  const notice = h('div', { class: 'battle-notice', role: 'status', 'aria-live': 'polite' });
  let bannerUntil = 0;
  let noticeUntil = 0;
  let lastHearts = -1;

  /**
   * 上の表示を書き換える
   * @param o { hearts, maxHearts, stage, total（Infinity ならエンドレス）, boss（ボス戦か）, wave, waves, name（面の名前・無ければ空）, score, combo }
   */
  function update(o) {
    if (o.hearts !== lastHearts) {
      // 減ったときだけ揺らす
      if (lastHearts > o.hearts) {
        hearts.classList.remove('hit');
        void hearts.offsetWidth;
        hearts.classList.add('hit');
      }
      lastHearts = o.hearts;
      hearts.innerHTML = Array.from({ length: o.maxHearts }, (_, i) => heartSVG(i < o.hearts)).join('');
      hearts.setAttribute('aria-label', `残り ${o.hearts}`);
    }
    where.replaceChildren(
      h('b', {}, `ステージ ${o.stage}`, Number.isFinite(o.total) ? h('small', {}, ` / ${o.total}`) : null),
      h('span', {}, [o.name, o.boss ? 'ボス' : `群れ ${o.wave}/${o.waves}`].filter(Boolean).join('・')));
    const m = multiplier(o.combo);
    const mult = m > 1 ? ` <span class="mult">×${m}</span>` : '';
    scoreEl.innerHTML = `<b>${o.score.toLocaleString()}</b><span class="combo">${o.combo >= 3 ? `<span class="ok">${o.combo} コンボ</span>${mult}` : ''}</span>`;
  }

  /** 戦場の真ん中の見出し。ms ミリ秒で消える。cls = small・bad・good */
  function show(main, sub = '', ms = 1500, cls = '') {
    // replaceChildren は null を「null」という文字にしてしまうので、副題が無いときは渡さない
    banner.replaceChildren(...[h('b', {}, main), sub ? h('span', {}, sub) : null].filter(Boolean));
    banner.className = `battle-banner show ${cls}`;
    bannerUntil = performance.now() + ms;
  }
  /** 戦場の下の知らせ。cls = bad・good・（なし） */
  function say(text, cls = '', ms = 2200) {
    notice.textContent = text;
    notice.className = `battle-notice show ${cls}`;
    noticeUntil = performance.now() + ms;
  }
  /** 毎コマ呼ぶ（見出しと知らせを時間で消す） */
  function tick(now) {
    if (bannerUntil && now > bannerUntil) {
      banner.classList.remove('show');
      bannerUntil = 0;
    }
    if (noticeUntil && now > noticeUntil) {
      notice.classList.remove('show');
      noticeUntil = 0;
    }
  }
  function setPaused(on) {
    pauseBox.hidden = !on;
    pauseBtn.disabled = on;
  }
  return { bar, banner, pauseBox, notice, update, show, say, tick, setPaused };
}
