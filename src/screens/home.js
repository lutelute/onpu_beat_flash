// ホーム：バナー・ゲームの札・調べる
import { h } from '../ui/dom.js';
import { GAMES, GROUPS, genOf, gameById } from '../games.js';
import { getSettings, canSave } from '../core/store.js';
import { icon } from '../ui/icons.js';
import { bannerArt } from '../art/banner.js';
import { account, onAccount } from '../account/account.js';

export function mountHome(root, { life }) {
  // アカウントの札：ログインの状態は少し遅れて分かるので、分かったら書き換える
  const acct = link('#/account', 'account', 'アカウント', '');
  const loggedOut = h('p', { class: 'notice', hidden: true }, h('span', {}, ''), ' ', h('a', { href: '#/account' }, 'ログインする'));
  const showAcct = (s) => {
    loggedOut.hidden = !s.notice || s.phase === 'in';
    loggedOut.firstChild.textContent = s.notice;
    acct.querySelector('.gc-l').textContent = s.phase === 'in'
      ? `${s.name} さんでログイン中。成績と自己ベストはアカウントに残ります`
      : 'ログインすると、成績と自己ベストをほかの端末でも（釣りすごろくと同じアカウント）';
  };
  showAcct(account());
  onAccount(showAcct, life);
  root.replaceChildren(...[
    hero(),
    loggedOut,
    canSave() ? null : h('p', { class: 'notice' }, 'このブラウザでは記録を保存できません（プライベートブラウズなど）。練習はできますが、閉じると記録は消えます。'),
    // ゲームは段ごとに 1 列の一覧（左右に並べると、目が行き来して選びにくい）
    ...GROUPS.map((grp) =>
      h('section', { class: 'group' },
        h('h2', {}, grp.title, h('small', {}, grp.lead)),
        h('div', { class: 'gamelist' },
          (grp.links ?? []).map((l) => link(l.href, l.icon, l.title, l.lead, l.tone)),
          GAMES.filter((x) => x.group === grp.id).map(card)))),
    h('section', { class: 'group' },
      h('h2', {}, '調べる'),
      h('div', { class: 'gamelist small' },
        link('#/guide', 'guide', '読み方ガイド', '音部記号ごとの早見表と、テノール記号の読み方のコツ'),
        link('#/stats', 'stats', '苦手な音・成績', 'どの音を間違えやすいか、どれに時間がかかるか'),
        link('#/settings', 'settings', '設定', '音名の呼び方・音量・明るさ・MIDI 鍵盤・マイク'),
        acct,
        link('#/about', 'about', 'このアプリについて', '記録の書き出し・読み込み、ライセンス'))),
  ].filter(Boolean));
}

// 前回遊んだゲーム（ホームの大きなボタンを「つづける」にする）。保存できないブラウザでは使わない
const LAST = 'onpu-beat-flash.last';
export function rememberGame(id) {
  try {
    localStorage.setItem(LAST, id);
  } catch {
    /* 保存できない */
  }
}
function lastGame() {
  try {
    return gameById(localStorage.getItem(LAST) ?? '') ?? null;
  } catch {
    return null;
  }
}

function hero() {
  const last = lastGame();
  return h('section', { class: 'hero' },
    h('div', { class: 'hero-art', html: bannerArt({ w: 760, h: 200, sp: 15, notes: 9, animate: true, background: false, id: 'hero', align: 'xMinYMid' }) }),
    h('div', { class: 'hero-text' },
      h('h2', {}, '音符を、見た瞬間に読む。'),
      h('p', {}, 'テノール記号などの譜読みと、音名・音程・コードの聞き取りを、ランダムな問題でいくらでも。'),
      h('div', { class: 'hero-actions' },
        last
          ? h('a', { class: 'btn primary', href: `#/game/${last.id}` }, `つづける：${last.title}`)
          : h('a', { class: 'btn primary', href: '#/game/flash' }, '譜読みフラッシュをはじめる'),
        h('a', { class: 'btn on-dark', href: '#/guide' }, '読み方ガイド'))));
}

/** 一覧の 1 行：アイコン・名前と説明・いまの設定（tags）・› 。行のどこを押しても入れる */
function row(href, ico, title, lead, tone, tags = []) {
  return h('a', { class: 'gamecard', href, dataset: { tone } },
    h('span', { class: 'ico', html: icon(ico) }),
    h('span', { class: 'gc-text' }, h('span', { class: 'gc-t' }, title), h('span', { class: 'gc-l' }, lead)),
    h('span', { class: 'gc-s' }, tags.map((t) => h('span', { class: 'tag' }, t))),
    h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
}

const link = (href, ico, title, lead, tone = 'neutral') => row(href, ico, title, lead, tone);

function card(game) {
  const gen = genOf(game);
  const s = getSettings('gen', gen.id, gen.defaults, gen.fields);
  return row(`#/game/${game.id}`, game.icon, game.title, `${game.lead.split('。')[0]}。`, game.id, gen.summary(s).split('／'));
}
