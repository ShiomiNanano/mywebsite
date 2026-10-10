#!/usr/bin/env python3
"""把素材库里的动态壁纸处理成网页可用的资源。

做四件事：
  1. 从源视频里切一段短循环，缩到网页合适的尺寸并重新压缩（H.264 + faststart）
  2. 抽一张海报图（poster）：视频还没开始播、或者移动端不播视频时显示它
  3. 生成一张极小的模糊占位图（LQIP）并输出 base64，用于首屏瞬间铺底色、避免白屏
  4. 从画面里提取配色，生成一组 CSS 变量（--wp-*），让页面配色跟着壁纸走

依赖：ffmpeg / ffprobe 在 PATH 里；Python 有 Pillow 和 numpy。
用法示例（见文件末尾的 __main__ 参数说明）。
"""
import argparse
import base64
import io
import json
import os
import shutil
import subprocess
import sys

from PIL import Image, ImageFilter
import numpy as np


# ---------- 小工具 ----------

def need(cmd):
    p = shutil.which(cmd)
    if not p:
        sys.exit('找不到 %s，请先安装 ffmpeg 并确保它在 PATH 里' % cmd)
    return p


def run(args, quiet=True):
    r = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if r.returncode != 0:
        sys.stderr.write(r.stdout.decode('utf-8', 'replace')[-3000:])
        sys.exit('命令失败：' + ' '.join(args[:6]) + ' …')
    return r.stdout.decode('utf-8', 'replace')


def find_bin(name, hint=None):
    """依次尝试：命令行参数 → PATH → imageio-ffmpeg 自带的二进制"""
    if hint:
        return hint
    p = shutil.which(name)
    if p:
        return p
    try:
        import imageio_ffmpeg
        if name == 'ffmpeg':
            return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    if name == 'ffprobe':
        return None          # 没有 ffprobe 也能跑，下面会退化成解析 ffmpeg -i 的输出
    sys.exit('找不到 %s：请安装 ffmpeg，或用 --ffmpeg 指定路径' % name)


def ffprobe_video(path, ffmpeg, ffprobe):
    """优先用 ffprobe；没有就解析 ffmpeg -i 的 stderr"""
    if ffprobe:
        out = run([ffprobe, '-v', 'error', '-select_streams', 'v:0',
                   '-show_entries', 'stream=width,height,r_frame_rate,codec_name',
                   '-show_entries', 'format=duration,size',
                   '-of', 'json', path])
        try:
            return json.loads(out)
        except Exception:
            pass
    r = subprocess.run([ffmpeg, '-hide_banner', '-i', path], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    txt = r.stdout.decode('utf-8', 'replace')
    import re
    v = re.search(r'Video:\s*(\w+).*?,\s*(\d{2,5})x(\d{2,5})', txt)
    d = re.search(r'Duration:\s*(\d+):(\d+):(\d+\.\d+)', txt)
    if not v:
        sys.exit('无法解析视频信息，请安装 ffprobe 或用 --ffprobe 指定')
    dur = (int(d.group(1)) * 3600 + int(d.group(2)) * 60 + float(d.group(3))) if d else 0.0
    return {'streams': [{'codec_name': v.group(1), 'width': int(v.group(2)), 'height': int(v.group(3))}],
            'format': {'duration': str(dur), 'size': str(os.path.getsize(path))}}


def human(n):
    for unit in ('B', 'KB', 'MB', 'GB'):
        if n < 1024 or unit == 'GB':
            return '%.1f %s' % (n, unit)
        n /= 1024.0


# ---------- 颜色 ----------

def srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rel_luminance(rgb):
    r, g, b = (srgb_to_linear(v) for v in rgb[:3])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = rel_luminance(a), rel_luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def hexof(rgb):
    return '#%02x%02x%02x' % tuple(int(round(v)) for v in rgb[:3])


def rgbof(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(a[i] * (1 - t) + b[i] * t for i in range(3))


def sat(rgb):
    mx, mn = max(rgb[:3]), min(rgb[:3])
    return 0.0 if mx == 0 else (mx - mn) / mx


def shade(rgb, t):
    """t<0 变暗，t>0 变亮"""
    return mix(rgb, (0, 0, 0) if t < 0 else (255, 255, 255), abs(t))


def darken_until(c, bg, target):
    """把颜色逐步压暗，直到它在 bg 上的对比度达标。
    亮金直接用在白底上只有 1.9:1，当链接色会看不清，所以浅色界面要用压暗版。"""
    out = c
    for _ in range(40):
        if contrast(out, bg) >= target:
            break
        out = shade(out, -0.06)
    return out


def extract_palette(img, k=6):
    """用 PIL 的中位切分量化取主色，返回 [(rgb, 占比)] 按占比降序"""
    small = img.convert('RGB').resize((240, max(1, int(240 * img.height / img.width))), Image.LANCZOS)
    q = small.quantize(colors=k, method=Image.MEDIANCUT)
    pal = q.getpalette()
    counts = sorted(q.getcolors(), key=lambda c: -c[0])
    total = sum(c for c, _ in counts)
    out = []
    for cnt, idx in counts:
        rgb = tuple(pal[idx * 3:idx * 3 + 3])
        out.append((rgb, cnt / total))
    return out


def hue(rgb):
    r, g, b = [v / 255.0 for v in rgb[:3]]
    mx, mn = max(r, g, b), min(r, g, b)
    d = mx - mn
    if d < 1e-6:
        return 0.0
    if mx == r:
        h = ((g - b) / d) % 6
    elif mx == g:
        h = (b - r) / d + 2
    else:
        h = (r - g) / d + 4
    return h * 60.0


def cool_accent(img, min_share=0.012):
    """画面里若确实有青绿/蓝紫（叶子、菜单板之类），取它们当"次强调色"，用得克制。
    返回 (颜色 或 None, 占比)"""
    small = img.convert('RGB').resize((200, max(1, int(200 * img.height / img.width))), Image.LANCZOS)
    a = np.asarray(small).astype(np.float32) / 255.0
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(2), a.min(2)
    d = mx - mn
    s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
    h = np.zeros_like(mx)
    nz = d > 1e-6
    i = nz & (mx == r); h[i] = ((g - b)[i] / d[i]) % 6
    i = nz & (mx == g); h[i] = ((b - r)[i] / d[i]) + 2
    i = nz & (mx == b); h[i] = ((r - g)[i] / d[i]) + 4
    h *= 60
    mask = (s > 0.18) & (h >= 140) & (h <= 265)
    share = float(mask.mean())
    if share < min_share:
        return None, share
    return tuple((a[mask] * 255).mean(0)), share


def build_theme(img):
    """把画面主色翻译成一组语义化的界面颜色"""
    pal = extract_palette(img, 6)
    avg = tuple(int(x) for x in np.asarray(img.convert('RGB').resize((1, 1), Image.LANCZOS))[0][0])
    dark = min(pal, key=lambda p: rel_luminance(p[0]))[0]
    light = max(pal, key=lambda p: rel_luminance(p[0]))[0]
    mood_dark = rel_luminance(avg) < 0.28

    # 强调色：不取"最饱和"（那往往是暗褐），也不取"最亮"（那往往是奶白），
    # 而是在暖色里找"饱和度够、亮度居中"的那个 —— 也就是画面里那束暖金。
    def chroma_score(c):
        return sat(c) * (1 - abs(rel_luminance(c) - 0.45))

    colorful = [c for c, _ in pal if sat(c) >= 0.15]
    warm = [c for c in colorful if hue(c) < 95 or hue(c) > 295]
    accent = max(warm or colorful or [light], key=chroma_score)

    cool, cool_share = cool_accent(img)
    # 次强调：画面确实有青绿就用它（用得克制）；否则用主强调的亮调，方便做渐变/高光
    accent2 = shade(cool, 0.12) if cool else shade(accent, 0.28)
    # 浅色界面上能当文字/链接的压暗版（对比度 >= 4.5:1），以及它的更深调
    accent_ink = darken_until(accent, (255, 255, 255), 4.5)
    accent_deep = shade(accent_ink, -0.18)

    # 底/文字：保证正文对比度足够（目标 >= 7，接近 AAA）
    base = shade(dark, -0.45) if mood_dark else shade(avg, -0.72)
    ink = (244, 246, 250)
    if contrast(ink, base) < 7:
        base = shade(base, -0.35)
    if contrast(ink, base) < 7:
        ink = (255, 255, 255)
        base = shade(base, -0.25)

    return {
        'avg': avg, 'mood_dark': mood_dark, 'palette': pal,
        'base': base, 'ink': ink, 'accent': accent, 'accent2': accent2,
        'accent_ink': accent_ink, 'accent_deep': accent_deep,
        'cream': light, 'deep': shade(base, -0.35), 'glow': accent,
        'cool_share': cool_share,
        'contrast_body': contrast(ink, base),
        'contrast_accent': contrast(accent, base),
        'contrast_accent_light': contrast(accent_ink, (255, 255, 255)),
        'contrast_cream_on_accent': contrast((253, 250, 243), accent_ink),
    }


def css_block(theme):
    b, ink, ac, ac2 = theme['base'], theme['ink'], theme['accent'], theme['accent2']
    cream = theme['cream']
    lines = [
        '/* 由 tools/make-wallpaper.py 依据壁纸自动生成 —— 不要手改，重新跑脚本即可 */',
        ':root {',
        '  /* 画面平均色 %s（%s）；冷色占比 %.1f%% */' % (
            hexof(theme['avg']), '偏暗' if theme['mood_dark'] else '偏亮', theme['cool_share'] * 100),
        '  --wp-base: %s;' % hexof(b),
        '  --wp-deep: %s;' % hexof(theme['deep']),
        '  --wp-ink: %s;' % hexof(ink),
        '  --wp-ink-soft: rgba(%d, %d, %d, .78);' % tuple(int(x) for x in ink),
        '  --wp-cream: %s;' % hexof(cream),
        '  --wp-accent: %s;' % hexof(ac),
        '  --wp-accent-2: %s;' % hexof(ac2),
        '  /* 浅色界面上当文字/链接用的压暗版（对比度已达 %.1f:1） */' % theme['contrast_accent_light'],
        '  --wp-accent-ink: %s;' % hexof(theme['accent_ink']),
        '  --wp-accent-deep: %s;' % hexof(theme['accent_deep']),
        '  --wp-glow: rgba(%d, %d, %d, .34);' % tuple(int(x) for x in theme['glow']),
        '  --wp-glow-soft: rgba(%d, %d, %d, .16);' % tuple(int(x) for x in theme['glow']),
        '  --wp-line: rgba(%d, %d, %d, .34);' % tuple(int(x) for x in ink),
        '  --wp-line-soft: rgba(%d, %d, %d, .18);' % tuple(int(x) for x in ink),
        '  --wp-veil: rgba(%d, %d, %d, .58);' % tuple(int(x) for x in b),
        '  --wp-veil-strong: rgba(%d, %d, %d, .88);' % tuple(int(x) for x in b),
        '  --wp-cover-1: %s;' % hexof(shade(ac, -0.62)),
        '  --wp-cover-2: %s;' % hexof(shade(b, -0.12)),
        '}',
    ]
    return '\n'.join(lines)


# ---------- 主流程 ----------

def main():
    ap = argparse.ArgumentParser(description='把动态壁纸处理成网页资源')
    ap.add_argument('--src', required=True, help='源视频路径')
    ap.add_argument('--out', required=True, help='输出目录（一般是 public/media）')
    ap.add_argument('--start', type=float, default=0, help='从第几秒开始截（建议取关键帧处，10 的倍数）')
    ap.add_argument('--dur', type=float, default=10, help='循环时长（秒）')
    ap.add_argument('--width', type=int, default=1280, help='输出宽度，高度按比例')
    ap.add_argument('--crf', type=int, default=28, help='H.264 质量，越大越小越糊（推荐 26-30）')
    ap.add_argument('--poster-at', type=float, default=None, help='海报取第几秒（默认取 start+1）')
    ap.add_argument('--name', default='wallpaper', help='输出文件名前缀')
    ap.add_argument('--ffmpeg', default=None, help='ffmpeg 路径（默认自动找）')
    ap.add_argument('--ffprobe', default=None, help='ffprobe 路径（没有会自动降级）')
    args = ap.parse_args()

    ffmpeg = find_bin('ffmpeg', args.ffmpeg)
    ffprobe = find_bin('ffprobe', args.ffprobe)
    os.makedirs(args.out, exist_ok=True)
    poster_at = args.poster_at if args.poster_at is not None else args.start + 1.0

    info = ffprobe_video(args.src, ffmpeg, ffprobe)
    st = info['streams'][0]
    fmt = info.get('format', {})
    print('源视频: %sx%s %s  时长 %.1fs  大小 %s' % (
        st['width'], st['height'], st.get('codec_name'), float(fmt.get('duration', 0)), human(int(fmt.get('size', 0)))))

    mp4 = os.path.join(args.out, args.name + '.mp4')
    poster = os.path.join(args.out, args.name + '-poster.webp')
    lqip = os.path.join(args.out, args.name + '-lqip.webp')

    # 1) 短循环：先快进到 start（关键帧处最干净），再截 dur 秒；-an 去掉音轨
    run([ffmpeg, '-y', '-ss', str(args.start), '-t', str(args.dur), '-i', args.src,
         '-an', '-vf', 'scale=%d:-2:flags=lanczos' % args.width,
         '-c:v', 'libx264', '-crf', str(args.crf), '-preset', 'slow',
         '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.0',
         '-movflags', '+faststart', mp4])

    # 2) 海报图
    run([ffmpeg, '-y', '-ss', str(poster_at), '-i', args.src, '-frames:v', '1',
         '-vf', 'scale=%d:-2:flags=lanczos' % args.width, '-quality', '82', poster])

    # 3) LQIP：32 像素宽、轻微模糊，内联进 CSS 用
    im = Image.open(poster).convert('RGB')
    small = im.resize((32, max(1, round(32 * im.height / im.width))), Image.LANCZOS)
    small = small.filter(ImageFilter.GaussianBlur(0.6))
    small.save(lqip, 'WEBP', quality=55, method=6)
    buf = io.BytesIO()
    small.save(buf, 'WEBP', quality=55, method=6)
    b64 = base64.b64encode(buf.getvalue()).decode()

    # 4) 配色
    theme = build_theme(im)
    css = css_block(theme)
    css_path = os.path.join(args.out, args.name + '-palette.css')
    with open(css_path, 'w', encoding='utf-8') as f:
        f.write(css + '\n')

    print('\n--- 输出 ---')
    for p in (mp4, poster, lqip, css_path):
        print('  %-46s %s' % (os.path.basename(p), human(os.path.getsize(p))))
    print('\n--- 画面主色（占比）---')
    for rgb, ratio in theme['palette']:
        print('  %s  %5.1f%%   亮度 %.3f' % (hexof(rgb), ratio * 100, rel_luminance(rgb)))
    print('\n--- 生成的配色 ---')
    print('  底色 %s   文字 %s   主强调 %s   次强调 %s' % (
        hexof(theme['base']), hexof(theme['ink']), hexof(theme['accent']), hexof(theme['accent2'])))
    print('  浅色界面用色 %s（对白底 %.1f:1，可直接当链接色）' % (
        hexof(theme['accent_ink']), theme['contrast_accent_light']))
    print('  正文对比度 %.1f:1（目标 >= 7）   强调色对底色对比度 %.1f:1' % (
        theme['contrast_body'], theme['contrast_accent']))
    print('  米白字压在该强调色上 %.1f:1（>= 4.5 才适合当按钮文字）' % theme['contrast_cream_on_accent'])
    print('\n--- LQIP（可直接内联进 CSS）---')
    print('  data:image/webp;base64,' + b64)
    print('\n配色 CSS 已写入: %s' % css_path)


if __name__ == '__main__':
    main()
