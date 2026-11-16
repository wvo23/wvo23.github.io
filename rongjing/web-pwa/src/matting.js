/**
 * 浏览器端抠图模块（@imgly/background-removal + 本地 ONNX 模型）
 */
import { removeBackground as imglyRemove, preload as imglyPreload } from '@imgly/background-removal';

let _modelPromise = null;

function getConfig(onProgress = () => {}) {
  const base = new URL('../removebg/', import.meta.url).href;
  return {
    publicPath: base,
    model: 'isnet_quint8',
    device: 'cpu',
    proxyToWorker: false, // iOS Safari 的 Worker+WASM 兼容差，改主线程
    output: { format: 'image/png', quality: 0.9 },
    progress: (key, current, total) => {
      let p = 0.05;
      if (typeof current === 'number' && typeof total === 'number' && total > 0) p = 0.05 + 0.85 * (current / total);
      onProgress(Math.min(0.92, p), `正在加载 AI (${key})…`);
    },
    debug: false,
  };
}

export function preloadModel(onProgress = () => {}) {
  if (!_modelPromise) {
    _modelPromise = imglyPreload(getConfig(onProgress))
      .then(() => { try { window.dispatchEvent(new Event('rongjing-model-ready')); } catch (_) {} return { ok: true }; })
      .catch((e) => { _modelPromise = null; throw e; });
  }
  return _modelPromise;
}

export async function removeBackground(input, onProgress = () => {}) {
  onProgress(0.03, '正在加载 AI 模型（首次较慢，请耐心等待）…');
  try { await preloadModel(onProgress); } catch (e) { console.warn('预加载失败，尝试直接推理', e); }
  const blob = await imglyRemove(input, getConfig(onProgress));
  onProgress(0.92, '正在处理边缘…');
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  bitmap.close();
  onProgress(0.96, '抠图完成');
  return imageData;
}

export async function normalizeInput(file, maxDim = 768) {
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch (e) {
    try { bitmap = await bitmapViaImg(file); }
    catch (e2) {
      if (/heic|heif/i.test(file.type) || /heic|heif/i.test(file.name || ''))
        throw new Error('这是 iPhone 的 HEIC 照片，请在设置→相机→格式选「兼容性最佳」，或分享时选「JPEG」。');
      throw new Error('图片解码失败：' + (e2.message || e.message || '未知错误'));
    }
  }
  try { const { blob } = await bitmapToScaledBlob(bitmap, maxDim); return blob; }
  finally { bitmap.close?.(); }
}

function bitmapViaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); createImageBitmap(img).then(resolve).catch(reject); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img 解码失败')); };
    img.src = url;
  });
}

function bitmapToScaledBlob(src, maxDim) {
  const { width, height } = src;
  let w = width, h = height;
  if (width > maxDim || height > maxDim) { const s = maxDim / Math.max(width, height); w = Math.round(width * s); h = Math.round(height * s); }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(src, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve({ blob, width: w, height: h }), 'image/png'));
}

export async function loadImageBitmap(blobOrUrl, maxDim = 1024) {
  let source = blobOrUrl;
  if (typeof blobOrUrl === 'string') {
    const resp = await fetch(blobOrUrl);
    if (!resp.ok) throw new Error('背景加载失败: ' + blobOrUrl);
    source = await resp.blob();
  }
  const b = await createImageBitmap(source);
  if (b.width <= maxDim && b.height <= maxDim) return b;
  const scale = maxDim / Math.max(b.width, b.height);
  const w = Math.round(b.width * scale), h = Math.round(b.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(b, 0, 0, w, h);
  b.close();
  return createImageBitmap(canvas);
}

export function imageDataToBlob(imageData, type = 'image/png', quality = 0.92) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width; canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
