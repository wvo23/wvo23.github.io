/**
 * 图像融合核心（浏览器端 JS 实现）
 * 移植自 Python 版 harmonize.py —— 纯像素运算，无需模型。
 * 目标：让人物色调/明暗与新背景自然融合，人物像素结构保持不变。
 */

function srgbToLinear(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function linearToSrgb(c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }

/** RGB(0-255) -> LAB (L:0-100, a,b:-128..127) —— OpenCV 兼容矩阵 D65 */
function rgbToLab(r, g, b) {
  const rl = srgbToLinear(r), gl = srgbToLinear(g), bl = srgbToLinear(b);
  let x = (rl * 0.412453 + gl * 0.357580 + bl * 0.180423) / 0.95047;
  let y = (rl * 0.212671 + gl * 0.715160 + bl * 0.072169);
  let z = (rl * 0.019334 + gl * 0.119193 + bl * 0.950227) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** LAB -> RGB(0-255) */
function labToRgb(L, a, bb) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - bb / 200;
  const finv = (t) => (t > 0.206893 ? t * t * t : (t - 16 / 116) / 7.787);
  let x = finv(fx) * 0.95047, y = finv(fy), z = finv(fz) * 1.08883;
  let rl = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  let gl = x * -0.9692660 + y * 1.8760108 + z * 0.0415560;
  let bl = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
  return [
    Math.round(Math.max(0, Math.min(255, linearToSrgb(Math.max(0, rl)) * 255))),
    Math.round(Math.max(0, Math.min(255, linearToSrgb(Math.max(0, gl)) * 255))),
    Math.round(Math.max(0, Math.min(255, linearToSrgb(Math.max(0, bl)) * 255))),
  ];
}

/** 可分离高斯模糊（近似），返回 Float32Array 单通道 */
function gaussianBlur1D(src, w, h, sigma) {
  if (sigma <= 0) return src.slice();
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); kernel[i + radius] = v; sum += v; }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0; for (let k = -radius; k <= radius; k++) { const xx = Math.min(w - 1, Math.max(0, x + k)); acc += src[y * w + xx] * kernel[k + radius]; }
    tmp[y * w + x] = acc;
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    let acc = 0; for (let k = -radius; k <= radius; k++) { const yy = Math.min(h - 1, Math.max(0, y + k)); acc += tmp[yy * w + x] * kernel[k + radius]; }
    out[y * w + x] = acc;
  }
  return out;
}

/** 对 RGB 三通道做高斯模糊 */
function gaussianBlurRGB(data, w, h, sigma) {
  const r = new Float32Array(w * h), g = new Float32Array(w * h), b = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { r[i] = data[i * 4]; g[i] = data[i * 4 + 1]; b[i] = data[i * 4 + 2]; }
  const rb = gaussianBlur1D(r, w, h, sigma), gb = gaussianBlur1D(g, w, h, sigma), bb = gaussianBlur1D(b, w, h, sigma);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { out[i * 4] = rb[i]; out[i * 4 + 1] = gb[i]; out[i * 4 + 2] = bb[i]; out[i * 4 + 3] = data[i * 4 + 3]; }
  return out;
}

export function harmonize(fgLayer, bgData, opts = {}) {
  const { colorStrength = 0.7, lightStrength = 0.6, shadowStrength = 0.45, feather = 1, decontaminate = true, bbox = null } = opts;
  const w = bgData.width, h = bgData.height, N = w * h;
  const fg = fgLayer.data, bg = bgData.data;
  const alpha = new Float32Array(N);
  for (let i = 0; i < N; i++) alpha[i] = fg[i * 4 + 3] / 255;

  // 背景 LAB 均值（抽样）
  let bgL = 0, bgA = 0, bgB = 0;
  const step = Math.max(1, Math.floor(N / 20000)); let cnt = 0;
  for (let i = 0; i < N; i += step) { const [l, a, b] = rgbToLab(bg[i * 4], bg[i * 4 + 1], bg[i * 4 + 2]); bgL += l; bgA += a; bgB += b; cnt++; }
  bgL /= cnt; bgA /= cnt; bgB /= cnt;

  // 前景 LAB 统计（mask 区域）
  let fgLsum = 0, fgAsum = 0, fgBsum = 0, fgL2 = 0, fgCount = 0;
  for (let i = 0; i < N; i++) if (alpha[i] > 0.5) { const [l, a, b] = rgbToLab(fg[i * 4], fg[i * 4 + 1], fg[i * 4 + 2]); fgLsum += l; fgAsum += a; fgBsum += b; fgL2 += l * l; fgCount++; }
  if (fgCount < 10) return composite(fgLayer, bgData, alpha, shadowStrength, bbox, w, h);
  const fgLm = fgLsum / fgCount, fgAm = fgAsum / fgCount, fgBm = fgBsum / fgCount;

  // 边缘去色边
  let work = new Uint8ClampedArray(fg);
  if (decontaminate) {
    const clean = gaussianBlurRGB(fg, w, h, 6);
    for (let i = 0; i < N; i++) if (alpha[i] > 0.02 && alpha[i] < 0.85) { work[i * 4] = clean[i * 4]; work[i * 4 + 1] = clean[i * 4 + 1]; work[i * 4 + 2] = clean[i * 4 + 2]; }
  }

  // 背景低频光照场
  const bgGray = new Float32Array(N);
  for (let i = 0; i < N; i++) bgGray[i] = 0.299 * bg[i * 4] + 0.587 * bg[i * 4 + 1] + 0.114 * bg[i * 4 + 2];
  const sigma = Math.max(15, Math.floor(w / 30));
  const lightField = gaussianBlur1D(bgGray, w, h, sigma);
  let lfMean = 0; for (let i = 0; i < N; i++) lfMean += lightField[i]; lfMean /= N;

  // 颜色迁移 + 光照匹配
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < N; i++) {
    let r = work[i * 4], g = work[i * 4 + 1], b = work[i * 4 + 2];
    if (alpha[i] > 0.02) {
      if (colorStrength > 0) {
        const [l, a, bb] = rgbToLab(r, g, b);
        let nL = l + (bgL - fgLm) * colorStrength; // 高光保护：漂移±9，上限92
        nL = Math.max(l - 9, Math.min(l + 9, nL)); nL = Math.min(92, nL);
        let nA = a + (bgA - fgAm) * colorStrength * 0.5;
        let nB = bb + (bgB - fgBm) * colorStrength * 0.5;
        [r, g, b] = labToRgb(nL, nA, nB);
      }
      if (lightStrength > 0) {
        const localLight = lightField[i] / (lfMean + 1e-3);
        let corr = Math.max(0.65, Math.min(1.45, localLight));
        corr = Math.pow(corr, lightStrength);
        r *= corr; g *= corr; b *= corr;
      }
    }
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = fg[i * 4 + 3];
  }
  return composite(new ImageData(out, w, h), bgData, alpha, shadowStrength, bbox, w, h, feather);
}

/** 画阴影 + 羽化合成 */
function composite(fgLayer, bgData, alpha, shadowStrength, bbox, w, h, feather = 1) {
  const N = w * h, fg = fgLayer.data, bg = bgData.data;
  const result = new Uint8ClampedArray(w * h * 4);
  // 光源方向（背景亮区重心）
  let wsum = 0, xs = 0; const step = Math.max(1, Math.floor(w / 100));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const i = y * w + x, lum = (bg[i * 4] + bg[i * 4 + 1] + bg[i * 4 + 2]) / 3, wt = Math.pow(lum / 255, 3);
    wsum += wt; xs += x * wt;
  }
  const brightX = wsum > 0 ? xs / wsum : w / 2, lightDir = (brightX - w / 2) / (w / 2);
  const offX = Math.round(-lightDir * (bbox ? (bbox[2] - bbox[0]) : w * 0.3) * 0.25);
  const offY = bbox ? Math.max(10, Math.round((bbox[3] - bbox[1]) * 0.045)) : 12;
  let shadow = null;
  if (shadowStrength > 0) {
    const shSrc = new Float32Array(N);
    const y0 = bbox ? bbox[1] : 0, y1 = bbox ? bbox[3] : h, x0 = bbox ? bbox[0] : 0, x1 = bbox ? bbox[2] : w;
    for (let y = y0; y < y1; y++) { const t = (y - y0) / Math.max(1, y1 - y0), wgt = Math.pow(t, 6); for (let x = x0; x < x1; x++) shSrc[y * w + x] = alpha[y * w + x] * wgt; }
    const shBlur = gaussianBlur1D(shSrc, w, h, Math.max(9, Math.floor((x1 - x0) / 12)));
    shadow = new Float32Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = Math.min(w - 1, Math.max(0, x - offX)), sy = Math.min(h - 1, Math.max(0, y - offY));
      shadow[y * w + x] = Math.min(0.6, shBlur[sy * w + sx] * shadowStrength);
    }
  }
  let feathered = alpha;
  if (feather > 0) feathered = gaussianBlur1D(alpha, w, h, feather);
  for (let i = 0; i < N; i++) {
    const a = feathered[i], s = shadow ? shadow[i] : 0;
    for (let c = 0; c < 3; c++) { const bgv = bg[i * 4 + c] * (1 - s); result[i * 4 + c] = bgv * (1 - a) + fg[i * 4 + c] * a; }
    result[i * 4 + 3] = 255;
  }
  return new ImageData(result, w, h);
}
