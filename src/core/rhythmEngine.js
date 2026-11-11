// リズムの判定（画面にも音にも触らない。時刻を渡して使う）
//   add(item, t)      t 秒に線へ届く音符を足す（item は何でもよい。answer を持つこと）
//   press(id, t)      t 秒に id と答えた → { note, grade, dt } か、近くに音符がなければ null
//   sweep(now)        通り過ぎて答えのない音符を Miss にする → [{ note, grade, dt }]
//   score()           { tally, maxStreak, streak, judged, accuracy }

export const WINDOWS = { perfect: 0.05, great: 0.1, good: 0.16 };
export const POINTS = { perfect: 3, great: 2, good: 1, miss: 0 };

export function makeRhythmEngine({ windows = WINDOWS, slack = 0.08 } = {}) {
  const notes = [];
  const tally = { perfect: 0, great: 0, good: 0, miss: 0 };
  let streak = 0;
  let maxStreak = 0;
  let judged = 0;

  const settle = (note, grade, dt, id) => {
    note.judged = true;
    note.grade = grade;
    note.given = id;
    tally[grade]++;
    judged++;
    streak = grade === 'miss' ? 0 : streak + 1;
    maxStreak = Math.max(maxStreak, streak);
    return { note, grade, dt };
  };

  return {
    notes,
    add(item, t) {
      const n = { item, t, judged: false };
      notes.push(n);
      return n;
    },
    press(id, t) {
      const dist = (n) => Math.abs(t - n.t);
      const near = notes.filter((n) => !n.judged && dist(n) <= windows.good + slack);
      // 近くに音符がなければ数えない（早押しの空振りは減点しない）
      if (!near.length) return null;
      // 判定の幅の中に答えの合う音符があれば、いちばん近いそれを当たりにする
      // （音符の間隔が狭いとき、少し遅れた答えが次の音符に取られないように）
      const hit = near.filter((n) => n.item.answer === id && dist(n) <= windows.good).sort((a, b) => dist(a) - dist(b))[0];
      if (hit) {
        const d = dist(hit);
        return settle(hit, d <= windows.perfect ? 'perfect' : d <= windows.great ? 'great' : 'good', t - hit.t, id);
      }
      // 合う音符がなければ、いちばん早い音符をまちがいにする
      const first = near.reduce((a, b) => (a.t <= b.t ? a : b));
      return settle(first, 'miss', t - first.t, id);
    },
    sweep(now) {
      const out = [];
      for (const n of notes) if (!n.judged && now - n.t > windows.good) out.push(settle(n, 'miss', now - n.t, null));
      return out;
    },
    /** 判定済みで、もう画面にいらない音符を外す */
    drop(pred) {
      for (let i = notes.length - 1; i >= 0; i--) if (pred(notes[i])) notes.splice(i, 1);
    },
    score() {
      const pts = Object.entries(tally).reduce((s, [g, c]) => s + POINTS[g] * c, 0);
      return { tally: { ...tally }, streak, maxStreak, judged, accuracy: judged ? Math.round((100 * pts) / (3 * judged)) : 0 };
    },
  };
}
