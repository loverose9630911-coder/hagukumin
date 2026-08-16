/* =========================================================
 *  ハグミン ツムツム  ―  キャラクター描画（プロシージャル）
 *  画像素材を一切使わず、Canvas でキャラを描いてスプライト化する
 * =======================================================*/

var Sprites = (function () {

  var cache = {};   // key: charId + '_' + size  -> canvas

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /* ---------- パーツ ---------- */

  function drawEars(ctx, ch, r) {
    var t = ch.ears;
    if (t === 'none') return;
    ctx.save();
    var pos = [-1, 1];
    for (var i = 0; i < 2; i++) {
      var s = pos[i];
      ctx.save();
      if (t === 'round') {
        ctx.translate(s * r * 0.62, -r * 0.72);
        ctx.fillStyle = ch.color;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.36, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = ch.dark; ctx.lineWidth = r * 0.07; ctx.stroke();
        ctx.fillStyle = ch.inner;
        ctx.beginPath(); ctx.arc(0, r * 0.03, r * 0.18, 0, Math.PI * 2); ctx.fill();
      } else if (t === 'pointed') {
        ctx.translate(s * r * 0.66, -r * 0.80);
        ctx.rotate(s * 0.30);
        ctx.scale(1.3, 1.3);
        ctx.fillStyle = ch.color;
        ctx.beginPath();
        ctx.moveTo(-r * 0.30, r * 0.30);
        ctx.quadraticCurveTo(-r * 0.16, -r * 0.56, r * 0.26, r * 0.16);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = ch.dark; ctx.lineWidth = r * 0.055;
        ctx.lineJoin = 'round'; ctx.stroke();
        ctx.fillStyle = ch.inner;
        ctx.beginPath();
        ctx.moveTo(-r * 0.16, r * 0.20);
        ctx.quadraticCurveTo(-r * 0.09, -r * 0.26, r * 0.10, r * 0.11);
        ctx.closePath(); ctx.fill();
      } else if (t === 'long') {
        ctx.translate(s * r * 0.44, -r * 0.88);
        ctx.rotate(s * 0.22);
        ctx.fillStyle = ch.color;
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.22, r * 0.50, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = ch.dark; ctx.lineWidth = r * 0.07; ctx.stroke();
        ctx.fillStyle = ch.inner;
        ctx.beginPath(); ctx.ellipse(0, r * 0.05, r * 0.10, r * 0.30, 0, 0, Math.PI * 2); ctx.fill();
      } else if (t === 'horn') {
        ctx.translate(s * r * 0.54, -r * 0.88);
        ctx.rotate(s * 0.42);
        ctx.scale(1.25, 1.25);
        ctx.fillStyle = ch.inner;
        ctx.beginPath();
        ctx.moveTo(-r * 0.16, r * 0.24);
        ctx.quadraticCurveTo(0, -r * 0.50, r * 0.16, r * 0.24);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = ch.dark; ctx.lineWidth = r * 0.06;
        ctx.lineJoin = 'round'; ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function drawBody(ctx, ch, r) {
    // 影
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(0, r * 0.86, r * 0.72, r * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    var g = ctx.createRadialGradient(-r * 0.30, -r * 0.36, r * 0.10, 0, 0, r * 1.08);
    g.addColorStop(0, lighten(ch.color, 0.34));
    g.addColorStop(0.55, ch.color);
    g.addColorStop(1, mix(ch.color, ch.dark, 0.45));
    ctx.fillStyle = g;
    ctx.beginPath();
    // ツムらしい「まんまる＋下すぼまり」シルエット
    ctx.ellipse(0, 0, r * 0.98, r * 0.94, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ch.dark;
    ctx.lineWidth = r * 0.075;
    ctx.stroke();

    // おなかの明るい部分
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = ch.inner;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.30, r * 0.52, r * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ハイライト
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(-r * 0.38, -r * 0.46, r * 0.22, r * 0.13, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawEyes(ctx, ch, r) {
    var ey = -r * 0.06, ex = r * 0.34;
    ctx.fillStyle = '#3B2A21';
    for (var i = 0; i < 2; i++) {
      var s = i === 0 ? -1 : 1;
      ctx.save();
      ctx.translate(s * ex, ey);
      if (ch.eyes === 'sleepy' || (ch.eyes === 'wink' && s > 0)) {
        ctx.strokeStyle = '#3B2A21';
        ctx.lineWidth = r * 0.075;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(0, r * 0.06, r * 0.17, Math.PI * 1.15, Math.PI * 1.85, false);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.135, r * 0.175, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(-r * 0.045, -r * 0.06, r * 0.055, 0, Math.PI * 2); ctx.fill();
        if (ch.eyes === 'sparkle') {
          ctx.beginPath();
          ctx.arc(r * 0.05, r * 0.06, r * 0.028, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#3B2A21';
      }
      ctx.restore();
    }
  }

  function drawMouth(ctx, ch, r) {
    ctx.save();
    ctx.translate(0, r * 0.30);
    ctx.strokeStyle = '#3B2A21';
    ctx.lineWidth = r * 0.062;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (ch.mouth === 'w') {
      ctx.beginPath();
      ctx.moveTo(-r * 0.20, 0);
      ctx.quadraticCurveTo(-r * 0.10, r * 0.14, 0, 0);
      ctx.quadraticCurveTo(r * 0.10, r * 0.14, r * 0.20, 0);
      ctx.stroke();
    } else if (ch.mouth === 'smile') {
      ctx.beginPath();
      ctx.arc(0, -r * 0.06, r * 0.17, Math.PI * 0.18, Math.PI * 0.82, false);
      ctx.stroke();
    } else if (ch.mouth === 'cat') {
      ctx.beginPath();
      ctx.moveTo(-r * 0.19, -r * 0.03);
      ctx.quadraticCurveTo(-r * 0.095, r * 0.10, 0, -r * 0.02);
      ctx.quadraticCurveTo(r * 0.095, r * 0.10, r * 0.19, -r * 0.03);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.10); ctx.lineTo(0, -r * 0.02);
      ctx.stroke();
    } else { // 'o'
      ctx.fillStyle = '#8A4A57';
      ctx.beginPath();
      ctx.ellipse(0, r * 0.01, r * 0.09, r * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCheeks(ctx, ch, r) {
    ctx.save();
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = ch.cheek;
    for (var i = 0; i < 2; i++) {
      var s = i === 0 ? -1 : 1;
      ctx.beginPath();
      ctx.ellipse(s * r * 0.60, r * 0.20, r * 0.16, r * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawItem(ctx, ch, r) {
    var t = ch.item;
    if (t === 'none') return;
    ctx.save();
    if (t === 'leaf') {
      ctx.translate(r * 0.42, -r * 0.80);
      ctx.rotate(-0.5);
      ctx.fillStyle = '#5FBF6B';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(r * 0.34, -r * 0.30, r * 0.60, -r * 0.02);
      ctx.quadraticCurveTo(r * 0.30, r * 0.20, 0, 0);
      ctx.fill();
      ctx.strokeStyle = '#2F7D3B'; ctx.lineWidth = r * 0.05; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r * 0.06, 0); ctx.lineTo(r * 0.52, -r * 0.05); ctx.stroke();
    } else if (t === 'star') {
      ctx.translate(r * 0.58, -r * 0.66);
      star(ctx, 0, 0, r * 0.26, r * 0.12, 5);
      ctx.fillStyle = '#FFE066'; ctx.fill();
      ctx.strokeStyle = '#E0A800'; ctx.lineWidth = r * 0.05;
      ctx.lineJoin = 'round'; ctx.stroke();
    } else if (t === 'ribbon') {
      ctx.translate(-r * 0.56, -r * 0.60);
      ctx.rotate(-0.35);
      ctx.fillStyle = '#FF4F6D';
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(-r * 0.30, -r * 0.18); ctx.lineTo(-r * 0.30, r * 0.16); ctx.closePath();
      ctx.moveTo(0, 0); ctx.lineTo(r * 0.30, -r * 0.18); ctx.lineTo(r * 0.30, r * 0.16); ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#C22745'; ctx.lineWidth = r * 0.05; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.fillStyle = '#FF7C93';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.11, 0, Math.PI * 2); ctx.fill();
    } else if (t === 'moon') {
      ctx.translate(r * 0.60, -r * 0.62);
      ctx.fillStyle = '#FFE9A8';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.24, Math.PI * 0.35, Math.PI * 1.65, false);
      ctx.quadraticCurveTo(-r * 0.02, 0, r * 0.17, r * 0.14);
      ctx.fill();
      ctx.strokeStyle = '#D9AE3B'; ctx.lineWidth = r * 0.045; ctx.stroke();
    } else if (t === 'crown') {
      ctx.translate(0, -r * 0.98);
      ctx.fillStyle = '#FFD54A';
      ctx.beginPath();
      ctx.moveTo(-r * 0.34, r * 0.16);
      ctx.lineTo(-r * 0.40, -r * 0.22);
      ctx.lineTo(-r * 0.14, -r * 0.02);
      ctx.lineTo(0, -r * 0.30);
      ctx.lineTo(r * 0.14, -r * 0.02);
      ctx.lineTo(r * 0.40, -r * 0.22);
      ctx.lineTo(r * 0.34, r * 0.16);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#C8951A'; ctx.lineWidth = r * 0.055; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.fillStyle = '#FF5E7A';
      ctx.beginPath(); ctx.arc(0, r * 0.01, r * 0.07, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function star(ctx, cx, cy, outer, inner, points) {
    ctx.beginPath();
    for (var i = 0; i < points * 2; i++) {
      var rad = (i % 2 === 0) ? outer : inner;
      var a = (Math.PI / points) * i - Math.PI / 2;
      var x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /* ---------- 色ユーティリティ ---------- */

  function hexToRgb(h) {
    h = h.replace('#', '');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  function rgbToHex(c) {
    return '#' + c.map(function (v) {
      var s = Math.max(0, Math.min(255, Math.round(v))).toString(16);
      return s.length < 2 ? '0' + s : s;
    }).join('');
  }
  function lighten(hex, amt) {
    var c = hexToRgb(hex);
    return rgbToHex(c.map(function (v) { return v + (255 - v) * amt; }));
  }
  function mix(a, b, t) {
    var ca = hexToRgb(a), cb = hexToRgb(b);
    return rgbToHex([0, 1, 2].map(function (i) { return ca[i] * (1 - t) + cb[i] * t; }));
  }

  /* ---------- 公開 ---------- */

  // スプライトの箱：耳・アイテムが上にはみ出すぶんだけ余白を取る
  var BOX_W = 2.30;   // r 倍
  var BOX_H = 2.95;   // r 倍
  var BOX_BASE = 1.25; // 下端から body 中心までの距離（r 倍）

  function box(r) {
    return {
      w: Math.ceil(r * BOX_W),
      h: Math.ceil(r * BOX_H),
      cx: Math.ceil(r * BOX_W) / 2,
      cy: Math.ceil(r * BOX_H) - r * BOX_BASE
    };
  }

  /** キャラのスプライトを取得（r ＝ ツムの半径） */
  function get(charId, r) {
    var key = charId + '_' + r;
    if (cache[key]) return cache[key];
    var ch = CHAR_BY_ID[charId];
    var b = box(r);
    var cv = makeCanvas(b.w, b.h);
    var ctx = cv.getContext('2d');
    ctx.translate(b.cx, b.cy);
    drawEars(ctx, ch, r);
    drawBody(ctx, ch, r);
    drawCheeks(ctx, ch, r);
    drawEyes(ctx, ch, r);
    drawMouth(ctx, ch, r);
    drawItem(ctx, ch, r);
    cv.__cx = b.cx;
    cv.__cy = b.cy;
    cv.__r = r;
    cache[key] = cv;
    return cv;
  }

  /** ボム用スプライト */
  function bomb(r, isTime) {
    var key = (isTime ? 'timebomb_' : 'bomb_') + r;
    if (cache[key]) return cache[key];
    var b = box(r);
    var cv = makeCanvas(b.w, b.h);
    var ctx = cv.getContext('2d');
    ctx.translate(b.cx, b.cy);

    var base = isTime ? '#4FD1C5' : '#4A4A5A';
    var g = ctx.createRadialGradient(-r * 0.32, -r * 0.36, r * 0.08, 0, 0, r);
    g.addColorStop(0, lighten(base, 0.55));
    g.addColorStop(0.6, base);
    g.addColorStop(1, mix(base, '#000000', 0.45));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.96, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = mix(base, '#000000', 0.5);
    ctx.lineWidth = r * 0.08; ctx.stroke();

    // 導火線
    ctx.strokeStyle = '#8A6A3A'; ctx.lineWidth = r * 0.10; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(r * 0.22, -r * 0.86);
    ctx.quadraticCurveTo(r * 0.62, -r * 1.18, r * 0.50, -r * 1.44);
    ctx.stroke();
    ctx.fillStyle = '#FFD34E';
    ctx.beginPath(); ctx.arc(r * 0.50, -r * 1.50, r * 0.17, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FF7A2F';
    ctx.beginPath(); ctx.arc(r * 0.50, -r * 1.50, r * 0.10, 0, Math.PI * 2); ctx.fill();

    if (isTime) {
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold ' + Math.round(r * 0.72) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('+', 0, r * 0.02);
    } else {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(-r * 0.34, -r * 0.36, r * 0.20, r * 0.12, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    cv.__cx = b.cx; cv.__cy = b.cy; cv.__r = r;
    cache[key] = cv;
    return cv;
  }

  /** UI 用（表示したい要素の高さ px からスプライトを作る） */
  function icon(charId, elementHeight) {
    return get(charId, Math.max(9, Math.round(elementHeight / BOX_H)));
  }

  return {
    get: get, bomb: bomb, icon: icon,
    lighten: lighten, mix: mix, star: star,
    BOX_W: BOX_W, BOX_H: BOX_H
  };
})();
