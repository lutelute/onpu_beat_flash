// アカウント：ログイン・登録、ログイン中の様子（記録がアカウントと合っているか）、端末の記録をアカウントに足す
import { h } from '../ui/dom.js';
import { account, onAccount, login, register, logout, syncNow, clearError } from '../account/account.js';
import { accountDirty, dataCounts, deviceCounts, moveDeviceToAccount } from '../core/store.js';
import { NAME_MAX, PASSWORD_MIN } from '../core/account.js';
import { toast } from '../ui/toast.js';

const when = (ms) => {
  const d = new Date(ms);
  const time = d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.getMonth() + 1}月${d.getDate()}日 ${time}`;
};
const amount = ({ answers, bests }) => `答えた回数 ${answers}・自己ベスト ${bests} 件`;

export function mountAccount(root, { life }) {
  let built = null; // いま出している画面の種類（入力中に作り直して、打った文字やフォーカスを失わないように）
  let refresh = () => {};
  const update = () => {
    const s = account();
    const kind = s.phase === 'in' ? 'in' : 'form';
    if (kind !== built) {
      built = kind;
      refresh = kind === 'in' ? buildIn(root, life) : buildForm(root);
    }
    refresh(s);
  };
  onAccount(update, life);
  update();
}

// ---------------- ログインしていない ----------------
function buildForm(root) {
  let mode = 'login';
  const title = h('h2', {}, '');
  const said = h('p', { class: 'notice', hidden: true });
  const error = h('p', { class: 'notice bad', role: 'alert', hidden: true });
  const name = h('input', {
    type: 'text', name: 'username', autocomplete: 'username', maxlength: NAME_MAX, required: true,
    autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', placeholder: 'ユーザー名',
  });
  const pass = h('input', { type: 'password', name: 'password', required: true, placeholder: 'パスワード' });
  const passNote = h('span', { class: 'field-note' }, `${PASSWORD_MIN} 文字以上`);
  const submit = h('button', { type: 'submit', class: 'btn primary block big' }, '');
  const swap = h('button', { type: 'button', class: 'linkbtn' }, '');
  const form = h('form', {
    class: 'acct-form',
    onsubmit: (e) => {
      e.preventDefault();
      if (account().busy) return;
      (mode === 'register' ? register : login)(name.value, pass.value);
    },
  },
  h('label', {}, h('span', { class: 'field-label' }, 'ユーザー名'), name),
  h('label', {}, h('span', { class: 'field-label' }, 'パスワード'), pass, passNote),
  error,
  submit,
  h('div', { class: 'center' }, swap));

  const setMode = (m) => {
    mode = m;
    pass.setAttribute('autocomplete', m === 'register' ? 'new-password' : 'current-password');
    passNote.hidden = m !== 'register';
    swap.textContent = m === 'register' ? 'ログインに戻る' : 'アカウントを作る';
    error.hidden = true;
    paint(account());
  };
  swap.addEventListener('click', () => {
    clearError();
    setMode(mode === 'register' ? 'login' : 'register');
  });

  const paint = (s) => {
    title.textContent = mode === 'register' ? 'アカウントを作る' : 'ログイン';
    submit.textContent = s.busy ? '確かめています…' : mode === 'register' ? '登録する' : 'ログイン';
    submit.disabled = s.busy;
  };

  root.replaceChildren(
    h('section', { class: 'card' },
      title,
      h('p', { class: 'lead' }, '釣りすごろくと同じユーザー名とパスワードで入れます。ログインすると、成績と自己ベストがアカウントに残り、ほかの端末でも続きから練習できます。'),
      said,
      form),
    h('p', { class: 'field-note center' }, 'ログインしなくても、今までどおり遊べます（記録はこの端末のブラウザの中だけに保存されます）。'),
    about(),
  );
  setMode('login');

  return (s) => {
    paint(s);
    const note = s.phase === 'guest'
      ? '釣りすごろくのゲストで入っています。ゲストの記録はこの端末だけに保存されます。自分のアカウントで入ると、記録がアカウントに残ります。'
      : s.notice;
    said.hidden = !note;
    said.textContent = note;
    error.hidden = !s.error;
    error.textContent = s.error;
  };
}

// ---------------- ログイン中 ----------------
function buildIn(root, life) {
  const who = h('h2', {}, '');
  const dot = h('span', { class: 'acct-dot', 'aria-hidden': 'true' });
  const line = h('span', {}, '');
  const status = h('p', { class: 'acct-status', role: 'status', 'aria-live': 'polite' }, dot, line);
  const total = h('p', { class: 'field-note' }, '');
  const error = h('p', { class: 'notice bad', role: 'alert', hidden: true });
  const syncBtn = h('button', { type: 'button', class: 'btn', onclick: () => syncNow() }, 'いま合わせる');
  const outBtn = h('button', { type: 'button', class: 'btn ghost', onclick: () => logout() }, 'ログアウト');

  // 端末の記録（ログインする前のもの）をアカウントに足す：1 回目で確認、3 秒以内にもう 1 回で足す
  const devText = h('p', {}, '');
  const devBtn = h('button', { type: 'button', class: 'btn' }, 'アカウントに足す');
  let armed = false;
  const disarm = () => {
    armed = false;
    devBtn.textContent = 'アカウントに足す';
  };
  devBtn.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      devBtn.textContent = 'もう一度押すと足します（元に戻せません）';
      life.timeout(disarm, 3000);
      return;
    }
    disarm();
    if (moveDeviceToAccount()) {
      toast('この端末の記録をアカウントに足しました');
      syncNow();
    }
    paint(account());
  });
  const device = h('section', { class: 'card', hidden: true },
    h('h2', {}, 'この端末にある、ログインする前の記録'),
    devText,
    h('p', { class: 'field-note' }, '足すと、成績は合計され、自己ベストは良いほうが残ります。この端末の記録は空になります（ログアウトしたときに見える記録です）。ほかの人の記録なら、足さずにそのままにしておきます。'),
    h('div', { class: 'actions left' }, devBtn));

  const paint = (s) => {
    who.replaceChildren(`${s.name} さん`, h('small', {}, 'ログイン中'));
    const dirty = accountDirty();
    const [tone, text] =
      !s.confirmed && s.sync !== 'offline' ? ['busy', 'ログインを確かめています…']
        : s.sync === 'busy' ? ['busy', 'アカウントと記録を合わせています…']
          : s.sync === 'offline' || !s.confirmed ? ['bad', 'つながっていません。記録はこの端末に置いてあり、つながったらアカウントに送ります。']
            : s.sync === 'error' ? ['bad', '記録をアカウントと合わせられませんでした。']
              : dirty ? ['busy', 'まだ送っていない記録があります。少しすると自動で送ります。']
                : ['ok', s.syncAt ? `アカウントと合っています（${when(s.syncAt)}）` : 'アカウントと合っています'];
    status.dataset.tone = tone;
    line.textContent = text;
    total.textContent = `このアカウントの記録：${amount(dataCounts())}`;
    const err = s.error || (s.sync === 'error' ? s.syncError : '');
    error.hidden = !err;
    error.textContent = err;
    syncBtn.disabled = s.busy || s.sync === 'busy' || !s.confirmed;
    outBtn.disabled = s.busy;
    outBtn.textContent = s.busy ? 'ログアウトしています…' : 'ログアウト';
    const dev = deviceCounts();
    device.hidden = dev.answers === 0 && dev.bests === 0;
    devText.textContent = `${amount(dev)} が、この端末に残っています。`;
  };

  root.replaceChildren(
    h('section', { class: 'card' },
      who,
      status,
      total,
      error,
      h('div', { class: 'actions left' }, syncBtn, outBtn)),
    device,
    about(),
  );
  return paint;
}

function about() {
  return h('section', { class: 'card' },
    h('h2', {}, 'アカウントについて'),
    h('ul', { class: 'tips' },
      h('li', {}, '釣りすごろくと同じアカウントです。どちらで作っても、両方で使えます。'),
      h('li', {}, 'アカウントに残るのは、成績（どの音をどれだけ間違えたか・かかった時間）と自己ベスト・検定の級です。つながっていないときに練習した分は、つながったときに送ります。2 台で別々に練習しても、どちらの分も合計されます。'),
      h('li', {}, '設定（音名の呼び方・音量・明るさ・MIDI 鍵盤・マイク・ゲームごとの設定）は、端末ごとに覚えます。アカウントには入りません。'),
      h('li', {}, '24 時間使わないと、自動でログアウトします（釣りすごろくと同じ決まり）。この端末にある記録は消えず、次にログインしたとき続きから使えます。'),
      h('li', {}, 'パスワードを忘れたときに作り直す仕組みはありません。忘れないようにしてください。')));
}
