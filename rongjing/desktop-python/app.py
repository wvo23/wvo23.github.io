"""
融境 Seamless BG Changer —— 智能换背景应用（Gradio UI）
启动: python3.11 app.py  →  http://localhost:7860
"""
from __future__ import annotations
import os
import numpy as np
from PIL import Image
import gradio as gr
from core.pipeline import process

BASE = os.path.dirname(os.path.abspath(__file__))
BG_DIR = os.path.join(BASE, "assets", "backgrounds")
OUT_DIR = os.path.join(BASE, "outputs")
os.makedirs(OUT_DIR, exist_ok=True)

BUILTIN_BG = {
    "🏞️ 户外公园（自然光）": os.path.join(BG_DIR, "park.png"),
    "🛋️ 暖色室内（窗边光）": os.path.join(BG_DIR, "room.png"),
    "🏢 冷色办公室（日光）": os.path.join(BG_DIR, "office.png"),
}


def load_bg(choice, custom_bg):
    if custom_bg is not None:
        return Image.fromarray(custom_bg).convert("RGB")
    path = BUILTIN_BG.get(choice)
    if path and os.path.exists(path):
        return Image.open(path).convert("RGB")
    return Image.open(next(iter(BUILTIN_BG.values()))).convert("RGB")


def run(person, bg_choice, custom_bg, model, matting, scale, pos_x, pos_y,
        color_strength, light_strength, shadow_strength, feather, decontaminate):
    if person is None:
        raise gr.Error("请先上传一张人物照片")
    person_img = Image.fromarray(person).convert("RGB")
    bg_img = load_bg(bg_choice, custom_bg)
    model_key = "isnet-general-use" if "通用" in model else "u2net_human_seg"
    out, _ = process(person_img, bg_img, model=model_key, matting=matting,
        scale=scale, pos_x=pos_x, pos_y=pos_y, color_strength=color_strength,
        light_strength=light_strength, shadow_strength=shadow_strength,
        feather=int(feather), decontaminate=decontaminate)
    return out


def clear_all():
    return None, None, None


CSS = """
.gradio-container { max-width: 1280px !important; }
.title { text-align:center; font-size:30px; font-weight:700;
         background:linear-gradient(90deg,#2563eb,#7c3aed,#db2777);
         -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
.subtitle { text-align:center; color:#64748b; font-size:14px; margin-top:-6px; }
.note { font-size:12px; color:#64748b; line-height:1.6; }
"""

with gr.Blocks() as demo:
    gr.Markdown('<div class="title">融境 · 智能换背景</div>')
    gr.Markdown('<div class="subtitle">人物保持不变 · 光照色调自然相融 · 一键完成</div>')
    with gr.Row():
        with gr.Column(scale=1):
            gr.Markdown("### ① 上传人物照片")
            person_in = gr.Image(label="人物照片", type="numpy", height=260)
            gr.Markdown("### ② 选择新背景")
            bg_choice = gr.Radio(choices=list(BUILTIN_BG.keys()), value=list(BUILTIN_BG.keys())[1], label="内置背景")
            custom_bg = gr.Image(label="或上传自定义背景（可选）", type="numpy", height=160)
            gr.Markdown("### ③ 一键融合")
            run_btn = gr.Button("🚀 生成融合效果", variant="primary", size="lg")
            clear_btn = gr.Button("清空", size="sm")
        with gr.Column(scale=1):
            gr.Markdown("### 融合结果")
            out_img = gr.Image(label="结果（右键另存为）", type="pil", height=520)
            gr.Markdown('<div class="note">先发丝级抠出人物（保留原始像素，人脸不变），再把人物的色调明暗调整到与新背景一致，并补上接地阴影，最后做边缘融合。全程不重新生成人物。</div>')
    with gr.Accordion("⚙️ 高级调节", open=False):
        with gr.Row():
            model = gr.Radio(["通用模型（人物/物品均可）", "人像专用模型（仅人物）"], value="通用模型（人物/物品均可）", label="抠图模型")
            matting = gr.Checkbox(value=True, label="发丝级精修")
            decontaminate = gr.Checkbox(value=True, label="边缘去色边")
        with gr.Row():
            scale = gr.Slider(0.5, 1.5, 1.0, step=0.05, label="人物大小")
            pos_x = gr.Slider(0.0, 1.0, 0.5, step=0.01, label="水平位置")
            pos_y = gr.Slider(0.5, 1.0, 0.92, step=0.01, label="垂直位置")
        with gr.Row():
            color_strength = gr.Slider(0.0, 1.5, 0.7, step=0.05, label="色调融合强度")
            light_strength = gr.Slider(0.0, 1.5, 0.6, step=0.05, label="光照融合强度")
            shadow_strength = gr.Slider(0.0, 1.0, 0.45, step=0.05, label="阴影强度")
            feather = gr.Slider(0, 4, 1, step=1, label="边缘羽化")
    inputs = [person_in, bg_choice, custom_bg, model, matting, scale, pos_x, pos_y,
        color_strength, light_strength, shadow_strength, feather, decontaminate]
    run_btn.click(run, inputs, out_img)
    clear_btn.click(clear_all, None, [person_in, custom_bg, out_img])

if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860, share=False, css=CSS, theme=gr.themes.Soft())
