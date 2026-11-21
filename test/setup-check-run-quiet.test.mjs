// The setup check at work, what a person is told and when (docs/setup-check.md): a daily run says nothing unless a person can act on it. A healthy installation, with
// the bypass list that a workflow token is not shown and with the single-owner mode on, gets no annotation, nothing on the error output and the status 0, on a schedule
// and on a manual run of the workflow, and so does the repository of the kit itself. The single-owner mode is said once, by the pull request that starts it. Against a
// local server that plays GitHub; every program is given the environment that the test names and no other.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCli } from '../setup-check.mjs';
import { parseSettings } from '../record-keeper.mjs';
import {
  BLOCK, NOW, actions, check, cleanUp, folder, guardedFetch, healthy, installed, reads, ruleset, serve, tree,
} from './setup-check-world.mjs';

after(cleanUp);

const root = fileURLToPath(new URL('..', import.meta.url));
const SETTINGS = '.github/record-keeper/settings.yml';
const SILENT = 'setup check: 0 errors, 0 warnings, 0 notices\n';

async function world(change) {
  const state = healthy();
  if (change) change(state);
  await serve(state);
  return state;
}
/** A run in Actions, with the output as it is written, and the job summary in a file that this returns. */
async function run(state, dir, env = {}) {
  const summary = path.join(folder('summary'), 'summary.md');
  const got = await runCli(['--repo', state.repo, '--root', dir], actions(state, { GITHUB_STEP_SUMMARY: summary, ...env }), { fetch: guardedFetch([]), sleep: async () => {}, now: () => NOW });
  return { ...got, summary: fs.readFileSync(summary, 'utf8') };
}
const annotations = (stdout) => stdout.split('\n').filter((line) => line.startsWith('::'));

/** The settings file of this repository, as a tree and a world that knows its owners: the kit's own repository. */
function kit() {
  const text = fs.readFileSync(path.join(root, SETTINGS), 'utf8');
  const { settings } = parseSettings(Buffer.from(text));
  const files = { [SETTINGS]: text, 'install.json': fs.readFileSync(path.join(root, 'install.json'), 'utf8'), '.github/workflows/records-audit.yml': 'name: Records audit\n', '.github/CODEOWNERS': '/.github/ @a\n' };
  return { files, owners: settings.owners, approvals: settings.approvals };
}

describe('a healthy installation on a schedule and on a manual run of the workflow', () => {
  for (const event of ['schedule', 'workflow_dispatch']) {
    for (const [name, actors] of [['the bypass list not shown', undefined], ['the bypass list shown, and nobody may bypass but for pull requests', [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }]]]) {
      test(`${event}, with ${name} and approvals 1: no annotation, nothing on the error output, the status 0`, async () => {
        const state = await world((s) => { s.rulesets.set(4101, ruleset(4101, { actors })); });
        const dir = tree({ ...installed(), [SETTINGS]: 'owners: [alice/1001, bob/1002]\napprovals: 1\n' });
        const got = await run(state, dir, { GITHUB_EVENT_NAME: event });
        assert.equal(got.stdout, SILENT);
        assert.equal(got.stderr, '');
        assert.equal(got.code, 0);
        assert.deepEqual(annotations(got.stdout), []);
        const said = got.summary.includes('Not looked at');
        assert.equal(said, actors === undefined, 'the summary says what was not looked at, when something was not');
        if (actors === undefined) assert.match(got.summary, /\n- `bypass`: not looked at\\: who may bypass the ruleset \\\(ruleset 4101\\: the token cannot see the bypass list\\\)/);
        assert.match(got.summary, /\*\*0 errors, 0 warnings, 0 notices\*\*/);
      });
    }
  }

  test('with --json the same run says what it did not look at, and has no finding', async () => {
    const state = await world((s) => { s.rulesets.set(4101, ruleset(4101, { actors: undefined })); });
    const dir = tree({ ...installed(), [SETTINGS]: 'owners: [alice/1001, bob/1002]\napprovals: 1\n' });
    const got = await check(state, dir, { env: { GITHUB_EVENT_NAME: 'schedule' } });
    assert.deepEqual(got.report.findings, []);
    assert.deepEqual(got.report.notLookedAt.map((item) => item.topic), ['bypass']);
  });

  test('outside Actions the same run says what it did not look at in one plain line, and the count is still nothing', async () => {
    const state = await world((s) => { s.rulesets.set(4101, ruleset(4101, { actors: undefined })); });
    const dir = tree(installed());
    const got = await runCli(['--repo', state.repo, '--root', dir], actions(state, { GITHUB_ACTIONS: undefined, GITHUB_EVENT_NAME: undefined }), { fetch: guardedFetch([]), now: () => NOW });
    const lines = got.stdout.split('\n');
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^not looked at: who may bypass the ruleset \(ruleset 4101: the token cannot see the bypass list\)\. The token of a workflow is not shown the bypass list/);
    assert.equal(lines[1], 'setup check: 0 errors, 0 warnings, 0 notices');
    assert.equal(got.code, 0);
  });

  test('when the token is shown the list, a bypass that does not wait for a pull request is still a warning', async () => {
    const state = await world((s) => { s.rulesets.set(4101, ruleset(4101, { actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }] })); });
    const got = await run(state, tree(), { GITHUB_EVENT_NAME: 'schedule' });
    assert.equal(got.code, 0);
    assert.match(got.stdout, /^::warning title=bypass-always::/m);
    assert.match(got.stdout, /setup check: 0 errors, 1 warning, 0 notices\n$/);
    assert.ok(!got.summary.includes('Not looked at'));
  });
});

describe('the repository of the kit itself', () => {
  for (const event of ['schedule', 'workflow_dispatch', 'pull_request']) {
    test(`${event}: its own settings and install.json, a CODEOWNERS file, and a ruleset that was not shown to the token: no annotation`, async () => {
      const { files, owners } = kit();
      const state = await world((s) => {
        s.users = new Map(owners.map((owner) => [owner.id, owner.login]));
        s.rulesets.set(4101, ruleset(4101, { actors: undefined }));
      });
      const dir = tree(files);
      // the settings of the base of a pull request are the settings of the head: nothing starts and nothing changes
      state.settingsAt.set('main', files[SETTINGS]);
      const got = await run(state, dir, { GITHUB_EVENT_NAME: event, GITHUB_BASE_REF: event === 'pull_request' ? 'main' : undefined });
      assert.equal(got.stdout, SILENT);
      assert.equal(got.stderr, '');
      assert.equal(got.code, 0);
      assert.match(got.summary, /\n- `own`: not looked at\\: the pin, the pinned release and the installed files/);
      assert.match(got.summary, /\n- `bypass`: not looked at\\: who may bypass the ruleset/);
    });
  }

  test('without a CODEOWNERS file, the one warning that a person can mend is the only thing it says', async () => {
    const { files, owners } = kit();
    delete files['.github/CODEOWNERS'];
    const state = await world((s) => { s.users = new Map(owners.map((owner) => [owner.id, owner.login])); });
    const got = await run(state, tree(files), { GITHUB_EVENT_NAME: 'schedule' });
    assert.deepEqual(annotations(got.stdout).map((line) => /^::(\w+) title=([a-z-]+)::/.exec(line).slice(1).join(' ')), ['warning codeowners-missing']);
    assert.equal(got.code, 0);
  });
});

describe('a pull request on a healthy installation', () => {
  const SAME = 'owners: [alice/1001, bob/1002]\napprovals: 1\n';
  for (const [name, text] of [['approvals 2', null], ['approvals 1, and the base has the same owners and the same approvals', SAME]]) {
    for (const value of ['true', 'false', undefined]) {
      test(`${name}, and the workflow says the secret is ${value === undefined ? 'not said' : value === 'true' ? 'set' : 'not set'}: no annotation, nothing on the error output, the status 0`, async () => {
        const state = await world();
        if (text !== null) state.settingsAt.set('main', text);
        const dir = tree(text === null ? installed() : { ...installed(), [SETTINGS]: text });
        const got = await run(state, dir, { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main', HAS_RECORD_KEEPER_TOKEN: value });
        assert.equal(got.stdout, SILENT);
        assert.equal(got.stderr, '');
        assert.equal(got.code, 0);
        assert.deepEqual(annotations(got.stdout), []);
        assert.match(got.summary, /\n- `secret`: not looked at\\: whether RECORD\\_KEEPER\\_TOKEN is set \\\(a run for a pull request is not given the secrets\\\)/);
        assert.match(got.summary, /\*\*0 errors, 0 warnings, 0 notices\*\*/);
        assert.ok(!/Checked, and fine:[^\n]*`secret`/.test(got.summary), 'what was not looked at is not found fine');
      });
    }
  }

  test('the same run by hand, outside Actions, says it in one plain line, and the count is still nothing', async () => {
    const state = await world();
    const got = await runCli(['--repo', state.repo, '--root', tree()], actions(state, { GITHUB_ACTIONS: undefined, GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' }), { fetch: guardedFetch([]), now: () => NOW });
    const lines = got.stdout.split('\n');
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^not looked at: whether RECORD_KEEPER_TOKEN is set \(a run for a pull request is not given the secrets\)\. /);
    assert.equal(lines[1], 'setup check: 0 errors, 0 warnings, 0 notices');
    assert.equal(got.code, 0);
  });

  test('with --json it is in notLookedAt, with the bypass list that the token is not shown, and has no finding', async () => {
    const state = await world((s) => { s.rulesets.set(4101, ruleset(4101, { actors: undefined })); });
    const got = await check(state, tree(), { env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' } });
    assert.deepEqual(got.report.findings, []);
    assert.deepEqual(got.report.notLookedAt.map((item) => item.topic), ['bypass', 'secret']);
  });

  test('the secret that is not set is still a warning on a schedule, on a manual run and by hand, and is not one on a pull request', async () => {
    for (const [event, said] of [['schedule', true], ['workflow_dispatch', true], [undefined, true], ['pull_request', false]]) {
      const state = await world();
      const got = await run(state, tree(), { GITHUB_EVENT_NAME: event, GITHUB_BASE_REF: 'main', HAS_RECORD_KEEPER_TOKEN: 'false' });
      assert.deepEqual(annotations(got.stdout).map((line) => /^::(\w+) title=([a-z-]+)::/.exec(line).slice(1).join(' ')), said ? ['warning secret-not-set'] : [], String(event));
    }
  });
});

describe('the single-owner mode is said once, by the pull request that puts it on or changes its owners', () => {
  const SINGLE = 'owners: [alice/1001]\napprovals: 1\n';
  const prRun = async (settingsAt, { head = SINGLE, env = {}, change } = {}) => {
    const state = await world((s) => {
      s.release = { ...s.release };
      if (change) change(s);
      for (const [ref, text] of Object.entries(settingsAt)) s.settingsAt.set(ref, text);
    });
    const dir = tree({ ...installed(), [SETTINGS]: head });
    const got = await check(state, dir, { env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main', ...env } });
    return { state, got, singles: got.report.findings.filter((finding) => finding.code === 'single-owner') };
  };

  test('the base has no settings file: the mode starts', async () => {
    const { got, singles, state } = await prRun({});
    assert.equal(singles.length, 1);
    assert.equal(singles[0].severity, 'notice');
    assert.match(singles[0].text, /^this pull request puts the single-owner mode on, or changes who the owners are while it is on \(approvals: 1\)/);
    assert.equal(got.code, 0);
    assert.ok(reads(state).includes('GET /repos/example/repo/contents/.github/record-keeper/settings.yml?ref=main'));
    const request = state.requests.find((item) => item.path.endsWith('/settings.yml'));
    assert.equal(request.accept, 'application/vnd.github.raw+json');
    assert.equal(request.authorization.startsWith('Bearer '), true);
  });

  test('the base wants two approvals, or says nothing of them: the mode starts', async () => {
    assert.equal((await prRun({ main: 'owners: [alice/1001, bob/1002]\napprovals: 2\n' })).singles.length, 1);
    assert.equal((await prRun({ main: 'owners: [alice/1001]\n' })).singles.length, 1);
    assert.equal((await prRun({ main: '# nothing yet\n' })).singles.length, 1);
  });

  test('the base is in the mode with the same owner, or the same owners in another order: nothing is said', async () => {
    assert.equal((await prRun({ main: SINGLE })).singles.length, 0);
    assert.equal((await prRun({ main: 'owners: [alice/1001, bob/1002]\napprovals: 1\n' }, { head: 'owners: [bob/1002, alice/1001]\napprovals: 1\n' })).singles.length, 0);
    assert.equal((await prRun({ main: '# the mode, with a comment\nowners: [alice/1001]\n\napprovals: 1 # one\n' })).singles.length, 0);
  });

  test('the base is in the mode with other owners: the owners change', async () => {
    assert.equal((await prRun({ main: 'owners: [bob/1002]\napprovals: 1\n' })).singles.length, 1);
    assert.equal((await prRun({ main: SINGLE }, { head: 'owners: [alice/1001, bob/1002]\napprovals: 1\n' })).singles.length, 1);
  });

  test('the head does not say approvals 1: nothing is said, and the base is not asked for', async () => {
    const { singles, state } = await prRun({ main: SINGLE }, { head: 'owners: [alice/1001, bob/1002]\napprovals: 2\n' });
    assert.equal(singles.length, 0);
    assert.equal(state.requests.some((request) => request.path.endsWith('/settings.yml')), false);
  });

  test('the base that cannot be read says nothing: a refusal, an error of the server, a file that is too large, bytes that are not text', async () => {
    for (const fault of [{ status: 403 }, { status: 500 }, { status: 401 }]) {
      const { singles } = await prRun({}, { change: (s) => { s.fault = (entry) => (entry.path.endsWith('/settings.yml') ? fault : undefined); } });
      assert.equal(singles.length, 0, JSON.stringify(fault));
    }
    assert.equal((await prRun({ main: `${'#'.repeat(70 * 1024)}\n` })).singles.length, 0);
    assert.equal((await prRun({ main: Buffer.from([0x6f, 0xff, 0x3a]) })).singles.length, 0);
    assert.equal((await prRun({ main: '\ufeffowners: [alice/1001]\napprovals: 1\n' })).singles.length, 0);
  });

  test('a base that is a branch with a slash in its name is asked for in one piece', async () => {
    const { singles, state } = await prRun({ 'release/next': 'owners: [alice/1001]\n' }, { env: { GITHUB_BASE_REF: 'release/next' } });
    assert.equal(singles.length, 1);
    assert.ok(reads(state).includes('GET /repos/example/repo/contents/.github/record-keeper/settings.yml?ref=release%2Fnext'));
  });

  test('a base that is not a name that the check puts into a request is not asked for, and says nothing', async () => {
    for (const base of ['', ' ', 'a b', 'a;b', '$(id)', 'a`b`', '../x', 'a/../b', 'a//b', '/a', 'a/', 'a?x=1', 'a#b', 'a%2Fb', 'x'.repeat(201), '--local', 'main\nmain']) {
      const { singles, state } = await prRun({}, { env: { GITHUB_BASE_REF: base } });
      assert.equal(singles.length, 0, JSON.stringify(base));
      assert.equal(state.requests.some((request) => request.path.endsWith('/settings.yml')), false, JSON.stringify(base));
    }
    const { singles } = await prRun({}, { env: { GITHUB_BASE_REF: undefined } });
    assert.equal(singles.length, 0);
  });

  test('on a schedule, on a manual run and on a run with no event, the base is not asked for, and nothing is said', async () => {
    for (const event of ['schedule', 'workflow_dispatch', undefined, 'push']) {
      const { singles, state } = await prRun({}, { env: { GITHUB_EVENT_NAME: event } });
      assert.equal(singles.length, 0, String(event));
      assert.equal(state.requests.some((request) => request.path.endsWith('/settings.yml')), false, String(event));
    }
  });

  test('with --local the base is not asked for, whatever the environment says', async () => {
    const state = await world();
    const dir = tree({ ...installed(), [SETTINGS]: SINGLE });
    const got = await check(state, dir, { argv: ['--local'], env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' } });
    assert.ok(!got.report.findings.some((finding) => finding.code === 'single-owner'));
    assert.deepEqual(state.requests, []);
  });

  test('the notice is one line among the annotations of that pull request, and it is a notice: the status stays 0', async () => {
    const state = await world();
    const dir = tree({ ...installed(), [SETTINGS]: SINGLE });
    const got = await run(state, dir, { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main', HAS_RECORD_KEEPER_TOKEN: 'true' });
    assert.deepEqual(annotations(got.stdout).map((line) => /^::(\w+) title=([a-z-]+)::/.exec(line).slice(1).join(' ')), ['notice single-owner']);
    assert.match(got.stdout, /setup check: 0 errors, 0 warnings, 1 notice\n$/);
    assert.equal(got.code, 0);
  });
});

describe('the files of the agents are as quiet as the rest of a healthy installation', () => {
  for (const event of ['schedule', 'workflow_dispatch', 'pull_request']) {
    test(`${event}: the skill, the block of AGENTS.md and a CLAUDE.md of any content give no annotation, whatever else AGENTS.md says`, async () => {
      for (const files of [
        {},
        { 'AGENTS.md': `${BLOCK}\n` },
        { 'AGENTS.md': `# Another text entirely\n\nwith \`code\` and tabs\t\n\n${BLOCK}\n\n- more\n\n\`\`\`\n<!-- record-keeper:begin -->\n\`\`\`\n` },
        { 'AGENTS.md': `a file that does not end in a line feed, with text after the block\n\n${BLOCK}\ntext` },
        { 'CLAUDE.md': null },
        { 'CLAUDE.md': 'the notes of the repository, which do not import the file\n' },
      ]) {
        const state = await world();
        const dir = tree({ ...installed(), ...files });
        const got = await run(state, dir, { GITHUB_EVENT_NAME: event, ...(event === 'pull_request' ? { GITHUB_BASE_REF: 'main' } : {}) });
        assert.equal(got.stdout.endsWith(SILENT), true, `${Object.keys(files)}: ${got.stdout}`);
        assert.deepEqual(annotations(got.stdout).filter((line) => !line.startsWith('::notice title=single-owner')), []);
        assert.equal(got.stderr, '');
        assert.equal(got.code, 0);
      }
    });
  }

  test('markers that cannot be used are one warning a day, with the step that mends it, and the status stays 0', async () => {
    const state = await world();
    const dir = tree({ ...installed(), 'AGENTS.md': `${BLOCK}\n\n${BLOCK}\n` });
    const got = await run(state, dir, { GITHUB_EVENT_NAME: 'schedule' });
    assert.equal(got.code, 0);
    assert.deepEqual(annotations(got.stdout).map((line) => line.split('::')[1]), ['warning title=block-unusable']);
    assert.match(got.stdout, /Repair or take out the two marker lines and the text between them by hand, and run the updater with --target set to the pinned version \(docs\/agent-files\.md of the kit\)\.\n/);
    assert.match(got.stdout, /setup check: 0 errors, 1 warning, 0 notices\n$/);
    assert.match(got.summary, /\| warning \| `block-unusable` \|/);
  });
});
