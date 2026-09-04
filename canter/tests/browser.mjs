// ブラウザでの動作確認。
//
//   make browser        … Playwright が入っていれば動く
//   node tests/browser.mjs
//
// サーバー側のテスト（tests/run.php）が「数え方」を、
// エディタのテスト（tests/editor.mjs）が「計算」を見るのに対して、
// こちらは「画面がちゃんと出て、押したら動くか」を見る。
// Playwright は開発用の道具なのでアプリ本体には要らない。入っていなければ何もせず終わる。
//
// Playwright が持っている Chromium と、環境に入っている Chromium が食い違うときは
// CANTER_CHROMIUM に実行ファイルの場所を入れる。

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || 8134);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = join(ROOT, 'docs');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('… Playwright が入っていないので、ブラウザの確認はとばします');
  console.log('   （試したいときは  npm i playwright && npx playwright install chromium ）');
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), 'canter-browser-'));
const env = { ...process.env, CANTER_DATA: work, CANTER_DB: join(work, 'test.sqlite') };

console.log('▶ デモデータを用意します');
await run('php', ['-r', 'require "tools/bootstrap.php"; Canter\\Seed::run();'], env);

console.log(`▶ サーバーを立ち上げます (port ${PORT})`);
const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', 'public', 'public/index.php'],
  { cwd: ROOT, env, stdio: 'ignore' });

const cleanup = () => {
  server.kill();
  rmSync(work, { recursive: true, force: true });
};
process.on('exit', cleanup);

await waitFor(BASE + '/api/me');

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, locale: 'ja-JP' });
const page = await context.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let pass = 0;
const fail = [];
const ok = (what, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${what}`); }
  else { fail.push(what + (extra ? `  (${extra})` : '')); console.log(`  ✗ ${what} ${extra}`); }
};

try {
  // ---- ログイン ----------------------------------------------------------
  console.log('\n▶ ログイン');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('input[name=login]', 'demo');
  await page.fill('input[name=password]', 'demo1234');
  await page.click('button[type=submit]');
  await page.waitForSelector('.home', { timeout: 15000 });
  ok('ログインして置き場が出る', true);

  // ---- 置き場 ------------------------------------------------------------
  console.log('\n▶ 置き場');
  const presets = await page.locator('.preset-card').count();
  ok('出し先のプリセットが並ぶ', presets === 11, `${presets}件`);

  const cards = await page.locator('.design-card').count();
  ok('デモのデザインが並ぶ', cards === 5, `${cards}件`);

  await page.screenshot({ path: join(SHOTS, 'home.png') });

  // ---- テンプレートから作る ----------------------------------------------
  console.log('\n▶ テンプレートから新しく作る');
  await page.locator('.preset-card', { hasText: 'Instagram 正方形' }).first().click();
  await page.waitForSelector('.tpl-grid');
  const tpls = await page.locator('.tpl-card').count();
  ok('ひな型が出る', tpls >= 2, `${tpls}件`);

  await page.locator('.tpl-card', { hasText: 'お知らせ' }).first().click();
  await page.waitForSelector('.editor', { timeout: 15000 });
  await page.waitForTimeout(700);
  ok('編集の画面がひらく', true);

  // ---- 描かれているか ----------------------------------------------------
  console.log('\n▶ キャンバス');
  const drawn = await page.locator('.scene [data-id]').count();
  ok('テンプレートの図形が描かれている', drawn >= 4, `${drawn}個`);

  const texts = await page.locator('.scene text').count();
  ok('文字が SVG として描かれている', texts >= 2, `${texts}個`);

  // ---- 図形を足す --------------------------------------------------------
  console.log('\n▶ 図形を足す');
  await page.click('.panel.left .tab:has-text("図形")');
  await page.click('.shape-btn[title="円"]');
  await page.waitForTimeout(200);
  const after = await page.locator('.scene [data-id]').count();
  ok('図形が1つ増える', after === drawn + 1, `${drawn} → ${after}`);
  ok('置いたものが選ばれている', await page.locator('.sel-outline').count() === 1);
  ok('つまみが出る', await page.locator('.handle').count() >= 8);

  // ---- 動かす ------------------------------------------------------------
  console.log('\n▶ 動かす');
  const before = await nodeBox(page);
  const stage = await page.locator('.stage').boundingBox();
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width / 2 + 120, stage.y + stage.height / 2 + 40, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const moved = await nodeBox(page);
  ok('ドラッグで動く', Math.abs(moved.x - before.x) > 30, `${before.x} → ${moved.x}`);

  // ---- 元に戻す ----------------------------------------------------------
  console.log('\n▶ 元に戻す');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  const undone = await nodeBox(page);
  ok('Ctrl+Z で戻る', Math.abs(undone.x - before.x) < 2, `${undone.x}`);

  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(250);
  ok('Ctrl+Shift+Z でやり直せる', Math.abs((await nodeBox(page)).x - moved.x) < 2);

  // ---- パスファインダー --------------------------------------------------
  console.log('\n▶ 形を組み合わせる');
  await page.click('.shape-btn[title="四角"]');
  await page.waitForTimeout(200);
  const beforeOp = await page.locator('.scene [data-id]').count();

  // レイヤーから2つえらぶ
  await page.locator('.layer-name').first().click();
  await page.locator('.layer-name').nth(1).click({ modifiers: ['Shift'] });
  await page.waitForTimeout(150);
  ok('2つえらべる', await page.locator('.sel-outline').count() === 2);

  await page.locator('.insp button:has-text("合体")').first().click();
  await page.waitForTimeout(300);
  const afterOp = await page.locator('.scene [data-id]').count();
  ok('合体すると1つになる', afterOp === beforeOp - 1, `${beforeOp} → ${afterOp}`);
  ok('できたのはパス', await page.locator('.scene path').count() >= 1);

  // ---- マジックリサイズ --------------------------------------------------
  console.log('\n▶ 別のサイズで作り直す');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.locator('.insp button:has-text("Instagram ストーリー")').first().click();
  await page.waitForTimeout(500);
  const size = await page.evaluate(() => {
    const el = document.querySelector('.scene rect');
    return { w: Number(el.getAttribute('width')), h: Number(el.getAttribute('height')) };
  });
  ok('キャンバスの大きさが変わる', size.w === 1080 && size.h === 1920, JSON.stringify(size));

  // ---- 書き出し ----------------------------------------------------------
  console.log('\n▶ 書き出し');
  const png = await page.evaluate(async () => {
    const { toPngBlob } = await import('/assets/js/editor/exporter.js');
    const { store, assetMap } = await import('/assets/js/store.js');
    const doc = window.__canterDoc;
    const blob = await toPngBlob(doc, assetMap(), 0.25);
    const bmp = await createImageBitmap(blob);
    return { size: blob.size, type: blob.type, w: bmp.width, h: bmp.height };
  });
  ok('PNG が作れる', png.size > 1000 && png.type === 'image/png', JSON.stringify(png));
  ok('PNG の大きさが指定どおり', png.w === 270 && png.h === 480, `${png.w}×${png.h}`);

  const svg = await page.evaluate(async () => {
    const { toSvgString } = await import('/assets/js/editor/exporter.js');
    return toSvgString(window.__canterDoc, new Map()).length;
  });
  ok('SVG も書き出せる', svg > 500, `${svg}文字`);

  await page.screenshot({ path: join(SHOTS, 'editor.png') });

  // ---- 保存 --------------------------------------------------------------
  console.log('\n▶ 保存');
  await page.waitForFunction(() => document.querySelector('.save-state')?.textContent.startsWith('保存済み'), null, { timeout: 20000 });
  ok('自動で保存される', true);

  // ---- 出す --------------------------------------------------------------
  console.log('\n▶ 出す');
  await page.click('.topbar .btn.primary');   // 「書き出す」も「出す」を含むので、主ボタンで指す
  await page.waitForSelector('.share', { timeout: 15000 });
  const picks = await page.locator('.conn-pick').count();
  ok('つなぎ先がえらべる', picks >= 1, `${picks}件`);

  await page.locator('.conn-pick').first().click();
  await page.fill('.share-caption', 'ブラウザのテストから出しました。');
  await page.waitForTimeout(200);
  await page.click('.share .btn.primary.big');
  await page.waitForSelector('.results', { timeout: 30000 });
  const okResult = await page.locator('.result.ok').count();
  ok('note へ書き出せる', okResult === 1, `${okResult}件`);
  ok('貼りつけ用の本文が出る', (await page.locator('.artifact-text').innerText()).includes('#'));

  await page.screenshot({ path: join(SHOTS, 'share.png') });
  await page.click('.results button:has-text("とじる")');

  // ---- つなぎ先の画面 ----------------------------------------------------
  console.log('\n▶ つなぎ先');
  await page.goto(BASE + '/#/connect', { waitUntil: 'networkidle' });
  await page.waitForSelector('.conns');
  const blocks = await page.locator('.conn-block').count();
  ok('つなげる先が6つ出る', blocks === 6, `${blocks}件`);
  ok('外から見えないことを知らせる', await page.locator('.notice').count() === 1);
  ok('出した記録が残る', await page.locator('.post-row').count() >= 1);

  await page.locator('.conn-block:has-text("Instagram") button:has-text("つなぐ")').click();
  await page.waitForSelector('.conn-form');
  const fields = await page.locator('.conn-form .field').count();
  ok('サービスごとの入力欄が作られる', fields >= 4, `${fields}件`);

  await page.screenshot({ path: join(SHOTS, 'connect.png') });

  ok('画面のエラーが出ていない', errors.length === 0, errors.slice(0, 3).join(' / '));
} catch (e) {
  fail.push('とちゅうで止まりました: ' + e.message);
  console.log('\n✗ ' + e.message);
  if (errors.length) {
    console.log('   画面で出ていたエラー:');
    for (const line of errors.slice(0, 6)) console.log('     ' + line);
  }
  try {
    await page.screenshot({ path: join(SHOTS, 'error.png') });
  } catch { /* 撮れなくても続ける */ }
}

await browser.close();

console.log(`\n${pass} 件たしかめました`);
if (fail.length) {
  console.log(`\n✗ ${fail.length} 件しっぱい`);
  for (const f of fail) console.log('   - ' + f);
  process.exit(1);
}
console.log('✓ ぜんぶ通りました');

// ---- 小道具 ---------------------------------------------------------------

async function launch() {
  try {
    return await chromium.launch();
  } catch (e) {
    if (!process.env.CANTER_CHROMIUM) throw e;
    return await chromium.launch({ executablePath: process.env.CANTER_CHROMIUM });
  }
}

/** いま選ばれている図形の囲み（画面上の位置）。 */
async function nodeBox(page) {
  const el = page.locator('.sel-outline').first();
  const pts = await el.getAttribute('points');
  const [x, y] = pts.split(' ')[0].split(',').map(Number);
  return { x: Math.round(x), y: Math.round(y) };
}

function run(cmd, args, env) {
  return new Promise((ok2, ng) => {
    const p = spawn(cmd, args, { cwd: ROOT, env, stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? ok2() : ng(new Error(`${cmd} が ${code} で終わりました`))));
  });
}

async function waitFor(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* まだ起きていない */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('サーバーが立ち上がりませんでした');
}
