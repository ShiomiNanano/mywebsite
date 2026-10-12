#!/usr/bin/env python3
"""合成风铃音效（用作"点击封面"的音效）。

为什么这类声音能合成：风铃是「有音高的金属敲击声」，物理很干净 ——
  一根金属管的振动是几个**非谐分音**，频率比约为 1 : 2.756 : 5.404 : 8.933，
  高次分音衰减更快。把这些分量按比例叠加，加一个极短的击打噪声和一点混响，
  听起来就是风铃。（人声/聊天那种复杂声源合成不出来，音高类可以。）

输出：单声道 44.1kHz WAV → 再用 ffmpeg 压成 mp3（点击音效必须小）。
用法：
  python tools/make-chime.py --out .preview/chime
"""
import argparse
import math
import os
import random
import shutil
import subprocess
import sys
import wave

import numpy as np

SR = 44100
# 金属管的非谐分音（自由-自由梁的经典比值）与各自的衰减时间、相对强度
RATIOS = [1.0, 2.756, 5.404, 8.933]
TAUS = [1.20, 0.55, 0.30, 0.16]
AMPS = [1.00, 0.42, 0.20, 0.09]
# 五声音阶（G5 A5 C6 D6 E6），风铃听起来最舒服
SCALE = [784.0, 880.0, 1046.5, 1174.7, 1318.5]


def tube(f0, dur, amp=1.0, seed=0):
    """一根金属管被敲响：非谐分音叠加 + 极短击打噪声。"""
    n = int(SR * dur)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for i, (r, tau, a) in enumerate(zip(RATIOS, TAUS, AMPS)):
        rng = random.Random(seed * 131 + i)
        phase = rng.uniform(0, 2 * math.pi)
        x += a * np.sin(2 * math.pi * f0 * r * t + phase) * np.exp(-t / tau)
    # 击打瞬间的金属噪声：6ms 的尖锐噪声，1.8ms 衰减
    na = int(SR * 0.006)
    noise = np.random.default_rng(seed).normal(0, 1, na) * np.exp(-np.arange(na) / (SR * 0.0018))
    x[:na] += noise * 0.30
    at = int(SR * 0.002)                     # 2ms 淡入，避免开头"咔"一声
    x[:at] *= np.linspace(0, 1, at)
    return x * amp


def reverb(x, taps=((0.043, 0.28), (0.071, 0.19), (0.113, 0.12), (0.163, 0.07))):
    """极简混响：几个衰减的延迟副本，给一点空间感（比干声自然得多）。"""
    extra = int(SR * taps[-1][0]) + 8
    y = np.concatenate([x, np.zeros(extra)])
    for d, g in taps:
        k = int(SR * d)
        y[k:k + len(x)] += x * g
    return y


def normalize(x, peak=0.55):
    m = float(np.max(np.abs(x))) or 1.0
    x = x * (peak / m)
    # 尾巴 30ms 淡出，避免截断爆音
    f = int(SR * 0.03)
    if len(x) > f:
        x[-f:] *= np.linspace(1, 0, f)
    return x


def write_wav(path, x):
    data = np.clip(x, -1, 1)
    pcm = (data * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def make_single():
    """一声清响：最轻、最短，适合当点击音效。"""
    x = tube(1046.5, 1.35, 1.0, seed=1)
    return normalize(reverb(x))


def make_triple():
    """经典三声：间隔均匀，像风铃被轻碰一下。"""
    total = int(SR * 2.4)
    y = np.zeros(total)
    for i, f in enumerate([1046.5, 880.0, 1174.7]):
        start = int(SR * (0.10 + i * 0.16))
        s = tube(f, 1.6, 1.0 - i * 0.12, seed=10 + i)
        seg = y[start:start + len(s)]
        seg += s[:len(seg)]
    return normalize(reverb(y))


def make_sway():
    """随风摇曳：五六声、间隔不规则、有轻有重。"""
    total = int(SR * 4.2)
    y = np.zeros(total)
    rng = random.Random(7)
    t = 0.05
    for i in range(6):
        f = SCALE[rng.randrange(len(SCALE))]
        amp = rng.uniform(0.45, 1.0)
        s = tube(f, 2.0, amp, seed=100 + i)
        start = int(SR * t)
        if start >= total:
            break
        seg = y[start:start + len(s)]
        seg += s[:len(seg)]
        t += rng.uniform(0.42, 0.78)
    return normalize(reverb(y))


def find_ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    for c in ('ffmpeg', 'ffmpeg.exe'):
        p = shutil.which(c)
        if p:
            return p
    return None


def main():
    ap = argparse.ArgumentParser(description='合成风铃音效')
    ap.add_argument('--out', default='.preview/chime', help='输出目录')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    variants = [('chime-single', make_single, '一声清响'),
                ('chime-triple', make_triple, '经典三声'),
                ('chime-sway', make_sway, '随风摇曳')]
    ff = find_ffmpeg()
    print('ffmpeg: %s' % (ff or '（没找到，只出 WAV）'))

    made = []
    for name, fn, desc in variants:
        x = fn()
        wav = os.path.join(args.out, name + '.wav')
        write_wav(wav, x)
        out = wav
        if ff:
            mp3 = os.path.join(args.out, name + '.mp3')
            r = subprocess.run([ff, '-y', '-loglevel', 'error', '-i', wav,
                                '-ac', '1', '-b:a', '112k', mp3],
                               capture_output=True)
            if r.returncode == 0 and os.path.exists(mp3):
                out = mp3
                os.remove(wav)
            else:
                print('  ! mp3 编码失败：%s' % r.stderr.decode('utf-8', 'replace')[:120])
        made.append((name, desc, out))
        print('  %-14s %-8s %5.2f 秒  %6.1f KB' % (
            name, desc, len(x) / SR, os.path.getsize(out) / 1024))

    # 附带一个可以双击打开的试听页（不需要服务器）
    html = os.path.join(args.out, '试听.html')
    rows = '\n'.join(
        '  <div class="row"><div class="t">%s<span>%s</span></div>'
        '<audio controls preload="auto" src="%s"></audio></div>' % (d, n, os.path.basename(p))
        for n, d, p in made)
    open(html, 'w', encoding='utf-8').write('''<!doctype html>
<meta charset="utf-8"><title>风铃试听</title>
<style>
  body { margin:0; padding:34px 22px; background:#12100d; color:#efe6d4;
         font-family:"Noto Serif SC","Songti SC",serif; }
  h1 { font-size:19px; font-weight:600; letter-spacing:.14em; margin:0 0 6px; color:#d3b37e; }
  p  { margin:0 0 26px; font-size:12px; color:#9c917e; letter-spacing:.06em; }
  .row { display:flex; align-items:center; gap:18px; padding:14px 0;
         border-bottom:1px solid rgba(239,230,212,.10); }
  .t { width:190px; font-size:15px; letter-spacing:.08em; }
  .t span { display:block; margin-top:3px; font-size:11px; color:#8d8574; letter-spacing:.1em; }
  audio { flex:1; height:34px; }
</style>
<h1>风铃音效 · 三个版本</h1>
<p>点播放试听。挑一个（或让我调音高、时长、清脆程度）再接到封面上。</p>
''' + rows + '\n')

    print('\n试听页：%s（双击打开，不用起服务器）' % html)


if __name__ == '__main__':
    main()
