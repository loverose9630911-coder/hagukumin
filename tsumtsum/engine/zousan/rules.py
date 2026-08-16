"""スコア・コイン・レベルの計算式.

ゲームのバランスに関わる数値はすべてここに集める。
PHP 側はこの計算をやり直さず、エンジンが出した結果をそのまま保存する
（サーバー権威なので、クライアントからスコアを送りつけても効かない）。
"""

from __future__ import annotations

PLAY_TIME = 60.0            # 1 プレイの秒数
MAX_TIME = 80.0             # 時間ボーナスを足しても超えない上限
COMBO_HOLD = 2.2            # コンボが途切れるまでの秒数
COMBO_CAP = 50              # 倍率に効くコンボの上限

FEVER_NEED = 55             # フィーバーに必要なユニット数
FEVER_TIME = 10.0           # フィーバーの持続秒数
FEVER_TIME_BONUS = 2.0      # フィーバー突入時の時間ボーナス
FEVER_MULTIPLIER = 2.0

TIME_BOMB_BONUS = 5.0       # タイムボムをこわしたときの時間ボーナス

BASE_SCORE = 100            # ツム 1 個ぶんの素点


def chain_score(units: int, combo: int, fever: bool) -> int:
    """1 回の消去で入るスコア。

    units は「大ツム＝3 個ぶん」で数えたツム数。
    """
    base = units * BASE_SCORE
    chain_bonus = 1.0 + max(0, units - 3) * 0.08
    combo_bonus = 1.0 + min(combo, COMBO_CAP) * 0.02
    fever_bonus = FEVER_MULTIPLIER if fever else 1.0
    return int(round(base * chain_bonus * combo_bonus * fever_bonus))


COIN_PER_SCORE = 120        # このスコアごとに 1 コイン
COIN_PER_COMBO = 2          # 最大コンボ 1 につきもらえるコイン
EXP_PER_OWN = 6             # 自分のツム 1 個ぶんの経験値
EXP_PER_SCORE = 400         # このスコアごとに 1 経験値


def coins_earned(score: int, max_combo: int) -> int:
    return score // COIN_PER_SCORE + max_combo * COIN_PER_COMBO


def exp_earned(own_cleared: int, score: int) -> int:
    return own_cleared * EXP_PER_OWN + score // EXP_PER_SCORE


def clamp_time(seconds: float) -> float:
    return min(MAX_TIME, max(0.0, seconds))
