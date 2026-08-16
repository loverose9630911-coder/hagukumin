<?php
/** ゲーム画面（描画と入力だけ。ルールはすべて Python エンジン側） */
declare(strict_types=1);

require __DIR__ . '/../src/App.php';
require __DIR__ . '/../src/layout.php';

use Zousan\App;

$app = App::boot();
$selected = $app->character($app->selectedId());
$sprites = json_decode((string)file_get_contents(__DIR__ . '/assets/sprites.json'), true);

$boot = [
    'characters' => $app->characters(),
    'field' => $app->config['field'],
    'rules' => $app->config['rules'],
    'sprites' => $sprites,
    'selected' => $selected['id'],
];

layout_head('プレイ中 ― ぞうさんと仲間たち', 'playing');
?>
<canvas id="cv"></canvas>

<div id="hud">
  <div class="hud-top">
    <div class="hud-left">
      <div class="score-label">SCORE</div>
      <div class="score-value" id="hud-score">0</div>
      <div class="combo" id="hud-combo">
        <span class="combo-num" id="hud-combo-num">0</span><span class="combo-txt">Combo</span>
      </div>
    </div>
    <div class="hud-right">
      <div class="hud-buttons">
        <button class="icon-btn" id="btn-sound" aria-label="音のオンオフ">♪</button>
        <a class="icon-btn" href="index.php" aria-label="やめる">×</a>
      </div>
      <div class="timer" id="hud-timer">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle class="t-bg" cx="50" cy="50" r="42"></circle>
          <circle class="t-fg" id="hud-timer-arc" cx="50" cy="50" r="42"></circle>
        </svg>
        <span id="hud-time">60</span>
      </div>
    </div>
  </div>

  <div class="fever-wrap">
    <div class="fever-label">FEVER</div>
    <div class="fever-bar"><i id="hud-fever-bar"></i></div>
  </div>

  <button class="skill-btn locked" id="btn-skill">
    <span class="skill-ring"><svg viewBox="0 0 100 100" aria-hidden="true">
      <circle class="s-bg" cx="50" cy="50" r="44"></circle>
      <circle class="s-fg" id="hud-skill-arc" cx="50" cy="50" r="44"></circle>
    </svg></span>
    <span class="skill-icon"><?= tsum_img($selected, 84) ?></span>
    <span class="skill-text"><?= App::esc($selected['skill']['name']) ?></span>
  </button>
</div>

<section class="screen dim" id="scr-result">
  <div class="panel result">
    <div class="res-badge" id="res-badge">RESULT</div>
    <div class="res-score" id="res-score">0</div>
    <div class="res-char" id="res-char"></div>
    <ul class="res-list">
      <li><span>最大コンボ</span><b id="res-combo">0</b></li>
      <li><span>消したツム</span><b id="res-tsum">0</b></li>
      <li><span>フィーバー</span><b id="res-fever">0</b></li>
      <li><span>スキル発動</span><b id="res-skill">0</b></li>
      <li><span>ランキング</span><b id="res-rank">-</b></li>
      <li class="coin"><span>もらえるコイン</span><b id="res-coin">0</b></li>
    </ul>
    <div class="res-level" id="res-level"></div>
    <div class="btn-col">
      <a class="btn primary" href="play.php">もういちど</a>
      <a class="btn ghost" href="index.php">ホームへ</a>
    </div>
  </div>
</section>

<div id="toast"></div>

<script>window.BOOT = <?= json_encode($boot, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG) ?>;</script>
<script src="assets/js/audio.js"></script>
<script src="assets/js/client.js"></script>
<?php layout_foot();
