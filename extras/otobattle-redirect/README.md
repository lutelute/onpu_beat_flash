# 元の otobattle からの案内ページ

公開中の https://lutelute.github.io/otobattle/ を開いた人を、音符ビートフラッシュの中のオトバトルへ案内するページです。
元のリポジトリ（`~/dev/github/game/otobattle`、GitHub の `lutelute/otobattle`）にはまだ何もしていません。

## 使い方（音符ビートフラッシュの公開先が決まってから）

1. `index.html` の URL（3 か所と `NEW_URL`）を、決まった公開先の `…/#/game/battle?from=otobattle` に書き換える。`?from=otobattle` が付いていると、オトバトルは「四方から・だんだん広がる」（前の版と同じ遊び方）で開きます。
2. 元の otobattle のリポジトリで、GitHub Pages に出すものをこのページだけにする。
   - いまは `.github/workflows/deploy.yml` が Vite でビルドした `dist/` を出している。
   - 例：`dist/` の代わりにこのページを置いたフォルダを出すよう workflow を書き換える（またはビルドの最後に `dist/index.html` をこのページで上書きする）。
3. README の「Play:」の行を新しい URL に替え、リポジトリの説明に「音符ビートフラッシュに移りました」と書く。

## 前の記録

前のオトバトルの最高点は、ブラウザの `localStorage` の `otobattle_best_score` に入っています。
音符ビートフラッシュも `lutelute.github.io` で公開すれば同じ場所として読めるので、
オトバトルの設定の画面に「もとのオトバトルの最高点」として出します（点の付け方が違うので、新しいハイスコアとは別にしています）。
