// 生成器どうしで使う小道具

/**
 * 候補から 1 つ選ぶ。
 * @param pool     [{ key, ... }]
 * @param ctx      { rng, prev, weight }   prev は直前の問題（streak を持つ）
 * @param o.weak   苦手ほど多く出すか（ctx.weight を使う）
 * @param o.base   (x) => 元の出やすさ
 * @param o.repeat 'never' … 直前と同じものは出さない（譜面：同じ絵が続くと変わったと分からない）
 *                 'max2'  … 同じものは 2 回までなら続けてよい（耳：選択肢が 2 つでも交互にならない）
 */
export function choose(pool, { rng, prev, weight }, { weak = false, base, repeat = 'never' } = {}) {
  const block = prev && pool.length > 1 && (repeat === 'never' || (prev.streak ?? 1) >= 2);
  const cands = block ? pool.filter((x) => x.key !== prev.key) : pool;
  const useWeight = weak && weight;
  if (!base && !useWeight) return rng.pick(cands);
  return rng.weighted(cands, (x) => (base ? base(x) : 1) * (useWeight ? weight(x.key) : 1));
}

/** 同じものが何回続いたか（choose の 'max2' 用。生成器は問題に streak として付ける） */
export const nextStreak = (prev, key) => (prev?.key === key ? (prev.streak ?? 1) + 1 : 1);

/** 苦手を多めに出す、の設定項目（どの生成器にも付ける） */
export const weakField = { key: 'weak', type: 'toggle', label: '苦手なものを多めに出す' };
