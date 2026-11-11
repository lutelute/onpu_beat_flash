// リズム譜を描く（線 1 本の打楽器譜。連桁は拍ごと）
// 戻り値で、音符の要素（叩いた結果の色を付ける）と、拍 → 横の位置（流れる縦の線）を渡す
import { Renderer, Stave, StaveNote, Voice, Formatter, Beam, Dot, Fraction } from 'vexflow/bravura';

const DUR = { 1: '16', 2: '8', 3: '8d', 4: 'q', 6: 'qd', 8: 'h', 12: 'hd', 16: 'w' };
const SVGNS = 'http://www.w3.org/2000/svg';

/**
 * @param {HTMLElement} container  ここに SVG を入れる
 * @param {{ beats:number, measures:Array }} pattern  生成器の prompt
 * @param {number} perRow  1 段に並べる小節の数
 * @returns {{ svg, notes:[{el, beat}], at(beat) → {x, y1, y2}, playhead }}
 */
export function renderRhythm(container, { beats, measures }, perRow = 2) {
  const measureW = 60 + beats * 64;
  const clefW = 34;
  const timeW = 30;
  const rowH = 100;
  const rows = [];
  for (let i = 0; i < measures.length; i += perRow) rows.push(measures.slice(i, i + perRow).map((m, k) => [m, i + k]));
  const W = Math.min(perRow, measures.length) * measureW + clefW + timeW + 12;
  const H = rows.length * rowH + 10;

  container.innerHTML = '';
  const renderer = new Renderer(container, Renderer.Backends.SVG);
  renderer.resize(W, H);
  const ctx = renderer.getContext();
  ctx.setFillStyle('currentColor');
  ctx.setStrokeStyle('currentColor');

  const out = [];
  const spans = []; // 小節ごとの { b0, b1, knots:[[拍, x]], y1, y2 }
  let beatPos = 0;
  rows.forEach((row, r) => {
    let x = 4;
    row.forEach(([notes, mi], k) => {
      const w = measureW + (k === 0 ? clefW : 0) + (mi === 0 ? timeW : 0);
      const stave = new Stave(x, 6 + r * rowH, w);
      stave.setConfigForLines([0, 1, 2, 3, 4].map((i) => ({ visible: i === 2 })));
      stave.setStyle({ fillStyle: 'currentColor', strokeStyle: 'currentColor' });
      if (k === 0) stave.addClef('percussion');
      if (mi === 0) stave.addTimeSignature(`${beats}/4`);
      stave.setContext(ctx).draw();

      const sn = notes.map((n) => {
        const d = DUR[n.ticks];
        const note = new StaveNote({ keys: ['b/4'], duration: d + (n.rest ? 'r' : ''), clef: 'percussion', stem_direction: 1, auto_stem: false });
        if (d.endsWith('d')) Dot.buildAndAttach([note], { all: true });
        return note;
      });
      const voice = new Voice({ num_beats: beats, beat_value: 4 }).addTickables(sn);
      const beams = Beam.generateBeams(sn, { groups: [new Fraction(1, 4)], stem_direction: 1 });
      new Formatter().joinVoices([voice]).format([voice], stave.getNoteEndX() - stave.getNoteStartX() - 12);
      voice.draw(ctx, stave);
      beams.forEach((b) => b.setContext(ctx).draw());

      const knots = [[beatPos, stave.getNoteStartX() - 4]];
      let b = beatPos;
      notes.forEach((n, ni) => {
        const xMid = sn[ni].getAbsoluteX() + 6;
        knots.push([b, xMid]);
        if (!n.rest) out.push({ note: sn[ni], beat: b });
        b += n.ticks / 4;
      });
      knots.push([beatPos + beats, x + w - 6]);
      const yMid = stave.getYForLine(2);
      spans.push({ b0: beatPos, b1: beatPos + beats, knots, y1: yMid - 46, y2: yMid + 22 });
      beatPos += beats;
      x += w;
    });
  });

  const svg = container.querySelector('svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.removeAttribute('style'); // VexFlow が書いた幅の指定を外し、入れ物の幅に合わせる
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'リズム譜');

  // 流れる縦の線（五線の下に敷く）
  const playhead = document.createElementNS(SVGNS, 'line');
  playhead.setAttribute('class', 'playhead');
  svg.insertBefore(playhead, svg.firstChild);

  const at = (beat) => {
    const sp = spans.find((s) => beat >= s.b0 && beat < s.b1) ?? spans[beat < 0 ? 0 : spans.length - 1];
    const k = sp.knots;
    const bb = Math.min(Math.max(beat, sp.b0), sp.b1);
    let i = 0;
    while (i < k.length - 2 && k[i + 1][0] <= bb) i++;
    const [b0, x0] = k[i];
    const [b1, x1] = k[i + 1];
    const x = b1 > b0 ? x0 + ((bb - b0) / (b1 - b0)) * (x1 - x0) : x0;
    return { x, y1: sp.y1, y2: sp.y2 };
  };

  const notes = out.map(({ note, beat }) => ({ el: svg.querySelector(`[id="vf-${note.getAttribute('id')}"]`), beat }));
  return { svg, notes, at, playhead };
}
