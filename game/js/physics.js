/* =========================================================
 *  ハグミン ツムツム  ―  かんたん円形物理エンジン
 *  ツムが下に積み上がる挙動を作る（外部ライブラリ不使用）
 *
 *  位置ベース（PBD）方式：
 *    1. 重力を加えて仮の位置へ動かす
 *    2. めり込みを「位置」で解く（数回くり返す）
 *    3. 実際に動いた量から速度を作り直す
 *  こうすると、支えられているツムの速度は自然に 0 になり、
 *  積み上がった山がガタガタ振動しない。
 * =======================================================*/

var Physics = (function () {

  var GRAVITY = 2100;      // px/s^2
  var DAMP = 0.986;        // 速度の減衰
  var ITER = 8;            // 位置補正の反復回数
  var STIFF = 0.85;        // めり込みを 1 回でどれだけ戻すか
  var MAX_V = 2600;

  function World(w, h, floorPad) {
    this.w = w;
    this.h = h;
    this.floor = h - (floorPad || 0);
    this.bodies = [];
    this.cell = 120;   // 2 * 大ツム半径(54) より大きくする
    this.grid = {};
  }

  World.prototype.add = function (b) {
    b.px = b.x; b.py = b.y;
    this.bodies.push(b);
    return b;
  };

  World.prototype.remove = function (b) {
    var i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
  };

  World.prototype._rebuildGrid = function () {
    var g = {};
    var cell = this.cell;
    for (var i = 0; i < this.bodies.length; i++) {
      var b = this.bodies[i];
      var k = Math.floor(b.x / cell) + ',' + Math.floor(b.y / cell);
      (g[k] || (g[k] = [])).push(b);
    }
    this.grid = g;
  };

  /** 近傍セル（3x3）のボディを集める */
  World.prototype._neighbors = function (b, out) {
    out.length = 0;
    var cell = this.cell;
    var cx = Math.floor(b.x / cell), cy = Math.floor(b.y / cell);
    for (var dx = -1; dx <= 1; dx++) {
      for (var dy = -1; dy <= 1; dy++) {
        var list = this.grid[(cx + dx) + ',' + (cy + dy)];
        if (!list) continue;
        for (var i = 0; i < list.length; i++) out.push(list[i]);
      }
    }
    return out;
  };

  World.prototype.step = function (dt) {
    var bodies = this.bodies, i, b;

    // 1. 重力を加えて仮の位置へ
    for (i = 0; i < bodies.length; i++) {
      b = bodies[i];
      b.px = b.x; b.py = b.y;
      if (b.frozen) continue;
      b.vy += GRAVITY * dt;
      if (b.vy > MAX_V) b.vy = MAX_V; else if (b.vy < -MAX_V) b.vy = -MAX_V;
      if (b.vx > MAX_V) b.vx = MAX_V; else if (b.vx < -MAX_V) b.vx = -MAX_V;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }

    // 2. めり込みを位置で解く（グリッドは 1 ステップに 1 回だけ作り直す）
    var buf = [];
    this._rebuildGrid();
    for (var it = 0; it < ITER; it++) {
      for (i = 0; i < bodies.length; i++) {
        var a = bodies[i];
        var near = this._neighbors(a, buf);
        for (var j = 0; j < near.length; j++) {
          var c = near[j];
          if (c.id <= a.id) continue;   // 各ペア 1 回だけ
          separate(a, c);
        }
        this._bounds(a);
      }
    }

    // 3. 動いた量から速度を作り直す
    var inv = 1 / dt;
    for (i = 0; i < bodies.length; i++) {
      b = bodies[i];
      if (b.frozen) continue;
      var nvx = (b.x - b.px) * inv;
      var nvy = (b.y - b.py) * inv;
      // 急に止まったらつぶれる演出
      if (b.vy > 900 && nvy < b.vy * 0.45) {
        b.squash = Math.max(b.squash || 0, Math.min(0.26, b.vy / 6500));
      }
      b.vx = nvx * DAMP;
      b.vy = nvy * DAMP;
      if (Math.abs(b.vx) < 2) b.vx = 0;
      if (b.squash) b.squash *= Math.pow(0.002, dt);
    }
  };

  World.prototype._bounds = function (b) {
    if (b.frozen) return;
    if (b.x - b.r < 0) b.x = b.r;
    else if (b.x + b.r > this.w) b.x = this.w - b.r;
    if (b.y + b.r > this.floor) b.y = this.floor - b.r;
    // 上方向は制限しない（画面外から落ちてくるため）
  };

  function separate(a, c) {
    var dx = c.x - a.x, dy = c.y - a.y;
    var rr = a.r + c.r;
    var d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) return;

    var d = Math.sqrt(d2), nx, ny;
    if (d < 0.0001) {
      // 完全に重なったら適当な向きへ逃がす
      var ang = (a.id * 12.9898 + c.id * 78.233) % 6.283;
      nx = Math.cos(ang); ny = Math.sin(ang); d = 0.0001;
    } else {
      nx = dx / d; ny = dy / d;
      // 真上に積み重なった「柱」は崩れないので、わずかに横へずらして崩す
      if (nx < 0.07 && nx > -0.07) {
        nx += ((a.id + c.id) % 2 ? 0.06 : -0.06);
        var len = Math.sqrt(nx * nx + ny * ny);
        nx /= len; ny /= len;
      }
    }

    var overlap = (rr - d) * STIFF;
    // 質量は半径の 2 乗に比例（大ツムは押されにくい）
    var ma = a.frozen ? 0 : 1 / (a.r * a.r);
    var mc = c.frozen ? 0 : 1 / (c.r * c.r);
    var total = ma + mc;
    if (total <= 0) return;

    var pa = overlap * (ma / total);
    var pc = overlap * (mc / total);
    a.x -= nx * pa; a.y -= ny * pa;
    c.x += nx * pc; c.y += ny * pc;
  }

  return { World: World, GRAVITY: GRAVITY };
})();
