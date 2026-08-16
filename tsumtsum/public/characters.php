<?php
/** キャラクターの選択とおむかえ（購入） */
declare(strict_types=1);

require __DIR__ . '/../src/App.php';
require __DIR__ . '/../src/layout.php';

use Hagukumin\App;

$app = App::boot();
$owned = $app->store->ownedIds((int)$app->player['id']);
$selected = $app->selectedId();

layout_head('キャラクター ― ハグミン ツムツム', 'page');
?>
<section class="screen show">
  <header class="sc-head">
    <a class="back" href="index.php">‹</a>
    <h2>キャラクター</h2>
    <div class="coin-pill"><i></i><span id="coins"><?= App::num((int)$app->player['coins']) ?></span></div>
  </header>

  <div class="char-list">
    <?php foreach ($app->characters() as $c):
      $has = in_array($c['id'], $owned, true);
      $lv = $app->levelOf($c['id']);
      $prog = $app->expProgress($c['id']);
      ?>
      <div class="char-card<?= $selected === $c['id'] ? ' sel' : '' ?><?= $has ? '' : ' lock' ?>"
           data-id="<?= App::esc($c['id']) ?>" data-owned="<?= $has ? 1 : 0 ?>">
        <?= tsum_img($c, 78) ?>
        <div class="cc-body">
          <div class="cc-name"><?= App::esc($c['name']) ?>
            <?php if ($has): ?><span class="cc-lv">Lv.<?= $lv + 1 ?></span><?php endif; ?>
          </div>
          <div class="cc-tag"><?= App::esc($c['tagline']) ?></div>
          <div class="cc-skill"><?= App::esc($c['skill']['name']) ?></div>
          <div class="cc-desc"><?= App::esc($c['skill']['desc']) ?></div>
          <?php if ($has && $prog): ?>
            <div class="cc-exp"><i style="width:<?= (int)round($prog['cur'] / $prog['need'] * 100) ?>%"></i></div>
          <?php elseif ($has): ?>
            <div class="cc-desc max">スキル最大レベル！</div>
          <?php endif; ?>
        </div>
        <div class="cc-side">
          <?php if ($has): ?>
            <?php if ($selected === $c['id']): ?>
              <div class="cc-using">つかって<br>います</div>
            <?php else: ?>
              <div class="cc-desc">えらぶ</div>
            <?php endif; ?>
          <?php else: ?>
            <button class="buy" data-buy="<?= App::esc($c['id']) ?>"
              <?= (int)$app->player['coins'] < (int)$c['price'] ? 'disabled' : '' ?>>
              <?= App::num((int)$c['price']) ?> コイン
            </button>
          <?php endif; ?>
        </div>
      </div>
    <?php endforeach; ?>
  </div>

  <div class="sc-foot">
    <a class="btn primary" href="play.php">このキャラであそぶ</a>
  </div>
  <div id="toast"></div>
</section>
<script src="assets/js/characters.js"></script>
<?php layout_foot();
