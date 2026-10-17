"""テスト用の写真を作る（Pillow）。run.sh が、無いときだけ呼ぶ。

撮影日（EXIF）と向き（Orientation）は Pillow で書き込む。
アプリ側の EXIF 読み取りとは別の実装で作るので、読み取りの確認になる。
"""
import random
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent / "fixtures"
EXIF_IFD = 0x8769


def save_jpeg(img, name, date=None, subsec=None, orientation=None):
    exif = Image.Exif()
    if orientation:
        exif[0x0112] = orientation
    if date:
        exif[0x0132] = date
        ifd = exif.get_ifd(EXIF_IFD)
        ifd[0x9003] = date  # DateTimeOriginal
        if subsec:
            ifd[0x9291] = subsec  # SubSecTimeOriginal
    kw = {"quality": 90}
    if len(exif):
        kw["exif"] = exif.tobytes()
    img.save(OUT / name, "JPEG", **kw)


def two_tone(w, h, top, bottom, extra=None):
    im = Image.new("RGB", (w, h), bottom)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w, h // 2], fill=top)
    if extra:
        extra(d, w, h)
    return im


def shapes(w, h, seed):
    rnd = random.Random(seed)
    im = Image.new("RGB", (w, h), (rnd.randint(0, 255), rnd.randint(0, 255), rnd.randint(0, 255)))
    d = ImageDraw.Draw(im)
    for _ in range(14):
        x0, y0 = rnd.randint(0, w), rnd.randint(0, h)
        x1, y1 = x0 + rnd.randint(80, w // 2), y0 + rnd.randint(80, h // 2)
        d.rectangle([x0, y0, x1, y1], fill=(rnd.randint(0, 255), rnd.randint(0, 255), rnd.randint(0, 255)))
    return im


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    # 1) 横長・撮影日あり（上が黄色、下が緑。左に白い丸）
    a = two_tone(1200, 900, (255, 220, 0), (40, 160, 60),
                 lambda d, w, h: d.ellipse([60, 330, 300, 570], fill=(255, 255, 255)))
    save_jpeg(a, "land_exif.jpg", "2026:05:05 10:00:00", "120")

    # 2) 横長・撮影日あり（たてじま）
    b = Image.new("RGB", (1200, 800), (90, 40, 140))
    db = ImageDraw.Draw(b)
    for x in range(0, 1200, 160):
        db.rectangle([x, 0, x + 70, 800], fill=(20, 170, 170))
    save_jpeg(b, "land2_exif.jpg", "2025:12:24 18:30:00", "5")

    # 3) 見た目はたて長（上が赤・下が青）。保存は横長のまま、Orientation=6（右に90°回して表示）
    disp = two_tone(900, 1200, (220, 30, 30), (30, 60, 220),
                    lambda d, w, h: d.line([0, 0, w, h], fill=(0, 0, 0), width=30))
    stored = disp.rotate(90, expand=True)  # 左に90°（表示のときに右へ90°戻る）
    save_jpeg(stored, "portrait_orient6.jpg", "2026:05:05 10:05:00", "0", orientation=6)

    # 4) 連写のつもり: くっきり / ぼやけ（少しずれて、ぼかしたもの）
    base = shapes(1200, 900, 7)
    save_jpeg(base, "dup_sharp.jpg", "2026:05:05 10:10:00", "200")
    blur = Image.new("RGB", base.size)
    blur.paste(base, (3, 2))
    blur = blur.filter(ImageFilter.GaussianBlur(3))
    save_jpeg(blur, "dup_blur.jpg", "2026:05:05 10:10:01", "500")

    # 5) 撮影日なし（たて長・同心円）
    c = Image.new("RGB", (800, 1000), (250, 250, 240))
    dc = ImageDraw.Draw(c)
    for i, r in enumerate(range(480, 0, -60)):
        dc.ellipse([400 - r, 500 - r, 400 + r, 500 + r], fill=(200, 80, 40) if i % 2 else (60, 90, 160))
    save_jpeg(c, "noexif.jpg")

    # 6) PNG（撮影日なし・横長）
    e = Image.new("RGB", (1000, 700))
    de = ImageDraw.Draw(e)
    for x in range(1000):
        de.line([x, 0, x, 700], fill=(x * 255 // 999, 120, 255 - x * 255 // 999))
    de.polygon([(100, 600), (300, 150), (500, 600)], fill=(255, 255, 255))
    e.save(OUT / "other.png")

    print("fixtures:", ", ".join(sorted(p.name for p in OUT.iterdir())))


if __name__ == "__main__":
    main()
