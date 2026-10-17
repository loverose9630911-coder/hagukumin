"""ホーム画面用のアイコンを作る。

藍色の地に、横から見た路線バスを描く（車体は白、窓は濃い藍、朱の帯）。
1024px で描いて、iPhone 用（180px）と manifest 用（192px・512px）に縮小して icons/ に書き出す。
会社のロゴや商標は使わない。

使い方:  python3 tools/make_icons.py
"""
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "icons")

INDIGO = (35, 66, 124)
BODY = (243, 245, 248)
GLASS = (22, 40, 76)
SHU = (191, 59, 38)
TIRE = (26, 36, 50)
HUB = (211, 218, 227)
SIZE = 1024


def draw_icon():
    img = Image.new("RGB", (SIZE, SIZE), INDIGO)
    d = ImageDraw.Draw(img)

    # 車体（右が前）
    d.rounded_rectangle((140, 300, 884, 670), radius=64, fill=BODY)
    # 側面の窓 4 枚と、前の大きな窓
    for i in range(4):
        x = 190 + i * 140
        d.rounded_rectangle((x, 350, x + 118, 500), radius=18, fill=GLASS)
    d.rounded_rectangle((770, 350, 846, 560), radius=22, fill=GLASS)
    # 朱の帯
    d.rectangle((140, 560, 760, 600), fill=SHU)
    # タイヤ（車体を切り欠いてから描く）
    for cx in (300, 724):
        d.ellipse((cx - 96, 670 - 96, cx + 96, 670 + 96), fill=INDIGO)
        d.ellipse((cx - 78, 670 - 78, cx + 78, 670 + 78), fill=TIRE)
        d.ellipse((cx - 30, 670 - 30, cx + 30, 670 + 30), fill=HUB)
    # 前照灯
    d.rounded_rectangle((850, 600, 884, 630), radius=8, fill=(255, 214, 102))
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    big = draw_icon()
    for name, px in (("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)):
        big.resize((px, px), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)
        print("wrote", name, px)


if __name__ == "__main__":
    main()
