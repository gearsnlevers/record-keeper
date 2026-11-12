// The audit run (docs/audit-run.md): run-audit.mjs against a local server that plays GitHub and against real git repositories.
// The repositories are the histories of test/fixtures/audit-effects, built with `git fast-import`; `origin` of the work directory is a bare
// repository, so the log branch can be read back from it. Nothing here may reach the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
