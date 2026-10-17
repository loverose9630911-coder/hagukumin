"""ホーム画面用のアイコンを作る。

承認欄の枠に、朱の「済」印が押された絵を 1024px で描き、
iPhone 用（180px）と manifest 用（192px・512px）に縮小して icons/ に書き出す。

使い方:  python3 tools/make_icons.py
（日本語フォントの場所が違う環境では --font でフォントファイルを指定する）
"""
import argparse
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "icons")

PAPER = (243, 245, 248)
INK = (26, 36, 50)
SHU = (191, 59, 38)
SIZE = 1024


def centered_text(draw, box, text, font, fill, stroke=0):
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font, stroke_width=stroke)
    w, h = right - left, bottom - top
    x = box[0] + (box[2] - box[0] - w) / 2 - left
    y = box[1] + (box[3] - box[1] - h) / 2 - top
    draw.text((x, y), text, font=font, fill=fill, stroke_width=stroke, stroke_fill=fill)


def draw_icon(font_path):
    img = Image.new("RGB", (SIZE, SIZE), PAPER)
    d = ImageDraw.Draw(img)

    # 承認欄の枠（上の帯に「購買」）
    frame = (170, 150, 854, 874)
    d.rectangle(frame, outline=INK, width=28)
    d.line((frame[0], 310, frame[2], 310), fill=INK, width=20)
    centered_text(d, (frame[0], frame[1], frame[2], 310), "購買", ImageFont.truetype(font_path, 104), INK, stroke=2)

    # 朱の「済」印（左に少し傾ける）
    stamp = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    s = ImageDraw.Draw(stamp)
    cx, cy, r = 512, 512, 220
    s.ellipse((cx - r, cy - r, cx + r, cy + r), outline=SHU + (255,), width=30)
    centered_text(s, (cx - r, cy - r, cx + r, cy + r), "済", ImageFont.truetype(font_path, 270), SHU + (255,), stroke=7)
    stamp = stamp.rotate(12, resample=Image.BICUBIC, center=(cx, cy))
    img.paste(stamp, (0, 80), stamp)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", default="/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf")
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    big = draw_icon(args.font)
    for name, px in (("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)):
        big.resize((px, px), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)
        print("wrote", name, px)


if __name__ == "__main__":
    main()
