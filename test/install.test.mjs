// The install set and the layout of a repository that installs the kit (docs/install.md): the consumer versions of the workflows, the templates, the guard of the
// files that make the check, and the programs run from `.github/record-keeper/` against a local server that plays GitHub. Everything here happens in folders
// that the tests make: nothing reads or writes the real working tree or the real home, and nothing reaches the network.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CODE_FILES, SETTINGS_PATH, WORKFLOW_FILES, checkChange } from '../record-keeper.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const install = JSON.parse(fs.readFileSync(path.join(root, 'install.json'), 'utf8'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'record-keeper-install-'));
const servers = [];
after(() => {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
  fs.rmSync(scratch, { recursive: true, force: true });
});

const CLEAN = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_') && name !== 'GITHUB_TOKEN' && name !== 'GITHUB_API_URL'));
// The git of the tests reads no configuration of the person who runs them (no signing, no hooks, no templates): the repositories here are made from nothing.
const IDENTITY = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd, ...args) => {
  const result = spawnSync('git', args, { cwd, env: { ...CLEAN, ...IDENTITY }, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};
let made = 0;
const folder = () => {
  const dir = path.join(scratch, `case-${(made += 1)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const write = (dir, relative, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
  fs.writeFileSync(path.join(dir, relative), content);
};
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

/** A repository with a first commit that is not about the kit, and nothing installed. */
function repository() {
  const dir = folder();
  git(dir, 'init', '-q', '-b', 'main');
  write(dir, 'README.md', '# A repository\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Start');
  return dir;
}

/** What the updater of M3b will do on the first adoption, in its simplest form: every file of the install set, from its source to its destination, byte for byte. */
function installKit(dir, kinds = ['managed', 'template']) {
  for (const entry of install.files.filter(({ kind }) => kinds.includes(kind))) write(dir, entry.path, fs.readFileSync(path.join(root, entry.source)));
}

const exec = (args, { cwd, env = {} }) => new Promise((resolve) => {
  const child = spawn(process.execPath, args, { cwd, env: { ...CLEAN, ...env } });
  const out = [];
  const err = [];
  child.stdout.on('data', (chunk) => out.push(chunk));
  child.stderr.on('data', (chunk) => err.push(chunk));
  child.on('close', (code) => resolve({ code, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() }));
});

// ---- the consumer versions of the workflows -------------------------------------------------------------------------------------------

/** The workflow of a repository that installs the kit, made from the workflow of the kit: the program is run where install.json puts it, and the page named in a comment by a link. */
function derive(text, { program, installed, page }) {
  const once = (from, to, count = 1) => {
    assert.equal(text.split(from).length - 1, count, from);
    text = text.replaceAll(from, to);
  };
  once(`node ${program} --repo`, `node ${installed} --repo`, program === 'run-audit.mjs' ? 2 : 1);
  once(`(docs/${page})`, `(https://github.com/gearsnlevers/record-keeper/blob/main/docs/${page})`);
  return text;
}
const WORKFLOWS = [
  { name: 'records-integrity.yml', program: 'check-pull-request.mjs', page: 'workflow.md' },
  { name: 'records-audit.yml', program: 'run-audit.mjs', page: 'audit-run.md' },
].map((item) => ({ ...item, installed: `.github/record-keeper/${item.program}` }));

describe('the workflows of a repository that installs the kit', () => {
  for (const item of WORKFLOWS) {
    test(`${item.name} is the workflow of the kit with the program run where install.json puts it, and nothing else`, () => {
      const kit = read(`.github/workflows/${item.name}`);
      const template = read(`templates/workflows/${item.name}`);
      assert.equal(template, derive(kit, item));
      assert.notEqual(template, kit, 'the derivation changes something');
      assert.ok(template.includes(`node ${item.installed} --repo`));
      assert.ok(!template.includes(`node ${item.program} --repo`));
      assert.ok(!/\(docs\//.test(template), 'no page of the kit is named by a path that a repository does not have');
    });

    test(`${item.name} is a file that install.json installs at the path of the workflow of the kit, as a managed file`, () => {
      const entry = install.files.find((file) => file.source === `templates/workflows/${item.name}`);
      assert.deepEqual(entry, { source: `templates/workflows/${item.name}`, path: `.github/workflows/${item.name}`, kind: 'managed' });
    });
  }

  test('a drift is found: a changed line, a changed comment, a changed command or a line added to either side', () => {
    for (const item of WORKFLOWS) {
      const kit = read(`.github/workflows/${item.name}`);
      const template = read(`templates/workflows/${item.name}`);
      for (const [name, edit] of [
        ['a line added to the kit', (text) => text.replace('\njobs:', '\n# a new comment\njobs:')],
        ['the runner changed', (text) => text.replace('ubuntu-latest', 'ubuntu-22.04')],
        ['the timeout changed', (text) => text.replace(/timeout-minutes: \d+/, 'timeout-minutes: 99')],
        ['a trailing space', (text) => text.replace('\njobs:', ' \njobs:')],
        ['the line endings', (text) => text.replaceAll('\n', '\r\n')],
      ]) {
        const changed = edit(kit);
        assert.notEqual(changed, kit, name);
        assert.notEqual(derive(changed, item), template, `${item.name}: ${name} must not go unseen`);
      }
      assert.throws(() => derive(kit.replace(`node ${item.program} --repo`, 'node other.mjs --repo'), item), /node /);
      assert.throws(() => derive(kit.replace(`(docs/${item.page})`, '(docs/other.md)'), item), /docs\//);
    }
  });

  test('the consumer versions do not name the Records integrity check anywhere but the workflow of that check', () => {
    assert.ok(/^name: Records integrity$/m.test(read('templates/workflows/records-integrity.yml')));
    assert.doesNotMatch(read('templates/workflows/records-audit.yml'), /records[ _-]?integrity/i);
  });
});

// ---- the templates ----------------------------------------------------------------------------------------------------------------------

describe('the templates', () => {
  const settingsPage = read('docs/settings.md');
  const rows = [...settingsPage.matchAll(/^\| `([a-z-]+)` \| (?:single|list) \| `?([^|`]+?)`? \|/gm)].map((m) => [m[1], m[2].trim()]);

  test('install.json installs them once: the records README, the template of a record and the settings, where the page says', () => {
    const templates = install.files.filter(({ kind }) => kind === 'template').map(({ source, path: destination }) => [source, destination]);
    assert.deepEqual(templates, [['templates/decisions/README.md', 'docs/decisions/README.md'], ['templates/decisions/template.md', 'docs/decisions/template.md'], ['templates/settings.yml', '.github/record-keeper/settings.yml']]);
    assert.equal(destinationOfSettings(), SETTINGS_PATH);
  });

  function destinationOfSettings() {
    return install.files.find(({ source }) => source === 'templates/settings.yml').path;
  }

  test('the template of a record is the one of the kit, byte for byte', () => {
    assert.equal(read('templates/decisions/template.md'), read('docs/decisions/template.md'));
  });

  test('the settings template has every key of the page, in the order of the page, commented out at its default', () => {
    assert.deepEqual(rows.map(([key]) => key), ['folder', 'shared-folder', 'extra-keys', 'owners', 'approvals', 'witnesses']);
    const lines = read('templates/settings.yml').split('\n');
    const keys = lines.filter((line) => /^# [a-z-]+: /.test(line)).map((line) => /^# ([a-z-]+): (\S+(?: \S+)*?)\s+# /.exec(line));
    assert.ok(keys.every((m) => m !== null));
    assert.deepEqual(keys.map((m) => [m[1], m[2]]), rows);
    assert.ok(lines.every((line) => line === '' || line.startsWith('#')), 'nothing in the file is a setting: every line is blank or a comment');
    assert.ok(read('templates/settings.yml').endsWith('\n'));
  });

  test('the index of the records README is empty, in the form that validate demands, and has no row for a protocol generation', () => {
    const text = read('templates/decisions/README.md');
    assert.ok(text.startsWith('# Decision records\n'));
    assert.ok(text.endsWith('## Index\n\n| # | Title | Status |\n| - | - | - |\n'));
    assert.equal((text.match(/^## Index$/gm) || []).length, 1);
    assert.doesNotMatch(text, /Generation|g1/);
    assert.ok(!/^\| \d{4} /m.test(text), 'no row');
  });

  test('installed in a repository, they are a records folder with 0 problems and settings at their defaults', () => {
    const dir = repository();
    installKit(dir, ['template']);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'Adopt');
    const program = path.join(root, 'record-keeper.mjs');
    const run = (...args) => spawnSync(process.execPath, [program, ...args], { cwd: dir, env: CLEAN, encoding: 'utf8' });
    assert.deepEqual([run('validate').status, run('validate').stdout, run('validate').stderr], [0, 'docs/decisions: 0 problems\n', '']);
    assert.deepEqual([run('validate', '--commit', 'HEAD', '--settings-from', 'HEAD').status, run('validate', '--commit', 'HEAD', '--settings-from', 'HEAD').stdout],
      [0, 'docs/decisions: 0 problems\n']);
    const config = run('config', '--commit', 'HEAD');
    assert.equal(config.status, 0, config.stderr);
    assert.equal(config.stdout, 'folder: docs/decisions\nshared-folder: shared\nextra-keys: []\nowners: []\napprovals: 2\nwitnesses: []\n.github/record-keeper/settings.yml: 0 problems\n');
  });

  test('a first record can be added by hand: a row under the empty index is read, and so is a second', () => {
    const dir = repository();
    installKit(dir, ['template']);
    const record = (n, title) => `---\nstatus: proposed\ndate: 2026-11-17\ndecision-makers:\n  - maintainers\n---\n\n# ${title}\n\n## Context and problem statement\n\nWhy.\n\n## Decision\n\n- Rule.\n\n## Consequences\n\n- Effect.\n`.replace('Why', `Why ${n}`);
    write(dir, 'docs/decisions/0001-first.md', record(1, 'First'));
    fs.appendFileSync(path.join(dir, 'docs/decisions/README.md'), '| 0001 | [First](0001-first.md) | proposed |\n');
    const program = path.join(root, 'record-keeper.mjs');
    assert.equal(spawnSync(process.execPath, [program, 'validate'], { cwd: dir, env: CLEAN, encoding: 'utf8' }).stdout, 'docs/decisions: 0 problems\n');
    write(dir, 'docs/decisions/0002-second.md', record(2, 'Second'));
    const missing = spawnSync(process.execPath, [program, 'validate'], { cwd: dir, env: CLEAN, encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /0002-second\.md: \[V-30\]/);
    fs.appendFileSync(path.join(dir, 'docs/decisions/README.md'), '| 0002 | [Second](0002-second.md) | proposed |\n');
    assert.equal(spawnSync(process.execPath, [program, 'validate'], { cwd: dir, env: CLEAN, encoding: 'utf8' }).stdout, 'docs/decisions: 0 problems\n');
  });

  test('the files that a release installs name no deployment, and no product that uses the kit', () => {
    const names = new RegExp([['concier', 'ge'], ['fro', 'do'], ['rock', 'carver'], ['ping', 'identity']].map((parts) => parts.join('')).join('|'), 'i');
    const files = [...install.files.map(({ source }) => source), 'install.json', 'tools/build-release-manifest.mjs', 'tools/update-changelog.mjs', '.github/workflows/release.yml', 'reference/verify_manifest.py'];
    for (const file of files) assert.doesNotMatch(read(file), names, file);
  });
});

// ---- the guard: every managed file is guarded, and what is guarded and installed is managed ---------------------------------------------

describe('the files that install.json installs, and the files that the check guards', () => {
  const GUARDED = [...WORKFLOW_FILES, ...CODE_FILES];
  const managed = install.files.filter(({ kind }) => kind === 'managed');
  const kindOf = (destination) => (WORKFLOW_FILES.includes(destination) ? 'workflow' : CODE_FILES.includes(destination) ? 'code' : null);

  test('no managed file is unguarded', () => {
    assert.ok(managed.length >= 5);
    for (const { path: destination } of managed) assert.notEqual(kindOf(destination), null, `${destination} is managed and no change to it is an act`);
  });

  test('every guarded path of a repository that is in install.json is managed, and the guarded paths at the root are not installed anywhere', () => {
    for (const destination of GUARDED.filter((file) => file.startsWith('.github/'))) {
      const entry = install.files.find((file) => file.path === destination);
      if (entry !== undefined) assert.equal(entry.kind, 'managed', destination);
    }
    for (const destination of GUARDED.filter((file) => !file.startsWith('.github/'))) assert.equal(install.files.find((file) => file.path === destination), undefined, destination);
  });

  test('a template is never guarded as a workflow or as code: the repository owns it, and the settings are an act of their own kind', () => {
    for (const { path: destination } of install.files.filter(({ kind }) => kind === 'template')) assert.equal(kindOf(destination), null, destination);
    assert.ok(!GUARDED.includes(SETTINGS_PATH));
  });

  test('a program is installed next to the rules file, and the workflows that run the programs are installed with them', () => {
    const programs = managed.filter(({ path: destination }) => destination.startsWith('.github/record-keeper/')).map(({ path: destination }) => path.posix.basename(destination)).sort();
    assert.deepEqual(programs, ['check-pull-request.mjs', 'record-keeper.mjs', 'run-audit.mjs']);
    assert.deepEqual(managed.filter(({ path: destination }) => destination.startsWith('.github/workflows/')).map(({ path: destination }) => path.posix.basename(destination)).sort(), ['records-audit.yml', 'records-integrity.yml']);
  });

  test('a change to any managed file in an installed repository is an act of the right kind, and a change to a template is not', () => {
    const dir = repository();
    installKit(dir);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'Adopt');
    for (const { path: destination, kind } of install.files) {
      git(dir, 'checkout', '-q', '-B', 'work', 'main');
      fs.appendFileSync(path.join(dir, destination), destination.endsWith('.mjs') ? '// changed\n' : destination.endsWith('.md') ? '\nMore.\n' : '# changed\n');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', `Change ${destination}`);
      const { acts } = checkChange(dir, 'main', 'work');
      const own = acts.filter((act) => act.path === destination).map((act) => act.kind);
      if (kind === 'managed') assert.deepEqual(own, [kindOf(destination)], destination);
      else if (destination === SETTINGS_PATH) assert.deepEqual(own, ['settings'], destination);
      else assert.deepEqual(own, [], destination);
      assert.deepEqual(acts.filter((act) => act.path !== destination), [], destination);
    }
  });

  test('deleting or replacing the folder of the kit is an act for every program in it', () => {
    const dir = repository();
    installKit(dir);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'Adopt');
    git(dir, 'checkout', '-q', '-b', 'work');
    git(dir, 'rm', '-q', '-r', '.github/record-keeper');
    git(dir, 'commit', '-q', '-m', 'Remove');
    const kinds = checkChange(dir, 'main', 'work').acts.map((act) => `${act.kind} ${act.path}`);
    assert.deepEqual(kinds, ['settings .github/record-keeper/settings.yml', 'code .github/record-keeper/check-pull-request.mjs', 'code .github/record-keeper/record-keeper.mjs', 'code .github/record-keeper/run-audit.mjs']);
  });
});

// ---- a repository that has the layout, with the programs run from .github/record-keeper -----------------------------------------------

async function serve(handler) {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const text = Buffer.concat(chunks).toString('utf8');
      const entry = { method: request.method, path: url.pathname, query: url.searchParams, body: text === '' ? undefined : JSON.parse(text), authorization: request.headers.authorization };
      requests.push(entry);
      const answer = handler(entry) ?? { status: 404, body: { message: 'Not Found' } };
      response.writeHead(answer.status ?? 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(answer.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

const OWNERS = 'owners: [alice/1001, bob/1002]\napprovals: 1\n';
const TOKEN = 'ghs_installtest1234567890';
const AUTHOR = 4242;

/** A repository as a repository that has installed the kit has it: the install set, the settings with owners, committed. `main` is the base. */
function adopted() {
  const dir = repository();
  installKit(dir);
  write(dir, SETTINGS_PATH, OWNERS);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Adopt Record Keeper (#1)');
  return dir;
}

/** A bare `origin` that has what the dev repository has, and a clone of it where a job runs. */
function origin(dev, refs = {}) {
  const bare = `${folder()}.git`;
  git(scratch, 'clone', '-q', '--bare', dev, bare);
  for (const [ref, branch] of Object.entries(refs)) git(dev, 'push', '-q', bare, `${branch}:${ref}`);
  const work = folder();
  git(scratch, 'clone', '-q', bare, work);
  return { bare, work };
}

describe('a repository with the layout of a consumer', () => {
  const program = '.github/record-keeper/record-keeper.mjs';
  const approve = (head, user = 1001) => ({ id: 1, user: { id: user, login: 'x' }, state: 'APPROVED', commit_id: head, submitted_at: '2026-11-17T09:00:00Z' });

  test('the programs are where install.json puts them, and are the files of the kit byte for byte', () => {
    const dir = adopted();
    for (const name of ['record-keeper.mjs', 'check-pull-request.mjs', 'run-audit.mjs']) assert.ok(fs.readFileSync(path.join(dir, '.github/record-keeper', name)).equals(fs.readFileSync(path.join(root, name))), name);
    assert.ok(!fs.existsSync(path.join(dir, 'record-keeper.mjs')), 'nothing is installed at the root');
  });

  test('validate, config and seal run from the folder, with the repository as the working directory', async () => {
    const dir = adopted();
    assert.deepEqual(await exec([program, 'validate'], { cwd: dir }), { code: 0, stdout: 'docs/decisions: 0 problems\n', stderr: '' });
    const config = await exec([program, 'config', '--commit', 'HEAD'], { cwd: dir });
    assert.equal(config.code, 0, config.stderr);
    assert.equal(config.stdout, 'folder: docs/decisions\nshared-folder: shared\nextra-keys: []\nowners: [alice/1001, bob/1002]\napprovals: 1\nwitnesses: []\n.github/record-keeper/settings.yml: 0 problems\n');
    write(dir, 'docs/decisions/0001-first.md', `---\nstatus: proposed\ndate: 2026-11-17\ndecision-makers:\n  - maintainers\n---\n\n# First\n\n## Context and problem statement\n\nWhy.\n\n## Decision\n\n- Rule.\n\n## Consequences\n\n- Effect.\n`);
    const sealed = await exec([program, 'seal', 'docs/decisions/0001-first.md'], { cwd: dir });
    assert.equal(sealed.code, 0, sealed.stderr);
    assert.match(sealed.stdout, /^sha256-g1:[0-9a-f]{64}\n$/);
  });

  describe('the pull request check', () => {
    const run = async (work, server, number = 1) => exec(['.github/record-keeper/check-pull-request.mjs', '--repo', 'o/r', '--pr', String(number)], { cwd: work, env: { GITHUB_TOKEN: TOKEN, GITHUB_API_URL: server.url } });
    const pull = (head, reviews = []) => serve(({ path: route }) => {
      if (route === '/repos/o/r/pulls/1') return { body: { number: 1, state: 'open', head: { sha: head }, base: { ref: 'main' }, user: { id: AUTHOR } } };
      if (route === '/repos/o/r/pulls/1/reviews') return { body: reviews };
      return undefined;
    });

    test('a pull request that adds a record is judged, and passes', async () => {
      const dev = adopted();
      git(dev, 'checkout', '-q', '-b', 'pr');
      write(dev, 'docs/decisions/0001-first.md', `---\nstatus: proposed\ndate: 2026-11-17\ndecision-makers:\n  - maintainers\n---\n\n# First\n\n## Context and problem statement\n\nWhy.\n\n## Decision\n\n- Rule.\n\n## Consequences\n\n- Effect.\n`);
      fs.appendFileSync(path.join(dev, 'docs/decisions/README.md'), '| 0001 | [First](0001-first.md) | proposed |\n');
      git(dev, 'add', '-A');
      git(dev, 'commit', '-q', '-m', 'Propose a record (#2)');
      const head = git(dev, 'rev-parse', 'HEAD');
      const { work } = origin(dev, { 'refs/pull/1/head': 'pr' });
      const server = await pull(head);
      const got = await run(work, server);
      assert.deepEqual(got, { code: 0, stdout: 'docs/decisions: 0 problems\n', stderr: '' });
      assert.equal(server.requests.length, 3);
      for (const request of server.requests) assert.equal(request.authorization, `Bearer ${TOKEN}`);
    });

    for (const [name, relative, kind] of [
      ['a program of the folder', '.github/record-keeper/record-keeper.mjs', 'code'],
      ['the program that reads the pull request', '.github/record-keeper/check-pull-request.mjs', 'code'],
      ['the program that runs the audit', '.github/record-keeper/run-audit.mjs', 'code'],
      ['the workflow of the check', '.github/workflows/records-integrity.yml', 'workflow'],
      ['the workflow of the audit', '.github/workflows/records-audit.yml', 'workflow'],
    ]) {
      test(`a change to ${name} needs the owners' approval, and an owner's review of the head meets it`, async () => {
        const dev = adopted();
        git(dev, 'checkout', '-q', '-b', 'pr');
        fs.appendFileSync(path.join(dev, relative), relative.endsWith('.mjs') ? '// a note\n' : '# a note\n');
        git(dev, 'add', '-A');
        git(dev, 'commit', '-q', '-m', 'Change the check (#2)');
        const head = git(dev, 'rev-parse', 'HEAD');
        const { work } = origin(dev, { 'refs/pull/1/head': 'pr' });
        const without = await run(work, await pull(head));
        assert.equal(without.code, 1, without.stderr);
        assert.equal(without.stdout, '');
        assert.ok(without.stderr.startsWith(`${relative}: needs the owners' approval (${kind})\n`), without.stderr);
        const reviewed = await run(work, await pull(head, [approve(head)]));
        assert.deepEqual(reviewed, { code: 0, stdout: `approvals: 1 of 1 (alice/1001: approved, bob/1002: none)\ndocs/decisions: 0 problems, 1 act approved\n`, stderr: '' });
        const stale = await run(work, await pull(head, [approve('0'.repeat(40))]));
        assert.equal(stale.code, 1, 'a review of another commit does not count');
      });
    }

    test('a change to the settings in the same folder is an act of its own kind', async () => {
      const dev = adopted();
      git(dev, 'checkout', '-q', '-b', 'pr');
      write(dev, SETTINGS_PATH, `${OWNERS}extra-keys: [repos]\n`);
      git(dev, 'add', '-A');
      git(dev, 'commit', '-q', '-m', 'Settings (#2)');
      const head = git(dev, 'rev-parse', 'HEAD');
      const { work } = origin(dev, { 'refs/pull/1/head': 'pr' });
      const got = await run(work, await pull(head));
      assert.equal(got.code, 1);
      assert.ok(got.stderr.startsWith(`${SETTINGS_PATH}: needs the owners' approval (settings)\n`), got.stderr);
      assert.doesNotMatch(got.stderr, /\(code\)/);
    });
  });

  describe('the audit', () => {
    const run = (work, server, ...extra) => exec(['.github/record-keeper/run-audit.mjs', '--repo', 'o/r', ...extra], { cwd: work, env: { GITHUB_TOKEN: TOKEN, GITHUB_API_URL: server.url } });
    const github = (dev, { pulls = {}, issues = [] } = {}) => serve(({ method, path: route }) => {
      if (method === 'GET' && route === '/repos/o/r') return { body: { default_branch: 'main' } };
      let found = /^\/repos\/o\/r\/commits\/([0-9a-f]+)\/pulls$/.exec(route);
      if (method === 'GET' && found) return { body: pulls[found[1]] ?? [] };
      if (method === 'GET' && /^\/repos\/o\/r\/pulls\/\d+\/reviews$/.test(route)) return { body: pulls.reviews ?? [] };
      found = /^\/repos\/o\/r\/commits\/([0-9a-f]+)\/check-runs$/.exec(route);
      if (method === 'GET' && found) return { body: { total_count: 0, check_runs: [] } };
      if (method === 'GET' && /^\/user\/\d+$/.test(route)) return { body: { login: 'someone' } };
      if (method === 'GET' && route === '/repos/o/r/issues') return { body: issues };
      if (method === 'POST' && route === '/repos/o/r/issues') return { status: 201, body: { number: 7 } };
      void dev;
      return undefined;
    });

    test('a history without an act after the adoption is audited, and the log branch is pushed from the folder of the kit', async () => {
      const dev = adopted();
      write(dev, 'docs/decisions/0001-first.md', '---\nstatus: proposed\ndate: 2026-11-17\ndecision-makers:\n  - maintainers\n---\n\n# First\n\n## Context and problem statement\n\nWhy.\n\n## Decision\n\n- Rule.\n\n## Consequences\n\n- Effect.\n');
      fs.appendFileSync(path.join(dev, 'docs/decisions/README.md'), '| 0001 | [First](0001-first.md) | proposed |\n');
      git(dev, 'add', '-A');
      git(dev, 'commit', '-q', '-m', 'Propose a record (#2)');
      const { bare, work } = origin(dev);
      const server = await github(dev);
      const dry = await run(work, server, '--dry-run');
      assert.equal(dry.code, 0, dry.stderr);
      assert.match(dry.stdout, /dry run: nothing was written\n$/);
      assert.equal(server.requests.filter((request) => request.method !== 'GET').length, 0);
      const real = await run(work, server);
      assert.equal(real.code, 0, real.stderr);
      assert.match(real.stdout, /log: the record of the run pushed to record-keeper\/log\n$/);
      assert.match(git(bare, 'show', 'refs/heads/record-keeper/log:last-run.json'), /"violations":0/);
    });

    test('the commit that the release workflow pushes, the changelog and the version, is no act and no breach', async () => {
      const dev = adopted();
      write(dev, 'CHANGELOG.md', '# Changelog\n\n## [v1.0.0] - 2026-11-17\n\n- a change\n');
      write(dev, 'package.json', '{\n  "name": "record-keeper",\n  "version": "1.0.0",\n  "private": true\n}\n');
      git(dev, 'add', '-A');
      git(dev, 'commit', '-q', '-m', 'chore: release v1.0.0');
      const { work } = origin(dev);
      const server = await github(dev);
      const got = await run(work, server, '--dry-run');
      assert.equal(got.code, 0, got.stdout + got.stderr);
      assert.match(got.stdout, /dry run: nothing was written\n$/);
      assert.deepEqual(server.requests.filter((request) => /\/commits\//.test(request.path)), [], 'no evidence is asked for a commit without an act');
      assert.doesNotMatch(got.stdout + got.stderr, /A-0\d/);
    });

    test('an act after the adoption that the owners approved is announced, from the folder of the kit', async () => {
      const dev = adopted();
      fs.appendFileSync(path.join(dev, '.github/workflows/records-audit.yml'), '# a note\n');
      git(dev, 'add', '-A');
      git(dev, 'commit', '-q', '-m', 'Note in the audit workflow (#2)');
      const head = git(dev, 'rev-parse', 'HEAD');
      const { work } = origin(dev);
      const pulls = { [head]: [{ number: 2, user: { id: AUTHOR }, head: { sha: head }, merged_at: '2026-11-17T10:00:00Z', merge_commit_sha: head, base: { ref: 'main' }, state: 'closed' }], reviews: [approve(head)] };
      const server = await github(dev, { pulls });
      const got = await run(work, server);
      assert.equal(got.code, 0, got.stderr);
      assert.match(got.stdout, /^announced [0-9a-f]{40} #7$/m);
      const posts = server.requests.filter((request) => request.method === 'POST');
      assert.equal(posts.length, 1);
      assert.match(posts[0].body.title, /^Act: workflow \(#2\)$/);
      assert.match(posts[0].body.body, /Acts: workflow \.github\/workflows\/records-audit\.yml/);
      assert.match(posts[0].body.body, /@someone/);
    });

    test('an act that nobody approved is a violation, and the run fails', async () => {
      const dev = adopted();
      fs.appendFileSync(path.join(dev, '.github/record-keeper/run-audit.mjs'), '// a note\n');
      git(dev, 'add', '-A');
      git(dev, 'commit', '-q', '-m', 'Note in the audit program (#2)');
      const head = git(dev, 'rev-parse', 'HEAD');
      const { work } = origin(dev);
      const pulls = { [head]: [{ number: 2, user: { id: AUTHOR }, head: { sha: head }, merged_at: '2026-11-17T10:00:00Z', merge_commit_sha: head, base: { ref: 'main' }, state: 'closed' }], reviews: [] };
      const got = await run(work, await github(dev, { pulls }), '--dry-run');
      assert.equal(got.code, 1, got.stdout + got.stderr);
      assert.match(got.stdout + got.stderr, /A-03/);
      assert.match(got.stdout + got.stderr, /\.github\/record-keeper\/run-audit\.mjs/);
    });
  });
});
