// タスクの詳細（右からスライドして出るパネル）。
//
// 左半分が Notion 的な「プロパティ」、下半分が Slack 的な「スレッド」。
// プロパティを変えると、その内容が自動でスレッドに1行流れる（サーバー側で記録している）ので、
// 「変更した → 報告する」の二度手間がなくなる。

import { el, field, select, avatar, toast, when, STATUS, PRIORITY, num } from './ui.js';
import { api } from './api.js';
import { store, member, project, activeProjects, updateTask, deleteTask } from './store.js';

let closeCurrent = null;
let shownId = null;

/** 画面のどこからでも呼ぶ入口。URL を変えるだけで、実際に開くのはルーター。 */
export function openTask(taskId) {
  const target = `#/task/${taskId}`;
  if (location.hash === target) showTask(taskId);
  else location.hash = target;
}

/**
 * ルーターから呼ばれて、実際にパネルを組み立てる。
 * 既に同じタスクを開いていれば何もしない（描きなおしのちらつき防止）。
 */
export function showTask(taskId) {
  if (shownId === taskId && closeCurrent) return;
  closeTask();
  shownId = taskId;

  const scrim = el('div', { class: 'scrim', onclick: () => close(false) });
  const panel = el('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'タスクの詳細' });
  const onKey = (e) => { if (e.key === 'Escape' && !e.target.closest('textarea')) close(false); };

  /** @param {boolean} silent true なら URL を触らない（ルーター都合の片づけ） */
  function close(silent = true) {
    scrim.remove();
    panel.remove();
    document.removeEventListener('keydown', onKey);
    closeCurrent = null;
    shownId = null;
    if (!silent && location.hash.startsWith('#/task/')) history.back();
  }
  closeCurrent = close;

  document.body.append(scrim, panel);
  document.addEventListener('keydown', onKey);

  render(panel, taskId, () => close(false));
}

/** ルーターが別の画面へ移るときに呼ぶ（URL には触らない）。 */
export function closeTask() {
  closeCurrent?.(true);
}

function render(panel, taskId, close) {
  const t = store.tasks.find((x) => x.id === taskId);
  if (!t) {
    panel.replaceChildren(
      el('div', { class: 'panel-h' }, el('span', { class: 'grow' }), el('button', { class: 'btn ghost sm', onclick: close }, '✕')),
      el('div', { class: 'empty' }, 'このタスクは見つかりませんでした'));
    return;
  }

  const save = async (patch) => {
    try {
      await updateTask(t.id, patch);
      render(panel, taskId, close);
    } catch (e) {
      toast(e.message);
    }
  };

  const title = el('input', {
    class: 'title-in', value: t.title, 'aria-label': 'タスク名',
    onchange: (e) => { if (e.target.value.trim() && e.target.value !== t.title) save({ title: e.target.value }); },
  });

  const body = el('textarea', {
    class: 'input', rows: 4, placeholder: 'メモ・手順・決まったこと…', value: t.body,
    onchange: (e) => { if (e.target.value !== t.body) save({ body: e.target.value }); },
  });

  panel.replaceChildren(
    el('div', { class: 'panel-h' },
      el('span', { class: `tag ${t.status}` }, STATUS[t.status].label),
      el('span', { class: 'muted', style: { fontSize: '12px' } }, `#${t.id}`),
      el('span', { class: 'grow' }),
      el('button', {
        class: 'btn ghost sm danger',
        onclick: async () => {
          if (!confirm(`「${t.title}」を消します。よろしいですか？`)) return;
          await deleteTask(t.id);
          toast('タスクを消しました');
          close();
        },
      }, '削除'),
      el('button', { class: 'btn ghost sm', onclick: close, 'aria-label': '閉じる' }, '✕')),

    el('div', { class: 'panel-b' },
      title,
      el('div', { class: 'props', style: { marginTop: '12px' } }, props(t, save)),
      el('h3', {}, 'メモ'),
      body,
      el('h3', {}, 'スレッド'),
      thread(t)),
  );
}

function props(t, save) {
  const on = (key, cast = (v) => v) => (e) => save({ [key]: cast(e.target.value) });

  const goalOptions = [{ value: '', label: '紐づけない' }].concat(
    store.goals.map((g) => ({
      value: g.id,
      label: `${g.scope === 'team' ? '【チーム】' : '【個人】'}${g.title}`,
    })));

  return [
    el('div', { class: 'k' }, 'ステータス'),
    select(Object.entries(STATUS).map(([v, s]) => ({ value: v, label: s.label })), t.status, { onchange: on('status') }),

    el('div', { class: 'k' }, '担当'),
    el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
      avatar(member(t.assignee_id), 'sm'),
      select(
        [{ value: '', label: '担当なし' }].concat(store.members.map((m) => ({ value: m.id, label: m.name }))),
        t.assignee_id ?? '',
        { onchange: on('assignee_id', (v) => (v === '' ? null : Number(v))) })),

    el('div', { class: 'k' }, '納期'),
    el('input', { class: 'input', type: 'date', value: t.due_date || '', onchange: on('due_date', (v) => v || null) }),

    el('div', { class: 'k' }, '優先度'),
    select(Object.entries(PRIORITY).map(([v, l]) => ({ value: v, label: l })), t.priority, { onchange: on('priority') }),

    el('div', { class: 'k' }, '見積'),
    el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
      el('input', {
        class: 'input', type: 'number', min: 0, step: 0.5, value: t.estimate_h,
        style: { width: '90px' }, onchange: on('estimate_h', Number),
      }),
      el('span', { class: 'muted' }, '時間')),

    el('div', { class: 'k' }, 'プロジェクト'),
    select(activeProjects().map((p) => ({ value: p.id, label: `${p.emoji} ${p.name}` })), t.project_id,
      { onchange: on('project_id', Number) }),

    el('div', { class: 'k' }, '目標'),
    select(goalOptions, t.goal_id ?? '', { onchange: on('goal_id', (v) => (v === '' ? null : Number(v))) }),

    el('div', { class: 'k' }, '目標値'),
    el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
      el('input', {
        class: 'input', type: 'number', step: 'any', placeholder: '—',
        value: t.target_value ?? '', style: { width: '90px' },
        onchange: on('target_value', (v) => (v === '' ? null : Number(v))),
      }),
      el('span', { class: 'muted' }, '→'),
      el('input', {
        class: 'input', type: 'number', step: 'any', value: t.actual_value,
        style: { width: '90px' }, title: '実績値', onchange: on('actual_value', Number),
      }),
      el('input', {
        class: 'input', placeholder: '単位', value: t.unit, style: { width: '64px' },
        onchange: on('unit'),
      })),

    el('div', { class: 'k' }, '進み'),
    el('div', {},
      t.target_value
        ? el('span', {},
            el('b', { class: 'num' }, `${num(t.actual_value)} / ${num(t.target_value)}${t.unit}`),
            el('span', { class: 'muted' }, `（${Math.round((t.actual_value / t.target_value) * 100)}%）`))
        : el('span', { class: 'muted' }, '目標値を入れると達成率が出ます')),
  ];
}

function thread(t) {
  const list = el('div', { style: { display: 'grid', gap: '2px', margin: '4px 0 12px' } },
    el('div', { class: 'empty' }, '読み込み中…'));

  const input = el('textarea', {
    class: 'input', rows: 2, placeholder: 'このタスクについて書く…（Enterで送信）',
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    },
  });

  const draw = (messages) => {
    list.replaceChildren(...(messages.length
      ? messages.map((msg, i) => messageRow(msg, messages[i - 1]))
      : [el('div', { class: 'empty' }, 'まだ書き込みはありません')]));
  };

  const load = async () => {
    try {
      const { messages } = await api.thread(store.teamId, t.id);
      draw(messages);
    } catch (e) {
      list.replaceChildren(el('div', { class: 'empty' }, e.message));
    }
  };

  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      await api.post(store.teamId, { task_id: t.id, body: text });
      await load();
      list.lastElementChild?.scrollIntoView({ block: 'nearest' });
    } catch (e) {
      toast(e.message);
    }
  };

  load();

  return el('div', {},
    list,
    el('div', { class: 'box', style: { border: '1px solid var(--line)', borderRadius: '10px', padding: '8px 10px' } },
      input,
      el('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '6px' } },
        el('button', { class: 'btn primary sm', onclick: send }, '送信'))));
}

function messageRow(msg, prev) {
  const who = member(msg.user_id);
  const same = prev && prev.user_id === msg.user_id && prev.kind === msg.kind;

  return el('div', { class: `msg${msg.kind === 'system' ? ' sys' : ''}${same ? ' same' : ''}` },
    avatar(who, 'sm'),
    el('div', {},
      !same ? el('div', { class: 'who' },
        el('b', {}, who?.name || '不明'),
        el('time', {}, when(msg.created_at))) : null,
      el('div', { class: 'body' },
        msg.kind === 'system' ? `${msg.body}` : msg.body)));
}
