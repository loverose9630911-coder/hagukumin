/* キャラクター画面：おむかえ（購入）と選択 */
(function () {
  'use strict';

  var toastEl = document.getElementById('toast');
  var toastTimer = null;

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1600);
  }

  function call(body) {
    return fetch('api/player.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) { return res.json(); });
  }

  document.querySelectorAll('[data-buy]').forEach(function (button) {
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      button.disabled = true;
      call({ action: 'buy', char_id: button.dataset.buy }).then(function (res) {
        if (res.ok) {
          toast(res.message);
          setTimeout(function () { location.reload(); }, 700);
        } else {
          toast(res.error || 'おむかえできませんでした');
          button.disabled = false;
        }
      });
    });
  });

  document.querySelectorAll('.char-card').forEach(function (card) {
    card.addEventListener('click', function () {
      if (card.dataset.owned !== '1') {
        toast('コインで おむかえしよう');
        return;
      }
      call({ action: 'select', char_id: card.dataset.id }).then(function (res) {
        if (res.ok) location.reload();
        else toast(res.error || 'えらべませんでした');
      });
    });
  });
})();
