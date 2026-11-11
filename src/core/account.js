// アカウントの決まり（画面にもネットワークにも触らない。Node でテストできる）
// 釣りすごろくと同じアカウントを使う。向こうの決まり（src/store/useAuthStore.ts）と揃えてあるので、
// 片方を変えるときはもう片方も変える：
//   - ユーザー名は、小文字にして @tsuri.local を付けたメールアドレスとして登録されている
//   - ログインしてから 24 時間使わないと、自動でログアウトする（使っているあいだは延びる）
//   - ゲスト（guest@tsuri.local）は全員で共有するアカウント。記録は送らず、端末の中だけに置く

export const GUEST_EMAIL = 'guest@tsuri.local';
/** 最後に使った時刻を入れておく localStorage のキー（釣りすごろくと同じ名前。同じ場所で公開すると共有される） */
export const SESSION_KEY = 'tsuri_session_at';
export const SESSION_MS = 24 * 60 * 60 * 1000;
export const NAME_MAX = 20;
export const PASSWORD_MIN = 6;

export const toEmail = (username) => `${String(username).trim().toLowerCase()}@tsuri.local`;
export const isGuestEmail = (email) => email === GUEST_EMAIL;

/** 最後に使った時刻（文字列）から、期限が切れているか。記録が無ければ切れている扱い */
export function sessionExpired(stamp, now) {
  const t = Number(stamp);
  if (!stamp || !Number.isFinite(t)) return true;
  return now - t > SESSION_MS;
}

/** 入力の確かめ。だめなら理由の文、よければ null。登録のときだけ長さも見る（前からあるアカウントは通す） */
export function checkCredentials(username, password, { register = false } = {}) {
  const name = String(username ?? '').trim();
  if (!name) return 'ユーザー名を入れてください。';
  if (/[\s@]/.test(name)) return 'ユーザー名に空白と @ は使えません。';
  if (!password) return 'パスワードを入れてください。';
  if (register) {
    if (name.includes('/')) return 'ユーザー名に / は使えません。';
    if ([...name].length > NAME_MAX) return `ユーザー名は ${NAME_MAX} 文字までです。`;
    if (password.length < PASSWORD_MIN) return `パスワードは ${PASSWORD_MIN} 文字以上にしてください。`;
  }
  return null;
}

/** Firebase の失敗を、画面に出す文にする（kind: 'login' | 'register' | 'sync'） */
export function authMessage(err, kind = 'login') {
  const text = `${err?.code ?? ''} ${err?.message ?? err ?? ''}`;
  const has = (...words) => words.some((w) => text.includes(w));
  if (has('network', 'Failed to fetch', 'unavailable', 'offline')) return 'ネットワークにつながりません。つながってからもう一度試してください。';
  if (has('too-many-requests')) return '試した回数が多すぎます。しばらく待ってからもう一度試してください。';
  if (has('email-already-in-use')) return 'このユーザー名はもう使われています。自分のものなら「ログインに戻る」から入ってください。';
  if (has('weak-password')) return `パスワードは ${PASSWORD_MIN} 文字以上にしてください。`;
  if (has('invalid-email')) return 'このユーザー名は使えません。半角の英字と数字で作ってください。';
  if (has('user-not-found', 'invalid-credential', 'wrong-password', 'invalid-login-credentials')) {
    return 'ユーザー名かパスワードが違います。初めての人は「アカウントを作る」から登録してください。';
  }
  if (has('permission-denied')) return '記録を読み書きする許可がありません。ログインし直してみてください。';
  if (kind === 'sync') return '記録を送れませんでした。あとで自動でやり直します。';
  return kind === 'register' ? '登録できませんでした。もう一度試してください。' : 'ログインできませんでした。もう一度試してください。';
}
