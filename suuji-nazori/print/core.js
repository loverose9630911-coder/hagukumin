/*
 * おもいでプリント core.js
 * 画面に依存しない計算だけを集めたもの。ブラウザでは window.OP、Node では require() で使う。
 *
 *   用紙とマス割り   PAPERS / cellsMm / sheetSize
 *   切り取りと回転   cellRotation / placePhoto / drawPhoto
 *   日付と年齢       ageAt / ageText / dateText / stampLines / drawStamp
 *   撮影日           readExif（JPEG の EXIF だけ読む。読めなければ null）
 *   似ている・くっきり dHash / hamming / colorDist / groupSimilar / sharpness
 *   そのほか         buildSheets / chunk / printedKey
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OP = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 用紙とマス割り ---------- */

  // 寸法はすべて「たて向き」の mm
  var PAPERS = {
    L:      { id: 'L',      name: 'L判',    w: 89,  h: 127 },
    KG:     { id: 'KG',     name: 'KG',     w: 102, h: 152 },
    HAGAKI: { id: 'HAGAKI', name: 'はがき', w: 100, h: 148 },
    '2L':   { id: '2L',     name: '2L判',   w: 127, h: 178 },
    A4:     { id: 'A4',     name: 'A4',     w: 210, h: 297 }
  };
  var PAPER_ORDER = ['L', 'KG', 'HAGAKI', '2L', 'A4'];

  // 1枚に何面ならべるか
  var LAYOUTS = {
    1: { cols: 1, rows: 1 },
    2: { cols: 1, rows: 2 },
    4: { cols: 2, rows: 2 }
  };
  // 2面・4面のときの外側の余白と、写真どうしのすき間（切りやすさ優先）
  var MULTI_MARGIN_MM = 3;
  var MULTI_GAP_MM = 3;
  var DPI = 300;

  function mmToPx(mm, dpi) { return Math.round(mm / 25.4 * (dpi || DPI)); }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // たて向きの用紙の中のマス（mm）
  function cellsMm(paper, perSheet) {
    var lay = LAYOUTS[perSheet] || LAYOUTS[1];
    if (perSheet === 1 || !LAYOUTS[perSheet]) return [{ x: 0, y: 0, w: paper.w, h: paper.h }];
    var m = MULTI_MARGIN_MM, g = MULTI_GAP_MM;
    var cw = (paper.w - 2 * m - (lay.cols - 1) * g) / lay.cols;
    var ch = (paper.h - 2 * m - (lay.rows - 1) * g) / lay.rows;
    var out = [];
    for (var r = 0; r < lay.rows; r++) {
      for (var c = 0; c < lay.cols; c++) {
        out.push({ x: m + c * (cw + g), y: m + r * (ch + g), w: cw, h: ch });
      }
    }
    return out;
  }

  // 写真の向き（手動回転をふくむ）
  function rotatedSize(natW, natH, rot) {
    return (rot % 180 === 0) ? { w: natW, h: natH } : { w: natH, h: natW };
  }
  function normRot(r) { return (((r || 0) % 360) + 360) % 360; }

  /*
   * 1枚の用紙の大きさ（px）と、そこに並ぶマス（px）を返す。
   * 1面で landscapeOK のときは、横長の写真なら用紙ごと横向きにする（写真は回さない）。
   * それ以外は用紙はたて向きのまま。
   */
  function sheetSize(paper, perSheet, dpi, firstPhoto, landscapeOK) {
    dpi = dpi || DPI;
    var landscape = false;
    if (perSheet === 1 && landscapeOK && firstPhoto) {
      var rs = rotatedSize(firstPhoto.natW, firstPhoto.natH, normRot(firstPhoto.rot));
      landscape = rs.w > rs.h;
    }
    var pw = mmToPx(paper.w, dpi), ph = mmToPx(paper.h, dpi);
    var cells = cellsMm(paper, perSheet).map(function (c) {
      return { x: mmToPx(c.x, dpi), y: mmToPx(c.y, dpi), w: mmToPx(c.w, dpi), h: mmToPx(c.h, dpi) };
    });
    if (perSheet === 1) cells = [{ x: 0, y: 0, w: pw, h: ph }];
    if (landscape) {
      return { w: ph, h: pw, landscape: true, cells: [{ x: 0, y: 0, w: ph, h: pw }] };
    }
    return { w: pw, h: ph, landscape: false, cells: cells };
  }

  /*
   * マスに入れるときの回転（0/90/180/270、時計回り）。
   * 手動回転のあと、写真とマスの縦横がちがえば 270°（左に90°）回してそろえる。
   */
  function cellRotation(natW, natH, manualRot, cellW, cellH) {
    var r = normRot(manualRot);
    var s = rotatedSize(natW, natH, r);
    if (s.w !== s.h && cellW !== cellH && ((s.w > s.h) !== (cellW > cellH))) r = (r + 270) % 360;
    return r;
  }

  /*
   * 回転後の写真（rw×rh）を、マス（bw×bh）に置く。
   *   mode 'fill' … マスをうめるように切り取る（フチなし）。panX/panY(-1〜1) でずらし、zoom(1〜) で寄る
   *   mode 'fit'  … 写真をぜんぶ入れる（余りは白）
   * 返り値: 回転後の写真の座標で使う範囲 {sx,sy,sw,sh} と、マスの中の描き先 {dx,dy,dw,dh}
   */
  function placePhoto(rw, rh, bw, bh, mode, panX, panY, zoom) {
    if (mode === 'fit') {
      var s = Math.min(bw / rw, bh / rh);
      var dw = rw * s, dh = rh * s;
      return { sx: 0, sy: 0, sw: rw, sh: rh, dx: (bw - dw) / 2, dy: (bh - dh) / 2, dw: dw, dh: dh };
    }
    var z = Math.max(1, zoom || 1);
    var boxAR = bw / bh, sw, sh;
    if (rw / rh > boxAR) { sh = rh; sw = rh * boxAR; } else { sw = rw; sh = rw / boxAR; }
    sw /= z; sh /= z;
    var cx = (rw - sw) / 2, cy = (rh - sh) / 2;
    var sx = cx + clamp(panX || 0, -1, 1) * cx;
    var sy = cy + clamp(panY || 0, -1, 1) * cy;
    return { sx: sx, sy: sy, sw: sw, sh: sh, dx: 0, dy: 0, dw: bw, dh: bh };
  }

  /*
   * canvas にマス1つ分の写真を描く（画面のプレビューも、印刷用の書き出しもこれ1つ）。
   *   img        描く画像（元写真でも縮小版でもよい）
   *   natW,natH  元写真の大きさ（縮小版を渡すときも元の大きさ）
   *   cell       {x,y,w,h} 描く場所（px）
   *   rot        cellRotation の結果
   *   pl         placePhoto の結果
   * 返り値: 写真が実際に見えている範囲（日付を入れる位置に使う）
   */
  function drawPhoto(ctx, img, natW, natH, cell, rot, pl) {
    var rs = rotatedSize(natW, natH, rot);
    var k = pl.dw / pl.sw;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cell.x + pl.dx, cell.y + pl.dy, pl.dw, pl.dh);
    ctx.clip();
    ctx.translate(cell.x + pl.dx - pl.sx * k, cell.y + pl.dy - pl.sy * k);
    if (rot === 90) { ctx.translate(rs.w * k, 0); ctx.rotate(Math.PI / 2); }
    else if (rot === 180) { ctx.translate(rs.w * k, rs.h * k); ctx.rotate(Math.PI); }
    else if (rot === 270) { ctx.translate(0, rs.h * k); ctx.rotate(-Math.PI / 2); }
    ctx.drawImage(img, 0, 0, natW * k, natH * k);
    ctx.restore();
    return { x: cell.x + pl.dx, y: cell.y + pl.dy, w: pl.dw, h: pl.dh };
  }

  /* ---------- 日付と年齢 ---------- */

  function parseYmd(s) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || '').trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return { y: y, m: mo, d: d };
  }
  function ymd(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function lastDayOfMonth(y, m) { return new Date(y, m, 0).getDate(); } // m は 1〜12

  /*
   * 撮影日における年齢 {years, months, days}。うまれる前なら null。
   * 「月の日にちが誕生日の日にちに届いたら1か月」。誕生日が31日などで、その月に同じ日が
   * ないときは、その月の最終日に届いたことにする。
   */
  function ageAt(birthStr, date) {
    var b = parseYmd(birthStr);
    if (!b || !(date instanceof Date) || isNaN(date)) return null;
    var y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
    var birth = new Date(b.y, b.m - 1, b.d);
    var day0 = new Date(y, m - 1, d);
    if (day0 < birth) return null;
    var years = y - b.y, months = m - b.m;
    var reached = d >= b.d || d === lastDayOfMonth(y, m);
    if (!reached) months -= 1;
    if (months < 0) { years -= 1; months += 12; }
    var days = Math.round((day0 - birth) / 86400000);
    return { years: years, months: months, days: days };
  }

  // style 'kana' → 3さい5かげつ / 'kanji' → 3歳5か月
  function ageText(age, style) {
    if (!age) return '';
    var kanji = style === 'kanji';
    if (age.years === 0 && age.months === 0) {
      return kanji ? ('生後' + age.days + '日') : ('うまれて' + age.days + 'にち');
    }
    var s = '';
    if (age.years > 0) s += age.years + (kanji ? '歳' : 'さい');
    if (age.months > 0) s += age.months + (kanji ? 'か月' : 'かげつ');
    return s;
  }

  // style 'film' → '26 5 5 / 'plain' → 2026.5.5
  function dateText(date, style) {
    if (!(date instanceof Date) || isNaN(date)) return '';
    var y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
    if (style === 'film') return "'" + String(y).slice(-2) + ' ' + m + ' ' + d;
    return y + '.' + m + '.' + d;
  }

  /*
   * 写真に入れる文字（行の配列）。
   *   mode 'none' | 'date' | 'age'（日付＋年齢）
   *   kids [{name, birth}] のうち、うまれる前の子は出さない
   * 撮影日がわからないときは何も入れない（年齢も出さない）。
   */
  function stampLines(opt) {
    if (!opt || opt.mode === 'none' || !(opt.date instanceof Date) || isNaN(opt.date)) return [];
    var lines = [dateText(opt.date, opt.dateStyle)];
    if (opt.mode === 'age') {
      var parts = [];
      (opt.kids || []).forEach(function (k) {
        var a = ageAt(k.birth, opt.date);
        if (!a) return;
        var t = ageText(a, opt.ageStyle);
        parts.push(k.name ? (k.name + ' ' + t) : t);
      });
      if (parts.length) lines.push(parts.join('・'));
    }
    return lines;
  }

  /* ---------- 撮影日（JPEG の EXIF） ---------- */

  /*
   * JPEG の先頭部分（ArrayBuffer）から撮影日などを読む。読めなければ null。
   * 返り値 {date: Date|null, raw: 'YYYY:MM:DD HH:MM:SS', subsec: '123', orientation: 1〜8, w, h}
   */
  function readExif(buf) {
    try {
      var v = new DataView(buf);
      if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;
      var p = 2;
      while (p + 4 <= v.byteLength) {
        if (v.getUint8(p) !== 0xFF) return null;
        var marker = v.getUint8(p + 1);
        if (marker === 0xDA || marker === 0xD9) return null;
        var len = v.getUint16(p + 2);
        if (marker === 0xE1 && p + 10 <= v.byteLength &&
            v.getUint32(p + 4) === 0x45786966 && v.getUint16(p + 8) === 0) { // 'Exif\0\0'
          return parseTiff(v, p + 10, Math.min(v.byteLength, p + 2 + len));
        }
        p += 2 + len;
      }
    } catch (e) { /* こわれたファイルは読まない */ }
    return null;
  }

  function parseTiff(v, t, end) {
    var bo = v.getUint16(t);
    var le = bo === 0x4949;
    if (!le && bo !== 0x4D4D) return null;
    function u16(o) { return v.getUint16(t + o, le); }
    function u32(o) { return v.getUint32(t + o, le); }
    function inRange(o, n) { return t + o >= t && t + o + n <= end; }
    if (!inRange(2, 6) || u16(2) !== 42) return null;

    function readIfd(off) {
      var out = {};
      if (!inRange(off, 2)) return out;
      var n = u16(off);
      for (var i = 0; i < n; i++) {
        var e = off + 2 + i * 12;
        if (!inRange(e, 12)) break;
        var tag = u16(e), type = u16(e + 2), count = u32(e + 4);
        var val;
        if (type === 2) { // ASCII
          var o = count <= 4 ? e + 8 : u32(e + 8);
          if (!inRange(o, count)) continue;
          var s = '';
          for (var j = 0; j < count; j++) {
            var ch = v.getUint8(t + o + j);
            if (ch === 0) break;
            s += String.fromCharCode(ch);
          }
          val = s;
        } else if (type === 3) { val = u16(e + 8); }     // SHORT
        else if (type === 4) { val = u32(e + 8); }       // LONG
        else continue;
        out[tag] = val;
      }
      return out;
    }

    var ifd0 = readIfd(u32(4));
    if (!Object.keys(ifd0).length) return null; // 1つも読めない＝こわれている
    var exif = typeof ifd0[0x8769] === 'number' ? readIfd(ifd0[0x8769]) : {};
    var raw = exif[0x9003] || exif[0x9004] || ifd0[0x0132] || null;
    var subsec = exif[0x9291] || exif[0x9292] || '';
    return {
      raw: raw,
      date: exifDate(raw),
      subsec: String(subsec).trim(),
      orientation: ifd0[0x0112] || 1,
      w: exif[0xA002] || 0,
      h: exif[0xA003] || 0
    };
  }

  function exifDate(raw) {
    var m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw || '');
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    if (isNaN(d) || d.getFullYear() < 1990) return null;
    return d;
  }

  /* ---------- 似ている・くっきり ---------- */

  // 9×8 のグレー値（72個）から 64bit の dHash（16桁の16進）
  function dHash(gray9x8) {
    var hex = '', nib = 0, bits = 0;
    for (var y = 0; y < 8; y++) {
      for (var x = 0; x < 8; x++) {
        nib = (nib << 1) | (gray9x8[y * 9 + x] > gray9x8[y * 9 + x + 1] ? 1 : 0);
        if (++bits === 4) { hex += nib.toString(16); nib = 0; bits = 0; }
      }
    }
    return hex;
  }
  var POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
  function hamming(a, b) {
    if (!a || !b || a.length !== b.length) return 64;
    var n = 0;
    for (var i = 0; i < a.length; i++) n += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
    return n;
  }

  // 色合いの差（RGB の平均の差の平均、0〜255）。4×4 マスの平均色どうしをくらべる
  function colorDist(a, b) {
    if (!a || !b || a.length !== b.length || !a.length) return 0;
    var s = 0;
    for (var i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length;
  }

  // 似ている判定のしきい値
  var SIMILAR = {
    nearMinutes: 30,   // 撮影時刻がこの分以内なら
    nearMaxDist: 10,   //   形の差（dHash の距離）がこれ以下を「似ている」
    farMaxDist: 6,     // 時刻が離れている・わからないときは、より厳しく
    maxColorDist: 24   // 色合いの差がこれより大きければ、形が近くても別の写真
                       // （空・壁など模様の少ない写真は形の値が近くなりやすいため）
  };

  /*
   * items [{hash, date, color}] を似ているものどうしでまとめる（color は 4×4 の平均色。なくてもよい）。
   * 返り値: items と同じ長さの配列。2枚以上のまとまりには 0,1,2… の番号、1枚だけなら null
   */
  function groupSimilar(items) {
    var n = items.length, parent = [];
    for (var i = 0; i < n; i++) parent[i] = i;
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    for (var a = 0; a < n; a++) {
      for (var b = a + 1; b < n; b++) {
        var A = items[a], B = items[b];
        if (!A.hash || !B.hash) continue;
        var near = A.date instanceof Date && B.date instanceof Date &&
          Math.abs(A.date - B.date) <= SIMILAR.nearMinutes * 60000;
        var lim = near ? SIMILAR.nearMaxDist : SIMILAR.farMaxDist;
        if (hamming(A.hash, B.hash) > lim) continue;
        if (colorDist(A.color, B.color) > SIMILAR.maxColorDist) continue;
        parent[find(a)] = find(b);
      }
    }
    var count = {}, ids = {}, next = 0, out = [];
    for (var c = 0; c < n; c++) { var r = find(c); count[r] = (count[r] || 0) + 1; }
    for (var d = 0; d < n; d++) {
      var root = find(d);
      if (count[root] < 2) { out.push(null); continue; }
      if (!(root in ids)) ids[root] = next++;
      out.push(ids[root]);
    }
    return out;
  }

  // くっきり度（ラプラシアンの分散）。グレー値 w×h。大きいほどくっきり
  function sharpness(gray, w, h) {
    var sum = 0, sum2 = 0, n = 0;
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x;
        var l = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
        sum += l; sum2 += l * l; n++;
      }
    }
    if (!n) return 0;
    var mean = sum / n;
    return sum2 / n - mean * mean;
  }


  /* ---------- 写真に文字を入れる ---------- */

  // 文字の大きさと、ふちからの距離（px）。写真の短い辺に合わせて決める
  function stampMetrics(area, pxPerMm, borderless) {
    var shortMm = Math.min(area.w, area.h) / pxPerMm;
    var fontMm = clamp(shortMm * 0.036, 2.2, 6);
    // フチなし印刷は用紙より少し大きく刷られて端が切れるので、内側に寄せる
    var insetMm = borderless ? 5 : 2.5;
    return { font: fontMm * pxPerMm, inset: insetMm * pxPerMm, gap: fontMm * 0.3 * pxPerMm };
  }

  /*
   * 写真の右下に文字を入れる。lines[0] が日付（いちばん下）、そのあとが年齢（上へ積む）。
   *   turn  写真を自動で回した角度（0 か 270）。文字も写真といっしょに回し、
   *         写真を正しい向きで見たときの右下に来るようにする
   *   文字が写真の幅に入りきらないときは、その行だけ小さくする
   */
  function drawStamp(ctx, area, lines, style, pxPerMm, borderless, turn) {
    if (!lines || !lines.length) return;
    var t = normRot(turn);
    var m = stampMetrics(area, pxPerMm, borderless);
    var w = (t % 180) ? area.h : area.w, h = (t % 180) ? area.w : area.h;
    ctx.save();
    ctx.translate(area.x + area.w / 2, area.y + area.h / 2);
    if (t) ctx.rotate(t * Math.PI / 180);
    var x = w / 2 - m.inset;
    var y = h / 2 - m.inset;
    var maxW = Math.max(1, w - 2 * m.inset);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    for (var i = 0; i < lines.length; i++) {
      var isDate = i === 0;
      var fs = isDate ? m.font : m.font * 0.9;
      var family = (style === 'film' && isDate)
        ? '"Courier New", Menlo, ui-monospace, monospace'
        : '"Hiragino Maru Gothic ProN", "Hiragino Sans", "Noto Sans JP", "IPAGothic", sans-serif';
      ctx.font = 'bold ' + fs.toFixed(1) + 'px ' + family;
      var tw = ctx.measureText(lines[i]).width;
      if (tw > maxW) {
        fs = fs * maxW / tw;
        ctx.font = 'bold ' + fs.toFixed(1) + 'px ' + family;
      }
      if (style === 'film') {
        ctx.fillStyle = '#FF9A2E';
        ctx.shadowColor = 'rgba(255, 90, 0, 0.55)';
        ctx.shadowBlur = fs * 0.18;
        ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
      } else {
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
        ctx.shadowBlur = fs * 0.22;
        ctx.shadowOffsetX = 0; ctx.shadowOffsetY = fs * 0.05;
      }
      ctx.fillText(lines[i], x, y);
      y -= fs + m.gap;
    }
    ctx.restore();
  }

  // 自動で回した角度（全体の回転から手動のぶんを引いたもの）。文字の向きに使う
  function autoTurn(totalRot, manualRot) { return normRot(normRot(totalRot) - normRot(manualRot)); }

  /* ---------- そのほか ---------- */

  /*
   * 写真の並びと枚数から、用紙ごとのマス割り当てを作る。
   * photos [{on, copies}] → [[photoIndex, ...], ...]（1つの配列が用紙1枚）
   */
  function buildSheets(photos, perSheet) {
    var slots = [];
    photos.forEach(function (p, i) {
      if (!p.on) return;
      var c = Math.max(1, Math.min(99, p.copies | 0 || 1));
      for (var k = 0; k < c; k++) slots.push(i);
    });
    return chunk(slots, perSheet);
  }

  function chunk(arr, size) {
    var out = [];
    if (!size || size < 1) return arr.length ? [arr.slice()] : [];
    for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  /*
   * 印刷済みの記録に使うキー。撮影日時（秒以下まで）と大きさで決める。
   * 撮影日がない写真は、中身のハッシュ（呼び出し側で作る）を使う。
   */
  function printedKey(exif, natW, natH, contentHash) {
    if (exif && exif.raw) {
      var w = Math.max(natW, natH), h = Math.min(natW, natH);
      return 'x:' + exif.raw + '.' + (exif.subsec || '') + ':' + w + 'x' + h;
    }
    return contentHash ? 'h:' + contentHash : null;
  }

  return {
    PAPERS: PAPERS, PAPER_ORDER: PAPER_ORDER, LAYOUTS: LAYOUTS, DPI: DPI, SIMILAR: SIMILAR,
    MULTI_MARGIN_MM: MULTI_MARGIN_MM, MULTI_GAP_MM: MULTI_GAP_MM,
    mmToPx: mmToPx, clamp: clamp, cellsMm: cellsMm, sheetSize: sheetSize,
    rotatedSize: rotatedSize, normRot: normRot, cellRotation: cellRotation,
    placePhoto: placePhoto, drawPhoto: drawPhoto,
    parseYmd: parseYmd, ymd: ymd, ageAt: ageAt, ageText: ageText, dateText: dateText,
    stampLines: stampLines, stampMetrics: stampMetrics, drawStamp: drawStamp, autoTurn: autoTurn, readExif: readExif, exifDate: exifDate,
    dHash: dHash, hamming: hamming, colorDist: colorDist, groupSimilar: groupSimilar, sharpness: sharpness,
    buildSheets: buildSheets, chunk: chunk, printedKey: printedKey
  };
});
