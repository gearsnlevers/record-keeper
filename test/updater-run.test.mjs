// The updater at work (docs/updater.md): the runner against a local server that plays GitHub, and against local git repositories, one bare as `origin` and one as the
// working tree. Nothing here reaches the network, and nothing reads or writes the real working tree or the real home: every repository is made in a folder of its own.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildManifest, canonical } from '../tools/build-release-manifest.mjs';
import { BRANCH, PIN_PATH, runCli } from '../updater.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const program = path.join(root, 'updater.mjs');
const install = JSON.parse(fs.readFileSync(path.join(root, 'install.json'), 'utf8'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'record-keeper-updater-run-'));
const servers = [];
const asked = [];
after(() => {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
  fs.rmSync(scratch, { recursive: true, force: true });
});

// A request that is not for this machine is a mistake of the test, or of the program.
const guardedFetch = (url, init) => {
  const { hostname } = new URL(url);
  asked.push(String(url));
  if (hostname !== '127.0.0.1') throw new Error(`a test made a request to ${url}`);
  return globalThis.fetch(url, init);
};

const CLEAN = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_') && !['GITHUB_TOKEN', 'GITHUB_API_URL', 'GITHUB_REPOSITORY', 'RECORD_KEEPER_TOKEN'].includes(name)));
const GIT_ENV = { ...CLEAN, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const IDENTITY = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
const git = (cwd, ...args) => {
  const result = spawnSync('git', args, { cwd, env: { ...GIT_ENV, ...IDENTITY }, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};
/** git with more in the environment: the dates of a commit, for instance. */
const gitWith = (cwd, environment, ...args) => {
  const result = spawnSync('git', args, { cwd, env: { ...GIT_ENV, ...IDENTITY, ...environment }, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};
const BASE_DATE = '2020-01-02T03:04:05+0000';
let made = 0;
const folder = (name = 'case') => {
  const dir = path.join(scratch, `${name}-${(made += 1)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const write = (dir, relative, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
  fs.writeFileSync(path.join(dir, relative), content);
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const commitOf = (name) => createHash('sha1').update(`commit ${name}`).digest('hex');
const TOKEN = 'ghp_RecordKeeperTestToken0123456789abcdef';

// ---- the server that plays GitHub ---------------------------------------------------------------------------------------------------------

const TEMPLATES = ['.github/record-keeper/settings.yml', 'docs/decisions/README.md', 'docs/decisions/template.md'];
const REQUIRES = { rulesets: [{ branch: 'default', checks: ['Records integrity'], 'up-to-date': true }], secrets: ['RECORD_KEEPER_TOKEN'], settings: ['owners'] };

/** The state of the server: releases with the files at their commits, the pull requests of the consumer, and a log of every request. */
async function github({ pageSize = 100, redirect = false, consumer = 'o/r', source = 'gearsnlevers/record-keeper', prefix = '' } = {}) {
  const state = { chunked: false, source, consumer, defaultBranch: 'main', releases: [], contents: new Map(), refs: new Map(), annotated: new Map(), pulls: [], comments: [], requests: [], fault: null, redirect, nextAsset: 100, nextPull: 1, listBody: null };
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const text = Buffer.concat(chunks).toString('utf8');
      // A server that stands behind a path, as a server of an enterprise does: what is outside the path is not found, and what is inside is as on the other server.
      const inside = prefix === '' || url.pathname.startsWith(`${prefix}/`);
      const entry = { method: request.method, path: inside ? url.pathname.slice(prefix.length) : url.pathname, original: url.pathname, search: url.search, query: url.searchParams, body: text === '' ? undefined : JSON.parse(text), authorization: request.headers.authorization, accept: request.headers.accept, contentType: request.headers['content-type'], apiVersion: request.headers['x-github-api-version'], userAgent: request.headers['user-agent'] };
      state.requests.push(entry);
      // An answer says how long it is, as GitHub's do, or comes in pieces with no length (state.chunked), as an answer that is made while it is sent does.
      const send = (status, body, headers = {}) => {
        const raw = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
        const type = { 'content-type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json' };
        if (state.chunked) {
          response.writeHead(status, { ...type, ...headers });
          const half = Math.floor(raw.length / 2);
          response.write(raw.subarray(0, half));
          response.end(raw.subarray(half));
        } else if (state.split !== undefined) {
          // the length is said, and the answer comes in two pieces some time apart
          response.writeHead(status, { ...type, 'content-length': String(raw.length), ...headers });
          const half = Math.floor(raw.length / 2);
          response.write(raw.subarray(0, half));
          setTimeout(() => response.end(raw.subarray(half)), state.split);
        } else {
          response.writeHead(status, { ...type, 'content-length': String(raw.length), ...headers });
          response.end(raw);
        }
      };
      const fault = state.fault?.(entry);
      if (fault) return send(fault.status, fault.body ?? { message: 'fault' }, fault.headers);
      const answer = inside ? route(state, entry, pageSize, `http://${request.headers.host}${prefix}`) : undefined;
      return answer === undefined ? send(404, { message: 'Not Found' }) : send(answer.status ?? 200, answer.body, answer.headers);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  state.url = `http://127.0.0.1:${server.address().port}`;
  return state;
}

function route(state, entry, pageSize, origin) {
  const { method, path: route_ } = entry;
  const src = `/repos/${state.source}`;
  const con = `/repos/${state.consumer}`;
  if (method === 'GET' && route_ === src) return { body: { default_branch: 'main' } };
  if (method === 'GET' && route_ === con) return { body: { default_branch: state.defaultBranch } };
  if (method === 'GET' && route_ === `${src}/releases`) {
    const page = Number(entry.query.get('page') ?? 1);
    const all = state.releases.map((r) => ({ tag_name: r.tag, draft: r.draft, prerelease: r.prerelease, body: r.body, assets: r.manifest === null ? [] : [{ id: r.assetId, name: 'release-manifest.json', size: Buffer.byteLength(r.manifest) }] }));
    const items = state.listBody ?? all.slice((page - 1) * pageSize, page * pageSize);
    const next = page * pageSize < all.length ? { link: `<${origin}${src}/releases?per_page=${entry.query.get('per_page')}&page=${page + 1}>; rel="next"` } : {};
    return { body: items, headers: next.link ? { link: state.nextLink ?? next.link } : {} };
  }
  let found = new RegExp(`^${src}/git/ref/tags/(.+)$`).exec(route_);
  if (method === 'GET' && found) {
    const ref = state.refs.get(decodeURIComponent(found[1]));
    return ref === undefined ? undefined : { body: { ref: `refs/tags/${found[1]}`, object: ref } };
  }
  found = new RegExp(`^${src}/git/tags/([0-9a-f]+)$`).exec(route_);
  if (method === 'GET' && found) return state.annotated.has(found[1]) ? { body: { sha: found[1], object: state.annotated.get(found[1]) } } : undefined;
  found = new RegExp(`^${src}/releases/assets/(\\d+)$`).exec(route_);
  if (method === 'GET' && found) {
    const release = state.releases.find((r) => String(r.assetId) === found[1]);
    if (release === undefined || release.manifest === null) return undefined;
    return state.redirect ? { status: 302, body: '', headers: { location: typeof state.redirect === 'string' ? state.redirect : `${origin}/blob/${found[1]}` } } : { body: Buffer.from(release.manifest) };
  }
  found = /^\/blob\/(\d+)$/.exec(route_);
  if (method === 'GET' && found) return { body: Buffer.from(state.releases.find((r) => String(r.assetId) === found[1]).manifest) };
  found = new RegExp(`^${src}/contents/(.+)$`).exec(route_);
  if (method === 'GET' && found) {
    const bytes = state.contents.get(entry.query.get('ref'))?.get(decodeURIComponent(found[1]));
    return bytes === undefined ? undefined : { body: Buffer.from(bytes) };
  }
  if (method === 'GET' && route_ === `${con}/pulls`) {
    if (state.pullsBody) return { body: state.pullsBody };
    const wanted = entry.query.get('head');
    return { body: state.pulls.filter((p) => p.state === 'open' && `${state.consumer.split('/')[0]}:${p.head.ref}` === wanted && p.base.ref === entry.query.get('base')) };
  }
  if (method === 'POST' && route_ === `${con}/pulls`) {
    const pull = { number: state.nextPull++, state: 'open', title: entry.body.title, body: entry.body.body, head: { ref: entry.body.head }, base: { ref: entry.body.base } };
    state.pulls.push(pull);
    return { status: 201, body: { number: pull.number, html_url: `https://example.invalid/pull/${pull.number}` } };
  }
  found = new RegExp(`^${con}/pulls/(\\d+)$`).exec(route_);
  if (method === 'PATCH' && found) {
    const pull = state.pulls.find((p) => p.number === Number(found[1]));
    Object.assign(pull, entry.body);
    return { body: { number: pull.number } };
  }
  found = new RegExp(`^${con}/issues/(\\d+)/comments$`).exec(route_);
  if (method === 'POST' && found) {
    state.comments.push({ number: Number(found[1]), body: entry.body.body });
    return { status: 201, body: { id: state.comments.length } };
  }
  return undefined;
}

/** Publishes a release: the files at its commit, the manifest as an asset, and the tag. `files` maps a destination to its content. */
function release(state, tag, files, { prerelease = tag.includes('-'), draft = false, body = `Notes of ${tag}.`, node = '>=22', commit = commitOf(tag), annotated = false, requires = REQUIRES, mutate } = {}) {
  const entries = Object.entries(files).map(([destination, content]) => ({ kind: TEMPLATES.includes(destination) ? 'template' : 'managed', path: destination, sha256: sha(content), size: Buffer.byteLength(content), source: `kit/${destination}` }));
  const manifest = { commit, files: entries, generations: ['g1'], node, requires, schema: 1, tag, version: tag.slice(1) };
  if (mutate) mutate(manifest);
  const record = { tag, draft, prerelease, body, commit, manifest: canonical(manifest), assetId: (state.nextAsset += 1), served: new Map(Object.entries(files).map(([destination, content]) => [`kit/${destination}`, Buffer.from(content)])) };
  state.releases.push(record);
  state.contents.set(commit, record.served);
  if (annotated) {
    const object = commitOf(`annotated ${tag}`);
    state.refs.set(tag, { type: 'tag', sha: object });
    state.annotated.set(object, { type: 'commit', sha: commit });
  } else state.refs.set(tag, { type: 'commit', sha: commit });
  return record;
}

// ---- the repository of a consumer -----------------------------------------------------------------------------------------------------------

const V1 = {
  '.github/record-keeper/record-keeper.mjs': '// rules 1\n',
  '.github/record-keeper/check-pull-request.mjs': '// check 1\n',
  '.github/record-keeper/updater.mjs': '// updater 1\n',
  '.github/workflows/records-integrity.yml': 'name: Records integrity\n',
  '.github/record-keeper/settings.yml': 'owners: [alice/1001]\n',
  'docs/decisions/README.md': '# Decision records\n',
};
const V2 = {
  '.github/record-keeper/record-keeper.mjs': '// rules 2\n',
  '.github/record-keeper/updater.mjs': '// updater 2\n',
  '.github/workflows/records-integrity.yml': 'name: Records integrity\n',
  '.github/workflows/records-updater.yml': 'name: Records updater\n',
  '.github/record-keeper/settings.yml': '# settings 2\n',
  'docs/decisions/README.md': '# Decision records 2\n',
  'docs/decisions/template.md': '# Template\n',
};
const V3 = { ...V2, '.github/record-keeper/record-keeper.mjs': '// rules 3\n' };

const pinOf = (tag, commit = commitOf(tag), channel = 'stable', source = 'gearsnlevers/record-keeper') => `# Written by the Record Keeper updater. Do not edit it by hand, except the channel, in a pull request.\nsource: ${source}\nversion: ${tag}\ncommit: ${commit}\nchannel: ${channel}\n`;

/** A repository that has adopted v1.0.0 (the files `installed`, and its pin), a bare `origin` with it, and a clone of that where a job runs. */
function adopted({ installed = V1, pin = pinOf('v1.0.0'), extra = {} } = {}) {
  const dev = folder('dev');
  git(dev, 'init', '-q', '-b', 'main');
  write(dev, 'README.md', '# The repository\n');
  for (const [relative, content] of Object.entries({ ...installed, ...extra })) write(dev, relative, content);
  if (pin !== null) write(dev, PIN_PATH, pin);
  git(dev, 'add', '-A');
  gitWith(dev, { GIT_AUTHOR_DATE: BASE_DATE, GIT_COMMITTER_DATE: BASE_DATE }, 'commit', '-q', '-m', 'Adopt Record Keeper (#1)');
  const bare = `${folder('origin')}.git`;
  git(scratch, 'clone', '-q', '--bare', dev, bare);
  const work = folder('work');
  git(scratch, 'clone', '-q', bare, work);
  return { dev, bare, work };
}

const env = (state, over = {}) => ({ GITHUB_REPOSITORY: state.consumer, GITHUB_API_URL: state.url, RECORD_KEEPER_TOKEN: TOKEN, ...over });
const call = (argv, state, work, { token = TOKEN, extra = {}, ...options } = {}) => runCli(argv, env(state, token === null ? { RECORD_KEEPER_TOKEN: undefined, ...extra } : { RECORD_KEEPER_TOKEN: token, ...extra }),
  { cwd: work, fetch: guardedFetch, sleep: async () => {}, gitEnv: GIT_ENV, ...options });
const writes = (state) => state.requests.filter((r) => r.method !== 'GET');
const refsOf = (bare) => git(bare, 'for-each-ref', '--format=%(refname) %(objectname)');
const show = (bare, ref, relative) => git(bare, 'show', `${ref}:${relative}`);
const treeOf = (bare, ref) => git(bare, 'ls-tree', '-r', '--name-only', ref).split('\n');
const statusOf = (work) => git(work, 'status', '--porcelain', '--untracked-files=all');

/** A world with the two releases of the fixtures above, and a consumer on the first. */
async function world(options = {}) {
  const state = await github(options);
  release(state, 'v1.0.0', V1);
  release(state, 'v1.1.0', V2, { body: 'Adds the updater workflow. Thanks @alice!' });
  return { state, ...adopted() };
}

// ---- the update: the branch, and the one pull request ----------------------------------------------------------------------------------------

describe('an update in Actions', () => {
  test('rebuilds the branch from the default branch, pushes it, and opens the pull request', async () => {
    const { state, bare, work } = await world();
    const before = refsOf(bare);
    const got = await call([], state, work);
    assert.equal(got.stderr, '');
    assert.equal(got.code, 0);
    assert.match(got.stdout, /^update v1\.0\.0 to v1\.1\.0 \(stable\)\n  add \.github\/workflows\/records-updater\.yml\n  change \.github\/record-keeper\/record-keeper\.mjs\n  change \.github\/record-keeper\/updater\.mjs\n  remove \.github\/record-keeper\/check-pull-request\.mjs\n  install template docs\/decisions\/template\.md\n  write \.github\/record-keeper\.yml\n1 file to add, 2 to change, 1 to remove, 1 template to install, 0 local changes overwritten\npushed record-keeper\/update \([0-9a-f]{7}\)\nopened pull request #1\n$/);
    // the branch: the base and one commit, with the files of the release and the pin
    const main = git(bare, 'rev-parse', 'refs/heads/main');
    assert.equal(git(bare, 'rev-parse', `refs/heads/${BRANCH}^`), main);
    assert.equal(git(bare, 'rev-list', '--count', `main..${BRANCH}`), '1');
    assert.equal(show(bare, `refs/heads/${BRANCH}`, '.github/record-keeper/record-keeper.mjs'), '// rules 2');
    assert.equal(show(bare, `refs/heads/${BRANCH}`, '.github/record-keeper/updater.mjs'), '// updater 2');
    assert.equal(show(bare, `refs/heads/${BRANCH}`, '.github/workflows/records-updater.yml'), 'name: Records updater');
    assert.equal(show(bare, `refs/heads/${BRANCH}`, PIN_PATH), pinOf('v1.1.0').trimEnd());
    assert.equal(show(bare, `refs/heads/${BRANCH}`, 'docs/decisions/template.md'), '# Template');
    assert.equal(show(bare, `refs/heads/${BRANCH}`, 'docs/decisions/README.md'), '# Decision records', 'a template that is there is never overwritten');
    assert.equal(show(bare, `refs/heads/${BRANCH}`, '.github/record-keeper/settings.yml'), 'owners: [alice/1001]', 'the settings of the repository are not touched');
    assert.ok(!treeOf(bare, `refs/heads/${BRANCH}`).includes('.github/record-keeper/check-pull-request.mjs'), 'a file that the release no longer has is removed');
    const bot = '41898282+github-actions[bot]@users.noreply.github.com';
    assert.equal(git(bare, 'log', '-1', '--format=%an|%ae|%cn|%ce|%s', `refs/heads/${BRANCH}`), `github-actions[bot]|${bot}|github-actions[bot]|${bot}|chore: update Record Keeper v1.0.0 to v1.1.0`);
    assert.equal(git(bare, 'log', '-1', '--format=%aI|%cI', `refs/heads/${BRANCH}`), '2020-01-02T03:04:05Z|2020-01-02T03:04:05Z', 'the commit has the date of its base, which is not the date of the run');
    assert.equal(git(bare, 'log', '-1', '--format=%B', `refs/heads/${BRANCH}`), `chore: update Record Keeper v1.0.0 to v1.1.0\n\nsource: gearsnlevers/record-keeper\nversion: v1.1.0\ncommit: ${commitOf('v1.1.0')}`);
    assert.equal(git(bare, 'diff', '--name-status', 'main', BRANCH).split('\n').sort().join('|'), ['A\t.github/workflows/records-updater.yml', 'A\tdocs/decisions/template.md', 'D\t.github/record-keeper/check-pull-request.mjs', 'M\t.github/record-keeper.yml', 'M\t.github/record-keeper/record-keeper.mjs', 'M\t.github/record-keeper/updater.mjs'].sort().join('|'));
    assert.equal(refsOf(bare).split('\n').filter((line) => !line.includes(BRANCH)).join('\n'), before, 'no other ref changed');
    // the pull request
    assert.equal(state.pulls.length, 1);
    const [pull] = state.pulls;
    assert.equal(pull.title, 'chore: update Record Keeper v1.0.0 to v1.1.0');
    assert.deepEqual([pull.head.ref, pull.base.ref, pull.state], [BRANCH, 'main', 'open']);
    assert.ok(pull.body.includes('Adds the updater workflow. Thanks (at)alice!'), 'the notes, with no mention');
    assert.ok(!pull.body.includes('@'));
    assert.ok(pull.body.includes('- `.github/workflows/records-updater.yml`'));
    assert.ok(pull.body.includes('- the repository secret `RECORD_KEEPER_TOKEN`'));
    const post = state.requests.find((r) => r.method === 'POST');
    assert.deepEqual([post.body.head, post.body.base, post.body.maintainer_can_modify], [BRANCH, 'main', false]);
    // the working tree is where it was, and clean
    assert.equal(git(work, 'symbolic-ref', '--short', 'HEAD'), 'main');
    assert.equal(statusOf(work), '');
    assert.equal(fs.readFileSync(path.join(work, '.github/record-keeper/record-keeper.mjs'), 'utf8'), '// rules 1\n');
  });

  test('a second run updates the same pull request, makes no second one, and pushes nothing', async () => {
    const { state, bare, work } = await world();
    assert.equal((await call([], state, work)).code, 0);
    const branch = git(bare, 'rev-parse', `refs/heads/${BRANCH}`);
    const again = await call([], state, work);
    assert.equal(again.code, 0, again.stderr);
    assert.match(again.stdout, new RegExp(`branch ${BRANCH} is up to date\\nupdated pull request #1\\n$`));
    assert.equal(git(bare, 'rev-parse', `refs/heads/${BRANCH}`), branch, 'the same commit: nothing was pushed');
    assert.equal(state.pulls.length, 1);
    assert.equal(state.requests.filter((r) => r.method === 'POST').length, 1, 'one pull request was made, ever');
    assert.equal(state.requests.filter((r) => r.method === 'PATCH').length, 1);
    const lookups = state.requests.filter((r) => r.path === '/repos/o/r/pulls' && r.method === 'GET');
    assert.equal(lookups.length, 2);
    assert.equal(lookups[0].query.get('head'), `o:${BRANCH}`);
    assert.equal(lookups[0].query.get('base'), 'main');
    assert.equal(lookups[0].query.get('state'), 'open');
    assert.equal(lookups[0].query.get('per_page'), '100');
  });

  test('a newer release replaces the branch and the title of the same pull request', async () => {
    const { state, bare, work } = await world();
    assert.equal((await call([], state, work)).code, 0);
    const first = git(bare, 'rev-parse', `refs/heads/${BRANCH}`);
    release(state, 'v1.2.0', V3, { body: 'Third.' });
    const got = await call([], state, work);
    assert.equal(got.code, 0, got.stderr);
    assert.match(got.stdout, /update v1\.0\.0 to v1\.2\.0 \(stable\)/);
    assert.match(got.stdout, /pushed record-keeper\/update/);
    const second = git(bare, 'rev-parse', `refs/heads/${BRANCH}`);
    assert.notEqual(second, first);
    assert.equal(git(bare, 'rev-parse', `refs/heads/${BRANCH}^`), git(bare, 'rev-parse', 'refs/heads/main'), 'rebuilt from the default branch and not on top of the last one');
    assert.equal(show(bare, `refs/heads/${BRANCH}`, '.github/record-keeper/record-keeper.mjs'), '// rules 3');
    assert.equal(state.pulls.length, 1);
    assert.equal(state.pulls[0].title, 'chore: update Record Keeper v1.0.0 to v1.2.0');
    assert.ok(state.pulls[0].body.includes('Third.'));
    assert.ok(!state.pulls[0].body.includes('Adds the updater workflow'));
  });

  test('the update of a repository that merged the first one is the next release, with the new pin as its base', async () => {
    const { state, dev, bare, work } = await world();
    assert.equal((await call([], state, work)).code, 0);
    git(dev, 'fetch', '-q', bare, `${BRANCH}:merged`);
    git(dev, 'merge', '-q', '--ff-only', 'merged');
    git(dev, 'push', '-q', bare, 'main');
    git(work, 'pull', '-q');
    release(state, 'v1.3.0', { ...V3, '.github/record-keeper/updater.mjs': '// updater 4\n' });
    const got = await call([], state, work);
    assert.equal(got.code, 0, got.stderr);
    assert.match(got.stdout, /^update v1\.1\.0 to v1\.3\.0 \(stable\)\n  change \.github\/record-keeper\/record-keeper\.mjs\n  change \.github\/record-keeper\/updater\.mjs\n  write \.github\/record-keeper\.yml\n/);
    assert.doesNotMatch(got.stdout, /install template|remove /, 'the templates are not installed again, and nothing of v1.1.0 is removed');
    assert.equal(git(bare, 'rev-list', '--count', `main..${BRANCH}`), '1');
  });

  test('of the pull requests that the list of GitHub holds, the oldest that is a pull request from the update branch to the default branch is the one that is updated', async () => {
    const { state, work } = await world();
    const pull = (number) => ({ number, state: 'open', title: 'old', body: 'old', head: { ref: BRANCH }, base: { ref: 'main' } });
    state.pulls.push(pull(12), pull(13));
    state.nextPull = 20;
    state.pullsBody = [null, 5, 'x', [], { number: '7', head: { ref: BRANCH }, base: { ref: 'main' } }, { number: 8, head: { ref: 'other' }, base: { ref: 'main' } }, { number: 9, head: { ref: BRANCH }, base: { ref: 'develop' } },
      { number: 10, head: null, base: { ref: 'main' } }, { number: 11, head: { ref: BRANCH }, base: null }, { number: 1.5, head: { ref: BRANCH }, base: { ref: 'main' } }, { head: { ref: BRANCH }, base: { ref: 'main' } },
      { number: 13, head: { ref: BRANCH }, base: { ref: 'main' } }, { number: 12, head: { ref: BRANCH }, base: { ref: 'main' } }];
    const got = await call([], state, work);
    assert.equal(got.code, 0, got.stderr);
    assert.match(got.stdout, /updated pull request #12\n$/);
    assert.deepEqual(state.requests.filter((r) => r.method === 'PATCH').map((r) => r.path), ['/repos/o/r/pulls/12']);
    assert.equal(state.requests.filter((r) => r.method === 'POST').length, 0);
    state.pullsBody = { message: 'not a list' };
    const odd = await call([], state, work);
    assert.deepEqual([odd.code, odd.stderr], [1, 'updater: failed: the list of pull requests is not a list\n']);
  });

  test('nothing newer: no change, and an open update pull request that has nothing to update to is closed with a comment', async () => {
    const state = await github();
    release(state, 'v1.0.0', V1);
    const { bare, work } = adopted();
    state.pulls.push({ number: 7, state: 'open', title: 'chore: update Record Keeper v1.0.0 to v1.1.0', body: 'old', head: { ref: BRANCH }, base: { ref: 'main' } });
    state.nextPull = 8;
    const before = refsOf(bare);
    const got = await call([], state, work);
    assert.equal(got.code, 0, got.stderr);
    assert.match(got.stdout, /^current: v1\.0\.0 is the newest stable release of gearsnlevers\/record-keeper\nclosed pull request #7: v1\.0\.0 is the newest stable release of gearsnlevers\/record-keeper, so there is nothing to update to\.\n$/);
    assert.equal(state.pulls[0].state, 'closed');
    assert.equal(state.comments.length, 1);
    assert.deepEqual([state.comments[0].number, state.comments[0].body.startsWith('Closed by the Record Keeper updater: ')], [7, true]);
    assert.equal(refsOf(bare), before, 'nothing was pushed');
    assert.equal(statusOf(work), '');
    const again = await call([], state, work);
    assert.equal(again.stdout, 'current: v1.0.0 is the newest stable release of gearsnlevers/record-keeper\n');
    assert.equal(writes(state).length, 2, 'a pull request that is closed is not closed again');
  });

  test('a repository that is at the release already has nothing to update to either', async () => {
    const { state, dev, bare, work } = await world();
    git(dev, 'checkout', '-q', '-b', 'by-hand');
    for (const [relative, content] of Object.entries(V2)) if (relative !== '.github/record-keeper/settings.yml' && relative !== 'docs/decisions/README.md') write(dev, relative, content);
    fs.rmSync(path.join(dev, '.github/record-keeper/check-pull-request.mjs'));
    write(dev, PIN_PATH, pinOf('v1.1.0'));
    git(dev, 'add', '-A');
    git(dev, 'commit', '-q', '-m', 'Update by hand (#2)');
    git(dev, 'push', '-q', bare, 'by-hand:main');
    git(work, 'pull', '-q');
    state.pulls.push({ number: 3, state: 'open', title: 't', body: 'b', head: { ref: BRANCH }, base: { ref: 'main' } });
    const got = await call(['--target', 'v1.1.0'], state, work);
    assert.equal(got.code, 0, got.stderr);
    assert.match(got.stdout, /^unchanged: v1\.1\.0 is installed and nothing differs\nclosed pull request #3: v1\.1\.0 is installed and nothing differs, so there is nothing to update\.\n$/);
  });

  test('a local change is overwritten and listed, and so is a file that the release removes and that was edited', async () => {
    const { state, bare, work } = await world();
    const dev = folder('dev2');
    git(dev, 'clone', '-q', bare, '.');
    write(dev, '.github/record-keeper/record-keeper.mjs', '// my edit\n');
    write(dev, '.github/record-keeper/check-pull-request.mjs', '// my edit of the check\n');
    git(dev, 'commit', '-qam', 'Edit the programs (#2)');
    git(dev, 'push', '-q', 'origin', 'main');
    git(work, 'pull', '-q');
    const got = await call([], state, work);
    assert.equal(got.code, 0, got.stderr);
    assert.match(got.stdout, /  local change overwritten \.github\/record-keeper\/check-pull-request\.mjs\n  local change overwritten \.github\/record-keeper\/record-keeper\.mjs\n/);
    assert.match(got.stdout, /2 local changes overwritten\n/);
    const body = state.pulls[0].body;
    assert.match(body, /## Local changes this update overwrites\n\n[^\n]+\n\n- `\.github\/record-keeper\/check-pull-request\.mjs`\n- `\.github\/record-keeper\/record-keeper\.mjs`\n/);
  });

  test('the pinned release has no manifest to read: the update goes on with a warning, and without removals and templates', async () => {
    const state = await github();
    const old = release(state, 'v1.0.0', V1);
    old.manifest = null;
    release(state, 'v1.1.0', V2);
    const { bare, work } = adopted();
    const got = await call([], state, work);
    assert.equal(got.code, 0, got.stderr);
    assert.match(got.stdout, /warning: the pinned release v1\.0\.0 has no manifest to read; local changes and removals are not listed\n/);
    assert.doesNotMatch(got.stdout, /^ {2}(remove|install template) /m);
    assert.ok(treeOf(bare, BRANCH).includes('.github/record-keeper/check-pull-request.mjs'));
    assert.match(state.pulls[0].body, /## Warnings\n\n- The pinned release v1\.0\.0 has no manifest/);
  });

  test('the pinned release is not in the list at all: the same', async () => {
    const state = await github();
    release(state, 'v1.1.0', V2);
    const { work } = adopted();
    const got = await call([], state, work);
    assert.equal(got.code, 0, got.stderr);
    assert.match(got.stdout, /warning: the pinned release v1\.0\.0 has no manifest to read/);
  });

  test('an annotated tag is followed to its commit', async () => {
    const state = await github();
    release(state, 'v1.0.0', V1);
    release(state, 'v1.1.0', V2, { annotated: true });
    const { work } = adopted();
    const got = await call([], state, work);
    assert.equal(got.code, 0, got.stderr);
    assert.ok(state.requests.some((r) => r.path.startsWith('/repos/gearsnlevers/record-keeper/git/tags/')));
  });

  test('a prerelease is taken on the prerelease channel and not on the stable one', async () => {
    const state = await github();
    release(state, 'v1.0.0', V1);
    release(state, 'v1.1.0-1', V2);
    const { work } = adopted();
    assert.equal((await call(['--dry-run'], state, work)).stdout, 'current: v1.0.0 is the newest stable release of gearsnlevers/record-keeper\n');
    const dry = await call(['--dry-run', '--channel', 'prerelease'], state, work);
    assert.match(dry.stdout, /^update v1\.0\.0 to v1\.1\.0-1 \(prerelease\)\n/);
    const got = await call(['--channel', 'prerelease'], state, work);
    assert.equal(got.code, 0, got.stderr);
    assert.match(state.pulls[0].title, /v1\.1\.0-1$/);
  });

  test('the releases are read from every page, and the newest of all is taken', async () => {
    const state = await github({ pageSize: 2 });
    release(state, 'v1.0.0', V1);
    release(state, 'v1.4.0', V2);
    release(state, 'v1.2.0', V2);
    release(state, 'v1.3.0', V2);
    release(state, 'v1.1.0', V2);
    const { work } = adopted();
    const got = await call(['--dry-run'], state, work);
    assert.match(got.stdout, /^update v1\.0\.0 to v1\.4\.0 \(stable\)/);
    assert.equal(state.requests.filter((r) => r.path === '/repos/gearsnlevers/record-keeper/releases').length, 3);
  });

  test('a repair: the pinned release as the target rewrites a file that drifted, in the same pull request', async () => {
    const { state, dev, bare, work } = await world();
    write(dev, '.github/record-keeper/record-keeper.mjs', '// drifted\n');
    git(dev, 'commit', '-qam', 'Drift (#2)');
    git(dev, 'push', '-q', bare, 'main');
    git(work, 'pull', '-q');
    const got = await call(['--target', 'v1.0.0'], state, work);
    assert.equal(got.code, 0, got.stderr);
    assert.match(got.stdout, /^update v1\.0\.0 to v1\.0\.0 \(stable\)\n  change \.github\/record-keeper\/record-keeper\.mjs\n  local change overwritten \.github\/record-keeper\/record-keeper\.mjs\n0 files to add, 1 to change, 0 to remove, 0 templates to install, 1 local change overwritten\npushed record-keeper\/update \([0-9a-f]{7}\)\nopened pull request #1\n$/);
    assert.equal(state.pulls[0].title, 'chore: repair Record Keeper v1.0.0');
    assert.equal(show(bare, `refs/heads/${BRANCH}`, '.github/record-keeper/record-keeper.mjs'), '// rules 1');
    assert.equal(git(bare, 'diff', '--name-only', 'main', BRANCH), '.github/record-keeper/record-keeper.mjs', 'the pin is the same and is not in the change');
  });
});

// ---- what is never written ---------------------------------------------------------------------------------------------------------------------

describe('a dry run', () => {
  test('changes nothing: not the working tree, not the repository on origin, and it asks GitHub for no more than reads', async () => {
    const { state, bare, work } = await world();
    const refs = refsOf(bare);
    const files = git(work, 'ls-files');
    const got = await call(['--dry-run'], state, work, { token: null });
    assert.equal(got.code, 0, got.stderr);
    assert.match(got.stdout, /^update v1\.0\.0 to v1\.1\.0 \(stable\)\n(?:  [^\n]+\n)+1 file to add, 2 to change, 1 to remove, 1 template to install, 0 local changes overwritten\ndry run: nothing was written\n$/);
    assert.equal(refsOf(bare), refs);
    assert.equal(statusOf(work), '');
    assert.equal(git(work, 'ls-files'), files);
    assert.equal(git(work, 'symbolic-ref', '--short', 'HEAD'), 'main');
    assert.equal(writes(state).length, 0);
    assert.equal(state.pulls.length, 0);
    assert.ok(state.requests.every((r) => r.authorization === undefined), 'a dry run needs no token and sends none');
    assert.ok(!state.requests.some((r) => r.path === '/repos/o/r' || r.path.startsWith('/repos/o/r/')), 'it does not even look at the repository of the consumer');
  });

  test('with the token it still only reads, and sends it only to the API', async () => {
    const { state, bare, work } = await world({ redirect: true });
    const refs = refsOf(bare);
    const got = await call(['--dry-run'], state, work);
    assert.equal(got.code, 0, got.stderr);
    assert.equal(writes(state).length, 0);
    assert.equal(refsOf(bare), refs);
    assert.ok(state.requests.filter((r) => r.path !== '/blob/101' && r.path !== '/blob/102').every((r) => r.authorization === `Bearer ${TOKEN}`));
    const blobs = state.requests.filter((r) => r.path.startsWith('/blob/'));
    assert.ok(blobs.length >= 2, 'the manifests were fetched through the redirect');
    assert.ok(blobs.every((r) => r.authorization === undefined), 'the redirect is followed without the token');
  });

  test('--local with --dry-run is a dry run', async () => {
    const { state, work } = await world();
    const got = await call(['--local', '--dry-run'], state, work, { token: null });
    assert.match(got.stdout, /dry run: nothing was written\n$/);
    assert.equal(statusOf(work), '');
  });
});

describe('a release that is wrong writes nothing and pushes nothing', () => {
  const nothing = (state, bare, work, refs) => {
    assert.equal(writes(state).length, 0, 'no request that writes');
    assert.equal(refsOf(bare), refs);
    assert.equal(statusOf(work), '');
    assert.equal(git(work, 'symbolic-ref', '--short', 'HEAD'), 'main');
    assert.equal(fs.readFileSync(path.join(work, PIN_PATH), 'utf8'), pinOf('v1.0.0'));
  };

  test('a file that is not the file of the manifest (its digest)', async () => {
    const { state, bare, work } = await world();
    const refs = refsOf(bare);
    state.releases[1].served.set('kit/.github/record-keeper/updater.mjs', Buffer.from('// updater 2, swapped\n'.padEnd(Buffer.byteLength('// updater 2\n'), ' ').slice(0, Buffer.byteLength('// updater 2\n'))));
    const got = await call([], state, work);
    assert.equal(got.code, 1);
    assert.equal(got.stdout, '');
    assert.equal(got.stderr, 'updater: refused: digest mismatch: .github/record-keeper/updater.mjs\n');
    nothing(state, bare, work, refs);
  });

  test('a file that is longer than the manifest says (its size), which is not read to the end', async () => {
    const { state, bare, work } = await world();
    const refs = refsOf(bare);
    state.releases[1].served.set('kit/.github/record-keeper/updater.mjs', Buffer.from(`// updater 2\n${'x'.repeat(100000)}`));
    const got = await call([], state, work);
    assert.equal(got.code, 1);
    assert.equal(got.stderr, 'updater: refused: size mismatch: .github/record-keeper/updater.mjs\n');
    nothing(state, bare, work, refs);
  });

  test('a file that is shorter than the manifest says', async () => {
    const { state, bare, work } = await world();
    const refs = refsOf(bare);
    state.releases[1].served.set('kit/.github/record-keeper/updater.mjs', Buffer.from('// u\n'));
    const got = await call([], state, work);
    assert.equal(got.stderr, 'updater: refused: size mismatch: .github/record-keeper/updater.mjs\n');
    nothing(state, bare, work, refs);
  });

  test('a file that is missing at the commit', async () => {
    const { state, bare, work } = await world();
    const refs = refsOf(bare);
    state.releases[1].served.delete('kit/.github/record-keeper/updater.mjs');
    const got = await call([], state, work);
    assert.equal(got.code, 1);
    assert.match(got.stderr, /^updater: failed: GET \/repos\/gearsnlevers\/record-keeper\/contents\/kit\/\.github\/record-keeper\/updater\.mjs\?ref=[0-9a-f]{40} answered 404/);
    nothing(state, bare, work, refs);
  });

  test('the same on a first adoption: nothing is written into the working tree', async () => {
    const state = await github();
    release(state, 'v1.0.0', V1);
    state.releases[0].served.set('kit/.github/record-keeper/record-keeper.mjs', Buffer.from('// rules X\n'));
    const work = folder('first');
    const got = await call(['--local', '--source', 'gearsnlevers/record-keeper'], state, work, { token: null });
    assert.equal(got.code, 1);
    assert.equal(got.stderr, 'updater: refused: digest mismatch: .github/record-keeper/record-keeper.mjs\n');
    assert.deepEqual(fs.readdirSync(work), []);
  });

  describe('a list of releases and a manifest that lie', () => {
    const refused = async (change, expected, argv = []) => {
      const { state, bare, work } = await world();
      const refs = refsOf(bare);
      change(state);
      const got = await call(argv, state, work);
      assert.equal(got.code, 1, got.stdout);
      assert.match(got.stderr, expected);
      nothing(state, bare, work, refs);
    };

    test('a manifest of another tag', () => refused((s) => { s.releases[1].manifest = canonical({ ...JSON.parse(s.releases[1].manifest), tag: 'v1.0.0', version: '1.0.0' }); }, /^updater: refused: the manifest is not the manifest of this release: its tag differs\n$/));
    test('a manifest that names another commit than the tag points at', () => refused((s) => { s.releases[1].manifest = canonical({ ...JSON.parse(s.releases[1].manifest), commit: commitOf('other') }); }, /refused: the commit of the manifest is not the commit that the tag points at\n$/));
    test('a tag that has been moved since the manifest was made', () => refused((s) => { s.refs.set('v1.1.0', { type: 'commit', sha: commitOf('moved') }); }, /the commit of the manifest is not the commit that the tag points at/));
    test('a tag that points at a tree', () => refused((s) => { s.refs.set('v1.1.0', { type: 'tree', sha: commitOf('tree') }); }, /^updater: refused: the tag v1\.1\.0 does not point at a commit\n$/));
    test('an annotated tag that points at a tag that points at a tree', () => refused((s) => {
      s.refs.set('v1.1.0', { type: 'tag', sha: commitOf('a1') });
      s.annotated.set(commitOf('a1'), { type: 'tag', sha: commitOf('a2') });
      s.annotated.set(commitOf('a2'), { type: 'tree', sha: commitOf('t') });
    }, /does not point at a commit/));
    test('a tag that does not exist', () => refused((s) => { s.refs.delete('v1.1.0'); }, /^updater: failed: GET \/repos\/gearsnlevers\/record-keeper\/git\/ref\/tags\/v1\.1\.0 answered 404/));
    test('a release without a manifest', () => refused((s) => { s.releases[1].manifest = null; }, /^updater: refused: the release v1\.1\.0 has no release-manifest\.json\n$/));
    test('a manifest that is not JSON', () => refused((s) => { s.releases[1].manifest = '{ not json'; }, /the manifest is not one JSON document/));
    test('a manifest that installs a workflow of its own', () => refused((s) => { s.releases[1].manifest = canonical({ ...JSON.parse(s.releases[1].manifest), files: [...JSON.parse(s.releases[1].manifest).files, { kind: 'managed', path: '.github/workflows/evil.yml', sha256: sha('x'), size: 1, source: 'x' }] }); },
      /^updater: refused: the manifest installs a path that the updater does not install: \.github\/workflows\/evil\.yml\n$/));
    test('a manifest that installs outside the repository', () => refused((s) => { s.releases[1].manifest = canonical({ ...JSON.parse(s.releases[1].manifest), files: [{ kind: 'managed', path: '../../etc/cron.d/x', sha256: sha('x'), size: 1, source: 'x' }] }); }, /installs a path that the updater does not install: \.\.\/\.\.\/etc\/cron\.d\/x/));
    test('a manifest that asks for a file at a path that is no path of the kit', () => refused((s) => { s.releases[1].manifest = canonical({ ...JSON.parse(s.releases[1].manifest), files: JSON.parse(s.releases[1].manifest).files.map((f, i) => (i === 0 ? { ...f, source: '../../secrets' } : f)) }); }, /names a source that is not a path: \.\.\/\.\.\/secrets/));
    test('a manifest for a Node.js that is not this one', () => refused((s) => { s.releases[1].manifest = canonical({ ...JSON.parse(s.releases[1].manifest), node: '>=99' }); }, /does not satisfy the range that the release names: >=99/));
    test('a manifest with a range that it does not read', () => refused((s) => { s.releases[1].manifest = canonical({ ...JSON.parse(s.releases[1].manifest), node: '^22' }); }, /the range of Node\.js versions of the manifest is one that the updater cannot read: \^22/));
    test('a manifest that is larger than the updater takes', () => refused((s) => { s.releases[1].manifest = `${s.releases[1].manifest}${' '.repeat(1100000)}`; }, /^updater: refused: the manifest is larger than the updater takes\n$/));
    test('two releases with one tag', () => refused((s) => { s.releases.push({ ...s.releases[1] }); }, /^updater: refused: two releases name the tag v1\.1\.0\n$/));
    test('the pinned release made again from another commit', () => refused((s) => { s.refs.set('v1.0.0', { type: 'commit', sha: commitOf('remade') }); s.releases[0].commit = commitOf('remade'); s.releases[0].manifest = canonical({ ...JSON.parse(s.releases[0].manifest), commit: commitOf('remade') }); s.contents.set(commitOf('remade'), s.releases[0].served); },
      /^updater: refused: the release v1\.0\.0 was made from another commit than the pin recorded\n$/, ['--target', 'v1.0.0']));

    test('a list that names entries that are not releases, tags that are no tags of the kit, and drafts: they are left out, and nothing is run or fetched for them', async () => {
      const { state, bare, work } = await world();
      const refs = refsOf(bare);
      state.listBody = [
        { tag_name: '../../../etc/passwd', draft: false, prerelease: false, body: 'x', assets: [{ id: 1, name: 'release-manifest.json', size: 1 }] },
        { tag_name: 'v9.9.9', draft: true, prerelease: false, body: 'x', assets: [{ id: 1, name: 'release-manifest.json', size: 1 }] },
        { tag_name: 'v9.9.9-1', draft: false, prerelease: true, body: 'x', assets: [] },
        { tag_name: 'nightly', draft: false, prerelease: false },
        null,
        'v9.9.9',
        ...state.releases.map((r) => ({ tag_name: r.tag, draft: false, prerelease: r.prerelease, body: r.body, assets: [{ id: r.assetId, name: 'release-manifest.json', size: 1 }] })),
      ];
      const got = await call(['--dry-run'], state, work);
      assert.equal(got.code, 0, got.stderr);
      assert.match(got.stdout, /^update v1\.0\.0 to v1\.1\.0 \(stable\)/);
      assert.ok(!state.requests.some((r) => /passwd|9\.9\.9|nightly/.test(r.path)));
      assert.equal(writes(state).length, 0);
      assert.equal(refsOf(bare), refs);
    });

    test('annotated tags are followed five times and no more, and the commit at the end is the one of the manifest', async () => {
      for (const [chain, ok] of [[1, true], [5, true], [6, false]]) {
        const { state, bare, work } = await world();
        const refs = refsOf(bare);
        const commit = state.releases[1].commit;
        const ids = Array.from({ length: chain }, (_, i) => commitOf(`chain ${chain} ${i}`));
        state.refs.set('v1.1.0', { type: 'tag', sha: ids[0] });
        for (const [i, id] of ids.entries()) state.annotated.set(id, i === chain - 1 ? { type: 'commit', sha: commit } : { type: 'tag', sha: ids[i + 1] });
        const got = await call(['--dry-run'], state, work);
        if (ok) assert.equal(got.code, 0, `${chain}: ${got.stderr}`);
        else assert.deepEqual([got.code, got.stderr], [1, 'updater: refused: the tag v1.1.0 does not point at a commit\n']);
        assert.equal(refsOf(bare), refs);
      }
    });

    test('the assets of a release: entries that are not assets are passed over, and an asset whose id is not an id is no manifest', async () => {
      const listing = (state, assets) => state.releases.map((r) => ({ tag_name: r.tag, draft: false, prerelease: r.prerelease, body: r.body, assets: r.tag === 'v1.1.0' ? assets(r) : [{ id: r.assetId, name: 'release-manifest.json', size: 1 }] }));
      {
        const { state, work } = await world();
        state.listBody = listing(state, (r) => [null, 5, 'x', [], { id: 7 }, { name: 'other.json', id: 8 }, { id: r.assetId, name: 'release-manifest.json', size: 1 }]);
        const got = await call(['--dry-run'], state, work);
        assert.equal(got.code, 0, got.stderr);
      }
      for (const id of [0, -1, 1.5, '102', null, undefined, 2 ** 60]) {
        const { state, work } = await world();
        state.listBody = listing(state, () => [{ id, name: 'release-manifest.json', size: 1 }]);
        const got = await call(['--dry-run'], state, work);
        assert.deepEqual([got.code, got.stderr], [1, 'updater: refused: the release v1.1.0 has no release-manifest.json\n'], String(id));
      }
      for (const assets of [undefined, null, 'x', {}]) {
        const { state, work } = await world();
        state.listBody = listing(state, () => assets);
        const got = await call(['--dry-run'], state, work);
        assert.deepEqual([got.code, got.stderr], [1, 'updater: refused: the release v1.1.0 has no release-manifest.json\n'], String(assets));
      }
    });

    test('a link to the next page that has an empty address is the address of the API itself, which has no releases to give', async () => {
      const state = await github({ pageSize: 1 });
      release(state, 'v1.0.0', V1);
      release(state, 'v1.1.0', V2);
      state.nextLink = '<>; rel="next"';
      const { work } = adopted();
      const got = await call(['--dry-run'], state, work);
      assert.equal(got.code, 1);
      assert.match(got.stderr, /^updater: failed: GET \/ answered 404/);
    });

    test('a list of something else than a list', async () => {
      const { state, work } = await world();
      state.listBody = { message: 'hello' };
      const got = await call(['--dry-run'], state, work);
      assert.equal(got.code, 1);
      assert.equal(got.stderr, 'updater: failed: the list of releases is not a list\n');
    });

    test('a link to the next page that leaves the API, or goes round', async () => {
      for (const [link, said] of [['<https://evil.example/releases?page=2>; rel="next"', 'is not the API'], ['<http://127.0.0.2:1/repos/gearsnlevers/record-keeper/releases?page=2>; rel="next"', 'is not the API'],
      ['</repos/gearsnlevers/record-keeper/releases?per_page=100&page=1>; rel="next"', 'goes back to a page that was read'], ['<http://[::1>; rel="next"', 'is not the API']]) {
        const state = await github({ pageSize: 1 });
        release(state, 'v1.0.0', V1);
        release(state, 'v1.1.0', V2);
        state.nextLink = link;
        const { work } = adopted();
        const got = await call(['--dry-run'], state, work);
        assert.equal(got.code, 1, link);
        assert.equal(got.stderr, `updater: failed: the link to the next page ${said}\n`, link);
        assert.ok(asked.every((url) => !url.includes('evil.example')), 'the program did not ask the other place');
      }
    });

    test('more pages than the program reads', async () => {
      const state = await github({ pageSize: 1 });
      for (let i = 0; i < 52; i++) release(state, `v1.0.${i}`, V1);
      const work = folder('first');
      const got = await call(['--local', '--source', 'gearsnlevers/record-keeper'], state, work, { token: null });
      assert.equal(got.code, 1);
      assert.equal(got.stderr, 'updater: failed: more than 50 pages of releases\n');
    });
  });
});

// ---- where a download is sent -------------------------------------------------------------------------------------------------------------------

describe('what is read of an answer', () => {
  const MANIFEST_LIMIT = 1024 * 1024;
  const PAGE_LIMIT = 8 * 1024 * 1024;

  for (const chunked of [false, true]) {
    const how = chunked ? 'an answer in pieces, with no length' : 'an answer that says its length';

    test(`a manifest of exactly the limit is read, and one byte more is not (${how})`, async () => {
      const { state, work } = await world();
      state.chunked = chunked;
      const text = state.releases[1].manifest;
      state.releases[1].manifest = text + ' '.repeat(MANIFEST_LIMIT - Buffer.byteLength(text));
      const exact = await call(['--dry-run'], state, work);
      assert.equal(exact.code, 0, exact.stderr);
      state.releases[1].manifest += ' ';
      const over = await call(['--dry-run'], state, work);
      assert.deepEqual([over.code, over.stderr], [1, 'updater: refused: the manifest is larger than the updater takes\n']);
    });

    test(`a page of releases of exactly the limit is read, and one byte more is not (${how})`, async () => {
      const { state, work } = await world();
      state.chunked = chunked;
      const page = JSON.stringify(state.releases.map((r) => ({ tag_name: r.tag, draft: false, prerelease: r.prerelease, body: r.body, assets: [{ id: r.assetId, name: 'release-manifest.json', size: Buffer.byteLength(r.manifest) }] })));
      state.listBody = `${page}${' '.repeat(PAGE_LIMIT - Buffer.byteLength(page))}`;
      const exact = await call(['--dry-run'], state, work);
      assert.equal(exact.code, 0, exact.stderr);
      state.listBody += ' ';
      const over = await call(['--dry-run'], state, work);
      assert.deepEqual([over.code, over.stderr], [1, 'updater: failed: the answer to /repos/gearsnlevers/record-keeper/releases?per_page=30 is larger than the updater takes\n']);
    });

    test(`a file of exactly the size of the manifest is read, and one byte more is not (${how})`, async () => {
      const { state, work } = await world();
      state.chunked = chunked;
      const served = state.releases[1].served;
      served.set('kit/.github/record-keeper/updater.mjs', Buffer.from('// updater 2\n'));
      assert.equal((await call(['--dry-run'], state, work)).code, 0);
      served.set('kit/.github/record-keeper/updater.mjs', Buffer.from('// updater 2\n '));
      const over = await call(['--dry-run'], state, work);
      assert.deepEqual([over.code, over.stderr], [1, 'updater: refused: size mismatch: .github/record-keeper/updater.mjs\n']);
    });
  }

  test('the beginning of what an error says is part of the message, as much as 200 characters, and an error that has no body says nothing more', async () => {
    const { state, work } = await world();
    state.fault = (entry) => (entry.path.endsWith('/releases') ? { status: 404, body: `${'x'.repeat(150)}${'y'.repeat(150)}` } : null);
    const got = await call(['--dry-run'], state, work);
    assert.equal(got.stderr, `updater: failed: GET /repos/gearsnlevers/record-keeper/releases?per_page=30 answered 404: ${'x'.repeat(150)}${'y'.repeat(50)}\n`);
    state.fault = (entry) => (entry.path.endsWith('/releases') ? { status: 404, body: 'z'.repeat(5000) } : null);
    const long = await call(['--dry-run'], state, work);
    assert.equal(long.stderr, 'updater: failed: GET /repos/gearsnlevers/record-keeper/releases?per_page=30 answered 404\n', 'an error that says more than 2000 bytes is not read');
    for (const [size, shown] of [[2000, true], [2001, false]]) {
      state.fault = (entry) => (entry.path.endsWith('/releases') ? { status: 404, body: 'k'.repeat(size) } : null);
      const edge = await call(['--dry-run'], state, work);
      assert.equal(edge.stderr, `updater: failed: GET /repos/gearsnlevers/record-keeper/releases?per_page=30 answered 404${shown ? `: ${'k'.repeat(200)}` : ''}\n`, `${size} bytes`);
    }
    state.split = 30;
    state.fault = (entry) => (entry.path.endsWith('/releases') ? { status: 404, body: 'y'.repeat(3000) } : null);
    const told = await call(['--dry-run'], state, work);
    assert.equal(told.stderr, 'updater: failed: GET /repos/gearsnlevers/record-keeper/releases?per_page=30 answered 404\n', 'an error that says that it is longer than 2000 bytes is not read at all, even when it comes in pieces');
    state.split = undefined;
    state.fault = (entry) => (entry.path.endsWith('/releases') ? { status: 304, body: '' } : null);
    const none = await call(['--dry-run'], state, work);
    assert.equal(none.stderr, 'updater: failed: GET /repos/gearsnlevers/record-keeper/releases?per_page=30 answered 304\n');
    state.fault = (entry) => (entry.path.endsWith('/releases') ? { status: 404, body: 'a\nb\u202ec\u0000d' } : null);
    const hiding = await call(['--dry-run'], state, work);
    assert.equal(hiding.stderr, 'updater: failed: GET /repos/gearsnlevers/record-keeper/releases?per_page=30 answered 404: a b\\u{202e}c\\u{0}d\n', 'what hides is written out, and a line feed is a space');
  });

  test('a request that writes says that its body is JSON, and a request that reads says nothing of a body', async () => {
    const { state, work } = await world();
    assert.equal((await call([], state, work)).code, 0);
    assert.equal((await call([], state, work)).code, 0);
    for (const r of state.requests) assert.deepEqual([r.apiVersion, r.userAgent], ['2022-11-28', 'record-keeper-updater'], r.path);
    const kinds = state.requests.map((r) => [r.method, r.contentType]);
    assert.ok(kinds.some(([method]) => method === 'POST') && kinds.some(([method]) => method === 'PATCH'));
    for (const [method, type] of kinds) assert.equal(type, method === 'GET' ? undefined : 'application/json', method);
    for (const r of state.requests) {
      assert.equal(r.accept, r.path.includes('/contents/') ? 'application/vnd.github.raw+json' : r.path.includes('/releases/assets/') || r.path.startsWith('/blob/') ? 'application/octet-stream' : 'application/vnd.github+json', r.path);
    }
  });
});

describe('the redirect of the manifest', () => {
  test('is followed once to the API itself, and the token is not sent on', async () => {
    const { state, work } = await world({ redirect: true });
    const got = await call(['--dry-run'], state, work);
    assert.equal(got.code, 0, got.stderr);
    const blobs = state.requests.filter((r) => r.path.startsWith('/blob/'));
    assert.ok(blobs.length >= 2);
    for (const r of blobs) assert.deepEqual([r.accept, r.apiVersion, r.userAgent], ['application/octet-stream', '2022-11-28', 'record-keeper-updater']);
  });

  test('is refused when it leads anywhere else, and nothing is asked of that place', async () => {
    for (const location of ['http://evil.example/steal', 'https://objects.githubusercontent.com/x', 'ftp://127.0.0.1/x', 'http://127.0.0.2:9/x']) {
      const { state, work } = await world();
      state.redirect = location;
      const before = asked.length;
      const got = await call(['--dry-run'], state, work);
      assert.equal(got.code, 1, location);
      assert.match(got.stderr, /^updater: failed: the download of the manifest was sent to a place that the updater does not follow: /, location);
      assert.ok(!got.stderr.includes(TOKEN));
      assert.ok(asked.slice(before).every((url) => url.startsWith(state.url)), 'every request went to the API');
    }
  });

  test('is followed once and not twice', async () => {
    const { state, work } = await world({ redirect: true });
    const real = state.releases[1];
    state.redirect = `${state.url}/blob/${real.assetId}`;
    const original = state.fault;
    state.fault = (entry) => (entry.path.startsWith('/blob/') ? { status: 302, headers: { location: `${state.url}/blob/${real.assetId}` } } : original?.(entry));
    const got = await call(['--dry-run'], state, work);
    assert.equal(got.code, 1);
    assert.match(got.stderr, /answered 302/);
  });
});

// ---- the token -----------------------------------------------------------------------------------------------------------------------------------

describe('the token', () => {
  test('is never in what the program prints: not on success, not on a refusal, not on a failure, not when the server says it back', async () => {
    const outputs = [];
    {
      const { state, work } = await world();
      outputs.push(await call([], state, work));
    }
    {
      const { state, work } = await world();
      state.releases[1].served.set('kit/.github/record-keeper/updater.mjs', Buffer.from('// bad\n'));
      outputs.push(await call([], state, work));
    }
    {
      const { state, work } = await world();
      state.fault = (entry) => (entry.path.includes('/contents/') ? { status: 401, body: { message: `Bad credentials: ${TOKEN} is not valid` } } : null);
      outputs.push(await call([], state, work));
    }
    {
      const { state, work } = await world();
      state.fault = (entry) => (entry.path.endsWith('/releases') ? { status: 500, body: `the token was ${TOKEN}` } : null);
      outputs.push(await call([], state, work));
    }
    {
      const { state, work } = await world();
      state.fault = (entry) => (entry.method === 'POST' ? { status: 422, body: { message: `Validation Failed ${TOKEN}` } } : null);
      outputs.push(await call([], state, work));
    }
    assert.deepEqual(outputs.map((o) => o.code), [0, 1, 1, 1, 1]);
    for (const out of outputs) {
      assert.ok(!out.stdout.includes(TOKEN) && !out.stderr.includes(TOKEN));
      assert.ok(!(out.stdout + out.stderr).includes(Buffer.from(TOKEN).toString('base64')));
    }
    assert.match(outputs[2].stderr, /answered 401: \{"message":"Bad credentials: \*\*\* is not valid"\}/);
    assert.match(outputs[3].stderr, /answered 500: the token was \*\*\*/);
  });

  test('is never in what a child process prints, and its exit status is the one of the page', async () => {
    const { state, work } = await world();
    const ran = await exec([program], { cwd: work, env: { GITHUB_REPOSITORY: 'o/r', GITHUB_API_URL: state.url, RECORD_KEEPER_TOKEN: TOKEN } });
    assert.equal(ran.code, 0, ran.stderr);
    assert.ok(!(ran.stdout + ran.stderr).includes(TOKEN));
    assert.match(ran.stdout, /opened pull request #1\n$/);
    const bad = await exec([program, '--bogus'], { cwd: work, env: {} });
    assert.deepEqual([bad.code, bad.stdout], [2, '']);
    assert.match(bad.stderr, /^Usage:\n/);
  });

  test('is sent as a bearer token to the API for every request, and never in the address', async () => {
    const { state, work } = await world();
    await call([], state, work);
    for (const r of state.requests) {
      assert.equal(r.authorization, `Bearer ${TOKEN}`);
      assert.ok(!r.search.includes(TOKEN) && !r.path.includes(TOKEN));
      assert.ok(r.body === undefined || !JSON.stringify(r.body).includes(TOKEN));
    }
  });

  test('without it a run reports the update, writes nothing, and fails when there was something to write', async () => {
    const { state, bare, work } = await world();
    const refs = refsOf(bare);
    const got = await call([], state, work, { token: null });
    assert.equal(got.code, 1);
    assert.equal(got.stderr, '');
    assert.match(got.stdout, /^update v1\.0\.0 to v1\.1\.0 \(stable\)\n[\s\S]*\nRECORD_KEEPER_TOKEN is not set: nothing was written/);
    assert.equal(refsOf(bare), refs);
    assert.equal(writes(state).length, 0);
    assert.equal(statusOf(work), '');
    assert.ok(state.requests.every((r) => r.authorization === undefined));
    const empty = await call([], state, work, { token: '' });
    assert.equal(empty.code, 1);
  });

  test('without it a run with nothing to do is green', async () => {
    const state = await github();
    release(state, 'v1.0.0', V1);
    const { work } = adopted();
    const got = await call([], state, work, { token: null });
    assert.deepEqual([got.code, got.stdout], [0, 'current: v1.0.0 is the newest stable release of gearsnlevers/record-keeper\n']);
  });

  test('a token with a space in it is refused before anything is asked', async () => {
    const { state, work } = await world();
    const got = await call([], state, work, { token: 'a b' });
    assert.deepEqual([got.code, got.stderr], [1, 'updater: failed: RECORD_KEEPER_TOKEN is not a token\n']);
    assert.equal(state.requests.length, 0);
  });
});

// ---- the one branch ------------------------------------------------------------------------------------------------------------------------------

describe('the branch', () => {
  test('is never any other: a default branch named like the update branch is refused', async () => {
    const { state, work } = await world();
    state.defaultBranch = BRANCH;
    const got = await call([], state, work);
    assert.equal(got.code, 1);
    assert.equal(got.stderr, 'updater: failed: the default branch of the repository is not what the updater reads\n');
    assert.equal(writes(state).length, 0);
  });

  test('the name of the default branch is a name of a branch: letters, digits and . _ / -, 1 to 200 characters, and anything else is not read', async () => {
    const state = await github();
    release(state, 'v1.0.0', V1);
    const { work } = adopted();
    for (const name of ['main', 'release-2.0', 'a/b', 'v1_x.2', 'A-Z0-9', 'x'.repeat(200), 'a']) {
      state.defaultBranch = name;
      const got = await call([], state, work);
      assert.deepEqual([got.code, got.stderr], [0, ''], name);
    }
    for (const name of ['', 'x'.repeat(201), 'with space', 'a@b', '@main', 'main@', 'a`b', 'a\nb', 'a:b', 'a*b', 'a~b', 123, null, ['main']]) {
      state.defaultBranch = name;
      const got = await call([], state, work);
      assert.deepEqual([got.code, got.stderr], [1, 'updater: failed: the default branch of the repository is not what the updater reads\n'], String(name));
    }
  });

  test('an error that is no refusal and no failure and no error of the system is not hidden: it ends the run, with its stack', async () => {
    const { state, work } = await world();
    let failed = false;
    state.fault = (entry) => (entry.path.endsWith('/releases') && !failed && (failed = true) ? { status: 503 } : null);
    const sleep = async () => { throw Object.assign(new Error('a mistake of the test'), { code: 'ERR_A_MISTAKE' }); };
    await assert.rejects(call(['--dry-run'], state, work, { sleep }), /a mistake of the test/);
  });

  test('a pull request that GitHub answers with something that is none is a failure, and so is one that it does not make', async () => {
    for (const body of [{ id: 5 }, 'not json', '[]', 'null', { number: 'seven' }, { number: 1.5 }]) {
      const { state, bare, work } = await world();
      state.fault = (entry) => (entry.method === 'POST' && entry.path === '/repos/o/r/pulls' ? { status: 201, body } : null);
      const got = await call([], state, work);
      assert.deepEqual([got.code, got.stderr], [1, 'updater: failed: the answer to the new pull request is not a pull request\n'], JSON.stringify(body));
      assert.ok(treeOf(bare, BRANCH).length > 0, 'the branch was pushed before the pull request was asked for');
    }
  });

  test('is built only from the head of the default branch: a working tree that is behind, or on another branch, is refused', async () => {
    const { state, dev, bare, work } = await world();
    write(dev, 'NEWS.md', 'news\n');
    git(dev, 'add', '-A');
    git(dev, 'commit', '-qm', 'A push that came in between (#2)');
    git(dev, 'push', '-q', bare, 'main');
    const refs = refsOf(bare);
    const got = await call([], state, work);
    assert.equal(got.code, 1);
    assert.match(got.stderr, /^updater: failed: the working tree is not at the head of main on origin: check out that branch, and run again\n$/);
    assert.equal(refsOf(bare), refs);
    assert.equal(writes(state).length, 0);
    git(work, 'checkout', '-q', '-b', 'feature');
    const other = await call([], state, work);
    assert.equal(other.code, 1);
    assert.match(other.stderr, /not at the head of main/);
    assert.equal(git(work, 'symbolic-ref', '--short', 'HEAD'), 'feature');
  });

  test('is built only from a clean working tree: a change that is not committed, or a file that is not tracked, is refused', async () => {
    for (const mess of [(dir) => fs.appendFileSync(path.join(dir, '.github/record-keeper/record-keeper.mjs'), '// mine\n'), (dir) => write(dir, 'untracked.txt', 'x')]) {
      const { state, bare, work } = await world();
      mess(work);
      const refs = refsOf(bare);
      const got = await call([], state, work);
      assert.equal(got.code, 1);
      assert.equal(got.stderr, 'updater: failed: the working tree has changes that are not committed: the update branch is built from a clean checkout\n');
      assert.equal(refsOf(bare), refs);
      assert.equal(writes(state).length, 0);
    }
  });

  test('a run in a folder that is not a repository fails with what git says', async () => {
    const { state } = await world();
    const work = folder('plain');
    write(work, PIN_PATH, pinOf('v1.0.0'));
    const got = await call([], state, work);
    assert.equal(got.code, 1);
    assert.match(got.stderr, /^updater: failed: git rev-parse failed: /);
    assert.equal(writes(state).length, 0);
  });

  test('is not changed by the variables that tell git where a repository is', async () => {
    const { state, bare, work } = await world();
    const elsewhere = folder('elsewhere');
    git(elsewhere, 'init', '-q');
    const nowhere = path.join(elsewhere, 'nowhere');
    const got = await call([], state, work, { gitEnv: { ...GIT_ENV, GIT_DIR: path.join(elsewhere, '.git'), GIT_WORK_TREE: elsewhere, GIT_INDEX_FILE: path.join(elsewhere, 'index'), GIT_OBJECT_DIRECTORY: path.join(nowhere, 'objects'),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: nowhere, GIT_COMMON_DIR: nowhere, GIT_NAMESPACE: 'elsewhere', GIT_PREFIX: 'sub/' } });
    assert.equal(got.code, 0, got.stderr);
    assert.ok(treeOf(bare, BRANCH).includes('.github/workflows/records-updater.yml'));
    assert.deepEqual(fs.readdirSync(elsewhere), ['.git']);
  });

  test('runs with no hook: a hook of the repository does not run', async () => {
    const { state, work } = await world();
    const marker = path.join(folder('marker'), 'ran');
    for (const hook of ['pre-commit', 'commit-msg', 'post-commit', 'reference-transaction', 'pre-push']) {
      const file = path.join(work, '.git/hooks', hook);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `#!/bin/sh\necho ${hook} >> '${marker}'\nexit 1\n`, { mode: 0o755 });
    }
    const got = await call([], state, work);
    assert.equal(got.code, 0, got.stderr);
    assert.ok(!fs.existsSync(marker), 'no hook ran');
  });

  test('a push that origin refuses is a failure with what git says, and the working tree is put back', async () => {
    const { state, bare, work } = await world();
    fs.mkdirSync(path.join(bare, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(bare, 'hooks/pre-receive'), '#!/bin/sh\necho "no pushes today" >&2\nexit 1\n', { mode: 0o755 });
    const got = await call([], state, work, { gitEnv: GIT_ENV });
    assert.equal(got.code, 1);
    assert.match(got.stderr, /^updater: failed: git push failed: /);
    assert.equal(git(work, 'symbolic-ref', '--short', 'HEAD'), 'main');
    assert.equal(statusOf(work), '');
    assert.equal(state.pulls.length, 0, 'no pull request for a branch that is not there');
  });
});

// ---- the working tree ------------------------------------------------------------------------------------------------------------------------------

describe('what is in the way', () => {
  test('a link at the place of a managed file is not written through, and nothing is written', async () => {
    const { state, dev, bare, work } = await world();
    const outside = path.join(folder('outside'), 'target.txt');
    fs.writeFileSync(outside, 'precious\n');
    fs.rmSync(path.join(dev, '.github/record-keeper/updater.mjs'));
    fs.symlinkSync(outside, path.join(dev, '.github/record-keeper/updater.mjs'));
    git(dev, 'add', '-A');
    git(dev, 'commit', '-qm', 'A link (#2)');
    git(dev, 'push', '-q', bare, 'main');
    git(work, 'pull', '-q');
    const refs = refsOf(bare);
    const got = await call([], state, work);
    assert.equal(got.code, 1);
    assert.equal(got.stderr, 'updater: refused: something other than a file is in the way of .github/record-keeper/updater.mjs\n');
    assert.equal(fs.readFileSync(outside, 'utf8'), 'precious\n');
    assert.equal(refsOf(bare), refs);
    assert.equal(statusOf(work), '');
  });

  test('a folder of the path is a link to somewhere else: nothing is written there', async () => {
    const state = await github();
    release(state, 'v1.0.0', V1);
    const work = folder('first');
    const outside = folder('outside');
    fs.mkdirSync(path.join(work, '.github'));
    fs.symlinkSync(outside, path.join(work, '.github/record-keeper'));
    const got = await call(['--local', '--source', 'gearsnlevers/record-keeper'], state, work, { token: null });
    assert.equal(got.code, 1);
    assert.match(got.stderr, /^updater: refused: something other than a file is in the way of \.github\/record-keeper\/[a-z-]+\.mjs\n$/);
    assert.deepEqual(fs.readdirSync(outside), []);
  });

  test('the pin is a folder, or a link, or not text: refused', async () => {
    const state = await github();
    release(state, 'v1.0.0', V1);
    for (const make of [(dir) => fs.mkdirSync(path.join(dir, PIN_PATH), { recursive: true }), (dir) => { fs.mkdirSync(path.join(dir, '.github')); fs.symlinkSync('/etc/hosts', path.join(dir, PIN_PATH)); }, (dir) => write(dir, PIN_PATH, Buffer.from([0xff, 0xfe, 0x0a])), (dir) => write(dir, PIN_PATH, 'x'.repeat(70000))]) {
      const work = folder('pin');
      make(work);
      const got = await call(['--dry-run'], state, work, { token: null });
      assert.equal(got.code, 1);
      assert.equal(got.stderr, 'updater: refused: the pin is not a regular file of text in UTF-8\n');
    }
  });

  test('a pin of exactly 64 KiB is read, and one byte more is not', async () => {
    const state = await github();
    release(state, 'v1.0.0', V1);
    const pin = pinOf('v1.0.0');
    const filler = (size) => `${pin}#${'x'.repeat(size - Buffer.byteLength(pin) - 2)}\n`;
    const exact = filler(64 * 1024);
    assert.equal(Buffer.byteLength(exact), 64 * 1024);
    const work = folder('pin');
    write(work, PIN_PATH, exact);
    const got = await call(['--dry-run'], state, work, { token: null });
    assert.deepEqual([got.code, got.stderr], [0, '']);
    assert.match(got.stdout, /^current: v1\.0\.0 /);
    const more = folder('pin');
    write(more, PIN_PATH, filler(64 * 1024 + 1));
    const over = await call(['--dry-run'], state, more, { token: null });
    assert.deepEqual([over.code, over.stderr], [1, 'updater: refused: the pin is not a regular file of text in UTF-8\n']);
  });

  test('a pin that is not in the form of the page is refused with the line, and nothing is asked of GitHub', async () => {
    const state = await github();
    release(state, 'v1.0.0', V1);
    const work = folder('pin');
    write(work, PIN_PATH, `${pinOf('v1.0.0')}branch: main\n`);
    const got = await call(['--dry-run'], state, work, { token: null });
    assert.deepEqual([got.code, got.stderr], [1, 'updater: refused: the pin has a key that is not one of source, version, commit and channel: branch\n']);
    assert.equal(state.requests.length, 0);
  });

  test('a repository without a pin, in Actions, or with another source than the pin, is refused', async () => {
    const state = await github();
    release(state, 'v1.0.0', V1);
    const { work } = adopted({ pin: null });
    const got = await call([], state, work);
    assert.deepEqual([got.code, got.stderr], [1, 'updater: refused: there is no pin and no --source: the first adoption names the source repository\n']);
    const withSource = await call(['--source', 'gearsnlevers/record-keeper'], state, work);
    assert.equal(withSource.code, 1, 'a pull request is for a repository that has adopted the kit');
    const other = adopted();
    const mismatch = await call(['--source', 'other/kit', '--dry-run'], state, other.work);
    assert.deepEqual([mismatch.code, mismatch.stderr], [1, 'updater: refused: the pin names another source repository than --source (gearsnlevers/record-keeper)\n']);
    assert.equal(state.requests.length, 0);
  });
});

// ---- retries ---------------------------------------------------------------------------------------------------------------------------------------

describe('a request that fails', () => {
  test('is repeated when GitHub answers 5xx, up to three times in all', async () => {
    const { state, work } = await world();
    let failures = 2;
    state.fault = (entry) => (entry.path.endsWith('/releases') && failures-- > 0 ? { status: 503, body: { message: 'unavailable' } } : null);
    const waits = [];
    const got = await call(['--dry-run'], state, work, { sleep: async (ms) => { waits.push(ms); } });
    assert.equal(got.code, 0, got.stderr);
    assert.deepEqual(waits, [1000, 2000]);
    assert.equal(state.requests.filter((r) => r.path.endsWith('/releases')).length, 3);
  });

  test('is given up after the third answer, and says what it was', async () => {
    const { state, work } = await world();
    state.fault = (entry) => (entry.path.endsWith('/releases') ? { status: 502, body: { message: 'bad gateway' } } : null);
    const got = await call(['--dry-run'], state, work);
    assert.equal(got.code, 1);
    assert.equal(got.stderr, 'updater: failed: GET /repos/gearsnlevers/record-keeper/releases?per_page=30 answered 502: {"message":"bad gateway"}\n');
    assert.equal(state.requests.filter((r) => r.path.endsWith('/releases')).length, 3);
  });

  test('waits as long as GitHub asks for a secondary limit, if it is not long, and then goes on', async () => {
    const { state, work } = await world();
    let limited = 1;
    state.fault = (entry) => (entry.path.endsWith('/releases') && limited-- > 0 ? { status: 403, headers: { 'retry-after': '7' }, body: { message: 'secondary rate limit' } } : null);
    const waits = [];
    const got = await call(['--dry-run'], state, work, { sleep: async (ms) => { waits.push(ms); } });
    assert.equal(got.code, 0, got.stderr);
    assert.deepEqual(waits, [7000]);
  });

  test('does not wait for a long time, and does not wait for the primary limit: it says when the limit resets', async () => {
    for (const fault of [{ status: 403, headers: { 'retry-after': '3600' }, body: { message: 'later' } }, { status: 429, headers: { 'retry-after': '61' }, body: {} }]) {
      const { state, work } = await world();
      state.fault = (entry) => (entry.path.endsWith('/releases') ? fault : null);
      const waits = [];
      const got = await call(['--dry-run'], state, work, { sleep: async (ms) => { waits.push(ms); } });
      assert.equal(got.code, 1);
      assert.deepEqual(waits, []);
      assert.match(got.stderr, /answered (403|429)/);
    }
    const { state, work } = await world();
    state.fault = (entry) => (entry.path.endsWith('/releases') ? { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000', 'retry-after': '5' }, body: { message: 'rate limit exceeded' } } : null);
    const waits = [];
    const got = await call(['--dry-run'], state, work, { sleep: async (ms) => { waits.push(ms); } });
    assert.equal(got.code, 1);
    assert.deepEqual(waits, []);
    assert.equal(got.stderr, 'updater: failed: GET /repos/gearsnlevers/record-keeper/releases?per_page=30 answered 403: the rate limit is used up and resets at 2027-01-15T08:00:00.000Z; run again later, with a token\n');
  });

  test('the limits of GitHub are read as they come: which answers wait, which are given up, and what is said of the reset', async () => {
    const answers = [
      // [status, headers, how many requests are made, what is waited, the end of the message]
      [403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' }, 1, [], 'answered 403: the rate limit is used up and resets at 2027-01-15T08:00:00.000Z; run again later, with a token'],
      [429, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' }, 1, [], 'answered 429: the rate limit is used up and resets at 2027-01-15T08:00:00.000Z; run again later, with a token'],
      [403, { 'x-ratelimit-remaining': '0' }, 1, [], 'answered 403: the rate limit is used up; run again later, with a token'],
      [403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': 'soon' }, 1, [], 'answered 403: the rate limit is used up; run again later, with a token'],
      [403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '0' }, 1, [], 'answered 403: the rate limit is used up; run again later, with a token'],
      [403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '100000000000' }, 1, [], 'answered 403: the rate limit is used up; run again later, with a token'],
      [403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '99999999999' }, 1, [], 'answered 403: the rate limit is used up and resets at 5138-11-16T09:46:39.000Z; run again later, with a token'],
      [403, { 'x-ratelimit-remaining': '1', 'retry-after': '3' }, 3, [3000, 3000], 'answered 403: {"message":"fault"}'],
      [404, { 'x-ratelimit-remaining': '0' }, 1, [], 'answered 404: {"message":"fault"}'],
      [500, { 'x-ratelimit-remaining': '0' }, 3, [1000, 2000], 'answered 500: {"message":"fault"}'],
      [499, {}, 1, [], 'answered 499: {"message":"fault"}'],
      [500, {}, 3, [1000, 2000], 'answered 500: {"message":"fault"}'],
      [403, {}, 1, [], 'answered 403: {"message":"fault"}'],
      [429, { 'retry-after': '5' }, 3, [5000, 5000], 'answered 429: {"message":"fault"}'],
      [403, { 'retry-after': '1' }, 3, [1000, 1000], 'answered 403: {"message":"fault"}'],
      [403, { 'retry-after': '60' }, 3, [60000, 60000], 'answered 403: {"message":"fault"}'],
      [403, { 'retry-after': '61' }, 1, [], 'answered 403: {"message":"fault"}'],
      [403, { 'retry-after': '0' }, 1, [], 'answered 403: {"message":"fault"}'],
      [403, { 'retry-after': '-5' }, 1, [], 'answered 403: {"message":"fault"}'],
      [403, { 'retry-after': 'soon' }, 1, [], 'answered 403: {"message":"fault"}'],
      [404, { 'retry-after': '3' }, 1, [], 'answered 404: {"message":"fault"}'],
      [500, { 'retry-after': '3' }, 3, [1000, 2000], 'answered 500: {"message":"fault"}'],
    ];
    for (const [status, headers, requests, waits, said] of answers) {
      const { state, work } = await world();
      state.fault = (entry) => (entry.path.endsWith('/releases') ? { status, headers } : null);
      const slept = [];
      const got = await call(['--dry-run'], state, work, { sleep: async (ms) => { slept.push(ms); } });
      const what = `${status} ${JSON.stringify(headers)}`;
      assert.equal(got.code, 1, what);
      assert.equal(got.stderr, `updater: failed: GET /repos/gearsnlevers/record-keeper/releases?per_page=30 ${said}\n`, what);
      assert.equal(state.requests.filter((r) => r.path.endsWith('/releases')).length, requests, what);
      assert.deepEqual(slept, waits, what);
    }
  });

  test('a redirect of the download that does not say where to go is a failure that says so', async () => {
    const { state, work } = await world();
    state.fault = (entry) => (entry.path.startsWith('/repos/gearsnlevers/record-keeper/releases/assets/') ? { status: 302, headers: {}, body: '' } : null);
    const got = await call(['--dry-run'], state, work);
    assert.deepEqual([got.code, got.stderr], [1, 'updater: failed: GET /repos/gearsnlevers/record-keeper/releases/assets/102 answered 302 and did not say where the download is\n']);
  });

  test('a 4xx that is no limit is not repeated', async () => {
    const { state, work } = await world();
    state.fault = (entry) => (entry.path.endsWith('/releases') ? { status: 404, body: { message: 'Not Found' } } : null);
    const got = await call(['--dry-run'], state, work);
    assert.equal(got.code, 1);
    assert.equal(state.requests.filter((r) => r.path.endsWith('/releases')).length, 1);
  });

  test('a connection that fails is repeated, and a request that writes is never repeated', async () => {
    const { state, work } = await world();
    let calls = 0;
    const flaky = (url, init) => {
      if (String(url).endsWith('per_page=30') && (calls += 1) <= 2) return Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET', message: 'socket hang up' } }));
      return guardedFetch(url, init);
    };
    const got = await call(['--dry-run'], state, work, { fetch: flaky });
    assert.equal(got.code, 0, got.stderr);
    assert.equal(calls, 3);
    const ok = await world();
    ok.state.fault = (entry) => (entry.method === 'POST' ? { status: 503, body: { message: 'unavailable' } } : null);
    const failed = await call([], ok.state, ok.work);
    assert.equal(failed.code, 1);
    assert.match(failed.stderr, /^updater: failed: POST \/repos\/o\/r\/pulls answered 503/);
    assert.equal(ok.state.requests.filter((r) => r.method === 'POST').length, 1, 'the pull request was not asked for twice');
  });

  test('a connection that does not come back is a failure that says why', async () => {
    const { state, work } = await world();
    const down = () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:9' } }));
    const got = await call(['--dry-run'], state, work, { fetch: down });
    assert.equal(got.code, 1);
    assert.match(got.stderr, /^updater: failed: GET \/repos\/gearsnlevers\/record-keeper\/releases\?per_page=30 failed: connect ECONNREFUSED 127\.0\.0\.1:9\n$/);
  });

  test('an answer that is not JSON, and one that is too large', async () => {
    const { state, work } = await world();
    state.fault = (entry) => (entry.path.endsWith('/releases') ? { status: 200, body: Buffer.from('<html>') } : null);
    const got = await call(['--dry-run'], state, work);
    assert.deepEqual([got.code, got.stderr], [1, 'updater: failed: the answer to /repos/gearsnlevers/record-keeper/releases?per_page=30 is not JSON\n']);
    state.fault = (entry) => (entry.path.endsWith('/releases') ? { status: 200, body: Buffer.alloc(9 * 1024 * 1024, 0x20) } : null);
    const large = await call(['--dry-run'], state, work);
    assert.deepEqual([large.code, large.stderr], [1, 'updater: failed: the answer to /repos/gearsnlevers/record-keeper/releases?per_page=30 is larger than the updater takes\n']);
  });

  test('the address of the API may have a path and a slash at the end, and every request is made below that path', async () => {
    const { state, work } = await world({ prefix: '/api/v3', pageSize: 1 });
    for (const suffix of ['/api/v3', '/api/v3/', '/api/v3//']) {
      const before = state.requests.length;
      const got = await call(['--dry-run'], state, work, { token: null, extra: { GITHUB_API_URL: `${state.url}${suffix}` } });
      assert.equal(got.code, 0, `${suffix}: ${got.stderr}`);
      const made = state.requests.slice(before);
      assert.ok(made.length >= 5, 'the pages and the files were asked for');
      assert.ok(made.every((r) => r.original.startsWith('/api/v3/repos/') || r.original.startsWith('/api/v3/blob/')), made.map((r) => r.original).join(' '));
      assert.ok(made.every((r) => !r.original.includes('//')), 'no double slash');
    }
  });

  test('the address of the API must be https, or plain http for this machine, with no credentials', async () => {
    const { state, work } = await world();
    for (const address of ['http://example.com', 'http://localhost.example.com', 'http://127.0.0.2', 'ftp://127.0.0.1', 'https://user:pw@example.com', 'https://user@example.com', 'https://:pw@example.com', 'http://user@127.0.0.1', 'https://example.com?x=1',
      'https://example.com#x', 'https://example.com/api?x', 'https://example.com/api#', 'not an address']) {
      const got = await runCli(['--dry-run'], { GITHUB_API_URL: address }, { cwd: work, fetch: guardedFetch, gitEnv: GIT_ENV });
      assert.equal(got.code, 1, address);
      assert.match(got.stderr, /^updater: failed: GITHUB_API_URL (is not an address|must be an https address)/, address);
    }
    assert.equal(state.requests.length, 0);
    const localhost = await runCli(['--dry-run'], { GITHUB_API_URL: 'http://localhost:9' }, { cwd: work, fetch: guardedFetch, sleep: async () => {}, gitEnv: GIT_ENV });
    assert.match(localhost.stderr, /^updater: failed: GET \/repos\/gearsnlevers\/record-keeper\/releases\?per_page=30 failed: /, 'localhost is a place for plain http, and the request was tried');
  });

  test('the repository of a run in Actions must be owner/name', async () => {
    const { state, work } = await world();
    for (const repo of [undefined, '', 'o', 'o/r/x', '../x', 'o/..', 'o r/x']) {
      const got = await runCli([], { GITHUB_API_URL: state.url, GITHUB_REPOSITORY: repo, RECORD_KEEPER_TOKEN: TOKEN }, { cwd: work, fetch: guardedFetch, gitEnv: GIT_ENV });
      assert.deepEqual([got.code, got.stderr], [1, 'updater: failed: GITHUB_REPOSITORY must be owner/name\n'], String(repo));
    }
    assert.equal(state.requests.length, 0);
  });
});

// ---- the first adoption ------------------------------------------------------------------------------------------------------------------------------

/** A release made of the files of this repository, as the release workflow would make it, with the manifest of tools/build-release-manifest.mjs. */
function releaseOfTheKit(state, tag) {
  const commit = commitOf(tag);
  const manifest = buildManifest({ root, version: tag.slice(1), tag, commit });
  const record = { tag, draft: false, prerelease: tag.includes('-'), body: `The kit ${tag}.`, commit, manifest: canonical(manifest), assetId: (state.nextAsset += 1), served: new Map(install.files.map((file) => [file.source, fs.readFileSync(path.join(root, file.source))])) };
  state.releases.push(record);
  state.contents.set(commit, record.served);
  state.refs.set(tag, { type: 'commit', sha: commit });
  return record;
}
const exec = (args, { cwd, env: environment }) => new Promise((resolve) => {
  const child = spawn(process.execPath, args, { cwd, env: { ...CLEAN, HOME: scratch, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...environment } });
  const out = [];
  const err = [];
  child.stdout.on('data', (chunk) => out.push(chunk));
  child.stderr.on('data', (chunk) => err.push(chunk));
  child.on('close', (code) => resolve({ code, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() }));
});

describe('the first adoption, with --local', () => {
  test('writes the files of the release and the pin into a repository that has nothing, and the rules run in it', async () => {
    const state = await github();
    releaseOfTheKit(state, 'v1.0.0');
    const work = folder('adopt');
    git(work, 'init', '-q', '-b', 'main');
    write(work, 'README.md', '# A repository\n');
    // the owners first, as the page says, and the updater is run from a copy that is not in the repository
    write(work, '.github/record-keeper/settings.yml', 'owners: [alice/1001]\napprovals: 1\n');
    const bootstrap = path.join(folder('bootstrap'), 'updater.mjs');
    fs.copyFileSync(program, bootstrap);
    const ran = await exec([bootstrap, '--local', '--source', 'gearsnlevers/record-keeper', '--target', 'v1.0.0'], { cwd: work, env: { GITHUB_API_URL: state.url } });
    assert.equal(ran.code, 0, ran.stderr);
    assert.equal(ran.stderr, '');
    const managed = install.files.filter((file) => file.kind === 'managed');
    for (const file of managed) assert.ok(fs.readFileSync(path.join(work, file.path)).equals(fs.readFileSync(path.join(root, file.source))), file.path);
    assert.equal(fs.readFileSync(path.join(work, '.github/record-keeper/settings.yml'), 'utf8'), 'owners: [alice/1001]\napprovals: 1\n', 'the settings of the owners are kept');
    assert.ok(fs.readFileSync(path.join(work, 'docs/decisions/README.md')).equals(fs.readFileSync(path.join(root, 'templates/decisions/README.md'))));
    assert.ok(fs.readFileSync(path.join(work, 'docs/decisions/template.md')).equals(fs.readFileSync(path.join(root, 'templates/decisions/template.md'))));
    assert.equal(fs.readFileSync(path.join(work, PIN_PATH), 'utf8'), pinOf('v1.0.0', commitOf('v1.0.0')));
    assert.match(ran.stdout, new RegExp(`^update \\(nothing installed\\) to v1\\.0\\.0 \\(stable\\)\\n(?:  [^\\n]+\\n)+${managed.length} files to add, 0 to change, 0 to remove, 2 templates to install, 0 local changes overwritten\\nwrote ${managed.length + 2} files, removed 0 and wrote the pin \\.github/record-keeper\\.yml\\n$`));
    assert.deepEqual(fs.readdirSync(path.join(work, '.github')).sort(), ['record-keeper', 'record-keeper.yml', 'workflows']);
    assert.deepEqual(fs.readdirSync(path.join(work, '.github/record-keeper')).filter((name) => name.includes('updating')), [], 'no temporary file is left');
    assert.ok(!fs.existsSync(path.join(work, 'record-keeper.mjs')), 'nothing at the root');
    // the rules that were written are the rules of the kit: validate runs clean in the result, from where they were put
    const validate = await exec(['.github/record-keeper/record-keeper.mjs', 'validate'], { cwd: work, env: {} });
    assert.deepEqual([validate.code, validate.stdout, validate.stderr], [0, 'docs/decisions: 0 problems\n', '']);
    // and the updater that was put there is the one that ran, so a second run says that nothing differs
    assert.ok(fs.readFileSync(path.join(work, '.github/record-keeper/updater.mjs')).equals(fs.readFileSync(program)));
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'Adopt Record Keeper v1.0.0');
    const again = await exec(['.github/record-keeper/updater.mjs', '--dry-run'], { cwd: work, env: { GITHUB_API_URL: state.url } });
    assert.deepEqual([again.code, again.stdout], [0, 'current: v1.0.0 is the newest stable release of gearsnlevers/record-keeper\n']);
    const repair = await exec(['.github/record-keeper/updater.mjs', '--dry-run', '--target', 'v1.0.0'], { cwd: work, env: { GITHUB_API_URL: state.url } });
    assert.deepEqual([repair.code, repair.stdout], [0, 'unchanged: v1.0.0 is installed and nothing differs\ndry run: nothing was written\n']);
  });

  test('works in a repository that has no git at all, takes the newest stable release without a target, and installs the settings when there are none', async () => {
    const state = await github();
    releaseOfTheKit(state, 'v1.0.0');
    releaseOfTheKit(state, 'v1.1.0-1');
    const work = folder('adopt');
    const got = await call(['--local', '--source', 'gearsnlevers/record-keeper'], state, work, { token: null });
    assert.equal(got.code, 0, got.stderr);
    assert.equal(fs.readFileSync(path.join(work, PIN_PATH), 'utf8'), pinOf('v1.0.0', commitOf('v1.0.0')));
    assert.ok(fs.existsSync(path.join(work, '.github/record-keeper/settings.yml')));
    assert.match(fs.readFileSync(path.join(work, '.github/record-keeper/settings.yml'), 'utf8'), /^# folder: docs\/decisions/m);
  });

  test('a first adoption of a prerelease with its channel, which the later runs keep', async () => {
    const state = await github();
    releaseOfTheKit(state, 'v1.0.0-1');
    const work = folder('adopt');
    const got = await call(['--local', '--source', 'gearsnlevers/record-keeper', '--channel', 'prerelease'], state, work, { token: null });
    assert.equal(got.code, 0, got.stderr);
    assert.equal(fs.readFileSync(path.join(work, PIN_PATH), 'utf8'), pinOf('v1.0.0-1', commitOf('v1.0.0-1'), 'prerelease'));
    releaseOfTheKit(state, 'v1.0.0-2');
    const next = await call(['--dry-run'], state, work, { token: null });
    assert.match(next.stdout, /^update v1\.0\.0-1 to v1\.0\.0-2 \(prerelease\)\n/);
  });

  test('--local on a repository that has a pin is an update by hand: the files are replaced, removed ones are removed, and the pin moves', async () => {
    const { state, work } = await world();
    const got = await call(['--local'], state, work, { token: null });
    assert.equal(got.code, 0, got.stderr);
    assert.match(got.stdout, /wrote 4 files, removed 1 and wrote the pin/);
    assert.equal(fs.readFileSync(path.join(work, '.github/record-keeper/updater.mjs'), 'utf8'), '// updater 2\n');
    assert.ok(!fs.existsSync(path.join(work, '.github/record-keeper/check-pull-request.mjs')));
    assert.equal(fs.readFileSync(path.join(work, PIN_PATH), 'utf8'), pinOf('v1.1.0'));
    assert.equal(fs.readFileSync(path.join(work, 'docs/decisions/README.md'), 'utf8'), '# Decision records\n');
    assert.equal(git(work, 'status', '--porcelain', '--untracked-files=all').split('\n').length, 6);
    assert.equal(writes(state).length, 0);
    assert.equal(git(work, 'symbolic-ref', '--short', 'HEAD'), 'main');
  });

  test('a write that fails is a failure of the run in one line, with nothing written before it', { skip: process.getuid?.() === 0 }, async () => {
    const state = await github();
    releaseOfTheKit(state, 'v1.0.0');
    const work = folder('adopt');
    fs.mkdirSync(path.join(work, '.github/record-keeper'), { recursive: true });
    fs.chmodSync(path.join(work, '.github/record-keeper'), 0o555);
    try {
      const got = await call(['--local', '--source', 'gearsnlevers/record-keeper'], state, work, { token: null });
      assert.equal(got.code, 1);
      assert.equal(got.stdout.includes('wrote'), false);
      assert.match(got.stderr, /^updater: failed: (open|mkdir) [^\n]*\.github\/record-keeper\/[a-z-]+\.mjs\.updating-\d+ failed: EACCES\n$/);
      assert.ok(!fs.existsSync(path.join(work, PIN_PATH)), 'the pin is written last');
    } finally {
      fs.chmodSync(path.join(work, '.github/record-keeper'), 0o755);
    }
  });

  test('a template that is there is kept, in whatever form it is: a file, a folder, a link', async () => {
    const state = await github();
    releaseOfTheKit(state, 'v1.0.0');
    const work = folder('adopt');
    write(work, 'docs/decisions/README.md', 'my own\n');
    fs.mkdirSync(path.join(work, 'docs/decisions/template.md'), { recursive: true });
    write(work, '.github/record-keeper/settings.yml', 'x\n');
    fs.rmSync(path.join(work, '.github/record-keeper/settings.yml'));
    fs.symlinkSync('/nonexistent', path.join(work, '.github/record-keeper/settings.yml'));
    const got = await call(['--local', '--source', 'gearsnlevers/record-keeper'], state, work, { token: null });
    assert.equal(got.code, 0, got.stderr);
    assert.equal(fs.readFileSync(path.join(work, 'docs/decisions/README.md'), 'utf8'), 'my own\n');
    assert.ok(fs.statSync(path.join(work, 'docs/decisions/template.md')).isDirectory());
    assert.equal(fs.readlinkSync(path.join(work, '.github/record-keeper/settings.yml')), '/nonexistent');
  });

  test('files of the kit that are there already, by hand, are replaced, and reported as nothing special', async () => {
    const state = await github();
    releaseOfTheKit(state, 'v1.0.0');
    const work = folder('adopt');
    write(work, '.github/record-keeper/record-keeper.mjs', '// by hand\n');
    const got = await call(['--local', '--source', 'gearsnlevers/record-keeper'], state, work, { token: null });
    assert.equal(got.code, 0, got.stderr);
    assert.match(got.stdout, /  change \.github\/record-keeper\/record-keeper\.mjs\n/);
    assert.match(got.stdout, /0 local changes overwritten/);
    assert.ok(fs.readFileSync(path.join(work, '.github/record-keeper/record-keeper.mjs')).equals(fs.readFileSync(path.join(root, 'record-keeper.mjs'))));
  });

  test('without --source and without a pin it is refused, and a source that is not owner/name is wrong usage', async () => {
    const state = await github();
    const work = folder('adopt');
    const got = await call(['--local'], state, work, { token: null });
    assert.deepEqual([got.code, got.stderr], [1, 'updater: refused: there is no pin and no --source: the first adoption names the source repository\n']);
    const bad = await call(['--local', '--source', 'record-keeper'], state, work, { token: null });
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /^Usage:/);
    assert.equal(state.requests.length, 0);
  });

  test('an empty list of releases, and a release that is gone: a first adoption has nothing to install', async () => {
    const state = await github();
    const work = folder('adopt');
    const got = await call(['--local', '--source', 'gearsnlevers/record-keeper'], state, work, { token: null });
    assert.deepEqual([got.code, got.stderr], [1, 'updater: refused: there is no usable release of stable\n']);
    const target = await call(['--local', '--source', 'gearsnlevers/record-keeper', '--target', 'v9.9.9'], state, work, { token: null });
    assert.deepEqual([target.code, target.stderr], [1, 'updater: refused: there is no release v9.9.9\n']);
    assert.deepEqual(fs.readdirSync(work), []);
  });

  test('a Node.js that is too old for the release is refused before any file is asked for', async () => {
    const state = await github();
    releaseOfTheKit(state, 'v1.0.0');
    const work = folder('adopt');
    const got = await call(['--local', '--source', 'gearsnlevers/record-keeper'], state, work, { token: null, node: '20.19.5' });
    assert.deepEqual([got.code, got.stderr], [1, 'updater: refused: this Node.js does not satisfy the range that the release names: >=22\n']);
    assert.ok(!state.requests.some((r) => r.path.includes('/contents/')));
  });
});

// ---- the program as a program ----------------------------------------------------------------------------------------------------------------

describe('the program as a file', () => {
  test('prints the usage, and exits 2, for a command line that is not one; and 1 with nothing to read from', async () => {
    const dir = folder('cli');
    for (const argv of [['--nope'], ['--target'], ['extra'], ['--local', '--local']]) {
      const got = await exec([program, ...argv], { cwd: dir, env: {} });
      assert.deepEqual([got.code, got.stdout], [2, ''], argv.join(' '));
      assert.equal(got.stderr, 'Usage:\n  updater.mjs [--dry-run] [--target <tag>]\n  updater.mjs --local --source <owner/name> [--target <tag>] [--channel stable|prerelease]\n');
    }
    const none = await exec([program, '--dry-run'], { cwd: dir, env: {} });
    assert.deepEqual([none.code, none.stdout, none.stderr], [1, '', 'updater: refused: there is no pin and no --source: the first adoption names the source repository\n']);
  });

  test('runs through a symbolic link, and importing it does nothing', async () => {
    const dir = folder('link');
    fs.symlinkSync(program, path.join(dir, 'u.mjs'));
    const got = await exec([path.join(dir, 'u.mjs'), '--bogus'], { cwd: dir, env: {} });
    assert.equal(got.code, 2);
    const imported = await exec(['--input-type=module', '-e', `const u = await import(${JSON.stringify(program)}); console.log(typeof u.runCli);`], { cwd: dir, env: {} });
    assert.deepEqual([imported.code, imported.stdout, imported.stderr], [0, 'function\n', '']);
  });

  test('is the same file in the kit and in the install set: one source, at the place the page says', () => {
    const entry = install.files.find((file) => file.source === 'updater.mjs');
    assert.deepEqual(entry, { source: 'updater.mjs', path: '.github/record-keeper/updater.mjs', kind: 'managed' });
    assert.equal(sha(fs.readFileSync(program)), sha(fs.readFileSync(path.join(root, entry.source))));
  });
});
