"""Differential fuzz of the block of AGENTS.md (docs/agent-files.md). Usage: agent_fuzz.py <count> <seed> <out.jsonl>
Each scenario is a file and a block, and writes three lines: `read` (where the block is), `splice` (what the file becomes) and `diff` (whether what agents read changed
between the file and another that was made from it by an edit of one of about twenty kinds, or by chance). Each line carries the answer of the Python reference
(agent_ref.py), and agent_compare.mjs asks the Node program the same. The files are not drawn blindly: they are made of lines (text, markers, markers that are damaged
in a dozen ways, fences of every shape, prose that holds the text of a marker, line ends of three kinds, bytes that are not UTF-8, zero bytes) around one block, two blocks,
half a block or none, so that every branch is reached often. The surroundings are random on purpose: the property that the updater must keep is that nothing outside the
markers changes, and it is checked here on every scenario, in the reference. It prints how many scenarios reached each branch."""
import json
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import agent_ref as ref

BEGIN, END = ref.BEGIN, ref.END
EOLS = [b'\n', b'\n', b'\n', b'\r\n', b'\r\n', b'\r']
PROSE = [b'', b'# Notes', b'Build with care.', b'- a list item', b'  indented text', b'\ttabbed', b'trailing space ', b'caf\xc3\xa9 \xe2\x98\x83', b'\xe2\x80\xa8', b'\xff\xfe\x80', b'\x00', b'a\x00b', b'> a quote',
         b'    code', b'| a | b |', b'<!-- a comment -->', b'<!-- record-keeper -->', b'record-keeper', b'Record-Keeper:Begin', b'<!-- Record Keeper:end -->', b'~', b'``', b'~~', b'---', b'\xef\xbb\xbf# bom']
STEM_LINES = [b'see ' + BEGIN + b' here', BEGIN + b' ', b' ' + BEGIN, b'\t' + END, BEGIN + b'x', b'x' + END, b'record-keeper:begin', b'about record-keeper:end', b'<!-- record-keeper:begin  -->',
              b'<!-- record-keeper:begin-->', b'\xef\xbb\xbf' + BEGIN, END + b' <!-- more -->', b'`' + BEGIN + b'`', b'<!--  record-keeper:end -->', b'<!-- record-keeper:endx -->']
FENCES = [b'```', b'~~~', b'````', b'~~~~', b'```markdown', b'~~~ text', b'``` a`b', b'   ```', b'  ~~~', b' ````', b'    ```', b'\t```', b'```  ', b'``', b'~~']
CLOSERS = [b'```', b'~~~', b'````', b'~~~~', b'`````', b'~~~~~', b'   ```', b' ~~~', b'``` ', b'```\t', b'```x', b'~~~ x', b'``', b'    ```']


def pick(r, items):
    return items[r.randrange(len(items))]


def chance(r, p):
    return r.random() < p


def lines_of(r, n, with_stems=False):
    out = []
    for _ in range(n):
        roll = r.random()
        if roll < 0.035:
            out.append(pick(r, FENCES))
        elif roll < 0.07:
            out.append(pick(r, CLOSERS))
        elif with_stems and roll < 0.09:
            out.append(pick(r, STEM_LINES))
        elif roll < 0.10:
            out.append(BEGIN if chance(r, 0.5) else END)
        else:
            out.append(pick(r, PROSE))
    return out


def join(r, lines, mixed=False):
    eol = pick(r, EOLS)
    data = b''
    for line in lines:
        data += line + (pick(r, EOLS) if mixed else eol)
    if lines and chance(r, 0.25):
        data = data[:-len(eol)] if data.endswith(eol) and not mixed else data
    return data


def body(r):
    """The text inside a block, now and then with a fenced example that is closed."""
    rows = [pick(r, [b'rule one', b'rule two', b'- a rule', b'## Heading', b'caf\xc3\xa9', b'', b'text  '] ) for _ in range(r.randint(0, 4))]
    if chance(r, 0.12):
        rows = [b'```', b'example', b'```'] + rows
    if chance(r, 0.05):
        rows.insert(0, pick(r, FENCES))
    return rows


def make_block(r):
    rows = body(r)
    eol = b'\r\n' if chance(r, 0.08) else b'\n'
    block = BEGIN + eol + eol.join(rows) + (eol if rows else b'') + END
    roll = r.random()
    if roll < 0.04:
        return pick(r, [b'', b'no markers', BEGIN + b'\nx', END + b'\nx\n' + BEGIN, BEGIN + b'\nx\n' + END + b'\n', b' ' + BEGIN + b'\nx\n' + END, BEGIN + b'\n' + BEGIN + b'\n' + END,
                        BEGIN + b'\nx ' + END, BEGIN + b'\n```\nx\n' + END, BEGIN + b'\nrecord-keeper:end\nx\n' + END])
    return block


def make_file(r):
    """A file around zero, one or more blocks, with surroundings of every sort."""
    roll = r.random()
    before = join(r, lines_of(r, r.randint(0, 6), with_stems=chance(r, 0.25)), mixed=chance(r, 0.2))
    after = join(r, lines_of(r, r.randint(0, 6), with_stems=chance(r, 0.25)), mixed=chance(r, 0.2))
    eol = pick(r, EOLS)
    if roll < 0.30:
        return before + (b'' if before == b'' or before.endswith((b'\n', b'\r')) else eol) + after
    block = make_block(r)
    inner = block if chance(r, 0.6) else BEGIN + eol + b'old text' + eol + END
    glue = lambda x: (b'' if x == b'' or x.endswith((b'\n', b'\r')) else eol)
    if roll < 0.62:
        return before + glue(before) + inner + (eol + after if after or chance(r, 0.5) else b'')
    if roll < 0.68:
        return before + glue(before) + inner + eol + after + glue(after) + (inner if chance(r, 0.5) else BEGIN + eol + b'second' + eol + END) + eol
    if roll < 0.74:
        return before + glue(before) + BEGIN + eol + b'half a block' + eol + after
    if roll < 0.80:
        return before + glue(before) + END + eol + b'half a block' + eol + after
    if roll < 0.84:
        return before + glue(before) + END + eol + BEGIN + eol + after
    if roll < 0.88:
        return before + glue(before) + BEGIN + eol + BEGIN + eol + b'x' + eol + END + eol + END + eol + after
    if roll < 0.93:
        fence = pick(r, [b'```', b'~~~', b'````'])
        return before + glue(before) + fence + eol + inner + eol + (fence if chance(r, 0.7) else b'') + eol + after
    if roll < 0.96:
        return before + glue(before) + inner + eol + after + glue(after) + pick(r, FENCES) + eol + b'open' + eol
    return before + glue(before) + inner + eol + pick(r, STEM_LINES) + eol + after


def edit(r, data):
    """Another version of a file: an edit of one of about twenty kinds, now and then none."""
    found = ref.read_block(data)
    kind = r.randrange(24)
    if kind == 0:
        return data
    if kind == 1:
        return make_file(r)
    if kind == 2:
        return None
    if kind == 3:
        return data + pick(r, PROSE) + b'\n'
    if kind == 4:
        return pick(r, PROSE) + b'\n' + data
    if kind == 5:
        return data.replace(b'\n', b'\r\n') if b'\r\n' not in data else data.replace(b'\r\n', b'\n')
    if kind == 6:
        return data.replace(b'rule one', b'rule uno').replace(b'old text', b'new text')
    if kind == 7:
        return data.replace(BEGIN, b'')
    if kind == 8:
        return data.replace(END, b'', 1)
    if kind == 9:
        return data.replace(BEGIN, BEGIN + b' ', 1)
    if kind == 10:
        return b'```\n' + data + b'\n```\n'
    if kind == 11:
        return data + b'\n' + pick(r, STEM_LINES) + b'\n'
    if kind == 12 and found['state'] == 'one':
        block = data[found['start']:found['end']]
        rest = data[:found['start']] + data[found['end']:]
        return block + b'\n' + rest if chance(r, 0.5) else rest + b'\n' + block
    if kind == 13 and found['state'] == 'one':
        return data[:found['start']] + data[found['start']:found['end']].replace(b'\n', b'\r\n') + data[found['end']:]
    if kind == 14 and found['state'] == 'one':
        return data[:found['start']] + b'changed' + data[found['end']:]
    if kind == 15 and found['state'] == 'one':
        return data[:found['start']] + data[found['start']:found['end']] + b' ' + data[found['end']:]
    if kind == 16:
        return b''
    if kind == 17:
        return data.replace(b'\n', b'\n\n', 1)
    if kind == 18:
        return b'\xef\xbb\xbf' + data
    if kind == 19:
        return data + b'\x00'
    if kind == 20 and found['state'] == 'one':
        return data[:found['start']] + b'outside ' + pick(r, PROSE) + b'\n' + data[found['start']:]
    if kind == 21 and found['state'] == 'one':
        return data[:found['end']] + b' x' + data[found['end']:]
    if kind == 22:
        return data.replace(b'```', b'~~~')
    return data[:r.randrange(len(data) + 1)]


def scenario(r, hits, out):
    def hit(name):
        hits[name] = hits.get(name, 0) + 1
    current = None if chance(r, 0.03) else make_file(r)
    block = make_block(r)
    read_of = lambda data: ref.read_block(data)
    if current is not None:
        got = read_of(current)
        hit('read ' + got['state'] + (' ' + got['why'] if got['state'] == 'refused' else ' fenced' if got.get('fenced') else ''))
        out.append({'k': 'read', 'in': current.hex(), 'expect': got})
        if b'\r\n' in current and got['state'] == 'one':
            hit('read one in a file with CRLF')
        if b'\r' in current.replace(b'\r\n', b''):
            hit('read in a file with a lone carriage return')
        if got['state'] == 'one' and got['end'] == len(current):
            hit('read one that ends the file')
        if got['state'] == 'one' and got['start'] == 0:
            hit('read one that starts the file')
        if any(f in current for f in (b'```', b'~~~')):
            hit('read in a file with a fence')
    result = ref.splice_block(current, block)
    expect = {'ok': True, 'action': result['action'], 'output': result['output'].hex()} if result['ok'] else result
    out.append({'k': 'splice', 'cur': None if current is None else current.hex(), 'block': block.hex(), 'expect': expect})
    hit('splice ' + (result['action'] if result['ok'] else 'refused ' + result['why']))
    if result['ok']:
        output = result['output']
        # what the updater counts on: the block is found, it is the block, and put in again changes nothing
        found = ref.read_block(output)
        assert found['state'] == 'one' and output[found['start']:found['end']] == block, 'the block is not found in the output'
        assert ref.splice_block(output, block) == {'ok': True, 'action': 'current', 'output': output}, 'a second splice changes something'
        # and not a byte outside the markers changes
        if result['action'] == 'replace':
            old = ref.read_block(current)
            assert output[:found['start']] == current[:old['start']] and output[found['end']:] == current[old['end']:] and found['start'] == old['start'], 'a byte outside the markers changed'
            hit('splice replace with text before and after' if old['start'] > 0 and old['end'] < len(current) else 'splice replace at an edge')
        elif result['action'] == 'append':
            assert output.startswith(current), 'a byte of the file changed'
            tail = output[len(current):]
            hit('splice append with separator %r' % tail[:len(tail) - len(block) - 1])
        elif result['action'] == 'create':
            assert output == block + b'\n'
        else:
            assert output == current
    else:
        hit('refusal does not write')
    other = edit(r, current) if current is not None else (None if chance(r, 0.3) else make_file(r))
    changed = ref.block_changed(current, other)
    out.append({'k': 'diff', 'a': None if current is None else current.hex(), 'b': None if other is None else other.hex(), 'expect': changed})
    views = lambda data: ref.view(data)[0]
    hit('diff %s to %s: %s' % (views(current), views(other), 'changed' if changed else 'same'))
    assert ref.block_changed(other, current) == changed, 'the comparison is not symmetric'
    if current is not None and other is not None and current != other and not changed:
        hit('diff of files that differ, and the same to agents')


def main():
    count, seed, path = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
    r = random.Random(seed)
    hits = {}
    with open(path, 'w') as handle:
        for _ in range(count):
            out = []
            scenario(r, hits, out)
            for line in out:
                handle.write(json.dumps(line) + '\n')
    print(count, 'inputs;', json.dumps(dict(sorted(hits.items()))))


if __name__ == '__main__':
    main()
