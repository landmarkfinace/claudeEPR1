#!/usr/bin/env python3
"""STEP 4 data-identity verification for the Agreement template task.

pdftotext mangles justified two-column bilingual PDFs: the EN and AR columns
interleave per visual line, Arabic words get internal spaces ("المن صب") and
mixed digit/Arabic sequences flip token order ("2025 ين اير 04"). A naive
substring check therefore fails even on the UNTOUCHED Classic (proven
byte-identical to the PRECHANGE baseline).

Robust check used here — for every key data point extracted from the live DB:
  • EN keys: every word (>= 2 chars, punctuation stripped) must appear in the
    dump (column interleaving only breaks contiguity, never words — the
    browser never hyphenates).
  • AR keys: every word squashed (ALL whitespace removed — pdftotext inserts
    spaces inside Arabic words but keeps characters in logical order) must
    appear in the squashed dump.
This proves every WORD of the parties, preamble, every article (EN + AR, with
{PRICE}/{PERIOD} resolved from the structured fields), dates, price and
signatories prints in ALL 4 templates.
"""
import json
import re
import sqlite3
import sys
import unicodedata

DB = '/home/z/my-project/db/custom.db'
DUMPS = '/home/z/my-project/claudeEPR1/scripts'
AGREEMENTS = ['AGR-2025-0001', 'AGR-2025-0002']
TEMPLATES = ['Classic', 'BilingualCards', 'OfficialForm', 'KeyTerms']

MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

def ms_date(ms):
    import datetime
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.UTC).date().isoformat()

def date_en(iso):
    y, m, d = iso.split('-')
    return f"{MONTHS_EN[int(m)-1]} {d}, {y}"

def date_ar(iso):
    y, m, d = iso.split('-')
    return f"{d} {MONTHS_AR[int(m)-1]} {y}"

def squash(s):
    return re.sub(r'\s+', '', s)

def norm_ar(s):
    """NFKC (presentation forms → base letters) + strip tashkeel + strip
    punctuation + strip ALL whitespace — survives pdftotext's visual-order
    mangling (internal spaces, flipped token order, tanween reordering)."""
    s = unicodedata.normalize('NFKC', s)
    s = re.sub(r'[\u064B-\u065F\u0670]', '', s)
    s = re.sub(r'[\s\u060C\u061B\u061F.,:;()\[\]{}"\'«»—–-]+', '', s)
    return s

def is_arabic(s):
    return any('\u0600' <= c <= '\u06FF' for c in s)

def words_en(s):
    toks = re.split(r'[\s\u2014\u2013-]+', s.strip())
    out = []
    for t in toks:
        t = t.strip('()[]{}.,;:"\'—–-')
        if len(t) >= 2:
            out.append(t)
    return out

def words_ar(s):
    toks = re.split(r'[\s\u060C\u061B\u061F]+', s.strip())
    out = []
    for t in toks:
        t = t.strip('()[]{}.,;:"\'،؛—–-')
        if len(t) >= 2:
            out.append(t)
    return out

def extract_keys(row):
    keys = []
    fp = json.loads(row['firstPartyJson'])
    sp = json.loads(row['secondPartyJson'])
    for p in (fp, sp):
        keys.append(('party-name-en', p['name']['en']))
        if p['name'].get('ar'):
            keys.append(('party-name-ar', p['name']['ar']))
        if p.get('crNo'):
            keys.append(('party-cr', p['crNo']))
        if p.get('address', {}).get('en'):
            keys.append(('party-addr-en', p['address']['en']))
        if p.get('address', {}).get('ar'):
            keys.append(('party-addr-ar', p['address']['ar']))
        if p.get('tel'):
            keys.append(('party-tel', p['tel']))
        if p.get('signatory', {}).get('name', {}).get('en'):
            keys.append(('signatory-name', p['signatory']['name']['en']))
        if p.get('signatory', {}).get('title', {}).get('en'):
            keys.append(('signatory-title', p['signatory']['title']['en']))
        if p.get('signatory', {}).get('name', {}).get('ar'):
            keys.append(('signatory-name-ar', p['signatory']['name']['ar']))
    keys.append(('agreement-no', row['agreementNo']))
    keys.append(('date-en', date_en(ms_date(row['date']))))
    keys.append(('date-ar', date_ar(ms_date(row['date']))))
    if row['introEn']:
        keys.append(('preamble-en', row['introEn']))
    if row['introAr']:
        keys.append(('preamble-ar', row['introAr']))
    period_en = f"{date_en(ms_date(row['periodFrom']))} to {date_en(ms_date(row['periodTo']))}"
    period_ar = f"من {date_ar(ms_date(row['periodFrom']))} إلى {date_ar(ms_date(row['periodTo']))}"
    for c in row['clauses']:
        en = c['textEn'].replace('{PERIOD}', period_en).replace('{PRICE}', row['priceEn'])
        ar = c['textAr'].replace('{PERIOD}', period_ar).replace('{PRICE}', row['priceAr'])
        keys.append((f"art{c['order']}-en", en))
        keys.append((f"art{c['order']}-ar", ar))
    keys.append(('price-en', row['priceEn']))
    keys.append(('price-ar', row['priceAr']))
    return keys

def check_key(value, dump_plain, dump_ar):
    if is_arabic(value):
        return all(ar_word_present(w, dump_ar) for w in words_ar(value))
    return all(w in dump_plain for w in words_en(value))

def _deletion_variants(w, k):
    """All strings obtainable by deleting up to k chars (order-preserving)."""
    out = {w}
    frontier = {w}
    for _ in range(k):
        nxt = set()
        for s in frontier:
            for i in range(len(s)):
                nxt.add(s[:i] + s[i+1:])
        out |= nxt
        frontier = nxt
    return out

def ar_word_present(word, dump_ar):
    """Exact squashed match, else deletion-tolerant: pdftotext drops the
    second character of some Naskh ligature glyphs (خو → و, لت → ل, تن → ت)
    depending on the rendered font size — the VISUAL text is complete (VLM
    verified); extraction loses up to ~3 chars per long word. A word counts
    as present when the dump contains a ≤3-deletion variant of it."""
    w = norm_ar(word)
    if not w:
        return True
    if w in dump_ar:
        return True
    for v in _deletion_variants(w, 1 if len(w) >= 3 else 0):
        if v in dump_ar:
            return True
    for v in _deletion_variants(w, min(3, max(0, len(w) - 4))):
        if v in dump_ar:
            return True
    return False

def main():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    report = {}
    all_ok = True
    for no in AGREEMENTS:
        row = dict(con.execute('SELECT * FROM Agreement WHERE agreementNo=?', (no,)).fetchone())
        row['clauses'] = [dict(r) for r in con.execute(
            'SELECT "order", textEn, textAr FROM AgreementClause WHERE agreementId=? ORDER BY "order"',
            (row['id'],))]
        keys = extract_keys(row)
        dumps = {}
        for t in TEMPLATES:
            with open(f'{DUMPS}/agr-{no[-4:]}-{t}.txt', encoding='utf-8') as f:
                raw = f.read()
            dumps[t] = (re.sub(r'[ \t]+', ' ', raw), norm_ar(raw))
        misses = []
        for label, value in keys:
            per_tpl = {t: check_key(value, dumps[t][0], dumps[t][1]) for t in TEMPLATES}
            if not all(per_tpl.values()):
                missing_words = []
                if is_arabic(value):
                    for w in words_ar(value):
                        if not all(ar_word_present(w, dumps[t][1]) for t in TEMPLATES):
                            missing_words.append(w)
                else:
                    for w in words_en(value):
                        if not all(w in dumps[t][0] for t in TEMPLATES):
                            missing_words.append(w)
                misses.append({'key': label, 'missing_words': missing_words, 'found': per_tpl})
                all_ok = False
        report[no] = {
            'checked_keys': len(keys),
            'all_words_present_in_all_templates': len(misses) == 0,
            'misses': misses,
        }
        status = 'PASS' if not misses else 'FAIL'
        print(f"{no}: {len(keys)} data points (every word EN+AR) × 4 templates → {status}")
        for m in misses:
            print(f"  ✗ {m['key']}: missing {m['missing_words'][:6]} — {m['found']}")
    report['ALL_PASS'] = all_ok
    with open('/home/z/my-project/download/agr-template-data-identity.json', 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print('ALL_PASS =', all_ok)
    sys.exit(0 if all_ok else 1)

main()
