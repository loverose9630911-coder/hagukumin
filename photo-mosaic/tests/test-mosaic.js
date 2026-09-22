const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

// Usage: serve photo-mosaic/ on 127.0.0.1:8765 (python3 -m http.server 8765 --bind 127.0.0.1), then run this file.
// PAGE_URL overrides the page address, OUT_DIR the folder for saved images and screenshots,
// FONT_MIRROR=1 fetches Google Fonts with curl and hands them to the browser (for sandboxes whose browser cannot reach fonts.gstatic.com).
const os = require('os');
const PAGE = process.env.PAGE_URL || 'http://127.0.0.1:8765/index.html';
const OUT = process.env.OUT_DIR || path.join(os.tmpdir(), 'mosaic-out');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  -- ' + detail : '')); }

(async () => {
  const launchOpts = { headless: true };
  if (process.env.HTTPS_PROXY) launchOpts.proxy = { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' };
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, ignoreHTTPSErrors: true, acceptDownloads: true, locale: 'ja-JP' });
  // Google Fonts mirror: headless Chromium in this sandbox cannot complete TLS to fonts.gstatic.com,
  // so fetch the CSS and font files with curl (which goes through the proxy) and hand them to the page.
  const { execFileSync } = require('child_process');
  const fontMirror = new Map();
  async function mirror(route, request) {
    const url = request.url();
    let buf = fontMirror.get(url);
    if (!buf) {
      try { buf = execFileSync('curl', ['-sS', '--max-time', '40', '-A', request.headers()['user-agent'] || 'Mozilla/5.0', url], { maxBuffer: 64 * 1024 * 1024 }); }
      catch (e) { console.log('mirror failed', url.slice(0, 80)); return route.abort(); }
      fontMirror.set(url, buf);
    }
    const ct = url.includes('googleapis.com') ? 'text/css; charset=utf-8' : 'font/woff2';
    return route.fulfill({ status: 200, body: buf, headers: { 'content-type': ct, 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=3600' } });
  }
  if (process.env.FONT_MIRROR) {
    await ctx.route('https://fonts.googleapis.com/**', mirror);
    await ctx.route('https://fonts.gstatic.com/**', mirror);
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const reqFails = new Map(); page.on('requestfailed', r => { const k = r.url().slice(0, 60) + ' ' + (r.failure() && r.failure().errorText); reqFails.set(k, (reqFails.get(k) || 0) + 1); });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__mosaic && window.__mosaic.state.lastStats && !window.__mosaic.state.rendering, null, { timeout: 30000 });
  let stats = await page.evaluate(() => window.__mosaic.state.lastStats);
  check('initial render with sample tiles', stats.placed > 0 && stats.photos === 0, JSON.stringify(stats));
  check('web font loaded (Mochiy Pop One)', stats.font === 'Mochiy Pop One', 'font=' + stats.font);

  // --- generate 30 sample photos (mixed portrait/landscape) inside a helper page
  const helper = await ctx.newPage();
  await helper.setContent('<canvas id=c></canvas>');
  const dataUrls = await helper.evaluate(() => {
    const out = [];
    for (let i = 0; i < 30; i++) {
      const portrait = i % 3 === 0;
      const w = portrait ? 900 : 1600, h = portrait ? 1600 : 900;
      const c = document.getElementById('c'); c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = `hsl(${(i * 37) % 360} 70% 60%)`; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(w / 2, h * (portrait ? 0.3 : 0.5), Math.min(w, h) * 0.25, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#222'; g.font = 'bold 120px sans-serif'; g.textAlign = 'center'; g.fillText(String(i + 1), w / 2, h * (portrait ? 0.3 : 0.5) + 40);
      out.push(c.toDataURL('image/jpeg', 0.85));
    }
    return out;
  });
  await helper.close();
  const files = dataUrls.map((d, i) => ({ name: `IMG_${String(i + 1).padStart(4, '0')}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(d.split(',')[1], 'base64') }));

  await page.setInputFiles('#photos', files);
  await page.waitForFunction(() => window.__mosaic.state.photos.length === 30 && window.__mosaic.state.lastStats && window.__mosaic.state.lastStats.photos === 30 && !window.__mosaic.state.rendering, null, { timeout: 30000 });
  stats = await page.evaluate(() => window.__mosaic.state.lastStats);
  check('30 photos loaded and rendered', stats.photos === 30 && stats.placed > 0, JSON.stringify(stats));
  check('photo count label', (await page.textContent('#photoCount')).includes('写真 30枚'), await page.textContent('#photoCount'));
  check('thumbnail strip shows 14 + more', (await page.$$('#strip canvas')).length === 14 && (await page.textContent('#strip .more')) === '+16');

  // neighbours differ (no same photo left/up) - sample check on canvas assignment is internal; check pixel variety instead
  const variety = await page.evaluate(() => {
    const c = document.getElementById('out'); const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data; const seen = new Set(); let nonBg = 0;
    for (let i = 0; i < d.length; i += 4 * 97) { const k = (d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4); seen.add(k); if (!(d[i] > 250 && d[i + 1] > 250 && d[i + 2] > 250)) nonBg++; }
    return { colors: seen.size, nonBg };
  });
  check('canvas has many colours from photos', variety.colors > 20 && variety.nonBg > 1000, JSON.stringify(variety));

  // --- change options: block mode, small tiles, Dela font, A4 portrait, no gap, navy bg
  await page.check('#modeBlock');
  await page.selectOption('#tiles', '24');
  await page.selectOption('#font', 'dela');
  await page.selectOption('#size', 'a4p');
  await page.selectOption('#gap', '0');
  await page.click('.swatch[data-color="#2b2f45"]');
  await page.waitForFunction(() => { const s = window.__mosaic.state.lastStats; return s && s.W === 2480 && s.cols === 24 && !window.__mosaic.state.rendering; }, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  stats = await page.evaluate(() => window.__mosaic.state.lastStats);
  check('block mode / A4 portrait / 24 cols rendered', stats.W === 2480 && stats.H === 3508 && stats.cols === 24 && stats.placed > 0, JSON.stringify(stats));
  check('Dela Gothic One loaded', stats.font === 'Dela Gothic One', 'font=' + stats.font);
  check('outline control hidden in block mode', await page.$eval('#outlineField', el => el.hidden) && !(await page.isVisible('#outlineField')));
  const bgPixel = await page.evaluate(() => { const c = document.getElementById('out'); return Array.from(c.getContext('2d').getImageData(2, 2, 1, 1).data); });
  check('background colour applied (navy)', bgPixel[0] === 0x2b && bgPixel[1] === 0x2f && bgPixel[2] === 0x45, bgPixel.join(','));

  // --- shuffle changes seed and re-renders
  const before = await page.evaluate(() => window.__mosaic.state.seed);
  await page.click('#shuffle');
  await page.waitForTimeout(500);
  check('shuffle advances seed', (await page.evaluate(() => window.__mosaic.state.seed)) === before + 1);

  // --- broken file does not crash
  await page.setInputFiles('#photos', [{ name: 'IMG_9999.HEIC', mimeType: 'image/heic', buffer: Buffer.from('not an image at all') }]);
  await page.waitForFunction(() => window.__mosaic.state.failed === 1, null, { timeout: 15000 });
  check('unreadable file counted, page alive', (await page.textContent('#photoErr')).includes('1枚'));

  // --- empty text falls back
  await page.fill('#text', '   ');
  await page.waitForTimeout(500);
  stats = await page.evaluate(() => window.__mosaic.state.lastStats);
  check('blank text still renders', stats.placed > 0);
  await page.fill('#text', '4さい\nおめでとう');
  await page.check('#modeCut'); await page.selectOption('#size', 'a4l'); await page.selectOption('#tiles', '16'); await page.selectOption('#gap', '0.06');
  await page.click('.swatch[data-color="#ffffff"]');
  await page.waitForFunction(() => { const s = window.__mosaic.state.lastStats; return s && s.W === 3508 && s.cols === 16 && !window.__mosaic.state.rendering; }, null, { timeout: 30000 });
  await page.waitForTimeout(400);

  // --- save (top-level page: no claude viewer, no navigator.share in headless -> anchor download)
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#save')]);
  const savedPath = path.join(OUT, download.suggestedFilename());
  await download.saveAs(savedPath);
  const buf = fs.readFileSync(savedPath);
  check('download produced a JPEG', buf[0] === 0xff && buf[1] === 0xd8 && buf.length > 100000, `${download.suggestedFilename()} ${buf.length} bytes`);
  await page.waitForFunction(() => { const i = document.getElementById('resultImg'); return i.naturalWidth > 0; }, null, { timeout: 15000 });
  const nat = await page.$eval('#resultImg', i => [i.naturalWidth, i.naturalHeight]);
  check('long-press image shown at full size', nat[0] === 3508 && nat[1] === 2480, nat.join('x'));

  // --- PNG format
  await page.selectOption('#format', 'png');
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#save')]);
  const p2 = path.join(OUT, dl2.suggestedFilename()); await dl2.saveAs(p2);
  const b2 = fs.readFileSync(p2);
  check('PNG download', b2[0] === 0x89 && b2[1] === 0x50 && dl2.suggestedFilename().endsWith('.png'), `${dl2.suggestedFilename()} ${b2.length} bytes`);

  // --- settings persist across reload
  await page.selectOption('#font', 'zenmaru');
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__mosaic && window.__mosaic.state.lastStats && !window.__mosaic.state.rendering, null, { timeout: 30000 });
  check('settings remembered after reload', (await page.inputValue('#font')) === 'zenmaru' && (await page.inputValue('#format')) === 'png');
  check('result image box hidden on fresh load', !(await page.isVisible('#result')) && !(await page.isVisible('#saveNote')) && !(await page.isVisible('#progress')));

  // --- screenshots (phone + desktop) for the one look
  await page.selectOption('#font', 'pop'); await page.waitForTimeout(800);
  await page.setInputFiles('#photos', files.slice(0, 24));
  await page.waitForFunction(() => window.__mosaic.state.photos.length === 24 && !window.__mosaic.state.rendering, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'desktop.png'), fullPage: false });
  // dark theme
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'desktop-dark.png'), fullPage: false });

  console.log('failed requests:', JSON.stringify([...reqFails.entries()]).slice(0, 600));
  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 500));
  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(2); });
