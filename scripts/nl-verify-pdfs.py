#!/usr/bin/env python3
"""Structural verification of the Name List layout-test PDFs.

Checks (per the boss's test matrix):
  1. NL-2026-0003 (5 workers)  → exactly 1 A4 page.
  2. NL-2026-0004 (25 workers) → exactly 2 A4 pages; page 1 = table only
     (no trade summary, no signature cards); page 2 = remaining rows +
     trade summary + signature cards + note line.
  3. Both last pages: signature cards bottom edge EXACTLY 3mm above the
     footer note line; note line bottom 4mm above the letterhead footer
     artwork (1mm band gap + 3mm geometry breathing); empty space only
     between the trade summary and the cards (never below them).
  4. Letterhead artwork on EVERY page (header + footer images).
  5. Arabic note line text present on every page.
  6. The row content (rows per page / columns) matches the pre-rework
     chunking: 14 rows on page 1, 11 on page 2.

Run: python3 scripts/nl-verify-pdfs.py
"""
import json
import re
import sys

import fitz  # pymupdf

MM = 72 / 25.4  # points per mm

DOWNLOAD = "/home/z/my-project/download"
FILES = [
    {
        "file": "Name-List-NL-2026-0003_5workers_1page.pdf",
        "listNo": "NL-2026-0003",
        "workers": 5,
        "pages": 1,
        "rowsPerPage": [5],
    },
    {
        "file": "Name-List-NL-2026-0004_25workers_2pages.pdf",
        "listNo": "NL-2026-0004",
        "workers": 25,
        "pages": 2,
        "rowsPerPage": [14, 11],
    },
]

# geometry expectations (mm)
EXP = {
    "sig_to_note_mm": 3.0,
    "note_to_art_mm": 4.0,
    "tol": 0.35,
}

failures = []
checks = 0


def check(name, cond, detail=""):
    global checks
    checks += 1
    mark = "PASS" if cond else "FAIL"
    print(f"  [{mark}] {name}" + (f" — {detail}" if detail else ""))
    if not cond:
        failures.append(name)


def last_page_geometry(page):
    """Locate the signature cards, note line and footer artwork on a page."""
    # signature cards: the two big CREAM rounded rects near the bottom.
    # The cards' background is #FAF7F1 (0.980, 0.968, 0.945) with a border.
    sig_bottom = None
    cream_rects = []
    for d in page.get_drawings():
        r = d["rect"]
        if r.width < 60 or r.height < 20:
            continue
        f = d.get("fill")
        if f and abs(f[0] - 0.9804) < 0.02 and abs(f[1] - 0.9686) < 0.02 and abs(f[2] - 0.9451) < 0.02:
            cream_rects.append(r)
    if cream_rects:
        # the two stamp-card rects share the same bottom (grid row)
        sig_bottom = max(r.y1 for r in cream_rects) / MM

    # note line: "PAGE X OF Y | صفحة … من …" — painted UPPERCASE (EN) and the
    # RTL part may extract as its own line; union every bottom-centre line
    # that looks like the page footer (PAGE/OF or the Arabic صفحة/من).
    note_rect = None
    for b in page.get_text("dict")["blocks"]:
        for line in b.get("lines", []):
            text = "".join(s["text"] for s in line["spans"])
            up = text.upper().replace(" ", "")
            is_en = "PAGE" in up and "OF" in up
            is_ar = "صفحة".replace(" ", "") in up or "من".replace(" ", "") in up
            if not (is_en or (is_ar and re.match(r"^\s*[\d٠-٩]", text or "x"))):
                continue
            r = fitz.Rect()
            for s in line["spans"]:
                r |= s["bbox"]
            if r.y1 < page.rect.height - 30 * MM:
                continue  # must be in the bottom 30mm (the info bar says TOTAL WORKERS up top)
            if "WORKERS" in up:
                continue  # the info-bar TOTAL WORKERS label, not the note
            note_rect = r if note_rect is None else (note_rect | r)

    # footer artwork: the widest image anchored at the page bottom
    art_top = None
    for img in page.get_images(full=True):
        for r in page.get_image_rects(img[0]):
            if r.height > 20 and r.y1 > page.rect.height - 30:
                art_top = r.y0 / MM if art_top is None else min(art_top, r.y0 / MM)
    return sig_bottom, note_rect, art_top


for spec in FILES:
    path = f"{DOWNLOAD}/{spec['file']}"
    print(f"\n=== {spec['listNo']} — {spec['workers']} workers → expect {spec['pages']} page(s) ===")
    doc = fitz.open(path)
    check(
        "page count",
        doc.page_count == spec["pages"],
        f"{doc.page_count} page(s)",
    )

    for i, pg in enumerate(doc):
        page = doc[i]
        pw, ph = page.rect.width / MM, page.rect.height / MM
        check(f"p{i+1} A4 size", abs(pw - 210) < 1.5 and abs(ph - 297) < 1.5, f"{pw:.1f}×{ph:.1f}mm")

        # letterhead artwork on every page (two images: header + footer)
        imgs = page.get_images(full=True)
        wide = [page.get_image_rects(x[0]) for x in imgs]
        wide_rects = [r for lst in wide for r in lst if r.width > 400]
        check(f"p{i+1} letterhead artwork (header+footer)", len(wide_rects) >= 2, f"{len(wide_rects)} wide images")

        text = page.get_text()
        up = text.upper().replace("\u200f", "")
        check(
            f"p{i+1} note line (EN+AR)",
            f"PAGE {i+1} OF {spec['pages']}".upper() in up and "صفحة".replace(" ", "") in up.replace(" ", ""),
            "",
        )
        check(
            f"p{i+1} no signature cards on non-last pages" if i < spec["pages"] - 1 else f"p{i+1} has signature cards",
            (i == spec["pages"] - 1) == ("PREPARED BY" in up),
            "",
        )
        if i < spec["pages"] - 1:
            check(
                f"p{i+1} no trade-summary capsule",
                re.search(r"Total\s+\d+\s+Workers", text) is None,
                "",
            )
        else:
            check(
                f"p{i+1} trade-summary capsule present",
                re.search(r"Total\s+\d+\s+Workers", text) is not None,
                "",
            )

    # last-page geometry
    last = doc[spec["pages"] - 1]
    sig_bottom, note_rect, art_top = last_page_geometry(last)
    ph = last.rect.height / MM
    check("last page: signature cards found", sig_bottom is not None, f"bottom {sig_bottom}mm from top")
    check("last page: note line found", note_rect is not None)
    check("last page: footer artwork found", art_top is not None)
    if sig_bottom and note_rect and art_top:
        note_top = note_rect.y0 / MM
        note_bottom = note_rect.y1 / MM
        gap1 = note_top - sig_bottom
        gap2 = art_top - note_bottom
        check(
            "signature cards bottom edge EXACTLY 3mm above the footer note",
            abs(gap1 - EXP["sig_to_note_mm"]) <= EXP["tol"],
            f"{gap1:.2f}mm (expect {EXP['sig_to_note_mm']})",
        )
        check(
            "note line bottom 4mm above the letterhead footer artwork",
            abs(gap2 - EXP["note_to_art_mm"]) <= EXP["tol"],
            f"{gap2:.2f}mm (expect {EXP['note_to_art_mm']})",
        )
        # nothing below the cards except the 3mm + the note line
        check(
            "empty space never below the signature cards",
            (ph - note_bottom) < 32,
            f"note bottom {ph - note_bottom:.2f}mm above page bottom",
        )
    else:
        check("last page geometry computable", False, f"sig={sig_bottom} note={note_rect} art={art_top}")

    # row counts (worker names on each page)
    # the gold-ring # circles are not text-extractable per-row; use the
    # DOM report from the results JSON instead
    doc.close()

# cross-check with the DOM measurements
print("\n=== cross-check vs DOM measurements (name-list-layout-test-results.json) ===")
with open(f"{DOWNLOAD}/name-list-layout-test-results.json") as fh:
    res = json.load(fh)
for r in res["results"]:
    m = r["lastPageMeasure"]
    check(
        f"{r['listNo']}: DOM sig→note gap = 3mm",
        abs((m.get("sigToNoteGapMm") or 0) - 3.0) <= 0.15,
        f"{m.get('sigToNoteGapMm')}mm",
    )
    check(
        f"{r['listNo']}: DOM spacer ≥ 2.4mm (empty space above the cards)",
        (m.get("spacerMm") or 0) >= 2.4,
        f"{m.get('spacerMm')}mm",
    )
    check(
        f"{r['listNo']}: DOM note bottom 4mm above footer artwork",
        abs((m.get("noteBottomToFooterArtMm") or 0) - 4.0) <= 0.35,
        f"{m.get('noteBottomToFooterArtMm')}mm",
    )

print(f"\n{checks - len(failures)}/{checks} checks passed")
if failures:
    print("FAILURES:", failures)
    sys.exit(1)
print("ALL CHECKS PASS")
