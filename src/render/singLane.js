// なぞって採点の帯（canvas）。横が時間、縦が音の高さ（半音ごとの段）
//   ・鳴らす音は角の丸い帯。いまの線（左から 3 割）に来たら、その高さで鳴らす
//   ・聞こえた高さは線。オクターブは問わないので、帯にいちばん近いオクターブに直して描く
//   ・合っていたところは、帯を緑で塗る（カラオケの採点のように、なぞったところが光る）
import { frameCredit } from '../core/singScore.js';

const GUTTER = 44; // 左の音名の幅
const NOW_AT = 0.3; // いまの線の位置（左から）

/** 帯の高さの範囲（MIDI 番号）。旋律の上下に 2 半音のゆとり、少なくとも 1 オクターブ */
export function laneRange(notes) {
  let lo = Math.min(...notes.map((n) => n.midi)) - 2;
  let hi = Math.max(...notes.map((n) => n.midi)) + 2;
  while (hi - lo < 12) {
    lo--;
    if (hi - lo < 12) hi++;
  }
  return { lo, hi };
}

/** その時刻に比べる音：鳴らしている音、なければ時刻のいちばん近い音 */
export function refNoteAt(notes, t) {
  let best = null;
  let bd = Infinity;
  for (const n of notes) {
    if (t >= n.t && t < n.t + n.d) return n;
    const d = t < n.t ? n.t - t : t - (n.t + n.d);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

/**
 * @param o.cv canvas、o.notes 採点の音 [{ midi, t, d, target?, frames? }]（秒。frames は聞こえたずれ）、
 *        o.now いまの時刻（旋律の始まりから。null なら全体を描く）
 * @param o.trail [{ t, m }]（聞こえた高さ。m は MIDI 番号・小数か null）
 * @param o.tol きびしさ、o.col 色、o.label(midi) 音名、o.pps 1 秒の幅（全体を描くとき）、o.tonic 主音（0〜11）
 */
export function drawLane({ cv, notes, now, trail, tol, col, label, pps: wholePps, tonic = 0, range }) {
  const w = cv.clientWidth;
  const hgt = cv.clientHeight;
  if (!w || !hgt || !notes.length) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hgt * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(hgt * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hgt);
  const { lo, hi } = range ?? laneRange(notes);
  const rows = hi - lo + 1;
  const rowH = (hgt - 12) / rows;
  const yOf = (m) => 6 + (hi + 0.5 - m) * rowH; // 段のまん中が整数の MIDI 番号
  const whole = now == null;
  const pps = whole ? wholePps : Math.max(70, Math.min(150, (w - GUTTER) / 4.2));
  const nowX = whole ? GUTTER + 8 : GUTTER + (w - GUTTER) * NOW_AT;
  const xOf = (t) => nowX + (t - (whole ? 0 : now)) * pps;

  // 段：黒鍵の段は少し濃く、主音の段に線
  for (let m = lo; m <= hi; m++) {
    const pc = ((m % 12) + 12) % 12;
    const y = yOf(m) - rowH / 2;
    if ([1, 3, 6, 8, 10].includes(pc)) {
      ctx.fillStyle = col.rowDark;
      ctx.fillRect(GUTTER, y, w - GUTTER, rowH);
    }
    if (pc === tonic) {
      ctx.fillStyle = col.line;
      ctx.fillRect(GUTTER, y + rowH - 1, w - GUTTER, 1);
    }
  }
  // 左の音名（旋律に出る高さだけ）
  const used = new Set(notes.map((n) => n.midi));
  ctx.font = `${Math.min(13, Math.max(10, rowH * 0.8))}px system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let m = lo; m <= hi; m++) {
    if (!used.has(m)) continue;
    ctx.fillStyle = col.sub;
    ctx.fillText(label(m), GUTTER - 6, yOf(m));
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(GUTTER, 0, w - GUTTER, hgt);
  ctx.clip();

  // 鳴らす音の帯
  const barH = Math.max(8, Math.min(26, rowH * 0.74));
  for (const n of notes) {
    const x1 = xOf(n.t) + 1;
    const x2 = xOf(n.t + n.d) - 1;
    if (x2 < GUTTER || x1 > w) continue;
    const y = yOf(n.target ?? n.midi) - barH / 2;
    const active = !whole && now >= n.t && now < n.t + n.d;
    const past = !whole && now >= n.t + n.d;
    ctx.fillStyle = active ? col.toneStrong : past ? col.barPast : col.bar;
    roundRect(ctx, x1, y, Math.max(2, x2 - x1), barH, barH / 2);
    ctx.fill();
    // 合っていたところ
    if (n.frames?.length) {
      ctx.fillStyle = col.ok;
      ctx.save();
      roundRect(ctx, x1, y, Math.max(2, x2 - x1), barH, barH / 2);
      ctx.clip();
      for (const f of n.frames) {
        const cr = frameCredit(f.c, tol);
        if (cr <= 0) continue;
        ctx.globalAlpha = 0.35 + 0.65 * cr;
        ctx.fillRect(xOf(f.t) - 0.5, y, 0.02 * pps + 1, barH);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    // 帯の中の音名（入るときだけ）
    if (x2 - x1 > 30 && barH >= 12) {
      ctx.fillStyle = active ? col.toneInk : col.barInk;
      ctx.font = `600 ${Math.min(12, barH - 3)}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(label(n.midi), Math.max(x1, GUTTER) + 6, y + barH / 2 + 0.5);
    }
  }

  // 聞こえた高さの線
  ctx.lineWidth = whole ? 2 : 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  let prev = null;
  for (const p of trail) {
    if (p.m == null || (!whole && p.t > now + 0.02)) {
      prev = null;
      continue;
    }
    const ref = refNoteAt(notes, p.t);
    const target = ref?.target ?? ref?.midi ?? p.m;
    const m = p.m + 12 * Math.round((target - p.m) / 12);
    const y = Math.max(2, Math.min(hgt - 2, yOf(m)));
    const x = xOf(p.t);
    if (prev && p.t - prev.t <= 0.05 && Math.abs(prev.y - y) < rowH * 3) {
      const inNote = ref && p.t >= ref.t && p.t < ref.t + ref.d;
      const c = (m - target) * 100;
      ctx.strokeStyle = inNote && Math.abs(c) <= tol ? col.okLine : col.ink;
      ctx.globalAlpha = inNote ? 1 : 0.55;
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    prev = { t: p.t, x, y };
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // いまの線
  if (!whole) {
    ctx.strokeStyle = col.ink;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(nowX, 0);
    ctx.lineTo(nowX, hgt);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 帯の色（CSS の色から。明るい・暗いに合わせる） */
export function laneColors(el) {
  const cs = getComputedStyle(el);
  const v = (n, d) => cs.getPropertyValue(n).trim() || d;
  return {
    ink: v('--ink', '#222'), sub: v('--sub', '#666'), line: v('--line', '#ddd'), ok: v('--ok', '#1e9e5a'),
    okLine: v('--ok', '#1e9e5a'), toneStrong: v('--tone', '#6d7b0c'), toneInk: '#fff',
    bar: v('--lane-bar', 'rgba(0,0,0,0.14)'), barPast: v('--lane-bar-past', 'rgba(0,0,0,0.08)'), barInk: v('--ink', '#222'),
    rowDark: v('--lane-row', 'rgba(0,0,0,0.035)'),
  };
}
