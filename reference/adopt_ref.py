"""A second implementation of the first sealing of the records that existed before the kit (`seal --adopt`, docs/install.md), in Python with the standard library
only. It is written from the page and shares no code with record-keeper.mjs: it uses g1.py for the seal and for the rules of g1, and validate_ref.py for the length that
V-10 counts, which are the second implementations of those pages.

  adopt_record(data)  -> ('seal', new_bytes) | ('has-seal',) | ('skip', why) | ('cannot', rule, why)
  adopt_folder(files) -> [(name, result), ...] in name order, for `files`, a dict of the regular files of a records folder (name to bytes)

A record is bytes. Nothing here changes a byte of a record but by adding the line `seal: sha256-g1:<hex>` before the closing `---` of the front matter."""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
import g1
import validate_ref

SEALABLE = re.compile(r'^(accepted|superseded by [0-9]{4})$')


def adopt_record(data):
    try:
        lines, end = g1.check(data)
    except g1.Reject as rejected:
        return ('cannot', rejected.rule, None)
    keys = [(g1.KEY_LINE.match(l).group(1), (g1.KEY_LINE.match(l).group(2) or '').lstrip(' ')) for l in lines[1:end] if g1.KEY_LINE.match(l)]
    status = [value for key, value in keys if key == 'status']
    if not status:
        return ('skip', 'no status')
    if not SEALABLE.match(status[0]):
        return ('skip', 'status ' + status[0])
    if any(key == 'seal' for key, _ in keys):
        return ('has-seal',)
    value = g1.seal_g1(data)
    # the physical line `end` is the closing delimiter: g1 allows no carriage return that is not part of a CRLF, so the lines are the pieces between line feeds
    pieces = data.split(b'\n')
    at = sum(len(piece) + 1 for piece in pieces[:end])
    eol = b'\r\n' if pieces[end - 1].endswith(b'\r') else b'\n'
    sealed = data[:at] + b'seal: ' + value.encode() + eol + data[at:]
    # a line more, and V-10 counts it: a record that is at the longest length would be one that `validate` reports
    new_lines, new_end = g1.check(sealed)
    if validate_ref.length_as_accepted(lines, end) <= validate_ref.MAX_LINES < validate_ref.length_as_accepted(new_lines, new_end):
        return ('cannot', 'V-10', 'the seal line would make the record longer than %d lines' % validate_ref.MAX_LINES)
    return ('seal', sealed)


def adopt_folder(files):
    out = []
    for name in sorted(files):
        if name.startswith('.') or name in ('README.md', 'template.md'):
            continue
        if not validate_ref.RECORD_FILE.match(name):
            out.append((name, ('skip', 'not a record file')))
        else:
            out.append((name, adopt_record(files[name])))
    return out
