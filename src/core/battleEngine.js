// オトバトルの進行と判定（画面にも音にも触らない。経過秒 dt を渡して進める）
//
// 上から五線のパネルを持った敵が降りてくる。書いてある音を答えると、その音の敵を撃つ。
// 下の線（砦）に届かれるとハートが 1 つ減る。ステージは「ウェーブ 3 つ → ボス」。
// ボスは短いフレーズ（同じ音部記号の音の並び）を持っていて、左から順に答えると削れる。
//
// 戦い方（field）は 2 つ
//   'fall'   … 上から降りてくる。砦は下の線
//   'around' … もとのオトバトルのように、真ん中の砦へ四方から迫ってくる。通り道（lanes）は絵の側が
//              画面の形に合わせて決める（縦長なら上下から、横長なら左右からも）。重ならない通り道だけを選ぶ
//
// 座標（画面の大きさによらない割合）
//   x = 横の位置（0 左端〜1 右端。パネルの中心）
//   y = 進んだ割合（0 = 現れたところ、1 = 砦に届いたところ）。'fall' ではパネルの下端が砦の線に届いたところ
//   'around' の敵は、通り道の始まり（x0, y0）と終わり（x1, y1）を y で結んだところにいる（px, py。画面の割合）
//
// 使い方
//   const b = makeBattle({ rng, make, makePhrase, cols, rowH, ... })
//   b.step(dt)      時間を進める（一時停止中は呼ばない）
//   b.press(id, rank)  答えた → { type: 'hit' | 'boss' | 'miss' | 'jammed' } か、受け付けない場面なら null
//                   rank(敵 または 'boss') を渡すと、同じ音の的のうち rank の小さいものを撃つ（照準）
//   b.peek()        「もう一度見る」（フラッシュ表示で消えた音符を見せ直す。コンボは切れる）
//   b.take()        起きたこと（出現・命中・突破・場面の切り替え…）を取り出す。描画と音はこれを見て出す
//   b.setLayout(layout)   画面の大きさが変わったとき（layout は絵の側の layout() の結果）
//   b.s             いまの状態（描画が読む）

export const BATTLE = {
  hearts: 5,
  jam: 0.45, // 外したあと撃てない秒数（連打で当てられないように）
  hintAt: 0.62, // 「近づいたら音名を出す」の位置
  intro: 1.8, // ステージの始まりの見出し
  between: 1.3, // ウェーブの間
  bossIntro: 2.0,
  clear: 2.8, // ステージクリアの見出し
  guard: 1.0, // ハートが減ったあと、次に届かれても減らない秒数（隊列がまとめて届いても 1 つだけ）
};

/** 速さの設定 → 時間の倍率（大きいほどゆっくり）。'auto'（おまかせ）は 1 から始めて、群れごとに合わせる */
export const SPEEDS = { slow: 1.4, normal: 1, fast: 0.75, auto: 1 };
/** おまかせの速さの範囲（時間の倍率） */
export const PACE = { min: 0.5, max: 1.8 };

/**
 * おまかせ：1 つの群れの出来から、次の時間の倍率を決める（大きいほどゆっくり）
 * @param w { kills, breaches, misses, prog: 倒したときの進んだ割合の並び }
 */
export function nextPace(pace, w) {
  let k = 1;
  const shots = w.kills + w.misses;
  const missRate = shots ? w.misses / shots : 0;
  const avg = w.prog.length ? w.prog.reduce((a, b) => a + b, 0) / w.prog.length : 1;
  if (w.breaches >= 2) k = 1.18;
  else if (w.breaches === 1 || missRate > 0.35) k = 1.07;
  else if (avg < 0.4 && missRate <= 0.15) k = 0.86; // 早めに、ほとんど外さずに倒せている
  else if (avg < 0.6 && missRate <= 0.25) k = 0.94;
  return Math.min(PACE.max, Math.max(PACE.min, pace * k));
}

/** ステージ n（1 から）の難しさ。時間は speed 倍 */
export function stageParams(n, speed = 1) {
  const k = Math.max(0, n - 1);
  return {
    fall: Math.max(4.2, 10.5 - 1.1 * k) * speed, // 上から砦まで降りる秒数
    quota: Math.min(14, 6 + 2 * k), // 1 ウェーブの敵の数
    every: Math.max(0.8, 2.3 - 0.25 * k) * speed, // 出てくる間隔（秒）
    most: Math.min(6, 3 + k), // 同時に出ている数の上限（列の数でも制限）
    waves: 3,
    rowSize: Math.min(5, 3 + Math.floor(k / 2)), // 隊列の数
    bossHp: Math.min(5, 2 + Math.floor(k / 2)), // フレーズをいくつ弾けば倒せるか
    phrase: Math.min(6, 3 + Math.floor(k / 2)), // フレーズの音の数
    bossFall: Math.max(24, 46 - 4 * k) * speed, // ボスが砦まで降りる秒数
    minion: Math.max(2.6, 5.2 - 0.4 * k) * speed, // ボスが手下を出す間隔
  };
}

/** コンボで得点が増える（10 コンボごとに 1 倍ずつ、4 倍まで） */
export const multiplier = (combo) => 1 + Math.min(3, Math.floor(combo / 10));

/**
 * @param o.rng         makeRng の乱数
 * @param o.make        () => 問題（生成器の make の結果。answer・key・prompt を持つ）
 * @param o.makePhrase  (n) => 問題の並び（同じ音部記号）。ボスのフレーズ
 * @param o.cols        横に並べられるパネルの数
 * @param o.rowH        パネルの高さ（降りる距離に対する割合）。重ならないように使う
 * @param o.bossH       ボスのパネルの高さ（同じく割合）
 * @param o.speed       SPEEDS の値
 * @param o.stages      何ステージで終わりか（Infinity でエンドレス）
 * @param o.hint        近づいた敵に音名を出すか
 */
export function makeBattle({
  rng, make, makePhrase, field = 'fall', cols = 4, rowH = 0.25, bossH = 0.3, bossTravel = 0.7, sway = 0.03,
  geo = null, speed = 1, stages = Infinity, hint = false, hearts = BATTLE.hearts, guard = BATTLE.guard, adapt = false,
}) {
  const around = field === 'around';
  const s = {
    t: 0,
    stage: 1,
    wave: 1,
    phase: 'intro', // intro → wave → between → wave … → bossIntro → boss → clear → intro …（over・won で終わり）
    phaseLeft: BATTLE.intro,
    hearts,
    maxHearts: hearts,
    score: 0,
    combo: 0,
    maxCombo: 0,
    jamUntil: -1,
    enemies: [],
    boss: null,
    log: [], // [{ q, id, ok, ms, how }] how = hit・boss・miss・breach
    kills: 0,
    misses: 0,
    breaches: 0,
    stageDamage: 0,
    spawned: 0,
    spawnLeft: 0.4,
    rowPlan: [],
    cols,
    rowH,
    bossH, // ボスの札の下端（ボスが一番上のとき）。敵の上端の降りた割合で
    bossTravel, // ボスが一番上から砦まで降りる距離（同じく敵の降りる距離に対する割合）
    sway, // ふつうの敵が左右に揺れる幅（画面の幅に対する割合。隣の列と重ならない大きさ）
    field,
    geo, // 'around' の並べ方 { lanes, hw, hh, mx, my, rows, rowY0, rowY1, boss: { w, h, y0, y1 } }
    guardUntil: -1,
    peekAt: -Infinity, // 「もう一度見る」を押した時刻（フラッシュ表示で、この時刻からまた見える）
    peeks: 0,
    pace: 1, // おまかせの速さの倍率（adapt のときだけ動く）
    w: null, // いまの群れの出来（おまかせ用）
  };
  const events = [];
  let nextId = 1;
  let P = stageParams(1, speed);
  const refreshP = () => { P = stageParams(s.stage, speed * s.pace); };
  const newW = () => ({ kills: 0, breaches: 0, misses: 0, prog: [] });
  s.w = newW();
  /** 群れが終わったら、おまかせなら次の速さを決める */
  function adaptPace() {
    if (!adapt) return;
    const before = s.pace;
    s.pace = nextPace(s.pace, s.w);
    if (Math.abs(s.pace - before) / before > 0.01) emit({ type: 'pace', pace: s.pace, slower: s.pace > before });
  }
  const emit = (e) => events.push(e);
  emit({ type: 'phase', phase: 'intro', stage: 1, wave: 1 });

  const colX = (i, n = s.cols) => (i + 0.5) / n;
  const live = () => s.enemies.filter((e) => e.alive);
  const lerp = (a, b, k) => a + (b - a) * k;
  const gap = () => s.rowH * 1.3; // 同じ列で前の敵とこれだけ離れてから出す

  function setPhase(phase, left = 0) {
    s.phase = phase;
    s.phaseLeft = left;
    emit({ type: 'phase', phase, stage: s.stage, wave: s.wave });
  }

  function startWave() {
    refreshP();
    s.w = newW();
    s.spawned = 0;
    s.spawnLeft = 0.5;
    // 隊列：2 つめのウェーブは最初に、3 つめは途中で 1 度
    s.rowPlan = s.wave === 2 ? [0] : s.wave === 3 ? [Math.floor(P.quota / 2)] : [];
    setPhase('wave');
  }

  function newEnemy(kind, x, y, extra = {}) {
    const e = { id: nextId++, q: make(s.stage), kind, x, cx: x, y, born: s.t, alive: true, hinted: false, minion: !!s.boss, sway: rng.next() * Math.PI * 2, ...extra };
    if (around) place(e);
    s.enemies.push(e);
    s.spawned++;
    emit({ type: 'spawn', e });
    return e;
  }

  /** 上のほうが空いている列（y < top の敵がいない列）。隊列は横に揺れるので、上にいるあいだは全部の列をふさぐ */
  function freeCols(top) {
    const used = new Set();
    for (const e of live()) {
      if (e.y >= top) continue;
      if (e.kind === 'row') return [];
      used.add(Math.min(s.cols - 1, Math.max(0, Math.floor(e.cx * s.cols))));
    }
    const out = [];
    for (let i = 0; i < s.cols; i++) if (!used.has(i)) out.push(i);
    return out;
  }

  // ---- 四方から（around）：先の動きまで見て、重ならない通り道を選ぶ ----
  /** 敵の画面の上の位置（割合）を y から決める */
  function place(e) {
    const G = s.geo;
    if (e.kind === 'row') {
      e.px = e.x;
      e.py = lerp(G.rowY0, G.rowY1, e.y);
    } else {
      const L = G.lanes[e.lane];
      e.px = lerp(L.x0, L.x1, e.y);
      e.py = lerp(L.y0, L.y1, e.y);
    }
  }
  // 動くもの（敵・隊列・ボス）を、tau 秒後の箱（中心と半分の幅・高さ）にする
  const moverOf = (e) => (e.kind === 'row' ? { kind: 'row', p: e.y, cx: e.cx, room: e.group.room } : { kind: 'drop', p: e.y, lane: e.lane });
  function boxAt(m, tau) {
    const G = s.geo;
    if (m.kind === 'boss') {
      const y = Math.min(1, m.p + tau / P.bossFall);
      const top = lerp(G.boss.y0, G.boss.y1, y);
      return { x: 0.5, y: top + G.boss.h / 2, w: G.boss.w / 2, h: G.boss.h / 2 };
    }
    const p = Math.min(1, m.p + tau / P.fall);
    if (m.kind === 'row') return { x: m.cx, y: lerp(G.rowY0, G.rowY1, p), w: G.hw + m.room, h: G.hh };
    const L = G.lanes[m.lane];
    return { x: lerp(L.x0, L.x1, p), y: lerp(L.y0, L.y1, p), w: G.hw, h: G.hh };
  }
  const lifeOf = (m) => (1 - m.p) * (m.kind === 'boss' ? P.bossFall : P.fall);
  /** a と b が、どちらかが砦に届くまでのあいだに重なるか */
  function clash(a, b) {
    const G = s.geo;
    const T = Math.max(0, Math.min(lifeOf(a), lifeOf(b)));
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const A = boxAt(a, (T * i) / n);
      const B = boxAt(b, (T * i) / n);
      if (Math.abs(A.x - B.x) < A.w + B.w + G.mx && Math.abs(A.y - B.y) < A.h + B.h + G.my) return true;
    }
    return false;
  }
  function movers() {
    const out = live().map(moverOf);
    if (s.boss) out.push({ kind: 'boss', p: s.boss.y });
    return out;
  }
  function spawnAround() {
    const G = s.geo;
    if (!G?.lanes?.length) return false;
    const others = movers();
    for (const lane of rng.shuffle(G.lanes.map((_, i) => i))) {
      const m = { kind: 'drop', p: 0, lane };
      if (others.some((o) => clash(m, o))) continue;
      newEnemy('drop', G.lanes[lane].x0, 0, { lane });
      return true;
    }
    return false;
  }

  function spawnDrop(y0 = 0) {
    if (around) return spawnAround();
    const free = freeCols(y0 + gap());
    if (!free.length) return false;
    const i = rng.pick(free);
    newEnemy('drop', colX(i), y0);
    return true;
  }

  function spawnRow() {
    const m = Math.min(s.cols, P.rowSize, P.quota - s.spawned);
    if (around && !s.geo?.rows) return false;
    if (m < 2 || (!around && freeCols(gap()).length < s.cols)) return false;
    const first = (s.cols - m) / 2; // 真ん中に置く（列が余る数が奇数なら半列ずれる）
    // 余った幅のぶんだけ左右に揺れる（列いっぱいなら揺れずに降りるだけ）
    const room = (s.cols - m) / 2 / s.cols;
    if (around) {
      const others = movers();
      for (let k = 0; k < m; k++) {
        const me = { kind: 'row', p: 0, cx: colX(first + k), room };
        if (others.some((o) => clash(me, o))) return false;
      }
    }
    const dir = rng.next() < 0.5 ? -1 : 1;
    const group = { off: -dir * room, dir, room, stepLeft: 0.9 };
    for (let k = 0; k < m; k++) newEnemy('row', colX(first + k), 0, { group });
    return true;
  }

  function spawnTick(dt) {
    if (s.spawned >= P.quota) return;
    s.spawnLeft -= dt;
    if (s.spawnLeft > 0) return;
    if (s.rowPlan.length && around && !s.geo?.rows) s.rowPlan = []; // 隊列が入らない画面の形
    if (s.rowPlan.length && s.spawned >= s.rowPlan[0]) {
      if (spawnRow()) {
        s.rowPlan.shift();
        s.spawnLeft = P.every * 1.6;
      } else s.spawnLeft = 0.25;
      return;
    }
    if (live().length >= (around ? P.most : Math.min(P.most, s.cols + 1))) {
      s.spawnLeft = 0.2;
      return;
    }
    s.spawnLeft = spawnDrop() ? P.every * (0.75 + rng.next() * 0.5) : 0.2;
  }

  function moveEnemies(dt) {
    const groups = new Set();
    for (const e of live()) {
      if (e.kind === 'row') {
        groups.add(e.group);
        continue;
      }
      e.y += dt / P.fall;
      if (!around) e.x = e.cx + Math.sin(s.t * 1.9 + e.sway) * s.sway;
    }
    // 隊列：揃って左右に行き来しながら降りる（速さは他の敵と同じなので、縦の間隔が詰まらない）
    for (const gr of groups) {
      gr.stepLeft -= dt;
      gr.off += gr.dir * dt * ((2 * gr.room) / 0.9); // 0.9 秒で端から端へ
      if (Math.abs(gr.off) > gr.room) gr.off = Math.sign(gr.off) * gr.room;
      if (gr.stepLeft <= 0) {
        gr.stepLeft += 0.9;
        gr.dir = -gr.dir;
      }
    }
    for (const e of live()) {
      if (e.kind !== 'row') continue;
      e.y += dt / P.fall;
      e.x = e.cx + e.group.off;
    }
    if (around) for (const e of live()) place(e);
    for (const e of live()) {
      if (hint && !e.hinted && e.y >= BATTLE.hintAt) {
        e.hinted = true;
        emit({ type: 'hint', e });
      }
      if (e.y >= 1) breach(e);
    }
    s.enemies = s.enemies.filter((e) => e.alive);
  }

  function hurt(n) {
    s.guardUntil = s.t + guard;
    s.hearts = Math.max(0, s.hearts - n);
    s.stageDamage += n;
    s.combo = 0;
    if (s.hearts <= 0 && s.phase !== 'over') {
      setPhase('over');
      emit({ type: 'over' });
    }
  }

  function breach(e) {
    e.alive = false;
    s.breaches++;
    s.log.push({ q: e.q, id: null, ok: false, ms: null, how: 'breach', hinted: e.hinted });
    s.w.breaches++;
    // 減った直後は守られる（もとのオトバトルの「無敵時間」。隊列がまとめて届いても 1 つだけ）
    const guarded = s.t < s.guardUntil;
    emit({ type: 'breach', e, guarded });
    if (guarded) s.combo = 0;
    else hurt(1);
  }

  // ---- ボス ----
  /** ボスの札の下端（敵の上端の降りた割合と同じ物差し） */
  const bossBottom = () => s.bossH + s.boss.y * s.bossTravel;
  // 砦への近さ（大きいほど近い）。'fall' はパネルの下端どうし、'around' は進んだ割合どうしで比べる
  const near = (e) => (around ? e.y : e.y + s.rowH);
  const bossNear = () => (around ? s.boss.y : bossBottom());
  function newPhrase() {
    const b = s.boss;
    b.phrase = makePhrase(P.phrase, s.stage);
    b.idx = 0;
    b.seq = { t0: s.t, from: 0 }; // フラッシュ表示：この時刻から、from 番めの音から順に光る
  }
  function startBoss() {
    refreshP();
    s.boss = { hp: P.bossHp, maxHp: P.bossHp, y: 0, phrase: [], idx: 0, minionLeft: P.minion * 0.8, flash: 0, born: s.t };
    newPhrase();
    setPhase('boss');
    emit({ type: 'bossStart', boss: s.boss });
  }
  function moveBoss(dt) {
    const b = s.boss;
    b.y += dt / P.bossFall;
    b.flash = Math.max(0, b.flash - dt);
    b.minionLeft -= dt;
    // 手下はボスの下から出てくる（ボスと重ならないように）
    if (b.minionLeft <= 0) {
      const y0 = around ? 0 : bossBottom() + 0.01; // ボスの札のすぐ下から（敵の上端の降りた割合で）。四方からなら端から
      const room = live().length < Math.min(P.most - 1, around ? P.most : s.cols);
      const ok = (around || y0 < 0.55) && room && spawnDrop(y0);
      b.minionLeft = ok ? P.minion * (0.8 + rng.next() * 0.4) : 0.6;
    }
    if (b.y >= 1) {
      // 砦に届いた：ハート 2 つ。ボスは上へ押し戻される
      const q = b.phrase[b.idx];
      s.log.push({ q, id: null, ok: false, ms: null, how: 'breach' });
      s.breaches++;
      b.y = 0;
      emit({ type: 'bossBreach', boss: b });
      hurt(2);
    }
  }

  function clearStage() {
    for (const e of live()) {
      e.alive = false;
      emit({ type: 'vanish', e });
    }
    s.enemies = [];
    let bonus = 1000 * s.stage;
    const perfect = s.stageDamage === 0;
    if (perfect) bonus += 500 * s.stage;
    s.score += bonus;
    const healed = s.hearts < s.maxHearts;
    if (healed) s.hearts++;
    emit({ type: 'stageClear', stage: s.stage, bonus, perfect, healed });
    s.boss = null;
    setPhase('clear', BATTLE.clear);
  }

  // ---- 進める ----
  function step(dt) {
    if (s.phase === 'over' || s.phase === 'won') return;
    s.t += dt;
    if (s.phase === 'intro' || s.phase === 'between' || s.phase === 'bossIntro' || s.phase === 'clear') {
      // 見出しのあいだも、残っている敵は降り続ける（ウェーブの間は 0 体のはず）
      moveEnemies(dt);
      s.phaseLeft -= dt;
      if (s.phaseLeft > 0 || s.phase === 'over') return;
      if (s.phase === 'intro' || s.phase === 'between') return startWave();
      if (s.phase === 'bossIntro') return startBoss();
      // clear → 次のステージ（または終わり）
      if (s.stage >= stages) {
        setPhase('won');
        emit({ type: 'won' });
        return;
      }
      s.stage++;
      s.wave = 1;
      s.stageDamage = 0;
      refreshP();
      setPhase('intro', BATTLE.intro);
      return;
    }
    if (s.phase === 'wave') {
      spawnTick(dt);
      moveEnemies(dt);
      if (s.phase === 'wave' && s.spawned >= P.quota && live().length === 0) {
        adaptPace();
        if (s.wave < P.waves) {
          s.wave++;
          setPhase('between', BATTLE.between);
        } else setPhase('bossIntro', BATTLE.bossIntro);
      }
      return;
    }
    if (s.phase === 'boss') {
      moveBoss(dt);
      moveEnemies(dt);
    }
  }

  // ---- 答える ----
  function press(id, rank) {
    if (s.phase !== 'wave' && s.phase !== 'boss') return null;
    if (s.t < s.jamUntil) return { type: 'jammed' };
    id = String(id);
    const b = s.boss;
    const bossNote = b && b.phrase[b.idx];
    const bossOk = !!bossNote && bossNote.answer === id;
    const cands = live().filter((e) => e.q.answer === id);
    // 照準があれば、同じ音の的のうち照準に近いものを撃つ（もとのオトバトルの狙い撃ち）
    if (rank && (cands.length || bossOk)) {
      let best = null;
      let bestR = Infinity;
      for (const e of cands) {
        const r = rank(e);
        if (r < bestR) [best, bestR] = [e, r];
      }
      if (bossOk && rank('boss') < bestR) return hitBoss(id);
      if (best) return hitEnemy(best, id);
    }
    // ふだんは、答えた音の敵のうち、いちばん砦に近いものを撃つ。ボスは「いま弾く音」だけが的
    let best = null;
    for (const e of cands) if (!best || e.y > best.y) best = e;
    if (bossOk && (!best || bossNear() > near(best))) return hitBoss(id);
    if (best) return hitEnemy(best, id);
    return miss(id);
  }

  function gain(base) {
    s.combo++;
    s.maxCombo = Math.max(s.maxCombo, s.combo);
    const pts = Math.round(base * multiplier(s.combo));
    s.score += pts;
    return pts;
  }

  function hitEnemy(e, id) {
    e.alive = false;
    s.enemies = s.enemies.filter((x) => x.alive);
    s.kills++;
    s.w.kills++;
    s.w.prog.push(e.y);
    // 早く倒すほど少し多め。近づいて音名が出てからのは半分
    const pts = gain((100 + Math.round(60 * (1 - e.y))) * (e.hinted ? 0.5 : 1));
    s.log.push({ q: e.q, id, ok: true, ms: (s.t - e.born) * 1000, how: 'hit', hinted: e.hinted });
    const r = { type: 'hit', e, pts, combo: s.combo };
    emit(r);
    return r;
  }

  function hitBoss(id) {
    const b = s.boss;
    const q = b.phrase[b.idx];
    const pts = gain(150);
    s.log.push({ q, id, ok: true, ms: null, how: 'boss' });
    b.idx++;
    // 絵のために、当たった時点のボスの位置とフレーズの長さを添える（このあと押し戻し・倒されることがある）
    const r = { type: 'boss', q, idx: b.idx - 1, pts, combo: s.combo, phraseDone: false, down: false, bossY: b.y, n: b.phrase.length };
    if (b.idx >= b.phrase.length) {
      r.phraseDone = true;
      b.hp--;
      b.flash = 0.5;
      s.score += 400 * s.stage;
      if (b.hp <= 0) {
        r.down = true;
        emit(r);
        emit({ type: 'bossDown', boss: b });
        clearStage();
        return r;
      }
      b.y = Math.max(0, b.y - 0.12); // 弾ききると少し押し返す
      newPhrase();
    }
    emit(r);
    return r;
  }

  function miss(id) {
    s.combo = 0;
    s.misses++;
    s.w.misses++;
    s.jamUntil = s.t + BATTLE.jam;
    // まちがえた記録は、いちばん近い敵（読んでいたはずのもの）に付ける
    let blame = null;
    for (const e of live()) if (!blame || e.y > blame.y) blame = e;
    const b = s.boss;
    let q = blame?.q ?? null;
    if (b && (!blame || bossNear() > near(blame))) {
      blame = null;
      q = b.phrase[b.idx];
    }
    if (q) s.log.push({ q, id, ok: false, ms: null, how: 'miss', hinted: !!blame?.hinted });
    const r = { type: 'miss', id, blame, q, hinted: !!blame?.hinted };
    emit(r);
    return r;
  }

  /** もう一度見る：消えた音符をまた見せる（コンボは切れる）。受け付けない場面なら false */
  function peek() {
    if (s.phase !== 'wave' && s.phase !== 'boss') return false;
    s.peekAt = s.t;
    s.peeks++;
    s.combo = 0;
    if (s.boss) s.boss.seq = { t0: s.t, from: s.boss.idx };
    emit({ type: 'peek' });
    return true;
  }

  return {
    s,
    step,
    press,
    peek,
    take: () => events.splice(0, events.length),
    params: () => P,
    jammed: () => s.t < s.jamUntil,
    /** 画面の大きさが変わったとき。列の数が変わったら、いる敵を新しい列に合わせ直す */
    setLayout({ cols: c, rowH: r, bossH: bh, bossTravel: bt, sway: sw, geo: G }) {
      if (around && G) {
        // 通り道が変わったら、いる敵を向きのいちばん近い新しい通り道へ移す（進んだ割合はそのまま）
        const ang = (L) => Math.atan2(L.y1 - L.y0, L.x1 - L.x0);
        const old = s.geo?.lanes ?? [];
        for (const e of live()) {
          if (e.kind === 'row' || !G.lanes.length) continue;
          const a = old[e.lane] ? ang(old[e.lane]) : 0;
          let bi = 0;
          let bd = Infinity;
          G.lanes.forEach((L, i) => {
            const d = Math.abs(Math.atan2(Math.sin(ang(L) - a), Math.cos(ang(L) - a)));
            if (d < bd) [bi, bd] = [i, d];
          });
          e.lane = bi;
        }
        s.geo = G;
      }
      if (r) s.rowH = r;
      if (bh) s.bossH = bh;
      if (bt) s.bossTravel = bt;
      if (sw != null) s.sway = sw;
      if (c && c !== s.cols) {
        const groups = new Set();
        for (const e of live()) {
          if (e.kind === 'row') groups.add(e.group);
          else e.cx = colX(Math.min(c - 1, Math.max(0, Math.floor(e.cx * c))), c);
        }
        for (const gr of groups) {
          const members = live().filter((e) => e.group === gr);
          const m = members.length;
          const mm = Math.min(m, c);
          const first = (c - mm) / 2;
          gr.room = Math.max(0, (c - mm) / 2 / c);
          gr.off = Math.max(-gr.room, Math.min(gr.room, gr.off));
          members.forEach((e, k) => { e.cx = (first + Math.min(k, c - 1) + 0.5) / c; });
        }
        s.cols = c;
      }
      if (around) for (const e of live()) place(e);
    },
  };
}
