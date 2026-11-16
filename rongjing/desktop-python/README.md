# 融境 · Python 桌面版

Gradio + rembg 抠图 + 图像和谐化融合。这是算法的权威参考实现。

## 运行
```bash
pip install gradio rembg onnxruntime pillow numpy opencv-python-headless
python3.11 app.py   # http://localhost:7860
```

## 结构
- `core/matting.py` — 抠图 + 智能放置
- `core/harmonize.py` — 融合核心（颜色/光照/阴影/边缘）★ Mac 移植重点
- `core/pipeline.py` — 端到端流程
- `app.py` — Gradio UI

## 模型
抠图模型放 `~/.u2net/`（isnet-general-use.onnx / u2net_human_seg.onnx）。
国内镜像下载见上层 `docs/03_效果基准与模型说明.md`。代码已设 `MODEL_CHECKSUM_DISABLED=1` 跳过 MD5 校验。

## 编程调用
```python
from core.pipeline import process
from PIL import Image
out, steps = process(Image.open('人物.jpg'), Image.open('背景.jpg'),
    model='isnet-general-use', color_strength=0.7, light_strength=0.6, shadow_strength=0.45)
out.save('结果.png')
```
