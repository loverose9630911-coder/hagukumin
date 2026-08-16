"""キャラクターのマスタ定義.

生成AIで制作したオリジナル動物キャラクター 6 匹をゲーム用に定義する。
ここが色・スキル・価格の唯一の情報源で、PHP 側とブラウザ側は
``export_config.py`` が書き出した JSON を読むだけになる。
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional


@dataclass(frozen=True)
class Skill:
    """キャラクターのスキル.

    need / power はレベル 1〜5 に対応する 5 要素のリスト。
    """

    id: str            # skills.py の効果 ID
    name: str
    desc: str
    need: List[int]    # 発動に必要な「自分のツム」の数
    power: List[float]  # 効果量（半径・帯の太さ・個数など、効果ごとに意味が違う）


@dataclass(frozen=True)
class Character:
    id: str
    name: str
    tagline: str
    kind: str          # 描画用の種族 ID（PHP の描画側が分岐に使う）
    body: str          # 本体色
    shade: str         # 影・輪郭色
    inner: str         # 耳の内側・おなかの色
    cheek: str         # ほっぺの色
    accent: str        # 帽子・小物の色
    price: int
    skill: Skill
    index: int = field(default=0)

    def to_dict(self) -> Dict:
        d = asdict(self)
        return d


#: レベル 1〜5 に上がるまでの累積経験値
EXP_TABLE = [0, 300, 900, 2000, 4200]

MAX_LEVEL = len(EXP_TABLE)


def level_from_exp(exp: int) -> int:
    """経験値から内部レベル (0〜4 ＝ 表示 Lv.1〜Lv.5) を返す。"""
    level = 0
    for i, need in enumerate(EXP_TABLE):
        if exp >= need:
            level = i
    return level


def exp_to_next(exp: int) -> Optional[Dict[str, int]]:
    """次のレベルまでの進捗。最大レベルなら None。"""
    level = level_from_exp(exp)
    if level >= MAX_LEVEL - 1:
        return None
    return {
        "cur": exp - EXP_TABLE[level],
        "need": EXP_TABLE[level + 1] - EXP_TABLE[level],
    }


CHARACTERS: List[Character] = [
    Character(
        id="zou",
        name="ぞうさん",
        tagline="あさがおに 水やりする やさしい子",
        kind="elephant",
        body="#B9C4CE", shade="#75858F", inner="#F3AAAA", cheek="#FF9C9C",
        accent="#4A82C4",          # 青白キャップ
        price=0,
        skill=Skill(
            id="rainbow",
            name="にじのシャワー",
            desc="はなから にじを ふきだして よこ一列を 消す",
            need=[22, 20, 18, 16, 14],
            power=[96, 112, 128, 146, 166],   # 帯の高さ(px)
        ),
    ),
    Character(
        id="usagi",
        name="うさちゃん",
        tagline="えんがわで すいかを たべる 人気者",
        kind="rabbit",
        body="#FDFAF4", shade="#C7B6A6", inner="#FFC3CE", cheek="#FF9C9C",
        accent="#E8C98A",          # 麦わら帽子
        price=0,
        skill=Skill(
            id="burst",
            name="すいかバースト",
            desc="まんなかの ツムを まるく まとめて 消す",
            need=[22, 20, 18, 16, 14],
            power=[112, 128, 144, 162, 182],  # 効果半径(px)
        ),
    ),
    Character(
        id="kapibara",
        name="カピバラくん",
        tagline="うきわで かわに ぷかぷか",
        kind="capybara",
        body="#B5865B", shade="#7C5533", inner="#E7D0B4", cheek="#FF9C9C",
        accent="#FFFFFF",          # 頭の白タオル
        price=0,
        skill=Skill(
            id="wave",
            name="ぷかぷかウェーブ",
            desc="たて一列を なみで ながして 消す",
            need=[24, 22, 20, 18, 16],
            power=[112, 128, 144, 162, 182],  # 帯の幅(px)
        ),
    ),
    Character(
        id="kirin",
        name="キリンさん",
        tagline="うみべで ゆうやけを ながめる",
        kind="giraffe",
        body="#F2C464", shade="#B4762E", inner="#FCE2A8", cheek="#FF9C9C",
        accent="#D9483B",          # 赤いバンダナ
        price=600,
        skill=Skill(
            id="cross",
            name="ゆうやけクロス",
            desc="じゅうじに ツムを 消す",
            need=[26, 24, 22, 20, 18],
            power=[86, 98, 110, 124, 140],    # 帯の太さ(px)
        ),
    ),
    Character(
        id="panda",
        name="パンダくん",
        tagline="なつまつりの やたいで ラムネ",
        kind="panda",
        body="#FBFBFB", shade="#3A3A3A", inner="#E9E9E9", cheek="#FF9C9C",
        accent="#E4682E",          # オレンジのオーバーオール
        price=1000,
        skill=Skill(
            id="ramune",
            name="ラムネクラッシュ",
            desc="ランダムに 消して じかんを +3びょう",
            need=[26, 24, 22, 20, 18],
            power=[10, 13, 16, 19, 23],       # 消す数
        ),
    ),
    Character(
        id="beaver",
        name="ビーバーくん",
        tagline="むぎわらぼうしで かわづり",
        kind="beaver",
        body="#9C6C46", shade="#66412A", inner="#DCC0A0", cheek="#FF9C9C",
        accent="#E8C98A",          # 麦わら帽子
        price=1500,
        skill=Skill(
            id="dam",
            name="かわづりダム",
            desc="ツムを 大ツムに そだてる",
            need=[26, 24, 22, 20, 18],
            power=[3, 4, 5, 6, 8],            # 大ツムにする数
        ),
    ),
]

# index を振り直す（定義順＝表示順）
CHARACTERS = [
    Character(**{**asdict(c), "skill": c.skill, "index": i})
    for i, c in enumerate(CHARACTERS)
]

BY_ID: Dict[str, Character] = {c.id: c for c in CHARACTERS}

#: 最初から持っているキャラ
FREE_IDS: List[str] = [c.id for c in CHARACTERS if c.price == 0]

#: アプリアイコンに使うキャラ
ICON_ID = "zou"


def get(char_id: str) -> Character:
    if char_id not in BY_ID:
        raise KeyError(f"unknown character: {char_id}")
    return BY_ID[char_id]


def all_dicts() -> List[Dict]:
    return [c.to_dict() for c in CHARACTERS]
