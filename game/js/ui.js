/* =========================================================
 *  ハグミン ツムツム  ―  画面まわり
 * =======================================================*/

var UI = (function () {

  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  var TIMER_C = 2 * Math.PI * 42;
  var SKILL_C = 2 * Math.PI * 44;
  var toastTimer = null;
  var lastSkillReady = false;

  function cache() {
    ['hud', 'hud-score', 'hud-combo', 'hud-combo-num', 'hud-combo-bar', 'hud-time',
      'hud-timer', 'hud-timer-arc', 'hud-fever-bar', 'hud-skill-arc', 'hud-skill-icon',
      'hud-skill-text', 'btn-skill', 'toast', 'char-list', 't-high', 't-coin', 't-plays',
      's-coin', 'title-deco', 'res-score', 'res-combo', 'res-tsum', 'res-fever',
      'res-skill', 'res-coin', 'res-badge', 'res-level', 'res-char', 'btn-bgm', 'btn-se'
    ].forEach(function (id) { el[id] = $(id); });
  }

  /* ---------- 共通 ---------- */

  /** キャラアイコンの canvas 要素を作る（h ＝ 表示したい高さ px） */
  function iconEl(charId, h) {
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var src = Sprites.icon(charId, Math.round(h * dpr));
    var c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    c.style.display = 'block';
    c.style.height = h + 'px';
    c.style.width = (h * src.width / src.height).toFixed(1) + 'px';
    return c;
  }

  function show(id) {
    ['scr-title', 'scr-select', 'scr-help', 'scr-pause', 'scr-result'].forEach(function (s) {
      $(s).classList.toggle('show', s === id);
    });
    if (id === 'scr-title') refreshTitle();
    if (id === 'scr-select') buildCharList();
  }

  function hideAll() {
    ['scr-title', 'scr-select', 'scr-help', 'scr-pause', 'scr-result'].forEach(function (s) {
      $(s).classList.remove('show');
    });
  }

  function toast(msg) {
    el['toast'].textContent = msg;
    el['toast'].classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el['toast'].classList.remove('show'); }, 1600);
  }

  function num(n) { return n.toLocaleString('ja-JP'); }

  /* ---------- タイトル ---------- */

  function refreshTitle() {
    var d = Save.data;
    el['t-high'].textContent = num(d.highScore);
    el['t-coin'].textContent = num(d.coins);
    el['t-plays'].textContent = num(d.plays);
    el['btn-bgm'].textContent = 'BGM: ' + (d.bgm ? 'ON' : 'OFF');
    el['btn-bgm'].classList.toggle('off', !d.bgm);
    el['btn-se'].textContent = 'SE: ' + (d.se ? 'ON' : 'OFF');
    el['btn-se'].classList.toggle('off', !d.se);

    if (!el['title-deco'].childElementCount) {
      var picks = [Save.data.selected, 'rubi', 'sora', 'pomu'];
      var used = {};
      picks.forEach(function (id) {
        if (used[id] || !CHAR_BY_ID[id]) return;
        used[id] = 1;
        el['title-deco'].appendChild(iconEl(id, 80));
      });
    }
  }

  /* ---------- キャラ選択 ---------- */

  function buildCharList() {
    var d = Save.data;
    el['s-coin'].textContent = num(d.coins);
    var list = el['char-list'];
    list.innerHTML = '';

    CHARACTERS.forEach(function (c) {
      var owned = Save.owns(c.id);
      var lv = Save.level(c.id);
      var card = document.createElement('div');
      card.className = 'char-card' + (d.selected === c.id ? ' sel' : '') + (owned ? '' : ' lock');

      card.appendChild(iconEl(c.id, 76));

      var body = document.createElement('div');
      body.className = 'cc-body';
      var next = charExpToNext(d.exp[c.id] || 0);
      body.innerHTML =
        '<div class="cc-name">' + c.name +
        (owned ? '<span class="cc-lv">Lv.' + (lv + 1) + '</span>' : '') + '</div>' +
        '<div class="cc-skill">' + c.skill.name + '</div>' +
        '<div class="cc-desc">' + c.skill.desc + '</div>' +
        (owned && next
          ? '<div class="cc-exp"><i style="width:' + Math.round(next.cur / next.need * 100) + '%"></i></div>'
          : (owned ? '<div class="cc-desc" style="color:#D9930F">スキル最大レベル！</div>' : ''));
      card.appendChild(body);

      var side = document.createElement('div');
      side.className = 'cc-side';
      if (owned) {
        side.innerHTML = d.selected === c.id
          ? '<div class="cc-using">つかって<br>います</div>'
          : '<div class="cc-desc">えらぶ</div>';
      } else {
        var b = document.createElement('button');
        b.className = 'buy';
        b.textContent = num(c.price) + ' コイン';
        b.disabled = d.coins < c.price;
        b.addEventListener('click', function (ev) {
          ev.stopPropagation();
          if (Save.buy(c.id)) {
            Sound.skill();
            toast(c.name + 'を おむかえしました！');
            d.selected = c.id;
            Save.save();
            buildCharList();
          } else {
            Sound.ng();
            toast('コインが たりません');
          }
        });
        side.appendChild(b);
      }
      card.appendChild(side);

      card.addEventListener('click', function () {
        if (!Save.owns(c.id)) { Sound.ng(); toast('コインで おむかえしよう'); return; }
        Sound.ui();
        d.selected = c.id;
        Save.save();
        buildCharList();
      });

      list.appendChild(card);
    });
  }

  /* ---------- HUD ---------- */

  function startHud(charId) {
    el['hud'].classList.remove('hidden');
    el['hud'].classList.remove('fever');
    var ch = CHAR_BY_ID[charId];
    el['hud-skill-icon'].innerHTML = '';
    el['hud-skill-icon'].appendChild(iconEl(charId, 86));
    el['hud-skill-text'].textContent = ch.skill.name;
    el['btn-skill'].classList.add('locked');
    el['btn-skill'].classList.remove('ready');
    lastSkillReady = false;
    syncHud({ score: 0, time: 60, combo: 0, comboRatio: 0, skillRatio: 0, skillReady: false, feverRatio: 0, fever: false });
  }

  function stopHud() { el['hud'].classList.add('hidden'); }

  function syncHud(h) {
    el['hud-score'].textContent = num(h.score);
    var t = Math.ceil(h.time);
    el['hud-time'].textContent = t;
    el['hud-timer'].classList.toggle('warn', h.time <= 10);
    el['hud-timer-arc'].style.strokeDashoffset = TIMER_C * (1 - Math.max(0, Math.min(1, h.time / 60)));

    el['hud-combo'].classList.toggle('on', h.combo > 0);
    el['hud-combo-num'].textContent = h.combo;
    el['hud-combo-bar'].style.transform = 'scaleX(' + h.comboRatio.toFixed(3) + ')';

    el['hud-fever-bar'].style.width = Math.max(0, Math.min(1, h.feverRatio)) * 100 + '%';
    el['hud'].classList.toggle('fever', !!h.fever);

    el['hud-skill-arc'].style.strokeDashoffset = SKILL_C * (1 - Math.max(0, Math.min(1, h.skillRatio)));
    if (h.skillReady !== lastSkillReady) {
      lastSkillReady = h.skillReady;
      el['btn-skill'].classList.toggle('ready', h.skillReady);
      el['btn-skill'].classList.toggle('locked', !h.skillReady);
    }
  }

  function onSkillReady() { toast('スキル じゅんび かんりょう！'); }

  function onFever(on) { if (on) toast('FEVER TIME！ スコア2ばい'); }

  /* ---------- リザルト ---------- */

  function showResult(r) {
    stopHud();
    el['res-score'].textContent = num(r.score);
    el['res-combo'].textContent = num(r.maxCombo);
    el['res-tsum'].textContent = num(r.tsumCleared);
    el['res-fever'].textContent = r.feverCount + ' かい';
    el['res-skill'].textContent = r.skillUsed + ' かい';
    el['res-coin'].textContent = '+' + num(r.coins);
    el['res-badge'].textContent = r.newHigh ? 'NEW RECORD!' : 'RESULT';
    el['res-badge'].classList.toggle('high', !!r.newHigh);

    var ch = CHAR_BY_ID[r.charId];
    el['res-char'].innerHTML = '';
    el['res-char'].appendChild(iconEl(r.charId, 54));
    var nm = document.createElement('span');
    nm.textContent = ch.name + '  Lv.' + (Save.level(r.charId) + 1);
    el['res-char'].appendChild(nm);

    el['res-level'].textContent = r.levelUp > 0
      ? '★ ' + ch.name + 'が Lv.' + (r.levelUp + 1) + ' に なった！ スキルが つよくなったよ'
      : '';

    show('scr-result');
  }

  return {
    cache: cache, show: show, hideAll: hideAll, toast: toast,
    startHud: startHud, stopHud: stopHud, syncHud: syncHud,
    onSkillReady: onSkillReady, onFever: onFever,
    showResult: showResult, refreshTitle: refreshTitle, buildCharList: buildCharList,
    iconEl: iconEl
  };
})();
