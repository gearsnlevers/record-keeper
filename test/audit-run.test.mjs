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
import { audit, findAdoption, run } from '../record-keeper.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = path.join(root, 'run-audit.mjs');
const { cases } = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/audit-effects/cases.json'), 'utf8'));
const announceCases = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/announce/cases.json'), 'utf8')).cases;
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

/**
 * Builds the bare repository of a history; its branch `main` is the last commit. Returns { repo, ids }. A history in which no commit names another
 * by its id is built by one fast-import; the others one commit after the other, because the id of an earlier commit goes into a later one.
 */
function build(c, name = c.id) {
  const repo = path.join(scratch, `${name}.git`);
  git(scratch, ['init', '-q', '--bare', repo]);
  const trees = new Map();
  const ids = {};
  const fill = (text) => text.replace(/@([a-z0-9]+)@/g, (_, label) => ids[label]);
  const named = c.commits.some((commit) => /@[a-z0-9]+@/.test(commit.message + JSON.stringify(commit.changes)));
  const streams = [];
  for (const commit of c.commits) {
    const before = commit.parents.length > 0 ? trees.get(commit.parents[0]) : new Map();
    const changes = commit.changes.map((change) => (change.content === undefined ? change : { ...change, content: fill(change.content) }));
    trees.set(commit.id, applyChanges(before, changes));
    const one = stream(commit.id, trees.get(commit.id), fill(commit.message), commit.parents);
    if (named) {
      git(repo, ['fast-import', '--quiet'], one);
      ids[commit.id] = git(repo, ['rev-parse', commit.id]);
    } else streams.push(one);
  }
  if (!named) {
    git(repo, ['fast-import', '--quiet'], Buffer.concat(streams));
    for (const line of git(repo, ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads']).split('\n')) {
      const [label, id] = line.split(' ');
      ids[label] = id;
    }
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
    announcements: files.includes('announcements.jsonl') ? spawnSync('git', ['-C', repo, 'show', 'refs/heads/record-keeper/log:announcements.jsonl'], { env: CLEAN }).stdout.toString('utf8') : null,
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
    found = /^\/user\/(\d+)$/.exec(route);
    if (method === 'GET' && found) return { body: { login: `u${found[1]}` } };
    if (method === 'GET' && route === `/repos/${REPO}/issues`) return { body: issues };
    if (method === 'POST' && route === `/repos/${REPO}/issues`) return { status: 201, body: { number: (next += 1) } };
    found = /^\/repos\/o\/r\/issues\/(\d+)$/.exec(route);
    if (method === 'PATCH' && found) return { body: { number: Number(found[1]) } };
    return undefined;
  };
}

const NOW = (c) => () => Date.parse(c.now);
const options = (c, work, server, extra = {}) => ({ repo: REPO, token: 'tok', api: server.url, cwd: work, now: NOW(c), timeout: 5000, pause: 0, ...extra });

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

/** What announce-plan says for a case: { announcements, log }, with the logins of the fake GitHub (u<id>). */
function announcementsOf(c, ids, work, issues) {
  const fill = fillWith(ids);
  const folder = fs.mkdtempSync(path.join(scratch, 'announce-'));
  const file = (name, content) => {
    fs.writeFileSync(path.join(folder, name), content);
    return path.join(folder, name);
  };
  const evidence = file('evidence.json', fill(JSON.stringify(c.evidence ?? {})));
  const listed = file('issues.json', JSON.stringify(issues));
  const asked = (logins) => run(['announce-plan', '--repo', work, '--head', 'HEAD', '--adopted', '--evidence', evidence, '--issues', listed, '--logins', file('logins.json', JSON.stringify(logins)), '--now', c.now]);
  const first = asked({});
  assert.equal(first.code, 0, first.stderr);
  const need = JSON.parse(first.stdout).lookups;
  const second = asked(Object.fromEntries(need.map((id) => [id, `u${id}`])));
  assert.equal(second.code, 0, second.stderr);
  return JSON.parse(second.stdout);
}

const built = new Map();
const eligible = [];
// AUDIT_RUN_STRIDE=8 runs only every eighth of the cases from the history to the log branch: mutation testing (reference/fuzz/mutate_pr.py) uses it.
const STRIDE = Number(process.env.AUDIT_RUN_STRIDE ?? 1);
before(() => {
  let counted = 0;
  for (const c of cases) {
    if (c.expect.code !== 0 || c.evidenceRaw !== undefined || c.evidenceHex !== undefined || c.issuesRaw !== undefined || c.since !== undefined) continue;
    if ((counted += 1) % STRIDE !== 0 && STRIDE > 1) continue;
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
    if (STRIDE > 1) return;
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
      const announced = announcementsOf(c, ids, work, JSON.parse(fill(JSON.stringify(c.issues ?? []))));
      const wanted = [...writesOf(plan), ...announced.announcements.map(({ title, body }) => ({ method: 'POST', path: `/repos/${REPO}/issues`, body: { title, body } }))];
      assert.deepEqual(writes, wanted, c.note);
      let created = 1000;
      const said = plan.issues.map((a) => `${{ open: 'opened', update: 'updated', reopen: 'reopened', close: 'closed' }[a.action]} ${a.key} #${a.action === 'open' ? (created += 1) : a.number}`);
      assert.deepEqual(got.stdout.split('\n').filter((line) => /^(opened|updated|reopened|closed) /.test(line)), said, c.note);
      assert.deepEqual(got.stdout.split('\n').filter((line) => /^announced /.test(line)), announced.announcements.map(({ key }) => `announced ${key} #${(created += 1)}`), c.note);
      const last = got.stdout.trimEnd().split('\n').at(-1);
      const kinds = [...(plan.log.length === 0 ? [] : [`${plan.log.length} ${plan.log.length === 1 ? 'entry' : 'entries'}`]), ...(announced.log.length === 0 ? [] : [`${announced.log.length} ${announced.log.length === 1 ? 'announcement' : 'announcements'}`]), 'the record of the run'];
      assert.equal(last, `log: ${kinds.length === 1 ? kinds[0] : `${kinds.slice(0, -1).join(', ')} and ${kinds.at(-1)}`} pushed to record-keeper/log`, c.note);
      const log = logOf(repo);
      assert.ok(log, 'the log branch was made');
      assert.deepEqual(log.files, announced.log.length === 0 ? ['README.md', 'incidents.jsonl', 'last-run.json'] : ['README.md', 'announcements.jsonl', 'incidents.jsonl', 'last-run.json']);
      assert.equal(log.incidents, plan.log.map((entry) => `${JSON.stringify(entry)}\n`).join(''));
      assert.equal(log.announcements, announced.log.length === 0 ? null : announced.log.map((entry) => `${JSON.stringify(entry)}\n`).join(''));
      assert.equal(log.last, `${JSON.stringify(plan.run)}\n`);
      assert.equal(log.commits.length, 1);
      assert.equal(log.message(log.commits[0]).trim(), `Audit of ${plan.run.head} at ${plan.run.at}: ${plan.run.violations} violation${plan.run.violations === 1 ? '' : 's'}, ${plan.log.length} ${plan.log.length === 1 ? 'entry' : 'entries'}${announced.log.length === 0 ? '' : `, ${announced.log.length} ${announced.log.length === 1 ? 'announcement' : 'announcements'}`}`);
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
    const s = await scenario('b32-no-act-no-evidence');
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
    const s = await scenario('b32-no-act-no-evidence');
    const blob = (text) => git(s.work, ['hash-object', '-w', '--stdin'], text);
    const tree = git(s.work, ['mktree'], `100644 blob ${blob('{"cut":')}\tannouncements.jsonl\n100644 blob ${blob('{"cut":\n')}\tincidents.jsonl\n100644 blob ${blob('mine\n')}\tnotes.txt\n`);
    const parent = git(s.work, ['commit-tree', tree, '-m', 'someone else']);
    git(s.work, ['push', '--quiet', 'origin', `${parent}:refs/heads/record-keeper/log`]);
    const server = await serve(github(s.c, s.ids));
    const got = await runAudit(options(s.c, s.work, server));
    assert.equal(got.code, 0);
    const log = logOf(s.repo);
    assert.deepEqual(log.files, ['announcements.jsonl', 'incidents.jsonl', 'last-run.json', 'notes.txt']);
    assert.equal(log.incidents, '{"cut":\n');
    assert.equal(log.announcements, '{"cut":\n', 'the file of the announcements is a log like the other, also when this run announces nothing');
    assert.equal(git(s.repo, ['show', 'refs/heads/record-keeper/log:notes.txt']), 'mine');
    assert.equal(git(s.repo, ['rev-parse', `${log.commits[1]}^`]), parent);
  });
});

describe('the announcements', () => {
  const spec = (id) => announceCases.find((c) => c.id === id);
  const posts = (server) => writesOn(server).filter(({ method }) => method === 'POST');
  const lookups = (server) => server.requests.filter(({ path: route }) => route.startsWith('/user/')).map(({ path: route }) => route);
  const botIssue = (number, key) => ({ number, state: 'open', title: 'Act: pin (#7)', body: `<!-- record-keeper:announcement ${key} -->\nText.\n`, user: { login: 'github-actions[bot]', type: 'Bot' } });

  test('an act that the owners approved is announced: the accounts are looked up, the issue is made, the log has its line, the job says so', async () => {
    const s = await scenario('a01-pin', { spec: spec('a01-pin') });
    const got = await runAudit(options(s.c, s.work, s.server));
    assert.deepEqual(got, { code: 0, stdout: `audit: 0 violations, 0 excused, 1 commit judged\nannounced ${s.ids.c1} #1001\nlog: 1 announcement and the record of the run pushed to record-keeper/log\n`, stderr: '' });
    assert.deepEqual(lookups(s.server), ['/user/1001', '/user/1002']);
    const [made] = posts(s.server);
    assert.equal(posts(s.server).length, 1);
    assert.equal(made.path, '/repos/o/r/issues');
    assert.deepEqual(Object.keys(made.body), ['title', 'body']);
    assert.equal(made.body.title, 'Act: pin (#7)');
    assert.ok(made.body.body.startsWith(`<!-- record-keeper:announcement ${s.ids.c1} -->\n`));
    assert.ok(made.body.body.includes('- Told: @u1001 and @u1002 (owners)\n'));
    const log = logOf(s.repo);
    assert.deepEqual(log.files, ['README.md', 'announcements.jsonl', 'incidents.jsonl', 'last-run.json']);
    assert.equal(log.announcements, `${JSON.stringify({ at: '2026-11-10T03:00:00Z', event: 'announced', key: s.ids.c1, acts: [{ kind: 'pin', path: '.github/record-keeper.yml' }], told: [1001, 1002] })}\n`);
    assert.equal(log.incidents, '');
    assert.match(log.readme, /announcements\.jsonl/);
    assert.equal(log.message(log.commits[0]).trim(), `Audit of ${s.ids.c1} at 2026-11-10T03:00:00Z: 0 violations, 0 entries, 1 announcement`);
  });

  test('the lookups are reads of the account by its id, with the token, and the log is written before the first issue is made', async () => {
    let repo;
    const seen = [];
    const s = await scenario('a01-pin', { spec: spec('a01-pin'), over: (method, route) => {
      if (method === 'POST' && route === '/repos/o/r/issues') seen.push(logOf(repo) !== null);
      return undefined;
    } });
    repo = s.repo;
    await runAudit(options(s.c, s.work, s.server));
    assert.deepEqual(seen, [true]);
    const first = s.server.requests.findIndex(({ method }) => method === 'POST');
    const at = (route) => s.server.requests.findIndex(({ path: found }) => found === route);
    assert.ok(at('/user/1001') < first && at('/user/1002') < first);
    const lookup = s.server.requests.find(({ path: route }) => route === '/user/1001');
    assert.equal(lookup.method, 'GET');
    assert.equal(lookup.headers.authorization, 'Bearer tok');
  });

  test('a dry run says what it would announce, reads the accounts and writes nothing', async () => {
    const s = await scenario('a01-pin', { spec: spec('a01-pin') });
    const got = await runAudit(options(s.c, s.work, s.server, { dryRun: true }));
    assert.deepEqual(got, { code: 0, stdout: `audit: 0 violations, 0 excused, 1 commit judged\nwould announce ${s.ids.c1}\ndry run: nothing was written\n`, stderr: '' });
    assert.equal(writesOn(s.server).length, 0);
    assert.equal(logOf(s.repo), null);
  });

  test('an act that has its issue is not announced again, and nobody is looked up', async () => {
    const s = await scenario('a01-pin', { spec: spec('a01-pin'), issues: [] });
    const server = await serve(github(s.c, s.ids, { issues: [botIssue(5, s.ids.c1)] }));
    const got = await runAudit(options(s.c, s.work, server));
    assert.deepEqual(got, { code: 0, stdout: 'audit: 0 violations, 0 excused, 1 commit judged\nlog: the record of the run pushed to record-keeper/log\n', stderr: '' });
    assert.equal(posts(server).length, 0);
    assert.deepEqual(lookups(server), []);
    assert.deepEqual(logOf(s.repo).files, ['README.md', 'incidents.jsonl', 'last-run.json']);
  });

  test('the log of the announcements is appended to, and kept when a run announces nothing', async () => {
    const s = await scenario('a01-pin', { spec: spec('a01-pin') });
    await runAudit(options(s.c, s.work, s.server));
    const before = logOf(s.repo).announcements;
    const server = await serve(github(s.c, s.ids, { issues: [botIssue(5, s.ids.c1)] }));
    await runAudit(options(s.c, s.work, server));
    const after = logOf(s.repo);
    assert.equal(after.announcements, before);
    assert.equal(after.commits.length, 2);
    assert.equal(after.message(after.commits[1]).trim(), `Audit of ${s.ids.c1} at 2026-11-10T03:00:00Z: 0 violations, 0 entries`);
  });

  test('two announcements are made in the order of the commits, a pause apart and not before the first', async () => {
    const s = await scenario('d01', { spec: spec('d01-two-commits-in-order') });
    const slept = [];
    const got = await runAudit(options(s.c, s.work, s.server, { pause: 250, sleep: async (ms) => { slept.push(ms); } }));
    assert.equal(got.code, 0, got.stderr);
    assert.deepEqual(slept, [250]);
    assert.deepEqual(posts(s.server).map(({ body }) => body.title), ['Act: pin (#7)', 'Act: pin (#8)']);
    assert.deepEqual(got.stdout.split('\n').filter((line) => line.startsWith('announced ')), [`announced ${s.ids.c1} #1001`, `announced ${s.ids.c2} #1002`]);
    assert.equal(lookups(s.server).length, 2, 'each account once, not once for each announcement');
    assert.match(got.stdout, /log: 2 announcements and the record of the run pushed to record-keeper\/log\n$/);
  });

  test('the pause is a second when nothing says otherwise', async () => {
    const s = await scenario('d01', { spec: spec('d01-two-commits-in-order') });
    const slept = [];
    const original = globalThis.setTimeout;
    globalThis.setTimeout = (callback, ms, ...rest) => {
      if (ms === 1000) {
        slept.push(ms);
        return original(callback, 0, ...rest);
      }
      return original(callback, ms, ...rest);
    };
    try {
      await runAudit(options(s.c, s.work, s.server, { pause: undefined }));
    } finally {
      globalThis.setTimeout = original;
    }
    assert.deepEqual(slept, [1000]);
  });

  test('an incident and an announcement are both made and both counted', async () => {
    const s = await scenario('b03', { spec: spec('b03-the-bar-is-not-met') });
    const got = await runAudit(options(s.c, s.work, s.server));
    assert.equal(got.code, 1);
    assert.match(got.stdout, /opened -:A-03 #1001\nannounced [0-9a-f]{40} #1002\nlog: 1 entry, 1 announcement and the record of the run pushed to record-keeper\/log\n$/);
    assert.deepEqual(posts(s.server).map(({ body }) => body.title.slice(0, 8)), ['Records:', 'Act: set']);
    const log = logOf(s.repo);
    assert.equal(log.message(log.commits[0]).trim(), `Audit of ${s.ids.c1} at 2026-11-10T03:00:00Z: 1 violation, 1 entry, 1 announcement`);
  });

  test('a refused announcement stops the run with the reason, after the log was written, and the others are left for the next run', async () => {
    const s = await scenario('d01', { spec: spec('d01-two-commits-in-order'), over: (method, route) => (method === 'POST' && route === '/repos/o/r/issues' ? { status: 422, body: { message: 'no' } } : undefined) });
    const got = await runAudit(options(s.c, s.work, s.server));
    assert.deepEqual(got, { code: 2, stdout: '', stderr: 'Records audit could not run: POST /repos/o/r/issues answered 422\n' });
    assert.equal(posts(s.server).length, 1);
    assert.equal(logOf(s.repo).announcements.split('\n').filter(Boolean).length, 2);
  });

  test('one account to look up is looked up, and its login is in the issue', async () => {
    const single = JSON.parse(JSON.stringify(spec('a01-pin')).replaceAll('owners: [alice/1001, bob/1002]', 'owners: [alice/1001]'));
    const s = await scenario('a01-pin', { spec: single });
    const got = await runAudit(options(s.c, s.work, s.server));
    assert.equal(got.code, 0, got.stderr);
    assert.deepEqual(lookups(s.server), ['/user/1001']);
    assert.ok(posts(s.server)[0].body.body.includes('- Told: @u1001 (owners)\n'));
  });

  test('an answer to the making of an issue that has no number is no answer', async () => {
    for (const answer of [{ status: 201, body: {} }, { status: 201, body: { number: 'x' } }, { status: 201, body: { number: 0 } }, { status: 201, body: [] }]) {
      const s = await scenario('a01-pin', { spec: spec('a01-pin'), over: (method, route) => (method === 'POST' && route === '/repos/o/r/issues' ? answer : undefined) });
      const got = await runAudit(options(s.c, s.work, s.server));
      assert.equal(got.code, 2, JSON.stringify(answer));
      assert.ok(got.stderr.includes('the answer to /repos/o/r/issues is not what the audit needs'), `${JSON.stringify(answer)}: ${got.stderr}`);
    }
  });

  test('the last line of the job counts the entries and the announcements, with the plural of each', async () => {
    const s = await scenario('e03-two-violations-two-issues');
    const got = await runAudit(options(s.c, s.work, s.server));
    assert.equal(got.code, 1);
    assert.match(got.stdout, /\nlog: 2 entries and the record of the run pushed to record-keeper\/log\n$/);
    const log = logOf(s.repo);
    assert.match(log.message(log.commits[0]), /: 2 violations, 2 entries\n?$/);
  });

  test('an account that GitHub does not know is not mentioned', async () => {
    const s = await scenario('a01-pin', { spec: spec('a01-pin'), over: (method, route) => (method === 'GET' && route === '/user/1002' ? { status: 404, body: { message: 'Not Found' } } : undefined) });
    const got = await runAudit(options(s.c, s.work, s.server));
    assert.equal(got.code, 0, got.stderr);
    assert.ok(posts(s.server)[0].body.body.includes('- Told: @u1001 and bob/1002 (no longer an account) (owners)\n'));
    assert.match(logOf(s.repo).announcements, /"told":\[1001\]/);
  });

  test('an answer that is not what the audit needs, or a login that does not fit, is no answer', async () => {
    const answers = [
      [{ status: 500, body: {} }, 'GET /user/1001 answered 500'],
      [{ body: { id: 1 } }, 'the answer to /user/1001 is not what the audit needs'],
      [{ body: [] }, 'the answer to /user/1001 is not what the audit needs'],
      [{ body: 'not json' }, 'the answer to /user/1001 is not what the audit needs'],
      [{ body: { login: 'a b' } }, 'logins.json: 1001: is neither a login nor null'],
    ];
    for (const [answer, reason] of answers) {
      const s = await scenario('a01-pin', { spec: spec('a01-pin'), over: (method, route) => (method === 'GET' && route === '/user/1001' ? answer : undefined) });
      const got = await runAudit(options(s.c, s.work, s.server));
      assert.equal(got.code, 2, reason);
      assert.ok(got.stderr.includes(reason), `${reason}: ${got.stderr}`);
      assert.equal(writesOn(s.server).length, 0, 'nothing is written when the logins are not known');
      assert.equal(logOf(s.repo), null);
    }
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
    // The limit is 300 in the program; the tests set it low, because the audit takes some 50 milliseconds for each commit.
    let many;
    before(() => {
      const base = byId('b01-the-author-is-an-owner');
      const spec = { id: 'many', commits: [{ ...base.commits[0] }] };
      for (let i = 1; i <= 6; i++) spec.commits.push({ id: `c${i}`, parents: [`c${i - 1}`], message: `commit ${i}`, changes: [{ write: '.github/record-keeper.yml', content: `version: ${i + 1}\n` }] });
      many = { spec, ...build(spec, 'many') };
    });

    test('more than the limit: the run stops before it asks about any of them', async () => {
      const work = workdir(many.repo);
      const server = await serve(github(many.spec, many.ids));
      assert.deepEqual(await runAudit(options({ now: '2026-11-10T03:00:00Z' }, work, server, { maxCommits: 5 })), failure('more than 5 commits with acts'));
      assert.equal(server.requests.length, 1);
    });

    test('exactly the limit: all are asked about, one after the other, and the violations are one issue', async () => {
      const work = workdir(many.repo);
      const server = await serve(github(many.spec, many.ids));
      const got = await runAudit(options({ now: '2026-11-10T03:00:00Z' }, work, server, { maxCommits: 6 }));
      assert.equal(got.code, 1, got.stderr);
      assert.equal(server.requests.filter(({ path: route }) => route.endsWith('/pulls')).length, 6);
      const [write] = writesOn(server);
      assert.equal(write.body.body.split('\n').filter((line) => line.startsWith('- ')).length, 6);
    });

    test('the limit of the program is the 300 of the page', () => {
      assert.match(fs.readFileSync(script, 'utf8'), /^const MAX_COMMITS = 300;$/m);
      assert.match(fs.readFileSync(path.join(root, 'docs/audit-run.md'), 'utf8'), /`more than 300 commits with acts`/);
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

// ---- the details that mutation testing asked for ------------------------------------------------------------------------------------------------
describe('the shapes of what GitHub answers, to the character', () => {
  const HEAD = 'e'.repeat(40);
  const failsAs = (id, query = '?per_page=100') => ({ code: 2, stdout: '', stderr: `Records audit could not run: the answer to /repos/o/r/commits/${id}/pulls${query} is not what the audit needs\n` });
  /** One scenario whose list of pull requests the test changes from call to call; every pull request in it is made against another branch, so none brings the act in. */
  async function listing() {
    const state = { list: [] };
    const s = await scenario('b01-the-author-is-an-owner', {
      over: (method, route) => (method === 'GET' && /\/commits\/[0-9a-f]+\/pulls$/.test(route) ? { body: state.list } : undefined),
    });
    // b01 has an act in its commit and no evidence in the case: the pull requests are the answer of the server, so list them for that commit
    return { s, state, id: s.ids.c1 };
  }
  const pull = (over) => ({ number: 5, user: { id: 1001 }, head: { sha: HEAD }, merged_at: '2026-11-09T12:00:00Z', merge_commit_sha: null, base: { ref: 'dev' }, state: 'closed', ...over });

  test('a time is YYYY-MM-DDTHH:MM:SSZ with a month, a day, an hour, a minute and a second that exist: every digit of every field', async () => {
    const { s, state } = await listing();
    const good = ['2026-01-01T00:00:00Z', '2026-09-10T09:19:20Z', '2026-10-20T10:20:29Z', '2026-11-30T19:59:59Z', '2026-12-09T23:01:30Z', '2026-02-19T12:34:56Z'];
    state.list = good.map((merged_at, index) => pull({ number: index + 1, merged_at }));
    const got = await runAudit(options(s.c, s.work, s.server, { dryRun: true }));
    assert.doesNotMatch(got.stderr, /is not what the audit needs/, got.stderr);
    for (const merged_at of ['2026-00-01T00:00:00Z', '2026-13-01T00:00:00Z', '2026-01-00T00:00:00Z', '2026-01-32T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:60:00Z', '2026-01-01T00:00:60Z',
      '2026-01-01T00:00:00', '2026-01-01T00:00:00.000Z', ' 2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z ', 'x2026-01-01T00:00:00Z', '2026-01-01T00:00:00Zx', '2026-01-01 00:00:00Z', '2026-1-01T00:00:00Z', '26-01-01T00:00:00Z', '2026-01-01t00:00:00z']) {
      state.list = [pull({ merged_at })];
      assert.deepEqual(await runAudit(options(s.c, s.work, s.server, { dryRun: true })), failsAs(s.ids.c1), merged_at);
    }
  });

  test('an identifier is a whole number from 1 to 999999999999999', async () => {
    const { s, state } = await listing();
    state.list = [pull({ number: 1, user: { id: 1 } }), pull({ number: 999_999_999_999_999, user: { id: 999_999_999_999_999 } }), pull({ number: 2, user: null })];
    assert.doesNotMatch((await runAudit(options(s.c, s.work, s.server, { dryRun: true }))).stderr, /is not what the audit needs/);
    for (const over of [{ number: 0 }, { number: -1 }, { number: 1.5 }, { number: 1e15 }, { number: '5' }, { number: null }, { user: { id: 0 } }, { user: { id: 1e15 } }, { user: { id: 1.5 } }, { user: { id: '1' } }, { user: 5 }]) {
      state.list = [pull(over)];
      assert.deepEqual(await runAudit(options(s.c, s.work, s.server, { dryRun: true })), failsAs(s.ids.c1), JSON.stringify(over));
    }
  });
});

describe('the address of the API', () => {
  test('trailing slashes are dropped, and a path in front of the routes is kept (a server of GitHub Enterprise)', async () => {
    const c = byId('b32-no-act-no-evidence');
    const { repo, ids } = build(c, `prefix-${(worlds += 1)}`);
    const inner = github(c, ids);
    const server = await serve((method, route, query, body, seen, origin) => (route.startsWith('/ghe/api/v3/') ? inner(method, route.slice('/ghe/api/v3'.length), query, body, seen, origin) : undefined));
    for (const slashes of ['', '/', '//', '///']) {
      const work = workdir(repo);
      const got = await runAudit(options(c, work, server, { api: `${server.url}/ghe/api/v3${slashes}`, dryRun: true }));
      assert.equal(got.code, 0, `${slashes}: ${got.stderr}`);
    }
    assert.ok(server.requests.every(({ path: route }) => route.startsWith('/ghe/api/v3/repos/o/r')));
    const bare = await serve(github(c, ids));
    assert.equal((await runAudit(options(c, workdir(repo), bare, { api: `${bare.url}/`, dryRun: true }))).code, 0);
    assert.ok(bare.requests.every(({ path: route }) => route.startsWith('/repos/o/r')));
  });

  test('the names of a repository: letters, digits, dot, underscore and hyphen, one to a hundred characters each', async () => {
    const c = byId('b01-the-author-is-an-owner');
    const { repo } = build(c, `names-${(worlds += 1)}`);
    const none = await serve(() => undefined);
    const work = workdir(repo);
    const message = (name) => `Records audit could not run: GET /repos/${name} answered 404\n`;
    for (const name of ['a/b', 'A/Z', 'Own-er_1.x/Re-po_2.y', '0/9', 'z/_', '-/.x', `${'x'.repeat(100)}/${'y'.repeat(100)}`]) {
      assert.equal((await runAudit(options(c, work, none, { repo: name }))).stderr, message(name), name);
    }
    for (const name of [`${'x'.repeat(101)}/y`, `x/${'y'.repeat(101)}`, 'a b/c', 'a/c!', 'a/é', 'a:b/c', 'a/b/c']) {
      assert.equal((await runAudit(options(c, work, none, { repo: name }))).stderr, 'Records audit could not run: repository: must be owner/name\n', name);
    }
  });
});

describe('what the messages and the links look like', () => {
  const throwing = (error) => () => { throw error; };

  test('a message of an error is cut at 200 characters, and comes from the cause, its code, or the error itself, in that order', async () => {
    const s = await scenario('b01-the-author-is-an-owner');
    const run = async (error) => (await runAudit(options(s.c, s.work, s.server, { fetch: throwing(error) }))).stderr;
    const long = 'x'.repeat(300);
    assert.equal(await run(Object.assign(new TypeError('outer'), { cause: new Error(long) })), `Records audit could not run: GET /repos/o/r failed: ${'x'.repeat(200)}\n`);
    assert.equal(await run(Object.assign(new TypeError('outer'), { cause: Object.assign(new Error(''), { code: 'ECODE' }) })), 'Records audit could not run: GET /repos/o/r failed: ECODE\n');
    assert.equal(await run(Object.assign(new TypeError('outer'), { cause: new Error('inner') })), 'Records audit could not run: GET /repos/o/r failed: inner\n');
    assert.equal(await run(new TypeError(`${long}`)), `Records audit could not run: GET /repos/o/r failed: ${'x'.repeat(200)}\n`);
    assert.equal(await run(new TypeError('plain')), 'Records audit could not run: GET /repos/o/r failed: plain\n');
  });

  test('a message of git is cut at 400 characters', async () => {
    const s = await scenario('b01-the-author-is-an-owner');
    git(s.work, ['remote', 'set-url', 'origin', `/no/such/${'p'.repeat(600)}`]);
    const got = await runAudit(options(s.c, s.work, s.server));
    assert.equal(got.code, 2);
    const message = got.stderr.replace(/^Records audit could not run: /, '').replace(/\n$/, '');
    assert.match(message, /^git ls-remote failed: /);
    assert.equal(message.length, 400);
  });

  test('the link to the next page is the one marked next, among others, with or without a space, and not one that only contains the word', async () => {
    const link = (header) => async () => {
      const s = await scenario('b01-the-author-is-an-owner', {
        over: (method, route, query, body, seen, origin) => (method === 'GET' && route === `/repos/${REPO}/issues`
          ? (query.get('page') === '2' ? { body: [] } : { body: [], headers: { link: header(`${origin}${route}?page=2`) } }) : undefined),
      });
      await runAudit(options(s.c, s.work, s.server, { dryRun: true }));
      return s.server.requests.filter(({ path: route }) => route === `/repos/${REPO}/issues`).length;
    };
    for (const header of [(u) => `<${u}>; rel="next"`, (u) => `<${u}>;rel="next"`, (u) => `<${u}>;   rel="next"`, (u) => `<${u}>; rel="prev next"`, (u) => `<${u}>; rel="next last"`, (u) => `<${u}>; rel="first next last"`,
      (u) => `<http://127.0.0.1:1/p>; rel="prev", <${u}>; rel="next"`, (u) => `<${u}>; rel="next"; title="x"`]) {
      assert.equal(await link(header)(), 2, header('U'));
    }
    for (const header of [(u) => `<${u}>; rel="nextish"`, (u) => `<${u}>; rel="xnext"`, (u) => `<${u}>; rel="prev"`, (u) => `<${u}>; rel=next`, (u) => `<${u}>`, () => 'nonsense']) {
      assert.equal(await link(header)(), 1, header('U'));
    }
  });

  test('every listing asks for a hundred in a page, and the check runs for the one check', async () => {
    const s = await scenario('b02-no-owner-approved');
    await runAudit(options(s.c, s.work, s.server));
    const lists = s.server.requests.filter(({ method, path: route }) => method === 'GET' && route !== `/repos/${REPO}`);
    assert.ok(lists.length >= 4);
    for (const { path: route, query } of lists) assert.equal(query.get('per_page'), '100', route);
  });

  test('the time of the run is written without the thousandths', async () => {
    const s = await scenario('b01-the-author-is-an-owner');
    await runAudit(options(s.c, s.work, s.server, { now: () => Date.parse('2026-11-10T03:00:00Z') + 789 }));
    assert.equal(JSON.parse(logOf(s.repo).last).at, '2026-11-10T03:00:00Z');
  });

  test('with one run of the check by the app, that run is the start', async () => {
    const c = byId('b20-erratum-too-soon');
    const s = await scenario('b20-erratum-too-soon', {
      over: (method, route) => (method === 'GET' && route.endsWith('/check-runs') ? { body: { check_runs: [{ name: 'Records integrity', app: { slug: 'github-actions' }, started_at: '2026-11-09T11:00:00Z' }] } } : undefined),
    });
    const got = await runAudit(options(c, s.work, s.server, { dryRun: true }));
    assert.match(got.stderr, /\(1h of 48h\)/);
  });
});

describe('the push, to the end', () => {
  test('three attempts are made, no more and no fewer', async () => {
    const s = await scenario('b02-no-owner-approved');
    const racer = path.join(scratch, `counted-${worlds}.git`);
    git(scratch, ['init', '-q', '--bare', racer]);
    const blob = git(s.work, ['hash-object', '-w', '--stdin'], 'x\n');
    const tree = git(s.work, ['mktree'], `100644 blob ${blob}\tincidents.jsonl\n`);
    git(s.work, ['push', '--quiet', racer, `${git(s.work, ['commit-tree', tree, '-m', 'first'])}:refs/heads/record-keeper/log`]);
    const calls = path.join(scratch, `attempts-${worlds}`);
    fs.mkdirSync(path.join(s.work, '.git', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(s.work, '.git', 'hooks', 'pre-push'), `#!/bin/sh\necho x >> '${calls}'\nexit 0\n`, { mode: 0o755 });
    git(s.work, ['config', 'remote.origin.pushurl', racer]);
    assert.match((await runAudit(options(s.c, s.work, s.server))).stderr, /could not push the log after 3 attempts/);
    assert.equal(fs.readFileSync(calls, 'utf8'), 'x\nx\nx\n');
  });

  test('a push that fails for another reason is not a lost race: it is not tried again, and its message is shown', async () => {
    const s = await scenario('b02-no-owner-approved');
    git(s.work, ['config', 'remote.origin.pushurl', path.join(scratch, 'no-such-repository.git')]);
    const got = await runAudit(options(s.c, s.work, s.server));
    assert.equal(got.code, 2);
    assert.match(got.stderr, /^Records audit could not run: git push failed: .*no-such-repository/s);
    assert.doesNotMatch(got.stderr, /attempts/);
    assert.equal(writesOn(s.server).length, 0);
  });
});

describe('more details', () => {
  test('without GITHUB_API_URL the program talks to api.github.com (the test refuses to let it)', async () => {
    const s = await scenario('b01-the-author-is-an-owner');
    const got = await runCli(['--repo', REPO, '--dry-run'], { GITHUB_TOKEN: 'tok' }, { cwd: s.work });
    assert.deepEqual(got, { code: 2, stdout: '', stderr: 'Records audit could not run: GET /repos/o/r failed: a test made a request to https://api.github.com/repos/o/r\n' });
    const empty = await runCli(['--repo', REPO, '--dry-run'], { GITHUB_TOKEN: 'tok', GITHUB_API_URL: '' }, { cwd: s.work });
    assert.equal(empty.stderr, got.stderr);
  });

  test('an address that is https is taken whatever the host; http only for this machine, by name or by number', async () => {
    const s = await scenario('b01-the-author-is-an-owner');
    assert.equal((await runAudit(options(s.c, s.work, s.server, { api: 'https://api.example.com/v3' }))).stderr, 'Records audit could not run: GET /repos/o/r failed: a test made a request to https://api.example.com/v3/repos/o/r\n');
    const port = new URL(s.server.url).port;
    for (const host of ['localhost', '127.0.0.1']) assert.equal((await runAudit(options(s.c, s.work, s.server, { api: `http://${host}:${port}`, dryRun: true }))).code, 0, host);
    for (const api of ['http://localhosts', 'http://127.0.0.2', 'http://example.com', 'ws://localhost', 'file:///x']) {
      assert.equal((await runAudit(options(s.c, s.work, s.server, { api }))).stderr, 'Records audit could not run: API address: must be an https address without credentials, query or fragment\n', api);
    }
    for (const api of ['https://u@example.com', 'https://:p@example.com', 'https://example.com?', 'https://example.com#']) {
      assert.equal((await runAudit(options(s.c, s.work, s.server, { api }))).stderr, 'Records audit could not run: API address: must be an https address without credentials, query or fragment\n', api);
    }
  });

  test('every request asks for the JSON of GitHub, with the token, in the version the program was written for', async () => {
    const s = await scenario('b02-no-owner-approved');
    await runAudit(options(s.c, s.work, s.server));
    for (const { headers, method, path: route } of s.server.requests) {
      assert.equal(headers.accept, 'application/vnd.github+json', route);
      assert.equal(headers.authorization, 'Bearer tok', route);
      assert.equal(headers['x-github-api-version'], '2022-11-28', route);
      assert.equal(headers['content-type'], method === 'GET' ? undefined : 'application/json', route);
    }
  });

  test('a connection that was reset is tried again whatever the code that says so, and a timeout is not', async () => {
    const error = (code) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });
    for (const code of ['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET']) {
      const s = await scenario('b01-the-author-is-an-owner');
      let first = true;
      const fetch = (url, init) => { if (first && init.method === 'GET') { first = false; throw error(code); } return globalThis.fetch(url, init); };
      assert.equal((await runAudit(options(s.c, s.work, s.server, { fetch, dryRun: true }))).code, 0, code);
    }
    const s = await scenario('b01-the-author-is-an-owner');
    let calls = 0;
    const fetch = () => { calls += 1; throw error('ETIMEDOUT'); };
    assert.equal((await runAudit(options(s.c, s.work, s.server, { fetch }))).stderr, 'Records audit could not run: GET /repos/o/r failed: ETIMEDOUT\n');
    assert.equal(calls, 1);
  });

  test('evidence that the audit cannot read is named: the file is evidence.json, and the plan does not run', async () => {
    const s = await scenario('b02-no-owner-approved', {
      over: (method, route) => (method === 'GET' && /\/commits\/[0-9a-f]+\/pulls$/.test(route) ? { body: [{ number: 5, user: { id: 1 }, head: { sha: 'abc' }, merged_at: '2026-11-09T12:00:00Z', merge_commit_sha: null, base: { ref: 'main' }, state: 'closed' }] } : undefined),
    });
    const got = await runAudit(options(s.c, s.work, s.server));
    assert.deepEqual(got, { code: 2, stdout: '', stderr: `Records audit could not run: the audit could not read the history: evidence.json: ${s.ids.c1}: pull: head.sha is not a full commit id\n` });
    assert.equal(writesOn(s.server).length, 0);
    assert.equal(logOf(s.repo), null);
  });

  test('a listing that does not end is named by what it lists: pull requests, reviews, check runs', async () => {
    const endless = (suffix) => async (id, scenarioName) => {
      const s = await scenario(scenarioName, {
        over: (method, route, query, body, seen, origin) => {
          if (method !== 'GET' || !route.endsWith(suffix)) return undefined;
          const next = `${origin}${route}?page=${Number(query.get('page') ?? 1) + 1}`;
          const headers = { link: `<${next}>; rel="next"` };
          return suffix === '/check-runs' ? { body: { check_runs: [] }, headers } : { body: [], headers };
        },
      });
      return runAudit(options(s.c, s.work, s.server, { dryRun: true }));
    };
    assert.equal((await endless('/pulls')('x', 'b02-no-owner-approved')).stderr, 'Records audit could not run: more than 200 pages of pull requests\n');
    assert.equal((await endless('/reviews')('x', 'b03-an-owner-approved-the-head')).stderr, 'Records audit could not run: more than 200 pages of reviews\n');
    assert.equal((await endless('/check-runs')('x', 'b20-erratum-too-soon')).stderr, 'Records audit could not run: more than 200 pages of check runs\n');
  });
});
