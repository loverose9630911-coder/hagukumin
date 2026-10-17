"""ホーム画面用のアイコンを作る。

街を走る水色のノンステップ路線バスを、正面から描く。
大きな前面ガラス、上の行き先表示と車いすマーク、左右に張り出したミラー、
横長の前照灯。背景は青い空とビル、下は道路。
2048px で描いて縮小し（線のギザギザを消すため）、
iPhone 用（180px）と manifest 用（192px・512px）を icons/ に書き出す。
会社のロゴ・車名・写真は使わない（すべて一から描いた絵）。

使い方:  python3 tools/make_icons.py
"""
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "icons")

SKY_TOP = (58, 98, 168)
SKY_BOTTOM = (176, 200, 228)
TOWER = (120, 148, 190)
TOWER_WIN = (150, 176, 212)
ROAD = (44, 50, 62)
BODY = (168, 200, 236)
BODY_LIGHT = (196, 220, 246)
BODY_DARK = (122, 156, 198)
GLASS = (24, 40, 64)
SIGN = (20, 26, 36)
LED = (255, 178, 60)
ACCESS = (40, 104, 200)
LAMP_HOUSING = (40, 50, 68)
LAMP = (238, 244, 252)
AMBER = (245, 166, 58)
TIRE = (22, 26, 34)
SIZE = 1024
K = 2  # 描くときの倍率


def P(*pts):
    return [(x * K, y * K) for x, y in pts]


def draw_icon():
    W = SIZE * K
    img = Image.new("RGBA", (W, W))
    d = ImageDraw.Draw(img)

    # 空とビル
    for y in range(W):
        t = y / (W - 1)
        d.line((0, y, W, y), fill=tuple(round(a + (b - a) * t) for a, b in zip(SKY_TOP, SKY_BOTTOM)))
    for x0, x1, top in ((0, 150, 260), (120, 230, 380), (800, 930, 300), (900, 1024, 200)):
        d.rectangle(P((x0, top), (x1, 900)), fill=TOWER)
        for wy in range(top + 30, 880, 46):
            d.rectangle(P((x0 + 16, wy), (x1 - 16, wy + 16)), fill=TOWER_WIN)
    # 道路
    d.rectangle(P((0, 880), (1024, 1024)), fill=ROAD)
    d.rectangle(P((0, 876), (1024, 884)), fill=(200, 208, 220))

    fx = Image.new("RGBA", (W, W))
    f = ImageDraw.Draw(fx)
    f.ellipse(P((200, 868), (824, 924)), fill=(0, 0, 0, 120))
    img.alpha_composite(fx)
    d = ImageDraw.Draw(img)

    # タイヤ（車体の下からのぞく）
    for x in (262, 682):
        d.rounded_rectangle(P((x, 830), (x + 80, 900)), radius=14 * K, fill=TIRE)

    # 車体（正面）
    d.rounded_rectangle(P((226, 150), (798, 872)), radius=60 * K, fill=BODY)
    # 左の角に光、右の角に影を入れて丸みを出す
    d.rounded_rectangle(P((240, 190), (282, 840)), radius=20 * K, fill=BODY_LIGHT)
    d.rounded_rectangle(P((742, 190), (784, 840)), radius=20 * K, fill=(150, 184, 224))
    d.rounded_rectangle(P((226, 150), (798, 872)), radius=60 * K, outline=BODY_DARK, width=6 * K)

    # 行き先表示と車いすマーク
    d.rounded_rectangle(P((272, 188), (752, 262)), radius=10 * K, fill=SIGN)
    for i, x in enumerate(range(296, 600, 38)):
        d.rounded_rectangle(P((x, 212), (x + 26, 238)), radius=4 * K, fill=LED)
    d.rounded_rectangle(P((672, 194), (744, 256)), radius=8 * K, fill=ACCESS)
    wc = (255, 255, 255)
    d.ellipse(P((700, 202), (714, 216)), fill=wc)                                # 頭
    d.line(P((706, 218), (704, 236), (724, 236), (730, 250)), fill=wc, width=6 * K)  # 体と脚
    d.arc(P((690, 228), (718, 256)), 60, 330, fill=wc, width=5 * K)              # 車輪

    # 大きな前面ガラス（真ん中に細い柱）
    d.rounded_rectangle(P((256, 278), (768, 610)), radius=24 * K, fill=GLASS)
    gl = Image.new("RGBA", (W, W))
    g = ImageDraw.Draw(gl)
    for x, w in ((300, 70), (420, 30), (600, 60)):
        g.polygon(P((x + 60, 282), (x + 60 + w, 282), (x + w - 40, 606), (x - 40, 606)), fill=(170, 205, 255, 50))
    img.alpha_composite(gl)
    d = ImageDraw.Draw(img)
    d.rectangle(P((508, 278), (516, 610)), fill=BODY_DARK)
    # ガラスの下の黒い縁取り（真ん中に向かって少し下がる）
    d.polygon(P((256, 604), (768, 604), (740, 640), (512, 668), (284, 640)), fill=LAMP_HOUSING)
    # ワイパー
    d.line(P((440, 600), (372, 452)), fill=(10, 14, 22), width=7 * K)
    d.line(P((610, 600), (678, 452)), fill=(10, 14, 22), width=7 * K)

    # 左右に張り出したミラー
    for side in (-1, 1):
        x0 = 226 if side < 0 else 798
        arm = P((x0, 190), (x0 + side * 46, 196), (x0 + side * 62, 236))
        d.line(arm, fill=(40, 48, 64), width=9 * K, joint="curve")
        mx = x0 + side * 62
        d.rounded_rectangle(P((min(mx - 18, mx + 18), 236), (max(mx - 18, mx + 18), 330)), radius=10 * K, fill=(40, 48, 64))

    # 下の部分：前照灯と方向指示器、真ん中は無地のプレート
    for x0, x1, ax in ((266, 400, 270), (624, 758, 734)):
        d.rounded_rectangle(P((x0, 700), (x1, 752)), radius=12 * K, fill=LAMP_HOUSING)
        d.rounded_rectangle(P((x0 + 14, 710), (x0 + 58, 742)), radius=8 * K, fill=LAMP)
        d.rounded_rectangle(P((x1 - 58, 710), (x1 - 14, 742)), radius=8 * K, fill=LAMP)
        d.rounded_rectangle(P((ax - 4 if ax < 512 else ax - 16, 766), (ax + 16 if ax < 512 else ax + 4, 784)), radius=4 * K, fill=AMBER)
    d.rounded_rectangle(P((452, 742), (572, 790)), radius=8 * K, fill=(240, 244, 250))
    # バンパー
    d.rounded_rectangle(P((226, 818), (798, 872)), radius=26 * K, fill=BODY_DARK)
    return img.convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    big = draw_icon()
    for name, px in (("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)):
        big.resize((px, px), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)
        print("wrote", name, px)


if __name__ == "__main__":
    main()
