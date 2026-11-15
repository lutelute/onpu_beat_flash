// チューナー：いま聞こえている音の高さを細かく見る
//   ・いちばん近い音（弦楽器は開放弦）と、そこからのずれ（0.1 セント）。基準のラは設定と同じ
//   ・弦楽器は、純正な 5 度（コントラバスは 4 度）で合わせる目標も選べる。弦を押すと、その高さの音を鳴らす
//   ・高さの動き（直前の 6 秒）と、ビブラートの速さ・幅。ビブラートのあいだは、揺れの中心で針を出す
//   ・倍音の強さ（どの倍音がどれだけ鳴っているか）
// 高さはマイクの 1 枚（20 ms）ごと（ui/mic.js の onMicFrame）。音域は「マイクで聞く楽器」に合わせる
import { h } from '../ui/dom.js';
import { globalSettings, setGlobal } from '../core/store.js';
import { micDiagView } from '../ui/micDiag.js';
import { enableMic, micStatus, onMicStatus, onMicFrame, onMicLevel, hearing, micSupported } from '../ui/mic.js';
import { MIC_INSTRUMENTS, REF_A, freqToMidi } from '../core/pitch.js';
import { openStrings, harmonics, harmonicCents } from '../core/intonation.js';
import { makeTunerTrack, easeNeedle } from '../core/tunerTrack.js';
import { playDrone, stopDrone, droneOn } from '../render/audio.js';
import { NAMINGS, WHITE_PCS, chromaNameFlat, midiSci } from '../core/music.js';

const SPAN = 6; // 高さの動きを見せる秒数
const IN = 3; // 合っている（セント）
const NEAR = 10; // だいたい合っている
const sign = (c) => (c > 0 ? '+' : c < 0 ? '−' : '±');
const fmtC = (c) => `${sign(Math.round(c * 10) / 10)}${Math.abs(c).toFixed(1)}`;

/** 音の名前を、大きく出す名前と、小さく添える高さ（A4 など）に */
export function noteParts(midi, naming) {
  const pc = ((midi % 12) + 12) % 12;
  const sci = midiSci(midi);
  if (naming === 'english' || naming === 'german') {
    const w = WHITE_PCS.indexOf(pc);
    const name = w >= 0 ? NAMINGS[naming].names[w] : chromaNameFlat(pc, naming);
    return { name: `${name}${Math.floor(midi / 12) - 1}`, sci: naming === 'german' ? sci : '' };
  }
  const w = WHITE_PCS.indexOf(pc);
  return { name: w >= 0 ? NAMINGS[naming].names[w] : chromaNameFlat(pc, naming), sci };
}

export function mountTuner(root, { life }) {
  const g0 = globalSettings();
  let strings = null; // 弦楽器の開放弦と目標 [{ midi, cents }]
  const tt = makeTunerTrack({ keep: SPAN + 0.5 }); // 比べる音と針（core/tunerTrack.js）
  let harm = null; // 倍音の強さ（ならした dB）
  let harmTick = 0;
  let shownKey = '';

  // ---- 上の段：楽器・基準のラ・純正な 5 度 ----
  const instSel = h('select', { class: 'select', 'aria-label': 'マイクで聞く楽器' },
    MIC_INSTRUMENTS.map((x) => h('option', { value: x.id }, x.label)));
  instSel.value = g0.micInstrument;
  const refSel = h('select', { class: 'select', 'aria-label': '基準のラ' }, REF_A.map((hz) => h('option', { value: String(hz) }, `A4 = ${hz} Hz`)));
  refSel.value = String(g0.micRefA ?? 440);
  const pureBox = h('input', { type: 'checkbox', checked: !!g0.tunerPure });
  const pureLbl = h('label', { class: 'tn-pure' }, pureBox, h('span', {}, '純正な 5 度で合わせる'));
  const controls = h('div', { class: 'tn-controls' },
    h('label', { class: 'tn-field' }, h('span', {}, '楽器'), instSel),
    h('label', { class: 'tn-field' }, h('span', {}, '基準'), refSel),
    pureLbl);

  // ---- 針 ----
  const needle = svgEl('line', { x1: 150, y1: 150, x2: 150, y2: 26, class: 'tn-needle' });
  const gauge = h('div', { class: 'tn-gauge', html: gaugeSVG() });
  gauge.querySelector('svg').append(needle, svgEl('circle', { cx: 150, cy: 150, r: 7, class: 'tn-hub' }));
  const nameEl = h('span', { class: 'tn-name' }, '—');
  const sciEl = h('span', { class: 'tn-sci' }, '');
  const centsEl = h('span', { class: 'tn-cents' }, '');
  const hzEl = h('span', { class: 'tn-hz' }, '');
  const modeEl = h('span', { class: 'tn-mode' }, '');
  const panel = h('section', { class: 'card tn-panel idle' },
    gauge,
    h('div', { class: 'tn-read' }, h('div', { class: 'tn-note' }, nameEl, sciEl), h('div', { class: 'tn-sub' }, centsEl, hzEl), modeEl));
  const status = h('p', { class: 'sr-only', role: 'status' });

  // ---- 開放弦と基準の音 ----
  const stringRow = h('div', { class: 'tn-strings' });
  const droneSay = h('p', { class: 'field-note tn-drone-say', 'aria-live': 'polite' });
  let droneBtn = null;
  let droneTimer = 0;
  function drone(btn, f, label) {
    clearTimeout(droneTimer);
    if (droneBtn === btn && droneOn()) {
      stopDrone();
      droneBtn?.classList.remove('playing');
      droneBtn = null;
      droneSay.textContent = '';
      return;
    }
    droneBtn?.classList.remove('playing');
    const d = playDrone(f, 4);
    if (!d) return;
    droneBtn = btn;
    btn.classList.add('playing');
    droneSay.textContent = `${label}（${f.toFixed(2)} Hz）を鳴らしています。${globalSettings().micPhones ? '' : '鳴っているあいだはマイクで聞きません（イヤホンなら聞きます）。'}もう一度押すと止まります`;
    droneTimer = setTimeout(() => {
      btn.classList.remove('playing');
      if (droneBtn === btn) droneBtn = null;
      droneSay.textContent = '';
    }, d * 1000);
  }
  const hzOf = (midi, cents = 0) => (globalSettings().micRefA ?? 440) * 2 ** ((midi - 69 + cents / 100) / 12);
  function buildStrings() {
    const g = globalSettings();
    strings = openStrings(g.micInstrument, { pure: g.tunerPure });
    pureLbl.hidden = !strings || g.micInstrument === 'guitar';
    pureLbl.querySelector('span').textContent = g.micInstrument === 'bass' ? '純正な 4 度で合わせる' : '純正な 5 度で合わせる';
    const naming = g.naming;
    const list = strings ?? [{ midi: 69, cents: 0, a: true }];
    stringRow.replaceChildren(
      h('span', { class: 'tn-strings-label' }, strings ? '開放弦（押すと鳴ります）' : '基準の音'),
      ...list.map((s, i) => {
        const p = noteParts(s.midi, naming);
        const btn = h('button', { type: 'button', class: 'tn-string', dataset: { i } },
          h('b', {}, p.name), h('small', {}, `${p.sci}${s.cents ? ` ${s.cents > 0 ? '+' : '−'}${Math.abs(s.cents)}` : ''}`));
        btn.addEventListener('click', () => drone(btn, hzOf(s.midi, s.cents), `${p.name}${p.sci ? `（${p.sci}）` : ''}`));
        return btn;
      }));
    tt.setStrings(strings);
  }

  // ---- 高さの動き（直前 6 秒）とビブラート ----
  const canvas = h('canvas', { class: 'tn-trace', 'aria-hidden': 'true' });
  const vibEl = h('p', { class: 'tn-vib' }, '');
  // ---- 倍音 ----
  const harmBars = h('div', { class: 'tn-harm-bars' });
  const harmCard = h('section', { class: 'card tn-harm' },
    h('h2', {}, '倍音', h('small', {}, 'いまの音にふくまれる倍音の強さ（いちばん強い倍音を 0 dB）')),
    harmBars,
    h('p', { class: 'field-note' }, '弦の倍音（自然倍音）は平均律と少しずれます。3 倍音と 6 倍音は +2 セント、5 倍音は −14 セント、7 倍音は −31 セント。弦楽器で倍音（フラジオレット）を使って合わせるときの目安です'));

  // ---- マイクが使えないとき ----
  const micLine = h('p', { class: 'field-note tn-mic-line', 'aria-live': 'polite' });
  const micBtn = h('button', { type: 'button', class: 'btn primary', onclick: async () => {
    setGlobal({ mic: true });
    micBtn.disabled = true;
    await enableMic(true);
    micBtn.disabled = false;
    showMic(micStatus());
  } }, 'マイクをオンにする');
  const micCard = h('section', { class: 'card tn-mic', hidden: true }, h('p', {}, 'チューナーはマイクで聞きます。'), micBtn, micLine);
  const diag = micDiagView(life);
  function showMic(st) {
    diag.hidden = !globalSettings().mic;
    const on = globalSettings().mic && st.state === 'on';
    micCard.hidden = on;
    micBtn.hidden = st.state === 'unsupported';
    micLine.textContent = !micSupported() ? st.text : globalSettings().mic ? st.text : '';
  }
  showMic(micStatus());
  onMicStatus(showMic, life);
  let heardKind = '';
  onMicLevel((info) => {
    const hr = hearing(info, globalSettings().naming);
    if (hr.kind === heardKind) return;
    heardKind = hr.kind;
    modeEl.dataset.kind = hr.kind;
    if (['paused', 'nosignal', 'gated'].includes(hr.kind)) modeEl.textContent = hr.long;
    else modeEl.textContent = '';
  }, life);

  instSel.addEventListener('change', () => {
    setGlobal({ micInstrument: instSel.value });
    buildStrings();
  });
  refSel.addEventListener('change', () => {
    setGlobal({ micRefA: Number(refSel.value) });
    buildStrings();
  });
  pureBox.addEventListener('change', () => {
    setGlobal({ tunerPure: pureBox.checked });
    buildStrings();
  });
  buildStrings();

  root.replaceChildren(
    h('p', { class: 'lead' }, '弾くか歌うと、いちばん近い音と、そこからのずれを出します。弦楽器を選ぶと開放弦に合わせられます。'),
    micCard,
    controls,
    panel,
    stringRow,
    droneSay,
    h('section', { class: 'card tn-trace-card' }, h('h2', {}, '高さの動き', h('small', {}, '直前 6 秒。緑の帯が ±3 セント')), canvas, vibEl),
    harmCard,
    diag,
    status,
  );

  // ---- 1 枚ごと ----
  onMicFrame((f) => {
    const e = tt.feed(f);
    // 倍音は 0.1 秒ごと（受け取った枚だけ）
    if (e && harmTick++ % 5 === 0 && f.rawFreq) {
      const hs = harmonics(f.buf, f.sampleRate, f.rawFreq, { count: 8 });
      harm = hs.map((x, i) => ({ k: x.k, db: harm?.[i] ? harm[i].db * 0.5 + x.db * 0.5 : x.db }));
    }
  }, life);

  // ---- 描く（画面の更新ごと） ----
  let shown = 0; // 針（なめらかに動かす）
  let prevNow = 0;
  let textAt = -1; // ずれの数字を書いた時刻（続いているあいだは 0.2 秒ごとに書き直す）
  let textKey = '';
  let raf = 0;
  let colors = null;
  let colorsAt = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!colors || now - colorsAt > 1000) {
      colors = readColors(root);
      colorsAt = now;
    }
    const naming = globalSettings().naming;
    const dt = prevNow ? Math.min(0.1, (now - prevNow) / 1000) : 1 / 60;
    prevNow = now;
    const r = tt.read();
    const live = r.state === 'live';
    const showing = r.state !== 'idle';
    panel.classList.toggle('idle', !showing);
    panel.classList.toggle('hold', r.state === 'hold');
    const { ref, value, vib } = r;
    if (value != null && ref) {
      const p = noteParts(ref.midi, naming);
      shown = easeNeedle(shown, Math.max(-50, Math.min(50, value)), dt);
      // 数字は 0.2 秒ごと（細かく踊らないように）。音が変わったとき・聞こえ始めたときは、すぐ書き直す
      const key = `${ref.key}|${live}`;
      if (live && (key !== textKey || now - textAt >= 200)) {
        const v = key !== textKey ? value : shown;
        textAt = now;
        nameEl.textContent = p.name;
        sciEl.textContent = p.sci;
        centsEl.textContent = `${fmtC(v)} セント`;
        const f = hzOf(ref.midi, ref.cents + v);
        hzEl.textContent = `${f.toFixed(f < 100 ? 2 : 1)} Hz`;
        panel.classList.toggle('intune', Math.abs(v) <= IN);
        panel.classList.toggle('near', Math.abs(v) > IN && Math.abs(v) <= NEAR);
        panel.classList.toggle('sharp', v > NEAR);
        panel.classList.toggle('flat', v < -NEAR);
        if (shownKey !== `${ref.key}${Math.abs(v) <= IN}`) {
          shownKey = `${ref.key}${Math.abs(v) <= IN}`;
          status.textContent = `${p.name} ${Math.abs(v) <= IN ? '合っています' : v > 0 ? '高め' : '低め'}`;
        }
      }
      textKey = key;
    } else textKey = '';
    needle.setAttribute('transform', `rotate(${(shown * 1.8).toFixed(2)} 150 150)`);
    // 弦のボタン：いま近い弦に印
    for (const b of stringRow.querySelectorAll('.tn-string')) {
      const on = showing && ref?.string != null && Number(b.dataset.i) === ref.string;
      b.classList.toggle('active', on);
      b.classList.toggle('intune', on && value != null && Math.abs(value) <= IN);
    }
    vibEl.textContent = !showing ? '' : vib
      ? `ビブラート：1 秒に ${vib.rate} 回・幅 ±${Math.round(vib.width)} セント。針は揺れの中心（${fmtC(vib.center)} セント）を出しています`
      : r.run.length >= 30 ? `まっすぐ伸びています（ふらつき ±${spread(r.run).toFixed(1)} セント）` : '';
    drawTrace(canvas, tt.hist, tt.lastT, colors, naming);
    drawHarm(harmBars, showing ? harm : null, ref, naming);
  }
  raf = requestAnimationFrame(frame);
  life.signal.addEventListener('abort', () => {
    cancelAnimationFrame(raf);
    clearTimeout(droneTimer);
    stopDrone();
  }, { once: true });
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const spread = (xs) => {
  const c = xs.map((x) => x.c);
  const mu = mean(c);
  return Math.sqrt(mean(c.map((x) => (x - mu) ** 2)));
};

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** 針の目盛り（-50〜+50 セントを 180 度に） */
function gaugeSVG() {
  const pt = (c, r) => {
    const a = (c * 1.8 * Math.PI) / 180;
    return [150 + r * Math.sin(a), 150 - r * Math.cos(a)];
  };
  const arc = (c1, c2, r) => {
    const [x1, y1] = pt(c1, r);
    const [x2, y2] = pt(c2, r);
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  };
  let ticks = '';
  for (let c = -50; c <= 50; c += 5) {
    const major = c % 25 === 0;
    const [x1, y1] = pt(c, major ? 112 : c % 10 === 0 ? 118 : 122);
    const [x2, y2] = pt(c, 130);
    ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="tn-tick${major ? ' major' : ''}"/>`;
  }
  const labels = [-50, -25, 0, 25, 50].map((c) => {
    const [x, y] = pt(c, 96);
    return `<text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" class="tn-tlabel">${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 300 172" role="img" aria-label="ずれの針（左が低い、右が高い）">
    <path d="${arc(-50, 50, 138)}" class="tn-arc"/>
    <path d="${arc(-NEAR, NEAR, 138)}" class="tn-arc near"/>
    <path d="${arc(-IN, IN, 138)}" class="tn-arc in"/>
    ${ticks}${labels}
    <text x="40" y="166" class="tn-side">低い ♭</text><text x="260" y="166" class="tn-side">高い ♯</text>
  </svg>`;
}

function readColors(el) {
  const cs = getComputedStyle(el);
  const v = (n) => cs.getPropertyValue(n).trim();
  return { ink: v('--ink'), sub: v('--sub'), line: v('--line'), ok: v('--ok'), okSoft: v('--ok-soft'), warn: v('--warn'), accent: v('--accent'), ng: v('--ng'), surface: v('--surface') };
}

/** 直前 6 秒の高さ（比べている音からのずれ、±50 セント） */
function drawTrace(cv, hist, now, col, naming) {
  const w = cv.clientWidth;
  const hgt = cv.clientHeight;
  if (!w || !hgt) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hgt * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(hgt * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hgt);
  const L = 34;
  const y = (c) => hgt / 2 - (Math.max(-50, Math.min(50, c)) / 50) * (hgt / 2 - 8);
  const x = (t) => L + ((t - (now - SPAN)) / SPAN) * (w - L - 6);
  ctx.fillStyle = col.okSoft;
  ctx.fillRect(L, y(IN), w - L, y(-IN) - y(IN));
  ctx.strokeStyle = col.line;
  ctx.lineWidth = 1;
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = col.sub;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const c of [-50, -25, 0, 25, 50]) {
    ctx.globalAlpha = c === 0 ? 0.9 : 0.5;
    ctx.beginPath();
    ctx.moveTo(L, y(c));
    ctx.lineTo(w, y(c));
    ctx.stroke();
    ctx.fillText(`${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c)}`, L - 5, y(c));
  }
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let prev = null;
  let labelKey = '';
  for (const p of hist) {
    if (p.t < now - SPAN) continue;
    if (p.c == null) {
      prev = null;
      continue;
    }
    if (p.key !== labelKey) {
      labelKey = p.key;
      ctx.fillStyle = col.sub;
      const midi = Number(p.key.slice(1));
      const name = p.key[0] === 'n' ? noteParts(midi, naming).name : '';
      if (name) ctx.fillText(name, x(p.t) + 2, 4);
    }
    if (prev && prev.key === p.key && p.t - prev.t <= 0.05) {
      const a = Math.abs(p.c);
      ctx.strokeStyle = a <= IN ? col.ok : a <= NEAR ? col.warn : col.accent;
      ctx.beginPath();
      ctx.moveTo(x(prev.t), y(prev.c));
      ctx.lineTo(x(p.t), y(p.c));
      ctx.stroke();
    }
    prev = p;
  }
}

/** 倍音の棒（0〜-50 dB） */
function drawHarm(box, harm, ref, naming) {
  if (box.children.length !== 8) {
    box.replaceChildren(...Array.from({ length: 8 }, (_, i) => h('div', { class: 'tn-hb' },
      h('span', { class: 'tn-hb-bar' }, h('i')), h('b', {}, String(i + 1)), h('small', {}, ''), h('small', { class: 'tn-hb-dev' }, ''))));
  }
  [...box.children].forEach((el, i) => {
    const x = harm?.[i];
    const k = i + 1;
    el.querySelector('i').style.height = `${x ? Math.max(2, ((x.db + 50) / 50) * 100) : 0}%`;
    el.classList.toggle('top', !!x && x.db > -0.5);
    const nm = el.querySelector('small');
    const dev = el.querySelector('.tn-hb-dev');
    if (ref) {
      const m = ref.midi + Math.round(12 * Math.log2(k));
      nm.textContent = noteParts(m, naming).name.replace(/[0-9]/g, '').split('／')[0];
      const hc = harmonicCents(k);
      dev.textContent = hc ? `${hc > 0 ? '+' : '−'}${Math.abs(Math.round(hc))}` : '';
    } else {
      nm.textContent = '';
      dev.textContent = '';
    }
    el.title = x ? `${k} 倍音 ${x.db.toFixed(1)} dB` : `${k} 倍音`;
  });
}
