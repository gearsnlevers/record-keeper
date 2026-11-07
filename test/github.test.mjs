// The pull request check (docs/workflow.md): check-pull-request.mjs against a local server that plays GitHub and against real git repositories.
// The repositories are built with `git fast-import`; the work directory is a clone, as it is in the job.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, describe } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CannotRun, checkPullRequest, readNeeds, runCli } from '../check-pull-request.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = path.join(root, 'check-pull-request.mjs');
const change = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/change/cases.json'), 'utf8'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'record-keeper-github-'));
const servers = [];
// Nothing here may reach the network: a request to anything but this machine is a failure of the test.
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

// ---- git ------------------------------------------------------------------------------------------------------------------------------

const CLEAN = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
const git = (cwd, args, input) => {
  const result = spawnSync('git', args, { cwd, input, env: { ...CLEAN, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.toString('utf8').trim();
};
const data = (text) => `data ${Buffer.byteLength(text)}\n${text}\n`;
const treeOf = (list) => new Map(list.map((f) => [f.path, f.content]));
const commitStream = (ref, tree, parent) => {
  const lines = [`commit refs/heads/${ref}\ncommitter T <t@example.com> 0 +0000\n${data('case')}`];
  if (parent) lines.push(`from refs/heads/${parent}\n`);
  lines.push('deleteall\n');
  for (const [file, content] of [...tree].sort((a, b) => (a[0] < b[0] ? -1 : 1))) lines.push(`M 100644 inline ${file}\n${data(content)}`);
  return Buffer.from(lines.join(''));
};

// The base: the fixture tree `owned` with one approval needed. The head: record 0007 is accepted (one act, `accept`).
const SETTINGS = '.github/record-keeper/settings.yml';
const baseTree = treeOf(change.trees.owned);
baseTree.set(SETTINGS, 'owners: [alice/1001, bob/1002]\napprovals: 1\n');
const headTree = new Map(baseTree);
for (const c of change.cases.find((x) => x.id === 'w22-accept-with-owners').changes) headTree.set(c.write, c.content);
// The tree `world` with owners, and three heads of it: an erratum, deviation notes (an issue and a pull request), and both together.
const worldTree = treeOf(change.trees.world);
worldTree.set(SETTINGS, 'owners: [alice/1001, bob/1002]\napprovals: 1\n');
const headOf = (id) => {
  const tree = new Map(worldTree);
  for (const c of change.cases.find((x) => x.id === id).changes) if (c.write !== undefined) tree.set(c.write, c.content);
  return tree;
};

let origin;
let ids;
before(() => {
  origin = path.join(scratch, 'origin.git');
  git(scratch, ['init', '-q', '--bare', origin]);
  const ahead = new Map(baseTree);
  ahead.set('NOTES.txt', 'the base moved on\n');
  git(origin, ['fast-import', '--quiet'], Buffer.concat([
    commitStream('main', baseTree),
    commitStream('release', baseTree),
    commitStream('pr', headTree, 'main'),
    commitStream('moved', ahead, 'main'),
    commitStream('world', worldTree),
    commitStream('erratum', headOf('r01-erratum'), 'world'),
    commitStream('notes', headOf('x10-deviation-two-notes-at-once'), 'world'),
    commitStream('both', headOf('x40-deviation-and-erratum-on-two-records'), 'world'),
  ]));
  ids = Object.fromEntries(['main', 'release', 'pr', 'moved', 'world', 'erratum', 'notes', 'both'].map((name) => [name, git(origin, ['rev-parse', `refs/heads/${name}`])]));
  git(origin, ['update-ref', 'refs/pull/1/head', ids.pr]);
  git(origin, ['update-ref', 'refs/pull/2/head', ids.erratum]);
  git(origin, ['update-ref', 'refs/pull/3/head', ids.notes]);
  git(origin, ['update-ref', 'refs/pull/4/head', ids.both]);
  git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
});

let clones = 0;
/** A fresh clone of a repository (the origin by default), where the check runs. */
function workdir(from = origin) {
  const dir = path.join(scratch, `work-${(clones += 1)}`);
  git(scratch, ['clone', '-q', from, dir]);
  return dir;
}

// ---- the server that plays GitHub -------------------------------------------------------------------------------------------------------

async function serve(handler) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ url: request.url, headers: request.headers });
    const answer = handler(request.url, requests.length, `http://${request.headers.host}`) ?? { status: 404, body: { message: 'Not Found' } };
    response.writeHead(answer.status ?? 200, { 'content-type': 'application/json', ...answer.headers });
    response.end(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

const TOKEN = 'ghs_testtoken1234567890';
const T1 = '2026-11-01T09:00:00Z';
const T2 = '2026-11-02T09:00:00Z';
const T3 = '2026-11-03T09:00:00Z';
const review = (id, user, state, at, commit = ids.pr) => ({ id, user: { id: user, login: 'whoever' }, state, commit_id: commit, submitted_at: at });
const pullBody = (over = {}) => ({ number: 1, state: 'open', head: { sha: ids.pr }, base: { ref: 'main' }, user: { id: 4242 }, ...over });
const filler = (from, count) => Array.from({ length: count }, (_, i) => review(from + i, 5000 + i, 'COMMENTED', T1));

/**
 * GitHub for the repository o/r: `pulls` are the answers to the successive reads of the pull request (the last one repeats) and `pages`
 * the pages of the reviews. The Link header is written the way GitHub writes it, to the path `/repositories/7/...`.
 */
const github = ({ pulls = [pullBody()], pages = [[]], link, number: n = 1, extra } = {}) => {
  let reads = 0;
  return (url, count, origin) => {
    const address = new URL(url, origin);
    const more = extra?.(address, origin);
    if (more) return more;
    if (address.pathname === `/repos/o/r/pulls/${n}`) {
      reads += 1;
      return { body: pulls[Math.min(reads, pulls.length) - 1] };
    }
    if (address.pathname === `/repos/o/r/pulls/${n}/reviews` || address.pathname === `/repositories/7/pulls/${n}/reviews`) {
      const number = Number(address.searchParams.get('page') ?? 1);
      const here = (page) => `${origin}/repositories/7/pulls/${n}/reviews?per_page=100&page=${page}`;
      const parts = [];
      if (number < pages.length) parts.push(`<${here(number + 1)}>; rel="next"`, `<${here(pages.length)}>; rel="last"`);
      if (number > 1) parts.push(`<${here(1)}>; rel="first"`, `<${here(number - 1)}>; rel="prev"`);
      return { body: pages[number - 1], headers: link ? link(number, here, origin) : parts.length ? { link: parts.join(', ') } : {} };
    }
    return null;
  };
};
const play = (options) => serve(github(options));

async function check({ server, cwd = workdir(), number = 1, repo = 'o/r', token = TOKEN, api, now } = {}) {
  const run = await checkPullRequest({ repo, number, token, api: api ?? server.url, cwd, ...(now === undefined ? {} : { now }) });
  assert.ok(!`${run.stdout}${run.stderr}`.includes(token ?? '\0'), 'the token is never printed');
  return run;
}
const cannotRun = (reason) => ({ code: 2, stdout: '', stderr: `Records integrity could not run: ${reason}\n` });

// ---- the happy path and what it reads --------------------------------------------------------------------------------------------------

describe('a pull request that is judged', () => {
  test('an owner approved the head commit: the act is met, exit 0', async () => {
    const server = await play({ pages: [[review(1, 1001, 'APPROVED', T1)]] });
    assert.deepEqual(await check({ server }), { code: 0, stdout: 'approvals: 1 of 1 (alice/1001: approved, bob/1002: none)\ndocs/decisions: 0 problems, 1 act approved\n', stderr: '' });
  });

  test('nobody approved: the act is not met, exit 1, and the output of check-pr is passed on', async () => {
    const server = await play();
    const got = await check({ server });
    assert.equal(got.code, 1);
    assert.equal(got.stdout, '');
    assert.equal(got.stderr, "docs/decisions/0007-seventh.md: needs the owners' approval (accept)\napprovals: 0 of 1 (alice/1001: none, bob/1002: none)\ndocs/decisions: 0 problems, 1 act\n");
  });

  test('the author of the pull request is the live one: an owner who opened it counts', async () => {
    const server = await play({ pulls: [pullBody({ user: { id: 1002 } })] });
    assert.deepEqual(await check({ server }), { code: 0, stdout: 'approvals: 1 of 1 (alice/1001: none, bob/1002: author)\ndocs/decisions: 0 problems, 1 act approved\n', stderr: '' });
  });

  test('the requests carry the token, ask for JSON and for 100 reviews at a time', async () => {
    const server = await play({ pages: [[]] });
    await check({ server });
    assert.deepEqual(server.requests.map((r) => r.url), ['/repos/o/r/pulls/1', '/repos/o/r/pulls/1/reviews?per_page=100', '/repos/o/r/pulls/1']);
    for (const { headers } of server.requests) {
      assert.equal(headers.authorization, `Bearer ${TOKEN}`);
      assert.equal(headers.accept, 'application/vnd.github+json');
      assert.equal(headers['x-github-api-version'], '2022-11-28');
    }
  });

  test('the head and the base are fetched as objects: nothing is checked out and the working tree is not touched', async () => {
    const server = await play({ pages: [[review(1, 1001, 'APPROVED', T1)]] });
    const cwd = workdir();
    const before = git(cwd, ['rev-parse', 'HEAD']);
    await check({ server, cwd });
    assert.equal(git(cwd, ['rev-parse', 'HEAD']), before);
    assert.equal(git(cwd, ['status', '--porcelain']), '');
    assert.ok(!fs.existsSync(path.join(cwd, 'docs/decisions/0007-seventh.md')), 'the file of the pull request is not in the working tree');
    assert.equal(git(cwd, ['rev-parse', 'refs/record-keeper/head']), ids.pr);
    assert.equal(git(cwd, ['rev-parse', 'refs/record-keeper/base']), ids.main);
  });

  test('the pull request is judged against the base branch it names, not against the default branch', async () => {
    const server = await play({ pulls: [pullBody({ base: { ref: 'release' } })], pages: [[review(1, 1001, 'APPROVED', T1)]] });
    const cwd = workdir();
    await check({ server, cwd });
    assert.equal(git(cwd, ['rev-parse', 'refs/record-keeper/base']), ids.release);
  });

  test('the tip of the base branch is the base: a branch that is behind fails (P-09)', async () => {
    // a copy of the origin in which main has moved on after the pull request was cut from it
    const moved = path.join(scratch, 'moved.git');
    git(scratch, ['clone', '-q', '--mirror', origin, moved]);
    git(moved, ['update-ref', 'refs/heads/main', ids.moved]);
    const server = await play({ pages: [[review(1, 1001, 'APPROVED', T1)]] });
    const got = await check({ server, cwd: workdir(moved) });
    assert.equal(got.code, 1);
    assert.match(got.stderr, /\[P-09\]/);
  });
});

// ---- every page of the reviews --------------------------------------------------------------------------------------------------------

describe('the pages of the reviews', () => {
  // 250 reviews in 3 pages: alice approves on the first page and asks for changes, later, on the third
  const pages = () => [
    [review(1, 1001, 'APPROVED', T1), ...filler(10, 99)],
    filler(200, 100),
    [review(900, 1001, 'CHANGES_REQUESTED', T2), ...filler(400, 49)],
  ];

  test('all pages are read: a request for changes on the third page takes the approval of the first back', async () => {
    const server = await play({ pages: pages() });
    const got = await check({ server });
    assert.equal(got.code, 1);
    assert.match(got.stderr, /approvals: 0 of 1 \(alice\/1001: changes, bob\/1002: none\)/);
    assert.deepEqual(server.requests.filter((r) => r.url.includes('/reviews')).map((r) => r.url), [
      '/repos/o/r/pulls/1/reviews?per_page=100',
      '/repositories/7/pulls/1/reviews?per_page=100&page=2',
      '/repositories/7/pulls/1/reviews?per_page=100&page=3',
    ]);
  });

  test('the same reviews without the third page would pass: the page decides', async () => {
    const server = await play({ pages: pages().slice(0, 2) });
    assert.equal((await check({ server })).code, 0);
  });

  test('an approval on the last page counts, and a page may be empty', async () => {
    const server = await play({ pages: [[], [], [review(1, 1001, 'APPROVED', T1)]] });
    assert.equal((await check({ server })).code, 0);
  });

  test('a link with other relations than next (first, prev, last) is read for `next` only', async () => {
    const server = await play({ pages: [[], [], []] });
    const got = await check({ server });
    assert.equal(server.requests.filter((r) => r.url.includes('/reviews')).length, 3);
    assert.equal(got.code, 1);
  });

  test('a relation list that holds next among others is read', async () => {
    const server = await play({
      pages: [[], [review(1, 1001, 'APPROVED', T1)]],
      link: (number, here) => (number === 1 ? { link: `<${here(2)}>; rel="prefetch next"` } : {}),
    });
    assert.equal((await check({ server })).code, 0);
  });

  test('a relation that only contains the word `next` is not a next page', async () => {
    const server = await play({ pages: [[], [review(1, 1001, 'APPROVED', T1)]], link: (number, here) => (number === 1 ? { link: `<${here(2)}>; rel="nextish"` } : {}) });
    const got = await check({ server });
    assert.equal(server.requests.filter((r) => r.url.includes('/reviews')).length, 1);
    assert.equal(got.code, 1);
  });

  test('a link to another server is not followed and the token is not sent there', async () => {
    const elsewhere = await serve(() => ({ body: [] }));
    const server = await play({ pages: [[], []], link: (number) => (number === 1 ? { link: `<${elsewhere.url}/repositories/7/pulls/1/reviews?page=2>; rel="next"` } : {}) });
    assert.deepEqual(await check({ server }), cannotRun('the link to the next page is not the API'));
    assert.equal(elsewhere.requests.length, 0);
  });

  test('a link to a page that was already read ends the run', async () => {
    const server = await play({ pages: [[], []], link: (number, here) => ({ link: `<${here(number === 1 ? 2 : 1)}>; rel="next"` }) });
    assert.deepEqual(await check({ server }), cannotRun('the link to the next page is not the API'));
  });

  test('a link to the page itself ends the run', async () => {
    const server = await play({ pages: [[]], link: (number, here, origin) => ({ link: `<${origin}/repos/o/r/pulls/1/reviews?per_page=100>; rel="next"` }) });
    assert.deepEqual(await check({ server }), cannotRun('the link to the next page is not the API'));
  });

  test('a link that is not an address ends the run', async () => {
    const server = await play({ pages: [[]], link: () => ({ link: '<http://[>; rel="next"' }) });
    assert.deepEqual(await check({ server }), cannotRun('the link to the next page is not the API'));
  });

  test('a link to an address with credentials that starts like the API ends the run', async () => {
    const server = await play({ pages: [[]], link: () => ({ link: `<${server.url.replace('127.0.0.1', '127.0.0.1@evil.example')}/x>; rel="next"` }) });
    assert.deepEqual(await check({ server }), cannotRun('the link to the next page is not the API'));
  });

  test('200 pages are read and 201 are too many', async () => {
    const endless = (count) => (url, n, origin) => {
      const address = new URL(url, origin);
      if (address.pathname === '/repos/o/r/pulls/1') return { body: pullBody() };
      const page = Number(address.searchParams.get('page') ?? 1);
      return { body: [], headers: page < count ? { link: `<${origin}/repositories/7/pulls/1/reviews?per_page=100&page=${page + 1}>; rel="next"` } : {} };
    };
    const ok = await serve(endless(200));
    assert.equal((await check({ server: ok })).code, 1);
    assert.equal(ok.requests.filter((r) => r.url.includes('/reviews')).length, 200);
    const many = await serve(endless(201));
    assert.deepEqual(await check({ server: many }), cannotRun('more than 200 pages of reviews'));
    assert.equal(many.requests.filter((r) => r.url.includes('/reviews')).length, 200);
  });

  test('a page that is not a list ends the run', async () => {
    for (const body of [{ message: 'x' }, 'text', 7, null]) {
      const server = await serve((url, n, origin) => (new URL(url, origin).pathname.endsWith('/reviews') ? { body } : { body: pullBody() }));
      assert.deepEqual(await check({ server }), cannotRun('the answer to /repos/o/r/pulls/1/reviews?per_page=100 is not what the check needs'), JSON.stringify(body));
    }
  });

  test('a review that does not fit is check-pr\'s error, exit 2, and the entry is named', async () => {
    const server = await play({ pages: [[review(1, 1001, 'APPROVED', T1), { id: 2, user: { id: 'x' }, state: 'APPROVED', commit_id: ids.pr, submitted_at: T1 }]] });
    const got = await check({ server });
    assert.equal(got.code, 2);
    assert.match(got.stderr, /entry 2/);
  });
});

// ---- what the API says ----------------------------------------------------------------------------------------------------------------

describe('what GitHub answers', () => {
  test('anything but 200 ends the run, and names the status and the path', async () => {
    for (const status of [201, 204, 401, 403, 404, 422, 500, 502]) {
      const server = await serve(() => ({ status, body: { message: 'no' } }));
      assert.deepEqual(await check({ server }), cannotRun(`GET /repos/o/r/pulls/1 answered ${status}`));
    }
  });

  test('a failure on the second page of the reviews names the page', async () => {
    const server = await serve((url, n, origin) => {
      const address = new URL(url, origin);
      if (address.pathname === '/repos/o/r/pulls/1') return { body: pullBody() };
      if (address.searchParams.get('page') === '2') return { status: 502, body: {} };
      return { body: [], headers: { link: `<${origin}/repositories/7/pulls/1/reviews?per_page=100&page=2>; rel="next"` } };
    });
    assert.deepEqual(await check({ server }), cannotRun('GET /repositories/7/pulls/1/reviews?per_page=100&page=2 answered 502'));
  });

  test('an answer that is not JSON ends the run', async () => {
    const server = await serve(() => ({ body: '<html>' }));
    assert.deepEqual(await check({ server }), cannotRun('the answer to /repos/o/r/pulls/1 is not what the check needs'));
  });

  test('a redirect is not followed and the token is not sent on', async () => {
    const elsewhere = await serve(() => ({ body: pullBody() }));
    const server = await serve(() => ({ status: 301, headers: { location: `${elsewhere.url}/x` }, body: {} }));
    const got = await check({ server });
    assert.equal(got.code, 2);
    assert.match(got.stderr, /^Records integrity could not run: GET \/repos\/o\/r\/pulls\/1 failed: /);
    assert.equal(elsewhere.requests.length, 0);
  });

  test('a server that is not there ends the run', async () => {
    const got = await check({ api: 'http://127.0.0.1:1' });
    assert.equal(got.code, 2);
    assert.match(got.stderr, /^Records integrity could not run: GET \/repos\/o\/r\/pulls\/1 failed: .+\n$/);
  });

  test('a server that does not answer ends the run when the time is up', async () => {
    const silent = http.createServer(() => {});
    await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
    servers.push(silent);
    const got = await checkPullRequest({ repo: 'o/r', number: 1, token: TOKEN, api: `http://127.0.0.1:${silent.address().port}`, cwd: workdir(), timeout: 100 });
    assert.equal(got.code, 2);
    assert.match(got.stderr, /^Records integrity could not run: GET \/repos\/o\/r\/pulls\/1 failed: .*timeout/i);
  });

  const pulls = {
    'a list': [],
    'no head': pullBody({ head: undefined }),
    'a head that is text': pullBody({ head: 'abc' }),
    'no sha': pullBody({ head: {} }),
    'a short sha': pullBody({ head: { sha: ids.pr.slice(0, 39) } }),
    'an upper-case sha': pullBody({ head: { sha: ids.pr.toUpperCase() } }),
    'a sha that is not hexadecimal': pullBody({ head: { sha: 'g'.repeat(40) } }),
    'a sha of 41 digits': pullBody({ head: { sha: `${ids.pr}0` } }),
    'a number of another pull request': pullBody({ number: 2 }),
    'a number as text': pullBody({ number: '1' }),
    'no state': pullBody({ state: undefined }),
    'a state that is a number': pullBody({ state: 1 }),
    'no base': pullBody({ base: undefined }),
    'an empty base branch': pullBody({ base: { ref: '' } }),
    'a base branch that is a number': pullBody({ base: { ref: 5 } }),
    'a base branch with a line feed': pullBody({ base: { ref: 'ma\nin' } }),
    'a base branch with a control character': pullBody({ base: { ref: 'ma\u0001in' } }),
    'a base branch with a delete character': pullBody({ base: { ref: 'ma\u007fin' } }),
    'a base branch of 256 characters': pullBody({ base: { ref: 'a'.repeat(256) } }),
    'no user': pullBody({ user: undefined }),
    'a user that is text': pullBody({ user: 'alice' }),
    'a user without an id': pullBody({ user: { login: 'alice' } }),
    'an id as text': pullBody({ user: { id: '1001' } }),
    'an id of 0': pullBody({ user: { id: 0 } }),
    'a negative id': pullBody({ user: { id: -4 } }),
    'a fractional id': pullBody({ user: { id: 1.5 } }),
    'an id of 16 digits': pullBody({ user: { id: 1000000000000000 } }),
  };
  for (const [name, body] of Object.entries(pulls)) {
    test(`a pull request with ${name} ends the run`, async () => {
      const server = await serve(() => ({ body }));
      assert.deepEqual(await check({ server }), cannotRun('the answer to /repos/o/r/pulls/1 is not what the check needs'));
    });
  }

  test('a base branch of 255 characters and an id of 15 digits fit (git then says there is no such branch)', async () => {
    const server = await play({ pulls: [pullBody({ base: { ref: 'a'.repeat(255) }, user: { id: 999999999999999 } })] });
    const got = await check({ server });
    assert.equal(got.code, 2);
    assert.match(got.stderr, /^Records integrity could not run: git fetch failed/);
  });

  test('a pull request that is not open ends the run', async () => {
    for (const state of ['closed', 'merged', 'OPEN', '']) {
      const server = await play({ pulls: [pullBody({ state })] });
      assert.deepEqual(await check({ server }), cannotRun('the pull request is not open'), state);
    }
  });

  test('a pull request without an author (a deleted account) ends the run', async () => {
    const server = await play({ pulls: [pullBody({ user: null })] });
    assert.deepEqual(await check({ server }), cannotRun('the pull request has no author'));
  });

  test('a pull request that is closed on the second read ends the run', async () => {
    const server = await play({ pulls: [pullBody(), pullBody({ state: 'closed' })] });
    assert.deepEqual(await check({ server }), cannotRun('the pull request is not open'));
  });
});

// ---- the head moves -------------------------------------------------------------------------------------------------------------------

describe('a pull request that moves while it is read', () => {
  test('another head commit on the second read ends the run', async () => {
    const server = await play({ pulls: [pullBody(), pullBody({ head: { sha: ids.main } })], pages: [[review(1, 1001, 'APPROVED', T1)]] });
    assert.deepEqual(await check({ server }), cannotRun('the head moved'));
  });

  test('another base branch on the second read ends the run', async () => {
    const server = await play({ pulls: [pullBody(), pullBody({ base: { ref: 'release' } })] });
    assert.deepEqual(await check({ server }), cannotRun('the head moved'));
  });

  test('another author on the second read is not a move (an author cannot change)', async () => {
    const server = await play({ pulls: [pullBody(), pullBody({ user: { id: 1 } })], pages: [[review(1, 1001, 'APPROVED', T1)]] });
    assert.equal((await check({ server })).code, 0);
  });

  test('a head commit that git does not hold under refs/pull/N/head ends the run', async () => {
    const server = await play({ pulls: [pullBody({ head: { sha: ids.main } })] });
    assert.deepEqual(await check({ server }), cannotRun('the head moved'));
  });
});

// ---- git ------------------------------------------------------------------------------------------------------------------------------

describe('git', () => {
  test('a pull request that origin does not have ends the run, with the message of git', async () => {
    const server = await serve((url, n, origin) => {
      const address = new URL(url, origin);
      return address.pathname.includes('/pulls/9/reviews') ? { body: [] } : { body: pullBody({ number: 9 }) };
    });
    const got = await check({ server, number: 9 });
    assert.equal(got.code, 2);
    assert.match(got.stderr, /^Records integrity could not run: git fetch failed: /);
  });

  test('a base branch that origin does not have ends the run', async () => {
    const server = await play({ pulls: [pullBody({ base: { ref: 'gone' } })] });
    const got = await check({ server });
    assert.equal(got.code, 2);
    assert.match(got.stderr, /^Records integrity could not run: git fetch failed: /);
  });

  test('a directory that is not a repository ends the run', async () => {
    const server = await play();
    const lonely = fs.mkdtempSync(path.join(scratch, 'lonely-'));
    const got = await check({ server, cwd: lonely });
    assert.equal(got.code, 2);
    assert.match(got.stderr, /^Records integrity could not run: git fetch failed: /);
  });

  test('a message of git is printed without control characters', async () => {
    const server = await play({ pulls: [pullBody({ base: { ref: 'a\u202eb' } })] });
    const got = await check({ server });
    assert.equal(got.code, 2);
    assert.ok(!got.stderr.includes('\u202e'));
  });
});

// ---- the arguments --------------------------------------------------------------------------------------------------------------------

describe('what the check is given', () => {
  test('no token, or one with white space, ends the run before any request', async () => {
    const server = await play();
    for (const token of [undefined, '', 'a b', 'a\nb', ' ']) {
      assert.deepEqual(await checkPullRequest({ repo: 'o/r', number: 1, token, api: server.url }), cannotRun('no token'), JSON.stringify(token));
    }
    assert.equal(server.requests.length, 0);
  });

  test('a repository that is not owner/name ends the run', async () => {
    const server = await play();
    for (const repo of ['o', 'o/r/x', '/r', 'o/', '../r', 'o/..', './r', 'o/.', 'o /r', 'o/r\n', 'o/r?x', 'o/r\u00e9', `o/${'r'.repeat(101)}`, undefined, 7]) {
      assert.deepEqual(await checkPullRequest({ repo, number: 1, token: TOKEN, api: server.url }), cannotRun('repository: must be owner/name'), String(repo));
    }
    assert.equal(server.requests.length, 0);
  });

  test('names with dots, hyphens and underscores are repositories', async () => {
    const server = await serve(() => ({ status: 404, body: {} }));
    for (const repo of ['o/.github', 'my-org/my_repo.js', `${'a'.repeat(100)}/${'b'.repeat(100)}`]) {
      const got = await checkPullRequest({ repo, number: 1, token: TOKEN, api: server.url });
      assert.equal(got.stderr, `Records integrity could not run: GET /repos/${repo}/pulls/1 answered 404\n`);
    }
  });

  test('a number that is not a positive integer of at most 9 digits ends the run', async () => {
    const server = await play();
    for (const number of [0, -1, 1.5, 1e9, NaN, '1', undefined, Number.MAX_SAFE_INTEGER]) {
      assert.deepEqual(await checkPullRequest({ repo: 'o/r', number, token: TOKEN, api: server.url }), cannotRun('pull request number: must be a positive integer of at most 9 digits'), String(number));
    }
    const got = await checkPullRequest({ repo: 'o/r', number: 999999999, token: TOKEN, api: server.url });
    assert.match(got.stderr, /answered 404/);
  });

  test('the API address must be https, or http for the machine itself; no credentials, query or fragment', async () => {
    for (const api of ['', 'api.github.com', 'ftp://api.github.com', 'http://api.github.com', 'http://localhost.example', 'https://u:p@api.github.com', 'https://u@api.github.com', 'https://api.github.com?x=1', 'https://api.github.com#x', 'https://api.github.com/?']) {
      const got = await checkPullRequest({ repo: 'o/r', number: 1, token: TOKEN, api });
      assert.equal(got.code, 2, api);
      assert.match(got.stderr, /^Records integrity could not run: API address: /, api);
    }
  });

  test('an address with a path and a closing slash is used as written, without the slash', async () => {
    const server = await serve((url) => (url === '/api/v3/repos/o/r/pulls/1' ? { body: pullBody({ state: 'closed' }) } : null));
    const got = await check({ api: `${server.url}/api/v3/` });
    assert.deepEqual(got, cannotRun('the pull request is not open'));
  });

  test('http://localhost is accepted too', async () => {
    const server = await serve(() => ({ status: 404, body: {} }));
    const got = await check({ api: server.url.replace('127.0.0.1', 'localhost') });
    assert.match(got.stderr, /answered 404/);
  });
});

// ---- the command line -----------------------------------------------------------------------------------------------------------------

describe('the command line', () => {
  const USAGE = 'Usage:\n  check-pull-request.mjs --repo <owner/name> --pr <number>\n';
  const usage = { code: 2, stdout: '', stderr: USAGE };

  test('wrong usage prints the usage and exits 2', async () => {
    const cases = [[], ['--repo'], ['--repo', 'o/r'], ['--pr', '1'], ['--repo', 'o/r', '--pr'], ['--repo', 'o/r', '--pr', '1', '--pr', '2'], ['--repo', 'o/r', '--repo', 'o/s'], ['--repo', 'o/r', '--pr', '1', 'x'],
      ['--repo', 'o/r', '--pr', '0'], ['--repo', 'o/r', '--pr', '01'], ['--repo', 'o/r', '--pr', '1234567890'], ['--repo', 'o/r', '--pr', '-1'], ['--repo', 'o/r', '--pr', '1.5'], ['--repo', 'o/r', '--pr', ' 1'],
      ['--repo', 'o/r', '--num', '1'], ['--help'], ['--pr', '1', '--repo']];
    for (const argv of cases) assert.deepEqual(await runCli(argv, { GITHUB_TOKEN: TOKEN }), usage, argv.join(' '));
  });

  test('the arguments may come in either order, and the token and the address come from the environment', async () => {
    const server = await play({ pages: [[review(1, 1001, 'APPROVED', T1)]] });
    const cwd = workdir();
    const got = await runCli(['--pr', '1', '--repo', 'o/r'], { GITHUB_TOKEN: TOKEN, GITHUB_API_URL: server.url }, { cwd });
    assert.equal(got.code, 0);
    assert.equal(server.requests[0].headers.authorization, `Bearer ${TOKEN}`);
  });

  test('an empty address in the environment is the default one; no token ends the run', async () => {
    assert.deepEqual(await runCli(['--repo', 'o/r', '--pr', '1'], { GITHUB_API_URL: '' }), cannotRun('no token'));
  });

  test('as a program: the standard output, the error output and the exit status are those of the check', async () => {
    const server = await play({ pages: [[review(1, 1001, 'APPROVED', T1)]] });
    const exec = (args, env) => new Promise((resolve) => {
      const child = spawn(process.execPath, [script, ...args], { cwd: env.cwd, env: { ...CLEAN, ...env.vars } });
      const out = [];
      const err = [];
      child.stdout.on('data', (chunk) => out.push(chunk));
      child.stderr.on('data', (chunk) => err.push(chunk));
      child.on('close', (code) => resolve({ code, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() }));
    });
    const passed = await exec(['--repo', 'o/r', '--pr', '1'], { cwd: workdir(), vars: { GITHUB_TOKEN: TOKEN, GITHUB_API_URL: server.url } });
    assert.deepEqual(passed, { code: 0, stdout: 'approvals: 1 of 1 (alice/1001: approved, bob/1002: none)\ndocs/decisions: 0 problems, 1 act approved\n', stderr: '' });
    const failed = await exec(['--repo', 'o/r', '--pr', '1'], { cwd: workdir(), vars: { GITHUB_TOKEN: TOKEN, GITHUB_API_URL: 'http://127.0.0.1:1' } });
    assert.equal(failed.code, 2);
    assert.equal(failed.stdout, '');
    assert.match(failed.stderr, /^Records integrity could not run: GET \/repos\/o\/r\/pulls\/1 failed: /);
    const wrong = await exec([], { cwd: workdir(), vars: {} });
    assert.deepEqual(wrong, { code: 2, stdout: '', stderr: USAGE });
  });

  test('the program is the same when it is reached through a link', async () => {
    const link = path.join(scratch, 'link.mjs');
    fs.symlinkSync(script, link);
    const got = spawnSync(process.execPath, [link], { env: CLEAN });
    assert.equal(got.status, 2);
    assert.equal(got.stderr.toString(), USAGE);
  });

  test('CannotRun is exported', () => {
    assert.ok(new CannotRun('x') instanceof Error);
  });
});

// ---- what the survivors of the first round of mutation testing showed -------------------------------------------------------------------

describe('the address of the API', () => {
  const stub = (status = 404) => {
    const urls = [];
    return { urls, fetch: async (url) => { urls.push(url); return new Response('{}', { status }); } };
  };

  test('without an address it is GitHub.com, over https', async () => {
    const { urls, fetch } = stub();
    const got = await checkPullRequest({ repo: 'o/r', number: 1, token: TOKEN, fetch });
    assert.deepEqual(urls, ['https://api.github.com/repos/o/r/pulls/1']);
    assert.equal(got.stderr, 'Records integrity could not run: GET /repos/o/r/pulls/1 answered 404\n');
  });

  test('an https address of another server is used, with its path and without the closing slash', async () => {
    for (const api of ['https://ghe.example.com/api/v3/', 'https://ghe.example.com/api/v3', 'https://ghe.example.com/api/v3//']) {
      const { urls, fetch } = stub();
      await checkPullRequest({ repo: 'o/r', number: 1, token: TOKEN, api, fetch });
      assert.deepEqual(urls, ['https://ghe.example.com/api/v3/repos/o/r/pulls/1'], api);
    }
  });

  test('an address that is not one, and one that is not allowed, are named', async () => {
    const { fetch } = stub();
    const notOne = await checkPullRequest({ repo: 'o/r', number: 1, token: TOKEN, api: 'api.github.com', fetch });
    assert.deepEqual(notOne, cannotRun('API address: not an address'));
    for (const api of ['http://api.github.com', 'https://u:p@api.github.com', 'https://u@api.github.com', 'https://api.github.com/?', 'https://api.github.com/#x']) {
      const got = await checkPullRequest({ repo: 'o/r', number: 1, token: TOKEN, api, fetch });
      assert.deepEqual(got, cannotRun('API address: must be an https address without credentials, query or fragment'), api);
    }
  });

  test('the request says who asks', async () => {
    const server = await play();
    await check({ server });
    for (const { headers } of server.requests) assert.equal(headers['user-agent'], 'record-keeper');
  });
});

describe('a request that fails', () => {
  const failing = (error) => async () => { throw error; };
  const run = (error) => checkPullRequest({ repo: 'o/r', number: 1, token: TOKEN, fetch: failing(error) });
  const failed = (why) => cannotRun(`GET /repos/o/r/pulls/1 failed: ${why}`);

  test('names the cause when there is one, else its code, else the error itself', async () => {
    assert.deepEqual(await run(Object.assign(new TypeError('fetch failed'), { cause: new Error('connect ECONNREFUSED 1.2.3.4:443') })), failed('connect ECONNREFUSED 1.2.3.4:443'));
    assert.deepEqual(await run(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(''), { code: 'ENOTFOUND' }) })), failed('ENOTFOUND'));
    assert.deepEqual(await run(new TypeError('fetch failed')), failed('fetch failed'));
    assert.deepEqual(await run(Object.assign(new Error('outer'), { cause: Object.assign(new Error('inner'), { code: 'CODE' }) })), failed('inner'));
  });

  test('says at most 200 characters, and no control characters', async () => {
    assert.deepEqual(await run(new Error('x'.repeat(300))), failed('x'.repeat(200)));
    assert.deepEqual(await run(new Error('x'.repeat(200))), failed('x'.repeat(200)));
    assert.deepEqual(await run(new Error('a\nb\u202ec')), failed('a\\u{a}b\\u{202e}c'));
  });
});

describe('the link to the next page, in the forms GitHub and others write it', () => {
  const second = [[], [review(1, 1001, 'APPROVED', T1)]];
  const followed = async (link) => {
    const server = await play({ pages: second, link: (number, here) => (number === 1 ? { link: link(here(2)) } : {}) });
    const got = await check({ server });
    return { reads: server.requests.filter((r) => r.url.includes('/reviews')).length, code: got.code };
  };

  test('is followed when the relation is next, with or without spaces, alone or in a list', async () => {
    for (const form of [(u) => `<${u}>; rel="next"`, (u) => `<${u}>;rel="next"`, (u) => `<${u}>;   rel="next"`, (u) => `<${u}>; rel="next "`, (u) => `<${u}>; rel=" next"`,
      (u) => `<${u}>; rel="prev next"`, (u) => `<${u}>; rel="next last"`, (u) => `<${u}>; rel="a  next  b"`, (u) => `<x>; rel="last", <${u}>; rel="next"`, (u) => `<${u}>; title="x"; rel="next"`]) {
      assert.deepEqual(await followed(form), { reads: 2, code: 0 }, form('U'));
    }
  });

  test('is not followed when the relation only looks like next', async () => {
    for (const form of [(u) => `<${u}>; rel="nextish"`, (u) => `<${u}>; rel="prenext"`, (u) => `<${u}>; rel="last"`, (u) => `<${u}>; rev="next"`, (u) => `<${u}>; rel=next`, (u) => `<${u}>`, (u) => `<${u}>; title="rel=\"next\""x`, () => '']) {
      assert.deepEqual(await followed(form), { reads: 1, code: 1 }, form('U'));
    }
  });

  test('an empty address is the page itself, which was read: the run ends', async () => {
    const server = await play({ pages: second, link: () => ({ link: '<>; rel="next"' }) });
    assert.deepEqual(await check({ server }), cannotRun('the link to the next page is not the API'));
  });
});

describe('what git is given', () => {
  test('the work directory gets two refs and the objects, and no tags, even when the head commit has one', async () => {
    const tagged = path.join(scratch, 'tagged.git');
    git(scratch, ['clone', '-q', '--mirror', origin, tagged]);
    const server = await play();
    const cwd = workdir(tagged);
    git(tagged, ['tag', 'v1', ids.pr]);
    git(tagged, ['tag', '-a', '-m', 'm', 'v2', ids.main]);
    const before = git(cwd, ['for-each-ref', '--format=%(refname)']).split('\n');
    await check({ server, cwd });
    const after = git(cwd, ['for-each-ref', '--format=%(refname)']).split('\n');
    assert.deepEqual(after.filter((ref) => !before.includes(ref)).sort(), ['refs/record-keeper/base', 'refs/record-keeper/head']);
    assert.deepEqual(before.filter((ref) => !after.includes(ref)), []);
    assert.equal(git(cwd, ['tag']), '');
  });

  test('a message of git is cut at 400 characters', async () => {
    const server = await play();
    const cwd = workdir();
    git(cwd, ['remote', 'set-url', 'origin', `/nonexistent/${'x'.repeat(100)}/${'y'.repeat(100)}/${'z'.repeat(100)}/${'w'.repeat(100)}`]);
    const got = await check({ server, cwd });
    const message = got.stderr.replace(/^Records integrity could not run: /, '').replace(/\n$/, '');
    assert.equal(got.code, 2);
    assert.equal(message.length, 400);
    assert.ok(message.startsWith('git fetch failed: fatal: '));
  });

  test('a repository that keeps its objects under SHA-256 is judged the same', async () => {
    const wide = path.join(scratch, 'wide.git');
    git(scratch, ['init', '-q', '--bare', '--object-format=sha256', wide]);
    git(wide, ['fast-import', '--quiet'], Buffer.concat([commitStream('main', baseTree), commitStream('pr', headTree, 'main')]));
    git(wide, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    const head = git(wide, ['rev-parse', 'refs/heads/pr']);
    assert.equal(head.length, 64);
    git(wide, ['update-ref', 'refs/pull/1/head', head]);
    const server = await play({ pulls: [pullBody({ head: { sha: head } })], pages: [[review(1, 1001, 'APPROVED', T1, head)]] });
    assert.deepEqual(await check({ server, cwd: workdir(wide) }), { code: 0, stdout: 'approvals: 1 of 1 (alice/1001: approved, bob/1002: none)\ndocs/decisions: 0 problems, 1 act approved\n', stderr: '' });
  });

  test('a head commit written with 64 hexadecimal digits of any kind has the shape of an object id; 63 and 65 do not', async () => {
    for (const sha of ['1'.repeat(64), 'a'.repeat(64), 'f0'.repeat(32)]) {
      const server = await play({ pulls: [pullBody({ head: { sha } })] });
      assert.deepEqual(await check({ server }), cannotRun('the head moved'), sha);
    }
    for (const sha of ['1'.repeat(63), 'a'.repeat(65), '1'.repeat(41), 'a'.repeat(39), '1'.repeat(40).replace(/.$/, 'g')]) {
      const server = await play({ pulls: [pullBody({ head: { sha } })] });
      assert.deepEqual(await check({ server }), cannotRun('the answer to /repos/o/r/pulls/1 is not what the check needs'), sha);
    }
  });
});

describe('names and numbers that fit', () => {
  test('a repository may have capitals and digits in both names', async () => {
    const server = await serve(() => ({ status: 404, body: {} }));
    for (const repo of ['Org1/Repo2', 'ORG/Repo9', '9/0', 'A-Z/a_z.js']) {
      const got = await checkPullRequest({ repo, number: 1, token: TOKEN, api: server.url });
      assert.equal(got.stderr, `Records integrity could not run: GET /repos/${repo}/pulls/1 answered 404\n`, repo);
    }
  });

  test('a number of 9 digits is a number for the command line, one of 10 is not', async () => {
    const server = await serve(() => ({ status: 404, body: {} }));
    const got = await runCli(['--repo', 'o/r', '--pr', '999999999'], { GITHUB_TOKEN: TOKEN, GITHUB_API_URL: server.url });
    assert.equal(got.stderr, 'Records integrity could not run: GET /repos/o/r/pulls/999999999 answered 404\n');
    assert.equal((await runCli(['--repo', 'o/r', '--pr', '1000000000'], { GITHUB_TOKEN: TOKEN })).stderr, 'Usage:\n  check-pull-request.mjs --repo <owner/name> --pr <number>\n');
  });

  test('importing the file runs nothing', () => {
    const got = spawnSync(process.execPath, ['--input-type=module', '-e', `import ${JSON.stringify(pathToFileURL(script).href)}`], { env: CLEAN });
    assert.deepEqual({ status: got.status, out: got.stdout.toString(), err: got.stderr.toString() }, { status: 0, out: '', err: '' });
  });
});

// ---- errata and deviation notes: what the program looks up (docs/errata-and-deviations.md) -----------------------------------------------

describe('errata and deviation notes', () => {
  const NOW = Date.parse('2026-11-10T00:00:00Z');
  const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  const run = (started_at, over = {}) => ({ id: 1, name: 'Records integrity', app: { slug: 'github-actions' }, status: 'completed', started_at, ...over });
  /** Pull request `number` with the head `ids[head]`, approved by alice, and the check runs `runs` (pages) for that head. */
  const notes = ({ number, head, runs = [[]], issues = {}, approved = true, extra } = {}) => github({
    number,
    pulls: [pullBody({ number, head: { sha: ids[head] }, base: { ref: 'world' } })],
    pages: [approved ? [review(1, 1001, 'APPROVED', T1, ids[head])] : []],
    extra: (address, origin) => {
      const given = extra?.(address, origin);
      if (given) return given;
      if (address.pathname === `/repos/o/r/commits/${ids[head]}/check-runs`) {
        const page = Number(address.searchParams.get('page') ?? 1);
        const headers = page < runs.length ? { link: `<${origin}/repos/o/r/commits/${ids[head]}/check-runs?check_name=Records%20integrity&filter=all&per_page=100&page=${page + 1}>; rel="next"` } : {};
        return { body: { total_count: 1, check_runs: runs[page - 1] }, headers };
      }
      const issue = /^\/repos\/o\/r\/issues\/(\d+)$/.exec(address.pathname);
      if (issue) return issues[issue[1]] ?? { status: 404, body: { message: 'Not Found' } };
      return null;
    },
  });
  const go = async (options, extra = {}) => {
    const server = await serve(notes(options));
    return { got: await check({ server, number: options.number, now: () => NOW, ...extra }), server };
  };
  const ERRATUM = { number: 2, head: 'erratum' };
  const mentions = (server, part) => server.requests.filter(({ url }) => url.includes(part));

  test('an erratum that has been open for three days is met by the approval', async () => {
    const { got, server } = await go({ ...ERRATUM, runs: [[run(hoursAgo(72)), run(hoursAgo(1))]] });
    assert.deepEqual(got, { code: 0, stdout: 'approvals: 1 of 1 (alice/1001: approved, bob/1002: none)\ndocs/decisions: 0 problems, 1 act approved\n', stderr: '' });
    const asked = mentions(server, '/check-runs');
    assert.equal(asked.length, 1);
    assert.equal(asked[0].url, `/repos/o/r/commits/${ids.erratum}/check-runs?check_name=Records%20integrity&filter=all&per_page=100`);
    assert.equal(asked[0].headers.authorization, `Bearer ${TOKEN}`);
  });

  test('an erratum of one hour fails with the hours it has had', async () => {
    const { got } = await go({ ...ERRATUM, runs: [[run(hoursAgo(1))]] });
    assert.equal(got.code, 1);
    assert.match(got.stderr, /\[P-13\] .*\(1h of 48h\)\n/);
  });

  test('the earliest run counts, in any order and on any page; other names, other apps and runs that never began do not', async () => {
    const early = run(hoursAgo(100));
    const others = [run(hoursAgo(200), { name: 'Test (Node 22)' }), run(hoursAgo(300), { app: { slug: 'someone-else' } }), run(hoursAgo(400), { app: null }), run(null, { status: 'queued' })];
    for (const runs of [[[run(hoursAgo(2)), early, ...others]], [[run(hoursAgo(2)), ...others], [early]], [[early], [run(hoursAgo(2)), ...others]]]) {
      const { got } = await go({ ...ERRATUM, runs });
      assert.equal(got.code, 0, JSON.stringify(runs).slice(0, 80));
    }
    const { got } = await go({ ...ERRATUM, runs: [[run(hoursAgo(3)), ...others]] });
    assert.match(got.stderr, /\(3h of 48h\)/);
  });

  test('no run listed counts as no time at all', async () => {
    const { got } = await go({ ...ERRATUM, runs: [[]] });
    assert.match(got.stderr, /\(0h of 48h\)/);
    const { got: nameless } = await go({ ...ERRATUM, runs: [[run(hoursAgo(100), { name: 'Other' })]] });
    assert.match(nameless.stderr, /\(0h of 48h\)/);
  });

  test('the clock of the process is the default for now', async () => {
    const server = await serve(notes({ ...ERRATUM, runs: [[run(new Date(Date.now() - 72 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, 'Z'))]] }));
    assert.equal((await check({ server, number: 2 })).code, 0);
    const fresh = await serve(notes({ ...ERRATUM, runs: [[]] }));
    assert.match((await check({ server: fresh, number: 2 })).stderr, /\(0h of 48h\)/);
  });

  test('a list of check runs that does not fit ends the run', async () => {
    const bad = [
      { total_count: 0 }, [], 'x', { check_runs: {} }, { check_runs: [null] }, { check_runs: ['x'] }, { check_runs: [{ started_at: hoursAgo(1) }] },
      { check_runs: [{ name: 'Records integrity', started_at: 'yesterday' }] }, { check_runs: [{ name: 'Records integrity', started_at: 5 }] },
      { check_runs: [{ name: 'Records integrity', started_at: '2026-11-09T00:00:00.000Z' }] }, { check_runs: [{ name: 'Records integrity', started_at: hoursAgo(1), app: 'x' }] },
      { check_runs: [{ name: 5, started_at: hoursAgo(1) }] },
    ];
    for (const body of bad) {
      const server = await serve(notes({ ...ERRATUM, extra: (address) => (address.pathname.endsWith('/check-runs') ? { body } : null) }));
      const got = await check({ server, number: 2, now: () => NOW });
      assert.equal(got.code, 2, JSON.stringify(body));
      assert.match(got.stderr, /^Records integrity could not run: the answer to \/repos\/o\/r\/commits\/[0-9a-f]{40}\/check-runs\?check_name=Records%20integrity&filter=all&per_page=100 is not what the check needs\n$/, JSON.stringify(body));
    }
  });

  test('check runs that cannot be read end the run: an error, a redirect, a link to another place', async () => {
    const failing = (answer) => notes({ ...ERRATUM, extra: (address) => (address.pathname.endsWith('/check-runs') ? answer : null) });
    const server500 = await serve(failing({ status: 500, body: {} }));
    assert.match((await check({ server: server500, number: 2, now: () => NOW })).stderr, /^Records integrity could not run: GET \/repos\/o\/r\/commits\/[0-9a-f]{40}\/check-runs\?[^ ]+ answered 500\n$/);
    const redirect = await serve(failing({ status: 302, headers: { location: 'https://example.com/' }, body: {} }));
    assert.match((await check({ server: redirect, number: 2, now: () => NOW })).stderr, /failed: /);
    const elsewhere = await serve(failing({ body: { check_runs: [] }, headers: { link: '<https://example.com/x?page=2>; rel="next"' } }));
    assert.equal((await check({ server: elsewhere, number: 2, now: () => NOW })).stderr, 'Records integrity could not run: the link to the next page is not the API\n');
    const endless = await serve(notes({ ...ERRATUM, extra: (address, origin) => (address.pathname.endsWith('/check-runs') ? { body: { check_runs: [] }, headers: { link: `<${origin}/repos/o/r/commits/${ids.erratum}/check-runs?page=${Number(address.searchParams.get('page') ?? 1) + 1}>; rel="next"` } } : null) }));
    assert.equal((await check({ server: endless, number: 2, now: () => NOW })).stderr, 'Records integrity could not run: more than 200 pages of check runs\n');
  });

  test('a pull request that needs nothing makes no request for it', async () => {
    const server = await play({ pages: [[review(1, 1001, 'APPROVED', T1)]] });
    await check({ server });
    assert.equal(mentions(server, '/check-runs').length + mentions(server, '/issues/').length, 0);
  });

  test('deviation notes: the cases are looked up in the order they are needed, an issue and a pull request by their kind', async () => {
    const issues = { 3: { body: { number: 3 } }, 5: { body: { number: 5, pull_request: { url: 'x' } } } };
    const { got, server } = await go({ number: 3, head: 'notes', issues });
    assert.deepEqual(got, { code: 0, stdout: 'approvals: 1 of 1 (alice/1001: approved, bob/1002: none)\ndocs/decisions: 0 problems, 1 act approved\n', stderr: '' });
    assert.deepEqual(mentions(server, '/issues/').map(({ url }) => url), ['/repos/o/r/issues/3', '/repos/o/r/issues/5']);
    assert.equal(mentions(server, '/check-runs').length, 0);
  });

  test('a case that is the other kind, or absent, or gone, does not resolve', async () => {
    const wrongKind = await go({ number: 3, head: 'notes', issues: { 3: { body: { number: 3, pull_request: {} } }, 5: { body: { number: 5 } } } });
    assert.match(wrongKind.got.stderr, /\[P-14\] .*\(entry 1: case does not resolve\)\n.*\[P-14\] .*\(entry 2: case does not resolve\)\n.*\[P-14\] .*\(entry 3: case does not resolve\)/s);
    const absent = await go({ number: 3, head: 'notes', issues: { 3: { body: { number: 3 } } } });
    assert.match(absent.got.stderr, /\(entry 1: case does not resolve\)/);
    assert.doesNotMatch(absent.got.stderr, /entry 2/);
    assert.match(absent.got.stderr, /\(entry 3: case does not resolve\)/);
    const gone = await go({ number: 3, head: 'notes', issues: { 3: { status: 410, body: { message: 'Gone' } }, 5: { body: { number: 5, pull_request: {} } } } });
    assert.match(gone.got.stderr, /\(entry 2: case does not resolve\)/);
    assert.doesNotMatch(gone.got.stderr, /entry 1|entry 3/);
  });

  test('an answer about a case that does not fit, or an error, ends the run', async () => {
    const bodies = [{ number: 4 }, { number: '3' }, 'x', [], null, { number: 3, pull_request: 'yes' }, { number: 3, pull_request: null }];
    for (const body of bodies) {
      const { got } = await go({ number: 3, head: 'notes', issues: { 3: { body }, 5: { body: { number: 5, pull_request: {} } } } });
      assert.equal(got.code, 2, JSON.stringify(body));
      assert.equal(got.stderr, 'Records integrity could not run: the answer to /repos/o/r/issues/3 is not what the check needs\n', JSON.stringify(body));
    }
    const { got } = await go({ number: 3, head: 'notes', issues: { 3: { status: 500, body: {} } } });
    assert.equal(got.stderr, 'Records integrity could not run: GET /repos/o/r/issues/3 answered 500\n');
    const { got: forbidden } = await go({ number: 3, head: 'notes', issues: { 3: { status: 403, body: {} } } });
    assert.equal(forbidden.stderr, 'Records integrity could not run: GET /repos/o/r/issues/3 answered 403\n');
  });

  test('a pull request with an erratum and a note asks for both', async () => {
    const issues = { 5: { body: { number: 5, pull_request: {} } } };
    const { got, server } = await go({ number: 4, head: 'both', runs: [[run(hoursAgo(72))]], issues });
    assert.equal(got.code, 0, got.stderr);
    assert.deepEqual(mentions(server, '/issues/').map(({ url }) => url), ['/repos/o/r/issues/5']);
    assert.equal(mentions(server, '/check-runs').length, 1);
  });

  test('more than 50 cases are too many to look up', async () => {
    const entries = Array.from({ length: 51 }, (_, i) => `### Deviation ${i + 1}\n\n- date: 2026-11-08\n- case: issue ${i + 1}\n- reason: One.`).join('\n\n');
    const bigTree = new Map(worldTree);
    const second = change.trees.world.find((f) => f.path.endsWith('0002-second.md')).content;
    bigTree.set('docs/decisions/0002-second.md', second.replace('\n## Alternatives considered', `\n## Known deviations\n\n${entries}\n\n## Alternatives considered`));
    const repo = path.join(scratch, 'many-cases.git');
    git(scratch, ['init', '-q', '--bare', repo]);
    git(repo, ['fast-import', '--quiet'], Buffer.concat([commitStream('world', worldTree), commitStream('pr', bigTree, 'world')]));
    git(repo, ['update-ref', 'refs/pull/5/head', git(repo, ['rev-parse', 'refs/heads/pr'])]);
    const head = git(repo, ['rev-parse', 'refs/heads/pr']);
    const server = await serve(github({ number: 5, pulls: [pullBody({ number: 5, head: { sha: head }, base: { ref: 'world' } })] }));
    const got = await check({ server, number: 5, cwd: workdir(repo), now: () => NOW });
    assert.equal(got.stderr, 'Records integrity could not run: more than 50 cases to look up\n');
    assert.equal(mentions(server, '/issues/').length, 0);
  });

  test('what record-keeper needs prints is read strictly', () => {
    assert.deepEqual(readNeeds(''), { cited: [], clock: false });
    assert.deepEqual(readNeeds('case issue 3\ncase pull 5\nclock\n'), { cited: [{ kind: 'issue', number: 3 }, { kind: 'pull', number: 5 }], clock: true });
    assert.deepEqual(readNeeds('clock\n').clock, true);
    for (const bad of ['case issue 0\n', 'case issue 05\n', 'case commit 3\n', 'case issue 3 \n', 'Clock\n', 'case  issue 3\n', 'x\n', 'case issue 1234567890\n']) {
      assert.throws(() => readNeeds(bad), (error) => error instanceof CannotRun && error.message === 'record-keeper needs printed something that is not a need', bad);
    }
    const many = Array.from({ length: 51 }, (_, i) => `case issue ${i + 1}\n`).join('');
    assert.throws(() => readNeeds(many), (error) => error.message === 'more than 50 cases to look up');
    assert.equal(readNeeds(many.split('\n').slice(0, 50).join('\n')).cited.length, 50);
  });
});
