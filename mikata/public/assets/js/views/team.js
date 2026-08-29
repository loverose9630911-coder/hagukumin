// チームの設定。
//
// ・参加コード（この文字列を渡せばメンバーが参加できる）
// ・メンバーごとの「1週間に使える時間」← 負荷グラフの分母になる大事な数字
// ・プロジェクト（＝チャンネル）の名前・色・アーカイブ

import { el, field, avatar, toast, num, pct, modal } from '../ui.js';
import { loadBar } from '../charts.js';
import { store, updateMember, updateProject, createProject } from '../store.js';

export function teamView(root) {
  const me = store.members.find((m) => m.id === store.user.id);
  const iAmOwner = me?.role === 'owner';
  const people = store.metrics?.team.members || [];

  root.replaceChildren(el('div', { class: 'pad' }, el('div', { class: 'wrap', style: { maxWidth: '860px' } },
    el('div', { class: 'stack' },

      card('チームに人を招待する', null,
        el('div', {},
          el('p', { style: { margin: '0 0 10px' } }, 'この参加コードを伝えると、その人はこのチームに入れます。'),
          el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
            el('code', {
              style: {
                fontSize: '26px', letterSpacing: '.16em', fontWeight: 700,
                background: 'var(--line-soft)', padding: '8px 16px', borderRadius: '10px',
              },
            }, store.team.join_code),
            el('button', {
              class: 'btn',
              onclick: async () => {
                try {
                  await navigator.clipboard.writeText(store.team.join_code);
                  toast('参加コードをコピーしました');
                } catch {
                  toast('コピーできませんでした。手で控えてください');
                }
              },
            }, 'コピー')),
          el('p', { class: 'muted', style: { margin: '10px 0 0', fontSize: '12px' } },
            'ログイン画面の「新規登録」→「コードでチームに入る」で使います。'))),

      card('メンバー', `${store.members.length}人`,
        el('div', { class: 'bars' }, store.members.map((m) => memberRow(m, people, iAmOwner)))),

      card('プロジェクト（チャンネル）', null,
        el('div', {},
          el('div', { class: 'list' }, store.projects.map(projectRow)),
          el('div', { style: { marginTop: '12px' } },
            el('button', { class: 'btn', onclick: projectDialog }, '＋ プロジェクトを作成')))),
    ),
  )));
}

function card(title, note, body) {
  return el('div', { class: 'card' },
    el('div', { class: 'card-h' },
      el('h2', {}, title),
      el('span', { class: 'grow' }),
      note ? el('span', { class: 'note' }, note) : null),
    el('div', { class: 'card-b' }, body));
}

function memberRow(m, people, iAmOwner) {
  const stat = people.find((p) => p.user_id === m.id);
  const canEdit = iAmOwner || m.id === store.user.id;

  const cap = el('input', {
    class: 'input', type: 'number', min: 0, max: 168, step: 1, value: m.capacity_h,
    style: { width: '78px' }, disabled: !canEdit,
    title: '1週間にこのチームの仕事に使える時間',
    onchange: async (e) => {
      try {
        await updateMember(m.id, { capacity_h: Number(e.target.value) });
        toast('使える時間を更新しました');
      } catch (ex) {
        toast(ex.message);
        e.target.value = m.capacity_h;
      }
    },
  });

  return el('div', {
    style: {
      display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px 12px',
      alignItems: 'center', paddingBottom: '12px', borderBottom: '1px solid var(--line-soft)',
    },
  },
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 } },
      avatar(m, 'lg'),
      el('div', { style: { minWidth: 0 } },
        el('b', {}, m.name),
        m.role === 'owner' ? el('span', { class: 'tag', style: { marginLeft: '6px' } }, 'オーナー') : null,
        el('div', { class: 'muted', style: { fontSize: '11.5px' } }, `@${m.login}`))),

    el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
      el('span', { class: 'muted', style: { fontSize: '12px' } }, '週'),
      cap,
      el('span', { class: 'muted', style: { fontSize: '12px' } }, '時間')),

    stat
      ? el('div', { style: { gridColumn: '1 / -1' } },
          loadBar(stat.load_rate, m.color),
          el('div', { class: 'muted', style: { fontSize: '11.5px', marginTop: '4px' } },
            `残り${stat.open}件 / 見積${num(stat.open_hours)}時間 → 負荷 ${pct(stat.load_rate)}`,
            stat.due.overdue ? el('span', { style: { color: 'var(--danger)', fontWeight: 700 } }, ` ・遅れ${stat.due.overdue}件`) : ''))
      : null);
}

function projectRow(p) {
  return el('div', { class: 'list-row', style: { cursor: 'default' } },
    el('span', {}, p.emoji),
    el('span', { class: 't' }, p.name, p.archived ? el('span', { class: 'tag', style: { marginLeft: '8px' } }, 'アーカイブ') : null),
    el('button', { class: 'btn ghost sm', onclick: () => projectDialog(p) }, '編集'));
}

function projectDialog(p) {
  const project = p && p.id ? p : null;

  const name  = el('input', { class: 'input', value: project?.name || '', placeholder: '例）新規開拓', required: true });
  const emoji = el('input', { class: 'input', value: project?.emoji || '📁', maxLength: 2, style: { width: '70px' } });
  const color = el('input', { class: 'input', type: 'color', value: project?.color || '#6366f1', style: { width: '70px', padding: '2px' } });
  const arch  = el('input', { type: 'checkbox', checked: !!project?.archived });

  const err = el('div', { class: 'err', hidden: true });
  const save = el('button', { class: 'btn primary' }, project ? '保存' : '作成');

  const close = modal({
    title: project ? 'プロジェクトを編集' : '新しいプロジェクト',
    body: el('div', {},
      err,
      field('名前', name, 'チャンネル名にもなります。'),
      el('div', { class: 'row' }, field('アイコン', emoji), field('色', color)),
      project
        ? el('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px' } },
            arch, 'アーカイブする（一覧から隠す。タスクは消えません）')
        : null),
    actions: [save],
  });

  save.addEventListener('click', async () => {
    if (!name.value.trim()) {
      err.textContent = '名前を入れてください';
      err.hidden = false;
      return;
    }
    save.disabled = true;
    try {
      const input = { name: name.value, emoji: emoji.value, color: color.value };
      if (project) {
        await updateProject(project.id, { ...input, archived: arch.checked });
      } else {
        await createProject(input);
      }
      close();
      toast(project ? '保存しました' : 'プロジェクトを作成しました');
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      save.disabled = false;
    }
  });
}
