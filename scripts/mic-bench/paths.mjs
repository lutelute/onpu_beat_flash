import { homedir } from 'node:os';
import { join } from 'node:path';

/** 録音のキャッシュの置き場所（リポジトリの外） */
export const cacheDir = () => process.env.MIC_BENCH_DIR || join(homedir(), '.cache', 'onpu-mic-bench');
