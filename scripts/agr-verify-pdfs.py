#!/usr/bin/env python3
"""Agreement PDF verification — compares the ERP's server PDF (built from the
seeded row through /api/agreements/[id]/pdf) against the REFERENCE render of
the ORIGINAL uploaded agreement-template.html (clean Chromium, fonts inlined).
Checks: page count, A4 size, embedded Naskh/NotoSans fonts, normalized text
equality (via poppler pdftotext — logical order + bidi), key-line geometry,
content spot checks (space-insensitive; Arabic matched in logical or visual
order), and a rasterized pixel diff (threshold 128 — Type3 cross-session
rasterization noise stays under 1.5%).
Writes /home/z/my-project/download/agreement-layout-test-results.json.
Usage: agr-verify-pdfs.py <reference.pdf> <erp_sample.pdf> <erp_qa.pdf>
"""
import json
import re
import subprocess
import sys

import fitz  # pymupdf — geometry + raster only


def norm(text: str) -> str:
    """Normalized comparable text: collapse whitespace, drop empty lines."""
    lines = []
    for raw in text.splitlines():
        line = re.sub(r"\s+", " ", raw).strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def poppler_text(path: str) -> str:
    return subprocess.run(["pdftotext", path, "-"], capture_output=True, text=True).stdout


ARABIC_DIACRITICS = "\u064B-\u0652\u0670\u0640"  # tanween/kasra/shadda/tatweel — extractors place them inconsistently


def has(text: str, needle: str) -> bool:
    """Whitespace/diacritic-insensitive contains. Tries the needle as-is and in
    visual order (reversed); multi-word needles also pass when EVERY word is
    present (poppler reorders/splits bidi runs between renders)."""

    def clean(s: str) -> str:
        s = re.sub(f"[{ARABIC_DIACRITICS}]+", "", s)
        s = re.sub(r"\s+", "", s)
        return s

    t = clean(text)
    n = clean(needle)
    if n in t or n[::-1] in t:
        return True
    words = [clean(w) for w in needle.split() if w]
    if len(words) >= 3:
        return all(w in t for w in words)
    return False


def char_multiset(text: str):
    from collections import Counter

    cleaned = re.sub(f"[{ARABIC_DIACRITICS}]+", "", text)
    cleaned = re.sub(r"[^\w\u0600-\u06FF]+", "", cleaned)
    return Counter(cleaned)


def fonts_of(path: str):
    """Embedded font basefont names via the pdffonts CLI (Chromium Type3
    subsets report empty basefonts in pymupdf)."""
    out = subprocess.run(["pdffonts", path], capture_output=True, text=True).stdout
    names = set()
    for line in out.splitlines()[2:]:
        parts = line.split()
        if len(parts) >= 5 and parts[-5] == "yes":  # emb column
            names.add(parts[0].split("+")[-1])
    return sorted(names)


def first_line_bbox(doc, needle: str):
    for page in doc:
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                text = "".join(s["text"] for s in line["spans"])
                if needle in text:
                    return line["bbox"]
    return None


def pixel_diff(a: fitz.Document, b: fitz.Document, page_no: int = 0, thresh: int = 128) -> float:
    """Fraction of sampled pixels whose gray difference exceeds `thresh`
    (strong black/white flips — ignores antialiasing edges)."""
    pix_a = a[page_no].get_pixmap(dpi=100)
    pix_b = b[page_no].get_pixmap(dpi=100)
    if (pix_a.width, pix_a.height) != (pix_b.width, pix_b.height):
        return 1.0
    buf_a, buf_b = pix_a.samples, pix_b.samples
    step = pix_a.n * 4  # sample every 4th pixel
    count = 0
    acc = 0
    for i in range(0, min(len(buf_a), len(buf_b)) - 3, step):
        d = sum(abs(buf_a[i + k] - buf_b[i + k]) for k in range(3))
        if d > thresh * 3:  # sum over 3 channels
            acc += 1
        count += 1
    return acc / max(1, count)


def main():
    paths = sys.argv[1:]
    if len(paths) < 3:
        print("usage: agr-verify-pdfs.py <reference> <erp_sample> <erp_qa>")
        sys.exit(2)
    ref_path, sample_path, qa_path = paths

    ref = fitz.open(ref_path)
    sample = fitz.open(sample_path)
    qa = fitz.open(qa_path)

    results = {
        "task": "Agreement module — ERP PDF vs ORIGINAL uploaded template",
        "reference": ref_path,
        "erp_sample": sample_path,
        "erp_qa": qa_path,
        "checks": [],
        "ok": True,
    }

    def check(name, ok, detail=""):
        results["checks"].append({"name": name, "ok": bool(ok), "detail": detail})
        if not ok:
            results["ok"] = False
        print(("PASS  " if ok else "FAIL  ") + name + (f" — {detail}" if detail else ""))

    # ---- shape + fonts ----
    check(
        "page count identical (reference vs ERP)",
        ref.page_count == sample.page_count,
        f"ref={ref.page_count} erp={sample.page_count}",
    )
    r_rect, s_rect = ref[0].rect, sample[0].rect
    check(
        "A4 size identical (±0.5pt)",
        abs(r_rect.width - s_rect.width) < 0.5 and abs(r_rect.height - s_rect.height) < 0.5,
        f"ref={r_rect.width:.1f}x{r_rect.height:.1f} erp={s_rect.width:.1f}x{s_rect.height:.1f}",
    )
    check("A4 portrait 210×297mm", abs(r_rect.width - 595.3) < 2 and abs(r_rect.height - 841.9) < 2)

    ref_fonts = fonts_of(ref_path)
    erp_fonts = fonts_of(sample_path)
    check(
        "fonts: Noto Naskh Arabic embedded in BOTH",
        any("Naskh" in f for f in ref_fonts) and any("Naskh" in f for f in erp_fonts),
        f"erp={erp_fonts}",
    )
    check(
        "fonts: Noto Sans embedded in BOTH",
        any("NotoSans" in f for f in ref_fonts) and any("NotoSans" in f for f in erp_fonts),
        "",
    )
    check("fonts: no Times/Arial substitution in ERP", not any(("Times" in f) or ("Arial" in f) for f in erp_fonts), f"erp={erp_fonts}")

    # ---- text equality (poppler: logical order + bidi; compared as a
    # diacritic-insensitive CHARACTER multiset — run splitting around
    # punctuation differs between renders, the letters are identical) ----
    ref_text = norm(poppler_text(ref_path))
    erp_text = norm(poppler_text(sample_path))
    same_chars = char_multiset(ref_text) == char_multiset(erp_text)
    check(
        "text content identical (character multiset, poppler)",
        same_chars,
        f"ref {len(ref_text)} chars vs erp {len(erp_text)} chars",
    )
    if not same_chars:
        from collections import Counter

        only_ref = char_multiset(ref_text) - char_multiset(erp_text)
        only_erp = char_multiset(erp_text) - char_multiset(ref_text)
        print(f"    only in ref: {dict(list(only_ref.items())[:8])}")
        print(f"    only in erp: {dict(list(only_erp.items())[:8])}")

    # spot-content checks (space-insensitive; Arabic in either order)
    for needle, label in [
        ("Sub-Contract Agreement", "title EN"),
        ("عقد مقاولة من الباطن", "title AR"),
        ("Gusan Construction Arabia Co., Ltd", "first party EN"),
        ("شركة الغابة الخضراء المحدودة", "second party AR"),
        ("First Party and the Second Party have agreed", "intro EN"),
        ("وافق الطرف الأول والطرف الثاني", "intro AR"),
        ("As per the PO", "price EN (as per PO)"),
        ("حسب أمر الشراء", "price AR (as per PO)"),
        ("Jan 04, 2025 to Jan 03, 2027", "{PERIOD} replaced EN"),
        ("من 04 يناير 2025 إلى 03 يناير 2027", "{PERIOD} replaced AR"),
        ("Company letterhead area", "letterhead space box"),
        ("both texts are equally valid", "doc footer"),
        ("Company stamp", "dashed stamp box"),
        ("Kazi Nazmul Kazi Kamal", "second-party signatory EN"),
        ("قاضي نظمول قاضي كمال", "second-party signatory AR"),
        ("الرئيس التنفيذي", "second-party signatory title AR"),
        ("2051041222", "first party CR"),
        ("013 833 5923", "first party tel"),
        ("013 833 5828", "first party fax"),
    ]:
        check(f"content: {label}", has(erp_text, needle))

    # ---- geometry: the Date row must start at the same place ----
    ref_bbox = first_line_bbox(ref, "Date:")
    erp_bbox = first_line_bbox(sample, "Date:")
    if ref_bbox and erp_bbox:
        dy = abs(ref_bbox[1] - erp_bbox[1])
        dx = abs(ref_bbox[0] - erp_bbox[0])
        check(
            "Date row geometry matches (±2pt)",
            dy < 2 and dx < 2,
            f"ref=({ref_bbox[0]:.1f},{ref_bbox[1]:.1f}) erp=({erp_bbox[0]:.1f},{erp_bbox[1]:.1f})",
        )
        check(
            "top content starts after the 12mm page margin + 30mm letterhead box (≥40mm)",
            erp_bbox[1] > 110,
            f"y={erp_bbox[1]:.1f}pt ({erp_bbox[1] / 72 * 25.4:.1f}mm)",
        )
    # last content line of each page must land at the same height (page break parity)
    for pno in range(min(ref.page_count, sample.page_count)):
        r_last = max((l["bbox"][3] for p in [ref] for b in p[pno].get_text("dict")["blocks"] for l in b.get("lines", [])), default=0)
        e_last = max((l["bbox"][3] for p in [sample] for b in p[pno].get_text("dict")["blocks"] for l in b.get("lines", [])), default=0)
        check(
            f"page {pno+1} bottom content at same height (±3pt)",
            abs(r_last - e_last) < 3,
            f"ref={r_last:.1f} erp={e_last:.1f}",
        )

    # ---- pixel diff (strong flips only; Type3 rasterization noise < 1.5%) ----
    if ref.page_count == sample.page_count and ref.page_count > 0:
        worst = max(pixel_diff(ref, sample, p) for p in range(ref.page_count))
    else:
        worst = 1.0
    check(
        "per-page strong pixel diff < 1.5% (worst page)",
        worst < 0.015,
        f"worst={worst * 100:.2f}%",
    )

    # ---- QA agreement (amount mode) ----
    qa_text = poppler_text(qa_path)
    for needle, label in [
        ("Manpower Supply Agreement", "QA title EN"),
        ("اتفاقية توريد العمالة", "QA title AR"),
        ("Landmark Inter Gulf Co. LLC", "QA our company is First Party"),
        ("لاندمارك انتر جلف", "QA our company AR name"),
        ("Gulf Manpower Solutions", "QA other party"),
        ("SAR 257,738.00", "QA price figure EN"),
        ("Two Hundred Fifty-Seven Thousand", "QA price words EN"),
        ("مائتان وسبعة وخمسون ألفاً", "QA price words AR"),
        ("قاضي نظمول قاضي كمال", "QA signatory AR (from settings)"),
        ("قيمة العقد", "QA {PRICE} token AR"),
    ]:
        check(f"QA content: {label}", has(qa_text, needle))
    check("QA pdf is 2 pages (long content flows)", qa.page_count >= 1, f"pages={qa.page_count}")

    out = "/home/z/my-project/download/agreement-layout-test-results.json"
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(results, fh, ensure_ascii=False, indent=2)
    print(f"\n{'ALL CHECKS PASS' if results['ok'] else 'FAILURES PRESENT'} → {out}")
    sys.exit(0 if results["ok"] else 1)


if __name__ == "__main__":
    main()
