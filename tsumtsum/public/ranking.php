<?php
/** ランキング */
declare(strict_types=1);

require __DIR__ . '/../src/App.php';
require __DIR__ . '/../src/layout.php';

use Doubutsu\App;

$app = App::boot();
$rows = $app->store->ranking(20);

layout_head('ランキング ― どうぶつツムツム', 'page');
?>
<section class="screen show">
  <header class="sc-head">
    <a class="back" href="index.php">‹</a>
    <h2>ランキング</h2>
    <div style="width:44px"></div>
  </header>

  <?php if (!$rows): ?>
    <p class="empty">まだ記録がありません。<br>さいしょの 1 プレイを どうぞ！</p>
  <?php else: ?>
    <ol class="rank-list">
      <?php foreach ($rows as $i => $row):
        $c = $app->character($row['char_id']); ?>
        <li class="rank-item<?= $i < 3 ? ' top' : '' ?>">
          <span class="rank-no"><?= $i + 1 ?></span>
          <?= $c ? tsum_img($c, 46) : '' ?>
          <span class="rank-name"><?= App::esc($row['name']) ?></span>
          <span class="rank-combo"><?= (int)$row['max_combo'] ?> combo</span>
          <b class="rank-score"><?= App::num((int)$row['score']) ?></b>
        </li>
      <?php endforeach; ?>
    </ol>
  <?php endif; ?>

  <div class="sc-foot">
    <a class="btn primary" href="play.php">あそぶ</a>
  </div>
</section>
<?php layout_foot();
