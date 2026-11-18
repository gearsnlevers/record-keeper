// The release manifest (docs/releases.md): tools/build-release-manifest.mjs on small folders of its own, on adversarial files, and on this repository;
// and the second implementation, reference/verify_manifest.py, run against it. Nothing here reads or writes outside the folders the tests make.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GENERATION } from '../record-keeper.mjs';
import { DESTINATIONS, KINDS, ManifestError, SCHEMA, buildManifest, canonical, pathProblem, readInstall, run, verifyManifest } from '../tools/build-release-manifest.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const tool = path.join(root, 'tools/build-release-manifest.mjs');
const reference = path.join(root, 'reference/verify_manifest.py');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'record-keeper-manifest-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const COMMIT = 'a'.repeat(40);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const REQUIRES = { secrets: [], settings: ['owners'], rulesets: [{ branch: 'default', checks: ['Records integrity'], 'up-to-date': true }] };
let made = 0;

/** A folder of its own with `files` (path to text or bytes), a package.json, and an install.json made from `entries` unless `install` is given. */
function folder(files, entries, { install, engines = '>=22' } = {}) {
  const dir = path.join(scratch, `case-${(made += 1)}`);
  const write = (relative, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
    fs.writeFileSync(path.join(dir, relative), content);
  };
  for (const [relative, content] of Object.entries(files)) write(relative, content);
  write('package.json', JSON.stringify({ name: 'x', version: '0.0.0', engines: engines === null ? {} : { node: engines } }));
  write('install.json', install ?? JSON.stringify({ schema: 1, generations: ['g1'], files: entries, requires: REQUIRES }));
  return dir;
}
const entry = (source, destination, kind = 'managed') => ({ source, path: destination, kind });
const build = (dir, over = {}) => buildManifest({ root: dir, version: '1.2.3', tag: 'v1.2.3', commit: COMMIT, ...over });
const refused = (dir, pattern, over) => assert.throws(() => build(dir, over), (error) => error instanceof ManifestError && pattern.test(error.message), String(pattern));

describe('the manifest of a small folder', () => {
  const files = { 'b.txt': 'B\n', 'a.txt': 'A\n', 'docs/z.md': 'Z\n' };
  const entries = [entry('b.txt', '.github/record-keeper/b.txt'), entry('docs/z.md', 'docs/decisions/z.md', 'template'), entry('a.txt', '.github/a.txt')];

  test('has the fields of the page, the files sorted by destination, and the digest and size of each', () => {
    const manifest = build(folder(files, entries));
    assert.deepEqual(Object.keys(manifest).sort(), ['commit', 'files', 'generations', 'node', 'requires', 'schema', 'tag', 'version']);
    assert.deepEqual(manifest.files.map((f) => f.path), ['.github/a.txt', '.github/record-keeper/b.txt', 'docs/decisions/z.md']);
    assert.deepEqual(manifest.files[0], { kind: 'managed', path: '.github/a.txt', sha256: sha('A\n'), size: 2, source: 'a.txt' });
    assert.deepEqual(manifest.files[2], { kind: 'template', path: 'docs/decisions/z.md', sha256: sha('Z\n'), size: 2, source: 'docs/z.md' });
    assert.equal(manifest.schema, 1);
    assert.equal(manifest.version, '1.2.3');
    assert.equal(manifest.tag, 'v1.2.3');
    assert.equal(manifest.commit, COMMIT);
    assert.equal(manifest.node, '>=22');
    assert.deepEqual(manifest.generations, ['g1']);
    assert.deepEqual(manifest.requires, REQUIRES);
  });

  test('is the same bytes for the same files, wherever the folder is and in whatever order install.json lists them', () => {
    const first = canonical(build(folder(files, entries)));
    assert.equal(canonical(build(folder(files, entries))), first);
    assert.equal(canonical(build(folder(files, [...entries].reverse()))), first);
  });

  test('is written with the keys in order, two spaces, line feeds, one line feed at the end, and no time', () => {
    const text = canonical(build(folder(files, entries)));
    assert.ok(text.endsWith('}\n') && !text.endsWith('\n\n'));
    assert.ok(!text.includes('\r'));
    assert.ok(!/20\d\d-\d\d-\d\d/.test(text));
    assert.deepEqual(Object.keys(JSON.parse(text)), ['commit', 'files', 'generations', 'node', 'requires', 'schema', 'tag', 'version']);
    assert.match(text, /^\{\n {2}"commit": "a{40}",\n {2}"files": \[\n {4}\{\n {6}"kind": "managed",\n {6}"path": "\.github\/a\.txt",\n {6}"sha256": "[0-9a-f]{64}",\n {6}"size": 2,\n {6}"source": "a\.txt"\n {4}\},/);
    assert.match(text, /"rulesets": \[\n {6}\{\n {8}"branch": "default",\n {8}"checks": \[\n {10}"Records integrity"\n {8}\],\n {8}"up-to-date": true\n {6}\}\n {4}\]/);
  });

  test('a file is read once for each destination, and one source may have two', () => {
    const manifest = build(folder({ 'a.txt': 'A\n' }, [entry('a.txt', '.github/one.txt'), entry('a.txt', '.github/two.txt')]));
    assert.deepEqual(manifest.files.map((f) => [f.path, f.source]), [['.github/one.txt', 'a.txt'], ['.github/two.txt', 'a.txt']]);
  });
});

describe('files that are hard to hash', () => {
  const odd = {
    'crlf.txt': 'one\r\ntwo\r\n',
    'empty.txt': '',
    'bom.txt': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('text\n')]),
    'binary.bin': Buffer.from([0, 255, 13, 10, 0, 128]),
    'no newline.txt': 'no end',
    'sub dir/with space.md': 'x\n',
    'unicode.txt': 'caf\u00e9 \u{1f600}\n',
  };
  const entries = [
    entry('crlf.txt', '.github/crlf.txt'), entry('empty.txt', '.github/empty.txt'), entry('bom.txt', '.github/bom.txt'), entry('binary.bin', '.github/binary.bin'),
    entry('no newline.txt', '.github/no newline.txt'), entry('sub dir/with space.md', 'docs/decisions/with space.md', 'template'), entry('unicode.txt', '.github/unicode.txt'),
  ];

  test('are hashed byte for byte, with their size in bytes', () => {
    const manifest = build(folder(odd, entries));
    for (const [source, content] of Object.entries(odd)) {
      const bytes = Buffer.from(content);
      const found = manifest.files.find((f) => f.source === source);
      assert.equal(found.sha256, sha(bytes), source);
      assert.equal(found.size, bytes.length, source);
    }
    assert.equal(manifest.files.find((f) => f.source === 'empty.txt').sha256, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(manifest.files.find((f) => f.source === 'unicode.txt').size, Buffer.byteLength('caf\u00e9 \u{1f600}\n'));
  });

  test('keep a space in the path, and verify', () => {
    const dir = folder(odd, entries);
    const manifest = build(dir);
    assert.ok(manifest.files.some((f) => f.path === '.github/no newline.txt'));
    assert.deepEqual(verifyManifest(canonical(manifest), dir), []);
  });
});

describe('what is refused', () => {
  const ok = { 'a.txt': 'A\n' };
  const one = (source, destination, kind) => [entry(source, destination, kind)];

  test('a source that is not there, a folder as a source, and a file where a folder should be', () => {
    refused(folder(ok, one('gone.txt', '.github/gone.txt')), /source gone\.txt: no such file/);
    refused(folder({ 'sub/x.txt': 'x' }, one('sub', '.github/sub')), /source sub: is not a regular file/);
    refused(folder(ok, one('a.txt/b.txt', '.github/b.txt')), /source a\.txt\/b\.txt: a\.txt is not a folder/);
  });

  test('a symbolic link as a source, or in front of it', () => {
    const dir = folder({ 'real.txt': 'R\n', 'real/x.txt': 'X\n' }, [entry('link.txt', '.github/link.txt')]);
    fs.symlinkSync('real.txt', path.join(dir, 'link.txt'));
    refused(dir, /source link\.txt: is a symbolic link/);
    const other = folder({ 'real/x.txt': 'X\n' }, one('linked/x.txt', '.github/x.txt'));
    fs.symlinkSync('real', path.join(other, 'linked'));
    refused(other, /source linked\/x\.txt: linked is a symbolic link/);
    const dangling = folder(ok, one('dangling.txt', '.github/d.txt'));
    fs.symlinkSync('nowhere', path.join(dangling, 'dangling.txt'));
    refused(dangling, /source dangling\.txt: is a symbolic link/);
  });

  test('install.json and package.json as links', () => {
    const dir = folder(ok, one('a.txt', '.github/a.txt'));
    fs.renameSync(path.join(dir, 'install.json'), path.join(dir, 'real-install.json'));
    fs.symlinkSync('real-install.json', path.join(dir, 'install.json'));
    refused(dir, /file install\.json: is a symbolic link/);
    const other = folder(ok, one('a.txt', '.github/a.txt'));
    fs.renameSync(path.join(other, 'package.json'), path.join(other, 'real-package.json'));
    fs.symlinkSync('real-package.json', path.join(other, 'package.json'));
    refused(other, /file package\.json: is a symbolic link/);
  });

  test('a destination twice, also in other capitals', () => {
    refused(folder({ 'a.txt': 'A', 'b.txt': 'B' }, [entry('a.txt', '.github/x.txt'), entry('b.txt', '.github/x.txt')]), /entry 2: path \.github\/x\.txt is already the destination of \.github\/x\.txt/);
    refused(folder({ 'a.txt': 'A', 'b.txt': 'B' }, [entry('a.txt', '.github/x.txt'), entry('b.txt', '.github/X.TXT')]), /entry 2: path \.github\/X\.TXT is already the destination of \.github\/x\.txt/);
  });

  test('a destination that is a file and the folder of another', () => {
    refused(folder({ 'a.txt': 'A', 'b.txt': 'B' }, [entry('a.txt', '.github/x'), entry('b.txt', '.github/x/y')]), /\.github\/x is a file and \.github\/x\/y is below it/);
    refused(folder({ 'a.txt': 'A', 'b.txt': 'B' }, [entry('a.txt', '.github/x/y'), entry('b.txt', '.GITHUB/X')]), /outside/);
  });

  test('a destination outside .github/ and docs/decisions/, in any way of writing it', () => {
    for (const destination of ['README.md', 'docs/README.md', 'docs/decisions', 'docs/decisions-extra/x.md', '.github', '.githubx/a.txt', 'src/.github/a.txt', '.Github/a.txt', 'DOCS/decisions/a.md', 'docs/Decisions/a.md']) {
      refused(folder(ok, one('a.txt', destination)), /entry 1: path .* (is outside|has a)/, undefined);
    }
  });

  test('an absolute path, a path with .., a drive, a backslash, and the parts that no system keeps', () => {
    const cases = [
      ['/etc/passwd', /is absolute/], ['/.github/a.txt', /is absolute/], ['.github/../x', /part that is \. or \.\./], ['.github/..', /part that is \. or \.\./], ['..', /part that is \. or \.\./],
      ['.github/./a.txt', /part that is \. or \.\./], ['.github//a.txt', /empty part/], ['.github/a.txt/', /empty part/], ['C:/x', /backslash or a colon/], ['.github\\a.txt', /backslash or a colon/],
      ['.github/a:b', /backslash or a colon/], ['.github/ a.txt', /starts with a space/], ['.github/a.txt ', /ends with a space/], ['.github/a.', /ends with a space or a dot/], ['.github/.git/x', /part that is \.git/],
      ['.github/.GIT', /part that is \.git/], ['.github/a\tb', /printable ASCII/], ['.github/a\nb', /printable ASCII/], ['.github/\u00e9', /printable ASCII/], ['.github/a\u0000b', /printable ASCII/],
      ['.github/a\u007fb', /printable ASCII/], ['', /is not a path/],
    ];
    for (const [destination, pattern] of cases) {
      refused(folder(ok, one('a.txt', destination)), pattern);
      refused(folder(ok, one(destination, '.github/a.txt')), pattern);
    }
  });

  test('a source outside the folder', () => {
    for (const source of ['../x', 'a/../../x', '/etc/passwd']) refused(folder(ok, one(source, '.github/a.txt')), /source|part that is|absolute/);
  });

  test('an entry that is not what install.json allows', () => {
    refused(folder(ok, one('a.txt', '.github/a.txt', 'other')), /kind must be managed or template/);
    refused(folder(ok, [{ source: 'a.txt', path: '.github/a.txt', kind: null }]), /kind must be managed or template/);
    refused(folder(ok, [{ source: 'a.txt', path: '.github/a.txt', kind: 'managed', extra: 1 }]), /unknown key extra/);
    refused(folder(ok, [{ source: 'a.txt', kind: 'managed' }]), /missing key path/);
    refused(folder(ok, ['a.txt']), /entry 1: must be an object/);
    refused(folder(ok, []), /files must be a list with at least one entry/);
    refused(folder(ok, null), /files must be a list/);
    refused(folder(ok, [{ source: 3, path: '.github/a.txt', kind: 'managed' }]), /source is not a path/);
  });

  test('an install.json that is not what the page says', () => {
    const good = { schema: 1, generations: ['g1'], files: one('a.txt', '.github/a.txt'), requires: REQUIRES };
    const text = (over) => JSON.stringify({ ...good, ...over });
    refused(folder(ok, null, { install: '{' }), /is not one JSON document/);
    refused(folder(ok, null, { install: `\ufeff${text({})}` }), /is not one JSON document/);
    refused(folder(ok, null, { install: '[]' }), /must be an object/);
    refused(folder(ok, null, { install: text({ schema: 2 }) }), /schema must be 1/);
    refused(folder(ok, null, { install: text({ generations: [] }) }), /generations must name at least one/);
    refused(folder(ok, null, { install: text({ generations: ['G1'] }) }), /generations must name at least one/);
    refused(folder(ok, null, { install: text({ generations: ['g1', 'g1'] }) }), /names something twice/);
    refused(folder(ok, null, { install: text({ requires: [] }) }), /requires must be an object/);
    refused(folder(ok, null, { install: text({ requires: { ...REQUIRES, secrets: 'X' } }) }), /requires\.secrets: must be a list of texts/);
    refused(folder(ok, null, { install: text({ requires: { ...REQUIRES, settings: [''] } }) }), /requires\.settings: must be a list of texts/);
    refused(folder(ok, null, { install: text({ requires: { secrets: [], settings: [] } }) }), /missing key rulesets/);
    refused(folder(ok, null, { install: text({ requires: { ...REQUIRES, rulesets: [{ branch: 'default', checks: ['A'] }] } }) }), /missing key up-to-date/);
    refused(folder(ok, null, { install: text({ requires: { ...REQUIRES, rulesets: [{ branch: '', checks: ['A'], 'up-to-date': true }] } }) }), /needs a branch/);
    refused(folder(ok, null, { install: text({ requires: { ...REQUIRES, rulesets: [{ branch: 'default', checks: ['A'], 'up-to-date': 'yes' }] } }) }), /up-to-date must be true or false/);
    refused(folder(ok, null, { install: text({ requires: { ...REQUIRES, rulesets: ['x'] } }) }), /ruleset must be an object/);
    refused(folder(ok, null, { install: text({ requires: { ...REQUIRES, rulesets: 'x' } }) }), /rulesets must be a list/);
    refused(folder(ok, null, { install: text({ extra: 1 }) }), /unknown key extra/);
    refused(folder(ok, null, { install: JSON.stringify({ schema: 1, generations: ['g1'], files: good.files }) }), /missing key requires/);
    assert.throws(() => readInstall(path.join(scratch, 'nowhere')), /file install\.json: no such file/);
  });

  test('a version, a tag and a commit that are not what a release has', () => {
    const dir = folder(ok, one('a.txt', '.github/a.txt'));
    for (const version of ['1', '1.2', '01.2.3', '1.02.3', '1.2.3+build', 'v1.2.3', '1.2.3-', '1.2.3-01', '1.2.3-a..b', '', ' 1.2.3', '1.2.3\n', undefined]) {
      refused(dir, /is not a semantic version/, { version, tag: `v${version}` });
    }
    for (const version of ['0.0.0', '1.2.3', '10.20.30', '1.0.0-1', '1.0.0-rc.1', '1.0.0-alpha-beta.2', '1.0.0-0', '2.0.0-premajor.0']) assert.equal(build(dir, { version, tag: `v${version}` }).version, version);
    for (const tag of ['1.2.3', 'v1.2.4', 'V1.2.3', 'v1.2.3 ', undefined]) refused(dir, /tag .* is not v1\.2\.3/, { tag });
    for (const commit of ['abc', 'A'.repeat(40), 'a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40), `${'a'.repeat(40)}\n`, undefined, 'HEAD']) refused(dir, /commit .* is not a full commit id/, { commit });
    assert.equal(build(dir, { commit: 'f'.repeat(64) }).commit, 'f'.repeat(64));
  });

  test('a package.json without engines.node', () => {
    refused(folder(ok, one('a.txt', '.github/a.txt'), { engines: null }), /engines\.node is missing/);
    refused(folder(ok, one('a.txt', '.github/a.txt'), { engines: '' }), /engines\.node is missing/);
    const dir = folder(ok, one('a.txt', '.github/a.txt'));
    fs.writeFileSync(path.join(dir, 'package.json'), '[]');
    refused(dir, /engines\.node is missing/);
    fs.writeFileSync(path.join(dir, 'package.json'), '{');
    refused(dir, /package\.json: is not one JSON document/);
    fs.rmSync(path.join(dir, 'package.json'));
    refused(dir, /file package\.json: no such file/);
  });

  test('pathProblem says why, and nothing about a path that is fine', () => {
    for (const fine of ['a', '.github/a.txt', 'docs/decisions/0001-x.md', 'a b/c d.txt', '.github/workflows/records-integrity.yml', '~a/b', 'a/.hidden', 'a.b/c']) assert.equal(pathProblem(fine), null, fine);
    assert.equal(pathProblem(undefined), 'is not a path');
    assert.equal(pathProblem(3), 'is not a path');
    assert.equal(pathProblem('a/.git/b'), 'has a part that is .git');
    assert.equal(pathProblem('a/.gitignore'), null);
  });
});

describe('verifying a manifest against the files', () => {
  const files = { 'a.txt': 'A\n', 'b.txt': 'B\n' };
  const entries = [entry('a.txt', '.github/a.txt'), entry('b.txt', 'docs/decisions/b.txt', 'template')];
  const setup = () => {
    const dir = folder(files, entries);
    const manifest = build(dir);
    return { dir, manifest, text: canonical(manifest) };
  };
  const problemsOf = (manifest, dir, text = canonical(manifest)) => verifyManifest(text, dir);

  test('finds nothing wrong with a fresh manifest', () => {
    const { dir, text } = setup();
    assert.deepEqual(verifyManifest(text, dir), []);
  });

  test('finds a file that was changed, resized, deleted or replaced by a link', () => {
    const one = setup();
    fs.writeFileSync(path.join(one.dir, 'a.txt'), 'X\n');
    assert.deepEqual(verifyManifest(one.text, one.dir), ['digest mismatch: .github/a.txt']);
    const two = setup();
    fs.writeFileSync(path.join(two.dir, 'a.txt'), 'A\n\n');
    assert.deepEqual(verifyManifest(two.text, two.dir), ['digest mismatch: .github/a.txt']);
    const three = setup();
    fs.rmSync(path.join(three.dir, 'b.txt'));
    assert.deepEqual(verifyManifest(three.text, three.dir), ['source b.txt: no such file']);
    const four = setup();
    fs.rmSync(path.join(four.dir, 'a.txt'));
    fs.symlinkSync('b.txt', path.join(four.dir, 'a.txt'));
    assert.deepEqual(verifyManifest(four.text, four.dir), ['source a.txt: is a symbolic link']);
  });

  test('finds a line ending that was changed', () => {
    const { dir, text } = setup();
    fs.writeFileSync(path.join(dir, 'a.txt'), 'A\r\n');
    assert.deepEqual(verifyManifest(text, dir), ['digest mismatch: .github/a.txt']);
  });

  test('finds a wrong digest, size, kind or source in the manifest', () => {
    const { dir, manifest } = setup();
    const changed = (edit) => {
      const copy = structuredClone(manifest);
      edit(copy);
      return problemsOf(copy, dir);
    };
    assert.deepEqual(changed((m) => { m.files[0].sha256 = '0'.repeat(64); }), ['digest mismatch: .github/a.txt']);
    assert.deepEqual(changed((m) => { m.files[0].size = 3; }), ['size mismatch: .github/a.txt']);
    assert.deepEqual(changed((m) => { m.files[1].kind = 'managed'; }), ['kind or source mismatch: docs/decisions/b.txt']);
    assert.deepEqual(changed((m) => { m.files[1].source = 'a.txt'; }), ['kind or source mismatch: docs/decisions/b.txt']);
  });

  test('finds a file that the manifest lacks, one that install.json does not list, and a path listed twice', () => {
    const { dir, manifest } = setup();
    const missing = structuredClone(manifest);
    missing.files.pop();
    assert.deepEqual(problemsOf(missing, dir), ['missing from the manifest: docs/decisions/b.txt']);
    const extra = structuredClone(manifest);
    extra.files.push({ kind: 'managed', path: '.github/extra.txt', sha256: sha('x'), size: 1, source: 'a.txt' });
    assert.deepEqual(problemsOf(extra, dir), ['not in install.json: .github/extra.txt']);
    const twice = structuredClone(manifest);
    twice.files.push(structuredClone(twice.files[0]));
    assert.deepEqual(problemsOf(twice, dir), ['the manifest lists a path twice']);
    const odd = structuredClone(manifest);
    odd.files.push(7);
    assert.deepEqual(problemsOf(odd, dir), ['not in install.json: 7']);
    const nameless = structuredClone(manifest);
    nameless.files.push({ kind: 'managed' });
    assert.deepEqual(problemsOf(nameless, dir), ['not in install.json: undefined']);
  });

  test('finds a node, a schema, a generation or a requirement that is not what the files give', () => {
    const { dir, manifest } = setup();
    for (const [key, value] of [['node', '>=18'], ['schema', 2], ['generations', ['g1', 'g2']], ['requires', { ...REQUIRES, secrets: ['X'] }]]) {
      const copy = structuredClone(manifest);
      copy[key] = value;
      assert.deepEqual(problemsOf(copy, dir), [`${key} is not what install.json and package.json give`], key);
      delete copy[key];
      assert.deepEqual(problemsOf(copy, dir), [`${key} is not what install.json and package.json give`], `no ${key}`);
    }
  });

  test('finds a version, a tag or a commit that a release cannot have, and a manifest that is not one', () => {
    const { dir, manifest } = setup();
    assert.match(problemsOf({ ...manifest, version: '1.2' }, dir)[0], /is not a semantic version/);
    assert.match(problemsOf({ ...manifest, tag: 'v1.2.4' }, dir)[0], /is not v1\.2\.3/);
    assert.match(problemsOf({ ...manifest, commit: 'abc' }, dir)[0], /is not a full commit id/);
    assert.deepEqual(verifyManifest('not json', dir), ['the manifest is not one JSON document']);
    assert.deepEqual(verifyManifest('[]', dir), ['the manifest is not an object']);
    assert.deepEqual(verifyManifest('null', dir), ['the manifest is not an object']);
  });

  test('finds a manifest that says the right things in another form', () => {
    const { dir, manifest, text } = setup();
    assert.deepEqual(verifyManifest(JSON.stringify(manifest, null, 2), dir), ['the manifest is not in canonical form']);
    assert.deepEqual(verifyManifest(JSON.stringify(manifest), dir), ['the manifest is not in canonical form']);
    assert.deepEqual(verifyManifest(text.replace(/\n/g, '\r\n'), dir), ['the manifest is not in canonical form']);
    assert.deepEqual(verifyManifest(text.slice(0, -1), dir), ['the manifest is not in canonical form']);
    assert.deepEqual(verifyManifest(`${text}\n`, dir), ['the manifest is not in canonical form']);
    const reordered = { files: manifest.files.slice().reverse(), ...manifest };
    assert.deepEqual(verifyManifest(JSON.stringify(reordered, null, 2) + '\n', dir), ['the manifest is not in canonical form']);
  });
});

describe('the command line', () => {
  const files = { 'a.txt': 'A\n' };
  const entries = [entry('a.txt', '.github/a.txt')];
  const USAGE = 'Usage:\n  build-release-manifest.mjs --version <semver> --tag <tag> --commit <id> --out <file> [--root <folder>]\n  build-release-manifest.mjs --verify <manifest> [--root <folder>]\n';

  test('writes the manifest, relative to the folder it runs in, and says how many files', () => {
    const dir = folder(files, entries);
    const got = run(['--version', '1.2.3', '--tag', 'v1.2.3', '--commit', COMMIT, '--out', 'out.json', '--root', '.'], { cwd: dir });
    assert.deepEqual(got, { code: 0, stdout: 'wrote out.json: 1 files\n', stderr: '' });
    assert.equal(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'), canonical(build(dir)));
    assert.deepEqual(run(['--verify', 'out.json'], { cwd: dir }), { code: 0, stdout: 'verified 1 files\n', stderr: '' });
  });

  test('the arguments may come in any order, and --root names the folder of the files', () => {
    const dir = folder(files, entries);
    const out = path.join(scratch, 'elsewhere.json');
    assert.equal(run(['--root', dir, '--out', out, '--commit', COMMIT, '--tag', 'v1.2.3', '--version', '1.2.3'], { cwd: scratch }).code, 0);
    assert.equal(run(['--root', dir, '--verify', out], { cwd: scratch }).code, 0);
    assert.equal(run(['--verify', out], { cwd: dir }).code, 0);
  });

  test('a refusal exits 1 and writes nothing', () => {
    const dir = folder(files, [entry('gone.txt', '.github/gone.txt')]);
    const got = run(['--version', '1.2.3', '--tag', 'v1.2.3', '--commit', COMMIT, '--out', 'out.json'], { cwd: dir });
    assert.deepEqual(got, { code: 1, stdout: '', stderr: 'build-release-manifest: source gone.txt: no such file\n' });
    assert.ok(!fs.existsSync(path.join(dir, 'out.json')));
  });

  test('a manifest that does not verify exits 1 and lists every problem', () => {
    const dir = folder({ 'a.txt': 'A\n', 'b.txt': 'B\n' }, [entry('a.txt', '.github/a.txt'), entry('b.txt', '.github/b.txt')]);
    run(['--version', '1.2.3', '--tag', 'v1.2.3', '--commit', COMMIT, '--out', 'out.json'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'a.txt'), 'changed');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'changed');
    assert.deepEqual(run(['--verify', 'out.json'], { cwd: dir }), { code: 1, stdout: '', stderr: 'build-release-manifest: digest mismatch: .github/a.txt\nbuild-release-manifest: digest mismatch: .github/b.txt\nbuild-release-manifest: 2 problems\n' });
    fs.writeFileSync(path.join(dir, 'b.txt'), 'B\n');
    assert.deepEqual(run(['--verify', 'out.json'], { cwd: dir }).stderr, 'build-release-manifest: digest mismatch: .github/a.txt\nbuild-release-manifest: 1 problem\n');
    assert.deepEqual(run(['--verify', 'nothing.json'], { cwd: dir }), { code: 1, stdout: '', stderr: 'build-release-manifest: nothing.json: cannot be read (ENOENT)\n' });
  });

  test('wrong usage prints the usage and exits 2', () => {
    const all = ['--version', '1.2.3', '--tag', 'v1.2.3', '--commit', COMMIT, '--out', 'out.json'];
    const wrong = [[], ['--version'], ['--verify'], ['--verify', 'a', '--out', 'b'], ['--verify', 'a', 'b'], ['--build'], all.slice(2), all.slice(0, 6), [...all, '--version', '1.2.3'], [...all, 'extra'],
      [...all, '--verify', 'x'], ['--version', '1.2.3', '--tag', 'v1.2.3', '--commit', COMMIT, '--root', '.'], [...all, '--root'], [...all, '--unknown', 'x'], ['--verify', 'a', '--verify', 'b'], ['--help']];
    for (const argv of wrong) assert.deepEqual(run(argv), { code: 2, stdout: '', stderr: USAGE }, argv.join(' '));
  });

  test('as a program, also through a link', () => {
    const dir = folder(files, entries);
    const exec = (program, args) => spawnSync(process.execPath, [program, ...args], { cwd: dir, encoding: 'utf8' });
    const got = exec(tool, ['--version', '1.2.3', '--tag', 'v1.2.3', '--commit', COMMIT, '--out', 'out.json']);
    assert.deepEqual([got.status, got.stdout, got.stderr], [0, 'wrote out.json: 1 files\n', '']);
    const link = path.join(scratch, 'linked-tool.mjs');
    fs.symlinkSync(tool, link);
    const again = exec(link, ['--verify', 'out.json']);
    assert.deepEqual([again.status, again.stdout, again.stderr], [0, 'verified 1 files\n', '']);
    assert.equal(exec(tool, ['--bad']).status, 2);
    assert.equal(exec(tool, ['--verify', 'missing.json']).status, 1);
  });
});

describe('this repository', () => {
  const install = JSON.parse(fs.readFileSync(path.join(root, 'install.json'), 'utf8'));

  test('install.json is the install set that the page lists, and builds', () => {
    const read = readInstall(root);
    assert.equal(install.schema, SCHEMA);
    assert.deepEqual(read.generations, [GENERATION]);
    assert.deepEqual(read.generations, install.generations);
    assert.ok(read.files.length > 0);
    for (const file of read.files) {
      assert.ok(KINDS.includes(file.kind));
      assert.ok(DESTINATIONS.some((start) => file.path.startsWith(start)), file.path);
      assert.ok(fs.statSync(path.join(root, file.source)).isFile(), file.source);
    }
    const manifest = build(root);
    assert.equal(manifest.node, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).engines.node);
    assert.deepEqual(verifyManifest(canonical(manifest), root), []);
  });

  test('install.json is written in the order of its destinations, so that a change to it reads as a list', () => {
    const sections = ['managed', 'template'].map((kind) => install.files.filter((f) => f.kind === kind));
    assert.deepEqual(install.files, [...sections[0], ...sections[1]], 'the managed files come first');
  });

  test('no file of the install set has a carriage return, and git is told to keep it so', () => {
    for (const { source } of install.files) {
      assert.ok(!fs.readFileSync(path.join(root, source)).includes(13), `${source} has a carriage return`);
      const attributes = spawnSync('git', ['check-attr', 'text', 'eol', '--', source], { cwd: root, encoding: 'utf8' });
      if (attributes.status !== 0) continue;
      assert.match(attributes.stdout, /text: set/, source);
      assert.match(attributes.stdout, /eol: lf/, source);
    }
  });
});

describe('the second implementation, reference/verify_manifest.py', () => {
  const python = spawnSync('python3', ['--version']);
  const available = python.status === 0;
  const py = (args, options = {}) => spawnSync('python3', ['-I', reference, ...args], { encoding: 'utf8', ...options });
  const files = {
    'crlf.txt': 'one\r\ntwo\r\n', 'empty.txt': '', 'bom.txt': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('text\n')]), 'binary.bin': Buffer.from([0, 255, 13, 10, 0, 128]),
    'sub dir/with space.md': 'x\n', 'unicode.txt': 'caf\u00e9 \u{1f600}\n',
  };
  const entries = [
    entry('crlf.txt', '.github/crlf.txt'), entry('empty.txt', '.github/empty.txt'), entry('bom.txt', '.github/bom.txt'), entry('binary.bin', '.github/binary.bin'),
    entry('sub dir/with space.md', 'docs/decisions/with space.md', 'template'), entry('unicode.txt', '.github/unicode.txt'),
  ];
  const skip = available ? false : 'python3 is not available';

  test('writes the same bytes as the Node program, for the odd files and for this repository', { skip }, () => {
    for (const dir of [folder(files, entries), root]) {
      const got = py(['--build', '1.2.3', 'v1.2.3', COMMIT, '--root', dir]);
      assert.equal(got.status, 0, got.stderr);
      assert.equal(got.stdout, canonical(build(dir)));
    }
  });

  test('verifies what the Node program wrote, and says the same of what was changed', { skip }, () => {
    const dir = folder(files, entries);
    const out = path.join(dir, 'out.json');
    assert.equal(run(['--version', '1.2.3', '--tag', 'v1.2.3', '--commit', COMMIT, '--out', out, '--root', dir]).code, 0);
    const clean = py(['--verify', out, '--root', dir]);
    assert.deepEqual([clean.status, clean.stdout, clean.stderr], [0, 'verified 6 files\n', '']);
    const text = fs.readFileSync(out, 'utf8');
    const cases = [
      ['a file changed', (d) => fs.writeFileSync(path.join(d, 'crlf.txt'), 'one\ntwo\n')],
      ['a file emptied', (d) => fs.writeFileSync(path.join(d, 'unicode.txt'), '')],
      ['a file filled', (d) => fs.writeFileSync(path.join(d, 'empty.txt'), '\n')],
      ['a bom taken off', (d) => fs.writeFileSync(path.join(d, 'bom.txt'), 'text\n')],
      ['a file deleted', (d) => fs.rmSync(path.join(d, 'binary.bin'))],
      ['a file made a link', (d) => { fs.rmSync(path.join(d, 'crlf.txt')); fs.symlinkSync('unicode.txt', path.join(d, 'crlf.txt')); }],
      ['a folder made a link', (d) => { fs.renameSync(path.join(d, 'sub dir'), path.join(d, 'real')); fs.symlinkSync('real', path.join(d, 'sub dir')); }],
    ];
    for (const [name, change] of cases) {
      const copy = folder(files, entries);
      change(copy);
      fs.writeFileSync(path.join(copy, 'out.json'), text);
      const node = run(['--verify', 'out.json'], { cwd: copy });
      const python3 = py(['--verify', path.join(copy, 'out.json'), '--root', copy]);
      assert.equal(node.code, 1, name);
      assert.equal(python3.status, 1, name);
      // The same problems, in the same words; only the program name in front and the count at the end of the Node program differ.
      const words = (stderr, prefix) => stderr.split('\n').filter((line) => line !== '' && !/^[a-z_-]+: \d+ problems?$/.test(line)).map((line) => line.replace(prefix, ''));
      assert.deepEqual(words(python3.stderr, 'verify_manifest: '), words(node.stderr, 'build-release-manifest: '), name);
    }
    for (const [name, edit] of [
      ['a changed digest', (m) => { m.files[0].sha256 = '0'.repeat(64); }], ['a changed size', (m) => { m.files[1].size += 1; }], ['a changed kind', (m) => { m.files.find((f) => f.kind === 'template').kind = 'managed'; }],
      ['a file left out', (m) => { m.files.pop(); }], ['a file added', (m) => { m.files.push({ ...m.files[0], path: '.github/more.txt' }); }], ['another node', (m) => { m.node = '>=20'; }],
      ['other requirements', (m) => { m.requires.secrets = ['X']; }], ['another version', (m) => { m.version = '1.2'; }], ['another tag', (m) => { m.tag = 'v9.9.9'; }],
    ]) {
      const manifest = JSON.parse(text);
      edit(manifest);
      const changed = path.join(dir, 'changed.json');
      fs.writeFileSync(changed, canonical(manifest));
      const node = run(['--verify', changed, '--root', dir]);
      const python3 = py(['--verify', changed, '--root', dir]);
      assert.equal(node.code, 1, name);
      assert.equal(python3.status, 1, name);
      assert.equal(python3.stderr.replaceAll('verify_manifest: ', '').replace(/\n$/, ''), node.stderr.replaceAll('build-release-manifest: ', '').replace(/(\n)?\d+ problems?\n$/, ''), name);
    }
    fs.writeFileSync(path.join(dir, 'spaced.json'), JSON.stringify(JSON.parse(text), null, 4));
    assert.equal(py(['--verify', path.join(dir, 'spaced.json'), '--root', dir]).stderr, 'verify_manifest: the manifest is not in canonical form\n');
  });

  test('refuses what the Node program refuses', { skip }, () => {
    const install = (list) => (d) => fs.writeFileSync(path.join(d, 'install.json'), JSON.stringify({ schema: 1, generations: ['g1'], files: list, requires: REQUIRES }));
    const cases = [
      ['a symbolic link as a source', (d) => { fs.rmSync(path.join(d, 'empty.txt')); fs.symlinkSync('crlf.txt', path.join(d, 'empty.txt')); }],
      ['a source that is gone', (d) => fs.rmSync(path.join(d, 'empty.txt'))],
      ['a destination twice', install([entry('crlf.txt', '.github/x'), entry('empty.txt', '.github/X')])],
      ['a destination outside', install([entry('crlf.txt', 'src/x')])],
      ['a path with ..', install([entry('crlf.txt', '.github/../x')])],
      ['an absolute source', install([entry('/etc/hosts', '.github/x')])],
      ['a folder and a file', install([entry('crlf.txt', '.github/x'), entry('empty.txt', '.github/x/y')])],
      ['a kind that is not one', install([entry('crlf.txt', '.github/x', 'other')])],
      ['no files', install([])],
    ];
    for (const [name, change] of cases) {
      const copy = folder(files, entries);
      change(copy);
      const node = run(['--version', '1.2.3', '--tag', 'v1.2.3', '--commit', COMMIT, '--out', 'node.json', '--root', copy], { cwd: copy });
      const python3 = py(['--build', '1.2.3', 'v1.2.3', COMMIT, '--root', copy]);
      assert.equal(node.code, 1, name);
      assert.equal(python3.status, 1, name);
      assert.equal(python3.stderr.replace('verify_manifest: ', ''), node.stderr.replace('build-release-manifest: ', ''), name);
    }
    for (const version of ['1.2', '01.2.3', '1.2.3+x']) assert.equal(py(['--build', version, `v${version}`, COMMIT]).status, 1, version);
    assert.equal(py(['--build', '1.2.3', 'v1.2.4', COMMIT]).status, 1);
    assert.equal(py(['--build', '1.2.3', 'v1.2.3', 'abc']).status, 1);
  });

  test('refuses a key that is written twice, which JSON.parse would let through', { skip }, () => {
    const copy = folder(files, entries);
    fs.writeFileSync(path.join(copy, 'install.json'), `{"schema":1,"schema":1,"generations":["g1"],"files":${JSON.stringify(entries)},"requires":${JSON.stringify(REQUIRES)}}`);
    const got = py(['--build', '1.2.3', 'v1.2.3', COMMIT, '--root', copy]);
    assert.equal(got.status, 1);
    assert.match(got.stderr, /is not one JSON document/);
  });

  test('refuses wrong usage', { skip }, () => {
    assert.equal(py([]).status, 2);
    assert.equal(py(['--verify']).status, 2);
    assert.equal(py(['--build', '1.2.3']).status, 2);
    assert.equal(py(['--verify', 'a', '--root']).status, 2);
    assert.equal(py(['--verify', path.join(scratch, 'none.json')]).status, 1);
  });
});
