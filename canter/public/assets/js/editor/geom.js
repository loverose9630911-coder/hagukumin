// 図形の位置・大きさ・回転をあつかう計算。
//
// canter の図形は「置き場所（x, y, w, h, rot）」と「その中の形」に分けて持つ。
// 中の形は 0〜1 に正規化した座標で持っているので、
// 大きさを変えても形はそのまま、という当たり前のふるまいがただで手に入る。
//
// ここには画面の要素も、データの保存も出てこない。数だけを相手にする
// （そのぶん Node からそのまま呼べて、テストが書ける）。

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const rad = (deg) => (deg * Math.PI) / 180;
export const round = (v, digits = 3) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/** 点 (px,py) を (cx,cy) のまわりに deg 度まわす。 */
export function rotatePoint(px, py, cx, cy, deg) {
  if (!deg) return { x: px, y: py };
  const a = rad(deg);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

/** 図形の中心。 */
export const center = (n) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

/** 回転を含めた4すみ（左上→右上→右下→左下）。 */
export function corners(n) {
  const c = center(n);
  return [
    [n.x, n.y],
    [n.x + n.w, n.y],
    [n.x + n.w, n.y + n.h],
    [n.x, n.y + n.h],
  ].map(([x, y]) => rotatePoint(x, y, c.x, c.y, n.rot || 0));
}

/** 回転を含めた、まっすぐな囲み。 */
export function bbox(n) {
  const pts = corners(n);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** いくつかの囲みをまとめた囲み。 */
export function unionBox(boxes) {
  if (!boxes.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** キャンバスの点を、図形の中の座標（回転を戻した位置）に直す。 */
export function toLocal(n, px, py) {
  const c = center(n);
  const p = rotatePoint(px, py, c.x, c.y, -(n.rot || 0));
  return { x: p.x - n.x, y: p.y - n.y };
}

/** 図形の中の座標を、キャンバスの点に直す。 */
export function toCanvas(n, lx, ly) {
  const c = center(n);
  return rotatePoint(n.x + lx, n.y + ly, c.x, c.y, n.rot || 0);
}

/** 2つの囲みが重なっているか。 */
export const overlaps = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** 囲み a が b をすっぽり含むか。 */
export const contains = (a, b) =>
  a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;

// ---- ベジェ曲線 -----------------------------------------------------------

/** 3次ベジェの t の位置。 */
export function bezierAt(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/** 点 i から点 i+1 へ向かうときの、2つの制御点。 */
export function handlesBetween(a, b) {
  return [
    { x: a.h2x ?? a.x, y: a.h2y ?? a.y },
    { x: b.h1x ?? b.x, y: b.h1y ?? b.y },
  ];
}

/** その区間が曲がっているか（まっすぐなら分割しなくてよい）。 */
export function isCurved(a, b) {
  const [c1, c2] = handlesBetween(a, b);
  return c1.x !== a.x || c1.y !== a.y || c2.x !== b.x || c2.y !== b.y;
}

/**
 * 曲線を細かい直線の連なりに置きかえる。
 * パス演算も当たり判定も、いったんここを通してから考える。
 */
export function flattenSubpath(sub, steps = 24) {
  const pts = sub.pts || [];
  if (pts.length === 0) return [];
  if (pts.length === 1) return [{ x: pts[0].x, y: pts[0].y }];

  const out = [{ x: pts[0].x, y: pts[0].y }];
  const last = sub.closed ? pts.length : pts.length - 1;

  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (!isCurved(a, b)) {
      out.push({ x: b.x, y: b.y });
      continue;
    }
    const [c1, c2] = handlesBetween(a, b);
    for (let s = 1; s <= steps; s++) {
      out.push(bezierAt(a, c1, c2, b, s / steps));
    }
  }

  // 閉じた形では、終わりの点が始まりと同じになるので落とす。
  if (sub.closed && out.length > 1) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.y - l.y) < 1e-9) out.pop();
  }

  return out;
}

// ---- 多角形 ---------------------------------------------------------------

/** 符号つきの面積。プラスなら時計回り（画面の座標では y が下向きなので）。 */
export function signedArea(poly) {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export const area = (poly) => Math.abs(signedArea(poly));

/** 点が多角形の中にあるか（レイキャスティング）。 */
export function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y)) {
      const x = a.x + ((pt.y - a.y) / (b.y - a.y)) * (b.x - a.x);
      if (pt.x < x) inside = !inside;
    }
  }
  return inside;
}

/** 穴あきの形。奇数回またいだら中（even-odd）。 */
export function pointInRings(pt, rings) {
  let inside = false;
  for (const r of rings) {
    if (pointInPolygon(pt, r)) inside = !inside;
  }
  return inside;
}

/** 多角形の囲み。 */
export function polyBox(poly) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of poly) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 点と線分の距離（線の当たり判定に使う）。 */
export function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
