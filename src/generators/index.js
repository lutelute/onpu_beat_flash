// 生成器（Generator）の一覧と約束
//
// 生成器は「設定」と「乱数」から 1 問ずつ作る純粋な部品。画面にも音にも触らない。
// 遊び方（modes/）は生成器の約束だけを見て動くので、組み合わせを増やすのは games.js に 1 行足すだけ。
//
// Generator = {
//   id, title,
//   space,                       成績の置き場（stats の名前）
//   spaces?, spaceOf?(s)         設定によって置き場を分けるとき（例: 基準の音あり／なし）
//   defaults,                    設定の初期値
//   fields(s) → Field[]          設定項目（ui/form.js が画面にする）
//   presets? → [{label, values}] よく使う組み合わせ
//   pool(s) → [{ key, ... }]     出しうる「もの」（苦手の重みづけ・成績表に使う）
//   allKeys() → key[]            どの設定でもありうる key の全部（記録の画面で、知らない key を除く）
//   make(s, ctx) → Question      1 問作る。ctx = { rng, prev, weight(key) }
//   answerPad(s) → PadSpec       答えの入れ方 name7 / piano / chroma / choices（ui/pads.js）
//   answerLabel(id, s, naming)   答えの id を表示用の文字に
//   keyLabel(key, s, naming)     成績表で key を表示用の文字に
//   summary(s) → string          いまの設定のひとこと（ホームの札に出す）
//   signature(s) → string        記録を分ける鍵（設定が違う記録をまぜない）
// }
//
// Question = {
//   key,                         成績の鍵（pool の key と同じ）
//   answer,                      正解の id（文字列）
//   prompt,                      { type:'staff', clef, step, frame } | { type:'audio', events }
//   reveal(naming) → string      答え合わせで見せる文
//   sound?                       答えたあとに鳴らす音（events）
//   compare?(id) → events        「選んだ答えを聞く」用
// }
//
// events = [{ midi: number[], t: 開始秒, d: 長さ秒 }]

import { reading } from './reading.js';
import { pitch } from './pitch.js';
import { interval } from './interval.js';
import { chord } from './chord.js';
import { rhythmPattern } from './rhythmPattern.js';

export const GENERATORS = { reading, pitch, interval, chord, rhythmPattern };
