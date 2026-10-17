"""おもいでプリントのアイコンを描く（Pillow だけで作る。画像素材は使わない）

    python3 tools/make_omoide_icons.py

絵柄: にこにこ顔のプリンターから、写真（空・丘・ハート・オレンジの日付）が出てくるところ。
大事な部分は中心から半径 40% の内側に収めているので、Android の丸いアイコン（maskable）でも欠けない。

suuji-nazori/print/img/ に次を書き出す。
  icon-512.png / icon-192.png   ホーム画面・PWA 用（maskable 兼用）
  apple-touch-icon.png (180)    iPhone のホーム画面用
  favicon-32.png                ブラウザのタブ用
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "suuji-nazori" / "print" / "img"
S = 1024
CORAL = (242, 112, 78)
CORAL_DARK = (214, 88, 58)
CREAM = (255, 244, 228)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def background():
    img = Image.new("RGB", (S, S))
    d = ImageDraw.Draw(img)
    top, bottom = (255, 205, 175), CREAM
    for y in range(S):
        d.line([(0, y), (S, y)], fill=lerp(top, bottom, y / (S - 1)))
    return img.convert("RGBA")


def photo(w, h):
    """白いフチの写真1枚（空・太陽・丘・ハート・日付）"""
    card = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    m = int(w * 0.075)
    iw, ih = w - 2 * m, h - 2 * m
    im = Image.new("RGBA", (iw, ih))
    d = ImageDraw.Draw(im)
    for y in range(ih):
        d.line([(0, y), (iw, y)], fill=lerp((116, 192, 240), (206, 236, 252), y / ih) + (255,))
    d.ellipse([iw * 0.68, ih * 0.10, iw * 0.92, ih * 0.10 + iw * 0.24], fill=(255, 206, 64, 255))
    d.ellipse([-iw * 0.35, ih * 0.58, iw * 0.75, ih * 1.55], fill=(124, 198, 112, 255))
    d.ellipse([iw * 0.30, ih * 0.68, iw * 1.45, ih * 1.65], fill=(92, 172, 92, 255))
    cx, cy, r = iw * 0.32, ih * 0.38, iw * 0.09
    d.ellipse([cx - 2 * r, cy - r, cx, cy + r], fill=CORAL + (255,))
    d.ellipse([cx, cy - r, cx + 2 * r, cy + r], fill=CORAL + (255,))
    d.polygon([(cx - 1.95 * r, cy + 0.25 * r), (cx + 1.95 * r, cy + 0.25 * r), (cx, cy + 2.3 * r)], fill=CORAL + (255,))
    d.rounded_rectangle([iw * 0.60, ih * 0.84, iw * 0.92, ih * 0.90], radius=6, fill=(255, 154, 46, 255))
    card.paste(im, (m, m))
    return card


def shadow_of(layer, blur, alpha):
    sh = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    sh.paste((90, 45, 25, alpha), mask=layer.split()[3])
    return sh.filter(ImageFilter.GaussianBlur(blur))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    img = background()

    # 写真（プリンターの上から出てくる。少しかたむける）
    pw, ph = 430, 470
    pic = photo(pw, ph).rotate(-4, resample=Image.BICUBIC, expand=True)
    px, py = (S - pic.width) // 2 + 6, 150
    img.alpha_composite(shadow_of(pic, 16, 60), (px + 8, py + 16))
    img.alpha_composite(pic, (px, py))

    # プリンター本体
    body = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(body)
    x0, x1, top, bot = 196, 828, 540, 846
    d.rounded_rectangle([x0, top, x1, bot], radius=96, fill=CORAL + (255,))
    d.rounded_rectangle([x0 + 70, top - 18, x1 - 70, top + 40], radius=26, fill=CORAL_DARK + (255,))  # 紙の出口
    d.rounded_rectangle([x0 + 110, bot - 92, x1 - 110, bot - 50], radius=21, fill=(255, 255, 255, 235))  # 用紙トレイ
    # にこにこ顔
    ey = top + 120
    for ex in (420, 604):
        d.ellipse([ex - 26, ey - 30, ex + 26, ey + 30], fill=(58, 46, 40, 255))
        d.ellipse([ex - 10, ey - 20, ex + 6, ey - 4], fill=(255, 255, 255, 255))
    d.arc([462, ey + 8, 562, ey + 78], start=20, end=160, fill=(58, 46, 40, 255), width=16)
    for cx in (360, 664):  # ほっぺ
        d.ellipse([cx - 34, ey + 30, cx + 34, ey + 62], fill=(255, 168, 150, 255))
    img.alpha_composite(shadow_of(body, 22, 70), (0, 18))
    img.alpha_composite(body)

    img = img.convert("RGB")
    for name, size in [("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180), ("favicon-32.png", 32)]:
        img.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
        print("wrote", OUT / name)


if __name__ == "__main__":
    main()
