"""1 プレイぶんのゲームセッション.

時間・コンボ・フィーバー・スキルゲージなど、
「いま何が起きているか」はすべてサーバー側のこのオブジェクトが持つ。
クライアントは表示するだけなので、スコアを書き換えても効かない。
"""

from __future__ import annotations

import random
import time
import uuid
from typing import Dict, List, Optional, Sequence

from . import board as board_mod
from . import characters, rules, skills
from .board import Board


class GameSession:
    def __init__(self, char_id: str, level: int = 0, height: float = 1080.0,
                 seed: Optional[int] = None, clock=time.monotonic):
        self.id = uuid.uuid4().hex
        self.char = characters.get(char_id)
        self.level = max(0, min(characters.MAX_LEVEL - 1, level))
        self.clock = clock
        self.rng = random.Random(seed)

        self.deck: List[str] = board_mod.build_deck(char_id, self.rng)
        self.board = Board(self.deck, height=height, seed=self.rng.randrange(1 << 30))

        self.score = 0
        self.combo = 0
        self.max_combo = 0
        self.last_clear_at = -999.0

        self.tsum_cleared = 0
        self.own_cleared = 0
        self.chain_count = 0
        self.bombs_used = 0
        self.skills_used = 0
        self.fever_count = 0

        self.skill_gauge = 0
        self.skill_need = self.char.skill.need[self.level]
        self.skill_ready = False

        self.fever_gauge = 0
        self.fever_until = 0.0

        self.time_bonus = 0.0
        self.started_at: Optional[float] = None
        self.finished = False
        self.finished_at: Optional[float] = None

    # ---------------------------------------------------------------- 時間

    def start(self) -> None:
        """カウントダウンが終わった瞬間に呼ぶ。"""
        if self.started_at is None:
            self.started_at = self.clock()

    @property
    def elapsed(self) -> float:
        if self.started_at is None:
            return 0.0
        end = self.finished_at if self.finished_at is not None else self.clock()
        return end - self.started_at

    @property
    def time_left(self) -> float:
        if self.started_at is None:
            return rules.PLAY_TIME
        return max(0.0, rules.PLAY_TIME + self.time_bonus - self.elapsed)

    @property
    def in_fever(self) -> bool:
        return not self.finished and self.clock() < self.fever_until

    def add_time(self, seconds: float) -> None:
        total = rules.PLAY_TIME + self.time_bonus + seconds
        capped = min(total, rules.MAX_TIME + self.elapsed)
        self.time_bonus = capped - rules.PLAY_TIME

    def _sync_combo(self) -> None:
        if self.combo and self.clock() - self.last_clear_at > rules.COMBO_HOLD:
            self.combo = 0

    def check_timeout(self) -> bool:
        """時間切れなら終了させる。"""
        if not self.finished and self.started_at is not None and self.time_left <= 0.0:
            self.finish()
        return self.finished

    # ---------------------------------------------------------------- 消去の共通処理

    def _apply_clear(self, bodies, source: str) -> Dict:
        info = self.board.clear(bodies)
        if not info["cleared"]:
            return {"gained": 0, **info}

        self._sync_combo()
        self.combo += 1
        self.max_combo = max(self.max_combo, self.combo)
        self.last_clear_at = self.clock()

        fever = self.in_fever
        gained = rules.chain_score(info["units"], self.combo, fever)
        self.score += gained
        self.tsum_cleared += info["cleared"]

        own = info["by_char"].get(self.char.id, 0)
        self.own_cleared += own

        if not self.skill_ready:
            self.skill_gauge = min(self.skill_need, self.skill_gauge + own)
            if self.skill_gauge >= self.skill_need:
                self.skill_ready = True

        fever_started = False
        if not fever:
            self.fever_gauge += info["units"]
            if self.fever_gauge >= rules.FEVER_NEED:
                self._start_fever()
                fever_started = True

        return {"gained": gained, "fever_started": fever_started,
                "source": source, **info}

    def _start_fever(self) -> None:
        self.fever_gauge = rules.FEVER_NEED
        self.fever_until = self.clock() + rules.FEVER_TIME
        self.fever_count += 1
        self.add_time(rules.FEVER_TIME_BONUS)

    # ---------------------------------------------------------------- 操作

    def act_chain(self, ids: Sequence[int]) -> Dict:
        if self.check_timeout():
            return {"ok": False, "error": "じかんぎれです", "state": self.state()}

        ok, message, bodies = self.board.validate_chain(ids)
        if not ok:
            return {"ok": False, "error": message, "state": self.state()}

        count = len(bodies)
        result = self._apply_clear(bodies, "chain")
        self.chain_count += 1

        effects: List[Dict] = []
        bomb = None
        if count >= board_mod.BOMB_CHAIN and result["center"]:
            cx, cy = result["center"]
            time_bomb = count >= board_mod.TIME_BOMB_CHAIN
            bomb = self.board.spawn_bomb(cx, cy, time_bomb)
            effects.append({"fx": "bomb_born", "x": round(cx, 1), "y": round(cy, 1),
                            "time": time_bomb})

        self.board.refill()
        self.board.settle()
        return {
            "ok": True,
            "gained": result["gained"],
            "cleared": result["positions"],
            "effects": effects,
            "bomb_id": bomb.id if bomb else None,
            "state": self.state(),
            "board": self.board.snapshot(),
        }

    def act_bomb(self, bomb_id: int) -> Dict:
        if self.check_timeout():
            return {"ok": False, "error": "じかんぎれです", "state": self.state()}

        bomb = self.board.by_id(bomb_id)
        if bomb is None or bomb.kind != "bomb":
            return {"ok": False, "error": "そのボムは ありません", "state": self.state()}

        targets = self.board.bomb_targets(bomb)
        radius = (board_mod.TIME_BOMB_RADIUS if bomb.time_bomb
                  else board_mod.BOMB_RADIUS)
        effects = [
            {"fx": "ring", "x": round(bomb.x, 1), "y": round(bomb.y, 1),
             "r": radius, "color": "#4FD1C5" if bomb.time_bomb else "#FFB03A"},
            {"fx": "shake", "power": 14},
        ]
        added = 0.0
        if bomb.time_bomb:
            self.add_time(rules.TIME_BOMB_BONUS)
            added = rules.TIME_BOMB_BONUS
            effects.append({"fx": "time", "sec": rules.TIME_BOMB_BONUS})

        self.board.world.remove(bomb)
        self.bombs_used += 1
        result = self._apply_clear(targets, "bomb")

        self.board.refill()
        self.board.settle()
        return {
            "ok": True,
            "gained": result.get("gained", 0),
            "cleared": result.get("positions", []),
            "effects": effects,
            "time_added": added,
            "state": self.state(),
            "board": self.board.snapshot(),
        }

    def act_skill(self) -> Dict:
        if self.check_timeout():
            return {"ok": False, "error": "じかんぎれです", "state": self.state()}
        if not self.skill_ready:
            return {"ok": False, "error": "スキルゲージが まだです",
                    "state": self.state()}

        self.skill_ready = False
        self.skill_gauge = 0
        self.skills_used += 1

        power = self.char.skill.power[self.level]
        targets, effects, extra_time = skills.run(
            self.char.skill.id, self.board, power, self.char.body)

        if extra_time:
            self.add_time(extra_time)
            effects.append({"fx": "time", "sec": extra_time})
        effects.append({"fx": "label", "text": self.char.skill.name})

        result = self._apply_clear(targets, "skill") if targets else {"gained": 0,
                                                                      "positions": []}
        self.board.refill()
        self.board.settle()
        return {
            "ok": True,
            "gained": result.get("gained", 0),
            "cleared": result.get("positions", []),
            "effects": effects,
            "state": self.state(),
            "board": self.board.snapshot(),
        }

    # ---------------------------------------------------------------- 状態

    def state(self) -> Dict:
        self._sync_combo()
        fever = self.in_fever
        fever_ratio = ((self.fever_until - self.clock()) / rules.FEVER_TIME
                       if fever else self.fever_gauge / rules.FEVER_NEED)
        return {
            "score": self.score,
            "combo": self.combo,
            "max_combo": self.max_combo,
            "time_left": round(self.time_left, 2),
            "fever": fever,
            "fever_ratio": round(max(0.0, min(1.0, fever_ratio)), 3),
            "skill_ratio": round(1.0 if self.skill_ready
                                 else self.skill_gauge / self.skill_need, 3),
            "skill_ready": self.skill_ready,
            "finished": self.finished,
        }

    def finish(self) -> Dict:
        if not self.finished:
            self.finished = True
            self.finished_at = self.clock()
        return self.result()

    def result(self) -> Dict:
        return {
            "char_id": self.char.id,
            "score": self.score,
            "max_combo": self.max_combo,
            "tsum_cleared": self.tsum_cleared,
            "chain_count": self.chain_count,
            "bombs_used": self.bombs_used,
            "skills_used": self.skills_used,
            "fever_count": self.fever_count,
            "coins": rules.coins_earned(self.score, self.max_combo),
            "exp": rules.exp_earned(self.own_cleared, self.score),
        }
