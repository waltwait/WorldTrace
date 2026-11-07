#!/usr/bin/env python3
"""把「預設以彩色 emoji 顯示」的字（Unicode Emoji_Presentation=Yes）從內建字型的 cmap 拿掉。

為什麼（2026-09-27，使用者截圖：每日報告「🆕新進」的 🆕 變成一個黑白方框）：
    App 的字型是 DejaVu Sans Mono → Noto Sans TC → 系統字型的後援鏈（AppFont.kt）。
    Android 用「第一個有這個字的字型」，Noto Sans TC 剛好有單色的 🆕，系統的彩色 emoji 就輪不到。
    RN 用系統字型，沒有這個問題。受影響的字：
        DejaVu Sans Mono（含 Bold）：◽◾☔☕♿⚓⚡➿ 與十二星座
        Noto Sans TC：🆕🆗🆙🆒🆓🆘🆚🆎🆑🆔🆖 🈁🈚🈯🈲🈳🈴🈵🈶🈸🈹🈺🉐🉑 ⚽⚾

怎麼改：
    只刪 cmap 對照（所有 Unicode 子表），字形留在檔案裡；這些字就會落到系統的彩色 emoji。
    只處理 Emoji_Presentation=Yes 的字；⚠ ✔ © 這類「預設是文字、加 FE0F 才是 emoji」的不動
    （帶 FE0F 時 Android 本來就會改挑彩色字型；不帶時報告裡是當文字符號用）。
    清單在同目錄的 emoji_presentation.txt（Unicode 15.1 emoji-data.txt），
    JVM 測試 BundledFontEmojiTest 讀同一份，換字型檔後忘了重跑這支就會紅。

授權：DejaVu（Bitstream Vera 衍生授權）與 Noto（OFL 1.1）都允許修改後散布。

用法（可重跑，已經沒有就不會再動）：
    python3 -m pip install --target /tmp/ft fonttools
    PYTHONPATH=/tmp/ft python3 tools/fonts/strip_emoji_presentation.py assets/fonts/NotoSansTC-Regular.ttf assets/fonts/NotoSansTC-Bold.ttf assets/fonts/NotoSansTC-Black.ttf
"""
import os
import sys

from fontTools.ttLib import TTFont


def emoji_presentation() -> set[int]:
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "emoji_presentation.txt")
    out: set[int] = set()
    for line in open(path, encoding="utf-8"):
        body = line.split("#")[0].strip()
        if not body:
            continue
        a, _, b = body.partition("..")
        out.update(range(int(a, 16), int(b or a, 16) + 1))
    return out


def main(paths: list[str]) -> None:
    ep = emoji_presentation()
    for path in paths:
        font = TTFont(path)
        removed: set[int] = set()
        for table in font["cmap"].tables:
            if not table.isUnicode():
                continue
            for cp in [cp for cp in table.cmap if cp in ep]:
                del table.cmap[cp]
                removed.add(cp)
        name = os.path.basename(path)
        if not removed:
            print(f"{name}: nothing to strip")
            continue
        font.save(path)
        print(f"{name}: stripped {len(removed)} → {''.join(chr(c) for c in sorted(removed))}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
