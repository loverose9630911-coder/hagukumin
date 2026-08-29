// 「＋ タスク」の入力窓。ボードからもテーブルからも同じものを使う。

import { el, field, select, modal, toast, STATUS, PRIORITY } from '../ui.js';
import { store, activeProjects, createTask } from '../store.js';
import { openTask } from '../taskpanel.js';

export function newTaskDialog(preset = {}) {
  const projects = activeProjects();
  if (!projects.length) {
    toast('先にプロジェクトを1つ作ってください');
    return;
  }

  const title    = el('input', { class: 'input', placeholder: '例）提案書のたたき台を作成する', required: true });
  const projectS = select(projects.map((p) => ({ value: p.id, label: `${p.emoji} ${p.name}` })), preset.project_id ?? projects[0].id);
  const assignee = select(
    [{ value: '', label: '担当なし' }].concat(store.members.map((m) => ({ value: m.id, label: m.name }))),
    preset.assignee_id ?? store.user.id);
  const status   = select(Object.entries(STATUS).map(([v, s]) => ({ value: v, label: s.label })), preset.status ?? 'todo');
  const priority = select(Object.entries(PRIORITY).map(([v, l]) => ({ value: v, label: l })), 'mid');
  const due      = el('input', { class: 'input', type: 'date', value: preset.due_date ?? '' });
  const estimate = el('input', { class: 'input', type: 'number', min: 0, step: 0.5, value: 1 });
  const target   = el('input', { class: 'input', type: 'number', step: 'any', placeholder: '例）10' });
  const unit     = el('input', { class: 'input', placeholder: '例）件' });
  const goalS    = select(
    [{ value: '', label: '紐づけない' }].concat(store.goals.map((g) => ({
      value: g.id, label: `${g.scope === 'team' ? '【チーム】' : '【個人】'}${g.title}`,
    }))), preset.goal_id ?? '');

  const err = el('div', { class: 'err', hidden: true });
  const save = el('button', { class: 'btn primary' }, '作成');

  const body = el('form', { id: 'newtask-form', onsubmit: (e) => e.preventDefault() },
    err,
    field('タスク名', title),
    el('div', { class: 'row' }, field('プロジェクト', projectS), field('担当', assignee)),
    el('div', { class: 'row' }, field('ステータス', status), field('優先度', priority)),
    el('div', { class: 'row' }, field('納期', due), field('見積（時間）', estimate)),
    el('div', { class: 'row' }, field('目標値', target, '数字で追いたいときだけ'), field('単位', unit)),
    field('紐づける目標', goalS, '目標に紐づけると、その目標の達成率にこのタスクの実績が足されます。'));

  const close = modal({ title: '新しいタスク', body, actions: [save] });

  save.addEventListener('click', async () => {
    if (!title.value.trim()) {
      err.textContent = 'タスク名を入れてください';
      err.hidden = false;
      return;
    }
    save.disabled = true;
    try {
      const t = await createTask({
        title: title.value,
        project_id: Number(projectS.value),
        assignee_id: assignee.value === '' ? null : Number(assignee.value),
        status: status.value,
        priority: priority.value,
        due_date: due.value || null,
        estimate_h: Number(estimate.value || 0),
        target_value: target.value === '' ? null : Number(target.value),
        unit: unit.value,
        goal_id: goalS.value === '' ? null : Number(goalS.value),
      });
      close();
      toast('タスクを作成しました');
      openTask(t.id);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      save.disabled = false;
    }
  });

  title.focus();
}
