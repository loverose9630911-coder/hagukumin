/* =========================================================
 *  ぞうさんとなかまたち ― 静的 PWA 版の画面まわり
 *
 *  サーバー版では PHP が出していた画面（タイトル・キャラ選択・
 *  ランキング・あそびかた）を、こちらでは JavaScript が作る。
 *  セーブは localStorage（Store）。
 * =======================================================*/

(function () {
  'use strict';

  var CFG = window.CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  var SCREENS = ['scr-title', 'scr-chars', 'scr-help', 'scr-rank', 'scr-result'];
  var toastTimer = null;

  LocalEngine.init(CFG);

  /* ---------------------------------------------------------- 部品 */

  function num(n) { return Number(n || 0).toLocaleString('ja-JP'); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function tsumImg(charId, height) {
    var img = new Image();
    img.src = 'assets/img/tsum_' + charId + '.png';
    img.alt = '';
    img.style.height = height + 'px';
    img.style.display = 'block';
    return img;
  }

  function show(id) {
    SCREENS.forEach(function (s) {
      var el = $(s);
      if (el) el.classList.toggle('show', s === id);
    });
    if (id === 'scr-title') renderTitle();
    if (id === 'scr-chars') renderCharacters();
    if (id === 'scr-rank') renderRanking();
  }

  function hideAll() {
    SCREENS.forEach(function (s) {
      var el = $(s);
      if (el) el.classList.remove('show');
    });
  }

  function toast(message) {
    var el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1600);
  }

  function character(id) {
    for (var i = 0; i < CFG.characters.length; i++) {
      if (CFG.characters[i].id === id) return CFG.characters[i];
    }
    return CFG.characters[0];
  }

  /* ---------------------------------------------------------- タイトル */

  function renderTitle() {
    var d = Store.data();
    $('t-high').textContent = num(d.high_score);
    $('t-coin').textContent = num(d.coins);
    $('t-plays').textContent = num(d.plays);
    $('name-input').value = d.name;

    var deco = $('title-deco');
    if (!deco.childElementCount) {
      CFG.characters.slice(0, 4).forEach(function (c, i) {
        var span = document.createElement('span');
        span.className = 'bob';
        span.style.animationDelay = (i * 0.18) + 's';
        span.appendChild(tsumImg(c.id, 74));
        deco.appendChild(span);
      });
    }

    var c = character(d.selected);
    var picked = $('picked');
    picked.innerHTML = '';
    picked.appendChild(tsumImg(c.id, 58));
    var box = document.createElement('div');
    box.innerHTML = '<b>' + esc(c.name) + '</b><small>Lv.'
      + (Store.level(c.id) + 1) + ' ／ ' + esc(c.skill.name) + '</small>';
    picked.appendChild(box);
  }

  /* ---------------------------------------------------------- キャラクター */

  function renderCharacters() {
    var d = Store.data();
    $('s-coin').textContent = num(d.coins);
    var list = $('char-list');
    list.innerHTML = '';

    CFG.characters.forEach(function (c) {
      var owned = Store.owns(c.id);
      var card = document.createElement('div');
      card.className = 'char-card' + (d.selected === c.id ? ' sel' : '') + (owned ? '' : ' lock');
      card.appendChild(tsumImg(c.id, 78));

      var progress = Store.progress(c.id);
      var body = document.createElement('div');
      body.className = 'cc-body';
      body.innerHTML =
        '<div class="cc-name">' + esc(c.name)
        + (owned ? '<span class="cc-lv">Lv.' + (Store.level(c.id) + 1) + '</span>' : '')
        + '</div>'
        + '<div class="cc-tag">' + esc(c.tagline) + '</div>'
        + '<div class="cc-skill">' + esc(c.skill.name) + '</div>'
        + '<div class="cc-desc">' + esc(c.skill.desc) + '</div>'
        + (owned && progress
          ? '<div class="cc-exp"><i style="width:'
            + Math.round(progress.cur / progress.need * 100) + '%"></i></div>'
          : (owned ? '<div class="cc-desc max">スキル さいだいレベル！</div>' : ''));
      card.appendChild(body);

      var side = document.createElement('div');
      side.className = 'cc-side';
      if (owned) {
        side.innerHTML = d.selected === c.id
          ? '<div class="cc-using">つかって<br>います</div>'
          : '<div class="cc-desc">えらぶ</div>';
      } else {
        var buy = document.createElement('button');
        buy.className = 'buy';
        buy.textContent = num(c.price) + ' コイン';
        buy.disabled = d.coins < c.price;
        buy.addEventListener('click', function (event) {
          event.stopPropagation();
          var res = Store.buy(c.id);
          if (res.ok) { Sound.ui(); toast(res.message); renderCharacters(); }
          else { Sound.ng(); toast(res.error); }
        });
        side.appendChild(buy);
      }
      card.appendChild(side);

      card.addEventListener('click', function () {
        if (!owned) { Sound.ng(); toast('コインで おむかえしよう'); return; }
        Sound.ui();
        Store.select(c.id);
        renderCharacters();
      });
      list.appendChild(card);
    });
  }

  /* ---------------------------------------------------------- ランキング */

  function renderRanking() {
    var rows = Store.ranking();
    var wrap = $('rank-body');
    if (!rows.length) {
      wrap.innerHTML = '<p class="empty">まだ きろくが ありません。<br>さいしょの 1 かいを どうぞ！</p>';
      return;
    }
    wrap.innerHTML = '';
    var ol = document.createElement('ol');
    ol.className = 'rank-list';
    rows.forEach(function (row, i) {
      var li = document.createElement('li');
      li.className = 'rank-item' + (i < 3 ? ' top' : '');
      li.innerHTML = '<span class="rank-no">' + (i + 1) + '</span>';
      li.appendChild(tsumImg(row.char_id, 46));
      var rest = document.createElement('span');
      rest.style.display = 'contents';
      rest.innerHTML = '<span class="rank-name">' + esc(row.name) + '</span>'
        + '<span class="rank-combo">' + row.max_combo + ' combo</span>'
        + '<b class="rank-score">' + num(row.score) + '</b>';
      li.appendChild(rest);
      ol.appendChild(li);
    });
    wrap.appendChild(ol);
  }

  /* ---------------------------------------------------------- ゲーム開始 */

  function startGame() {
    var c = character(Store.data().selected);
    var icon = $('hud-skill-icon');
    icon.innerHTML = '';
    icon.appendChild(tsumImg(c.id, 84));
    $('hud-skill-text').textContent = c.skill.name;
    $('btn-skill').classList.add('locked');
    $('btn-skill').classList.remove('ready');

    hideAll();
    Sound.resume();
    window.__game.startGame();
  }

  /* ---------------------------------------------------------- 配線 */

  function tap(id, fn) {
    var el = $(id);
    if (!el) return;
    el.addEventListener('click', function (event) {
      event.preventDefault();
      Sound.resume();
      Sound.ui();
      fn();
    });
  }

  function bind() {
    tap('btn-play', startGame);
    tap('btn-play2', startGame);
    tap('btn-retry', startGame);
    tap('btn-chars', function () { show('scr-chars'); });
    tap('btn-rank', function () { show('scr-rank'); });
    tap('btn-help', function () { show('scr-help'); });
    tap('btn-home', function () { show('scr-title'); });
    tap('btn-quit', function () {
      // 途中でやめたら、時間切れの結果画面が出ないように止める
      window.__game.state.phase = 'over';
      Sound.bgmStop();
      show('scr-title');
    });
    ['btn-back-chars', 'btn-back-help', 'btn-back-rank'].forEach(function (id) {
      tap(id, function () { show('scr-title'); });
    });

    $('name-form').addEventListener('submit', function (event) {
      event.preventDefault();
      Store.rename($('name-input').value);
      renderTitle();
      toast('なまえを かえました');
      $('name-input').blur();
    });
  }

  bind();
  show('scr-title');

  // タイトルを出したあと、うしろで最初の山を作っておく（スタートで待たせない）
  setTimeout(function () {
    var rect = document.getElementById('cv').getBoundingClientRect();
    var f = CFG.field;
    var h = rect.width ? f.w * rect.height / rect.width : 1080;
    LocalEngine.prewarm(h);
  }, 60);
})();
