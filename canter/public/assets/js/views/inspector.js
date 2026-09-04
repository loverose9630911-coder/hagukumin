// 右側の設定パネル。えらんだものの中身をここで直す。
//
// イラストレーターの機能をひととおり出しつつ、ふだん使うものを上に、
// たまにしか使わないものを下に置いてある。
// 「何も選んでいないとき」は、キャンバスそのものの設定になる。

import { el, btn, icon, num, select, swatch, section, field, toast, fmt, modal } from '../ui.js';
import { FONTS, ALIGN, align, distribute, reorder, group, ungroup, applyTextStyle, applyPalette, magicResize, makeNode, uid } from '../editor/scene.js';
import { toRings, combine, ringsToNode, canCombine, OP_LABEL } from '../editor/pathops.js';
import { wrapText, textHeight } from '../editor/render.js';

export function createInspector(host, ctx) {
  function draw() {
    const doc = ctx.doc();
    const ids = ctx.canvas.selection;
    const picked = doc.nodes.filter((n) => ids.includes(n.id));

    host.replaceChildren(
      picked.length === 0 ? canvasPanel(doc) : nodePanel(doc, picked),
      layersPanel(doc, ids));
  }

  const change = (kind) => { ctx.commit(kind); draw(); };

  /** えらんだもの全部に同じ変更をかける。 */
  function patch(picked, fn, kind) {
    for (const n of picked) {
      if (n.locked) continue;
      fn(n);
    }
    change(kind);
  }

  // ---- 何も選んでいないとき ----------------------------------------------

  function canvasPanel(doc) {
    const presets = ctx.presets();

    return el('div', { class: 'insp' },
      section('キャンバス',
        el('div', { class: 'grid2' },
          field('よこ', num(doc.w, (v) => { resize(Math.round(v), doc.h); }, { min: 16, max: 8000 })),
          field('たて', num(doc.h, (v) => { resize(doc.w, Math.round(v)); }, { min: 16, max: 8000 }))),

        field('背景の色', colorRow(doc.bg, (c) => { doc.bg = c || '#ffffff'; change('bg'); }, false))),

      section('別のサイズで作り直す',
        el('p', { class: 'hint' },
          '同じ絵を、ほかの出し先の大きさに合わせて置き直します。'
          + '大きさは縦横まとめて同じ比で変わるので、字が太ったり画像がつぶれたりしません。'),
        el('div', { class: 'resize-list' },
          presets.map((p) => btn(`${p.label}  ${p.w}×${p.h}`, {
            class: 'btn wide small' + (doc.w === p.w && doc.h === p.h ? ' on' : ''),
            onclick: () => resize(p.w, p.h),
          })))),

      section('配色を変える',
        el('p', { class: 'hint' }, '使っている色を、よく使われている順に置きかえます。'),
        el('div', { class: 'palette-list' },
          ctx.palettes().map((p) => el('button', {
            class: 'palette', type: 'button', title: p.label,
            onclick: () => {
              const next = applyPalette(ctx.doc(), p.colors);
              ctx.replaceDoc(next);
              change('palette');
              toast(`配色を「${p.label}」にしました`);
            },
          },
            p.colors.map((c) => el('span', { class: 'palette-dot', style: { background: c } })),
            el('span', { class: 'palette-name' }, p.label))))));
  }

  function resize(w, h) {
    const next = magicResize(ctx.doc(), w, h, 'stretch');
    ctx.replaceDoc(next);
    ctx.canvas.fit();
    change('resize');
  }

  // ---- 何かを選んでいるとき ----------------------------------------------

  function nodePanel(doc, picked) {
    const one = picked.length === 1 ? picked[0] : null;
    const kinds = new Set(picked.map((n) => n.type));

    return el('div', { class: 'insp' },
      section(picked.length === 1 ? label(one) : `${picked.length}個をえらんでいます`,
        el('div', { class: 'grid2' },
          field('よこ位置', num(one ? one.x : boxOf(picked).x, (v) => moveTo(picked, 'x', v))),
          field('たて位置', num(one ? one.y : boxOf(picked).y, (v) => moveTo(picked, 'y', v))),
          field('はば', num(one ? one.w : boxOf(picked).w, (v) => sizeTo(picked, 'w', v), { min: 1 })),
          field('たかさ', num(one ? one.h : boxOf(picked).h, (v) => sizeTo(picked, 'h', v), { min: 1 })),
          field('かたむき', num(one ? one.rot : 0, (v) => patch(picked, (n) => { n.rot = v; }, 'rot'), { step: 1 })),
          field('すけ具合', el('div', { class: 'row center gap6' },
            el('input', {
              type: 'range', class: 'range', min: 0, max: 100, step: 1,
              value: Math.round((one?.opacity ?? 1) * 100),
              oninput: (e) => patch(picked, (n) => { n.opacity = Number(e.target.value) / 100; }, 'opacity'),
            }),
            el('span', { class: 'muted small' }, `${Math.round((one?.opacity ?? 1) * 100)}%`))))),

      (kinds.has('rect') || kinds.has('ellipse') || kinds.has('path'))
        ? section('塗りと線',
            field('塗り', colorRow(one?.fill, (c) => patch(picked, (n) => { n.fill = c; }, 'fill'), true, one?.fill)),
            field('線の色', colorRow(one?.stroke, (c) => patch(picked, (n) => { n.stroke = c; }, 'stroke'), false)),
            el('div', { class: 'grid2' },
              field('線の太さ', num(one?.strokeWidth ?? 0, (v) => patch(picked, (n) => { n.strokeWidth = Math.max(0, v); }, 'sw'), { min: 0, step: 0.5 })),
              field('破線', num(one?.dash ?? 0, (v) => patch(picked, (n) => { n.dash = Math.max(0, v); }, 'dash'), { min: 0 }))),
            kinds.has('rect')
              ? field('角の丸み', num(one?.radius ?? 0, (v) => patch(picked, (n) => { if (n.type === 'rect') n.radius = Math.max(0, v); }, 'radius'), { min: 0 }))
              : null)
        : null,

      kinds.has('text') ? textPanel(doc, picked, one) : null,
      kinds.has('image') ? imagePanel(picked, one) : null,

      section('ならべる',
        el('div', { class: 'align-row' },
          Object.entries(ALIGN).map(([mode, name]) => icon(alignGlyph(mode), name, {
            onclick: () => { align(ctx.doc(), ctx.canvas.selection, mode); change('align'); },
          }))),
        picked.length >= 3
          ? el('div', { class: 'row gap6' },
              btn('よこのすきまを等しく', { class: 'btn small wide', onclick: () => { distribute(ctx.doc(), ctx.canvas.selection, 'x'); change('dist'); } }),
              btn('たてのすきまを等しく', { class: 'btn small wide', onclick: () => { distribute(ctx.doc(), ctx.canvas.selection, 'y'); change('dist'); } }))
          : el('p', { class: 'hint' }, picked.length >= 2
              ? 'えらんだもの全体にそろえます。1つだけのときはキャンバスにそろいます。'
              : 'キャンバスにそろえます。2つ以上えらぶと、そのあいだでそろえます。')),

      section('重なり',
        el('div', { class: 'row gap6' },
          icon('⤒', 'いちばん前へ', { onclick: () => { reorder(ctx.doc(), ctx.canvas.selection, 'front'); change('order'); } }),
          icon('↑', '1つ前へ', { onclick: () => { reorder(ctx.doc(), ctx.canvas.selection, 'forward'); change('order'); } }),
          icon('↓', '1つ後ろへ', { onclick: () => { reorder(ctx.doc(), ctx.canvas.selection, 'backward'); change('order'); } }),
          icon('⤓', 'いちばん後ろへ', { onclick: () => { reorder(ctx.doc(), ctx.canvas.selection, 'back'); change('order'); } }))),

      pathfinderPanel(picked),

      section('まとめる',
        el('div', { class: 'row gap6' },
          picked.length >= 2
            ? btn('グループにする', {
                class: 'btn small', onclick: () => {
                  const g = group(ctx.doc(), ctx.canvas.selection);
                  if (g) { ctx.canvas.setSelection([g.id]); change('group'); }
                },
              })
            : null,
          one?.type === 'group'
            ? btn('グループを解く', {
                class: 'btn small', onclick: () => {
                  const kids = ungroup(ctx.doc(), one.id);
                  ctx.canvas.setSelection(kids.map((k) => k.id));
                  change('ungroup');
                },
              })
            : null)),

      section('',
        el('div', { class: 'row gap6' },
          btn(one?.locked ? '動かせるようにする' : '動かないようにする', {
            class: 'btn small wide',
            onclick: () => { for (const n of picked) n.locked = !one?.locked; change('lock'); },
          }),
          btn('複製', {
            class: 'btn small', onclick: () => duplicate(picked),
          }),
          btn('消す', {
            class: 'btn small danger', onclick: () => {
              const d = ctx.doc();
              d.nodes = d.nodes.filter((n) => !ctx.canvas.selection.includes(n.id));
              ctx.canvas.setSelection([]);
              change('delete');
            },
          }))));
  }

  function textPanel(doc, picked, one) {
    return section('文字',
      el('div', { class: 'style-row' },
        ctx.styles().map((s) => btn(s.label, {
          class: 'btn tiny',
          title: `${FONTS[s.font].label} / ${Math.round(s.size * doc.w)}px`,
          onclick: () => patch(picked, (n) => {
            if (n.type !== 'text') return;
            Object.assign(n, applyTextStyle(n, s, doc.w));
            n.h = textHeight(n, wrapText(n, n.w));
          }, 'textstyle'),
        }))),

      field('書体', select(one?.font || 'sans',
        Object.entries(FONTS).map(([v, f]) => ({ value: v, label: f.label })),
        (v) => patch(picked, (n) => { if (n.type === 'text') n.font = v; }, 'font'))),

      el('div', { class: 'grid2' },
        field('大きさ', num(one?.fontSize ?? 48, (v) => patch(picked, (n) => {
          if (n.type !== 'text') return;
          n.fontSize = Math.max(4, v);
          n.h = textHeight(n, wrapText(n, n.w));
        }, 'fontsize'), { min: 4 })),
        field('太さ', select(String(one?.weight ?? 500),
          [300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: String(w), label: String(w) })),
          (v) => patch(picked, (n) => { if (n.type === 'text') n.weight = Number(v); }, 'weight'))),
        field('行の間', num(one?.lineHeight ?? 1.4, (v) => patch(picked, (n) => {
          if (n.type !== 'text') return;
          n.lineHeight = Math.max(0.6, v);
          n.h = textHeight(n, wrapText(n, n.w));
        }, 'lh'), { step: 0.05, min: 0.6 })),
        field('字の間', num(one?.tracking ?? 0, (v) => patch(picked, (n) => { if (n.type === 'text') n.tracking = v; }, 'tracking'), { step: 0.01 }))),

      field('そろえ', el('div', { class: 'row gap6' },
        [['left', '⬅'], ['center', '↔'], ['right', '➡']].map(([v, g]) => icon(g, v, {
          class: 'icon-btn' + (one?.align === v ? ' on' : ''),
          onclick: () => patch(picked, (n) => { if (n.type === 'text') n.align = v; }, 'talign'),
        })))),

      field('文字の色', colorRow(one?.color, (c) => patch(picked, (n) => { if (n.type === 'text') n.color = c || '#000000'; }, 'color'), false)),

      one ? btn('文字を書きかえる', {
        class: 'btn small wide', onclick: () => ctx.editText(one),
      }) : null);
  }

  function imagePanel(picked, one) {
    return section('画像',
      field('はめ方', select(one?.fit || 'cover', [
        { value: 'cover', label: '枠いっぱい（はみ出しは切る）' },
        { value: 'contain', label: '全部見せる（すきまができる）' },
        { value: 'fill', label: '枠に合わせて伸ばす' },
      ], (v) => patch(picked, (n) => { if (n.type === 'image') n.fit = v; }, 'fit'))),
      field('角の丸み', num(one?.radius ?? 0, (v) => patch(picked, (n) => { if (n.type === 'image') n.radius = Math.max(0, v); }, 'iradius'), { min: 0 })));
  }

  /** パスファインダー。 */
  function pathfinderPanel(picked) {
    const usable = picked.filter(canCombine);
    if (picked.length < 2) return null;

    return section('形を組み合わせる',
      usable.length < 2
        ? el('p', { class: 'hint' }, '四角・円・パスだけを組み合わせられます。文字や画像はそのままでは使えません。')
        : el('div', { class: 'row gap6 wrap' },
            Object.entries(OP_LABEL).map(([op, name]) => btn(name, {
              class: 'btn small',
              onclick: () => runPathOp(usable, op),
            }))));
  }

  function runPathOp(picked, op) {
    const doc = ctx.doc();

    // 重ね順のとおりに、下から順に組み合わせる（上の形で下を抜く、が直感どおりになる）。
    const ordered = doc.nodes.filter((n) => picked.some((p) => p.id === n.id));

    let rings = toRings(ordered[0]);
    if (!rings) { toast('この形は組み合わせられません', 'error'); return; }

    for (let i = 1; i < ordered.length; i++) {
      const next = toRings(ordered[i]);
      if (!next) { toast('この形は組み合わせられません', 'error'); return; }
      rings = combine(rings, next, op);
    }

    const base = ordered[ordered.length - 1];
    const node = ringsToNode(rings, {
      id: uid(),
      name: OP_LABEL[op],
      opacity: base.opacity,
      hidden: false,
      locked: false,
      fill: base.fill ?? ordered[0].fill ?? '#7c5cff',
      stroke: base.stroke ?? null,
      strokeWidth: base.strokeWidth ?? 0,
      dash: base.dash ?? 0,
      cap: 'round',
    });

    if (!node) {
      toast('重なりが無いので、形が残りませんでした', 'error');
      return;
    }

    const at = doc.nodes.indexOf(ordered[ordered.length - 1]);
    doc.nodes = doc.nodes.filter((n) => !ordered.includes(n));
    doc.nodes.splice(Math.min(at, doc.nodes.length), 0, node);

    ctx.canvas.setSelection([node.id]);
    change('pathop');
    toast(`${OP_LABEL[op]}しました`);
  }

  function duplicate(picked) {
    const doc = ctx.doc();
    const copies = picked.map((n) => ({ ...JSON.parse(JSON.stringify(n)), id: uid(), x: n.x + 16, y: n.y + 16 }));
    doc.nodes.push(...copies);
    ctx.canvas.setSelection(copies.map((c) => c.id));
    change('duplicate');
  }

  // ---- レイヤー -----------------------------------------------------------

  function layersPanel(doc, ids) {
    return section('かさなり（上が手前）',
      el('div', { class: 'layers' },
        [...doc.nodes].reverse().map((n) => el('div', {
          class: 'layer' + (ids.includes(n.id) ? ' on' : ''),
        },
          el('button', {
            class: 'layer-name', type: 'button',
            onclick: (e) => ctx.canvas.setSelection(
              e.shiftKey ? [...new Set([...ids, n.id])] : [n.id]
            ),
          },
            el('span', { class: 'layer-kind' }, kindGlyph(n.type)),
            label(n)),
          icon(n.hidden ? '🚫' : '👁', n.hidden ? '出す' : '隠す', {
            class: 'icon-btn tiny',
            onclick: () => { n.hidden = !n.hidden; change('hide'); },
          }),
          icon(n.locked ? '🔒' : '🔓', n.locked ? '動かせるようにする' : '動かないようにする', {
            class: 'icon-btn tiny',
            onclick: () => { n.locked = !n.locked; change('lock'); },
          })))));
  }

  // ---- 部品 ---------------------------------------------------------------

  /** 色を選ぶ1行。塗りではグラデーションも選べる。 */
  function colorRow(value, onpick, allowGradient, current) {
    const isGrad = value && typeof value === 'object';
    const hex = typeof value === 'string' ? value : '#ffffff';

    return el('div', { class: 'color-row' },
      el('input', {
        type: 'color', class: 'color-pick', value: isGrad ? (value.a || '#ffffff') : hex,
        oninput: (e) => onpick(e.target.value),
      }),
      el('div', { class: 'swatches' },
        ctx.brandColors().map((c) => swatch(c, () => onpick(c), value === c)),
        swatch(null, () => onpick(null), value === null || value === undefined)),
      allowGradient
        ? btn(isGrad ? 'グラデを直す' : 'グラデにする', {
            class: 'btn tiny',
            onclick: () => gradientDialog(isGrad ? value : { type: 'linear', angle: 90, a: hex, b: '#ffffff' }, onpick),
          })
        : null);
  }

  function gradientDialog(g, onpick) {
    const state = { ...g };
    modal('グラデーション', (close) => el('div', {},
      field('はじめの色', el('input', { type: 'color', class: 'color-pick', value: state.a, oninput: (e) => { state.a = e.target.value; } })),
      field('おわりの色', el('input', { type: 'color', class: 'color-pick', value: state.b, oninput: (e) => { state.b = e.target.value; } })),
      field('向き（度）', num(state.angle, (v) => { state.angle = v; }, { step: 15 })),
      el('div', { class: 'row end gap' },
        btn('やめる', { onclick: close }),
        btn('決める', { class: 'btn primary', onclick: () => { close(); onpick({ ...state, type: 'linear' }); } }))));
  }

  function moveTo(picked, key, v) {
    if (picked.length === 1) { picked[0][key] = v; change('pos'); return; }
    const b = boxOf(picked);
    const d = v - b[key];
    patch(picked, (n) => { n[key] += d; }, 'pos');
  }

  function sizeTo(picked, key, v) {
    if (picked.length !== 1) return;
    const n = picked[0];
    n[key] = Math.max(1, v);
    if (n.type === 'text') n.h = textHeight(n, wrapText(n, n.w));
    change('size');
  }

  return { draw };
}

// ---- 表示のきまり ---------------------------------------------------------

const KIND = {
  rect: '四角', ellipse: '円', text: '文字', path: 'パス', image: '画像', group: 'グループ',
};

const GLYPH = {
  rect: '▭', ellipse: '◯', text: 'T', path: '✒', image: '🖼', group: '❑',
};

const kindGlyph = (t) => GLYPH[t] || '・';

function label(n) {
  if (n.name) return n.name;
  if (n.type === 'text') return (n.text || '').split('\n')[0].slice(0, 18) || '文字';
  return KIND[n.type] || n.type;
}

const alignGlyph = (mode) => ({
  left: '⇤', hcenter: '↔', right: '⇥', top: '⤒', vcenter: '↕', bottom: '⤓',
}[mode] || '·');

function boxOf(picked) {
  const x = Math.min(...picked.map((n) => n.x));
  const y = Math.min(...picked.map((n) => n.y));
  const x1 = Math.max(...picked.map((n) => n.x + n.w));
  const y1 = Math.max(...picked.map((n) => n.y + n.h));
  return { x, y, w: x1 - x, h: y1 - y };
}
