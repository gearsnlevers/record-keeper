"""A second implementation of the block of AGENTS.md (docs/agent-files.md), in Python with the standard library only. It is written from the page and shares no code with
updater.mjs: it finds the block between the two markers of a file, puts a block into a file, and says whether the text that agents read changed between two versions.

  read_block(data)            -> {'state': 'none', 'fenced'} | {'state': 'one', 'start', 'end'} | {'state': 'refused', 'why'}
  splice_block(current, block) -> {'ok': True, 'action', 'output'} | {'ok': False, 'why'}
  block_changed(before, after) -> bool

A file is bytes, and `None` is no file. Nothing here decodes a file: the markers are ASCII, and every byte outside them is kept as it is."""

BEGIN = b'<!-- record-keeper:begin -->'
END = b'<!-- record-keeper:end -->'
STEMS = (b'record-keeper:begin', b'record-keeper:end')
KINDS = ('managed', 'template', 'block')
WHYS = ('partial-line', 'begin-without-end', 'end-without-begin', 'reversed', 'doubled', 'not-text', 'fence', 'invalid-block')


def fence_of(line):
    """A fence of Markdown at the start of a line: up to three spaces, then three or more backticks or tildes. (mark, count, info) or None."""
    at = 0
    while line[at:at + 1] == b' ':
        at += 1
    if at > 3 or line[at:at + 1] not in (b'`', b'~'):
        return None
    mark = line[at:at + 1]
    count = 0
    while line[at + count:at + count + 1] == mark:
        count += 1
    if count < 3:
        return None
    return mark, count, line[at + count:]


def read_block(data):
    """Where the block is in the bytes of a file (docs/agent-files.md). A marker is a whole line, a carriage return allowed at its end, outside every fenced code block."""
    marks = []
    fence = None
    pos = 0
    while True:
        newline = data.find(b'\n', pos)
        raw = data[pos:] if newline == -1 else data[pos:newline]
        line = raw[:-1] if raw.endswith(b'\r') else raw
        found = fence_of(line)
        if fence is not None:
            if found is not None and found[0] == fence[0] and found[1] >= fence[1] and found[2].strip(b' \t') == b'':
                fence = None
        elif found is not None and not (found[0] == b'`' and b'`' in found[2]):
            fence = found
        elif line == BEGIN:
            marks.append(('B', pos))
        elif line == END:
            marks.append(('E', pos + len(line)))
        elif any(stem in line for stem in STEMS):
            return {'state': 'refused', 'why': 'partial-line'}
        if newline == -1:
            break
        pos = newline + 1
    kinds = ''.join(kind for kind, _ in marks)
    if kinds == '':
        return {'state': 'none', 'fenced': fence is not None}
    if kinds == 'BE':
        return {'state': 'one', 'start': marks[0][1], 'end': marks[1][1]}
    return {'state': 'refused', 'why': {'B': 'begin-without-end', 'E': 'end-without-begin', 'EB': 'reversed'}.get(kinds, 'doubled')}


def block_of(data):
    """The bytes between the markers, the markers included, or None when the file has no block or its markers are refused."""
    found = read_block(data)
    return data[found['start']:found['end']] if found['state'] == 'one' else None


def splice_block(current, block):
    """The file with the block in it, or why not. Outside the markers not a byte changes."""
    own = read_block(block)
    if own['state'] != 'one' or own['start'] != 0 or own['end'] != len(block):
        return {'ok': False, 'why': 'invalid-block'}
    if current is None:
        return {'ok': True, 'action': 'create', 'output': block + b'\n'}
    found = read_block(current)
    if found['state'] == 'refused':
        return {'ok': False, 'why': found['why']}
    if found['state'] == 'one':
        if current[found['start']:found['end']] == block:
            return {'ok': True, 'action': 'current', 'output': current}
        return {'ok': True, 'action': 'replace', 'output': current[:found['start']] + block + current[found['end']:]}
    if b'\x00' in current:
        return {'ok': False, 'why': 'not-text'}
    if found['fenced']:
        return {'ok': False, 'why': 'fence'}
    if current == b'':
        return {'ok': True, 'action': 'append', 'output': block + b'\n'}
    if current.endswith(b'\n\n') or current.endswith(b'\n\r\n'):
        separator = b''
    elif current.endswith(b'\n'):
        separator = b'\n'
    else:
        separator = b'\n\n'
    return {'ok': True, 'action': 'append', 'output': current + separator + block + b'\n'}


def view(data):
    if data is None:
        return ('none', None)
    found = read_block(data)
    if found['state'] == 'none':
        return ('none', None)
    if found['state'] == 'one':
        return ('one', data[found['start']:found['end']])
    return ('refused', data)


def block_changed(before, after):
    """Whether the text that agents read differs between two versions of AGENTS.md: the block, or its markers. Outside them nothing counts."""
    return view(before) != view(after)
