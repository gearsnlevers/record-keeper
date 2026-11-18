// tools/update-changelog.mjs: the section that the release workflow adds to CHANGELOG.md when the notes are the ones GitHub generates (docs/releases.md).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { addRelease, demoteHeadings, run } from '../tools/update-changelog.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const tool = path.join(root, 'tools/update-changelog.mjs');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'record-keeper-changelog-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
let made = 0;
const folder = (files = {}) => {
  const dir = path.join(scratch, `case-${(made += 1)}`);
  fs.mkdirSync(dir);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
};

const args = (tag, notes = '- a change') => ({ tag, date: '2026-11-17', notes });

describe('addRelease', () => {
  test('creates the file with a title when there is no changelog yet', () => {
    assert.equal(addRelease('', args('v1.0.0')), '# Changelog\n\n## [v1.0.0] - 2026-11-17\n\n- a change\n');
    assert.equal(addRelease('  \n\n', args('v1.0.0')), '# Changelog\n\n## [v1.0.0] - 2026-11-17\n\n- a change\n');
  });

  test('puts the newest release first, below the title', () => {
    const second = addRelease(addRelease('', args('v1.0.0', '- one')), args('v1.1.0', '- two'));
    assert.ok(second.indexOf('## [v1.1.0]') < second.indexOf('## [v1.0.0]'));
    assert.ok(second.startsWith('# Changelog\n'));
    assert.equal((second.match(/^## \[/gm) || []).length, 2);
    assert.equal(second, '# Changelog\n\n## [v1.1.0] - 2026-11-17\n\n- two\n\n## [v1.0.0] - 2026-11-17\n\n- one\n');
  });

  test('keeps a preamble between the title and the first release', () => {
    const out = addRelease('# Changelog\n\nAll notable changes.\n\n## [v1.0.0] - 2026-01-01\n\n- old\n', args('v1.1.0', '- new'));
    assert.equal(out, '# Changelog\n\nAll notable changes.\n\n## [v1.1.0] - 2026-11-17\n\n- new\n\n## [v1.0.0] - 2026-01-01\n\n- old\n');
  });

  test('a title with nothing after it, and a preamble with nothing after it', () => {
    assert.equal(addRelease('# Changelog\n', args('v1.0.0')), '# Changelog\n\n## [v1.0.0] - 2026-11-17\n\n- a change\n');
    assert.equal(addRelease('# Changelog\n\nWords.\n', args('v1.0.0')), '# Changelog\n\nWords.\n\n## [v1.0.0] - 2026-11-17\n\n- a change\n');
  });

  test('refuses the same tag twice, but not a prerelease of it or a tag that only starts like it', () => {
    const once = addRelease('', args('v1.0.0'));
    assert.throws(() => addRelease(once, args('v1.0.0')), /already has a section for v1\.0\.0/);
    assert.doesNotThrow(() => addRelease(once, args('v1.0.0-1')));
    assert.doesNotThrow(() => addRelease(once, args('v1.0.01')));
    assert.doesNotThrow(() => addRelease(addRelease('', args('v1.0.0-1')), args('v1.0.0')));
    assert.doesNotThrow(() => addRelease('# Changelog\n\nSee ## [v1.0.0] in the text.\n', args('v1.0.0')));
  });

  test('a file without a title gets one, and keeps its text', () => {
    const out = addRelease('some text\n', args('v1.0.0'));
    assert.equal(out, '# Changelog\n\n## [v1.0.0] - 2026-11-17\n\n- a change\n\nsome text\n');
  });

  test('headings in the notes move one level below the release heading', () => {
    const notes = "## What's Changed\n* a thing\n\n## New Contributors\n* someone\n\n**Full Changelog**: https://example.com";
    const out = addRelease('', args('v1.0.0', notes));
    assert.ok(out.includes("## [v1.0.0] - 2026-11-17\n\n### What's Changed\n"));
    assert.ok(out.includes('\n### New Contributors\n'));
    assert.equal((out.match(/^## /gm) || []).length, 1);
    assert.ok(out.includes('**Full Changelog**: https://example.com'));
  });

  test('the notes are trimmed, and the file ends with one line feed and has no run of empty lines', () => {
    const out = addRelease('# Changelog\n\n\n\n## [v0.9.0] - 2026-01-01\n\n- old\n\n\n', args('v1.0.0', '\n\n- a\n\n- b\n\n\n'));
    assert.ok(out.endsWith('- old\n'));
    assert.ok(!out.includes('\n\n\n'));
    assert.ok(out.includes('## [v1.0.0] - 2026-11-17\n\n- a\n\n- b\n'));
  });
});

describe('demoteHeadings', () => {
  test('leaves code fences, non-headings and the deepest level alone', () => {
    const text = '# A\n##### E\n###### F\n#hashtag\n```\n# not a heading\n```\n~~~\n## also code\n~~~\n## B';
    assert.equal(demoteHeadings(text), '## A\n###### E\n###### F\n#hashtag\n```\n# not a heading\n```\n~~~\n## also code\n~~~\n### B');
  });

  test('a fence that is indented still opens a fence', () => {
    assert.equal(demoteHeadings('  ```\n# x\n  ```\n# y'), '  ```\n# x\n  ```\n## y');
  });
});

describe('the command line', () => {
  const USAGE = 'Usage:\n  update-changelog.mjs --tag <tag> --notes <file> [--file <changelog>] [--date <YYYY-MM-DD>]\n';

  test('adds the section to CHANGELOG.md of the folder it runs in, with the date of today unless it is given', () => {
    const dir = folder({ 'notes.md': '- a change\n' });
    assert.deepEqual(run(['--tag', 'v1.0.0', '--notes', 'notes.md'], { cwd: dir, today: () => '2026-11-18' }), { code: 0, stdout: 'added v1.0.0 to CHANGELOG.md\n', stderr: '' });
    assert.equal(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'), '# Changelog\n\n## [v1.0.0] - 2026-11-18\n\n- a change\n');
    assert.equal(run(['--tag', 'v1.1.0', '--notes', 'notes.md', '--date', '2026-12-01'], { cwd: dir }).code, 0);
    assert.ok(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8').startsWith('# Changelog\n\n## [v1.1.0] - 2026-12-01\n'));
  });

  test('takes another file, and the arguments in any order', () => {
    const dir = folder({ 'n.md': '- x\n', 'LOG.md': '# Changelog\n\nWords.\n' });
    assert.deepEqual(run(['--file', 'LOG.md', '--notes', 'n.md', '--date', '2026-11-17', '--tag', 'v2.0.0-1'], { cwd: dir }), { code: 0, stdout: 'added v2.0.0-1 to LOG.md\n', stderr: '' });
    assert.equal(fs.readFileSync(path.join(dir, 'LOG.md'), 'utf8'), '# Changelog\n\nWords.\n\n## [v2.0.0-1] - 2026-11-17\n\n- x\n');
    assert.ok(!fs.existsSync(path.join(dir, 'CHANGELOG.md')));
  });

  test('refuses a tag that is there, a tag or a date that is not one, notes that are not there or empty, and writes nothing', () => {
    const dir = folder({ 'notes.md': '- a\n', 'empty.md': ' \n\n' });
    assert.equal(run(['--tag', 'v1.0.0', '--notes', 'notes.md', '--date', '2026-11-17'], { cwd: dir }).code, 0);
    const before = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
    const refused = (argv, message) => assert.deepEqual(run(argv, { cwd: dir }), { code: 1, stdout: '', stderr: `update-changelog: ${message}\n` }, argv.join(' '));
    refused(['--tag', 'v1.0.0', '--notes', 'notes.md'], 'CHANGELOG already has a section for v1.0.0');
    refused(['--tag', '1.0.0', '--notes', 'notes.md'], '"1.0.0" is not a tag like v1.2.3');
    refused(['--tag', 'v1.0', '--notes', 'notes.md'], '"v1.0" is not a tag like v1.2.3');
    refused(['--tag', 'v1.0.0\n## [v9.9.9]', '--notes', 'notes.md'], '"v1.0.0\\n## [v9.9.9]" is not a tag like v1.2.3');
    refused(['--tag', 'v1.1.0', '--notes', 'notes.md', '--date', '17.11.2026'], '"17.11.2026" is not a date like 2026-11-17');
    refused(['--tag', 'v1.1.0', '--notes', 'none.md'], 'none.md: cannot be read (ENOENT)');
    refused(['--tag', 'v1.1.0', '--notes', 'empty.md'], 'empty.md: has no notes');
    assert.equal(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'), before);
  });

  test('a changelog that cannot be written is refused with the reason', () => {
    const dir = folder({ 'notes.md': '- a\n' });
    fs.mkdirSync(path.join(dir, 'CHANGELOG.md'));
    const got = run(['--tag', 'v1.0.0', '--notes', 'notes.md'], { cwd: dir });
    assert.equal(got.code, 1);
    assert.match(got.stderr, /^update-changelog: EISDIR/);
  });

  test('wrong usage prints the usage and exits 2', () => {
    const wrong = [[], ['--tag'], ['--tag', 'v1.0.0'], ['--notes', 'n.md'], ['--tag', 'v1.0.0', '--notes'], ['--tag', 'v1.0.0', '--notes', 'n.md', '--tag', 'v1.0.1'], ['--tag', 'v1.0.0', '--notes', 'n.md', 'x'],
      ['--tag', 'v1.0.0', '--notes', 'n.md', '--other', 'x'], ['--help']];
    for (const argv of wrong) assert.deepEqual(run(argv, { cwd: scratch }), { code: 2, stdout: '', stderr: USAGE }, argv.join(' '));
  });

  test('as a program, also through a link', () => {
    const dir = folder({ 'notes.md': '- a\n' });
    const got = spawnSync(process.execPath, [tool, '--tag', 'v1.0.0', '--notes', 'notes.md', '--date', '2026-11-17'], { cwd: dir, encoding: 'utf8' });
    assert.deepEqual([got.status, got.stdout, got.stderr], [0, 'added v1.0.0 to CHANGELOG.md\n', '']);
    const link = path.join(scratch, 'linked-changelog-tool.mjs');
    fs.symlinkSync(tool, link);
    const again = spawnSync(process.execPath, [link, '--tag', 'v1.0.0', '--notes', 'notes.md'], { cwd: dir, encoding: 'utf8' });
    assert.deepEqual([again.status, again.stdout], [1, '']);
    assert.match(again.stderr, /already has a section/);
    assert.equal(spawnSync(process.execPath, [tool], { cwd: dir }).status, 2);
  });
});

describe('the changelog of this repository', () => {
  test('is a changelog that the tool can add to', () => {
    const text = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    assert.ok(text.startsWith('# Changelog\n'));
    assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
    assert.doesNotThrow(() => addRelease(text, args('v0.0.1')));
  });
});
