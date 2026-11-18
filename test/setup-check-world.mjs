// A world for the tests of the runner of the setup check (docs/setup-check.md): a local server that plays GitHub with the shapes of the answers that were read from
// the real API (the names, the numbers and the logins are made up), and the working tree of a repository that installed the kit. This file holds no test: the
// files setup-check-run*.test.mjs use it. Nothing here reaches the network, and every working tree is made in a folder of its own.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { canonical } from '../tools/build-release-manifest.mjs';
import { runCli } from '../setup-check.mjs';
import { renderPin } from '../updater.mjs';

export const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);
export const TOKEN = 'ghs_SetupCheckTestToken0123456789abcdef';
/** The secret of the updater. The program is never given it, so a request that carries it is a failure. */
export const SECRET = 'ghp_RecordKeeperSecretThatMustNeverLeave0123456789';
export const CHECK = 'Records integrity';
export const COMMIT = 'a1'.repeat(20);

const servers = [];
// The folder for the working trees is made when the first one is asked for, so that a file that only imports this one (the runner of the tests takes it for a test
// file too) leaves nothing behind.
let scratch = null;
let made = 0;

/** Closes every server and removes every folder that this file made. */
export function cleanUp() {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
  if (scratch !== null) fs.rmSync(scratch, { recursive: true, force: true });
}

export const folder = (name = 'tree') => {
  scratch ??= fs.mkdtempSync(path.join(os.tmpdir(), 'record-keeper-setup-'));
  const dir = path.join(scratch, `${name}-${(made += 1)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
export const write = (dir, relative, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
  fs.writeFileSync(path.join(dir, relative), content);
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

// ---- the shapes of GitHub ------------------------------------------------------------------------------------------------------------------------------

/** A rule of the type `required_status_checks`, as `GET /repos/{repo}/rules/branches/{branch}` lists it. */
export const requiring = (id, { strict = true, checks = [CHECK, 'Test gate'], repo = 'example/repo' } = {}) => ({
  type: 'required_status_checks',
  parameters: { strict_required_status_checks_policy: strict, do_not_enforce_on_create: false, required_status_checks: checks.map((context) => ({ context })) },
  ruleset_source_type: 'Repository',
  ruleset_source: repo,
  ruleset_id: id,
});
/** The other rules of a ruleset, which the check does not read. */
export const others = (id, repo = 'example/repo') => [
  { type: 'deletion', ruleset_source_type: 'Repository', ruleset_source: repo, ruleset_id: id },
  { type: 'non_fast_forward', ruleset_source_type: 'Repository', ruleset_source: repo, ruleset_id: id },
  { type: 'pull_request', parameters: { required_approving_review_count: 0, dismiss_stale_reviews_on_push: false, required_reviewers: [], require_code_owner_review: false, dismissal_restriction: { enabled: false, allowed_actors: [] }, require_last_push_approval: false, required_review_thread_resolution: false, require_extra_approval_for_unattributed_changes: true, allowed_merge_methods: ['merge', 'squash', 'rebase'] }, ruleset_source_type: 'Repository', ruleset_source: repo, ruleset_id: id },
];
/** A ruleset as `GET /repos/{repo}/rulesets/{id}` gives it to an administrator; `actors` undefined leaves the field out, as for a token that is shown no list. */
export const ruleset = (id, options = {}) => {
  const { name = 'main protection', repo = 'example/repo' } = options;
  const actors = 'actors' in options ? options.actors : [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }];
  return {
  id,
  name,
  target: 'branch',
  source_type: 'Repository',
  source: repo,
  enforcement: 'active',
  conditions: { ref_name: { exclude: [], include: ['~DEFAULT_BRANCH'] } },
  rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, do_not_enforce_on_create: false, required_status_checks: [{ context: CHECK }] } }],
  node_id: `RRS_example${id}`,
  created_at: '2026-11-03T21:07:34.941-07:00',
  updated_at: '2026-11-07T11:54:02.497-07:00',
  ...(actors === undefined ? {} : { bypass_actors: actors, current_user_can_bypass: 'pull_requests_only' }),
  _links: { self: { href: `https://api.github.com/repos/${repo}/rulesets/${id}` }, html: { href: `https://github.com/${repo}/rules/${id}` } },
  };
};
/** `GET /repos/{repo}/branches/{branch}` for a branch that a ruleset protects, and for one that branch protection does. */
export const branchByRuleset = (name = 'main') => ({ name, commit: { sha: COMMIT }, protected: true, protection: { enabled: false, required_status_checks: { enforcement_level: 'off', contexts: [], checks: [] } }, protection_url: 'https://api.github.com/x' });
export const branchByProtection = (name = 'main', checks = [CHECK], level = 'non_admins') => ({ name, commit: { sha: COMMIT }, protected: true, protection: { enabled: true, required_status_checks: { enforcement_level: level, contexts: checks, checks: checks.map((context) => ({ app_id: null, context })) } } });
/** An entry of `GET /repos/{repo}/commits?path=...`. */
export const commitOf = (date) => ({
  sha: createHash('sha1').update(date).digest('hex'),
  node_id: 'C_example',
  commit: { author: { name: 'A Person', email: 'a@example.com', date }, committer: { name: 'A Person', email: 'a@example.com', date }, message: 'Add the audit', tree: { sha: COMMIT }, comment_count: 0 },
  parents: [],
});
export const lastRunText = (at, extra = {}) => `${JSON.stringify({ at, head: 'b2'.repeat(20), from: 'c3'.repeat(20), judged: 19, violations: 0, excused: 0, ...extra })}\n`;
export const hoursAgo = (hours) => new Date(NOW - hours * 3600 * 1000).toISOString().replace('.000Z', 'Z');

// ---- the kit that was installed, and the release that it came from ------------------------------------------------------------------------------------

export const FILES = {
  '.github/record-keeper/record-keeper.mjs': '// rules 1\n',
  '.github/record-keeper/setup-check.mjs': '// setup check 1\n',
  '.github/workflows/records-audit.yml': 'name: Records audit\n',
  '.github/workflows/records-setup-check.yml': 'name: Records setup check\n',
};
export const REQUIRES = { rulesets: [{ branch: 'default', checks: [CHECK], 'up-to-date': true }], secrets: ['RECORD_KEEPER_TOKEN'], settings: ['owners'] };

/** A release of the kit: the tag, the manifest as an asset, and the entry that the list of releases has for it. */
export function releaseOf(tag, files = FILES, { requires = REQUIRES, commit = COMMIT, assetId = 700, mutate } = {}) {
  const entries = Object.entries(files).map(([destination, content]) => ({ kind: 'managed', path: destination, sha256: sha(content), size: Buffer.byteLength(content), source: `kit/${destination}` }));
  const manifest = { commit, files: entries, generations: ['g1'], node: '>=22', requires, schema: 1, tag, version: tag.slice(1) };
  if (mutate) mutate(manifest);
  const text = canonical(manifest);
  return { tag, text, entry: { tag_name: tag, draft: false, prerelease: false, body: `Notes of ${tag}.`, assets: [{ id: assetId, name: 'release-manifest.json', size: Buffer.byteLength(text) }] }, assetId };
}

/** The state of a world in which nothing is wrong: the audit ran three hours ago, the ruleset requires the check and carries no actor that may bypass but for pull requests. */
export function healthy() {
  const release = releaseOf('v1.0.0');
  return {
    repo: 'example/repo',
    source: 'example/kit',
    branch: 'main',
    pageSize: 100,
    rules: [...others(4101), requiring(4101)],
    rulesets: new Map([[4101, ruleset(4101)]]),
    branchBody: branchByRuleset(),
    users: new Map([[1001, 'alice'], [1002, 'Bob']]),
    lastRun: lastRunText(hoursAgo(3)),
    commits: [commitOf(hoursAgo(500))],
    releases: [release],
    requests: [],
    fault: null,
    redirect: false,
    nextAsset: 800,
    chunked: false,
  };
}

/** The files of a repository that installed v1.0.0 and has two owners, as `{ path: text }`. */
export const installed = () => ({
  '.github/record-keeper.yml': renderPin({ source: 'example/kit', version: 'v1.0.0', commit: COMMIT, channel: 'stable' }),
  '.github/record-keeper/settings.yml': 'owners: [alice/1001, bob/1002]\napprovals: 2\n',
  '.github/CODEOWNERS': '# the kit\n/.github/ @alice @bob\n',
  ...FILES,
});

/** Writes `files` into a folder of its own, and returns it. */
export function tree(files = installed()) {
  const dir = folder();
  for (const [relative, content] of Object.entries(files)) if (content !== null) write(dir, relative, content);
  return dir;
}

// ---- the server --------------------------------------------------------------------------------------------------------------------------------------

/** The server that plays GitHub for `state`. Returns the state with its `url`. A request that was made is in `state.requests`. */
export async function serve(state = healthy()) {
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const entry = { method: request.method, path: decodeURIComponent(url.pathname), raw: url.pathname, search: url.search, query: url.searchParams, authorization: request.headers.authorization, accept: request.headers.accept, userAgent: request.headers['user-agent'], apiVersion: request.headers['x-github-api-version'], headers: request.headers, body: Buffer.concat(chunks).toString('utf8') };
      state.requests.push(entry);
      const send = (status, body, headers = {}) => {
        const raw = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
        const type = { 'content-type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json' };
        if (state.chunked) {
          response.writeHead(status, { ...type, ...headers });
          response.write(raw.subarray(0, Math.floor(raw.length / 2)));
          response.end(raw.subarray(Math.floor(raw.length / 2)));
        } else {
          response.writeHead(status, { ...type, 'content-length': String(raw.length), ...headers });
          response.end(raw);
        }
      };
      const fault = state.fault?.(entry);
      if (fault) return send(fault.status, fault.body ?? { message: 'fault' }, fault.headers);
      const answer = route(state, entry, `http://${request.headers.host}`);
      return answer === undefined ? send(404, { message: 'Not Found', documentation_url: 'https://docs.github.com/rest', status: '404' }) : send(answer.status ?? 200, answer.body, answer.headers);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  state.url = `http://127.0.0.1:${server.address().port}`;
  return state;
}

/** One page of a list, as GitHub pages it: `page` and `per_page`, and a `Link` header with `rel="next"` when there is more. */
function paged(list, entry, origin, size) {
  const per = Math.min(Number(entry.query.get('per_page') ?? 30), size);
  const page = Number(entry.query.get('page') ?? 1);
  const items = list.slice((page - 1) * per, page * per);
  const more = page * per < list.length;
  const next = new URLSearchParams(entry.query);
  next.set('page', String(page + 1));
  return { body: items, headers: more ? { link: `<${origin}${entry.raw}?${next}>; rel="next", <${origin}${entry.raw}?${next}>; rel="last"` } : {} };
}

function route(state, entry, origin) {
  const { method, path: where } = entry;
  if (method !== 'GET') return { status: 405, body: { message: 'Method Not Allowed' } };
  const repo = `/repos/${state.repo}`;
  const source = `/repos/${state.source}`;
  if (where === repo) return { body: { id: 1, name: 'repo', full_name: state.repo, private: false, default_branch: state.branch, permissions: undefined } };
  if (where === `${repo}/rules/branches/${state.branch}`) return paged(state.rules, entry, origin, state.pageSize);
  if (where === `${repo}/branches/${state.branch}`) return { body: state.branchBody };
  let found = new RegExp(`^${repo}/rulesets/(\\d+)$`).exec(where);
  if (found) return state.rulesets.has(Number(found[1])) ? { body: state.rulesets.get(Number(found[1])) } : undefined;
  found = /^\/user\/(\d+)$/.exec(where);
  if (found) return state.users.has(Number(found[1])) ? { body: { login: state.users.get(Number(found[1])), id: Number(found[1]), type: 'User', site_admin: false } } : undefined;
  if (where === `${repo}/contents/last-run.json`) {
    if (entry.query.get('ref') !== 'record-keeper/log' || state.lastRun === null) return undefined;
    return { body: Buffer.from(state.lastRun), headers: { 'content-type': 'application/vnd.github.raw+json; charset=utf-8' } };
  }
  if (where === `${repo}/commits`) {
    if (entry.query.get('path') !== '.github/workflows/records-audit.yml' || entry.query.get('sha') !== state.branch) return { body: [] };
    return paged(state.commits, entry, origin, state.pageSize);
  }
  if (where === `${source}/releases`) return paged(state.releases.map((release) => release.entry), entry, origin, state.pageSize);
  found = new RegExp(`^${source}/releases/assets/(\\d+)$`).exec(where);
  if (found) {
    const release = state.releases.find((item) => String(item.assetId) === found[1]);
    if (release === undefined) return undefined;
    return state.redirect ? { status: 302, body: '', headers: { location: typeof state.redirect === 'string' ? state.redirect : `${origin}/blob/${found[1]}` } } : { body: Buffer.from(release.text) };
  }
  found = /^\/blob\/(\d+)$/.exec(where);
  if (found) return { body: Buffer.from(state.releases.find((item) => String(item.assetId) === found[1]).text) };
  return undefined;
}

/** A request that is not for this machine is a mistake of the test, or of the program. */
export const guardedFetch = (asked) => (url, init) => {
  asked.push(String(url));
  if (new URL(url).hostname !== '127.0.0.1') throw new Error(`a test made a request to ${url}`);
  return globalThis.fetch(url, init);
};

/** The environment of a run in Actions, with the token of the workflow, and the secret of the updater that must never be used. */
export const actions = (state, over = {}) => ({ GITHUB_TOKEN: TOKEN, GITHUB_REPOSITORY: state.repo, GITHUB_API_URL: state.url, GITHUB_EVENT_NAME: 'schedule', GITHUB_ACTIONS: 'true', HAS_RECORD_KEEPER_TOKEN: 'true', ...over });

/**
 * One run of the check against `state`, in the working tree `dir`: { code, stdout, stderr, report, found, asked }. The output is JSON unless `json` is false; `found`
 * lists the findings as `code detail`. `options` replaces what the program takes from outside: `fetch`, `sleep`, `timeout` and `now`.
 */
export async function check(state, dir, { argv = ['--repo', state.repo], env = {}, json = true, ...options } = {}) {
  const asked = [];
  const got = await runCli([...argv, '--root', dir, ...(json ? ['--json'] : [])], actions(state, env), { fetch: guardedFetch(asked), sleep: async () => {}, now: () => NOW, ...options });
  const report = json && got.stdout !== '' ? JSON.parse(got.stdout) : null;
  return { ...got, report, asked, found: report === null ? [] : report.findings.map((finding) => `${finding.code}${finding.detail === '' ? '' : ` ${finding.detail}`}`) };
}

/** The requests that the server saw, as `GET /path?query`, in order. */
export const reads = (state) => state.requests.map((request) => `${request.method} ${request.raw}${request.search}`);
