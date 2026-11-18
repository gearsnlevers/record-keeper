// The setup check at work, the reads of GitHub (docs/setup-check.md): which requests the runner makes and in which order, what each answer becomes, and what each way for
// a read to fail becomes, against a local server that plays GitHub with the shapes of the real answers. The working tree is the one of a repository that is as it
// should be, so every finding here is made by what GitHub says. Nothing reaches the network.
import assert from 'node:assert/strict';
import test, { after, describe } from 'node:test';
import {
  CHECK, COMMIT, FILES, NOW, REQUIRES, SECRET, TOKEN, branchByProtection, branchByRuleset, check, cleanUp, commitOf, hoursAgo, installed, lastRunText, others, reads, releaseOf, requiring, ruleset, serve, tree, healthy, write,
} from './setup-check-world.mjs';

after(cleanUp);

/** A world in which nothing is wrong, served, with its working tree. `change` may change the state before it is served. */
async function world(change) {
  const state = healthy();
  if (change) change(state);
  await serve(state);
  return { state, dir: tree() };
}
const ALL = ['settings', 'owners', 'owner-accounts', 'codeowners', 'check-required', 'check-strict', 'bypass', 'pin', 'manifest', 'managed-files', 'secret', 'audit-workflow', 'audit'];
const without = (...topics) => ALL.filter((topic) => !topics.includes(topic));

describe('what is asked of GitHub, and how', () => {
  test('a repository in which nothing is wrong: nine reads in this order, and no finding', async () => {
    const { state, dir } = await world();
    const got = await check(state, dir);
    assert.equal(got.stderr, '');
    assert.equal(got.code, 0);
    assert.deepEqual(got.found, []);
    assert.deepEqual(got.report.passed, ALL);
    assert.deepEqual(reads(state), [
      'GET /repos/example/repo',
      'GET /repos/example/repo/rules/branches/main?per_page=100',
      'GET /repos/example/repo/branches/main',
      'GET /repos/example/repo/rulesets/4101',
      'GET /user/1001',
      'GET /user/1002',
      'GET /repos/example/kit/releases?per_page=30',
      'GET /repos/example/kit/releases/assets/700',
      'GET /repos/example/repo/contents/last-run.json?ref=record-keeper%2Flog',
    ]);
  });

  test('every request is a GET with the token of the workflow, the version of the API and the name of the program, and no request writes', async () => {
    const { state, dir } = await world();
    await check(state, dir);
    assert.equal(state.requests.length, 9);
    for (const request of state.requests) {
      assert.equal(request.method, 'GET');
      assert.equal(request.authorization, `Bearer ${TOKEN}`, request.path);
      assert.equal(request.apiVersion, '2022-11-28');
      assert.equal(request.userAgent, 'record-keeper-setup-check');
      assert.equal(request.body, '');
    }
    const accept = Object.fromEntries(state.requests.map((request) => [request.path.replace(/^\/repos\/example\/(repo|kit)/, ''), request.accept]));
    assert.equal(accept['/contents/last-run.json'], 'application/vnd.github.raw+json');
    assert.equal(accept['/releases/assets/700'], 'application/octet-stream');
    assert.equal(accept['/rules/branches/main'], 'application/vnd.github+json');
  });

  test('the secret of the updater is never read, never sent and never printed, though it is in the environment', async () => {
    const { state, dir } = await world();
    const got = await check(state, dir, { env: { RECORD_KEEPER_TOKEN: SECRET }, json: false });
    assert.equal(got.code, 0);
    for (const request of state.requests) assert.ok(!JSON.stringify(request.headers).includes(SECRET) && !request.search.includes(SECRET) && !request.path.includes(SECRET));
    assert.ok(!got.stdout.includes(SECRET) && !got.stderr.includes(SECRET));
  });

  test('a run without a token asks all the same, with no authorization', async () => {
    const { state, dir } = await world();
    const got = await check(state, dir, { env: { GITHUB_TOKEN: '' } });
    assert.deepEqual(got.found, []);
    for (const request of state.requests) assert.equal(request.authorization, undefined);
  });

  test('a default branch with a slash in its name is asked for by its parts', async () => {
    const { state, dir } = await world((s) => { s.branch = 'release/next'; s.branchBody = branchByRuleset('release/next'); });
    const got = await check(state, dir);
    assert.deepEqual(got.found, []);
    assert.ok(reads(state).includes('GET /repos/example/repo/rules/branches/release/next?per_page=100'));
    assert.ok(reads(state).includes('GET /repos/example/repo/branches/release/next'));
  });

  test('a default branch that is not a name that the check will put into a request is a repository that was not read', async () => {
    for (const branch of ['a b', 'a?b', 'a#b', '../x', 'a/../x', 'a/./x', 'a//x', '/a', 'a/', '.', '..', 'a..b', 'x'.repeat(201), '']) {
      const { state, dir } = await world((s) => { s.branch = branch; });
      state.fault = (entry) => (entry.path === '/repos/example/repo' ? undefined : { status: 404 });
      const got = await check(state, dir);
      assert.ok(got.found.some((line) => /^not-checked repository: the answer about the repository is not what the check needs$/.test(line)), `${branch}: ${got.found}`);
      assert.equal(reads(state).length > 0 && state.requests.some((request) => /rules\/branches/.test(request.path)), false, branch);
    }
  });

  test('a repository that cannot be read leaves the rest of the check to what does not depend on it: the owners and the release', async () => {
    const { state, dir } = await world();
    state.fault = (entry) => (entry.path === '/repos/example/repo' ? { status: 404, body: { message: 'Not Found' } } : undefined);
    const got = await check(state, dir);
    assert.deepEqual(got.found, ['not-checked repository: GET /repos/example/repo answered 404: {"message":"Not Found"}']);
    assert.deepEqual(got.report.passed, without('check-required', 'check-strict', 'bypass', 'audit-workflow', 'audit'));
    assert.equal(state.requests.some((request) => /\/rules\/|last-run|commits/.test(request.path)), false);
    assert.ok(state.requests.some((request) => request.path === '/user/1001') && state.requests.some((request) => request.path === '/repos/example/kit/releases'));
  });
});

describe('the failures of a read: every one is a notice that says what was not looked at, and no run is made to fail by one', () => {
  // [what is wrong, the route it is wrong at, the topic that says it]
  const routes = [
    ['the repository', (e) => e.path === '/repos/example/repo', 'repository'],
    ['the rules', (e) => e.path.includes('/rules/branches/'), 'rules'],
    ['an account', (e) => e.path === '/user/1002', 'accounts'],
    ['the list of releases', (e) => e.path === '/repos/example/kit/releases', 'release'],
    ['the manifest', (e) => e.path.includes('/releases/assets/'), 'release'],
    ['the record of the audit', (e) => e.path.endsWith('/last-run.json'), 'audit'],
    ['the ruleset', (e) => /\/rulesets\/\d+$/.test(e.path), 'bypass'],
  ];
  const failures = [
    ['answers 403', { status: 403, body: { message: 'Resource not accessible by integration' } }, /answered 403: .*Resource not accessible by integration/],
    ['answers 401', { status: 401, body: { message: 'Bad credentials' } }, /answered 401/],
    ['answers 500, three times', { status: 500, body: { message: 'Server Error' } }, /answered 500/],
    ['answers 429 with no time to wait', { status: 429, body: { message: 'slow down' } }, /answered 429/],
    ['sends the client somewhere else', { status: 302, body: '', headers: { location: 'http://127.0.0.1:9/elsewhere' } }, /answered 302/],
  ];
  for (const [what, matches, topic] of routes) {
    for (const [how, fault, pattern] of failures) {
      // The manifest may be sent on; that is a case of its own.
      if (what === 'the manifest' && fault.status === 302) continue;
      test(`${what} ${how}`, async () => {
        const { state, dir } = await world();
        state.fault = (entry) => (matches(entry) ? fault : undefined);
        const got = await check(state, dir);
        assert.equal(got.code, 0, got.stderr);
        const said = got.report.findings.filter((finding) => finding.code === 'not-checked' && finding.detail.startsWith(`${topic}: `));
        assert.equal(said.length, 1, got.found.join(' | '));
        assert.match(said[0].detail, pattern);
        assert.deepEqual(got.report.findings.filter((finding) => finding.severity !== 'notice'), [], 'a failed read is no warning and no error');
        for (const request of state.requests) assert.ok(request.method === 'GET');
        assert.ok(!got.asked.some((url) => !url.startsWith(state.url)), 'a redirect is never followed');
      });
    }
  }

  test('a failed read of the rules does not make the run fail, and it makes no pass', async () => {
    const { state, dir } = await world();
    state.fault = (entry) => (entry.path.includes('/rules/') ? { status: 403 } : undefined);
    const got = await check(state, dir);
    assert.equal(got.code, 0);
    assert.deepEqual(got.report.passed, without('check-required', 'check-strict', 'bypass'));
    assert.equal(state.requests.filter((request) => /\/rulesets\//.test(request.path)).length, 0, 'the bypass list is asked for through the rules');
  });

  test('a server error that goes away: three attempts are made, with a wait before each other one, and a read that works the second time is a read', async () => {
    const { state, dir } = await world();
    let failures = 0;
    state.fault = (entry) => (entry.path === '/user/1001' && failures++ < 2 ? { status: 502 } : undefined);
    const waits = [];
    const got = await check(state, dir, { sleep: async (ms) => { waits.push(ms); } });
    assert.deepEqual(got.found, []);
    assert.deepEqual(waits, [1000, 2000]);
    assert.equal(state.requests.filter((request) => request.path === '/user/1001').length, 3);
  });

  test('a limit that GitHub asks to wait for is waited for, up to a minute, and a limit that is used up is not', async () => {
    const { state, dir } = await world();
    let asked = 0;
    state.fault = (entry) => (entry.path === '/user/1001' && asked++ < 1 ? { status: 403, headers: { 'retry-after': '3' } } : undefined);
    const waits = [];
    assert.deepEqual((await check(state, dir, { sleep: async (ms) => { waits.push(ms); } })).found, []);
    assert.deepEqual(waits, [3000]);
    const again = await world();
    again.state.fault = (entry) => (entry.path === '/user/1001' ? { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(NOW / 1000) + 600) } } : undefined);
    const used = await check(again.state, again.dir);
    assert.deepEqual(used.found, ['not-checked accounts: alice/1001: GET /user/1001 answered 403: the rate limit is used up and resets at 2026-11-18T12:10:00.000Z; run again later, with a token']);
    assert.equal(again.state.requests.filter((request) => request.path === '/user/1001').length, 1);
    const slow = await world();
    slow.state.fault = (entry) => (entry.path === '/user/1001' ? { status: 429, headers: { 'retry-after': '61' } } : undefined);
    assert.equal((await check(slow.state, slow.dir)).found.length, 1);
    assert.equal(slow.state.requests.filter((request) => request.path === '/user/1001').length, 1, 'a wait of more than a minute is no wait');
  });

  test('an answer that is too large, and an answer that is not JSON, is a read that failed', async () => {
    const { state, dir } = await world();
    state.fault = (entry) => (entry.path.includes('/rules/') ? { status: 200, body: Buffer.alloc(1024 * 1024 + 1, 0x20) } : entry.path === '/user/1001' ? { status: 200, body: 'not json' } : undefined);
    const got = await check(state, dir);
    assert.deepEqual(got.found.map((line) => line.replace(/\d+/g, 'N')), [
      'not-checked accounts: alice/N: the answer to /user/N is not JSON',
      'not-checked rules: the answer to /repos/example/repo/rules/branches/main?per_page=N is larger than the check takes',
    ].sort((a, b) => got.found.findIndex((line) => line.replace(/\d+/g, 'N') === a) - got.found.findIndex((line) => line.replace(/\d+/g, 'N') === b)));
  });

  test('an answer that arrives in pieces with no length is read as it is', async () => {
    const { state, dir } = await world((s) => { s.chunked = true; });
    assert.deepEqual((await check(state, dir)).found, []);
  });

  test('a connection that is refused is a failed read for every read, and nothing makes the run fail', async () => {
    const { state, dir } = await world();
    const got = await check(state, dir, { fetch: () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); } });
    assert.equal(got.code, 0, got.stderr);
    assert.deepEqual(got.report.findings.filter((finding) => finding.severity !== 'notice'), []);
    assert.ok(got.found.some((line) => line.startsWith('not-checked repository: GET /repos/example/repo failed: ECONNREFUSED')), got.found.join(' | '));
    assert.ok(got.found.some((line) => line.startsWith('not-checked accounts: ')));
    assert.ok(got.found.some((line) => line.startsWith('not-checked release: ')));
  });

  test('a read that takes too long is a failed read', async () => {
    const { state, dir } = await world();
    const got = await check(state, dir, { timeout: 50, fetch: (url, init) => (url.endsWith('/user/1001') ? new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason)); }) : globalThis.fetch(url, init)), sleep: async () => {} });
    assert.ok(got.found.some((line) => /^not-checked accounts: alice\/1001: GET \/user\/1001 failed: /.test(line)), got.found.join(' | '));
  });
});

describe('the rules that apply to the default branch', () => {
  test('no rule at all, only rules of other kinds, and rules that require other checks: the check is not required, and the run fails', async () => {
    for (const rules of [[], others(4101), [...others(4101), requiring(4101, { checks: ['Test gate'] })], [...others(4101), requiring(4101, { checks: ['records integrity', 'Records integrity '] })]]) {
      const { state, dir } = await world((s) => { s.rules = rules; });
      const got = await check(state, dir);
      assert.equal(got.code, 1, JSON.stringify(rules));
      assert.deepEqual(got.found.filter((line) => line.startsWith('check-not-required')), ['check-not-required main']);
      assert.deepEqual(got.report.passed, without('check-required', 'check-strict', 'bypass'));
    }
  });

  test('a rule that requires the check but not up to date: a warning, and no failure', async () => {
    const { state, dir } = await world((s) => { s.rules = [...others(4101), requiring(4101, { strict: false })]; });
    const got = await check(state, dir);
    assert.equal(got.code, 0);
    assert.deepEqual(got.found, ['check-not-strict main']);
    assert.deepEqual(got.report.passed, without('check-strict'));
  });

  test('the shape of a check that is tied to an application, an unknown kind of rule, and a rule that is not strict beside one that is', async () => {
    const { state, dir } = await world((s) => {
      const tied = requiring(4101, { strict: false });
      tied.parameters.required_status_checks = [{ context: CHECK, integration_id: 15368 }];
      s.rules = [{ type: 'a_new_kind', parameters: { x: 1 }, ruleset_source_type: 'Repository', ruleset_source: 'example/repo', ruleset_id: 4101 }, tied, requiring(4101, { strict: true })];
    });
    const got = await check(state, dir);
    assert.deepEqual(got.found, []);
    assert.equal(state.requests.filter((request) => request.path.startsWith('/repos/example/repo/rulesets/')).length, 1, 'one ruleset is read once');
  });

  test('rules of two rulesets, as an organisation may add them: both are read for their bypass list, in the order of their numbers', async () => {
    const { state, dir } = await world((s) => {
      s.rules = [...others(4200), requiring(4200, { strict: false }), requiring(4101, { strict: true })];
      s.rulesets.set(4200, ruleset(4200, { name: 'organisation rules', actors: [{ actor_id: 1, actor_type: 'OrganizationAdmin', bypass_mode: 'always' }] }));
    });
    const got = await check(state, dir);
    assert.deepEqual(got.found, ['bypass-always organisation rules: OrganizationAdmin 1, mode always']);
    assert.deepEqual(reads(state).filter((line) => /rulesets/.test(line)), ['GET /repos/example/repo/rulesets/4101', 'GET /repos/example/repo/rulesets/4200']);
  });

  test('a ruleset that requires other checks only is not read for its bypass list', async () => {
    const { state, dir } = await world((s) => { s.rules = [...others(4101), requiring(4101), requiring(4200, { checks: ['Test gate'] })]; });
    assert.deepEqual((await check(state, dir)).found, []);
    assert.deepEqual(reads(state).filter((line) => /rulesets/.test(line)), ['GET /repos/example/repo/rulesets/4101']);
  });

  test('a list that comes in pages is read to its end, with a link that stays on the API', async () => {
    const { state, dir } = await world((s) => { s.rules = [...others(4101), requiring(4101)]; s.pageSize = 1; });
    const got = await check(state, dir);
    assert.deepEqual(got.found, []);
    assert.deepEqual(reads(state).filter((line) => /rules\/branches/.test(line)), [
      'GET /repos/example/repo/rules/branches/main?per_page=100',
      'GET /repos/example/repo/rules/branches/main?per_page=100&page=2',
      'GET /repos/example/repo/rules/branches/main?per_page=100&page=3',
      'GET /repos/example/repo/rules/branches/main?per_page=100&page=4',
    ]);
  });

  test('more than five pages of rules, or a link that leaves the API, or one that goes back: the rules were not read', async () => {
    const many = await world((s) => { s.rules = Array.from({ length: 8 }, (_, id) => requiring(4101 + id, { checks: ['Test gate'] })); s.pageSize = 1; });
    assert.ok((await check(many.state, many.dir)).found.includes('not-checked rules: more than 5 pages of rules'));
    assert.equal(many.state.requests.filter((request) => /rules\/branches/.test(request.path)).length, 5);
    for (const link of ['<http://127.0.0.1:9/x?page=2>; rel="next"', '<http://127.0.0.1:1/repos/example/repo/rules/branches/main>; rel="next"']) {
      const out = await world();
      out.state.fault = (entry) => (entry.path.includes('/rules/') ? { status: 200, body: [], headers: { link } } : undefined);
      assert.deepEqual((await check(out.state, out.dir)).found.filter((line) => line.startsWith('not-checked rules')), ['not-checked rules: the link to the next page is not the API']);
    }
    const loop = await world();
    loop.state.fault = (entry) => (entry.path.includes('/rules/') ? { status: 200, body: [], headers: { link: `<${loop.state.url}/repos/example/repo/rules/branches/main?per_page=100>; rel="next"` } } : undefined);
    assert.deepEqual((await check(loop.state, loop.dir)).found.filter((line) => line.startsWith('not-checked rules')), ['not-checked rules: the link to the next page goes back to a page that was read']);
  });

  test('an answer that is not what the check needs is a read that failed: not a list, an entry that is not an object, a rule that has no checks or no ruleset', async () => {
    const bad = [
      { what: 'an object', body: { message: 'x' } },
      { what: 'an entry that is a text', body: ['x'] },
      { what: 'an entry with no type', body: [{ ruleset_id: 1 }] },
      { what: 'a rule with no parameters', body: [{ type: 'required_status_checks', ruleset_id: 1 }] },
      { what: 'a rule with checks that are not a list', body: [{ type: 'required_status_checks', ruleset_id: 1, parameters: { required_status_checks: 'x' } }] },
      { what: 'a check with no context', body: [{ type: 'required_status_checks', ruleset_id: 1, parameters: { required_status_checks: [{ app: 1 }] } }] },
      { what: 'a rule with no ruleset', body: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: CHECK }] } }] },
      { what: 'a ruleset that is not a number', body: [{ type: 'required_status_checks', ruleset_id: '1', parameters: { required_status_checks: [{ context: CHECK }] } }] },
      { what: 'a ruleset that is 0', body: [{ type: 'required_status_checks', ruleset_id: 0, parameters: { required_status_checks: [{ context: CHECK }] } }] },
    ];
    for (const { what, body } of bad) {
      const { state, dir } = await world();
      state.fault = (entry) => (entry.path.includes('/rules/') ? { status: 200, body } : undefined);
      const got = await check(state, dir);
      assert.deepEqual(got.found.filter((line) => line.startsWith('not-checked rules')), ['not-checked rules: the answer about the rules is not what the check needs'], what);
      assert.equal(got.code, 0, what);
    }
  });
});

describe('branch protection, the older way to require a check', () => {
  const noRuleset = (extra) => (s) => { s.rules = others(4101); Object.assign(s, extra); };

  test('it requires the check and no ruleset does: required, and whether it must be up to date is not known', async () => {
    const { state, dir } = await world(noRuleset({ branchBody: branchByProtection() }));
    const got = await check(state, dir);
    assert.equal(got.code, 0);
    assert.deepEqual(got.found, ['not-checked strict: the check is required by branch protection, and not by a ruleset']);
    assert.deepEqual(got.report.passed, without('check-strict', 'bypass'));
    assert.equal(state.requests.filter((request) => /rulesets/.test(request.path)).length, 0);
  });

  test('it names the check only in `contexts`, or only in `checks`', async () => {
    for (const body of [{ ...branchByProtection(), protection: { enabled: true, required_status_checks: { enforcement_level: 'everyone', contexts: [CHECK], checks: [] } } }, { ...branchByProtection(), protection: { enabled: true, required_status_checks: { enforcement_level: 'everyone', contexts: [], checks: [{ app_id: 1, context: CHECK }] } } }]) {
      const { state, dir } = await world(noRuleset({ branchBody: body }));
      assert.deepEqual((await check(state, dir)).report.passed.includes('check-required'), true);
    }
  });

  test('it requires nothing, requires another check, or is off: the check is not required', async () => {
    for (const branchBody of [branchByRuleset(), branchByProtection('main', ['Test gate']), branchByProtection('main', [CHECK], 'off'), { ...branchByProtection(), protection: { enabled: false, required_status_checks: { enforcement_level: 'everyone', contexts: [CHECK], checks: [] } } }]) {
      const { state, dir } = await world(noRuleset({ branchBody }));
      const got = await check(state, dir);
      assert.equal(got.code, 1, JSON.stringify(branchBody.protection));
      assert.deepEqual(got.found, ['check-not-required main']);
    }
  });

  test('it cannot be read, or is not what the check needs: no ruleset requires the check and that is said', async () => {
    const unread = await world(noRuleset({}));
    unread.state.fault = (entry) => (entry.path === '/repos/example/repo/branches/main' ? { status: 403 } : undefined);
    assert.deepEqual((await check(unread.state, unread.dir)).found, ['check-not-required main; branch protection could not be read']);
    for (const branchBody of [{ name: 'main' }, { protection: 'x' }, { protection: { enabled: 'yes' } }, { protection: { enabled: true } }, { protection: { enabled: true, required_status_checks: { enforcement_level: 'off', contexts: 'x', checks: [] } } }]) {
      const { state, dir } = await world(noRuleset({ branchBody }));
      const got = await check(state, dir);
      assert.equal(got.code, 1, JSON.stringify(branchBody));
      assert.deepEqual(got.found, ['check-not-required main; branch protection could not be read']);
    }
  });

  test('a ruleset that requires the check is enough, whatever the answer about branch protection is', async () => {
    const { state, dir } = await world((s) => { s.branchBody = 'not an object'; });
    state.fault = (entry) => (entry.path === '/repos/example/repo/branches/main' ? { status: 500 } : undefined);
    assert.deepEqual((await check(state, dir)).found, []);
  });
});

describe('who may bypass a ruleset', () => {
  const actors = (...list) => (s) => { s.rulesets.set(4101, ruleset(4101, { actors: list })); };
  const actor = (type, id, mode) => ({ actor_id: id, actor_type: type, bypass_mode: mode });

  test('an actor in the mode always, and one in another mode that is not the mode of a pull request: a warning for each, and no failure', async () => {
    const { state, dir } = await world(actors(actor('RepositoryRole', 5, 'always'), actor('Team', 9, 'exempt'), actor('RepositoryRole', 4, 'pull_request'), actor('DeployKey', null, 'always')));
    const got = await check(state, dir);
    assert.equal(got.code, 0);
    assert.deepEqual(got.found, [
      'bypass-always main protection: RepositoryRole 5, mode always',
      'bypass-always main protection: Team 9, mode exempt',
      'bypass-always main protection: DeployKey without an ID, mode always',
    ]);
    assert.deepEqual(got.report.passed, without('bypass'));
  });

  test('no actor may bypass at all', async () => {
    const { state, dir } = await world(actors());
    assert.deepEqual((await check(state, dir)).found, []);
  });

  test('a token that is shown no list: the field is not there, and that is not a pass', async () => {
    const { state, dir } = await world((s) => { s.rulesets.set(4101, ruleset(4101, { actors: undefined })); });
    const got = await check(state, dir);
    assert.deepEqual(got.found, ['not-checked bypass: ruleset 4101: the token cannot see the bypass list']);
    assert.deepEqual(got.report.passed, without('bypass'));
  });

  test('a ruleset that is not there, or is not what the check needs', async () => {
    const gone = await world((s) => { s.rulesets.delete(4101); });
    assert.match((await check(gone.state, gone.dir)).found[0], /^not-checked bypass: ruleset 4101: GET \/repos\/example\/repo\/rulesets\/4101 answered 404/);
    for (const body of [{ id: 4101 }, { name: 'x', bypass_actors: 'x' }, { name: 'x', bypass_actors: [{ actor_type: 'Team', bypass_mode: 'always', actor_id: '5' }] }, { name: 'x', bypass_actors: [{ actor_type: 'Team', actor_id: 5 }] }, { name: 'x', bypass_actors: ['x'] }, { name: 'x', bypass_actors: [{ actor_type: 'Team', bypass_mode: 'always', actor_id: 0 }] }]) {
      const { state, dir } = await world((s) => { s.rulesets.set(4101, body); });
      assert.deepEqual((await check(state, dir)).found, ['not-checked bypass: ruleset 4101: the answer about the ruleset 4101 is not what the check needs'], JSON.stringify(body));
    }
  });

  test('the name of a ruleset is cut to eighty characters', async () => {
    const { state, dir } = await world(actors(actor('Team', 9, 'always')));
    state.rulesets.get(4101).name = 'n'.repeat(120);
    assert.deepEqual((await check(state, dir)).found, [`bypass-always ${'n'.repeat(80)}: Team 9, mode always`]);
  });

  test('at most ten rulesets are read, and the others are said not to have been', async () => {
    const { state, dir } = await world((s) => {
      s.rules = [];
      for (let id = 5001; id <= 5012; id++) {
        s.rules.push(requiring(id));
        s.rulesets.set(id, ruleset(id));
      }
    });
    const got = await check(state, dir);
    assert.equal(state.requests.filter((request) => /rulesets\//.test(request.path)).length, 10);
    assert.deepEqual(got.found, ['not-checked bypass: ruleset 5011: not read; ruleset 5012: not read']);
  });

  test('a ruleset of an organisation, as the rules name it, is read from the repository', async () => {
    const { state, dir } = await world((s) => { s.rules = [...others(4101), { ...requiring(4101), ruleset_source_type: 'Organization', ruleset_source: 'example' }]; });
    assert.deepEqual((await check(state, dir)).found, []);
    assert.ok(reads(state).includes('GET /repos/example/repo/rulesets/4101'));
  });
});

describe('the accounts of the owners', () => {
  test('a login that is another one, an ID that no account has, and a login that differs in its capitals only', async () => {
    const { state, dir } = await world((s) => { s.users = new Map([[1001, 'carol'], [1002, 'BOB']]); });
    assert.deepEqual((await check(state, dir)).found, ['owner-mismatch alice/1001: GitHub says carol']);
    const gone = await world((s) => { s.users.delete(1002); });
    assert.deepEqual((await check(gone.state, gone.dir)).found, ['owner-mismatch bob/1002: no account has this ID']);
  });

  test('an application has a login with [bot] in it, and is not the owner whose ID it has', async () => {
    const { state, dir } = await world((s) => { s.users.set(1002, 'github-actions[bot]'); });
    assert.deepEqual((await check(state, dir)).found, ['owner-mismatch bob/1002: GitHub says github-actions[bot]']);
  });

  test('an answer that is not what the check needs: a login that is not a login, no login, and the account of another ID', async () => {
    for (const body of [{ login: 'a b', id: 1001 }, { login: 'x\ny', id: 1001 }, { id: 1001 }, { login: 7, id: 1001 }, { login: 'alice', id: 1002 }, { login: 'alice' }, ['alice'], { login: 'a'.repeat(40), id: 1001 }, { login: '-alice', id: 1001 }]) {
      const { state, dir } = await world();
      state.fault = (entry) => (entry.path === '/user/1001' ? { status: 200, body } : undefined);
      assert.deepEqual((await check(state, dir)).found, ['not-checked accounts: alice/1001: the answer about the account 1001 is not what the check needs'], JSON.stringify(body));
    }
  });

  test('more owners than thirty: thirty are asked about, and the others are said not to have been', async () => {
    const { state, dir } = await world((s) => { for (let id = 3000; id < 3033; id++) s.users.set(id, `o${id}`); });
    const owners = Array.from({ length: 33 }, (_, i) => `o${3000 + i}/${3000 + i}`);
    write(dir, '.github/record-keeper/settings.yml', `owners: [${owners.join(', ')}]\napprovals: 2\n`);
    const got = await check(state, dir);
    assert.equal(state.requests.filter((request) => request.path.startsWith('/user/')).length, 30);
    assert.deepEqual(got.found, ['not-checked accounts: 3 more owners']);
  });

  test('no owner, or no settings: nobody is asked about', async () => {
    const { state, dir } = await world();
    write(dir, '.github/record-keeper/settings.yml', 'approvals: 1\n');
    await check(state, dir);
    assert.equal(state.requests.some((request) => request.path.startsWith('/user/')), false);
  });
});

describe('the pinned release', () => {
  test('the manifest is sent on once, to the same server, without the token', async () => {
    const { state, dir } = await world((s) => { s.redirect = true; });
    const got = await check(state, dir);
    assert.deepEqual(got.found, []);
    const blob = state.requests.find((request) => request.path.startsWith('/blob/'));
    assert.ok(blob);
    assert.equal(blob.authorization, undefined);
  });

  test('a manifest that is sent to another host is not followed', async () => {
    const { state, dir } = await world((s) => { s.redirect = 'http://127.0.0.1:9/x'; });
    const got = await check(state, dir);
    assert.deepEqual(got.found, ['not-checked release: the download of the manifest was sent to a place that the updater does not follow: http://127.0.0.1:9/x']);
    assert.ok(!got.asked.some((url) => url.includes(':9/')));
  });

  test('the pinned release is not in the list, is a draft, or its tag is there twice', async () => {
    const lacking = await world((s) => { s.releases = [releaseOf('v1.1.0', FILES, { assetId: 701 })]; });
    assert.deepEqual((await check(lacking.state, lacking.dir)).found, ['manifest-unreadable v1.0.0 is not in the list of releases of example/kit']);
    const draft = await world((s) => { s.releases[0].entry.draft = true; });
    assert.deepEqual((await check(draft.state, draft.dir)).found, ['manifest-unreadable v1.0.0 is not in the list of releases of example/kit']);
    const twice = await world((s) => { s.releases.push(releaseOf('v1.0.0', FILES, { assetId: 701 })); });
    assert.deepEqual((await check(twice.state, twice.dir)).found, ['manifest-unreadable v1.0.0: release-duplicate']);
  });

  test('the pinned release has no manifest asset', async () => {
    const { state, dir } = await world((s) => { s.releases[0].entry.assets = []; });
    assert.deepEqual((await check(state, dir)).found, ['manifest-unreadable v1.0.0 has no release-manifest.json']);
  });

  test('a manifest that the rules of the updater refuse: the refusal is the detail', async () => {
    const refused = [
      ['manifest-tag', { mutate: (m) => { m.tag = 'v9.9.9'; } }],
      ['manifest-commit-moved', { commit: 'b2'.repeat(20), mutate: (m) => { m.commit = 'b2'.repeat(20); } }],
      ['manifest-path', { mutate: (m) => { m.files[0].path = '.github/workflows/evil.yml'; } }],
      ['manifest-schema', { mutate: (m) => { m.schema = 2; } }],
      ['manifest-requires', { mutate: (m) => { m.requires = { secrets: 'x' }; } }],
    ];
    for (const [code, options] of refused) {
      const { state, dir } = await world((s) => { s.releases = [releaseOf('v1.0.0', FILES, options)]; });
      const got = await check(state, dir);
      assert.deepEqual(got.found.filter((line) => line.startsWith('manifest-unreadable')), [`manifest-unreadable v1.0.0: ${code}`], code);
      assert.equal(got.code, 0);
    }
    const notJson = await world((s) => { s.releases[0].text = '{'; });
    assert.deepEqual((await check(notJson.state, notJson.dir)).found, ['manifest-unreadable v1.0.0: manifest-json']);
    const large = await world((s) => { s.releases[0].text = ' '.repeat(1024 * 1024 + 1); });
    assert.deepEqual((await check(large.state, large.dir)).found, ['manifest-unreadable v1.0.0: manifest-large']);
  });

  test('a list of releases in pages: the pinned one is on the third', async () => {
    const { state, dir } = await world((s) => { s.releases = [releaseOf('v1.3.0', FILES, { assetId: 703 }), releaseOf('v1.2.0', FILES, { assetId: 702 }), releaseOf('v1.1.0', FILES, { assetId: 701 }), releaseOf('v1.0.0', FILES, { assetId: 700 })]; s.pageSize = 2; });
    assert.deepEqual((await check(state, dir)).found, []);
    assert.equal(reads(state).filter((line) => /\/releases\?/.test(line)).length, 2);
  });

  test('the release says that up to date is not wanted: a rule that is not strict is fine, and the page that says so is the release\'s', async () => {
    const requires = { ...REQUIRES, rulesets: [{ branch: 'default', checks: [CHECK], 'up-to-date': false }] };
    const { state, dir } = await world((s) => { s.releases = [releaseOf('v1.0.0', FILES, { requires })]; s.rules = [...others(4101), requiring(4101, { strict: false })]; });
    const got = await check(state, dir);
    assert.deepEqual(got.found, []);
    assert.deepEqual(got.report.passed, without('check-strict'));
  });

  test('a release that names no ruleset for the default branch, or none at all: up to date is wanted', async () => {
    for (const rulesets of [[], [{ branch: 'release', checks: [CHECK], 'up-to-date': false }]]) {
      const { state, dir } = await world((s) => { s.releases = [releaseOf('v1.0.0', FILES, { requires: { ...REQUIRES, rulesets } })]; s.rules = [...others(4101), requiring(4101, { strict: false })]; });
      assert.deepEqual((await check(state, dir)).found, ['check-not-strict main']);
    }
  });

  test('a release that does not list the secret: it is not asked for', async () => {
    const { state, dir } = await world((s) => { s.releases = [releaseOf('v1.0.0', FILES, { requires: { ...REQUIRES, secrets: [] } })]; });
    const got = await check(state, dir, { env: { HAS_RECORD_KEEPER_TOKEN: 'false' } });
    assert.deepEqual(got.found, []);
  });

  test('no pin, no read of a release', async () => {
    const { state, dir } = await world();
    const files = installed();
    delete files['.github/record-keeper.yml'];
    const bare = tree(files);
    const got = await check(state, bare);
    assert.deepEqual(got.found, ['pin-missing']);
    assert.equal(state.requests.some((request) => request.path.includes('/example/kit/')), false);
    void dir;
  });
});

describe('the record of the last run of the audit', () => {
  const text = (body) => (s) => { s.lastRun = body; };

  test('it is asked for raw, on the log branch, and what it says is what the audit wrote', async () => {
    const { state, dir } = await world();
    await check(state, dir);
    const request = state.requests.find((item) => item.path.endsWith('/last-run.json'));
    assert.equal(request.accept, 'application/vnd.github.raw+json');
    assert.equal(request.query.get('ref'), 'record-keeper/log');
    assert.equal(request.raw, '/repos/example/repo/contents/last-run.json');
  });

  test('a record that is 48 hours old is alive, and one that is a second older is dead, and the run fails', async () => {
    const alive = await world(text(lastRunText(hoursAgo(48))));
    assert.deepEqual((await check(alive.state, alive.dir)).found, []);
    const dead = await world(text(lastRunText(new Date(NOW - 48 * 3600 * 1000 - 1000).toISOString().replace('.000Z', 'Z'))));
    const got = await check(dead.state, dead.dir);
    assert.equal(got.code, 1);
    assert.deepEqual(got.found, ['audit-dead the last run was at 2026-11-16T11:59:59Z, more than two days ago']);
    assert.deepEqual(got.report.passed, without('audit'));
  });

  test('what else the record says is not read: more keys, fewer keys, a line that does not end', async () => {
    for (const body of [lastRunText(hoursAgo(1), { more: [1, 2], head: null }), `{"at":"${hoursAgo(1)}"}`, `{"at":"${hoursAgo(1)}"}\n\n`, JSON.stringify({ at: hoursAgo(1) }, null, 2)]) {
      const { state, dir } = await world(text(body));
      assert.deepEqual((await check(state, dir)).found, [], body);
    }
  });

  test('a record that is not a record: not JSON, not an object, no time, a time that is not a time', async () => {
    const bad = [
      ['', 'not JSON in UTF-8'], ['{', 'not JSON in UTF-8'], ['nope\n', 'not JSON in UTF-8'], [`\ufeff${lastRunText(hoursAgo(1))}`, 'not JSON in UTF-8'],
      ['[]', 'not an object with an at'], ['null', 'not an object with an at'], ['"2026-11-18T09:00:00Z"', 'not an object with an at'], ['{"head":"x"}', 'not an object with an at'],
      [`{"at":${NOW}}`, 'at is not a UTC time'], ['{"at":null}', 'at is not a UTC time'], ['{"at":"2026-11-18T09:00:00+00:00"}', 'at is not a UTC time'], ['{"at":"2026-02-30T09:00:00Z"}', 'at is not a UTC time'], ['{"at":["2026-11-18T09:00:00Z"]}', 'at is not a UTC time'],
      [`{"at":"${'x'.repeat(70 * 1024)}"}`, 'larger than 64 KiB'],
    ];
    for (const [body, why] of bad) {
      const { state, dir } = await world(text(body));
      const got = await check(state, dir);
      assert.deepEqual(got.found, [`audit-record-unreadable ${why}`], JSON.stringify(body.slice(0, 40)));
      assert.equal(got.code, 0);
      assert.deepEqual(got.report.passed, without('audit'));
    }
  });

  test('bytes that are not UTF-8 are not a record', async () => {
    const { state, dir } = await world();
    state.lastRun = Buffer.from([0x7b, 0x22, 0x61, 0x74, 0x22, 0x3a, 0xff, 0x7d]);
    assert.deepEqual((await check(state, dir)).found, ['audit-record-unreadable not JSON in UTF-8']);
  });

  test('a time in the future is a warning, and five minutes ahead is only the clock of another runner', async () => {
    const ahead = (ms) => new Date(NOW + ms).toISOString().replace('.000Z', 'Z');
    const near = await world(text(lastRunText(ahead(5 * 60 * 1000))));
    assert.deepEqual((await check(near.state, near.dir)).found, []);
    const far = await world(text(lastRunText(ahead(5 * 60 * 1000 + 1000))));
    assert.deepEqual((await check(far.state, far.dir)).found, ['audit-record-future 2026-11-18T12:05:01Z']);
  });

  test('no record, and the audit workflow has been on the default branch for three days: the audit is dead, and the history is read for its age', async () => {
    const { state, dir } = await world((s) => { s.lastRun = null; s.commits = [commitOf(hoursAgo(60)), commitOf(hoursAgo(72))]; });
    const got = await check(state, dir);
    assert.equal(got.code, 1);
    assert.deepEqual(got.found, [`audit-dead there is no record of a run, and the audit workflow has been in the repository since ${hoursAgo(72)}`]);
    assert.deepEqual(reads(state).slice(-2), [
      'GET /repos/example/repo/contents/last-run.json?ref=record-keeper%2Flog',
      'GET /repos/example/repo/commits?sha=main&path=.github%2Fworkflows%2Frecords-audit.yml&per_page=100&page=1',
    ]);
  });

  test('no record, and a workflow that is a day old: a notice, and the run does not fail', async () => {
    const { state, dir } = await world((s) => { s.lastRun = null; s.commits = [commitOf(hoursAgo(24))]; });
    const got = await check(state, dir);
    assert.equal(got.code, 0);
    assert.deepEqual(got.found, [`audit-not-yet there is no record of a run yet, and the audit workflow is on the default branch since ${hoursAgo(24)}`]);
    assert.equal(got.report.findings[0].severity, 'notice');
  });

  test('no record, and no commit of the default branch touches the workflow', async () => {
    const { state, dir } = await world((s) => { s.lastRun = null; s.commits = []; });
    assert.deepEqual((await check(state, dir)).found, ['audit-not-yet there is no record of a run, and the audit workflow is not on the default branch yet']);
  });

  test('the oldest commit is the last of the last page: two hundred and fifty commits, and exactly one hundred', async () => {
    const many = await world((s) => { s.lastRun = null; s.commits = Array.from({ length: 250 }, (_, i) => commitOf(new Date(NOW - (i + 1) * 3600 * 1000).toISOString().replace('.000Z', 'Z'))); });
    const got = await check(many.state, many.dir);
    assert.deepEqual(got.found, ['audit-dead there is no record of a run, and the audit workflow has been in the repository since 2026-11-08T02:00:00Z']);
    assert.deepEqual(reads(many.state).filter((line) => /commits/.test(line)).map((line) => line.slice(-6)), ['page=1', 'page=2', 'page=3']);
    const exact = await world((s) => { s.lastRun = null; s.commits = Array.from({ length: 100 }, (_, i) => commitOf(new Date(NOW - (i + 1) * 3600 * 1000).toISOString().replace('.000Z', 'Z'))); });
    const again = await check(exact.state, exact.dir);
    assert.deepEqual(again.found, ['audit-dead there is no record of a run, and the audit workflow has been in the repository since 2026-11-14T08:00:00Z']);
    assert.equal(reads(exact.state).filter((line) => /commits/.test(line)).length, 2);
  });

  test('more than five hundred commits touch the workflow: the age is not known', async () => {
    const { state, dir } = await world((s) => { s.lastRun = null; s.commits = Array.from({ length: 700 }, () => commitOf(hoursAgo(100))); });
    const got = await check(state, dir);
    assert.deepEqual(got.found, ['not-checked age: more than 500 commits touch .github/workflows/records-audit.yml']);
    assert.equal(reads(state).filter((line) => /commits/.test(line)).length, 5);
  });

  test('a history that is not what the check needs, and one that cannot be read', async () => {
    for (const commits of [[{ sha: 'x' }], [{ commit: { committer: {} } }], [{ commit: { committer: { date: 5 } } }]]) {
      const { state, dir } = await world((s) => { s.lastRun = null; s.commits = commits; });
      assert.deepEqual((await check(state, dir)).found, ['not-checked age: the answer about the history of the audit workflow is not what the check needs']);
    }
    const objectBody = await world((s) => { s.lastRun = null; });
    objectBody.state.fault = (entry) => (entry.path.endsWith('/commits') ? { status: 200, body: { message: 'x' } } : undefined);
    assert.deepEqual((await check(objectBody.state, objectBody.dir)).found, ['not-checked age: the answer about the history of the audit workflow is not what the check needs']);
    const failed = await world((s) => { s.lastRun = null; });
    failed.state.fault = (entry) => (entry.path.endsWith('/commits') ? { status: 403 } : undefined);
    assert.match((await check(failed.state, failed.dir)).found[0], /^not-checked age: GET \/repos\/example\/repo\/commits\?.* answered 403/);
  });

  test('a date that is not a time is no age', async () => {
    const { state, dir } = await world((s) => { s.lastRun = null; s.commits = [commitOf('yesterday')]; });
    assert.deepEqual((await check(state, dir)).found, ['not-checked age: the date of the first commit is not a UTC time']);
  });

  test('the history is asked for only when there is no record and the audit workflow is a file', async () => {
    const withRecord = await world();
    await check(withRecord.state, withRecord.dir);
    assert.equal(withRecord.state.requests.some((request) => request.path.endsWith('/commits')), false);
    const noWorkflow = await world((s) => { s.lastRun = null; });
    const files = installed();
    delete files['.github/workflows/records-audit.yml'];
    const got = await check(noWorkflow.state, tree(files));
    assert.equal(noWorkflow.state.requests.some((request) => request.path.endsWith('/commits')), false);
    assert.ok(got.found.includes('audit-workflow-missing'));
    assert.equal(got.code, 0);
  });

  test('a record that cannot be read now, and a record that is not there because the log branch is not', async () => {
    const failed = await world();
    failed.state.fault = (entry) => (entry.path.endsWith('/last-run.json') ? { status: 500 } : undefined);
    assert.equal((await check(failed.state, failed.dir)).found.length, 1);
    assert.equal(failed.state.requests.some((request) => request.path.endsWith('/commits')), false, 'a read that failed is not a record that is not there');
    const noBranch = await world((s) => { s.lastRun = null; s.commits = [commitOf(hoursAgo(1))]; });
    assert.equal((await check(noBranch.state, noBranch.dir)).found[0].startsWith('audit-not-yet'), true);
  });
});

void COMMIT;
