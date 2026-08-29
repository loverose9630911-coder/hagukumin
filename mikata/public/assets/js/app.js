// アプリの入口。左のサイドバー・上の帯・画面の切りかえをここで組み立てる。
//
// 画面の切りかえは URL の # で決めている（#/board、#/channel/3 など）。
// サーバーの設定がいらないので、どこに置いても同じように動く。

import { el, avatar, toast, mount } from './ui.js';
import {
  store, subscribe, emit, loadMe, pickTeam, openTeam,
  activeProjects, startSync, logout, project,
} from './store.js';
import { api } from './api.js';
import { loginView } from './views/login.js';
import { dashboardView } from './views/dashboard.js';
import { boardView } from './views/board.js';
import { tableView } from './views/table.js';
import { goalsView } from './views/goals.js';
import { channelView } from './views/channel.js';
import { teamView } from './views/team.js';
import { newTaskDialog } from './views/newtask.js';
import { showTask, closeTask } from './taskpanel.js';
import { modal, field } from './ui.js';

const root = document.getElementById('app');

const NAV = [
  { hash: '#/',       icon: '📊', label: 'ダッシュボード' },
  { hash: '#/board',  icon: '🗂', label: 'ボード' },
  { hash: '#/table',  icon: '📋', label: 'テーブル' },
  { hash: '#/goals',  icon: '🎯', label: '目標' },
];

let viewBox = null;   // 画面のはめこみ先
let titleBox = null;
let sideBox = null;
let lastViewHash = '#/';

start();

async function start() {
  try {
    const user = await loadMe();
    if (!user) return gate();
    const teamId = pickTeam();
    if (!teamId) return gate();      // まれに起きる（チームなしユーザー）
    await openTeam(teamId);
    shell();
  } catch (e) {
    root.replaceChildren(el('div', { class: 'gate' },
      el('div', { class: 'card gate-card' }, el('div', { class: 'card-b' },
        el('p', {}, '読み込めませんでした：', e.message),
        el('button', { class: 'btn primary', onclick: () => location.reload() }, '再試行')))));
  }
}

function gate() {
  root.className = '';
  loginView(root, async ({ teams }) => {
    store.teams = teams;
    await openTeam(teams[0].id);
    location.hash = '#/';
    shell();
  });
}

// ---- ガワ ---------------------------------------------------------------

function shell() {
  root.className = '';
  sideBox = el('aside', { class: 'side', id: 'side' });
  titleBox = el('div', { style: { minWidth: 0 } });
  viewBox = el('div', { class: 'view' });

  root.replaceChildren(el('div', { class: 'shell' },
    sideBox,
    el('div', { class: 'main' },
      el('div', { class: 'topbar' },
        el('button', {
          class: 'btn ghost burger', 'aria-label': 'メニュー',
          onclick: () => sideBox.classList.toggle('open'),
        }, '☰'),
        titleBox,
        el('span', { class: 'grow' }),
        el('button', { class: 'btn primary', onclick: () => newTaskDialog() }, '＋ タスク')),
      viewBox)));

  drawSide();
  route();
  wireOnce();

  startSync((messages) => {
    const mine = messages.filter((m) => m.user_id !== store.user.id && m.kind === 'chat');
    const here = location.hash.startsWith('#/channel/') ? Number(location.hash.split('/')[2]) : 0;
    const elsewhere = mine.filter((m) => m.project_id !== here);
    if (elsewhere.length) {
      const p = project(elsewhere[0].project_id);
      toast(`${p ? p.emoji + ' ' + p.name : 'チャンネル'} に新しい書き込み（${elsewhere.length}件）`);
    }
  });
}

/**
 * 画面全体に1回だけ付ければよい見張り。
 * shell() はチームを切り替えるたびに呼ばれるので、ここを分けておかないと
 * 同じ処理が二重三重に走ってしまう。
 */
let wired = false;
function wireOnce() {
  if (wired) return;
  wired = true;

  window.addEventListener('hashchange', route);
  document.addEventListener('mikata:redraw', () => renderView(lastViewHash));

  subscribe((what) => {
    if (['unread', 'projects', 'sync', 'team', 'members'].includes(what)) drawSide();
    // 表示中の画面が持っているデータが変わったら描き直す。
    if (['tasks', 'metrics', 'goals', 'members', 'team'].includes(what)) renderView(lastViewHash);
  });
}

function drawSide() {
  const unreadTotal = Object.values(store.unread).reduce((a, b) => a + b, 0);

  mount(sideBox,
    el('div', { class: 'side-head' },
      el('button', { class: 'side-team', onclick: teamMenu },
        el('div', { class: 'side-mark' }, (store.team.name || '？').slice(0, 1)),
        el('div', { style: { minWidth: 0, flex: 1 } },
          el('b', {}, store.team.name),
          el('small', {}, `${store.members.length}人${unreadTotal ? ` ・未読${unreadTotal}` : ''}`)),
        el('span', { style: { opacity: .6 } }, '▾'))),

    el('div', { class: 'side-scroll' },
      el('div', { class: 'side-group' },
        NAV.map((n) => navItem(n.hash, n.icon, n.label))),

      el('div', { class: 'side-group' },
        el('div', { class: 'side-label' },
          el('span', {}, 'チャンネル'),
          el('button', { title: 'プロジェクトを作成する', onclick: () => { location.hash = '#/team'; } }, '＋')),
        activeProjects().map((p) => navItem(
          `#/channel/${p.id}`, p.emoji, p.name, store.unread[String(p.id)] || 0))),

      el('div', { class: 'side-group' },
        el('div', { class: 'side-label' }, el('span', {}, 'メンバー')),
        store.members.map((m) => el('div', { class: 'nav-item', style: { cursor: 'default' } },
          avatar(m, 'sm'),
          el('span', { class: 'grow' }, m.name),
          m.id === store.user.id ? el('span', { style: { fontSize: '10px', opacity: .6 } }, '自分') : null)))),

    el('div', { class: 'side-foot' },
      avatar(store.user),
      el('div', { class: 'grow' },
        el('b', {}, store.user.name),
        el('small', {}, `@${store.user.login}`)),
      el('button', { class: 'btn ghost sm', title: 'チーム設定', onclick: () => { location.hash = '#/team'; } }, '⚙'),
      el('button', { class: 'btn ghost sm', title: 'ログアウト', onclick: () => logout() }, '⏻')),
  );
}

function navItem(hash, icon, label, badge) {
  const on = location.hash === hash || (hash === '#/' && (location.hash === '' || location.hash === '#/'));
  return el('a', {
    class: `nav-item${on ? ' on' : ''}`, href: hash,
    onclick: () => sideBox.classList.remove('open'),
  },
    el('span', { class: 'ico' }, icon),
    el('span', { class: 'grow' }, label),
    badge ? el('span', { class: 'pill' }, String(badge)) : null);
}

// ---- 画面の切りかえ -----------------------------------------------------

function route() {
  const hash = location.hash || '#/';

  if (hash.startsWith('#/task/')) {
    // タスクは今の画面の上に重ねて出す。うしろの画面はそのまま。
    if (!viewBox.firstChild) renderView(lastViewHash);
    showTask(Number(hash.split('/')[2]));
    drawSide();
    return;
  }

  closeTask();
  lastViewHash = hash;
  renderView(hash);
  drawSide();
}

function renderView(hash) {
  if (!viewBox) return;
  viewBox.dispatchEvent(new CustomEvent('mikata:leave'));
  viewBox.scrollTop = 0;

  if (hash.startsWith('#/channel/')) {
    const id = Number(hash.split('/')[2]);
    const p = project(id);
    setTitle(p ? `${p.emoji} ${p.name}` : 'チャンネル', p ? 'このプロジェクトの会話とタスクのスレッド' : '');
    channelView(viewBox, id);
    return;
  }

  switch (hash) {
    case '#/board':
      setTitle('ボード', 'ドラッグしてステータスや担当を変えられます');
      return boardView(viewBox);
    case '#/table':
      setTitle('テーブル', '絞り込み・並べ替え');
      return tableView(viewBox);
    case '#/goals':
      setTitle('目標', '目標値と期限の進捗');
      return goalsView(viewBox);
    case '#/team':
      setTitle('チーム設定', '参加コード・使える時間・プロジェクト');
      return teamView(viewBox);
    default:
      setTitle('ダッシュボード', `${store.metrics?.today || ''} の状況`);
      return dashboardView(viewBox);
  }
}

function setTitle(title, sub) {
  mount(titleBox,
    el('h1', {}, title),
    sub ? el('div', { class: 'sub' }, sub) : null);
}

// ---- チームの切りかえ ---------------------------------------------------

function teamMenu() {
  const body = el('div', {});

  body.append(el('div', { class: 'list' }, store.teams.map((t) => el('button', {
    class: 'list-row',
    onclick: async () => {
      close();
      if (t.id === store.teamId) return;
      await openTeam(t.id);
      location.hash = '#/';
      shell();
    },
  },
    el('span', { class: 't' }, t.name),
    t.id === store.teamId ? el('span', { class: 'tag ok' }, '表示中') : null))));

  const newName = el('input', { class: 'input', placeholder: '例）開発チーム' });
  const code = el('input', { class: 'input', placeholder: 'ABC123', style: { textTransform: 'uppercase' } });

  body.append(
    el('h3', { style: { fontSize: '12px', color: 'var(--ink-3)', margin: '18px 0 8px' } }, 'チームを増やす'),
    field('新しく作る', el('div', { class: 'row' }, newName,
      el('button', {
        class: 'btn', style: { flex: '0 0 auto', minWidth: 0 },
        onclick: () => act(() => api.createTeam(newName.value)),
      }, '作る'))),
    field('コードで入る', el('div', { class: 'row' }, code,
      el('button', {
        class: 'btn', style: { flex: '0 0 auto', minWidth: 0 },
        onclick: () => act(() => api.joinTeam(code.value)),
      }, '入る'))));

  const close = modal({ title: 'チーム', body });

  async function act(fn) {
    try {
      const team = await fn();
      close();
      await loadMe();
      await openTeam(team.id);
      location.hash = '#/';
      shell();
      toast(`「${team.name}」を開きました`);
    } catch (e) {
      toast(e.message);
    }
  }
}
