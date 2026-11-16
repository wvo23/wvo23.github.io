"""
素材重建脚本 —— 生成内置背景图与 APP 图标
二进制图片不适合通过文本通道传输，本地运行本脚本即可重建所有图片素材。
依赖：pip install pillow numpy    运行：python3 generate_assets.py
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import os

HERE = os.path.dirname(os.path.abspath(__file__))
BG_DIR = os.path.join(HERE, 'web-pwa', 'public', 'backgrounds')
ICON_DIR = os.path.join(HERE, 'web-pwa', 'public')
os.makedirs(BG_DIR, exist_ok=True)


def vgrad(w, h, c_top, c_bot):
    arr = np.zeros((h, w, 3), dtype=np.float32)
    for y in range(h):
        t = y / max(1, h - 1)
        arr[y, :, :] = np.array(c_top) * (1 - t) + np.array(c_bot) * t
    return arr


def make_bg_park(path):
    w, h = 720, 960
    arr = vgrad(w, h, (120, 180, 235), (150, 200, 120))
    for y in range(h // 2, h):
        arr[y, :, :] = arr[y, :, :] * 0.5 + np.array([70, 140, 60]) * 0.5
    img = Image.fromarray(arr.astype(np.uint8))
    d = ImageDraw.Draw(img)
    for (x, r) in [(80, 70), (640, 90), (120, 50), (600, 60)]:
        d.ellipse([x - r, 360 - r // 2, x + r, 360 + r // 2], fill=(40, 100, 45))
    ov = Image.new('RGB', (w, h), (0, 0, 0)); od = ImageDraw.Draw(ov)
    od.ellipse([-100, -100, 300, 300], fill=(120, 110, 80))
    ov = ov.filter(ImageFilter.GaussianBlur(120))
    img = Image.blend(img, Image.fromarray(np.clip(np.array(img).astype(int) + np.array(ov).astype(int), 0, 255).astype(np.uint8)), 0.6)
    img.save(path); print('背景-公园:', path)


def make_bg_room(path):
    w, h = 720, 960
    arr = vgrad(w, h, (235, 215, 185), (180, 140, 105))
    img = Image.fromarray(arr.astype(np.uint8)); d = ImageDraw.Draw(img)
    d.rectangle([0, 680, w, h], fill=(140, 95, 60))
    for i in range(8):
        y = 700 + i * 35
        d.line([(0, y), (w, y)], fill=(120, 78, 48), width=2)
    d.rectangle([60, 120, 240, 380], fill=(255, 245, 210), outline=(120, 90, 60), width=8)
    d.line([(150, 120), (150, 380)], fill=(120, 90, 60), width=6)
    img = img.filter(ImageFilter.GaussianBlur(1))
    img.save(path); print('背景-室内:', path)


def make_bg_office(path):
    w, h = 720, 960
    arr = vgrad(w, h, (205, 215, 225), (150, 160, 175))
    img = Image.fromarray(arr.astype(np.uint8)); d = ImageDraw.Draw(img)
    d.rectangle([0, 700, w, h], fill=(110, 118, 130))
    d.rectangle([450, 80, 700, 500], fill=(190, 205, 220))
    d.line([(575, 80), (575, 500)], fill=(120, 135, 150), width=6)
    img.save(path); print('背景-办公室:', path)


def make_person(path):
    W, H = 480, 640
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.ellipse([120, 230, 360, 700], fill=(45, 72, 120, 255))
    d.rectangle([215, 175, 265, 250], fill=(205, 160, 130, 255))
    d.ellipse([175, 60, 305, 220], fill=(225, 180, 150, 255))
    d.ellipse([168, 45, 312, 150], fill=(60, 40, 30, 255))
    d.pieslice([168, 60, 312, 190], 180, 360, fill=(60, 40, 30, 255))
    hl = Image.new('RGBA', (W, H), (0, 0, 0, 0)); hd = ImageDraw.Draw(hl)
    hd.ellipse([180, 65, 250, 205], fill=(255, 230, 210, 90))
    img = Image.alpha_composite(img, hl)
    hl2 = Image.new('RGBA', (W, H), (0, 0, 0, 0)); h2 = ImageDraw.Draw(hl2)
    h2.ellipse([140, 260, 230, 600], fill=(120, 150, 200, 60))
    img = Image.alpha_composite(img, hl2)
    img.save(path); print('测试人像:', path)


def make_icon(size):
    s = size
    img = Image.new('RGB', (s, s)); px = img.load()
    for y in range(s):
        for x in range(s):
            t = (x + y) / (2 * s)
            r = int(99 + (236 - 99) * t); g = int(102 + (72 - 102) * t); b = int(241 + (153 - 241) * t)
            px[x, y] = (r, g, b)
    d = ImageDraw.Draw(img)
    mask = Image.new('L', (s, s), 0); md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=255)
    cx = cy = s // 2
    d.ellipse([cx - int(s * 0.22), cy - int(s * 0.26), cx + int(s * 0.08), cy + int(s * 0.04)], fill=(255, 255, 255, 230))
    d.ellipse([cx - int(s * 0.08), cy - int(s * 0.04), cx + int(s * 0.22), cy + int(s * 0.26)], fill=(255, 255, 255, 180))
    img = img.convert('RGBA'); img.putalpha(mask)
    p = os.path.join(ICON_DIR, f'icon-{size}.png')
    img.save(p); print('图标:', p)


if __name__ == '__main__':
    make_bg_park(os.path.join(BG_DIR, 'park.png'))
    make_bg_room(os.path.join(BG_DIR, 'room.png'))
    make_bg_office(os.path.join(BG_DIR, 'office.png'))
    sd = os.path.join(HERE, 'desktop-python', 'assets', 'samples'); os.makedirs(sd, exist_ok=True)
    make_person(os.path.join(sd, 'person.png'))
    make_icon(192); make_icon(512)
    print('全部素材已生成。目录:', HERE)
