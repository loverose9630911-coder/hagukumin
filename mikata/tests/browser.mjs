// ブラウザでの動作確認（任意）。
//
//   make browser        … Playwright が入っていれば動く
//   node tests/browser.mjs
//
// PHP のテスト（tests/run.php）が「数え方」を見るのに対して、
// こちらは「画面がちゃんと出て、押したら動くか」を見る。
// Playwright は開発用の道具なのでアプリ本体には不要。入っていなければ何もせず終わる。

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || 8123);
const BASE = `http://127.0.0.1:${PORT}`;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('… Playwright が入っていないので、ブラウザの確認はとばします');
  console.log('   （試したいときは  npm i -g playwright && npx playwright install chromium ）');
  process.exit(0);
}

// 本番のデータを触らないよう、使い捨ての DB で立ち上げる
const work = mkdtempSync(join(tmpdir(), 'mikata-browser-'));
const env = { ...process.env, MIKATA_DB: join(work, 'test.sqlite') };

console.log('▶ デモデータを用意します');
await run('php', ['-r', 'require "tools/bootstrap.php"; Mikata\\Seed::run();'], env);

console.log(`▶ サーバーを立ち上げます (port ${PORT})`);
const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', 'public', 'public/index.php'],
  { cwd: ROOT, env, stdio: 'ignore' });

const cleanup = () => {
  server.kill();
  rmSync(work, { recursive: true, force: true });
};
process.on('exit', cleanup);

await waitFor(BASE + '/api/me');

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 940 }, locale: 'ja-JP' })).newPage();

const problems = [];
page.on('pageerror', (e) => problems.push('画面のエラー: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });

let passed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log('  ✓', name);
  } catch (e) {
    problems.push(`${name} → ${e.message.split('\n')[0]}`);
    console.log('  ✗', name, '→', e.message.split('\n')[0]);
  }
};

await step('ログインできる', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('.gate input[autocomplete="username"]', 'demo');
  await page.fill('.gate input[type="password"]', 'demo1234');
  await page.click('.gate button[type="submit"]');
  await page.waitForSelector('.col-head.me', { timeout: 10000 });
});

await step('ダッシュボードに数字とグラフが出る', async () => {
  const kpi = await page.locator('.kpi').count();
  const gauge = await page.locator('.gauge').count();
  const chart = await page.locator('svg[role="img"]').count();
  if (kpi < 8) throw new Error(`KPIが足りない: ${kpi}`);
  if (gauge < 2) throw new Error(`ゲージが足りない: ${gauge}`);
  if (chart < 3) throw new Error(`グラフが足りない: ${chart}`);
});

await step('自分とチームが並んで出る', async () => {
  if (!(await page.locator('.col-head.me').count())) throw new Error('自分の欄がない');
  if (!(await page.locator('.col-head.team').count())) throw new Error('チームの欄がない');
});

await step('ボードが開き、担当者でも分けられる', async () => {
  await page.click('a[href="#/board"]');
  await page.waitForSelector('.tcard');
  await page.selectOption('.filters select >> nth=0', 'assignee');
  await page.waitForTimeout(300);
  if ((await page.locator('.board .col').count()) < 5) throw new Error('担当者の列が出ない');
});

await step('テーブルで絞り込める', async () => {
  await page.click('a[href="#/table"]');
  await page.waitForSelector('table.tbl tbody tr');
  const all = await page.locator('table.tbl tbody tr').count();
  await page.fill('.filters input[placeholder*="検索"]', '訪問');
  await page.waitForTimeout(300);
  const some = await page.locator('table.tbl tbody tr').count();
  if (some >= all || some === 0) throw new Error(`絞り込みがきいていない: ${all} → ${some}`);
  await page.fill('.filters input[placeholder*="検索"]', '');
});

await step('目標に積み上げの内訳が出る', async () => {
  await page.click('a[href="#/goals"]');
  await page.waitForSelector('.gauge');
  if ((await page.locator('.bar-row').count()) < 4) throw new Error('内訳が出ていない');
});

await step('タスクを開いてステータスを変えられる', async () => {
  await page.click('a[href="#/table"]');
  await page.waitForSelector('table.tbl tbody tr');
  await page.click('table.tbl tbody tr >> nth=0');
  await page.waitForSelector('.panel .title-in');
  const before = await page.locator('.panel .props select >> nth=0').inputValue();
  const next = before === 'doing' ? 'review' : 'doing';
  await page.selectOption('.panel .props select >> nth=0', next);
  await page.waitForTimeout(900);
  if ((await page.locator('.panel .props select >> nth=0').inputValue()) !== next) {
    throw new Error('変わらなかった');
  }
});

await step('変更がスレッドに自動で流れる', async () => {
  if (!(await page.locator('.panel').innerText()).includes('ステータスを')) {
    throw new Error('自動投稿が見あたらない');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

await step('チャンネルに書き込める', async () => {
  await page.click('.side a[href^="#/channel/"] >> nth=0');
  await page.waitForSelector('.chat .composer textarea');
  await page.fill('.chat .composer textarea', 'テストの書き込みです @sakura');
  await page.click('.composer button.primary');
  await page.waitForTimeout(900);
  if (!(await page.locator('.chat-scroll').innerText()).includes('テストの書き込みです')) {
    throw new Error('反映されない');
  }
  if (!(await page.locator('.msg .mention').count())) throw new Error('メンションが目立っていない');
});

await step('タスクを作れる', async () => {
  await page.click('.topbar button.primary');
  await page.waitForSelector('.modal');
  await page.fill('.modal input >> nth=0', 'ブラウザから作ったタスク');
  await page.click('.modal-f button.primary');
  await page.waitForSelector('.panel .title-in', { timeout: 6000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

await step('チームを切り替えても画面が二重にならない', async () => {
  await page.goto(BASE + '/#/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.side-team');
  await page.click('.side-team');
  await page.waitForSelector('.modal');
  await page.fill('.modal input[placeholder*="開発チーム"]', 'テスト用チーム');
  await page.click('.modal button:has-text("作る")');
  await page.waitForSelector('.col-head.team', { timeout: 8000 });
  await page.waitForTimeout(500);
  if ((await page.locator('.shell').count()) !== 1) throw new Error('画面が二重になっている');
  if ((await page.locator('.col-head.me').count()) !== 1) throw new Error('見出しが二重になっている');
});

await step('スマホの幅で横にはみ出さない', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + '/#/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.col-head.me');
  await page.waitForTimeout(600);
  const over = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (over > 2) throw new Error(`${over}px はみ出している`);
});

await browser.close();

console.log('');
if (problems.length === 0) {
  console.log(`✓ 全て成功しました（${passed}件）`);
  process.exit(0);
}
console.log(`✗ 失敗した項目（${problems.length}件 / 成功は ${passed}件）`);
for (const p of problems) console.log('  -', p);
process.exit(1);

// ---- 小物 ---------------------------------------------------------------

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, env, stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} が失敗しました`))));
  });
}

async function waitFor(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // まだ立ち上がっていない
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('サーバーが立ち上がりませんでした');
}
