<?php
/** あそびかた */
declare(strict_types=1);

require __DIR__ . '/../src/App.php';
require __DIR__ . '/../src/layout.php';

use Doubutsu\App;

$app = App::boot();
$rules = $app->config['rules'];

layout_head('あそびかた ― どうぶつツムツム', 'page');
?>
<section class="screen show">
  <header class="sc-head">
    <a class="back" href="index.php">‹</a>
    <h2>あそびかた</h2>
    <div style="width:44px"></div>
  </header>
  <div class="help-body">
    <div class="help-item"><b>1. なぞってつなげる</b>
      <p>おなじキャラのツムを <b>3こ以上</b> なぞってはなすと消えます。となり同士のツムだけつながります。</p></div>
    <div class="help-item"><b>2. コンボをつなげる</b>
      <p>つづけて消すとコンボが増えて、スコアの倍率がアップ。<?= $rules['combo_hold'] ?>びょう いないに つぎを消そう！</p></div>
    <div class="help-item"><b>3. ボムをつくる</b>
      <p><b><?= (int)$rules['bomb_chain'] ?>こ以上</b>つなげるとボムが出現。タップすると まわりのツムをまとめて消します。<br>
      <b><?= (int)$rules['time_bomb_chain'] ?>こ以上</b>ならタイムボム！ こわすと 残り時間が +<?= (int)$rules['time_bomb_bonus'] ?>びょう。</p></div>
    <div class="help-item"><b>4. スキルをつかう</b>
      <p>えらんだキャラのツムを消すと、右下のスキルゲージがたまります。光ったらタップして発動！</p></div>
    <div class="help-item"><b>5. フィーバー</b>
      <p>ツムを消すと上のゲージがたまり、満タンで <b>FEVER</b>！ <?= (int)$rules['fever_time'] ?>びょうかん スコアが2ばいになります。</p></div>
    <div class="help-item"><b>6. コインでなかまを増やす</b>
      <p>プレイで手に入るコインで新しいキャラをおむかえできます。使うほどキャラがレベルアップし、スキルが強くなります。</p></div>
    <div class="help-item"><b>ひとこと</b>
      <p>ゲームのルール（物理・チェーン判定・スコア）は Python のエンジンが、画面とデータは PHP が動かしています。
      スコアはサーバーで計算しているので、ブラウザ側では書きかえられません。</p></div>
  </div>
</section>
<?php layout_foot();
