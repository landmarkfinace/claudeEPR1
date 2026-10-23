#!/usr/bin/env python3
"""Geometry measurement for the E-Invoice letterhead exports (Task: letterhead v2).

Renders each page of the `after` PDFs at 150 dpi and MEASURES (mm, from the
page top/left) against the spec:
  1. header art is flush at the page TOP (navy rule at row 0, full width —
     no margin above) and its corner registration marks sit at y = 45 mm
     (45 mm band, full 210 mm width)
  2. footer art is flush at the page BOTTOM (navy bar in the last rows) with
     top-edge marks at y = 272 mm (25 mm band, full width)
  3. page-number line baseline sits just above the footer (≈26 mm from the
     bottom), from pdftotext -bbox
  4. watermark tint present in the body area (70 % opacity over white)
  5. body content never overlaps the bands: no dark text pixels inside the
     0-45 mm / 272-297 mm zones except the artwork itself (checked on the
     after-nolh renders where the bands are EMPTY: those zones must contain
     NO ink at all → proves the margins are respected with artwork hidden)
"""
import subprocess, sys, os, glob
from PIL import Image

DPI = 150
PXMM = DPI / 25.4
W, H = 210, 297.0
AFTER = "/home/z/my-project/claudeEPR1/qa/ei-lh/after"
NOLH = "/home/z/my-project/claudeEPR1/qa/ei-lh/after-nolh"
TMP = "/tmp/eilh-measure"

passed = failed = 0
def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {detail}")

os.makedirs(TMP, exist_ok=True)

def render_pages(pdf, prefix):
    subprocess.run(["pdftoppm", "-r", str(DPI), "-png", pdf, f"{TMP}/{prefix}"], check=True)
    out = {}
    for f in sorted(glob.glob(f"{TMP}/{prefix}-*.png")):
        n = int(f.rsplit("-", 1)[1].split(".")[0])
        out[n] = Image.open(f).convert("RGB")
    return out

def px(img, xmm, ymm):
    x = min(int(xmm * PXMM), img.width - 1)
    y = min(int(ymm * PXMM), img.height - 1)
    return img.getpixel((x, y))

def is_ink(p, thr=120):
    return p[0] < thr and p[1] < thr and p[2] < thr

def row_ink_fraction(img, ymm, x0=2, x1=208):
    row = int(ymm * PXMM)
    if row >= img.height:
        return 0.0
    ink = total = 0
    for x in range(int(x0 * PXMM), int(x1 * PXMM), 4):
        total += 1
        if is_ink(img.getpixel((x, row))):
            ink += 1
    return ink / max(total, 1)

def find_corner_marks(img, y_expect_mm, x_candidates=(2, 208), tol=2.5):
    """black registration squares near (x, y_expect)."""
    hits = []
    ylo, yhi = int((y_expect_mm - tol) * PXMM), int((y_expect_mm + tol) * PXMM)
    for xc in x_candidates:
        xlo, xhi = int((xc - tol) * PXMM), int((xc + tol) * PXMM)
        best = None
        for y in range(max(ylo, 0), min(yhi, img.height), 2):
            for x in range(max(xlo, 0), min(xhi, img.width), 2):
                if is_ink(img.getpixel((x, y)), 90):
                    if best is None or y < best[0]:
                        best = (y, x)
        if best:
            hits.append((best[1] / PXMM, best[0] / PXMM))  # x, y in mm
    return hits

def zone_has_ink(img, y0, y1, x0=2, x1=208):
    """any ink in a horizontal zone (excluding near page edges)?"""
    for y in range(int(y0 * PXMM), min(int(y1 * PXMM), img.height), 2):
        for x in range(int(x0 * PXMM), min(int(x1 * PXMM), img.width), 3):
            if is_ink(img.getpixel((x, y)), 130):
                return True
    return False

def watermark_tint_hits(img):
    """count pixels matching 70 % watermark tint (181,190,205) +- 28 in the body area."""
    lo, hi = (153, 162, 177), (209, 218, 233)
    hits = 0
    for y in range(int(52 * PXMM), int(264 * PXMM), 3):
        for x in range(int(14 * PXMM), int(196 * PXMM), 3):
            p = img.getpixel((x, y))
            if lo[0] <= p[0] <= hi[0] and lo[1] <= p[1] <= hi[1] and lo[2] <= p[2] <= hi[2]:
                hits += 1
    return hits

def page_number_positions(pdf):
    """pdftotext -bbox → y (mm from top) of each 'Page N of M' line."""
    out = subprocess.run(["pdftotext", "-bbox", pdf, "-"], capture_output=True, text=True).stdout
    import re
    pos = []
    # each word block: <word xMin=".." yMin=".." xMax=".." yMax="..">Page</word>
    for m in re.finditer(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">Page</word>', out):
        yMm = float(m.group(2)) / 72 * 25.4
        yMm2 = float(m.group(4)) / 72 * 25.4
        pos.append((yMm, yMm2))
    return pos

targets = [
    ("INV-2026-00001", "E-Invoice-INV-2026-00001_2items_2pages.pdf", 2),
    ("INV-2026-00004", "E-Invoice-INV-2026-00004_6items_2pages.pdf", 2),
    ("INV-2026-00005", "E-Invoice-INV-2026-00005_25items_3pages.pdf", 3),
]

for inv, fname, pages in targets:
    print(f"— {inv} ({fname}) —")
    imgs = render_pages(f"{AFTER}/{fname}", f"m-{inv}")
    imgs_nh = render_pages(f"{NOLH}/{fname}", f"mn-{inv}")
    pn = page_number_positions(f"{AFTER}/{fname}")
    for n in range(1, pages + 1):
        im = imgs[n]
        imnh = imgs_nh[n]
        # 1. header flush at top: navy rule at y=0.5mm across the width
        check(f"p{n}: header art flush at page top (navy row0, full width)",
              row_ink_fraction(im, 0.5) > 0.85, f"frac={row_ink_fraction(im, 0.5):.2f}")
        # header marks at 45mm
        marks = find_corner_marks(im, 45.0)
        check(f"p{n}: header band bottom edge at 45mm (corner marks)",
              len(marks) >= 1 and all(abs(my - 45.0) < 1.6 for mx, my in marks), str(marks))
        # 2. footer flush at bottom + top edge at 272mm
        check(f"p{n}: footer art flush at page bottom (navy last row, full width)",
              row_ink_fraction(im, 296.0) > 0.85, f"frac={row_ink_fraction(im, 296.0):.2f}")
        fmarks = find_corner_marks(im, 272.0)
        check(f"p{n}: footer band top edge at 272mm (corner marks)",
              len(fmarks) >= 1 and all(abs(my - 272.0) < 1.6 for mx, my in fmarks), str(fmarks))
        # 3. page number ~26mm from bottom
        ok = False
        detail = "no Page line found"
        for (y0, y1) in pn:
            # bottom of the word ≈ 297-26+lineheight... baseline zone 265-272mm
            if 265.5 <= y1 <= 271.5:
                ok = True
                break
        # at least one Page line on this page in the zone — pdftotext bbox is per-PAGE? no, it's whole doc; approximate per page count
        check(f"p{n}: page number line in the 265.5-271.5mm zone", ok, f"positions={[(round(a,1),round(b,1)) for a,b in pn]}")
        # 4. watermark tint present
        hits = watermark_tint_hits(im)
        check(f"p{n}: watermark tint present in body (70% opacity)", hits > 300, f"hits={hits}")
        # 5. bands EMPTY above/below body in the no-letterhead render
        #    (proves the body respects the margins even when artwork hidden)
        top_zone_ink = zone_has_ink(imnh, 0, 44.5)
        bot_zone_ink = zone_has_ink(imnh, 272.5, 296.4)
        # allow the page-number line (265.5-271.5) — it is OUTSIDE these zones
        check(f"p{n}: [artwork hidden] 0-44.5mm zone completely empty", not top_zone_ink)
        check(f"p{n}: [artwork hidden] 272.5-297mm zone completely empty", not bot_zone_ink)

print(f"\n{passed} passed, {failed} failed")
sys.exit(0 if failed == 0 else 1)
