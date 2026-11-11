// ゲーム = 生成器（何を出すか）× 遊び方（どう出すか）
// 新しいゲームはここに 1 行足すだけ。生成器は generators/、遊び方は modes/ にある
import { GENERATORS } from './generators/index.js';
import { mountFlash } from './modes/flash.js';
import { mountQuiz } from './modes/quiz.js';
import { mountRhythm } from './modes/rhythm.js';
import { mountTap } from './modes/tap.js';
import { mountBattle } from './modes/battle.js';

export const MODES = { flash: mountFlash, quiz: mountQuiz, rhythm: mountRhythm, tap: mountTap, battle: mountBattle };

export const GROUPS = [
  { id: 'read', title: '読む', lead: '五線の音符を読む' },
  { id: 'beat', title: '刻む', lead: 'リズム譜を見て叩く' },
  { id: 'ear', title: '聴く', lead: '鳴った音を聞き取る' },
];

export const GAMES = [
  {
    id: 'flash', group: 'read', mode: 'flash', gen: 'reading', icon: 'flash',
    title: '譜読みフラッシュ',
    lead: '音符が次々に光ります。消えたら、出た順に音名を答えてください。検定は 10級 から 五段 まで。',
    modeDefaults: { style: 'free', display: 'flash', count: 5, ms: 800, startLevel: '0', flashSound: false },
  },
  {
    id: 'quick', group: 'read', mode: 'quiz', gen: 'reading', icon: 'quick',
    title: '譜読み即答',
    lead: '1音ずつ出ます。できるだけ速く答えてください。苦手な音は「記録」で見られます。',
    lengths: ['time30', 'time60', 'count20', 'count50', 'endless'],
    modeDefaults: { length: 'time60', feedback: 'fast' },
  },
  {
    id: 'rhythm', group: 'read', mode: 'rhythm', gen: 'reading', icon: 'rhythm',
    title: '譜読みリズム',
    lead: '右から流れてくる音符を、縦の線に重なった瞬間に答えます。当たると音符の音が鳴り、メロディーになります。',
    modeDefaults: { pad: 'keys', bpm: 72, density: 'every2', length: 'n32', metronome: true, pitch: true, offset: 0 },
  },
  {
    id: 'battle', group: 'read', mode: 'battle', gen: 'reading', icon: 'battle',
    title: 'オトバトル',
    lead: '降りてくる敵の五線を読み、その音を答えて撃ちます。ステージの最後はフレーズを持ったボス。四方から迫る戦い方もあります。',
    modeDefaults: { field: 'fall', course: 'set', length: 's3', speed: 'normal', look: 'always', flashMs: 900, pad: 'keys', hint: false, colors: false, pitch: true },
  },
  {
    id: 'tap', group: 'beat', mode: 'tap', gen: 'rhythmPattern', icon: 'tap',
    title: 'リズム練習',
    lead: 'リズム譜を見て、メトロノームに合わせて音符のところで叩きます。お手本を聞いてからでも。',
    modeDefaults: { bpm: 80, count: 'n8', listen: true, metronome: true, offset: 0 },
  },
  {
    id: 'pitch', group: 'ear', mode: 'quiz', gen: 'pitch', icon: 'pitch',
    title: '音名当て',
    lead: '鳴った音の名前を答えます。基準の音（ド）を先に鳴らすと相対音感、なしにすると絶対音感の練習です。',
    lengths: ['count10', 'count20', 'count50', 'time60', 'endless'],
    modeDefaults: { length: 'count20', feedback: 'study' },
  },
  {
    id: 'interval', group: 'ear', mode: 'quiz', gen: 'interval', icon: 'interval',
    title: '音程当て',
    lead: '2つの音の隔たり（何度か）を答えます。まちがえたら、選んだ音程と聞き比べられます。',
    lengths: ['count10', 'count20', 'count50', 'time60', 'endless'],
    modeDefaults: { length: 'count20', feedback: 'study' },
  },
  {
    id: 'chord', group: 'ear', mode: 'quiz', gen: 'chord', icon: 'chord',
    title: 'コード聞き取り',
    lead: '鳴った和音の種類（メジャー・マイナー…）を答えます。根音は毎回変わります。',
    lengths: ['count10', 'count20', 'count50', 'time60', 'endless'],
    modeDefaults: { length: 'count20', feedback: 'study' },
  },
];

export const gameById = (id) => GAMES.find((g) => g.id === id);
export const genOf = (game) => GENERATORS[game.gen];
