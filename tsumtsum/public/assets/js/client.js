/* =========================================================
 *  ハグミン ツムツム ― ブラウザ側
 *
 *  ここがやるのは「描くこと」と「指の動きを送ること」だけ。
 *  盤面もスコアも時間も Python エンジンが決めていて、
 *  この JS は受け取った静止盤面のあいだを補間して見せている。
 * =======================================================*/

(function () {
  'use strict';

  var BOOT = window.BOOT;
  var FIELD = BOOT.field;
  var SP = BOOT.sprites;

  var W = FIELD.w;              // 論理幅（エンジンと同じ 540）
  var H = 1080;                 // 論理高さ（画面比率から決めてサーバーへ伝える）
  var ANIM = 0.42;              // 盤面が入れかわるアニメーションの秒数
  var CHAIN_REACH = FIELD.chain_reach;

  var canvas = document.getElementById('cv');
  var ctx = canvas.getContext('2d');

  var images = {};              // charId / 'bomb' / 'bomb_time' -> Image
  var charById = {};
  BOOT.characters.forEach(function (c) { charById[c.id] = c; });

  var G = {
    phase: 'loading',           // loading | ready | play | over
    tsums: [],                  // 表示中のツム（補間ずみ）
    anim: 0,                    // 残りアニメーション時間
    chain: [],
    pointer: null,
    busy: false,
    score: 0,
    shownScore: 0,
    combo: 0,
    time: BOOT.rules.play_time,
    fever: false,
    feverRatio: 0,
    skillRatio: 0,
    skillReady: false,
    countdown: 3.2,
    elapsed: 0,
    particles: [],
    pops: [],
    rings: [],
    bands: [],
    popping: [],
    flash: null,
    shake: 0,
    label: null
  };

  /* ---------------------------------------------------------- 画像の読み込み */

  function loadImages() {
    var list = BOOT.characters.map(function (c) {
      return ['tsum_' + c.id, 'assets/img/tsum_' + c.id + '.png'];
    });
    list.push(['bomb', 'assets/img/bomb.png']);
    list.push(['bomb_time', 'assets/img/bomb_time.png']);

    return Promise.all(list.map(function (pair) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = img.onerror = function () { resolve(); };
        img.src = pair[1];
        images[pair[0]] = img;
      });
    }));
  }

  function spriteFor(t) {
    if (t.k === 'b') return images.bomb;
    if (t.k === 't') return images.bomb_time;
    return images['tsum_' + t.c];
  }

  /* ---------------------------------------------------------- 画面サイズ */

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    H = Math.round(Math.max(FIELD.h_min,
      Math.min(FIELD.h_max, W * rect.height / rect.width)));
  }

  function toLogical(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width * W,
      y: (clientY - rect.top) / rect.height * H
    };
  }

  /* ---------------------------------------------------------- サーバーとのやりとり */

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (res) { return res.json(); });
  }

  function action(type, extra) {
    var body = Object.assign({ type: type }, extra || {});
    return post('api/action.php', body);
  }

  /* ---------------------------------------------------------- 盤面の入れかえ */

  /**
   * サーバーの静止盤面を受け取り、いまの表示位置から補間で移す。
   * 新しく出てきたツムは画面の上から落ちてくるように見せる。
   */
  function applyBoard(board) {
    var current = {};
    G.tsums.forEach(function (t) { current[t.i] = t; });

    G.tsums = board.map(function (item) {
      var old = current[item.i];
      var t = {
        i: item.i, c: item.c, k: item.k, g: item.g,
        r: item.r, tx: item.x, ty: item.y,
        x: item.x, y: item.y,
        fx: old ? old.x : item.x,
        fy: old ? old.y : -item.r - 40 - Math.random() * 260
      };
      if (!old) t.x = t.fx, t.y = t.fy;
      return t;
    });
    G.anim = ANIM;
  }

  function tweenBoard(dt) {
    if (G.anim <= 0) return;
    G.anim = Math.max(0, G.anim - dt);
    var p = 1 - G.anim / ANIM;
    // 落下らしく見えるように、だんだん速くなる補間にする
    var e = p * p * (3 - 2 * p) * 0.35 + p * p * 0.65;
    G.tsums.forEach(function (t) {
      t.x = t.fx + (t.tx - t.fx) * e;
      t.y = t.fy + (t.ty - t.fy) * e;
    });
    if (G.anim === 0) {
      G.tsums.forEach(function (t) { t.x = t.tx; t.y = t.ty; });
    }
  }

  function syncState(state) {
    if (!state) return;
    var wasFever = G.fever;
    G.score = state.score;
    G.combo = state.combo;
    G.time = state.time_left;
    G.fever = state.fever;
    if (state.fever !== wasFever) {
      if (state.fever) Sound.fever();
      Sound.bgmRate(state.fever);
    }
    G.feverRatio = state.fever_ratio;
    G.skillRatio = state.skill_ratio;
    setSkillReady(state.skill_ready);
    if (state.finished && G.phase === 'play') finishGame();
  }

  /* ---------------------------------------------------------- 演出 */

  function playEffects(res) {
    if ((res.cleared || []).length) Sound.pop(res.cleared.length);
    (res.cleared || []).forEach(function (item) {
      G.popping.push({ item: item, t: 1 });
      burst(item);
    });
    if (res.gained) {
      var c = centerOf(res.cleared);
      addPop(c.x, c.y, '+' + res.gained, G.fever ? '#FFE066' : '#ffffff', 1.1);
    }
    (res.effects || []).forEach(function (fx) {
      if (fx.fx === 'ring') G.rings.push({ x: fx.x, y: fx.y, r: fx.r, color: fx.color, t: 1 });
      else if (fx.fx === 'band') G.bands.push({ x: fx.x, y: fx.y, w: fx.w, h: fx.h, color: fx.color, t: 1, rainbow: fx.rainbow });
      else if (fx.fx === 'flash') G.flash = { color: fx.color, t: 1 };
      else if (fx.fx === 'shake') G.shake = Math.max(G.shake, fx.power);
      else if (fx.fx === 'boom') Sound.bomb();
      else if (fx.fx === 'label') G.label = { text: fx.text, t: 1 };
      else if (fx.fx === 'time') addPop(W / 2, H * 0.32, '+' + fx.sec + 'びょう', '#7EF5E0', 1.2);
      else if (fx.fx === 'bomb_born') addPop(fx.x, fx.y - 54, fx.time ? 'タイムボム!' : 'ボム!', '#7EF5E0', 1.1);
    });
  }

  function centerOf(list) {
    if (!list || !list.length) return { x: W / 2, y: H * 0.6 };
    var x = 0, y = 0;
    list.forEach(function (p) { x += p.x; y += p.y; });
    return { x: x / list.length, y: y / list.length };
  }

  function burst(item) {
    var ch = item.char ? charById[item.char] : null;
    var color = ch ? ch.body : '#FFC46B';
    var n = item.big ? 14 : 8;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 120 + Math.random() * 260;
      G.particles.push({
        x: item.x, y: item.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 90,
        r: 3 + Math.random() * (item.big ? 8 : 5),
        life: 0.5 + Math.random() * 0.4,
        color: Math.random() < 0.3 ? '#ffffff' : color
      });
    }
  }

  function addPop(x, y, text, color, scale) {
    G.pops.push({ x: x, y: y, text: text, color: color, t: 1, scale: scale || 1 });
  }

  /* ---------------------------------------------------------- 入力 */

  function tsumAt(x, y) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < G.tsums.length; i++) {
      var t = G.tsums[i];
      var dx = x - t.x, dy = y - t.y;
      var d2 = dx * dx + dy * dy;
      if (d2 <= t.r * t.r && d2 < bestD) { bestD = d2; best = t; }
    }
    return best;
  }

  function canChain(a, b) {
    if (!a || !b || a.k || b.k) return false;      // ボムはつなげない
    if (a.c !== b.c) return false;
    var reach = (a.r + b.r) * CHAIN_REACH;
    var dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy <= reach * reach;
  }

  function bindSoundToggle() {
    var button = document.getElementById('btn-sound');
    if (!button) return;
    var label = function () {
      button.textContent = Sound.isEnabled() ? '♪' : '♪̸';
      button.classList.toggle('off', !Sound.isEnabled());
    };
    label();
    button.addEventListener('click', function (event) {
      event.preventDefault();
      Sound.resume();
      Sound.setEnabled(!Sound.isEnabled());
      label();
    });
  }

  function bindInput() {
    function point(e) {
      if (e.touches) {
        if (!e.touches.length) return null;
        return toLogical(e.touches[0].clientX, e.touches[0].clientY);
      }
      return toLogical(e.clientX, e.clientY);
    }

    function down(e) {
      if (G.phase !== 'play' || G.busy || G.anim > 0) return;
      e.preventDefault();
      var p = point(e);
      if (!p) return;
      G.pointer = p;
      Sound.resume();
      var t = tsumAt(p.x, p.y);
      if (!t) return;
      if (t.k) { sendBomb(t); return; }
      G.chain = [t];
      Sound.chainTick(0);
    }

    function move(e) {
      if (G.phase !== 'play') return;
      var p = point(e);
      if (!p) return;
      G.pointer = p;
      if (!G.chain.length) return;
      e.preventDefault();
      var t = tsumAt(p.x, p.y);
      if (!t || t.k) return;
      var idx = G.chain.indexOf(t);
      if (idx >= 0) {
        if (idx === G.chain.length - 2) G.chain.pop();   // ひとつ戻る
        return;
      }
      if (canChain(G.chain[G.chain.length - 1], t)) {
        G.chain.push(t);
        Sound.chainTick(G.chain.length - 1);
      }
    }

    function up() {
      if (!G.chain.length) return;
      var chain = G.chain;
      G.chain = [];
      G.pointer = null;
      if (G.phase !== 'play') return;
      if (chain.length < 3) { Sound.ng(); return; }
      sendChain(chain);
    }

    canvas.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    canvas.addEventListener('touchstart', down, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
    window.addEventListener('touchcancel', up);

    document.getElementById('btn-skill').addEventListener('click', function () {
      Sound.resume();
      if (G.phase !== 'play' || G.busy || !G.skillReady) {
        if (!G.skillReady) { Sound.ng(); toast('スキルゲージが まだです'); }
        return;
      }
      Sound.skill();
      run(action('skill'));
    });
  }

  function sendChain(chain) {
    run(action('chain', { ids: chain.map(function (t) { return t.i; }) }));
  }

  function sendBomb(bomb) {
    run(action('bomb', { id: bomb.i }));
  }

  /** サーバーへ送って、返ってきた盤面に入れかえる */
  function run(promise) {
    G.busy = true;
    return promise.then(function (res) {
      if (res.expired) { toast('セッションが切れました'); location.href = 'index.php'; return; }
      if (!res.ok) {
        if (res.error) toast(res.error);
        syncState(res.state);
        return;
      }
      playEffects(res);
      if (res.board) applyBoard(res.board);
      syncState(res.state);
    }).catch(function () {
      toast('つうしんに しっぱいしました');
    }).then(function () {
      G.busy = false;
    });
  }

  /* ---------------------------------------------------------- HUD */

  var el = {};
  ['hud-score', 'hud-combo', 'hud-combo-num', 'hud-time', 'hud-timer',
    'hud-timer-arc', 'hud-fever-bar', 'hud-skill-arc', 'btn-skill', 'toast',
    'hud'].forEach(function (id) { el[id] = document.getElementById(id); });

  var TIMER_C = 2 * Math.PI * 42;
  var SKILL_C = 2 * Math.PI * 44;
  var toastTimer = null;

  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 1600);
  }

  function setSkillReady(ready) {
    if (ready === G.skillReady) return;
    G.skillReady = ready;
    el['btn-skill'].classList.toggle('ready', ready);
    el['btn-skill'].classList.toggle('locked', !ready);
    if (ready) toast('スキル じゅんび かんりょう！');
  }

  function drawHud() {
    G.shownScore += (G.score - G.shownScore) * 0.25;
    if (Math.abs(G.score - G.shownScore) < 1) G.shownScore = G.score;
    el['hud-score'].textContent = Math.round(G.shownScore).toLocaleString('ja-JP');

    var t = Math.max(0, Math.ceil(G.time));
    el['hud-time'].textContent = t;
    el['hud-timer'].classList.toggle('warn', G.time <= 10);
    el['hud-timer-arc'].style.strokeDashoffset =
      TIMER_C * (1 - Math.max(0, Math.min(1, G.time / BOOT.rules.play_time)));

    el['hud-combo'].classList.toggle('on', G.combo > 0);
    el['hud-combo-num'].textContent = G.combo;

    el['hud-fever-bar'].style.width = Math.max(0, Math.min(1, G.feverRatio)) * 100 + '%';
    el.hud.classList.toggle('fever', G.fever);
    el['hud-skill-arc'].style.strokeDashoffset =
      SKILL_C * (1 - Math.max(0, Math.min(1, G.skillRatio)));
  }

  /* ---------------------------------------------------------- 描画 */

  function drawSprite(img, x, y, radius, scaleExtra) {
    if (!img || !img.naturalWidth) return;
    var iw = img.naturalWidth, ih = img.naturalHeight;
    var bodyR = iw / SP.box_w;                       // 画像内での体の半径
    var s = (radius / bodyR) * (scaleExtra || 1);
    var cxInImage = iw / 2;
    var cyInImage = ih - bodyR * SP.box_base;
    ctx.drawImage(img, x - cxInImage * s, y - cyInImage * s, iw * s, ih * s);
  }

  function draw() {
    ctx.save();
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    if (G.shake > 0) {
      ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);
    }

    drawBackground();

    G.bands.forEach(function (b) {
      ctx.save();
      ctx.globalAlpha = b.t * 0.5;
      if (b.rainbow) {
        var g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
        ['#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#B983FF'].forEach(function (c, i, a) {
          g.addColorStop(i / (a.length - 1), c);
        });
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = b.color;
      }
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.restore();
    });

    G.popping.forEach(function (p) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.t);
      var img = p.item.kind === 'bomb'
        ? (p.item.time_bomb ? images.bomb_time : images.bomb)
        : images['tsum_' + p.item.char];
      drawSprite(img, p.item.x, p.item.y, p.item.r, 1 + (1 - p.t) * 0.7);
      ctx.restore();
    });

    G.tsums.forEach(function (t) {
      drawSprite(spriteFor(t), t.x, t.y, t.r, 1);
    });

    if (G.chain.length) drawChain();

    G.rings.forEach(function (r) {
      ctx.save();
      ctx.globalAlpha = r.t * 0.9;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 14 * r.t + 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r * (0.25 + (1 - r.t) * 0.95), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });

    G.particles.forEach(function (p) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 0.5));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    G.pops.forEach(function (p) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.t * 1.6);
      ctx.translate(p.x, p.y);
      var s = p.scale * (1 + (1 - p.t) * 0.25);
      ctx.scale(s, s);
      ctx.font = 'bold 34px "Hiragino Maru Gothic ProN", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 7;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(60,40,20,0.75)';
      ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    });

    if (G.label) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, G.label.t * 1.4);
      ctx.font = 'bold 52px "Hiragino Maru Gothic ProN", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 12;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(60,40,20,0.8)';
      ctx.strokeText(G.label.text, W / 2, H * 0.42);
      ctx.fillStyle = '#FFF0A8';
      ctx.fillText(G.label.text, W / 2, H * 0.42);
      ctx.restore();
    }

    if (G.phase === 'ready') drawCountdown();

    if (G.flash) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, G.flash.t) * 0.8;
      ctx.fillStyle = G.flash.color;
      ctx.fillRect(-40, -40, W + 80, H + 80);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawBackground() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    if (G.fever) {
      g.addColorStop(0, '#FFB870');
      g.addColorStop(0.5, '#FFC46B');
      g.addColorStop(1, '#FF8AA8');
    } else {
      g.addColorStop(0, '#9BD7F5');
      g.addColorStop(0.45, '#CFEBFB');
      g.addColorStop(1, '#FFE9C7');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = G.fever ? 0.22 : 0.5;
    ctx.fillStyle = '#ffffff';
    for (var i = 0; i < 5; i++) {
      var cx = ((i * 137 + G.elapsed * (6 + i * 3)) % (W + 200)) - 100;
      var cy = 90 + i * 78;
      var r = 46 + i * 7;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.arc(cx + r * 0.85, cy + r * 0.1, r * 0.75, 0, Math.PI * 2);
      ctx.arc(cx - r * 0.85, cy + r * 0.15, r * 0.65, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, H - 14, W, 14);
  }

  function drawChain() {
    var ch = charById[G.chain[0].c];
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(G.chain[0].x, G.chain[0].y);
    for (var i = 1; i < G.chain.length; i++) ctx.lineTo(G.chain[i].x, G.chain[i].y);
    if (G.pointer) ctx.lineTo(G.pointer.x, G.pointer.y);
    ctx.stroke();
    ctx.strokeStyle = ch ? ch.shade : '#888';
    ctx.lineWidth = 7;
    ctx.stroke();

    G.chain.forEach(function (t) {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r * 1.06, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = ch ? ch.shade : '#888';
      ctx.lineWidth = 3;
      ctx.stroke();
    });
    ctx.restore();

    var last = G.pointer || G.chain[G.chain.length - 1];
    var n = G.chain.length;
    ctx.save();
    ctx.translate(last.x, last.y - 62);
    var big = n >= BOOT.rules.bomb_chain;
    ctx.fillStyle = n >= 3 ? (big ? '#FF6F91' : '#ffffff') : 'rgba(255,255,255,0.75)';
    ctx.strokeStyle = ch ? ch.shade : '#888';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 27, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = big ? '#ffffff' : (ch ? ch.shade : '#555');
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 0, 2);
    ctx.restore();
  }

  function drawCountdown() {
    var n = Math.ceil(G.countdown);
    var frac = G.countdown - Math.floor(G.countdown);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    var s = 1 + (1 - frac) * 0.5;
    ctx.scale(s, s);
    ctx.globalAlpha = Math.min(1, frac * 2.2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 16;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(60,40,20,0.8)';
    var text = n >= 1 ? String(Math.min(n, 3)) : 'START!';
    ctx.font = 'bold ' + (n >= 1 ? 170 : 96) + 'px system-ui, sans-serif';
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = '#FFF2B8';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  /* ---------------------------------------------------------- ループ */

  var lastTs = 0;

  function loop(ts) {
    requestAnimationFrame(loop);
    if (!lastTs) lastTs = ts;
    var dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    update(dt);
    draw();
    drawHud();
  }

  function update(dt) {
    G.elapsed += dt;
    tweenBoard(dt);

    if (G.phase === 'ready') {
      var before = Math.ceil(G.countdown);
      G.countdown -= dt;
      var after = Math.ceil(G.countdown);
      if (after !== before && after >= 0 && after <= 3) Sound.countdown(after === 0);
      if (G.countdown <= 0) startPlay();
    } else if (G.phase === 'play') {
      G.time -= dt;
      if (G.time <= 0) { G.time = 0; finishGame(); }
    }

    var i;
    for (i = G.particles.length - 1; i >= 0; i--) {
      var p = G.particles[i];
      p.vy += 900 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) G.particles.splice(i, 1);
    }
    decay(G.pops, dt, 0.95, function (p) { p.y -= 46 * dt; });
    decay(G.rings, dt, 0.5);
    decay(G.bands, dt, 0.45);
    decay(G.popping, dt, 0.3);
    if (G.label) { G.label.t -= dt / 1.1; if (G.label.t <= 0) G.label = null; }
    if (G.flash) { G.flash.t -= dt / 0.45; if (G.flash.t <= 0) G.flash = null; }
    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 46);
  }

  function decay(list, dt, life, each) {
    for (var i = list.length - 1; i >= 0; i--) {
      list[i].t -= dt / life;
      if (each) each(list[i]);
      if (list[i].t <= 0) list.splice(i, 1);
    }
  }

  /* ---------------------------------------------------------- 進行 */

  function startPlay() {
    G.phase = 'play';
    Sound.bgmStart(false);
    action('start').then(function (res) { syncState(res.state); });
  }

  var finishing = false;

  function finishGame() {
    if (finishing) return;
    finishing = true;
    G.phase = 'over';
    G.chain = [];
    Sound.bgmStop();
    Sound.finish();
    post('api/finish.php', {}).then(showResult).catch(function () {
      toast('結果を ほぞんできませんでした');
    });
  }

  function showResult(data) {
    if (!data || !data.ok) { toast(data && data.error ? data.error : 'エラー'); return; }
    var r = data.result;
    var $ = function (id) { return document.getElementById(id); };
    $('res-score').textContent = r.score.toLocaleString('ja-JP');
    $('res-combo').textContent = r.max_combo;
    $('res-tsum').textContent = r.tsum_cleared;
    $('res-fever').textContent = r.fever_count + ' かい';
    $('res-skill').textContent = r.skills_used + ' かい';
    $('res-coin').textContent = '+' + r.coins.toLocaleString('ja-JP');
    $('res-rank').textContent = data.rank ? data.rank + ' い' : '-';
    $('res-badge').textContent = data.new_high ? 'NEW RECORD!' : 'RESULT';
    $('res-badge').classList.toggle('high', !!data.new_high);

    var ch = data.character;
    $('res-char').innerHTML = '';
    var img = new Image();
    img.src = 'assets/img/tsum_' + ch.id + '.png';
    img.style.height = '54px';
    $('res-char').appendChild(img);
    var name = document.createElement('span');
    name.textContent = ch.name;
    $('res-char').appendChild(name);

    $('res-level').textContent = data.level_up
      ? '★ ' + ch.name + 'が Lv.' + data.level_up + ' に なった！ スキルが つよくなったよ'
      : '';
    document.getElementById('scr-result').classList.add('show');
  }

  /* ---------------------------------------------------------- 起動 */

  function boot() {
    resize();
    window.addEventListener('resize', resize);
    bindInput();
    bindSoundToggle();
    requestAnimationFrame(loop);

    loadImages().then(function () {
      return post('api/session.php', { height: H });
    }).then(function (res) {
      if (!res.ok) {
        toast(res.error || 'ゲームを はじめられません');
        setTimeout(function () { location.href = 'index.php'; }, 2200);
        return;
      }
      applyBoard(res.board);
      G.tsums.forEach(function (t) { t.x = t.tx; t.y = t.ty; t.fx = t.tx; t.fy = t.ty; });
      G.anim = 0;
      syncState(res.state);
      G.phase = 'ready';
    }).catch(function () {
      toast('ゲームエンジンに つながりません');
    });
  }

  // 動作確認用に、いまの盤面と操作を外から触れるようにしておく
  window.__game = {
    state: G,
    tsums: function () { return G.tsums; },
    canChain: canChain,
    sendChain: sendChain
  };

  boot();
})();
