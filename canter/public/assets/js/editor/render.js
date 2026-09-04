// doc を SVG にする。
//
// なぜ SVG なのか
//   ・拡大しても輪郭がぼけない（イラストレーターと同じ土俵に立てる）
//   ・画面に出しているものと、書き出すものが**同じ作りかた**になる。
//     見えているとおりに出る、を仕組みで保証できる。
//   ・当たり判定をブラウザに任せられる（要素にそのままイベントが来る）
//
// 文字の折り返しだけはブラウザの寸法測りが要るので、
// 測れないところ（テストなど）では字幅の見当で代用する。

import { FONTS } from './scene.js';

const NS = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';

export function svgEl(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'href') n.setAttributeNS(XLINK, 'href', v);
    n.setAttribute(k, String(v));
  }
  for (const kid of kids.flat()) if (kid) n.append(kid);
  return n;
}

// ---- 文字の寸法 -----------------------------------------------------------

let measureCtx = null;

function ctx() {
  if (measureCtx !== null) return measureCtx;
  try {
    measureCtx = document.createElement('canvas').getContext('2d');
  } catch {
    measureCtx = false;
  }
  return measureCtx;
}

export function fontCss(node) {
  const family = (FONTS[node.font] || FONTS.sans).css;
  return `${node.italic ? 'italic ' : ''}${node.weight || 500} ${node.fontSize}px ${family}`;
}

/** 1行の幅。測れないときは、全角0.98em・半角0.52em の見当で出す。 */
export function measure(text, node) {
  const c = ctx();
  const tracking = (node.tracking || 0) * node.fontSize;

  if (c) {
    c.font = fontCss(node);
    return c.measureText(text).width + tracking * Math.max(0, text.length - 1);
  }

  let w = 0;
  for (const ch of text) w += /[\x20-\x7e]/.test(ch) ? 0.52 : 0.98;
  return w * node.fontSize + tracking * Math.max(0, text.length - 1);
}

/**
 * 幅に収まるように折り返す。
 *
 * 日本語は文字の切れ目で折り返してよいが、行の頭に来てはいけない字（、。」など）と
 * 行の終わりに来てはいけない字（「（など）だけは送る（禁則処理）。
 * 英単語は途中で切らない。
 */
const NO_HEAD = '、。，．・：；？！ー〜）］｝」』〕】’”ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々';
const NO_TAIL = '（［｛「『〔【‘“';

export function wrapText(node, maxWidth) {
  const lines = [];
  for (const raw of String(node.text ?? '').split('\n')) {
    if (raw === '') { lines.push(''); continue; }
    lines.push(...wrapOne(raw, node, maxWidth));
  }
  return lines.length ? lines : [''];
}

function wrapOne(text, node, maxWidth) {
  if (maxWidth <= 0 || measure(text, node) <= maxWidth) return [text];

  const out = [];
  let line = '';

  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    // 英単語はまとめて1つの塊として扱う。
    let chunk = chars[i];
    if (/[A-Za-z0-9]/.test(chunk)) {
      while (i + 1 < chars.length && /[A-Za-z0-9'’-]/.test(chars[i + 1])) chunk += chars[++i];
    }

    if (line !== '' && measure(line + chunk, node) > maxWidth) {
      // 行の頭に来てはいけない字なら、前の行にぶら下げる。
      if (NO_HEAD.includes(chunk[0])) {
        line += chunk;
        out.push(line);
        line = '';
        continue;
      }
      // 行の終わりに来てはいけない字が末尾なら、いっしょに送る。
      const lastCh = line[line.length - 1];
      if (NO_TAIL.includes(lastCh) && line.length > 1) {
        out.push(line.slice(0, -1));
        line = lastCh + chunk;
        continue;
      }
      out.push(line);
      line = chunk;
      continue;
    }

    line += chunk;
  }

  if (line !== '') out.push(line);
  return out;
}

/** 文字の図形が本当に必要とする高さ。 */
export function textHeight(node, lines) {
  return Math.max(node.fontSize * node.lineHeight * lines.length, node.fontSize);
}

// ---- 描く -----------------------------------------------------------------

/**
 * doc を <svg> にする。
 *
 * @param {object} doc
 * @param {object} opt  assets: Map(id → url), forExport: 書き出し用か, ids: 図形のidを属性に付けるか
 */
export function renderDoc(doc, opt = {}) {
  const defs = svgEl('defs');
  const root = svgEl('svg', {
    xmlns: NS,
    'xmlns:xlink': XLINK,
    viewBox: `0 0 ${doc.w} ${doc.h}`,
    width: doc.w,
    height: doc.h,
    'shape-rendering': 'geometricPrecision',
    'text-rendering': 'geometricPrecision',
  });

  root.append(defs);
  root.append(svgEl('rect', { x: 0, y: 0, width: doc.w, height: doc.h, fill: doc.bg || '#ffffff' }));

  const state = { defs, seq: 0, assets: opt.assets || new Map(), ids: opt.ids !== false };

  for (const node of doc.nodes) {
    const el = renderNode(node, state);
    if (el) root.append(el);
  }

  return root;
}

export function renderNode(node, state) {
  if (node.hidden) return null;

  const el = shapeOf(node, state);
  if (!el) return null;

  const wrap = svgEl('g', {
    transform: transformOf(node),
    opacity: node.opacity === 1 ? null : node.opacity,
  });
  if (state.ids) {
    wrap.setAttribute('data-id', node.id);
    if (node.locked) wrap.setAttribute('data-locked', '1');
  }
  wrap.append(el);
  return wrap;
}

function transformOf(n) {
  const parts = [`translate(${round(n.x)} ${round(n.y)})`];
  if (n.rot) parts.push(`rotate(${round(n.rot)} ${round(n.w / 2)} ${round(n.h / 2)})`);
  if (n.type === 'group') {
    const sx = n.bw ? n.w / n.bw : 1;
    const sy = n.bh ? n.h / n.bh : 1;
    if (sx !== 1 || sy !== 1) parts.push(`scale(${round(sx, 5)} ${round(sy, 5)})`);
  }
  return parts.join(' ');
}

function shapeOf(node, state) {
  switch (node.type) {
    case 'rect':    return rectEl(node, state);
    case 'ellipse': return ellipseEl(node, state);
    case 'path':    return pathEl(node, state);
    case 'text':    return textEl(node);
    case 'image':   return imageEl(node, state);
    case 'group':   return groupEl(node, state);
    default:        return null;
  }
}

function paint(node, state, key = 'fill') {
  const v = node[key];
  if (v === null || v === undefined) return 'none';
  if (typeof v === 'string') return v;

  if (v.type === 'linear') {
    const id = `g${state.seq++}`;
    const a = ((v.angle || 90) * Math.PI) / 180;
    const dx = Math.cos(a) / 2;
    const dy = Math.sin(a) / 2;
    state.defs.append(svgEl('linearGradient',
      {
        id,
        x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy,
      },
      svgEl('stop', { offset: '0', 'stop-color': v.a }),
      svgEl('stop', { offset: '1', 'stop-color': v.b })));
    return `url(#${id})`;
  }

  return 'none';
}

const strokeAttrs = (n) => ({
  stroke: n.stroke || null,
  'stroke-width': n.stroke && n.strokeWidth ? n.strokeWidth : null,
  'stroke-dasharray': n.stroke && n.dash ? `${n.dash} ${n.dash}` : null,
  'stroke-linejoin': 'round',
  'stroke-linecap': n.cap || 'round',
});

function rectEl(n, state) {
  const r = Math.min(n.radius || 0, n.w / 2, n.h / 2);
  return svgEl('rect', {
    x: 0, y: 0, width: n.w, height: n.h,
    rx: r || null, ry: r || null,
    fill: paint(n, state),
    ...strokeAttrs(n),
  });
}

function ellipseEl(n, state) {
  return svgEl('ellipse', {
    cx: n.w / 2, cy: n.h / 2, rx: n.w / 2, ry: n.h / 2,
    fill: paint(n, state),
    ...strokeAttrs(n),
  });
}

function pathEl(n, state) {
  return svgEl('path', {
    d: pathData(n),
    fill: paint(n, state),
    'fill-rule': n.rule || 'nonzero',
    ...strokeAttrs(n),
  });
}

/** 0〜1で持っている点を、いまの大きさに引きのばして d 属性にする。 */
export function pathData(n) {
  const sx = n.w;
  const sy = n.h;
  const P = (p) => `${round(p.x * sx)} ${round(p.y * sy)}`;
  const out = [];

  for (const sub of n.d || []) {
    const pts = sub.pts || [];
    if (pts.length === 0) continue;

    out.push(`M ${P(pts[0])}`);

    const last = sub.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < last; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const c1 = { x: a.h2x ?? a.x, y: a.h2y ?? a.y };
      const c2 = { x: b.h1x ?? b.x, y: b.h1y ?? b.y };
      const straight = c1.x === a.x && c1.y === a.y && c2.x === b.x && c2.y === b.y;
      out.push(straight ? `L ${P(b)}` : `C ${P(c1)} ${P(c2)} ${P(b)}`);
    }

    if (sub.closed) out.push('Z');
  }

  return out.join(' ');
}

function textEl(n) {
  const lines = wrapText(n, n.w);
  const anchor = n.align === 'center' ? 'middle' : n.align === 'right' ? 'end' : 'start';
  const x = n.align === 'center' ? n.w / 2 : n.align === 'right' ? n.w : 0;
  const family = (FONTS[n.font] || FONTS.sans).css;

  const t = svgEl('text', {
    'font-family': family,
    'font-size': n.fontSize,
    'font-weight': n.weight,
    'font-style': n.italic ? 'italic' : null,
    'letter-spacing': n.tracking ? round(n.tracking * n.fontSize, 3) : null,
    fill: n.color,
    'text-anchor': anchor,
    'white-space': 'pre',
  });

  lines.forEach((line, i) => {
    t.append(svgEl('tspan', {
      x,
      y: round(n.fontSize * 0.82 + i * n.fontSize * n.lineHeight, 3),
    }, document.createTextNode(line === '' ? ' ' : line)));
  });

  return t;
}

function imageEl(n, state) {
  const url = state.assets.get(n.asset);
  if (!url) {
    // 元の画像が見つからないとき。空白にせず、それと分かる形を出す。
    return svgEl('g', {},
      svgEl('rect', { x: 0, y: 0, width: n.w, height: n.h, fill: '#eceef4', rx: n.radius || 0 }),
      svgEl('text', {
        x: n.w / 2, y: n.h / 2, 'text-anchor': 'middle',
        'font-size': Math.min(n.w, n.h) * 0.12, fill: '#98a0b3',
        'font-family': FONTS.sans.css,
      }, document.createTextNode('画像が見つかりません')));
  }

  const img = svgEl('image', {
    x: 0, y: 0, width: n.w, height: n.h, href: url,
    preserveAspectRatio: n.fit === 'contain' ? 'xMidYMid meet'
      : n.fit === 'fill' ? 'none' : 'xMidYMid slice',
  });

  const r = Math.min(n.radius || 0, n.w / 2, n.h / 2);
  if (r <= 0) return img;

  const id = `c${state.seq++}`;
  state.defs.append(svgEl('clipPath', { id },
    svgEl('rect', { x: 0, y: 0, width: n.w, height: n.h, rx: r, ry: r })));

  return svgEl('g', { 'clip-path': `url(#${id})` }, img);
}

function groupEl(n, state) {
  const g = svgEl('g', {});
  for (const kid of n.kids || []) {
    const el = renderNode(kid, { ...state, ids: false });
    if (el) g.append(el);
  }
  return g;
}

function round(v, digits = 2) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
