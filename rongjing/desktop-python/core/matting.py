"""
抠图与智能放置模块
- 使用 rembg 做发丝级人像/通用主体抠图
- 提供 alpha matting 精修选项
- 将抠出的人物按比例、位置智能放置到新背景上
"""
from __future__ import annotations

import os

# 关键：跳过 rembg 对本地模型的 MD5 在线校验，避免其尝试从 GitHub 重新下载
os.environ.setdefault("MODEL_CHECKSUM_DISABLED", "1")
os.environ.setdefault("OMP_NUM_THREADS", "4")

import numpy as np
from PIL import Image, ImageFilter
from rembg import remove, new_session

_SESSIONS: dict[str, object] = {}


def get_session(model: str):
    if model not in _SESSIONS:
        _SESSIONS[model] = new_session(model)
    return _SESSIONS[model]


def remove_background(
    image: Image.Image,
    model: str = "isnet-general-use",
    alpha_matting: bool = True,
    foreground_threshold: int = 250,
    background_threshold: int = 12,
    erode_size: int = 6,
) -> Image.Image:
    session = get_session(model)
    kwargs = dict(session=session)
    if alpha_matting:
        kwargs.update(
            alpha_matting=True,
            alpha_matting_foreground_threshold=foreground_threshold,
            alpha_matting_background_threshold=background_threshold,
            alpha_matting_erode_size=erode_size,
        )
    out = remove(image.convert("RGBA"), **kwargs)
    return out.convert("RGBA")


def tighten_crop(rgba: Image.Image, pad_ratio: float = 0.02) -> Image.Image:
    alpha = rgba.getchannel("A")
    bbox = alpha.point(lambda p: 255 if p > 8 else 0).getbbox()
    if not bbox:
        return rgba
    w, h = rgba.size
    px = int(w * pad_ratio); py = int(h * pad_ratio)
    box = (max(0, bbox[0] - px), max(0, bbox[1] - py), min(w, bbox[2] + px), min(h, bbox[3] + py))
    return rgba.crop(box)


def place_foreground(
    fg: Image.Image, bg: Image.Image,
    scale: float = 1.0, pos_x: float = 0.5, pos_y: float = 0.92, anchor: str = "feet",
) -> tuple[Image.Image, Image.Image, tuple[int, int, int, int]]:
    fg = tighten_crop(fg.convert("RGBA")); bg = bg.convert("RGB")
    Bw, Bh = bg.size; Fw, Fh = fg.size
    target_h = int(Bh * 0.78 * scale); target_w = int(Fw * target_h / Fh)
    if target_w > Bw * 0.92:
        target_w = int(Bw * 0.92); target_h = int(Fh * target_w / Fw)
    fg_resized = fg.resize((target_w, target_h), Image.LANCZOS)
    cx = int(pos_x * Bw)
    if anchor == "feet":
        x0 = cx - target_w // 2; y0 = int(pos_y * Bh) - target_h
    else:
        x0 = cx - target_w // 2; y0 = int(pos_y * Bh) - target_h // 2
    x0 = max(0, min(Bw - target_w, x0)); y0 = max(0, min(Bh - target_h, y0))
    x1, y1 = x0 + target_w, y0 + target_h
    bbox = (x0, y0, x1, y1)
    layer = Image.new("RGBA", (Bw, Bh), (0, 0, 0, 0))
    layer.alpha_composite(fg_resized, (x0, y0))
    composite = Image.alpha_composite(bg.convert("RGBA"), layer).convert("RGB")
    placed_mask = layer.getchannel("A")
    return composite, placed_mask, bbox
