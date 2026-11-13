// The announcements (docs/announcements.md): the cases of test/fixtures/announce, rebuilt with git fast-import, and the command `announce-plan`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Unreadable, planAnnouncements, readLogins, run } from '../record-keeper.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { cases } = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/announce/cases.json'), 'utf8'));
const page = fs.readFileSync(path.join(root, 'docs/announcements.md'), 'utf8');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'record-keeper-announce-'));
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

/** The arguments of announce-plan for a case, with the files it needs written into the scratch folder. */
function planArguments(c) {
  const { repo, ids } = built.get(c.id);
  const fill = fillWith(ids);
  const folder = fs.mkdtempSync(path.join(scratch, 'files-'));
  const files = {};
  const write = (name, content) => {
    files[name] = path.join(folder, `${name}.json`);
    fs.writeFileSync(files[name], content);
  };
  write('evidence', fill(c.evidenceRaw ?? JSON.stringify(c.evidence)));
  write('issues', fill(c.issuesRaw ?? JSON.stringify(c.issues ?? [])));
  write('logins', c.loginsHex !== undefined ? Buffer.from(c.loginsHex, 'hex') : (c.loginsRaw ?? JSON.stringify(c.logins)));
  const args = ['announce-plan', '--repo', repo, '--head', ids[c.commits.at(-1).id], '--adopted', '--evidence', files.evidence, '--issues', files.issues, '--logins', files.logins, '--now', c.now];
  return { args, ids, files };
}

describe('the plans of the page', () => {
  for (const c of cases) {
    test(`${c.id}: ${c.expect.code === 2 ? 'unreadable' : `${c.expect.plan.announcements.length} to open`}`, () => {
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
      assert.deepEqual(Object.keys(plan), ['announcements', 'log', 'lookups']);
      for (const item of plan.announcements) assert.deepEqual(Object.keys(item), ['key', 'title', 'body']);
    });
  }

  test('the ids of the cases are unique and every case says what it shows', () => {
    assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
    for (const c of cases) assert.ok(c.note, c.id);
  });
});

describe('the command line', () => {
  const sample = () => {
    const c = cases.find((candidate) => candidate.id === 'a01-pin');
    return planArguments(c);
  };
  const without = (args, name) => {
    const at = args.indexOf(name);
    return args.filter((_, i) => i !== at && i !== at + 1);
  };

  test('refuse a missing option', () => {
    const { args } = sample();
    for (const name of ['--head', '--evidence', '--issues', '--logins', '--now']) assert.equal(run(without(args, name)).code, 2, name);
    assert.equal(run(args.filter((item) => item !== '--adopted')).code, 2, '--adopted');
    assert.match(run(args.filter((item) => item !== '--adopted')).stderr, /^Usage:/);
  });

  test('refuse the options of audit-plan that mean nothing here', () => {
    const { args, ids } = sample();
    assert.equal(run([...args, '--from', ids.c0]).code, 2);
    assert.equal(run([...args, '--since', ids.c0]).code, 2);
    assert.equal(run([...args, 'extra']).code, 2);
  });

  test('refuse a time that is not one', () => {
    const { args } = sample();
    const at = args.indexOf('--now');
    assert.equal(run(args.map((item, i) => (i === at + 1 ? 'tomorrow' : item))).code, 2);
  });

  test('say which file cannot be read', () => {
    const { args } = sample();
    for (const name of ['--evidence', '--issues', '--logins']) {
      const at = args.indexOf(name);
      const got = run(args.map((item, i) => (i === at + 1 ? path.join(scratch, 'no-such-file') : item)));
      assert.equal(got.code, 2, name);
      assert.match(got.stderr, /^record-keeper: cannot read /);
    }
  });

  test('read the files in this order: the evidence, the issues, the logins', () => {
    const { args } = sample();
    const spoil = (name, text) => {
      const file = path.join(scratch, `spoiled-${name.slice(2)}.json`);
      fs.writeFileSync(file, text);
      return (list) => list.map((item, i) => (i === list.indexOf(name) + 1 ? file : item));
    };
    const evidence = spoil('--evidence', '{');
    const issues = spoil('--issues', '{}');
    const logins = spoil('--logins', '[]');
    assert.match(run(logins(issues(evidence(args)))).stderr, /spoiled-evidence\.json: is not one JSON document\n$/);
    assert.match(run(logins(issues(args))).stderr, /spoiled-issues\.json: is not a list\n$/);
    assert.match(run(logins(args)).stderr, /spoiled-logins\.json: is not an object\n$/);
  });

  test('document the command on the page and in the usage text', () => {
    assert.match(run(['--help']).stdout, /announce-plan --head <revision> --adopted/);
    assert.match(page, /record-keeper announce-plan --head <revision> --adopted/);
  });
});

describe('the file of the logins', () => {
  const read = (text) => readLogins(Buffer.from(text));
  test('read ids and logins, and null', () => {
    assert.deepEqual([...read('{"2": "bob", "1": null}')], [[1, null], [2, 'bob']]);
    assert.deepEqual([...read('{}')], []);
  });
  test('read the entries in the order of the bytes of their keys', () => {
    assert.throws(() => read('{"9": 1, "10": 2}'), (error) => error instanceof Unreadable && error.message === '10: is neither a login nor null');
  });
  test('accept the form of a login: 1 to 39 letters, digits and single hyphens inside', () => {
    for (const login of ['a', 'Z', '0', '9', 'aB', 'Ab', 'a0', 'a-b', 'a-B', 'a-0', 'A-Z-0-9', '0a', 'x'.repeat(39), 'a-'.repeat(19) + 'a']) {
      assert.equal(read(JSON.stringify({ 1: login })).get(1), login, login);
    }
    for (const login of ['', '-a', 'a-', 'a--b', 'a b', 'a_b', 'x'.repeat(40), 'é', 'a\n', '-']) {
      assert.throws(() => read(JSON.stringify({ 1: login })), (error) => error instanceof Unreadable && error.message === '1: is neither a login nor null', JSON.stringify(login));
    }
  });
  test('accept an id of 1 to 15 digits that does not start with 0', () => {
    assert.deepEqual([...read('{"1": null, "999999999999999": "a", "100000000000000": "b"}').keys()], [1, 100000000000000, 999999999999999]);
    for (const key of ['0', '01', '1000000000000000', '-1', '1.5', 'a', '']) {
      assert.throws(() => read(JSON.stringify({ [key]: null })), (error) => error instanceof Unreadable && error.message === `${key}: is not an id`, key);
    }
  });
  test('name a key that is not an id, also with a control character shown', () => {
    assert.throws(() => read('{"a\\u202eb": "x"}'), (error) => error instanceof Unreadable && error.message === 'a\\u{202e}b: is not an id');
  });
});

describe('what git is asked', () => {
  const FACTS = (diffs, accounts = { owners: [{ login: 'alice', id: 1 }], witnesses: [] }) => ({ parent: () => 'p'.repeat(40), accounts: () => accounts, diff: (_, __, file) => diffs[file] ?? '' });
  const result = (acts, extra = {}) => ({ violations: [], excused: [], acts: acts.map(([kind, file]) => ({ commit: 'a'.repeat(40), kind, path: file, pull: 7 })), ...extra });
  const evidence = new Map([['a'.repeat(40), { pull: { number: 7 }, started: null, reviews: [] }]]);
  const plan = (acts, diffs, extra) => planAnnouncements(result(acts, extra), evidence, [], new Map([[1, 'alice']]), '2026-11-10T03:00:00Z', FACTS(diffs));

  test('read a marker only as the whole first line, with the full id of 40 or 64 digits', () => {
    const key = (digits) => digits.repeat(64).slice(0, 64);
    const wide = { commit: key('9a'), kind: 'pin', path: 'p1', pull: 7 };
    const plan64 = (issues) => planAnnouncements({ violations: [], excused: [], acts: [wide] }, new Map([[wide.commit, { pull: { number: 7 } }]]), issues, new Map([[1, 'alice']]), 'now', FACTS({}));
    const bot = { login: 'github-actions[bot]', type: 'Bot' };
    const issue = (first, body = `${first}\ntext\n`) => ({ number: 1, state: 'open', title: 't', body, user: bot });
    const marker = (id) => `<!-- record-keeper:announcement ${id} -->`;
    assert.equal(plan64([issue(marker(wide.commit))]).announcements.length, 0, 'the 64 digits of a SHA-256 repository');
    assert.equal(plan64([issue(marker(wide.commit), `${marker(wide.commit)}\r\ntext`)]).announcements.length, 0, 'a carriage return before the line feed');
    assert.equal(plan64([issue(marker(wide.commit.slice(0, 63)))]).announcements.length, 1, '63 digits');
    assert.equal(plan64([issue(marker(`${wide.commit}9`))]).announcements.length, 1, '65 digits');
    assert.equal(plan64([issue(marker(wide.commit.toUpperCase()))]).announcements.length, 1, 'capital letters');
    assert.equal(plan64([issue(marker(`${wide.commit.slice(0, 63)}g`))]).announcements.length, 1, 'a digit that is not hexadecimal');
    assert.equal(plan64([issue(`text ${marker(wide.commit)}`)]).announcements.length, 1, 'text before the marker');
    assert.equal(plan64([issue(`${marker(wide.commit)} text`)]).announcements.length, 1, 'text after the marker');
    assert.equal(plan64([issue('', `\n${marker(wide.commit)}\n`)]).announcements.length, 1, 'the marker is not on the first line');
    const f = 'f'.repeat(64);
    const other = { ...wide, commit: f };
    const planF = (issues) => planAnnouncements({ violations: [], excused: [], acts: [other] }, new Map([[f, { pull: { number: 7 } }]]), issues, new Map([[1, 'alice']]), 'now', FACTS({}));
    assert.equal(planF([issue(marker(f))]).announcements.length, 0, 'the letters a to f');
    const zero = { ...wide, commit: '0'.repeat(40) };
    const planZ = (issues) => planAnnouncements({ violations: [], excused: [], acts: [zero] }, new Map([[zero.commit, { pull: { number: 7 } }]]), issues, new Map([[1, 'alice']]), 'now', FACTS({}));
    assert.equal(planZ([issue(marker(zero.commit))]).announcements.length, 0, '40 digits');
  });

  test('say that nothing changed when the diff is empty, and keep the room', () => {
    const got = plan([['pin', 'p1'], ['code', 'p2']], { p2: '+x\n' });
    assert.match(got.announcements[0].body, /### pin p1\n\nNo text changed; see the commit\.\n\n### code p2\n\n```diff\n\+x\n```\n$/);
  });

  test('count the room in characters and not in UTF-16 units or bytes', () => {
    const row = `+${'\u{1f600}'.repeat(19999)}`;           // 20,000 characters and a line feed
    const got = plan([['pin', 'p1']], { p1: `${row}\n${row}\n${row}\n` });
    const body = got.announcements[0].body;
    assert.equal(body.split('\n').filter((line) => line === row).length, 1, 'the second row would make 40,002 characters');
    assert.match(body, /\.\.\. 2 more lines; see the commit\.\n$/);
  });

  test('take exactly 40,000 characters', () => {
    const a = `+${'a'.repeat(19998)}`;                      // 19,999 and a line feed
    const got = plan([['pin', 'p1']], { p1: `${a}\n${a}\n` });
    assert.match(got.announcements[0].body, /```\n$/);
    assert.equal(got.announcements[0].body.includes('more lines'), false);
  });

  test('one character too many cuts the diff', () => {
    const a = `+${'a'.repeat(19998)}`;
    const got = plan([['pin', 'p1']], { p1: `${a}\n${a}x\n` });
    assert.match(got.announcements[0].body, /\.\.\. 1 more lines; see the commit\.\n$/);
  });

  test('a row that is longer than the whole room uses the room at once', () => {
    const got = plan([['pin', 'p1'], ['code', 'p2']], { p1: `+${'y'.repeat(40000)}\n`, p2: '+z\n' });
    assert.equal(got.announcements[0].body.match(/The room of this issue is used; see the commit\./g).length, 2);
  });

  test('once the room is used no later act gets a diff, whatever its rows are', () => {
    const used = plan([['pin', 'p1'], ['code', 'p2']], { p1: `+${'y'.repeat(40000)}\n`, p2: '\n' });
    assert.ok(used.announcements[0].body.endsWith('### code p2\n\nThe room of this issue is used; see the commit.\n'), 'a row that fits no room');
    const cut = plan([['pin', 'p1'], ['code', 'p2']], { p1: `+${'a'.repeat(30000)}\n+${'b'.repeat(30000)}\n`, p2: '\n' });
    assert.ok(cut.announcements[0].body.endsWith('### code p2\n\nThe room of this issue is used; see the commit.\n'), 'a diff that was cut');
  });

  test('write the paths with the escapes of the audit', () => {
    const got = plan([['code', 'a‮b']], { 'a‮b': '+x\n' });
    assert.ok(got.announcements[0].body.includes('- Acts: code a\\u{202e}b\n'));
    assert.ok(got.announcements[0].body.includes('### code a\\u{202e}b\n'));
  });

  test('leave an act of another kind out and keep one that has a violation of another rule', () => {
    const got = plan([['accept', 'p0'], ['erratum', 'p1']], {}, { violations: [{ commit: 'a'.repeat(40), kind: 'commit', file: null, rule: 'P-13', detail: 'no clock' }] });
    assert.equal(got.announcements.length, 1);
    assert.equal(got.announcements[0].title, 'Act: erratum (#7)');
  });

  test('leave out an act with a violation of A-03, standing or excused, and only that act', () => {
    const detail = 'pin p1: 0 of 1 approvals';
    for (const where of ['violations', 'excused']) {
      const got = plan([['pin', 'p1'], ['workflow', 'p2']], {}, { [where]: [{ commit: 'a'.repeat(40), kind: 'commit', file: null, rule: 'A-03', detail }] });
      assert.equal(got.announcements[0].title, 'Act: workflow (#7)', where);
    }
    const other = plan([['pin', 'p1']], {}, { violations: [{ commit: 'b'.repeat(40), kind: 'commit', file: null, rule: 'A-03', detail }] });
    assert.equal(other.announcements.length, 1, 'a violation at another commit');
    const similar = plan([['pin', 'p1']], {}, { violations: [{ commit: 'a'.repeat(40), kind: 'commit', file: null, rule: 'A-03', detail: 'pin p10: no pull request' }] });
    assert.equal(similar.announcements.length, 1, 'the path p10 is not the path p1');
  });
});

describe('a diff of a file that the attributes call binary', () => {
  test('is shown as text', () => {
    const repo = path.join(scratch, 'attributes');
    fs.mkdirSync(path.join(repo, '.github'), { recursive: true });
    git(scratch, ['init', '-q', '-b', 'main', repo]);
    const write = (name, text) => {
      fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
      fs.writeFileSync(path.join(repo, name), text);
    };
    write('.github/record-keeper/settings.yml', 'owners: [alice/1001]\napprovals: 1\n');
    write('record-keeper.mjs', 'one\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'start']);
    write('.gitattributes', 'record-keeper.mjs -diff\n');
    write('record-keeper.mjs', 'two\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'Merge pull request #7 from a/b']);
    const head = git(repo, ['rev-parse', 'HEAD']);
    const files = {
      evidence: path.join(scratch, 'attr-evidence.json'),
      issues: path.join(scratch, 'attr-issues.json'),
      logins: path.join(scratch, 'attr-logins.json'),
    };
    fs.writeFileSync(files.evidence, JSON.stringify({ [head]: { pull: { number: 7, user: { id: 1001 }, head: { sha: 'e'.repeat(40) }, merged_at: '2026-11-09T12:00:00Z' }, started: null, reviews: [] } }));
    fs.writeFileSync(files.issues, '[]');
    fs.writeFileSync(files.logins, '{"1001": "alice"}');
    const got = run(['announce-plan', '--repo', repo, '--head', head, '--adopted', '--evidence', files.evidence, '--issues', files.issues, '--logins', files.logins, '--now', '2026-11-10T03:00:00Z']);
    assert.equal(got.code, 0, got.stderr);
    const body = JSON.parse(got.stdout).announcements[0].body;
    assert.ok(body.includes('-one\n+two\n'), body);
    assert.equal(body.includes('Binary files'), false);
  });
});
