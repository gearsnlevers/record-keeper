// The block of AGENTS.md (docs/agent-files.md): where it is, what a file becomes when a block is put into it, and whether the text that agents read changed. The fixtures
// of test/fixtures/agent give the answers, and the tests below state the rules one by one: above all that nothing outside the two markers is ever written, because the
// updater writes into a file that the maintainers own.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BLOCK_BEGIN, BLOCK_END, blockChanged, blockOf, readBlock, spliceBlock } from '../updater.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { block: BLOCK_TEXT, reads, splices, diffs } = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/agent/cases.json'), 'utf8'));
const page = fs.readFileSync(path.join(root, 'docs/agent-files.md'), 'utf8');

/** A file as the fixtures write it: a text, or {hex}, or null. */
const bytesOf = (value) => (value === null ? null : typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value.hex, 'hex'));
const BLOCK = Buffer.from(BLOCK_TEXT, 'utf8');
const WHYS = ['partial-line', 'begin-without-end', 'end-without-begin', 'reversed', 'doubled', 'not-text', 'fence', 'invalid-block'];

describe('the fixtures', () => {
  for (const c of reads) {
    test(`${c.id}: ${c.note}`, () => assert.deepEqual(readBlock(bytesOf(c.input)), c.expect));
  }
  for (const c of splices) {
    test(`${c.id}: ${c.note}`, () => {
      const got = spliceBlock(bytesOf(c.current), bytesOf(c.block));
      const want = c.expect.ok ? { ok: true, action: c.expect.action, output: bytesOf(c.expect.output) } : c.expect;
      assert.deepEqual(got, want);
    });
  }
  for (const c of diffs) {
    test(`${c.id}: ${c.note}`, () => assert.equal(blockChanged(bytesOf(c.before), bytesOf(c.after)), c.expect));
  }

  test('the ids are unique, every case says what it shows, and the block of the fixtures is the block of a release in form', () => {
    const ids = [...reads, ...splices, ...diffs].map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const c of [...reads, ...splices, ...diffs]) assert.ok(c.note.length > 10, c.id);
    assert.deepEqual(readBlock(BLOCK), { state: 'one', start: 0, end: BLOCK.length });
  });

  test('every state, every action and every reason is shown by a case, and the page lists each reason', () => {
    assert.deepEqual([...new Set(reads.map((c) => c.expect.state))].sort(), ['none', 'one', 'refused']);
    assert.deepEqual([...new Set(splices.filter((c) => c.expect.ok).map((c) => c.expect.action))].sort(), ['append', 'create', 'current', 'replace']);
    const reasons = new Set([...reads.filter((c) => c.expect.why).map((c) => c.expect.why), ...splices.filter((c) => !c.expect.ok).map((c) => c.expect.why)]);
    assert.deepEqual(WHYS.filter((why) => !reasons.has(why)), []);
    for (const why of WHYS) assert.ok(page.includes(`\`${why}\``), `the page does not list ${why}`);
    assert.ok(reads.some((c) => c.expect.fenced === true) && reads.some((c) => c.expect.fenced === false));
    assert.ok(diffs.some((c) => c.expect === true) && diffs.some((c) => c.expect === false));
  });

  test('a function does not change what it is given', () => {
    for (const c of splices) {
      const current = bytesOf(c.current);
      const copy = current === null ? null : Buffer.from(current);
      const block = bytesOf(c.block);
      spliceBlock(current, block);
      assert.deepEqual(current, copy, c.id);
      assert.deepEqual(block, bytesOf(c.block), c.id);
    }
  });
});

describe('what the splice guarantees', () => {
  test('a block that was put in is found, is the block, and put in again changes nothing', () => {
    for (const c of splices.filter((item) => item.expect.ok)) {
      const out = bytesOf(c.expect.output);
      const found = readBlock(out);
      assert.equal(found.state, 'one', c.id);
      assert.deepEqual(out.subarray(found.start, found.end), bytesOf(c.block), c.id);
      assert.deepEqual(blockOf(out), bytesOf(c.block), c.id);
      assert.deepEqual(spliceBlock(out, bytesOf(c.block)), { ok: true, action: 'current', output: out }, c.id);
    }
  });

  test('only the bytes between the markers change: what stands before them and after them is the same byte for byte, whatever it holds', () => {
    // A small generator of files of every sort of text: it needs no randomness of the machine, so a failure is the same on every run.
    let seed = 12345;
    const next = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.floor(seed / 65536) % n;
    };
    const pieces = ['# Mine\n', 'text  \n', '\r\n', '\n', '\t\n', ' \n', 'café ☃\n', ' \n', '- list item\n', '```\n', '~~~~\n', '    code\n', 'see `<!-- record-keeper:end -->`\n', '\x00\n', 'no end of line'];
    const bytes = [(n) => Buffer.from(pieces[n % pieces.length], 'utf8'), () => Buffer.from([0xff, 0xfe, 0x80, 0x0a])];
    const OTHER = Buffer.from(`${BLOCK_BEGIN}\nold text\n${BLOCK_END}`);
    let spliced = 0;
    for (let n = 0; n < 4000; n++) {
      const part = () => Buffer.concat(Array.from({ length: next(5) }, () => bytes[next(10) === 0 ? 1 : 0](next(100))));
      const [before, after] = [part(), part()];
      const file = Buffer.concat([before, next(3) === 0 ? Buffer.alloc(0) : OTHER, after]);
      const got = spliceBlock(file, BLOCK);
      if (!got.ok) continue;
      spliced++;
      if (got.action === 'append') {
        assert.deepEqual(got.output.subarray(0, file.length), file);
        assert.ok(['', '\n', '\n\n'].some((separator) => got.output.subarray(file.length).equals(Buffer.from(`${separator}${BLOCK_TEXT}\n`))));
      } else if (got.action === 'replace') {
        const found = readBlock(file);
        assert.deepEqual(got.output.subarray(0, found.start), file.subarray(0, found.start));
        assert.deepEqual(got.output.subarray(got.output.length - (file.length - found.end)), file.subarray(found.end));
        assert.deepEqual(got.output.subarray(found.start, got.output.length - (file.length - found.end)), BLOCK);
      }
      const again = spliceBlock(got.output, BLOCK);
      assert.equal(again.ok && again.action, 'current');
      assert.deepEqual(again.output, got.output);
    }
    assert.ok(spliced > 1000, `only ${spliced} of 4000 files were spliced`);
  });

  test('the appended text is a blank line, the block and a line feed, and a file that has a block never gets a second one', () => {
    for (const file of ['', 'a', 'a\n', 'a\n\n', 'a\r\n', 'a\r\n\r\n', '\n']) {
      const out = spliceBlock(Buffer.from(file), BLOCK).output;
      const tail = out.subarray(file.length).toString();
      assert.ok(tail === `${BLOCK_TEXT}\n` || tail === `\n${BLOCK_TEXT}\n` || tail === `\n\n${BLOCK_TEXT}\n`, JSON.stringify(file));
      assert.equal(readBlock(out).state, 'one');
    }
    const once = spliceBlock(Buffer.from('a\n'), BLOCK).output;
    assert.equal(spliceBlock(once, BLOCK).action, 'current');
    assert.equal(once.toString().split(BLOCK_BEGIN).length - 1, 1);
  });

  test('the block put in must be one begin marker, text and one end marker', () => {
    const bad = ['', 'x', `${BLOCK_BEGIN}\nx`, `${BLOCK_END}\nx\n${BLOCK_BEGIN}`, `${BLOCK_BEGIN}\nx\n${BLOCK_END}\n`, ` ${BLOCK_BEGIN}\nx\n${BLOCK_END}`, `${BLOCK_BEGIN}\nx ${BLOCK_END}`, `${BLOCK_BEGIN}\n${BLOCK_BEGIN}\n${BLOCK_END}`];
    for (const text of bad) assert.deepEqual(spliceBlock(Buffer.from('a\n'), Buffer.from(text)), { ok: false, why: 'invalid-block' }, JSON.stringify(text));
    assert.deepEqual(spliceBlock(null, Buffer.from('x')), { ok: false, why: 'invalid-block' });
  });
});

describe('what the comparison guarantees', () => {
  test('a change outside the markers is nothing, and a change of the block or of the markers is a change', () => {
    const file = (before, inside, after) => Buffer.from(`${before}${BLOCK_BEGIN}\n${inside}\n${BLOCK_END}${after}`);
    assert.equal(blockChanged(file('a\n', 'x', '\nb\n'), file('A\n', 'x', '\nB\n')), false);
    assert.equal(blockChanged(file('a\n', 'x', '\nb\n'), file('a\n', 'y', '\nb\n')), true);
    assert.equal(blockChanged(file('a\n', 'x', '\n'), Buffer.from(`a\n${BLOCK_BEGIN}\nx\n`)), true);
    assert.equal(blockChanged(file('', 'x', ''), file('', 'x', '')), false);
  });

  test('the same text is never a change, with or without a block, and a missing file is the same as a file with no block', () => {
    for (const text of ['', 'a\n', `${BLOCK_BEGIN}\nx\n${BLOCK_END}\n`, `${BLOCK_BEGIN}\nx\n`, '```\nopen\n']) {
      assert.equal(blockChanged(Buffer.from(text), Buffer.from(text)), false, JSON.stringify(text));
    }
    assert.equal(blockChanged(null, null), false);
    assert.equal(blockChanged(null, Buffer.from('')), false);
    assert.equal(blockChanged(Buffer.from(''), null), false);
  });

  test('the comparison is symmetric', () => {
    const files = [null, Buffer.from(''), Buffer.from('a\n'), Buffer.from(`${BLOCK_BEGIN}\nx\n${BLOCK_END}\n`), Buffer.from(`${BLOCK_BEGIN}\ny\n${BLOCK_END}\n`), Buffer.from(`${BLOCK_BEGIN}\n`), Buffer.from(`b\n${BLOCK_BEGIN}\n`)];
    for (const x of files) for (const y of files) assert.equal(blockChanged(x, y), blockChanged(y, x));
  });
});
