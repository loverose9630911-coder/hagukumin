// アプリのアイコンを作る。
//
//   node tools/render-icons.mjs      （= make icons）
//
// 元になる形はこのファイルの icon() ただ1つ。そこから
//   ・public/assets/icon.svg          … 大もと（新しいブラウザはこれをそのまま使う）
//   ・icon-192.png / icon-512.png     … ホーム画面に追加したとき
//   ・icon-maskable-512.png           … Android が好きな形に切り抜くとき用（余白を広めに）
//   ・apple-touch-icon.png            … iPhone / iPad 用
//   ・favicon-32.png                  … 古いブラウザ用
// を書き出す。SVG だけはいつでも書き出せる。PNG にするにはブラウザが要るので、
// Playwright が入っていなければそこだけとばす。
//
// ＜デザインのねらい＞
//   外側のリング … チーム全体の進み具合
//   中の点       … その中にいる自分
//   リングの切れ目 … まだ終わっていないぶん
// ダッシュボードのドーナツと同じ形なので、アイコンと中身が地続きになる。

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/assets/', import.meta.url));

/** 配色（アプリの藍色 #4f46e5 を挟むように、紫から水色へ流す） */
const FROM = '#7c3aed';
const TO   = '#06b6d4';

/**
 * @param {object} o
 * @param {boolean} o.rounded 角を丸めるか（false なら全面を塗る＝端末側で切り抜く前提）
 * @param {number}  o.scale   中のマークの大きさ（1 が標準）
 */
function icon({ rounded = true, scale = 1 } = {}) {
  const r    = 20 * scale;
  const w    = 8 * scale;
  const dot  = 6.5 * scale;
  const dash = 80 * scale;               // リングの長さ（1周は約 125.7）
  const rest = 2 * Math.PI * r - dash;
  const rx   = rounded ? ' rx="14"' : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="ミカタ">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${FROM}"/>
      <stop offset="1" stop-color="${TO}"/>
    </linearGradient>
    <radialGradient id="shine" cx="16" cy="10" r="48" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff" stop-opacity=".22"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="64" height="64"${rx} fill="url(#tile)"/>
  <rect width="64" height="64"${rx} fill="url(#shine)"/>

  <!-- 外側のリング＝チーム。薄いほうが全体、濃いほうが進んだぶん -->
  <g transform="rotate(-90 32 32)" fill="none" stroke-linecap="round">
    <circle cx="32" cy="32" r="${r}" stroke="#fff" stroke-opacity=".24" stroke-width="${w}"/>
    <circle cx="32" cy="32" r="${r}" stroke="#fff" stroke-width="${w}" stroke-dasharray="${dash} ${rest.toFixed(2)}"/>
  </g>

  <!-- 真ん中の点＝その中にいる自分 -->
  <circle cx="32" cy="32" r="${dot}" fill="#fff"/>
</svg>
`;
}

// 大もとの SVG は、ブラウザが無くても必ず書き出す。
mkdirSync(OUT, { recursive: true });
writeFileSync(OUT + 'icon.svg', icon());
console.log('✓ icon.svg');

const PNGS = [
  { file: 'icon-192.png',          size: 192, svg: icon() },
  { file: 'icon-512.png',          size: 512, svg: icon() },
  // 端末が丸や角丸に切り抜くので、中身は内側 72% に収める
  { file: 'icon-maskable-512.png', size: 512, svg: icon({ rounded: false, scale: 0.72 }) },
  // iOS は自分で角を丸めるため、角丸なしで目いっぱい使う
  { file: 'apple-touch-icon.png',  size: 180, svg: icon({ rounded: false }) },
  { file: 'favicon-32.png',        size: 32,  svg: icon() },
];

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('… Playwright が入っていないので PNG は作りません（SVG だけ更新しました）');
  console.log('   （作り直したいときは  npm i -g playwright && npx playwright install chromium ）');
  process.exit(0);
}

const browser = await chromium.launch();
const page = await browser.newPage();

for (const { file, size, svg } of PNGS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block}</style>` +
    svg.replace('width="64" height="64"', `width="${size}" height="${size}"`),
  );
  await page.screenshot({ path: OUT + file, omitBackground: true });
  console.log(`✓ ${file}  (${size}×${size})`);
}

await browser.close();
