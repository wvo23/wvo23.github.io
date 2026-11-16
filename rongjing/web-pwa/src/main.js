/**
 * 融境 · 智能换背景 —— 主应用逻辑
 */
import { removeBackground, normalizeInput, loadImageBitmap, imageDataToBlob, preloadModel } from './matting.js';
import { placeForeground } from './place.js';
import { harmonize } from './fusion.js';

const $ = (id) => document.getElementById(id);

// ---------- 可见错误提示（真机上 alert 常被抑制，必须显示在页面上） ----------
function showError(msg) {
  const bar = $('errorBar');
  if (!bar) return;
  bar.innerHTML = '⚠️ <b>出错了：</b>' + (msg || '未知错误');
  bar.style.display = 'block';
  bar.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function clearError() {
  const bar = $('errorBar');
  if (bar) { bar.style.display = 'none'; bar.textContent = ''; }
}
window.addEventListener('error', (e) => showError(e.message || '脚本错误'));
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  showError((r && (r.message || r)) || '异步处理失败');
});

const state = { personFile: null, personPreview: null, customBgFile: null, bgBitmap: null, bgImageData: null, resultBlob: null };
const BUILTIN_BG = { park: './backgrounds/park.png', room: './backgrounds/room.png', office: './backgrounds/office.png' };
let selectedBg = 'room';

async function init() {
  try { await loadBackground(BUILTIN_BG[selectedBg]); }
  catch (e) { console.error('默认背景加载失败', e); }
  document.querySelectorAll('.bg-option').forEach((el) => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.bg-option').forEach((x) => x.classList.remove('active'));
      el.classList.add('active');
      selectedBg = el.dataset.bg;
      loadBackground(BUILTIN_BG[selectedBg]);
    });
  });
  $('personInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    state.personFile = file;
    const url = URL.createObjectURL(file);
    $('personPreview').src = url;
    $('personPreview').style.display = 'block';
    $('uploadHint').style.display = 'none';
    $('generateBtn').disabled = false;
    clearError();
    showProgress(true);
    preloadModel((p, msg) => setProgress(p, msg)).catch((e) => {
      showError('AI 模型加载失败，请检查网络后重试：' + (e.message || e));
      showProgress(false);
    });
  });
  $('bgInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    state.customBgFile = file;
    document.querySelectorAll('.bg-option').forEach((x) => x.classList.remove('active'));
    const bmp = await loadImageBitmap(file);
    state.bgBitmap = bmp;
    state.bgImageData = bitmapToImageData(bmp);
    $('bgCustomPreview').src = URL.createObjectURL(file);
    $('bgCustomPreview').style.display = 'block';
  });
  $('generateBtn').addEventListener('click', generate);
  $('saveBtn').addEventListener('click', saveResult);
  $('resetBtn').addEventListener('click', reset);
}

async function loadBackground(url) {
  const bmp = await loadImageBitmap(url);
  state.bgBitmap?.close?.();
  state.bgBitmap = bmp;
  state.bgImageData = bitmapToImageData(bmp);
}

function bitmapToImageData(bmp) {
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}

async function generate() {
  if (!state.personFile) { showError('请先上传人物照片'); return; }
  if (!state.bgImageData) { showError('背景还没准备好，请稍等一下再点生成'); return; }
  const btn = $('generateBtn');
  btn.disabled = true;
  clearError();
  showProgress(true);
  setProgress(0.02, '准备中…');
  try {
    setProgress(0.05, '正在准备图片…');
    const normalized = await normalizeInput(state.personFile, 1024);
    const cutout = await removeBackground(normalized, (p, msg) => setProgress(p, msg));
    setProgress(0.96, '正在摆放人物…');
    const params = readParams();
    const placed = placeForeground(cutout, state.bgImageData, { scale: params.scale, posX: params.posX, posY: params.posY });
    setProgress(0.97, '正在融合光影…');
    const fused = harmonize(placed.layer, state.bgImageData, {
      colorStrength: params.color, lightStrength: params.light, shadowStrength: params.shadow,
      feather: params.feather, decontaminate: true, bbox: placed.bbox,
    });
    const blob = await imageDataToBlob(fused, 'image/jpeg', 0.92);
    state.resultBlob = blob;
    $('resultImage').src = URL.createObjectURL(blob);
    $('resultImage').style.display = 'block';
    $('resultPlaceholder').style.display = 'none';
    $('saveBtn').style.display = 'inline-flex';
    $('saveHint').style.display = 'block';
    setProgress(1, '完成');
    setTimeout(() => showProgress(false), 600);
  } catch (err) {
    console.error(err);
    showProgress(false);
    showError('处理失败：' + (err.message || err));
  } finally {
    btn.disabled = false;
  }
}

function readParams() {
  return {
    scale: parseFloat($('scaleSlider').value), posX: parseFloat($('posXSlider').value), posY: parseFloat($('posYSlider').value),
    color: parseFloat($('colorSlider').value), light: parseFloat($('lightSlider').value),
    shadow: parseFloat($('shadowSlider').value), feather: parseInt($('featherSlider').value),
  };
}

function saveResult() {
  if (!state.resultBlob) return;
  const url = URL.createObjectURL(state.resultBlob);
  const a = document.createElement('a');
  a.href = url; a.download = `融境_换背景_${Date.now()}.jpg`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showProgress(show) { $('progressPanel').style.display = show ? 'block' : 'none'; }
function setProgress(p, msg) {
  $('progressBar').style.width = Math.round(p * 100) + '%';
  $('progressText').textContent = msg + ` ${Math.round(p * 100)}%`;
}
function reset() {
  state.personFile = null; state.resultBlob = null;
  $('personInput').value = ''; $('bgInput').value = '';
  $('personPreview').style.display = 'none'; $('bgCustomPreview').style.display = 'none';
  $('uploadHint').style.display = 'block';
  $('resultImage').style.display = 'none'; $('resultPlaceholder').style.display = 'block';
  $('saveBtn').style.display = 'none'; $('saveHint').style.display = 'none';
  $('generateBtn').disabled = true;
}

['scale','posX','posY','color','light','shadow','feather'].forEach((k) => {
  const el = $(k + 'Slider'); const out = $(k + 'Value');
  if (el && out) el.addEventListener('input', () => out.textContent = el.value);
});

function setupInstallTip() {
  const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const dismissed = localStorage.getItem('rongjing_tip_dismissed') === '1';
  if (!standalone && isIOS && !dismissed) {
    setTimeout(() => { $('installTip').style.display = 'block'; }, 2500);
    $('closeTip')?.addEventListener('click', () => {
      $('installTip').style.display = 'none';
      localStorage.setItem('rongjing_tip_dismissed', '1');
    });
  }
}
setupInstallTip();

function fillDiag() {
  const box = $('diagBox');
  if (!box) return;
  const info = [
    'UA: ' + navigator.userAgent,
    '独立模式: ' + (window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches),
    '跨域隔离: ' + crossOriginIsolated,
    '硬件并发: ' + navigator.hardwareConcurrency,
    '屏幕: ' + screen.width + 'x' + screen.height,
    '背景就绪: ' + !!state.bgImageData,
    '模型就绪: ' + !!_modelReady,
    '在线: ' + navigator.onLine,
  ];
  box.textContent = info.join('\n');
}
$('diagToggle')?.addEventListener('click', () => {
  fillDiag();
  const box = $('diagBox');
  box.style.display = box.style.display === 'block' ? 'none' : 'block';
});

let _modelReady = false;
window.addEventListener('rongjing-model-ready', () => { _modelReady = true; });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.log('SW 注册失败', e));
  });
}

init();
