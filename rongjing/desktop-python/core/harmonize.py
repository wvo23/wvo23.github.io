"""
图像和谐化 / 融合核心模块
目标：让人物的光照、色调与新背景自然融为一体，同时人物身份/像素结构保持不变。

融合手段（可组合）：
1. 统计颜色迁移 (Reinhard / 均值-方差匹配, LAB 空间)
2. 局部光照匹配
3. 多项式颜色映射
4. 边缘羽化 + 去色边
5. 接地阴影
6. [可选] NVIDIA Harmonizer 深度学习和谐化

设计原则：所有深度学习增强都是"可选且失败可降级"，核心融合用纯数值计算保证一定能跑。
"""
from __future__ import annotations
import numpy as np
import cv2
from PIL import Image, ImageFilter


def _to_arr(img: Image.Image) -> np.ndarray:
    return np.asarray(img.convert("RGB")).astype(np.float32) / 255.0


def _to_pil(arr: np.ndarray) -> Image.Image:
    return Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))


def _mask_f32(mask: Image.Image) -> np.ndarray:
    return np.asarray(mask.convert("L")).astype(np.float32) / 255.0


def _feather_mask(mask: np.ndarray, radius: int = 1) -> np.ndarray:
    if radius <= 0:
        return mask
    k = radius * 2 + 1
    return cv2.GaussianBlur(mask, (k, k), 0)


def reinhard_color_transfer(fg, bg, mask, strength: float = 1.0):
    fg_lab = cv2.cvtColor((fg * 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    bg_lab = cv2.cvtColor((bg * 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    m = mask > 0.5
    if m.sum() < 10:
        return fg
    fg_mean = fg_lab[m].mean(0)
    fg_std = fg_lab[m].std(0) + 1e-6
    bg_mean = bg_lab.mean((0, 1))
    bg_std = bg_lab.reshape(-1, 3).std(0)
    tgt_std = fg_std * 0.6 + bg_std * 0.4
    tgt = np.empty_like(fg_lab)
    for c in range(3):
        mapped = (fg_lab[:, :, c] - fg_mean[c]) * (tgt_std[c] / fg_std[c]) + bg_mean[c]
        if c == 0:
            # L 通道保护：限制漂移，避免高光拉爆/暗部死黑
            mapped = np.clip(mapped, fg_lab[:, :, c] - 22, fg_lab[:, :, c] + 22)
            mapped = np.minimum(mapped, 232)
        tgt[:, :, c] = mapped
    out_lab = fg_lab * (1 - mask[..., None]) + tgt * mask[..., None]
    out = cv2.cvtColor(np.clip(out_lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.float32) / 255.0
    return fg * (1 - strength) + out * strength


def match_luminance(fg, bg, mask, strength: float = 1.0):
    fg_y = cv2.cvtColor((fg * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    bg_y = cv2.cvtColor((bg * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    m = mask > 0.5
    if m.sum() < 10:
        return fg
    fg_mean = fg_y[m].mean(); fg_std = fg_y[m].std() + 1e-6
    bg_mean = np.median(bg_y); bg_std = bg_y.std()
    tgt_std = fg_std * 0.7 + bg_std * 0.3
    ratio = np.clip(bg_mean / (fg_mean + 1e-6), 0.6, 1.6)
    adj = (fg_y - fg_mean) * (tgt_std / fg_std) * ratio + bg_mean
    scale = np.clip(adj / (fg_y + 1e-6), 0.55, 1.6)
    out = fg * scale[..., None]
    w = mask[..., None] * strength
    return fg * (1 - w) + out * w


def local_light_match(fg, bg, mask, strength: float = 0.7):
    bg_y = cv2.cvtColor((bg * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    light_field = cv2.GaussianBlur(bg_y, (0, 0), sigmaX=max(15, bg.shape[1] // 30))
    light_field = light_field / (light_field.mean() + 1e-6)
    fg_y = cv2.cvtColor((fg * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    fg_low = cv2.GaussianBlur(fg_y, (0, 0), sigmaX=max(15, fg.shape[1] // 30))
    fg_low = fg_low / (fg_low.mean() + 1e-6)
    corr = light_field / (fg_low + 1e-6)
    corr = np.clip(corr, 0.65, 1.45)
    corr = np.power(corr, strength)
    out = fg * corr[..., None]
    w = mask[..., None]
    return fg * (1 - w) + out * w


def decontaminate_edges(fg, mask):
    m8 = (mask * 255).astype(np.uint8)
    inner = cv2.erode(m8, np.ones((5, 5), np.uint8), iterations=1).astype(np.float32) / 255.0
    has_inner = inner > 0.1
    if not has_inner.any():
        return fg
    clean = cv2.GaussianBlur(fg, (0, 0), sigmaX=6)
    edge = np.clip(mask - inner, 0, 1)[..., None]
    out = fg * (1 - edge) + clean * edge
    return out


def estimate_light_direction(bg):
    gray = cv2.cvtColor((bg * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)
    blur = cv2.GaussianBlur(gray, (0, 0), sigmaX=max(31, bg.shape[1] // 12))
    h, w = blur.shape
    weights = blur.astype(np.float32) ** 3
    ys, xs = np.mgrid[0:h, 0:w]
    cx = (xs * weights).sum() / (weights.sum() + 1e-6)
    cy = (ys * weights).sum() / (weights.sum() + 1e-6)
    dx = (cx - w / 2) / (w / 2)
    dy = (cy - h / 2) / (h / 2)
    return float(dx), float(dy)


def add_contact_shadow(composite, mask, bbox, strength: float = 0.45):
    x0, y0, x1, y1 = bbox
    h, w = mask.shape
    dx, dy = estimate_light_direction(composite)
    off_x = int(-dx * (x1 - x0) * 0.25)
    off_y = int(max(10, (y1 - y0) * 0.045))
    bottom = np.zeros_like(mask)
    ys = np.linspace(y0, y1, 8).astype(int)
    for yy in ys[:-1]:
        bottom[max(0, yy - 6):min(h, yy + 6), x0:x1] = mask[max(0, yy - 6):min(h, yy + 6), x0:x1]
    bottom = np.maximum(bottom, mask * np.linspace(0, 1, h)[:, None] ** 6)
    M = np.float32([[1, 0, off_x], [0, 1, off_y]])
    shadow = cv2.warpAffine(bottom, M, (w, h))
    shadow = cv2.GaussianBlur(shadow, (0, 0), sigmaX=max(9, (x1 - x0) // 12))
    shadow = np.clip(shadow * strength, 0, 0.6)[..., None]
    out = composite * (1 - shadow)
    return out


def poisson_blend(fg_rgb, bg, mask):
    h, w = bg.shape[:2]
    fg_u8 = (np.clip(fg_rgb, 0, 1) * 255).astype(np.uint8)
    bg_u8 = (np.clip(bg, 0, 1) * 255).astype(np.uint8)
    mask_u8 = (mask * 255).astype(np.uint8)
    ys, xs = np.where(mask_u8 > 0)
    if len(xs) == 0:
        return bg
    center = (int((xs.min() + xs.max()) / 2), int((ys.min() + ys.max()) / 2))
    try:
        cloned = cv2.seamlessClone(fg_u8, bg_u8, mask_u8, center, cv2.NORMAL_CLONE)
        return cloned.astype(np.float32) / 255.0
    except Exception:
        return bg


def harmonize(
    composite, placed_rgba, mask, bbox,
    color_strength: float = 0.7, light_strength: float = 0.6,
    shadow_strength: float = 0.45, feather: int = 1,
    decontaminate: bool = True, use_poisson: bool = False, bg_reference=None,
):
    """主融合函数。composite: 已叠人物的RGB; placed_rgba: 前景RGBA; mask: alpha; bbox: 位置"""
    bg = bg_reference if bg_reference is not None else composite
    fg = placed_rgba[..., :3]
    a = np.clip(mask, 0, 1)
    result = fg.copy()
    if decontaminate:
        result = decontaminate_edges(result, a)
    if color_strength > 0:
        result = reinhard_color_transfer(result, bg, a, strength=color_strength)
    if light_strength > 0:
        result = match_luminance(result, bg, a, strength=light_strength * 0.8)
        result = local_light_match(result, bg, a, strength=light_strength)
    if use_poisson:
        poisson = poisson_blend(result, bg, a)
        blend_w = a[..., None] * 0.5
        result = result * (1 - blend_w) + poisson * blend_w
    shadowed_bg = add_contact_shadow(bg.copy(), a, bbox, strength=shadow_strength) if shadow_strength > 0 else bg.copy()
    feathered = _feather_mask(a, feather)[..., None]
    final = shadowed_bg * (1 - feathered) + result * feathered
    return np.clip(final, 0, 1)
