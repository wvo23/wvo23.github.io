# 融境 · 智能换背景（Seamless Background Changer）

> 一个功能：**给照片换背景，人物保持不变，且人物与新背景自然融合。**

本项目已在 Linux 沙箱完成调研、开发、测试与发布。本仓库目录是**完整资料快照**，供本地 Mac 拉取后继续开发功能更强的原生 macOS App。

## 🚀 本地 Mac 开发者快速开始

**第一件事**：读 [`MAC_APP_GUIDE.md`](MAC_APP_GUIDE.md) —— 为你编写的详细开发指南，含架构、Swift 核心代码、分阶段计划。

```bash
# 1. 克隆仓库（本项目在 wvo23.github.io 的 rongjing/ 目录）
git clone https://github.com/wvo23/wvo23.github.io.git
cd wvo23.github.io/rongjing

# 2. 重建图片素材（二进制图片未随文本传输，运行脚本生成）
pip3 install pillow numpy
python3 generate_assets.py

# 3. 开始开发 Mac 原生版 → 先读 MAC_APP_GUIDE.md
open MAC_APP_GUIDE.md
```

## 📦 目录内容

| 路径 | 说明 |
|---|---|
| `MAC_APP_GUIDE.md` | ★ **Mac 原生应用开发完整指南**（本次核心交付） |
| `docs/` | 技术调研、融合算法详解、效果基准、CoreML 转换说明 |
| `desktop-python/` | Python 桌面版源码（Gradio + rembg 抠图 + 融合算法权威实现） |
| `web-pwa/` | 网页/PWA 版源码（已发布、iPhone 可用的版本） |
| `generate_assets.py` | 素材重建脚本（生成背景图/图标/测试人像） |
| `.gitignore` | 忽略规则 |

## 🔑 核心技术结论

用户遇到的"AI 换背景把人改了"，根源是**用扩散模型整图重绘**。正确解法是三步分离：

1. **抠图**：保留人物原始像素 → 人脸绝不变
2. **放置**：按比例/位置放到新背景
3. **融合**（灵魂）：只调整人物的色调/明暗/阴影/边缘去匹配新背景，不改人物结构

## 🧬 两个可运行版本（已验证）

```bash
# Python 桌面版
cd desktop-python
pip install gradio rembg onnxruntime pillow numpy opencv-python-headless
python3.11 app.py   # http://localhost:7860

# Web PWA 版
cd web-pwa
pnpm install && pnpm run dev    # http://localhost:5173
```

## 🍎 Mac 原生版优势
Vision 框架抠图（免模型、快 5-10 倍）+ Metal 加速融合 + 原生交互。详见 `MAC_APP_GUIDE.md`。
