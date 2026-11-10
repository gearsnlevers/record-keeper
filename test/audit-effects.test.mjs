// The effects of the audit (docs/audit-effects.md): the cases of test/fixtures/audit-effects, rebuilt with git fast-import, and the commands
// `audit-plan` and `audit` with `--adopted`, `--evidence` and `--json`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AUDIT_RULES, Unreadable, audit, findAdoption, planAudit, readEvidence, readIssues, run } from '../record-keeper.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { cases } = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/audit-effects/cases.json'), 'utf8'));
const page = fs.readFileSync(path.join(root, 'docs/audit-effects.md'), 'utf8');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'record-keeper-audit-effects-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const CLEAN = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
const git = (cwd, args, input) => {
  const result = spawnSync('git', args, { cwd, input, env: { ...CLEAN, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.toString('utf8').trim();
};
const data = (text) => Buffer.concat([Buffer.from(`data ${Buffer.byteLength(text)}\n`), Buffer.from(text), Buffer.from('\n')]);

function applyChanges(tree, changes) {
  const out = new Map(tree);
  for (const change of changes) {
    if (change.write !== undefined) out.set(change.write, [change.mode ?? '100644', change.content]);
    else if (change.remove !== undefined) out.delete(change.remove);
    else if (change.symlink !== undefined) out.set(change.symlink, ['120000', change.target]);
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
  for (const [entryPath, [mode, content]] of [...tree].sort((a, b) => (a[0] < b[0] ? -1 : 1))) out.push(Buffer.from(`M ${mode} inline ${entryPath}\n`), data(content));
  return Buffer.concat(out);
}

/** Builds the repository of a case; returns { repo, ids } with the id of each commit by its label. */
function build(c) {
  const repo = path.join(scratch, `${c.id}.git`);
  git(scratch, ['init', '-q', '--bare', repo]);
  const trees = new Map();
  const ids = {};
  const fill = (text) => text.replace(/@([a-z0-9]+)@/g, (_, label) => ids[label]);
  for (const commit of c.commits) {
    const before = commit.parents.length > 0 ? trees.get(commit.parents[0]) : new Map();
    const changes = commit.changes.map((change) => (change.content === undefined ? change : { ...change, content: fill(change.content) }));
    trees.set(commit.id, applyChanges(before, changes));
    git(repo, ['fast-import', '--quiet'], stream(commit.id, trees.get(commit.id), fill(commit.message), commit.parents));
    ids[commit.id] = git(repo, ['rev-parse', commit.id]);
  }
  return { repo, ids };
}

const built = new Map();
before(() => {
  for (const c of cases) built.set(c.id, build(c));
});

const fillWith = (ids) => (text) => text.replace(/@([a-z0-9]+)@/g, (_, label) => ids[label]);
const resolve = (value, ids) => (value === null || value === undefined ? undefined : /^@.+@$/.test(value) ? ids[value.slice(1, -1)] : (ids[value] ?? value));

/** The arguments of audit-plan for a case, with the files it needs written into the scratch folder. */
function planArguments(c) {
  const { repo, ids } = built.get(c.id);
  const fill = fillWith(ids);
  const folder = fs.mkdtempSync(path.join(scratch, 'files-'));
  const args = ['audit-plan', '--repo', repo, '--head', ids[c.head ?? c.commits.at(-1).id]];
  if (c.adopted) args.push('--adopted');
  if (c.from) args.push('--from', resolve(c.from, ids));
  if (c.since) args.push('--since', resolve(c.since, ids));
  const files = {};
  if (c.evidence !== undefined || c.evidenceRaw !== undefined || c.evidenceHex !== undefined) {
    files.evidence = path.join(folder, 'evidence.json');
    fs.writeFileSync(files.evidence, c.evidenceHex !== undefined ? Buffer.from(c.evidenceHex, 'hex') : fill(c.evidenceRaw ?? JSON.stringify(c.evidence)));
    args.push('--evidence', files.evidence);
  }
  files.issues = path.join(folder, 'issues.json');
  fs.writeFileSync(files.issues, fill(c.issuesRaw ?? JSON.stringify(c.issues ?? [])));
  args.push('--issues', files.issues, '--now', c.now);
  return { args, ids, files };
}

describe('the plans of the page', () => {
  for (const c of cases) {
    test(`${c.id}: ${c.expect.code === 2 ? 'unreadable' : c.expect.plan.failed ? `${c.expect.plan.run.violations} violation${c.expect.plan.run.violations === 1 ? '' : 's'}` : 'nothing found'}`, () => {
      const { args, ids, files } = planArguments(c);
      const fill = fillWith(ids);
      const got = run(args);
      assert.equal(got.code, c.expect.code, c.note);
      if (c.expect.code === 2) {
        const text = c.expect.message !== undefined ? fill(c.expect.message) : `${files[c.expect.file]}: ${fill(c.expect.reason)}`;
        assert.equal(got.stderr, `record-keeper: ${text}\n`, c.note);
        assert.equal(got.stdout, '');
        return;
      }
      assert.equal(got.stderr, '');
      const plan = JSON.parse(got.stdout);
      assert.deepEqual(plan, JSON.parse(fill(JSON.stringify(c.expect.plan))), c.note);
      assert.equal(got.stdout, `${JSON.stringify(plan)}\n`, 'one line of JSON without white space between the tokens');
    });
  }

  test('the ids of the cases are unique', () => {
    assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
  });

  test('every action, every event and every kind of place is shown, and so is a failure and a success', () => {
    const plans = cases.filter((c) => c.expect.code === 0).map((c) => c.expect.plan);
    assert.deepEqual([...new Set(plans.flatMap((p) => p.issues.map((i) => i.action)))].sort(), ['close', 'open', 'reopen', 'update']);
    assert.deepEqual([...new Set(plans.flatMap((p) => p.log.map((l) => l.event)))].sort(), ['changed', 'closed', 'opened', 'reopened']);
    assert.deepEqual([...new Set(plans.flatMap((p) => p.log.flatMap((l) => l.violations.map((v) => v.kind))))].sort(), ['commit', 'history', 'state']);
    assert.deepEqual([...new Set(plans.map((p) => p.failed))].sort(), [false, true]);
    assert.ok(plans.some((p) => p.log.some((l) => l.duplicate !== undefined)));
    assert.ok(plans.some((p) => p.run.from === null));
    assert.ok(plans.some((p) => p.run.excused > 0));
    assert.ok(AUDIT_RULES['A-03']);
    assert.ok(plans.some((p) => p.log.some((l) => l.violations.some((v) => v.rule === 'A-03'))));
  });

  test('the keys of a plan, of its run and of its actions come in the order of the page', () => {
    const plan = JSON.parse(run(planArguments(cases.find((c) => c.id === 'e03-two-violations-two-issues')).args).stdout);
    assert.deepEqual(Object.keys(plan), ['run', 'failed', 'issues', 'log']);
    assert.deepEqual(Object.keys(plan.run), ['at', 'head', 'from', 'judged', 'violations', 'excused']);
    assert.deepEqual(Object.keys(plan.issues[0]), ['action', 'key', 'title', 'body']);
    assert.deepEqual(Object.keys(plan.log[0]), ['at', 'event', 'key', 'violations']);
    assert.deepEqual(Object.keys(plan.log[0].violations[0]), ['commit', 'kind', 'file', 'rule', 'detail']);
    const reopen = JSON.parse(run(planArguments(cases.find((c) => c.id === 'e07-closed-issues-are-reopened')).args).stdout);
    assert.deepEqual(Object.keys(reopen.issues[0]), ['action', 'key', 'number', 'title', 'body']);
    const close = JSON.parse(run(planArguments(cases.find((c) => c.id === 'e09-duplicates')).args).stdout);
    assert.deepEqual(Object.keys(close.issues[0]), ['action', 'key', 'number', 'body']);
    assert.deepEqual(Object.keys(close.log[0]), ['at', 'event', 'key', 'duplicate', 'violations']);
  });
});

describe('the page and the code agree', () => {
  test('every reason of an unreadable file is on the page', () => {
    for (const c of cases.filter((x) => x.expect.file)) {
      if (/reviews: /.test(c.expect.reason)) continue; // the reasons of a review are those of the approvals page
      const core = c.expect.reason.replace(/^(?:[^ ]+: )?(?:(?:pull|started): )?(?:entry \d+: )?/, '');
      assert.ok(page.includes(core), `${c.id}: ${core}`);
    }
  });

  test('every rule that the page names for acts, and the new rule, are in the table of the audit page', () => {
    const audit = fs.readFileSync(path.join(root, 'docs/audit.md'), 'utf8');
    for (const rule of Object.keys(AUDIT_RULES)) assert.ok(audit.includes(`| ${rule} |`), rule);
    assert.ok(page.includes('A-03'));
  });

  test('the commands are in the usage text', () => {
    const usage = run(['--help']).stdout;
    assert.match(usage, /record-keeper\.mjs audit --head <revision> \[--from <commit> \| --adopted\] \[--since <commit>\] \[--repo <path>\] \[--evidence <file>\] \[--json\]/);
    assert.match(usage, /record-keeper\.mjs audit-plan --head <revision>/);
  });
});

describe('the commands', () => {
  const caseOf = (id) => cases.find((c) => c.id === id);
  const arg = (args, name) => args[args.indexOf(name) + 1];

  test('audit --adopted starts at the commit that adopted the kit, and the result says where', () => {
    const { repo, ids } = built.get('a01-adopted-starts-at-the-settings');
    assert.equal(findAdoption(repo, ids.c3), ids.c2);
    const got = run(['audit', '--repo', repo, '--head', ids.c3, '--adopted']);
    assert.deepEqual(got, { code: 0, stdout: 'audit: 0 violations, 0 excused, 1 commit judged\n', stderr: '' });
    const json = JSON.parse(run(['audit', '--repo', repo, '--head', ids.c3, '--adopted', '--json']).stdout);
    assert.equal(json.from, ids.c2);
    assert.equal(json.judged, 1);
    assert.deepEqual(audit(repo, ids.c3, { from: ids.c2 }), audit(repo, ids.c3, { from: ids.c2 }));
    assert.equal(findAdoption(built.get('a03-no-commit-holds-the-settings').repo, built.get('a03-no-commit-holds-the-settings').ids.c1), null);
  });

  test('audit --json prints the result and exits 0 also when a violation stands', () => {
    const { repo, ids } = built.get('a02-from-the-first-commit-judges-the-same-history');
    const got = run(['audit', '--repo', repo, '--head', ids.c3, '--from', ids.c0, '--json']);
    assert.equal(got.code, 0);
    assert.equal(got.stderr, '');
    const result = JSON.parse(got.stdout);
    assert.deepEqual(Object.keys(result), ['head', 'from', 'folder', 'judged', 'violations', 'excused', 'acts', 'cases']);
    assert.equal(result.violations.length, 2);
    assert.equal(got.stdout, `${JSON.stringify(result)}\n`);
  });

  test('audit with evidence prints A-03 like any other violation, and without evidence does not judge the acts', () => {
    const c = caseOf('b02-no-owner-approved');
    const { args, ids } = planArguments(c);
    const options = ['audit', '--repo', arg(args, '--repo'), '--head', arg(args, '--head'), '--from', ids.c0];
    const without = run(options);
    assert.deepEqual(without, { code: 0, stdout: 'audit: 0 violations, 0 excused, 1 commit judged\n', stderr: '' });
    const withEvidence = run([...options, '--evidence', arg(args, '--evidence')]);
    assert.equal(withEvidence.code, 1);
    assert.equal(withEvidence.stderr, `${ids.c1.slice(0, 12)}: docs/decisions: [A-03] ${AUDIT_RULES['A-03']} (pin .github/record-keeper.yml: 0 of 1 approvals)\naudit: 1 violation, 0 excused, 1 commit judged\n`);
  });

  test('wrong usage exits 2 with the usage text', () => {
    const { args, ids } = planArguments(caseOf('b02-no-owner-approved'));
    const base = args.slice(1);
    const without = (name) => { const i = base.indexOf(name); return [...base.slice(0, i), ...base.slice(i + 2)]; };
    const wrong = [
      ['audit-plan'], ['audit-plan', ...without('--now')], ['audit-plan', ...without('--issues')], ['audit-plan', ...without('--head')],
      ['audit-plan', ...base, '--now', 'yesterday'], ['audit-plan', ...base.slice(0, -1), '2026-11-10T03:00:00+00:00'], ['audit-plan', ...base, '--adopted'],
      ['audit-plan', ...base, 'extra'], ['audit-plan', ...base, '--wat', 'x'], ['audit-plan', ...base.slice(0, -2), '--now', '2026-02-30T00:00:00Z'],
      ['audit', ...base.filter((x, i) => base[i - 1] !== '--issues' && x !== '--issues' && base[i - 1] !== '--now' && x !== '--now'), '--adopted'],
      ['audit', '--repo', arg(args, '--repo'), '--head', ids.c1, '--from', 'abc', '--adopted'],
      ['audit', '--repo', arg(args, '--repo'), '--head', ids.c1, '--json', 'x'],
    ];
    for (const options of wrong) {
      const got = run(options);
      assert.equal(got.code, 2, options.join(' '));
      assert.match(got.stderr, /^Usage:/, options.join(' '));
    }
  });

  test('a file that cannot be read exits 2 and names the file', () => {
    const { args } = planArguments(caseOf('b02-no-owner-approved'));
    const missing = path.join(scratch, 'no-such-file.json');
    for (const [name, command] of [['--evidence', 'audit-plan'], ['--issues', 'audit-plan'], ['--evidence', 'audit']]) {
      const options = command === 'audit' ? ['audit', '--repo', arg(args, '--repo'), '--head', arg(args, '--head'), '--evidence', missing] : args.map((x, i) => (args[i - 1] === name ? missing : x));
      const got = run(options);
      assert.equal(got.code, 2, `${command} ${name}`);
      assert.match(got.stderr, new RegExp(`^record-keeper: cannot read ${missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `), `${command} ${name}`);
    }
  });

  test('a shallow clone cannot be planned or searched for the adoption', () => {
    const { repo } = built.get('a04-the-settings-are-in-the-first-commit');
    const clone = path.join(scratch, 'shallow');
    git(scratch, ['clone', '-q', '--depth', '1', '--branch', 'c1', `file://${repo}`, clone]);
    const message = 'record-keeper: the repository is a shallow clone: the audit needs the whole history\n';
    assert.equal(run(['audit', '--repo', clone, '--head', 'HEAD', '--adopted']).stderr, message);
    assert.throws(() => findAdoption(clone, 'HEAD'), Unreadable);
    const issues = path.join(scratch, 'none.json');
    fs.writeFileSync(issues, '[]');
    assert.equal(run(['audit-plan', '--repo', clone, '--head', 'HEAD', '--adopted', '--issues', issues, '--now', '2026-11-10T03:00:00Z']).stderr, message);
  });

  test('the readers throw Unreadable, and planAudit works on data alone', () => {
    assert.throws(() => readEvidence(Buffer.from('[')), Unreadable);
    assert.throws(() => readIssues(Buffer.from('{}')), Unreadable);
    assert.equal(readEvidence(Buffer.from('{}')).size, 0);
    assert.deepEqual(readIssues(Buffer.from('[[{"number":3,"state":"open","title":"t","body":null,"user":null}],[]]')), [{ number: 3, state: 'open', title: 't', body: '', user: null }]);
    const result = { head: 'h', from: null, folder: 'docs/decisions', judged: 0, violations: [], excused: [] };
    assert.deepEqual(planAudit(result, [], '2026-11-10T03:00:00Z'), { run: { at: '2026-11-10T03:00:00Z', head: 'h', from: null, judged: 0, violations: 0, excused: 0 }, failed: false, issues: [], log: [] });
  });
});
