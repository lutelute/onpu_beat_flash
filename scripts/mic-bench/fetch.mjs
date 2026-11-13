// ベンチマークの録音を手元のキャッシュに取ってくる（取ってあるものは取らない）
//   node scripts/mic-bench/fetch.mjs        キャッシュは ~/.cache/onpu-mic-bench（MIC_BENCH_DIR で変えられる）
import { existsSync, mkdirSync, statSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SETS, CHORD_NOTES, urlOf } from './manifest.mjs';
import { cacheDir } from './paths.mjs';

const DIR = cacheDir();
const ok = (p) => {
  if (!existsSync(p) || statSync(p).size < 2000) return false;
  const fd = openSync(p, 'r');
  const head = Buffer.alloc(4);
  readSync(fd, head, 0, 4, 0);
  closeSync(fd);
  return ['FORM', 'RIFF'].includes(head.toString('ascii'));
};

const jobs = [...SETS, CHORD_NOTES].flatMap((set) => set.files.map((f) => ({ url: urlOf(set, f), range: set.range, path: join(DIR, set.id, f.split('/').pop()) })));
let done = 0;
let got = 0;
const failed = [];
async function worker() {
  for (let j = jobs.shift(); j; j = jobs.shift()) {
    if (!ok(j.path)) {
      try {
        const res = await fetch(j.url, j.range ? { headers: { Range: `bytes=0-${j.range - 1}` } } : {});
        if (!res.ok) throw new Error(`${res.status}`);
        mkdirSync(dirname(j.path), { recursive: true });
        writeFileSync(j.path, Buffer.from(await res.arrayBuffer()));
        if (!ok(j.path)) throw new Error('音のファイルではない');
        got++;
      } catch (e) {
        failed.push(`${j.url}（${e.message}）`);
      }
    }
    done++;
    if (done % 20 === 0) process.stdout.write(`${done} `);
  }
}
const total = jobs.length;
await Promise.all(Array.from({ length: 4 }, worker));
console.log(`\n${total} 個のうち、新しく取った ${got}・取れなかった ${failed.length}（置き場所 ${DIR}）`);
if (failed.length) console.log(failed.join('\n'));
process.exit(failed.length ? 1 : 0);
