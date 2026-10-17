// おもいでプリント core.js の単体テスト（node --test で流す）
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const OP = require('../../suuji-nazori/print/core.js');

const FIX = process.env.OMOIDE_FIXTURES || path.join(__dirname, 'fixtures');
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≒ ${b}`);

test('用紙サイズ: L判 300dpi は 1051×1500px', () => {
  assert.equal(OP.mmToPx(89, 300), 1051);
  assert.equal(OP.mmToPx(127, 300), 1500);
  assert.equal(OP.mmToPx(210, 300), 2480);
  assert.equal(OP.mmToPx(297, 300), 3508);
});

test('マス割り: 2面・4面は余白とすき間を引いて等分', () => {
  const L = OP.PAPERS.L;
  const two = OP.cellsMm(L, 2);
  assert.equal(two.length, 2);
  near(two[0].w, 89 - 6);
  near(two[0].h * 2 + 3 + 6, 127);
  near(two[1].y, 3 + two[0].h + 3);
  const four = OP.cellsMm(L, 4);
  assert.equal(four.length, 4);
  near(four[0].w * 2 + 3 + 6, 89);
  near(four[3].x + four[3].w + 3, 89);
  near(four[3].y + four[3].h + 3, 127);
  assert.deepEqual(OP.cellsMm(L, 1), [{ x: 0, y: 0, w: 89, h: 127 }]);
});

test('用紙の向き: 1面で横長の写真なら用紙ごと横、設定でたてに固定もできる', () => {
  const L = OP.PAPERS.L;
  const land = { natW: 4032, natH: 3024, rot: 0 };
  const port = { natW: 3024, natH: 4032, rot: 0 };
  assert.deepEqual([OP.sheetSize(L, 1, 300, land, true).w, OP.sheetSize(L, 1, 300, land, true).h], [1500, 1051]);
  assert.deepEqual([OP.sheetSize(L, 1, 300, port, true).w, OP.sheetSize(L, 1, 300, port, true).h], [1051, 1500]);
  assert.deepEqual([OP.sheetSize(L, 1, 300, land, false).w, OP.sheetSize(L, 1, 300, land, false).h], [1051, 1500]);
  // 手で90°回した横写真は、たて写真あつかい
  const s = OP.sheetSize(L, 1, 300, { natW: 4032, natH: 3024, rot: 90 }, true);
  assert.equal(s.landscape, false);
  // 4面は常にたて
  const m = OP.sheetSize(L, 4, 300, land, true);
  assert.equal(m.landscape, false);
  assert.equal(m.cells.length, 4);
});

test('回転: 写真とマスの縦横がちがうときだけ 270° 回す', () => {
  assert.equal(OP.cellRotation(4032, 3024, 0, 1051, 1500), 270);
  assert.equal(OP.cellRotation(3024, 4032, 0, 1051, 1500), 0);
  assert.equal(OP.cellRotation(4032, 3024, 0, 1500, 1051), 0);
  assert.equal(OP.cellRotation(4032, 3024, 90, 1051, 1500), 90);
  assert.equal(OP.cellRotation(3000, 3000, 0, 1051, 1500), 0); // 正方形は回さない
  assert.equal(OP.normRot(-90), 270);
  assert.equal(OP.normRot(450), 90);
});

test('切り取り(fill): 用紙と同じ縦横比で切り、ずらしと拡大が効く', () => {
  const pl = OP.placePhoto(4000, 3000, 1500, 1051, 'fill', 0, 0, 1);
  near(pl.sw / pl.sh, 1500 / 1051, 1e-9);
  near(pl.sw, 4000);           // 横いっぱい
  near(pl.sy, (3000 - pl.sh) / 2);
  const top = OP.placePhoto(4000, 3000, 1500, 1051, 'fill', 0, -1, 1);
  near(top.sy, 0);
  const bottom = OP.placePhoto(4000, 3000, 1500, 1051, 'fill', 0, 1, 1);
  near(bottom.sy + bottom.sh, 3000);
  const z = OP.placePhoto(4000, 3000, 1500, 1051, 'fill', 0, 0, 2);
  near(z.sw, pl.sw / 2);
  near(z.sx, (4000 - z.sw) / 2);
  const over = OP.placePhoto(4000, 3000, 1500, 1051, 'fill', 0, 5, 0.3); // はみ出し値はおさえる
  near(over.sy + over.sh, 3000);
  near(over.sw, pl.sw);
  assert.deepEqual([pl.dx, pl.dy, pl.dw, pl.dh], [0, 0, 1500, 1051]);
});

test('切り取り(fit): ぜんぶ入れて、まん中に置く', () => {
  const pl = OP.placePhoto(3000, 4000, 1500, 1051, 'fit');
  assert.deepEqual([pl.sx, pl.sy, pl.sw, pl.sh], [0, 0, 3000, 4000]);
  near(pl.dh, 1051);
  near(pl.dw, 1051 * 3000 / 4000);
  near(pl.dx, (1500 - pl.dw) / 2);
});

test('年齢: 月の日にちが誕生日に届いたら1か月', () => {
  const d = (s) => { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd, 10); };
  assert.deepEqual(OP.ageAt('2023-03-10', d('2026-05-05')).years, 3);
  assert.deepEqual(OP.ageAt('2023-03-10', d('2026-05-05')).months, 1);
  const a2 = OP.ageAt('2023-03-10', d('2025-12-24'));
  assert.deepEqual([a2.years, a2.months], [2, 9]);
  const a3 = OP.ageAt('2023-03-10', d('2026-03-10'));
  assert.deepEqual([a3.years, a3.months], [3, 0]);
  const a4 = OP.ageAt('2023-03-10', d('2026-03-09'));
  assert.deepEqual([a4.years, a4.months], [2, 11]);
  // 31日うまれ: 2月は最終日に1か月
  assert.equal(OP.ageAt('2024-01-31', d('2024-02-29')).months, 1);
  assert.equal(OP.ageAt('2024-01-31', d('2024-02-28')).months, 0);
  // うまれる前は null、うまれた日は 0日
  assert.equal(OP.ageAt('2026-10-01', d('2026-09-30')), null);
  assert.equal(OP.ageAt('2026-10-01', d('2026-10-01')).days, 0);
  assert.equal(OP.ageAt('2026-10-01', d('2026-10-13')).days, 12);
  assert.equal(OP.ageAt('2026-02-30', d('2026-10-13')), null); // ない日付
  assert.equal(OP.ageAt('', d('2026-10-13')), null);
});

test('年齢の書き方', () => {
  assert.equal(OP.ageText({ years: 3, months: 5, days: 0 }, 'kana'), '3さい5かげつ');
  assert.equal(OP.ageText({ years: 3, months: 5, days: 0 }, 'kanji'), '3歳5か月');
  assert.equal(OP.ageText({ years: 3, months: 0, days: 0 }, 'kana'), '3さい');
  assert.equal(OP.ageText({ years: 0, months: 7, days: 0 }, 'kana'), '7かげつ');
  assert.equal(OP.ageText({ years: 0, months: 0, days: 12 }, 'kana'), 'うまれて12にち');
  assert.equal(OP.ageText({ years: 0, months: 0, days: 12 }, 'kanji'), '生後12日');
  assert.equal(OP.ageText(null, 'kana'), '');
});

test('日付の書き方', () => {
  const t = new Date(2026, 4, 5, 10);
  assert.equal(OP.dateText(t, 'film'), "'26 5 5");
  assert.equal(OP.dateText(t, 'plain'), '2026.5.5');
  assert.equal(OP.dateText(null, 'film'), '');
});

test('写真に入れる文字: 撮影日がない写真には何も入れない', () => {
  const t = new Date(2026, 4, 5, 10);
  const kids = [{ name: 'つばき', birth: '2023-03-10' }, { name: 'はると', birth: '2026-08-01' }, { name: '', birth: '2025-05-05' }];
  assert.deepEqual(OP.stampLines({ mode: 'none', date: t, kids }), []);
  assert.deepEqual(OP.stampLines({ mode: 'age', date: null, kids }), []);
  assert.deepEqual(OP.stampLines({ mode: 'date', date: t, kids, dateStyle: 'film' }), ["'26 5 5"]);
  // はるとはまだうまれていないので出さない。名前なしの子は年齢だけ
  assert.deepEqual(OP.stampLines({ mode: 'age', date: t, kids, dateStyle: 'plain', ageStyle: 'kana' }),
    ['2026.5.5', 'つばき 3さい1かげつ・1さい']);
});

test('文字の大きさ: 短い辺の3.6%、2.2〜6mm、フチなしは5mm内側', () => {
  const px = 300 / 25.4;
  const L = OP.stampMetrics({ x: 0, y: 0, w: 1500, h: 1051 }, px, true);
  near(L.font / px, 89 * 0.036, 0.01);
  near(L.inset / px, 5, 1e-9);
  const small = OP.stampMetrics({ x: 0, y: 0, w: 472, h: 697 }, px, false); // 4面のマス
  near(small.font / px, 2.2, 1e-9);
  near(small.inset / px, 2.5, 1e-9);
  const big = OP.stampMetrics({ x: 0, y: 0, w: 2480, h: 3508 }, px, true); // A4
  near(big.font / px, 6, 1e-9);
});

test('文字の向き: 自動で回したぶんだけ回す（手で回したぶんは除く）', () => {
  assert.equal(OP.autoTurn(270, 0), 270);
  assert.equal(OP.autoTurn(0, 0), 0);
  assert.equal(OP.autoTurn(90, 90), 0);
  assert.equal(OP.autoTurn(0, 90), 270); // 手で90°回したあと、さらに自動で270°回した
});

test('EXIF: Pillow で書いた撮影日・秒以下・向きを読める', () => {
  const land = OP.readExif(ab(fs.readFileSync(path.join(FIX, 'land_exif.jpg'))));
  assert.equal(land.raw, '2026:05:05 10:00:00');
  assert.equal(land.subsec, '120');
  assert.equal(land.orientation, 1);
  assert.equal(land.date.getFullYear(), 2026);
  assert.equal(land.date.getMonth(), 4);
  assert.equal(land.date.getDate(), 5);
  assert.equal(land.date.getHours(), 10);
  const o6 = OP.readExif(ab(fs.readFileSync(path.join(FIX, 'portrait_orient6.jpg'))));
  assert.equal(o6.orientation, 6);
  assert.equal(o6.raw, '2026:05:05 10:05:00');
  assert.equal(OP.readExif(ab(fs.readFileSync(path.join(FIX, 'noexif.jpg')))), null);
  assert.equal(OP.readExif(ab(fs.readFileSync(path.join(FIX, 'other.png')))), null);
});

test('EXIF: ビッグエンディアン（MM）も読める・こわれたデータは null', () => {
  // 手で組み立てた最小の JPEG + EXIF（MM）
  const date = '2024:07:07 07:07:07\0'; // 20 バイト
  const tiff = [];
  const u16 = (v) => tiff.push((v >> 8) & 255, v & 255);
  const u32 = (v) => { u16((v >>> 16) & 0xFFFF); u16(v & 0xFFFF); };
  tiff.push(0x4D, 0x4D); u16(42); u32(8);           // ヘッダ、IFD0 は 8
  u16(1); u16(0x8769); u16(4); u32(1); u32(26); u32(0); // IFD0: ExifIFD へのポインタ（26）
  u16(1); u16(0x9003); u16(2); u32(20); u32(44); u32(0); // ExifIFD: DateTimeOriginal（44）
  for (const ch of date) tiff.push(ch.charCodeAt(0));
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = app1.length + 2;
  const jpg = Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE1, len >> 8, len & 255, ...app1, 0xFF, 0xD9]);
  const r = OP.readExif(jpg.buffer);
  assert.equal(r.raw, '2024:07:07 07:07:07');
  assert.equal(r.date.getSeconds(), 7);
  // 途中で切れたデータ、でたらめなデータ
  assert.equal(OP.readExif(jpg.slice(0, 30).buffer), null);
  assert.equal(OP.readExif(Uint8Array.from([1, 2, 3, 4, 5]).buffer), null);
  assert.equal(OP.readExif(new ArrayBuffer(0)), null);
  assert.equal(OP.exifDate('0000:00:00 00:00:00'), null);
});

test('似ている判定: dHash の距離と撮影時刻で決める', () => {
  const g = (f) => Array.from({ length: 72 }, (_, i) => f(i % 9, Math.floor(i / 9)));
  const a = OP.dHash(g((x) => 100 - x * 5));      // 左が明るい
  const b = OP.dHash(g((x) => x * 5));            // 右が明るい
  assert.equal(a.length, 16);
  assert.equal(OP.hamming(a, a), 0);
  assert.equal(OP.hamming(a, b), 64);
  assert.equal(OP.hamming(a, null), 64);
  const t = (min) => new Date(2026, 4, 5, 10, min);
  const flip = (h, n) => { const v = (parseInt(h.slice(-4), 16) ^ ((1 << n) - 1)).toString(16).padStart(4, '0'); return h.slice(0, -4) + v; };
  const items = [
    { hash: a, date: t(0) },
    { hash: flip(a, 8), date: t(1) },   // 距離8・1分差 → 似ている
    { hash: flip(a, 8), date: t(120) }, // 距離8・2時間差 → 似ていない（厳しいほう）
    { hash: b, date: t(0) },            // まったく違う
    { hash: flip(b, 5), date: null }    // 距離5・時刻不明 → b と似ている
  ];
  const ids = OP.groupSimilar(items);
  assert.equal(ids[0], ids[1]);
  assert.notEqual(ids[0], null);
  assert.equal(ids[3], ids[4]);
  assert.notEqual(ids[3], ids[0]);
  // 2時間後の写真は、1分後の写真とは距離0なのでまとまる（同じ写真のコピーとみなす）
  assert.equal(OP.hamming(items[1].hash, items[2].hash), 0);
  assert.equal(ids[2], ids[1]);
  assert.deepEqual(OP.groupSimilar([{ hash: a, date: null }]), [null]);
});

test('似ている判定: 形が近くても色合いがちがえば別の写真', () => {
  const h = '0000004040000000';
  const yellowGreen = [].concat(...Array(8).fill([255, 220, 0]), ...Array(8).fill([40, 160, 60]));
  const redBlue = [].concat(...Array(8).fill([220, 30, 30]), ...Array(8).fill([30, 60, 220]));
  const yellowGreen2 = yellowGreen.map((v) => Math.min(255, v + 10)); // 少し明るいだけ
  assert.equal(OP.colorDist(yellowGreen, yellowGreen), 0);
  near(OP.colorDist(yellowGreen, yellowGreen2), 10 * 40 / 48, 1e-9); // 255 の8個は増えない
  assert.ok(OP.colorDist(yellowGreen, redBlue) > OP.SIMILAR.maxColorDist);
  const t = new Date(2026, 4, 5, 10, 0);
  const ids = OP.groupSimilar([
    { hash: h, date: t, color: yellowGreen },
    { hash: h, date: t, color: redBlue },
    { hash: h, date: t, color: yellowGreen2 }
  ]);
  assert.equal(ids[0], ids[2]);
  assert.notEqual(ids[0], null);
  assert.equal(ids[1], null);
  assert.equal(OP.colorDist(null, redBlue), 0); // 色がないときは形だけで決める
});

test('くっきり度: 平らな画像は0、しま模様は大きい', () => {
  const w = 16, h = 16;
  assert.equal(OP.sharpness(new Array(w * h).fill(128), w, h), 0);
  const stripes = Array.from({ length: w * h }, (_, i) => ((i % w) % 2 ? 255 : 0));
  assert.ok(OP.sharpness(stripes, w, h) > 10000);
});

test('用紙への割り当て: 枚数と、はずした写真', () => {
  const ph = [{ on: true, copies: 1 }, { on: false, copies: 3 }, { on: true, copies: 3 }, { on: true, copies: 0 }];
  assert.deepEqual(OP.buildSheets(ph, 1), [[0], [2], [2], [2], [3]]);
  assert.deepEqual(OP.buildSheets(ph, 4), [[0, 2, 2, 2], [3]]);
  assert.deepEqual(OP.buildSheets(ph, 2), [[0, 2], [2, 2], [3]]);
  assert.deepEqual(OP.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(OP.chunk([1, 2, 3], 0), [[1, 2, 3]]);
  assert.deepEqual(OP.chunk([], 0), []);
});

test('印刷済みのキー: 撮影日時があればそれ、なければ中身のハッシュ', () => {
  const ex = { raw: '2026:05:05 10:00:00', subsec: '120' };
  assert.equal(OP.printedKey(ex, 4032, 3024, 'zz'), 'x:2026:05:05 10:00:00.120:4032x3024');
  assert.equal(OP.printedKey(ex, 3024, 4032, 'zz'), 'x:2026:05:05 10:00:00.120:4032x3024'); // 向きがちがっても同じ
  assert.equal(OP.printedKey(null, 10, 10, 'abc'), 'h:abc');
  assert.equal(OP.printedKey({ raw: null }, 10, 10, null), null);
});
