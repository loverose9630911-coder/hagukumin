// パスの演算（イラストレーターでいう「パスファインダー」）。
//
//   合体（union）      … 2つを1つの形にする
//   型抜き（subtract） … 上の形で下をくり抜く
//   交差（intersect）  … 重なっているところだけ残す
//   中マド（exclude）  … 重なっているところだけ抜く
//
// やり方は Greiner–Hormann という古典的な手順。
//   1. 2つの輪郭の交点を全部見つけて、両方の輪郭に差しこむ
//   2. 各交点に「ここから相手の中に入る／出る」の印をつける
//   3. 演算の種類に応じて、進む向きを決めながら輪郭をたどる
//
// この手順は「頂点がちょうど相手の辺の上に乗っている」ような場面に弱い。
// そこで、そういう形を見つけたら片方をごくわずかに動かして計算し直す
// （retry の中の nudge）。見た目には分からない大きさしか動かさない。
//
// 曲線は先に細かい直線に置きかえてから計算する。
// そのぶん出来上がりは折れ線になるが、細かさ（steps）を上げれば目では分からない。

import {
  pointInPolygon, pointInRings, signedArea, area, polyBox,
  flattenSubpath, rotatePoint, center, round,
} from './geom.js';

const EPS = 1e-9;
const DEGENERATE = Symbol('degenerate');

export const OPS = ['union', 'subtract', 'intersect', 'exclude'];

export const OP_LABEL = {
  union: '合体',
  subtract: '型抜き',
  intersect: '交差',
  exclude: '中マド',
};

/** パス演算にかけられる図形か。 */
export const canCombine = (n) => n.type === 'rect' || n.type === 'ellipse' || n.type === 'path';

// ---- 図形 → 多角形 --------------------------------------------------------

/**
 * 図形をキャンバス上の輪郭（多角形の集まり）に置きかえる。
 * 演算にかけられない種類なら null。
 */
export function toRings(node, steps = 24) {
  const local = localRings(node, steps);
  if (local === null) return null;

  const c = center(node);
  const rot = node.rot || 0;

  return local
    .map((ring) => ring.map((p) => rotatePoint(node.x + p.x, node.y + p.y, c.x, c.y, rot)))
    .filter((ring) => ring.length >= 3);
}

/** 図形の中の座標での輪郭（回転を掛ける前）。 */
function localRings(node, steps) {
  const w = node.w;
  const h = node.h;

  if (node.type === 'rect') {
    const r = Math.min(node.radius || 0, w / 2, h / 2);
    if (r <= 0.01) {
      return [[{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]];
    }
    const seg = Math.max(3, Math.round(steps / 3));
    const ring = [];
    const arc = (cx, cy, from) => {
      for (let i = 0; i <= seg; i++) {
        const a = from + (Math.PI / 2) * (i / seg);
        ring.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
    };
    arc(w - r, r, -Math.PI / 2);      // 右上
    arc(w - r, h - r, 0);             // 右下
    arc(r, h - r, Math.PI / 2);       // 左下
    arc(r, r, Math.PI);               // 左上
    return [ring];
  }

  if (node.type === 'ellipse') {
    const n = Math.max(24, steps * 3);
    const ring = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ring.push({ x: (w / 2) * (1 + Math.cos(a)), y: (h / 2) * (1 + Math.sin(a)) });
    }
    return [ring];
  }

  if (node.type === 'path') {
    return (node.d || [])
      .filter((sub) => sub.closed && (sub.pts || []).length >= 3)
      .map((sub) => flattenSubpath(scaleSub(sub, w, h), steps));
  }

  return null;
}

/** 0〜1で持っている点を、実際の大きさに引きのばす。 */
function scaleSub(sub, w, h) {
  return {
    closed: sub.closed,
    pts: (sub.pts || []).map((p) => {
      const q = { x: p.x * w, y: p.y * h };
      if (p.h1x !== undefined) { q.h1x = p.h1x * w; q.h1y = (p.h1y ?? 0) * h; }
      if (p.h2x !== undefined) { q.h2x = p.h2x * w; q.h2y = (p.h2y ?? 0) * h; }
      return q;
    }),
  };
}

// ---- 多角形 → パスの図形 --------------------------------------------------

/**
 * 計算した輪郭を、そのままパスの図形に戻す。
 * 点は囲みの大きさで割って 0〜1 にしまい直す（拡大縮小に強くするため）。
 */
export function ringsToNode(rings, base = {}) {
  const live = rings.filter((r) => r.length >= 3 && area(r) > 0.01);
  if (live.length === 0) return null;

  const all = live.flat();
  const box = polyBox(all);
  const w = Math.max(box.w, 0.001);
  const h = Math.max(box.h, 0.001);

  return {
    ...base,
    type: 'path',
    x: round(box.x, 2),
    y: round(box.y, 2),
    w: round(box.w, 2),
    h: round(box.h, 2),
    rot: 0,
    rule: 'evenodd',
    d: live.map((ring) => ({
      closed: true,
      pts: dedupe(ring).map((p) => ({
        x: round((p.x - box.x) / w, 5),
        y: round((p.y - box.y) / h, 5),
      })),
    })),
  };
}

function dedupe(ring) {
  const out = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1e-7 || Math.abs(last.y - p.y) > 1e-7) out.push(p);
  }
  while (out.length > 1) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.abs(f.x - l.x) < 1e-7 && Math.abs(f.y - l.y) < 1e-7) out.pop();
    else break;
  }
  return out;
}

// ---- 演算の入口 -----------------------------------------------------------

/**
 * 2つの輪郭の集まりを組み合わせる。
 *
 * 穴のあいた形（輪郭が2つ以上）どうしのときは、輪郭ごとに組み合わせる。
 * 単純な形どうし（ふつうはこちら）では、これで正しい答えになる。
 */
export function combine(ringsA, ringsB, op) {
  if (op === 'exclude') {
    // 中マドは「合体から交差を抜く」と同じ。
    const u = combine(ringsA, ringsB, 'union');
    const i = combine(ringsA, ringsB, 'intersect');
    return i.length === 0 ? u : combine(u, i, 'subtract');
  }

  if (ringsA.length === 0) return op === 'union' ? [...ringsB] : [];
  if (ringsB.length === 0) return op === 'intersect' ? [] : [...ringsA];

  if (op === 'union') return unionAll([...ringsA, ...ringsB]);

  if (op === 'intersect') {
    const out = [];
    for (const a of ringsA) {
      for (const b of ringsB) out.push(...retry(a, b, 'intersect'));
    }
    return out;
  }

  // subtract: A から B の輪郭を順に抜いていく
  let acc = [...ringsA];
  for (const b of ringsB) {
    const next = [];
    for (const a of acc) next.push(...retry(a, b, 'subtract'));
    acc = next;
  }
  return acc;
}

/** 重なっている輪郭どうしを、重ならなくなるまで合体させていく。 */
function unionAll(rings) {
  const pool = rings.filter((r) => r.length >= 3);

  for (let guard = 0; guard < 60; guard++) {
    let merged = false;

    for (let i = 0; i < pool.length && !merged; i++) {
      for (let j = i + 1; j < pool.length && !merged; j++) {
        if (!boxHit(polyBox(pool[i]), polyBox(pool[j]))) continue;

        const res = retry(pool[i], pool[j], 'union');
        // 2つのままなら重なっていない。1つ（や、穴つき）になったら合体できた。
        if (res.length >= 2 && res.length >= 2 && sameAsInput(res, pool[i], pool[j])) continue;

        pool.splice(j, 1);
        pool.splice(i, 1, ...res);
        merged = true;
      }
    }

    if (!merged) break;
  }

  return pool;
}

const boxHit = (a, b) =>
  a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;

/** union の答えが「入力そのまま」か（＝重なっていなかったか）。 */
function sameAsInput(res, a, b) {
  if (res.length !== 2) return false;
  const wanted = [area(a), area(b)].sort((x, y) => x - y);
  const got = res.map(area).sort((x, y) => x - y);
  return Math.abs(wanted[0] - got[0]) < 0.01 && Math.abs(wanted[1] - got[1]) < 0.01;
}

/**
 * 端がぴったり重なっている形はそのままでは解けないので、
 * 片方をごくわずかに動かしてやり直す。
 */
function retry(a, b, op) {
  const size = Math.max(polyBox(a).w, polyBox(a).h, 1);

  for (let attempt = 0; attempt < 7; attempt++) {
    const nudged = attempt === 0 ? b : nudge(b, size * 1e-7 * (attempt * attempt + 1), attempt);
    try {
      return clip(a, nudged, op);
    } catch (e) {
      if (e !== DEGENERATE) throw e;
    }
  }

  // どうしても解けないときは、せめて壊れた形を出さない。
  return op === 'intersect' ? [] : [a];
}

function nudge(ring, d, seed) {
  const ang = (seed * 2.399963) % (Math.PI * 2);   // 黄金角。ずらす向きが偏らないように
  const dx = Math.cos(ang) * d;
  const dy = Math.sin(ang) * d;
  return ring.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

// ---- Greiner–Hormann ------------------------------------------------------

/** 進む向きの決め方。vertex.entry がこの値と同じなら「次へ」、違えば「前へ」。 */
const DIRECTION = {
  union:     { s: false, c: false },
  intersect: { s: true,  c: true },
  subtract:  { s: false, c: true },
};

function clip(subject, clipRing, op) {
  const dir = DIRECTION[op];
  const S = buildList(subject, true);
  const C = buildList(clipRing, false);

  const found = crossAll(S, C);

  if (found === 0) {
    return noCrossing(subject, clipRing, op);
  }

  markEntry(S, clipRing);
  markEntry(C, subject);

  return trace(S, dir);
}

/** 輪郭を、ぐるりとつながった点の列にする。 */
function buildList(ring, onS) {
  const verts = ring.map((p) => ({
    x: p.x, y: p.y, onS,
    next: null, prev: null,
    inter: false, neighbor: null, alpha: 0, entry: false, visited: false,
  }));
  for (let i = 0; i < verts.length; i++) {
    verts[i].next = verts[(i + 1) % verts.length];
    verts[i].prev = verts[(i - 1 + verts.length) % verts.length];
  }
  return verts;
}

/** すべての辺どうしの交点を見つけて、両方の列に差しこむ。 */
function crossAll(S, C) {
  const hits = [];

  for (let i = 0; i < S.length; i++) {
    const a1 = S[i];
    const a2 = S[(i + 1) % S.length];
    for (let j = 0; j < C.length; j++) {
      const b1 = C[j];
      const b2 = C[(j + 1) % C.length];
      const x = cross(a1, a2, b1, b2);
      if (x !== null) hits.push({ i, j, ...x });
    }
  }

  if (hits.length === 0) return 0;
  if (hits.length % 2 !== 0) throw DEGENERATE;   // 数が合わないのは端で接している証拠

  insertInto(S, hits, 'i', 't');
  insertInto(C, hits, 'j', 'u');

  // 差しこんだ点どうしを結びつける（S側の交点と C側の交点は同じ場所）。
  for (const h of hits) {
    h.sv.neighbor = h.cv;
    h.cv.neighbor = h.sv;
  }

  return hits.length;
}

function insertInto(list, hits, edgeKey, alphaKey) {
  const byEdge = new Map();
  for (const h of hits) {
    const k = h[edgeKey];
    if (!byEdge.has(k)) byEdge.set(k, []);
    byEdge.get(k).push(h);
  }

  for (const [edge, group] of byEdge) {
    group.sort((p, q) => p[alphaKey] - q[alphaKey]);

    const a = list[edge];
    const b = a.next;
    let cursor = a;

    for (const h of group) {
      const v = {
        x: h.x, y: h.y, onS: a.onS,
        next: null, prev: null,
        inter: true, neighbor: null, alpha: h[alphaKey], entry: false, visited: false,
      };
      cursor.next = v;
      v.prev = cursor;
      v.next = b;
      b.prev = v;
      cursor = v;

      if (edgeKey === 'i') h.sv = v;
      else h.cv = v;
    }
  }
}

/** 線分どうしの交点。端で接している形なら DEGENERATE を投げる。 */
function cross(a1, a2, b1, b2) {
  const rx = a2.x - a1.x;
  const ry = a2.y - a1.y;
  const sx = b2.x - b1.x;
  const sy = b2.y - b1.y;
  const den = rx * sy - ry * sx;

  const qpx = b1.x - a1.x;
  const qpy = b1.y - a1.y;

  if (Math.abs(den) < 1e-12) {
    // 平行。重なって伸びている場合だけ、やり直しの合図を出す。
    if (Math.abs(qpx * ry - qpy * rx) < 1e-9 && onSegmentRange(a1, a2, b1, b2)) throw DEGENERATE;
    return null;
  }

  const t = (qpx * sy - qpy * sx) / den;
  const u = (qpx * ry - qpy * rx) / den;

  const inT = t > EPS && t < 1 - EPS;
  const inU = u > EPS && u < 1 - EPS;

  if (inT && inU) {
    return { t, u, x: a1.x + t * rx, y: a1.y + t * ry };
  }

  // 端点がちょうど相手の上に乗っている。そのままでは解けないのでやり直す。
  const near = (v) => v > -1e-7 && v < 1 + 1e-7;
  if (near(t) && near(u)) throw DEGENERATE;

  return null;
}

function onSegmentRange(a1, a2, b1, b2) {
  const dx = a2.x - a1.x;
  const dy = a2.y - a1.y;
  const len2 = dx * dx + dy * dy || 1;
  const proj = (p) => ((p.x - a1.x) * dx + (p.y - a1.y) * dy) / len2;
  const p1 = proj(b1);
  const p2 = proj(b2);
  const lo = Math.min(p1, p2);
  const hi = Math.max(p1, p2);
  return hi > EPS && lo < 1 - EPS;
}

/** 各交点に「相手の中に入るところ」か「出るところ」かの印をつける。 */
function markEntry(list, otherRing) {
  const first = list[0];
  let flag = !pointInPolygon(first, otherRing);   // 外から始まるなら、最初の交点は「入る」

  let v = first;
  do {
    if (v.inter) {
      v.entry = flag;
      flag = !flag;
    }
    v = v.next;
  } while (v !== first);
}

/** 印にしたがって輪郭をたどり、新しい形を組み立てる。 */
function trace(S, dir) {
  const out = [];
  const starts = [];

  let v = S[0];
  do {
    if (v.inter) starts.push(v);
    v = v.next;
  } while (v !== S[0]);

  for (const start of starts) {
    if (start.visited) continue;

    const poly = [{ x: start.x, y: start.y }];
    let cur = start;
    let guard = 0;

    do {
      if (++guard > 100000) throw DEGENERATE;

      const forward = cur.entry === (cur.onS ? dir.s : dir.c);
      cur.visited = true;
      if (cur.neighbor) cur.neighbor.visited = true;

      do {
        cur = forward ? cur.next : cur.prev;
        poly.push({ x: cur.x, y: cur.y });
      } while (!cur.inter);

      cur.visited = true;
      if (cur.neighbor) cur.neighbor.visited = true;

      if (!cur.neighbor) break;
      cur = cur.neighbor;
    } while (cur !== start);

    const ring = dedupe(poly);
    if (ring.length >= 3 && area(ring) > 1e-6) out.push(ring);
  }

  return out;
}

/** 交わっていないとき。どちらかがどちらかの中にあるか、離れているか。 */
function noCrossing(subject, clipRing, op) {
  const aInB = pointInPolygon(subject[0], clipRing);
  const bInA = pointInPolygon(clipRing[0], subject);

  if (op === 'union') {
    if (aInB) return [clipRing];
    if (bInA) return [subject];
    return [subject, clipRing];
  }

  if (op === 'intersect') {
    if (aInB) return [subject];
    if (bInA) return [clipRing];
    return [];
  }

  // subtract
  if (aInB) return [];
  if (bInA) return [subject, [...clipRing].reverse()];   // 穴になる
  return [subject];
}
