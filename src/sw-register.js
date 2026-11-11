// Service Worker（オフラインで使えるようにする）を登録し、新しい版が来たら知らせる
import { toast } from './ui/toast.js';

export function registerSW() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const go = async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      // 読み込み直すのは「更新する」を押したときだけ（初めて開いたときの引き継ぎでは読み込み直さない）
      let asked = false;
      const offer = (worker) =>
        toast('新しい版があります', {
          action: {
            label: '更新する',
            run: () => {
              asked = true;
              worker.postMessage('skipWaiting');
            },
          },
        });
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded || !asked) return;
        reloaded = true;
        location.reload();
      });
    } catch {
      /* 登録できない環境（file:// など）。そのまま使える */
    }
  };
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
}
