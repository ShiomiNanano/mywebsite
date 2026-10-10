#!/usr/bin/env python3
"""把素材库里的 logo（白底）做成封面可用的「金色烫印」蒙版。

思路：不直接贴图片，而是把 logo 转成「白色图案 + 透明背景」的蒙版，
      由 CSS 用 mask + 渐变给它上色 —— 这样 logo 会跟着站点的配色走
      （现在的主色是从壁纸里提取的暖金），而且任意缩放都清晰。

做四件事：
  1. 按亮度算 alpha：黑线条 → 不透明，白底 → 透明
  2. 把很低的 alpha 抹成 0（白底上那点纸张纹理的噪点，不清掉会有脏边）
  3. 裁到图案的实际边界 + 一点内边距（否则上下留白会让排版间距算不准）
  4. 输出白色 + 透明通道的 PNG

用法：
  python tools/make-logo.py --src "D:\\素材库\\logo（黑白）.png" --out public/media
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFilter


def main():
    ap = argparse.ArgumentParser(description='把白底 logo 做成 CSS 蒙版')
    ap.add_argument('--src', required=True, help='源文件（建议用黑白版，线条最干净）')
    ap.add_argument('--out', required=True, help='输出目录（一般是 public/media）')
    ap.add_argument('--name', default='logo-mask', help='输出文件名（不含扩展名）')
    ap.add_argument('--threshold', type=int, default=18,
                    help='低于这个 alpha 的一律抹成 0（去掉白底纹理噪点，默认 18）')
    ap.add_argument('--pad', type=int, default=6, help='裁切后四周留的像素（默认 6）')
    ap.add_argument('--max-width', type=int, default=900, help='最大宽度，超过会等比缩小')
    args = ap.parse_args()

    im = Image.open(args.src).convert('L')
    w, h = im.size
    print('源图: %sx%s' % (w, h))

    # 1) 亮度 → alpha（反相）：黑 = 255，白 = 0
    alpha = im.point(lambda v: 255 - v)

    # 2) 抹掉很低的 alpha（白底上的细微纹理）
    alpha = alpha.point(lambda v: 0 if v < args.threshold else v)

    # 3) 按 alpha 的实际边界裁切（+ pad）
    bbox = alpha.getbbox()
    if not bbox:
        sys.exit('✗ 整张图都是透明的？检查一下阈值 --threshold')
    x0, y0, x1, y1 = bbox
    x0 = max(0, x0 - args.pad); y0 = max(0, y0 - args.pad)
    x1 = min(w, x1 + args.pad); y1 = min(h, y1 + args.pad)
    alpha = alpha.crop((x0, y0, x1, y1))
    print('裁切后: %sx%s（原区域 %s）' % (alpha.size[0], alpha.size[1], bbox))

    # 4) 白色 + alpha
    out = Image.new('RGBA', alpha.size, (255, 255, 255, 0))
    out.putalpha(alpha)
    if out.size[0] > args.max_width:
        ratio = args.max_width / out.size[0]
        out = out.resize((args.max_width, max(1, round(out.size[1] * ratio))), Image.LANCZOS)
        print('缩放到: %sx%s' % out.size)

    os.makedirs(args.out, exist_ok=True)
    dest = os.path.join(args.out, args.name + '.png')
    out.save(dest, 'PNG', optimize=True)
    size = os.path.getsize(dest)
    print('\n输出: %s  %.1f KB  %sx%s  宽高比 %.3f' % (
        dest, size / 1024, out.size[0], out.size[1], out.size[0] / out.size[1]))
    print('CSS 里用 width + aspect-ratio: %.3f 就能保证不变形' % (out.size[0] / out.size[1]))

    # ---------- 顶栏小标记：只要咖啡杯那部分（文字在 26px 下是糊的）----------
    mark = out.crop(split_mark(out))
    mark_path = os.path.join(args.out, 'logo-mark.png')
    mark.save(mark_path, 'PNG', optimize=True)
    print('\n顶栏标记: %s  %.1f KB  %sx%s  宽高比 %.3f' % (
        os.path.basename(mark_path), os.path.getsize(mark_path) / 1024,
        mark.size[0], mark.size[1], mark.size[0] / mark.size[1]))

    # ---------- favicon：深色圆角方块 + 金色咖啡杯 ----------
    solid = simple_silhouette(mark)
    solid_path = os.path.join(args.out, 'logo-simple.png')
    solid.save(solid_path, 'PNG', optimize=True)
    print('简化剪影: %s  %.1f KB  %sx%s' % (
        os.path.basename(solid_path), os.path.getsize(solid_path) / 1024, solid.size[0], solid.size[1]))

    for px in (32, 180):
        fav = make_favicon(solid, px, bg=(43, 36, 29), fg=(211, 179, 126))
        name = 'favicon-%d.png' % px if px <= 32 else 'favicon.png'
        fp = os.path.join(args.out, name)
        fav.save(fp, 'PNG', optimize=True)
        print('图标: %s  %.1f KB  %sx%s' % (name, os.path.getsize(fp) / 1024, px, px))


def split_mark(img, gap_ratio=0.06):
    """把「杯子」和下面的「Daydream Café」文字分开。
    做法：看每一行的 alpha 总量，在图中下部找一条足够宽的全空行。"""
    w, h = img.size
    a = img.split()[-1]
    rows = [sum(a.crop((0, y, w, y + 1)).tobytes()) for y in range(h)]
    min_gap = max(3, int(h * gap_ratio))
    best = None
    y = int(h * 0.35)
    while y < h - min_gap:
        if rows[y] == 0:
            start = y
            while y < h and rows[y] == 0:
                y += 1
            if (y - start) >= min_gap:
                best = start + (y - start) // 2
            continue
        y += 1
    if best is None:
        best = int(h * 0.62)      # 兜底：取上半部分
        print('（没找到明显空隙，按 62% 处切分）')
    return (0, 0, w, best)



def simple_silhouette(mark, drop_top=0.24, threshold=40):
    """由线条蒙版求出"实心剪影"版，专供 favicon（16~32px）。

    上一版我用的是闭运算（膨胀+腐蚀），结果杯身、把手、碟子全糊成一块板 ✗。
    正确做法是泛洪填充：从画面四角把"外部背景"灌满，剩下的就是杯子的实体轮廓
    （杯子内部和把手中间那些被线条围住的区域会一并算进来 —— 那正是我们要的实心感）。

    顺带切掉上方的小 zzz：那个尺寸下它只会变成一团噪点。
    """
    w, h = mark.size
    # 注意：这里必须取 alpha 通道。用 convert('L') 会把透明丢掉（RGB 全是白的），
    # 结果整张图都被当成"墨迹"，泛洪一填就什么都不剩。
    m = mark.crop((0, int(h * drop_top), w, h)).split()[-1]
    binary = m.point(lambda v: 255 if v >= threshold else 0)

    filled = binary.copy()
    for xy in [(0, 0), (w - 1, 0), (0, m.size[1] - 1), (w - 1, m.size[1] - 1)]:
        ImageDraw.floodfill(filled, xy, 128, thresh=0)     # 外部背景 → 128
    solid = filled.point(lambda v: 0 if v == 128 else 255) # 非外部 = 实体

    out = Image.new('RGBA', m.size, (255, 255, 255, 0))
    out.putalpha(solid)
    return out


def make_favicon(mark, px, bg, fg, close_lines=False):
    """把杯子标记染成金色，放在深色圆角方块上。先在 4 倍尺寸画再缩小，边缘才干净。"""
    S = px * 4
    canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    # 圆角底
    plate = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(plate)
    r = int(S * 0.22)
    d.rounded_rectangle((0, 0, S - 1, S - 1), radius=r, fill=bg + (255,))
    canvas = Image.alpha_composite(canvas, plate)
    # 小图标留白少一点、线条粗一点，才能在 16px 下看出是只杯子
    small = px <= 48
    scale = (S * (0.88 if small else 0.76)) / mark.size[0]
    m = mark.resize((max(1, round(mark.size[0] * scale)), max(1, round(mark.size[1] * scale))), Image.LANCZOS)
    alpha = m.split()[-1]
    if small and close_lines:
        alpha = alpha.filter(ImageFilter.MaxFilter(3))     # 细线时加粗约 1px
    colored = Image.new('RGBA', m.size, fg + (0,))
    colored.putalpha(alpha)
    canvas.alpha_composite(colored, ((S - m.size[0]) // 2, (S - m.size[1]) // 2))
    return canvas.resize((px, px), Image.LANCZOS)


if __name__ == '__main__':
    main()
