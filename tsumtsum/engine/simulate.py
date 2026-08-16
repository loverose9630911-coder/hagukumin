#!/usr/bin/env python3
"""ヘッドレスで自動プレイして、バランスと速度を確かめる.

    python3 engine/simulate.py --games 5 --char zou

ブラウザを使わずにエンジンだけを回すので、
スコアの出かたや 1 手あたりの計算時間をすぐ確認できる。
"""

from __future__ import annotations

import argparse
import os
import statistics
import sys
import time
from typing import List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from hagukumin import characters              # noqa: E402
from hagukumin.board import CHAIN_REACH       # noqa: E402
from hagukumin.session import GameSession     # noqa: E402


class FakeClock:
    """好きなだけ時間を進められる時計（実時間を待たずに 60 秒ぶん遊ぶ）。"""

    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def longest_chain(session: GameSession, limit: int = 12) -> List[int]:
    """いまの盤面から、なるべく長くつながる並びを探す。"""
    board = session.board
    board.world.rebuild_index()
    tsums = board.tsums()
    adjacency = {}
    for a in tsums:
        near = []
        for c in board.world.neighbors(a):
            if c is a or c.kind != "tsum" or c.char != a.char:
                continue
            reach = (a.r + c.r) * CHAIN_REACH
            if (a.x - c.x) ** 2 + (a.y - c.y) ** 2 <= reach * reach:
                near.append(c)
        adjacency[a.id] = near

    best: List[int] = []

    def walk(node, seen, path):
        nonlocal best
        if len(path) > len(best):
            best = list(path)
        if len(path) >= limit:
            return
        for nxt in adjacency[node.id]:
            if nxt.id in seen:
                continue
            seen.add(nxt.id)
            path.append(nxt.id)
            walk(nxt, seen, path)
            path.pop()
            seen.discard(nxt.id)

    for start in tsums:
        walk(start, {start.id}, [start.id])
        if len(best) >= 10:
            break
    return best


def play_one(char_id: str, seed: Optional[int] = None, verbose: bool = False):
    clock = FakeClock()
    session = GameSession(char_id, level=0, height=1080.0, seed=seed, clock=clock)
    session.start()

    move_times: List[float] = []
    moves = 0
    while session.time_left > 0 and moves < 400:
        if session.skill_ready:
            t0 = time.perf_counter()
            session.act_skill()
            move_times.append(time.perf_counter() - t0)
            clock.advance(0.5)
            continue

        bomb = next((b for b in session.board.bodies if b.kind == "bomb"), None)
        if bomb is not None:
            t0 = time.perf_counter()
            session.act_bomb(bomb.id)
            move_times.append(time.perf_counter() - t0)
            clock.advance(0.5)
            continue

        ids = longest_chain(session)
        if len(ids) < 3:
            clock.advance(0.4)
            continue

        t0 = time.perf_counter()
        result = session.act_chain(ids)
        move_times.append(time.perf_counter() - t0)
        moves += 1
        if verbose and result.get("ok"):
            print(f"  {len(ids):2d}つなぎ  +{result['gained']:>6}  "
                  f"combo {result['state']['combo']:>2}  "
                  f"残り {result['state']['time_left']:.1f}s")
        clock.advance(0.55)          # 実際の落下アニメーションぶん

    result = session.finish()
    result["moves"] = moves
    result["move_ms_avg"] = statistics.mean(move_times) * 1000 if move_times else 0.0
    result["move_ms_max"] = max(move_times) * 1000 if move_times else 0.0
    return result


def main() -> int:
    ap = argparse.ArgumentParser(description="ハグミン ツムツム 自動プレイ")
    ap.add_argument("--games", type=int, default=3)
    ap.add_argument("--char", default=None, help="省略すると全キャラを 1 回ずつ")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    targets = ([args.char] * args.games if args.char
               else [c.id for c in characters.CHARACTERS])

    print(f"{'キャラ':<14}{'スコア':>9}{'最大コンボ':>10}{'消したツム':>10}"
          f"{'ボム':>6}{'スキル':>7}{'FEVER':>7}{'コイン':>8}"
          f"{'1手ms':>8}{'最大ms':>8}")
    print("-" * 92)
    scores = []
    worst = 0.0
    for i, char_id in enumerate(targets):
        res = play_one(char_id, seed=1000 + i, verbose=args.verbose)
        scores.append(res["score"])
        worst = max(worst, res["move_ms_max"])
        name = characters.get(char_id).name
        print(f"{name:<14}{res['score']:>9,}{res['max_combo']:>10}"
              f"{res['tsum_cleared']:>10}{res['bombs_used']:>6}"
              f"{res['skills_used']:>7}{res['fever_count']:>7}"
              f"{res['coins']:>8,}{res['move_ms_avg']:>8.1f}{res['move_ms_max']:>8.1f}")
    print("-" * 92)
    print(f"平均スコア {statistics.mean(scores):,.0f} / "
          f"最高 {max(scores):,} / 最低 {min(scores):,} / "
          f"1 手の最大計算時間 {worst:.1f}ms")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
