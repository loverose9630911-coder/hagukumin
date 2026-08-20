"""盤面（ツムの山）の管理.

ツムの生成・補充・チェーン判定・消去・ボムをここで扱う。
物理はすべて physics.World にまかせ、1 手ごとに「完全に静止した盤面」を作る。
クライアントはその静止盤面を受け取って、落下アニメーションを補間で見せる。
"""

from __future__ import annotations

import json
import math
import os
import random
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from . import characters
from .physics import Body, World

WIDTH = 540.0
HEIGHT_MIN = 960.0
HEIGHT_MAX = 1180.0
FLOOR_PAD = 8.0

TSUM_R = 34.0
BIG_R = 54.0
BOMB_R = TSUM_R * 1.12

CHAIN_REACH = 1.34          # 隣接判定 (r1+r2) * この係数
BOMB_CHAIN = 7              # これ以上つなぐとボム
TIME_BOMB_CHAIN = 9         # これ以上つなぐとタイムボム
BOMB_RADIUS = 175.0
TIME_BOMB_RADIUS = 150.0

DECK_SIZE = 5

_CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".cache")
_CACHE_FILE = os.path.join(_CACHE_DIR, "layouts.json")
_LAYOUT_VARIANTS = 4


def clamp_height(height: float) -> float:
    return max(HEIGHT_MIN, min(HEIGHT_MAX, float(height)))


def target_count(height: float) -> int:
    """画面下半分がツムで埋まるような個数。"""
    area = math.pi * TSUM_R * TSUM_R
    n = round(height * 0.52 * WIDTH * 0.72 / area)
    return max(45, min(72, int(n)))


# --------------------------------------------------------------------------- レイアウト

_layout_cache: Dict[str, List[List[Tuple[float, float]]]] = {}


def _bake_layout(height: float, count: int, rng: random.Random) -> List[Tuple[float, float]]:
    """count 個の円を落として、静止した位置を返す。"""
    world = World(WIDTH, height, FLOOR_PAD)
    for i in range(count):
        x = TSUM_R + 6 + rng.random() * (WIDTH - TSUM_R * 2 - 12)
        y = -TSUM_R - rng.random() * 900.0
        body = Body(i + 1, x, y, TSUM_R)
        body.vy = 60.0
        world.add(body)
    world.settle(max_steps=600)
    return [(round(b.x, 2), round(b.y, 2)) for b in world.bodies]


def get_layouts(height: float, count: int) -> List[List[Tuple[float, float]]]:
    """(height, count) 用の静止レイアウトを返す（ディスクにキャッシュ）。"""
    key = f"{int(height)}x{count}"
    if key in _layout_cache:
        return _layout_cache[key]

    disk: Dict[str, List[List[List[float]]]] = {}
    if os.path.exists(_CACHE_FILE):
        try:
            with open(_CACHE_FILE, "r", encoding="utf-8") as fh:
                disk = json.load(fh)
        except (OSError, ValueError):
            disk = {}

    if key in disk:
        layouts = [[(p[0], p[1]) for p in layout] for layout in disk[key]]
    else:
        rng = random.Random(hash(key) & 0xFFFFFFFF)
        layouts = [_bake_layout(height, count, rng) for _ in range(_LAYOUT_VARIANTS)]
        disk[key] = [[[x, y] for x, y in layout] for layout in layouts]
        try:
            os.makedirs(_CACHE_DIR, exist_ok=True)
            with open(_CACHE_FILE, "w", encoding="utf-8") as fh:
                json.dump(disk, fh)
        except OSError:
            pass

    _layout_cache[key] = layouts
    return layouts


def warm_cache(heights: Sequence[int] = (960, 1024, 1080, 1120, 1170, 1180)) -> None:
    """サーバー起動時にレイアウトを焼いておく。"""
    for h in heights:
        get_layouts(float(h), target_count(float(h)))


# --------------------------------------------------------------------------- 盤面

class Board:
    def __init__(self, deck: Sequence[str], height: float = 1080.0,
                 seed: Optional[int] = None):
        self.height = clamp_height(height)
        self.deck = list(deck)
        self.rng = random.Random(seed)
        self.count = target_count(self.height)
        self.world = World(WIDTH, self.height, FLOOR_PAD)
        self._next_id = 1
        self._fill_from_layout()

    # ---------------------------------------------------------------- 生成

    def _new_id(self) -> int:
        i = self._next_id
        self._next_id += 1
        return i

    def _pick_char(self) -> str:
        return self.rng.choice(self.deck)

    def _fill_from_layout(self) -> None:
        layout = self.rng.choice(get_layouts(self.height, self.count))
        for x, y in layout:
            body = Body(self._new_id(), x, y, TSUM_R, char=self._pick_char())
            body.asleep = True
            self.world.add(body)

    def _pile_top(self) -> float:
        """いちばん高いツムの y（ツムが無ければ床）。"""
        if not self.world.bodies:
            return self.height
        return min(b.y for b in self.world.bodies)

    def spawn_tsum(self, char: Optional[str] = None, big: bool = False,
                   above: Optional[float] = None) -> Body:
        """山のすぐ上にツムを足す。

        クライアントは新しいツムを画面の外から落ちてくるように描くので、
        サーバー側は「山の少し上」から落とせば十分。落下距離が短くなり、
        1 手あたりの計算が軽くなる。
        """
        r = BIG_R if big else TSUM_R
        x = r + 6 + self.rng.random() * (WIDTH - r * 2 - 12)
        base = self._pile_top() if above is None else above
        y = base - r * 1.4 - self.rng.random() * r * 0.6
        body = Body(self._new_id(), x, y, r, char=char or self._pick_char(), big=big)
        body.vy = 60.0
        body.spawn = True
        return self.world.add(body)

    def spawn_bomb(self, x: float, y: float, time_bomb: bool) -> Body:
        body = Body(self._new_id(), x, min(y, self.height - 160.0), BOMB_R,
                    kind="bomb", time_bomb=time_bomb)
        body.vy = -160.0
        body.spawn = True
        return self.world.add(body)

    def refill(self) -> List[Body]:
        """減ったぶんのツムを、山の上に段違いで足す。"""
        need = max(0, self.count - len(self.world.bodies))
        if not need:
            return []
        top = self._pile_top()
        out = []
        for i in range(need):
            # 3 個ずつ段をずらして置き、生成直後の重なりを減らす
            layer = top - (i // 3) * TSUM_R * 1.9
            out.append(self.spawn_tsum(above=layer))
        return out

    # ---------------------------------------------------------------- 参照

    @property
    def bodies(self) -> List[Body]:
        return self.world.bodies

    def by_id(self, bid: int) -> Optional[Body]:
        for b in self.world.bodies:
            if b.id == bid:
                return b
        return None

    def tsums(self) -> List[Body]:
        return [b for b in self.world.bodies if b.kind == "tsum"]

    def neighbors_of(self, body: Body) -> List[Body]:
        """同じキャラで、つなげられる距離にいるツム。"""
        self.world.rebuild_index()
        out = []
        for c in self.world.neighbors(body):
            if c is body or c.kind != "tsum" or c.char != body.char:
                continue
            reach = (body.r + c.r) * CHAIN_REACH
            if (c.x - body.x) ** 2 + (c.y - body.y) ** 2 <= reach * reach:
                out.append(c)
        return out

    # ---------------------------------------------------------------- チェーン

    def validate_chain(self, ids: Sequence[int]) -> Tuple[bool, str, List[Body]]:
        """なぞられた順の ID 列が正しいチェーンかを確かめる。"""
        if len(ids) < 3:
            return False, "3こ以上つないでください", []
        if len(set(ids)) != len(ids):
            return False, "おなじツムが 2かい入っています", []

        bodies: List[Body] = []
        index = {b.id: b for b in self.world.bodies}
        for bid in ids:
            body = index.get(bid)
            if body is None:
                return False, "もう消えているツムです", []
            if body.kind != "tsum":
                return False, "ボムは つなげられません", []
            bodies.append(body)

        first_char = bodies[0].char
        for body in bodies:
            if body.char != first_char:
                return False, "ちがうキャラが まざっています", []

        for a, b in zip(bodies, bodies[1:]):
            reach = (a.r + b.r) * CHAIN_REACH
            if (a.x - b.x) ** 2 + (a.y - b.y) ** 2 > reach * reach:
                return False, "となり同士では ありません", []

        return True, "", bodies

    # ---------------------------------------------------------------- 消去

    def clear(self, bodies: Iterable[Body]) -> Dict:
        """ツムを消して、盤面を静止するまで落とす。"""
        targets = [b for b in bodies if b in self.world.bodies]
        if not targets:
            return {"cleared": 0, "units": 0, "by_char": {}, "center": None,
                    "positions": []}

        units = 0
        by_char: Dict[str, int] = {}
        cx = cy = 0.0
        top_y = self.height
        positions = []
        for b in targets:
            weight = 3 if b.big else 1
            units += weight
            if b.char:
                by_char[b.char] = by_char.get(b.char, 0) + weight
            cx += b.x
            cy += b.y
            top_y = min(top_y, b.y)
            positions.append({"id": b.id, "x": round(b.x, 1), "y": round(b.y, 1),
                              "r": round(b.r, 1), "char": b.char,
                              "kind": b.kind, "big": b.big})
        cx /= len(targets)
        cy /= len(targets)

        self.world.remove_many(targets)
        self.world.wake_above(max(p["y"] for p in positions), margin=TSUM_R * 2)
        return {
            "cleared": len(targets),
            "units": units,
            "by_char": by_char,
            "center": (round(cx, 1), round(cy, 1)),
            "top_y": round(top_y, 1),
            "positions": positions,
        }

    def bomb_targets(self, bomb: Body) -> List[Body]:
        radius = TIME_BOMB_RADIUS if bomb.time_bomb else BOMB_RADIUS
        r2 = radius * radius
        return [b for b in self.world.bodies
                if b.kind == "tsum"
                and (b.x - bomb.x) ** 2 + (b.y - bomb.y) ** 2 <= r2]

    def make_big(self, n: int) -> List[Body]:
        candidates = [b for b in self.tsums() if not b.big]
        self.rng.shuffle(candidates)
        grown = []
        for body in candidates[:n]:
            body.big = True
            body.r = BIG_R
            body.y -= 24.0
            body.wake()
            grown.append(body)
        if grown:
            self.world.wake_all()
        return grown

    def settle(self) -> None:
        self.world.settle()

    # ---------------------------------------------------------------- 出力

    def snapshot(self) -> List[Dict]:
        """クライアントへ渡す静止盤面。キーは転送量を抑えて短くしてある。"""
        out = []
        for b in self.world.bodies:
            item = {
                "i": b.id,
                "x": round(b.x, 1),
                "y": round(b.y, 1),
                "r": round(b.r, 1),
            }
            if b.kind == "bomb":
                item["k"] = "t" if b.time_bomb else "b"
            else:
                item["c"] = b.char
                if b.big:
                    item["g"] = 1
            if b.spawn:
                item["n"] = 1
                b.spawn = False
            out.append(item)
        return out


def build_deck(char_id: str, rng: random.Random) -> List[str]:
    """選んだキャラ＋ランダム 4 種の、計 5 種類で 1 プレイぶんの山を作る。"""
    others = [c.id for c in characters.CHARACTERS if c.id != char_id]
    rng.shuffle(others)
    return [char_id] + others[:DECK_SIZE - 1]
