// 目標（目標値と期限）。
//
// チームの目標と個人の目標を同じ形のゲージで並べる。
// ゲージの上の細い縦線は「期限までの日数から見て、いま何％まで進んでいるべきか」。
// 塗りがその線より右にあれば予定より早い、左なら遅れている。

import { el, field, select, modal, toast, num, pct, avatar, ROLLUP } from '../ui.js';
import { gauge } from '../charts.js';
import { store, member, saveGoal, removeGoal } from '../store.js';
import { openTask } from '../taskpanel.js';
import { newTaskDialog } from './newtask.js';

export function goalsView(root) {
  const teamGoals = store.goals.filter((g) => g.scope === 'team');
  const personal  = store.goals.filter((g) => g.scope === 'personal');

  const byOwner = new Map();
  for (const g of personal) {
    const k = g.owner_id ?? 0;
    if (!byOwner.has(k)) byOwner.set(k, []);
    byOwner.get(k).push(g);
  }

  root.replaceChildren(el('div', { class: 'pad' }, el('div', { class: 'wrap' },
    el('div', { class: 'col-head team' },
      el('span', { class: 'badge' }, 'チーム'),
      el('h2', {}, 'チームの目標'),
      el('span', { class: 'note' },
        el('button', { class: 'btn sm', onclick: () => goalEditor(null, { scope: 'team' }) }, '＋ チーム目標'))),

    teamGoals.length
      ? el('div', { class: 'stack' }, teamGoals.map((g) => goalCard(g, '#0ea5e9')))
      : el('div', { class: 'card' }, el('div', { class: 'empty' },
          'チームの目標がまだありません。「今期 受注 500万円」のように、数字と期限を決めて置いてみましょう。')),

    el('div', { class: 'col-head me', style: { marginTop: '26px' } },
      el('span', { class: 'badge' }, '個人'),
      el('h2', {}, '個人の目標'),
      el('span', { class: 'note' },
        el('button', {
          class: 'btn sm',
          onclick: () => goalEditor(null, { scope: 'personal', owner_id: store.user.id }),
        }, '＋ 個人目標'))),

    byOwner.size
      ? el('div', { class: 'stack' }, [...byOwner.entries()].map(([ownerId, goals]) => {
          const who = member(ownerId);
          return el('div', {},
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '0 2px 8px' } },
              avatar(who, 'sm'),
              el('b', {}, who?.name || '担当なし'),
              el('span', { class: 'muted', style: { fontSize: '12px' } },
                `平均 ${pct(goals.reduce((s, g) => s + g.rate, 0) / goals.length)}`)),
            el('div', { class: 'stack' }, goals.map((g) => goalCard(g, 'var(--accent)'))));
        }))
      : el('div', { class: 'card' }, el('div', { class: 'empty' },
          '個人の目標がまだありません。自分の数字を置くと、ダッシュボードの左がわに出ます。')),
  )));
}

function goalCard(g, color) {
  const linked = store.tasks.filter((t) => t.goal_id === g.id);
  const who = g.owner_id ? member(g.owner_id) : null;

  return el('div', { class: 'card' },
    el('div', { class: 'card-h' },
      who ? avatar(who, 'sm') : null,
      el('h2', {}, g.title),
      el('span', { class: 'grow' }),
      el('span', { class: 'note' }, ROLLUP[g.rollup]),
      el('button', { class: 'btn ghost sm', onclick: () => goalEditor(g) }, '編集')),

    el('div', { class: 'card-b' },
      gauge({
        title: g.due_date ? `期限 ${g.due_date}` : '期限なし',
        current: g.current_value,
        target: g.target_value,
        unit: g.unit,
        rate: g.rate,
        pace: g.pace,
        color,
      }),

      g.rollup === 'manual'
        ? manualInput(g)
        : g.rollup === 'children'
        ? contributors(g)
        : el('div', { style: { marginTop: '14px' } },
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' } },
              el('b', { style: { fontSize: '12px' } }, `紐づいたタスク ${linked.length}件`),
              el('span', { class: 'grow', style: { flex: 1 } }),
              el('button', {
                class: 'btn sm ghost',
                onclick: () => newTaskDialog({ goal_id: g.id, assignee_id: g.owner_id ?? undefined }),
              }, '＋ このタスク')),
            linked.length
              ? el('div', { class: 'list' }, linked.map((t) => el('button', {
                  class: 'list-row', onclick: () => openTask(t.id),
                },
                  el('span', { class: `tag ${t.status}` }, t.status === 'done' ? '完了' : '未'),
                  el('span', { class: 't' }, t.title),
                  el('span', { class: 'num muted', style: { fontSize: '12px' } },
                    g.rollup === 'done_count'
                      ? (t.status === 'done' ? '+1' : '—')
                      : `${num(t.actual_value)}${g.unit}`))))
              : el('div', { class: 'empty', style: { fontSize: '12.5px' } },
                  'タスクを紐づけると、その実績がここに足されていきます。'))));
}

/**
 * 「個人目標の合計」で進めるチーム目標の内訳。
 * 誰がどれだけ積んだのかを、同じ物差しの棒で並べる。
 */
function contributors(g) {
  const kids = g.contributors || [];
  if (!kids.length) {
    return el('div', { class: 'empty', style: { fontSize: '12.5px', marginTop: '10px' } },
      'この目標に紐づいた個人目標がまだありません。個人目標を作成するときに「紐づけ先」でこの目標を選択してください。');
  }

  const scale = Math.max(...kids.map((k) => k.target_value), 1);

  return el('div', { style: { marginTop: '14px' } },
    el('b', { style: { fontSize: '12px' } }, `誰の積み上げか（${kids.length}人）`),
    el('div', { class: 'bars', style: { marginTop: '8px' } }, kids.map((k) => {
      const who = member(k.owner_id);
      const rate = k.target_value > 0 ? k.current_value / k.target_value : 0;
      return el('div', { class: 'bar-row' },
        el('div', { class: 'who' }, avatar(who, 'sm'), el('span', {}, who?.name || '—')),
        el('div', { class: 'bar-track', title: `目標 ${num(k.target_value)}${g.unit}` },
          // 棒の長さは「いちばん大きい目標値」を基準にそろえる（人ごとの目標の差も見えるように）
          el('div', {
            class: 'bar-fill',
            style: {
              width: `${Math.min(100, (k.target_value / scale) * 100)}%`,
              background: 'var(--line)',
              position: 'absolute', left: 0, top: 0, bottom: 0,
            },
          }),
          el('div', {
            class: 'bar-fill',
            style: {
              width: `${Math.min(100, (k.current_value / scale) * 100)}%`,
              background: who?.color || 'var(--accent)', position: 'relative',
            },
          })),
        el('div', { class: 'bar-val num' }, `${num(k.current_value)} / ${num(k.target_value)}`,
          el('div', { class: 'muted', style: { fontSize: '10.5px', fontWeight: 400 } }, pct(rate))));
    })));
}

function manualInput(g) {
  const box = el('input', {
    class: 'input', type: 'number', step: 'any', value: g.manual_value, style: { width: '120px' },
  });
  return el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '14px' } },
    el('span', { class: 'muted', style: { fontSize: '12px' } }, '現在の実績'),
    box,
    el('span', { class: 'muted' }, g.unit),
    el('button', {
      class: 'btn sm',
      onclick: async () => {
        try {
          await saveGoal(g.id, { manual_value: Number(box.value || 0) });
          toast('実績を更新しました');
        } catch (e) {
          toast(e.message);
        }
      },
    }, '更新'));
}

/** 目標をつくる・なおす窓。ダッシュボードからも呼ばれる。 */
export function goalEditor(goal, preset = {}) {
  const scope = goal?.scope ?? preset.scope ?? 'team';

  const title  = el('input', { class: 'input', value: goal?.title || '', placeholder: '例）今期の受注金額', required: true });
  const scopeS = select([
    { value: 'team', label: 'チームの目標' },
    { value: 'personal', label: '個人の目標' },
  ], scope);
  const ownerS = select(store.members.map((m) => ({ value: m.id, label: m.name })),
    goal?.owner_id ?? preset.owner_id ?? store.user.id);
  const target = el('input', { class: 'input', type: 'number', step: 'any', min: 0, value: goal?.target_value ?? '' , required: true });
  const unit   = el('input', { class: 'input', value: goal?.unit || '件', placeholder: '件 / 円 / 社' });
  const due    = el('input', { class: 'input', type: 'date', value: goal?.due_date || '' });
  const rollup = select(Object.entries(ROLLUP).map(([v, l]) => ({ value: v, label: l })), goal?.rollup || 'tasks');

  // 紐づけ先にできるのは「親を持っていないチーム目標」だけ（親子は1段まで）。
  const parents = store.goals.filter((g) => g.scope === 'team' && !g.parent_id && g.id !== goal?.id);
  const parentS = select(
    [{ value: '', label: '紐づけない' }].concat(parents.map((g) => ({ value: g.id, label: g.title }))),
    goal?.parent_id ?? preset.parent_id ?? '');

  const ownerBox  = field('誰の目標', ownerS);
  const parentBox = field('チーム目標に紐づける', parentS,
    '紐づけると、その個人目標の実績がチーム目標の合計に加算されます。');

  const syncOwner = () => {
    const personal = scopeS.value === 'personal';
    ownerBox.hidden = !personal;
    parentBox.hidden = !personal || parents.length === 0;
  };
  scopeS.addEventListener('change', syncOwner);
  syncOwner();

  const err = el('div', { class: 'err', hidden: true });
  const save = el('button', { class: 'btn primary' }, goal ? '保存' : '作成');

  const actions = [save];
  if (goal) {
    actions.unshift(el('button', {
      class: 'btn danger',
      onclick: async () => {
        if (!confirm(`目標「${goal.title}」を消します。よろしいですか？`)) return;
        await removeGoal(goal.id);
        close();
        toast('目標を消しました');
      },
    }, '削除'));
  }

  const close = modal({
    title: goal ? '目標を編集' : '新しい目標',
    body: el('div', {},
      err,
      field('目標の名前', title),
      el('div', { class: 'row' }, field('誰の目標か', scopeS), ownerBox),
      el('div', { class: 'row' }, field('目標値', target), field('単位', unit)),
      parentBox,
      field('期限', due, '期限を入れると「予定より早い/遅い」が出ます。'),
      field('実績の数えかた', rollup,
        'タスクの実績値を合計＝金額など。完了したタスクの数＝件数。手で入力＝外部の数字。')),
    actions,
  });

  save.addEventListener('click', async () => {
    if (!title.value.trim()) {
      err.textContent = '目標の名前を入れてください';
      err.hidden = false;
      return;
    }
    save.disabled = true;
    try {
      await saveGoal(goal?.id ?? null, {
        title: title.value,
        scope: scopeS.value,
        owner_id: scopeS.value === 'personal' ? Number(ownerS.value) : null,
        target_value: Number(target.value || 0),
        unit: unit.value,
        due_date: due.value || null,
        rollup: rollup.value,
        parent_id: scopeS.value === 'personal' && parentS.value !== '' ? Number(parentS.value) : null,
      });
      close();
      toast(goal ? '目標を保存しました' : '目標を作成しました');
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      save.disabled = false;
    }
  });
}
