/*
 * おもいでプリント app.js（画面の操作）
 * 計算は core.js（window.OP）にまかせ、ここは画面・読み込み・書き出し・共有だけを書く。
 * 写真はブラウザの中だけで扱い、どこにも送らない。
 */
(function () {
  'use strict';
  var OP = window.OP;
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  /* ---------- 保存（この端末の中だけ） ---------- */
  var KEY_SET = 'omoide.settings';
  var KEY_PRINTED = 'omoide.printed';
  function load(key, fb) {
    try { var s = localStorage.getItem(key); return s ? JSON.parse(s) : fb; } catch (e) { return fb; }
  }
  function store(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }

  var DEFAULTS = {
    paper: 'L', per: 1, mode: 'fill', stamp: 'none',
    dateStyle: 'film', ageStyle: 'kana', kids: [],
    rotateLandscape: false, batch: 0
  };
  var set = Object.assign({}, DEFAULTS, load(KEY_SET, {}));
  if (!OP.PAPERS[set.paper]) set.paper = 'L';
  if (!OP.LAYOUTS[set.per]) set.per = 1;
  if (!Array.isArray(set.kids)) set.kids = [];
  var printed = load(KEY_PRINTED, {});
  if (!printed || typeof printed !== 'object') printed = {};
  function saveSet() { store(KEY_SET, set); }
  function savePrinted() {
    var keys = Object.keys(printed);
    if (keys.length > 30000) { // 古いものから捨てる
      keys.sort(function (a, b) { return String(printed[a]).localeCompare(String(printed[b])); });
      keys.slice(0, keys.length - 30000).forEach(function (k) { delete printed[k]; });
    }
    if (!store(KEY_PRINTED, printed)) toast('印刷済みの記録を保存できませんでした（プライベートブラウズでは保存されません）');
  }

  /* ---------- 状態 ---------- */
  var THUMB = 640;         // 画面用の縮小版の長い辺
  var photos = [];         // 読み込んだ写真
  var seq = 0;
  var prepared = null;     // 書き出し済みの印刷用画像

  /* ---------- 小さな道具 ---------- */
  function loadImg(url) {
    return new Promise(function (ok, ng) {
      var im = new Image();
      im.decoding = 'async';
      im.onload = function () { ok(im); };
      im.onerror = function () { ng(new Error('decode')); };
      im.src = url;
    });
  }
  function toBlob(canvas, type, q) {
    return new Promise(function (ok, ng) {
      canvas.toBlob(function (b) { b ? ok(b) : ng(new Error('toBlob')); }, type, q);
    });
  }
  function freeCanvas(c) { c.width = 1; c.height = 1; }
  function grayOf(src, w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(src, 0, 0, w, h);
    var d = x.getImageData(0, 0, w, h).data, g = new Array(w * h);
    for (var i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    freeCanvas(c);
    return g;
  }
  // 4×4 マスの平均色（48個の数）
  function colorOf(src) {
    var c = document.createElement('canvas');
    c.width = 4; c.height = 4;
    var x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, 4, 4);
    var d = x.getImageData(0, 0, 4, 4).data, out = [];
    for (var i = 0; i < 16; i++) out.push(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    freeCanvas(c);
    return out;
  }
  function hexOf(buf) {
    var a = new Uint8Array(buf), s = '';
    for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16);
    return s;
  }
  async function contentHash(file) {
    try {
      var head = await file.slice(0, 1048576).arrayBuffer();
      var d = await crypto.subtle.digest('SHA-256', head);
      return hexOf(d).slice(0, 24) + '-' + file.size;
    } catch (e) {
      return 'n-' + file.name + '-' + file.size;
    }
  }
  function today() { return OP.ymd(new Date()); }
  function sleep0() { return new Promise(function (r) { setTimeout(r, 0); }); }

  /* ---------- 進み具合とお知らせ ---------- */
  function busy(msg, done, total) {
    $('#busy').classList.remove('hidden');
    $('#busyMsg').textContent = msg;
    $('#busyFill').style.width = (total ? Math.round(done / total * 100) : 0) + '%';
    $('#busyCount').textContent = total ? (done + ' / ' + total) : '';
  }
  function unbusy() { $('#busy').classList.add('hidden'); }

  var toastTimer = null;
  function toast(msg, btnLabel, onBtn, ms) {
    var t = $('#toast'), b = $('#toastBtn');
    $('#toastMsg').textContent = msg;
    if (btnLabel) {
      b.textContent = btnLabel; b.classList.remove('hidden');
      b.onclick = function () { hideToast(); onBtn(); };
    } else { b.classList.add('hidden'); b.onclick = null; }
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms || (btnLabel ? 8000 : 4000));
  }
  function hideToast() { $('#toast').classList.add('hidden'); }

  /* ---------- 写真の読み込み ---------- */
  function isImage(f) {
    return /^image\//.test(f.type) || /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(f.name);
  }

  async function loadOne(file) {
    var url = URL.createObjectURL(file);
    try {
      var img = await loadImg(url);
      var natW = img.naturalWidth, natH = img.naturalHeight;
      if (!natW || !natH) throw new Error('size');
      var s = Math.min(1, THUMB / Math.max(natW, natH));
      var tw = Math.max(1, Math.round(natW * s)), th = Math.max(1, Math.round(natH * s));
      var c = document.createElement('canvas');
      c.width = tw; c.height = th;
      var ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, tw, th);
      var thumbBlob = await toBlob(c, 'image/jpeg', 0.85);
      var hash = OP.dHash(grayOf(c, 9, 8));
      var color = colorOf(c);
      var gw = 160, gh = Math.max(8, Math.round(160 * th / tw));
      if (th > tw) { gh = 160; gw = Math.max(8, Math.round(160 * tw / th)); }
      var sharp = OP.sharpness(grayOf(c, gw, gh), gw, gh);
      freeCanvas(c);
      img.src = '';

      var exif = null;
      if (/jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name) || !file.type) {
        exif = OP.readExif(await file.slice(0, 262144).arrayBuffer());
      }
      var key = OP.printedKey(exif, natW, natH, (exif && exif.raw) ? null : await contentHash(file));
      return {
        id: 'p' + (++seq), file: file, name: file.name || '', natW: natW, natH: natH,
        thumb: URL.createObjectURL(thumbBlob), thumbImg: null,
        exif: exif, date: exif && exif.date ? exif.date : null, dateFrom: exif && exif.date ? 'exif' : null,
        key: key, hash: hash, color: color, sharp: sharp,
        rot: 0, panX: 0, panY: 0, zoom: 1, copies: 1, on: true, stamp: true, kids: null,
        group: null, best: false, printed: !!(key && printed[key])
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function addFiles(list) {
    var files = Array.prototype.filter.call(list || [], isImage);
    if (!files.length) return;
    var failed = 0, dup = 0, have = {};
    photos.forEach(function (p) { if (p.key) have[p.key] = true; });
    busy('写真をよみこんでいます', 0, files.length);
    for (var i = 0; i < files.length; i++) {
      try {
        var p = await loadOne(files[i]);
        if (p.key && have[p.key]) { dup++; URL.revokeObjectURL(p.thumb); }
        else { if (p.key) have[p.key] = true; photos.push(p); }
      } catch (e) { failed++; }
      busy('写真をよみこんでいます', i + 1, files.length);
      if (i % 4 === 3) await sleep0();
    }
    sortByDate();
    regroup();
    invalidate();
    unbusy();
    renderAll();
    var msg = [];
    if (failed) msg.push(failed + '枚はよみこめませんでした');
    if (dup) msg.push('同じ写真' + dup + '枚は1回だけにしました');
    if (msg.length) toast(msg.join('。'));
  }

  // 撮影日の古い順（日付のない写真は、えらんだ順のまま最後）
  function sortByDate() {
    var idx = new Map(photos.map(function (p, i) { return [p, i]; }));
    photos.sort(function (a, b) {
      var da = a.date ? a.date.getTime() : Infinity, db = b.date ? b.date.getTime() : Infinity;
      if (da !== db) return da - db;
      return idx.get(a) - idx.get(b);
    });
  }

  function regroup() {
    var ids = OP.groupSimilar(photos.map(function (p) { return { hash: p.hash, date: p.date, color: p.color }; }));
    var bestOf = {};
    photos.forEach(function (p, i) {
      p.group = ids[i]; p.best = false;
      if (p.group === null) return;
      if (!(p.group in bestOf) || photos[bestOf[p.group]].sharp < p.sharp) bestOf[p.group] = i;
    });
    Object.keys(bestOf).forEach(function (g) { photos[bestOf[g]].best = true; });
  }

  /* ---------- 写真ごとの置き方 ---------- */
  function paper() { return OP.PAPERS[set.paper]; }
  function sheetOf(p) { return OP.sheetSize(paper(), set.per, OP.DPI, p, !set.rotateLandscape); }
  function geomOf(p) {
    var sh = sheetOf(p), cell = sh.cells[0];
    var rot = OP.cellRotation(p.natW, p.natH, p.rot, cell.w, cell.h);
    var rs = OP.rotatedSize(p.natW, p.natH, rot);
    var pl = OP.placePhoto(rs.w, rs.h, cell.w, cell.h, set.mode, p.panX, p.panY, p.zoom);
    return { sheet: sh, cell: cell, rot: rot, rs: rs, pl: pl };
  }
  function kidsFor(p) {
    var kids = set.kids.filter(function (k) { return k && OP.parseYmd(k.birth); });
    if (!p.kids) return kids;
    return kids.filter(function (k, i) { return p.kids.indexOf(i) >= 0; });
  }
  function stampOf(p) {
    if (!p.stamp) return [];
    return OP.stampLines({ mode: set.stamp, date: p.date, kids: kidsFor(p), dateStyle: set.dateStyle, ageStyle: set.ageStyle });
  }
  var PX_PER_MM = OP.DPI / 25.4;
  function borderless() { return set.per === 1 && set.mode === 'fill'; }

  /* ---------- 一覧の表示 ---------- */
  var GROUP_COLORS = ['#6C63FF', '#E0569B', '#1E9BB0', '#C0612B', '#5A8F29', '#8E5CC9'];

  function frameHTML(p) {
    var g = geomOf(p), c = g.cell, pl = g.pl;
    var k = pl.dw / pl.sw; // 回転後の写真 1px が、マスの何px になるか
    // 外の箱 = 写真が見えている範囲（マスに対する %）
    var clip = 'left:' + (pl.dx / c.w * 100) + '%;top:' + (pl.dy / c.h * 100) + '%;width:' + (pl.dw / c.w * 100) + '%;height:' + (pl.dh / c.h * 100) + '%';
    // 中の箱 = 回転後の写真ぜんたい（外の箱に対する %）。切り取り位置のぶんだけ左上へずらす
    var inner = 'left:' + (-pl.sx * k / pl.dw * 100) + '%;top:' + (-pl.sy * k / pl.dh * 100) + '%;width:' + (g.rs.w * k / pl.dw * 100) + '%;height:' + (g.rs.h * k / pl.dh * 100) + '%';
    // 画像は回転前の向きで置いて、まん中を軸に回す
    var side = g.rot % 180 !== 0;
    var imgW = side ? (g.rs.h / g.rs.w * 100) : 100, imgH = side ? (g.rs.w / g.rs.h * 100) : 100;
    var html = '<div class="frame" style="aspect-ratio:' + c.w + '/' + c.h + '">' +
      '<div class="box" style="' + clip + ';overflow:hidden">' +
      '<div class="box" style="' + inner + '">' +
      '<img alt="" src="' + p.thumb + '" style="width:' + imgW + '%;height:' + imgH + '%;transform:translate(-50%,-50%) rotate(' + g.rot + 'deg)">' +
      '</div></div>';
    var lines = stampOf(p);
    if (lines.length) {
      // 写真の向きにそろえた箱（見えている範囲のまん中を軸に、自動回転のぶんだけ回す）を作り、その右下に置く。
      // 単位は cqw（マスの幅の1%）。文字は10倍の大きさで描いて 1/10 に縮める（小さすぎる文字がブラウザに拡大されないように）
      var turn = OP.autoTurn(g.rot, p.rot);
      var area = { x: pl.dx, y: pl.dy, w: pl.dw, h: pl.dh };
      var m = OP.stampMetrics(area, PX_PER_MM, borderless());
      var u = 100 / c.w;
      var bw = (turn % 180 ? pl.dh : pl.dw) * u, bh = (turn % 180 ? pl.dw : pl.dh) * u;
      var cls = set.dateStyle === 'film' ? 'film' : 'plain';
      html += '<div class="sbox" style="left:' + ((pl.dx + pl.dw / 2) * u) + 'cqw;top:' + ((pl.dy + pl.dh / 2) * u) + 'cqw;width:' + bw + 'cqw;height:' + bh +
        'cqw;transform:translate(-50%,-50%) rotate(' + turn + 'deg)">' +
        '<div class="stamp ' + cls + '" style="right:' + (m.inset * u) + 'cqw;bottom:' + (m.inset * u) + 'cqw;font-size:' + (m.font * u * 10) + 'cqw">';
      for (var i = lines.length - 1; i >= 0; i--) {
        html += '<div class="' + (i === 0 ? 'd ' + cls : 'a') + '"' + (i > 0 ? ' style="font-size:.9em"' : '') + '>' + esc(lines[i]) + '</div>';
      }
      html += '</div></div>';
    }
    return html + '</div>';
  }

  function cardHTML(p) {
    var b = '';
    if (p.printed) b += '<span class="badge printed">印刷済み</span>';
    if (p.group !== null) b += '<span class="badge sim" style="background:' + GROUP_COLORS[p.group % GROUP_COLORS.length] + '">似ている</span>';
    if (p.best) b += '<span class="badge best">★くっきり</span>';
    if (!p.date && set.stamp !== 'none') b += '<span class="badge nodate">日付なし</span>';
    return '<div class="card' + (p.on ? '' : ' off') + '" data-id="' + p.id + '">' +
      frameHTML(p) +
      '<div class="badges">' + b + '</div>' +
      '<div class="row">' +
      '<button class="check" data-act="toggle" aria-label="印刷する">✓</button>' +
      '<div class="copies"><button data-act="minus" aria-label="へらす">−</button><span>' + p.copies + '枚</span>' +
      '<button data-act="plus" aria-label="ふやす">＋</button></div>' +
      '</div></div>';
  }

  function renderGrid() {
    $('#grid').innerHTML = photos.map(cardHTML).join('');
  }

  function renderHints() {
    var h = '';
    var groups = {}, extra = 0;
    photos.forEach(function (p) {
      if (p.group === null) return;
      groups[p.group] = true;
      if (!p.best && p.on) extra++;
    });
    var ng = Object.keys(groups).length;
    if (ng && extra) {
      h += '<div class="hint sim"><div class="grow"><b>似ている写真が' + ng + '組</b><br>いちばんくっきりした1枚（★）だけ残せます</div>' +
        '<button data-hint="sim">★だけ残す</button></div>';
    }
    var pc = photos.filter(function (p) { return p.printed && p.on; }).length;
    if (pc) {
      h += '<div class="hint done"><div class="grow"><b>印刷済みの写真が' + pc + '枚</b>まじっています</div>' +
        '<button data-hint="printed">はずす</button></div>';
    }
    if (set.stamp !== 'none') {
      var nd = photos.filter(function (p) { return p.on && !p.date; }).length;
      if (nd) h += '<div class="hint nodate"><div class="grow">撮影日がわからない写真が<b>' + nd + '枚</b>あります。日付は入りません（写真をタップすると入力できます）</div></div>';
      if (set.stamp === 'age' && !kidsFor({ kids: null }).length) {
        h += '<div class="hint nodate"><div class="grow">年齢を入れるには、⚙設定で子どもの名前と誕生日を入れてください</div><button data-hint="settings">設定</button></div>';
      }
    }
    $('#hints').innerHTML = h;
  }

  function sheetsNow() { return OP.buildSheets(photos, set.per); }

  function renderBar() {
    var on = photos.filter(function (p) { return p.on; });
    var prints = on.reduce(function (s, p) { return s + p.copies; }, 0);
    var sheets = sheetsNow().length;
    $('#bar').classList.toggle('hidden', !photos.length);
    $('#listInfo').textContent = photos.length + '枚をえらんでいます';
    var main = $('#btnMain'), subs = $('#barSubs');
    if (!prepared) {
      $('#barSum').innerHTML = '印刷する写真 <b>' + prints + '枚</b> ・ ' + paper().name + 'の用紙 <b>' + sheets + '枚</b>';
      main.textContent = 'じゅんびする';
      main.classList.remove('ready');
      main.disabled = !sheets;
      subs.classList.add('hidden');
      return;
    }
    var total = prepared.batches.length;
    subs.classList.remove('hidden');
    main.disabled = false;
    if (prepared.next >= total) {
      $('#barSum').innerHTML = '<b>ぜんぶ送りました</b>（用紙 ' + prepared.files.length + '枚）';
      main.textContent = 'もう一度プリントする';
      main.classList.add('ready');
      return;
    }
    var n = prepared.batches[prepared.next].length;
    $('#barSum').innerHTML = 'じゅんびできました ・ 用紙 <b>' + prepared.files.length + '枚</b>' +
      (total > 1 ? '（' + (prepared.next + 1) + ' / ' + total + '回目：' + n + '枚）' : '');
    main.textContent = canShareFiles() ? '🖨 プリントする' : '画像をダウンロード';
    main.classList.add('ready');
  }

  function renderTools() {
    $('#segPaper').innerHTML = OP.PAPER_ORDER.map(function (id) {
      return '<button data-v="' + id + '">' + OP.PAPERS[id].name + '</button>';
    }).join('');
    [['#segPaper', set.paper], ['#segPer', String(set.per)], ['#segMode', set.mode], ['#segStamp', set.stamp]].forEach(function (a) {
      Array.prototype.forEach.call(document.querySelectorAll(a[0] + ' button'), function (b) {
        b.setAttribute('aria-pressed', b.dataset.v === a[1] ? 'true' : 'false');
      });
    });
  }

  function renderAll() {
    var has = photos.length > 0;
    $('#hero').classList.toggle('hidden', has);
    $('#work').classList.toggle('hidden', !has);
    renderTools();
    renderHints();
    renderGrid();
    renderBar();
  }

  // 内容が変わったら、作った印刷用画像は捨てる
  function invalidate() {
    if (!prepared) return;
    prepared.urls.forEach(function (u) { URL.revokeObjectURL(u); });
    prepared = null;
    $('#printArea').innerHTML = '';
  }
  function changed() { invalidate(); renderAll(); }

  /* ---------- 画像の用意（縮小版・元写真） ---------- */
  async function thumbImg(p) {
    if (!p.thumbImg) p.thumbImg = await loadImg(p.thumb);
    return p.thumbImg;
  }
  var origCache = { id: null, img: null, url: null };
  async function origImg(p) {
    if (origCache.id === p.id) return origCache.img;
    releaseOrig();
    var url = URL.createObjectURL(p.file);
    var img = await loadImg(url);
    origCache = { id: p.id, img: img, url: url };
    return img;
  }
  function releaseOrig() {
    if (origCache.url) URL.revokeObjectURL(origCache.url);
    if (origCache.img) origCache.img.src = '';
    origCache = { id: null, img: null, url: null };
  }

  /*
   * 用紙1枚を描く。scale=1 で 300dpi の本番、小さくするとプレビュー。
   * useThumb=true なら縮小版で描く（速い）。
   */
  async function renderSheet(slots, scale, useThumb) {
    var first = photos[slots[0]];
    var sz = sheetOf(first);
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sz.w * scale));
    c.height = Math.max(1, Math.round(sz.h * scale));
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (var i = 0; i < slots.length; i++) {
      var p = photos[slots[i]], cl = sz.cells[i];
      var cell = { x: cl.x * scale, y: cl.y * scale, w: cl.w * scale, h: cl.h * scale };
      var rot = OP.cellRotation(p.natW, p.natH, p.rot, cell.w, cell.h);
      var rs = OP.rotatedSize(p.natW, p.natH, rot);
      var pl = OP.placePhoto(rs.w, rs.h, cell.w, cell.h, set.mode, p.panX, p.panY, p.zoom);
      var img = useThumb ? await thumbImg(p) : await origImg(p);
      var area = OP.drawPhoto(ctx, img, p.natW, p.natH, cell, rot, pl);
      OP.drawStamp(ctx, area, stampOf(p), set.dateStyle, PX_PER_MM * scale, borderless(), OP.autoTurn(rot, p.rot));
    }
    return { canvas: c, landscape: sz.landscape };
  }

  /* ---------- じゅんび（印刷用の画像を作る） ---------- */
  async function prepare() {
    var sheets = sheetsNow();
    if (!sheets.length) return;
    invalidate();
    var files = [], urls = [], lands = [];
    var stamp = today().replace(/-/g, '');
    try {
      for (var i = 0; i < sheets.length; i++) {
        busy('印刷用の画像を作っています', i, sheets.length);
        var r = await renderSheet(sheets[i], 1, false);
        var blob = await toBlob(r.canvas, 'image/jpeg', 0.92);
        freeCanvas(r.canvas);
        var name = 'omoide_' + stamp + '_' + String(i + 1).padStart(3, '0') + '.jpg';
        var f = new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
        files.push(f); urls.push(URL.createObjectURL(f)); lands.push(r.landscape);
        await sleep0();
      }
    } catch (e) {
      releaseOrig(); unbusy();
      urls.forEach(function (u) { URL.revokeObjectURL(u); });
      toast('画像を作れませんでした。枚数をへらして、もう一度ためしてください');
      return;
    }
    releaseOrig();
    var idx = files.map(function (f, i) { return i; });
    prepared = {
      files: files, urls: urls, landscape: lands, sheets: sheets,
      batches: OP.chunk(idx, Number(set.batch) || 0), next: 0, paper: set.paper
    };
    unbusy();
    renderBar();
    toast('じゅんびできました。「プリントする」を押してください');
  }

  /* ---------- 送る（共有シート → プリント） ---------- */
  function canShareFiles(files) {
    try {
      var f = files || [new File([new Blob(['x'], { type: 'image/jpeg' })], 'x.jpg', { type: 'image/jpeg' })];
      return !!(navigator.share && navigator.canShare && navigator.canShare({ files: f }));
    } catch (e) { return false; }
  }

  var sharing = false; // 2回押しで共有が重ならないように
  async function sendBatch() {
    if (!prepared || sharing) return;
    if (prepared.next >= prepared.batches.length) prepared.next = 0; // もう一度
    var batch = prepared.batches[prepared.next];
    var files = batch.map(function (i) { return prepared.files[i]; });
    if (!canShareFiles(files)) {
      download(files);
      prepared.next++;
      renderBar();
      toast('画像を保存しました。印刷できたら「印刷済みにする」を押してください');
      return;
    }
    sharing = true;
    try {
      await navigator.share({ files: files });
    } catch (e) {
      if (e && e.name === 'AbortError') return; // 共有画面を閉じただけ
      if (e && e.name === 'NotAllowedError') { toast('もう一度「プリントする」を押してください'); return; }
      toast('送れませんでした。⚙設定の「まとめて送る枚数」をへらしてください');
      return;
    } finally {
      sharing = false;
    }
    markPrinted(batch);
    prepared.next++;
    renderBar();
  }

  function download(files) {
    files.forEach(function (f) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(f); a.download = f.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function (u) { URL.revokeObjectURL(u); }.bind(null, a.href), 4000);
    });
  }

  function photosOfSheets(sheetIdx) {
    var seen = {}, out = [];
    sheetIdx.forEach(function (si) {
      prepared.sheets[si].forEach(function (pi) { if (!seen[pi]) { seen[pi] = true; out.push(photos[pi]); } });
    });
    return out;
  }

  function markPrinted(sheetIdx) {
    var list = photosOfSheets(sheetIdx).filter(function (p) { return p.key; });
    var before = list.map(function (p) { return [p, p.printed, printed[p.key]]; });
    var d = today();
    list.forEach(function (p) { printed[p.key] = d; p.printed = true; });
    savePrinted();
    renderHints(); renderGrid();
    toast(list.length + '枚を「印刷済み」にしました（印刷しなかったときは もとにもどす）', 'もとにもどす', function () {
      before.forEach(function (b) {
        b[0].printed = b[1];
        if (b[2]) printed[b[0].key] = b[2]; else delete printed[b[0].key];
      });
      savePrinted(); renderHints(); renderGrid();
    });
  }

  /* ---------- ブラウザで印刷（予備） ---------- */
  function browserPrint() {
    if (!prepared) return;
    var pp = OP.PAPERS[prepared.paper];
    $('#pageStyle').textContent = '@page { size: ' + pp.w + 'mm ' + pp.h + 'mm; margin: 0; }';
    var area = $('#printArea');
    area.style.setProperty('--pw', pp.w + 'mm');
    area.style.setProperty('--ph', pp.h + 'mm');
    area.innerHTML = prepared.urls.map(function (u, i) {
      return '<div class="sheet' + (prepared.landscape[i] ? ' land' : '') + '"><img alt="" src="' + u + '"></div>';
    }).join('');
    var imgs = area.querySelectorAll('img');
    Promise.all(Array.prototype.map.call(imgs, function (im) {
      return im.complete ? Promise.resolve() : new Promise(function (r) { im.onload = im.onerror = r; });
    })).then(function () {
      window.print();
      toast('印刷できたら「印刷済みにする」を押してください');
    });
  }

  /* ---------- 調整画面 ---------- */
  var ed = { p: null, pointers: new Map(), start: null, dirty: false };

  function openEditor(p) {
    ed.p = p;
    ed.dirty = false;
    $('#edZoom').value = p.zoom;
    $('#edDate').value = p.date ? OP.ymd(p.date) : '';
    $('#edDateNote').textContent = p.dateFrom === 'exif' ? '写真の記録から読みとった日付です'
      : p.dateFrom === 'manual' ? '手で入力した日付です' : '撮影日がわかりません（入力すると日付が入ります）';
    $('#edStamp').checked = p.stamp;
    $('#edOn').checked = p.on;
    var kids = set.kids.filter(function (k) { return k && OP.parseYmd(k.birth); });
    $('#edKidsWrap').classList.toggle('hidden', !kids.length || set.stamp !== 'age');
    $('#edKids').innerHTML = set.kids.map(function (k, i) {
      if (!k || !OP.parseYmd(k.birth)) return '';
      var on = !p.kids || p.kids.indexOf(i) >= 0;
      return '<label class="chk-line"><input type="checkbox" data-kid="' + i + '"' + (on ? ' checked' : '') + '> ' + esc(k.name || ('子ども' + (i + 1))) + '</label>';
    }).join('');
    $('#edHint').textContent = set.mode === 'fit' ? 'フチありのときは、写真をぜんぶ入れます' : '指でずらす・2本指で大きくできます';
    $('#dlgEdit').showModal();
    drawEditor();
  }

  async function drawEditor() {
    var p = ed.p;
    if (!p) return;
    var g = geomOf(p);
    var cv = $('#edCanvas');
    var maxW = Math.min(window.innerWidth - 56, 500), maxH = Math.min(window.innerHeight * 0.45, 460);
    var cssW = maxW, cssH = maxW * g.cell.h / g.cell.w;
    if (cssH > maxH) { cssH = maxH; cssW = maxH * g.cell.w / g.cell.h; }
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    var s = cv.width / g.cell.w;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingQuality = 'high';
    var cell = { x: 0, y: 0, w: cv.width, h: cv.height };
    var pl = OP.placePhoto(g.rs.w, g.rs.h, cell.w, cell.h, set.mode, p.panX, p.panY, p.zoom);
    var img = await thumbImg(p);
    if (ed.p !== p) return;
    var area = OP.drawPhoto(ctx, img, p.natW, p.natH, cell, g.rot, pl);
    OP.drawStamp(ctx, area, stampOf(p), set.dateStyle, PX_PER_MM * s, borderless(), OP.autoTurn(g.rot, p.rot));
  }

  function editorPan(dxCss, dyCss) {
    var p = ed.p, g = geomOf(p);
    if (set.mode === 'fit') return;
    var cv = $('#edCanvas');
    var cssW = parseFloat(cv.style.width);
    var srcPerCss = g.pl.sw / cssW;
    var cx = (g.rs.w - g.pl.sw) / 2, cy = (g.rs.h - g.pl.sh) / 2;
    if (cx > 0.5) p.panX = OP.clamp(ed.start.panX - dxCss * srcPerCss / cx, -1, 1);
    if (cy > 0.5) p.panY = OP.clamp(ed.start.panY - dyCss * srcPerCss / cy, -1, 1);
  }

  function bindEditor() {
    var cv = $('#edCanvas');
    cv.addEventListener('pointerdown', function (e) {
      cv.setPointerCapture(e.pointerId);
      ed.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      ed.start = { panX: ed.p.panX, panY: ed.p.panY, zoom: ed.p.zoom, pts: new Map(ed.pointers) };
    });
    cv.addEventListener('pointermove', function (e) {
      if (!ed.pointers.has(e.pointerId) || !ed.start) return;
      ed.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      var pts = Array.from(ed.pointers.values()), st = Array.from(ed.start.pts.values());
      if (pts.length >= 2 && st.length >= 2) {
        var d0 = Math.hypot(st[0].x - st[1].x, st[0].y - st[1].y) || 1;
        var d1 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        ed.p.zoom = OP.clamp(ed.start.zoom * d1 / d0, 1, 3);
        $('#edZoom').value = ed.p.zoom;
      } else if (pts.length === 1 && st.length === 1) {
        editorPan(pts[0].x - st[0].x, pts[0].y - st[0].y);
      }
      ed.dirty = true;
      drawEditor();
    });
    function end(e) {
      ed.pointers.delete(e.pointerId);
      ed.start = ed.pointers.size ? { panX: ed.p.panX, panY: ed.p.panY, zoom: ed.p.zoom, pts: new Map(ed.pointers) } : null;
    }
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);

    $('#edZoom').addEventListener('input', function () { ed.p.zoom = Number(this.value); ed.dirty = true; drawEditor(); });
    $('#edRot').addEventListener('click', function () { ed.p.rot = OP.normRot(ed.p.rot + 90); ed.p.panX = ed.p.panY = 0; ed.dirty = true; drawEditor(); });
    $('#edReset').addEventListener('click', function () {
      ed.p.panX = ed.p.panY = 0; ed.p.zoom = 1; ed.p.rot = 0; $('#edZoom').value = 1; ed.dirty = true; drawEditor();
    });
    $('#edDate').addEventListener('change', function () {
      var v = OP.parseYmd(this.value);
      if (v) {
        var keep = ed.p.date && ed.p.dateFrom === 'exif' ? ed.p.date : null;
        ed.p.date = new Date(v.y, v.m - 1, v.d, keep ? keep.getHours() : 12, keep ? keep.getMinutes() : 0);
        ed.p.dateFrom = 'manual';
      } else { ed.p.date = null; ed.p.dateFrom = null; }
      $('#edDateNote').textContent = ed.p.date ? '手で入力した日付です' : '撮影日がわかりません（入力すると日付が入ります）';
      ed.dirty = true;
      drawEditor();
    });
    $('#edKids').addEventListener('change', function () {
      var on = Array.prototype.filter.call(this.querySelectorAll('input[data-kid]'), function (i) { return i.checked; })
        .map(function (i) { return Number(i.dataset.kid); });
      ed.p.kids = on;
      ed.dirty = true;
      drawEditor();
    });
    $('#edStamp').addEventListener('change', function () { ed.p.stamp = this.checked; ed.dirty = true; drawEditor(); });
    $('#edOn').addEventListener('change', function () { ed.p.on = this.checked; ed.dirty = true; });
    $('#dlgEdit').addEventListener('close', function () {
      var dirty = ed.dirty;
      ed.p = null; ed.pointers.clear(); ed.start = null; ed.dirty = false;
      if (dirty) changed();
    });
  }

  /* ---------- できあがりを見る ---------- */
  async function openPreview() {
    var sheets = sheetsNow();
    var show = sheets.slice(0, 12);
    $('#pvTitle').textContent = 'できあがり（用紙 ' + sheets.length + '枚）';
    $('#pvNote').textContent = (sheets.length > show.length ? 'はじめの' + show.length + '枚を表示しています。' : '') +
      '画面用の小さい画像で作っています。印刷は元の写真で作ります。';
    var grid = $('#pvGrid');
    grid.innerHTML = '';
    $('#dlgPreview').showModal();
    for (var i = 0; i < show.length; i++) {
      var r = await renderSheet(show[i], 0.22, true);
      r.canvas.setAttribute('aria-label', '用紙' + (i + 1));
      grid.appendChild(r.canvas);
      await sleep0();
    }
  }

  /* ---------- 設定 ---------- */
  function renderKids() {
    if (!set.kids.length) set.kids.push({ name: '', birth: '' });
    $('#kidsList').innerHTML = set.kids.map(function (k, i) {
      return '<div class="kid" data-i="' + i + '">' +
        '<input type="text" placeholder="なまえ" maxlength="12" data-f="name" value="' + esc(k.name || '') + '" aria-label="なまえ">' +
        '<input type="date" data-f="birth" value="' + esc(k.birth || '') + '" aria-label="誕生日">' +
        '<button data-del="' + i + '" aria-label="消す">✕</button></div>';
    }).join('');
  }
  // 子どもを1人消す（写真ごとの「写っている子」の番号もつめる）
  function removeKid(i) {
    set.kids.splice(i, 1);
    photos.forEach(function (p) {
      if (!p.kids) return;
      p.kids = p.kids.filter(function (k) { return k !== i; }).map(function (k) { return k > i ? k - 1 : k; });
    });
  }
  var setBefore = '';
  function openSettings() {
    setBefore = JSON.stringify(set);
    renderKids();
    $('#setDateStyle').value = set.dateStyle;
    $('#setAgeStyle').value = set.ageStyle;
    $('#setBatch').value = String(set.batch || 0);
    $('#setRotate').checked = !!set.rotateLandscape;
    $('#printedCount').textContent = '記録している写真: ' + Object.keys(printed).length + '枚';
    $('#dlgSettings').showModal();
  }
  function bindSettings() {
    $('#kidsList').addEventListener('input', function (e) {
      var row = e.target.closest('.kid'); if (!row) return;
      set.kids[Number(row.dataset.i)][e.target.dataset.f] = e.target.value.trim();
      saveSet();
    });
    $('#kidsList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-del]'); if (!b) return;
      removeKid(Number(b.dataset.del));
      saveSet(); renderKids();
    });
    $('#btnAddKid').addEventListener('click', function () {
      if (set.kids.length >= 4) { toast('4人までです'); return; }
      set.kids.push({ name: '', birth: '' }); saveSet(); renderKids();
    });
    $('#setDateStyle').addEventListener('change', function () { set.dateStyle = this.value; saveSet(); });
    $('#setAgeStyle').addEventListener('change', function () { set.ageStyle = this.value; saveSet(); });
    $('#setBatch').addEventListener('change', function () { set.batch = Number(this.value) || 0; saveSet(); });
    $('#setRotate').addEventListener('change', function () { set.rotateLandscape = this.checked; saveSet(); });
    $('#btnClearPrinted').addEventListener('click', function () {
      if (!confirm('印刷済みの記録をぜんぶ消しますか？')) return;
      printed = {}; savePrinted();
      photos.forEach(function (p) { p.printed = false; });
      $('#printedCount').textContent = '記録している写真: 0枚';
    });
    $('#dlgSettings').addEventListener('close', function () {
      for (var i = set.kids.length - 1; i >= 0; i--) {
        if (!set.kids[i] || (!set.kids[i].name && !set.kids[i].birth)) removeKid(i);
      }
      saveSet();
      if (JSON.stringify(set) !== setBefore) changed(); else renderAll();
    });
  }

  /* ---------- つなぎこみ ---------- */
  function pick() { $('#fileInput').click(); }

  function bind() {
    $('#btnPickHero').addEventListener('click', pick);
    $('#btnAdd').addEventListener('click', pick);
    $('#fileInput').addEventListener('change', function () {
      var list = Array.prototype.slice.call(this.files || []);
      this.value = '';
      addFiles(list);
    });
    $('#btnHelp').addEventListener('click', function () { $('#dlgHelp').showModal(); });
    $('#btnSettings').addEventListener('click', openSettings);
    $('#btnPreview').addEventListener('click', openPreview);
    $('#btnClear').addEventListener('click', function () {
      if (!confirm('えらんだ写真をぜんぶ消しますか？（iPhoneの写真は消えません）')) return;
      photos.forEach(function (p) { URL.revokeObjectURL(p.thumb); });
      photos = []; changed();
    });
    Array.prototype.forEach.call(document.querySelectorAll('dialog [data-close]'), function (b) {
      b.addEventListener('click', function () { b.closest('dialog').close(); });
    });

    function seg(id, apply) {
      $(id).addEventListener('click', function (e) {
        var b = e.target.closest('button[data-v]'); if (!b) return;
        apply(b.dataset.v); saveSet(); changed();
      });
    }
    seg('#segPaper', function (v) { set.paper = v; });
    seg('#segPer', function (v) { set.per = Number(v); });
    seg('#segMode', function (v) { set.mode = v; });
    seg('#segStamp', function (v) { set.stamp = v; });

    $('#grid').addEventListener('click', function (e) {
      var card = e.target.closest('.card'); if (!card) return;
      var p = photos.find(function (x) { return x.id === card.dataset.id; }); if (!p) return;
      var act = e.target.closest('[data-act]');
      if (!act) { openEditor(p); return; }
      if (act.dataset.act === 'toggle') p.on = !p.on;
      if (act.dataset.act === 'plus') p.copies = Math.min(99, p.copies + 1);
      if (act.dataset.act === 'minus') p.copies = Math.max(1, p.copies - 1);
      changed();
    });

    $('#hints').addEventListener('click', function (e) {
      var b = e.target.closest('[data-hint]'); if (!b) return;
      var kind = b.dataset.hint, n = 0;
      if (kind === 'sim') photos.forEach(function (p) { if (p.group !== null && !p.best && p.on) { p.on = false; n++; } });
      if (kind === 'printed') photos.forEach(function (p) { if (p.printed && p.on) { p.on = false; n++; } });
      if (kind === 'settings') { openSettings(); return; }
      changed();
      toast(n + '枚をはずしました（✓でもどせます）');
    });

    $('#btnMain').addEventListener('click', function () {
      if (!prepared) prepare(); else sendBatch();
    });
    $('#btnBrowserPrint').addEventListener('click', browserPrint);
    $('#btnMarkDone').addEventListener('click', function () {
      if (prepared) markPrinted(prepared.files.map(function (f, i) { return i; }));
    });
    $('#btnRedo').addEventListener('click', function () { invalidate(); renderBar(); });

    bindEditor();
    bindSettings();
  }

  bind();
  renderAll();

  // テスト用の入り口（画面の動作確認に使う）
  window.__op = {
    photos: function () { return photos; },
    settings: function () { return set; },
    prepared: function () { return prepared; },
    printed: function () { return printed; }
  };
})();
