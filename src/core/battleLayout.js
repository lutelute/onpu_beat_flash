// オトバトルの並べ方：画面の大きさ（px）から、敵（怪物と五線の札）・砦・ボスの大きさと位置を決める。
// 描かずに数だけを決めるので、絵（render/battleCanvas.js）とテスト（tests/battle.test.js）が同じものを使える。
// 進行と判定（core/battleEngine.js）には engineLayout() の結果（画面の割合）だけを渡す。
//
// 敵 1 体 = 怪物が五線の札を抱えた形。札の上に頭（head）、下に足（feet）、左右に手（hand）がはみ出す。
// 重なりの判定と通り道は、はみ出しも含めた大きさ（unitW × unitH）で決める。

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// 怪物のはみ出し（線の間隔 g に対する倍率）
// bossHead は、ボスの角の先（揺れを含めて札の上端から約 4.6 線間）が切れない高さ（render/battleMonsters.js の bossBack と合わせる）
export const MONSTER = { head: 3.4, feet: 1.1, hand: 0.5, bossHead: 4.7 };

/**
 * @param o.W, o.H     戦場の大きさ（px）
 * @param o.span       { lo, hi } 札に入れる高さ（render/notation.js の staffSpan）
 * @param o.maxPhrase  ボスのフレーズの最大の音の数
 * @param o.field      'fall'（上から）か 'around'（四方から）
 */
export function battleGeometry({ W, H, span, maxPhrase = 6, field = 'fall' }) {
  const around = field === 'around';
  const rows = (span.hi - span.lo) / 2 + 2.4; // 札の高さ（線の間隔いくつ分か）
  // 線の間隔：狭い画面でも 8 px は残す。札が縦に場所を取りすぎないように（四方からは少し小さめ）
  // とても低い画面（横向きのスマホ）では、間隔を 6 px まで詰めて怪物が縦に収まるように
  const gMin = H < 320 ? 6 : 8;
  const g = around
    ? clamp(Math.min(W / 36, H / 50, (H * 0.2) / rows), gMin, 13)
    : clamp(Math.min(W / 35, H / 46, (H * 0.26) / rows), gMin, 13);
  const panelW = 9.4 * g;
  const panelH = rows * g;
  const head = MONSTER.head * g;
  const feet = MONSTER.feet * g;
  const unitW = panelW + 2 * MONSTER.hand * g;
  const unitH = head + panelH + feet;
  const topY = 4 + 0.4 * g; // トゲや角が上で切れないように少しあける
  const baseY = H - Math.max(44, g * 4.6);
  const cols = clamp(Math.floor((W - 8) / (unitW + 8)), 2, 6);
  // ボスは別の線間隔で大きく（戦場の幅の 8 割まで・高さの 3 分の 1 まで・ふつうの敵の 1.5 倍まで）
  const bossG = clamp(Math.min((W * 0.8 - 20) / (4 + maxPhrase * 3.4), (H * 0.34) / (rows * 1.1 + 2.2), g * 1.5), Math.min(g, 8), 20);
  const topB = topY + MONSTER.bossHead * bossG; // ボスの札の上端（頭と角のぶん下げる）
  const bossW = Math.min(W - 12, (4 + maxPhrase * 3.4) * bossG + 20);
  const bossH = rows * bossG * 1.1 + bossG * 2.2;
  const geo = around ? aroundGeometry({ W, H, g, panelW: unitW, panelH: unitH, cols, topB, bossH }) : null;
  return { W, H, g, bossG, field, panelW, panelH, head, feet, unitW, unitH, signDy: (head - feet) / 2, topY, topB, baseY, cols, bossW, bossH, geo };
}

/** 進行と判定に渡す並べ方（画面の割合）。上から：敵の上端が動く距離に対する割合 */
export function engineLayout(G) {
  const travel = Math.max(20, G.baseY - G.topY - G.unitH); // とても小さい画面でも 0 や負にしない
  const colW = G.W / G.cols;
  return {
    cols: G.cols,
    rowH: G.unitH / travel,
    bossH: (G.topB - G.topY + G.bossH) / travel, // ボスの札の下端（一番上にいるとき）
    bossTravel: (G.baseY - G.topB - G.bossH) / travel,
    sway: Math.max(0, Math.min(0.12 * colW, (colW - G.unitW - 6) / 2)) / G.W, // 隣の列と重ならない揺れ幅
    ...(G.geo ? { geo: aroundLayout(G.geo, { W: G.W, H: G.H, panelW: G.unitW, panelH: G.unitH, bossW: G.bossW, bossH: G.bossH, bossHead: MONSTER.bossHead * G.bossG }) } : {}),
  };
}

/**
 * 四方から（around）の並べ方（px）。砦は画面の真ん中。通り道は、上下の辺（列の数だけ）と左右の辺（入るだけ）から砦へまっすぐ。
 * 短すぎる通り道（縦長の画面の真横など）は使わない。panelW・panelH には怪物のはみ出しも含めた大きさを渡す。
 * @returns { fx, fy, core, sp, ring, lanes: [{ x0, y0, x1, y1 }], rows, rowY0, rowY1, bossTop0, bossTop1 }（px）
 */
export function aroundGeometry({ W, H, g, panelW, panelH, cols, topB, bossH }) {
  const fx = W / 2;
  const fy = H / 2;
  const core = g * 1.9; // 砲台
  const sp = g * 0.42;
  const ring = core + 4 * sp; // 五線の輪のいちばん外
  const ix = panelW / 2 + 4;
  const iy = panelH / 2 + 4;
  const starts = [];
  for (let i = 0; i < cols; i++) {
    const x = clamp(((i + 0.5) / cols) * W, ix, W - ix);
    starts.push({ x, y: iy }, { x, y: H - iy });
  }
  const nr = Math.floor((H - 8) / (panelH + 8));
  for (let j = 1; j < nr - 1; j++) {
    const y = clamp(((j + 0.5) / nr) * H, iy, H - iy);
    starts.push({ x: ix, y }, { x: W - ix, y });
  }
  // 通り道の短さの下限（短すぎると、現れてすぐ砦の近くで怒っている敵になる）
  const minTravel = Math.max(36, panelH * 0.4, Math.min(W, H) * 0.18);
  const lanes = [];
  for (const S of starts) {
    const dx = fx - S.x;
    const dy = fy - S.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    // 札（はみ出しを含む四角）の縁が輪に触れるところで止まる（四角の、向きに沿った半分の長さ）
    const stop = ring + Math.abs(ux) * (panelW / 2) + Math.abs(uy) * (panelH / 2) + 3;
    if (d - stop < minTravel) continue;
    lanes.push({ x0: S.x, y0: S.y, x1: fx - ux * stop, y1: fy - uy * stop });
  }
  if (!lanes.length) {
    // とても小さい画面：短くても、上と下の真ん中から来る通り道だけは残す
    for (const S of [{ x: fx, y: iy }, { x: fx, y: H - iy }]) {
      const stop = ring + panelH / 2 + 3;
      const dir = Math.sign(fy - S.y) || 1;
      lanes.push({ x0: S.x, y0: S.y, x1: fx, y1: Math.abs(fy - S.y) > stop + 2 ? fy - dir * stop : S.y + dir * 2 });
    }
  }
  const rowY0 = iy;
  const rowY1 = fy - ring - panelH / 2 - 3;
  const bossTop1 = Math.max(topB, fy - ring - 3 - bossH);
  return { fx, fy, core, sp, ring, lanes, rows: rowY1 - rowY0 >= minTravel, rowY0, rowY1, bossTop0: topB, bossTop1 };
}

/** aroundGeometry（px）→ エンジンに渡す並べ方（画面の割合） */
// ボスの箱には、札の上の頭と角も入れる（手下と重ならないように）
export const aroundLayout = (geo, { W, H, panelW, panelH, bossW, bossH, bossHead = 0 }) => ({
  lanes: geo.lanes.map((L) => ({ x0: L.x0 / W, y0: L.y0 / H, x1: L.x1 / W, y1: L.y1 / H })),
  hw: panelW / 2 / W, hh: panelH / 2 / H, mx: 6 / W, my: 6 / H,
  rows: geo.rows, rowY0: geo.rowY0 / H, rowY1: geo.rowY1 / H,
  boss: { w: bossW / W, h: (bossH + bossHead) / H, y0: (geo.bossTop0 - bossHead) / H, y1: (geo.bossTop1 - bossHead) / H },
});
