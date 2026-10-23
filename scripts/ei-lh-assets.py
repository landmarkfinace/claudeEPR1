#!/usr/bin/env python3
"""Test PNG assets for the E-Invoice letterhead feature (Task: letterhead v2).

Generates three PNGs at exact print proportions (300 dpi):
  header    210 x 45 mm  (2480 x 531 px)  — qa/ei-lh/assets/lh-header.png
  footer    210 x 25 mm  (2480 x 295 px)  — qa/ei-lh/assets/lh-footer.png
  watermark ~120 mm wide, 4:3             — qa/ei-lh/assets/lh-watermark.png

All three carry 6 px black corner/edge registration marks so the exported
PDF geometry can be MEASURED (band 0-45 mm / 25 mm, full width, watermark
center + width). Distinct "EI-LH" labels distinguish them from the shared
letterhead artwork in QA.
"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = "/home/z/my-project/claudeEPR1/qa/ei-lh/assets"
os.makedirs(OUT, exist_ok=True)

DPI = 300
NAVY = (19, 42, 74)
GOLD = (192, 147, 76)
DARKGOLD = (142, 100, 32)
MUTED = (107, 116, 136)
WMGRAY = (150, 162, 184)  # light steel — visible behind text, never obscuring

def mm(x):
    return round(x / 25.4 * DPI)

def font(size_px, bold=False):
    path = "/usr/share/fonts/truetype/english"
    try:
        import glob
        cands = glob.glob(f"{path}/*Carlito*Bold*.ttf") if bold else glob.glob(f"{path}/*Carlito*Regular*.ttf")
        if not cands:
            cands = glob.glob("/usr/share/fonts/truetype/dejavu/DejaVuSans*.ttf")
        return ImageFont.truetype(cands[0], size_px)
    except Exception:
        return ImageFont.load_default()

def corner_marks(draw, w, h, size=6):
    """Black registration squares at the four exact corners."""
    for x, y in [(0, 0), (w - size, 0), (0, h - size), (w - size, h - size)]:
        draw.rectangle([x, y, x + size - 1, y + size - 1], fill=(0, 0, 0))

# ── header 210 x 45 mm ────────────────────────────────────────────────────────
W, H = mm(210), mm(45)
img = Image.new("RGB", (W, H), "white")
d = ImageDraw.Draw(img)
d.rectangle([0, 0, W - 1, mm(2)], fill=NAVY)                       # top rule
d.rectangle([0, mm(2), W - 1, mm(2.8)], fill=GOLD)                  # gold hairline
d.ellipse([mm(14) - mm(4), mm(14) - mm(4), mm(14) + mm(4), mm(14) + mm(4)], fill=GOLD)
f_big = font(mm(7.2), bold=True)
f_small = font(mm(3.4))
d.text((mm(22), mm(9)), "LANDMARK INTER GULF CO. LLC", font=f_big, fill=NAVY)
d.text((mm(22), mm(20)), "Manpower Supply · Operation & Maintenance · Saudi Arabia", font=f_small, fill=MUTED)
d.text((mm(22), mm(25.5)), "EI-LH HEADER ARTWORK — 45 mm band, full 210 mm width", font=f_small, fill=DARKGOLD)
# right block: test tag inside a gold ring
d.ellipse([W - mm(52), mm(8), W - mm(14), mm(40)], outline=GOLD, width=mm(1.2))
d.text((W - mm(46), mm(16)), "EI-LH", font=font(mm(6.5), bold=True), fill=NAVY)
d.text((W - mm(46), mm(26)), "TEST 45", font=f_small, fill=MUTED)
d.rectangle([0, H - mm(3.2), W - 1, H - mm(2.4)], fill=GOLD)        # bottom gold rule
corner_marks(d, W, H)
img.save(f"{OUT}/lh-header.png", optimize=True)
print(f"header  {W}x{H}px  (210x45mm)  -> {OUT}/lh-header.png")

# ── footer 210 x 25 mm ────────────────────────────────────────────────────────
W, H = mm(210), mm(25)
img = Image.new("RGB", (W, H), "white")
d = ImageDraw.Draw(img)
d.rectangle([0, mm(0.8), W - 1, mm(1.6)], fill=GOLD)                # top gold rule
d.rectangle([0, H - mm(3), W - 1, H], fill=NAVY)                    # bottom navy bar
f_small = font(mm(3.3))
f_tiny = font(mm(2.8))
d.text((mm(12), mm(5)), "Landmark Inter Gulf Co. LLC · Al Jubail 31951, Kingdom of Saudi Arabia", font=f_small, fill=NAVY)
d.text((mm(12), mm(10.5)), "VAT 310283746500003 · CR 1010357489 · +966 13 000 0000 · info@landmarkintergulf.com", font=f_tiny, fill=MUTED)
d.text((mm(12), mm(15)), "EI-LH FOOTER ARTWORK — 25 mm band, full 210 mm width", font=f_tiny, fill=DARKGOLD)
# right: bank strip
d.text((W - mm(72), mm(6)), "SABB · SA03 8000 0000 6080 1016 7676", font=f_tiny, fill=NAVY)
d.text((W - mm(72), mm(12)), "EI-LH TEST 25", font=f_tiny, fill=MUTED)
corner_marks(d, W, H)
img.save(f"{OUT}/lh-footer.png", optimize=True)
print(f"footer  {W}x{H}px  (210x25mm)  -> {OUT}/lh-footer.png")

# ── watermark ~120 mm wide, 4:3, transparent background ─────────────────────
W, H = mm(120), mm(90)   # 1417 x 1063 px
img = Image.new("RGBA", (W, H), (255, 255, 255, 0))
d = ImageDraw.Draw(img)
# big diamond outline + wordmark, light steel, semi-faded look
cx, cy = W // 2, H // 2
r = mm(34)
d.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], outline=(*WMGRAY, 255), width=mm(3))
d.polygon([(cx, cy - mm(26)), (cx + mm(26), cy), (cx, cy + mm(26)), (cx - mm(26), cy)], outline=(*WMGRAY, 200), width=mm(1.6))
f_wm = font(mm(11), bold=True)
d.text((cx, mm(52)), "LANDMARK", font=f_wm, fill=(*WMGRAY, 255), anchor="mm")
d.text((cx, mm(67)), "EI-LH WATERMARK · 120 mm", font=font(mm(4.6)), fill=(*WMGRAY, 235), anchor="mm")
d.text((cx, mm(76)), "transparent PNG test asset", font=font(mm(4.2)), fill=(*WMGRAY, 210), anchor="mm")
img.save(f"{OUT}/lh-watermark.png", optimize=True)
print(f"wm     {W}x{H}px  (120x90mm)  -> {OUT}/lh-watermark.png")
print("done")
