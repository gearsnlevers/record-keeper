"""Builds test/fixtures/agent/cases.json. Every case states the answer it was written to show; the generator runs the Python reference (agent_ref.py) on it and stops if the
two differ. Usage: build_agent_cases.py <out.json>

The cases are about the block of AGENTS.md (docs/agent-files.md): where it is (`reads`), what the file becomes when a block is put into it (`splices`) and whether the text that
agents read changed between two versions (`diffs`). A file is bytes, written as a text when it is UTF-8 and as {"hex": ...} when it is not; null is no file."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import agent_ref as ref

BEGIN, END = ref.BEGIN, ref.END
BLOCK = BEGIN + b'\nrule one\nrule two\n' + END
OTHER = BEGIN + b'\nsomething else\n' + END
reads, splices, diffs = [], [], []


def shown(data):
    if data is None:
        return None
    try:
        return data.decode('utf-8')
    except UnicodeDecodeError:
        return {'hex': data.hex()}


def read(case_id, note, data, **expect):
    expect.setdefault('fenced', False) if expect.get('state') == 'none' else None
    reads.append({'id': case_id, 'note': note, 'input': shown(data), 'expect': expect})


def splice(case_id, note, current, block, **expect):
    out = {'ok': expect['ok']}
    if expect['ok']:
        out.update(action=expect['action'], output=shown(expect['output']))
    else:
        out['why'] = expect['why']
    splices.append({'id': case_id, 'note': note, 'current': shown(current), 'block': shown(block), 'expect': out})


def diff(case_id, note, before, after, changed):
    diffs.append({'id': case_id, 'note': note, 'before': shown(before), 'after': shown(after), 'expect': changed})


def one(prefix, block, suffix, **extra):
    return dict(state='one', start=len(prefix), end=len(prefix) + len(block), **extra)


# ---------------------------------------------------------------------------------------------------------------------------------- reads
read('r01-empty', 'An empty file has no block.', b'', state='none')
read('r02-prose', 'Prose and no marker: none.', b'# Notes\n\nSome text.\n', state='none')
read('r03-block-alone', 'A file that is the block and nothing else.', BLOCK, **one(b'', BLOCK, b''))
read('r04-around', 'A block between a heading and a list: the region is from the first byte of the begin line to the last byte of the end marker.', b'# Mine\n\n' + BLOCK + b'\n\n- mine\n', **one(b'# Mine\n\n', BLOCK, b''))
read('r05-crlf', 'A file with CRLF line ends: the carriage return after a marker is not part of it, and the region ends before it.', b'# Mine\r\n' + BEGIN + b'\r\nx\r\n' + END + b'\r\nafter\r\n', **one(b'# Mine\r\n', BEGIN + b'\r\nx\r\n' + END, b''))
read('r06-no-final-newline', 'The end marker is the last thing in the file.', b'top\n' + BLOCK, **one(b'top\n', BLOCK, b''))
read('r07-backtick-fence', 'Both markers inside a fence of backticks are an example and not a block.', b'```\n' + BLOCK + b'\n```\n', state='none')
read('r08-tilde-fence', 'The same in a fence of tildes, with an info string.', b'~~~markdown\n' + BLOCK + b'\n~~~\n', state='none')
read('r09-longer-fence', 'A fence of four backticks is not closed by three, so the markers stay inside it.', b'````\n```\n' + BLOCK + b'\n```\n````\n', state='none')
read('r10-fence-closed-by-longer', 'A fence of three is closed by one of five.', b'```\nexample\n`````\n' + BLOCK + b'\n', **one(b'```\nexample\n`````\n', BLOCK, b''))
read('r11-fence-closer-with-info', 'A line of backticks with text after it does not close a fence.', b'```\n```not a closer\n' + BLOCK + b'\n```\n', state='none')
read('r12-begin-in-fence-end-outside', 'A begin marker inside a fence and an end marker outside it: the end has no begin.', b'```\n' + BEGIN + b'\n```\nx\n' + END + b'\n', state='refused', why='end-without-begin')
read('r13-unclosed-fence', 'A fence that is never closed runs to the end of the file, and the file says so.', b'text\n```\n' + BLOCK + b'\n', state='none', fenced=True)
read('r14-indented-fence', 'A fence may be indented by three spaces.', b'   ```\n' + BLOCK + b'\n   ```\n', state='none')
read('r15-fence-four-spaces', 'Four spaces make it code that is indented, not a fence: the begin marker is then a line that holds more than the marker.', b'    ```\n' + BLOCK + b'\n', **one(b'    ```\n', BLOCK, b''))
read('r16-backtick-in-info', 'An opener with a backtick in its info string is not an opener.', b'``` a`b\n' + BLOCK + b'\n', **one(b'``` a`b\n', BLOCK, b''))
read('r17-tilde-info-with-backtick', 'A tilde fence may have a backtick in its info string.', b'~~~ a`b\n' + BLOCK + b'\n~~~\n', state='none')
read('r18-mid-line', 'A marker in the middle of a line is refused: the line holds more than a marker.', b'see ' + BEGIN + b' for more\n', state='refused', why='partial-line')
read('r19-trailing-space', 'A marker with a space after it is not the marker.', BEGIN + b' \nx\n' + END + b'\n', state='refused', why='partial-line')
read('r20-leading-space', 'A marker with a space before it is not the marker.', b' ' + BEGIN + b'\nx\n' + END + b'\n', state='refused', why='partial-line')
read('r21-tab', 'A marker with a tab before it is not the marker.', b'\t' + BEGIN + b'\nx\n' + END + b'\n', state='refused', why='partial-line')
read('r22-byte-order-mark', 'A byte order mark in front of the begin marker is a line that holds more than the marker.', b'\xef\xbb\xbf' + BLOCK + b'\n', state='refused', why='partial-line')
read('r23-stem-in-prose', 'The text of a marker in prose, with no comment around it, is refused too: it could be a marker that was damaged.', b'The block starts at record-keeper:begin.\n', state='refused', why='partial-line')
read('r24-stem-inside-the-block', 'A line that holds the stem of the end marker inside the block makes the file refused.', BEGIN + b'\nrecord-keeper:end\n' + END + b'\n', state='refused', why='partial-line')
read('r25-doubled', 'Two blocks.', BLOCK + b'\n\n' + OTHER + b'\n', state='refused', why='doubled')
read('r26-nested', 'A begin marker inside a block.', BEGIN + b'\n' + BEGIN + b'\nx\n' + END + b'\n' + END + b'\n', state='refused', why='doubled')
read('r27-reversed', 'The end marker before the begin marker.', END + b'\nx\n' + BEGIN + b'\n', state='refused', why='reversed')
read('r28-begin-only', 'A begin marker and no end.', b'a\n' + BEGIN + b'\nb\n', state='refused', why='begin-without-end')
read('r29-end-only', 'An end marker and no begin.', b'a\n' + END + b'\nb\n', state='refused', why='end-without-begin')
read('r30-two-ends', 'A block and one more end marker.', BLOCK + b'\n' + END + b'\n', state='refused', why='doubled')
read('r31-end-begin-end', 'An end, a begin and an end.', END + b'\n' + BLOCK + b'\n', state='refused', why='doubled')
read('r32-two-begins', 'Two begin markers and no end.', BEGIN + b'\n' + BEGIN + b'\n', state='refused', why='doubled')
read('r33-marker-in-a-url', 'A line of prose that holds the stem is refused, whatever it is for.', b'https://example.com/record-keeper:endpoint\n', state='refused', why='partial-line')
read('r34-lone-carriage-return', 'A carriage return that is not before a line feed does not end a line.', b'a\r' + BEGIN + b'\nx\n' + END + b'\n', state='refused', why='partial-line')
read('r35-marker-then-eof-cr', 'The end marker followed by a carriage return at the end of the file.', BEGIN + b'\nx\n' + END + b'\r', **one(b'', BEGIN + b'\nx\n' + END, b''))
read('r36-outside-is-not-text', 'Bytes that are not UTF-8 stand outside the markers and are not read.', b'\xff\xfe caf\xe9\n' + BLOCK + b'\n\x00', **one(b'\xff\xfe caf\xe9\n', BLOCK, b''))
read('r37-a-line-of-the-fence-is-no-marker', 'The opening line of a fence is never read as a marker, even when it holds one.', b'```' + BEGIN + b'\n```\n', state='none')

read('r38-two-backticks', 'Two backticks are not a fence, so the block after them is read.', b'``\n' + BLOCK + b'\n', **one(b'``\n', BLOCK, b''))
read('r39-two-tildes', 'Two tildes are not a fence either.', b'~~\n' + BLOCK + b'\n', **one(b'~~\n', BLOCK, b''))
read('r40-closer-with-trailing-spaces', 'A closing fence may be followed by spaces.', b'```\nexample\n```   \n' + BLOCK + b'\n', **one(b'```\nexample\n```   \n', BLOCK, b''))
read('r41-closer-with-a-trailing-tab', 'A closing fence may be followed by a tab.', b'```\nexample\n```\t\n' + BLOCK + b'\n', **one(b'```\nexample\n```\t\n', BLOCK, b''))
read('r42-the-start-of-the-stem-is-not-the-stem', 'The text of a marker that is cut short is not the text of a marker: nothing is refused for it.', b'record-keeper:begi and record-keeper:en\n' + BLOCK + b'\n', **one(b'record-keeper:begi and record-keeper:en\n', BLOCK, b''))

# ------------------------------------------------------------------------------------------------------------------------------- splices
splice('s01-no-file', 'No file: it is created with the block and a line feed.', None, BLOCK, ok=True, action='create', output=BLOCK + b'\n')
splice('s02-empty-file', 'An empty file: the block is the whole of it, and there is no blank line before it.', b'', BLOCK, ok=True, action='append', output=BLOCK + b'\n')
splice('s03-no-markers', 'A file with no markers: the block goes at the end, after one blank line.', b'# Mine\n\nText.\n', BLOCK, ok=True, action='append', output=b'# Mine\n\nText.\n\n' + BLOCK + b'\n')
splice('s04-blank-line-already', 'A file that ends in a blank line gets no more.', b'# Mine\n\n', BLOCK, ok=True, action='append', output=b'# Mine\n\n' + BLOCK + b'\n')
splice('s05-no-final-newline', 'A file that does not end in a line feed gets two.', b'# Mine', BLOCK, ok=True, action='append', output=b'# Mine\n\n' + BLOCK + b'\n')
splice('s06-crlf-file-no-markers', 'A file with CRLF line ends: the new lines are the block as it is, and the file is not touched.', b'# Mine\r\nText\r\n', BLOCK, ok=True, action='append', output=b'# Mine\r\nText\r\n\n' + BLOCK + b'\n')
splice('s07-crlf-blank-line', 'A CRLF file that ends in a blank line gets no more.', b'# Mine\r\n\r\n', BLOCK, ok=True, action='append', output=b'# Mine\r\n\r\n' + BLOCK + b'\n')
splice('s08-one-block', 'A block that differs is replaced, and nothing before or after it changes.', b'# Mine\n\n' + OTHER + b'\n\n- after\n', BLOCK, ok=True, action='replace', output=b'# Mine\n\n' + BLOCK + b'\n\n- after\n')
splice('s09-already-current', 'A block that is the block already: nothing changes, byte for byte.', b'# Mine\n\n' + BLOCK + b'\n\n- after\n', BLOCK, ok=True, action='current', output=b'# Mine\n\n' + BLOCK + b'\n\n- after\n')
splice('s10-crlf-around-block', 'A CRLF file with a block: the line ends outside the markers stay, and the block is put in as it is.', b'# Mine\r\n' + BEGIN + b'\r\nold\r\n' + END + b'\r\nafter\r\n', BLOCK, ok=True, action='replace', output=b'# Mine\r\n' + BLOCK + b'\r\nafter\r\n')
splice('s11-block-at-end-no-newline', 'A block at the end of a file with no final line feed: the file still has none.', b'top\n' + OTHER, BLOCK, ok=True, action='replace', output=b'top\n' + BLOCK)
splice('s12-in-a-fence', 'Markers inside a fence are an example: the block is added after the fence.', b'```\n' + OTHER + b'\n```\n', BLOCK, ok=True, action='append', output=b'```\n' + OTHER + b'\n```\n\n' + BLOCK + b'\n')
splice('s13-ends-in-a-fence', 'A file that ends inside a fence is refused: the block would be part of the example.', b'text\n```\ncode\n', BLOCK, ok=False, why='fence')
splice('s14-mid-line', 'A marker in the middle of a line.', b'see ' + BEGIN + b'\n', BLOCK, ok=False, why='partial-line')
splice('s15-doubled', 'Two blocks.', BLOCK + b'\n' + BLOCK + b'\n', BLOCK, ok=False, why='doubled')
splice('s16-nested', 'Nested markers.', BEGIN + b'\n' + BEGIN + b'\n' + END + b'\n' + END + b'\n', BLOCK, ok=False, why='doubled')
splice('s17-reversed', 'The end marker before the begin marker.', END + b'\n' + BEGIN + b'\n', BLOCK, ok=False, why='reversed')
splice('s18-begin-only', 'A begin marker and no end.', b'a\n' + BEGIN + b'\nb\n', BLOCK, ok=False, why='begin-without-end')
splice('s19-end-only', 'An end marker and no begin.', b'a\n' + END + b'\nb\n', BLOCK, ok=False, why='end-without-begin')
splice('s20-unicode-and-white-space', 'Text outside the markers with non-ASCII letters, trailing white space and a tab is never touched.', 'café ☃ éè  \n\t\t\n'.encode('utf-8') + OTHER + b'\n  \n\xe2\x80\xa8trailing \t\n', BLOCK, ok=True, action='replace', output='café ☃ éè  \n\t\t\n'.encode('utf-8') + BLOCK + b'\n  \n\xe2\x80\xa8trailing \t\n')
splice('s21-bytes-outside', 'A file that is not UTF-8 is not decoded: bytes outside the markers stay as they are.', b'\xff\xfe\x80\n' + OTHER + b'\n\xc3(\n', BLOCK, ok=True, action='replace', output=b'\xff\xfe\x80\n' + BLOCK + b'\n\xc3(\n')
splice('s22-zero-byte', 'A file with a zero byte and no markers is not a text that can be added to.', b'a\x00b\n', BLOCK, ok=False, why='not-text')
splice('s23-zero-byte-with-block', 'A zero byte in a file that has a block does not stop the replacement: only what is between the markers changes.', b'a\x00b\n' + OTHER + b'\n', BLOCK, ok=True, action='replace', output=b'a\x00b\n' + BLOCK + b'\n')
splice('s24-whitespace-line-before', 'A last line of spaces is a line like another: one more blank line follows it.', b'# Mine\n  \n', BLOCK, ok=True, action='append', output=b'# Mine\n  \n\n' + BLOCK + b'\n')
splice('s25-a-block-that-is-not-one', 'A block that is not one begin marker, text and one end marker is refused before the file is read.', b'a\n', b'no markers here', ok=False, why='invalid-block')
splice('s26-a-block-with-text-after-the-end', 'The block must end with the end marker.', b'a\n', BLOCK + b'\n', ok=False, why='invalid-block')
splice('s27-a-block-that-opens-a-fence', 'A block that opens a fence it does not close would swallow its own end marker.', b'a\n', BEGIN + b'\n```\n' + END, ok=False, why='invalid-block')
splice('s28-a-block-with-a-fence-that-closes', 'A block with a fenced example that is closed is a block.', b'a\n', BEGIN + b'\n```\nx\n```\n' + END, ok=True, action='append', output=b'a\n\n' + BEGIN + b'\n```\nx\n```\n' + END + b'\n')
splice('s29-the-block-twice-with-no-final-newline', 'The block, put in again over its own output, is the same file.', BLOCK + b'\n', BLOCK, ok=True, action='current', output=BLOCK + b'\n')
splice('s30-the-first-line-only', 'A file with one line and a line feed.', b'x\n', BLOCK, ok=True, action='append', output=b'x\n\n' + BLOCK + b'\n')
splice('s31-lone-newline', 'A file that is one line feed.', b'\n', BLOCK, ok=True, action='append', output=b'\n\n' + BLOCK + b'\n')
splice('s32-crlf-only', 'A file that is one CRLF.', b'\r\n', BLOCK, ok=True, action='append', output=b'\r\n\n' + BLOCK + b'\n')
splice('s33-marker-text-in-a-fence-and-a-block', 'A fenced example next to the real block: the real block is replaced and the example stays.', b'```\n' + BEGIN + b'\n```\n' + OTHER + b'\n', BLOCK, ok=True, action='replace', output=b'```\n' + BEGIN + b'\n```\n' + BLOCK + b'\n')
splice('s34-block-with-a-carriage-return-inside-is-replaced', 'A block whose lines end in CRLF is not the block of the release: it is replaced.', BEGIN + b'\r\nrule one\r\nrule two\r\n' + END + b'\r\n', BLOCK, ok=True, action='replace', output=BLOCK + b'\r\n')

splice('s35-a-block-with-text-before-the-begin-marker', 'The block must start with the begin marker: a line before it makes it no block.', b'a\n', b'a heading\n' + BLOCK, ok=False, why='invalid-block')

# --------------------------------------------------------------------------------------------------------------------------------- diffs
diff('d01-no-file-no-file', 'Neither side has a file.', None, None, False)
diff('d02-file-without-block-to-another', 'Two files with no markers are the same, whatever they say.', b'one\n', b'two\n', False)
diff('d03-file-appears-without-block', 'A file that appears with no block is nothing.', None, b'# A new file\n', False)
diff('d04-file-appears-with-block', 'A file that appears with a block is an act.', None, BLOCK + b'\n', True)
diff('d05-block-appears', 'A block is added to a file that had none.', b'# Mine\n', b'# Mine\n\n' + BLOCK + b'\n', True)
diff('d06-block-removed', 'A block is removed.', b'# Mine\n\n' + BLOCK + b'\n', b'# Mine\n', True)
diff('d07-file-deleted-with-block', 'A file with a block is deleted.', BLOCK + b'\n', None, True)
diff('d08-file-deleted-without-block', 'A file with no block is deleted.', b'x\n', None, False)
diff('d09-outside-changes', 'Text outside the markers changes: nothing.', b'a\n' + BLOCK + b'\nb\n', b'A\n' + BLOCK + b'\nB\nmore\n', False)
diff('d10-block-changes', 'A word in the block changes.', b'a\n' + BLOCK + b'\n', b'a\n' + BLOCK.replace(b'one', b'uno') + b'\n', True)
diff('d11-block-moves', 'The block moves to the top: its bytes are the same, so nothing changed that agents read.', b'a\n' + BLOCK + b'\n', BLOCK + b'\na\n', False)
diff('d12-begin-marker-changes', 'The begin marker is damaged: the markers are refused, and that is a change.', b'a\n' + BLOCK + b'\n', b'a\n' + BLOCK.replace(BEGIN, b'<!-- record-keeper:begin  -->') + b'\n', True)
diff('d13-end-marker-removed', 'The end marker is removed.', b'a\n' + BLOCK + b'\n', b'a\n' + BEGIN + b'\nrule one\nrule two\n', True)
diff('d14-both-refused-and-equal', 'A file whose markers are refused, unchanged.', BEGIN + b'\nx\n', BEGIN + b'\nx\n', False)
diff('d15-both-refused-outside-changes', 'A file whose markers are refused changes anywhere: the check cannot tell what is inside, so it counts.', BEGIN + b'\nx\n', b'top\n' + BEGIN + b'\nx\n', True)
diff('d16-refused-to-block', 'The markers are mended: a change.', BEGIN + b'\nx\n', BLOCK + b'\n', True)
diff('d17-refused-to-none', 'The stray marker is removed.', BEGIN + b'\nx\n', b'x\n', True)
diff('d18-none-to-refused', 'A stray marker is added to a file with no block.', b'x\n', b'x\n' + END + b'\n', True)
diff('d19-block-in-fence-added', 'A block is added inside a fence: it is an example, and nothing that agents read changed.', b'x\n', b'x\n```\n' + BLOCK + b'\n```\n', False)
diff('d20-block-moved-into-fence', 'The block is wrapped in a fence: it is no block now, and that is a change.', b'x\n' + BLOCK + b'\n', b'x\n```\n' + BLOCK + b'\n```\n', True)
diff('d21-line-end-outside-changes', 'Line ends outside the markers change from LF to CRLF: nothing.', b'a\n' + BLOCK + b'\nb\n', b'a\r\n' + BLOCK + b'\r\nb\r\n', False)
diff('d22-line-end-after-the-block-only', 'The block with a carriage return after the end marker: the same block.', b'a\n' + BLOCK + b'\n', b'a\n' + BLOCK + b'\r\n', False)
diff('d23-line-ends-inside-change', 'Line ends inside the block change: the block is another text.', b'a\n' + BLOCK + b'\n', b'a\n' + BEGIN + b'\r\nrule one\r\nrule two\r\n' + END + b'\n', True)
diff('d24-trailing-space-in-block', 'A space at the end of a line inside the block.', b'a\n' + BLOCK + b'\n', b'a\n' + BLOCK.replace(b'one', b'one ') + b'\n', True)
diff('d25-unicode-outside', 'Unicode outside the markers changes: nothing.', 'café\n'.encode() + BLOCK + b'\n', 'cafè ☃\n'.encode() + BLOCK + b'\n', False)
diff('d26-empty-to-block', 'An empty file gets a block.', b'', BLOCK, True)
diff('d27-empty-to-none', 'An empty file gets text.', b'', b'x', False)
diff('d28-no-file-to-empty', 'No file, then an empty file.', None, b'', False)
diff('d29-bytes-outside-not-utf8', 'Bytes that are not UTF-8 outside the markers change: nothing.', b'\xff\n' + BLOCK + b'\n', b'\xfe\x00\n' + BLOCK + b'\n', False)
diff('d30-block-with-fence-example-added-to-the-top', 'An example of the markers in a fence is added above the real block: nothing.', b'a\n' + BLOCK + b'\n', b'```\n' + BEGIN + b'\n' + END + b'\n```\na\n' + BLOCK + b'\n', False)

# ---------------------------------------------------------------------------------------------------------------------- the reference agrees
failed = 0
for c in reads:
    data = None if c['input'] is None else (c['input'].encode('utf-8') if isinstance(c['input'], str) else bytes.fromhex(c['input']['hex']))
    got = ref.read_block(data)
    if got != c['expect']:
        failed += 1
        print('DIFFERENT', c['id'], '\n  intended', c['expect'], '\n  reference', got)


def raw(value):
    return None if value is None else (value.encode('utf-8') if isinstance(value, str) else bytes.fromhex(value['hex']))


for c in splices:
    got = ref.splice_block(raw(c['current']), raw(c['block']))
    got = {'ok': True, 'action': got['action'], 'output': shown(got['output'])} if got['ok'] else got
    if got != c['expect']:
        failed += 1
        print('DIFFERENT', c['id'], '\n  intended', c['expect'], '\n  reference', got)
for c in diffs:
    got = ref.block_changed(raw(c['before']), raw(c['after']))
    if got != c['expect']:
        failed += 1
        print('DIFFERENT', c['id'], '\n  intended', c['expect'], '\n  reference', got)
# a block that was put in is found, and put in again changes nothing: the two things the updater counts on
for c in splices:
    if c['expect']['ok']:
        out = raw(c['expect']['output'])
        found = ref.read_block(out)
        again = ref.splice_block(out, raw(c['block']))
        if found['state'] != 'one' or out[found['start']:found['end']] != raw(c['block']) or again != {'ok': True, 'action': 'current', 'output': out}:
            failed += 1
            print('NOT STABLE', c['id'])
if failed:
    print(failed, 'cases differ')
    sys.exit(1)
ids = [c['id'] for group in (reads, splices, diffs) for c in group]
assert len(ids) == len(set(ids)), 'ids repeat'
with open(sys.argv[1], 'w', encoding='utf-8') as handle:
    json.dump({'block': shown(BLOCK), 'reads': reads, 'splices': splices, 'diffs': diffs}, handle, ensure_ascii=True, indent=1)
    handle.write('\n')
print(len(reads), 'read cases,', len(splices), 'splice cases,', len(diffs), 'diff cases; the reference agrees with all of them')
