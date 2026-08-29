// アプリが持っているデータと、その出し入れ。
//
// 画面（views/*.js）はここのデータを読むだけ。書きかえるときは必ずここの関数を通す。
// 変化があったら subscribe した画面に知らせて、描き直してもらう。

import { api } from './api.js';

const KEY_TEAM = 'mikata.team';

export const store = {
  user: null,
  teams: [],
  teamId: null,

  team: null,
  members: [],
  projects: [],
  tasks: [],
  goals: [],
  metrics: null,
  unread: {},
  mentions: [],
  latestId: 0,
  _incoming: [],

  _subs: new Set(),
  _timer: null,
  _metricsTimer: null,
};

export function subscribe(fn) {
  store._subs.add(fn);
  return () => store._subs.delete(fn);
}

export function emit(what = 'data') {
  for (const fn of store._subs) fn(what);
}

// ---- 読み込み -----------------------------------------------------------

export async function loadMe() {
  const { user, teams } = await api.me();
  store.user = user;
  store.teams = teams || [];
  return user;
}

export function pickTeam() {
  const saved = Number(localStorage.getItem(KEY_TEAM) || 0);
  const found = store.teams.find((t) => t.id === saved);
  return (found || store.teams[0])?.id ?? null;
}

export async function openTeam(teamId) {
  const data = await api.bootstrap(teamId);
  store.teamId = teamId;
  store.user = data.user;
  store.teams = data.teams;
  store.team = data.team;
  store.members = data.members;
  store.projects = data.projects;
  store.tasks = data.tasks;
  store.goals = data.goals;
  store.metrics = data.metrics;
  store.unread = data.unread || {};
  store.latestId = data.latest_id || 0;
  localStorage.setItem(KEY_TEAM, String(teamId));
  emit('team');
}

/** 集計と目標をサーバーから取り直す。 */
export async function pullMetrics() {
  const m = await api.metrics(store.teamId);
  store.metrics = m;
  store.goals = [...m.team.goals.team, ...m.team.goals.personal];
  return m;
}

/**
 * タスクを書きかえたあと、集計だけを取り直す。
 * 続けて操作したときに何度も呼ばれないよう、少しだけ待ってからまとめて実行する。
 */
export function refreshMetrics() {
  clearTimeout(store._metricsTimer);
  store._metricsTimer = setTimeout(async () => {
    try {
      await pullMetrics();
      emit('metrics');
    } catch {
      // つながらないときは次の操作でまた取りにいく
    }
  }, 120);
}

// ---- 検索 -------------------------------------------------------------

export const member  = (id) => store.members.find((m) => m.id === id) || null;
export const project = (id) => store.projects.find((p) => p.id === id) || null;
export const task    = (id) => store.tasks.find((t) => t.id === id) || null;
export const goal    = (id) => store.goals.find((g) => g.id === id) || null;

export const activeProjects = () => store.projects.filter((p) => !p.archived);

// ---- 書きかえ -----------------------------------------------------------

export async function createTask(input) {
  const { task: t } = await api.createTask(store.teamId, input);
  store.tasks.push(t);
  refreshMetrics();
  emit('tasks');
  return t;
}

export async function updateTask(id, patch) {
  const before = task(id);
  const i = store.tasks.findIndex((t) => t.id === id);

  // 先に画面を動かして、後からサーバーの答えで上書きする（もたつきを消すため）。
  if (i >= 0) {
    store.tasks[i] = { ...store.tasks[i], ...patch };
    emit('tasks');
  }

  try {
    const { task: t } = await api.updateTask(store.teamId, id, patch);
    if (i >= 0) store.tasks[i] = t;
    refreshMetrics();
    emit('tasks');
    return t;
  } catch (e) {
    if (i >= 0 && before) store.tasks[i] = before; // 失敗したら元に戻す
    emit('tasks');
    throw e;
  }
}

export async function deleteTask(id) {
  await api.deleteTask(store.teamId, id);
  store.tasks = store.tasks.filter((t) => t.id !== id);
  refreshMetrics();
  emit('tasks');
}

export async function saveGoal(id, input) {
  const res = id ? await api.updateGoal(store.teamId, id, input) : await api.createGoal(store.teamId, input);
  await reloadGoals();
  return res.goal;
}

export async function removeGoal(id) {
  await api.deleteGoal(store.teamId, id);
  await reloadGoals();
}

async function reloadGoals() {
  await pullMetrics();
  emit('goals');
}

export async function createProject(input) {
  const { project: p } = await api.createProject(store.teamId, input);
  store.projects.push(p);
  emit('projects');
  return p;
}

export async function updateProject(id, patch) {
  const { project: p } = await api.updateProject(store.teamId, id, patch);
  const i = store.projects.findIndex((x) => x.id === id);
  if (i >= 0) store.projects[i] = p;
  emit('projects');
  return p;
}

export async function updateMember(userId, patch) {
  const { members } = await api.updateMember(store.teamId, userId, patch);
  store.members = members;
  refreshMetrics();
  emit('members');
}

export async function markRead(projectId) {
  if (!store.unread[String(projectId)]) return;
  const { unread } = await api.markRead(store.teamId, projectId);
  store.unread = unread || {};
  emit('unread');
}

// ---- 新着の見はり -------------------------------------------------------

/**
 * 数秒おきに「自分が最後に見たあとの新着」だけを聞きにいく。
 * WebSocket を使わないぶん仕組みが単純で、どんな置きかたでも動く。
 */
let tickNow = null;

export function startSync(onMessages) {
  stopSync();

  tickNow = async () => {
    if (document.hidden || !store.teamId) return;
    try {
      const res = await api.sync(store.teamId, store.latestId);
      const unreadChanged = JSON.stringify(store.unread) !== JSON.stringify(res.unread || {});

      store.latestId = res.latest_id || store.latestId;
      store.unread = res.unread || {};
      store.mentions = res.mentions || [];
      // 開いている画面が拾えるように、届いたぶんを置いておく。
      store._incoming = res.messages || [];

      if (res.messages?.length) {
        onMessages?.(res.messages);
        // タスクの動きが混ざっていたら、集計とタスク一覧も取り直す。
        if (res.messages.some((m) => m.task_id)) refreshTasks();
      }

      // 何も変わっていないのに知らせると、5秒ごとに画面を描き直すことになる。
      if (res.messages?.length || unreadChanged) emit('sync');
    } catch {
      // 一時的な失敗は次のまわりで取り返す
    }
  };

  store._timer = setInterval(() => tickNow?.(), 5000);
}

// タブに戻ってきたらすぐ取りに行く。付けるのは1回だけ。
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) tickNow?.();
});

export function stopSync() {
  if (store._timer) clearInterval(store._timer);
  store._timer = null;
  tickNow = null;
}

let refreshing = false;
async function refreshTasks() {
  if (refreshing) return;
  refreshing = true;
  try {
    const data = await api.bootstrap(store.teamId);
    store.tasks = data.tasks;
    store.goals = data.goals;
    store.metrics = data.metrics;
    store.members = data.members;
    emit('tasks');
  } catch {
    // つぎの機会に
  } finally {
    refreshing = false;
  }
}

export async function logout() {
  stopSync();
  await api.logout();
  localStorage.removeItem(KEY_TEAM);
  location.reload();
}
