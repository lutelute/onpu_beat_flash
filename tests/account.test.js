import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toEmail, isGuestEmail, sessionExpired, checkCredentials, authMessage, SESSION_MS, SESSION_KEY } from '../src/core/account.js';
import {
  merge3, addData, betterRecord, normalizeData, emptyData, sameData, countData, isEmptyData, packCloud, unpackCloud,
} from '../src/core/sync.js';

const stat = (n, ok, ms = 0, msN = 0, conf = {}) => ({ n, ok, ms, msN, conf });
const data = (stats = {}, records = {}) => ({ stats, records });

// ---------------- アカウントの決まり（釣りすごろくと同じ） ----------------
test('ユーザー名は、小文字にして @tsuri.local を付けたメールアドレスになる（釣りすごろくと同じ）', () => {
  assert.equal(toEmail('Lute'), 'lute@tsuri.local');
  assert.equal(toEmail('  Taro01 '), 'taro01@tsuri.local');
  assert.equal(SESSION_KEY, 'tsuri_session_at');
  assert.ok(isGuestEmail('guest@tsuri.local'));
  assert.ok(!isGuestEmail('lute@tsuri.local'));
});

test('24 時間使わないと期限切れ。記録が無いときも期限切れ', () => {
  const now = 1_800_000_000_000;
  assert.equal(sessionExpired(String(now - 1000), now), false);
  assert.equal(sessionExpired(String(now - SESSION_MS + 1), now), false);
  assert.equal(sessionExpired(String(now - SESSION_MS - 1), now), true);
  assert.equal(sessionExpired(null, now), true);
  assert.equal(sessionExpired('', now), true);
  assert.equal(sessionExpired('abc', now), true);
});

test('入力の確かめ：ログインは空と空白・@ だけ、登録は長さも見る', () => {
  assert.equal(checkCredentials('lute', 'x'), null); // 前からあるアカウントは、短いパスワードでも通す
  assert.match(checkCredentials('', 'pw'), /ユーザー名/);
  assert.match(checkCredentials('   ', 'pw'), /ユーザー名/);
  assert.match(checkCredentials('a b', 'pw'), /空白/);
  assert.match(checkCredentials('a@b', 'pw'), /@/);
  assert.match(checkCredentials('lute', ''), /パスワード/);
  assert.equal(checkCredentials('lute', '123456', { register: true }), null);
  assert.match(checkCredentials('lute', '12345', { register: true }), /6 文字以上/);
  assert.match(checkCredentials('a'.repeat(21), '123456', { register: true }), /20 文字まで/);
  assert.match(checkCredentials('a/b', '123456', { register: true }), /\//);
});

test('Firebase の失敗は、読める文になる', () => {
  const err = (code) => Object.assign(new Error(`Firebase: Error (${code}).`), { code });
  assert.match(authMessage(err('auth/invalid-credential')), /ユーザー名かパスワードが違います/);
  assert.match(authMessage(err('auth/wrong-password')), /ユーザー名かパスワードが違います/);
  assert.match(authMessage(err('auth/email-already-in-use'), 'register'), /もう使われています/);
  assert.match(authMessage(err('auth/weak-password'), 'register'), /6 文字以上/);
  assert.match(authMessage(err('auth/invalid-email'), 'register'), /半角/);
  assert.match(authMessage(err('auth/too-many-requests')), /しばらく待って/);
  assert.match(authMessage(err('auth/network-request-failed')), /ネットワーク/);
  assert.match(authMessage(new TypeError('Failed to fetch'), 'sync'), /ネットワーク/);
  assert.match(authMessage(err('permission-denied'), 'sync'), /許可/);
  assert.match(authMessage(err('something-else'), 'sync'), /送れませんでした/);
  assert.match(authMessage(err('something-else'), 'register'), /登録できませんでした/);
  assert.match(authMessage(undefined), /ログインできませんでした/);
});

// ---------------- 自己ベストの比べ方 ----------------
test('自己ベスト：数は大きいほうが良い。即答は 正解が多い → ミスが少ない → 時間が短い', () => {
  assert.ok(betterRecord(5, 3));
  assert.ok(!betterRecord(3, 3));
  assert.ok(betterRecord({ ok: 10, ng: 3 }, { ok: 9, ng: 0 }));
  assert.ok(betterRecord({ ok: 10, ng: 1 }, { ok: 10, ng: 2 }));
  assert.ok(betterRecord({ ok: 20, ng: 0, time: 9000 }, { ok: 20, ng: 0, time: 9500 }));
  assert.ok(!betterRecord({ ok: 20, ng: 0, time: 9500 }, { ok: 20, ng: 0, time: 9500 }));
  assert.ok(!betterRecord(5, { ok: 1 })); // 形が違えば、いまあるほうを残す
  assert.ok(!betterRecord({ ok: 1 }, 5));
});

// ---------------- 記録を合わせる ----------------
test('この端末で変わっていなければ、アカウントの中身そのまま（余計な書き込みをしない）', () => {
  const remote = data({ reading: { a: stat(10, 7, 4321.5, 7, { 'b': 3 }) } }, { 'battle|x': 1200, 'quiz|y': { ok: 20, ng: 1, time: 30000 } });
  const base = normalizeData(remote);
  const m = merge3(base, normalizeData(remote), remote);
  assert.ok(sameData(m, remote));
  // 初めての端末（何も持っていない）でも同じ
  assert.ok(sameData(merge3(emptyData(), emptyData(), remote), remote));
});

test('アカウントが空で、この端末にだけ記録がある（初めて送る）', () => {
  const local = data({ reading: { a: stat(3, 2, 900, 2, { c: 1 }) } }, { k: 5 });
  assert.ok(sameData(merge3(emptyData(), local, emptyData()), local));
  assert.ok(sameData(merge3(null, local, null), local));
});

test('2 台で別々に練習した分は、どちらも合計される', () => {
  const base = data({ reading: { a: stat(10, 8, 8000, 8, { x: 2 }) } });
  // この端末：a をあと 5 回（正解 3・間違い 2 回は y と答えた）、b を初めて 1 回
  const local = data({ reading: { a: stat(15, 11, 11000, 11, { x: 2, y: 2 }), b: stat(1, 1, 700, 1) } });
  // ほかの端末：a をあと 4 回（正解 4）、c を 2 回
  const remote = data({ reading: { a: stat(14, 12, 12400, 12, { x: 2 }), c: stat(2, 0, 0, 0, { z: 2 }) } });
  const m = merge3(base, local, remote);
  assert.deepEqual(m.stats.reading.a, stat(19, 15, 15400, 15, { x: 2, y: 2 }));
  assert.deepEqual(m.stats.reading.b, stat(1, 1, 700, 1));
  assert.deepEqual(m.stats.reading.c, stat(2, 0, 0, 0, { z: 2 }));
});

test('合わせた結果をもう一度合わせても増えない（同じ分を 2 回足さない）', () => {
  const base = data({ s: { a: stat(4, 2, 1000, 2, { q: 2 }) } }, { r: 10 });
  const local = data({ s: { a: stat(9, 5, 2500, 5, { q: 3, w: 1 }) } }, { r: 12, t: 3 });
  const remote = data({ s: { a: stat(6, 4, 2000, 4, { q: 2 }) } }, { r: 11 });
  const m = merge3(base, local, remote);
  assert.deepEqual(m.stats.s.a, stat(11, 7, 3500, 7, { q: 3, w: 1 }));
  // 送ったあとは base = local = m。もう一度合わせても変わらない
  assert.ok(sameData(merge3(m, m, m), m));
  // 送ったあとに、ほかの端末がまだ古い base のまま自分の分を足しても、こちらの分は 1 回だけ
  const other = merge3(base, data({ s: { a: stat(5, 3, 1500, 3, { q: 2 }) } }, { r: 10 }), m);
  assert.equal(other.stats.s.a.n, 12);
});

test('この端末で成績を消すと、消した分だけ減る。そのあいだにほかの端末で増えた分は残る', () => {
  const base = data({ s: { a: stat(10, 6, 6000, 6, { q: 4 }) }, t: { b: stat(3, 3, 900, 3) } });
  const local = data({ t: { b: stat(3, 3, 900, 3) } }); // s を消した
  // 向こうは変わっていない → s は消える
  assert.deepEqual(merge3(base, local, base).stats, { t: { b: stat(3, 3, 900, 3) } });
  // 向こうで a が 2 回増えていた → その 2 回は残る
  const remote = data({ s: { a: stat(12, 7, 7100, 7, { q: 5 }) }, t: { b: stat(3, 3, 900, 3) } });
  assert.deepEqual(merge3(base, local, remote).stats.s.a, stat(2, 1, 1100, 1, { q: 1 }));
});

test('合わせた成績は、いつも使える形（正解は回数以下・負にならない）', () => {
  const base = data({ s: { a: stat(10, 9, 9000, 9) } });
  const local = data({ s: { a: stat(2, 0, 0, 0, { x: 2 }) } }); // 消してからやり直した
  const remote = data({ s: { a: stat(3, 3, 2000, 3) } }); // 向こうも消してやり直した
  const a = merge3(base, local, remote).stats.s?.a;
  if (a) {
    assert.ok(a.n > 0 && a.ok >= 0 && a.ok <= a.n && a.msN <= a.ok && a.ms >= 0);
    for (const v of Object.values(a.conf)) assert.ok(v > 0);
  }
  assert.ok(sameData(normalizeData(merge3(base, local, remote)), merge3(base, local, remote)));
});

test('自己ベスト：この端末で更新したら良いほう、していなければアカウントのまま', () => {
  const base = data({}, { up: 10, same: 5, quiz: { ok: 10, ng: 2 }, gone: 7 });
  const local = data({}, { up: 15, same: 5, quiz: { ok: 10, ng: 1 }, gone: 7, mine: 3 });
  const remote = data({}, { up: 12, same: 8, quiz: { ok: 12, ng: 4 }, theirs: 9 }); // gone は向こうで消えた
  const m = merge3(base, local, remote).records;
  assert.equal(m.up, 15); // 両方で更新 → 良いほう
  assert.equal(m.same, 8); // こちらは変えていない → 向こうの更新
  assert.deepEqual(m.quiz, { ok: 12, ng: 4 }); // 両方で更新 → 正解が多いほう
  assert.equal(m.mine, 3);
  assert.equal(m.theirs, 9);
  assert.ok(!('gone' in m)); // 向こうで消えて、こちらは触っていない → 消える
  // この端末で全部消した：向こうで変わっていないものは消え、向こうで更新されていたものは残る
  const wiped = merge3(base, emptyData(), data({}, { up: 10, same: 9, quiz: { ok: 10, ng: 2 }, gone: 7 })).records;
  assert.deepEqual(wiped, { same: 9 });
});

test('端末の記録をアカウントに足す：成績は足し算、自己ベストは良いほう。元の入れ物は書き換えない', () => {
  const account = data({ s: { a: stat(5, 4, 4000, 4, { x: 1 }) } }, { r: 10, q: 1 });
  const device = data({ s: { a: stat(3, 1, 800, 1, { x: 1, y: 1 }), b: stat(2, 2, 1000, 2) } }, { r: 8, q: 2, d: 4 });
  const before = JSON.stringify([account, device]);
  const m = addData(account, device);
  assert.deepEqual(m.stats.s.a, stat(8, 5, 4800, 5, { x: 2, y: 1 }));
  assert.deepEqual(m.stats.s.b, stat(2, 2, 1000, 2));
  assert.deepEqual(m.records, { r: 10, q: 2, d: 4 });
  assert.equal(JSON.stringify([account, device]), before);
  // 結果を書き換えても、元は変わらない（入れ物を共有していない）
  m.stats.s.b.n = 99;
  assert.equal(device.stats.s.b.n, 2);
});

test('数える・空かどうか', () => {
  assert.deepEqual(countData(data({ s: { a: stat(5, 4), b: stat(2, 0) }, t: { c: stat(1, 1) } }, { r: 1, q: 2 })), { answers: 8, bests: 2 });
  assert.ok(isEmptyData(emptyData()));
  assert.ok(isEmptyData(null));
  assert.ok(!isEmptyData(data({}, { r: 1 })));
});

test('アカウントに置く形：包んで開くと元に戻る。記号の入ったキーもそのまま', () => {
  const d = data(
    { 'reading': { 'tenor|C4|#': stat(3, 2, 1500.25, 2, { 'D♭4': 1 }), '__x__': stat(1, 1, 300, 1) } },
    { 'quiz|quick|n20|tenor.alto/a1': { ok: 20, ng: 0, time: 31000 }, 'kentei|tenor': 4 },
  );
  const packed = packCloud(d, new Date('2026-11-10T03:00:00Z'));
  assert.equal(packed.app, 'onpu-beat-flash');
  assert.equal(packed.v, 1);
  assert.equal(packed.updatedAt, '2026-11-10T03:00:00.000Z');
  assert.equal(typeof packed.json, 'string');
  assert.deepEqual(Object.keys(packed).sort(), ['app', 'json', 'updatedAt', 'v']); // 中身は 1 つの文字列だけ
  assert.ok(sameData(unpackCloud(packed), d));
});

test('アカウントから読んだものが無い・壊れているときは空。使えない部分は捨てる。新しい版の形は読まない', () => {
  assert.ok(isEmptyData(unpackCloud(null)));
  assert.ok(isEmptyData(unpackCloud({})));
  assert.ok(isEmptyData(unpackCloud({ v: 1, json: '{こわれている' })));
  const mixed = unpackCloud({ v: 1, json: JSON.stringify({ stats: { s: { good: stat(2, 1), bad: { n: 1, ok: 5 }, worse: 'x' }, t: 3 }, records: { a: 1, b: 'x', c: { ok: 2 }, d: { ng: 1 } } }) });
  assert.deepEqual(mixed, { stats: { s: { good: stat(2, 1) } }, records: { a: 1, c: { ok: 2 } } });
  assert.throws(() => unpackCloud({ v: 2, json: '{}' }), (e) => e.code === 'onpu/newer-data');
});
