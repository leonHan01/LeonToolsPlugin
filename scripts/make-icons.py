#!/usr/bin/env python3
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "icons"
SOURCE = ROOT / "logo.png"


def fit_square(img: Image.Image, size: int, pad_ratio: float = 0.08) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = max(1, int(size * (1 - pad_ratio * 2)))
    width, height = img.size
    scale = min(inner / width, inner / height)
    next_w = max(1, round(width * scale))
    next_h = max(1, round(height * scale))
    resized = img.resize((next_w, next_h), Image.Resampling.LANCZOS)
    canvas.paste(resized, ((size - next_w) // 2, (size - next_h) // 2), resized)
    return canvas


if __name__ == "__main__":
    ROOT.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert("RGBA")
    cropped = source.crop(source.getbbox())
    for size in (16, 32, 48, 128):
        path = ROOT / f"icon{size}.png"
        fit_square(cropped, size).save(path, "PNG")
        print(path)
