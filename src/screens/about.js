// このアプリについて：記録の書き出し・読み込み・全消去、使い方のヒント、使っている部品とライセンス
import { h } from '../ui/dom.js';
import { exportData, importData, resetAll, canSave } from '../core/store.js';
import { toast } from '../ui/toast.js';
import { account, onAccount } from '../account/account.js';

/* global __APP_VERSION__ */
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export function mountAbout(root, { life }) {
  const fileInput = h('input', {
    type: 'file', accept: 'application/json,.json', hidden: true,
    onchange: async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        importData(await f.text());
        toast('記録を読み込みました');
      } catch (err) {
        toast(`読み込めませんでした: ${err.message}`);
      }
      e.target.value = '';
    },
  });

  const download = () => {
    const blob = new Blob([exportData()], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `onpu-beat-flash-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // 全部消す：1 回目で確認の表示、3 秒以内にもう 1 回で消す
  const wipeLabel = () => (account().phase === 'in' ? 'アカウントの記録と、この端末の設定を全部消す' : '記録と設定を全部消す');
  const wipe = h('button', { class: 'btn ghost' }, wipeLabel());
  let armed = false;
  wipe.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      wipe.textContent = 'もう一度押すと全部消えます（元に戻せません）';
      wipe.classList.add('danger');
      life.timeout(() => {
        armed = false;
        wipe.textContent = wipeLabel();
        wipe.classList.remove('danger');
      }, 3000);
      return;
    }
    resetAll();
    armed = false;
    wipe.textContent = wipeLabel();
    wipe.classList.remove('danger');
    toast('全部消しました');
  });

  // ログインしているかどうかで、記録の置き場所の説明が変わる
  const privacy = h('p', {}, '');
  const showPrivacy = (s) => {
    privacy.replaceChildren(...(s.phase === 'in'
      ? [`${s.name} さんでログイン中です。成績と自己ベストは、アカウント（釣りすごろくと同じ Firebase）に保存され、ほかの端末でも同じアカウントで続きから使えます。設定は、この端末のこのブラウザの中にだけ保存されます。`]
      : ['記録と設定は、この端末のこのブラウザの中にだけ保存されます。どこにも送りません。ほかの端末へ移すときは、書き出したファイルを向こうで読み込むか、',
        h('a', { href: '#/account' }, 'アカウント'), 'にログインします（成績と自己ベストがアカウントに残ります）。']));
    if (!armed) wipe.textContent = wipeLabel();
  };
  showPrivacy(account());
  onAccount(showPrivacy, life);

  root.replaceChildren(
    h('section', { class: 'card' },
      h('h2', {}, '音符ビートフラッシュ', h('small', {}, `版 ${VERSION}`)),
      h('p', {}, '譜読み（テノール記号などのハ音記号・ト音・ヘ音）と、音名・音程・コードの聞き取りを、ランダムな問題でいくらでも練習できるアプリです。インターネットにつながっていなくても使えます（一度開いたあと）。')),
    h('section', { class: 'card' },
      h('h2', {}, '記録とプライバシー'),
      privacy,
      canSave() ? null : h('p', { class: 'notice' }, 'いまのブラウザは保存ができない状態です（プライベートブラウズなど）。'),
      h('div', { class: 'actions left' },
        h('button', { class: 'btn', onclick: download }, '記録を書き出す'),
        h('button', { class: 'btn', onclick: () => fileInput.click() }, '書き出したファイルを読み込む'),
        fileInput),
      h('div', { class: 'actions left' }, wipe)),
    h('section', { class: 'card' },
      h('h2', {}, '使い方のヒント'),
      h('ul', { class: 'tips' },
        h('li', {}, 'iPhone・iPad で音が出ないときは、本体の消音（マナーモード）スイッチを切ってください。'),
        h('li', {}, 'Bluetooth のイヤホンは音が遅れます。リズムで「遅め」と出続けるときは、リズムの設定の「タイミングの調整」をプラスにします。'),
        h('li', {}, 'パソコンでは C D E F G A B（ドイツ音名なら H）のキーで答えられます。Shift を押しながらで ♯。数字の 1〜9 は選択肢の番号です。Space でもう一度聞く、Enter で次へ・はじめる、Esc でやめる。'),
        h('li', {}, '電子ピアノなどの MIDI 鍵盤は、右上の歯車の「設定」でオンにすると使えます（パソコンや Android の Chrome・Edge。iPhone・iPad の Safari は MIDI に対応していません）。オンにしたあとでつないでも使えます。押した鍵盤の音名が設定の画面に出るので、届いているか確かめられます。'),
        h('li', {}, '楽器を弾いたり歌ったりして答えるには、「設定」の「マイクで答える」をオンにします。アプリの音が鳴っているあいだは聞かないので、問題の音を拾って勝手に答えることはありません。イヤホンを使うとより確かです。「マイクで聞く楽器」で楽器を選ぶと、その音域の音だけを聞きます（ギターとコントラバス・ベースは楽譜に書く高さで受け取ります）。弾いていないのに音が出る・小さな音を拾わないときは「マイクの感度」を変えるか、設定の画面の「周りの音を測る」で部屋に合わせます。'),
        h('li', {}, 'オトバトルは「譜読み」の出題の設定（音部記号・範囲・臨時記号・答え方）をほかの譜読みのゲームと共有しています。外すと少しのあいだ撃てなくなるので、連打より読んで答えるほうが速く進めます。戦い方を「四方から」にすると、もとのオトバトルのように真ん中の砦を守ります。戦場をタップ（マウスなら重ねる）すると照準になり、同じ音の敵が 2 つあるとき近いほうを撃ちます。音符の見え方を「フラッシュ」にすると、音符は少しのあいだだけ見え、ボスのフレーズは 1 音ずつ光って消えます。Space（砲台をタップ）でもう一度見られますが、コンボは切れます。'),
        h('li', {}, '「設定を共有」「この問題を共有」で作ったリンクを開くと、同じ設定・同じ問題で始まります。授業やレッスンで同じ問題を配れます。'),
        h('li', {}, 'スマホではブラウザの「ホーム画面に追加」で、アプリのように開けます。'))),
    h('section', { class: 'card' },
      h('h2', {}, '使っている部品とライセンス'),
      h('ul', { class: 'credits' },
        h('li', {}, h('b', {}, 'VexFlow 4.2.5'), ' — 楽譜の描画。MIT License, Copyright (c) 2010 Mohit Muthanna Cheppudira and contributors. ', h('a', { href: 'https://github.com/vexflow/vexflow', rel: 'noopener', target: '_blank' }, 'github.com/vexflow/vexflow')),
        h('li', {}, h('b', {}, 'Bravura'), ' — 音符・記号の字形（VexFlow に含まれる）。SIL Open Font License 1.1, Copyright (c) Steinberg Media Technologies GmbH. ', h('a', { href: 'https://github.com/steinbergmedia/bravura', rel: 'noopener', target: '_blank' }, 'github.com/steinbergmedia/bravura')),
        h('li', {}, '音はブラウザの Web Audio で作っています（録音した音源は使っていません）。'))),
  );
}
