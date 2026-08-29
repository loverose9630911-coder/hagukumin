// ボード（カンバン）。
//
// 列の分けかたを「ステータス」と「担当者」で切りかえられるのがポイント。
// 担当者で並べると、誰にいくつ乗っているかがそのまま列の高さになって見える。

import { el, select, avatar, dueLook, toast, STATUS, num } from '../ui.js';
import { store, member, project, activeProjects, updateTask } from '../store.js';
import { openTask } from '../taskpanel.js';
import { newTaskDialog } from './newtask.js';

const ui = { group: 'status', projectId: 0, mine: false, hideDone: false };

export function boardView(root) {
  const tasks = filtered();
  const cols = ui.group === 'status' ? statusColumns(tasks) : assigneeColumns(tasks);

  root.replaceChildren(
    el('div', { class: 'pad', style: { paddingBottom: 0 } }, el('div', { class: 'filters' }, controls())),
    el('div', { class: 'board' }, cols.map(column)),
  );
}

function controls() {
  const redraw = () => document.dispatchEvent(new CustomEvent('mikata:redraw'));

  return [
    select([
      { value: 'status', label: 'ステータスで分ける' },
      { value: 'assignee', label: '担当者で分ける' },
    ], ui.group, { class: 'input', onchange: (e) => { ui.group = e.target.value; redraw(); } }),

    select([{ value: 0, label: '全てのプロジェクト' }].concat(
      activeProjects().map((p) => ({ value: p.id, label: `${p.emoji} ${p.name}` }))
    ), ui.projectId, { class: 'input', onchange: (e) => { ui.projectId = Number(e.target.value); redraw(); } }),

    toggle('自分の担当のみ', ui.mine, (v) => { ui.mine = v; redraw(); }),
    toggle('完了を非表示', ui.hideDone, (v) => { ui.hideDone = v; redraw(); }),
    el('span', { class: 'grow' }),
    el('button', { class: 'btn primary', onclick: () => newTaskDialog({ project_id: ui.projectId || undefined }) }, '＋ タスク'),
  ];
}

function toggle(label, on, set) {
  return el('button', {
    class: `btn sm${on ? ' primary' : ''}`, 'aria-pressed': String(on),
    onclick: () => set(!on),
  }, label);
}

function filtered() {
  return store.tasks.filter((t) => {
    if (ui.projectId && t.project_id !== ui.projectId) return false;
    if (ui.mine && t.assignee_id !== store.user.id) return false;
    if (ui.hideDone && t.status === 'done') return false;
    return true;
  });
}

function statusColumns(tasks) {
  return Object.entries(STATUS).map(([key, s]) => ({
    key,
    title: s.label,
    color: s.color,
    tasks: tasks.filter((t) => t.status === key),
    drop: (taskId) => updateTask(taskId, { status: key }),
  }));
}

function assigneeColumns(tasks) {
  const cols = store.members.map((m) => ({
    key: `u${m.id}`,
    title: m.name,
    color: m.color,
    user: m,
    tasks: tasks.filter((t) => t.assignee_id === m.id),
    drop: (taskId) => updateTask(taskId, { assignee_id: m.id }),
  }));

  cols.push({
    key: 'none',
    title: '担当なし',
    color: 'var(--todo)',
    tasks: tasks.filter((t) => t.assignee_id === null),
    drop: (taskId) => updateTask(taskId, { assignee_id: null }),
  });

  return cols;
}

function column(col) {
  const body = el('div', { class: 'col-b' },
    col.tasks.length
      ? col.tasks.map(taskCard)
      : el('div', { class: 'empty', style: { fontSize: '12px', padding: '14px 6px' } }, 'なし'));

  const box = el('div', { class: 'col' },
    el('div', { class: 'col-t' },
      col.user ? avatar(col.user, 'sm') : el('span', { class: 'dot', style: { background: col.color } }),
      el('span', {}, col.title),
      el('span', { class: 'n' },
        `${col.tasks.length}件`,
        hours(col.tasks) ? ` / ${num(hours(col.tasks))}h` : '')),
    body);

  // ドラッグして落とすと、その列の意味（ステータス or 担当）に書きかわる。
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('over'); });
  box.addEventListener('dragleave', () => box.classList.remove('over'));
  box.addEventListener('drop', async (e) => {
    e.preventDefault();
    box.classList.remove('over');
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (!id) return;
    try {
      await col.drop(id);
    } catch (ex) {
      toast(ex.message);
    }
  });

  return box;
}

const hours = (tasks) => tasks.filter((t) => t.status !== 'done').reduce((s, t) => s + t.estimate_h, 0);

function taskCard(t) {
  const who = member(t.assignee_id);
  const pj = project(t.project_id);
  const today = store.metrics?.today || new Date().toISOString().slice(0, 10);
  const look = dueLook(t.due_date, today, t.status === 'done');

  const card = el('div', {
    class: 'tcard', draggable: true, tabIndex: 0, role: 'button',
    onclick: () => openTask(t.id),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTask(t.id); } },
  },
    el('div', { class: 'ttl' }, t.title),
    t.target_value
      ? el('div', { class: 'prog', title: `${num(t.actual_value)} / ${num(t.target_value)}${t.unit}` },
          el('i', { style: { width: `${Math.min(100, (t.actual_value / t.target_value) * 100)}%` } }))
      : null,
    el('div', { class: 'meta' },
      pj ? el('span', { class: 'tag', title: pj.name }, `${pj.emoji} ${pj.name}`) : null,
      t.priority === 'high' && t.status !== 'done' ? el('span', { class: 'tag high' }, '高') : null,
      // 担当者で分けているときは、列が担当を表しているのでステータスを見せる（逆もまた同じ）。
      ui.group === 'assignee' ? el('span', { class: `tag ${t.status}` }, STATUS[t.status].label) : null,
      el('span', { class: 'spacer' }),
      t.due_date ? el('span', { class: `tag ${look.cls}` }, look.text) : null,
      ui.group === 'status' ? avatar(who, 'sm') : null));

  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', String(t.id));
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('drag');
  });
  card.addEventListener('dragend', () => card.classList.remove('drag'));

  return card;
}
