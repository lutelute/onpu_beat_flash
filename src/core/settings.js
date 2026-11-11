// 保存してある設定を、設定項目の定義（Field[]）に照らして確かめる
// 古い版で保存した値・手で書き換えた値・壊れた値があっても、生成器が落ちないようにする

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {object} saved     保存してあった値（何が入っていてもよい）
 * @param {object} defaults  初期値（ここにある項目だけを返す）
 * @param {(s)=>Array} [fields] 設定項目の定義
 * @returns {object} defaults と同じ項目を持つ、正しい値だけの設定
 */
export function sanitizeSettings(saved, defaults, fields) {
  const out = { ...defaults };
  if (!isObj(saved)) return out;
  const list = fields ? fields(defaults) : [];
  const byKey = Object.fromEntries(list.map((f) => [f.key, f]));
  for (const k of Object.keys(defaults)) {
    if (!(k in saved)) continue;
    const v = saved[k];
    const f = byKey[k];
    const def = defaults[k];
    if (!f) {
      // 項目の定義が無いものは、型が同じなら受け取る
      if (typeof v === typeof def && Array.isArray(v) === Array.isArray(def) && (typeof v !== 'number' || Number.isFinite(v))) out[k] = v;
      continue;
    }
    const ids = f.options?.map((o) => o.id);
    switch (f.type) {
      case 'multi': {
        if (!Array.isArray(v)) break;
        const ok = ids.filter((id) => v.includes(id)); // 並びは定義の順、重なりなし
        if (ok.length >= (f.min ?? 1)) out[k] = ok;
        break;
      }
      case 'segmented':
      case 'select':
        if (ids.includes(v)) out[k] = v;
        break;
      case 'toggle':
        if (typeof v === 'boolean') out[k] = v;
        break;
      case 'slider':
      case 'stepper':
        if (typeof v === 'number' && Number.isFinite(v) && v >= f.min && v <= f.max) out[k] = v;
        break;
      default:
        break;
    }
  }
  return out;
}

/** 成績の 1 件が使える形か */
export function validStat(s) {
  return isObj(s) && [s.n, s.ok, s.ms, s.msN].every((x) => Number.isFinite(x) && x >= 0) && s.ok <= s.n && isObj(s.conf);
}
