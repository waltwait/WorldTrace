#!/usr/bin/env python3
"""把 Noto Sans TC 的行框改成「上下對稱於中文字面中心」。

為什麼（2026-09-26，實機截圖逐像素量）：
    原檔 hhea ascent 1.160em／descent 0.288em，中文字面（ideographic em box，OS/2 typo
    +0.88／−0.12）的中心在基線上 0.38em，比行框中心（0.436em）低 0.056em。
    結果是全 App 的中文字在按鈕、膠囊、置中列裡都偏下 0.5～1dp
    （「波段」0.67dp、「▲加碼(5)」1.0dp，雷達連續天數膠囊因此看起來往上跑）。
    Compose／Android 沒有可以改行框上下緣的文字樣式，只能改字型本身。

怎麼改：
    總行高（ascent + descent）不變 ⇒ 任何一行字的高度都不變，版面不會被撐開或縮小；
    只把基線往上挪，讓字面中心落在行框正中間：
        ascent  = 字面中心 + 總行高 / 2   （1.160 → 1.104）
        descent = 總行高 / 2 − 字面中心   （0.288 → 0.344）
    只改 hhea（Android／FreeType 用它當行框）。OS/2 win 是 Windows 的裁切範圍，留原值（較大較安全）；
    OS/2 typo 就是字面框本身，也不動。這個字型沒有 MVAR，各字重共用同一組值。

授權：OFL 1.1，保留字型名稱只有 'Source'，修改版沿用 Noto Sans TC 的名稱沒有問題。

用法（可重跑，已對稱就不會再動）：
    python3 -m pip install --target /tmp/ft fonttools
    PYTHONPATH=/tmp/ft python3 tools/fonts/center_noto_line_box.py assets/fonts/NotoSansTC-Regular.ttf  # 每個字重各跑一次
"""
import sys

from fontTools.ttLib import TTFont


def main(path: str) -> None:
    font = TTFont(path)
    hhea, os2 = font["hhea"], font["OS/2"]
    upm = font["head"].unitsPerEm
    total = hhea.ascent - hhea.descent  # descent 是負值
    center = (os2.sTypoAscender + os2.sTypoDescender) / 2  # 字面框中心
    ascent = round(center + total / 2)
    descent = -(total - ascent)
    print(f"before ascent={hhea.ascent / upm:.3f} descent={-hhea.descent / upm:.3f} (total {total / upm:.3f}em)")
    if (hhea.ascent, hhea.descent) == (ascent, descent):
        print("already centered; nothing to do")
        return
    hhea.ascent, hhea.descent = ascent, descent
    font.save(path)
    print(f"after  ascent={ascent / upm:.3f} descent={-descent / upm:.3f} (字面中心 {center / upm:.3f}em 在行框正中)")


if __name__ == "__main__":
    main(sys.argv[1])
