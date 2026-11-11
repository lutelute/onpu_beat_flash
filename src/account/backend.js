// Firebase（釣りすごろくと同じプロジェクト）につなぐ部分。account.js が、使うときに初めて読み込む。
// ここは薄くしておき、判断（期限・合わせ方・文言）は core/ に置く。
//
// 置き場所（釣りすごろくの firestore.rules の「users/{uid}/ 以下はログインしていれば読み書きできる」に収まる）：
//   users/{uid}/data/onpuBeatFlash … このアプリの成績・自己ベスト（core/sync.js の packCloud の形）
// 新しく登録したときは、釣りすごろくと同じ 3 か所にも名前を書く（向こうの「ユーザーを探す」に出るように）：
//   users/{uid}/data/profile、profiles/{uid}、usernames/{小文字の名前}
import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, signOut, connectAuthEmulator,
} from 'firebase/auth';
import { getFirestore, doc, setDoc, runTransaction, connectFirestoreEmulator } from 'firebase/firestore/lite';

// 釣りすごろく（src/lib/firebase.ts）と同じ値。ウェブ用の公開してよい識別子で、守りは Firestore のルールが受け持つ
const firebaseConfig = {
  apiKey: 'AIzaSyBHYCdC9amtGrH1bM9solO4shqm-XS4NOg',
  authDomain: 'tsuri-sugoroku.firebaseapp.com',
  projectId: 'tsuri-sugoroku',
  storageBucket: 'tsuri-sugoroku.firebasestorage.app',
  messagingSenderId: '1054360294742',
  appId: '1:1054360294742:web:3c1b04c992fd167c8672f7',
};
const DOC = 'onpuBeatFlash';

const pick = (u) => (u ? { uid: u.uid, email: u.email ?? '', name: u.displayName || (u.email ?? '').split('@')[0] } : null);

/**
 * @param {{auth?: string, firestore?: [string, number], projectId?: string}} [emulator]
 *   手元のエミュレータにつなぐ（tests/e2e/account-emu.mjs 用。本番では渡さない）
 */
export function createBackend(emulator) {
  // アプリの名前は既定のまま。釣りすごろくと同じ場所で公開したとき、ログインの状態が両方で共有される
  const app = initializeApp(emulator?.projectId ? { ...firebaseConfig, projectId: emulator.projectId } : firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (emulator?.auth) connectAuthEmulator(auth, emulator.auth, { disableWarnings: true });
  if (emulator?.firestore) connectFirestoreEmulator(db, ...emulator.firestore);

  return {
    /** ログインの状態が分かったとき・変わったときに fn({uid, email, name} | null)。返り値で見張りをやめる */
    onUser: (fn) => onAuthStateChanged(auth, (u) => fn(pick(u))),

    async signIn(email, password) {
      return pick((await signInWithEmailAndPassword(auth, email, password)).user);
    },

    /** 新しく登録する。username は画面に出す名前（大文字・小文字はそのまま） */
    async signUp(email, password, username) {
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(user, { displayName: username });
      const now = new Date().toISOString();
      const lower = username.toLowerCase();
      // 名前の登録は、失敗してもログインはできている（釣りすごろくに次に入ったとき、向こうが書き直す）
      await Promise.allSettled([
        setDoc(doc(db, 'users', user.uid, 'data', 'profile'), { displayName: username, lastLoginAt: now }, { merge: true }),
        setDoc(doc(db, 'profiles', user.uid), { uid: user.uid, displayName: username, displayNameLower: lower, lastLoginAt: now }, { merge: true }),
        setDoc(doc(db, 'usernames', lower), { uid: user.uid, displayName: username }),
      ]);
      return pick(user);
    },

    signOut: () => signOut(auth),

    /**
     * アカウントの記録を読み、fn(読んだもの | null) が返した { write, result } の write を書いて、result を返す。
     * 読んでから書くまでにほかの端末が書いたら、読み直してやり直す（fn は何度呼ばれてもよいように作る）
     */
    exchange(uid, fn) {
      const ref = doc(db, 'users', uid, 'data', DOC);
      return runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const out = fn(snap.exists() ? snap.data() : null);
        if (out.write) tx.set(ref, out.write);
        return out.result;
      });
    },
  };
}
