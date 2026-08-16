/* =========================================================
 *  ハグミン ツムツム  ―  ゲーム本体
 * =======================================================*/

var GameCore = (function () {

  var W = 540, H = 960;              // 論理解像度（幅は固定、高さは画面比率に追従）
  var H_MIN = 960, H_MAX = 1180;
  var FLOOR_PAD = 8;
  var TSUM_R = 34;
  var BIG_R = 54;
  var targetCount = 50;            // 画面の高さから自動で決まる
  var PLAY_TIME = 60;
  var FEVER_NEED = 55;
  var FEVER_TIME = 10;
  var COMBO_HOLD = 2.2;
  var CHAIN_REACH = 1.34;            // 隣接判定 (r1+r2) * この係数
  var BOMB_CHAIN = 7;                // これ以上つなぐとボム
  var TIME_BOMB_CHAIN = 9;           // これ以上つなぐとタイムボム

  var canvas, ctx, world;
  var uid = 1;
  var raf = null, lastTs = 0, acc = 0;
  var onEnd = null;

  var S = null;                      // 実行中のゲーム状態

  /* ---------------- 初期化 ---------------- */

  function init(cv, endCallback) {
    canvas = cv;
    ctx = canvas.getContext('2d');
    onEnd = endCallback;
    resize();
    window.addEventListener('resize', resize);
    bindInput();
  }

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    // 画面の縦横比に合わせて論理高さを決める（引き伸ばしを防ぐ）
    H = Math.round(Math.max(H_MIN, Math.min(H_MAX, W * rect.height / rect.width)));
    // 画面下半分くらいがツムで埋まるように数を決める
    targetCount = Math.max(45, Math.min(72,
      Math.round(H * 0.52 * W * 0.72 / (Math.PI * TSUM_R * TSUM_R))));
    if (world) {
      world.h = H;
      world.floor = H - FLOOR_PAD;
    }
  }

  function newState(charId) {
    var ch = CHAR_BY_ID[charId];
    var lv = Save.level(charId);
    return {
      charId: charId,
      char: ch,
      level: lv,
      deck: buildDeck(charId),
      score: 0,
      combo: 0,
      maxCombo: 0,
      comboTimer: 0,
      chainCleared: 0,
      tsumCleared: 0,
      ownCleared: 0,
      bombsUsed: 0,
      skillUsed: 0,
      skillCount: 0,
      skillNeed: ch.skill.need[lv],
      skillReady: false,
      feverGauge: 0,
      fever: false,
      feverTimer: 0,
      feverCount: 0,
      time: PLAY_TIME,
      phase: 'ready',                 // ready | play | over
      readyTimer: 3.2,
      chain: [],
      pointer: null,
      spawnCd: 0,
      particles: [],
      pops: [],
      rings: [],
      bands: [],
      popping: [],
      flash: null,
      shake: 0,
      timeFx: 0,
      elapsed: 0
    };
  }

  /** 出現する 5 種類（選択キャラ＋ランダム 4 種） */
  function buildDeck(charId) {
    var others = CHARACTERS.filter(function (c) { return c.id !== charId; });
    // シャッフル
    for (var i = others.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = others[i]; others[i] = others[j]; others[j] = t;
    }
    return [charId].concat(others.slice(0, 4).map(function (c) { return c.id; }));
  }

  /* ---------------- 開始 / 終了 ---------------- */

  function start(charId) {
    S = newState(charId);
    world = new Physics.World(W, H, FLOOR_PAD);
    uid = 1;
    // 最初のツムを積んでおく
    for (var i = 0; i < targetCount; i++) {
      var t = spawnTsum();
      t.y = -Math.random() * 900 - 40;
    }
    // 予め落として安定させる
    for (var k = 0; k < 320; k++) world.step(1 / 120);
    lastTs = 0; acc = 0;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
    Sound.bgmStart(false);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    Sound.bgmStop();
    S = null;
  }

  function pause() {
    if (!S || S.phase === 'over' || !raf) return false;
    cancelAnimationFrame(raf);
    raf = null;
    S.chain = [];
    S.pointer = null;
    Sound.bgmStop();
    return true;
  }

  function resume() {
    if (!S || S.phase === 'over' || raf) return;
    lastTs = 0; acc = 0;
    raf = requestAnimationFrame(loop);
    Sound.bgmStart(S.fever);
  }

  function finish() {
    S.phase = 'over';
    S.chain = [];
    Sound.bgmStop();
    Sound.finish();
    var d = Save.data;
    var prevHigh = d.highScore;
    var coins = Math.floor(S.score / 120) + S.maxCombo * 2;
    d.coins += coins;
    d.plays += 1;
    d.totalScore += S.score;
    if (S.score > d.highScore) d.highScore = S.score;
    if (S.maxCombo > d.maxCombo) d.maxCombo = S.maxCombo;
    var newLv = Save.addExp(S.charId, S.ownCleared * 6 + Math.floor(S.score / 400));
    Save.save();
    var result = {
      score: S.score,
      maxCombo: S.maxCombo,
      tsumCleared: S.tsumCleared,
      chainCleared: S.chainCleared,
      feverCount: S.feverCount,
      skillUsed: S.skillUsed,
      coins: coins,
      newHigh: S.score > prevHigh && S.score > 0,
      levelUp: newLv,
      charId: S.charId
    };
    setTimeout(function () {
      stop();
      if (onEnd) onEnd(result);
    }, 900);
  }

  /* ---------------- ツム生成 ---------------- */

  function spawnTsum(charId, x, y, big) {
    var id = charId || S.deck[Math.floor(Math.random() * S.deck.length)];
    var r = big ? BIG_R : TSUM_R;
    var b = {
      id: uid++,
      kind: 'tsum',
      charId: id,
      r: r,
      isBig: !!big,
      x: x !== undefined ? x : (r + 6 + Math.random() * (W - r * 2 - 12)),
      y: y !== undefined ? y : -r - Math.random() * 120,
      vx: (Math.random() - 0.5) * 60,
      vy: 60,
      squash: 0,
      born: S ? S.elapsed : 0
    };
    return world.add(b);
  }

  function spawnBomb(x, y, isTime) {
    return world.add({
      id: uid++,
      kind: 'bomb',
      charId: null,
      timeBomb: !!isTime,
      r: TSUM_R * 1.12,
      isBig: false,
      x: x, y: y,
      vx: 0, vy: -160,
      squash: 0,
      born: S.elapsed
    });
  }

  /* ---------------- 入力 ---------------- */

  function toLogical(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width * W,
      y: (clientY - rect.top) / rect.height * H
    };
  }

  function bindInput() {
    var down = function (e) {
      if (!S || S.phase !== 'play') return;
      e.preventDefault();
      var p = point(e);
      if (!p) return;
      S.pointer = p;
      var t = hit(p.x, p.y);
      if (!t) return;
      if (t.kind === 'bomb') { explodeBomb(t); return; }
      S.chain = [t];
      Sound.chainTick(0);
    };
    var move = function (e) {
      if (!S || S.phase !== 'play') return;
      var p = point(e);
      if (!p) return;
      S.pointer = p;
      if (!S.chain.length) return;
      e.preventDefault();
      var t = hit(p.x, p.y);
      if (!t || t.kind !== 'tsum') return;
      var idx = S.chain.indexOf(t);
      if (idx >= 0) {
        // ひとつ戻る
        if (idx === S.chain.length - 2) S.chain.pop();
        return;
      }
      var last = S.chain[S.chain.length - 1];
      if (t.charId !== last.charId) return;
      var reach = (t.r + last.r) * CHAIN_REACH;
      var dx = t.x - last.x, dy = t.y - last.y;
      if (dx * dx + dy * dy > reach * reach) return;
      S.chain.push(t);
      Sound.chainTick(S.chain.length - 1);
    };
    var up = function (e) {
      if (!S) return;
      S.pointer = null;
      if (!S.chain.length) return;
      var chain = S.chain;
      S.chain = [];
      if (S.phase !== 'play') return;
      if (chain.length >= 3) {
        clearTsums(chain, 'chain');
      } else {
        Sound.ng();
      }
    };

    function point(e) {
      if (e.touches) {
        if (!e.touches.length) return null;
        return toLogical(e.touches[0].clientX, e.touches[0].clientY);
      }
      return toLogical(e.clientX, e.clientY);
    }

    canvas.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    canvas.addEventListener('touchstart', down, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
    window.addEventListener('touchcancel', up);
  }

  function hit(x, y) {
    var list = world.bodies, best = null, bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var dx = x - b.x, dy = y - b.y;
      var d2 = dx * dx + dy * dy;
      if (d2 <= b.r * b.r && d2 < bestD) { bestD = d2; best = b; }
    }
    return best;
  }

  /* ---------------- 消す処理 ---------------- */

  function clearTsums(list, tag) {
    list = list.filter(function (t) { return world.bodies.indexOf(t) >= 0; });
    if (!list.length) return 0;

    var units = 0, own = 0, cx = 0, cy = 0;
    list.forEach(function (t) {
      units += t.isBig ? 3 : 1;
      if (t.charId === S.charId) own += t.isBig ? 3 : 1;
      cx += t.x; cy += t.y;
      addPopping(t);
      burstParticles(t);
      world.remove(t);
    });
    cx /= list.length; cy /= list.length;

    // スコア
    var base = units * 100;
    var chainBonus = 1 + Math.max(0, units - 3) * 0.08;
    var comboMult = 1 + Math.min(S.combo, 50) * 0.02;
    var feverMult = S.fever ? 2 : 1;
    var gained = Math.round(base * chainBonus * comboMult * feverMult);
    S.score += gained;
    S.tsumCleared += list.length;
    S.ownCleared += own;

    if (tag === 'chain') {
      S.chainCleared++;
      S.combo++;
      S.comboTimer = COMBO_HOLD;
      if (S.combo > S.maxCombo) S.maxCombo = S.combo;
      Sound.pop(list.length);
    }

    // スキルゲージ（自分のツムを消した分）
    if (!S.skillReady) {
      S.skillCount += own;
      if (S.skillCount >= S.skillNeed) {
        S.skillCount = S.skillNeed;
        S.skillReady = true;
        UI.onSkillReady();
      }
    }

    // フィーバーゲージ
    if (!S.fever) {
      S.feverGauge += units;
      if (S.feverGauge >= FEVER_NEED) startFever();
    }

    addPop(cx, cy, '+' + gained, S.fever ? '#FFE066' : '#fff', units >= 7 ? 1.3 : 1);

    // ボム生成
    if (tag === 'chain' && list.length >= BOMB_CHAIN) {
      spawnBomb(cx, Math.min(cy, H - 120), list.length >= TIME_BOMB_CHAIN);
      addPop(cx, cy - 54, list.length >= TIME_BOMB_CHAIN ? 'タイムボム!' : 'ボム!', '#7EF5E0', 1.1);
    }

    refill();
    return gained;
  }

  function explodeBomb(bomb) {
    if (world.bodies.indexOf(bomb) < 0) return;
    var isTime = bomb.timeBomb;
    var R = isTime ? 150 : 175;
    world.remove(bomb);
    addRing(bomb.x, bomb.y, R, isTime ? '#4FD1C5' : '#FFB03A');
    S.shake = Math.max(S.shake, 14);
    Sound.bomb();
    S.bombsUsed++;
    if (isTime) {
      S.time = Math.min(PLAY_TIME + 20, S.time + 5);
      S.timeFx = 1;
      addPop(bomb.x, bomb.y - 40, '+5びょう', '#4FD1C5', 1.2);
    }
    var hits = world.bodies.filter(function (t) {
      var dx = t.x - bomb.x, dy = t.y - bomb.y;
      return t.kind === 'tsum' && dx * dx + dy * dy <= R * R;
    });
    S.combo++;
    S.comboTimer = COMBO_HOLD;
    if (S.combo > S.maxCombo) S.maxCombo = S.combo;
    clearTsums(hits, 'bomb');
  }

  function refill() {
    var need = targetCount - world.bodies.length;
    for (var i = 0; i < need; i++) {
      var t = spawnTsum();
      t.y = -t.r - 20 - Math.random() * (S.fever ? 200 : 420);
    }
  }

  /* ---------------- フィーバー ---------------- */

  function startFever() {
    S.fever = true;
    S.feverTimer = FEVER_TIME;
    S.feverGauge = FEVER_NEED;
    S.feverCount++;
    S.time = Math.min(PLAY_TIME + 20, S.time + 2);
    S.flash = { color: 'rgba(255,220,120,0.55)', t: 1 };
    S.shake = 12;
    Sound.fever();
    Sound.bgmRate(true);
    UI.onFever(true);
  }

  function endFever() {
    S.fever = false;
    S.feverGauge = 0;
    Sound.bgmRate(false);
    UI.onFever(false);
  }

  /* ---------------- スキル ---------------- */

  function useSkill() {
    if (!S || S.phase !== 'play' || !S.skillReady) return false;
    S.skillReady = false;
    S.skillCount = 0;
    S.skillUsed++;
    Sound.skill();
    S.flash = { color: 'rgba(255,255,255,0.4)', t: 1 };
    var power = S.char.skill.power[S.level];
    Skills.run(S.char.skill.id, skillApi(), power);
    addPop(W / 2, H * 0.42, S.char.skill.name, '#FFF0A8', 1.4);
    return true;
  }

  function skillApi() {
    return {
      field: { w: W, h: H },
      tsums: function () {
        return world.bodies.filter(function (b) { return b.kind === 'tsum'; });
      },
      clear: function (list, tag) {
        if (!list || !list.length) return;
        S.combo++;
        S.comboTimer = COMBO_HOLD;
        if (S.combo > S.maxCombo) S.maxCombo = S.combo;
        clearTsums(list, tag || 'skill');
      },
      addTime: function (sec) {
        S.time = Math.min(PLAY_TIME + 20, S.time + sec);
        S.timeFx = 1;
        addPop(W / 2, H * 0.30, '+' + sec + 'びょう', '#7EF5E0', 1.2);
      },
      makeBig: function (n) {
        var cand = world.bodies.filter(function (b) { return b.kind === 'tsum' && !b.isBig; });
        var made = 0;
        for (var i = 0; i < n && cand.length; i++) {
          var idx = Math.floor(Math.random() * cand.length);
          var t = cand.splice(idx, 1)[0];
          t.isBig = true;
          t.r = BIG_R;
          t.y -= 24;
          t.squash = 0.25;
          addRing(t.x, t.y, BIG_R * 1.6, '#9DE0A0');
          made++;
        }
        return made;
      },
      flash: function (color) { S.flash = { color: color, t: 1 }; },
      shake: function (p) { S.shake = Math.max(S.shake, p); },
      ring: function (x, y, r, color) { addRing(x, y, r, color); },
      band: function (x, y, w, h, color) { S.bands.push({ x: x, y: y, w: w, h: h, color: color, t: 1 }); }
    };
  }

  /* ---------------- 演出 ---------------- */

  function addPopping(t) {
    S.popping.push({
      charId: t.charId, kind: t.kind, timeBomb: t.timeBomb,
      x: t.x, y: t.y, r: t.r, t: 1
    });
  }

  function burstParticles(t) {
    var ch = t.charId ? CHAR_BY_ID[t.charId] : null;
    var col = ch ? ch.color : '#FFC46B';
    var n = t.isBig ? 14 : 8;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 120 + Math.random() * 260;
      S.particles.push({
        x: t.x, y: t.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 90,
        r: 3 + Math.random() * (t.isBig ? 8 : 5),
        life: 0.5 + Math.random() * 0.4, max: 0.9,
        color: Math.random() < 0.3 ? '#fff' : col
      });
    }
  }

  function addPop(x, y, text, color, scale) {
    S.pops.push({ x: x, y: y, text: text, color: color || '#fff', t: 1, scale: scale || 1 });
  }

  function addRing(x, y, r, color) {
    S.rings.push({ x: x, y: y, r: r, color: color, t: 1 });
  }

  /* ---------------- ループ ---------------- */

  function loop(ts) {
    raf = requestAnimationFrame(loop);
    if (!lastTs) lastTs = ts;
    var dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    update(dt);
    draw();
  }

  function update(dt) {
    if (!S) return;
    S.elapsed += dt;

    if (S.phase === 'ready') {
      var before = Math.ceil(S.readyTimer);
      S.readyTimer -= dt;
      var after = Math.ceil(S.readyTimer);
      if (after !== before && after >= 0 && after <= 3) Sound.countdown(after === 0);
      if (S.readyTimer <= 0) S.phase = 'play';
    } else if (S.phase === 'play') {
      S.time -= dt;
      if (S.time <= 0) { S.time = 0; finish(); }
      if (S.combo > 0) {
        S.comboTimer -= dt;
        if (S.comboTimer <= 0) S.combo = 0;
      }
      if (S.fever) {
        S.feverTimer -= dt;
        if (S.feverTimer <= 0) endFever();
      }
    }

    // 物理（固定ステップ）
    acc += dt;
    var steps = 0;
    while (acc >= 1 / 120 && steps < 8) {
      world.step(1 / 120);
      acc -= 1 / 120;
      steps++;
    }
    if (steps >= 8) acc = 0;

    // 画面外に落ちたものは補充
    var lost = world.bodies.filter(function (b) { return b.y > H + 200; });
    lost.forEach(function (b) { world.remove(b); });
    if (lost.length) refill();

    // チェーンから消えたツムを除去
    if (S.chain.length) {
      S.chain = S.chain.filter(function (t) { return world.bodies.indexOf(t) >= 0; });
    }

    // エフェクト更新
    var i;
    for (i = S.particles.length - 1; i >= 0; i--) {
      var p = S.particles[i];
      p.vy += 900 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) S.particles.splice(i, 1);
    }
    for (i = S.pops.length - 1; i >= 0; i--) {
      S.pops[i].t -= dt / 0.95;
      S.pops[i].y -= 46 * dt;
      if (S.pops[i].t <= 0) S.pops.splice(i, 1);
    }
    for (i = S.rings.length - 1; i >= 0; i--) {
      S.rings[i].t -= dt / 0.5;
      if (S.rings[i].t <= 0) S.rings.splice(i, 1);
    }
    for (i = S.bands.length - 1; i >= 0; i--) {
      S.bands[i].t -= dt / 0.45;
      if (S.bands[i].t <= 0) S.bands.splice(i, 1);
    }
    for (i = S.popping.length - 1; i >= 0; i--) {
      S.popping[i].t -= dt / 0.3;
      if (S.popping[i].t <= 0) S.popping.splice(i, 1);
    }
    if (S.flash) { S.flash.t -= dt / 0.45; if (S.flash.t <= 0) S.flash = null; }
    if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 46);
    if (S.timeFx > 0) S.timeFx = Math.max(0, S.timeFx - dt / 0.8);

    UI.syncHud(getHud());
  }

  function getHud() {
    return {
      score: S.score,
      time: S.time,
      combo: S.combo,
      comboRatio: S.combo > 0 ? Math.max(0, S.comboTimer / COMBO_HOLD) : 0,
      skillRatio: S.skillReady ? 1 : S.skillCount / S.skillNeed,
      skillReady: S.skillReady,
      feverRatio: S.fever ? S.feverTimer / FEVER_TIME : S.feverGauge / FEVER_NEED,
      fever: S.fever,
      phase: S.phase
    };
  }

  /* ---------------- 描画 ---------------- */

  function draw() {
    if (!S) return;
    var dpr = canvas.width / W;
    ctx.save();
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);

    if (S.shake > 0) {
      ctx.translate((Math.random() - 0.5) * S.shake, (Math.random() - 0.5) * S.shake);
    }

    drawBackground();

    // スキルの帯
    S.bands.forEach(function (b) {
      ctx.save();
      ctx.globalAlpha = b.t * 0.55;
      var g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
      g.addColorStop(0, 'rgba(255,255,255,0.1)');
      g.addColorStop(0.5, b.color);
      g.addColorStop(1, 'rgba(255,255,255,0.1)');
      ctx.fillStyle = g;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.restore();
    });

    // 消えるアニメ
    S.popping.forEach(function (p) {
      var sc = 1 + (1 - p.t) * 0.7;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.t);
      var sp = p.kind === 'bomb' ? Sprites.bomb(Math.round(p.r), p.timeBomb) : Sprites.get(p.charId, Math.round(p.r));
      ctx.translate(p.x, p.y);
      ctx.scale(sc, sc);
      ctx.drawImage(sp, -sp.__cx, -sp.__cy);
      ctx.restore();
    });

    // ツム本体
    var bodies = world.bodies;
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      var sp = b.kind === 'bomb' ? Sprites.bomb(Math.round(b.r), b.timeBomb) : Sprites.get(b.charId, Math.round(b.r));
      var sq = b.squash || 0;
      ctx.save();
      ctx.translate(b.x, b.y);
      if (b.kind === 'bomb') {
        var pulse = 1 + Math.sin(S.elapsed * 8) * 0.05;
        ctx.scale(pulse, pulse);
      }
      if (sq > 0.001) ctx.scale(1 + sq, 1 - sq);
      ctx.drawImage(sp, -sp.__cx, -sp.__cy);
      ctx.restore();
    }

    // チェーン中のハイライト
    if (S.chain.length) drawChain();

    // リング
    S.rings.forEach(function (r) {
      var p = 1 - r.t;
      ctx.save();
      ctx.globalAlpha = r.t * 0.9;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 14 * r.t + 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r * (0.25 + p * 0.95), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });

    // パーティクル
    S.particles.forEach(function (p) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 0.5));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // スコアポップ
    S.pops.forEach(function (p) {
      ctx.save();
      var t = p.t;
      ctx.globalAlpha = Math.min(1, t * 1.6);
      var sc = p.scale * (1 + (1 - t) * 0.25);
      ctx.translate(p.x, p.y);
      ctx.scale(sc, sc);
      ctx.font = 'bold 34px "Hiragino Maru Gothic ProN", "Rounded Mplus 1c", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 7;
      ctx.strokeStyle = 'rgba(60,40,20,0.75)';
      ctx.lineJoin = 'round';
      ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    });

    // カウントダウン
    if (S.phase === 'ready') drawReady();

    // フラッシュ
    if (S.flash) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, S.flash.t) * 0.9;
      ctx.fillStyle = S.flash.color;
      ctx.fillRect(-40, -40, W + 80, H + 80);
      ctx.restore();
    }

    ctx.restore();
  }

  function drawBackground() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    if (S.fever) {
      var k = (Math.sin(S.elapsed * 6) + 1) / 2;
      g.addColorStop(0, Sprites.mix('#FF9E4F', '#FFD86B', k));
      g.addColorStop(0.5, '#FFC46B');
      g.addColorStop(1, '#FF8AA8');
    } else {
      g.addColorStop(0, '#9BD7F5');
      g.addColorStop(0.45, '#CFEBFB');
      g.addColorStop(1, '#FFE9C7');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // ふわふわの雲
    ctx.save();
    ctx.globalAlpha = S.fever ? 0.22 : 0.5;
    ctx.fillStyle = '#fff';
    for (var i = 0; i < 5; i++) {
      var cx = ((i * 137 + S.elapsed * (6 + i * 3)) % (W + 200)) - 100;
      var cy = 90 + i * 78;
      cloud(cx, cy, 46 + i * 7);
    }
    ctx.restore();

    // 地面
    ctx.save();
    ctx.fillStyle = S.fever ? 'rgba(255,140,90,0.35)' : 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, H - FLOOR_PAD - 6, W, FLOOR_PAD + 6);
    ctx.restore();

    if (S.timeFx > 0) {
      ctx.save();
      ctx.globalAlpha = S.timeFx * 0.35;
      ctx.fillStyle = '#4FD1C5';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  function cloud(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.arc(x + r * 0.85, y + r * 0.1, r * 0.75, 0, Math.PI * 2);
    ctx.arc(x - r * 0.85, y + r * 0.15, r * 0.65, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawChain() {
    var ch = CHAR_BY_ID[S.chain[0].charId];
    var pulse = 0.6 + Math.sin(S.elapsed * 12) * 0.25;

    // 線
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.55 + pulse * 0.35) + ')';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(S.chain[0].x, S.chain[0].y);
    for (var i = 1; i < S.chain.length; i++) ctx.lineTo(S.chain[i].x, S.chain[i].y);
    if (S.pointer) ctx.lineTo(S.pointer.x, S.pointer.y);
    ctx.stroke();
    ctx.strokeStyle = ch.dark;
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.restore();

    // 選択リング
    ctx.save();
    S.chain.forEach(function (t, i) {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r * 1.06, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = ch.dark;
      ctx.lineWidth = 3;
      ctx.stroke();
    });
    ctx.restore();

    // 個数バッジ
    var last = S.pointer || S.chain[S.chain.length - 1];
    var n = S.chain.length;
    ctx.save();
    ctx.translate(last.x, last.y - 62);
    var ok = n >= 3;
    ctx.fillStyle = ok ? (n >= BOMB_CHAIN ? '#FF6F91' : '#FFFFFF') : 'rgba(255,255,255,0.75)';
    ctx.strokeStyle = ch.dark;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 27, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = ok && n >= BOMB_CHAIN ? '#fff' : ch.dark;
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 0, 2);
    ctx.restore();
  }

  function drawReady() {
    var n = Math.ceil(S.readyTimer);
    var frac = S.readyTimer - Math.floor(S.readyTimer);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    var sc = 1 + (1 - frac) * 0.5;
    ctx.scale(sc, sc);
    ctx.globalAlpha = Math.min(1, frac * 2.2);
    ctx.font = 'bold 170px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 16; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(60,40,20,0.8)';
    var text = n >= 1 ? String(Math.min(n, 3)) : 'START!';
    if (n <= 0) { ctx.font = 'bold 96px system-ui, sans-serif'; }
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = '#FFF2B8';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  /* ---------------- 公開 ---------------- */

  return {
    init: init,
    start: start,
    stop: stop,
    useSkill: useSkill,
    resize: resize,
    pause: pause,
    resume: resume,
    isPlaying: function () { return !!S && S.phase !== 'over'; },
    state: function () { return S; },
    bodies: function () { return world ? world.bodies : []; },
    size: function () { return { w: W, h: H }; }
  };
})();
