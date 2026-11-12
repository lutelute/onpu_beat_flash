// 共通の設定（音名の呼び方・音・表示）。ホームの設定画面と保存データの検査で使う
import { NAMINGS, NAMING_ORDER } from './music.js';
import { MIC_INSTRUMENTS, MIC_SENS } from './pitch.js';

export const GLOBAL_DEFAULTS = {
  naming: 'doremi',
  sound: true,
  volume: 0.7,
  keyHints: true,
  midi: false,
  mic: false,
  micInstrument: 'any',
  micSens: 3, // ふつう（今までと同じ聞こえ方）
  micPhones: false,
  theme: 'auto',
};

export const globalFields = () => [
  {
    key: 'naming', type: 'segmented', label: '音名の呼び方',
    options: NAMING_ORDER.map((id) => ({ id, label: `${NAMINGS[id].label}（${NAMINGS[id].names.slice(0, 3).join(' ')}…）` })),
  },
  { key: 'sound', type: 'toggle', label: '譜読みで答え合わせの音を鳴らす' },
  { key: 'volume', type: 'slider', label: '音量', min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
  {
    key: 'keyHints', type: 'toggle', label: 'ボタンにキーボードのキーを表示',
    note: 'パソコンでは C D E F G A B や 1〜7 のキーで答えられます。Shift を押しながらで ♯。ドイツ音名では H がシ、12音のときの B が B♭',
  },
  {
    key: 'midi', type: 'toggle', label: 'MIDI 鍵盤で答える',
    note: 'つないだ電子ピアノなどの鍵盤で答えられます（Chrome・Edge）。iPhone・iPad の Safari は対応していません',
  },
  {
    key: 'mic', type: 'toggle', label: 'マイクで答える（楽器・声）',
    note: '楽器を弾くか歌うと、聞こえた音の高さで答えられます。音名で答えるゲームでは、どのオクターブでも同じ答えです。アプリの音が鳴っているあいだは聞きません（イヤホンを使うと聞きまちがいが減ります）。iPhone・iPad は Safari でマイクを許可すると使えます',
  },
  {
    key: 'micInstrument', type: 'select', label: 'マイクで聞く楽器', show: (s) => s.mic,
    options: MIC_INSTRUMENTS.map(({ id, label }) => ({ id, label })),
    note: '選ぶと、その楽器の音域の外の音は聞かないので、1オクターブずれた聞きまちがいが減ります。ギターとコントラバス・ベースは楽譜より1オクターブ低く鳴るので、1オクターブ上げて受け取ります（楽譜に書いた高さで答えになります）。歌うときは「声」を選ぶと、歌い始めのすくい上げが落ち着くのを待ってから答えます（少しだけ遅くなります）',
  },
  {
    key: 'micSens', type: 'segmented', label: 'マイクの感度', show: (s) => s.mic,
    options: MIC_SENS.map(({ id, label }) => ({ id, label })),
    note: '弾いていないのに音が出るときは低く、小さな音や離れた音を拾わないときは高くします。「マイクで答える」の下の「周りの音を測る」で、部屋に合わせて選ぶこともできます',
  },
  {
    key: 'micPhones', type: 'toggle', label: 'イヤホンで聞いている（アプリの音のあいだもマイクを止めない）',
    note: 'スピーカーで鳴らしているときはオフのままに。オンにすると、問題や答え合わせの音が鳴っていても続けて答えられ、当たったときの音も鳴らします',
  },
  {
    key: 'theme', type: 'segmented', label: '画面の明るさ',
    options: [{ id: 'auto', label: '端末に合わせる' }, { id: 'light', label: '明るい' }, { id: 'dark', label: '暗い' }],
  },
];
