"""円の積み上げ物理（位置ベース／PBD）.

速度をそのまま積分する方式だと、支えられた円に重力が溜まりつづけて
山が永久に振動する。ここでは

    1. 重力を加えて仮の位置へ動かす
    2. めり込みを「位置」で数回くり返し解く
    3. 実際に動いた距離から速度を作り直す

という順で解く。支えられた円は位置が動かない＝速度が自動的に 0 になるので、
積み上がった山が完全に静止する。

さらに、動きが止まった円を「ねむり」状態にして計算から外すことで、
1 手ごとの再計算を軽くしている（盤面のほとんどは動かないため）。
"""

from __future__ import annotations

import math
from typing import Dict, Iterable, List, Optional, Tuple

GRAVITY = 2100.0     # px/s^2
DAMPING = 0.986      # 速度の減衰
ITERATIONS = 5       # 位置補正の反復回数
STIFFNESS = 0.85     # 1 回でめり込みをどれだけ戻すか
MAX_SPEED = 2600.0
SLEEP_EPS = 0.45     # 1 ステップでこの距離しか動かなければ静止とみなす
SETTLE_SPEED = 55.0  # 下向きの速さがこれ未満になったら「落下おわり」
SETTLE_MIN_STEPS = 10   # 落ち始めを静止と誤判定しないための下限
SETTLE_QUIET_FRAMES = 4 # 静かなステップがこれだけ続いたら打ち切る
SETTLE_MAX_STEPS = 150  # 念のための上限
SETTLE_LANDING_STEPS = 90  # 浮いた円を着地させる仕上げの上限
CONTACT_TOLERANCE = 2.0    # これ以内なら「触れている」とみなす
SLEEP_FRAMES = 4     # 静止が続いたらねむる
PAIR_SLACK = 8.0     # ペアを作るときの余裕（反復中に動くぶん）
FRICTION = 0.22      # 接触面の摩擦（転がりつづけるのを止める／大きすぎると山がすかすかになる）


class Body:
    """物理に載る円。ゲーム側の属性（キャラ・ボム種別）も一緒に持つ。"""

    __slots__ = (
        "id", "char", "kind", "r", "big", "time_bomb",
        "x", "y", "vx", "vy", "px", "py",
        "asleep", "_still", "spawn",
    )

    def __init__(self, bid: int, x: float, y: float, r: float,
                 char: Optional[str] = None, kind: str = "tsum",
                 big: bool = False, time_bomb: bool = False):
        self.id = bid
        self.char = char
        self.kind = kind
        self.r = r
        self.big = big
        self.time_bomb = time_bomb
        self.x = x
        self.y = y
        self.vx = 0.0
        self.vy = 0.0
        self.px = x
        self.py = y
        self.asleep = False
        self._still = 0
        self.spawn = False   # このターンに新しく湧いたか（クライアントの演出用）

    def wake(self) -> None:
        self.asleep = False
        self._still = 0


class World:
    """円が落ちて積み上がる箱。"""

    def __init__(self, width: float, height: float, floor_pad: float = 8.0,
                 cell: float = 120.0):
        self.width = width
        self.height = height
        self.floor = height - floor_pad
        self.cell = cell
        self.bodies: List[Body] = []
        self._grid: Dict[Tuple[int, int], List[Body]] = {}

    # ------------------------------------------------------------------ 出し入れ

    def add(self, body: Body) -> Body:
        body.px, body.py = body.x, body.y
        self.bodies.append(body)
        return body

    def remove(self, body: Body) -> None:
        try:
            self.bodies.remove(body)
        except ValueError:
            pass

    def remove_many(self, bodies: Iterable[Body]) -> None:
        drop = {id(b) for b in bodies}
        self.bodies = [b for b in self.bodies if id(b) not in drop]

    def wake_all(self) -> None:
        for b in self.bodies:
            b.wake()

    def wake_above(self, y: float, margin: float = 0.0) -> None:
        """指定の高さより上にいる円を起こす（消えた穴の上が落ちてくる）。"""
        limit = y + margin
        for b in self.bodies:
            if b.y <= limit:
                b.wake()

    def awake_count(self) -> int:
        return sum(0 if b.asleep else 1 for b in self.bodies)

    # ------------------------------------------------------------------ 近傍探索

    def _build_grid(self) -> None:
        grid: Dict[Tuple[int, int], List[Body]] = {}
        cell = self.cell
        for b in self.bodies:
            key = (int(b.x // cell), int(b.y // cell))
            bucket = grid.get(key)
            if bucket is None:
                grid[key] = [b]
            else:
                bucket.append(b)
        self._grid = grid

    def neighbors(self, body: Body) -> List[Body]:
        """自分の周囲 3x3 セルにいる円（自分自身を含む）。"""
        cell = self.cell
        cx = int(body.x // cell)
        cy = int(body.y // cell)
        grid = self._grid
        out: List[Body] = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                bucket = grid.get((cx + dx, cy + dy))
                if bucket:
                    out.extend(bucket)
        return out

    def rebuild_index(self) -> None:
        """外部から neighbors() を使う前に呼ぶ。"""
        self._build_grid()

    def _collect_pairs(self) -> List[Tuple[Body, Body]]:
        """このステップでぶつかる可能性のある組み合わせを集める。

        反復のあいだに円は少ししか動かないので、
        半径の合計に PAIR_SLACK だけ余裕を持たせて 1 回作れば足りる。
        """
        self._build_grid()
        grid = self._grid
        cell = self.cell
        pairs: List[Tuple[Body, Body]] = []
        append = pairs.append
        for a in self.bodies:
            ax, ay, ar = a.x, a.y, a.r
            a_sleep = a.asleep
            gx = int(ax // cell)
            gy = int(ay // cell)
            for dx in (-1, 0, 1):
                col = gx + dx
                for dy in (-1, 0, 1):
                    bucket = grid.get((col, gy + dy))
                    if not bucket:
                        continue
                    for c in bucket:
                        if c.id <= a.id:
                            continue          # 各ペアを 1 回だけ
                        if a_sleep and c.asleep:
                            continue          # どちらも眠っていれば無視
                        reach = ar + c.r + PAIR_SLACK
                        ddx = c.x - ax
                        ddy = c.y - ay
                        if ddx * ddx + ddy * ddy <= reach * reach:
                            append((a, c))
        return pairs

    # ------------------------------------------------------------------ 1 ステップ

    def step(self, dt: float) -> float:
        """dt 秒すすめて、いちばん大きく動いた距離を返す。"""
        bodies = self.bodies
        gravity_dt = GRAVITY * dt

        # 1. 重力を加えて仮の位置へ
        for b in bodies:
            b.px = b.x
            b.py = b.y
            if b.asleep:
                continue
            vy = b.vy + gravity_dt
            if vy > MAX_SPEED:
                vy = MAX_SPEED
            elif vy < -MAX_SPEED:
                vy = -MAX_SPEED
            vx = b.vx
            if vx > MAX_SPEED:
                vx = MAX_SPEED
            elif vx < -MAX_SPEED:
                vx = -MAX_SPEED
            b.vx = vx
            b.vy = vy
            b.x += vx * dt
            b.y += vy * dt

        # 2. めり込みを位置で解く
        #    ぶつかりそうな組み合わせ（ペア）は 1 ステップに 1 回だけ作り、
        #    反復のあいだ使い回す。ここが速度のいちばんの要。
        pairs = self._collect_pairs()
        width = self.width
        floor = self.floor
        sqrt = math.sqrt
        for it in range(ITERATIONS):
            first = it == 0
            for a, c in pairs:
                a_sleep = a.asleep
                c_sleep = c.asleep
                if a_sleep and c_sleep:
                    continue
                ar = a.r
                ddx = c.x - a.x
                ddy = c.y - a.y
                rr = ar + c.r
                d2 = ddx * ddx + ddy * ddy
                if d2 >= rr * rr:
                    continue
                if d2 < 1e-8:
                    ang = (a.id * 12.9898 + c.id * 78.233) % 6.283185
                    nx, ny = math.cos(ang), math.sin(ang)
                    d = 0.0
                else:
                    d = sqrt(d2)
                    nx = ddx / d
                    ny = ddy / d
                    # 真上に積み重なった「柱」は崩れないので横へ少しずらす。
                    # ただし、乗っているだけの接触にまで毎回ゆらぎを入れると
                    # 山がいつまでも静止しないので、めり込みが大きいときだけにする。
                    if -0.07 < nx < 0.07 and (rr - d) > 1.0:
                        nx += 0.06 if (a.id + c.id) & 1 else -0.06
                        inv = 1.0 / sqrt(nx * nx + ny * ny)
                        nx *= inv
                        ny *= inv
                overlap = (rr - d) * STIFFNESS
                # 眠っている側は押されると起きる
                if overlap > 0.5:
                    if a_sleep:
                        a.wake()
                        a_sleep = False
                    if c_sleep:
                        c.wake()
                        c_sleep = False
                # 質量は半径の 2 乗に比例（大ツムは押されにくい）
                ma = 0.0 if a_sleep else 1.0 / (ar * ar)
                mc = 0.0 if c_sleep else 1.0 / (c.r * c.r)
                total = ma + mc
                if total <= 0.0:
                    continue
                if ma:
                    pa = overlap * (ma / total)
                    a.x -= nx * pa
                    a.y -= ny * pa
                if mc:
                    pc = overlap * (mc / total)
                    c.x += nx * pc
                    c.y += ny * pc

                # 摩擦：接している相手とのあいだの「横ずれ」を打ち消す。
                # これが無いと円どうしが転がりつづけて山がなかなか静止しない。
                if first:
                    tdx = (a.x - a.px) - (c.x - c.px)
                    tdy = (a.y - a.py) - (c.y - c.py)
                    tn = tdx * nx + tdy * ny
                    tdx -= tn * nx
                    tdy -= tn * ny
                    if ma:
                        f = FRICTION * (ma / total)
                        a.x -= tdx * f
                        a.y -= tdy * f
                    if mc:
                        f = FRICTION * (mc / total)
                        c.x += tdx * f
                        c.y += tdy * f

            # 壁と床
            for b in bodies:
                if b.asleep:
                    continue
                br = b.r
                if b.x - br < 0.0:
                    b.x = br
                elif b.x + br > width:
                    b.x = width - br
                if b.y + br > floor:
                    b.y = floor - br

        # 3. 動いた距離から速度を作り直す
        inv_dt = 1.0 / dt
        moved_max = 0.0
        for b in bodies:
            if b.asleep:
                continue
            ddx = b.x - b.px
            ddy = b.y - b.py
            moved = math.sqrt(ddx * ddx + ddy * ddy)
            if moved > moved_max:
                moved_max = moved
            b.vx = ddx * inv_dt * DAMPING
            b.vy = ddy * inv_dt * DAMPING
            if -2.0 < b.vx < 2.0:
                b.vx = 0.0
            if moved < SLEEP_EPS:
                b._still += 1
                if b._still >= SLEEP_FRAMES:
                    b.asleep = True
                    b.vx = 0.0
                    b.vy = 0.0
            else:
                b._still = 0
        return moved_max

    def floating_bodies(self, tolerance: float = CONTACT_TOLERANCE) -> List[Body]:
        """床にも他の円にも触れていない（＝宙に浮いている）円を返す。"""
        self._build_grid()
        grid = self._grid
        cell = self.cell
        out: List[Body] = []
        for a in self.bodies:
            if a.y + a.r >= self.floor - tolerance:
                continue                                  # 床の上
            ax, ay, ar = a.x, a.y, a.r
            gx = int(ax // cell)
            gy = int(ay // cell)
            touching = False
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    bucket = grid.get((gx + dx, gy + dy))
                    if not bucket:
                        continue
                    for c in bucket:
                        if c is a:
                            continue
                        reach = ar + c.r + tolerance
                        ddx = c.x - ax
                        ddy = c.y - ay
                        if ddx * ddx + ddy * ddy <= reach * reach:
                            touching = True
                            break
                    if touching:
                        break
                if touching:
                    break
            if not touching:
                out.append(a)
        return out

    # ------------------------------------------------------------------ 静止まで回す

    def settle(self, dt: float = 1.0 / 60.0, max_steps: int = SETTLE_MAX_STEPS,
               speed_eps: float = SETTLE_SPEED) -> int:
        """落ちるものが無くなるまで進めて、盤面を固定する。

        円だけの山は、上のほうの円がすきまへゆっくり沈みこむため、
        完全な平衡までは何秒も掛かる。ゲームに必要なのは
        「もう落ちているものが無い」状態なので、いちばん速い円の速さが
        speed_eps を下回った時点で打ち切り、全部を静止させる
        （このあと次の操作があるまで盤面は動かない）。

        見るのは「下向きの速さ」だけにしている。ゆるい山は横方向にいつまでも
        小さくゆれるので、速さ全体で判定すると毎回上限まで回ってしまい、
        まだ落ちている途中の円をそのまま固めてしまうため。
        押し戻されて上へはねた円は頂点で一瞬 速さ 0 になるので、
        静かなステップが SETTLE_QUIET_FRAMES 回つづいたときだけ打ち切る。
        """
        steps = 0
        quiet = 0
        for _ in range(max_steps):
            if self.awake_count() == 0:
                break
            self.step(dt)
            steps += 1
            if steps >= SETTLE_MIN_STEPS:
                falling = 0.0
                for b in self.bodies:
                    if b.vy > falling:
                        falling = b.vy
                if falling < speed_eps:
                    quiet += 1
                    if quiet >= SETTLE_QUIET_FRAMES:
                        break
                else:
                    quiet = 0

        # 仕上げ：どこにも触れていない円が残っていたら、着地するまで回す。
        # ここを通すことで「宙に浮いたまま固まったツム」が絶対に残らない。
        for _ in range(SETTLE_LANDING_STEPS):
            floating = self.floating_bodies()
            if not floating:
                break
            for b in floating:
                b.wake()
            self.step(dt)
            steps += 1
        # 残っていた速度も 0 にして完全に止める
        for b in self.bodies:
            b.vx = 0.0
            b.vy = 0.0
            b.asleep = True
        return steps
