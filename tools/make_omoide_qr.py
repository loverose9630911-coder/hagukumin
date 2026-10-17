"""おもいでプリントを、ほかのスマホに入れるための案内カード（QRコードつき画像）を作る

    pip install segno          # QRコードを作る部品（純Python）
    python3 tools/make_omoide_qr.py [URL]

URL を省くと本番のアドレス（Netlify サイト rad-sprite-850f5f の /print/）で作る。
書き出し先: suuji-nazori/print/img/install-card.png（LINE などで送って、カメラで読みとってもらう）
"""
import io
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

try:
    import segno
except ImportError:
    sys.exit("segno がありません。先に  pip install segno  を実行してください")

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "suuji-nazori" / "print" / "img"
URL = sys.argv[1] if len(sys.argv) > 1 else "https://rad-sprite-850f5f.netlify.app/print/"
FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
    "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    "C:/Windows/Fonts/meiryo.ttc",
]


def font(size):
    for f in FONT_CANDIDATES:
        if Path(f).exists():
            return ImageFont.truetype(f, size)
    sys.exit("日本語フォントが見つかりません: " + ", ".join(FONT_CANDIDATES))


def main():
    W, H = 900, 1240
    card = Image.new("RGB", (W, H), (255, 244, 228))
    d = ImageDraw.Draw(card)

    icon = Image.open(IMG / "icon-512.png").convert("RGB").resize((200, 200), Image.LANCZOS)
    mask = Image.new("L", icon.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, 199, 199], radius=46, fill=255)
    card.paste(icon, ((W - 200) // 2, 60), mask)

    def center(text, y, size, fill=(58, 46, 40)):
        f = font(size)
        w = d.textlength(text, font=f)
        d.text(((W - w) / 2, y), text, font=f, fill=fill)

    center("おもいでプリント", 290, 56)
    center("iPhoneのカメラで読みとって開いてください", 376, 30, (133, 116, 106))

    buf = io.BytesIO()
    segno.make(URL, error="m").save(buf, kind="png", scale=12, border=3, dark="#3A2E28", light="#FFFFFF")
    qr = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    size = 520
    qr = qr.resize((size, size), Image.NEAREST)
    qx, qy = (W - size) // 2, 440
    d.rounded_rectangle([qx - 24, qy - 24, qx + size + 24, qy + size + 24], radius=28, fill=(255, 255, 255))
    card.paste(qr, (qx, qy))

    center("開いたら 共有 →「ホーム画面に追加」", 1010, 34)
    center("写真はiPhoneの中だけで処理します", 1066, 28, (133, 116, 106))
    center(URL, 1150, 26, (133, 116, 106))

    out = IMG / "install-card.png"
    card.save(out, optimize=True)
    print("wrote", out, "→", URL)


if __name__ == "__main__":
    main()
