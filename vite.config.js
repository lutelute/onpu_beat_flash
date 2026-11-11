import { defineConfig } from 'vite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// ビルドのたびに Service Worker（sw.js）を作る。出力したファイルを全部入れておき、オフラインで開けるようにする
function serviceWorker() {
  return {
    name: 'onpu-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      // public/ のうち、アプリが使うもの（maskable の元 SVG と共有用の大きな画像は除く）
      const pub = readdirSync('public').filter((f) => !f.startsWith('.') && !['icon-maskable.svg', 'og.png'].includes(f));
      const files = [...new Set(['./', './index.html', ...[...built, ...pub].map((f) => `./${f}`)])];
      const version = createHash('sha256').update(files.join('\n') + pkg.version + built.map((f) => bundle[f].code ?? '').join('')).digest('hex').slice(0, 12);
      const source = readFileSync(new URL('./src/sw-template.js', import.meta.url), 'utf8')
        .replaceAll('__CACHE__', `onpu-${version}`)
        .replaceAll('__ASSETS__', JSON.stringify(files));
      if (source.includes('__CACHE__') || source.includes('__ASSETS__')) this.error('sw.js の埋め込みに失敗しました');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// base: './' で、どのフォルダに置いても（GitHub Pages など）そのまま動く
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  plugins: [serviceWorker()],
});
