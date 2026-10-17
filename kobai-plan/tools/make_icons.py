"""ホーム画面用のアイコンを作る。

夜明け前の藍色の空を背景に、斜めに切れ込んだ大きな前面ガラスと、
朱と金の帯を流した大型バス（右向き）を描く。後ろには走る線を入れる。
2048px で描いて縮小し（線のギザギザを消すため）、
iPhone 用（180px）と manifest 用（192px・512px）を icons/ に書き出す。
会社のロゴや商標は使わない。

使い方:  python3 tools/make_icons.py
"""
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "icons")

SKY_TOP = (10, 20, 46)
SKY_BOTTOM = (40, 74, 140)
ROAD = (14, 24, 48)
BODY = (244, 246, 250)
BODY_SHADE = (205, 213, 226)
GLASS = (12, 22, 46)
SHU = (214, 66, 42)
GOLD = (242, 180, 64)
TIRE = (16, 22, 34)
RIM = (201, 210, 222)
LAMP = (255, 228, 140)
SIZE = 1024
K = 2  # 描くときの倍率
DY = -50  # 絵全体を上下にずらす量（バスがアイコンの真ん中に来るように）


def P(*pts):
    return [(x * K, (y + DY) * K) for x, y in pts]


def draw_icon():
    W = SIZE * K
    img = Image.new("RGBA", (W, W))
    d = ImageDraw.Draw(img)

    # 空（上から下へだんだん明るく）と道路
    for y in range(W):
        t = y / (W - 1)
        d.line((0, y, W, y), fill=tuple(round(a + (b - a) * t) for a, b in zip(SKY_TOP, SKY_BOTTOM)))
    d.rectangle(P((0, 760), (1024, 1100)), fill=ROAD)
    d.rectangle(P((0, 758), (1024, 764)), fill=(70, 100, 160))

    fx = Image.new("RGBA", (W, W))
    f = ImageDraw.Draw(fx)
    # 走る線
    for y0, x0, x1 in ((420, 20, 120), (500, 0, 100), (580, 40, 110)):
        f.rounded_rectangle(P((x0, y0), (x1, y0 + 14)), radius=7 * K, fill=(255, 255, 255, 120))
    # 車体の影
    f.ellipse(P((110, 735), (920, 790)), fill=(0, 0, 0, 110))
    img.alpha_composite(fx)

    d = ImageDraw.Draw(img)
    # 車体：後ろは丸く、前は斜めに切れ込んだ大型バス
    body = P((150, 300), (770, 300), (800, 306), (880, 430), (898, 560), (898, 690),
             (880, 712), (140, 712), (118, 690), (118, 340), (130, 312))
    d.polygon(body, fill=BODY)
    # 下の方を少し暗くして厚みを出す
    d.polygon(P((118, 650), (898, 650), (898, 690), (880, 712), (140, 712), (118, 690)), fill=BODY_SHADE)
    # ひと続きの窓（前面ガラスまでつながる）
    d.polygon(P((160, 350), (765, 350), (790, 356), (858, 456), (868, 520), (160, 520)), fill=GLASS)
    # 前面の行き先表示
    d.rounded_rectangle(P((774, 366), (826, 384)), radius=4 * K, fill=(255, 176, 60))
    # 窓に映る光
    gl = Image.new("RGBA", (W, W))
    g = ImageDraw.Draw(gl)
    for x in (300, 520, 700):
        g.polygon(P((x, 352), (x + 40, 352), (x - 40, 518), (x - 80, 518)), fill=(150, 190, 255, 55))
    img.alpha_composite(gl)
    d = ImageDraw.Draw(img)
    # 朱と金の帯（後ろから前へ流れるように上がる）
    d.polygon(P((118, 600), (560, 600), (898, 548), (898, 580), (560, 634), (118, 634)), fill=SHU)
    d.polygon(P((118, 578), (540, 578), (898, 526), (898, 540), (545, 592), (118, 592)), fill=GOLD)
    # 前照灯と尾灯
    d.polygon(P((862, 640), (898, 628), (898, 650), (866, 656)), fill=LAMP)
    d.rounded_rectangle(P((118, 560), (132, 620)), radius=5 * K, fill=(230, 40, 40))
    # 前に張り出したミラー
    d.line(P((800, 318), (900, 330), (918, 372)), fill=BODY_SHADE, width=9 * K, joint="curve")
    d.rounded_rectangle(P((906, 362), (930, 420)), radius=8 * K, fill=BODY_SHADE)
    # タイヤ（タイヤハウスの影 → タイヤ → ホイール）
    for cx in (290, 712):
        cy = 712
        d.pieslice(P((cx - 92, cy - 92), (cx + 92, cy + 92)), 180, 360, fill=(20, 30, 54))
        d.ellipse(P((cx - 74, cy - 74), (cx + 74, cy + 74)), fill=TIRE)
        d.ellipse(P((cx - 44, cy - 44), (cx + 44, cy + 44)), fill=RIM)
        d.ellipse(P((cx - 16, cy - 16), (cx + 16, cy + 16)), fill=(100, 112, 130))
    return img.convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    big = draw_icon()
    for name, px in (("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)):
        big.resize((px, px), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)
        print("wrote", name, px)


if __name__ == "__main__":
    main()
