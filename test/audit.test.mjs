// The audit (docs/audit.md): the histories of test/fixtures/audit, rebuilt with git fast-import, and the command `audit`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AUDIT_RULES, Unreadable, audit, run } from '../record-keeper.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { histories } = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/audit/cases.json'), 'utf8'));
const page = fs.readFileSync(path.join(root, 'docs/audit.md'), 'utf8');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'record-keeper-audit-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const CLEAN = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
const git = (cwd, args, input) => {
  const result = spawnSync('git', args, { cwd, input, env: { ...CLEAN, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.toString('utf8').trim();
};
const data = (text) => Buffer.concat([Buffer.from(`data ${Buffer.byteLength(text)}\n`), Buffer.from(text), Buffer.from('\n')]);
const GITLINK = '0123456789012345678901234567890123456789';

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

function stream(label, tree, message, parents) {
  const out = [Buffer.from(`commit refs/heads/${label}\ncommitter T <t@example.com> 0 +0000\n`), data(message)];
  if (parents.length > 0) out.push(Buffer.from(`from refs/heads/${parents[0]}\n${parents.slice(1).map((other) => `merge refs/heads/${other}\n`).join('')}`));
  out.push(Buffer.from('deleteall\n'));
  for (const [entryPath, [mode, content]] of [...tree].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (mode === '160000') out.push(Buffer.from(`M 160000 ${content} ${entryPath}\n`));
    else out.push(Buffer.from(`M ${mode} inline ${entryPath}\n`), data(content));
  }
  return Buffer.concat(out);
}

/** Builds the repository of a history; returns { repo, ids } with the id of each commit by its label. */
function build(history) {
  const repo = path.join(scratch, `${history.id}.git`);
  git(scratch, ['init', '-q', '--bare', repo]);
  const trees = new Map();
  const ids = {};
  for (const commit of history.commits) {
    const before = commit.parents.length > 0 ? trees.get(commit.parents[0]) : new Map();
    trees.set(commit.id, applyChanges(before, commit.changes));
    git(repo, ['fast-import', '--quiet'], stream(commit.id, trees.get(commit.id), commit.message, commit.parents));
    ids[commit.id] = git(repo, ['rev-parse', commit.id]);
  }
  return { repo, ids };
}

const fillIds = (text, ids) => text.replace(/@([a-z0-9]+)@/g, (_, label) => ids[label]);
/** The option of a history (a label, @label@, or a literal id) as the id. */
const resolve = (value, ids) => (value === null || value === undefined ? undefined : /^@.+@$/.test(value) ? ids[value.slice(1, -1)] : (ids[value] ?? value));
const labelOf = (ids, id) => Object.keys(ids).find((label) => ids[label] === id);

const built = new Map();
before(() => {
  for (const history of histories) built.set(history.id, build(history));
});

describe('the histories of the page', () => {
  for (const history of histories) {
    test(`${history.id}: ${history.expect.violations.map((v) => v.rule).join(' ') || 'nothing'}`, () => {
      const { repo, ids } = built.get(history.id);
      const head = ids[history.head ?? history.commits.at(-1).id];
      const got = audit(repo, head, { from: resolve(history.from, ids), since: resolve(history.since, ids) });
      const swap = (text) => text.replace(/\b[0-9a-f]{40}\b/g, (id) => (labelOf(ids, id) ? `@${labelOf(ids, id)}@` : id));
      const at = (violation) => ({ commit: labelOf(ids, violation.commit), kind: violation.kind, file: violation.file, rule: violation.rule, detail: /^V-/.test(violation.rule) ? '' : swap(violation.detail), ...(violation.line ? { line: violation.line } : {}) });
      assert.equal(got.judged, history.expect.judged, history.note);
      assert.deepEqual(got.violations.map(at), history.expect.violations, history.note);
      assert.deepEqual(got.excused.map((violation) => ({ ...at(violation), note: { ...violation.note, case: swap(violation.note.case) } })), history.expect.excused, history.note);
      assert.deepEqual(got.acts.map((act) => ({ commit: labelOf(ids, act.commit), kind: act.kind, path: act.path, pull: act.pull })), history.expect.acts, history.note);
      assert.deepEqual(got.cases.map((cited) => ({ commit: labelOf(ids, cited.commit), kind: cited.kind, number: cited.number })), history.expect.cases, history.note);
      assert.equal(got.head, head);
    });
  }

  test('the ids of the histories are unique', () => {
    assert.equal(new Set(histories.map((h) => h.id)).size, histories.length);
  });

  test('every rule of the audit is shown by a history', () => {
    const rules = new Set(histories.flatMap((h) => h.expect.violations.concat(h.expect.excused).map((v) => v.rule)));
    for (const rule of Object.keys(AUDIT_RULES)) if (rule !== 'A-03') assert.ok(rules.has(rule), rule); // A-03 needs evidence: test/fixtures/audit-effects
    const kinds = new Set(histories.flatMap((h) => h.expect.violations.map((v) => v.kind)));
    assert.deepEqual([...kinds].sort(), ['commit', 'history', 'register', 'state']);
  });

  test('the rules of the audit are on the page', () => {
    for (const rule of Object.keys(AUDIT_RULES)) assert.ok(page.includes(`| ${rule} |`), rule);
  });
});

describe('the command audit', () => {
  const history = (id) => {
    const { repo, ids } = built.get(id);
    const meta = histories.find((h) => h.id === id);
    const options = [];
    if (meta.from) options.push('--from', resolve(meta.from, ids));
    if (meta.since) options.push('--since', resolve(meta.since, ids));
    return { args: ['audit', '--repo', repo, '--head', ids[meta.head ?? meta.commits.at(-1).id], ...options], ids, repo };
  };

  test('no violation: exit 0, the count on the standard output', () => {
    assert.deepEqual(run(history('h02-from-the-first-commit').args), { code: 0, stdout: 'audit: 0 violations, 0 excused, 2 commits judged\n', stderr: '' });
    assert.deepEqual(run(history('h26-since-is-the-head').args).stderr.split('\n').at(-2), 'audit: 1 violation, 0 excused, 0 commits judged');
  });

  test('a violation of a record: the first twelve digits of the commit, the path, the rule, what is wrong and the detail', () => {
    const { args, ids } = history('h03-direct-edit-of-a-sealed-record');
    const got = run(args);
    assert.equal(got.code, 1);
    assert.equal(got.stdout, '');
    assert.equal(got.stderr, `${ids.c1.slice(0, 12)}: docs/decisions/0002-second.md: [P-02] is sealed and its text has changed (line 17)\n`
      + `${ids.c1.slice(0, 12)}: docs/decisions/0002-second.md: [P-06] says it is accepted and has no seal that verifies (seal does not match)\n`
      + 'audit: 2 violations, 0 excused, 1 commit judged\n');
  });

  test('a violation with no record names the folder; one of the settings names the file and the line; the tip and the history have their own words', () => {
    const folder = run(history('h30-a-workflow-that-names-the-check').args);
    assert.match(folder.stderr, /^[0-9a-f]{12}: docs\/decisions: \[P-15\] .*\(\.github\/workflows\/fake\.yml\)\n/);
    const settings = run(history('h29-a-problem-of-the-settings').args);
    assert.match(settings.stderr, /^[0-9a-f]{12}: \.github\/record-keeper\/settings\.yml:1: \[S-05\] .*\(witnesses\)\n/);
    const tip = run(history('h25-since-skips-the-commits-up-to-it').args);
    assert.match(tip.stderr, /^tip: docs\/decisions\/0002-second\.md: \[P-19\] is accepted and has an applies-to item that no file matches \(README\.md\)\n/);
    const rewritten = run(history('h10-the-start-is-unknown').args);
    assert.match(rewritten.stderr, new RegExp(`^history: docs/decisions: \\[A-01\\] ${AUDIT_RULES['A-01'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(from 1{40}\\)\\n`));
  });

  test('an excused violation is counted apart and not printed', () => {
    const got = run(history('h13-excused-by-the-commit').args);
    assert.deepEqual(got, { code: 0, stdout: 'audit: 0 violations, 1 excused, 2 commits judged\n', stderr: '' });
  });

  test('wrong usage and unreadable input exit 2', () => {
    const { repo, ids } = history('h01-clean-history-judged-from-the-root');
    const head = ids.c2;
    const cases = [
      ['audit'], ['audit', '--repo', repo], ['audit', '--head'], ['audit', '--repo', repo, '--head', head, 'extra'], ['audit', '--repo', repo, '--head', head, '--wat', 'x'],
      ['audit', '--repo', repo, '--head', head, '--from', 'abc'], ['audit', '--repo', repo, '--head', head, '--from', ids.c0.toUpperCase()], ['audit', '--repo', repo, '--head', head, '--since', ids.c0.slice(1)],
      ['audit', '--repo', repo, '--head', head, '--since', `${ids.c0}0`], ['audit', '--repo', repo, '--head', head, '--from', 'main'], ['audit', '--repo', repo, '--head', head, '--from', ''],
    ];
    for (const args of cases) {
      const got = run(args);
      assert.equal(got.code, 2, args.join(' '));
      assert.match(got.stderr, /^Usage:/, args.join(' '));
    }
    for (const bad of ['no-such-branch', '-x', '']) {
      const got = run(['audit', '--repo', repo, '--head', bad]);
      assert.equal(got.code, 2, bad);
      assert.match(got.stderr, /^record-keeper: |^Usage:/, bad);
    }
    assert.equal(run(['audit', '--repo', scratch, '--head', 'HEAD']).code, 2);
    assert.throws(() => audit(scratch, 'HEAD'), Unreadable);
  });

  test('a commit id is forty or sixty-four lower case hexadecimal digits: digits only, letters only, and both are ids', () => {
    const { repo, ids } = history('h01-clean-history-judged-from-the-root');
    for (const id of ['1'.repeat(40), 'a'.repeat(40), 'f0'.repeat(20), '1'.repeat(64), 'a'.repeat(64), '9f'.repeat(32)]) {
      for (const option of ['--from', '--since']) {
        const got = run(['audit', '--repo', repo, '--head', ids.c2, option, id]);
        assert.equal(got.code, 1, `${option} ${id}`);
        assert.match(got.stderr, new RegExp(`^history: .*\\[A-01\\].*\\(${option.slice(2)} ${id}\\)\n`), `${option} ${id}`);
      }
    }
    for (const id of ['1'.repeat(39), '1'.repeat(41), '1'.repeat(63), '1'.repeat(65), `${'1'.repeat(39)}g`, `${'1'.repeat(39)}A`, `${'1'.repeat(39)}-`, ` ${'1'.repeat(40)}`]) {
      assert.equal(run(['audit', '--repo', repo, '--head', ids.c2, '--from', id]).code, 2, id);
    }
  });

  test('a shallow clone cannot be audited: its first commit would look like one that adds everything', () => {
    const { repo, ids } = history('h01-clean-history-judged-from-the-root');
    const clone = path.join(scratch, 'shallow');
    git(scratch, ['clone', '-q', '--depth', '1', '--branch', 'c2', `file://${repo}`, clone]);
    const got = run(['audit', '--repo', clone, '--head', 'HEAD']);
    assert.equal(got.code, 2);
    assert.equal(got.stderr, 'record-keeper: the repository is a shallow clone: the audit needs the whole history\n');
    assert.ok(ids.c2);
  });

  test('the usage text lists the command', () => {
    assert.match(run(['--help']).stdout, /record-keeper\.mjs audit --head <revision> \[--from <commit> \| --adopted\] \[--since <commit>\]/);
  });

  test('a real process: the exit code and the streams', () => {
    const { args } = history('h03-direct-edit-of-a-sealed-record');
    const result = spawnSync(process.execPath, [path.join(root, 'record-keeper.mjs'), ...args], { env: CLEAN });
    assert.equal(result.status, 1);
    assert.match(result.stderr.toString(), /\[P-02\].*\n.*\[P-06\].*\naudit: 2 violations, 0 excused, 1 commit judged\n$/);
    const clean = spawnSync(process.execPath, [path.join(root, 'record-keeper.mjs'), ...history('h02-from-the-first-commit').args], { env: CLEAN });
    assert.equal(clean.status, 0);
  });

  test('the repository is not changed: no object, no ref', () => {
    const { repo, args } = history('h13-excused-by-the-commit');
    const before = git(repo, ['count-objects', '-v']) + git(repo, ['for-each-ref']);
    run(args);
    assert.equal(git(repo, ['count-objects', '-v']) + git(repo, ['for-each-ref']), before);
  });
});
