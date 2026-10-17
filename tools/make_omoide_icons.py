"""おもいでプリントのアイコンを描く（Pillow だけで作る。画像素材は使わない）

    python3 tools/make_omoide_icons.py

suuji-nazori/print/img/ に icon-512 / icon-192 / apple-touch-icon(180) / favicon-32 を書き出す。
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "suuji-nazori" / "print" / "img"
S = 1024


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def background():
    img = Image.new("RGB", (S, S))
    top, bottom = (255, 214, 186), (255, 244, 228)
    px = img.load()
    for y in range(S):
        c = lerp(top, bottom, y / (S - 1))
        for x in range(S):
            px[x, y] = c
    return img.convert("RGBA")


def photo_card(w, h, scene):
    """白いフチの写真1枚"""
    card = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    m = int(w * 0.07)
    inner = scene(w - 2 * m, int(h * 0.80) - m)
    card.paste(inner, (m, m))
    return card


def scene_day(w, h):
    im = Image.new("RGBA", (w, h), (150, 210, 245, 255))
    d = ImageDraw.Draw(im)
    for y in range(h):  # 空のグラデーション
        d.line([(0, y), (w, y)], fill=lerp((120, 195, 240), (205, 236, 252), y / h) + (255,))
    d.ellipse([w * 0.66, h * 0.10, w * 0.90, h * 0.10 + w * 0.24], fill=(255, 205, 60, 255))  # 太陽
    d.ellipse([-w * 0.3, h * 0.62, w * 0.8, h * 1.5], fill=(120, 196, 110, 255))  # 丘
    d.ellipse([w * 0.35, h * 0.70, w * 1.4, h * 1.6], fill=(92, 172, 92, 255))
    # 小さなハート
    cx, cy, r = w * 0.30, h * 0.42, w * 0.085
    d.ellipse([cx - 2 * r, cy - r, cx, cy + r], fill=(242, 112, 78, 255))
    d.ellipse([cx, cy - r, cx + 2 * r, cy + r], fill=(242, 112, 78, 255))
    d.polygon([(cx - 1.95 * r, cy + 0.25 * r), (cx + 1.95 * r, cy + 0.25 * r), (cx, cy + 2.3 * r)], fill=(242, 112, 78, 255))
    # フィルム風の日付
    d.rectangle([w * 0.62, h * 0.86, w * 0.92, h * 0.91], fill=(255, 154, 46, 255))
    return im


def scene_sea(w, h):
    im = Image.new("RGBA", (w, h), (255, 226, 170, 255))
    d = ImageDraw.Draw(im)
    for y in range(h):
        d.line([(0, y), (w, y)], fill=lerp((255, 200, 150), (255, 236, 200), y / h) + (255,))
    d.rectangle([0, h * 0.62, w, h], fill=(110, 180, 220, 255))
    d.ellipse([w * 0.18, h * 0.20, w * 0.48, h * 0.20 + w * 0.30], fill=(255, 150, 90, 255))
    return im


def place(base, card, angle, cx, cy):
    rot = card.rotate(angle, resample=Image.BICUBIC, expand=True)
    shadow = Image.new("RGBA", rot.size, (0, 0, 0, 0))
    shadow.paste((90, 50, 30, 70), mask=rot.split()[3])
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    x, y = int(cx - rot.width / 2), int(cy - rot.height / 2)
    base.alpha_composite(shadow, (x + 10, y + 22))
    base.alpha_composite(rot, (x, y))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    img = background()
    back = photo_card(470, 560, scene_sea)
    front = photo_card(500, 600, scene_day)
    place(img, back, 12, S * 0.40, S * 0.47)
    place(img, front, -7, S * 0.57, S * 0.54)
    img = img.convert("RGB")
    for name, size in [("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180), ("favicon-32.png", 32)]:
        img.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
        print("wrote", OUT / name)


if __name__ == "__main__":
    main()
