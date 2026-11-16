"""
端到端换背景 Pipeline：抠图 -> 智能放置 -> 光照色调融合 -> 阴影 -> 边缘处理
"""
from __future__ import annotations
import numpy as np
from PIL import Image
from .matting import remove_background, place_foreground
from .harmonize import harmonize, _to_arr, _to_pil, _mask_f32


def process(
    person_image: Image.Image, background_image: Image.Image,
    model: str = "isnet-general-use", matting: bool = True,
    scale: float = 1.0, pos_x: float = 0.5, pos_y: float = 0.92,
    color_strength: float = 0.7, light_strength: float = 0.6,
    shadow_strength: float = 0.45, feather: int = 1,
    decontaminate: bool = True, use_poisson: bool = False, return_steps: bool = False,
) -> tuple[Image.Image, dict]:
    bg = background_image.convert("RGB")
    cutout = remove_background(person_image, model=model, alpha_matting=matting)
    composite_pil, mask_pil, bbox = place_foreground(cutout, bg, scale=scale, pos_x=pos_x, pos_y=pos_y)
    composite = _to_arr(composite_pil)
    bg_arr = _to_arr(bg)
    placed_rgba = np.asarray(composite_pil.convert("RGBA")).astype(np.float32) / 255.0
    mask = _mask_f32(mask_pil)
    result = harmonize(
        composite=composite, placed_rgba=placed_rgba, mask=mask, bbox=bbox,
        color_strength=color_strength, light_strength=light_strength,
        shadow_strength=shadow_strength, feather=feather,
        decontaminate=decontaminate, use_poisson=use_poisson, bg_reference=bg_arr,
    )
    out_img = _to_pil(result)
    steps = {}
    if return_steps:
        steps["cutout"] = cutout; steps["placed"] = composite_pil; steps["mask"] = mask_pil
    return out_img, steps
