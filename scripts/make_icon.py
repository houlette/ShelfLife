#!/usr/bin/env python3
"""Generate AppIcon.icns for ShelfLife.app.

Usage: python3 make_icon.py [output.icns]
"""
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    print("Pillow is required: pip install pillow")
    sys.exit(1)

# Colour palette matching the app's warm paper theme
BG  = (74,  58,  42, 255)   # dark warm brown (background)
CR  = (242, 235, 218, 255)  # warm cream
TAN = (197, 168, 130, 255)  # tan
BRN = (130, 100,  70, 255)  # medium brown


def draw_icon(size: int) -> Image.Image:
    img  = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    radius = max(1, size // 5)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=BG)

    # Book spines area
    pad = size * 0.18
    al  = int(pad)
    ar  = int(size - pad)
    at  = int(size * 0.18)
    ab  = int(size * 0.76)

    n      = 4
    gap    = max(1, size // 40)
    bw     = max(2, (ar - al - (n - 1) * gap) // n)
    heights = [0.82, 0.65, 0.92, 0.72]
    colors  = [CR, TAN, CR, BRN]

    for i in range(n):
        x0 = al + i * (bw + gap)
        x1 = x0 + bw - 1
        h  = max(2, int((ab - at) * heights[i]))
        y0 = ab - h
        draw.rectangle([x0, y0, x1, ab], fill=colors[i])

    # Shelf line below books
    sh = max(1, size // 48)
    sy = ab + max(1, size // 32)
    draw.rectangle([al, sy, ar, sy + sh], fill=CR)

    return img


ICONSET_SPEC = [
    ("icon_16x16.png",       16),
    ("icon_16x16@2x.png",    32),
    ("icon_32x32.png",       32),
    ("icon_32x32@2x.png",    64),
    ("icon_128x128.png",    128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png",    256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png",    512),
    ("icon_512x512@2x.png", 1024),
]


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("AppIcon.icns")

    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / "AppIcon.iconset"
        iconset.mkdir()

        for name, size in ICONSET_SPEC:
            draw_icon(size).save(str(iconset / name))

        subprocess.check_call(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(out)]
        )

    print(f"Created {out}")


if __name__ == "__main__":
    main()
