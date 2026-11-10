"""Build the g1 test vectors: files plus vectors.json. The expected value of every vector is computed with reference implementation 1
(g1.py), and every reject vector is checked to break the rule the vector was written for."""
import json, os, shutil, sys
sys.path.insert(0, os.path.dirname(__file__))
import g1

OUT = sys.argv[1]
if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT + '/seal'); os.makedirs(OUT + '/reject')

BASE = """---
status: proposed
date: 2026-11-03
decision-makers:
  - maintainers
applies-to:
  - docs/decisions/**
---

# Example decision

## Context and problem statement

Why a decision was needed.

## Decision

- Do the thing.

## Consequences

- The thing is done.

## Alternatives considered

- Not doing the thing.
"""
KD = "## Known deviations\n\n- Deviation recorded for tracking issue owner/repo#1, commit 0123456.\n\n### Remediation\n\nFix it later.\n\n```sh\n## not a heading\n# a comment\n```\n"
ERR = "## Errata\n\n- 2026-11-04: fixed a typo. Previous seal sha256-g1:" + "0" * 64 + "\n"

V = []   # (id, kind, bytes, expectation, note, extra)

def seal(i, text, note, differs=None):
    b = text if isinstance(text, bytes) else text.encode('utf-8')
    V.append((i, 'seal', b, None, note, differs))

def reject(i, text, rule, note):
    b = text if isinstance(text, bytes) else text.encode('utf-8')
    V.append((i, 'reject', b, rule, note, None))

def crlf(t): return t.replace('\n', '\r\n')
def after(t, marker, ins):
    assert marker in t, marker
    return t.replace(marker, marker + ins, 1)
def swap(t, old, new):
    assert old in t, old
    return t.replace(old, new, 1)

# ---- records that have the same seal as the base --------------------------------------------------
seal('a01-base', BASE, 'The base record. Every vector that says "same seal" below has the seal of this one.')
seal('a02-crlf', crlf(BASE), 'Every line ends in CRLF, as after a Windows checkout.')
seal('a03-trailing-white-space', swap(swap(swap(BASE, 'Why a decision was needed.\n', 'Why a decision was needed.  \n'), '\n## Decision\n', ' \t\n## Decision \n'), '- Do the thing.\n', '- Do the thing.\t\n'), 'Spaces and tabs at the end of lines, and a line of only white space.')
seal('a04-no-final-newline', BASE.rstrip('\n'), 'No line feed at the end of the file.')
seal('a05-blank-lines-at-end', BASE + '\n\n  \n\n', 'Empty and white-space-only lines at the end of the file.')
seal('a06-status-accepted', swap(BASE, 'status: proposed', 'status: accepted'), 'The status is not sealed.')
seal('a07-status-superseded', swap(BASE, 'status: proposed', 'status: superseded by 0007'), 'The status is not sealed.')
seal('a08-date-changed', swap(BASE, 'date: 2026-11-03', 'date: 2031-01-31'), 'The date is not sealed.')
seal('a09-seal-with-another-value', after(BASE, 'date: 2026-11-03\n', 'seal: sha256-g1:' + 'f' * 64 + '\n'), 'A seal key is not sealed, whatever it says.')
seal('a10-key-order-of-excluded-keys', swap(BASE, 'status: proposed\ndate: 2026-11-03\n', 'date: 2026-11-03\nseal: sha256-g1:' + 'a' * 64 + '\nstatus: proposed\n'), 'The excluded keys may stand in any order and anywhere in the front matter.')
seal('a11-known-deviations-at-the-end', BASE + '\n' + KD, 'A Known deviations section appended; it contains a level 3 heading and a fence with a fake heading in it.')
seal('a12-errata-at-the-end', BASE + '\n' + ERR, 'An Errata section appended.')
seal('a13-both-sections-at-the-end', BASE + '\n' + KD + '\n' + ERR, 'Both sections appended, in the order the rules require.')
seal('a14-known-deviations-in-the-middle', swap(BASE, '## Alternatives considered', KD + '\n## Alternatives considered'), 'A Known deviations section between Consequences and Alternatives, where the Frodo core records keep it.')
seal('a15-errata-in-the-middle', swap(BASE, '## Alternatives considered', ERR + '\n## Alternatives considered'), 'An Errata section in the middle.')
seal('a16-extra-blank-lines', BASE.replace('\n\n## ', '\n\n\n\n## ').replace('\n\n# Example', '\n\n\n# Example'), 'Runs of blank lines outside code are one blank line.')
seal('a17-mixed-line-endings', swap(swap(BASE, 'Why a decision was needed.\n', 'Why a decision was needed.\r\n'), '- Do the thing.\n', '- Do the thing.\r\n'), 'Some lines CRLF, some LF.')
seal('a18-errata-last-without-final-newline', (BASE + '\n' + ERR).rstrip('\n'), 'An Errata section that is the last thing in the file, with no final line feed.')
seal('a19-delimiter-with-trailing-space', swap(BASE, '---\nstatus', '--- \nstatus'), 'White space after the opening --- is removed before the rules look at it.')
seal('a20-sealed-record', after(BASE, 'date: 2026-11-03\n', 'seal: @A01@\n'), 'A record that carries its own seal, as every accepted record does.')

# ---- records with a seal of their own -----------------------------------------------------------------
FENCE = BASE.replace('- Do the thing.\n', '- Do the thing:\n\n```sh\n# a comment\n\n\n  indented   \necho hi\n```\n')
seal('b01-fence-blank-lines-kept', FENCE, 'Blank lines inside a fence are kept as they are, and a line starting with # inside a fence is not a heading.')
seal('b02-fence-blank-lines-collapsed', FENCE.replace('\n\n\n  indented', '\n\n  indented'), 'The same record with one blank line fewer inside the fence: a different seal.', differs='b01-fence-blank-lines-kept')
seal('b03-fence-crlf', crlf(FENCE), 'The fence record with CRLF line endings: the same seal as b01.')
seal('b04-fence-longer-closing', FENCE.replace('echo hi\n```\n', 'echo hi\n`````\n'), 'A fence closed by a longer fence.')
seal('b05-fence-four-backticks-around-three', BASE.replace('- Do the thing.\n', '````md\n```\n\n\n## Decision\n```\n````\n'), 'Four backticks around three: the inner three-backtick lines do not close the outer fence, so the blank lines inside it are kept.')
seal('b06-fence-without-info-and-with', BASE.replace('- Do the thing.\n', '```\nplain\n```\n\n```js title="x"\nlet a = 1;\n```\n'), 'Fences with and without an info string.')
seal('c01-unicode', BASE.replace('Why a decision was needed.', 'Pourquoi une décision était nécessaire: 決定の理由, 🔒.'), 'Non-ASCII text, hashed as UTF-8.')
seal('c02-unicode-decomposed', BASE.replace('Why a decision was needed.', 'Pourquoi une décision était nécessaire: 決定の理由, 🔒.'), 'The same words with accents as two code points: no Unicode normalisation, so a different seal.', differs='c01-unicode')
seal('c03-list-values-and-more-keys', swap(BASE, 'applies-to:\n  - docs/decisions/**\n', 'applies-to:\n  - docs/decisions/**\n  - scripts/**\nsupersedes:\n  - 0003\nrepos:\n  - owner/one\n  - owner/two\nwindow: 5.x until 6.0\nissues:\n  - owner/repo#123\n'), 'More keys, list values and a plain value.')
seal('c04-autolink-line', BASE.replace('- Do the thing.\n', '<https://example.org/path?q=1>\n\n- Do the thing.\n'), 'A line that starts with an autolink is not raw HTML.')
seal('c05-thematic-break', BASE.replace('- Do the thing.\n', '- Do the thing.\n\n---\n\nAfter the rule.\n'), 'A --- after a blank line is a thematic break, not a setext underline.')
seal('c06-rule-after-heading', BASE.replace('## Decision\n', '## Decision\n---\n'), 'A --- directly after a heading is a thematic break.')
seal('c07-setext-lookalike-in-fence', BASE.replace('- Do the thing.\n', '```\nFoo\n---\nBar\n===\n```\n'), 'Underline-like lines inside a fence are code.')
seal('c08-html-in-fence', BASE.replace('- Do the thing.\n', '```html\n<div>\n</div>\n```\n'), 'HTML tags inside a fence are code.')
seal('c09-tilde-in-fence', BASE.replace('- Do the thing.\n', '```\n~~~\nx\n~~~\n```\n'), 'Tildes inside a backtick fence are code.')
seal('c10-keys-that-only-start-like-excluded', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\nstatus-note: kept in the seal\nseal-of: kept\ndatestamp: kept\n'), 'Keys that merely begin with an excluded name are part of the seal.')
seal('c11-spaces-after-colon', swap(BASE, 'date: 2026-11-03\n', 'date:    2026-11-03\ntitle:   spaced out\nrepos:\n'), 'More than one space after the colon, and a key with no value and no continuation.')
seal('c12-front-matter-only', '---\nstatus: proposed\n---\n', 'A record with no body at all.')
seal('c13-title-right-after-front-matter', swap(BASE, '---\n\n# Example', '---\n# Example'), 'No blank line between the front matter and the title.')
seal('c14-heading-in-block-quote', BASE.replace('- Do the thing.\n', '> ## Errata\n> not a section\n'), 'A heading inside a block quote does not start with the heading, so it is ordinary sealed text.')
seal('c15-errata-in-a-sentence', BASE.replace('- Do the thing.\n', 'See the Errata section of the other record, and the known deviations there.\n'), 'The words in a sentence are not a heading.')
seal('c16-escaped-heading', BASE.replace('- Do the thing.\n', '\\## Errata\n'), 'An escaped heading is ordinary text.')
seal('c17-heading-with-two-spaces', BASE.replace('## Consequences', '## Known  deviations'), 'Two spaces inside the name: not the excluded heading and not a lookalike, so an ordinary sealed section.')
seal('c18-indented-html', BASE.replace('- Do the thing.\n', 'A paragraph line\n    <div>\n'), 'Four spaces before < is not a raw HTML line start.')
seal('c19-less-than-in-text', BASE.replace('- Do the thing.\n', '< 5 and <= 7\n\n<3 is a heart\n'), 'A line that starts with < and then a space, or a digit, is not an HTML tag.')
seal('c20-html-inline', BASE.replace('- Do the thing.\n', 'Do <b>the</b> thing.\n'), 'Inline HTML in the middle of a line is allowed.')
seal('a22-errata-with-a-fence-inside', BASE + '\n' + ERR + '\n```text\n## Decision\n```\n', 'An Errata section with a fence in it that holds a heading: the heading does not end the section.')
seal('c22-tab-inside-line', BASE.replace('- Do the thing.\n', '- Do\tthe thing.\n'), 'A tab inside a line is kept.')

# ---- records that differ from the base ---------------------------------------------------------------
seal('d01-word-changed', BASE.replace('Not doing', 'Doing'), 'One word changed.', differs='a01-base')
seal('d02-heading-renamed', BASE.replace('## Consequences', '## Consequence'), 'A heading renamed.', differs='a01-base')
seal('d03-keys-swapped', swap(BASE, 'decision-makers:\n  - maintainers\napplies-to:\n  - docs/decisions/**\n', 'applies-to:\n  - docs/decisions/**\ndecision-makers:\n  - maintainers\n'), 'Two keys in another order.', differs='a01-base')
seal('d04-key-added', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\nrepos:\n  - owner/one\n'), 'A key added.', differs='a01-base')
seal('d05-inner-spaces', BASE.replace('Do the thing.', 'Do  the thing.'), 'Two spaces inside a line.', differs='a01-base')
seal('d06-text-moved-into-errata', BASE.replace('- Do the thing.\n', '') + '\n## Errata\n\n- Do the thing.\n', 'Text moved from a sealed section into an Errata section.', differs='a01-base')
seal('d07-list-item-added', BASE.replace('- Do the thing.\n', '- Do the thing.\n- And another.\n'), 'A list item added.', differs='a01-base')
seal('d08-list-marker', BASE.replace('- Do the thing.', '* Do the thing.'), 'Another list marker.', differs='a01-base')
seal('d09-section-removed', BASE.replace('\n## Alternatives considered\n\n- Not doing the thing.\n', ''), 'A section removed.', differs='a01-base')
seal('d10-case-changed', BASE.replace('Example decision', 'Example Decision'), 'One letter in another case.', differs='a01-base')
seal('d11-paragraph-added', BASE.replace('- The thing is done.\n', '- The thing is done.\n\nA new paragraph.\n'), 'A paragraph added.', differs='a01-base')
seal('d12-nonexcluded-key-value', swap(BASE, '  - maintainers\n', '  - owners\n'), 'A value in the front matter changed.', differs='a01-base')
seal('a21-level-three-heading-after-errata', BASE + '\n' + ERR + '\n### Extra\n\nText.\n', 'A level 3 heading after Errata stays inside the Errata section.')

# ---- rejected records ------------------------------------------------------------------------------------
def b(t): return t.encode('utf-8')
T = BASE.replace('- Do the thing.\n', '- Do the thing.@X@\n')
def put(x):
    return T.replace('@X@', x)

reject('r01a-invalid-byte', b(T.replace('@X@', '')) + b'\xff\n', 'G1-01', 'A byte that is never valid in UTF-8.')
reject('r01b-overlong', b(put('')) + b'\xc0\xaf\n', 'G1-01', 'An overlong encoding of /.')
reject('r01c-surrogate', b(put('')) + b'\xed\xa0\x80\n', 'G1-01', 'A UTF-16 surrogate encoded in UTF-8.')
reject('r01d-truncated', b(put('')) + b'\xe2\x82', 'G1-01', 'A sequence cut short at the end of the file.')
reject('r01e-above-max', b(put('')) + b'\xf4\x90\x80\x80\n', 'G1-01', 'A code point above U+10FFFF.')
reject('r02a-bom', b'\xef\xbb\xbf' + b(BASE), 'G1-02', 'A byte order mark at the start.')
reject('r02b-zero-width-no-break-space', put('﻿'), 'G1-02', 'U+FEFF inside the text.')
reject('r03a-nul', put('\x00'), 'G1-03', 'A NUL character.')
reject('r03b-escape', put('\x1b[31m'), 'G1-03', 'An escape character.')
reject('r03c-delete', put('\x7f'), 'G1-03', 'U+007F.')
reject('r03d-next-line', put('\u0085'), 'G1-03', 'U+0085, a line break for some readers.')
reject('r03e-backspace', put('\x08'), 'G1-03', 'A backspace.')
reject('r03f-c1-control', put('\u009f'), 'G1-03', 'U+009F.')
reject('r03g-form-feed', put('\x0c'), 'G1-03', 'A form feed.')
reject('r03h-vertical-tab', put('\x0b'), 'G1-03', 'A vertical tab.')
reject('r04a-right-to-left-override', put('‮'), 'G1-04', 'U+202E.')
reject('r04b-isolate', put('⁦'), 'G1-04', 'U+2066.')
reject('r04c-left-to-right-mark', put('‎'), 'G1-04', 'U+200E.')
reject('r04d-line-separator', put(' '), 'G1-04', 'U+2028.')
reject('r04e-paragraph-separator', put(' '), 'G1-04', 'U+2029.')
reject('r04f-arabic-letter-mark', put('؜'), 'G1-04', 'U+061C.')
reject('r04g-last-isolate', put('⁩'), 'G1-04', 'U+2069, the last of the range.')
reject('r05a-lone-cr', put('\rmore'), 'G1-05', 'A carriage return in the middle of a line.')
reject('r05b-double-cr-lf', put('\r\r') , 'G1-05', 'A CR followed by CR LF: the first CR is alone.')
reject('r05c-cr-at-end', b(BASE) + b'\r', 'G1-05', 'A CR as the last byte.')
reject('r06a-comment-line', BASE.replace('- Do the thing.\n', '<!-- hidden -->\n'), 'G1-06', 'An HTML comment on its own line.')
reject('r06b-comment-inline', put(' <!-- x -->'), 'G1-06', 'An HTML comment inside a line.')
reject('r06c-comment-in-fence', BASE.replace('- Do the thing.\n', '```\n<!--\n```\n'), 'G1-06', 'The characters are rejected even in a fence.')
reject('r07a-blank-first-line', '\n' + BASE, 'G1-07', 'A blank line before the front matter.')
reject('r07b-no-front-matter', BASE.split('---\n\n', 1)[1], 'G1-07', 'A record with no front matter.')
reject('r07c-four-dashes', BASE.replace('---\nstatus', '----\nstatus', 1), 'G1-07', 'Four dashes are not the delimiter.')
reject('r07d-empty-file', b'', 'G1-07', 'An empty file.')
reject('r08a-no-closing-delimiter', BASE.replace('---\n\n# Example', '\n# Example', 1), 'G1-08', 'The front matter is never closed.')
reject('r08b-dots-closing', BASE.replace('---\n\n# Example', '...\n\n# Example', 1), 'G1-08', 'The YAML document end marker does not close it.')
reject('r09a-blank-line-in-front-matter', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\n\n'), 'G1-09', 'A blank line inside the front matter.')
reject('r09b-tab-indent', swap(BASE, '  - maintainers', '\t- maintainers'), 'G1-09', 'A continuation line indented with a tab.')
reject('r09c-list-item-in-column-one', swap(BASE, 'applies-to:\n  - docs/decisions/**\n', 'applies-to:\n- docs/decisions/**\n'), 'G1-09', 'A list item in column 1.')
reject('r09d-comment-line', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\n# a comment\n'), 'G1-09', 'A comment line.')
reject('r09e-no-space-after-colon', swap(BASE, 'date: 2026-11-03', 'date:2026-11-03'), 'G1-09', 'No space after the colon.')
reject('r09f-continuation-first', swap(BASE, '---\nstatus: proposed', '---\n  stray: line\nstatus: proposed'), 'G1-09', 'An indented line before any key.')
reject('r09g-key-starts-with-digit', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\n1key: x\n'), 'G1-09', 'A key that starts with a digit.')
reject('r09h-quoted-key', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\n"status": accepted\n'), 'G1-09', 'A quoted key.')
reject('r10a-duplicate-key', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\napplies-to:\n  - x\n'), 'G1-10', 'A key twice.')
reject('r10b-duplicate-key-other-case', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\nApplies-To:\n  - x\n'), 'G1-10', 'A key twice, the second in another case.')
reject('r10c-duplicate-status', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\nstatus: accepted\n'), 'G1-10', 'status twice.')
reject('r11a-status-capital', swap(BASE, 'status: proposed', 'Status: proposed'), 'G1-11', 'status with a capital.')
reject('r11b-seal-capitals', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\nSEAL: x\n'), 'G1-11', 'seal in capitals.')
reject('r11c-date-capital', swap(BASE, 'date: 2026-11-03', 'Date: 2026-11-03'), 'G1-11', 'date with a capital.')
reject('r12a-status-empty', swap(BASE, 'status: proposed', 'status:'), 'G1-12', 'An excluded key with no value.')
reject('r12b-seal-with-continuation', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\nseal: sha256-g1:abc\n  def\n'), 'G1-12', 'An excluded key that continues on the next line.')
reject('r12c-date-with-continuation', swap(BASE, 'date: 2026-11-03', 'date:\n  2026-11-03'), 'G1-12', 'An excluded key with its value on the next line.')
reject('r13a-anchor', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\ntitle: &a x\n'), 'G1-13', 'An anchor.')
reject('r13b-alias', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\nref: *a\n'), 'G1-13', 'An alias.')
reject('r13c-tag', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\nx: !!str y\n'), 'G1-13', 'A tag.')
reject('r13d-literal-block', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\nx: |\n  text\n'), 'G1-13', 'A literal block scalar.')
reject('r13e-folded-block', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\nx: >\n  text\n'), 'G1-13', 'A folded block scalar.')
reject('r13f-alias-in-list', swap(BASE, '  - maintainers', '  - *m'), 'G1-13', 'An alias in a list.')
reject('r13g-anchor-after-spaces', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\nx:    &a y\n'), 'G1-13', 'An anchor after several spaces.')
reject('r14a-tilde-fence', BASE.replace('- Do the thing.\n', '~~~\ncode\n~~~\n'), 'G1-14', 'A fence of tildes.')
reject('r14b-indented-fence', BASE.replace('- Do the thing.\n', ' ```\n code\n ```\n'), 'G1-14', 'A fence indented by one space.')
reject('r14c-tab-indented-fence', BASE.replace('- Do the thing.\n', '\t```\ncode\n\t```\n'), 'G1-14', 'A fence indented by a tab.')
reject('r14d-indented-tilde-fence', BASE.replace('- Do the thing.\n', '   ~~~\ncode\n   ~~~\n'), 'G1-14', 'A fence of tildes indented by three spaces.')
reject('r14e-fence-in-list', BASE.replace('- Do the thing.\n', '- Do the thing:\n  ```\n  code\n  ```\n'), 'G1-14', 'A fence inside a list item.')
reject('r15a-unclosed-fence', BASE.replace('- Do the thing.\n', '```\ncode\n'), 'G1-15', 'A fence that is never closed.')
reject('r15b-closed-by-a-shorter-fence', BASE.replace('- Do the thing.\n', '````\ncode\n```\n'), 'G1-15', 'A fence of four closed by three.')
reject('r15c-closing-fence-with-text', BASE.replace('- Do the thing.\n', '```\ncode\n``` text\n'), 'G1-15', 'A closing fence with text after it does not close.')
reject('r16a-div', BASE.replace('- Do the thing.\n', '<div>\n'), 'G1-16', 'A <div> line.')
reject('r16b-pre', BASE.replace('- Do the thing.\n', '<pre>\n'), 'G1-16', 'A <pre> line.')
reject('r16c-closing-tag', BASE.replace('- Do the thing.\n', '</div>\n'), 'G1-16', 'A closing tag line.')
reject('r16d-processing-instruction', BASE.replace('- Do the thing.\n', '<?php\n'), 'G1-16', 'A processing instruction.')
reject('r16e-doctype', BASE.replace('- Do the thing.\n', '<!DOCTYPE html>\n'), 'G1-16', 'A declaration.')
reject('r16f-indented-details', BASE.replace('- Do the thing.\n', '   <details>\n'), 'G1-16', 'A tag indented by three spaces.')
reject('r16g-anchor-tag', BASE.replace('- Do the thing.\n', '<a href="x">y</a>\n'), 'G1-16', 'A line that starts with an inline tag.')
reject('r16h-autolink-with-space', BASE.replace('- Do the thing.\n', '<https://example.org/a b>\n'), 'G1-16', 'An autolink with a space is not an autolink.')
reject('r17a-equals', BASE.replace('- Do the thing.\n', 'Foo\n===\n'), 'G1-17', 'A setext level 1 heading.')
reject('r17b-dashes', BASE.replace('- Do the thing.\n', 'Foo\n---\n'), 'G1-17', 'A setext level 2 heading.')
reject('r17c-single-dash', BASE.replace('- Do the thing.\n', 'Foo\n-\n'), 'G1-17', 'A single dash under a text line.')
reject('r17d-errata-setext', BASE + '\nErrata\n------\n\nText.\n', 'G1-17', 'A setext Errata title: G1-17 is reported before G1-18.')
reject('r17e-indented-underline', BASE.replace('- Do the thing.\n', 'Foo\n   ===\n'), 'G1-17', 'An underline indented by three spaces.')
reject('r18a-lowercase', BASE + '\n## errata\n\nText.\n', 'G1-18', 'Another case.')
reject('r18b-level-three', BASE + '\n### Errata\n\nText.\n', 'G1-18', 'Another level.')
reject('r18c-no-space', BASE + '\n##Errata\n\nText.\n', 'G1-18', 'No space after the marks.')
reject('r18d-closing-marks', BASE + '\n## Errata ##\n\nText.\n', 'G1-18', 'Closing marks.')
reject('r18e-level-one', BASE + '\n# Known deviations\n\nText.\n', 'G1-18', 'Level one.')
reject('r18f-fenced', BASE.replace('- Do the thing.\n', '```\n## Errata\n```\n'), 'G1-18', 'The exact heading inside a fence.')
reject('r18g-indented-four', BASE + '\n    ## Errata\n\nText.\n', 'G1-18', 'Indented by four spaces.')
reject('r18h-indented-one', BASE + '\n ## Known deviations\n\nText.\n', 'G1-18', 'Indented by one space.')
reject('r18i-in-front-matter', swap(BASE, '  - docs/decisions/**\n', '  - docs/decisions/**\n  ## Errata\n'), 'G1-18', 'In the front matter.')
reject('r18j-alone-on-a-line', BASE.replace('- Do the thing.\n', 'Errata\n'), 'G1-18', 'The word alone on a line.')
reject('r18k-tab', BASE + '\n##\tErrata\n\nText.\n', 'G1-18', 'A tab after the marks.')
reject('r18l-known-deviations-fenced-in-errata', BASE + '\n' + ERR + '\n```\n## Known deviations\n```\n', 'G1-18', 'The exact heading in a fence inside an Errata section.')
reject('r18m-mixed-case-run', BASE + '\n## KNOWN DEVIATIONS\n\nText.\n', 'G1-18', 'Capitals.')
reject('r19a-errata-twice', BASE + '\n' + ERR + '\n' + ERR, 'G1-19', 'Two Errata sections.')
reject('r19b-known-deviations-twice', BASE + '\n' + KD + '\n' + KD, 'G1-19', 'Two Known deviations sections.')
reject('r19c-errata-first', BASE + '\n' + ERR + '\n' + KD, 'G1-19', 'Errata before Known deviations.')
reject('r20a-no-blank-line-before', BASE.rstrip('\n') + '\n## Errata\n\nText.\n', 'G1-20', 'The heading directly under a text line.')
reject('r20b-right-after-front-matter', swap(BASE, '---\n\n# Example decision\n', '---\n## Errata\n\nText.\n# Example decision\n'), 'G1-20', 'The heading directly after the front matter.')
reject('r20c-after-blank-with-spaces-is-fine-but-after-heading-is-not', BASE + '\n## Consequences\n## Errata\n\nText.\n', 'G1-20', 'The heading directly under another heading.')
# order of the rules: the first rule broken is reported
reject('o01-comment-and-no-front-matter', '<!-- x -->\n' + BASE.split('---\n\n', 1)[1], 'G1-06', 'Breaks G1-06 and G1-07: G1-06 is reported.')
reject('o02-nul-and-lone-cr', put('\x00\rmore'), 'G1-03', 'Breaks G1-03 and G1-05: G1-03 is reported.')
reject('o03-unclosed-fence-and-lookalike', BASE + '\n```\n## errata\n', 'G1-15', 'Breaks G1-15 and G1-18: G1-15 is reported.')
reject('o04-html-and-lookalike', BASE + '\n<div>\n## errata\n', 'G1-16', 'Breaks G1-16 and G1-18: G1-16 is reported.')
reject('o05-duplicate-key-and-excluded-capital', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\nStatus: x\n'), 'G1-10', 'Breaks G1-10 and G1-11: G1-10 is reported.')
reject('o06-invalid-utf8-and-bom', b'\xef\xbb\xbf' + b(BASE) + b'\xff', 'G1-01', 'Breaks G1-01 and G1-02: G1-01 is reported.')
reject('o07-front-matter-rule-before-body-rule', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\n# comment\n') + '\n~~~\n', 'G1-09', 'Breaks G1-09 and G1-14: G1-09 is reported.')


# ---- vectors added after the first mutation run -------------------------------------------------------
seal('b07-fence-closing-line-with-text', BASE.replace('- Do the thing.\n', '```\nfoo\n\n\n``` text\n\n\nbar\n```\n'), 'A line of backticks followed by text does not close a fence, so the blank lines after it are still inside the fence.')
seal('b08-level-one-heading-ends-a-section', BASE + '\n' + ERR + '\n# Appendix\n\nSealed text after the section.\n', 'A level 1 heading ends an excluded section: the text after it is sealed.', differs='a01-base')
seal('b09-heading-indented-one-space-ends-a-section', BASE + '\n' + ERR + '\n ## Appendix\n\nSealed text after the section.\n', 'A level 2 heading indented by one space ends an excluded section.', differs='a01-base')
seal('b10-heading-with-tab-ends-a-section', BASE + '\n' + ERR + '\n##\tAppendix\n\nSealed text after the section.\n', 'A tab after the marks makes a heading, which ends an excluded section.', differs='a01-base')
seal('b11-empty-heading-ends-a-section', BASE + '\n' + ERR + '\n##\n\nSealed text after the section.\n', 'A heading with no text ends an excluded section.', differs='a01-base')
seal('a23-heading-indented-four-spaces-stays-in-the-section', BASE + '\n' + ERR + '\n    ## Appendix\n\nStill the Errata section.\n', 'Four spaces make code, not a heading: the section goes on.')
seal('a24-marks-without-space-stay-in-the-section', BASE + '\n' + ERR + '\n##Appendix\n\nStill the Errata section.\n', 'Marks with no space after them are not a heading: the section goes on.')
seal('c23-unusual-characters-that-are-allowed', BASE.replace('Why a decision was needed.', 'No break, zero​width, joiner‍, narrow space, joiner⁠word, ideographic　space.'), 'Characters that look odd but are not on the list of G1-02 to G1-04.')
seal('c24-key-characters', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\nx_1-Y2: value\nA: b\n'), 'Digits, underscore, hyphen and capitals inside a key.')
seal('c25-two-tildes', BASE.replace('- Do the thing.\n', '~~struck~~ and ~~ more\n'), 'Two tildes are not a fence.')
seal('c26-line-of-inline-code', BASE.replace('- Do the thing.\n', '```inline``` is code, not a fence.\n\n\n- Do the thing.\n'), 'A line that starts with three backticks and has more backticks after them opens no fence.')
seal('c27-autolink-scheme-lengths', BASE.replace('- Do the thing.\n', '<ab:c>\n\n<' + 'a' * 32 + ':x>\n\n- Do the thing.\n'), 'An autolink scheme of 2 and of 32 characters.')
seal('c28-rule-after-a-fence', BASE.replace('- Do the thing.\n', '```\ncode\n```\n---\n\nAfter.\n'), 'A --- right after a closing fence is a thematic break.')
seal('c29-rule-right-after-front-matter', swap(BASE, '---\n\n# Example', '---\n---\n\n# Example'), 'A --- as the first line of the body.')
seal('d14-trailing-no-break-space', BASE.replace('Why a decision was needed.', 'Why a decision was needed. '), 'A no-break space at the end of a line is not white space for this page.', differs='a01-base')
reject('r03i-shift-out', put('\x0e'), 'G1-03', 'U+000E.')
reject('r03j-unit-separator', put('\x1f'), 'G1-03', 'U+001F.')
reject('r03k-first-c1-control', put('\u0080'), 'G1-03', 'U+0080.')
reject('r04h-right-to-left-mark', put('‏'), 'G1-04', 'U+200F.')
reject('r04i-left-to-right-embedding', put('‪'), 'G1-04', 'U+202A.')
reject('r09i-dot-in-key', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\na.b: x\n'), 'G1-09', 'A dot in a key.')
reject('r09j-tab-after-indent', swap(BASE, '  - maintainers', '  \t- maintainers'), 'G1-09', 'A space and then a tab: not a continuation line.')
seal('c30-no-break-space-after-indent', swap(BASE, '  - maintainers', '  \u00a0- maintainers'), 'A no-break space after the indent is a character, not white space for this page.', differs='a01-base')
reject('r16i-scheme-of-one-letter', BASE.replace('- Do the thing.\n', '<a:b>\n'), 'G1-16', 'An autolink scheme needs at least two characters.')
reject('r16j-scheme-of-33-characters', BASE.replace('- Do the thing.\n', '<' + 'a' * 33 + ':x>\n'), 'G1-16', 'An autolink scheme has at most 32 characters.')

# ---- boundaries that a mutation test of the third implementation (the kit's library) found unpinned --------
NEXT_TO_REJECTED = ''.join(chr(c) for c in (0x061b, 0x061d, 0x2010, 0x2027, 0x2065, 0x206a))
seal('c31-code-points-next-to-the-rejected-ones', BASE.replace('- Do the thing.\n', 'Next to the rejected ranges: ' + NEXT_TO_REJECTED + '\n'), 'U+061B, U+061D, U+2010, U+2027, U+2065 and U+206A lie just outside the separator and bidirectional ranges of G1-04: ordinary characters.')
seal('c32-one-letter-keys', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\nk: v\nx: y\n'), 'A key of one letter is a key, and a value may start with a lowercase letter.')
seal('c33-fence-marks-inside-a-line', BASE.replace('- Do the thing.\n', 'Write `` or ~~~ or ``` in a sentence.\n\n  ``two backticks, indented``\n\n``\n'), 'Tildes or three backticks in the middle of a line, two backticks indented, and a line of two backticks are not fences.')
seal('c34-autolink-forms', BASE.replace('- Do the thing.\n', '<ab:>\n\n<a+b:x>\n\n<a.b:x>\n\n<a-b:x>\n\n<a1:x>\n\n<AB:x>\n\n   <https://example.org/indented-by-three>\n'), 'Autolinks with no text after the colon, with every kind of character in the scheme, with capital letters, and indented by three spaces.')
seal('c35-lines-that-only-end-like-an-underline', BASE.replace('- Do the thing.\n', 'Compare the two values:\na - b =\nVersion 1.0 -\n\nA paragraph line\n    ---\n'), 'A line that ends in = or - is not an underline, and --- indented by four spaces is not one either.')
seal('c36-rules-under-headings', BASE.replace('- Do the thing.\n', '# One\n---\n\n###### Six\n---\n\n#\tTab\n---\n\n#\n---\n\n   ## Three spaces\n---\n'), 'A --- under a heading of level 1 or 6, with a tab after the marks, with no text, or indented by three spaces is a thematic break.')
seal('c37-empty-front-matter', '---\n---\n\n# Example decision\n\nText.\n', 'The closing --- may be line 2: an empty front matter.')
seal('c38-dash-before-an-anchor', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\ntags:\n  -&one\n  - plain\n'), 'A continuation line that starts with a dash and no space is not a list item, so the & after it is not the start of an anchor.')
seal('c39-values-that-start-with-other-marks', swap(BASE, 'date: 2026-11-03\n', 'date: 2026-11-03\nq1: "quoted"\nq2: \'single\'\nq3: [a, b]\nq4: {k: v}\nq5: -x\nq6: ?x\nq7: #x\nq8: %x\nq9: @x\nq10: `x\nq11: x\n'), 'Only & * ! | > start a value that G1-13 rejects; quotes, brackets, braces and the other marks are ordinary.')
seal('c40-near-misses-of-the-excluded-headings', BASE.replace('- Do the thing.\n', 'Err ata\n\n## Erratum\n\n## Errata list\n\n## Known deviation\n'), 'Words that are not the name of an excluded section, one of them split by a space, are ordinary text.')
seal('c41-fence-on-the-first-line-of-the-body', '---\nstatus: proposed\n---\n```text\nfirst\n\n\nsecond\n```\n\n# After\n', 'A fence that opens on the first line after the front matter; the two blank lines in it are kept.')
seal('c42-heading-indented-three-spaces-ends-the-section', swap(BASE, '## Alternatives considered', KD + '\n   ## Alternatives considered'), 'A heading indented by three spaces ends a Known deviations section and stays in the record: the seal is that of the base with that heading indented.', differs='a01-base')
seal('a25-errata-heading-directly-before-a-fence', BASE + '\n## Errata\n```text\n- 2026-11-04: fixed a typo.\n```\n', 'An Errata section whose first line after the heading is a fence: a heading that is not in a fence even though a fence follows it.')
reject('r14f-tab-indented-tilde-fence', BASE.replace('- Do the thing.\n', '\t~~~\ncode\n\t~~~\n'), 'G1-14', 'A tab before the tildes.')
reject('r16k-uppercase-tag', BASE.replace('- Do the thing.\n', '<DIV>\n'), 'G1-16', 'A tag name in capitals.')
reject('r16l-autolink-later-in-the-line', BASE.replace('- Do the thing.\n', '<div> <ab:x>\n'), 'G1-16', 'An autolink further along the line does not excuse the tag at the start.')
reject('r16m-html-on-the-first-line-of-the-body', '---\nstatus: proposed\n---\n<br>\n\nText.\n', 'G1-16', 'A tag on the line right after the front matter.')
reject('r17v-paragraph-right-after-a-fence', BASE.replace('- Do the thing.\n', '```\ncode\n```\nA line right after the fence\n---\n'), 'G1-17', 'The line above the underline follows a closing fence; it is a paragraph, not code.')
reject('r17w-seven-marks-above', BASE.replace('- Do the thing.\n', '####### Seven\n---\n'), 'G1-17', 'Seven # are not a heading, so the underline turns the line into one.')
reject('r17x-mark-inside-the-line-above', BASE.replace('- Do the thing.\n', 'I like C# a lot\n---\n'), 'G1-17', 'A # inside the line is not a heading mark.')
reject('r17y-indented-heading-above', BASE.replace('- Do the thing.\n', '    # Four spaces\n---\n'), 'G1-17', 'A # indented by four spaces is not a heading.')
reject('r17z-indented-paragraph-above', BASE.replace('- Do the thing.\n', ' One space\n---\n'), 'G1-17', 'A line indented by one space is a paragraph, not a heading.')
reject('r18n-closing-marks-after-a-tab', BASE.replace('- Do the thing.\n', '\n## Errata\t##\n'), 'G1-18', 'A tab before closing # marks still leaves a lookalike.')
reject('r18o-text-before-a-closing-run-in-a-fence', BASE.replace('- Do the thing.\n', '```\nfirst\ntext ```\n## Known deviations\n```\n'), 'G1-18', 'A line that ends in backticks but has text before them does not close the fence, so the heading stays in the code block.')
reject('r20d-right-after-a-fence', BASE.replace('- Do the thing.\n', '- Do the thing.\n\n```\ncode\n```\n## Errata\n\nEntry.\n'), 'G1-20', 'A closing fence directly above the heading: not an empty line, and the heading is not in the code block, so G1-20 and not G1-18.')

# ---- compute and write ---------------------------------------------------------------------------------
vecs = []
seals = {}
for (i, kind, data, rule, note, differs) in V:
    if kind == 'seal':
        s = g1.seal_g1(data)
        seals[i] = s
for (i, kind, data, rule, note, differs) in V:
    if i == 'a20-sealed-record':
        data = data.replace(b'@A01@', seals['a01-base'].encode())
        seals[i] = g1.seal_g1(data)
    if kind == 'seal':
        s = seals[i]
        if differs: assert s != seals[differs], (i, 'should differ from', differs)
        entry = {'id': i, 'file': f'seal/{i}.record', 'result': 'seal', 'seal': s, 'note': note}
        if differs: entry['differs-from'] = differs
    else:
        try:
            g1.canonical(data); got = None
        except g1.Reject as e:
            got = e.rule
        assert got == rule, (i, 'wanted', rule, 'got', got)
        entry = {'id': i, 'file': f'reject/{i}.record', 'result': 'reject', 'rule': rule, 'note': note}
    with open(os.path.join(OUT, entry['file']), 'wb') as f:
        f.write(data)
    vecs.append(entry)
base = seals['a01-base']
for i in [v for v in seals if v.startswith('a')]:
    assert seals[i] == base, (i, 'should have the seal of the base')
assert seals['b03-fence-crlf'] == seals['b01-fence-blank-lines-kept']
assert seals['c42-heading-indented-three-spaces-ends-the-section'] == g1.seal_g1(BASE.replace('## Alternatives considered', '   ## Alternatives considered').encode())
with open(os.path.join(OUT, 'vectors.json'), 'w') as f:
    json.dump({'generation': 'g1', 'vectors': vecs}, f, indent=2, ensure_ascii=False)
    f.write('\n')
print(len(vecs), 'vectors:', sum(1 for v in vecs if v['result'] == 'seal'), 'seal,', sum(1 for v in vecs if v['result'] == 'reject'), 'reject')
