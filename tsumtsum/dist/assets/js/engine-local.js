/* =========================================================
 *  ぞうさんとなかまたち ― ブラウザ内エンジン（静的 PWA 版）
 *
 *  Netlify などの静的ホスティングに置いて、iPad のホーム画面から
 *  オフラインで遊べるようにするための版。
 *  Python エンジンと同じ手順・同じ数値でうごくように移植してある。
 *
 *  ・数値（重力・スコア式・フィーバー条件…）は config.json を読む。
 *    もとは engine/zousan/ の Python なので、数値の二重管理はない。
 *  ・PHP の API とまったく同じ形の応答を返すので、
 *    描画側（client.js）はサーバー版と共通のまま動く。
 *
 *  ※ こちらはブラウザの中で完結するので、スコアはプレイヤーの
 *    手元にあります（サーバー版のような不正防止はありません）。
 *    娘の iPad で遊ぶ用なので、それで困りません。
 * =======================================================*/

var LocalEngine = (function () {
  'use strict';

  var CFG = null, RULES = null, FIELD = null, PHYS = null;
  var session = null;

  /* ============================================================ 物理 */

  function Body(id, x, y, r, char, kind, big, timeBomb) {
    this.id = id;
    this.char = char || null;
    this.kind = kind || 'tsum';
    this.r = r;
    this.big = !!big;
    this.timeBomb = !!timeBomb;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.px = x; this.py = y;
    this.asleep = false;
    this.still = 0;
    this.spawn = false;
  }

  Body.prototype.wake = function () { this.asleep = false; this.still = 0; };

  function World(width, height, floorPad) {
    this.width = width;
    this.height = height;
    this.floor = height - floorPad;
    this.cell = 120;
    this.bodies = [];
    this.grid = {};
  }

  World.prototype.add = function (b) { b.px = b.x; b.py = b.y; this.bodies.push(b); return b; };

  World.prototype.remove = function (b) {
    var i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
  };

  World.prototype.removeMany = function (list) {
    var drop = {};
    list.forEach(function (b) { drop[b.id] = 1; });
    this.bodies = this.bodies.filter(function (b) { return !drop[b.id]; });
  };

  World.prototype.wakeAbove = function (y, margin) {
    var limit = y + (margin || 0);
    this.bodies.forEach(function (b) { if (b.y <= limit) b.wake(); });
  };

  World.prototype.awakeCount = function () {
    var n = 0;
    this.bodies.forEach(function (b) { if (!b.asleep) n++; });
    return n;
  };

  World.prototype.buildGrid = function () {
    var grid = {}, cell = this.cell;
    for (var i = 0; i < this.bodies.length; i++) {
      var b = this.bodies[i];
      var key = Math.floor(b.x / cell) + ',' + Math.floor(b.y / cell);
      (grid[key] || (grid[key] = [])).push(b);
    }
    this.grid = grid;
  };

  World.prototype.collectPairs = function () {
    this.buildGrid();
    var grid = this.grid, cell = this.cell, pairs = [];
    for (var i = 0; i < this.bodies.length; i++) {
      var a = this.bodies[i];
      var gx = Math.floor(a.x / cell), gy = Math.floor(a.y / cell);
      for (var dx = -1; dx <= 1; dx++) {
        for (var dy = -1; dy <= 1; dy++) {
          var bucket = grid[(gx + dx) + ',' + (gy + dy)];
          if (!bucket) continue;
          for (var j = 0; j < bucket.length; j++) {
            var c = bucket[j];
            if (c.id <= a.id) continue;
            if (a.asleep && c.asleep) continue;
            var reach = a.r + c.r + PHYS.pair_slack;
            var ddx = c.x - a.x, ddy = c.y - a.y;
            if (ddx * ddx + ddy * ddy <= reach * reach) pairs.push([a, c]);
          }
        }
      }
    }
    return pairs;
  };

  /** Python の World.step と同じ手順 */
  World.prototype.step = function (dt) {
    var bodies = this.bodies, i, b;
    var g = PHYS.gravity * dt, maxV = PHYS.max_speed;

    for (i = 0; i < bodies.length; i++) {
      b = bodies[i];
      b.px = b.x; b.py = b.y;
      if (b.asleep) continue;
      var vy = b.vy + g;
      if (vy > maxV) vy = maxV; else if (vy < -maxV) vy = -maxV;
      var vx = b.vx;
      if (vx > maxV) vx = maxV; else if (vx < -maxV) vx = -maxV;
      b.vx = vx; b.vy = vy;
      b.x += vx * dt; b.y += vy * dt;
    }

    var pairs = this.collectPairs();
    var width = this.width, floor = this.floor;
    for (var it = 0; it < PHYS.iterations; it++) {
      var first = it === 0;
      for (var k = 0; k < pairs.length; k++) {
        var a = pairs[k][0], c = pairs[k][1];
        var aSleep = a.asleep, cSleep = c.asleep;
        if (aSleep && cSleep) continue;
        var ddx = c.x - a.x, ddy = c.y - a.y;
        var rr = a.r + c.r;
        var d2 = ddx * ddx + ddy * ddy;
        if (d2 >= rr * rr) continue;
        var d, nx, ny;
        if (d2 < 1e-8) {
          var ang = (a.id * 12.9898 + c.id * 78.233) % 6.283185;
          nx = Math.cos(ang); ny = Math.sin(ang); d = 0;
        } else {
          d = Math.sqrt(d2);
          nx = ddx / d; ny = ddy / d;
          // 真上に積み重なった「柱」を崩す（めり込みが大きいときだけ）
          if (nx > -0.07 && nx < 0.07 && (rr - d) > 1.0) {
            nx += ((a.id + c.id) % 2) ? 0.06 : -0.06;
            var inv = 1 / Math.sqrt(nx * nx + ny * ny);
            nx *= inv; ny *= inv;
          }
        }
        var overlap = (rr - d) * PHYS.stiffness;
        if (overlap > 0.5) {
          if (aSleep) { a.wake(); aSleep = false; }
          if (cSleep) { c.wake(); cSleep = false; }
        }
        var ma = aSleep ? 0 : 1 / (a.r * a.r);
        var mc = cSleep ? 0 : 1 / (c.r * c.r);
        var total = ma + mc;
        if (total <= 0) continue;
        if (ma) { var pa = overlap * (ma / total); a.x -= nx * pa; a.y -= ny * pa; }
        if (mc) { var pc = overlap * (mc / total); c.x += nx * pc; c.y += ny * pc; }

        if (first) {
          // 摩擦：接している相手との横ずれを打ち消す
          var tdx = (a.x - a.px) - (c.x - c.px);
          var tdy = (a.y - a.py) - (c.y - c.py);
          var tn = tdx * nx + tdy * ny;
          tdx -= tn * nx; tdy -= tn * ny;
          if (ma) { var fa = PHYS.friction * (ma / total); a.x -= tdx * fa; a.y -= tdy * fa; }
          if (mc) { var fc = PHYS.friction * (mc / total); c.x += tdx * fc; c.y += tdy * fc; }
        }
      }
      for (i = 0; i < bodies.length; i++) {
        b = bodies[i];
        if (b.asleep) continue;
        if (b.x - b.r < 0) b.x = b.r;
        else if (b.x + b.r > width) b.x = width - b.r;
        if (b.y + b.r > floor) b.y = floor - b.r;
      }
    }

    var invDt = 1 / dt, movedMax = 0;
    for (i = 0; i < bodies.length; i++) {
      b = bodies[i];
      if (b.asleep) continue;
      var mx = b.x - b.px, my = b.y - b.py;
      var moved = Math.sqrt(mx * mx + my * my);
      if (moved > movedMax) movedMax = moved;
      b.vx = mx * invDt * PHYS.damping;
      b.vy = my * invDt * PHYS.damping;
      if (b.vx > -2 && b.vx < 2) b.vx = 0;
      if (moved < PHYS.sleep_eps) {
        b.still++;
        if (b.still >= PHYS.sleep_frames) { b.asleep = true; b.vx = 0; b.vy = 0; }
      } else {
        b.still = 0;
      }
    }
    return movedMax;
  };

  /** どこにも触れていない（宙に浮いた）円 */
  World.prototype.floatingBodies = function () {
    this.buildGrid();
    var grid = this.grid, cell = this.cell, tol = PHYS.contact_tolerance, out = [];
    for (var i = 0; i < this.bodies.length; i++) {
      var a = this.bodies[i];
      if (a.y + a.r >= this.floor - tol) continue;
      var gx = Math.floor(a.x / cell), gy = Math.floor(a.y / cell);
      var touching = false;
      for (var dx = -1; dx <= 1 && !touching; dx++) {
        for (var dy = -1; dy <= 1 && !touching; dy++) {
          var bucket = grid[(gx + dx) + ',' + (gy + dy)];
          if (!bucket) continue;
          for (var j = 0; j < bucket.length; j++) {
            var c = bucket[j];
            if (c === a) continue;
            var reach = a.r + c.r + tol;
            var ddx = c.x - a.x, ddy = c.y - a.y;
            if (ddx * ddx + ddy * ddy <= reach * reach) { touching = true; break; }
          }
        }
      }
      if (!touching) out.push(a);
    }
    return out;
  };

  World.prototype.settle = function (dt, maxSteps) {
    dt = dt || 1 / 60;
    maxSteps = maxSteps || PHYS.settle_max_steps;
    var steps = 0, quiet = 0, i;
    for (var s = 0; s < maxSteps; s++) {
      if (this.awakeCount() === 0) break;
      this.step(dt);
      steps++;
      if (steps >= PHYS.settle_min_steps) {
        var falling = 0;
        for (i = 0; i < this.bodies.length; i++) {
          if (this.bodies[i].vy > falling) falling = this.bodies[i].vy;
        }
        if (falling < PHYS.settle_speed) {
          quiet++;
          if (quiet >= PHYS.settle_quiet_frames) break;
        } else {
          quiet = 0;
        }
      }
    }
    // 浮いた円が残っていたら着地させる
    for (var t = 0; t < PHYS.settle_landing_steps; t++) {
      var floating = this.floatingBodies();
      if (!floating.length) break;
      floating.forEach(function (b) { b.wake(); });
      this.step(dt);
      steps++;
    }
    this.bodies.forEach(function (b) { b.vx = 0; b.vy = 0; b.asleep = true; });
    return steps;
  };

  /* ============================================================ 盤面 */

  function targetCount(height) {
    var area = Math.PI * FIELD.tsum_r * FIELD.tsum_r;
    var n = Math.round(height * 0.52 * FIELD.w * 0.72 / area);
    return Math.max(45, Math.min(72, n));
  }

  var layoutCache = {};

  /**
   * 最初の山の形を作る。
   *
   * 画面の外から落として積むと 1.7 秒ほどかかって、
   * 「ゲームスタート」を押したあと待たされてしまう。
   * ここでは、はじめから六角形の並びで下から敷きつめて、
   * 軽くゆらして落ち着かせるだけにしている（0.1 秒ほど）。
   */
  function bakeLayout(height, count) {
    var world = new World(FIELD.w, height, FIELD.floor_pad);
    var r = FIELD.tsum_r;
    var perRow = Math.floor(FIELD.w / (r * 2));
    var rowH = r * 1.78;                       // 六角形に積んだときの段の高さ
    var id = 1;
    for (var row = 0; id <= count; row++) {
      var odd = row % 2 === 1;
      var cols = odd ? perRow - 1 : perRow;
      var margin = (FIELD.w - cols * r * 2) / 2;
      for (var col = 0; col < cols && id <= count; col++) {
        var x = margin + r + col * r * 2 + (Math.random() - 0.5) * 3;
        var y = world.floor - r - row * rowH - Math.random() * 2;
        world.add(new Body(id++, x, y, r));
      }
    }
    world.settle(1 / 60, 90);
    return world.bodies.map(function (b) { return [b.x, b.y]; });
  }

  function getLayout(height, count) {
    var key = Math.round(height) + 'x' + count;
    var list = layoutCache[key];
    if (!list) list = layoutCache[key] = [];
    if (list.length < 3) list.push(bakeLayout(height, count));
    return list[Math.floor(Math.random() * list.length)];
  }

  /** タイトル画面のあいだに山の形を作っておく（スタートを待たせない） */
  function prewarm(height) {
    var h = Math.max(FIELD.h_min, Math.min(FIELD.h_max, height));
    getLayout(h, targetCount(h));
  }

  function Board(deck, height) {
    this.height = Math.max(FIELD.h_min, Math.min(FIELD.h_max, height));
    this.deck = deck;
    this.count = targetCount(this.height);
    this.world = new World(FIELD.w, this.height, FIELD.floor_pad);
    this.nextId = 1;
    var self = this;
    getLayout(this.height, this.count).forEach(function (p) {
      var b = new Body(self.nextId++, p[0], p[1], FIELD.tsum_r, self.pickChar());
      b.asleep = true;
      self.world.add(b);
    });
  }

  Board.prototype.pickChar = function () {
    return this.deck[Math.floor(Math.random() * this.deck.length)];
  };

  Board.prototype.tsums = function () {
    return this.world.bodies.filter(function (b) { return b.kind === 'tsum'; });
  };

  Board.prototype.byId = function (id) {
    for (var i = 0; i < this.world.bodies.length; i++) {
      if (this.world.bodies[i].id === id) return this.world.bodies[i];
    }
    return null;
  };

  Board.prototype.pileTop = function () {
    if (!this.world.bodies.length) return this.height;
    return Math.min.apply(null, this.world.bodies.map(function (b) { return b.y; }));
  };

  Board.prototype.spawnTsum = function (above) {
    var r = FIELD.tsum_r;
    var x = r + 6 + Math.random() * (FIELD.w - r * 2 - 12);
    var base = above === undefined ? this.pileTop() : above;
    var y = base - r * 1.4 - Math.random() * r * 0.6;
    var b = new Body(this.nextId++, x, y, r, this.pickChar());
    b.vy = 60;
    b.spawn = true;
    return this.world.add(b);
  };

  Board.prototype.spawnBomb = function (x, y, timeBomb) {
    var b = new Body(this.nextId++, x, Math.min(y, this.height - 160),
      FIELD.bomb_r, null, 'bomb', false, timeBomb);
    b.vy = -160;
    b.spawn = true;
    return this.world.add(b);
  };

  Board.prototype.refill = function () {
    var need = Math.max(0, this.count - this.world.bodies.length);
    if (!need) return [];
    var top = this.pileTop(), out = [];
    for (var i = 0; i < need; i++) {
      out.push(this.spawnTsum(top - Math.floor(i / 3) * FIELD.tsum_r * 1.9));
    }
    return out;
  };

  Board.prototype.validateChain = function (ids) {
    if (ids.length < 3) return { ok: false, error: '3こ以上つないでください' };
    var seen = {}, bodies = [], i;
    for (i = 0; i < ids.length; i++) {
      if (seen[ids[i]]) return { ok: false, error: 'おなじツムが 2かい入っています' };
      seen[ids[i]] = 1;
      var body = this.byId(ids[i]);
      if (!body) return { ok: false, error: 'もう消えているツムです' };
      if (body.kind !== 'tsum') return { ok: false, error: 'ボムは つなげられません' };
      bodies.push(body);
    }
    var first = bodies[0].char;
    for (i = 0; i < bodies.length; i++) {
      if (bodies[i].char !== first) return { ok: false, error: 'ちがうキャラが まざっています' };
    }
    for (i = 0; i < bodies.length - 1; i++) {
      var a = bodies[i], b = bodies[i + 1];
      var reach = (a.r + b.r) * FIELD.chain_reach;
      var dx = a.x - b.x, dy = a.y - b.y;
      if (dx * dx + dy * dy > reach * reach) {
        return { ok: false, error: 'となり同士では ありません' };
      }
    }
    return { ok: true, bodies: bodies };
  };

  Board.prototype.clear = function (list) {
    var self = this;
    var targets = list.filter(function (b) { return self.world.bodies.indexOf(b) >= 0; });
    if (!targets.length) {
      return { cleared: 0, units: 0, byChar: {}, center: null, positions: [] };
    }
    var units = 0, byChar = {}, cx = 0, cy = 0, lowest = -1e9, positions = [];
    targets.forEach(function (b) {
      var weight = b.big ? 3 : 1;
      units += weight;
      if (b.char) byChar[b.char] = (byChar[b.char] || 0) + weight;
      cx += b.x; cy += b.y;
      if (b.y > lowest) lowest = b.y;
      positions.push({
        id: b.id, x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10,
        r: b.r, char: b.char, kind: b.kind, big: b.big, time_bomb: b.timeBomb
      });
    });
    cx /= targets.length; cy /= targets.length;
    this.world.removeMany(targets);
    this.world.wakeAbove(lowest, FIELD.tsum_r * 2);
    return {
      cleared: targets.length, units: units, byChar: byChar,
      center: [Math.round(cx * 10) / 10, Math.round(cy * 10) / 10],
      positions: positions
    };
  };

  Board.prototype.bombTargets = function (bomb) {
    var radius = bomb.timeBomb ? RULES.time_bomb_radius : RULES.bomb_radius;
    var r2 = radius * radius;
    return this.world.bodies.filter(function (b) {
      if (b.kind !== 'tsum') return false;
      var dx = b.x - bomb.x, dy = b.y - bomb.y;
      return dx * dx + dy * dy <= r2;
    });
  };

  Board.prototype.makeBig = function (n) {
    var candidates = this.tsums().filter(function (b) { return !b.big; });
    shuffle(candidates);
    var grown = candidates.slice(0, n);
    grown.forEach(function (b) {
      b.big = true;
      b.r = FIELD.big_r;
      b.y -= 24;
      b.wake();
    });
    if (grown.length) this.world.bodies.forEach(function (b) { b.wake(); });
    return grown;
  };

  Board.prototype.settle = function () { this.world.settle(); };

  Board.prototype.snapshot = function () {
    return this.world.bodies.map(function (b) {
      var item = {
        i: b.id,
        x: Math.round(b.x * 10) / 10,
        y: Math.round(b.y * 10) / 10,
        r: b.r
      };
      if (b.kind === 'bomb') item.k = b.timeBomb ? 't' : 'b';
      else {
        item.c = b.char;
        if (b.big) item.g = 1;
      }
      if (b.spawn) { item.n = 1; b.spawn = false; }
      return item;
    });
  };

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ============================================================ スキル */

  function centerOf(list) {
    var cx = 0, cy = 0;
    list.forEach(function (b) { cx += b.x; cy += b.y; });
    return [cx / list.length, cy / list.length];
  }

  var SKILLS = {
    burst: function (board, power, color) {
      var ts = board.tsums();
      if (!ts.length) return [[], [], 0];
      var c = centerOf(ts), cx = c[0], cy = Math.max(c[1], board.height * 0.55);
      var hit = ts.filter(function (b) {
        var dx = b.x - cx, dy = b.y - cy;
        return dx * dx + dy * dy <= power * power;
      });
      return [hit, [{ fx: 'ring', x: cx, y: cy, r: power, color: color },
        { fx: 'shake', power: 10 }], 0];
    },
    rainbow: function (board, power, color) {
      var ts = board.tsums();
      if (!ts.length) return [[], [], 0];
      var ys = ts.map(function (b) { return b.y; }).sort(function (a, b) { return a - b; });
      var cy = ys[Math.floor(ys.length * 0.55)], half = power / 2;
      var hit = ts.filter(function (b) { return Math.abs(b.y - cy) <= half; });
      return [hit, [{ fx: 'band', x: 0, y: cy - half, w: FIELD.w, h: power, color: color, rainbow: true },
        { fx: 'shake', power: 9 }], 0];
    },
    wave: function (board, power, color) {
      var ts = board.tsums();
      if (!ts.length) return [[], [], 0];
      var half = power / 2;
      var cx = centerOf(ts)[0] + (Math.random() - 0.5) * 120;
      cx = Math.max(half, Math.min(FIELD.w - half, cx));
      var hit = ts.filter(function (b) { return Math.abs(b.x - cx) <= half; });
      return [hit, [{ fx: 'band', x: cx - half, y: 0, w: power, h: board.height, color: color },
        { fx: 'shake', power: 9 }], 0];
    },
    cross: function (board, power, color) {
      var ts = board.tsums();
      if (!ts.length) return [[], [], 0];
      var c = centerOf(ts), cx = c[0], cy = Math.max(c[1], board.height * 0.58);
      var half = power / 2;
      var hit = ts.filter(function (b) {
        return Math.abs(b.y - cy) <= half || Math.abs(b.x - cx) <= half;
      });
      return [hit, [
        { fx: 'band', x: 0, y: cy - half, w: FIELD.w, h: power, color: color },
        { fx: 'band', x: cx - half, y: 0, w: power, h: board.height, color: color },
        { fx: 'shake', power: 10 }], 0];
    },
    ramune: function (board, power, color) {
      var ts = shuffle(board.tsums()).slice(0, Math.floor(power));
      var fx = ts.map(function (b) {
        return { fx: 'ring', x: b.x, y: b.y, r: b.r * 1.6, color: color };
      });
      fx.push({ fx: 'flash', color: color });
      fx.push({ fx: 'shake', power: 7 });
      return [ts, fx, 3];
    },
    dam: function (board, power, color) {
      var grown = board.makeBig(Math.floor(power));
      var fx = grown.map(function (b) {
        return { fx: 'ring', x: b.x, y: b.y, r: b.r * 1.6, color: color };
      });
      fx.push({ fx: 'flash', color: color });
      return [[], fx, 0];
    }
  };

  /* ============================================================ セッション */

  function now() { return Date.now() / 1000; }

  function Session(charId, level, height) {
    this.char = charById(charId);
    this.level = Math.max(0, Math.min(CFG.max_level - 1, level || 0));
    this.deck = buildDeck(charId);
    this.board = new Board(this.deck, height);

    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.lastClearAt = -999;

    this.tsumCleared = 0;
    this.ownCleared = 0;
    this.chainCount = 0;
    this.bombsUsed = 0;
    this.skillsUsed = 0;
    this.feverCount = 0;

    this.skillGauge = 0;
    this.skillNeed = this.char.skill.need[this.level];
    this.skillReady = false;

    this.feverGauge = 0;
    this.feverUntil = 0;

    this.timeBonus = 0;
    this.startedAt = null;
    this.finished = false;
    this.finishedAt = null;
  }

  function buildDeck(charId) {
    var others = CFG.characters.filter(function (c) { return c.id !== charId; })
      .map(function (c) { return c.id; });
    shuffle(others);
    return [charId].concat(others.slice(0, RULES.deck_size - 1));
  }

  function charById(id) {
    for (var i = 0; i < CFG.characters.length; i++) {
      if (CFG.characters[i].id === id) return CFG.characters[i];
    }
    return CFG.characters[0];
  }

  Session.prototype.start = function () {
    if (this.startedAt === null) this.startedAt = now();
  };

  Session.prototype.elapsed = function () {
    if (this.startedAt === null) return 0;
    return (this.finishedAt !== null ? this.finishedAt : now()) - this.startedAt;
  };

  Session.prototype.timeLeft = function () {
    if (this.startedAt === null) return RULES.play_time;
    return Math.max(0, RULES.play_time + this.timeBonus - this.elapsed());
  };

  Session.prototype.inFever = function () {
    return !this.finished && now() < this.feverUntil;
  };

  Session.prototype.addTime = function (seconds) {
    var total = RULES.play_time + this.timeBonus + seconds;
    var capped = Math.min(total, RULES.max_time + this.elapsed());
    this.timeBonus = capped - RULES.play_time;
  };

  Session.prototype.syncCombo = function () {
    if (this.combo && now() - this.lastClearAt > RULES.combo_hold) this.combo = 0;
  };

  Session.prototype.checkTimeout = function () {
    if (!this.finished && this.startedAt !== null && this.timeLeft() <= 0) this.finish();
    return this.finished;
  };

  Session.prototype.chainScore = function (units) {
    var base = units * RULES.base_score;
    var chainBonus = 1 + Math.max(0, units - 3) * 0.08;
    var comboBonus = 1 + Math.min(this.combo, RULES.combo_cap) * 0.02;
    var feverBonus = this.inFever() ? RULES.fever_multiplier : 1;
    return Math.round(base * chainBonus * comboBonus * feverBonus);
  };

  Session.prototype.applyClear = function (bodies) {
    var info = this.board.clear(bodies);
    if (!info.cleared) return { gained: 0, positions: [] };

    this.syncCombo();
    var wasFever = this.inFever();
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.lastClearAt = now();

    var gained = this.chainScore(info.units);
    this.score += gained;
    this.tsumCleared += info.cleared;

    var own = info.byChar[this.char.id] || 0;
    this.ownCleared += own;

    if (!this.skillReady) {
      this.skillGauge = Math.min(this.skillNeed, this.skillGauge + own);
      if (this.skillGauge >= this.skillNeed) this.skillReady = true;
    }

    if (!wasFever) {
      this.feverGauge += info.units;
      if (this.feverGauge >= RULES.fever_need) {
        this.feverGauge = RULES.fever_need;
        this.feverUntil = now() + RULES.fever_time;
        this.feverCount++;
        this.addTime(RULES.fever_time_bonus);
      }
    }
    info.gained = gained;
    return info;
  };

  Session.prototype.state = function () {
    this.syncCombo();
    var fever = this.inFever();
    var feverRatio = fever
      ? (this.feverUntil - now()) / RULES.fever_time
      : this.feverGauge / RULES.fever_need;
    return {
      score: this.score,
      combo: this.combo,
      max_combo: this.maxCombo,
      time_left: Math.round(this.timeLeft() * 100) / 100,
      fever: fever,
      fever_ratio: Math.max(0, Math.min(1, feverRatio)),
      skill_ratio: this.skillReady ? 1 : this.skillGauge / this.skillNeed,
      skill_ready: this.skillReady,
      finished: this.finished
    };
  };

  Session.prototype.finish = function () {
    if (!this.finished) {
      this.finished = true;
      this.finishedAt = now();
    }
    return {
      char_id: this.char.id,
      score: this.score,
      max_combo: this.maxCombo,
      tsum_cleared: this.tsumCleared,
      chain_count: this.chainCount,
      bombs_used: this.bombsUsed,
      skills_used: this.skillsUsed,
      fever_count: this.feverCount,
      coins: Math.floor(this.score / RULES.coin_per_score)
        + this.maxCombo * RULES.coin_per_combo,
      exp: this.ownCleared * RULES.exp_per_own
        + Math.floor(this.score / RULES.exp_per_score)
    };
  };

  /* ============================================================ 操作 */

  function actChain(ids) {
    if (session.checkTimeout()) {
      return { ok: false, error: 'じかんぎれです', state: session.state() };
    }
    var check = session.board.validateChain(ids);
    if (!check.ok) return { ok: false, error: check.error, state: session.state() };

    var count = check.bodies.length;
    var result = session.applyClear(check.bodies);
    session.chainCount++;

    var effects = [], bomb = null;
    if (count >= RULES.bomb_chain && result.center) {
      var timeBomb = count >= RULES.time_bomb_chain;
      bomb = session.board.spawnBomb(result.center[0], result.center[1], timeBomb);
      effects.push({ fx: 'bomb_born', x: result.center[0], y: result.center[1], time: timeBomb });
    }
    session.board.refill();
    session.board.settle();
    return {
      ok: true, gained: result.gained, cleared: result.positions,
      effects: effects, bomb_id: bomb ? bomb.id : null,
      state: session.state(), board: session.board.snapshot()
    };
  }

  function actBomb(id) {
    if (session.checkTimeout()) {
      return { ok: false, error: 'じかんぎれです', state: session.state() };
    }
    var bomb = session.board.byId(id);
    if (!bomb || bomb.kind !== 'bomb') {
      return { ok: false, error: 'そのボムは ありません', state: session.state() };
    }
    var targets = session.board.bombTargets(bomb);
    var radius = bomb.timeBomb ? RULES.time_bomb_radius : RULES.bomb_radius;
    var effects = [
      { fx: 'boom', time: bomb.timeBomb },
      { fx: 'ring', x: bomb.x, y: bomb.y, r: radius, color: bomb.timeBomb ? '#4FD1C5' : '#FFB03A' },
      { fx: 'shake', power: 14 }
    ];
    if (bomb.timeBomb) {
      session.addTime(RULES.time_bomb_bonus);
      effects.push({ fx: 'time', sec: RULES.time_bomb_bonus });
    }
    session.board.world.remove(bomb);
    session.bombsUsed++;
    var result = session.applyClear(targets);
    session.board.refill();
    session.board.settle();
    return {
      ok: true, gained: result.gained || 0, cleared: result.positions || [],
      effects: effects, state: session.state(), board: session.board.snapshot()
    };
  }

  function actSkill() {
    if (session.checkTimeout()) {
      return { ok: false, error: 'じかんぎれです', state: session.state() };
    }
    if (!session.skillReady) {
      return { ok: false, error: 'スキルゲージが まだです', state: session.state() };
    }
    session.skillReady = false;
    session.skillGauge = 0;
    session.skillsUsed++;

    var power = session.char.skill.power[session.level];
    var run = SKILLS[session.char.skill.id];
    var out = run ? run(session.board, power, session.char.body) : [[], [], 0];
    var targets = out[0], effects = out[1], extraTime = out[2];

    if (extraTime) {
      session.addTime(extraTime);
      effects.push({ fx: 'time', sec: extraTime });
    }
    effects.push({ fx: 'label', text: session.char.skill.name });

    var result = targets.length ? session.applyClear(targets) : { gained: 0, positions: [] };
    session.board.refill();
    session.board.settle();
    return {
      ok: true, gained: result.gained || 0, cleared: result.positions || [],
      effects: effects, state: session.state(), board: session.board.snapshot()
    };
  }

  /* ============================================================ API */

  /** PHP の API とおなじ形で応答する（client.js から見た違いを無くす） */
  function request(url, body) {
    body = body || {};
    var res;
    if (url.indexOf('session.php') >= 0) {
      var charId = Store.data().selected;
      session = new Session(charId, Store.level(charId), body.height || 1080);
      res = {
        ok: true,
        deck: session.deck,
        board: session.board.snapshot(),
        field: { w: FIELD.w, h: session.board.height },
        skill: { id: session.char.skill.id, name: session.char.skill.name, need: session.skillNeed },
        character: session.char,
        level: session.level,
        state: session.state()
      };
    } else if (url.indexOf('action.php') >= 0) {
      if (!session) {
        res = { ok: false, error: 'ゲームが はじまっていません', expired: true };
      } else if (body.type === 'start') {
        session.start();
        res = { ok: true, state: session.state() };
      } else if (body.type === 'state') {
        session.checkTimeout();
        res = { ok: true, state: session.state() };
      } else if (body.type === 'chain') {
        res = actChain((body.ids || []).map(Number));
      } else if (body.type === 'bomb') {
        res = actBomb(Number(body.id));
      } else if (body.type === 'skill') {
        res = actSkill();
      } else {
        res = { ok: false, error: 'しらない操作です' };
      }
    } else if (url.indexOf('finish.php') >= 0) {
      if (!session) {
        res = { ok: false, error: 'ゲームが はじまっていません' };
      } else {
        res = Store.record(session.finish());
        session = null;
      }
    } else {
      res = { ok: false, error: 'not found' };
    }
    return Promise.resolve(res);
  }

  function init(config) {
    CFG = config;
    RULES = config.rules;
    FIELD = config.field;
    PHYS = config.physics;
    Store.init(config);
  }

  return {
    enabled: true,
    init: init,
    request: request,
    prewarm: prewarm,
    // 動作確認用
    Board: Board, World: World, Body: Body,
    config: function () { return CFG; }
  };
})();

/* ===========================================================
 *  セーブデータ（静的版は localStorage に入れる）
 * =========================================================*/

var Store = (function () {
  'use strict';

  var KEY = 'zousan_save_v1';
  var CFG = null;
  var data = null;

  function fresh() {
    var d = {
      name: 'ななしさん', coins: 0, plays: 0, high_score: 0,
      max_combo: 0, total_score: 0, selected: CFG.icon_id,
      owned: {}, exp: {}, scores: []
    };
    CFG.free_ids.forEach(function (id) { d.owned[id] = 1; });
    return d;
  }

  function init(config) {
    CFG = config;
    try {
      var raw = localStorage.getItem(KEY);
      data = raw ? JSON.parse(raw) : fresh();
    } catch (e) {
      data = fresh();
    }
    var base = fresh();
    Object.keys(base).forEach(function (k) {
      if (data[k] === undefined) data[k] = base[k];
    });
    CFG.free_ids.forEach(function (id) { data.owned[id] = 1; });
    if (!data.owned[data.selected]) data.selected = CFG.free_ids[0];
    save();
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 無視 */ }
  }

  function level(charId) {
    var exp = data.exp[charId] || 0, lv = 0;
    CFG.exp_table.forEach(function (need, i) { if (exp >= need) lv = i; });
    return lv;
  }

  function progress(charId) {
    var exp = data.exp[charId] || 0, lv = level(charId), table = CFG.exp_table;
    if (lv >= table.length - 1) return null;
    return { cur: exp - table[lv], need: table[lv + 1] - table[lv] };
  }

  function character(id) {
    for (var i = 0; i < CFG.characters.length; i++) {
      if (CFG.characters[i].id === id) return CFG.characters[i];
    }
    return null;
  }

  /** ゲーム終了時の記録。PHP の finish.php と同じ形を返す */
  function record(result) {
    var beforeHigh = data.high_score;
    var beforeLevel = level(result.char_id);

    data.coins += result.coins;
    data.plays += 1;
    data.total_score += result.score;
    data.high_score = Math.max(data.high_score, result.score);
    data.max_combo = Math.max(data.max_combo, result.max_combo);
    data.exp[result.char_id] = (data.exp[result.char_id] || 0) + result.exp;

    if (result.score > 0) {
      data.scores.push({
        name: data.name, char_id: result.char_id,
        score: result.score, max_combo: result.max_combo,
        created_at: new Date().toISOString()
      });
      data.scores.sort(function (a, b) { return b.score - a.score; });
      data.scores = data.scores.slice(0, 20);
    }
    save();

    var afterLevel = level(result.char_id);
    var rank = data.scores.filter(function (s) { return s.score > result.score; }).length + 1;
    return {
      ok: true,
      result: result,
      new_high: result.score > beforeHigh && result.score > 0,
      level_up: afterLevel > beforeLevel ? afterLevel + 1 : null,
      rank: result.score > 0 ? rank : null,
      player: { coins: data.coins, high_score: data.high_score, plays: data.plays },
      character: character(result.char_id)
    };
  }

  function buy(charId) {
    var c = character(charId);
    if (!c || data.owned[charId]) return { ok: false, error: 'すでに おむかえずみです' };
    if (data.coins < c.price) return { ok: false, error: 'コインが たりません' };
    data.coins -= c.price;
    data.owned[charId] = 1;
    data.selected = charId;
    save();
    return { ok: true, coins: data.coins, message: c.name + 'を おむかえしました！' };
  }

  function select(charId) {
    if (!data.owned[charId]) return { ok: false, error: 'そのキャラは まだ つかえません' };
    data.selected = charId;
    save();
    return { ok: true, selected: charId };
  }

  function rename(name) {
    name = String(name || '').trim().slice(0, 12);
    if (name) { data.name = name; save(); }
    return { ok: true, name: data.name };
  }

  return {
    init: init, save: save, data: function () { return data; },
    level: level, progress: progress, character: character,
    record: record, buy: buy, select: select, rename: rename,
    owns: function (id) { return !!data.owned[id]; },
    ranking: function () { return data.scores; }
  };
})();
