// `seal` and `seal --verify`: the output, the exit status, and that nothing is ever written.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run, seal, verify } from '../record-keeper.mjs';

const script = fileURLToPath(new URL('../record-keeper.mjs', import.meta.url));
const vectorsDir = new URL('./vectors/g1/', import.meta.url);
const vectors = new Map(JSON.parse(fs.readFileSync(new URL('vectors.json', vectorsDir), 'utf8')).vectors.map((v) => [v.id, v]));

const record = (front = '', body = '# A rule\n\nSay what to do.\n') => `---\nid: 7\ntitle: A rule\n${front}---\n\n${body}`;
const sealOf = (text) => seal(Buffer.from(text));
const files = (contents) => (file) => {
  if (!Object.hasOwn(contents, file)) throw new Error(`ENOENT: no such file, open '${file}'`);
  return Buffer.from(contents[file]);
};
const runOn = (argv, contents = {}) => run(argv, { readFile: files(contents) });
const USAGE_START = 'Usage:\n';

describe('seal', () => {
  test('prints the seal and nothing else', () => {
    const result = runOn(['seal', 'r.md'], { 'r.md': record() });
    assert.deepEqual(result, { code: 0, stdout: `${sealOf(record())}\n`, stderr: '' });
  });

  test('does not depend on status, date or an existing seal', () => {
    const sealed = record(`status: accepted\ndate: 2026-11-04\nseal: ${sealOf(record())}\n`);
    assert.equal(runOn(['seal', 'r.md'], { 'r.md': sealed }).stdout, `${sealOf(record())}\n`);
  });

  test('names the rule and exits 1 for a record that cannot be sealed', () => {
    const result = runOn(['seal', 'r.md'], { 'r.md': record('', 'Hidden <!-- text -->\n') });
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^r\.md: rejected by G1-06: the text contains <!--\n$/);
  });
});

describe('seal --verify', () => {
  test('accepts a record whose seal matches, whatever its status and date', () => {
    const text = record(`status: accepted\ndate: 2026-11-04\nseal: ${sealOf(record())}\n`);
    assert.deepEqual(runOn(['seal', '--verify', 'r.md'], { 'r.md': text }), { code: 0, stdout: 'r.md: the seal verifies\n', stderr: '' });
  });

  test('reads the seal without the spaces after the colon', () => {
    const text = record(`seal:    ${sealOf(record())}\n`);
    assert.equal(runOn(['seal', '--verify', 'r.md'], { 'r.md': text }).code, 0);
  });

  test('still verifies after an erratum is added', () => {
    const text = record(`seal: ${sealOf(record())}\n`, '# A rule\n\nSay what to do.\n\n## Errata\n\n- 2026-11-05: a typo.\n');
    assert.equal(runOn(['seal', '--verify', 'r.md'], { 'r.md': text }).code, 0);
  });

  test('fails when the text changed, and shows both seals', () => {
    const stored = sealOf(record());
    const text = record(`seal: ${stored}\n`, '# A rule\n\nSay something else.\n');
    const result = runOn(['seal', '--verify', 'r.md'], { 'r.md': text });
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^r\.md: the seal does not verify\n/);
    assert.ok(result.stderr.includes(`stored:   ${stored}`));
    assert.ok(result.stderr.includes(`computed: ${sealOf(text)}`));
  });

  test('fails for a record without a seal', () => {
    const result = runOn(['seal', '--verify', 'r.md'], { 'r.md': record('status: proposed\n') });
    assert.deepEqual(result, { code: 1, stdout: '', stderr: 'r.md: not sealed (there is no seal: key)\n' });
  });

  test('fails for a seal that is not 64 lowercase hexadecimal digits after sha256-g1:', () => {
    const good = sealOf(record());
    const stray = [good.toUpperCase(), good.slice(0, 10) + good.slice(10).toUpperCase(), good.slice(0, -1), `${good}0`, 'trust me',
      `${good.slice(0, 40)} ${good.slice(40)}`, good.replace('g1', 'g'), `junk-${good}`];
    for (const stored of stray) {
      const result = runOn(['seal', '--verify', 'r.md'], { 'r.md': record(`seal: ${stored}\n`) });
      assert.equal(result.code, 1, stored);
      assert.match(result.stderr, /the seal is malformed/, stored);
    }
  });

  test('fails for a generation it does not know, whatever the digest', () => {
    const digest = sealOf(record()).slice('sha256-g1:'.length);
    for (const generation of ['g2', 'g10', 'g0']) {
      const result = runOn(['seal', '--verify', 'r.md'], { 'r.md': record(`seal: sha256-${generation}:${digest}\n`) });
      assert.equal(result.code, 1, generation);
      assert.match(result.stderr, new RegExp(`unknown generation ${generation} \\(this version knows g1\\)`));
    }
  });

  test('fails for a record that a rule rejects, even with a seal', () => {
    const text = record(`seal: ${sealOf(record())}\n`, 'Hidden <!-- text -->\n');
    const result = runOn(['seal', '--verify', 'r.md'], { 'r.md': text });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /^r\.md: rejected by G1-06/);
  });

  test('reports why through verify(), without throwing', () => {
    assert.deepEqual(verify(Buffer.from(record())), { ok: false, reason: 'not-sealed' });
    assert.deepEqual(verify(Buffer.from('no front matter\n')), { ok: false, reason: 'rejected', rule: 'G1-07' });
    assert.deepEqual(verify(Buffer.from([0xff, 0xfe])), { ok: false, reason: 'rejected', rule: 'G1-01' });
  });
});

describe('the command line', () => {
  test('explains itself on --help and -h and exits 0', () => {
    for (const flag of ['--help', '-h']) {
      const result = runOn([flag]);
      assert.equal(result.code, 0, flag);
      assert.ok(result.stdout.startsWith(USAGE_START), flag);
      assert.equal(result.stderr, '', flag);
    }
  });

  test('exits 2 with the usage for anything it does not understand', () => {
    const wrong = [[], ['verify', 'r.md'], ['seal'], ['seal', 'a.md', 'b.md'], ['seal', '--verify'], ['seal', '--verify', 'a.md', 'b.md'], ['seal', '--check', 'r.md'], ['seal', '-'], ['--verify', 'r.md']];
    for (const argv of wrong) {
      const result = runOn(argv, { 'r.md': record() });
      assert.equal(result.code, 2, JSON.stringify(argv));
      assert.equal(result.stdout, '', JSON.stringify(argv));
      assert.ok(result.stderr.startsWith(USAGE_START), JSON.stringify(argv));
    }
  });

  test('exits 2 for a file it cannot read', () => {
    for (const argv of [['seal', 'missing.md'], ['seal', '--verify', 'missing.md']]) {
      const result = runOn(argv);
      assert.equal(result.code, 2);
      assert.match(result.stderr, /^record-keeper: cannot read missing\.md: /);
    }
  });
});

describe('the program', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'record-keeper-'));
  after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const node = (...argv) => spawnSync(process.execPath, [script, ...argv], { encoding: 'utf8' });
  const vectorFile = (id) => fileURLToPath(new URL(vectors.get(id).file, vectorsDir));

  test('prints the seal of a file, bytes as they are on disk', () => {
    for (const id of ['a01-base', 'a02-crlf']) {
      const result = node('seal', vectorFile(id));
      assert.equal(result.stdout, `${vectors.get('a01-base').seal}\n`, id);
      assert.equal(result.status, 0, id);
    }
  });

  test('exits with the status of the result', () => {
    const sealed = path.join(scratch, 'sealed.md');
    fs.writeFileSync(sealed, record(`seal: ${sealOf(record())}\n`));
    const edited = path.join(scratch, 'edited.md');
    fs.writeFileSync(edited, record(`seal: ${sealOf(record())}\n`, 'Another text.\n'));
    assert.equal(node('seal', '--verify', sealed).status, 0);
    assert.equal(node('seal', '--verify', edited).status, 1);
    assert.equal(node('seal', '--verify', path.join(scratch, 'missing.md')).status, 2);
    assert.equal(node().status, 2);
  });

  test('never changes the file it reads', () => {
    const file = path.join(scratch, 'untouched.md');
    fs.writeFileSync(file, record(`status: proposed\n`));
    const before = { bytes: fs.readFileSync(file), mtime: fs.statSync(file).mtimeMs };
    node('seal', file);
    node('seal', '--verify', file);
    assert.deepEqual(fs.readFileSync(file), before.bytes);
    assert.equal(fs.statSync(file).mtimeMs, before.mtime);
  });

  test('also runs when it is started through a symbolic link', () => {
    const link = path.join(scratch, 'record-keeper');
    fs.symlinkSync(script, link);
    const result = spawnSync(process.execPath, [link, 'seal', vectorFile('a01-base')], { encoding: 'utf8' });
    assert.equal(result.stdout, `${vectors.get('a01-base').seal}\n`);
  });

  test('prints nothing when it is imported', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(script)})`], { encoding: 'utf8' });
    assert.deepEqual([result.status, result.stdout, result.stderr], [0, '', '']);
  });
});
