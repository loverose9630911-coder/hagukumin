// アプリの入口。画面の切りかえと、上の帯をここで組み立てる。
//
// 画面の切りかえは URL の # で決めている（#/、#/d/12、#/connect）。
// サーバー側の設定がいらないので、どこに置いても同じように動く。
//
//   #/         置き場（デザインの一覧と、新しく作るところ）
//   #/d/{id}   編集の画面（ここだけ上の帯を持たず、画面いっぱいを使う）
//   #/connect  つなぎ先の設定と、出した記録

import { el, btn, icon, toast, modal, field, mount } from './ui.js';
import { store, subscribe, loadMe, pickWorkspace, openWorkspace, logout, startTicker, stopTicker } from './store.js';
import { api } from './api.js';
import { loginView } from './views/login.js';
import { homeView } from './views/home.js';
import { editorView } from './views/editor.js';
import { connectionsView } from './views/connections.js';

const root = document.getElementById('app');

let headBox = null;
let viewBox = null;
let leaveView = null;      // 前の画面の後始末
let currentHash = '';

start();

async function start() {
  try {
    const user = await loadMe();
    if (!user) return gate();

    const id = pickWorkspace();
    if (!id) return gate();

    await openWorkspace(id);
    shell();
  } catch (e) {
    root.replaceChildren(el('div', { class: 'gate' },
      el('div', { class: 'gate-card' },
        el('p', {}, '読み込めませんでした：', e.message),
        btn('もう一度', { class: 'btn primary', onclick: () => location.reload() }))));
  }
}

function gate() {
  root.className = '';
  stopTicker();
  loginView(root, async ({ workspaces }) => {
    store.workspaces = workspaces;
    await openWorkspace(workspaces[0].id);
    location.hash = '#/';
    shell();
  });
}

// ---- ガワ -----------------------------------------------------------------

function shell() {
  root.className = '';
  headBox = el('header', { class: 'apphead' });
  viewBox = el('main', { class: 'appview' });

  root.replaceChildren(el('div', { class: 'app' }, headBox, viewBox));

  drawHead();
  startTicker();

  window.addEventListener('hashchange', route);
  subscribe((what) => {
    if (what === 'all' || what === 'connections' || what === 'posts') drawHead();
  });

  route();
}

function drawHead() {
  const failed = store.posts.filter((p) => p.status === 'failed').length;

  mount(headBox,
    el('a', { class: 'brand', href: '#/' },
      el('img', { src: '/assets/icon.svg', width: 30, height: 30, alt: '' }),
      el('span', {}, 'canter')),

    el('nav', { class: 'nav' },
      el('a', { class: 'nav-item' + (isHome() ? ' on' : ''), href: '#/' }, '置き場'),
      el('a', { class: 'nav-item' + (location.hash.startsWith('#/connect') ? ' on' : ''), href: '#/connect' },
        'つなぎ先',
        failed > 0 ? el('span', { class: 'dot-badge' }, String(failed)) : null)),

    el('div', { class: 'spacer' }),

    el('button', {
      class: 'ws-btn', type: 'button', title: 'ワークスペースを切りかえる',
      onclick: workspaceMenu,
    }, store.workspace?.name || 'ワークスペース'),

    el('button', {
      class: 'user-btn', type: 'button', title: store.user?.name,
      style: { background: store.user?.color || '#888' },
      onclick: userMenu,
    }, (store.user?.name || '?').slice(0, 1)));
}

const isHome = () => location.hash === '' || location.hash === '#/' || location.hash.startsWith('#/?');

function workspaceMenu() {
  modal('ワークスペース', (close) => el('div', {},
    el('div', { class: 'ws-list' },
      store.workspaces.map((w) => btn(w.name, {
        class: 'btn wide' + (w.id === store.workspaceId ? ' on' : ''),
        onclick: async () => {
          close();
          await openWorkspace(w.id);
          location.hash = '#/';
          drawHead();
          route(true);
        },
      }))),

    el('p', { class: 'hint' }, 'まねきコード: ', el('code', {}, store.workspace?.join_code || ''),
      '　これを伝えると、同じ置き場をいっしょに使えます。'),

    el('div', { class: 'row gap6' },
      btn('新しく作る', {
        class: 'btn small',
        onclick: () => {
          close();
          modal('新しいワークスペース', (done) => {
            const inp = el('input', { class: 'inp', placeholder: 'チームの名前' });
            return el('div', {},
              field('名前', inp),
              el('div', { class: 'row end gap' },
                btn('やめる', { onclick: done }),
                btn('作る', {
                  class: 'btn primary',
                  onclick: async () => {
                    try {
                      const ws = await api.createWorkspace(inp.value);
                      done();
                      await openWorkspace(ws.id);
                      drawHead();
                      route(true);
                    } catch (e) { toast(e.message, 'error'); }
                  },
                })));
          });
        },
      }),
      btn('コードで入る', {
        class: 'btn small',
        onclick: () => {
          close();
          modal('まねきコードで入る', (done) => {
            const inp = el('input', { class: 'inp', placeholder: 'ABC123', maxlength: 6 });
            return el('div', {},
              field('まねきコード', inp),
              el('div', { class: 'row end gap' },
                btn('やめる', { onclick: done }),
                btn('入る', {
                  class: 'btn primary',
                  onclick: async () => {
                    try {
                      const ws = await api.joinWorkspace(inp.value);
                      done();
                      await openWorkspace(ws.id);
                      drawHead();
                      route(true);
                    } catch (e) { toast(e.message, 'error'); }
                  },
                })));
          });
        },
      }))));
}

function userMenu() {
  modal(store.user?.name || 'あなた', (close) => el('div', {},
    el('p', { class: 'muted' }, 'ログインID: ', el('code', {}, store.user?.login || '')),
    el('div', { class: 'row end gap' },
      btn('とじる', { onclick: close }),
      btn('ログアウト', {
        class: 'btn danger',
        onclick: async () => {
          close();
          await logout();
          location.hash = '#/';
          gate();
        },
      }))));
}

// ---- 画面の切りかえ -------------------------------------------------------

async function route(force = false) {
  const hash = location.hash || '#/';
  if (hash === currentHash && !force) return;
  currentHash = hash;

  if (leaveView) { leaveView(); leaveView = null; }

  const design = hash.match(/^#\/d\/(\d+)/);

  // 編集の画面だけは、上の帯を隠して画面いっぱいに使う。
  root.classList.toggle('full', Boolean(design));

  if (design) {
    mount(viewBox, el('div', { class: 'loading' }, '開いています…'));
    leaveView = await editorView(viewBox, Number(design[1]), (to) => { location.hash = to; });
    return;
  }

  if (hash.startsWith('#/connect')) {
    connectionsView(viewBox, (to) => { location.hash = to; });
    return;
  }

  const home = homeView(viewBox, (to) => { location.hash = to; });
  const off = subscribe((what) => {
    if (what === 'all' || what === 'designs' || what === 'assets') home.draw();
  });
  leaveView = off;
}
