// `seal --adopt`: the first sealing of the records that existed before the kit (docs/install.md). What it adds to a record, what it leaves alone and lists, what it
// prints and what it writes, on records built here and on the vectors of g1, and on the fixtures that a second implementation made (test/fixtures/adopt).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { RULES, adopt, adoptRecord, run, seal, validate, verify } from '../record-keeper.mjs';

const script = fileURLToPath(new URL('../record-keeper.mjs', import.meta.url));
const vectorsDir = new URL('./vectors/g1/', import.meta.url);
const vectors = JSON.parse(fs.readFileSync(new URL('vectors.json', vectorsDir), 'utf8')).vectors;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'record-keeper-adopt-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

// The key order of the template of a record (templates/decisions/template.md), and a body with the three required sections.
const TEMPLATE_FRONT = ['status: accepted', 'date: 2026-11-01', 'decision-makers:', '  - maintainers', 'applies-to:', '  - src/**', 'issues:', '  - owner/repo#1'];
const BODY = ['', '# A rule', '', '## Context and problem statement', '', 'Why.', '', '## Decision', '', '- Do it.', '', '## Consequences', '', '- Done.'];
const record = (front = TEMPLATE_FRONT, body = BODY, eol = '\n', end = eol) => `${['---', ...front, '---', ...body].join(eol)}${end}`;
const SEAL_OF = /^sha256-g1:[0-9a-f]{64}$/;

/** The record without the line that adoption added at `at`: the bytes that were there before. */
const without = (sealed, bytes) => {
  const at = sealed.indexOf(Buffer.from('seal: sha256-g1:'));
  const eol = sealed.indexOf(0x0a, at) + 1;
  return Buffer.concat([sealed.subarray(0, at), sealed.subarray(eol)]).equals(bytes);
};

describe('adoptRecord: the seal line is the only thing that is added', () => {
  test('the line is the last line of the front matter, and the rest of the record is the bytes that were there', () => {
    for (const status of ['accepted', 'superseded by 0007']) {
      const bytes = Buffer.from(record(['status: ' + status, ...TEMPLATE_FRONT.slice(1)]));
      const result = adoptRecord(bytes);
      assert.equal(result.state, 'seal', status);
      const text = result.bytes.toString();
      assert.equal(text, bytes.toString().replace('\n---\n\n# A rule', `\nseal: ${seal(bytes)}\n---\n\n# A rule`), status);
      assert.ok(without(result.bytes, bytes), status);
      assert.deepEqual(verify(result.bytes), { ok: true, seal: seal(bytes) }, status);
      assert.match(seal(bytes), SEAL_OF);
    }
  });

  test('the seal is the one that `seal <file>` prints, and it does not depend on where the line stands', () => {
    const bytes = Buffer.from(record());
    const { bytes: sealed } = adoptRecord(bytes);
    assert.equal(seal(sealed), seal(bytes));
    const first = Buffer.from(sealed.toString().replace(/^seal: .*\n/m, '').replace('---\n', `---\nseal: ${seal(bytes)}\n`));
    assert.equal(seal(first), seal(bytes));
    assert.ok(verify(first).ok);
  });

  test('does not change the bytes it is given', () => {
    const bytes = Buffer.from(record());
    const copy = Buffer.from(bytes);
    adoptRecord(bytes);
    assert.ok(bytes.equals(copy));
  });

  test('a front matter that ends in a list, and in a key with a value, gets the line after the last of them', () => {
    for (const front of [TEMPLATE_FRONT, ['status: accepted', 'date: 2026-11-01', 'decision-makers:', '  - a', '  - b'], ['status: accepted', 'repos:', '  - a', 'date: 2026-11-01', 'decision-makers:', '  - a', 'emergency: no'], ['status: accepted']]) {
      const bytes = Buffer.from(record(front));
      const { state, bytes: sealed } = adoptRecord(bytes);
      assert.equal(state, 'seal', front.join('|'));
      const lines = sealed.toString().split('\n');
      assert.equal(lines.indexOf('---', 1) - 1, lines.findIndex((line) => line.startsWith('seal: ')), 'the seal line is the last of the front matter');
      assert.equal(lines.filter((line) => line.startsWith('seal: ')).length, 1);
      assert.ok(without(sealed, bytes));
    }
  });

  test('CRLF: the line ends as the line before it ends, and every other byte is as it was', () => {
    const bytes = Buffer.from(record(TEMPLATE_FRONT, BODY, '\r\n'));
    const { state, bytes: sealed } = adoptRecord(bytes);
    assert.equal(state, 'seal');
    assert.ok(sealed.toString().includes(`\r\nseal: ${seal(bytes)}\r\n---\r\n`));
    assert.equal(sealed.toString().replaceAll('\r\n', '').includes('\n'), false, 'no bare line feed was added');
    assert.ok(without(sealed, bytes));
    assert.equal(seal(bytes), seal(Buffer.from(record())), 'the seal does not see the line endings');
  });

  test('mixed line endings: the new line ends as the line before it, and nothing else changes', () => {
    const lf = Buffer.from(['---', 'status: accepted', 'date: 2026-11-01', 'decision-makers:', '  - a', '---', ...BODY].join('\n') + '\n');
    const crlfBefore = Buffer.from(lf.toString().replace('  - a\n', '  - a\r\n'));
    for (const [bytes, eol] of [[crlfBefore, '\r\n'], [lf, '\n']]) {
      const { state, bytes: sealed } = adoptRecord(bytes);
      assert.equal(state, 'seal');
      assert.ok(sealed.toString().includes(`  - a${eol}seal: ${seal(bytes)}${eol}---\n`));
      assert.ok(without(sealed, bytes));
    }
  });

  test('no final newline, trailing white space, extra blank lines at the end: all kept', () => {
    for (const end of ['', '\n\n\n', '  \n\t\n', ' ']) {
      const bytes = Buffer.from(record(TEMPLATE_FRONT, [...BODY, 'Trailing space here. '], '\n', end));
      const { state, bytes: sealed } = adoptRecord(bytes);
      assert.equal(state, 'seal', JSON.stringify(end));
      assert.ok(without(sealed, bytes), JSON.stringify(end));
      assert.ok(verify(sealed).ok, JSON.stringify(end));
    }
    const bare = Buffer.from('---\nstatus: accepted\n---');
    const { state, bytes: sealed } = adoptRecord(bare);
    assert.equal(state, 'seal');
    assert.equal(sealed.toString(), `---\nstatus: accepted\nseal: ${seal(bare)}\n---`);
  });

  test('white space after the delimiters and after the values is kept', () => {
    const bytes = Buffer.from('--- \nstatus: accepted \ndate: 2026-11-01\t\ndecision-makers:  \n  - a  \n--- \n\n# T\n');
    const { state, bytes: sealed } = adoptRecord(bytes);
    assert.equal(state, 'seal');
    assert.equal(sealed.toString(), `--- \nstatus: accepted \ndate: 2026-11-01\t\ndecision-makers:  \n  - a  \nseal: ${seal(bytes)}\n--- \n\n# T\n`);
  });

  test('a record with Known deviations and Errata sections is sealed as its text before them, and they stay', () => {
    const body = [...BODY, '', '## Known deviations', '', '- A note.', '', '## Errata', '', 'None yet.'];
    const bytes = Buffer.from(record(TEMPLATE_FRONT, body));
    const { state, bytes: sealed } = adoptRecord(bytes);
    assert.equal(state, 'seal');
    assert.equal(seal(sealed), seal(Buffer.from(record(TEMPLATE_FRONT, BODY))));
    assert.ok(without(sealed, bytes));
  });

  test('non-ASCII text is kept byte for byte', () => {
    const bytes = Buffer.from(record(['status: accepted', 'decision-makers:', '  - Zoë'], [...BODY, '', 'Ünïcödé ☃ 😀 and a no-break space ( ).']));
    const { bytes: sealed } = adoptRecord(bytes);
    assert.ok(without(sealed, bytes));
    assert.ok(verify(sealed).ok);
  });
});

describe('adoptRecord: what it leaves alone', () => {
  test('a status that is not accepted and not superseded is skipped, and says which', () => {
    const rest = TEMPLATE_FRONT.slice(1);
    for (const [status, why] of [['proposed', 'status proposed'], ['rejected', 'status rejected'], ['deprecated', 'status deprecated'], ['Accepted', 'status Accepted'], ['accepted # note', 'status accepted # note'],
      ['superseded by 12', 'status superseded by 12'], ['superseded', 'status superseded'], ['superseded  by 0012', 'status superseded  by 0012'], ['wip', 'status wip']]) {
      assert.deepEqual(adoptRecord(Buffer.from(record([`status: ${status}`, ...rest]))), { state: 'skip', why }, status);
    }
    assert.deepEqual(adoptRecord(Buffer.from(record(['date: 2026-11-01', 'decision-makers:', '  - a']))), { state: 'skip', why: 'no status' });
    assert.deepEqual(adoptRecord(Buffer.from(record(['date: 2026-11-01'], [...BODY, 'status: accepted']))), { state: 'skip', why: 'no status' }, 'a line of the body is not a key');
  });

  test('white space after the status is not part of it', () => {
    for (const status of ['accepted ', 'accepted\t', 'superseded by 0012 ', '  accepted']) {
      assert.equal(adoptRecord(Buffer.from(record([`status: ${status}`, ...TEMPLATE_FRONT.slice(1)]))).state, 'seal', JSON.stringify(status));
    }
  });

  test('a record with a seal line is left alone, whatever the seal is, and whatever the text is', () => {
    const bytes = Buffer.from(record());
    const good = seal(bytes);
    const other = seal(Buffer.from(record(TEMPLATE_FRONT, [...BODY, 'Another.'])));
    for (const value of [good, other, 'sha256-g1:abc', 'trust me', 'sha256-g2:' + 'a'.repeat(64), good.toUpperCase(), `${good} extra`, 'x']) {
      assert.deepEqual(adoptRecord(Buffer.from(record([...TEMPLATE_FRONT, `seal: ${value}`]))), { state: 'has-seal' }, value);
      assert.deepEqual(adoptRecord(Buffer.from(record([`seal: ${value}`, ...TEMPLATE_FRONT]))), { state: 'has-seal' }, value);
    }
    assert.deepEqual(adoptRecord(Buffer.from(record(['status: superseded by 0009', `seal: ${good}`, 'date: 2026-11-01', 'decision-makers:', '  - a']))), { state: 'has-seal' });
  });

  test('a proposed record with a seal line is skipped for its status, not listed as sealed', () => {
    assert.deepEqual(adoptRecord(Buffer.from(record(['status: proposed', `seal: ${seal(Buffer.from(record()))}`]))), { state: 'skip', why: 'status proposed' });
  });

  test('a record that g1 rejects is listed with the rule, whatever its status', () => {
    const cases = [
      ['a comment', record(TEMPLATE_FRONT, [...BODY, '<!-- a note -->']), 'G1-06'],
      ['a byte order mark', '﻿' + record(), 'G1-02'],
      ['no front matter', '# A rule\n\nText.\n', 'G1-07'],
      ['a front matter that is not closed', '---\nstatus: accepted\n\n# A rule\n', 'G1-08'],
      ['a line that is no key', record([...TEMPLATE_FRONT, 'no key here']), 'G1-09'],
      ['a lone carriage return', record(TEMPLATE_FRONT, [...BODY, 'a\rb']), 'G1-05'],
      ['Seal with a capital', record([...TEMPLATE_FRONT, 'Seal: x']), 'G1-11'],
      ['a seal with no value', record([...TEMPLATE_FRONT, 'seal:']), 'G1-12'],
      ['a key twice', record([...TEMPLATE_FRONT, 'date: 2026-11-02']), 'G1-10'],
      ['an unclosed fence', record(TEMPLATE_FRONT, [...BODY, '```', 'code']), 'G1-15'],
      ['html', record(TEMPLATE_FRONT, [...BODY, '<div>x</div>']), 'G1-16'],
    ];
    for (const [name, text, rule] of cases) {
      assert.deepEqual(adoptRecord(Buffer.from(text)), { state: 'cannot', rule, why: RULES[rule] }, name);
      assert.deepEqual(adoptRecord(Buffer.from(text.replace('status: accepted', 'status: proposed'))), { state: 'cannot', rule, why: RULES[rule] }, `${name}, proposed: the rule is read before the status`);
    }
    assert.deepEqual(adoptRecord(Buffer.from([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0x0a])), { state: 'cannot', rule: 'G1-01', why: RULES['G1-01'] });
    assert.deepEqual(adoptRecord(Buffer.alloc(0)), { state: 'cannot', rule: 'G1-07', why: RULES['G1-07'] });
  });

  test('a record that is one line short of the length V-10 allows is sealed, and one that is at it is listed under V-10 and left as it is', () => {
    const lines = (n) => [...BODY.slice(0, 3), 'Why.', '', '## Decision', '', '- Do it.', '', '## Consequences', '', ...Array.from({ length: n }, (_, i) => `- Done ${i}.`)];
    const front = ['status: accepted', 'date: 2026-11-01', 'decision-makers:', '  - a'];
    const total = (n) => 2 + front.length + lines(n).length; // the two delimiters, the front matter and the body, as validate counts them
    const fill = 60 - total(0);
    const at = (n) => Buffer.from(record(front, lines(n)));
    assert.equal(adoptRecord(at(fill - 1)).state, 'seal', '59 lines become 60');
    assert.deepEqual(adoptRecord(at(fill)), { state: 'cannot', rule: 'V-10', why: 'the seal line would make the record longer than 60 lines' }, '60 lines would become 61');
    assert.equal(adoptRecord(at(fill + 1)).state, 'seal', 'a record that is too long already has the problem, and the line adds none');
    assert.equal(adoptRecord(Buffer.concat([at(fill - 1), Buffer.from('\n')])).state, 'cannot', 'an empty line at the end is a line');
    assert.equal(adoptRecord(Buffer.concat([at(fill - 2), Buffer.from('\n')])).state, 'seal');
  });

  test('a placement that changes another byte, or that does not make a seal that verifies, is listed and not used', () => {
    const bytes = Buffer.from(record());
    const wrong = 'the seal line cannot be added without changing another byte of the record';
    const insert = (at, text, drop = 0) => ({ bytes: Buffer.concat([bytes.subarray(0, at), Buffer.from(text), bytes.subarray(at + drop)]), at, added: Buffer.from(text) });
    const front = bytes.indexOf('---\n\n# A rule');
    const places = {
      'the line in the body': (b, end, value) => insert(b.indexOf('# A rule'), `seal: ${value}\n`),
      'a changed byte next to the line': (b, end, value) => insert(front, `seal: ${value}\n`, 1),
      'a line that is not a seal': (b, end, value) => insert(front, `sealed: ${value}\n`),
      'a final newline that the placement drops, which g1 does not see': (b, end, value) => ({ ...insert(front, `seal: ${value}\n`), bytes: Buffer.concat([b.subarray(0, front), Buffer.from(`seal: ${value}\n`), b.subarray(front, b.length - 1)]) }),
      'a seal of another record': () => insert(front, `seal: sha256-g1:${'0'.repeat(64)}\n`),
    };
    for (const [name, place] of Object.entries(places)) assert.deepEqual(adoptRecord(bytes, place), { state: 'cannot', rule: null, why: wrong }, name);
    assert.equal(adoptRecord(bytes, (b, end, value) => insert(front, `seal: ${value}\n`)).state, 'seal');
  });
});

describe('adoptRecord on the vectors of g1', () => {
  const bytesOf = (vector) => fs.readFileSync(new URL(vector.file, vectorsDir));

  test('a record that a rule rejects is listed under that rule, for every vector that a rule rejects', () => {
    for (const vector of vectors.filter((v) => v.result === 'reject')) {
      assert.deepEqual(adoptRecord(bytesOf(vector)), { state: 'cannot', rule: vector.rule, why: RULES[vector.rule] }, vector.id);
    }
  });

  test('a record that is sealed gets exactly the seal that the vector says, and every other byte of it stays', () => {
    const states = new Map();
    for (const vector of vectors.filter((v) => v.result === 'seal')) {
      const bytes = bytesOf(vector);
      // Most vectors are proposed records: the same record with the status accepted has the same seal, because the seal does not cover the status.
      const accepted = Buffer.from(bytes.toString('latin1').replace(/^status: proposed/m, 'status: accepted'), 'latin1');
      for (const [text, input] of [['as it is', bytes], ['accepted', accepted]]) {
        const result = adoptRecord(input);
        states.set(`${text}: ${result.state}`, (states.get(`${text}: ${result.state}`) ?? 0) + 1);
        if (result.state !== 'seal') {
          assert.ok(['skip', 'has-seal'].includes(result.state) || result.rule === 'V-10', `${vector.id} ${text}: only the status, a seal line and the length can stop a record that g1 accepts`);
          continue;
        }
        assert.ok(without(result.bytes, input), `${vector.id} ${text}`);
        assert.deepEqual(verify(result.bytes), { ok: true, seal: vector.seal }, `${vector.id} ${text}`);
      }
    }
    assert.ok((states.get('accepted: seal') ?? 0) >= 60, JSON.stringify([...states]));
  });
});

// ---- a folder on disk ---------------------------------------------------------------------------------------------------------------------------

let counter = 0;
/** A records folder with README.md, template.md and `files` (name to text or bytes), and the folder around it. */
function folderWith(files, { links = [] } = {}) {
  const base = path.join(scratch, `case-${(counter += 1)}`);
  const dir = path.join(base, 'docs/decisions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Decisions\n\n## Index\n\n| # | Title | Status |\n| - | - | - |\n');
  fs.writeFileSync(path.join(dir, 'template.md'), '# Template\n');
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  for (const { name, target } of links) fs.symlinkSync(target, path.join(dir, name));
  return { base, dir };
}

/** Every file of a folder, with its bytes and its modification time: a change of either shows. */
function snapshot(dir) {
  return fs.readdirSync(dir, { recursive: true }).sort().map((name) => {
    const full = path.join(dir, name);
    const stat = fs.lstatSync(full);
    return `${name} ${stat.isFile() ? `${fs.readFileSync(full).toString('hex')} ${stat.mtimeMs} ${stat.mode}` : stat.isSymbolicLink() ? `-> ${fs.readlinkSync(full)}` : 'dir'}`;
  }).join('\n');
}

const OLD = record(['status: accepted', 'date: 2026-10-01', 'decision-makers:', '  - maintainers']);
const SUPERSEDED = record(['status: superseded by 0006', 'date: 2026-10-02', 'decision-makers:', '  - maintainers']);
const NEW = record(['status: proposed', 'date: 2026-11-01', 'decision-makers:', '  - maintainers']);
const bytesOfText = (text) => Buffer.from(text);
const sealedAlready = record(['status: accepted', 'date: 2026-10-03', 'decision-makers:', '  - maintainers', `seal: ${seal(bytesOfText(OLD))}`]);

describe('seal --adopt: a dry run', () => {
  const { dir } = folderWith({
    '0001-first-rule.md': OLD, '0002-second-rule.md': SUPERSEDED, '0003-third-rule.md': sealedAlready, '0004-fourth-rule.md': NEW,
    '0005-fifth-rule.md': record(TEMPLATE_FRONT, [...BODY, '<!-- no -->']), '0006-sixth-rule.md': record(['status: rejected', 'date: 2026-10-01', 'decision-makers:', '  - a']),
  });
  const before = snapshot(dir);
  const result = run(['seal', '--adopt', dir]);

  test('says what it would do, record by record, in name order, and counts', () => {
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, [
      `${dir}/0001-first-rule.md: would seal`,
      `${dir}/0002-second-rule.md: would seal`,
      `${dir}/0003-third-rule.md: already has a seal`,
      `${dir}/0004-fourth-rule.md: skipped (status proposed)`,
      `${dir}/0005-fifth-rule.md: cannot seal (G1-06: the text contains <!--)`,
      `${dir}/0006-sixth-rule.md: skipped (status rejected)`,
      `${dir}: 2 would be sealed, 1 has a seal, 2 skipped, 1 cannot be sealed`,
      'dry run: nothing was written; run it again with --write to add the seal lines',
      '',
    ].join('\n'));
  });

  test('writes nothing: no byte, no modification time, no file', () => {
    assert.equal(snapshot(dir), before);
  });

  test('is the default: no option makes it write', () => {
    const copy = folderWith({ '0001-first-rule.md': OLD });
    const got = run(['seal', '--adopt', copy.dir]);
    assert.deepEqual([got.code, got.stdout.split('\n').slice(0, 1).join()], [0, `${copy.dir}/0001-first-rule.md: would seal`]);
    assert.equal(fs.readFileSync(path.join(copy.dir, '0001-first-rule.md'), 'utf8'), OLD);
  });
});

describe('seal --adopt --write', () => {
  const files = {
    '0001-first-rule.md': OLD, '0002-second-rule.md': SUPERSEDED, '0003-third-rule.md': sealedAlready, '0004-fourth-rule.md': NEW,
    '0005-fifth-rule.md': record(TEMPLATE_FRONT, [...BODY, '<!-- no -->']), '0006-sixth-rule.md': record(['status: rejected', 'date: 2026-10-01', 'decision-makers:', '  - a']),
    '0007-crlf.md': record(['status: accepted', 'date: 2026-10-01', 'decision-makers:', '  - a'], BODY, '\r\n'),
    '0008-no-final-newline.md': record(['status: accepted', 'date: 2026-10-01', 'decision-makers:', '  - a'], BODY, '\n', ''),
    '0009-template-order.md': record(TEMPLATE_FRONT),
  };
  const { dir } = folderWith(files);
  const before = Object.fromEntries(fs.readdirSync(dir).map((name) => [name, { bytes: fs.readFileSync(path.join(dir, name)), mtime: fs.statSync(path.join(dir, name)).mtimeMs }]));
  const result = run(['seal', '--adopt', dir, '--write']);
  const after = Object.fromEntries(fs.readdirSync(dir).map((name) => [name, { bytes: fs.readFileSync(path.join(dir, name)), mtime: fs.statSync(path.join(dir, name)).mtimeMs }]));
  const sealedNames = ['0001-first-rule.md', '0002-second-rule.md', '0007-crlf.md', '0008-no-final-newline.md', '0009-template-order.md'];

  test('seals exactly the accepted and superseded records that have no seal line, and says so', () => {
    assert.equal(result.code, 1, 'the record that g1 rejects is still there');
    assert.equal(result.stderr, [
      `${dir}/0001-first-rule.md: sealed`,
      `${dir}/0002-second-rule.md: sealed`,
      `${dir}/0003-third-rule.md: already has a seal`,
      `${dir}/0004-fourth-rule.md: skipped (status proposed)`,
      `${dir}/0005-fifth-rule.md: cannot seal (G1-06: the text contains <!--)`,
      `${dir}/0006-sixth-rule.md: skipped (status rejected)`,
      `${dir}/0007-crlf.md: sealed`,
      `${dir}/0008-no-final-newline.md: sealed`,
      `${dir}/0009-template-order.md: sealed`,
      `${dir}: 5 sealed, 1 has a seal, 2 skipped, 1 cannot be sealed`,
      '',
    ].join('\n'));
    for (const name of Object.keys(before)) assert.equal(before[name].bytes.equals(after[name].bytes), !sealedNames.includes(name), name);
  });

  test('leaves every other file as it was: the bytes and the modification time', () => {
    for (const name of Object.keys(before)) if (!sealedNames.includes(name)) assert.deepEqual(after[name], before[name], name);
  });

  test('every other byte of a sealed record is as it was, line endings, the missing final newline and the order of the keys included', () => {
    for (const name of sealedNames) assert.ok(without(after[name].bytes, before[name].bytes), name);
    assert.ok(after['0007-crlf.md'].bytes.toString().includes(`\r\nseal: ${seal(before['0007-crlf.md'].bytes)}\r\n---\r\n`));
    assert.ok(!after['0008-no-final-newline.md'].bytes.toString().endsWith('\n'));
    assert.ok(after['0009-template-order.md'].bytes.toString().includes('  - owner/repo#1\nseal: sha256-g1:'));
  });

  test('the seal of every record that was written verifies, with `seal --verify`', () => {
    for (const name of sealedNames) {
      assert.deepEqual(run(['seal', '--verify', path.join(dir, name)]), { code: 0, stdout: `${path.join(dir, name)}: the seal verifies\n`, stderr: '' }, name);
    }
    const viaProgram = spawnSync(process.execPath, [script, 'seal', '--verify', path.join(dir, sealedNames[0])], { encoding: 'utf8' });
    assert.equal(viaProgram.status, 0);
  });

  test('is idempotent: a second run says "already has a seal" for each and changes nothing', () => {
    const state = snapshot(dir);
    const again = run(['seal', '--adopt', dir, '--write']);
    assert.equal(snapshot(dir), state);
    assert.equal(again.code, 1);
    assert.match(again.stderr, /0001-first-rule\.md: already has a seal\n/);
    assert.match(again.stderr, new RegExp(`${dir.replaceAll('/', '\\/')}: 0 sealed, 6 have a seal, 2 skipped, 1 cannot be sealed\\n$`));
  });

  test('a folder with nothing left to seal exits 0', () => {
    const copy = folderWith({ '0001-first-rule.md': OLD, '0002-second-rule.md': NEW });
    assert.equal(run(['seal', '--adopt', copy.dir, '--write']).code, 0);
    const second = run(['seal', '--adopt', copy.dir, '--write']);
    assert.deepEqual(second, { code: 0, stdout: `${copy.dir}/0001-first-rule.md: already has a seal\n${copy.dir}/0002-second-rule.md: skipped (status proposed)\n${copy.dir}: 0 sealed, 1 has a seal, 1 skipped, 0 cannot be sealed\n`, stderr: '' });
  });

  test('keeps the mode of the file', () => {
    const copy = folderWith({ '0001-first-rule.md': OLD });
    const file = path.join(copy.dir, '0001-first-rule.md');
    fs.chmodSync(file, 0o640);
    run(['seal', '--adopt', copy.dir, '--write']);
    assert.equal(fs.statSync(file).mode & 0o777, 0o640);
  });

  test('says what it wrote when it cannot write, and exits 2', () => {
    const copy = folderWith({ '0001-first-rule.md': OLD, '0002-second-rule.md': OLD });
    const written = [];
    const writeFile = (file, bytes) => {
      if (file.endsWith('0002-second-rule.md')) throw new Error('EACCES: permission denied');
      written.push(file);
      fs.writeFileSync(file, bytes);
    };
    const got = run(['seal', '--adopt', copy.dir, '--write'], { writeFile });
    assert.equal(got.code, 2);
    assert.equal(got.stdout, '');
    assert.equal(got.stderr, `${copy.dir}/0001-first-rule.md: sealed\nrecord-keeper: cannot write ${copy.dir}/0002-second-rule.md: EACCES: permission denied\n`);
    assert.deepEqual(written, [path.join(copy.dir, '0001-first-rule.md')]);
  });

  test('does not write on a dry run, even when a writer is given', () => {
    const copy = folderWith({ '0001-first-rule.md': OLD });
    run(['seal', '--adopt', copy.dir], { writeFile: () => assert.fail('written') });
  });
});

describe('seal --adopt: what is not a record', () => {
  test('a symbolic link is never read and never written, and its target is untouched', () => {
    const outside = path.join(scratch, 'outside.md');
    fs.writeFileSync(outside, OLD);
    const { dir } = folderWith({ '0002-real.md': OLD }, { links: [{ name: '0001-linked.md', target: outside }, { name: 'notes.md', target: outside }, { name: 'sub', target: scratch }] });
    for (const name of ['README.md', 'template.md']) {
      fs.rmSync(path.join(dir, name));
      fs.symlinkSync(outside, path.join(dir, name));
    }
    const got = run(['seal', '--adopt', dir, '--write']);
    assert.equal(got.code, 1);
    const link = 'cannot seal (V-04: the entry is a symbolic link, or is neither a regular file nor a directory)';
    assert.equal(got.stderr, [
      `${dir}/0001-linked.md: ${link}`,
      `${dir}/0002-real.md: sealed`,
      `${dir}/README.md: ${link}`,
      `${dir}/notes.md: ${link}`,
      `${dir}/sub: ${link}`,
      `${dir}/template.md: ${link}`,
      `${dir}: 1 sealed, 0 have a seal, 0 skipped, 5 cannot be sealed`,
      '',
    ].join('\n'));
    assert.equal(fs.readFileSync(outside, 'utf8'), OLD, 'the target of the link is as it was');
    assert.ok(fs.lstatSync(path.join(dir, '0001-linked.md')).isSymbolicLink(), 'the link is still a link');
  });

  test('a file that is not a record file is listed as skipped; README.md, template.md, a subfolder and a name that starts with a dot are not looked at', () => {
    const { dir } = folderWith({ '0001-first-rule.md': OLD, 'notes.txt': 'x', '0002-Capital.md': OLD, '2-short.md': OLD, '.hidden.md': OLD });
    fs.mkdirSync(path.join(dir, 'shared'));
    fs.writeFileSync(path.join(dir, 'shared/0001-shared-rule.md'), OLD);
    fs.mkdirSync(path.join(dir, 'other'));
    fs.writeFileSync(path.join(dir, 'other/0001-x.md'), OLD);
    const before = snapshot(dir);
    const got = run(['seal', '--adopt', dir, '--write']);
    assert.equal(got.code, 0);
    assert.equal(got.stdout, [
      `${dir}/0001-first-rule.md: sealed`,
      `${dir}/0002-Capital.md: skipped (not a record file)`,
      `${dir}/2-short.md: skipped (not a record file)`,
      `${dir}/notes.txt: skipped (not a record file)`,
      `${dir}: 1 sealed, 0 have a seal, 3 skipped, 0 cannot be sealed`,
      '',
    ].join('\n'));
    const changed = snapshot(dir).split('\n').filter((line, i) => line !== before.split('\n')[i]).map((line) => line.split(' ')[0]);
    assert.deepEqual(changed, ['0001-first-rule.md']);
  });

  test('a name with a control character is printed written out', () => {
    const { dir } = folderWith({ 'a\u0007b.md': 'x' });
    const got = run(['seal', '--adopt', dir]);
    assert.equal(got.stdout.split('\n')[0], `${dir}/a\\u{7}b.md: skipped (not a record file)`);
  });
});

describe('seal --adopt and validate', () => {
  /** The problems of a folder, as text: what `validate` would print. */
  const problems = (dir) => validate(dir, {}).map(({ file, rule, detail }) => `${file}|${rule}|${detail ?? ''}`).sort();

  test('give the same problems before and after, and none that is new', () => {
    const lines = (n) => [...BODY.slice(0, 3), 'Why.', '', '## Decision', '', '- Do it.', '', '## Consequences', '', ...Array.from({ length: n }, (_, i) => `- Done ${i}.`)];
    const front = ['status: accepted', 'date: 2026-11-01', 'decision-makers:', '  - a'];
    const { dir } = folderWith({
      '0001-first-rule.md': OLD, '0002-second-rule.md': SUPERSEDED, '0003-third-rule.md': record(['status: accepted', 'date: 2026-13-45', 'decision-makers:', '  - a']),
      '0004-too-long.md': record(front, lines(70)), '0005-just-fits.md': record(front, lines(60 - (2 + front.length + lines(0).length))), '0006-one-short.md': record(front, lines(59 - (2 + front.length + lines(0).length))),
      '0007-bad-key.md': record([...front, 'owner: me']), '0008-proposed.md': NEW, '0009-with-seal.md': sealedAlready, 'stray.txt': 'x',
    });
    const before = problems(dir);
    assert.ok(before.some((line) => line.includes('|V-')), 'the folder has problems of its own');
    const got = run(['seal', '--adopt', dir, '--write']);
    assert.match(got.stderr, /0005-just-fits\.md: cannot seal \(V-10: the seal line would make the record longer than 60 lines\)/);
    assert.match(got.stderr, /0006-one-short\.md: sealed/);
    const after = problems(dir);
    assert.deepEqual(after, before);
  });
});

describe('seal --adopt: the command line', () => {
  const node = (cwd, ...argv) => spawnSync(process.execPath, [script, ...argv], { encoding: 'utf8', cwd });

  test('the folder is docs/decisions, as for validate', () => {
    const { base } = folderWith({ '0001-first-rule.md': OLD });
    const got = node(base, 'seal', '--adopt');
    assert.equal(got.status, 0);
    assert.match(got.stdout, /^docs\/decisions\/0001-first-rule\.md: would seal\ndocs\/decisions: 1 would be sealed, /);
    assert.equal(node(base, 'seal', '--adopt', '--write').status, 0);
    assert.equal(node(base, 'seal', '--verify', 'docs/decisions/0001-first-rule.md').status, 0);
  });

  test('the options come in any order', () => {
    const { dir } = folderWith({ '0001-first-rule.md': OLD });
    assert.equal(run(['seal', dir, '--write', '--adopt']).code, 0);
    assert.match(fs.readFileSync(path.join(dir, '0001-first-rule.md'), 'utf8'), /\nseal: sha256-g1:/);
  });

  test('wrong usage exits 2 with the usage', () => {
    const { dir } = folderWith({ '0001-first-rule.md': OLD });
    for (const argv of [['seal', '--adopt', 'a', 'b'], ['seal', '--adopt', '--adopt', dir], ['seal', '--adopt', '--verify', dir], ['seal', '--adopt', '--other', dir], ['seal', '--adopt', '-'], ['seal', '--write', dir], ['seal', '--verify', '--write', dir], ['validate', '--adopt', dir]]) {
      const got = run(argv);
      assert.equal(got.code, 2, argv.join(' '));
      assert.equal(got.stdout, '', argv.join(' '));
      assert.ok(got.stderr.startsWith('Usage:\n'), argv.join(' '));
    }
    assert.equal(fs.readFileSync(path.join(dir, '0001-first-rule.md'), 'utf8'), OLD);
  });

  test('a folder that is not there, or is a file, exits 2', () => {
    const missing = path.join(scratch, 'no-such-folder');
    assert.deepEqual(run(['seal', '--adopt', missing]), { code: 2, stdout: '', stderr: `record-keeper: ${missing} does not exist or is not a directory\n` });
    const file = path.join(scratch, 'a-file');
    fs.writeFileSync(file, 'x');
    assert.equal(run(['seal', '--adopt', file, '--write']).code, 2);
  });

  test('a record file that cannot be read exits 2 and writes nothing', () => {
    const { dir } = folderWith({ '0001-first-rule.md': OLD, '0002-second-rule.md': OLD });
    fs.chmodSync(path.join(dir, '0002-second-rule.md'), 0);
    try {
      fs.readFileSync(path.join(dir, '0002-second-rule.md'));
      return; // a user that reads anything (root): the case cannot be made
    } catch {
      // the file is not readable here
    }
    const got = run(['seal', '--adopt', dir, '--write']);
    assert.equal(got.code, 2);
    assert.match(got.stderr, /^record-keeper: cannot read .*: EACCES/);
    assert.equal(fs.readFileSync(path.join(dir, '0001-first-rule.md'), 'utf8'), OLD, 'nothing was written');
  });

  test('is in the usage text, with its own words', () => {
    const { stdout } = run(['--help']);
    assert.match(stdout, /record-keeper\.mjs seal --adopt \[folder\] \[--write\]\n\s+the first sealing of the records that existed before the kit/);
    assert.match(stdout, /that writes nothing, unless --write adds the seal lines/);
  });

  test('does not read the folder it is given when the arguments are wrong', () => {
    assert.equal(run(['seal', '--adopt', '--write', 'a', 'b']).code, 2);
  });

  test('is used by the library as `adopt`: the entries are the ones that are printed', () => {
    const { dir } = folderWith({ '0001-first-rule.md': OLD, '0002-second-rule.md': NEW });
    assert.deepEqual(adopt(dir).map(({ name, state }) => [name, state]), [['0001-first-rule.md', 'seal'], ['0002-second-rule.md', 'skip']]);
  });
});

describe('the fixtures that a second implementation made', () => {
  const { cases } = JSON.parse(fs.readFileSync(new URL('./fixtures/adopt/cases.json', import.meta.url), 'utf8'));
  const bytesOf = (file) => (file.hex !== undefined ? Buffer.from(file.hex, 'hex') : Buffer.from(file.text));

  test('are there', () => {
    assert.ok(cases.length >= 40, `${cases.length} cases`);
    assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
  });

  for (const c of cases) {
    test(`${c.id}: ${c.note}`, () => {
      const { dir } = folderWith(Object.fromEntries(Object.entries(c.files).map(([name, file]) => [name, bytesOf(file)])));
      const before = snapshot(dir);
      const dry = run(['seal', '--adopt', dir]);
      assert.equal(snapshot(dir), before, 'a dry run writes nothing');
      const clauses = (text) => text.split('\n').filter((line) => line.startsWith(`${dir}/`)).map((line) => line.slice(dir.length + 1));
      assert.deepEqual(clauses(dry.stdout + dry.stderr), c.dry, 'the dry run');
      assert.equal(dry.code, c.code);
      const [sealable, sealed, skipped, left] = c.counts;
      assert.ok((dry.stdout + dry.stderr).includes(`${dir}: ${sealable} would be sealed, ${sealed} ${sealed === 1 ? 'has a seal' : 'have a seal'}, ${skipped} skipped, ${left} cannot be sealed\n`), 'the count');
      const written = run(['seal', '--adopt', dir, '--write']);
      assert.deepEqual(clauses(written.stdout + written.stderr), c.write, 'the written run');
      assert.equal(written.code, c.code);
      for (const [name, file] of Object.entries(c.files)) {
        const now = fs.readFileSync(path.join(dir, name));
        assert.ok(now.equals(c.after[name] === undefined ? bytesOf(file) : bytesOf(c.after[name])), name);
        if (c.after[name] !== undefined) assert.ok(verify(now).ok, `${name} verifies`);
      }
      const state = snapshot(dir);
      const second = run(['seal', '--adopt', dir, '--write']);
      assert.equal(snapshot(dir), state, 'a second run changes nothing');
      assert.equal(second.code, c.code);
      assert.ok(!/: sealed$/m.test(second.stdout + second.stderr), 'a second run seals nothing');
    });
  }
});
