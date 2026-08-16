<?php
/** タイトル画面 */
declare(strict_types=1);

require __DIR__ . '/../src/App.php';
require __DIR__ . '/../src/layout.php';

use Hagukumin\App;

$app = App::boot();
$p = $app->player;
$selected = $app->character($app->selectedId());
$engineUp = $app->engine->isUp();

layout_head('ハグミン ツムツム', 'page');
?>
<section class="screen show center">
  <div class="title-deco">
    <?php foreach (array_slice($app->characters(), 0, 4) as $i => $c): ?>
      <span class="bob" style="animation-delay:<?= $i * 0.18 ?>s"><?= tsum_img($c, 74) ?></span>
    <?php endforeach; ?>
  </div>

  <h1 class="logo"><span>ハグミン</span><em>ツムツム</em></h1>
  <p class="tagline">つないで、はじけて、なかよくなろう！</p>

  <div class="stat-row">
    <div><b><?= App::num((int)$p['high_score']) ?></b><span>ハイスコア</span></div>
    <div><b><?= App::num((int)$p['coins']) ?></b><span>コイン</span></div>
    <div><b><?= App::num((int)$p['plays']) ?></b><span>プレイ</span></div>
  </div>

  <div class="picked">
    <?= tsum_img($selected, 58) ?>
    <div>
      <b><?= App::esc($selected['name']) ?></b>
      <small>Lv.<?= $app->levelOf($selected['id']) + 1 ?> ／ <?= App::esc($selected['skill']['name']) ?></small>
    </div>
  </div>

  <?php if (!$engineUp): ?>
    <p class="warn">ゲームエンジン（Python）が動いていません。<br><code>bin/serve</code> で起動してください。</p>
  <?php endif; ?>

  <div class="btn-col">
    <a class="btn primary<?= $engineUp ? '' : ' disabled' ?>" href="play.php">ゲームスタート</a>
    <a class="btn" href="characters.php">キャラクター</a>
    <a class="btn" href="ranking.php">ランキング</a>
    <a class="btn ghost" href="help.php">あそびかた</a>
  </div>

  <form class="name-form" id="name-form">
    <label>なまえ</label>
    <input type="text" id="name-input" maxlength="12" value="<?= App::esc($p['name']) ?>">
    <button type="submit">かえる</button>
  </form>
</section>
<script>
document.getElementById('name-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('name-input').value;
  await fetch('api/player.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'rename', name })
  });
  location.reload();
});
</script>
<?php layout_foot();
