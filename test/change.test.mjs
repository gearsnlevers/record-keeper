// Checking a change (docs/checking-a-change.md): the cases of test/fixtures/change, the named tests of the design, and the command
// `check-pr`. The repositories are built with `git fast-import`, so nothing is checked out and links and modes can be committed freely.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CHANGE_RULES, FORMAT_RULES, PIN_PATH, SETTINGS_PATH, Unreadable, checkChange, run, seal } from '../record-keeper.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { trees, cases } = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/change/cases.json'), 'utf8'));
const page = fs.readFileSync(path.join(root, 'docs/checking-a-change.md'), 'utf8');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'record-keeper-change-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const CLEAN = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
const git = (cwd, args, input) => {
  const result = spawnSync('git', args, { cwd, input, env: { ...CLEAN, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
};

const GITLINK = '0123456789012345678901234567890123456789';
const data = (bytes) => Buffer.concat([Buffer.from(`data ${bytes.length}\n`), bytes, Buffer.from('\n')]);

/** A tree is a Map path -> [mode, content]. */
function treeOf(files) {
  return new Map(files.map((f) => [f.path, f.link !== undefined ? ['120000', f.link] : ['100644', f.content]]));
}

function applyChanges(tree, changes) {
  const out = new Map(tree);
  for (const change of changes) {
    if (change.write !== undefined) out.set(change.write, [change.mode ?? '100644', change.content]);
    else if (change.remove !== undefined) out.delete(change.remove);
    else if (change.symlink !== undefined) out.set(change.symlink, ['120000', change.target]);
    else if (change.submodule !== undefined) out.set(change.submodule, ['160000', GITLINK]);
    else throw new Error(`unknown change ${JSON.stringify(change)}`);
  }
  for (const entryPath of [...out.keys()]) {
    const parts = entryPath.split('/');
    for (let i = 1; i < parts.length; i++) out.delete(parts.slice(0, i).join('/'));
  }
  return out;
}

function commitStream(ref, tree, parent) {
  const stream = [Buffer.from(`commit refs/heads/${ref}\ncommitter T <t@example.com> 0 +0000\n`), data(Buffer.from('case'))];
  if (parent) stream.push(Buffer.from(`from refs/heads/${parent}\n`));
  stream.push(Buffer.from('deleteall\n'));
  for (const [entryPath, [mode, content]] of [...tree].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (mode === '160000') stream.push(Buffer.from(`M 160000 ${content} ${entryPath}\n`));
    else stream.push(Buffer.from(`M ${mode} inline ${entryPath}\n`), data(Buffer.from(content)));
  }
  return Buffer.concat(stream);
}

/** A bare repository with the base b<i> and the head h<i> of case i; the head is on top of the base unless the case says otherwise. */
function buildRepo(dir, list) {
  git(scratch, ['init', '-q', '--bare', dir]);
  const stream = [];
  list.forEach((c, i) => {
    const before = treeOf(trees[c.base]);
    const after = applyChanges(before, c.changes);
    if (c.parent === 'ahead') stream.push(commitStream(`h${i}`, after), commitStream(`b${i}`, before, `h${i}`));
    else if (c.parent === 'none') stream.push(commitStream(`b${i}`, before), commitStream(`h${i}`, after));
    else if (c.parent === 'same') stream.push(commitStream(`b${i}`, before), commitStream(`h${i}`, before, `b${i}`));
    else stream.push(commitStream(`b${i}`, before), commitStream(`h${i}`, after, `b${i}`));
  });
  git(dir, ['fast-import', '--quiet'], Buffer.concat(stream));
}

// The detail of a V rule only helps the reader; the other rules have an answer that includes it.
const withDetail = (rule) => /^(?:P-0[2-7]|T-0[23])$/.test(rule);
const shownProblem = ({ file, rule, detail }) => ({ file, rule, ...(withDetail(rule) && detail ? { detail } : {}) });
const shownSetting = ({ line, rule, detail }) => ({ line: line ?? null, rule, ...(detail ? { detail } : {}) });
const shown = (got) => ({ settings: got.settings.map(shownSetting), problems: got.problems.map(shownProblem), acts: got.acts });

let big;
before(() => {
  big = path.join(scratch, 'big.git');
  buildRepo(big, cases);
});

describe('the cases of the page', () => {
  cases.forEach((c, i) => {
    const rules = c.expect.problems.map((e) => e.rule).concat(c.expect.settings.map((e) => e.rule), c.expect.acts.map((e) => `act ${e.kind}`));
    test(`${c.id}: ${rules.length === 0 ? 'nothing' : rules.join(' ')}`, () => {
      assert.deepEqual(shown(checkChange(big, `b${i}`, `h${i}`)), c.expect, c.note);
    });
  });

  test('every rule of the page is shown by a case, and every act', () => {
    const rules = new Set(cases.flatMap((c) => c.expect.problems.map((e) => e.rule)));
    for (const rule of Object.keys(CHANGE_RULES)) assert.ok(rules.has(rule), `${rule} has no case`);
    const acts = new Set(cases.flatMap((c) => c.expect.acts.map((e) => e.kind)));
    assert.deepEqual([...acts].sort(), ['accept', 'pin', 'settings']);
    const settings = new Set(cases.flatMap((c) => c.expect.settings.map((e) => e.rule)));
    assert.ok(settings.size >= 3);
  });

  test('the ids of the cases are unique', () => {
    assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
  });
});

describe('the page and the code', () => {
  test('the rules in the table of the page are the rules of the code', () => {
    const table = [...page.matchAll(/^\| (P-\d\d) \|/gm)].map((m) => m[1]);
    assert.deepEqual(table, Object.keys(CHANGE_RULES));
  });

  test('the paths of the acts are the ones of the page', () => {
    assert.ok(page.includes(`\`${SETTINGS_PATH}\``));
    assert.ok(page.includes(`\`${PIN_PATH}\``));
  });
});

describe('the named tests of the design', () => {
  const at = (id) => cases.findIndex((c) => c.id === id);

  test('two pull requests that replace one record: the first passes alone, the second fails once the first is in the base', () => {
    const first = checkChange(big, `b${at('g01-first-supersession-alone')}`, `h${at('g01-first-supersession-alone')}`);
    assert.deepEqual(first.problems, []);
    assert.equal(first.acts.length, 1);
    for (const id of ['g02-second-supersession-updated', 'g03-second-supersession-without-flip']) {
      const got = checkChange(big, `b${at(id)}`, `h${at(id)}`);
      assert.ok(got.problems.some(({ rule }) => rule === 'P-05'), id);
    }
  });

  test('the second pull request, not updated, fails because the base is not under the head', () => {
    const got = checkChange(big, `b${at('g04-second-supersession-stale')}`, `h${at('g04-second-supersession-stale')}`);
    assert.deepEqual(got.problems.map(({ rule }) => rule), ['P-09']);
  });

  test('two changes that are valid alone and combine into an invalid tree are caught when the second is judged against the first', () => {
    const [b, h] = [`b${at('g02-second-supersession-updated')}`, `h${at('g02-second-supersession-updated')}`];
    assert.ok(checkChange(big, b, h).problems.length > 0);
  });
});

describe('reading the commits', () => {
  test('the working tree, the index and a stash take no part', () => {
    const work = path.join(scratch, 'work');
    git(scratch, ['clone', '-q', big, work]);
    const i = cases.findIndex((c) => c.id === 'a05-new-proposed');
    git(work, ['checkout', '-q', '--detach', `origin/h${i}`]);
    const expected = shown(checkChange(work, `origin/b${i}`, `origin/h${i}`));
    fs.writeFileSync(path.join(work, 'docs/decisions/0001-first.md'), 'edited in the work tree\n');
    fs.writeFileSync(path.join(work, 'docs/decisions/0099-new.md'), 'untracked\n');
    git(work, ['add', 'docs/decisions/0001-first.md']);
    assert.deepEqual(shown(checkChange(work, `origin/b${i}`, `origin/h${i}`)), expected);
  });

  test('the caller\'s git environment takes no part', () => {
    const i = cases.findIndex((c) => c.id === 'd02-delete-proposed');
    const saved = { GIT_DIR: process.env.GIT_DIR, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE };
    process.env.GIT_DIR = path.join(scratch, 'elsewhere');
    process.env.GIT_INDEX_FILE = path.join(scratch, 'index');
    try {
      assert.deepEqual(checkChange(big, `b${i}`, `h${i}`).problems.map(({ rule }) => rule), ['V-08', 'P-01']);
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  test('a revision that names no commit, and a folder that is no repository, are not a problem of the records', () => {
    assert.throws(() => checkChange(big, 'no-such-branch', 'h0'), Unreadable);
    assert.throws(() => checkChange(big, 'b0', 'no-such-branch'), Unreadable);
    assert.throws(() => checkChange(scratch, 'b0', 'h0'), Unreadable);
    assert.throws(() => checkChange(big, '-x', 'h0'), Unreadable);
  });

  test('a change in a repository with many records takes a moment, not a minute', () => {
    const records = new Map();
    for (let n = 1; n <= 400; n++) {
      const text = `---\nstatus: accepted\ndate: 2026-10-01\ndecision-makers:\n  - maintainers\n---\n\n# The ${n} decision\n\n## Context and problem statement\n\nWhy ${n}.\n\n## Decision\n\n- Rule ${n}.\n\n## Consequences\n\n- Effect ${n}.\n`;
      const sealed = text.replace('---\n\n#', `seal: ${seal(Buffer.from(text))}\n---\n\n#`);
      records.set(`docs/decisions/${String(n).padStart(4, '0')}-record.md`, ['100644', sealed]);
    }
    const before = new Map([...records, ['docs/decisions/README.md', ['100644', '# R\n\n## Index\n\n| # | Title | Status |\n| - | - | - |\n']], ['docs/decisions/template.md', ['100644', 'x\n']]]);
    const after = new Map(before);
    after.set('src/a.js', ['100644', 'x\n']);
    const repo = path.join(scratch, 'many.git');
    git(scratch, ['init', '-q', '--bare', repo]);
    git(repo, ['fast-import', '--quiet'], Buffer.concat([commitStream('b', before), commitStream('h', after, 'b')]));
    const started = Date.now();
    const got = checkChange(repo, 'b', 'h');
    assert.ok(Date.now() - started < 8000, `took ${Date.now() - started} ms`);
    assert.deepEqual(got, { folder: 'docs/decisions', settings: [], problems: [], acts: [] });
  });
});

describe('the command check-pr', () => {
  const at = (id) => cases.findIndex((c) => c.id === id);
  const go = (id, extra = []) => run(['check-pr', '--repo', big, '--base', `b${at(id)}`, '--head', `h${at(id)}`, ...extra]);

  test('no problem and no act: exit 0, the count on the standard output', () => {
    const got = go('a05-new-proposed');
    assert.deepEqual(got, { code: 0, stdout: 'docs/decisions: 0 problems\n', stderr: '' });
  });

  test('a problem: exit 1, one line each on the error output, then the count', () => {
    const got = go('d02-delete-proposed');
    assert.equal(got.code, 1);
    assert.equal(got.stdout, '');
    assert.equal(
      got.stderr,
      `docs/decisions: [V-08] ${FORMAT_RULES['V-08']}\n`
        + `docs/decisions/0003-third.md: [P-01] ${CHANGE_RULES['P-01']}\n`
        + 'docs/decisions: 2 problems\n',
    );
  });

  test('a detail is shown in brackets, and a problem of the settings comes first, with its line', () => {
    const got = go('k04-repair-incomplete');
    assert.equal(got.code, 1);
    assert.match(got.stderr, new RegExp(`^${SETTINGS_PATH.replaceAll('.', '\\.')}:1: \\[S-05\\] .*\\(owners\\)\\n${SETTINGS_PATH.replaceAll('.', '\\.')}:2: \\[S-05\\]`));
    const second = go('d09-trailing-space');
    assert.match(second.stderr, /docs\/decisions\/0002-second\.md: \[P-02\] is sealed and its text has changed \(line 17\)\n/);
  });

  test('an act alone fails the command until the approvals can be checked', () => {
    const got = go('c01-new-accepted-record');
    assert.equal(got.code, 1);
    assert.equal(got.stdout, '');
    assert.equal(got.stderr, "docs/decisions/0007-seventh.md: needs the owners' approval (accept)\ndocs/decisions: 0 problems, 1 act\n");
  });

  test('problems and several acts are counted together', () => {
    const got = go('f01-lists-without-flipping');
    assert.match(got.stderr, /1 problem, 1 act\n$/);
    const two = go('c11-new-superseded-record');
    assert.match(two.stderr, /0 problems, 2 acts\n$/);
  });

  test('a stale head is P-09 and prints the folder', () => {
    const got = go('h01-unrelated-commits');
    assert.equal(got.code, 1);
    assert.equal(got.stderr, `docs/decisions: [P-09] ${CHANGE_RULES['P-09']}\ndocs/decisions: 1 problem\n`);
  });

  test('the folder of the settings of the base is the one printed', () => {
    const got = go('k12-folder-in-the-settings-of-the-base');
    assert.equal(got.stdout, 'records: 0 problems\n');
  });

  test('wrong usage and unreadable input exit 2', () => {
    const i = at('a05-new-proposed');
    for (const args of [
      ['check-pr'],
      ['check-pr', '--base', 'b0'],
      ['check-pr', '--head', 'h0'],
      ['check-pr', '--base', 'b0', '--head', 'h0', 'extra'],
      ['check-pr', '--base', 'b0', '--head', 'h0', '--unknown', 'x'],
      ['check-pr', '--base', '--head', 'h0'],
    ]) {
      const got = run(args);
      assert.equal(got.code, 2, args.join(' '));
      assert.match(got.stderr, /^Usage:/);
    }
    for (const args of [['--base', 'nothing', '--head', `h${i}`], ['--base', `b${i}`, '--head', 'nothing']]) {
      const got = run(['check-pr', '--repo', big, ...args]);
      assert.equal(got.code, 2);
      assert.match(got.stderr, /^record-keeper: /);
    }
    assert.equal(run(['check-pr', '--repo', scratch, '--base', 'b0', '--head', 'h0']).code, 2);
  });

  test('the last of repeated options wins, as for validate', () => {
    const i = at('d02-delete-proposed');
    const got = run(['check-pr', '--base', 'b0', '--head', 'h0', '--repo', scratch, '--base', `b${i}`, '--head', `h${i}`, '--repo', big]);
    assert.equal(got.code, 1);
  });

  test('the usage text lists the command', () => {
    assert.match(run(['--help']).stdout, /check-pr --base <revision> --head <revision>/);
  });

  test('a file name that is not plain text is written escaped, so that it cannot start a line or a command in a log', () => {
    const repo = path.join(scratch, 'names.git');
    git(scratch, ['init', '-q', '--bare', repo]);
    const base = new Map(treeOf(trees.world));
    const head = new Map(base);
    head.set('docs/decisions/x\n::error::boom\u202e.md', ['100644', 'x\n']);
    const quote = (name) => `"${[...Buffer.from(name)].map((b) => (b === 0x0a ? '\\n' : b === 0x22 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b < 0x20 || b > 0x7e ? `\\${b.toString(8).padStart(3, '0')}` : String.fromCharCode(b))).join('')}"`;
    const stream = (ref, tree, parent) => {
      const out = [Buffer.from(`commit refs/heads/${ref}\ncommitter T <t@example.com> 0 +0000\n`), data(Buffer.from('c'))];
      if (parent) out.push(Buffer.from(`from refs/heads/${parent}\n`));
      out.push(Buffer.from('deleteall\n'));
      for (const [entryPath, [mode, content]] of tree) out.push(Buffer.from(`M ${mode} inline ${quote(entryPath)}\n`), data(Buffer.from(content)));
      return Buffer.concat(out);
    };
    git(repo, ['fast-import', '--quiet'], Buffer.concat([stream('b', base), stream('h', head, 'b')]));
    const got = run(['check-pr', '--repo', repo, '--base', 'b', '--head', 'h']);
    assert.equal(got.code, 1);
    assert.equal(got.stderr.split('\n').filter((line) => line.startsWith('::')).length, 0);
    assert.match(got.stderr, /x\\u\{a\}::error::boom\\u\{202e\}\.md: \[V-05\]/);
    const validated = run(['validate', '--commit', 'h', '--repo', repo]);
    assert.equal(validated.stderr.split('\n').filter((line) => line.startsWith('::')).length, 0);
    assert.match(validated.stderr, /x\\u\{a\}::error::boom\\u\{202e\}\.md: \[V-05\]/);
  });

  test('a real process: the exit code and the streams', () => {
    const i = at('d02-delete-proposed');
    const result = spawnSync(process.execPath, [path.join(root, 'record-keeper.mjs'), 'check-pr', '--repo', big, '--base', `b${i}`, '--head', `h${i}`], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /\[P-01\]/);
  });
});
