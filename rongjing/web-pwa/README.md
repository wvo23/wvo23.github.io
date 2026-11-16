# 融境 · Web PWA 版

浏览器端端到端本地推理的换背景 APP，已发布、iPhone 可用。

## 运行
```bash
pnpm install
pnpm run dev      # http://localhost:5173
pnpm run build    # 产物在 dist/（含本地模型约 353MB）
```

## 结构
- `src/fusion.js` — 融合算法（对 Mac 移植最有价值，逐函数对应 Swift）
- `src/place.js` — 智能放置
- `src/matting.js` — @imgly 抠图封装 + HEIC 处理
- `src/main.js` — 主逻辑 + 真机加固（错误可见化、单例预加载）
- `public/sw.js` — Service Worker 离线缓存（v2，代码 network-first）

## 模型本地化
`@imgly/background-removal` 的模型/JSON 放在 `public/removebg/`（体积大未入库）。
需要时从 `https://staticimgly.com/@imgly/background-removal-data/1.7.0/package.tgz` 下载解压到该目录。
