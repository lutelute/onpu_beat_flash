// ゲーム中のマイクの印。上の帯（.runbar）に差し込む（main.js）。マイクがオフなら出さない
//   ・音の大きさの短い棒と、聞こえた音名（静か「—」・音はあるが高さを調べ中「♪」・アプリの音のあいだ「待」）
//   ・ブラウザが音を止めている「止」・マイクから音が届かない「無音」・マイクが使えない「×」は赤く
//   ・くわしい説明は title（マウスを重ねると出る）と、読み上げ用の名前に
import { h } from './dom.js';
import { icon } from './icons.js';
import { onMicLevel, onMicStatus, micStatus, hearing } from './mic.js';
import { globalSettings } from '../core/store.js';

// 大きさは -60 dB〜0 dB を 0〜100% で（設定の画面のメーターと同じ）
const pos = (level) => {
  const db = level > 0 ? 20 * Math.log10(level) : -60;
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
};

export function makeMicBadge() {
  const bar = h('span', { class: 'mb-bar' });
  const text = h('span', { class: 'mb-text' }, '—');
  const el = h('span', { class: 'micbadge', hidden: true, 'data-kind': 'quiet' },
    h('span', { html: icon('mic'), 'aria-hidden': 'true' }),
    h('span', { class: 'mb-track', 'aria-hidden': 'true' }, bar),
    text);
  let kind = '';
  let shown = '';
  let long = '';
  const set = (k, short, about) => {
    if (k !== kind) el.dataset.kind = kind = k;
    if (short !== shown) text.textContent = shown = short;
    if (about !== long) {
      long = about;
      el.title = about;
      el.setAttribute('aria-label', `マイク：${about}`);
    }
  };
  const status = (st) => {
    el.hidden = !globalSettings().mic;
    if (st.state !== 'on') {
      bar.style.width = '0%';
      set('off', '×', st.text || 'マイクを使えません。設定の画面でマイクの様子を確かめてください');
    } else if (kind === 'off') set('quiet', '—', '静かです。弾くか歌うと、ここに音名が出ます'); // つながった
  };
  onMicStatus(status);
  onMicLevel((info) => {
    if (el.hidden || kind === 'off') return;
    bar.style.width = `${pos(info.level)}%`;
    const hr = hearing(info, globalSettings().naming);
    set(hr.kind, hr.short, hr.long);
  });
  const refresh = () => status(micStatus());
  refresh();
  return { el, refresh };
}
