// 画面の切り替え
//   #/            ホーム
//   #/game/<id>   ゲーム（?s=… が付いていれば共有された設定）
//   #/guide       読み方ガイド
//   #/stats       記録
//   #/about       このアプリについて
//   #/account     アカウント（ログイン・記録をアカウントと合わせる）
import './style.css';
import { h, makeLife } from './ui/dom.js';
import { MODES, gameById, genOf } from './games.js';
import { mountHome } from './screens/home.js';
import { mountStats } from './screens/stats.js';
import { mountGuide } from './screens/guide.js';
import { mountAbout } from './screens/about.js';
import { mountSettings } from './screens/settings.js';
import { mountAccount } from './screens/account.js';
import { initAccount, account, onAccount } from './account/account.js';
import { icon } from './ui/icons.js';
import { globalSettings } from './core/store.js';
import { setVolume, stopAll, ensureAudio, audioRunning } from './render/audio.js';
import { makeMicBadge } from './ui/micBadge.js';
import { applyTheme } from './ui/theme.js';
import { enableMidi } from './ui/midi.js';
import { rememberGame } from './screens/home.js';
import { enableMic } from './ui/mic.js';
import { registerSW } from './sw-register.js';

const APP = '音符ビートフラッシュ';
const app = document.getElementById('app');
const back = h('a', { class: 'back', href: '#/', 'aria-label': 'ホームへ' }, '← ホーム');
const title = h('h1', {}, '');
const gear = h('a', { class: 'iconbtn', href: '#/settings', 'aria-label': '設定', html: icon('settings') });
// アカウント：ログイン中は色と印が付く
const person = h('a', { class: 'iconbtn acct', href: '#/account', html: icon('account') });
const showPerson = (s) => {
  const on = s.phase === 'in';
  person.toggleAttribute('data-on', on);
  person.setAttribute('aria-label', on ? `アカウント（${s.name} さんでログイン中）` : 'アカウント（ログインしていません）');
  person.title = on ? `${s.name} さんでログイン中` : 'アカウント';
};
showPerson(account());
onAccount(showPerson);
const main = h('main', { id: 'main', tabindex: '-1' });
app.replaceChildren(h('header', { class: 'top' }, h('div', { class: 'top-inner' }, back, title, person, gear)), main);

// ゲーム中、上の帯にマイクの印を出す（マイクがオンのとき。オトバトルは砲台のそばに出るので除く）
const micBadge = makeMicBadge();
new MutationObserver(() => {
  const bar = main.querySelector('.runbar:not(.battlebar)');
  if (!bar || micBadge.el.parentNode === bar) return;
  micBadge.refresh();
  bar.insertBefore(micBadge.el, bar.querySelector(':scope > .btn'));
}).observe(main, { childList: true, subtree: true });

const g = globalSettings();
setVolume(g.volume);
applyTheme(g.theme);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(globalSettings().theme));
if (g.midi) enableMidi(true);
if (g.mic) enableMic(true);
// 操作のたびに音を起こす（ブラウザは操作の前に音を出させない。iPhone は touchend・click で起きる）
// 動き出したあとも見張りは外さない。iPhone・iPad は、ほかのアプリから戻ると音が止まっていることがあり、
// 次に触れたときに起こし直す（動いているあいだは何もしない）
const UNLOCK = ['pointerdown', 'touchend', 'click', 'keydown'];
const unlock = () => {
  if (!audioRunning()) ensureAudio();
};
for (const type of UNLOCK) window.addEventListener(type, unlock, true);

const PAGES = {
  stats: { title: '苦手な音・成績', mount: mountStats },
  guide: { title: '読み方ガイド', mount: mountGuide },
  about: { title: 'このアプリについて', mount: mountAbout },
  settings: { title: '設定', mount: mountSettings },
  account: { title: 'アカウント', mount: mountAccount },
};

let life = null;
function route() {
  life?.end();
  stopAll();
  life = makeLife();
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const [, name, id] = path.split('/');
  const game = name === 'game' ? gameById(id) : null;
  const page = PAGES[name];
  document.body.dataset.screen = game ? 'game' : page ? name : 'home';
  delete document.body.dataset.phase; // ゲームの中の場面（setup / run / result）は遊び方が付ける
  back.hidden = !game && !page;
  gear.hidden = name === 'settings';
  person.hidden = name === 'account';

  if (game && MODES[game.mode]) {
    title.replaceChildren(h('span', { class: 'tico', dataset: { tone: game.id }, html: icon(game.icon) }), game.title);
    document.title = `${game.title} | ${APP}`;
    MODES[game.mode](main, { game, gen: genOf(game), life, query });
    rememberGame(game.id);
    // 共有の設定は読み込んだので、アドレスからは外す（再読み込みで設定が戻らないように）
    if (query) history.replaceState(null, '', `#/game/${game.id}`);
  } else if (page) {
    title.textContent = page.title;
    document.title = `${page.title} | ${APP}`;
    page.mount(main, { life });
  } else {
    title.textContent = APP;
    document.title = APP;
    mountHome(main, { life });
  }
  window.scrollTo(0, 0);
  // 画面が変わったことを読み上げソフトに伝える
  if (document.activeElement && document.activeElement !== document.body && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);
route();
registerSW();
initAccount();
