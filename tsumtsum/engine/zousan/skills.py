"""キャラクターのスキル効果.

各関数は (消すツムのリスト, 見せかたの指示, 追加の時間) を返す。
見せかたの指示（effects）はクライアントがそのまま演出に使う。
"""

from __future__ import annotations

from typing import Callable, Dict, List, Tuple

from .board import Board, WIDTH
from .physics import Body

Result = Tuple[List[Body], List[Dict], float]


def _center_of(bodies: List[Body]) -> Tuple[float, float]:
    cx = sum(b.x for b in bodies) / len(bodies)
    cy = sum(b.y for b in bodies) / len(bodies)
    return cx, cy


def burst(board: Board, power: float, color: str) -> Result:
    """まんまるに まとめて消す。"""
    tsums = board.tsums()
    if not tsums:
        return [], [], 0.0
    cx, cy = _center_of(tsums)
    cy = max(cy, board.height * 0.55)
    hit = [b for b in tsums if (b.x - cx) ** 2 + (b.y - cy) ** 2 <= power * power]
    fx = [{"fx": "ring", "x": round(cx, 1), "y": round(cy, 1),
           "r": round(power, 1), "color": color},
          {"fx": "shake", "power": 10}]
    return hit, fx, 0.0


def rainbow(board: Board, power: float, color: str) -> Result:
    """よこ一列を にじで 消す。"""
    tsums = board.tsums()
    if not tsums:
        return [], [], 0.0
    ys = sorted(b.y for b in tsums)
    cy = ys[int(len(ys) * 0.55)]
    half = power / 2.0
    hit = [b for b in tsums if abs(b.y - cy) <= half]
    fx = [{"fx": "band", "x": 0, "y": round(cy - half, 1),
           "w": WIDTH, "h": round(power, 1), "color": color, "rainbow": True},
          {"fx": "shake", "power": 9}]
    return hit, fx, 0.0


def wave(board: Board, power: float, color: str) -> Result:
    """たて一列を なみで 消す。"""
    tsums = board.tsums()
    if not tsums:
        return [], [], 0.0
    cx, _ = _center_of(tsums)
    half = power / 2.0
    cx = max(half, min(WIDTH - half, cx + (board.rng.random() - 0.5) * 120))
    hit = [b for b in tsums if abs(b.x - cx) <= half]
    fx = [{"fx": "band", "x": round(cx - half, 1), "y": 0,
           "w": round(power, 1), "h": board.height, "color": color},
          {"fx": "shake", "power": 9}]
    return hit, fx, 0.0


def cross(board: Board, power: float, color: str) -> Result:
    """じゅうじに 消す。"""
    tsums = board.tsums()
    if not tsums:
        return [], [], 0.0
    cx, cy = _center_of(tsums)
    cy = max(cy, board.height * 0.58)
    half = power / 2.0
    hit = [b for b in tsums
           if abs(b.y - cy) <= half or abs(b.x - cx) <= half]
    fx = [{"fx": "band", "x": 0, "y": round(cy - half, 1),
           "w": WIDTH, "h": round(power, 1), "color": color},
          {"fx": "band", "x": round(cx - half, 1), "y": 0,
           "w": round(power, 1), "h": board.height, "color": color},
          {"fx": "shake", "power": 10}]
    return hit, fx, 0.0


def ramune(board: Board, power: float, color: str) -> Result:
    """ランダムに消して 時間を足す。"""
    tsums = board.tsums()
    n = int(power)
    board.rng.shuffle(tsums)
    hit = tsums[:n]
    fx = [{"fx": "ring", "x": round(b.x, 1), "y": round(b.y, 1),
           "r": round(b.r * 1.6, 1), "color": color} for b in hit]
    fx.append({"fx": "flash", "color": color})
    fx.append({"fx": "shake", "power": 7})
    return hit, fx, 3.0


def dam(board: Board, power: float, color: str) -> Result:
    """ツムを 大ツムに そだてる（消さない）。"""
    grown = board.make_big(int(power))
    fx = [{"fx": "ring", "x": round(b.x, 1), "y": round(b.y, 1),
           "r": round(b.r * 1.6, 1), "color": color} for b in grown]
    fx.append({"fx": "flash", "color": color})
    return [], fx, 0.0


TABLE: Dict[str, Callable[[Board, float, str], Result]] = {
    "burst": burst,
    "rainbow": rainbow,
    "wave": wave,
    "cross": cross,
    "ramune": ramune,
    "dam": dam,
}


def run(skill_id: str, board: Board, power: float, color: str) -> Result:
    fn = TABLE.get(skill_id)
    if fn is None:
        raise KeyError(f"unknown skill: {skill_id}")
    return fn(board, power, color)
