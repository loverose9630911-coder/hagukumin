// 入口の画面。はじめての人と、もう使っている人の両方をここで受ける。

import { el, btn, field, toast, mount } from '../ui.js';
import { api } from '../api.js';

export function loginView(root, onDone) {
  let mode = 'login';   // login | register

  const box = el('div', { class: 'gate' });
  root.replaceChildren(box);
  draw();

  function draw() {
    const isNew = mode === 'register';

    const form = el('form', {
      class: 'gate-form',
      onsubmit: async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.target).entries());
        const go = e.target.querySelector('button[type=submit]');
        go.disabled = true;
        go.textContent = '…';

        try {
          const res = isNew ? await api.register(data) : await api.login(data);
          onDone(res);
        } catch (err) {
          toast(err.message, 'error');
          go.disabled = false;
          go.textContent = isNew ? 'はじめる' : 'ログイン';
        }
      },
    },
      field('ログインID', el('input', {
        class: 'inp', name: 'login', required: true, autocomplete: 'username',
        placeholder: 'hanako', autofocus: true,
      })),

      isNew ? field('表示名', el('input', {
        class: 'inp', name: 'name', placeholder: '山田 はなこ', autocomplete: 'name',
      })) : null,

      field('パスワード', el('input', {
        class: 'inp', name: 'password', type: 'password', required: true,
        autocomplete: isNew ? 'new-password' : 'current-password',
        placeholder: isNew ? '6文字以上' : '',
      })),

      isNew ? field(
        'まねきコード（あれば）',
        el('input', { class: 'inp', name: 'join_code', placeholder: 'ABC123', maxlength: 6 }),
        '仲間から教わったコードを入れると、同じワークスペースに入れます。空のままなら自分のワークスペースを作ります。'
      ) : null,

      el('button', { type: 'submit', class: 'btn primary big' }, isNew ? 'はじめる' : 'ログイン'));

    mount(box,
      el('div', { class: 'gate-card' },
        el('div', { class: 'gate-brand' },
          el('img', { src: '/assets/icon.svg', width: 52, height: 52, alt: '' }),
          el('div', {},
            el('h1', {}, 'canter'),
            el('p', { class: 'muted' }, 'つくって、そのまま出す'))),

        form,

        el('div', { class: 'gate-switch' },
          el('span', { class: 'muted' }, isNew ? 'もうアカウントがある方は' : 'はじめての方は'),
          btn(isNew ? 'ログイン' : 'アカウントを作る', {
            class: 'btn link',
            onclick: () => { mode = isNew ? 'login' : 'register'; draw(); },
          })),

        el('p', { class: 'gate-demo muted' },
          'お試し: ', el('code', {}, 'demo'), ' / ', el('code', {}, 'demo1234'))));
  }
}
