/* =========================================================
 *  ハグミン ツムツム  ―  エントリーポイント
 * =======================================================*/

(function () {

  var $ = function (id) { return document.getElementById(id); };

  function boot() {
    UI.cache();
    GameCore.init($('cv'), onGameEnd);
    UI.show('scr-title');
    bind();
  }

  function tap(id, fn, silent) {
    var node = $(id);
    node.addEventListener('click', function (e) {
      e.preventDefault();
      Sound.resume();
      if (!silent) Sound.ui();
      fn();
    });
  }

  function bind() {
    tap('btn-play', function () { startGame(Save.data.selected); });
    tap('btn-select', function () { UI.show('scr-select'); });
    tap('btn-help', function () { UI.show('scr-help'); });
    tap('btn-back-select', function () { UI.show('scr-title'); });
    tap('btn-back-help', function () { UI.show('scr-title'); });
    tap('btn-play2', function () { startGame(Save.data.selected); });

    tap('btn-pause', function () {
      if (GameCore.pause()) UI.show('scr-pause');
    });
    tap('btn-resume', function () {
      UI.hideAll();
      GameCore.resume();
    });
    tap('btn-quit', function () {
      GameCore.stop();
      UI.stopHud();
      UI.show('scr-title');
    });

    tap('btn-retry', function () { startGame(Save.data.selected); });
    tap('btn-home', function () { UI.show('scr-title'); });

    tap('btn-skill', function () {
      if (!GameCore.useSkill()) UI.toast('スキルゲージが まだです');
    }, true);

    tap('btn-bgm', function () {
      Save.data.bgm = !Save.data.bgm;
      Save.save();
      UI.refreshTitle();
      if (!Save.data.bgm) Sound.bgmStop();
    });
    tap('btn-se', function () {
      Save.data.se = !Save.data.se;
      Save.save();
      UI.refreshTitle();
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden && GameCore.isPlaying()) {
        if (GameCore.pause()) UI.show('scr-pause');
      }
    });

    // ダブルタップ拡大の抑止
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('dblclick', function (e) { e.preventDefault(); });
  }

  function startGame(charId) {
    if (!Save.owns(charId)) charId = 'moko';
    Save.data.selected = charId;
    Save.save();
    UI.hideAll();
    UI.startHud(charId);
    GameCore.resize();
    GameCore.start(charId);
  }

  function onGameEnd(result) {
    UI.showResult(result);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
