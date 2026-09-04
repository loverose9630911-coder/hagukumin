// 画面が持っているデータと、その出し入れ。
//
// 画面ごとに fetch を書かないで済むように、ここに集める。
// 変わったら subscribe した人に知らせる（画面を組み直すのはそれぞれの担当）。

import { api } from './api.js';

export const store = {
  user: null,
  workspaces: [],
  workspaceId: null,
  workspace: null,
  members: [],
  brand: null,
  designs: [],
  assets: [],
  connections: [],
  posts: [],
  catalog: null,        // テンプレート・つなぎ先の一覧
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(what = 'all') {
  for (const fn of listeners) fn(what);
}

// ---- 読み込み -------------------------------------------------------------

export async function loadMe() {
  const me = await api.me();
  store.user = me.user;
  store.workspaces = me.workspaces || [];
  return me.user;
}

export async function loadCatalog() {
  if (store.catalog) return store.catalog;
  store.catalog = await api.catalog();
  return store.catalog;
}

export function pickWorkspace() {
  const saved = Number(localStorage.getItem('canter.ws') || 0);
  if (store.workspaces.some((w) => w.id === saved)) return saved;
  return store.workspaces[0]?.id ?? null;
}

export async function openWorkspace(id) {
  const data = await api.bootstrap(id);

  store.workspaceId = id;
  store.user = data.user;
  store.workspaces = data.workspaces;
  store.workspace = data.workspace;
  store.members = data.members;
  store.brand = data.brand;
  store.designs = data.designs;
  store.assets = data.assets;
  store.connections = data.connections;
  store.posts = data.posts;

  localStorage.setItem('canter.ws', String(id));
  await loadCatalog();
  emit('all');

  return data;
}

export async function logout() {
  await api.logout();
  store.user = null;
  store.workspaceId = null;
  localStorage.removeItem('canter.ws');
}

// ---- 画像 -----------------------------------------------------------------

/** 画像の id → 表示に使う URL。render.js に渡すのはこれ。 */
export function assetMap() {
  const m = new Map();
  for (const a of store.assets) m.set(a.id, a.url);
  return m;
}

export function assetById(id) {
  return store.assets.find((a) => a.id === id) || null;
}

/** ファイルを取りこむ（ドラッグ＆ドロップとファイル選択の両方から）。 */
export async function uploadFile(file) {
  const data = await new Promise((ok, ng) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => ng(new Error('ファイルを読めませんでした'));
    r.readAsDataURL(file);
  });

  const res = await api.upload(store.workspaceId, { data, name: file.name, kind: 'upload' });
  store.assets = [res.asset, ...store.assets];
  emit('assets');
  return res.asset;
}

/** 書き出した PNG を置いておく（投稿に使う実体）。 */
export async function uploadRender(dataUrl, name) {
  const res = await api.upload(store.workspaceId, { data: dataUrl, name, kind: 'render' });
  return res.asset;
}

// ---- デザイン -------------------------------------------------------------

export async function refreshDesigns() {
  const res = await api.designs(store.workspaceId);
  store.designs = res.designs;
  emit('designs');
}

export async function refreshPosts() {
  const res = await api.posts(store.workspaceId);
  store.posts = res.posts;
  emit('posts');
}

export async function refreshConnections() {
  const res = await api.connections(store.workspaceId);
  store.connections = res.connections;
  emit('connections');
}

// ---- 予約投稿の見張り -----------------------------------------------------

let ticking = null;

/**
 * 画面を開いている間、1分おきに「時間が来た予約」をサーバーに送らせる。
 * 常駐の仕組みを持たなくても、誰かが開いていれば予約が出る。
 * 誰も開かない時間帯にも出したい場合は bin/tick を cron に入れる。
 */
export function startTicker() {
  stopTicker();
  ticking = setInterval(async () => {
    if (!store.workspaceId || document.hidden) return;
    try {
      const res = await api.tick(store.workspaceId);
      if (res.sent?.length) {
        store.posts = res.posts;
        emit('posts');
      }
    } catch {
      // つながらないときは黙って次の回に回す
    }
  }, 60_000);
}

export function stopTicker() {
  if (ticking) clearInterval(ticking);
  ticking = null;
}

export const connector = (service) =>
  store.catalog?.connectors?.find((c) => c.service === service) || null;

export const presetById = (id) =>
  store.catalog?.templates?.presets?.find((p) => p.id === id) || null;
