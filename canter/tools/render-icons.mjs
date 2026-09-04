// アプリのアイコンを作る。
//
//   node tools/render-icons.mjs      （= make icons）
//
// 元になる形はこのファイルの icon() ただ1つ。そこから
//   ・public/assets/icon.svg          … 大もと
//   ・icon-192.png / icon-512.png     … ホーム画面に追加したとき
//   ・icon-maskable-512.png           … Android が好きな形に切り抜くとき用（余白を広めに）
//   ・apple-touch-icon.png            … iPhone / iPad 用
//   ・favicon-32.png                  … 古いブラウザ用
// を書き出す。SVG はいつでも作れる。PNG にはブラウザが要るので、
// Playwright が入っていなければそこだけとばす。
//
// ＜デザインのねらい＞
//   曲線     … ベジェ曲線。イラストレーターの側（正確に形を作る）
//   四角い点 … その曲線を押さえているアンカー。触れる、動かせる、というしるし
//   丸い角の地 … キャンバの側（気軽さ）
// 「むずかしいものに、手をかけられる」を1つの形にしている。

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/assets/', import.meta.url));

const FROM = '#f0508c';
const TO   = '#7c5cff';

/**
 * @param {object} o
 * @param {boolean} o.rounded 角を丸めるか（false なら全面を塗る＝端末側で切り抜く前提）
 * @param {number}  o.scale   中のマークの大きさ（1 が標準）
 */
function icon({ rounded = true, scale = 1 } = {}) {
  const rx = rounded ? ' rx="14"' : '';
  const s = scale;
  const t = `translate(32 32) scale(${s}) translate(-32 -32)`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="canter">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${FROM}"/>
      <stop offset="1" stop-color="${TO}"/>
    </linearGradient>
    <radialGradient id="shine" cx="16" cy="10" r="48" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff" stop-opacity=".24"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="64" height="64"${rx} fill="url(#tile)"/>
  <rect width="64" height="64"${rx} fill="url(#shine)"/>

  <g transform="${t}">
    <!-- ベジェ曲線。canter の c のかたち -->
    <path d="M 45 20 C 32 12, 17 21, 17 32 C 17 43, 32 52, 45 44"
          fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>

    <!-- 曲線を押さえているアンカー（触れる、動かせる、のしるし） -->
    <rect x="41" y="16" width="8" height="8" rx="1.5" fill="#fff"/>
    <rect x="41" y="40" width="8" height="8" rx="1.5" fill="#fff"/>
    <circle cx="17" cy="32" r="4" fill="#fff" stroke="url(#tile)" stroke-width="2.5"/>
  </g>
</svg>
`;
}

mkdirSync(OUT, { recursive: true });
writeFileSync(OUT + 'icon.svg', icon());
console.log('✓ icon.svg');

const PNGS = [
  { file: 'icon-192.png',          size: 192, svg: icon() },
  { file: 'icon-512.png',          size: 512, svg: icon() },
  { file: 'icon-maskable-512.png', size: 512, svg: icon({ rounded: false, scale: 0.72 }) },
  { file: 'apple-touch-icon.png',  size: 180, svg: icon({ rounded: false }) },
  { file: 'favicon-32.png',        size: 32,  svg: icon() },
];

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('… Playwright が入っていないので PNG は作りません（SVG だけ更新しました）');
  console.log('   （作り直したいときは  npm i playwright && npx playwright install chromium ）');
  process.exit(0);
}

// Playwright が持っている Chromium と、環境に入っている Chromium が
// 食い違うことがある（版が別々に更新されるため）。
// そのときは CANTER_CHROMIUM に実行ファイルの場所を入れて逃がす。
const browser = await launchChromium(chromium);
const page = await browser.newPage();

for (const { file, size, svg } of PNGS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    '<style>html,body{margin:0;background:transparent}svg{display:block}</style>' +
    svg.replace('width="64" height="64"', `width="${size}" height="${size}"`),
  );
  await page.screenshot({ path: OUT + file, omitBackground: true });
  console.log(`✓ ${file}  (${size}×${size})`);
}

await browser.close();

async function launchChromium(chromium) {
  try {
    return await chromium.launch();
  } catch (e) {
    const path = process.env.CANTER_CHROMIUM;
    if (!path) throw e;
    return await chromium.launch({ executablePath: path });
  }
}
