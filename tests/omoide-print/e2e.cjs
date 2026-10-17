// おもいでプリント 画面テスト（Chromium・iPhone の画面サイズ）
// 使い方: run.sh から呼ぶ（BASE_URL・FIXTURES・SHOTS を環境変数でわたす）
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium, devices } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8765/print/';
const FIX = process.env.FIXTURES || path.join(__dirname, 'fixtures');
const SHOTS = process.env.SHOTS || '';
const ALL = ['land_exif.jpg', 'land2_exif.jpg', 'portrait_orient6.jpg', 'dup_sharp.jpg', 'dup_blur.jpg', 'noexif.jpg', 'other.png']
  .map((n) => path.join(FIX, n));

let passed = 0;
let currentPage = null;
async function step(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) {
    console.log('FAIL ' + name);
    if (SHOTS && currentPage) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await currentPage.screenshot({ path: path.join(SHOTS, 'FAIL.png') }).catch(() => {});
    }
    throw e;
  }
}

// navigator.share / window.print をテスト用に差しかえる（受け取ったファイルを記録するだけ）
function initScript() {
  window.__shared = [];
  window.__sharedFiles = [];
  window.__printCalls = 0;
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d) => !!(d && d.files && d.files.length) });
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: async (d) => {
      const info = [];
      for (const f of d.files) {
        const bmp = await createImageBitmap(f);
        info.push({ name: f.name, type: f.type, size: f.size, w: bmp.width, h: bmp.height });
        bmp.close();
      }
      window.__shared.push(info);
      window.__sharedFiles.push(Array.from(d.files));
    }
  });
  window.print = () => { window.__printCalls++; };
}

// 書き出した画像の、ある範囲の色の平均と、オレンジの点の数
async function regionStats(page, batch, idx, rx, ry, rw, rh) {
  return page.evaluate(async ([batch, idx, rx, ry, rw, rh]) => {
    const f = window.__sharedFiles[batch][idx];
    const bmp = await createImageBitmap(f);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext('2d');
    x.drawImage(bmp, 0, 0);
    const X = Math.round(rx * c.width), Y = Math.round(ry * c.height);
    const W = Math.max(1, Math.round(rw * c.width)), H = Math.max(1, Math.round(rh * c.height));
    const d = x.getImageData(X, Y, W, H).data;
    let r = 0, g = 0, b = 0, orange = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]; g += d[i + 1]; b += d[i + 2];
      if (d[i] > 220 && d[i + 1] > 110 && d[i + 1] < 200 && d[i + 2] < 120) orange++;
    }
    const n = d.length / 4;
    return { r: r / n, g: g / n, b: b / n, orange };
  }, [batch, idx, rx, ry, rw, rh]);
}

async function addPhotos(page, files) {
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction((n) => window.__op.photos().length >= n && document.querySelector('#busy').classList.contains('hidden'), files.length);
}

async function closeDialog(page, id) {
  await page.click(id + ' [data-close]');
  await page.waitForFunction((sel) => !document.querySelector(sel).open, id);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50))); // close イベントの処理を待つ
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  await ctx.addInitScript(initScript);
  const page = await ctx.newPage();
  currentPage = page;
  const errors = [], requests = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('request', (r) => requests.push(r.url()));
  page.on('dialog', (d) => d.accept());
  const origin = new URL(BASE).origin;

  await step('はじめの画面: 写真をえらぶボタンが出る', async () => {
    await page.goto(BASE);
    assert.equal(await page.isVisible('#btnPickHero'), true);
    assert.equal(await page.isVisible('#work'), false);
    await shot(page, '01-hero');
  });

  await step('ホーム画面に追加の案内: iPhone の Safari では手順が出て、とじると次から出ない', async () => {
    assert.equal(await page.isVisible('#installCard'), true);
    assert.equal(await page.isVisible('#installIOS'), true);
    assert.equal(await page.isVisible('#installOther'), false);
    assert.match(await page.textContent('#installIOS'), /ホーム画面に追加/);
    await page.click('#btnInstallClose');
    assert.equal(await page.isVisible('#installCard'), false);
    await page.reload();
    assert.equal(await page.isVisible('#installCard'), false);
    await page.evaluate(() => localStorage.removeItem('omoide.installHidden'));
    await page.reload();
    assert.equal(await page.isVisible('#installCard'), true);
    await shot(page, '00-install-card');
  });

  await step('アイコンとアプリ設定: 180・192・512px の画像と manifest がそろっている', async () => {
    const r = await page.evaluate(async () => {
      const man = await (await fetch('manifest.webmanifest')).json();
      const size = (src) => new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i.naturalWidth + 'x' + i.naturalHeight); i.onerror = ng; i.src = src; });
      const touch = document.querySelector('link[rel="apple-touch-icon"]').getAttribute('href');
      return {
        name: man.name, short: man.short_name, display: man.display, start: man.start_url,
        icons: await Promise.all(man.icons.map(async (ic) => ic.sizes + ':' + ic.purpose + ':' + await size(ic.src))),
        touch: await size(touch),
        title: document.querySelector('meta[name="apple-mobile-web-app-title"]').content
      };
    });
    assert.equal(r.name, 'おもいでプリント');
    assert.equal(r.display, 'standalone');
    assert.equal(r.start, './');
    assert.deepEqual(r.icons, ['192x192:any:192x192', '512x512:any:512x512', '512x512:maskable:512x512']);
    assert.equal(r.touch, '180x180');
    assert.equal(r.title, '写真プリント');
  });

  await step('写真7枚を読みこむ: 撮影日・向き・並び順', async () => {
    await addPhotos(page, ALL);
    const ph = await page.evaluate(() => window.__op.photos().map((p) => ({
      name: p.name, natW: p.natW, natH: p.natH, date: p.date ? p.date.toISOString() : null, key: p.key, group: p.group, best: p.best
    })));
    assert.equal(ph.length, 7);
    // 撮影日の古い順、日付のないものは最後（えらんだ順）
    assert.deepEqual(ph.map((p) => p.name),
      ['land2_exif.jpg', 'land_exif.jpg', 'portrait_orient6.jpg', 'dup_sharp.jpg', 'dup_blur.jpg', 'noexif.jpg', 'other.png']);
    const o6 = ph.find((p) => p.name === 'portrait_orient6.jpg');
    assert.deepEqual([o6.natW, o6.natH], [900, 1200], '向き(Orientation=6)を反映してたて長');
    assert.equal(ph.find((p) => p.name === 'noexif.jpg').date, null);
    assert.equal(ph.find((p) => p.name === 'other.png').date, null);
    assert.ok(ph.every((p) => p.key), 'すべての写真に印刷済み用のキーがある');
    assert.equal(await page.locator('.card').count(), 7);
  });

  await step('似ている写真: 連写の2枚だけがまとまり、くっきりに★', async () => {
    const ph = await page.evaluate(() => window.__op.photos().map((p) => ({ name: p.name, group: p.group, best: p.best })));
    const s = ph.find((p) => p.name === 'dup_sharp.jpg'), b = ph.find((p) => p.name === 'dup_blur.jpg');
    assert.notEqual(s.group, null);
    assert.equal(s.group, b.group);
    assert.equal(s.best, true);
    assert.equal(b.best, false);
    assert.ok(ph.filter((p) => p.group !== null).length === 2, 'ほかの写真はまとまらない');
    assert.match(await page.textContent('#hints'), /似ている写真が1組/);
    await page.click('[data-hint="sim"]');
    const on = await page.evaluate(() => window.__op.photos().filter((p) => p.on).map((p) => p.name));
    assert.equal(on.includes('dup_blur.jpg'), false);
    assert.equal(on.length, 6);
  });

  await step('設定: 子どもの名前と誕生日を入れて、日付＋年齢', async () => {
    await page.click('#btnSettings');
    await page.fill('#kidsList input[data-f="name"]', 'つばき');
    await page.fill('#kidsList input[data-f="birth"]', '2023-03-10');
    await closeDialog(page, '#dlgSettings');
    await page.click('#segStamp button[data-v="age"]');
    const cardText = await page.locator('.card').nth(1).textContent();
    assert.match(cardText, /'26 5 5/);
    assert.match(cardText, /つばき 3さい1かげつ/);
    const first = await page.locator('.card').nth(0).textContent();
    assert.match(first, /'25 12 24/);
    assert.match(first, /つばき 2さい9かげつ/);
    assert.match(await page.textContent('#hints'), /撮影日がわからない写真が2枚/);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('omoide.settings')));
    assert.deepEqual(saved.kids, [{ name: 'つばき', birth: '2023-03-10' }]);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 0, '横にはみ出していない（' + over + 'px）');
    await shot(page, '02-grid');
  });

  await step('じゅんび→プリント: L判ちょうどの画像が6枚、共有シートに1回で渡る', async () => {
    assert.match(await page.textContent('#barSum'), /印刷する写真 6枚.*L判の用紙 6枚/);
    await page.click('#btnMain');
    await page.waitForFunction(() => window.__op.prepared() !== null);
    assert.equal((await page.textContent('#btnMain')).trim(), '🖨 プリントする');
    // 2回つづけて押しても、共有は1回だけ
    await page.evaluate(() => { const b = document.querySelector('#btnMain'); b.click(); b.click(); });
    await page.waitForFunction(() => window.__shared.length === 1);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__shared.length), 1);
    const files = await page.evaluate(() => window.__shared[0]);
    assert.equal(files.length, 6);
    assert.ok(files.every((f) => f.type === 'image/jpeg' && /^omoide_\d{8}_\d{3}\.jpg$/.test(f.name)));
    const dims = files.map((f) => f.w + 'x' + f.h);
    // land2, land, orient6, dup_sharp, noexif(たて), other.png(横)
    assert.deepEqual(dims, ['1500x1051', '1500x1051', '1051x1500', '1500x1051', '1051x1500', '1500x1051']);
  });

  await step('できた画像の中身: 向きが正しい・日付は右下にオレンジ・日付なしは入らない', async () => {
    // orient6（3枚目）: 上が赤、下が青
    const top = await regionStats(page, 0, 2, 0.3, 0.05, 0.4, 0.15);
    const bottom = await regionStats(page, 0, 2, 0.3, 0.80, 0.4, 0.10);
    assert.ok(top.r > 150 && top.b < 100, '上が赤 ' + JSON.stringify(top));
    assert.ok(bottom.b > 150 && bottom.r < 100, '下が青 ' + JSON.stringify(bottom));
    // land（2枚目）: 上が黄色、右下にオレンジの日付
    const yel = await regionStats(page, 0, 1, 0.4, 0.05, 0.2, 0.2);
    assert.ok(yel.r > 200 && yel.g > 180 && yel.b < 80, '上が黄色 ' + JSON.stringify(yel));
    const stampArea = await regionStats(page, 0, 1, 0.55, 0.75, 0.43, 0.23);
    assert.ok(stampArea.orange > 300, '右下に日付の文字 ' + stampArea.orange);
    const leftBottom = await regionStats(page, 0, 1, 0.02, 0.75, 0.40, 0.23);
    assert.equal(leftBottom.orange, 0, '左下には何もない');
    // noexif（5枚目）: 日付が入らない
    const none = await regionStats(page, 0, 4, 0.5, 0.75, 0.48, 0.23);
    assert.equal(none.orange, 0, '日付なしの写真に文字が入っていない');
  });

  await step('印刷済み: 送った6枚に印がつき、端末に記録される・もとにもどせる', async () => {
    assert.equal(await page.locator('.badge.printed').count(), 6);
    const rec = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('omoide.printed'))).length);
    assert.equal(rec, 6);
    assert.equal(await page.isVisible('#toastBtn'), true);
    await page.click('#toastBtn');
    assert.equal(await page.locator('.badge.printed').count(), 0);
    assert.equal(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('omoide.printed'))).length), 0);
    // ふたたび印刷済みにする（下のボタン）
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '横にはみ出していない');
    await page.click('#btnMarkDone');
    assert.equal(await page.locator('.badge.printed').count(), 6);
    assert.match(await page.textContent('#barSum'), /ぜんぶ送りました/);
  });

  await step('ブラウザで印刷: 用紙サイズのページが6枚・横画像は回して入る', async () => {
    await page.click('#btnBrowserPrint');
    await page.waitForFunction(() => window.__printCalls === 1);
    assert.equal(await page.locator('#printArea .sheet').count(), 6);
    assert.equal(await page.locator('#printArea .sheet.land').count(), 4);
    assert.match(await page.textContent('#pageStyle'), /size: 89mm 127mm; margin: 0;/);
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    await page.emulateMedia({ media: 'screen' });
    const txt = pdf.toString('latin1');
    const pages = (txt.match(/\/Type\s*\/Page[^s]/g) || []).length;
    assert.equal(pages, 6, 'PDF のページ数');
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(txt);
    assert.ok(box, 'MediaBox がある');
    // 89mm × 127mm = 252.28pt × 360pt（1pt = 1/72inch）
    assert.ok(Math.abs(Number(box[1]) - 252.28) < 1.5 && Math.abs(Number(box[2]) - 360) < 1.5, 'ページの大きさ ' + box[1] + 'x' + box[2]);
  });

  await step('写真の調整: 指でずらすと位置が変わり、作った画像は作り直しになる', async () => {
    await page.locator('.card .frame').nth(1).click();
    assert.equal(await page.isVisible('#dlgEdit'), true);
    await page.waitForTimeout(150);
    await shot(page, '03-editor');
    // land_exif（4:3）を L判の横（約1.43:1）に入れると、横はぴったりで上下だけ切れる。
    // なので上下にだけずらせて、左右には動かない
    const bb = await page.locator('#edCanvas').boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.move(bb.x + bb.width / 2 + 40, bb.y + bb.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
    const pan = await page.evaluate(() => ({ x: window.__op.photos()[1].panX, y: window.__op.photos()[1].panY }));
    assert.equal(pan.x, 0, '左右には余りがないので動かない');
    assert.ok(pan.y < 0, '下へ指を動かすと、写真の上のほうが見える ' + pan.y);
    await closeDialog(page, '#dlgEdit');
    // dialog の close イベントは少しあとに届く
    await page.waitForFunction(() => window.__op.prepared() === null);
    assert.equal((await page.textContent('#btnMain')).trim(), 'じゅんびする');
  });

  await step('調整画面を見るだけなら、作った画像はそのまま', async () => {
    await page.click('#btnMain');
    await page.waitForFunction(() => window.__op.prepared() !== null);
    await page.locator('.card .frame').nth(0).click();
    await closeDialog(page, '#dlgEdit');
    await page.waitForFunction(() => !document.querySelector('#dlgEdit').open);
    await page.waitForTimeout(200); // close イベントの処理を待つ
    assert.notEqual(await page.evaluate(() => window.__op.prepared()), null);
  });

  await step('撮影日を手で入れると、日付が入るようになる', async () => {
    await page.locator('.card .frame').nth(5).click(); // noexif
    await page.fill('#edDate', '2024-08-15');
    await page.dispatchEvent('#edDate', 'change');
    await closeDialog(page, '#dlgEdit');
    await page.waitForFunction(() => /'24 8 15/.test(document.querySelectorAll('.card')[5].textContent));
    const t = await page.locator('.card').nth(5).textContent();
    assert.match(t, /'24 8 15/);
    assert.match(t, /つばき 1さい5かげつ/);
  });

  await step('よこ写真を たてに回す設定: 横写真もたての画像になり、上が左に来る', async () => {
    await page.click('#btnSettings');
    await page.check('#setRotate');
    await closeDialog(page, '#dlgSettings');
    await page.click('#btnMain');
    await page.waitForFunction(() => window.__op.prepared() !== null);
    await page.click('#btnMain');
    await page.waitForFunction(() => window.__shared.length === 2);
    const files = await page.evaluate(() => window.__shared[1]);
    assert.ok(files.every((f) => f.w === 1051 && f.h === 1500), files.map((f) => f.w + 'x' + f.h).join(','));
    const left = await regionStats(page, 1, 1, 0.05, 0.4, 0.2, 0.2);   // land の上（黄色）が左
    const right = await regionStats(page, 1, 1, 0.75, 0.4, 0.2, 0.2);  // 下（緑）が右
    assert.ok(left.r > 200 && left.g > 180 && left.b < 80, '左が黄色 ' + JSON.stringify(left));
    assert.ok(right.g > 120 && right.r < 100, '右が緑 ' + JSON.stringify(right));
    // 日付も写真といっしょに回る: 写真の右下 → 画像の右上。画像の右下には入らない
    const topRight = await regionStats(page, 1, 1, 0.75, 0.0, 0.25, 0.45);
    const bottomRight = await regionStats(page, 1, 1, 0.55, 0.75, 0.45, 0.25);
    assert.ok(topRight.orange > 300, '日付は画像の右上（写真の右下）' + topRight.orange);
    assert.equal(bottomRight.orange, 0, '画像の右下には入らない');
    await page.click('#btnSettings');
    await page.uncheck('#setRotate');
    await closeDialog(page, '#dlgSettings');
  });

  await step('4面: 写真7つ（1つは2枚）で用紙2枚、どちらもたてのL判', async () => {
    await page.click('#segPer button[data-v="4"]');
    await page.locator('.card').nth(4).locator('[data-act="toggle"]').click(); // dup_blur をもどす → 7枚
    await page.locator('.card').nth(0).locator('[data-act="plus"]').click();   // 1枚目を2枚に → 8枚
    assert.match(await page.textContent('#barSum'), /印刷する写真 8枚.*用紙 2枚/);
    await page.click('#btnPreview');
    await page.waitForFunction(() => document.querySelectorAll('#pvGrid canvas').length === 2);
    await shot(page, '04-preview-4up');
    await closeDialog(page, '#dlgPreview');
    await page.click('#btnMain');
    await page.waitForFunction(() => window.__op.prepared() !== null);
    await page.click('#btnMain');
    await page.waitForFunction(() => window.__shared.length === 3);
    const files = await page.evaluate(() => window.__shared[2]);
    assert.deepEqual(files.map((f) => f.w + 'x' + f.h), ['1051x1500', '1051x1500']);
  });

  await step('分けて送る: 10枚ずつにすると 12枚が 10枚＋2枚の2回になる', async () => {
    await page.click('#segPer button[data-v="1"]');
    for (let i = 0; i < 4; i++) await page.locator('.card').nth(0).locator('[data-act="plus"]').click(); // 2→6枚
    assert.match(await page.textContent('#barSum'), /用紙 12枚/);
    await page.click('#btnSettings');
    await page.selectOption('#setBatch', '10');
    await closeDialog(page, '#dlgSettings');
    await page.click('#btnMain');
    await page.waitForFunction(() => window.__op.prepared() !== null);
    assert.match(await page.textContent('#barSum'), /1 \/ 2回目：10枚/);
    await page.click('#btnMain');
    await page.waitForFunction(() => window.__shared.length === 4);
    assert.match(await page.textContent('#barSum'), /2 \/ 2回目：2枚/);
    await page.click('#btnMain');
    await page.waitForFunction(() => window.__shared.length === 5);
    assert.deepEqual(await page.evaluate(() => [window.__shared[3].length, window.__shared[4].length]), [10, 2]);
    assert.match(await page.textContent('#barSum'), /ぜんぶ送りました/);
  });

  await step('読みこみなおし: 印刷済みの写真がわかり、1回ではずせる・同じ写真は二重に入らない', async () => {
    await page.reload();
    await addPhotos(page, ALL);
    assert.equal(await page.locator('.badge.printed').count(), 7);
    assert.match(await page.textContent('#hints'), /印刷済みの写真が7枚/);
    await page.click('[data-hint="printed"]');
    assert.equal(await page.evaluate(() => window.__op.photos().filter((p) => p.on).length), 0);
    await page.setInputFiles('#fileInput', ALL.slice(0, 2));
    await page.waitForFunction(() => /同じ写真/.test(document.querySelector('#toastMsg').textContent));
    assert.equal(await page.evaluate(() => window.__op.photos().length), 7);
    assert.match(await page.textContent('#toastMsg'), /同じ写真2枚は1回だけ/);
  });

  await step('すぐ開ける: 一度ひらいたあとは、電波がなくても開ける', async () => {
    await page.evaluate(() => navigator.serviceWorker.ready);
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await ctx.setOffline(true);
    try {
      await page.reload();
      assert.equal(await page.isVisible('#btnPickHero'), true);
      assert.equal(await page.evaluate(() => typeof window.OP.placePhoto), 'function');
      assert.equal(await page.evaluate(() => typeof window.__op.photos), 'function');
      // 電波がなくても写真を読みこんで、印刷用の画像まで作れる
      await addPhotos(page, ALL.slice(0, 1));
      await page.click('#btnMain');
      await page.waitForFunction(() => window.__op.prepared() !== null);
    } finally {
      await ctx.setOffline(false);
    }
  });

  await step('すうじアプリを使っている端末でも: /print/ は自分の仕組みで動き、電波なしで開ける', async () => {
    const ctx3 = await browser.newContext({ ...devices['iPhone 13'], locale: 'ja-JP' });
    const p3 = await ctx3.newPage();
    const e3 = [];
    p3.on('pageerror', (e) => e3.push(e.message));
    const root = new URL('../', BASE).href;
    await p3.goto(root);                                    // すうじアプリ（サイトのいちばん上）
    await p3.evaluate(() => navigator.serviceWorker.ready);
    await p3.goto(BASE);
    await p3.evaluate(() => navigator.serviceWorker.ready);
    if (!(await p3.evaluate(() => navigator.serviceWorker.controller && /\/print\/sw\.js$/.test(navigator.serviceWorker.controller.scriptURL)))) await p3.reload();
    await p3.waitForFunction(() => navigator.serviceWorker.controller && /\/print\/sw\.js$/.test(navigator.serviceWorker.controller.scriptURL));
    const caches = await p3.evaluate(() => caches.keys());
    assert.ok(caches.includes('omoide-v1') && caches.some((k) => /^suuji-/.test(k)), 'どちらの保存分も残っている ' + caches.join(','));
    await ctx3.setOffline(true);
    await p3.reload();
    assert.equal(await p3.isVisible('#btnPickHero'), true);
    await ctx3.setOffline(false);
    assert.deepEqual(e3, []);
    await ctx3.close();
  });

  await step('ホーム画面から開いたときは、追加の案内を出さない', async () => {
    const ctx2 = await browser.newContext({ ...devices['iPhone 13'], locale: 'ja-JP' });
    await ctx2.addInitScript(() => Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }));
    const p2 = await ctx2.newPage();
    const e2 = [];
    p2.on('pageerror', (e) => e2.push(e.message));
    await p2.goto(BASE);
    assert.equal(await p2.isVisible('#btnPickHero'), true);
    assert.equal(await p2.isVisible('#installCard'), false);
    assert.deepEqual(e2, []);
    await ctx2.close();
  });

  await step('写真はどこにも送らない: 通信はこのサイトのファイルだけ', async () => {
    const outside = requests.filter((u) => !u.startsWith(origin) && !u.startsWith('blob:') && !u.startsWith('data:'));
    assert.deepEqual(outside, []);
    const posts = requests.filter((u) => /\/api\//.test(u));
    assert.deepEqual(posts, []);
  });

  await step('JavaScript のエラーがない', async () => {
    assert.deepEqual(errors, []);
  });

  await browser.close();
  console.log(`\n画面テスト ${passed} 件 すべて成功`);
})().catch(async (e) => {
  console.error(e && e.stack || e);
  process.exit(1);
});
