/**
 * 智能放置：把抠出的人物 ImageData 放置到背景上
 * 返回 { layer: ImageData(背景坐标系,含alpha), bbox }
 */
export function tightenCrop(imageData, padRatio = 0.02) {
  const { width: w, height: h, data } = imageData;
  let minX = w, minY = h, maxX = 0, maxY = 0, found = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 8) { found = true; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (!found) return imageData;
  const px = Math.round(w * padRatio), py = Math.round(h * padRatio);
  minX = Math.max(0, minX - px); minY = Math.max(0, minY - py);
  maxX = Math.min(w - 1, maxX + px); maxY = Math.min(h - 1, maxY + py);
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const si = ((y + minY) * w + (x + minX)) * 4, di = (y * cw + x) * 4;
    out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = data[si + 3];
  }
  return new ImageData(out, cw, ch);
}

function scaleImageData(src, nw, nh) {
  const canvas = document.createElement('canvas');
  canvas.width = src.width; canvas.height = src.height;
  canvas.getContext('2d').putImageData(src, 0, 0);
  const out = document.createElement('canvas'); out.width = nw; out.height = nh;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, nw, nh);
  return ctx.getImageData(0, 0, nw, nh);
}

export function placeForeground(fg, bg, opts = {}) {
  const { scale = 1.0, posX = 0.5, posY = 0.92, anchor = 'feet' } = opts;
  fg = tightenCrop(fg);
  const Bw = bg.width, Bh = bg.height, Fw = fg.width, Fh = fg.height;
  let targetH = Math.round(Bh * 0.78 * scale);
  let targetW = Math.round(Fw * targetH / Fh);
  if (targetW > Bw * 0.92) { targetW = Math.round(Bw * 0.92); targetH = Math.round(Fh * targetW / Fw); }
  const resized = scaleImageData(fg, targetW, targetH);
  const cx = Math.round(posX * Bw);
  let x0 = cx - Math.round(targetW / 2);
  let y0 = anchor === 'feet' ? Math.round(posY * Bh) - targetH : Math.round(posY * Bh) - Math.round(targetH / 2);
  x0 = Math.max(0, Math.min(Bw - targetW, x0));
  y0 = Math.max(0, Math.min(Bh - targetH, y0));
  const x1 = x0 + targetW, y1 = y0 + targetH;
  const layer = new Uint8ClampedArray(Bw * Bh * 4);
  for (let y = 0; y < targetH; y++) for (let x = 0; x < targetW; x++) {
    const si = (y * targetW + x) * 4, di = ((y + y0) * Bw + (x + x0)) * 4;
    layer[di] = resized.data[si]; layer[di + 1] = resized.data[si + 1]; layer[di + 2] = resized.data[si + 2]; layer[di + 3] = resized.data[si + 3];
  }
  return { layer: new ImageData(layer, Bw, Bh), bbox: [x0, y0, x1, y1] };
}
