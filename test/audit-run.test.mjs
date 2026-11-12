// The audit run (docs/audit-run.md): run-audit.mjs against a local server that plays GitHub and against real git repositories.
// The repositories are the histories of test/fixtures/audit-effects, built with `git fast-import`; `origin` of the work directory is a bare
// repository, so the log branch can be read back from it. Nothing here may reach the network.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CannotRun, runAudit, runCli } from '../run-audit.mjs';
import { audit, findAdoption } from '../record-keeper.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = path.join(root, 'run-audit.mjs');
const { cases } = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/audit-effects/cases.json'), 'utf8'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'record-keeper-audit-run-'));
const servers = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (url, ...rest) => {
  const { hostname } = new URL(url);
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') throw new Error(`a test made a request to ${url}`);
  return realFetch(url, ...rest);
};
after(() => {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
  fs.rmSync(scratch, { recursive: true, force: true });
});

// ---- git ---------------------------------------------------------------------------------------------------------------------------

const CLEAN = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
const IDENTITY = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
const git = (cwd, args, input, env = {}) => {
  const result = spawnSync('git', args, { cwd, input, env: { ...CLEAN, ...IDENTITY, ...env } });
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

/** Builds the bare repository of a history; its branch `main` is the last commit. Returns { repo, ids }. */
function build(c, name = c.id) {
  const repo = path.join(scratch, `${name}.git`);
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
  git(repo, ['update-ref', 'refs/heads/main', ids[c.head ?? c.commits.at(-1).id]]);
  git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  return { repo, ids };
}

let clones = 0;
/** A fresh clone of a repository, where the audit runs: the whole history, and `origin` is the repository. */
function workdir(from) {
  const dir = path.join(scratch, `work-${(clones += 1)}`);
  git(scratch, ['clone', '-q', from, dir]);
  return dir;
}

const logOf = (repo) => {
  const have = spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', 'refs/heads/record-keeper/log'], { env: CLEAN });
  if (have.status !== 0) return null;
  const show = (file) => git(repo, ['show', `refs/heads/record-keeper/log:${file}`]);
  const files = git(repo, ['ls-tree', '--name-only', 'refs/heads/record-keeper/log']).split('\n');
  return {
    files,
    incidents: files.includes('incidents.jsonl') ? spawnSync('git', ['-C', repo, 'show', 'refs/heads/record-keeper/log:incidents.jsonl'], { env: CLEAN }).stdout.toString('utf8') : null,
    last: files.includes('last-run.json') ? spawnSync('git', ['-C', repo, 'show', 'refs/heads/record-keeper/log:last-run.json'], { env: CLEAN }).stdout.toString('utf8') : null,
    readme: files.includes('README.md') ? show('README.md') : null,
    commits: git(repo, ['rev-list', '--reverse', 'refs/heads/record-keeper/log']).split('\n'),
    message: (commit) => git(repo, ['log', '-1', '--format=%B', commit]),
    author: (commit) => git(repo, ['log', '-1', '--format=%an <%ae>|%cn <%ce>|%aI', commit]),
  };
};

// ---- the server that plays GitHub ------------------------------------------------------------------------------------------------------------

/**
 * Serves `routes`: a function (method, path, query, body, seen) that returns { status?, body, headers? } or undefined for 404.
 * `requests` records every request: { method, path, query, body, headers }.
 */
async function serve(routes) {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const text = Buffer.concat(chunks).toString('utf8');
      const entry = { method: request.method, path: url.pathname, query: url.searchParams, body: text === '' ? undefined : JSON.parse(text), headers: request.headers };
      requests.push(entry);
      const answer = routes(entry.method, entry.path, entry.query, entry.body, requests.length, `http://${request.headers.host}`) ?? { status: 404, body: { message: 'Not Found' } };
      if (answer.hang) return;
      response.writeHead(answer.status ?? 200, { 'content-type': 'application/json', ...answer.headers });
      response.end(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

const REPO = 'o/r';
const fillWith = (ids) => (text) => text.replace(/@([a-z0-9]+)@/g, (_, label) => ids[label]);

/** The routes of GitHub for a case: the repository, the pull requests of the evidence, their reviews and checks, and the issues. */
function github(c, ids, { issues = [], created = 1000, over } = {}) {
  const evidence = c.evidence ? JSON.parse(fillWith(ids)(JSON.stringify(c.evidence))) : {};
  const reviews = new Map();
  const starts = new Map();
  for (const entry of Object.values(evidence)) {
    if (entry.pull === null) continue;
    reviews.set(entry.pull.number, entry.reviews.flat());
    if (entry.started !== null) starts.set(entry.pull.head.sha, entry.started);
  }
  let next = created;
  return (method, route, query, body, seen, origin) => {
    const taken = over?.(method, route, query, body, seen, origin);
    if (taken !== undefined) return taken;
    if (method === 'GET' && route === `/repos/${REPO}`) return { body: { default_branch: 'main' } };
    let found = /^\/repos\/o\/r\/commits\/([0-9a-f]+)\/pulls$/.exec(route);
    if (method === 'GET' && found) {
      const entry = evidence[found[1]];
      return { body: entry?.pull ? [{ number: entry.pull.number, user: entry.pull.user ?? null, head: entry.pull.head, merged_at: entry.pull.merged_at, merge_commit_sha: found[1], base: { ref: 'main' }, state: 'closed' }] : [] };
    }
    found = /^\/repos\/o\/r\/pulls\/(\d+)\/reviews$/.exec(route);
    if (method === 'GET' && found) return { body: reviews.get(Number(found[1])) ?? [] };
    found = /^\/repos\/o\/r\/commits\/([0-9a-f]+)\/check-runs$/.exec(route);
    if (method === 'GET' && found) return { body: { total_count: 1, check_runs: starts.has(found[1]) ? [{ name: 'Records integrity', app: { slug: 'github-actions' }, started_at: starts.get(found[1]) }] : [] } };
    if (method === 'GET' && route === `/repos/${REPO}/issues`) return { body: issues };
    if (method === 'POST' && route === `/repos/${REPO}/issues`) return { status: 201, body: { number: (next += 1) } };
    found = /^\/repos\/o\/r\/issues\/(\d+)$/.exec(route);
    if (method === 'PATCH' && found) return { body: { number: Number(found[1]) } };
    return undefined;
  };
}

const NOW = (c) => () => Date.parse(c.now);
const options = (c, work, server, extra = {}) => ({ repo: REPO, token: 'tok', api: server.url, cwd: work, now: NOW(c), timeout: 5000, ...extra });

/** What the program must ask of the API for a plan: one request per action, in the order of the plan. */
function writesOf(plan) {
  return plan.issues.map((action, index) => {
    const duplicate = plan.log[index].duplicate !== undefined;
    if (action.action === 'open') return { method: 'POST', path: `/repos/${REPO}/issues`, body: { title: action.title, body: action.body } };
    const change = action.action === 'close' ? { state: 'closed', state_reason: duplicate ? 'not_planned' : 'completed', body: action.body }
      : { ...(action.action === 'reopen' ? { state: 'open' } : {}), title: action.title, body: action.body };
    return { method: 'PATCH', path: `/repos/${REPO}/issues/${action.number}`, body: change };
  });
}

const built = new Map();
const eligible = [];
before(() => {
  for (const c of cases) {
    if (c.expect.code !== 0 || c.evidenceRaw !== undefined || c.evidenceHex !== undefined || c.issuesRaw !== undefined || c.since !== undefined) continue;
    const { repo, ids } = build(c);
    const adopted = findAdoption(repo, ids[c.head ?? c.commits.at(-1).id]);
    const wanted = c.adopted ? adopted : c.from ? (/^@.+@$/.test(c.from) ? ids[c.from.slice(1, -1)] : (ids[c.from] ?? c.from)) : null;
    if (adopted === null || adopted !== wanted) continue;
    const head = ids[c.head ?? c.commits.at(-1).id];
    const carries = audit(repo, head, { from: adopted }).acts.length > 0;
    if (carries && c.evidence === undefined) continue;
    built.set(c.id, { repo, ids });
    eligible.push(c);
  }
});

describe('the cases of the effects, from the history to the requests and the log branch', () => {
  test('a good part of the cases can be run this way', () => {
    assert.ok(eligible.length >= 60, `only ${eligible.length} cases`);
    assert.ok(eligible.some((c) => c.expect.plan.issues.some((i) => i.action === 'close')));
    assert.ok(eligible.some((c) => c.expect.plan.issues.some((i) => i.action === 'reopen')));
    assert.ok(eligible.some((c) => c.expect.plan.issues.some((i) => i.action === 'update')));
    assert.ok(eligible.some((c) => c.expect.plan.issues.some((i) => i.action === 'open')));
    assert.ok(eligible.some((c) => c.expect.plan.failed === false));
  });

  for (const c of cases.filter((x) => x.expect.code === 0 && x.evidenceRaw === undefined && x.evidenceHex === undefined && x.issuesRaw === undefined && x.since === undefined)) {
    test(`${c.id}`, async (t) => {
      if (!built.has(c.id)) return t.skip('the history is not started from the adoption commit, or its acts have no evidence in the case');
      const { repo, ids } = built.get(c.id);
      const fill = fillWith(ids);
      const plan = JSON.parse(fill(JSON.stringify(c.expect.plan)));
      const work = workdir(repo);
      const server = await serve(github(c, ids, { issues: JSON.parse(fill(JSON.stringify(c.issues ?? []))) }));
      const got = await runAudit(options(c, work, server));
      assert.equal(got.code, plan.failed ? 1 : 0, c.note);
      const writes = server.requests.filter(({ method }) => method !== 'GET').map(({ method, path: route, body }) => ({ method, path: route, body }));
      const wanted = writesOf(plan);
      assert.deepEqual(writes, wanted, c.note);
      let created = 1000;
      const said = plan.issues.map((a) => `${{ open: 'opened', update: 'updated', reopen: 'reopened', close: 'closed' }[a.action]} ${a.key} #${a.action === 'open' ? (created += 1) : a.number}`);
      assert.deepEqual(got.stdout.split('\n').filter((line) => /^(opened|updated|reopened|closed) /.test(line)), said, c.note);
      const log = logOf(repo);
      assert.ok(log, 'the log branch was made');
      assert.deepEqual(log.files, ['README.md', 'incidents.jsonl', 'last-run.json']);
      assert.equal(log.incidents, plan.log.map((entry) => `${JSON.stringify(entry)}\n`).join(''));
      assert.equal(log.last, `${JSON.stringify(plan.run)}\n`);
      assert.equal(log.commits.length, 1);
      assert.equal(log.message(log.commits[0]).trim(), `Audit of ${plan.run.head} at ${plan.run.at}: ${plan.run.violations} violation${plan.run.violations === 1 ? '' : 's'}, ${plan.log.length} ${plan.log.length === 1 ? 'entry' : 'entries'}`);
      assert.equal(log.author(log.commits[0]), 'github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>|github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>|2026-11-10T03:00:00Z');
      const asked = new Set(server.requests.filter(({ path: route }) => /\/commits\/[0-9a-f]+\/pulls$/.test(route)).map(({ path: route }) => route.split('/')[5]));
      const acts = new Set(audit(work, 'HEAD', { from: findAdoption(work, 'HEAD') }).acts.map((act) => act.commit));
      assert.deepEqual([...asked].sort(), [...acts].sort(), 'the evidence is asked for the commits that carry an act, and for no other');
    });
  }
});

// ---- one scenario at a time --------------------------------------------------------------------------------------------------------------
const byId = (id) => cases.find((c) => c.id === id);
let worlds = 0;
/** A fresh history of a case, a clone of it, and a server for it. `over` and `issues` are the options of `github`. */
async function scenario(id, { issues, over, spec } = {}) {
  const c = spec ?? byId(id);
  const { repo, ids } = build(c, `s${(worlds += 1)}-${c.id}`);
  const work = workdir(repo);
  const server = await serve(github(c, ids, { issues: issues ?? [], over }));
  return { c, repo, ids, work, server, fill: fillWith(ids) };
}
const writesOn = (server) => server.requests.filter(({ method }) => method !== 'GET');

describe('what the job shows and what it writes', () => {
  test('a violation that stands: the lines of the audit on the standard error, one line for each action, the log, and a failing status', async () => {
    const s = await scenario('b02-no-owner-approved');
    const got = await runAudit(options(s.c, s.work, s.server));
    assert.equal(got.code, 1);
    assert.match(got.stderr, new RegExp(`^${s.ids.c1.slice(0, 12)}: docs/decisions: \\[A-03\\] .* \\(pin \\.github/record-keeper\\.yml: 0 of 1 approvals\\)\naudit: 1 violation, 0 excused, 1 commit judged\n$`));
    assert.equal(got.stdout, 'opened -:A-03 #1001\nlog: 1 entry and the record of the run pushed to record-keeper/log\n');
    const [write] = writesOn(s.server);
    assert.equal(write.headers.authorization, 'Bearer tok');
    assert.equal(write.headers['content-type'], 'application/json');
    assert.equal(write.headers['user-agent'], 'record-keeper');
    assert.equal(write.headers['x-github-api-version'], '2022-11-28');
  });

  test('a clean history: the record of the run is written, nothing else, and the status is good', async () => {
    const s = await scenario('b01-the-author-is-an-owner');
    const got = await runAudit(options(s.c, s.work, s.server));
    assert.deepEqual(got, { code: 0, stdout: 'audit: 0 violations, 0 excused, 1 commit judged\nlog: the record of the run pushed to record-keeper/log\n', stderr: '' });
    assert.equal(writesOn(s.server).length, 0);
    const log = logOf(s.repo);
    assert.equal(log.incidents, '');
    assert.equal(log.last, `${JSON.stringify({ at: '2026-11-10T03:00:00Z', head: s.ids.c1, from: s.ids.c0, judged: 1, violations: 0, excused: 0 })}\n`);
    assert.match(log.readme, /incidents\.jsonl/);
    assert.match(log.readme, /last-run\.json/);
    assert.equal(log.message(log.commits[0]).trim(), `Audit of ${s.ids.c1} at 2026-11-10T03:00:00Z: 0 violations, 0 entries`);
  });

  test('a dry run says what it would do and writes nothing: no issue, no log', async () => {
    const s = await scenario('b02-no-owner-approved');
    const got = await runAudit(options(s.c, s.work, s.server, { dryRun: true }));
    assert.equal(got.code, 1);
    assert.equal(got.stdout, 'would open -:A-03\ndry run: nothing was written\n');
    assert.match(got.stderr, /\[A-03\]/);
    assert.equal(writesOn(s.server).length, 0);
    assert.equal(logOf(s.repo), null);
    assert.equal(git(s.work, ['ls-remote', '--heads', 'origin']).includes('record-keeper/log'), false);
  });

  test('the clone is left as it was: no file changed, the same head, no branch, and one ref once the log branch exists', async () => {
    const s = await scenario('b02-no-owner-approved');
    const before = git(s.work, ['rev-parse', 'HEAD']);
    await runAudit(options(s.c, s.work, s.server));
    assert.equal(git(s.work, ['for-each-ref', '--format=%(refname)', 'refs/record-keeper']), '', 'the first run makes the branch and fetches nothing');
    await runAudit(options(s.c, s.work, await serve(github(s.c, s.ids))));
    assert.equal(git(s.work, ['status', '--porcelain']), '');
    assert.equal(git(s.work, ['rev-parse', 'HEAD']), before);
    assert.equal(git(s.work, ['for-each-ref', '--format=%(refname)', 'refs/record-keeper']), 'refs/record-keeper/log');
    assert.equal(git(s.work, ['branch', '--list', 'record-keeper/log']), '');
  });

  test('a second run adds to the branch: the entries are appended, the record is replaced, and the first commit stays', async () => {
    const s = await scenario('b02-no-owner-approved');
    await runAudit(options(s.c, s.work, s.server));
    const first = logOf(s.repo);
    const again = await serve(github(s.c, s.ids, { issues: [] }));
    const later = { ...s.c, now: '2026-11-11T03:00:00Z' };
    const second = await runAudit(options(later, s.work, again));
    assert.equal(second.code, 1);
    const log = logOf(s.repo);
    assert.equal(log.commits.length, 2);
    assert.equal(log.commits[0], first.commits[0]);
    assert.equal(git(s.repo, ['rev-parse', `${log.commits[1]}^`]), first.commits[0]);
    assert.ok(log.incidents.startsWith(first.incidents));
    assert.equal(log.incidents.split('\n').length, 3, 'two entries: the first run opened the issue, and the second run, which was shown no issue, opened it again');
    assert.equal(JSON.parse(log.last).at, '2026-11-11T03:00:00Z');
    assert.equal(log.readme, first.readme);
  });

  test('a branch that already exists keeps its other files, and a last line that was cut short stays a line of its own', async () => {
    const s = await scenario('b01-the-author-is-an-owner');
    const blob = (text) => git(s.work, ['hash-object', '-w', '--stdin'], text);
    const tree = git(s.work, ['mktree'], `100644 blob ${blob('{"cut":\n')}\tincidents.jsonl\n100644 blob ${blob('mine\n')}\tnotes.txt\n`);
    const parent = git(s.work, ['commit-tree', tree, '-m', 'someone else']);
    git(s.work, ['push', '--quiet', 'origin', `${parent}:refs/heads/record-keeper/log`]);
    const server = await serve(github(s.c, s.ids));
    const got = await runAudit(options(s.c, s.work, server));
    assert.equal(got.code, 0);
    const log = logOf(s.repo);
    assert.deepEqual(log.files, ['incidents.jsonl', 'last-run.json', 'notes.txt']);
    assert.equal(log.incidents, '{"cut":\n');
    assert.equal(git(s.repo, ['show', 'refs/heads/record-keeper/log:notes.txt']), 'mine');
    assert.equal(git(s.repo, ['rev-parse', `${log.commits[1]}^`]), parent);
  });
});

describe('the push of the log', () => {
  const hookFile = (repo, name, text) => {
    const file = path.join(repo, 'hooks', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, { mode: 0o755 });
  };
  const racerIn = (work, line) => {
    const blob = git(work, ['hash-object', '-w', '--stdin'], line);
    const tree = git(work, ['mktree'], `100644 blob ${blob}\tincidents.jsonl\n`);
    return git(work, ['commit-tree', tree, '-m', 'another writer']);
  };

  test('another writer gets there first: the program fetches the new tip, appends to it, and pushes again', async () => {
    const s = await scenario('b02-no-owner-approved');
    const racer = racerIn(s.work, '{"another":"writer"}\n');
    const mark = path.join(scratch, `race-${worlds}`);
    hookFile(path.join(s.work, '.git'), 'pre-push', `#!/bin/sh\nif [ ! -f '${mark}' ]; then\n  : > '${mark}'\n  git push --quiet origin ${racer}:refs/heads/record-keeper/log || exit 1\nfi\nexit 0\n`);
    const got = await runAudit(options(s.c, s.work, s.server));
    assert.equal(got.code, 1, got.stderr);
    const log = logOf(s.repo);
    assert.equal(log.commits.length, 2);
    assert.equal(log.commits[0], racer);
    assert.equal(git(s.repo, ['rev-parse', `${log.commits[1]}^`]), racer);
    assert.ok(log.incidents.startsWith('{"another":"writer"}\n{"at":'), 'the entries were appended to the file as the other writer left it');
    assert.equal(log.incidents.split('\n').length, 3);
    assert.equal(writesOn(s.server).length, 1, 'the issue is opened once');
  });

  test('a push that is refused every time ends the run after three attempts, and no issue is touched', async () => {
    const s = await scenario('b02-no-owner-approved');
    const racer = path.join(scratch, `racer-${worlds}.git`);
    git(scratch, ['init', '-q', '--bare', racer]);
    const other = racerIn(s.work, '{"x":1}\n');
    git(s.work, ['push', '--quiet', racer, `${other}:refs/heads/record-keeper/log`]);
    git(s.work, ['config', 'remote.origin.pushurl', racer]);
    const got = await runAudit(options(s.c, s.work, s.server));
    assert.deepEqual(got, { code: 2, stdout: '', stderr: 'Records audit could not run: could not push the log after 3 attempts\n' });
    assert.equal(writesOn(s.server).length, 0, 'the log comes first, and the issues are not touched when it fails');
  });

  test('a push that the repository refuses by a rule is not tried again, and the reason is shown', async () => {
    const s = await scenario('b02-no-owner-approved');
    const calls = path.join(scratch, `calls-${worlds}`);
    hookFile(s.repo, 'pre-receive', `#!/bin/sh\necho x >> '${calls}'\necho 'push declined due to repository rule violations' >&2\nexit 1\n`);
    const got = await runAudit(options(s.c, s.work, s.server));
    assert.equal(got.code, 2);
    assert.match(got.stderr, /^Records audit could not run: git push failed: .*push declined due to repository rule violations.*remote rejected/s);
    assert.equal(fs.readFileSync(calls, 'utf8'), 'x\n', 'one attempt');
    assert.equal(writesOn(s.server).length, 0);
    assert.equal(logOf(s.repo), null);
  });

  test('a request that writes an issue is refused: the run ends with 2 after the log was written', async () => {
    const s = await scenario('b02-no-owner-approved', { over: (method) => (method === 'POST' ? { status: 403, body: { message: 'no' } } : undefined) });
    const got = await runAudit(options(s.c, s.work, s.server));
    assert.deepEqual(got, { code: 2, stdout: '', stderr: 'Records audit could not run: POST /repos/o/r/issues answered 403\n' });
    assert.ok(logOf(s.repo), 'the log is written first');
    const again = await scenario('e05-the-body-differs', { over: (method) => (method === 'PATCH' ? { status: 500, body: {} } : undefined), issues: [] });
    assert.ok(again.c);
  });

  test('a request that answers with something else than the number of the new issue ends the run', async () => {
    const s = await scenario('b02-no-owner-approved', { over: (method) => (method === 'POST' ? { status: 201, body: { id: 5 } } : undefined) });
    const got = await runAudit(options(s.c, s.work, s.server));
    assert.deepEqual(got, { code: 2, stdout: '', stderr: 'Records audit could not run: the answer to /repos/o/r/issues is not what the audit needs\n' });
  });

  test('a PATCH is refused', async () => {
    const c = byId('e05-the-body-differs');
    const { repo, ids } = build(c, `patch-${(worlds += 1)}`);
    const work = workdir(repo);
    const issues = JSON.parse(fillWith(ids)(JSON.stringify(c.issues)));
    const server = await serve(github(c, ids, { issues, over: (method) => (method === 'PATCH' ? { status: 422, body: {} } : undefined) }));
    const got = await runAudit(options(c, work, server));
    assert.deepEqual(got, { code: 2, stdout: '', stderr: 'Records audit could not run: PATCH /repos/o/r/issues/11 answered 422\n' });
  });
});

describe('which pull request brought the act in, and what the program reads about it', () => {
  const HEAD = 'e'.repeat(40);
  const pull = (id, number, over = {}) => ({ number, user: { id: 1001 }, head: { sha: HEAD }, merged_at: '2026-11-09T12:00:00Z', merge_commit_sha: id, base: { ref: 'main' }, state: 'closed', ...over });
  /** The pin of `b02` is changed by a push or a merge; the author 1001 is an owner, so a pull request made by 1001 approves it, one by 9999 does not. */
  async function withPulls(list, options_ = {}) {
    let id;
    const s = await scenario('b02-no-owner-approved', {
      over: (method, route, query, body, seen, origin) => {
        const found = /\/commits\/([0-9a-f]+)\/pulls$/.exec(route);
        if (method !== 'GET' || !found) return undefined;
        id = found[1];
        return typeof list === 'function' ? list(id, query, origin) : { body: list.map((entry) => (typeof entry === 'function' ? entry(id) : entry)) };
      },
      ...options_,
    });
    const got = await runAudit(options(s.c, s.work, s.server));
    return { ...s, got, id: s.ids.c1 };
  }
  const violation = (got) => got.stderr.includes('[A-03]');

  test('a pull request that was merged into another branch gated nothing here', async () => {
    const { got } = await withPulls([(id) => pull(id, 5, { base: { ref: 'dev' } })]);
    assert.equal(got.code, 1);
    assert.match(got.stderr, /pin \.github\/record-keeper\.yml: no pull request\)/);
  });

  test('a pull request that was not merged is not one', async () => {
    const { got } = await withPulls([(id) => pull(id, 5, { merged_at: null, merge_commit_sha: null, state: 'open' })]);
    assert.match(got.stderr, /no pull request\)/);
  });

  test('the one whose merge commit is the commit wins over another merged pull request', async () => {
    const { got } = await withPulls([(id) => pull(id, 3, { user: { id: 9999 }, merge_commit_sha: 'f'.repeat(40) }), (id) => pull(id, 9)]);
    assert.equal(got.code, 0, got.stderr);
  });

  test('the only merged pull request is the one, also when its merge commit is another commit (a commit of its branch, a rebase)', async () => {
    const { got } = await withPulls([() => pull('x', 4, { merge_commit_sha: 'f'.repeat(40) })]);
    assert.equal(got.code, 0, got.stderr);
    const other = await withPulls([() => pull('x', 4, { merge_commit_sha: 'f'.repeat(40), user: { id: 9999 } })]);
    assert.ok(violation(other.got));
  });

  test('several merged pull requests and none with the commit as its merge commit: the run stops and names them in order', async () => {
    const { got, id } = await withPulls([() => pull('x', 9, { merge_commit_sha: 'a'.repeat(40) }), () => pull('x', 3, { merge_commit_sha: 'b'.repeat(40) }), (i) => pull(i, 5, { merged_at: null })]);
    assert.deepEqual(got, { code: 2, stdout: '', stderr: `Records audit could not run: several merged pull requests name the commit ${id}: #3, #9\n` });
  });

  test('an account that is gone is nobody', async () => {
    const { got } = await withPulls([(id) => pull(id, 5, { user: null })]);
    assert.match(got.stderr, /0 of 1 approvals\)/);
    const none = await withPulls([(id) => { const { user, ...rest } = pull(id, 5); return rest; }]);
    assert.match(none.got.stderr, /0 of 1 approvals\)/);
  });

  test('pull requests on several pages are all read', async () => {
    const { got, server } = await withPulls((id, query, origin) => (query.get('page') === '2'
      ? { body: [pull(id, 9)] }
      : { body: [pull(id, 5, { merged_at: null, merge_commit_sha: null })], headers: { link: `<${origin}/repos/o/r/commits/${id}/pulls?per_page=100&page=2>; rel="next"` } }));
    assert.equal(got.code, 0, got.stderr);
    assert.equal(server.requests.filter(({ path: route }) => route.endsWith('/pulls')).length, 2);
  });

  test('an answer that is not a list of pull requests, or one that does not fit, ends the run', async () => {
    for (const body of [{}, [{ number: 'x' }], [pull('y', 5, { merged_at: 'yesterday' })], [pull('y', 5, { head: null })], [pull('y', 5, { base: {} })], [pull('y', 5, { user: { id: 0 } })], [pull('y', 5, { merge_commit_sha: 5 })], ['x']]) {
      const { got, id } = await withPulls(() => ({ body }));
      assert.deepEqual(got, { code: 2, stdout: '', stderr: `Records audit could not run: the answer to /repos/o/r/commits/${id}/pulls?per_page=100 is not what the audit needs\n` }, JSON.stringify(body));
    }
  });

  test('the reviews on several pages are all read: an approval on the second page counts', async () => {
    const c = byId('b03-an-owner-approved-the-head');
    const s = await scenario('b03-an-owner-approved-the-head', {
      over: (method, route, query, body, seen, origin) => {
        if (method !== 'GET' || !route.endsWith('/pulls/7/reviews')) return undefined;
        const approval = c.evidence['@c1@'].reviews;
        return query.get('page') === '2' ? { body: approval } : { body: [{ id: 5, user: { id: 1003 }, state: 'COMMENTED', commit_id: HEAD, submitted_at: '2026-11-09T09:00:00Z' }], headers: { link: `<${origin}${route}?per_page=100&page=2>; rel="next"` } };
      },
    });
    const got = await runAudit(options(c, s.work, s.server));
    assert.equal(got.code, 0, got.stderr);
  });
});

describe('when the check first ran', () => {
  const run = (name, app, startedAt) => ({ name, app: app === null ? null : { slug: app }, started_at: startedAt });
  const withRuns = async (runs, extra = {}) => {
    const c = byId('b20-erratum-too-soon');
    const s = await scenario('b20-erratum-too-soon', {
      over: (method, route, query, body, seen, origin) => (method === 'GET' && route.endsWith('/check-runs') ? (extra.pages ? extra.pages(query, origin, route) : { body: { total_count: runs.length, check_runs: runs } }) : undefined),
    });
    return { ...s, got: await runAudit(options(c, s.work, s.server)) };
  };
  const GENUINE = (at) => run('Records integrity', 'github-actions', at);

  test('the earliest run of the check by the app counts; another app, another name, no app and a run that has not started do not', async () => {
    const decoys = [run('Records integrity', 'someone-else', '2026-11-01T00:00:00Z'), run('Other check', 'github-actions', '2026-11-01T00:00:00Z'), run('Records integrity', null, '2026-11-01T00:00:00Z'), run('Records integrity', 'github-actions', null)];
    const soon = await withRuns([...decoys, GENUINE('2026-11-09T11:30:00Z'), GENUINE('2026-11-09T11:00:00Z')]);
    assert.equal(soon.got.code, 1);
    assert.match(soon.got.stderr, /\[P-13\] .*\(1h of 48h\)/);
    const late = await withRuns([...decoys, GENUINE('2026-11-09T11:30:00Z'), GENUINE('2026-11-07T11:00:00Z')]);
    assert.equal(late.got.code, 0, late.got.stderr);
  });

  test('when it never ran there is no clock, and the check run is asked about the head of the pull request', async () => {
    const { got, server } = await withRuns([run('Records integrity', 'github-actions', null)]);
    assert.match(got.stderr, /\[P-13\] .*\(no clock\)/);
    const asked = server.requests.find(({ path: route }) => route.endsWith('/check-runs'));
    assert.equal(asked.path, `/repos/o/r/commits/${'e'.repeat(40)}/check-runs`);
    assert.equal(asked.query.get('check_name'), 'Records integrity');
    assert.equal(asked.query.get('filter'), 'all');
  });

  test('runs on several pages are all read', async () => {
    const { got } = await withRuns([], {
      pages: (query, origin, route) => (query.get('page') === '2'
        ? { body: { total_count: 2, check_runs: [GENUINE('2026-11-07T11:00:00Z')] } }
        : { body: { total_count: 2, check_runs: [GENUINE('2026-11-09T11:00:00Z')] }, headers: { link: `<${origin}${route}?check_name=x&page=2>; rel="next"` } }),
    });
    assert.equal(got.code, 0, got.stderr);
  });

  test('an answer that is not a list of check runs, or one that does not fit, ends the run', async () => {
    for (const body of [[], { check_runs: 'x' }, { check_runs: [{ name: 5 }] }, { check_runs: [{ name: 'x', started_at: 'soon', app: null }] }, { check_runs: [{ name: 'x', started_at: null, app: 'a' }] }]) {
      const { got } = await withRuns([], { pages: () => ({ body }) });
      assert.equal(got.code, 2, JSON.stringify(body));
      assert.match(got.stderr, /^Records audit could not run: the answer to \/repos\/o\/r\/commits\/e+\/check-runs\?check_name=Records%20integrity&filter=all&per_page=100 is not what the audit needs\n$/);
    }
  });
});

describe('the issues', () => {
  test('issues on several pages are all read: the ones on the second page are not opened again', async () => {
    const c = byId('e04-nothing-to-change');
    const { repo, ids } = build(c, `pages-${(worlds += 1)}`);
    const work = workdir(repo);
    const issues = JSON.parse(fillWith(ids)(JSON.stringify(c.issues)));
    const server = await serve(github(c, ids, {
      over: (method, route, query, body, seen, origin) => {
        if (method !== 'GET' || route !== `/repos/${REPO}/issues`) return undefined;
        return query.get('page') === '2' ? { body: [issues[1]] } : { body: [issues[0]], headers: { link: `<${origin}${route}?page=2>; rel="next"` } };
      },
    }));
    const got = await runAudit(options(c, work, server));
    assert.equal(got.code, 1);
    assert.equal(writesOn(server).length, 0);
    const asked = server.requests.find(({ path: route }) => route === `/repos/${REPO}/issues`);
    assert.equal(asked.query.get('creator'), 'github-actions[bot]');
    assert.equal(asked.query.get('state'), 'all');
  });

  test('an answer that is not a list of issues ends the run', async () => {
    const s = await scenario('b01-the-author-is-an-owner', { over: (method, route) => (method === 'GET' && route === `/repos/${REPO}/issues` ? { body: { items: [] } } : undefined) });
    const got = await runAudit(options(s.c, s.work, s.server));
    assert.deepEqual(got, { code: 2, stdout: '', stderr: 'Records audit could not run: the answer to /repos/o/r/issues?state=all&creator=github-actions%5Bbot%5D&per_page=100 is not what the audit needs\n' });
  });

  test('an issues list that the plan cannot read is a reason not to run', async () => {
    const s = await scenario('b01-the-author-is-an-owner', { over: (method, route) => (method === 'GET' && route === `/repos/${REPO}/issues` ? { body: [{ number: 'x' }] } : undefined) });
    const got = await runAudit(options(s.c, s.work, s.server));
    assert.deepEqual(got, { code: 2, stdout: '', stderr: 'Records audit could not run: the audit could not read the history: issues.json: entry 1: number is not a positive integer\n' });
  });
});

describe('when it cannot run', () => {
  const failure = (message) => ({ code: 2, stdout: '', stderr: `Records audit could not run: ${message}\n` });
  const quiet = async () => { const s = await scenario('b01-the-author-is-an-owner'); return s; };

  test('no token, or one that is not a single word', async () => {
    const s = await quiet();
    for (const token of [undefined, '', 'a b', ' ', 5]) assert.deepEqual(await runAudit(options(s.c, s.work, s.server, { token })), failure('no token'));
    assert.equal(s.server.requests.length, 0);
  });

  test('a repository that is not owner/name', async () => {
    const s = await quiet();
    for (const repo of [undefined, '', 'o', 'o/r/x', 'o/..', '../r', './r', 'o/r r', 'o/', '/r', 'o/r?x', 5, `o/${'r'.repeat(101)}`]) {
      assert.deepEqual(await runAudit(options(s.c, s.work, s.server, { repo })), failure('repository: must be owner/name'), String(repo));
    }
    assert.equal(s.server.requests.length, 0);
  });

  test('an address of the API that is not https, or has credentials, a query or a fragment', async () => {
    const s = await quiet();
    assert.deepEqual(await runAudit(options(s.c, s.work, s.server, { api: 'not an address' })), failure('API address: not an address'));
    for (const api of ['http://example.com', 'ftp://127.0.0.1', 'https://u:p@example.com', 'https://example.com/?x=1', 'https://example.com/#x', 'http://user@localhost']) {
      assert.deepEqual(await runAudit(options(s.c, s.work, s.server, { api })), failure('API address: must be an https address without credentials, query or fragment'), api);
    }
    assert.equal(s.server.requests.length, 0);
  });

  test('an answer that is not 200: the request and the status are named', async () => {
    const s = await scenario('b01-the-author-is-an-owner', { over: (method, route) => (route === `/repos/${REPO}` ? { status: 500, body: {} } : undefined) });
    assert.deepEqual(await runAudit(options(s.c, s.work, s.server)), failure('GET /repos/o/r answered 500'));
    const gone = await scenario('b02-no-owner-approved', { over: (method, route) => (route.endsWith('/pulls') ? { status: 404, body: {} } : undefined) });
    assert.match((await runAudit(options(gone.c, gone.work, gone.server))).stderr, /^Records audit could not run: GET \/repos\/o\/r\/commits\/[0-9a-f]{40}\/pulls\?per_page=100 answered 404\n$/);
  });

  test('no answer: a server that is gone, one that does not answer in time, and a redirect that is not followed', async () => {
    const s = await quiet();
    const gone = await serve(() => undefined);
    servers.pop().close();
    assert.match((await runAudit(options(s.c, s.work, gone))).stderr, /^Records audit could not run: GET \/repos\/o\/r failed: .+\n$/);
    const slow = await serve(() => ({ hang: true }));
    assert.match((await runAudit(options(s.c, s.work, slow, { timeout: 100 }))).stderr, /^Records audit could not run: GET \/repos\/o\/r failed: .+\n$/);
    const away = await serve(() => ({ status: 302, headers: { location: 'http://127.0.0.1:9/elsewhere' }, body: {} }));
    assert.match((await runAudit(options(s.c, s.work, away))).stderr, /^Records audit could not run: GET \/repos\/o\/r failed: .+\n$/);
    assert.equal(away.requests.length, 1, 'the redirect was not followed');
  });

  test('an answer that is not JSON, or has no default branch', async () => {
    for (const body of ['not json', '{}', '{"default_branch": ""}', '{"default_branch": 5}', '[]']) {
      const s = await scenario('b01-the-author-is-an-owner', { over: (method, route) => (route === `/repos/${REPO}` ? { body } : undefined) });
      assert.deepEqual(await runAudit(options(s.c, s.work, s.server)), failure('the answer to /repos/o/r is not what the audit needs'), body);
    }
  });

  test('a link to the next page that leaves the API, or comes back to a page already read', async () => {
    const issues = (link) => (method, route, query, body, seen, origin) => (method === 'GET' && route === `/repos/${REPO}/issues` ? { body: [], headers: { link: link(origin, route) } } : undefined);
    for (const link of [() => '<http://127.0.0.1:9/x>; rel="next"', (origin, route) => `<${origin}${route}?state=all&creator=github-actions%5Bbot%5D&per_page=100>; rel="next"`, () => '<http://[bad>; rel="next"']) {
      const s = await scenario('b01-the-author-is-an-owner', { over: issues(link) });
      assert.deepEqual(await runAudit(options(s.c, s.work, s.server)), failure('the link to the next page is not the API'));
    }
  });

  test('a listing that does not end', async () => {
    const s = await scenario('b01-the-author-is-an-owner', {
      over: (method, route, query, body, seen, origin) => (method === 'GET' && route === `/repos/${REPO}/issues` ? { body: [], headers: { link: `<${origin}${route}?page=${(Number(query.get('page') ?? 1)) + 1}>; rel="next"` } } : undefined),
    });
    assert.deepEqual(await runAudit(options(s.c, s.work, s.server)), failure('more than 200 pages of issues'));
    assert.equal(s.server.requests.filter(({ path: route }) => route === `/repos/${REPO}/issues`).length, 200);
  });

  test('the history cannot be audited: a shallow clone, and a history in which no commit holds the settings file', async () => {
    const s = await quiet();
    const shallow = path.join(scratch, `shallow-${worlds}`);
    git(scratch, ['clone', '-q', '--depth', '1', `file://${s.repo}`, shallow]);
    assert.deepEqual(await runAudit(options(s.c, shallow, s.server)), failure('the audit could not read the history: the repository is a shallow clone: the audit needs the whole history'));
    const bare = await scenario('a03-no-commit-holds-the-settings');
    assert.deepEqual(await runAudit(options(bare.c, bare.work, bare.server)), failure('the audit could not read the history: no commit of the history holds .github/record-keeper/settings.yml'));
  });

  test('git cannot do what the log needs: a clone with no origin', async () => {
    const s = await scenario('b01-the-author-is-an-owner');
    git(s.work, ['remote', 'remove', 'origin']);
    const got = await runAudit(options(s.c, s.work, s.server));
    assert.equal(got.code, 2);
    assert.match(got.stderr, /^Records audit could not run: git ls-remote failed: .+\n$/);
  });

  describe('a history with many commits that carry an act', () => {
    let many;
    before(() => {
      const base = byId('b01-the-author-is-an-owner');
      const spec = { id: 'many', commits: [{ ...base.commits[0] }] };
      for (let i = 1; i <= 301; i++) spec.commits.push({ id: `c${i}`, parents: [`c${i - 1}`], message: `commit ${i}`, changes: [{ write: '.github/record-keeper.yml', content: `version: ${i + 1}\n` }] });
      many = { spec, ...build(spec, 'many') };
    });

    test('more than 300: the run stops before it asks about any of them', async () => {
      const work = workdir(many.repo);
      const server = await serve(github(many.spec, many.ids));
      assert.deepEqual(await runAudit(options({ now: '2026-11-10T03:00:00Z' }, work, server)), failure('more than 300 commits with acts'));
      assert.equal(server.requests.length, 1);
    });

    test('exactly 300 are asked about, one after the other, and the violations are one issue', async () => {
      const work = workdir(many.repo);
      git(work, ['reset', '--hard', '-q', many.ids.c300]);
      const server = await serve(github(many.spec, many.ids));
      const got = await runAudit(options({ now: '2026-11-10T03:00:00Z' }, work, server));
      assert.equal(got.code, 1, got.stderr);
      assert.equal(server.requests.filter(({ path: route }) => route.endsWith('/pulls')).length, 300);
      const [write] = writesOn(server);
      assert.equal(write.body.body.split('\n').filter((line) => line.startsWith('- ')).length, 300);
    });
  });
});

describe('the command line', () => {
  const usage = { code: 2, stdout: '', stderr: 'Usage:\n  run-audit.mjs --repo <owner/name> [--dry-run]\n' };

  test('what it takes: --repo and --dry-run, each once, and nothing else', async () => {
    for (const argv of [[], ['--repo'], ['--repo', 'o/r', 'x'], ['--repo', 'o/r', '--repo', 'o/p'], ['--dry-run'], ['--dry-run', '--dry-run', '--repo', 'o/r'], ['--wat'], ['--repo', 'o/r', '--pr', '5']]) {
      assert.deepEqual(await runCli(argv, { GITHUB_TOKEN: 'tok' }), usage, argv.join(' '));
    }
  });

  test('the token and the address come from the environment, and the options of the tests pass through', async () => {
    const s = await scenario('b01-the-author-is-an-owner');
    const got = await runCli(['--repo', REPO, '--dry-run'], { GITHUB_TOKEN: 'from-env', GITHUB_API_URL: s.server.url }, { cwd: s.work, now: NOW(s.c) });
    assert.equal(got.code, 0, got.stderr);
    assert.equal(s.server.requests[0].headers.authorization, 'Bearer from-env');
    assert.deepEqual(await runCli(['--repo', REPO], {}), { code: 2, stdout: '', stderr: 'Records audit could not run: no token\n' });
    assert.ok(CannotRun.prototype instanceof Error);
  });

  /** Runs a program and waits for it without blocking this process, whose server it talks to. */
  const execute = (program, args, { cwd, env }) => new Promise((resolve) => {
    const child = spawn(process.execPath, [program, ...args], { cwd, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });

  test('as a program: the exit status is that of the run, also through a symbolic link', async () => {
    const s = await scenario('b02-no-owner-approved');
    const link = path.join(scratch, `link-${worlds}.mjs`);
    fs.symlinkSync(script, link);
    for (const program of [script, link]) {
      const fresh = workdir(s.repo);
      const result = await execute(program, ['--repo', REPO, '--dry-run'], { cwd: fresh, env: { ...CLEAN, GITHUB_TOKEN: 'tok', GITHUB_API_URL: s.server.url } });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stdout, /^would open -:A-03\ndry run: nothing was written\n$/);
      assert.match(result.stderr, /\[A-03\]/);
    }
    const none = await execute(script, ['--repo', REPO], { cwd: s.work, env: { ...CLEAN, GITHUB_API_URL: s.server.url } });
    assert.equal(none.status, 2);
    assert.equal(none.stderr, 'Records audit could not run: no token\n');
    assert.equal((await execute(script, [], { cwd: s.work, env: CLEAN })).status, 2);
  });
});

describe('a connection that was reset', () => {
  /** A fetch that fails once, as undici does when a pooled connection was closed by the server, for the requests that `fails` picks out. */
  const resetting = (fails) => {
    const seen = new Set();
    return (url, init) => {
      const key = `${init.method} ${url}`;
      if (fails(init.method, url) && !seen.has(key)) {
        seen.add(key);
        throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) });
      }
      return globalThis.fetch(url, init);
    };
  };

  test('a read is made once more: the run goes on as if nothing had happened', async () => {
    const s = await scenario('b02-no-owner-approved');
    const got = await runAudit(options(s.c, s.work, s.server, { fetch: resetting((method) => method === 'GET') }));
    assert.equal(got.code, 1, got.stderr);
    assert.equal(got.stdout.split('\n')[0], 'opened -:A-03 #1001');
  });

  test('a read that is reset twice ends the run', async () => {
    const s = await scenario('b01-the-author-is-an-owner');
    const always = () => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) }); };
    assert.deepEqual(await runAudit(options(s.c, s.work, s.server, { fetch: always })), { code: 2, stdout: '', stderr: 'Records audit could not run: GET /repos/o/r failed: read ECONNRESET\n' });
  });

  test('a write is not repeated: it may have been received', async () => {
    const s = await scenario('b02-no-owner-approved');
    let posts = 0;
    const fetch = (url, init) => {
      if (init.method === 'POST') {
        posts += 1;
        throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) });
      }
      return globalThis.fetch(url, init);
    };
    assert.deepEqual(await runAudit(options(s.c, s.work, s.server, { fetch })), { code: 2, stdout: '', stderr: 'Records audit could not run: POST /repos/o/r/issues failed: read ECONNRESET\n' });
    assert.equal(posts, 1);
  });

  test('a fresh connection is made before the first write: the repository is read again after the log', async () => {
    const s = await scenario('b02-no-owner-approved');
    await runAudit(options(s.c, s.work, s.server));
    const paths = s.server.requests.map(({ method, path: route }) => `${method} ${route}`);
    assert.equal(paths.filter((entry) => entry === `GET /repos/${REPO}`).length, 2);
    assert.equal(paths.indexOf(`POST /repos/${REPO}/issues`), paths.lastIndexOf(`GET /repos/${REPO}`) + 1);
    const dry = await scenario('b02-no-owner-approved');
    await runAudit(options(dry.c, dry.work, dry.server, { dryRun: true }));
    assert.equal(dry.server.requests.filter(({ path: route }) => route === `/repos/${REPO}`).length, 1, 'a dry run writes nothing and needs no fresh connection');
  });
});
