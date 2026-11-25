// 閉店セールのバナー3種を PNG に書き出し、書き出す前に中身を検査する。
//
//   使い方:  cd closing-sale/banner && npm install && node render.mjs
//
// 検査（1つでも外れたら PNG は out/ に出さず、終了コード 1）
//   1. 決まった文言がすべて入っていて、古い終了時刻「15:00」や旧送料「1,500円」が無い
//   2. 文字がすべて Web フォント（Cormorant Garamond / しっぽり明朝 / Noto Sans JP）で
//      描かれている（IPAゴシック等への置きかわりが無い）
//   3. 文字が額縁の内側に収まり、価格の札の中の文字は札からはみ出さない
//   4. 主な文字のかたまり同士が重ならない
//   5. 送料の文字の高さが「1」の数字の高さの 1/4 以上
//   6. 赤は「1円」にだけ使われている
//   7. 書き出した PNG の寸法が決めたサイズと一致する

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// Playwright はこの環境に共通で入っているものを使う（ESM の import では見つからないため require で読む）
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright が見つかりません。Playwright と Chromium が入った環境で実行してください。');
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', 'out');
const pageUrl = pathToFileURL(path.join(here, 'banner.html')).href;

const VARIANTS = [
  { key: 'yahoo', file: 'yahoo-kanban_1180x260.png', w: 1180, h: 260 },
  { key: 'line', file: 'line_1040x1040.png', w: 1040, h: 1040 },
  { key: 'threads', file: 'threads_1080x1350.png', w: 1080, h: 1350 },
];

const REQUIRED_TEXT = [
  'CLOSING SALE', '閉店セール', '全商品', '1円', '＋送料1,000円', '（1点ごと）',
  '11.24 TUE', '11.30 MON', '17:00', 'まで', '長い間ありがとうございました',
  'Office Casual Bura.bura',
];
const FORBIDDEN_TEXT = ['15:00', '1,500', '1,501'];
const ALLOWED_FONT = /^(Cormorant Garamond|Shippori Mincho|Noto Sans JP)/;

if (!fs.existsSync(path.join(here, 'node_modules', '@fontsource'))) {
  console.error('フォントが入っていません。先に closing-sale/banner で npm install を実行してください。');
  process.exit(1);
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// ページ内で実行する検査。問題の一覧（文字列の配列）を返す。
function inPageChecks() {
  const problems = [];
  const { w, h } = window.__VARIANT__;
  const text = document.body.innerText.replace(/\s+/g, ' ');

  for (const t of window.__REQUIRED_TEXT__) {
    if (!text.replace(/ /g, '').includes(t.replace(/ /g, '')) && !text.includes(t)) {
      problems.push(`文言が見つからない: ${t}`);
    }
  }
  for (const t of window.__FORBIDDEN_TEXT__) {
    if (text.includes(t)) problems.push(`入れてはいけない文言がある: ${t}`);
  }

  const textRect = (el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return r.getBoundingClientRect();
  };
  const inside = (a, b, pad = 0) =>
    a.left >= b.left + pad - 0.5 && a.right <= b.right - pad + 0.5 &&
    a.top >= b.top + pad - 0.5 && a.bottom <= b.bottom - pad + 0.5;

  // 3. 額縁の内側に収まる
  const frame = document.querySelector('.frame').getBoundingClientRect();
  const card = document.querySelector('[data-k="card"]');
  const cardRect = card.getBoundingClientRect();
  const keyed = [...document.querySelectorAll('[data-k]')];
  for (const el of keyed) {
    if (el.dataset.k === 'card') continue;
    const r = textRect(el);
    if (!inside(r, frame, 8)) problems.push(`額縁からはみ出し: ${el.dataset.k}`);
    if (card.contains(el) && !inside(r, cardRect, 4)) problems.push(`札からはみ出し: ${el.dataset.k}`);
  }
  if (!inside(cardRect, frame, 8)) problems.push('札が額縁からはみ出し');

  // 4. 主なかたまり同士が重ならない
  const blocks = ['en', 'ja', 'card', 'date', 'date2', 'thanks', 'brand']
    .map((k) => document.querySelector(`[data-k="${k}"]`))
    .filter(Boolean)
    .map((el) => ({ k: el.dataset.k, r: el.dataset.k === 'card' ? el.getBoundingClientRect() : textRect(el) }));
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i].r, b = blocks[j].r;
      const overlap = a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      if (overlap) problems.push(`重なっている: ${blocks[i].k} と ${blocks[j].k}`);
    }
  }

  // 6. 赤は「1円」だけ
  const red = getComputedStyle(document.querySelector('[data-k="num"]')).color;
  for (const el of document.querySelectorAll('.canvas *')) {
    if (el.closest('[data-k="price"]')) continue;
    if (getComputedStyle(el).color === red && el.textContent.trim()) {
      problems.push(`赤が「1円」以外に使われている: ${el.className}`);
    }
  }

  if (document.body.scrollWidth > w || document.body.scrollHeight > h) {
    problems.push(`ページがキャンバスより大きい: ${document.body.scrollWidth}x${document.body.scrollHeight}`);
  }
  return problems;
}

// 2. 実際に使われたフォントを Chrome に聞く（Web フォントなら isCustomFont が true）
async function fontProblems(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '.canvas *' });
  const problems = [];
  let checked = 0;
  for (const nodeId of nodeIds) {
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    for (const f of fonts) {
      checked++;
      if (!f.isCustomFont || !ALLOWED_FONT.test(f.familyName)) {
        problems.push(`決めたフォント以外で描かれている: ${f.familyName}（${f.glyphCount}字）`);
      }
    }
  }
  if (checked === 0) problems.push('フォントの使用状況が取れない');
  return problems;
}

// 5. 実際に描かれた画素から、文字の縦の高さ（インクのある行の数）を測る
//    kind = 'red'（「1」の赤） / 'dark'（送料の黒文字）
async function inkHeight(page, selector, kind) {
  const buf = await page.locator(selector).first().screenshot();
  return page.evaluate(async ({ b64, kind }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let top = -1, bottom = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const hit = kind === 'red' ? (r > 120 && g < 90 && b < 90) : (r + g + b) / 3 < 110;
        if (hit) { if (top < 0) top = y; bottom = y; break; }
      }
    }
    return top < 0 ? 0 : bottom - top + 1;
  }, { b64: buf.toString('base64'), kind });
}

const browser = await chromium.launch();
let failed = false;
fs.mkdirSync(outDir, { recursive: true });
try {
  for (const v of VARIANTS) {
    const page = await browser.newPage({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(`ページのエラー: ${e.message}`));
    page.on('requestfailed', (r) => errors.push(`読み込み失敗: ${r.url()}`));
    await page.goto(`${pageUrl}?v=${v.key}`);
    await page.evaluate(([req, forb]) => { window.__REQUIRED_TEXT__ = req; window.__FORBIDDEN_TEXT__ = forb; }, [REQUIRED_TEXT, FORBIDDEN_TEXT]);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);

    const problems = [...errors, ...(await page.evaluate(inPageChecks)), ...(await fontProblems(page))];
    const numH = await inkHeight(page, '[data-k="num"]', 'red');
    const shipH = await inkHeight(page, '[data-k="ship-main"]', 'dark');
    const ratio = numH ? shipH / numH : 0;
    if (!numH || !shipH) problems.push(`文字の高さが測れない: 数字 ${numH}px / 送料 ${shipH}px`);
    else if (shipH < numH / 4) problems.push(`送料の文字が小さい: 送料 ${shipH}px / 数字 ${numH}px`);

    const target = problems.length ? path.join(os.tmpdir(), `NG_${v.file}`) : path.join(outDir, v.file);
    await page.screenshot({ path: target, clip: { x: 0, y: 0, width: v.w, height: v.h } });
    const size = pngSize(target);
    if (size.w !== v.w || size.h !== v.h) problems.push(`PNG の寸法が違う: ${size.w}x${size.h}`);

    if (problems.length) {
      failed = true;
      console.log(`NG  ${v.file}（確認用の画像: ${target}）`);
      for (const p of problems) console.log(`    - ${p}`);
    } else {
      console.log(`OK  ${v.file}  ${size.w}x${size.h}  送料/数字の高さ比 ${ratio.toFixed(2)}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
