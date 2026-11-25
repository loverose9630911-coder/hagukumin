// toppage.html をスマホ幅などで表示して、見た目の確認用の画像を作り、はみ出しを検査する。
//   使い方:  node closing-sale/toppage/preview.mjs  （先に build.py を実行しておく）
// ここではお客様のスマホの書体（ヒラギノ明朝など）が無いので、似た書体（しっぽり明朝・Noto Sans JP）で代用して表示する。
// 外部の画像（shopping.c.yimg.jp）は読み込まない（枠だけになる）。
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const fontDir = path.resolve(here, '..', 'banner', 'node_modules', '@fontsource');
const outDir = path.resolve(here, 'preview');
fs.mkdirSync(outDir, { recursive: true });

// しっぽり明朝 / Noto Sans JP の @font-face を、スマホの書体名で読めるように名前を付け替える
function aliasCss(pkg, weight, family) {
  const css = fs.readFileSync(path.join(fontDir, pkg, `${weight}.css`), 'utf8');
  return css
    .replace(/font-family: '[^']+';/g, `font-family: '${family}';`)
    .replace(/url\(\.\/files\//g, `url(file://${path.join(fontDir, pkg, 'files')}/`);
}
const fontCss = [
  aliasCss('shippori-mincho', 500, 'Hiragino Mincho ProN'), aliasCss('shippori-mincho', 700, 'Hiragino Mincho ProN'),
  aliasCss('noto-sans-jp', 400, 'YuGothic'), aliasCss('noto-sans-jp', 700, 'YuGothic'),
].join('\n');

const code = fs.readFileSync(path.join(here, 'toppage.html'), 'utf8');
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><style>${fontCss} body{margin:0}</style></head>
<body>${code}</body></html>`;
const htmlPath = path.join(outDir, '_preview.html');
fs.writeFileSync(htmlPath, html);

const browser = await chromium.launch();
let failed = false;
for (const width of [375, 750]) {
  const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
  await page.route(/^https?:/, (r) => r.abort());
  await page.goto('file://' + htmlPath);
  await page.evaluate(() => document.fonts.ready);
  const res = await page.evaluate(() => {
    const problems = [];
    const w = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > w) problems.push(`横にはみ出している: ${document.documentElement.scrollWidth}px > ${w}px`);
    const block = [...document.querySelectorAll('a')].find((a) => a.textContent.includes('閉店セール'));
    if (!block) return { problems: ['セールの表示が見つからない'] };
    const br = block.getBoundingClientRect();
    for (const el of block.querySelectorAll('*')) {
      const r = document.createRange(); r.selectNodeContents(el);
      const t = r.getBoundingClientRect();
      if (t.width && (t.left < br.left - 0.5 || t.right > br.right + 0.5)) problems.push(`セールの表示からはみ出し: ${el.textContent.trim().slice(0, 20)}`);
    }
    // 送料の文字の高さ ≥ 「1」の高さ × 1/4（文字の大きさで比べる。字形の差は小さいので目安）
    const one = [...block.querySelectorAll('span')].find((s) => s.textContent === '1');
    const ship = [...block.querySelectorAll('span')].find((s) => s.textContent === '＋送料1,000円');
    const ratio = parseFloat(getComputedStyle(ship).fontSize) / parseFloat(getComputedStyle(one).fontSize);
    if (ratio < 0.25) problems.push(`送料の文字が小さい: 「1」の ${ratio.toFixed(2)} 倍（0.25 倍以上にする）`);
    return { problems, top: br.top + window.scrollY, height: br.height, ratio };
  });
  const file = path.join(outDir, `toppage_${width}px.png`);
  if (res.height) {
    await page.setViewportSize({ width, height: Math.ceil(res.top + res.height + 40) });
    await page.screenshot({ path: file, clip: { x: 0, y: Math.max(0, res.top - 20), width, height: Math.ceil(res.height + 40) } });
  }
  if (res.problems.length) { failed = true; console.log(`NG  ${width}px`); res.problems.forEach((p) => console.log('    -', p)); }
  else console.log(`OK  ${width}px  セールの表示の高さ ${Math.round(res.height)}px  送料/「1」の文字サイズ比 ${res.ratio.toFixed(2)}  → ${path.relative(process.cwd(), file)}`);
  await page.close();
}
await browser.close();
fs.rmSync(htmlPath);
process.exit(failed ? 1 : 0);
