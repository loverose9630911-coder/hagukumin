// チャンネル（Slack にあたる部分）。
//
// ふつうの会話と、タスクのスレッドでの発言が同じ流れに並ぶ。
// タスク由来の発言には小さな見出しが付いていて、押すとそのタスクが開く。
// 「どのタスクの話をしているのか」が迷子にならないようにするため。

import { el, avatar, when, dayLabel, toast, STATUS } from '../ui.js';
import { api } from '../api.js';
import { store, member, project, markRead, subscribe } from '../store.js';
import { openTask } from '../taskpanel.js';
import { newTaskDialog } from './newtask.js';

export function channelView(root, projectId) {
  const pj = project(projectId);
  if (!pj) return root.replaceChildren(el('div', { class: 'empty' }, 'チャンネルが見つかりません'));

  const scroll = el('div', { class: 'chat-scroll' }, el('div', { class: 'empty' }, '読み込み中…'));
  const input = el('textarea', {
    rows: 1, placeholder: `#${pj.name} に書く…（Enterで送信 / Shift+Enterで改行）`,
    'aria-label': 'メッセージ',
    oninput: (e) => {
      e.target.style.height = 'auto';
      e.target.style.height = `${Math.min(180, e.target.scrollHeight)}px`;
    },
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    },
  });

  let messages = [];

  const draw = () => {
    const stick = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
    scroll.replaceChildren(...(messages.length
      ? withDays(messages)
      : [el('div', { class: 'empty' }, 'まだ会話がありません。最初の一言をどうぞ。')]));
    if (stick) scroll.scrollTop = scroll.scrollHeight;
  };

  const load = async () => {
    try {
      const res = await api.channel(store.teamId, projectId);
      messages = res.messages;
      draw();
      scroll.scrollTop = scroll.scrollHeight;
      markRead(projectId);
    } catch (e) {
      scroll.replaceChildren(el('div', { class: 'empty' }, e.message));
    }
  };

  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    try {
      const { message } = await api.post(store.teamId, { project_id: projectId, body: text });
      messages.push(message);
      store.latestId = Math.max(store.latestId, message.id);
      draw();
      scroll.scrollTop = scroll.scrollHeight;
    } catch (e) {
      toast(e.message);
      input.value = text;
    }
  };

  // 新着が届いたら、このチャンネルのぶんだけ足す。
  const off = subscribe((what) => {
    if (what !== 'sync') return;
    const known = new Set(messages.map((m) => m.id));
    const add = (store._incoming || []).filter((m) => m.project_id === projectId && !known.has(m.id));
    if (add.length) {
      messages.push(...add);
      draw();
      markRead(projectId);
    }
  });
  root.addEventListener('mikata:leave', off, { once: true });

  root.replaceChildren(el('div', { class: 'chat' },
    scroll,
    el('div', { class: 'composer' },
      el('div', { class: 'box' },
        input,
        el('div', { class: 'tools' },
          el('span', { class: 'grow' }, `@${store.members.map((m) => m.login).slice(0, 4).join(' @')} で呼びかけられます`),
          el('button', {
            class: 'btn sm', onclick: () => newTaskDialog({ project_id: projectId }),
          }, '＋ タスクにする'),
          el('button', { class: 'btn primary sm', onclick: send }, '送信'))))));

  load();
}

function withDays(messages) {
  const out = [];
  let day = null;
  const today = store.metrics?.today || new Date().toISOString().slice(0, 10);

  messages.forEach((msg, i) => {
    const d = msg.created_at.slice(0, 10);
    if (d !== day) {
      out.push(el('div', { class: 'day-sep' }, dayLabel(d, today)));
      day = d;
      out.push(row(msg, null));
    } else {
      out.push(row(msg, messages[i - 1]));
    }
  });

  return out;
}

function row(msg, prev) {
  const who = member(msg.user_id);
  const task = msg.task_id ? store.tasks.find((t) => t.id === msg.task_id) : null;
  // 同じ人が続けて書いたときは名前を繰り返さない（Slack と同じ見え方）。
  const same = prev && prev.user_id === msg.user_id && prev.kind === msg.kind && !msg.task_id && !prev.task_id;

  return el('div', { class: `msg${msg.kind === 'system' ? ' sys' : ''}${same ? ' same' : ''}` },
    avatar(who),
    el('div', {},
      task
        ? el('button', { class: 'ref', onclick: () => openTask(task.id) },
            el('span', {}, `↳ ${task.title}`),
            el('span', { class: `tag ${task.status}`, style: { fontSize: '10px' } }, STATUS[task.status].label))
        : null,
      !same ? el('div', { class: 'who' },
        el('b', {}, who?.name || '不明'),
        el('time', { dateTime: msg.created_at }, when(msg.created_at))) : null,
      el('div', { class: 'body' }, mentions(msg.body))));
}

/** 本文の中の @login を目立たせる。テキストとして入れるので HTML は動かない。 */
function mentions(body) {
  const logins = new Set(store.members.map((m) => m.login));
  const parts = body.split(/(@[A-Za-z0-9_.-]+)/g);

  return parts.map((p) =>
    p.startsWith('@') && logins.has(p.slice(1))
      ? el('span', { class: 'mention' }, p)
      : p);
}
