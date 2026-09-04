// 「出す」画面。作ったものを、つないだ先へ送る。
//
// ここでやっていること
//   1. いま見ているデザインを PNG にして、1回だけサーバーに預ける
//   2. 選んだ出し先ごとに「投稿」を1件ずつ作る
//   3. すぐ出すなら、その場で送る。時間を決めたなら予約として置いておく
//
// 画像は出し先の数だけ作らない。同じ1枚を全員が指すので、
// 4つ同時に出しても、書き出しは1回で済む。

import { el, btn, icon, toast, modal, field, select, when, mount } from '../ui.js';
import { api } from '../api.js';
import { store, assetMap, uploadRender, refreshPosts, connector } from '../store.js';
import { toPngBlob } from '../editor/exporter.js';
import { blobToDataUrl, download } from '../editor/exporter.js';

export function sharePanel({ design, doc, onDone }) {
  const chosen = new Set();
  let caption = '';
  let title = design.title;
  let mode = 'now';         // now | later
  let at = defaultWhen();
  let renderAsset = null;   // 一度作ったら使い回す
  let busy = false;

  const { close, body } = modal(`「${design.title}」を出す`, () => el('div', { class: 'share' }), { wide: true });
  draw();

  function draw() {
    const conns = store.connections;
    const reach = store.catalog?.reachability || { public: true, reason: '' };

    const needsPublic = [...chosen]
      .map((id) => conns.find((c) => c.id === id))
      .filter(Boolean)
      .filter((c) => connector(c.service)?.needs_public_image);

    const limits = [...chosen]
      .map((id) => conns.find((c) => c.id === id))
      .filter(Boolean)
      .map((c) => ({ c, limit: connector(c.service)?.caption_limit || 0 }))
      .filter((x) => x.limit > 0 && caption.length > x.limit);

    mount(body, el('div', { class: 'share' },
      el('div', { class: 'share-left' },
        el('div', { class: 'share-preview', style: { aspectRatio: `${doc.w} / ${doc.h}` } },
          el('div', { class: 'share-preview-inner', id: 'sharePreview' })),
        el('p', { class: 'muted small' }, `${doc.w} × ${doc.h} ピクセルの PNG で出します`)),

      el('div', { class: 'share-right' },
        el('div', { class: 'sec-title' }, '出し先'),

        conns.length === 0
          ? el('p', { class: 'empty' }, 'まだどこにもつながっていません。右上の「つなぎ先」から設定してください。')
          : el('div', { class: 'conn-picks' }, conns.map(pick)),

        needsPublic.length > 0 && !reach.public
          ? el('p', { class: 'warn' },
              '⚠ ', reach.reason,
              ' いまえらんでいる ',
              needsPublic.map((c) => c.name).join('・'),
              ' は、このままでは送れません。')
          : null,

        el('div', { class: 'sec-title' }, '文'),
        el('textarea', {
          class: 'share-caption', rows: 6, value: caption,
          placeholder: 'ここに本文を書きます。ハッシュタグもここへ。',
          oninput: (e) => { caption = e.target.value; drawCount(); },
        }),
        el('div', { class: 'count-row', id: 'countRow' }, countText()),

        limits.length > 0
          ? el('p', { class: 'warn' }, limits.map((x) => `${x.c.name} は ${x.limit} 文字まで（いま ${caption.length} 文字）`).join(' / '))
          : null,

        needsTitle()
          ? field('見出し（Notion・note・ミカタで使います）',
              el('input', { class: 'inp', value: title, oninput: (e) => { title = e.target.value; } }))
          : null,

        el('div', { class: 'sec-title' }, 'いつ出すか'),
        el('div', { class: 'row gap6' },
          btn('いますぐ', { class: 'btn' + (mode === 'now' ? ' on' : ''), onclick: () => { mode = 'now'; draw(); } }),
          btn('時間を決める', { class: 'btn' + (mode === 'later' ? ' on' : ''), onclick: () => { mode = 'later'; draw(); } })),

        mode === 'later'
          ? el('div', {},
              el('input', {
                type: 'datetime-local', class: 'inp', value: at,
                oninput: (e) => { at = e.target.value; },
              }),
              el('p', { class: 'hint' },
                '決めた時間になったら送ります。画面を開いている人がいれば1分おきに、'
                + '誰も開いていない時間帯にも出したいときは bin/tick を cron に入れてください。'))
          : null,

        el('div', { class: 'row end gap' },
          btn('とじる', { onclick: () => { close(); onDone(); } }),
          btn(mode === 'now' ? '出す' : '予約する', {
            class: 'btn primary big',
            disabled: chosen.size === 0,
            onclick: run,
          })))));

    drawPreview();
  }

  function pick(c) {
    const meta = connector(c.service);
    const on = chosen.has(c.id);
    const ng = c.status === 'ng';

    return el('button', {
      class: 'conn-pick' + (on ? ' on' : '') + (ng ? ' ng' : ''),
      type: 'button',
      onclick: () => { on ? chosen.delete(c.id) : chosen.add(c.id); draw(); },
    },
      el('span', { class: 'conn-mark' }, on ? '✓' : ''),
      el('span', { class: 'conn-body' },
        el('span', { class: 'conn-name' }, c.name, c.label ? el('span', { class: 'muted small' }, `（${c.label}）`) : null),
        el('span', { class: 'muted small' },
          c.status === 'ok' ? 'つながっています'
            : c.status === 'ng' ? `確かめたときに失敗しました：${c.message}`
            : 'まだ確かめていません',
          meta?.capabilities?.export_only ? '・貼りつけ用に書き出します' : '')));
  }

  // draw() より前に呼ばれるので、巻き上げのきく function 宣言で書く。
  function needsTitle() {
    return [...chosen].some((id) => {
      const c = store.connections.find((x) => x.id === id);
      return c && ['notion', 'note', 'mikata'].includes(c.service);
    });
  }

  function countText() {
    const picked = [...chosen].map((id) => store.connections.find((c) => c.id === id)).filter(Boolean);
    const limits = picked
      .map((c) => ({ name: c.name, limit: connector(c.service)?.caption_limit || 0 }))
      .filter((x) => x.limit > 0);

    if (limits.length === 0) return `${caption.length} 文字`;
    return `${caption.length} 文字　（${limits.map((l) => `${l.name} ${l.limit}まで`).join(' / ')}）`;
  }

  function drawCount() {
    const row = body.querySelector('#countRow');
    if (row) row.textContent = countText();
  }

  async function drawPreview() {
    const box = body.querySelector('#sharePreview');
    if (!box || box.dataset.done) return;
    box.dataset.done = '1';
    try {
      const blob = await toPngBlob(doc, assetMap(), Math.min(1, 600 / Math.max(doc.w, doc.h)));
      const url = URL.createObjectURL(blob);
      box.replaceChildren(el('img', { src: url, alt: '' }));
    } catch {
      box.replaceChildren(el('span', { class: 'muted' }, '下絵を作れませんでした'));
    }
  }

  // ---- 送る ---------------------------------------------------------------

  async function run() {
    if (busy) return;
    busy = true;

    const picked = [...chosen].map((id) => store.connections.find((c) => c.id === id)).filter(Boolean);
    const t = toast('書き出しています…');

    try {
      if (!renderAsset) {
        const blob = await toPngBlob(doc, assetMap(), 1);
        const dataUrl = await blobToDataUrl(blob);
        renderAsset = await uploadRender(dataUrl, `${design.title}.png`);
      }
      t.remove();
    } catch (e) {
      t.remove();
      busy = false;
      toast(`書き出せませんでした：${e.message}`, 'error');
      return;
    }

    const results = [];

    for (const c of picked) {
      try {
        const created = await api.createPost(store.workspaceId, {
          connection_id: c.id,
          design_id: design.id,
          image_asset: renderAsset.id,
          caption,
          options: { title },
          status: mode === 'later' ? 'scheduled' : 'draft',
          scheduled_at: mode === 'later' ? at : null,
        });

        if (mode === 'later') {
          results.push({ c, post: created.post, scheduled: true });
          continue;
        }

        const ran = await api.runPost(store.workspaceId, created.post.id);
        results.push({ c, post: ran.post, artifact: ran.post.artifact });
      } catch (e) {
        results.push({ c, error: e.message });
      }
    }

    busy = false;
    await refreshPosts();
    close();
    showResults(results);
    onDone();
  }

  function showResults(results) {
    modal('結果', (done) => el('div', { class: 'results' },
      results.map((r) => el('div', { class: 'result ' + resultClass(r) },
        el('div', { class: 'result-head' },
          el('strong', {}, r.c.name),
          el('span', { class: 'muted small' }, r.c.label)),

        r.error
          ? el('p', { class: 'warn' }, r.error)
          : r.scheduled
            ? el('p', {}, `${when(r.post.scheduled_at)} に出す予約にしました`)
            : el('div', {},
                el('p', {}, r.post.status === 'done' ? '出しました' : `うまくいきませんでした：${r.post.error}`),
                r.post.external_url
                  ? el('a', { href: r.post.external_url, target: '_blank', rel: 'noopener', class: 'link' },
                      r.c.service === 'note' ? 'note を開く' : '開いて確かめる')
                  : null,
                r.artifact ? artifactBox(r.artifact) : null,
                r.post.logs?.length
                  ? el('details', {},
                      el('summary', {}, 'くわしい記録'),
                      el('ul', { class: 'logs' },
                        r.post.logs.map((l) => el('li', { class: l.level }, l.message))))
                  : null))),

      el('div', { class: 'row end' }, btn('とじる', { class: 'btn primary', onclick: done }))), { wide: true });
  }

  function artifactBox(a) {
    return el('div', { class: 'artifact' },
      el('p', { class: 'hint' }, 'note には公式の投稿APIがないため、貼りつけ用に用意しました。'),
      el('pre', { class: 'artifact-text' }, a.text),
      el('div', { class: 'row gap6' },
        btn('本文をコピー', {
          class: 'btn small',
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(a.text);
              toast('コピーしました');
            } catch {
              toast('コピーできませんでした。本文を選んで手で写してください', 'error');
            }
          },
        }),
        btn('Markdown で保存', {
          class: 'btn small',
          onclick: () => download(a.text, a.filename, 'text/markdown;charset=utf-8'),
        })));
  }

  function resultClass(r) {
    if (r.error) return 'ng';
    if (r.scheduled) return 'wait';
    return r.post.status === 'done' ? 'ok' : 'ng';
  }
}

function defaultWhen() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}
