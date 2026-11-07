// The owners' approval (docs/approvals.md): the cases of test/fixtures/approval, the reading of a reviews file, and the command `check-pr`
// with the reviews of a pull request. The repositories are built with `git fast-import`, so nothing is checked out.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SETTINGS_PATH, Unreadable, actApproved, checkChange, countApprovals, readReviews, run } from '../record-keeper.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { counts, files } = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/approval/cases.json'), 'utf8'));
const change = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/change/cases.json'), 'utf8'));
const page = fs.readFileSync(path.join(root, 'docs/approvals.md'), 'utf8');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'record-keeper-approval-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

describe('the count of approvals', () => {
  for (const c of counts) {
    test(`${c.id}: ${c.expect.owners.map((o) => o.how).join(' ') || 'no owners'}`, () => {
      assert.deepEqual(countApprovals({ owners: c.owners, needed: c.approvals, head: c.head, author: c.author, reviews: c.reviews }), c.expect, c.note);
    });
  }

  test('every result of the page is shown by a case, and every result of a case is on the page', () => {
    const shown = new Set(counts.flatMap((c) => c.expect.owners.map((o) => o.how)));
    const onPage = [...page.matchAll(/^\| `(\w+)` \| .* \| (?:yes|no) \|$/gm)].map((m) => m[1]);
    assert.deepEqual([...shown].sort(), [...onPage].sort());
  });

  test('both the cases that meet the approval and those that do not are there', () => {
    assert.ok(counts.some((c) => c.expect.met));
    assert.ok(counts.some((c) => !c.expect.met));
  });

  test('the ids of the cases are unique', () => {
    const ids = [...counts, ...files].map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('the result of the count does not depend on the order of the reviews', () => {
    for (const c of counts) {
      const reversed = [...c.reviews].reverse();
      assert.deepEqual(countApprovals({ owners: c.owners, needed: c.approvals, head: c.head, author: c.author, reviews: reversed }), c.expect, c.id);
    }
  });

  test('the count does not change what it is given', () => {
    const c = counts.find((x) => x.id === 'c47-latest-is-all-that-counts');
    const copy = structuredClone(c);
    countApprovals({ owners: c.owners, needed: c.approvals, head: c.head, author: c.author, reviews: c.reviews });
    assert.deepEqual(c, copy);
  });
});

describe('the reviews file', () => {
  for (const f of files) {
    const bytes = f.hex !== undefined ? Buffer.from(f.hex, 'hex') : Buffer.from(f.text, 'utf8');
    test(`${f.id}: ${f.expect.error ?? `${f.expect.reviews.length} reviews`}`, () => {
      if (f.expect.error === undefined) assert.deepEqual(readReviews(bytes), f.expect.reviews, f.note);
      else assert.throws(() => readReviews(bytes), (error) => error instanceof Unreadable && error.message === f.expect.error, f.note);
    });
  }

  test('every reason of the page is shown by a case', () => {
    const reasons = new Set(files.filter((f) => f.expect.error).map((f) => f.expect.error.replace(/^entry \d+: /, '')));
    assert.deepEqual([...reasons].sort(), [
      'commit_id is neither null nor text',
      'id is not a positive integer',
      'is not a list',
      'is not an object',
      'is not one JSON document',
      'mixes reviews and pages',
      'state is not text',
      'submitted_at is not a time like 2026-11-06T12:00:00Z',
      'user is neither null nor an object with a positive integer id',
    ]);
    for (const reason of reasons) assert.ok(reason.startsWith('is ') || reason.startsWith('mixes') || page.includes(reason.split(' ')[0]), reason);
  });

  test('a file is read as bytes, also from a Uint8Array', () => {
    assert.deepEqual(readReviews(new Uint8Array(Buffer.from('[]'))), []);
  });
});

describe('the act owners', () => {
  const owned = (id) => change.cases.find((c) => c.id === id);
  test('it is never met by an approval, the other acts are met by a met approval and by no other', () => {
    const met = { met: true };
    const not = { met: false };
    for (const kind of ['accept', 'settings', 'pin']) {
      assert.equal(actApproved({ kind, path: 'x' }, met), true);
      assert.equal(actApproved({ kind, path: 'x' }, not), false);
      assert.equal(actApproved({ kind, path: 'x' }, null), false);
    }
    assert.equal(actApproved({ kind: 'owners', path: 'x' }, met), false);
    assert.equal(actApproved({ kind: 'owners', path: 'x' }, null), false);
  });

  test('the cases of the change fixtures show it and show when it is not found', () => {
    const found = change.cases.filter((c) => c.expect.acts.some((a) => a.kind === 'owners')).map((c) => c.id);
    assert.ok(found.length >= 10, found.join());
    for (const id of ['w03-login-changed', 'w04-order-changed', 'w06-approvals-raised', 'w07-approvals-line-removed', 'w08-approvals-back-to-default', 'w12-other-setting-changes', 'w18-both-lists-empty', 'w21-same-owners-new-spelling']) {
      assert.ok(owned(id), id);
      assert.ok(!found.includes(id), id);
    }
  });
});

// ---- repositories for the command ----------------------------------------------------------------------------------------------

const CLEAN = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
const git = (cwd, args, input) => {
  const result = spawnSync('git', args, { cwd, input, env: { ...CLEAN, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
};
const GITLINK = '0123456789012345678901234567890123456789';
const data = (bytes) => Buffer.concat([Buffer.from(`data ${bytes.length}\n`), bytes, Buffer.from('\n')]);
const treeOf = (list) => new Map(list.map((f) => [f.path, f.link !== undefined ? ['120000', f.link] : ['100644', f.content]]));

function applyChanges(tree, changes) {
  const out = new Map(tree);
  for (const c of changes) {
    if (c.write !== undefined) out.set(c.write, [c.mode ?? '100644', c.content]);
    else if (c.remove !== undefined) out.delete(c.remove);
    else if (c.symlink !== undefined) out.set(c.symlink, ['120000', c.target]);
    else if (c.submodule !== undefined) out.set(c.submodule, ['160000', GITLINK]);
    else throw new Error(`unknown change ${JSON.stringify(c)}`);
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

/** A repository with the base b<i> and the head h<i> of the cases of the change fixtures that are asked for, by id. */
let repo;
const index = new Map();
const IDS = ['w22-accept-with-owners', 'w23-accept-and-a-problem', 'w01-owner-added', 'w05-approvals-lowered', 'w06-approvals-raised', 'c01-new-accepted-record', 'w12-other-setting-changes', 'a03-proposed-edited', 'w13-owners-named-first-time'];
before(() => {
  repo = path.join(scratch, 'r.git');
  git(scratch, ['init', '-q', '--bare', repo]);
  const stream = [];
  IDS.forEach((id, i) => {
    const c = change.cases.find((x) => x.id === id);
    assert.ok(c, id);
    stream.push(commitStream(`b${i}`, treeOf(change.trees[c.base])), commitStream(`h${i}`, applyChanges(treeOf(change.trees[c.base]), c.changes), `b${i}`));
    index.set(id, i);
  });
  git(repo, ['fast-import', '--quiet'], Buffer.concat(stream));
});

const idOf = (ref) => git(repo, ['rev-parse', ref]).toString('utf8').trim();
const review = (id, user, state, at, commit) => ({ id, user: { id: user, login: 'whoever' }, state, commit_id: commit, submitted_at: at });
const T1 = '2026-11-01T09:00:00Z';
const T2 = '2026-11-02T09:00:00Z';
let written = 0;

/** Runs check-pr on the case `id`, with reviews written as JSON to a file; `reviews` get the head id by default. */
function go(id, { reviews, author = 4242, extra = [] } = {}) {
  const i = index.get(id);
  const args = ['check-pr', '--repo', repo, '--base', `b${i}`, '--head', `h${i}`, ...extra];
  if (reviews !== undefined) {
    const file = path.join(scratch, `reviews-${(written += 1)}.json`);
    fs.writeFileSync(file, JSON.stringify(reviews(idOf(`h${i}`))));
    args.push('--reviews', file, '--author', String(author));
  }
  return run(args);
}

describe('the command check-pr with reviews', () => {
  const approve = (...users) => (head) => users.map((user, n) => review(n + 1, user, 'APPROVED', T1, head));

  test('an act that enough owners approved: exit 0, the count and the line of the approvals on the standard output', () => {
    const got = go('w22-accept-with-owners', { reviews: approve(1002), author: 1001 });
    assert.deepEqual(got, { code: 0, stdout: 'approvals: 2 of 2 (alice/1001: author, bob/1002: approved)\ndocs/decisions: 0 problems, 1 act approved\n', stderr: '' });
  });

  test('an act that too few owners approved: exit 1, the act, the approvals and the count on the error output', () => {
    const got = go('w22-accept-with-owners', { reviews: approve(1002), author: 4242 });
    assert.equal(got.code, 1);
    assert.equal(got.stdout, '');
    assert.equal(got.stderr, "docs/decisions/0007-seventh.md: needs the owners' approval (accept)\napprovals: 1 of 2 (alice/1001: none, bob/1002: approved)\ndocs/decisions: 0 problems, 1 act\n");
  });

  test('an approval of an earlier commit is named as such', () => {
    const got = go('w22-accept-with-owners', { reviews: (head) => [review(1, 1001, 'APPROVED', T1, 'f'.repeat(head.length)), review(2, 1002, 'APPROVED', T1, head)] });
    assert.match(got.stderr, /^docs\/decisions\/0007-seventh\.md: needs the owners' approval \(accept\)\napprovals: 1 of 2 \(alice\/1001: earlier, bob\/1002: approved\)\n/);
  });

  test('a request for changes takes an approval back, and is named', () => {
    const got = go('w22-accept-with-owners', { reviews: (head) => [review(1, 1001, 'APPROVED', T1, head), review(2, 1001, 'CHANGES_REQUESTED', T2, head), review(3, 1002, 'APPROVED', T1, head)] });
    assert.match(got.stderr, /approvals: 1 of 2 \(alice\/1001: changes, bob\/1002: approved\)/);
    assert.equal(got.code, 1);
  });

  test('with approvals 2 and the two owners approving, nothing else is needed', () => {
    const got = go('w22-accept-with-owners', { reviews: approve(1001, 1002) });
    assert.equal(got.code, 0);
    assert.equal(got.stdout, 'approvals: 2 of 2 (alice/1001: approved, bob/1002: approved)\ndocs/decisions: 0 problems, 1 act approved\n');
  });

  test('an act owners cannot be approved, and is named with the amendment bar; the other act of the change is met', () => {
    const got = go('w01-owner-added', { reviews: approve(1001, 1002) });
    assert.equal(got.code, 1);
    assert.equal(got.stdout, '');
    assert.equal(got.stderr, `${SETTINGS_PATH}: needs the amendment bar, which this version cannot check (owners)\napprovals: 2 of 2 (alice/1001: approved, bob/1002: approved)\ndocs/decisions: 0 problems, 2 acts\n`);
  });

  test('the owners are those of the base: an owner that the change adds does not approve it', () => {
    const got = go('w01-owner-added', { reviews: approve(1003) });
    assert.match(got.stderr, /approvals: 0 of 2 \(alice\/1001: none, bob\/1002: none\)/);
    assert.match(got.stderr, new RegExp(`${SETTINGS_PATH.replaceAll('.', '\\.')}: needs the owners' approval \\(settings\\)\\n`));
  });

  test('a change of the settings that is not about the owners is met by the approval of the owners', () => {
    const got = go('w12-other-setting-changes', { reviews: approve(1001, 1002) });
    assert.deepEqual(got, { code: 0, stdout: 'approvals: 2 of 2 (alice/1001: approved, bob/1002: approved)\ndocs/decisions: 0 problems, 1 act approved\n', stderr: '' });
  });

  test('a higher number of approvals in the settings of the head does not make the base ask for it', () => {
    const got = go('w06-approvals-raised', { reviews: approve(1001, 1002) });
    assert.equal(got.code, 0);
  });

  test('a repository without owners cannot approve: 0 of 2, no owners', () => {
    const got = go('c01-new-accepted-record', { reviews: approve(1001) });
    assert.equal(got.code, 1);
    assert.equal(got.stderr, "docs/decisions/0007-seventh.md: needs the owners' approval (accept)\napprovals: 0 of 2 (no owners)\ndocs/decisions: 0 problems, 1 act\n");
  });

  test('naming the first owners in a change is the act owners, and nobody can approve it', () => {
    const got = go('w13-owners-named-first-time', { reviews: approve(1001) });
    assert.equal(got.code, 1);
    assert.match(got.stderr, /needs the amendment bar/);
    assert.match(got.stderr, /approvals: 0 of 2 \(no owners\)/);
  });

  test('without an act the reviews change nothing: the count only', () => {
    const got = go('a03-proposed-edited', { reviews: approve(1001) });
    assert.deepEqual(got, { code: 0, stdout: 'docs/decisions: 0 problems\n', stderr: '' });
  });

  test('a problem is still a problem when the acts are approved', () => {
    const got = go('w23-accept-and-a-problem', { reviews: approve(1002), author: 1001 });
    assert.equal(got.code, 1);
    assert.equal(got.stdout, '');
    assert.match(got.stderr, /^docs\/decisions\/0002-second\.md: \[P-02\] .*\(line 17\)\napprovals: 2 of 2 \(alice\/1001: author, bob\/1002: approved\)\ndocs\/decisions: 1 problem, 1 act approved\n$/);
  });

  test('without reviews every act is unmet, as before, and the act owners is named', () => {
    const got = go('w22-accept-with-owners');
    assert.deepEqual(got, { code: 1, stdout: '', stderr: "docs/decisions/0007-seventh.md: needs the owners' approval (accept)\ndocs/decisions: 0 problems, 1 act\n" });
    assert.match(go('w05-approvals-lowered').stderr, /needs the amendment bar/);
  });

  test('the library: the approval is null without reviews and a count with them', () => {
    const i = index.get('w22-accept-with-owners');
    assert.equal(checkChange(repo, `b${i}`, `h${i}`).approval, null);
    const got = checkChange(repo, `b${i}`, `h${i}`, { author: 1001, reviews: [] });
    assert.deepEqual(got.approval, { have: 1, needed: 2, met: false, owners: [{ login: 'alice', id: 1001, how: 'author' }, { login: 'bob', id: 1002, how: 'none' }] });
  });

  test('the head commit is the one that --head names, whatever its name', () => {
    const i = index.get('w22-accept-with-owners');
    const head = idOf(`h${i}`);
    const file = path.join(scratch, 'by-id.json');
    fs.writeFileSync(file, JSON.stringify([review(1, 1002, 'APPROVED', T1, head)]));
    const got = run(['check-pr', '--repo', repo, '--base', `b${i}`, '--head', head, '--reviews', file, '--author', '1001']);
    assert.equal(got.code, 0);
    const tag = run(['check-pr', '--repo', repo, '--base', `b${i}`, '--head', `h${i}~0`, '--reviews', file, '--author', '1001']);
    assert.equal(tag.code, 0);
  });

  test('a stale head is P-09 and no act, whatever the reviews say', () => {
    const i = index.get('w22-accept-with-owners');
    const file = path.join(scratch, 'stale.json');
    fs.writeFileSync(file, '[]');
    const got = run(['check-pr', '--repo', repo, '--base', `h${i}`, '--head', `b${i}`, '--reviews', file, '--author', '1001']);
    assert.equal(got.code, 1);
    assert.match(got.stderr, /\[P-09\]/);
    assert.doesNotMatch(got.stderr, /approvals:/);
  });
});

describe('wrong usage and unreadable reviews', () => {
  const base = ['check-pr', '--repo', 'nowhere', '--base', 'a', '--head', 'b'];
  const file = path.join(scratch, 'ok.json');
  before(() => fs.writeFileSync(file, '[]'));

  // The repository of `base` does not exist, so every command that is not a usage error exits 2 with another message: the usage text tells them apart.
  const isUsage = (got) => got.code === 2 && got.stdout === '' && got.stderr.startsWith('Usage:');

  test('--reviews and --author go together', () => {
    assert.ok(isUsage(run([...base, '--reviews', file])));
    assert.ok(isUsage(run([...base, '--author', '1'])));
    assert.ok(!isUsage(run([...base, '--reviews', file, '--author', '1'])));
  });

  test('an author is a positive integer of at most 15 digits', () => {
    for (const author of ['0', '01', '-1', '1.5', 'x', '1e3', '1234567890123456', '+1', ' 1', '1 ', '١', '12x', 'x12', '1\n']) assert.ok(isUsage(run([...base, '--reviews', file, '--author', author])), JSON.stringify(author));
    for (const author of ['1', '9', '10', '999999999999999', '100000000000000']) assert.ok(!isUsage(run([...base, '--reviews', file, '--author', author])), author);
  });

  test('a file that cannot be read exits 2 and names the file', () => {
    const got = run([...base, '--reviews', path.join(scratch, 'missing.json'), '--author', '1']);
    assert.equal(got.code, 2);
    assert.equal(got.stdout, '');
    assert.match(got.stderr, /^record-keeper: cannot read .*missing\.json: /);
  });

  test('a file that is not reviews exits 2 with the file and the reason', () => {
    const bad = path.join(scratch, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify([{ id: 1, user: null, state: 'APPROVED', commit_id: null, submitted_at: 'soon' }]));
    const got = run([...base, '--reviews', bad, '--author', '1']);
    assert.deepEqual(got, { code: 2, stdout: '', stderr: `record-keeper: ${bad}: entry 1: submitted_at is not a time like 2026-11-06T12:00:00Z\n` });
  });

  test('the reviews are read before the repository: both problems, the first one is shown', () => {
    const bad = path.join(scratch, 'bad2.json');
    fs.writeFileSync(bad, '{');
    assert.match(run([...base, '--reviews', bad, '--author', '1']).stderr, /is not one JSON document/);
  });

  test('the file name is written escaped', () => {
    const got = run([...base, '--reviews', 'a\nb', '--author', '1'], { readFile: () => { throw new Error('no\nfile'); } });
    assert.equal(got.stderr, 'record-keeper: cannot read a\\u{a}b: no\\u{a}file\n');
    const got2 = run([...base, '--reviews', 'x‮y', '--author', '1'], { readFile: () => Buffer.from('{') });
    assert.equal(got2.stderr, 'record-keeper: x\\u{202e}y: is not one JSON document\n');
  });

  test('a file given to run is read with the function it is given', () => {
    const seen = [];
    run([...base, '--reviews', 'some/file.json', '--author', '5'], { readFile: (name) => { seen.push(name); return Buffer.from('[]'); } });
    assert.deepEqual(seen, ['some/file.json']);
  });

  test('the last of repeated options wins', () => {
    const bad = path.join(scratch, 'bad3.json');
    fs.writeFileSync(bad, '{');
    const got = run([...base, '--reviews', bad, '--reviews', file, '--author', '0', '--author', '7']);
    assert.doesNotMatch(got.stderr, /JSON/);
  });

  test('the usage text lists the options', () => {
    const got = run(['--help']);
    assert.match(got.stdout, /--reviews <file> --author <id>/);
  });
});

describe('a real process', () => {
  test('the exit code and the streams, with a file read from the disk', () => {
    const i = index.get('w22-accept-with-owners');
    const file = path.join(scratch, 'real.json');
    fs.writeFileSync(file, JSON.stringify([review(1, 1002, 'APPROVED', T1, idOf(`h${i}`))]));
    const program = path.join(root, 'record-keeper.mjs');
    const result = spawnSync(process.execPath, [program, 'check-pr', '--repo', repo, '--base', `b${i}`, '--head', `h${i}`, '--reviews', file, '--author', '1001'], { env: CLEAN });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.toString(), 'approvals: 2 of 2 (alice/1001: author, bob/1002: approved)\ndocs/decisions: 0 problems, 1 act approved\n');
    assert.equal(result.stderr.toString(), '');
  });
});
