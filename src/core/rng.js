// 種つきの乱数。同じ種なら同じ問題の並びになる（「同じ問題でもう一度」「問題番号で共有」用）

export const newSeed = () => 10000 + Math.floor(Math.random() * 90000);

export function makeRng(seed = newSeed()) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  const between = (lo, hi) => lo + int(hi - lo + 1); // lo, hi を含む
  const pick = (arr) => arr[int(arr.length)];
  const shuffle = (arr) => {
    const b = arr.slice();
    for (let i = b.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  };
  /** 重みつきで 1 つ選ぶ。weight(x) が 0 以下のものは選ばない */
  const weighted = (arr, weight) => {
    const ws = arr.map((x) => Math.max(0, weight(x)));
    const sum = ws.reduce((s, w) => s + w, 0);
    if (sum <= 0) return pick(arr);
    let r = next() * sum;
    for (let i = 0; i < arr.length; i++) {
      r -= ws[i];
      if (r < 0) return arr[i];
    }
    return arr[arr.length - 1];
  };
  return { seed, next, int, between, pick, shuffle, weighted };
}
