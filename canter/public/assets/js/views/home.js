// 置き場。作ったデザインの一覧と、新しく作るところ。
//
// 「白紙から作る」ではなく「出し先を選ぶ」から始める並びにしてある。
// Instagram に出したいのか note の見出しなのかで、必要な大きさは決まっているので、
// そこを最初に押さえてしまえば、あとで作り直す手間がなくなる。

import { el, btn, icon, toast, modal, when, confirmBox } from '../ui.js';
import { store, refreshDesigns } from '../store.js';
import { api } from '../api.js';

export function homeView(box, go) {
  let filter = '';
  draw();

  function draw() {
    const templates = store.catalog?.templates;
    const presets = templates?.presets || [];
    const groups = [...new Set(presets.map((p) => p.group))];

    const designs = store.designs.filter(
      (d) => filter === '' || d.title.toLowerCase().includes(filter.toLowerCase())
    );

    box.replaceChildren(
      el('div', { class: 'home' },
        el('section', { class: 'home-start' },
          el('h2', {}, 'どこに出しますか'),
          el('p', { class: 'muted' }, '出し先を選ぶと、そのサービスの推奨サイズで新しい1枚ができます。あとから別のサイズに作り直すこともできます。'),
          el('div', { class: 'preset-groups' },
            groups.map((g) => el('div', { class: 'preset-group' },
              el('div', { class: 'preset-group-name' }, g),
              el('div', { class: 'preset-row' },
                presets.filter((p) => p.group === g).map((p) => presetCard(p))))))),

        el('section', { class: 'home-list' },
          el('div', { class: 'row between center' },
            el('h2', {}, 'これまでのデザイン'),
            el('input', {
              class: 'inp search', type: 'search', placeholder: '名前でさがす', value: filter,
              oninput: (e) => { filter = e.target.value; draw(); },
            })),

          designs.length === 0
            ? el('p', { class: 'empty' }, filter ? '見つかりませんでした。' : 'まだありません。上から出し先を選んで始めてください。')
            : el('div', { class: 'design-grid' }, designs.map(designCard)))));
  }

  function presetCard(p) {
    const ratio = p.w / p.h;
    const boxW = 56;
    const boxH = 56;
    const w = ratio >= 1 ? boxW : boxW * ratio;
    const h = ratio >= 1 ? boxH / ratio : boxH;

    return el('button', {
      class: 'preset-card', type: 'button',
      title: `${p.w} × ${p.h}`,
      onclick: () => openTemplatePicker(p),
    },
      el('span', { class: 'preset-shape', style: { width: `${w}px`, height: `${h}px` } }),
      el('span', { class: 'preset-label' }, p.label),
      el('span', { class: 'preset-size muted' }, `${p.w}×${p.h}`));
  }

  function openTemplatePicker(preset) {
    const all = store.catalog.templates.designs.filter((d) => d.preset === preset.id);

    modal(`${preset.label} — ひな型をえらぶ`, (close) =>
      el('div', { class: 'tpl-pick' },
        el('p', { class: 'muted' }, `${preset.w} × ${preset.h} ピクセルで作ります。`),
        el('div', { class: 'tpl-grid' },
          all.map((t) => el('button', {
            class: 'tpl-card', type: 'button',
            onclick: async () => {
              close();
              await create({ template: t.id, title: t.label });
            },
          },
            el('span', { class: 'tpl-preview', style: previewStyle(t, preset) }, previewInner(t)),
            el('span', { class: 'tpl-name' }, t.label),
            el('span', { class: 'tpl-tag' }, t.tag))))),
      { wide: true });
  }

  /** ひな型の見本。中身の doc から、いちばん目立つ色だけを取り出して雰囲気を出す。 */
  function previewStyle(t, preset) {
    const ratio = preset.w / preset.h;
    return {
      background: t.doc.bg,
      aspectRatio: `${ratio}`,
    };
  }

  function previewInner(t) {
    // 上から3つぶんの図形を、色の帯として並べる（重い描画をせずに雰囲気だけ出す）。
    return t.doc.nodes.slice(0, 4).map((n) => {
      const color = typeof n.fill === 'string' ? n.fill
        : n.fill?.a ? n.fill.a
        : n.color || 'transparent';
      return el('span', {
        class: 'tpl-bar',
        style: {
          background: color,
          left: `${(n.x / t.doc.w) * 100}%`,
          top: `${(n.y / t.doc.h) * 100}%`,
          width: `${Math.max(3, (n.w / t.doc.w) * 100)}%`,
          height: `${Math.max(2, (n.h / t.doc.h) * 100)}%`,
          borderRadius: n.type === 'ellipse' ? '50%' : '2px',
          opacity: n.opacity ?? 1,
        },
      });
    });
  }

  function designCard(d) {
    return el('div', { class: 'design-card' },
      el('button', {
        class: 'design-thumb', type: 'button', onclick: () => go(`#/d/${d.id}`),
        style: { aspectRatio: `${d.w} / ${d.h}` },
      },
        d.thumb_url
          ? el('img', { src: d.thumb_url, alt: '', loading: 'lazy' })
          : miniPreview(d)),

      el('div', { class: 'design-meta' },
        el('button', { class: 'design-title', type: 'button', onclick: () => go(`#/d/${d.id}`) }, d.title),
        el('span', { class: 'muted small' }, `${d.w}×${d.h} ・ ${when(d.updated_at)}`)),

      el('div', { class: 'design-tools' },
        icon('⧉', '複製する', {
          onclick: async () => {
            try {
              await api.copyDesign(store.workspaceId, d.id, '');
              await refreshDesigns();
              toast('複製しました');
            } catch (e) { toast(e.message, 'error'); }
          },
        }),
        icon('🗑', '消す', {
          onclick: () => confirmBox('このデザインを消しますか', `「${d.title}」は元に戻せません。`, async () => {
            try {
              await api.deleteDesign(store.workspaceId, d.id);
              await refreshDesigns();
              toast('消しました');
            } catch (e) { toast(e.message, 'error'); }
          }, '消す'),
        })));
  }

  /**
   * まだ一度も開いていないデザインの「雰囲気」。
   * 見本の画像はブラウザ側で作るので、開くまでは無い。
   * そのあいだ空白にせず、色と位置だけを並べておく。
   */
  function miniPreview(d) {
    const p = d.preview;
    if (!p) return el('span', { class: 'muted' }, '見本なし');

    return el('span', { class: 'mini', style: { background: p.bg } },
      p.shapes.map((s) => el('span', {
        class: 'mini-bar',
        style: {
          background: s.color,
          left: `${s.x}%`, top: `${s.y}%`,
          width: `${Math.max(1.5, s.w)}%`, height: `${Math.max(1, s.h)}%`,
          borderRadius: s.round ? '50%' : '2px',
          opacity: String(s.op ?? 1),
        },
      })));
  }

  async function create(body) {
    try {
      const res = await api.createDesign(store.workspaceId, body);
      await refreshDesigns();
      go(`#/d/${res.design.id}`);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return { draw };
}
