// デザイン1枚の中身（doc）と、その組みかえ。
//
// doc = { v, w, h, bg, nodes: [...] }
//
// 図形（node）はどれも「置き場所」を同じ形で持つ。
//   x, y, w, h  … 回転する前の囲み（キャンバスの左上が原点）
//   rot         … その囲みの中心まわりの回転（度）
//
// 中の形は種類ごとに違うが、パスだけは 0〜1 に正規化して持つ。
// こうしておくと、大きさを変えたときに形が自動でついてくる。
//
// サーバー側の検査（src/Doc.php）と対になっている。片方だけ直すと噛み合わなくなる。

import { bbox, unionBox, center, rotatePoint, round, clamp } from './geom.js';

export const TYPES = ['rect', 'ellipse', 'text', 'path', 'image', 'group'];

export const FONTS = {
  sans:    { label: 'ゴシック',   css: '"Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", system-ui, sans-serif' },
  serif:   { label: '明朝',       css: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif' },
  rounded: { label: '丸ゴシック', css: '"Hiragino Maru Gothic ProN", "Zen Maru Gothic", "Rounded Mplus 1c", "Hiragino Kaku Gothic ProN", system-ui, sans-serif' },
  mono:    { label: '等幅',       css: '"SFMono-Regular", "Menlo", "Consolas", "Noto Sans Mono", monospace' },
};

let seq = 0;
export function uid() {
  seq = (seq + 1) % 100000;
  return 'n' + Date.now().toString(36).slice(-6) + seq.toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

export const newDoc = (w = 1080, h = 1080, bg = '#ffffff') => ({ v: 1, w, h, bg, nodes: [] });

/** 種類ごとの初期値。ここに無い項目は持たせない。 */
export function makeNode(type, props = {}) {
  const base = {
    id: uid(),
    type,
    name: '',
    x: 0, y: 0, w: 100, h: 100,
    rot: 0,
    opacity: 1,
    hidden: false,
    locked: false,
  };

  const extra = {
    rect:    { fill: '#f0508c', stroke: null, strokeWidth: 0, dash: 0, radius: 0 },
    ellipse: { fill: '#7c5cff', stroke: null, strokeWidth: 0, dash: 0 },
    path:    { fill: null, stroke: '#1f2430', strokeWidth: 4, dash: 0, rule: 'nonzero', cap: 'round', d: [] },
    image:   { asset: 0, fit: 'cover', radius: 0 },
    group:   { bw: 100, bh: 100, kids: [] },
    text: {
      text: 'テキスト', fontSize: 48, font: 'sans', weight: 500,
      color: '#1f2430', align: 'left', lineHeight: 1.4, tracking: 0, italic: false,
    },
  }[type] || {};

  return { ...base, ...extra, ...props };
}

// ---- 出し入れ -------------------------------------------------------------

/** すべての図形を、上から順に見ていく（グループの中も）。 */
export function walk(nodes, fn, parent = null) {
  for (const n of nodes) {
    fn(n, parent);
    if (n.type === 'group') walk(n.kids || [], fn, n);
  }
}

export function findNode(doc, id) {
  let hit = null;
  walk(doc.nodes, (n) => { if (n.id === id) hit = n; });
  return hit;
}

/** 上に置かれているものから順に並べた一覧（当たり判定はこの順で見る）。 */
export const topDown = (doc) => [...doc.nodes].reverse();

export const selectedNodes = (doc, ids) =>
  doc.nodes.filter((n) => ids.includes(n.id));

/** 選んだものの、まとめた囲み。 */
export function selectionBox(doc, ids) {
  const boxes = selectedNodes(doc, ids).map(bbox);
  return unionBox(boxes);
}

export function addNode(doc, node) {
  doc.nodes.push(node);
  return node;
}

export function removeNodes(doc, ids) {
  doc.nodes = doc.nodes.filter((n) => !ids.includes(n.id));
}

/** 重ね順を変える。 */
export function reorder(doc, ids, where) {
  const keep = doc.nodes.filter((n) => !ids.includes(n.id));
  const move = doc.nodes.filter((n) => ids.includes(n.id));
  if (move.length === 0) return;

  if (where === 'front') { doc.nodes = [...keep, ...move]; return; }
  if (where === 'back')  { doc.nodes = [...move, ...keep]; return; }

  // 1つぶん前へ／後ろへ
  const step = where === 'forward' ? 1 : -1;
  const list = [...doc.nodes];
  const order = step > 0
    ? [...list.keys()].reverse()
    : [...list.keys()];

  for (const i of order) {
    if (!ids.includes(list[i].id)) continue;
    const j = i + step;
    if (j < 0 || j >= list.length || ids.includes(list[j].id)) continue;
    [list[i], list[j]] = [list[j], list[i]];
  }
  doc.nodes = list;
}

// ---- グループ -------------------------------------------------------------

export function group(doc, ids) {
  const picked = doc.nodes.filter((n) => ids.includes(n.id));
  if (picked.length < 2) return null;

  const box = unionBox(picked.map(bbox));
  const g = makeNode('group', {
    name: 'グループ',
    x: box.x, y: box.y, w: box.w, h: box.h,
    bw: box.w, bh: box.h,
    kids: picked.map((n) => ({ ...n, x: n.x - box.x, y: n.y - box.y })),
  });

  // いちばん上にいた図形の位置に置く。
  const lastIndex = Math.max(...picked.map((n) => doc.nodes.indexOf(n)));
  const rest = doc.nodes.filter((n) => !ids.includes(n.id));
  const before = doc.nodes.slice(0, lastIndex + 1).filter((n) => !ids.includes(n.id)).length;
  rest.splice(before, 0, g);
  doc.nodes = rest;

  return g;
}

export function ungroup(doc, id) {
  const idx = doc.nodes.findIndex((n) => n.id === id && n.type === 'group');
  if (idx < 0) return [];

  const g = doc.nodes[idx];
  const sx = g.bw ? g.w / g.bw : 1;
  const sy = g.bh ? g.h / g.bh : 1;
  const c = center(g);

  const kids = (g.kids || []).map((k) => {
    // グループの中での位置を、いまの大きさに引きのばす。
    const nx = g.x + k.x * sx;
    const ny = g.y + k.y * sy;
    const nw = k.w * sx;
    const nh = k.h * sy;

    // グループが回っていたら、その回転を子に渡す。
    const kc = rotatePoint(nx + nw / 2, ny + nh / 2, c.x, c.y, g.rot || 0);

    return {
      ...k,
      id: uid(),
      x: round(kc.x - nw / 2, 2),
      y: round(kc.y - nh / 2, 2),
      w: round(nw, 2),
      h: round(nh, 2),
      rot: round(((k.rot || 0) + (g.rot || 0)) % 360, 2),
      ...(k.type === 'text' ? { fontSize: round(k.fontSize * Math.min(sx, sy), 2) } : {}),
    };
  });

  doc.nodes.splice(idx, 1, ...kids);
  return kids;
}

// ---- 並べる ---------------------------------------------------------------

export const ALIGN = {
  left: '左ぞろえ', hcenter: '左右中央', right: '右ぞろえ',
  top: '上ぞろえ', vcenter: '上下中央', bottom: '下ぞろえ',
};

/**
 * ぞろえる。
 * 2つ以上えらんでいれば「えらんだもの全体」に、1つならキャンバスにそろえる
 * （イラストレーターと同じ考え方）。
 */
export function align(doc, ids, mode) {
  const picked = selectedNodes(doc, ids);
  if (picked.length === 0) return;

  const area = picked.length >= 2
    ? unionBox(picked.map(bbox))
    : { x: 0, y: 0, w: doc.w, h: doc.h };

  for (const n of picked) {
    const b = bbox(n);
    if (mode === 'left')    n.x += area.x - b.x;
    if (mode === 'right')   n.x += area.x + area.w - (b.x + b.w);
    if (mode === 'hcenter') n.x += area.x + area.w / 2 - (b.x + b.w / 2);
    if (mode === 'top')     n.y += area.y - b.y;
    if (mode === 'bottom')  n.y += area.y + area.h - (b.y + b.h);
    if (mode === 'vcenter') n.y += area.y + area.h / 2 - (b.y + b.h / 2);
    n.x = round(n.x, 2);
    n.y = round(n.y, 2);
  }
}

/** すきまを等しくする。 */
export function distribute(doc, ids, axis) {
  const picked = selectedNodes(doc, ids);
  if (picked.length < 3) return;

  const key = axis === 'x' ? 'x' : 'y';
  const size = axis === 'x' ? 'w' : 'h';

  const rows = picked
    .map((n) => ({ n, b: bbox(n) }))
    .sort((a, b) => a.b[key] - b.b[key]);

  const first = rows[0].b;
  const last = rows[rows.length - 1].b;
  const span = last[key] + last[size] - first[key];
  const used = rows.reduce((s, r) => s + r.b[size], 0);
  const gap = (span - used) / (rows.length - 1);

  let cursor = first[key];
  for (const r of rows) {
    r.n[key] += cursor - r.b[key];
    r.n[key] = round(r.n[key], 2);
    cursor += r.b[size] + gap;
  }
}

// ---- マジックリサイズ -----------------------------------------------------

/**
 * 同じ絵を、別の大きさで作り直す。
 *
 * 「Instagram の正方形で作ったものを、そのままストーリーにも出したい」を
 * 一手で終わらせるためのもの。ここが canter でいちばん手数を減らす場所。
 *
 * 考え方
 *   ・大きさは縦横まとめて同じ比で変える（縦だけ伸びて字が太る、を避けるため）
 *   ・置き場所は、キャンバスの中での「相対的な位置」を保つ
 *   ・キャンバス全体をおおっている図形（背景）は、新しい大きさにぴったり合わせ直す
 *
 * mode
 *   'stretch' … 相対的な位置を保つ（すきまが広がりすぎない。ふだんはこちら）
 *   'fit'     … 全体を同じ比で縮めて中央に置く（構図をそのまま保ちたいとき）
 */
export function magicResize(doc, nw, nh, mode = 'stretch') {
  const ow = doc.w;
  const oh = doc.h;
  if (ow === nw && oh === nh) return doc;

  const s = Math.min(nw / ow, nh / oh);
  const out = { ...doc, w: nw, h: nh, nodes: doc.nodes.map((n) => resizeNode(n, ow, oh, nw, nh, s, mode)) };
  return out;
}

function resizeNode(n, ow, oh, nw, nh, s, mode) {
  // 背景（キャンバスをほぼおおっている図形）は、新しい枠いっぱいに合わせ直す。
  if (isFullBleed(n, ow, oh)) {
    const over = { x: n.x / ow, y: n.y / oh };
    return {
      ...n,
      x: round(over.x * nw, 2),
      y: round(over.y * nh, 2),
      w: round((n.w / ow) * nw, 2),
      h: round((n.h / oh) * nh, 2),
      ...(n.type === 'group' ? { bw: n.bw, bh: n.bh } : {}),
    };
  }

  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;

  const nx = mode === 'fit'
    ? nw / 2 + (cx - ow / 2) * s
    : (cx / ow) * nw;
  const ny = mode === 'fit'
    ? nh / 2 + (cy - oh / 2) * s
    : (cy / oh) * nh;

  const w = n.w * s;
  const h = n.h * s;

  const out = {
    ...n,
    x: round(nx - w / 2, 2),
    y: round(ny - h / 2, 2),
    w: round(w, 2),
    h: round(h, 2),
  };

  if (n.type === 'text') out.fontSize = round(n.fontSize * s, 2);
  if (n.type === 'rect' || n.type === 'image') out.radius = round((n.radius || 0) * s, 2);
  if (n.strokeWidth) out.strokeWidth = round(n.strokeWidth * s, 2);

  return out;
}

/** キャンバスをほぼおおっているか（＝背景あつかいしてよいか）。 */
function isFullBleed(n, w, h) {
  if (n.rot) return false;
  return n.x <= w * 0.02 && n.y <= h * 0.02
    && n.x + n.w >= w * 0.98 && n.y + n.h >= h * 0.98;
}

// ---- まとめて色を変える ---------------------------------------------------

/**
 * 使われている色を数え上げて、よく使われている順に palette の色へ置きかえる。
 * 「配色見本を押したら全部いい感じに変わる」を、規則だけで作る。
 */
export function applyPalette(doc, palette) {
  if (!palette || palette.length === 0) return doc;

  const counts = new Map();
  const bump = (c) => {
    if (typeof c !== 'string' || !c.startsWith('#')) return;
    counts.set(c, (counts.get(c) || 0) + 1);
  };

  bump(doc.bg);
  walk(doc.nodes, (n) => {
    bump(typeof n.fill === 'string' ? n.fill : null);
    if (n.fill && typeof n.fill === 'object') { bump(n.fill.a); bump(n.fill.b); }
    bump(n.stroke);
    bump(n.color);
  });

  // 多く使われている色ほど、パレットの前の色にあてる。
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const map = new Map();
  ranked.forEach((c, i) => map.set(c, palette[i % palette.length]));

  const swap = (c) => (typeof c === 'string' && map.has(c) ? map.get(c) : c);

  const next = structuredCloneSafe(doc);
  next.bg = swap(next.bg);
  walk(next.nodes, (n) => {
    if (typeof n.fill === 'string') n.fill = swap(n.fill);
    else if (n.fill && typeof n.fill === 'object') { n.fill.a = swap(n.fill.a); n.fill.b = swap(n.fill.b); }
    if (n.stroke) n.stroke = swap(n.stroke);
    if (n.color) n.color = swap(n.color);
  });

  return next;
}

/** 文字のひな型をあてる（大きさはキャンバスの幅から決める）。 */
export function applyTextStyle(node, style, canvasWidth) {
  return {
    ...node,
    font: style.font,
    weight: style.weight,
    fontSize: round(clamp(style.size * canvasWidth, 8, 2000), 2),
    lineHeight: style.lineHeight,
    tracking: style.tracking,
  };
}

export function structuredCloneSafe(v) {
  if (typeof structuredClone === 'function') return structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}
