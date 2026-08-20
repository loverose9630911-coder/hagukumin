"""エンジンのテスト.

    python3 -m unittest discover -s engine/tests -v
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from zousan import board as board_mod          # noqa: E402
from zousan import characters, rules           # noqa: E402
from zousan.board import Board                 # noqa: E402
from zousan.physics import Body, World         # noqa: E402
from zousan.session import GameSession         # noqa: E402


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


# ------------------------------------------------------------------ キャラクター

class CharacterTest(unittest.TestCase):
    def test_six_characters(self):
        self.assertEqual(len(characters.CHARACTERS), 6)

    def test_ids_are_unique(self):
        ids = [c.id for c in characters.CHARACTERS]
        self.assertEqual(len(ids), len(set(ids)))

    def test_icon_character_is_free(self):
        # アプリアイコンのぞうさんは最初から使える
        self.assertEqual(characters.ICON_ID, "zou")
        self.assertEqual(characters.get("zou").price, 0)

    def test_skill_tables_have_five_levels(self):
        for c in characters.CHARACTERS:
            self.assertEqual(len(c.skill.need), 5, c.id)
            self.assertEqual(len(c.skill.power), 5, c.id)
            # レベルが上がるほど必要数は減る
            self.assertLess(c.skill.need[4], c.skill.need[0], c.id)

    def test_level_from_exp(self):
        self.assertEqual(characters.level_from_exp(0), 0)
        self.assertEqual(characters.level_from_exp(299), 0)
        self.assertEqual(characters.level_from_exp(300), 1)
        self.assertEqual(characters.level_from_exp(99999), 4)

    def test_exp_to_next_is_none_at_max(self):
        self.assertIsNone(characters.exp_to_next(99999))
        self.assertEqual(characters.exp_to_next(0), {"cur": 0, "need": 300})


# ------------------------------------------------------------------ 物理

class PhysicsTest(unittest.TestCase):
    def test_circle_falls_to_floor(self):
        world = World(540, 960)
        body = world.add(Body(1, 270, 0, 34))
        world.settle()
        self.assertAlmostEqual(body.y + body.r, world.floor, delta=2.0)

    def test_pile_comes_to_rest(self):
        world = World(540, 960)
        for i in range(30):
            world.add(Body(i + 1, 40 + (i * 61) % 460, -i * 40, 34))
        world.settle()
        # 静止したら速度はすべて 0
        self.assertEqual(max(abs(b.vx) + abs(b.vy) for b in world.bodies), 0.0)

    def test_circles_do_not_overlap_badly(self):
        world = World(540, 960)
        for i in range(40):
            world.add(Body(i + 1, 40 + (i * 97) % 460, -i * 30, 34))
        world.settle()
        worst = 0.0
        bodies = world.bodies
        for i, a in enumerate(bodies):
            for b in bodies[i + 1:]:
                dist = ((a.x - b.x) ** 2 + (a.y - b.y) ** 2) ** 0.5
                worst = max(worst, (a.r + b.r) - dist)
        self.assertLess(worst, 6.0, "めり込みが大きすぎます")

    def test_stays_inside_walls(self):
        world = World(540, 960)
        for i in range(20):
            body = world.add(Body(i + 1, 10, -i * 50, 34))
            body.vx = -800.0
        world.settle()
        for b in world.bodies:
            self.assertGreaterEqual(b.x, b.r - 0.5)
            self.assertLessEqual(b.x, world.width - b.r + 0.5)
            self.assertLessEqual(b.y + b.r, world.floor + 0.5)

    def test_sleeping_bodies_are_skipped(self):
        world = World(540, 960)
        for i in range(12):
            world.add(Body(i + 1, 60 + i * 38, 900 - (i % 3) * 70, 34))
        world.settle()
        self.assertEqual(world.awake_count(), 0)

    def test_nothing_is_left_floating(self):
        # 落ちている途中で盤面を固めてしまうと、宙に浮いたツムが残ってしまう
        world = World(540, 1080)
        for i in range(50):
            body = world.add(Body(i + 1, 40 + (i * 83) % 460, -i * 45, 34))
            body.vy = 60.0
        world.settle()
        self.assertEqual(world.floating_bodies(), [],
                         "宙に浮いたまま固まった円があります")


# ------------------------------------------------------------------ 盤面

class BoardTest(unittest.TestCase):
    def setUp(self):
        self.board = Board(["zou", "usagi", "panda"], height=1080.0, seed=42)

    def test_board_is_filled_and_settled(self):
        self.assertEqual(len(self.board.bodies), board_mod.target_count(1080.0))
        self.assertEqual(self.board.world.awake_count(), 0)

    def test_only_deck_characters_appear(self):
        for b in self.board.tsums():
            self.assertIn(b.char, self.board.deck)

    def test_chain_needs_three(self):
        pair = self._find_chain(2)
        ok, message, _ = self.board.validate_chain([b.id for b in pair])
        self.assertFalse(ok)
        self.assertIn("3こ", message)

    def test_chain_rejects_different_characters(self):
        tsums = self.board.tsums()
        a = tsums[0]
        others = [t for t in tsums if t.char != a.char]
        ok, message, _ = self.board.validate_chain([a.id, others[0].id, others[1].id])
        self.assertFalse(ok)

    def test_chain_rejects_far_apart(self):
        tsums = self.board.tsums()
        same = [t for t in tsums if t.char == tsums[0].char]
        far = sorted(same, key=lambda t: t.y)
        if len(far) >= 3 and abs(far[0].y - far[-1].y) > 200:
            ok, _, _ = self.board.validate_chain([far[0].id, far[-1].id, far[1].id])
            self.assertFalse(ok)

    def test_chain_rejects_duplicates(self):
        chain = self._find_chain(3)
        ids = [b.id for b in chain]
        ok, message, _ = self.board.validate_chain([ids[0], ids[1], ids[0]])
        self.assertFalse(ok)

    def test_valid_chain_clears(self):
        chain = self._find_chain(3)
        before = len(self.board.bodies)
        ok, _, bodies = self.board.validate_chain([b.id for b in chain])
        self.assertTrue(ok)
        info = self.board.clear(bodies)
        self.assertEqual(info["cleared"], 3)
        self.assertEqual(len(self.board.bodies), before - 3)

    def test_board_never_leaves_a_floating_tsum(self):
        # 消す → 補充 → 静止 をくり返しても、浮いたツムは残らない
        for _ in range(6):
            chain = self._find_chain(3)
            _, _, bodies = self.board.validate_chain([b.id for b in chain])
            self.board.clear(bodies)
            self.board.refill()
            self.board.settle()
            self.assertEqual(self.board.world.floating_bodies(), [],
                             "宙に浮いたまま固まったツムがあります")

    def test_refill_restores_count(self):
        chain = self._find_chain(3)
        _, _, bodies = self.board.validate_chain([b.id for b in chain])
        self.board.clear(bodies)
        self.board.refill()
        self.board.settle()
        self.assertEqual(len(self.board.bodies), self.board.count)

    def test_big_tsum_counts_as_three(self):
        grown = self.board.make_big(1)
        self.assertEqual(len(grown), 1)
        self.assertEqual(grown[0].r, board_mod.BIG_R)
        info = self.board.clear([grown[0]])
        self.assertEqual(info["units"], 3)

    def test_snapshot_shape(self):
        snap = self.board.snapshot()
        self.assertEqual(len(snap), len(self.board.bodies))
        first = snap[0]
        for key in ("i", "x", "y", "r"):
            self.assertIn(key, first)

    def _find_chain(self, n):
        """つながっている n 個を探す。"""
        for start in self.board.tsums():
            chain = [start]
            seen = {start.id}
            while len(chain) < n:
                nxt = [c for c in self.board.neighbors_of(chain[-1])
                       if c.id not in seen]
                if not nxt:
                    break
                chain.append(nxt[0])
                seen.add(nxt[0].id)
            if len(chain) == n:
                return chain
        self.skipTest("つながるツムが見つかりませんでした")


# ------------------------------------------------------------------ スコア計算

class RulesTest(unittest.TestCase):
    def test_more_tsums_scores_more(self):
        self.assertLess(rules.chain_score(3, 0, False),
                        rules.chain_score(6, 0, False))

    def test_combo_increases_score(self):
        self.assertLess(rules.chain_score(5, 0, False),
                        rules.chain_score(5, 10, False))

    def test_fever_doubles(self):
        plain = rules.chain_score(5, 0, False)
        fever = rules.chain_score(5, 0, True)
        self.assertEqual(fever, plain * 2)

    def test_combo_multiplier_is_capped(self):
        self.assertEqual(rules.chain_score(5, rules.COMBO_CAP, False),
                         rules.chain_score(5, rules.COMBO_CAP + 100, False))

    def test_coins_and_exp(self):
        self.assertEqual(rules.coins_earned(12000, 10), 100 + 20)
        self.assertEqual(rules.exp_earned(50, 4000), 300 + 10)


# ------------------------------------------------------------------ セッション

class SessionTest(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.session = GameSession("zou", level=0, height=1080.0, seed=7,
                                   clock=self.clock)
        self.session.start()

    def _chain_ids(self, n=3):
        board = self.session.board
        for start in board.tsums():
            chain = [start]
            seen = {start.id}
            while len(chain) < n:
                nxt = [c for c in board.neighbors_of(chain[-1]) if c.id not in seen]
                if not nxt:
                    break
                chain.append(nxt[0])
                seen.add(nxt[0].id)
            if len(chain) == n:
                return [b.id for b in chain]
        self.skipTest("つながるツムが見つかりませんでした")

    def test_time_counts_down(self):
        self.assertAlmostEqual(self.session.time_left, rules.PLAY_TIME, delta=0.01)
        self.clock.advance(10)
        self.assertAlmostEqual(self.session.time_left, 50.0, delta=0.01)

    def test_game_ends_at_zero(self):
        self.clock.advance(rules.PLAY_TIME + 1)
        self.assertTrue(self.session.check_timeout())
        self.assertTrue(self.session.finished)

    def test_chain_scores_and_keeps_count(self):
        result = self.session.act_chain(self._chain_ids(3))
        self.assertTrue(result["ok"], result.get("error"))
        self.assertGreater(result["gained"], 0)
        self.assertEqual(len(result["board"]), self.session.board.count)
        self.assertEqual(self.session.combo, 1)

    def test_invalid_chain_scores_nothing(self):
        before = self.session.score
        result = self.session.act_chain([1])
        self.assertFalse(result["ok"])
        self.assertEqual(self.session.score, before)

    def test_combo_breaks_after_hold(self):
        self.session.act_chain(self._chain_ids(3))
        self.assertEqual(self.session.combo, 1)
        self.clock.advance(rules.COMBO_HOLD + 0.5)
        self.assertEqual(self.session.state()["combo"], 0)

    def test_skill_requires_gauge(self):
        result = self.session.act_skill()
        self.assertFalse(result["ok"])
        self.assertIn("ゲージ", result["error"])

    def test_skill_fires_when_ready(self):
        self.session.skill_ready = True
        result = self.session.act_skill()
        self.assertTrue(result["ok"])
        self.assertEqual(self.session.skills_used, 1)
        self.assertFalse(self.session.skill_ready)
        self.assertEqual(len(result["board"]), self.session.board.count)

    def test_every_skill_runs(self):
        for character in characters.CHARACTERS:
            clock = FakeClock()
            session = GameSession(character.id, level=4, height=1080.0,
                                  seed=99, clock=clock)
            session.start()
            session.skill_ready = True
            result = session.act_skill()
            self.assertTrue(result["ok"], f"{character.id} のスキルが失敗しました")
            self.assertEqual(len(result["board"]), session.board.count,
                             f"{character.id} のあと盤面の数が合いません")

    def test_time_bomb_adds_time(self):
        board = self.session.board
        bomb = board.spawn_bomb(270, 800, time_bomb=True)
        board.settle()
        before = self.session.time_left
        result = self.session.act_bomb(bomb.id)
        self.assertTrue(result["ok"], result.get("error"))
        self.assertGreater(self.session.time_left, before)

    def test_bomb_clears_area(self):
        board = self.session.board
        bomb = board.spawn_bomb(270, 850, time_bomb=False)
        board.settle()
        result = self.session.act_bomb(bomb.id)
        self.assertTrue(result["ok"], result.get("error"))
        self.assertGreater(len(result["cleared"]), 0)

    def test_long_chain_makes_bomb(self):
        ids = self._long_chain(board_mod.BOMB_CHAIN)
        result = self.session.act_chain(ids)
        self.assertTrue(result["ok"], result.get("error"))
        self.assertIsNotNone(result["bomb_id"])
        kinds = [item.get("k") for item in result["board"]]
        self.assertIn("b", kinds)

    def test_fever_starts_when_gauge_fills(self):
        self.session.fever_gauge = rules.FEVER_NEED - 1
        self.session.act_chain(self._chain_ids(3))
        self.assertTrue(self.session.in_fever)
        self.assertEqual(self.session.fever_count, 1)

    def test_result_has_coins_and_exp(self):
        self.session.act_chain(self._chain_ids(3))
        result = self.session.finish()
        self.assertIn("coins", result)
        self.assertIn("exp", result)
        self.assertEqual(result["char_id"], "zou")

    def test_actions_blocked_after_finish(self):
        self.clock.advance(rules.PLAY_TIME + 1)
        result = self.session.act_chain(self._chain_ids(3))
        self.assertFalse(result["ok"])

    def _long_chain(self, n):
        board = self.session.board
        best = []
        for start in board.tsums():
            chain = [start]
            seen = {start.id}
            while len(chain) < n:
                nxt = [c for c in board.neighbors_of(chain[-1]) if c.id not in seen]
                if not nxt:
                    break
                chain.append(nxt[0])
                seen.add(nxt[0].id)
            if len(chain) > len(best):
                best = chain
            if len(best) >= n:
                break
        if len(best) < n:
            self.skipTest(f"{n} 個つながるツムが見つかりませんでした")
        return [b.id for b in best]


if __name__ == "__main__":
    unittest.main()
