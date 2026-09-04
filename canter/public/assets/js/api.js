// サーバーとのやりとり。ここ以外から fetch は呼ばない
// （画像を data: に読み直すときだけ exporter.js が使う）。
//
// 画面から来た通信であることを示すために X-Canter ヘッダを必ず付ける。

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined
      ? { 'X-Canter': '1' }
      : { 'X-Canter': '1', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // 本文が JSON でないとき（502 など）は下でまとめて扱う
  }

  if (!res.ok) {
    const err = new Error(data?.error || `通信に失敗しました (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  me:       ()   => call('GET', '/api/me'),
  catalog:  ()   => call('GET', '/api/catalog'),
  register: (b)  => call('POST', '/api/auth/register', b),
  login:    (b)  => call('POST', '/api/auth/login', b),
  logout:   ()   => call('POST', '/api/auth/logout', {}),

  createWorkspace: (name)      => call('POST', '/api/workspaces', { name }),
  joinWorkspace:   (join_code) => call('POST', '/api/workspaces/join', { join_code }),

  bootstrap: (w) => call('GET', `/api/workspaces/${w}/bootstrap`),

  designs:       (w, q)      => call('GET',    `/api/workspaces/${w}/designs${qs(q)}`),
  design:        (w, id)     => call('GET',    `/api/workspaces/${w}/designs/${id}`),
  createDesign:  (w, b)      => call('POST',   `/api/workspaces/${w}/designs`, b),
  updateDesign:  (w, id, b)  => call('PATCH',  `/api/workspaces/${w}/designs/${id}`, b),
  deleteDesign:  (w, id)     => call('DELETE', `/api/workspaces/${w}/designs/${id}`),
  copyDesign:    (w, id, t)  => call('POST',   `/api/workspaces/${w}/designs/${id}/duplicate`, { title: t }),
  versions:      (w, id)     => call('GET',    `/api/workspaces/${w}/designs/${id}/versions`),
  restore:       (w, id, v)  => call('POST',   `/api/workspaces/${w}/designs/${id}/restore`, { version_id: v }),

  assets:      (w)         => call('GET',    `/api/workspaces/${w}/assets`),
  upload:      (w, b)      => call('POST',   `/api/workspaces/${w}/assets`, b),
  deleteAsset: (w, id)     => call('DELETE', `/api/workspaces/${w}/assets/${id}`),

  brand:       (w)     => call('GET',   `/api/workspaces/${w}/brand`),
  updateBrand: (w, b)  => call('PATCH', `/api/workspaces/${w}/brand`, b),

  connections:      (w)        => call('GET',    `/api/workspaces/${w}/connections`),
  createConnection: (w, b)     => call('POST',   `/api/workspaces/${w}/connections`, b),
  updateConnection: (w, id, b) => call('PATCH',  `/api/workspaces/${w}/connections/${id}`, b),
  deleteConnection: (w, id)    => call('DELETE', `/api/workspaces/${w}/connections/${id}`),
  verifyConnection: (w, id)    => call('POST',   `/api/workspaces/${w}/connections/${id}/verify`, {}),

  posts:      (w)        => call('GET',    `/api/workspaces/${w}/posts`),
  post:       (w, id)    => call('GET',    `/api/workspaces/${w}/posts/${id}`),
  createPost: (w, b)     => call('POST',   `/api/workspaces/${w}/posts`, b),
  updatePost: (w, id, b) => call('PATCH',  `/api/workspaces/${w}/posts/${id}`, b),
  deletePost: (w, id)    => call('DELETE', `/api/workspaces/${w}/posts/${id}`),
  runPost:    (w, id)    => call('POST',   `/api/workspaces/${w}/posts/${id}/run`, {}),

  tick: (w) => call('POST', `/api/workspaces/${w}/tick`, {}),
};
