// The setup check at work, whole runs (docs/setup-check.md): a repository that has everything wrong at once, a repository that installed the real files of this kit, and
// the repository of the kit itself, each from the answers that a server gives in the shapes of the real API. The reads and the files one by one are in the files next
// to this one. Nothing reaches the network, and every working tree is made in a folder of its own.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  COMMIT, REQUIRES, branchByProtection, check, cleanUp, commitOf, healthy, hoursAgo, installed, lastRunText, others, releaseOf, requiring, ruleset, serve, tree, write,
} from './setup-check-world.mjs';
import { renderPin } from '../updater.mjs';

after(cleanUp);

const root = fileURLToPath(new URL('..', import.meta.url));
const install = JSON.parse(fs.readFileSync(path.join(root, 'install.json'), 'utf8'));
const managed = install.files.filter((file) => file.kind === 'managed');

describe('a repository with everything wrong at once', () => {
  test('every severity, in the order of the checks, and the run fails', async () => {
    const state = healthy();
    state.rules = [...others(4101), requiring(4101, { strict: false, checks: ['Test gate'] })];
    state.branchBody = branchByProtection('main', ['Test gate']);
    state.users = new Map([[1001, 'carol']]);
    state.lastRun = lastRunText(hoursAgo(120));
    state.releases = [releaseOf('v1.0.0', undefined, { requires: { ...REQUIRES } })];
    await serve(state);
    const files = installed();
    delete files['.github/CODEOWNERS'];
    delete files['.github/workflows/records-audit.yml'];
    files['.github/record-keeper/record-keeper.mjs'] = '// edited\n';
    files['.github/record-keeper/settings.yml'] = 'owners: [alice/1001]\napprovals: 1\n';
    const dir = tree(files);
    const got = await check(state, dir, { env: { HAS_RECORD_KEEPER_TOKEN: 'false' } });
    assert.equal(got.code, 1);
    assert.deepEqual(got.found, [
      'check-not-required main',
      'audit-dead the last run was at 2026-11-13T12:00:00Z, more than two days ago',
      'owner-mismatch alice/1001: GitHub says carol',
      'codeowners-missing',
      'managed-differs .github/record-keeper/record-keeper.mjs (differs), .github/workflows/records-audit.yml (missing)',
      'secret-not-set',
      'audit-workflow-missing',
    ]);
    assert.deepEqual(got.report.findings.map((finding) => finding.severity), ['error', 'error', 'warning', 'warning', 'warning', 'warning', 'warning']);
    assert.deepEqual(got.report.passed, ['settings', 'owners', 'pin', 'manifest']);
  });

  test('nothing is dead that was not asked about: no record, no workflow, no age', async () => {
    const state = healthy();
    state.lastRun = null;
    await serve(state);
    const files = installed();
    delete files['.github/workflows/records-audit.yml'];
    const got = await check(state, tree(files));
    assert.equal(got.code, 0);
    assert.deepEqual(got.found, ['managed-differs .github/workflows/records-audit.yml (missing)', 'audit-workflow-missing']);
  });
});

describe('a repository that installed the real files of this kit', () => {
  const files = Object.fromEntries(managed.map((entry) => [entry.path, fs.readFileSync(path.join(root, entry.source), 'utf8')]));

  test('every managed file of the install set is the release\'s, and is found so: the sizes and the digests are those of the files', async () => {
    const state = healthy();
    state.releases = [releaseOf('v1.0.0', files)];
    await serve(state);
    const dir = tree({ ...installed(), ...files });
    const got = await check(state, dir);
    assert.deepEqual(got.found, []);
    assert.deepEqual(got.report.passed.filter((topic) => ['manifest', 'managed-files'].includes(topic)), ['manifest', 'managed-files']);
  });

  test('a file that is edited by one character is found, whichever file it is', async () => {
    const state = healthy();
    state.releases = [releaseOf('v1.0.0', files)];
    await serve(state);
    for (const entry of managed) {
      const dir = tree({ ...installed(), ...files, [entry.path]: `${files[entry.path]} ` });
      assert.deepEqual((await check(state, dir)).found, [`managed-differs ${entry.path} (differs)`], entry.path);
    }
  });

  test('the install set lists the program and the workflow of the setup check, so that a release has them to compare', () => {
    assert.ok(managed.some((entry) => entry.path === '.github/record-keeper/setup-check.mjs'));
    assert.ok(managed.some((entry) => entry.path === '.github/workflows/records-setup-check.yml'));
    assert.deepEqual(install.requires.secrets, ['RECORD_KEEPER_TOKEN']);
  });
});

describe('the repository of the kit itself, as the real API answered for it', () => {
  // The shapes are those that were read from the real API (docs/setup-check.md); the names and the numbers are made up.
  async function kit(change = () => {}) {
    const state = healthy();
    state.rules = [...others(26507), requiring(26507, { strict: true, checks: ['Records integrity', 'Test gate'] })];
    state.rulesets = new Map([[26507, ruleset(26507, { name: 'main-branch-protection' })]]);
    state.users = new Map([[2801, 'maintainer-one'], [3485, 'maintainer-two']]);
    state.lastRun = lastRunText(hoursAgo(2), { from: null });
    state.commits = [commitOf(hoursAgo(145))];
    change(state);
    await serve(state);
    const dir = tree({ '.github/record-keeper/settings.yml': 'owners: [maintainer-one/2801, maintainer-two/3485]\napprovals: 1\n', 'install.json': '{}\n', 'setup-check.mjs': '// the program\n', '.github/workflows/records-audit.yml': 'name: Records audit\n' });
    return { state, dir };
  }

  test('with the settings that it has, it says that it has no CODEOWNERS, and nothing of the single-owner mode or of the pin, and fails on nothing', async () => {
    const { state, dir } = await kit();
    const got = await check(state, dir);
    assert.equal(got.code, 0);
    assert.deepEqual(got.found, ['codeowners-missing']);
    assert.deepEqual(got.report.notLookedAt.map((item) => item.topic), ['own']);
    assert.deepEqual(got.report.passed, ['settings', 'owners', 'owner-accounts', 'check-required', 'check-strict', 'bypass', 'audit-workflow', 'audit']);
    assert.deepEqual(state.requests.filter((request) => request.path.includes('/example/kit/')), [], 'the kit does not ask for its own release');
  });

  test('with --local, the same without GitHub', async () => {
    const { dir } = await kit();
    write(dir, '.github/CODEOWNERS', '/.github/ @maintainer-one @maintainer-two\n');
    const got = await check(healthy(), dir, { argv: ['--local'] });
    assert.deepEqual(got.found, ['not-checked github: the command line says --local']);
    assert.deepEqual(got.report.notLookedAt.map((item) => item.topic), ['own']);
  });

  test('a ruleset that does not require the check, and an audit that stopped, fail it', async () => {
    const { state, dir } = await kit((s) => { s.rules = others(26507); s.lastRun = lastRunText(hoursAgo(60)); });
    const got = await check(state, dir);
    assert.equal(got.code, 1);
    assert.deepEqual(got.report.findings.filter((finding) => finding.severity === 'error').map((finding) => finding.code), ['check-not-required', 'audit-dead']);
  });
});

void COMMIT;
void renderPin;
