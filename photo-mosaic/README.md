# おめでとうモザイク（写真で文字をつくるコラージュ）

スマホのアルバムから写真を選ぶだけで、「4さい おめでとう」のような文字の形に
写真を敷きつめたコラージュ画像をつくる、1ファイルだけの静的ページです。

- 写真はブラウザの中だけで処理します。サーバーへの送信はありません。
- 対応: iPhone / Android のブラウザ、PC のブラウザ（Chrome / Safari / Edge）。
- 書体は Google Fonts から読み込みます。読み込めない環境では端末のフォントで代用します。

## 使い方（スマホ）

1. ページを開き、「アルバムから写真をえらぶ」を押す。
   iPhone は「写真ライブラリ」、Android は「ギャラリー」を選ぶと複数枚まとめて選べます。
   目安は 20〜60 枚です。
2. 「文字とデザイン」で文字（改行で行分け）、書体、仕上がり、写真の大きさ、背景色、サイズを選ぶ。
   変えるたびに「できあがり」が描き直されます。
3. 「画像を保存」を押す。
   - claude.ai のアーティファクトとして開いた場合は、保存の確認が出て端末に保存されます。
   - 通常の Web ページとして開いた場合は、共有シート（iPhone）またはダウンロード（Android / PC）になります。
   - どちらも動かないときは「画像を表示」を押し、表示された画像を長押しして「写真に追加」を選びます。

縦長の写真は、顔が入りやすい上のほうを残して正方形に切り取ります。

## 印刷するとき

- サイズを「A4 よこ」または「A4 たて」（300dpi 相当）にして、JPEG で保存します。
- コンビニのネットプリントや写真店のアプリに、保存した画像をそのまま送れます。

## 公開のしかた

ビルド工程はありません。`photo-mosaic/index.html` を置くだけで動きます。

- Netlify Drop（https://app.netlify.com/drop）に `photo-mosaic` フォルダをドラッグ＆ドロップすると URL ができます。
- Git 連携の Netlify サイトにする場合は、Base directory を `photo-mosaic`、Publish directory を `photo-mosaic` にしてください。

## 動作テスト

`tests/test-mosaic.js` は Playwright（Node）で、写真の読み込み、各設定での描画、JPEG / PNG 保存、
設定の記憶、読み込めないファイルの扱いを自動で確認します。

```sh
cd photo-mosaic
python3 -m http.server 8765 --bind 127.0.0.1 &
OUT_DIR=/tmp/mosaic-out NODE_PATH="$(npm root -g)" node tests/test-mosaic.js
```

`playwright` が入っていない場合は `npm i -g playwright && npx playwright install chromium` を先に実行します。
