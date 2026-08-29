// ダッシュボード ― このアプリの中心。
//
// 画面を左右に割って、左に「自分」、右に「チーム」を同じ順番・同じものさしで並べる。
// 上の帯では、自分の数字がチームの平均と比べてどうかを1行で出している。
// 「自分は進んでいるつもりだが、チームでは遅いほうだった」に気づけるようにするため。

import { el, num, pct, avatar, dueLook, STATUS } from '../ui.js';
import { donut, sparkline, trendBars, gauge, loadBar } from '../charts.js';
import { store, member, project } from '../store.js';
import { openTask } from '../taskpanel.js';
import { goalEditor } from './goals.js';

export function dashboardView(root) {
  const m = store.metrics;
  if (!m) return root.replaceChildren(el('div', { class: 'empty' }, '集計中です…'));

  const me = m.me;
  const team = m.team;

  root.replaceChildren(el('div', { class: 'pad' }, el('div', { class: 'wrap' },
    compareStrip(me, team),
    el('div', { class: 'split', style: { marginTop: '18px' } },
      el('div', {},
        el('div', { class: 'col-head me' },
          el('span', { class: 'badge' }, '自分'),
          el('h2', {}, me ? me.name : '自分'),
          el('span', { class: 'note' }, '自分のタスクだけを見る')),
        el('div', { class: 'stack' }, meColumn(me, team))),
      el('div', {},
        el('div', { class: 'col-head team' },
          el('span', { class: 'badge' }, 'チーム'),
          el('h2', {}, team.name),
          el('span', { class: 'note' }, `${team.member_count}人 / ${team.total}タスク`)),
        el('div', { class: 'stack' }, teamColumn(team, m.today)))),
  )));
}

// ---- 上の帯：自分 vs チーム平均 ---------------------------------------

function compareStrip(me, team) {
  if (!me) return el('div');

  const others = team.members.filter((p) => p.user_id !== me.user_id);
  const avg = (pick) => {
    const vals = others.map(pick).filter((v) => v !== null && v !== undefined);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const rows = [
    {
      k: '残タスク',
      mine: me.open,
      team: avg((p) => p.open),
      fmt: (v) => `${num(v, 0)}件`,
      lowerIsBetter: true,
    },
    {
      k: '遅れているタスク',
      mine: me.due.overdue,
      team: avg((p) => p.due.overdue),
      fmt: (v) => `${num(v, 0)}件`,
      lowerIsBetter: true,
    },
    {
      k: '完了率',
      mine: me.done_rate,
      team: team.done_rate,
      fmt: (v) => pct(v),
      lowerIsBetter: false,
    },
    {
      k: '負荷（見積 ÷ 使える時間）',
      mine: me.load_rate,
      team: team.load.rate,
      fmt: (v) => pct(v),
      lowerIsBetter: true,
    },
  ];

  return el('div', { class: 'card' },
    el('div', { class: 'card-h' },
      el('h2', {}, '自分とチームを比較する'),
      el('span', { class: 'grow' }),
      el('span', { class: 'note' }, 'チーム側は自分以外の平均（完了率と負荷はチーム全体）')),
    el('div', { class: 'card-b' },
      el('div', { class: 'bars' }, rows.map((r) => compareRow(r)))));
}

function compareRow({ k, mine, team, fmt, lowerIsBetter }) {
  const has = mine !== null && mine !== undefined && team !== null && team !== undefined;
  const better = has && (lowerIsBetter ? mine <= team : mine >= team);
  const scale = Math.max(mine || 0, team || 0, 0.0001);

  const line = (label, v, color) => el('div', { class: 'bar-row' },
    el('div', { class: 'who' }, el('span', { class: 'muted' }, label)),
    el('div', { class: 'bar-track' },
      el('div', {
        class: 'bar-fill',
        style: { width: `${Math.min(100, ((v || 0) / scale) * 100)}%`, background: color },
      })),
    el('div', { class: 'bar-val num' }, v === null || v === undefined ? '—' : fmt(v)));

  return el('div', { style: { marginBottom: '10px' } },
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' } },
      el('b', { style: { fontSize: '12.5px' } }, k),
      has ? el('span', { class: `tag ${better ? 'ok' : 'soon'}` }, better ? 'チーム平均より良い' : 'チーム平均より重い') : null),
    line('自分', mine, 'var(--accent)'),
    line('チーム', team, '#0ea5e9'));
}

// ---- 左：自分 ---------------------------------------------------------

function meColumn(me, team) {
  if (!me) return el('div', { class: 'card' }, el('div', { class: 'empty' }, 'メンバー情報が読めませんでした'));

  const myTasks = store.tasks
    .filter((t) => t.assignee_id === me.user_id && t.status !== 'done')
    .sort(byDue);

  return [
    el('div', { class: 'card' },
      el('div', { class: 'kpis' },
        kpi('残り', me.open, '件'),
        kpi('遅れ', me.due.overdue, '件', me.due.overdue > 0 ? 'bad' : ''),
        kpi('今日まで', me.due.today + me.due.soon, '件', me.due.today + me.due.soon > 0 ? 'warn' : ''),
        kpi('完了率', me.done_rate === null ? '—' : pct(me.done_rate), '', 'good'))),

    card('自分の負荷', `見積 ${num(me.open_hours)}時間 ÷ 週 ${num(me.capacity_h)}時間`,
      el('div', {},
        el('div', { class: 'bar-row', style: { gridTemplateColumns: '1fr auto' } },
          loadBar(me.load_rate, me.color),
          el('div', { class: 'bar-val num' }, pct(me.load_rate))),
        el('p', { class: 'muted', style: { margin: '8px 0 0', fontSize: '12px' } },
          me.load_rate === null ? '「使える時間」が0のため計算できません。'
            : me.load_rate > 1 ? '1週間では終わらない量です。納期か担当を見直しましょう。'
            : me.load_rate > 0.8 ? 'ほぼ埋まっています。新しい仕事は要相談。'
            : '余裕があります。'))),

    card('直近7日の完了', `${me.done_7d}件`,
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '14px' } },
        sparkline(me.trend7, { w: 180, h: 40 }),
        el('div', {},
          el('div', { style: { fontSize: '20px', fontWeight: 700 } }, `${me.done_7d}件`),
          el('div', { class: 'muted', style: { fontSize: '11.5px' } },
            `チーム平均 ${num(avgOf(team.members, (p) => p.done_7d), 1)}件`)))),

    goalCard('自分の目標', me.goals.items, 'personal', me.user_id),

    card('自分のタスク（納期の近い順）', `${myTasks.length}件`,
      myTasks.length
        ? el('div', { class: 'list' }, myTasks.slice(0, 8).map((t) => taskRow(t)))
        : el('div', { class: 'empty' }, '残っているタスクはありません 🎉')),
  ];
}

// ---- 右：チーム ---------------------------------------------------------

function teamColumn(team, today) {
  const segs = Object.entries(STATUS).map(([k, v]) => ({ value: team.status[k] || 0, color: v.color, label: v.label }));

  return [
    el('div', { class: 'card' },
      el('div', { class: 'kpis' },
        kpi('残り', team.open, '件'),
        kpi('遅れ', team.due.overdue, '件', team.due.overdue > 0 ? 'bad' : ''),
        kpi('今日まで', team.due.today + team.due.soon, '件', team.due.today + team.due.soon > 0 ? 'warn' : ''),
        kpi('完了率', team.done_rate === null ? '—' : pct(team.done_rate), '', 'good'))),

    card('ステータスの内訳', `全${team.total}件`,
      el('div', { style: { display: 'flex', gap: '18px', alignItems: 'center', flexWrap: 'wrap' } },
        donut(segs, { center: String(team.open), caption: '残り' }),
        el('div', { style: { flex: '1', minWidth: '150px' } },
          el('div', { class: 'legend', style: { display: 'grid', gap: '6px' } },
            segs.map((s) => el('div', {},
              el('i', { style: { background: s.color } }),
              `${s.label} `,
              el('b', { class: 'num' }, `${s.value}件`)))),
          team.unassigned.count
            ? el('p', { style: { margin: '10px 0 0' } },
                el('span', { class: 'tag soon' }, `担当なし ${team.unassigned.count}件`))
            : null))),

    card('メンバー別の担当量', '棒は「見積 ÷ 使える時間」。線が100%',
      el('div', { class: 'bars' },
        team.members.map((p) => memberRow(p)),
        team.unassigned.count
          ? el('div', { class: 'bar-row' },
              el('div', { class: 'who' }, avatar(null, 'sm'), el('span', { class: 'muted' }, '担当なし')),
              el('div', { class: 'bar-track' }),
              el('div', { class: 'bar-val num muted' }, `${team.unassigned.count}件`))
          : null)),

    goalCard('チームの目標', team.goals.team, 'team', null),

    card('発生した仕事と完了した仕事', `直近${team.trend.length}日`,
      el('div', {},
        trendBars(team.trend),
        el('div', { class: 'legend', style: { marginTop: '8px' } },
          el('span', {}, el('i', { style: { background: 'var(--todo)', opacity: .55 } }), '発生'),
          el('span', {}, el('i', { style: { background: 'var(--done)' } }), '完了')))),

    card('納期が迫っているタスク', `${team.risks.length}件`,
      team.risks.length
        ? el('div', { class: 'list' }, team.risks.map((r) => riskRow(r, today)))
        : el('div', { class: 'empty' }, '3日以内に納期のタスクはありません')),

    card('プロジェクト別', `${team.projects.length}件`,
      el('div', { class: 'bars' }, team.projects.filter((p) => p.total > 0 || !p.archived).map(projectRow))),
  ];
}

// ---- 部品 ---------------------------------------------------------------

function card(title, note, body) {
  return el('div', { class: 'card' },
    el('div', { class: 'card-h' },
      el('h2', {}, title),
      el('span', { class: 'grow' }),
      note ? el('span', { class: 'note' }, note) : null),
    el('div', { class: 'card-b' }, body));
}

function kpi(k, v, unit, cls) {
  return el('div', { class: `kpi ${cls || ''}` },
    el('div', { class: 'v num' }, String(v), unit ? el('small', {}, unit) : null),
    el('div', { class: 'k' }, k));
}

function goalCard(title, goals, scope, ownerId) {
  return el('div', { class: 'card' },
    el('div', { class: 'card-h' },
      el('h2', {}, title),
      el('span', { class: 'grow' }),
      el('button', {
        class: 'btn sm ghost',
        onclick: () => goalEditor(null, { scope, owner_id: ownerId }),
      }, '＋ 目標')),
    el('div', { class: 'card-b' },
      goals.length
        ? el('div', { class: 'gauge-list' }, goals.map((g) => gauge({
            title: g.title,
            current: g.current_value,
            target: g.target_value,
            unit: g.unit,
            rate: g.rate,
            pace: g.pace,
            color: scope === 'team' ? '#0ea5e9' : 'var(--accent)',
            meta: g.rollup === 'manual' ? '手入力'
              : g.rollup === 'children' ? `${(g.contributors || []).length}人の個人目標を合計`
              : `タスク ${g.linked_done}/${g.linked_total} 完了`,
          })))
        : el('div', { class: 'empty' }, '目標がまだありません。「＋ 目標」から数字と期限を決めましょう。')));
}

function memberRow(p) {
  return el('div', { class: 'bar-row' },
    el('div', { class: 'who' },
      avatar({ name: p.name, color: p.color }, 'sm'),
      el('span', { title: p.name }, p.name)),
    el('div', {},
      loadBar(p.load_rate, p.color),
      el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '3px' } },
        `残り${p.open}件`,
        p.due.overdue ? el('span', { style: { color: 'var(--danger)', fontWeight: 700 } }, ` ・遅れ${p.due.overdue}件`) : '',
        ` ・${num(p.open_hours)}h / ${num(p.capacity_h)}h`)),
    el('div', { class: 'bar-val num' }, pct(p.load_rate)));
}

function projectRow(p) {
  return el('div', { class: 'bar-row' },
    el('div', { class: 'who' }, el('span', {}, `${p.emoji} ${p.name}`)),
    el('div', { class: 'bar-track' },
      el('div', { class: 'bar-fill', style: { width: `${(p.done_rate || 0) * 100}%`, background: p.color } })),
    el('div', { class: 'bar-val num' }, p.total ? pct(p.done_rate) : '—'));
}

function taskRow(t) {
  const look = dueLook(t.due_date, store.metrics.today, t.status === 'done');
  const pj = project(t.project_id);
  return el('button', { class: 'list-row', onclick: () => openTask(t.id) },
    el('span', { class: `tag ${t.status}` }, STATUS[t.status].label),
    el('span', { class: 't' }, t.title),
    pj ? el('span', { class: 'muted', style: { fontSize: '11.5px' } }, pj.emoji) : null,
    el('span', { class: `tag ${look.cls}` }, look.text));
}

function riskRow(r, today) {
  const who = member(r.assignee_id);
  const look = dueLook(r.due_date, today);
  return el('button', { class: 'list-row', onclick: () => openTask(r.id) },
    avatar(who, 'sm'),
    el('span', { class: 't' }, r.title),
    r.priority === 'high' ? el('span', { class: 'tag high' }, '優先度 高') : null,
    el('span', { class: `tag ${look.cls}` }, look.text));
}

const byDue = (a, b) => {
  if (!a.due_date && !b.due_date) return a.id - b.id;
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : a.id - b.id;
};

function avgOf(list, pick) {
  const vals = list.map(pick).filter((v) => v !== null && v !== undefined);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
