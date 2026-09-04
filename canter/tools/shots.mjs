// README に載せる画面写真を撮る。
//
//   node tools/shots.mjs      （= make shots）
//
// 使い捨ての DB で立ち上げて、決まった順に操作しながら docs/ に書き出す。
// 手で撮ると毎回ちがう画面になってしまうので、手順ごと残してある。
// Playwright が入っていなければ何もせず終わる。

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = join(ROOT, 'docs');
const PORT = Number(process.env.PORT || 8156);
const BASE = `http://127.0.0.1:${PORT}`;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('… Playwright が入っていないので、画面写真は撮りません');
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), 'canter-shots-'));
const env = { ...process.env, CANTER_DATA: work, CANTER_DB: join(work, 'db.sqlite') };

await new Promise((ok, ng) => spawn('php', ['-r', 'require "tools/bootstrap.php"; Canter\\Seed::run();'],
  { cwd: ROOT, env, stdio: 'inherit' }).on('exit', (c) => (c === 0 ? ok() : ng(new Error('seed')))));

const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', 'public', 'public/index.php'],
  { cwd: ROOT, env, stdio: 'ignore' });
process.on('exit', () => { server.kill(); rmSync(work, { recursive: true, force: true }); });

await waitFor(BASE + '/api/me');

const browser = await launch();
const page = await (await browser.newContext({
  viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2, locale: 'ja-JP',
})).newPage();

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.fill('input[name=login]', 'demo');
await page.fill('input[name=password]', 'demo1234');
await page.click('button[type=submit]');
await page.waitForSelector('.home');
await page.waitForTimeout(600);
await shot('home.png');

await page.locator('.design-card', { hasText: '9月のお知らせ' }).first().click();
await page.waitForSelector('.editor');
await page.waitForTimeout(1200);
await page.locator('.layer-name:has-text("見出し")').first().click();
await page.waitForTimeout(400);
await shot('editor.png');

// 書き出した1枚そのもの
const png = await page.evaluate(async () => {
  const { toPngBlob } = await import('/assets/js/editor/exporter.js');
  const { assetMap } = await import('/assets/js/store.js');
  const blob = await toPngBlob(window.__canterDoc, assetMap(), 0.5);
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
});
writeFileSync(join(SHOTS, 'sample.png'), Buffer.from(png));
console.log('✓ sample.png');

await page.click('.topbar .btn.primary');
await page.waitForSelector('.share');
await page.locator('.conn-pick').first().click();
await page.fill('.share-caption', '9月の営業時間が変わります。\n詳しくは画像をご覧ください。');
await page.waitForTimeout(900);
await shot('share.png');
await page.keyboard.press('Escape');

await page.goto(BASE + '/#/connect', { waitUntil: 'networkidle' });
await page.waitForSelector('.conns');
await page.waitForTimeout(600);
await shot('connect.png');

await browser.close();

async function shot(name) {
  await page.screenshot({ path: join(SHOTS, name) });
  console.log(`✓ ${name}`);
}

async function launch() {
  try {
    return await chromium.launch();
  } catch (e) {
    if (!process.env.CANTER_CHROMIUM) throw e;
    return await chromium.launch({ executablePath: process.env.CANTER_CHROMIUM });
  }
}

async function waitFor(url) {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* まだ */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('サーバーが立ち上がりませんでした');
}
