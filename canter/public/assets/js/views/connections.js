// つなぎ先の設定と、出した記録。
//
// サービスごとに必要な入力は、サーバー側（src/Connector/*.php の fields()）が
// そのまま教えてくれる。画面はそれを並べるだけなので、
// あとからサービスを足しても、この画面を直す必要はない。

import { el, btn, icon, toast, modal, field, select, when, confirmBox, mount } from '../ui.js';
import { api } from '../api.js';
import { store, refreshConnections, refreshPosts, connector } from '../store.js';

export function connectionsView(box, go) {
  draw();

  function draw() {
    const cat = store.catalog?.connectors || [];
    const reach = store.catalog?.reachability || { public: true, reason: '' };

    box.replaceChildren(el('div', { class: 'conns' },
      el('div', { class: 'row between center' },
        el('h2', {}, 'つなぎ先'),
        btn('置き場へもどる', { class: 'btn', onclick: () => go('#/') })),

      !reach.public
        ? el('div', { class: 'notice' },
            el('strong', {}, '外から見えるアドレスがまだありません'),
            el('p', {}, reach.reason),
            el('p', { class: 'hint' },
              'Instagram・Threads・Notion は「画像の URL」を受け取って、'
              + '相手のサーバーが取りに来る作りです。手元の PC で動かしているあいだは、'
              + 'そのアドレス（' + reach.base + '）に外から届かないため画像を渡せません。'
              + 'X とミカタは画像そのものを送るので、いまのままでも出せます。'))
        : null,

      el('div', { class: 'conn-list' },
        cat.map((meta) => serviceBlock(meta))),

      el('h2', {}, '出した記録'),
      store.posts.length === 0
        ? el('p', { class: 'empty' }, 'まだ何も出していません。')
        : el('div', { class: 'post-list' }, store.posts.map(postRow))));
  }

  function serviceBlock(meta) {
    const mine = store.connections.filter((c) => c.service === meta.service);

    return el('div', { class: 'conn-block' },
      el('div', { class: 'conn-block-h' },
        el('div', {},
          el('h3', {}, meta.label),
          el('p', { class: 'muted small' }, describe(meta))),
        btn('つなぐ', { class: 'btn small', onclick: () => editDialog(meta, null) })),

      mine.length === 0
        ? null
        : el('div', { class: 'conn-rows' }, mine.map((c) => el('div', { class: 'conn-row ' + c.status },
            el('span', { class: 'conn-dot' }, c.status === 'ok' ? '●' : c.status === 'ng' ? '▲' : '○'),
            el('div', { class: 'conn-info' },
              el('strong', {}, c.label || '（名前なし）'),
              el('span', { class: 'muted small' },
                c.message || (c.status === 'unchecked' ? 'まだ確かめていません' : ''),
                c.checked_at ? `　${when(c.checked_at)}` : '')),
            btn('確かめる', {
              class: 'btn tiny',
              onclick: async (e) => {
                e.target.disabled = true;
                e.target.textContent = '…';
                try {
                  const res = await api.verifyConnection(store.workspaceId, c.id);
                  await refreshConnections();
                  toast(res.message, res.ok ? 'info' : 'error');
                } catch (err) {
                  toast(err.message, 'error');
                }
                draw();
              },
            }),
            icon('✎', '直す', { class: 'icon-btn tiny', onclick: () => editDialog(meta, c) }),
            icon('🗑', '外す', {
              class: 'icon-btn tiny',
              onclick: () => confirmBox('この接続を外しますか', `${c.name}「${c.label}」の設定を消します。`, async () => {
                try {
                  await api.deleteConnection(store.workspaceId, c.id);
                  await refreshConnections();
                  draw();
                  toast('外しました');
                } catch (err) { toast(err.message, 'error'); }
              }, '外す'),
            })))));
  }

  function describe(meta) {
    const bits = [];
    if (meta.capabilities.export_only) bits.push('公式の投稿APIが無いため、貼りつけ用に書き出します');
    else if (meta.needs_public_image) bits.push('画像は URL で渡します（外から見える場所が必要）');
    else bits.push('画像はそのまま送ります');
    if (meta.caption_limit) bits.push(`本文 ${meta.caption_limit} 文字まで`);
    return bits.join('・');
  }

  function editDialog(meta, existing) {
    const values = { ...(existing?.config || {}) };
    for (const f of meta.fields) {
      if (values[f.key] === undefined || values[f.key] === '') values[f.key] = f.default ?? '';
    }
    let label = existing?.label || '';

    modal(`${meta.label} につなぐ`, (close) => el('form', {
      class: 'conn-form',
      onsubmit: async (e) => {
        e.preventDefault();
        const go2 = e.target.querySelector('button[type=submit]');
        go2.disabled = true;
        go2.textContent = '…';

        try {
          const payload = { label, config: values };
          const res = existing
            ? await api.updateConnection(store.workspaceId, existing.id, payload)
            : await api.createConnection(store.workspaceId, { service: meta.service, ...payload });

          await refreshConnections();
          close();
          draw();

          // つないだ直後に、そのまま確かめる。
          const id = res.connection.id;
          const check = await api.verifyConnection(store.workspaceId, id);
          await refreshConnections();
          draw();
          toast(check.message, check.ok ? 'info' : 'error');
        } catch (err) {
          toast(err.message, 'error');
          go2.disabled = false;
          go2.textContent = '決める';
        }
      },
    },
      el('p', { class: 'hint' }, helpFor(meta.service)),

      field('この接続の名前', el('input', {
        class: 'inp', value: label, placeholder: '会社のアカウント',
        oninput: (e) => { label = e.target.value; },
      }), '同じサービスに複数つなぐときの目印です。'),

      meta.fields.map((f) => field(
        f.label + (f.required ? '' : '（任意）'),
        f.type === 'select'
          ? select(values[f.key], f.options, (v) => { values[f.key] = v; })
          : el('input', {
              class: 'inp',
              type: f.type === 'password' ? 'password' : f.type === 'url' ? 'url' : 'text',
              value: f.type === 'password' ? '' : values[f.key],
              placeholder: f.type === 'password' && existing?.has_secret?.[f.key] ? '（入っています。変えるときだけ入力）' : '',
              oninput: (e) => { values[f.key] = e.target.value; },
            }),
        f.help)),

      el('div', { class: 'row end gap' },
        btn('やめる', { onclick: close }),
        el('button', { type: 'submit', class: 'btn primary' }, '決める'))),
      { wide: true });
  }

  function postRow(p) {
    const c = store.connections.find((x) => x.id === p.connection_id);

    return el('div', { class: 'post-row ' + p.status },
      p.image ? el('img', { class: 'post-thumb', src: p.image.url, alt: '', loading: 'lazy' }) : el('span', { class: 'post-thumb' }),
      el('div', { class: 'post-body' },
        el('div', { class: 'row gap6 center' },
          el('strong', {}, c?.name || p.service),
          el('span', { class: 'badge ' + p.status }, STATUS[p.status] || p.status),
          el('span', { class: 'muted small' }, p.scheduled_at ? `${when(p.scheduled_at)} に出す` : when(p.created_at))),
        el('p', { class: 'post-cap' }, (p.caption || '').slice(0, 90) || '（本文なし）'),
        p.error ? el('p', { class: 'warn small' }, p.error) : null,
        p.external_url ? el('a', { class: 'link small', href: p.external_url, target: '_blank', rel: 'noopener' }, '開く') : null),

      el('div', { class: 'post-tools' },
        ['failed', 'draft', 'scheduled'].includes(p.status)
          ? btn('いま出す', {
              class: 'btn tiny',
              onclick: async (e) => {
                e.target.disabled = true;
                try {
                  const res = await api.runPost(store.workspaceId, p.id);
                  await refreshPosts();
                  draw();
                  toast(res.post.status === 'done' ? '出しました' : res.post.error, res.post.status === 'done' ? 'info' : 'error');
                } catch (err) {
                  toast(err.message, 'error');
                  draw();
                }
              },
            })
          : null,
        p.status !== 'sending'
          ? icon('🗑', '記録を消す', {
              class: 'icon-btn tiny',
              onclick: async () => {
                try {
                  await api.deletePost(store.workspaceId, p.id);
                  await refreshPosts();
                  draw();
                } catch (err) { toast(err.message, 'error'); }
              },
            })
          : null));
  }

  return { draw };
}

const STATUS = {
  draft: '下書き', scheduled: '予約', sending: '送信中', done: '済み', failed: '失敗',
};

function helpFor(service) {
  return {
    instagram: 'Meta のアプリで、プロアカウントに紐づいた長期アクセストークンを用意してください。'
      + '投稿は「入れものを作る → 公開する」の2段階で行います。',
    x: 'OAuth 2.0 のユーザートークンを使います。画像を送るには media.write の許可が要ります。'
      + 'リフレッシュトークンを入れておくと、期限切れのときに自動で取り直します。',
    threads: 'Threads の接続先は Facebook のものとは別（graph.threads.net）です。'
      + '文字だけの投稿なら、手元で動かしていても出せます。',
    notion: '作ったインテグレーションを、置き場所のページで「接続」に追加しておいてください。'
      + 'これを忘れると、鍵は正しいのにページが見つからない、という形で失敗します。',
    note: 'note には外部から記事を投稿する公式の API が公開されていません。'
      + 'そのため canter では投稿を自動化せず、見出し画像と本文を「貼るだけの形」にして渡します。',
    mikata: '同じ社内で動かしているミカタにつなぎます。デザインができたら、'
      + '制作タスクを立てたり、チャンネルに流したりできます。',
  }[service] || '';
}
