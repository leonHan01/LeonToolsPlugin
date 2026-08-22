#!/usr/bin/env python3
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "icons"
ROOT.mkdir(parents=True, exist_ok=True)

BLUE = (37, 99, 235, 255)
WHITE = (255, 255, 255, 255)


def make(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    margin = max(0, round(size * 0.06))
    radius = max(2, round(size * 0.22))
    draw.rounded_rectangle(
        [margin, margin, size - 1 - margin, size - 1 - margin],
        radius=radius,
        fill=BLUE,
    )

    inner = size - 2 * margin

    def xy(px: float, py: float) -> tuple[float, float]:
        return margin + px / 100 * inner, margin + py / 100 * inner

    draw.rounded_rectangle([*xy(22, 30), *xy(54, 44)], radius=max(1, round(size * 0.05)), fill=WHITE)
    draw.rounded_rectangle([*xy(18, 40), *xy(82, 76)], radius=max(1, round(size * 0.07)), fill=WHITE)
    if size >= 32:
        y1 = xy(30, 52)[1]
        y2 = xy(30, 60)[1]
        y3 = xy(30, 68)[1]
        x1 = xy(30, 52)[0]
        x2 = xy(70, 52)[0]
        width = max(1, size // 28)
        draw.line([(x1, y1), (x2, y1)], fill=BLUE, width=width)
        draw.line([(x1, y2), (x1 + (x2 - x1) * 0.78, y2)], fill=BLUE, width=width)
        draw.line([(x1, y3), (x1 + (x2 - x1) * 0.58, y3)], fill=BLUE, width=width)
    return img


if __name__ == "__main__":
    for size in (16, 32, 48, 128):
        path = ROOT / f"icon{size}.png"
        make(size).save(path)
        print(path)
