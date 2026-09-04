// 編集の画面。左に素材、まん中にキャンバス、右に設定。
//
// 【自動保存】
// 打つたびに保存すると通信が増えるので、手が止まって1.2秒たったらまとめて送る。
// 送っている間は右上に「保存中」と出す。閉じようとしたときに未保存があれば引き止める。
//
// 【見本（サムネイル）】
// 一覧に出す絵は、保存のついでにブラウザ側で作って一緒に送る。
// サーバーに画像を描く仕組みを持たなくて済むぶん、置き場所を選ばない。

import { el, btn, icon, toast, modal, field, select, num, when, mount, confirmBox } from '../ui.js';
import { api } from '../api.js';
import { store, assetMap, uploadFile, uploadRender, refreshDesigns } from '../store.js';
import { createCanvas, TOOLS } from '../editor/canvas.js';
import { createHistory } from '../editor/history.js';
import { createInspector } from './inspector.js';
import { makeNode, uid, group, ungroup, reorder, structuredCloneSafe, magicResize } from '../editor/scene.js';
import { wrapText, textHeight } from '../editor/render.js';
import { toPngBlob, toSvgString, toThumbDataUrl, inlineAssets, download } from '../editor/exporter.js';
import { sharePanel } from './share.js';

export async function editorView(host, designId, go) {
  let design;
  try {
    const res = await api.design(store.workspaceId, designId);
    design = res.design;
  } catch (e) {
    host.replaceChildren(el('div', { class: 'pad' },
      el('p', {}, '開けませんでした：', e.message),
      btn('置き場へもどる', { class: 'btn primary', onclick: () => go('#/') })));
    return () => {};
  }

  const history = createHistory(design.doc);
  let dirty = false;
  let saving = false;
  let saveTimer = null;
  let titleEl;
  let statusEl;
  let toolbarZoom;

  // ---- ガワ ---------------------------------------------------------------

  const stageBox = el('div', { class: 'stage-box' });
  const leftBox = el('aside', { class: 'panel left' });
  const rightBox = el('aside', { class: 'panel right' });
  const toolsBox = el('div', { class: 'tools' });

  const canvas = createCanvas(stageBox, {
    doc: history.doc,
    assets: assetMap(),
    onChange: (doc, kind) => { history.push(doc, kind); markDirty(); inspector.draw(); },
    onSelect: () => { inspector.draw(); drawTools(); },
    onTool: () => drawTools(),
    onView: () => { if (toolbarZoom) toolbarZoom.textContent = `${Math.round(canvas.zoom * 100)}%`; },
    onEditText: (node) => editText(node),
  });

  const inspector = createInspector(rightBox, {
    canvas,
    doc: () => canvas.doc,
    replaceDoc: (next) => { canvas.doc = next; canvas.paint(); },
    commit: (kind) => { history.push(canvas.doc, kind); markDirty(); canvas.paint(); },
    brandColors: () => store.brand?.colors || [],
    palettes: () => store.catalog?.templates?.palettes || [],
    styles: () => store.catalog?.templates?.styles || [],
    presets: () => store.catalog?.templates?.presets || [],
    editText,
  });

  host.replaceChildren(
    el('div', { class: 'editor' },
      topbar(),
      el('div', { class: 'editor-body' }, leftBox, el('div', { class: 'stage-wrap' }, toolsBox, stageBox), rightBox)));

  drawLeft();
  drawTools();
  inspector.draw();
  canvas.paint();
  requestAnimationFrame(() => canvas.fit());

  // ブラウザでの動作確認（tests/browser.mjs）から、いま編集している中身を見るための口。
  // 読み取り専用で、ここから書きかえることはできない。
  Object.defineProperty(window, '__canterDoc', { configurable: true, get: () => canvas.doc });

  // ---- 上の帯 -------------------------------------------------------------

  function topbar() {
    titleEl = el('input', {
      class: 'title-inp', value: design.title, maxlength: 80,
      onchange: async (e) => {
        design.title = e.target.value.trim() || '無題のデザイン';
        e.target.value = design.title;
        await save({ title: design.title });
      },
    });

    statusEl = el('span', { class: 'save-state muted' }, '保存済み');
    toolbarZoom = el('span', { class: 'zoom-val' }, '100%');

    return el('div', { class: 'topbar' },
      icon('←', '置き場へもどる', { onclick: () => leave(() => go('#/')) }),
      titleEl,
      statusEl,

      el('div', { class: 'spacer' }),

      icon('↶', '元に戻す（Ctrl+Z）', { onclick: undo }),
      icon('↷', 'やり直す（Ctrl+Shift+Z）', { onclick: redo }),

      el('div', { class: 'zoom-box' },
        icon('−', '縮小', { onclick: () => canvas.setZoom(canvas.zoom / 1.2) }),
        el('button', { class: 'zoom-val-btn', type: 'button', title: '全体を表示（Ctrl+0）', onclick: () => canvas.fit() }, toolbarZoom),
        icon('＋', '拡大', { onclick: () => canvas.setZoom(canvas.zoom * 1.2) })),

      btn('書き出す', { class: 'btn', onclick: exportMenu }),
      btn('出す', { class: 'btn primary', onclick: openShare }));
  }

  // ---- 道具 ---------------------------------------------------------------

  function drawTools() {
    mount(toolsBox,
      Object.entries(TOOLS).map(([id, t]) => el('button', {
        class: 'tool' + (canvas.tool === id ? ' on' : ''),
        type: 'button',
        title: `${t.label}（${t.key}）`,
        onclick: () => canvas.setTool(id),
      }, el('span', { class: 'tool-glyph' }, t.glyph), el('span', { class: 'tool-label' }, t.label))),

      canvas.penActive
        ? el('div', { class: 'pen-hint' },
            el('span', {}, 'ペン：クリックで点、ドラッグでふくらみ。'),
            btn('閉じて終わる', { class: 'btn tiny', onclick: () => canvas.endPen(true) }),
            btn('開いたまま終わる', { class: 'btn tiny', onclick: () => canvas.endPen(false) }))
        : null);
  }

  // ---- 左の棚 -------------------------------------------------------------

  function drawLeft() {
    let tab = leftBox.dataset.tab || 'shape';

    const tabs = [
      ['shape', '図形'],
      ['text', '文字'],
      ['image', '画像'],
      ['brand', 'ブランド'],
    ];

    const body = el('div', { class: 'panel-body' });

    mount(leftBox,
      el('div', { class: 'panel-tabs' },
        tabs.map(([id, label]) => btn(label, {
          class: 'tab' + (tab === id ? ' on' : ''),
          onclick: () => { leftBox.dataset.tab = id; drawLeft(); },
        }))),
      body);

    leftBox.dataset.tab = tab;

    if (tab === 'shape') mount(body, shapeShelf());
    if (tab === 'text') mount(body, textShelf());
    if (tab === 'image') mount(body, imageShelf());
    if (tab === 'brand') mount(body, brandShelf());
  }

  function shapeShelf() {
    const put = (node) => {
      const doc = canvas.doc;
      const size = Math.min(doc.w, doc.h) * 0.3;
      Object.assign(node, {
        x: Math.round(doc.w / 2 - size / 2),
        y: Math.round(doc.h / 2 - size / 2),
        w: Math.round(size), h: Math.round(size),
      });
      doc.nodes.push(node);
      canvas.setSelection([node.id]);
      history.push(doc, 'add');
      markDirty();
      canvas.paint();
      inspector.draw();
    };

    const colors = store.brand?.colors || ['#f0508c'];
    const pick = (i) => colors[i % colors.length];

    return el('div', { class: 'shelf' },
      el('p', { class: 'hint' }, '押すとまん中に置きます。ドラッグして描くこともできます（左の道具）。'),
      el('div', { class: 'shape-grid' },
        el('button', { class: 'shape-btn', type: 'button', title: '四角', onclick: () => put(makeNode('rect', { fill: pick(1) })) },
          el('span', { class: 'sh sq', style: { background: pick(1) } })),
        el('button', { class: 'shape-btn', type: 'button', title: '角丸四角', onclick: () => put(makeNode('rect', { fill: pick(2), radius: 40 })) },
          el('span', { class: 'sh sq r', style: { background: pick(2) } })),
        el('button', { class: 'shape-btn', type: 'button', title: '円', onclick: () => put(makeNode('ellipse', { fill: pick(3) })) },
          el('span', { class: 'sh ci', style: { background: pick(3) } })),
        el('button', { class: 'shape-btn', type: 'button', title: '三角', onclick: () => put(triangle(pick(1))) },
          el('span', { class: 'sh tri', style: { borderBottomColor: pick(1) } })),
        el('button', { class: 'shape-btn', type: 'button', title: '線', onclick: () => put(makeNode('path', { fill: null, stroke: pick(0), strokeWidth: 8, d: [{ closed: false, pts: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }] }] })) },
          el('span', { class: 'sh line', style: { background: pick(0) } })),
        el('button', { class: 'shape-btn', type: 'button', title: '星', onclick: () => put(star(pick(2))) },
          el('span', { class: 'sh star' }, '★')),
        el('button', { class: 'shape-btn', type: 'button', title: '矢印', onclick: () => put(arrow(pick(0))) },
          el('span', { class: 'sh' }, '➜')),
        el('button', { class: 'shape-btn', type: 'button', title: 'ふきだし', onclick: () => put(bubble(pick(3))) },
          el('span', { class: 'sh' }, '💬'))));
  }

  function textShelf() {
    const styles = store.catalog?.templates?.styles || [];

    const put = (style) => {
      const doc = canvas.doc;
      const node = makeNode('text', {
        text: style.label === '本文' ? 'ここに本文を書きます。' : 'ここに文字',
        fontSize: Math.round(style.size * doc.w),
        font: style.font,
        weight: style.weight,
        lineHeight: style.lineHeight,
        tracking: style.tracking,
        color: store.brand?.colors?.[0] || '#1f2430',
        w: Math.round(doc.w * 0.76),
        x: Math.round(doc.w * 0.12),
        y: Math.round(doc.h * 0.42),
      });
      node.h = textHeight(node, wrapText(node, node.w));
      doc.nodes.push(node);
      canvas.setSelection([node.id]);
      history.push(doc, 'add');
      markDirty();
      canvas.paint();
      inspector.draw();
    };

    return el('div', { class: 'shelf' },
      el('p', { class: 'hint' }, '押すと文字を置きます。ダブルクリックで書きかえられます。'),
      styles.map((s) => el('button', {
        class: 'text-sample', type: 'button', onclick: () => put(s),
        style: { fontWeight: s.weight, fontSize: `${Math.min(28, 8 + s.size * 180)}px` },
      }, s.label)));
  }

  function imageShelf() {
    const file = el('input', {
      type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true,
      style: { display: 'none' },
      onchange: async (e) => {
        for (const f of e.target.files) await take(f);
        e.target.value = '';
      },
    });

    return el('div', { class: 'shelf' },
      file,
      btn('画像を取りこむ', { class: 'btn primary wide', onclick: () => file.click() }),
      el('p', { class: 'hint' }, 'キャンバスにドラッグしても取りこめます（PNG・JPEG・WebP・GIF、1枚12MBまで）。'),
      el('div', { class: 'asset-grid' },
        store.assets.map((a) => el('button', {
          class: 'asset', type: 'button', title: a.name || '画像',
          onclick: () => place(a),
        }, el('img', { src: a.url, alt: '', loading: 'lazy' })))));
  }

  function brandShelf() {
    const brand = store.brand || { colors: [] };

    return el('div', { class: 'shelf' },
      el('p', { class: 'hint' }, 'ここの色は、右の設定でいつでも押せます。デザインごとに選び直す手間をなくすためのものです。'),
      el('div', { class: 'brand-colors' },
        brand.colors.map((c, i) => el('div', { class: 'brand-color' },
          el('input', {
            type: 'color', value: c,
            onchange: async (e) => {
              const next = [...brand.colors];
              next[i] = e.target.value;
              await saveBrand({ colors: next });
            },
          }),
          icon('✕', 'この色を消す', {
            class: 'icon-btn tiny',
            onclick: () => saveBrand({ colors: brand.colors.filter((_, j) => j !== i) }),
          }))),
        btn('＋', {
          class: 'btn small', title: '色を足す',
          onclick: () => saveBrand({ colors: [...brand.colors, '#888888'] }),
        })),

      el('div', { class: 'sec-title' }, '書体'),
      field('見出し', select(brand.font_head, fontOptions(), (v) => saveBrand({ font_head: v }))),
      field('本文', select(brand.font_body, fontOptions(), (v) => saveBrand({ font_body: v }))),

      el('div', { class: 'sec-title' }, 'ワークスペース'),
      el('p', { class: 'hint' },
        'まねきコード: ', el('code', {}, store.workspace?.join_code || ''),
        '　これを伝えると、同じ置き場をいっしょに使えます。'));
  }

  function fontOptions() {
    return [
      { value: 'sans', label: 'ゴシック' },
      { value: 'serif', label: '明朝' },
      { value: 'rounded', label: '丸ゴシック' },
      { value: 'mono', label: '等幅' },
    ];
  }

  async function saveBrand(patch) {
    try {
      const res = await api.updateBrand(store.workspaceId, patch);
      store.brand = res.brand;
      drawLeft();
      inspector.draw();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function take(file) {
    try {
      const asset = await uploadFile(file);
      canvas.assets = assetMap();
      drawLeft();
      place(asset);
      toast('取りこみました');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function place(asset, at) {
    const doc = canvas.doc;
    const max = Math.min(doc.w, doc.h) * 0.6;
    const s = Math.min(max / asset.width, max / asset.height, 1);
    const w = Math.round(asset.width * s);
    const h = Math.round(asset.height * s);

    const node = makeNode('image', {
      asset: asset.id,
      name: asset.name || '画像',
      x: Math.round((at?.x ?? doc.w / 2) - w / 2),
      y: Math.round((at?.y ?? doc.h / 2) - h / 2),
      w, h,
    });

    doc.nodes.push(node);
    canvas.assets = assetMap();
    canvas.setSelection([node.id]);
    history.push(doc, 'add');
    markDirty();
    canvas.paint();
    inspector.draw();
  }

  // ---- 文字の書きかえ -----------------------------------------------------

  function editText(node) {
    const area = el('textarea', {
      class: 'text-edit',
      value: node.text,
      spellcheck: false,
    });

    const { close } = modal('文字を書きかえる', (done) => el('div', {},
      area,
      el('p', { class: 'hint' }, 'Enter で改行します。幅に入りきらない行は自動で折り返します。'),
      el('div', { class: 'row end gap' },
        btn('やめる', { onclick: done }),
        btn('決める', {
          class: 'btn primary',
          onclick: () => {
            node.text = area.value;
            node.h = textHeight(node, wrapText(node, node.w));
            history.push(canvas.doc, 'text');
            markDirty();
            canvas.paint();
            inspector.draw();
            done();
          },
        }))));

    setTimeout(() => { area.focus(); area.select(); }, 30);

    area.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        node.text = area.value;
        node.h = textHeight(node, wrapText(node, node.w));
        history.push(canvas.doc, 'text');
        markDirty();
        canvas.paint();
        inspector.draw();
        close();
      }
    });
  }

  // ---- 保存 ---------------------------------------------------------------

  function markDirty() {
    dirty = true;
    if (statusEl) statusEl.textContent = '未保存';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(), 1200);
  }

  async function save(extra = {}) {
    if (saving) { markDirty(); return; }
    clearTimeout(saveTimer);

    saving = true;
    if (statusEl) statusEl.textContent = '保存中…';

    try {
      const body = { doc: canvas.doc, ...extra };

      // 一覧に出す見本も、ついでに作って送る。
      try {
        const dataUrl = await toThumbDataUrl(canvas.doc, assetMap(), 480);
        const asset = await uploadRender(dataUrl, `${design.title} の見本`);
        body.thumb_asset = asset.id;
      } catch {
        // 見本が作れなくても、中身の保存は続ける
      }

      const res = await api.updateDesign(store.workspaceId, design.id, body);
      design = { ...design, ...res.design };
      dirty = false;
      if (statusEl) statusEl.textContent = `保存済み ${when(design.updated_at)}`;
    } catch (e) {
      if (statusEl) statusEl.textContent = '保存できませんでした';
      toast(e.message, 'error');
    } finally {
      saving = false;
    }
  }

  function leave(after) {
    if (!dirty) { after(); return; }
    save().then(after);
  }

  // ---- 書き出す・出す -----------------------------------------------------

  function exportMenu() {
    modal('書き出す', (close) => el('div', { class: 'export-menu' },
      el('p', { class: 'hint' }, '画面に出ているものと同じ作りかたで書き出すので、見えているとおりに出ます。'),
      [
        ['PNG（そのままの大きさ）', () => savePng(1)],
        ['PNG（2倍の細かさ）', () => savePng(2)],
        ['SVG（あとで細かく直せる形）', saveSvg],
      ].map(([label, fn]) => btn(label, {
        class: 'btn wide',
        onclick: async () => { close(); await fn(); },
      }))));
  }

  async function savePng(scale) {
    const t = toast('書き出しています…');
    try {
      const blob = await toPngBlob(canvas.doc, assetMap(), scale);
      download(blob, `${safeName(design.title)}.png`, 'image/png');
      t.remove();
      toast('書き出しました');
    } catch (e) {
      t.remove();
      toast(e.message, 'error');
    }
  }

  async function saveSvg() {
    try {
      const inlined = await inlineAssets(canvas.doc, assetMap());
      download(toSvgString(canvas.doc, inlined), `${safeName(design.title)}.svg`, 'image/svg+xml');
      toast('書き出しました');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function openShare() {
    await save();
    sharePanel({ design, doc: canvas.doc, onDone: () => {} });
  }

  // ---- キーボード ---------------------------------------------------------

  function onKey(e) {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (typing) return;

    const meta = e.ctrlKey || e.metaKey;
    const doc = canvas.doc;

    if (e.code === 'Space' && !e.repeat) { canvas.setSpace(true); return; }

    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    if (meta && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      canvas.setSelection(doc.nodes.filter((n) => !n.locked && !n.hidden).map((n) => n.id));
      return;
    }
    if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
    if (meta && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      if (e.shiftKey) {
        const one = doc.nodes.find((n) => n.id === canvas.selection[0]);
        if (one?.type === 'group') {
          const kids = ungroup(doc, one.id);
          canvas.setSelection(kids.map((k) => k.id));
          push('ungroup');
        }
      } else if (canvas.selection.length >= 2) {
        const g = group(doc, canvas.selection);
        if (g) { canvas.setSelection([g.id]); push('group'); }
      }
      return;
    }
    if (meta && e.key === '0') { e.preventDefault(); canvas.fit(); return; }
    if (meta && (e.key === '=' || e.key === '+')) { e.preventDefault(); canvas.setZoom(canvas.zoom * 1.2); return; }
    if (meta && e.key === '-') { e.preventDefault(); canvas.setZoom(canvas.zoom / 1.2); return; }
    if (meta && e.key === ']') { e.preventDefault(); reorder(doc, canvas.selection, 'forward'); push('order'); return; }
    if (meta && e.key === '[') { e.preventDefault(); reorder(doc, canvas.selection, 'backward'); push('order'); return; }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (canvas.selection.length === 0) return;
      e.preventDefault();
      doc.nodes = doc.nodes.filter((n) => !canvas.selection.includes(n.id));
      canvas.setSelection([]);
      push('delete');
      return;
    }

    if (e.key === 'Escape') {
      if (canvas.penActive) canvas.endPen(false);
      else canvas.setSelection([]);
      return;
    }

    if (e.key.startsWith('Arrow') && canvas.selection.length) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      for (const id of canvas.selection) {
        const n = doc.nodes.find((m) => m.id === id);
        if (n && !n.locked) { n.x += dx; n.y += dy; }
      }
      push('nudge');
      return;
    }

    if (e.key === 'Enter' && canvas.penActive) { canvas.endPen(false); return; }

    for (const [id, t] of Object.entries(TOOLS)) {
      if (e.key.toUpperCase() === t.key && !meta) {
        canvas.setTool(id);
        return;
      }
    }
  }

  function onKeyUp(e) {
    if (e.code === 'Space') canvas.setSpace(false);
  }

  function push(kind) {
    history.push(canvas.doc, kind);
    markDirty();
    canvas.paint();
    inspector.draw();
  }

  function duplicate() {
    const doc = canvas.doc;
    const picked = doc.nodes.filter((n) => canvas.selection.includes(n.id));
    const copies = picked.map((n) => ({ ...structuredCloneSafe(n), id: uid(), x: n.x + 16, y: n.y + 16 }));
    doc.nodes.push(...copies);
    canvas.setSelection(copies.map((c) => c.id));
    push('duplicate');
  }

  function undo() {
    const d = history.undo();
    if (!d) return;
    canvas.doc = structuredCloneSafe(d);
    canvas.setSelection(canvas.selection.filter((id) => canvas.doc.nodes.some((n) => n.id === id)));
    canvas.paint();
    inspector.draw();
    markDirty();
  }

  function redo() {
    const d = history.redo();
    if (!d) return;
    canvas.doc = structuredCloneSafe(d);
    canvas.paint();
    inspector.draw();
    markDirty();
  }

  // ---- ドラッグ＆ドロップ -------------------------------------------------

  const onDragOver = (e) => { e.preventDefault(); stageBox.classList.add('drop'); };
  const onDragLeave = () => stageBox.classList.remove('drop');
  const onDrop = async (e) => {
    e.preventDefault();
    stageBox.classList.remove('drop');
    const at = canvas.toDoc(e.clientX, e.clientY);
    for (const f of e.dataTransfer.files) {
      if (!f.type.startsWith('image/')) continue;
      try {
        const asset = await uploadFile(f);
        canvas.assets = assetMap();
        place(asset, at);
        drawLeft();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  };

  stageBox.addEventListener('dragover', onDragOver);
  stageBox.addEventListener('dragleave', onDragLeave);
  stageBox.addEventListener('drop', onDrop);

  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKeyUp);

  const beforeUnload = (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', beforeUnload);

  const onResize = () => canvas.paint();
  window.addEventListener('resize', onResize);

  // 画面を離れるときの後始末。
  return () => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('beforeunload', beforeUnload);
    window.removeEventListener('resize', onResize);
    clearTimeout(saveTimer);
    if (dirty) save().then(() => refreshDesigns());
    else refreshDesigns();
    canvas.destroy();
  };
}

// ---- できあいの形 ---------------------------------------------------------

const triangle = (fill) => makeNode('path', {
  name: '三角', fill, stroke: null, strokeWidth: 0,
  d: [{ closed: true, pts: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }],
});

function star(fill) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 0.5 : 0.21;
    const a = (Math.PI * 2 * i) / 10 - Math.PI / 2;
    pts.push({ x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) });
  }
  return makeNode('path', { name: '星', fill, stroke: null, strokeWidth: 0, d: [{ closed: true, pts }] });
}

const arrow = (fill) => makeNode('path', {
  name: '矢印', fill, stroke: null, strokeWidth: 0,
  d: [{
    closed: true,
    pts: [
      { x: 0, y: 0.35 }, { x: 0.62, y: 0.35 }, { x: 0.62, y: 0.12 }, { x: 1, y: 0.5 },
      { x: 0.62, y: 0.88 }, { x: 0.62, y: 0.65 }, { x: 0, y: 0.65 },
    ],
  }],
});

const bubble = (fill) => makeNode('path', {
  name: 'ふきだし', fill, stroke: null, strokeWidth: 0,
  d: [{
    closed: true,
    pts: [
      { x: 0.06, y: 0, h2x: 0.02, h2y: 0 },
      { x: 0.94, y: 0, h1x: 0.98, h1y: 0, h2x: 1, h2y: 0.04 },
      { x: 1, y: 0.66, h1x: 1, h1y: 0.72, h2x: 0.96, h2y: 0.76 },
      { x: 0.4, y: 0.76 },
      { x: 0.24, y: 1 },
      { x: 0.26, y: 0.76 },
      { x: 0.06, y: 0.76, h1x: 0.02, h1y: 0.76, h2x: 0, h2y: 0.72 },
      { x: 0, y: 0.04, h1x: 0, h1y: 0 },
    ],
  }],
});

const safeName = (title) => (title || 'canter').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
