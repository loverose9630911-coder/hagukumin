// サーバーとのやりとり。ここ以外から fetch は呼ばない。
//
// 画面から来た通信であることを示すために X-Mikata ヘッダを必ず付ける
// （他のサイトから勝手に操作されないようにするため）。

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? { 'X-Mikata': '1' } : { 'X-Mikata': '1', 'Content-Type': 'application/json' },
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
  me:        ()               => call('GET', '/api/me'),
  register:  (b)              => call('POST', '/api/auth/register', b),
  login:     (b)              => call('POST', '/api/auth/login', b),
  logout:    ()               => call('POST', '/api/auth/logout', {}),

  createTeam: (name)          => call('POST', '/api/teams', { name }),
  joinTeam:   (join_code)     => call('POST', '/api/teams/join', { join_code }),

  bootstrap: (t)              => call('GET', `/api/teams/${t}/bootstrap`),
  metrics:   (t)              => call('GET', `/api/teams/${t}/metrics`),
  sync:      (t, since)       => call('GET', `/api/teams/${t}/sync${qs({ since })}`),

  createTask: (t, b)          => call('POST',   `/api/teams/${t}/tasks`, b),
  updateTask: (t, id, b)      => call('PATCH',  `/api/teams/${t}/tasks/${id}`, b),
  deleteTask: (t, id)         => call('DELETE', `/api/teams/${t}/tasks/${id}`),

  createGoal: (t, b)          => call('POST',   `/api/teams/${t}/goals`, b),
  updateGoal: (t, id, b)      => call('PATCH',  `/api/teams/${t}/goals/${id}`, b),
  deleteGoal: (t, id)         => call('DELETE', `/api/teams/${t}/goals/${id}`),

  createProject: (t, b)       => call('POST',  `/api/teams/${t}/projects`, b),
  updateProject: (t, id, b)   => call('PATCH', `/api/teams/${t}/projects/${id}`, b),
  updateMember:  (t, id, b)   => call('PATCH', `/api/teams/${t}/members/${id}`, b),

  channel:  (t, project, before) => call('GET', `/api/teams/${t}/messages${qs({ project, before })}`),
  thread:   (t, task)           => call('GET', `/api/teams/${t}/messages${qs({ task })}`),
  post:     (t, b)              => call('POST', `/api/teams/${t}/messages`, b),
  markRead: (t, project_id)     => call('POST', `/api/teams/${t}/read`, { project_id }),
};
