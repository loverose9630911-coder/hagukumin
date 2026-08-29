// テーブル（Notion のデータベース表示にあたるもの）。
//
// 絞り込みと並べ替えができる。数字（見積・目標値・実績）を横に並べて見たいときはこちら。

import { el, select, avatar, dueLook, num, pct, STATUS, PRIORITY } from '../ui.js';
import { store, member, project, activeProjects } from '../store.js';
import { openTask } from '../taskpanel.js';
import { newTaskDialog } from './newtask.js';

const ui = { q: '', projectId: 0, assigneeId: 'all', status: 'open', sort: 'due', desc: false };

const COLUMNS = [
  { key: 'title',    label: 'タスク',      sortable: true },
  { key: 'project',  label: 'プロジェクト', sortable: true },
  { key: 'status',   label: 'ステータス',   sortable: true },
  { key: 'assignee', label: '担当',        sortable: true },
  { key: 'due',      label: '納期',        sortable: true },
  { key: 'priority', label: '優先度',      sortable: true },
  { key: 'estimate', label: '見積',        sortable: true },
  { key: 'value',    label: '目標値 / 実績', sortable: true },
];

export function tableView(root) {
  const rows = sorted(filtered());
  const redraw = () => document.dispatchEvent(new CustomEvent('mikata:redraw'));

  const openHours = rows.filter((t) => t.status !== 'done').reduce((s, t) => s + t.estimate_h, 0);

  root.replaceChildren(el('div', { class: 'pad' }, el('div', { class: 'wrap' },
    el('div', { class: 'filters' },
      el('input', {
        class: 'input grow', placeholder: 'タスク名で検索', value: ui.q,
        oninput: (e) => { ui.q = e.target.value; redraw(); },
      }),
      select([{ value: 0, label: '全てのプロジェクト' }].concat(
        activeProjects().map((p) => ({ value: p.id, label: `${p.emoji} ${p.name}` }))
      ), ui.projectId, { class: 'input', onchange: (e) => { ui.projectId = Number(e.target.value); redraw(); } }),
      select([
        { value: 'all', label: '全ての担当' },
        { value: 'me', label: '自分' },
        { value: 'none', label: '担当なし' },
      ].concat(store.members.map((m) => ({ value: String(m.id), label: m.name }))),
        ui.assigneeId, { class: 'input', onchange: (e) => { ui.assigneeId = e.target.value; redraw(); } }),
      select([
        { value: 'open', label: '未完了のみ' },
        { value: 'all', label: '全て' },
        { value: 'overdue', label: '遅れているもの' },
        ...Object.entries(STATUS).map(([v, s]) => ({ value: v, label: s.label })),
      ], ui.status, { class: 'input', onchange: (e) => { ui.status = e.target.value; redraw(); } }),
      el('button', { class: 'btn primary', onclick: () => newTaskDialog({ project_id: ui.projectId || undefined }) }, '＋ タスク')),

    el('div', { class: 'card' },
      el('div', { class: 'card-h' },
        el('h2', {}, `${rows.length}件`),
        el('span', { class: 'grow' }),
        el('span', { class: 'note' }, `未完了の見積 合計 ${num(openHours)}時間`)),
      el('div', { class: 'tbl-wrap' },
        el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, COLUMNS.map(headCell))),
          el('tbody', {}, rows.length
            ? rows.map(bodyRow)
            : el('tr', {}, el('td', { colSpan: COLUMNS.length }, el('div', { class: 'empty' }, '条件に合うタスクはありません')))))),
    ),
  )));
}

function headCell(c) {
  const on = ui.sort === c.key;
  return el('th', {
    class: c.sortable ? 'sortable' : '',
    'aria-sort': on ? (ui.desc ? 'descending' : 'ascending') : 'none',
    onclick: c.sortable ? () => {
      if (ui.sort === c.key) ui.desc = !ui.desc;
      else { ui.sort = c.key; ui.desc = false; }
      document.dispatchEvent(new CustomEvent('mikata:redraw'));
    } : null,
  }, c.label, on ? (ui.desc ? ' ▾' : ' ▴') : '');
}

function bodyRow(t) {
  const pj = project(t.project_id);
  const who = member(t.assignee_id);
  const look = dueLook(t.due_date, store.metrics?.today || '', t.status === 'done');

  return el('tr', { onclick: () => openTask(t.id) },
    el('td', { class: 't' }, t.title),
    el('td', {}, pj ? `${pj.emoji} ${pj.name}` : '—'),
    el('td', {}, el('span', { class: `tag ${t.status}` }, STATUS[t.status].label)),
    el('td', {}, el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
      avatar(who, 'sm'), el('span', {}, who?.name || '—'))),
    el('td', {}, t.due_date
      ? el('span', { class: `tag ${look.cls}` }, look.text)
      : el('span', { class: 'muted' }, '—')),
    el('td', {}, t.priority === 'high'
      ? el('span', { class: 'tag high' }, '高')
      : el('span', { class: 'muted' }, PRIORITY[t.priority])),
    el('td', { class: 'num' }, t.estimate_h ? `${num(t.estimate_h)}h` : '—'),
    el('td', { class: 'num' }, t.target_value
      ? el('span', {}, `${num(t.actual_value)} / ${num(t.target_value)}${t.unit} `,
          el('span', { class: 'muted' }, pct(t.actual_value / t.target_value)))
      : el('span', { class: 'muted' }, '—')));
}

function filtered() {
  const q = ui.q.trim().toLowerCase();
  const today = store.metrics?.today || '';

  return store.tasks.filter((t) => {
    if (q && !t.title.toLowerCase().includes(q)) return false;
    if (ui.projectId && t.project_id !== ui.projectId) return false;

    if (ui.assigneeId === 'me' && t.assignee_id !== store.user.id) return false;
    if (ui.assigneeId === 'none' && t.assignee_id !== null) return false;
    if (!['all', 'me', 'none'].includes(ui.assigneeId) && t.assignee_id !== Number(ui.assigneeId)) return false;

    if (ui.status === 'open' && t.status === 'done') return false;
    if (ui.status === 'overdue' && !(t.status !== 'done' && t.due_date && t.due_date < today)) return false;
    if (!['all', 'open', 'overdue'].includes(ui.status) && t.status !== ui.status) return false;

    return true;
  });
}

function sorted(rows) {
  const order = { high: 0, mid: 1, low: 2 };
  const rank = { todo: 0, doing: 1, review: 2, done: 3 };

  const key = (t) => {
    switch (ui.sort) {
      case 'title':    return t.title;
      case 'project':  return project(t.project_id)?.name || '';
      case 'status':   return rank[t.status];
      case 'assignee': return member(t.assignee_id)?.name || '￿';
      case 'priority': return order[t.priority];
      case 'estimate': return t.estimate_h;
      case 'value':    return t.target_value ? t.actual_value / t.target_value : -1;
      default:         return t.due_date || '9999-12-31'; // 納期なしは最後
    }
  };

  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    const cmp = ka < kb ? -1 : ka > kb ? 1 : a.id - b.id;
    return ui.desc ? -cmp : cmp;
  });
}
