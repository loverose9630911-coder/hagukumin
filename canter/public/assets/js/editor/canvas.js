// 編集する面。えらぶ・動かす・大きさを変える・回す・描く、を受け持つ。
//
// 【組み立て】
//   <svg class="stage">            … 画面いっぱいの入れもの（座標は画面のピクセル）
//     <g class="view">             … 拡大と移動をここでまとめてかける
//       <g class="scene">          … render.js が作った絵をそのまま入れる
//       <g class="overlay">        … 選択の枠・つまみ・ガイド線（絵には出ない）
//
// 絵の部分と、操作のための線を分けてあるので、
// 「書き出したら選択枠まで写っていた」ということが起こらない。
//
// 【座標】
//   画面のピクセル → キャンバスの座標 は toDoc()、その逆は toScreen()。
//   この2つ以外で座標を作らないようにして、拡大時のずれを1か所に閉じこめている。

import { renderDoc, wrapText, textHeight, pathData } from './render.js';
import {
  bbox, corners, center, rotatePoint, toLocal, unionBox, clamp, round,
  pointInPolygon, distToSegment,
} from './geom.js';
import { makeNode, uid, findNode, structuredCloneSafe } from './scene.js';
import { snapMove } from './snap.js';

const HANDLES = [
  ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0],
  ['e', 1, 0.5], ['se', 1, 1], ['s', 0.5, 1],
  ['sw', 0, 1], ['w', 0, 0.5],
];

export const TOOLS = {
  select:  { label: '選ぶ',   key: 'V', glyph: '⬚' },
  node:    { label: '点を編集', key: 'A', glyph: '⌖' },
  rect:    { label: '四角',   key: 'R', glyph: '▭' },
  ellipse: { label: '円',     key: 'O', glyph: '◯' },
  line:    { label: '線',     key: 'L', glyph: '⁄' },
  pen:     { label: 'ペン',   key: 'P', glyph: '✒' },
  text:    { label: '文字',   key: 'T', glyph: 'T' },
  hand:    { label: '手のひら', key: 'H', glyph: '✋' },
};

export function createCanvas(host, opts = {}) {
  const on = {
    change: opts.onChange || (() => {}),
    select: opts.onSelect || (() => {}),
    tool: opts.onTool || (() => {}),
    view: opts.onView || (() => {}),
    edit: opts.onEditText || (() => {}),
  };

  let doc = opts.doc;
  let assets = opts.assets || new Map();
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  let tool = 'select';
  let selection = [];
  let guides = [];
  let marquee = null;
  let penDraft = null;      // ペンで描いている途中のもの
  let nodeEdit = null;      // 点を編集しているパス
  let drag = null;
  let spaceHeld = false;

  // ---- DOM ---------------------------------------------------------------

  const stage = svgTag('svg', { class: 'stage' });
  const view = svgTag('g', { class: 'view' });
  const scene = svgTag('g', { class: 'scene' });
  const overlay = svgTag('g', { class: 'overlay' });

  view.append(scene, overlay);
  stage.append(view);
  host.replaceChildren(stage);

  // ---- 座標 ---------------------------------------------------------------

  const rect = () => stage.getBoundingClientRect();

  const toDoc = (clientX, clientY) => {
    const r = rect();
    return {
      x: (clientX - r.left - pan.x) / zoom,
      y: (clientY - r.top - pan.y) / zoom,
    };
  };

  const toScreen = (x, y) => ({ x: x * zoom + pan.x, y: y * zoom + pan.y });

  // ---- 描き直し -----------------------------------------------------------

  function paint() {
    const rendered = renderDoc(doc, { assets });
    scene.replaceChildren(...rendered.childNodes);
    view.setAttribute('transform', `translate(${pan.x} ${pan.y}) scale(${zoom})`);
    drawOverlay();
  }

  function drawOverlay() {
    const kids = [];
    const s = 1 / zoom;   // 拡大しても線の太さを一定に見せるための係数

    // 紙のふち
    kids.push(svgTag('rect', {
      class: 'board', x: 0, y: 0, width: doc.w, height: doc.h,
      'stroke-width': s,
    }));

    // 吸着のガイド
    for (const g of guides) {
      kids.push(g.axis === 'x'
        ? svgTag('line', { class: 'guide', x1: g.v, y1: -4000, x2: g.v, y2: doc.h + 4000, 'stroke-width': s })
        : svgTag('line', { class: 'guide', x1: -4000, y1: g.v, x2: doc.w + 4000, y2: g.v, 'stroke-width': s }));
    }

    // 選んだもののふち。白い縁を1枚下に敷いて、どんな地の色でも見えるようにする。
    for (const id of selection) {
      const n = findNode(doc, id);
      if (!n) continue;
      const points = corners(n).map((p) => `${p.x},${p.y}`).join(' ');
      kids.push(svgTag('polygon', { class: 'sel-halo', points, 'stroke-width': s * 3.5 }));
      kids.push(svgTag('polygon', { class: 'sel-outline', points, 'stroke-width': s * 1.5 }));
    }

    // つまみ（1つだけ選んでいるときは回転も合わせて）
    if (selection.length > 0 && tool !== 'node') {
      const box = selBox();
      const one = selection.length === 1 ? findNode(doc, selection[0]) : null;
      const rot = one ? one.rot || 0 : 0;
      const c = one ? center(one) : { x: box.x + box.w / 2, y: box.y + box.h / 2 };
      const base = one ? { x: one.x, y: one.y, w: one.w, h: one.h } : box;

      const place = (fx, fy) => {
        const p = { x: base.x + base.w * fx, y: base.y + base.h * fy };
        return rot ? rotatePoint(p.x, p.y, c.x, c.y, rot) : p;
      };

      if (!one || (!one.locked)) {
        for (const [name, fx, fy] of HANDLES) {
          const p = place(fx, fy);
          kids.push(svgTag('rect', {
            class: 'handle', 'data-handle': name,
            x: p.x - 5 * s, y: p.y - 5 * s, width: 10 * s, height: 10 * s,
            rx: 2 * s, 'stroke-width': s,
          }));
        }

        const top = place(0.5, 0);
        const grip = rot
          ? rotatePoint(base.x + base.w / 2, base.y - 26 * s, c.x, c.y, rot)
          : { x: base.x + base.w / 2, y: base.y - 26 * s };

        kids.push(svgTag('line', {
          class: 'rot-stem', x1: top.x, y1: top.y, x2: grip.x, y2: grip.y, 'stroke-width': s,
        }));
        kids.push(svgTag('circle', {
          class: 'handle rot', 'data-handle': 'rotate',
          cx: grip.x, cy: grip.y, r: 6 * s, 'stroke-width': s,
        }));
      }
    }

    // パスの点を編集しているとき
    if (nodeEdit) {
      const n = findNode(doc, nodeEdit);
      if (n && n.type === 'path') kids.push(...anchorLayer(n, s));
    }

    // ペンで描いている途中
    if (penDraft) kids.push(...penLayer(penDraft, s));

    // 範囲えらび
    if (marquee) {
      kids.push(svgTag('rect', {
        class: 'marquee',
        x: Math.min(marquee.x0, marquee.x1), y: Math.min(marquee.y0, marquee.y1),
        width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0),
        'stroke-width': s,
      }));
    }

    overlay.replaceChildren(...kids);
  }

  /** パスの点と手（ハンドル）を出す。 */
  function anchorLayer(n, s) {
    const out = [];
    const P = (p) => {
      const c = center(n);
      return rotatePoint(n.x + p.x * n.w, n.y + p.y * n.h, c.x, c.y, n.rot || 0);
    };

    (n.d || []).forEach((sub, si) => {
      (sub.pts || []).forEach((p, pi) => {
        const a = P(p);

        for (const h of ['h1', 'h2']) {
          if (p[`${h}x`] === undefined) continue;
          const q = P({ x: p[`${h}x`], y: p[`${h}y`] });
          out.push(svgTag('line', { class: 'anchor-arm', x1: a.x, y1: a.y, x2: q.x, y2: q.y, 'stroke-width': s }));
          out.push(svgTag('circle', {
            class: 'anchor-handle', 'data-anchor': `${si}:${pi}:${h}`,
            cx: q.x, cy: q.y, r: 4 * s, 'stroke-width': s,
          }));
        }

        out.push(svgTag('rect', {
          class: 'anchor', 'data-anchor': `${si}:${pi}:a`,
          x: a.x - 4.5 * s, y: a.y - 4.5 * s, width: 9 * s, height: 9 * s, 'stroke-width': s,
        }));
      });
    });

    return out;
  }

  function penLayer(draft, s) {
    const out = [];
    const pts = draft.pts;
    if (pts.length === 0) return out;

    const d = pts.map((p, i) => {
      if (i === 0) return `M ${p.x} ${p.y}`;
      const a = pts[i - 1];
      const c1 = { x: a.h2x ?? a.x, y: a.h2y ?? a.y };
      const c2 = { x: p.h1x ?? p.x, y: p.h1y ?? p.y };
      return `C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p.x} ${p.y}`;
    }).join(' ');

    out.push(svgTag('path', { class: 'pen-line', d, 'stroke-width': 1.5 * s }));

    if (draft.cursor) {
      const a = pts[pts.length - 1];
      const c1 = { x: a.h2x ?? a.x, y: a.h2y ?? a.y };
      out.push(svgTag('path', {
        class: 'pen-ghost',
        d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${draft.cursor.x} ${draft.cursor.y} ${draft.cursor.x} ${draft.cursor.y}`,
        'stroke-width': s,
      }));
    }

    for (const p of pts) {
      out.push(svgTag('rect', {
        class: 'anchor', x: p.x - 4 * s, y: p.y - 4 * s, width: 8 * s, height: 8 * s, 'stroke-width': s,
      }));
    }

    return out;
  }

  const selBox = () => unionBox(selection.map((id) => findNode(doc, id)).filter(Boolean).map(bbox))
    || { x: 0, y: 0, w: 0, h: 0 };

  // ---- 当たり判定 ---------------------------------------------------------

  /** その位置にある、いちばん手前の図形。 */
  function hitTest(p) {
    for (let i = doc.nodes.length - 1; i >= 0; i--) {
      const n = doc.nodes[i];
      if (n.hidden || n.locked) continue;
      if (hitNode(n, p)) return n;
    }
    return null;
  }

  function hitNode(n, p) {
    const poly = corners(n);
    if (!pointInPolygon(p, poly)) {
      // 線だけの図形は、少しはみ出していても拾えるようにする。
      if (n.type !== 'path' || n.fill) return false;
      const near = 6 / zoom + (n.strokeWidth || 0) / 2;
      return polyDistance(n, p) < near;
    }

    // 塗りのないパスは、輪郭の近くだけを当たりにする。
    if (n.type === 'path' && !n.fill) {
      const near = 6 / zoom + (n.strokeWidth || 0) / 2;
      return polyDistance(n, p) < near;
    }

    return true;
  }

  function polyDistance(n, p) {
    const c = center(n);
    const local = rotatePoint(p.x, p.y, c.x, c.y, -(n.rot || 0));
    let best = Infinity;

    for (const sub of n.d || []) {
      const pts = (sub.pts || []).map((q) => ({ x: n.x + q.x * n.w, y: n.y + q.y * n.h }));
      const last = sub.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < last; i++) {
        best = Math.min(best, distToSegment(local, pts[i], pts[(i + 1) % pts.length]));
      }
    }

    return best;
  }

  // ---- 操作 ---------------------------------------------------------------

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('dblclick', onDblClick);
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  function onDown(e) {
    if (e.button === 1 || spaceHeld || tool === 'hand') {
      drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
      stage.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;

    const p = toDoc(e.clientX, e.clientY);
    stage.setPointerCapture(e.pointerId);

    // つまみを掴んだか
    const handle = e.target?.dataset?.handle;
    if (handle && selection.length > 0) {
      drag = handle === 'rotate'
        ? { kind: 'rotate', start: p, before: snapshot() }
        : { kind: 'resize', handle, start: p, before: snapshot(), box: selBox() };
      return;
    }

    // パスの点を掴んだか
    const anchor = e.target?.dataset?.anchor;
    if (anchor && nodeEdit) {
      const [si, pi, which] = anchor.split(':');
      drag = { kind: 'anchor', si: +si, pi: +pi, which, before: snapshot(), start: p };
      return;
    }

    if (tool === 'pen') { penDown(p, e); return; }

    if (tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'text') {
      drag = { kind: 'create', tool, start: p, node: null };
      return;
    }

    // 選ぶ
    const hit = hitTest(p);
    if (!hit) {
      if (!e.shiftKey) setSelection([]);
      if (tool === 'node') nodeEdit = null;
      drag = { kind: 'marquee', start: p };
      marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      drawOverlay();
      return;
    }

    if (e.shiftKey) {
      setSelection(selection.includes(hit.id)
        ? selection.filter((id) => id !== hit.id)
        : [...selection, hit.id]);
    } else if (!selection.includes(hit.id)) {
      setSelection([hit.id]);
    }

    if (tool === 'node' && hit.type === 'path') {
      nodeEdit = hit.id;
      drawOverlay();
      return;
    }

    drag = { kind: 'move', start: p, before: snapshot(), moved: false };
  }

  function onMove(e) {
    const p = toDoc(e.clientX, e.clientY);

    if (penDraft) {
      penDraft.cursor = p;
      if (drag?.kind === 'penHandle') {
        const last = penDraft.pts[penDraft.pts.length - 1];
        last.h2x = p.x;
        last.h2y = p.y;
        last.h1x = last.x * 2 - p.x;
        last.h1y = last.y * 2 - p.y;
      }
      drawOverlay();
      return;
    }

    if (!drag) return;

    switch (drag.kind) {
      case 'pan':
        pan = { x: drag.px + (e.clientX - drag.sx), y: drag.py + (e.clientY - drag.sy) };
        view.setAttribute('transform', `translate(${pan.x} ${pan.y}) scale(${zoom})`);
        on.view({ zoom, pan });
        return;

      case 'marquee':
        marquee = { x0: drag.start.x, y0: drag.start.y, x1: p.x, y1: p.y };
        drawOverlay();
        return;

      case 'move':
        doMove(p, e);
        return;

      case 'resize':
        doResize(p, e);
        return;

      case 'rotate':
        doRotate(p, e);
        return;

      case 'anchor':
        doAnchor(p, e);
        return;

      case 'create':
        doCreate(p, e);
        return;
    }
  }

  function onUp(e) {
    if (drag?.kind === 'penHandle') {
      drag = null;
      return;
    }

    if (drag?.kind === 'marquee') {
      const box = {
        x: Math.min(marquee.x0, marquee.x1), y: Math.min(marquee.y0, marquee.y1),
        w: Math.abs(marquee.x1 - marquee.x0), h: Math.abs(marquee.y1 - marquee.y0),
      };
      if (box.w > 2 || box.h > 2) {
        const inside = doc.nodes
          .filter((n) => !n.hidden && !n.locked)
          .filter((n) => {
            const b = bbox(n);
            return b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y;
          })
          .map((n) => n.id);
        setSelection(e.shiftKey ? [...new Set([...selection, ...inside])] : inside);
      }
      marquee = null;
    }

    if (drag && ['move', 'resize', 'rotate', 'anchor'].includes(drag.kind)) {
      if (drag.kind !== 'move' || drag.moved) commit(drag.kind);
    }

    if (drag?.kind === 'create' && drag.node) {
      finishCreate(drag);
    }

    guides = [];
    drag = null;
    drawOverlay();
  }

  function onDblClick(e) {
    const p = toDoc(e.clientX, e.clientY);
    const hit = hitTest(p);
    if (!hit) return;

    if (hit.type === 'text') {
      on.edit(hit);
      return;
    }
    if (hit.type === 'path') {
      setTool('node');
      nodeEdit = hit.id;
      setSelection([hit.id]);
      drawOverlay();
    }
  }

  function onWheel(e) {
    e.preventDefault();

    // Ctrl（Mac は ⌘）＋ホイール、またはピンチで拡大縮小。
    if (e.ctrlKey || e.metaKey) {
      zoomAt(e.clientX, e.clientY, zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
      return;
    }

    pan = { x: pan.x - e.deltaX, y: pan.y - e.deltaY };
    view.setAttribute('transform', `translate(${pan.x} ${pan.y}) scale(${zoom})`);
    on.view({ zoom, pan });
  }

  // ---- それぞれの操作 -----------------------------------------------------

  function doMove(p, e) {
    const dx0 = p.x - drag.start.x;
    const dy0 = p.y - drag.start.y;
    if (Math.abs(dx0) > 0.5 || Math.abs(dy0) > 0.5) drag.moved = true;

    let dx = dx0;
    let dy = dy0;

    // Shift でまっすぐ
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }

    const before = drag.before;
    const moving = selection.map((id) => before.find((n) => n.id === id)).filter(Boolean);
    const box = unionBox(moving.map(bbox));

    guides = [];
    if (!e.altKey && box) {
      const others = doc.nodes.filter((n) => !selection.includes(n.id) && !n.hidden).map(bbox);
      const s = snapMove({ x: box.x + dx, y: box.y + dy, w: box.w, h: box.h }, others, doc, zoom);
      dx += s.dx;
      dy += s.dy;
      guides = s.guides;
    }

    for (const id of selection) {
      const from = before.find((n) => n.id === id);
      const to = findNode(doc, id);
      if (!from || !to || to.locked) continue;
      to.x = round(from.x + dx, 2);
      to.y = round(from.y + dy, 2);
    }

    paint();
  }

  function doResize(p, e) {
    const one = selection.length === 1 ? drag.before.find((n) => n.id === selection[0]) : null;

    if (one) {
      resizeOne(one, p, e);
    } else {
      resizeMany(p, e);
    }

    paint();
  }

  /** 1つだけのときは、その図形の向きに沿って伸ばす（回っていても自然に動く）。 */
  function resizeOne(before, p, e) {
    const node = findNode(doc, before.id);
    if (!node || node.locked) return;

    const c = center(before);
    const local = rotatePoint(p.x, p.y, c.x, c.y, -(before.rot || 0));

    let x0 = before.x;
    let y0 = before.y;
    let x1 = before.x + before.w;
    let y1 = before.y + before.h;

    const h = drag.handle;
    if (h.includes('w')) x0 = local.x;
    if (h.includes('e')) x1 = local.x;
    if (h.includes('n')) y0 = local.y;
    if (h.includes('s')) y1 = local.y;

    let w = Math.max(2, x1 - x0);
    let h2 = Math.max(2, y1 - y0);

    // Shift で縦横の比を保つ
    if (e.shiftKey && before.w > 0 && before.h > 0) {
      const ratio = before.w / before.h;
      if (h === 'n' || h === 's') w = h2 * ratio;
      else if (h === 'e' || h === 'w') h2 = w / ratio;
      else {
        const s = Math.max(w / before.w, h2 / before.h);
        w = before.w * s;
        h2 = before.h * s;
      }
      if (h.includes('w')) x0 = x1 - w;
      if (h.includes('n')) y0 = y1 - h2;
    }

    // 大きさを変えても、掴んでいないほうの角は動かない。
    const nx = h.includes('w') ? x1 - w : x0;
    const ny = h.includes('n') ? y1 - h2 : y0;

    // 変えた後の中心を、回転を戻してから求め直す。
    const newCenterLocal = { x: nx + w / 2, y: ny + h2 / 2 };
    const newCenter = rotatePoint(newCenterLocal.x, newCenterLocal.y, c.x, c.y, before.rot || 0);

    node.w = round(w, 2);
    node.h = round(h2, 2);
    node.x = round(newCenter.x - w / 2, 2);
    node.y = round(newCenter.y - h2 / 2, 2);

    // 文字は、字の大きさも一緒に変える（角のつまみのときだけ）。
    if (node.type === 'text' && before.h > 0 && h.length === 2) {
      node.fontSize = round(clamp(before.fontSize * (h2 / before.h), 4, 2000), 2);
    }
  }

  /** 複数のときは、囲み全体を同じ比で伸ばす。 */
  function resizeMany(p, e) {
    const box = drag.box;
    let x0 = box.x;
    let y0 = box.y;
    let x1 = box.x + box.w;
    let y1 = box.y + box.h;

    const h = drag.handle;
    if (h.includes('w')) x0 = p.x;
    if (h.includes('e')) x1 = p.x;
    if (h.includes('n')) y0 = p.y;
    if (h.includes('s')) y1 = p.y;

    let sx = (x1 - x0) / (box.w || 1);
    let sy = (y1 - y0) / (box.h || 1);

    // 複数まとめてのときは、いつも同じ比にする（ばらばらに歪まないように）。
    const s = e.shiftKey ? Math.max(Math.abs(sx), Math.abs(sy)) : Math.min(Math.abs(sx), Math.abs(sy));
    sx = Math.max(0.02, s);
    sy = Math.max(0.02, s);

    const ax = h.includes('w') ? box.x + box.w : box.x;
    const ay = h.includes('n') ? box.y + box.h : box.y;

    for (const id of selection) {
      const from = drag.before.find((n) => n.id === id);
      const to = findNode(doc, id);
      if (!from || !to || to.locked) continue;
      to.x = round(ax + (from.x - ax) * sx, 2);
      to.y = round(ay + (from.y - ay) * sy, 2);
      to.w = round(Math.max(2, from.w * sx), 2);
      to.h = round(Math.max(2, from.h * sy), 2);
      if (to.type === 'text') to.fontSize = round(clamp(from.fontSize * sx, 4, 2000), 2);
    }
  }

  function doRotate(p, e) {
    const box = drag.box || selBox();
    const one = selection.length === 1 ? drag.before.find((n) => n.id === selection[0]) : null;
    const c = one ? center(one) : { x: box.x + box.w / 2, y: box.y + box.h / 2 };

    let deg = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90;
    if (e.shiftKey) deg = Math.round(deg / 15) * 15;

    if (one) {
      const node = findNode(doc, one.id);
      if (node && !node.locked) node.rot = round(deg, 2);
    } else {
      const start = (Math.atan2(drag.start.y - c.y, drag.start.x - c.x) * 180) / Math.PI + 90;
      const delta = deg - start;
      for (const id of selection) {
        const from = drag.before.find((n) => n.id === id);
        const to = findNode(doc, id);
        if (!from || !to || to.locked) continue;
        const fc = center(from);
        const nc = rotatePoint(fc.x, fc.y, c.x, c.y, delta);
        to.rot = round((from.rot || 0) + delta, 2);
        to.x = round(nc.x - from.w / 2, 2);
        to.y = round(nc.y - from.h / 2, 2);
      }
    }

    paint();
  }

  function doAnchor(p, e) {
    const n = findNode(doc, nodeEdit);
    if (!n || n.locked) return;

    const c = center(n);
    const local = rotatePoint(p.x, p.y, c.x, c.y, -(n.rot || 0));
    const nx = (local.x - n.x) / (n.w || 1);
    const ny = (local.y - n.y) / (n.h || 1);

    const pt = n.d?.[drag.si]?.pts?.[drag.pi];
    if (!pt) return;

    if (drag.which === 'a') {
      const dx = nx - pt.x;
      const dy = ny - pt.y;
      pt.x = round(nx, 5);
      pt.y = round(ny, 5);
      for (const h of ['h1', 'h2']) {
        if (pt[`${h}x`] === undefined) continue;
        pt[`${h}x`] = round(pt[`${h}x`] + dx, 5);
        pt[`${h}y`] = round(pt[`${h}y`] + dy, 5);
      }
    } else {
      pt[`${drag.which}x`] = round(nx, 5);
      pt[`${drag.which}y`] = round(ny, 5);

      // Alt を押していなければ、反対側の手も一直線に保つ（なめらかな点）。
      const other = drag.which === 'h1' ? 'h2' : 'h1';
      if (!e.altKey && pt[`${other}x`] !== undefined) {
        pt[`${other}x`] = round(pt.x * 2 - nx, 5);
        pt[`${other}y`] = round(pt.y * 2 - ny, 5);
      }
    }

    paint();
  }

  function doCreate(p, e) {
    const s = drag.start;
    let w = p.x - s.x;
    let h = p.y - s.y;

    if (e.shiftKey && drag.tool !== 'line') {
      const m = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * m;
      h = Math.sign(h || 1) * m;
    }

    const box = {
      x: Math.min(s.x, s.x + w), y: Math.min(s.y, s.y + h),
      w: Math.abs(w), h: Math.abs(h),
    };

    if (!drag.node) {
      drag.node = drag.tool === 'line'
        ? makeNode('path', { fill: null, stroke: '#1f2430', strokeWidth: 4 })
        : drag.tool === 'text'
          ? makeNode('text', { text: 'ここに文字', color: '#1f2430' })
          : makeNode(drag.tool);
      doc.nodes.push(drag.node);
    }

    Object.assign(drag.node, { x: round(box.x, 2), y: round(box.y, 2), w: round(Math.max(1, box.w), 2), h: round(Math.max(1, box.h), 2) });

    if (drag.tool === 'line') {
      // 起点から今の位置へ向かう1本の線（0〜1にしまう）。
      const rx = w >= 0 ? 0 : 1;
      const ry = h >= 0 ? 0 : 1;
      drag.node.d = [{ closed: false, pts: [{ x: rx, y: ry }, { x: 1 - rx, y: 1 - ry }] }];
      if (e.shiftKey) {
        // まっすぐな線にする
        if (Math.abs(w) > Math.abs(h)) drag.node.d[0].pts[1].y = drag.node.d[0].pts[0].y;
        else drag.node.d[0].pts[1].x = drag.node.d[0].pts[0].x;
      }
    }

    if (drag.tool === 'text') {
      drag.node.fontSize = round(clamp(box.h * 0.6, 10, 400), 1);
    }

    paint();
  }

  function finishCreate(d) {
    const n = d.node;

    // ほとんど動かさずに離したときは、使いやすい大きさで置く。
    if (n.w < 6 && n.h < 6) {
      const size = d.tool === 'text' ? { w: Math.min(doc.w * 0.6, 600), h: 90 } : { w: 200, h: 200 };
      n.w = size.w;
      n.h = size.h;
      n.x = round(d.start.x - n.w / 2, 2);
      n.y = round(d.start.y - n.h / 2, 2);
      if (d.tool === 'text') n.fontSize = 56;
      if (d.tool === 'line') n.d = [{ closed: false, pts: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }] }];
    }

    if (d.tool === 'text') n.h = round(textHeight(n, wrapText(n, n.w)), 2);

    setSelection([n.id]);
    setTool('select');
    commit('create');
    if (d.tool === 'text') on.edit(n);
  }

  // ---- ペン ---------------------------------------------------------------

  function penDown(p, e) {
    if (!penDraft) {
      penDraft = { pts: [{ x: p.x, y: p.y }], cursor: p };
      drag = { kind: 'penHandle' };
      drawOverlay();
      return;
    }

    const first = penDraft.pts[0];
    const close = Math.hypot(p.x - first.x, p.y - first.y) < 10 / zoom && penDraft.pts.length >= 3;

    if (close) {
      finishPen(true);
      return;
    }

    penDraft.pts.push({ x: p.x, y: p.y });
    drag = { kind: 'penHandle' };
    drawOverlay();
  }

  /** ペンを終える。closed なら閉じた形にする。 */
  function finishPen(closed) {
    if (!penDraft || penDraft.pts.length < 2) {
      penDraft = null;
      drawOverlay();
      return;
    }

    const pts = penDraft.pts;
    const all = pts.flatMap((p) => {
      const list = [{ x: p.x, y: p.y }];
      for (const h of ['h1', 'h2']) {
        if (p[`${h}x`] !== undefined) list.push({ x: p[`${h}x`], y: p[`${h}y`] });
      }
      return list;
    });

    const xs = all.map((q) => q.x);
    const ys = all.map((q) => q.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(1, Math.max(...xs) - x);
    const h = Math.max(1, Math.max(...ys) - y);

    const norm = (q) => ({ x: round((q.x - x) / w, 5), y: round((q.y - y) / h, 5) });

    const node = makeNode('path', {
      x: round(x, 2), y: round(y, 2), w: round(w, 2), h: round(h, 2),
      fill: closed ? '#7c5cff' : null,
      stroke: closed ? null : '#1f2430',
      strokeWidth: closed ? 0 : 4,
      d: [{
        closed,
        pts: pts.map((p) => {
          const out = norm(p);
          for (const hh of ['h1', 'h2']) {
            if (p[`${hh}x`] === undefined) continue;
            const q = norm({ x: p[`${hh}x`], y: p[`${hh}y`] });
            out[`${hh}x`] = q.x;
            out[`${hh}y`] = q.y;
          }
          return out;
        }),
      }],
    });

    doc.nodes.push(node);
    penDraft = null;
    setSelection([node.id]);
    setTool('select');
    commit('pen');
  }

  // ---- 記録 ---------------------------------------------------------------

  const snapshot = () => structuredCloneSafe(doc.nodes);

  function commit(kind) {
    on.change(doc, kind);
    paint();
  }

  function setSelection(ids) {
    selection = [...new Set(ids)];
    if (!selection.length) nodeEdit = null;
    on.select(selection);
    drawOverlay();
  }

  function setTool(t) {
    tool = t;
    if (t !== 'pen' && penDraft) finishPen(false);
    if (t !== 'node') nodeEdit = null;
    stage.dataset.tool = t;
    on.tool(t);
    drawOverlay();
  }

  function zoomAt(clientX, clientY, next) {
    const z = clamp(next, 0.05, 16);
    const r = rect();
    const cx = clientX - r.left;
    const cy = clientY - r.top;

    pan = {
      x: cx - ((cx - pan.x) / zoom) * z,
      y: cy - ((cy - pan.y) / zoom) * z,
    };
    zoom = z;

    view.setAttribute('transform', `translate(${pan.x} ${pan.y}) scale(${zoom})`);
    drawOverlay();
    on.view({ zoom, pan });
  }

  function fit(margin = 56) {
    const r = rect();
    if (r.width < 10) return;
    const z = Math.min((r.width - margin * 2) / doc.w, (r.height - margin * 2) / doc.h);
    zoom = clamp(z, 0.02, 4);
    pan = {
      x: (r.width - doc.w * zoom) / 2,
      y: (r.height - doc.h * zoom) / 2,
    };
    paint();
    on.view({ zoom, pan });
  }

  // ---- 外から使う口 -------------------------------------------------------

  return {
    stage,
    paint,
    fit,
    zoomAt,
    get doc() { return doc; },
    set doc(v) { doc = v; },
    get assets() { return assets; },
    set assets(v) { assets = v; paint(); },
    get zoom() { return zoom; },
    setZoom(z) {
      const r = rect();
      zoomAt(r.left + r.width / 2, r.top + r.height / 2, z);
    },
    get tool() { return tool; },
    setTool,
    get selection() { return selection; },
    setSelection,
    get nodeEdit() { return nodeEdit; },
    setNodeEdit(id) { nodeEdit = id; drawOverlay(); },
    get penActive() { return penDraft !== null; },
    endPen: (closed) => finishPen(closed),
    snapshot,
    commit,
    toDoc,
    toScreen,
    setSpace(v) { spaceHeld = v; stage.classList.toggle('grabbing', v); },
    destroy() {
      stage.remove();
    },
  };
}

function svgTag(tag, attrs = {}) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    n.setAttribute(k, String(v));
  }
  return n;
}
