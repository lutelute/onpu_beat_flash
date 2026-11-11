// 設定と問題番号をリンクにして配る（先生が生徒に同じ問題を出すなど）
//   #/game/<id>?s=<設定と種を JSON にして base64url>
import { sanitizeSettings } from '../core/settings.js';
import { toast } from '../ui/toast.js';

const enc = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const dec = (str) => JSON.parse(decodeURIComponent(escape(atob(str.replace(/-/g, '+').replace(/_/g, '/')))));

export function shareURL(game, gs, ms, seed) {
  const payload = { g: gs, m: ms };
  if (seed) payload.seed = seed;
  return `${location.origin}${location.pathname}#/game/${game.id}?s=${enc(payload)}`;
}

/**
 * リンクに入っていた設定を読む。設定項目の定義に照らして、正しい値だけにする
 * @returns {{ gs, ms, seed } | null}
 */
export function readShared(query, { gen, game, modeFields }) {
  const raw = new URLSearchParams(query || '').get('s');
  if (!raw) return null;
  try {
    const p = dec(raw);
    const seed = Number.isInteger(p.seed) && p.seed > 0 && p.seed < 1e9 ? p.seed : null;
    return {
      gs: sanitizeSettings(p.g, gen.defaults, gen.fields),
      ms: sanitizeSettings(p.m, game.modeDefaults, modeFields),
      seed,
    };
  } catch {
    toast('リンクの設定を読めませんでした。いつもの設定で開きます');
    return null;
  }
}

/** 共有する：スマホは共有シート、パソコンはクリップボードへ */
export async function shareLink(url, title) {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('リンクをコピーしました。送った相手は同じ設定で始められます');
  } catch {
    toast(`このリンクを送ってください: ${url}`, { ms: 12000 });
  }
}
