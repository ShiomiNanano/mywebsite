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

from PIL import Image


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


if __name__ == '__main__':
    main()
