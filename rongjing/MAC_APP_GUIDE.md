# 融境 · Mac 原生应用开发指南

> 目标：在本地 Mac（macOS 13+，建议 14+）上，把本项目做成功能更强、体验更好的**原生 macOS App**。
> 本文假设你熟悉 Swift / Xcode 基础，但不要求熟悉图像处理。所有算法细节都给出了对应源码位置与可直接改写的代码。

---

## 0. 为什么 Mac 原生版会更强？

我们在 Linux 沙箱里已经做出了三个可用的版本（Python 桌面版、浏览器 PWA 版、已发布的 iPhone 版），但都受限于运行环境。Mac 原生版可以彻底解决这些限制：

| 维度 | 浏览器/PWA 版（现状） | Mac 原生版（目标） | 提升 |
|---|---|---|---|
| **抠图** | WASM 跑 44MB ONNX，首次下载 80MB，CPU 慢 | **Apple Vision 框架原生抠图**，系统级优化，无需下载模型，快 5-10 倍 | ⭐⭐⭐⭐⭐ |
| 抠图质量 | isnet 量化模型 | Vision `VNGeneratePersonSegmentationRequest` + 自研/第三方 matting，发丝级 | ⭐⭐⭐⭐ |
| 融合运算 | JS 逐像素，单线程，大图卡顿 | **Metal / Accelerate(vDSP) 并行**，可实时预览 | ⭐⭐⭐⭐⭐ |
| 交互体验 | 网页按钮，需手动传图 | 拖拽图片、系统相册/文件面板、原生进度、批量处理 | ⭐⭐⭐⭐ |
| 隐私 | 本地（已实现） | 本地（更安全，可上 App Sandbox） | ⭐⭐⭐ |
| 分发 | 需 HTTPS 链接 | `.app` 直接运行 / Homebrew / Mac App Store | ⭐⭐⭐⭐ |

**核心策略**：`抠图` 换成 Apple Vision（关键升级），`融合算法` 直接复用本项目已验证的实现（Python `core/harmonize.py` 与 JS `src/fusion.js` 逻辑完全一致），用 Metal/Accelerate 加速即可。

---

## 1. 技术原理速览（务必先读）

### 1.1 为什么别的 AI 换背景会"把人改了"？
用扩散模型（GPT Image / Nano Banana / Stable Diffusion Inpainting）整图重绘，会在生成新背景时把人物像素一起重新采样，导致**换脸、变形、细节丢失**。

### 1.2 我们的正确路线（三步分离）
```
① 抠图 Matting  →  只抠出人物，保留原始像素（人脸绝不变）
② 放置 Placement →  按比例/位置把人物放到新背景
③ 融合 Harmonization → 只调整人物的「色调/明暗/阴影/边缘」去匹配新背景，
                        不改动人物结构
```
关键在第 ③ 步——这是"自然融入"的灵魂，也是本项目最有价值的资产。

### 1.3 融合算法的五个手段（都已实现并验证）
1. **边缘去色边**（decontamination）：半透明边缘常混入原背景色，换背景后发白/发绿 → 用内部干净色替换。
2. **LAB 颜色迁移**（Reinhard）：把背景的色调统计迁移到人物，带高光保护（肤色不过曝）。
3. **亮度/局部光照匹配**：用背景的低频光照场调制人物明暗，让人物受光方向与背景一致。
4. **接地阴影**（contact shadow）：估计光源方向，生成柔和投影，消除"漂浮感"。
5. **边缘羽化**（feather）：高斯羽化 alpha，消除硬边贴图感。

> ⚠️ 设计原则：**不要用泊松融合/扩散重绘去改人物内部像素**。本项目默认关闭泊松融合（`use_poisson=False`），正是为了保证"人物不变"。

---

## 2. 推荐架构（Swift + Vision + Metal）

```
RongJingMac/
├── RongJingMacApp.swift          # App 入口
├── Views/
│   ├── ContentView.swift         # 主界面：拖拽区 + 背景选择 + 结果预览
│   ├── ImageDropView.swift       # 拖拽/选择图片
│   ├── BackgroundPicker.swift    # 内置/自定义背景
│   └── AdjustPanel.swift         # 高级参数滑块
├── Engine/
│   ├── MattingEngine.swift       # ★ Vision 抠图（核心升级点）
│   ├── PlacementEngine.swift     # 智能放置（移植 place.js）
│   ├── HarmonizeEngine.swift     # ★ 融合算法（移植 fusion.js，Metal 加速）
│   ├── Metal/                    # 可选：Metal shader 加速像素运算
│   │   └── Harmonize.metal
│   └── Models.swift              # 参数结构体
├── Resources/
│   └── Backgrounds/              # 内置背景（由 tools/generate_assets.py 生成）
└── Tests/
```

---

## 3. 核心模块一：Vision 原生抠图（MattingEngine.swift）

这是相对现有版本**最大的升级**。Apple Vision 从 macOS 11 起提供人像分割，macOS 14+ 提供 `VNGenerateForegroundInstanceMaskRequest`（通用主体），速度快、质量高、无需下载模型。

```swift
import Vision
import AppKit
import CoreImage

class MattingEngine {
    /// 人像分割：返回带 alpha 的 CGImage（人物保留，背景透明）
    /// 支持 macOS 11+。对人物照片效果最佳。
    func segmentPerson(_ image: CGImage, progress: Float? = nil) async throws -> CGImage {
        let request = VNGeneratePersonSegmentationRequest()
        request.qualityLevel = .accurate        // .accurate / .balanced / .fast
        request.outputPixelFormat = kCVPixelFormatType_OneComponent8

        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        try handler.perform([request])

        guard let mask = request.results?.first as? VNSegmentationObservation else {
            throw EngineError.segmentationFailed
        }
        // mask.pixelBuffer 是 0~255 的灰度 alpha 掩膜
        return try apply(mask: mask.pixelBuffer, to: image)
    }

    /// macOS 14+ 通用主体分割（不只人像，物品也可）
    @available(macOS 14.0, *)
    func segmentForeground(_ image: CGImage) async throws -> CGImage {
        let request = VNGenerateForegroundInstanceMaskRequest()
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        try handler.perform([request])
        guard let result = try request.results else { throw EngineError.segmentationFailed }
        let mask = try result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler)
        return try apply(mask: mask, to: image)
    }

    /// 把灰度掩膜作为 alpha 通道贴回原图（发丝级边缘可再做 alpha matting 精修）
    private func apply(mask: CVPixelBuffer, to image: CGImage) throws -> CGImage {
        let ciImage = CIImage(cgImage: image)
        let maskCI = CIImage(cvPixelBuffer: mask)
        let maskToAlpha = CIFilter(name: "CIMaskToAlpha")!
        maskToAlpha.setValue(maskCI, forKey: kCIInputImageKey)
        let blend = CIFilter(name: "CIBlendWithMask")!
        blend.setValue(ciImage, forKey: kCIInputImageKey)
        blend.setValue(CIImage(color: .clear).cropped(to: ciImage.extent), forKey: kCIInputBackgroundImageKey)
        blend.setValue(maskToAlpha.outputImage, forKey: kCIInputMaskImageKey)
        let ctx = CIContext()
        return ctx.createCGImage(blend.outputImage!, from: ciImage.extent)!
    }
}

enum EngineError: Error {
    case segmentationFailed
    case invalidImage
}
```

**进阶（可选）**：Vision 给的是硬分割掩膜，发丝级 alpha 需要额外的 matting 模型。若追求极致，可把开源 **BiRefNet / ISNet** 转成 CoreML（用 `coremltools`），在 Mac 上用 `VNCoreMLRequest` 推理——比 ONNX WASM 快得多。转换脚本骨架见 `docs/03_效果基准与模型说明.md`。

---

## 4. 核心模块二：融合算法（HarmonizeEngine.swift）

这是本项目的核心资产，Python (`core/harmonize.py`) 和 JS (`src/fusion.js`) 逻辑完全一致。移植到 Swift 时**逐函数对照**即可。为求性能，建议用 **Accelerate 框架的 vDSP** 做向量化，或用 **Metal compute shader** 做 GPU 并行。

### 4.1 参数结构（对应 fusion.js 的 opts）
```swift
struct HarmonizeParams {
    var colorStrength: Float = 0.7     // 色调融合强度
    var lightStrength: Float = 0.6     // 光照融合强度
    var shadowStrength: Float = 0.45   // 阴影强度
    var feather: Int = 1               // 边缘羽化半径
    var decontaminate: Bool = true     // 边缘去色边
}
```

### 4.2 需要移植的函数清单（一一对应，别漏）

| 功能 | Python 源码 | JS 源码 | Swift 实现建议 |
|---|---|---|---|
| sRGB↔线性 | `_to_arr` 附近 | `srgbToLinear/linearToSrgb` | `simd` 向量化 |
| RGB↔LAB | `cv2.cvtColor(...LAB)` | `rgbToLab/labToRgb` | 手写矩阵 / Accelerate |
| 高斯模糊 | `cv2.GaussianBlur` | `gaussianBlur1D` | **vDSP 可分离卷积**或 Metal |
| 颜色迁移 | `reinhard_color_transfer` | 内联在主流程 | LAB 均值/方差匹配 |
| 亮度匹配 | `match_luminance` | 内联 | vDSP 统计 |
| 局部光照 | `local_light_match` | `lightField` 部分 | 大 sigma 模糊 |
| 去色边 | `decontaminate_edges` | `gaussianBlurRGB`+替换 | 腐蚀+模糊 |
| 光源方向 | `estimate_light_direction` | `composite()` 内 | 亮区重心 |
| 接地阴影 | `add_contact_shadow` | `composite()` 内 | 偏移+模糊 |
| 羽化合成 | `_feather_mask`+final | `composite()` final | alpha 混合 |

### 4.3 移植要点（血泪经验，务必遵守）
1. **LAB 使用 OpenCV 兼容矩阵**（D65），否则颜色会偏。JS 版 `rgbToLab` 里的矩阵是可信参考。
2. **高光保护不能省**：LAB 的 L 通道漂移必须限制在 ±9（JS 版）/ ±22（Python 0-255 尺度），且上限 92/232，否则脸会白成一片——这是调试中最容易踩的坑。
3. **像素格式统一用 RGBA8，逐通道 Float 运算**，最后再 clamp 回 0-255。
4. **性能**：640×960 的图，纯 Swift 逐像素约 0.3s；上 Metal 可 <0.05s，实现实时预览。

---

## 5. 核心模块三：智能放置（PlacementEngine.swift）

移植 `src/place.js`，逻辑很简单：
```
1. tightenCrop：按 alpha 裁掉人物周围透明区域（阈值 alpha>8）
2. 目标高度 = 背景高度 × 0.78 × scale；若超宽则按比例缩窄
3. 位置：cx = posX × 背景宽；底部锚点 y0 = posY × 背景高 - 目标高
4. 边界 clamp 到画布内
5. 返回 { layer(背景坐标透明图层), bbox(x0,y0,x1,y1) }
```
bbox 要传给融合引擎（阴影和光照估计要用）。

---

## 6. 界面设计建议（SwiftUI）

- **左侧拖拽区**：`onDrop` 接收图片，或按钮调 `NSOpenPanel` / 相册。支持 HEIC（macOS 原生可直接解码，这点比浏览器强）。
- **背景选择**：3 个内置背景缩略图 + 自定义上传。
- **一键生成按钮** + **原生进度条**（NSProgress）。
- **结果预览**：大图 + 拖拽导出 / "保存到相册"。
- **高级参数面板**：7 个滑块，与网页版一致。
- **批量处理**（Mac 版独有亮点）：拖入多张人物照，批量套同一背景。
- **实时预览**（进阶）：Metal 加速后，滑块拖动实时更新结果。

---

## 7. 分阶段实施计划（建议按此顺序）

| 阶段 | 目标 | 验收标准 | 预估工时 |
|---|---|---|---|
| P0 | 项目搭建 + Vision 抠图 | 拖入人像能抠出透明人物 | 0.5 天 |
| P1 | 放置 + 基础融合（颜色迁移） | 人物换背景后色调随环境变 | 1 天 |
| P2 | 完整融合（光照/阴影/去色边/羽化） | 效果追平 Python 版 real_compare | 1-2 天 |
| P3 | 界面完善 + 参数面板 + 保存 | 完整可用 App | 1 天 |
| P4 | Metal 加速 + 实时预览 + 批量 | 体验超越网页版 | 2-3 天 |

**对齐基准**：用 `desktop-python/assets/samples/person.png` 换到 `room.png`/`office.png`，与效果基准对比。

---

## 8. 现有资产对照表（本地拉取后用得上）

| 本地路径（仓库内） | 用途 | Mac 版如何使用 |
|---|---|---|
| `desktop-python/core/harmonize.py` | 融合算法权威实现 | 逐函数移植到 HarmonizeEngine |
| `desktop-python/core/matting.py` | 抠图+放置逻辑 | 放置逻辑移植；抠图改用 Vision |
| `desktop-python/core/pipeline.py` | 端到端流程 | 对应 Swift 的处理 pipeline |
| `web-pwa/src/fusion.js` | 融合算法 JS 版 | 更贴近 Swift（含数值细节） |
| `web-pwa/src/place.js` | 放置逻辑 JS 版 | 直接对应 PlacementEngine |
| `generate_assets.py` | 素材重建脚本 | 运行生成内置背景图/图标 |
| `docs/02_融合算法详解.md` | 效果基准 | 作为视觉验收参考 |

---

## 9. 运行环境要求
- macOS 13+（Vision person segmentation）；通用主体分割需 macOS 14+
- Xcode 15+ / Swift 5.9+
- 如需 CoreML 版抠图：`coremltools`（Python 侧转换）

---

## 10. 一句话总结给开发者
> **抠图**用 Apple Vision（现成的、快、免模型），**融合**照搬本项目 `harmonize.py`/`fusion.js`（这是灵魂，别重造轮子），**性能**用 Metal/Accelerate。按第 7 节分阶段做，先追平 Python 版效果，再谈超越。有任何算法细节疑问，直接对照仓库里的 Python/JS 源码——它们是已验证可工作的参考实现。
