# 購買管理 入社後プラン

購買管理スタッフ（富山）として、入社後1年の進め方と、ベテランバイヤーへの取適法の浸透プランをまとめたアプリです。
同じ中身を2つの形で使えます。

| | claude.ai のリンク版 | ホーム画面のアプリ版（このフォルダ） |
|---|---|---|
| 開き方 | https://claude.ai/artifact/Mo9HhwZifXRoUydPzp2xu2 | Netlify に置いた URL をホーム画面に追加 |
| アイコン | claude.ai 側のもの（自分では決められない） | 藍色の地に路線バスの絵（`icons/`。会社のロゴは使っていない） |
| 見られる人 | 自分だけ（非公開） | URL を知っている人なら誰でも |
| チェックの保存先 | claude.ai のアカウント（スマホと PC で同じ） | その iPhone の中だけ |
| 電波がないとき | 開けない | 一度開いていれば開ける |

## iPhone に入れる

### A. claude.ai のリンク版をホーム画面に置く

1. iPhone の Safari で https://claude.ai/artifact/Mo9HhwZifXRoUydPzp2xu2 を開きます（claude.ai にログインした状態で）。
2. 共有ボタン（四角から上向きの矢印が出ているマーク）をタップします。見当たらないときは画面下の「…」の中にあります（iOS のバージョンによって場所が違います）。
3. 「ホーム画面に追加」をタップし、名前を「購買プラン」にして「追加」をタップします。

### B. アプリ版をホーム画面に置く

最初の1回だけ、次の2つが必要です。

1. **GitHub でこのフォルダを取り込む**：このフォルダを追加したプルリクエストを「Merge」します。
2. **Netlify に新しいサイトを作る**：
   1. https://app.netlify.com を開き、「Add new site」→「Import an existing project」→「GitHub」を選びます。
   2. リポジトリ `hagukumin` を選びます。
   3. 「Base directory」に `kobai-plan` と入力します。ほかの欄は空のままで大丈夫です（このフォルダの `netlify.toml` の設定が使われます）。
   4. 「Deploy」をタップします。終わると `〜.netlify.app` の URL が出ます。

あとは iPhone の Safari でその URL を開き、A の 2〜3 と同じ手順で「ホーム画面に追加」します。

> ルートの `netlify.toml` は「すうじとなかまたち」用です。新しいサイトで Base directory を入れ忘れると、すうじのアプリが出てきます。そのときは Netlify の「Site configuration」→「Build & deploy」で Base directory を `kobai-plan` に直してください。

## 直すとき

- 中身は `page.html` だけを直します。claude.ai のリンク版も、この `page.html` から公開しています。
- 直したら `python3 build.py` を実行して、アプリ版の `index.html` と `sw.js` を作り直します。
  `python3 build.py --check` で、作り直し忘れがないか確かめられます。
- アイコンを作り直すときは `python3 tools/make_icons.py` を実行し、そのあと `python3 build.py` も実行します（Pillow が必要です）。
- Netlify と GitHub をつないだあとは、マージするたびに Netlify が自動で公開し直します。iPhone のアプリ版は、電波のあるところで開いたときに新しい中身に切り替わります。

## ファイル

| ファイル | 役割 |
|---|---|
| `page.html` | アプリ本体（ここを直す） |
| `build.py` | `page.html` からアプリ版を作るスクリプト |
| `index.html` / `sw.js` | `build.py` が作るアプリ版（直接は直さない） |
| `manifest.webmanifest` | ホーム画面に置いたときの名前・アイコン |
| `icons/` | アイコン（180px は iPhone 用） |
| `tools/make_icons.py` | アイコンを作るスクリプト |
| `netlify.toml` | Netlify で公開するときの設定 |
