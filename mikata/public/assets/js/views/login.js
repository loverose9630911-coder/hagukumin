// ログイン画面。初めての人はここでチームを作るか、参加コードで入る。

import { el, field, toast } from '../ui.js';
import { api } from '../api.js';

export function loginView(root, onDone) {
  let mode = 'login';

  const render = () => {
    const err = el('div', { class: 'err', hidden: true });
    const show = (msg) => { err.textContent = msg; err.hidden = false; };

    const form = mode === 'login' ? loginForm(err, show, onDone) : signupForm(err, show, onDone);

    root.replaceChildren(el('div', { class: 'gate' },
      el('div', { class: 'gate-card' },
        el('div', { class: 'gate-brand' },
          el('img', { class: 'mark', src: '/assets/icon.svg', width: 60, height: 60, alt: '' }),
          el('h1', {}, 'ミカタ'),
          el('p', {}, 'チームと個人のタスクを、1枚で見えるようにする')),

        el('div', { class: 'card' },
          el('div', { class: 'card-b' },
            el('div', { class: 'tabs', role: 'tablist' },
              el('button', {
                class: mode === 'login' ? 'on' : '', role: 'tab',
                'aria-selected': String(mode === 'login'),
                onclick: () => { mode = 'login'; render(); },
              }, 'ログイン'),
              el('button', {
                class: mode === 'signup' ? 'on' : '', role: 'tab',
                'aria-selected': String(mode === 'signup'),
                onclick: () => { mode = 'signup'; render(); },
              }, '新規登録')),
            err,
            form))),
    ));
  };

  render();
}

function loginForm(err, show, onDone) {
  const login = el('input', { class: 'input', autocomplete: 'username', required: true });
  const pass  = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
  const go    = el('button', { class: 'btn primary', type: 'submit', style: { width: '100%' } }, 'ログイン');

  return el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      go.disabled = true;
      try {
        const res = await api.login({ login: login.value, password: pass.value });
        onDone(res);
      } catch (ex) {
        show(ex.message);
        go.disabled = false;
      }
    },
  },
    field('ログインID', login),
    field('パスワード', pass),
    go);
}

function signupForm(err, show, onDone) {
  const name  = el('input', { class: 'input', placeholder: '山田 花子', required: true });
  const login = el('input', { class: 'input', placeholder: 'hanako', autocomplete: 'username', required: true });
  const pass  = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, minLength: 6 });
  const team  = el('input', { class: 'input', placeholder: '営業チーム' });
  const code  = el('input', { class: 'input', placeholder: 'ABC123', style: { textTransform: 'uppercase' } });
  const go    = el('button', { class: 'btn primary', type: 'submit', style: { width: '100%' } }, '登録して開始');

  const teamBox = field('チーム名', team, '後から変更できます。');
  const codeBox = field('参加コード', code, '既にチームがある人から受け取ってください。');
  codeBox.hidden = true;

  const choose = (which) => {
    teamBox.hidden = which !== 'new';
    codeBox.hidden = which === 'new';
    team.required = which === 'new';
    code.required = which !== 'new';
  };

  const radios = el('div', { class: 'row', style: { marginBottom: '12px' } },
    radio('team-kind', 'new', 'チームを新しく作る', true, () => choose('new')),
    radio('team-kind', 'join', 'コードでチームに入る', false, () => choose('join')));

  return el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      go.disabled = true;
      try {
        const joining = !codeBox.hidden;
        const res = await api.register({
          login: login.value,
          name: name.value,
          password: pass.value,
          team_name: joining ? '' : team.value,
          join_code: joining ? code.value : '',
        });
        toast('ようこそ！');
        onDone(res);
      } catch (ex) {
        show(ex.message);
        go.disabled = false;
      }
    },
  },
    field('表示名', name),
    field('ログインID', login, '半角の英数字。ログインとメンション（@）に使います。'),
    field('パスワード', pass, '6文字以上。'),
    radios,
    teamBox,
    codeBox,
    go);
}

function radio(name, value, label, checked, onpick) {
  return el('label', {
    style: {
      display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer',
      border: '1px solid var(--line)', borderRadius: '8px', padding: '8px 10px', fontSize: '12.5px',
    },
  },
    el('input', { type: 'radio', name, value, checked, onchange: onpick }),
    label);
}
