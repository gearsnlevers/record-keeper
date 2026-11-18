// The setup check at work, the files (docs/setup-check.md): what the runner reads from the working tree and what each state of each file becomes, with `--local` and
// against a local server that plays GitHub. Every working tree is made in a folder of its own; nothing reads or writes the real working tree or the real home.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCli } from '../setup-check.mjs';
import { renderPin } from '../updater.mjs';
import {
  COMMIT, FILES, NOW, REQUIRES, actions, check, cleanUp, folder, healthy, installed, releaseOf, reads, serve, tree, write,
} from './setup-check-world.mjs';

after(cleanUp);

const root = fileURLToPath(new URL('..', import.meta.url));
const SETTINGS = '.github/record-keeper/settings.yml';
const PIN = '.github/record-keeper.yml';
const AUDIT = '.github/workflows/records-audit.yml';

/** A repository as it should be, served, with a tree that `change` has changed (a path set to `null` is removed). */
async function repository(change = {}, { local = false, state = healthy() } = {}) {
  await serve(state);
  const files = { ...installed(), ...change };
  for (const [relative, content] of Object.entries(files)) if (content === null) delete files[relative];
  const dir = tree(files);
  const got = () => check(state, dir, local ? { argv: ['--local'] } : {});
  return { state, dir, got };
}
/** The findings, other than the notice that GitHub was not asked, and the findings that a healthy repository has none of. */
const said = async (change, options) => (await (await repository(change, options)).got()).found;

describe('--local: the files are read, and GitHub is not asked', () => {
  test('a repository that is as it should be: the files are fine, and the rest is said once to be not checked', async () => {
    const { state, got } = await repository({}, { local: true });
    const result = await got();
    assert.equal(result.code, 0);
    assert.deepEqual(result.found, ['not-checked github: the command line says --local']);
    assert.deepEqual(result.report.passed, ['settings', 'owners', 'codeowners', 'pin']);
    assert.deepEqual(result.asked, []);
    assert.deepEqual(reads(state), []);
  });

  test('it needs no repository, no token and no address: nothing is read from them', async () => {
    const dir = tree();
    const got = await runCli(['--local', '--root', dir, '--json'], {}, { fetch: () => { throw new Error('a request'); }, now: () => NOW });
    assert.equal(got.code, 0, got.stderr);
    assert.equal(JSON.parse(got.stdout).repository, null);
    assert.equal(JSON.parse(got.stdout).findings.length, 1);
  });

  test('the kit\'s own repository has no pin and nothing installed, and is told so and not asked for them', async () => {
    const files = installed();
    delete files[PIN];
    delete files['.github/CODEOWNERS'];
    for (const relative of Object.keys(FILES)) delete files[relative];
    const dir = tree({ ...files, 'install.json': '{}\n' });
    const got = await runCli(['--local', '--root', dir, '--json'], {}, { now: () => NOW });
    assert.deepEqual(JSON.parse(got.stdout).findings.map((finding) => `${finding.code} ${finding.detail.split(':')[0]}`.trim()), ['codeowners-missing', 'not-checked github']);
    assert.deepEqual(JSON.parse(got.stdout).notLookedAt.map((item) => item.topic), ['own']);
  });

  test('the default root is the working directory, and a root that is not there is a failure of the run', async () => {
    const dir = tree();
    const run = spawnSync(process.execPath, [path.join(root, 'setup-check.mjs'), '--local', '--json'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout).passed, ['settings', 'owners', 'codeowners', 'pin']);
    const absent = await runCli(['--local', '--root', path.join(dir, 'nowhere')], {}, { now: () => NOW });
    assert.equal(absent.code, 0, 'a root that is not there is a repository with nothing in it');
    assert.match(absent.stdout, /warning: \[settings-missing\]/);
  });
});

describe('the settings file', () => {
  const owners = (text) => ({ [SETTINGS]: text });

  test('there is none: it is said, and nobody is asked about', async () => {
    const { state, got } = await repository({ [SETTINGS]: null });
    const result = await got();
    assert.deepEqual(result.found, ['settings-missing']);
    assert.equal(state.requests.some((request) => request.path.startsWith('/user/')), false);
    assert.deepEqual(result.report.passed.filter((topic) => ['settings', 'owners', 'owner-accounts'].includes(topic)), []);
  });

  test('it is not a regular file of text: a folder, a link, a file that is too large, bytes that are not UTF-8, a byte order mark, a control character', async () => {
    const dir = tree({ ...installed(), [SETTINGS]: null });
    const cases = {
      folder: () => fs.mkdirSync(path.join(dir, SETTINGS), { recursive: true }),
      link: () => { write(dir, 'real.yml', 'owners: [alice/1001]\n'); fs.symlinkSync(path.join(dir, 'real.yml'), path.join(dir, SETTINGS)); },
      large: () => write(dir, SETTINGS, `${'# x\n'.repeat(20000)}owners: [alice/1001]\n`),
      binary: () => write(dir, SETTINGS, Buffer.from([0x6f, 0xff, 0x3a])),
      bom: () => write(dir, SETTINGS, '\ufeffowners: [alice/1001]\n'),
      control: () => write(dir, SETTINGS, 'owners: [alice/1001]\n\u0001\n'),
      separator: () => write(dir, SETTINGS, 'owners: [alice/1001] # x\u2028y\n'),
    };
    for (const [name, make] of Object.entries(cases)) {
      fs.rmSync(path.join(dir, SETTINGS), { recursive: true, force: true });
      make();
      const got = await runCli(['--local', '--root', dir, '--json'], {}, { now: () => NOW });
      const found = JSON.parse(got.stdout).findings.map((finding) => `${finding.code} ${finding.detail}`);
      assert.deepEqual(found.filter((line) => line.startsWith('settings')), ['settings-unusable not a regular file of text'], name);
      assert.ok(!found.some((line) => line.startsWith('owners-few') || line.startsWith('single-owner')), `${name}: the owners are not judged`);
    }
  });

  test('a file of exactly 64 KiB is read, and one byte more is not', async () => {
    const head = 'owners: [alice/1001, bob/1002]\n';
    const fill = (size) => `${head}${'#'.repeat(size - head.length - 1)}\n`;
    assert.deepEqual(await said(owners(fill(64 * 1024))), []);
    assert.deepEqual(await said(owners(fill(64 * 1024 + 1))), ['settings-unusable not a regular file of text']);
  });

  test('a problem in a line: the first one is said, and the owners that could be read are judged', async () => {
    assert.deepEqual(await said(owners('owners: [alice/1001, bob/1002]\napprovals: 2\nnonsense: 1\n')), ['settings-unusable S-05 at line 3']);
    assert.deepEqual(await said(owners('owners: [alice/1001, bob/1002]\napprovals: two\nextra-keys\n')), ['settings-unusable S-07 at line 2 and 1 more']);
  });

  test('an owner that is not an owner, so that the list is what the kit reads: none', async () => {
    assert.deepEqual(await said(owners('owners: [alice]\n')), ['settings-unusable S-07 at line 1', 'owners-few 0 listed, 2 needed']);
  });

  test('fewer owners than approvals needs, and the single-owner mode', async () => {
    assert.deepEqual(await said(owners('owners: [alice/1001]\n')), ['owners-few 1 listed, 2 needed']);
    assert.deepEqual(await said(owners('# no owner yet\n')), ['owners-few 0 listed, 2 needed']);
    assert.deepEqual(await said(owners('owners: [alice/1001]\napprovals: 1\n')), [], 'the single-owner mode is not said on a schedule');
    assert.deepEqual(await said(owners('owners: [alice/1001, bob/1002]\napprovals: 1\nwitnesses: [carol/1003]\n')), []);
  });

  test('the single-owner mode is not said with --local either, nor with the environment of a pull request when the base is not asked for', async () => {
    const dir = tree({ ...installed(), [SETTINGS]: 'owners: [alice/1001]\napprovals: 1\n' });
    for (const env of [{}, { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' }]) {
      const got = await runCli(['--local', '--root', dir, '--json'], env, { now: () => NOW, fetch: () => { throw new Error('a request'); } });
      assert.ok(!JSON.parse(got.stdout).findings.some((finding) => finding.code === 'single-owner'), JSON.stringify(env));
    }
  });

  test('a file that cannot be read is a failure of the run, said in a line', { skip: process.getuid?.() === 0 ? 'the user can read everything' : false }, async () => {
    const dir = tree();
    fs.chmodSync(path.join(dir, SETTINGS), 0o000);
    const got = await runCli(['--local', '--root', dir], {}, { now: () => NOW });
    fs.chmodSync(path.join(dir, SETTINGS), 0o644);
    assert.equal(got.code, 2);
    assert.equal(got.stdout, '');
    assert.match(got.stderr, /^setup-check: failed: open .*settings\.yml failed: EACCES\n$/);
  });
});

describe('the pin', () => {
  test('there is none, or it is not what the updater reads: the refusal of the updater is the detail', async () => {
    assert.deepEqual(await said({ [PIN]: null }), ['pin-missing']);
    const refused = {
      'pin-line': 'source: example/kit\nnonsense\n',
      'pin-key': 'source: example/kit\nversion: v1.0.0\ncommit: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nchannel: stable\nextra: x\n',
      'pin-duplicate': 'source: example/kit\nsource: example/kit\n',
      'pin-value': 'source: example/kit\nversion: 1.0.0\n',
      'pin-missing': 'source: example/kit\n',
    };
    for (const [code, text] of Object.entries(refused)) assert.deepEqual(await said({ [PIN]: text }, { local: true }), [`pin-unusable ${code}`, 'not-checked github: the command line says --local'], code);
  });

  test('it is a folder, a link or too large: pin-text', async () => {
    const dir = tree({ ...installed(), [PIN]: null });
    fs.mkdirSync(path.join(dir, PIN));
    assert.deepEqual(JSON.parse((await runCli(['--local', '--root', dir, '--json'], {}, { now: () => NOW })).stdout).findings.map((finding) => finding.detail).filter((detail) => detail.startsWith('pin')), ['pin-text']);
    fs.rmdirSync(path.join(dir, PIN));
    write(dir, PIN, `# ${'x'.repeat(70 * 1024)}\n`);
    assert.deepEqual(JSON.parse((await runCli(['--local', '--root', dir, '--json'], {}, { now: () => NOW })).stdout).findings.map((finding) => finding.detail).filter((detail) => detail.startsWith('pin')), ['pin-text']);
  });

  test('a pin that is read is fine, and a channel that is the other one is no matter', async () => {
    const pin = renderPin({ source: 'example/kit', version: 'v1.0.0', commit: COMMIT, channel: 'prerelease' });
    assert.deepEqual(await said({ [PIN]: pin }), []);
  });
});

describe('CODEOWNERS', () => {
  const located = async (files) => {
    const { got } = await repository({ '.github/CODEOWNERS': null, ...files }, { local: true });
    return (await got()).found.filter((line) => /^(codeowners|not-checked codeowners)/.test(line));
  };
  const COVERS = '/.github/ @alice\n';
  const NOT = '/docs/ @alice\n';

  test('the first of the three places that has a file is the file, and the others are not read', async () => {
    assert.deepEqual(await located({ '.github/CODEOWNERS': COVERS, CODEOWNERS: NOT, 'docs/CODEOWNERS': NOT }), []);
    assert.deepEqual(await located({ CODEOWNERS: COVERS, 'docs/CODEOWNERS': NOT }), []);
    assert.deepEqual(await located({ 'docs/CODEOWNERS': COVERS }), []);
    assert.deepEqual(await located({ '.github/CODEOWNERS': NOT, CODEOWNERS: COVERS, 'docs/CODEOWNERS': COVERS }), ['codeowners-uncovered .github/record-keeper/settings.yml, .github/record-keeper.yml, .github/workflows/records-integrity.yml, .github/workflows/records-audit.yml, .github/workflows/records-setup-check.yml, .github/workflows/records-updater.yml']);
  });

  test('no file in any of the three places', async () => {
    assert.deepEqual(await located({}), ['codeowners-missing']);
  });

  test('a place that holds a folder, a link or a file that is too large is the file, and it is not read: the others are not tried', async () => {
    const folderCase = await repository({ '.github/CODEOWNERS': null, CODEOWNERS: COVERS }, { local: true });
    fs.mkdirSync(path.join(folderCase.dir, '.github/CODEOWNERS'));
    assert.deepEqual((await folderCase.got()).found.filter((line) => line.startsWith('not-checked codeowners')), ['not-checked codeowners: .github/CODEOWNERS is not a small file of text']);
    const linkCase = await repository({ '.github/CODEOWNERS': null }, { local: true });
    write(linkCase.dir, 'elsewhere', COVERS);
    fs.symlinkSync(path.join(linkCase.dir, 'elsewhere'), path.join(linkCase.dir, 'CODEOWNERS'));
    assert.deepEqual((await linkCase.got()).found.filter((line) => line.startsWith('not-checked codeowners')), ['not-checked codeowners: CODEOWNERS is not a small file of text']);
    const large = await repository({ '.github/CODEOWNERS': `${'# x\n'.repeat(300000)}${COVERS}` }, { local: true });
    assert.deepEqual((await large.got()).found.filter((line) => line.startsWith('not-checked codeowners')), ['not-checked codeowners: .github/CODEOWNERS is not a small file of text']);
  });

  test('a file that is not text, or has a control character, a byte order mark or a line separator in it, is not read', async () => {
    for (const content of [Buffer.from([0x2f, 0xff, 0x20, 0x40, 0x61]), `${COVERS}\u0000`, `\ufeff${COVERS}`, `${COVERS}# a\u2028b\n`, `${COVERS}\u001b[31m\n`, `${COVERS}\u007f`]) {
      assert.deepEqual(await located({ '.github/CODEOWNERS': content }), ['not-checked codeowners: .github/CODEOWNERS is not a small file of text'], JSON.stringify(String(content).slice(0, 20)));
    }
  });

  test('every control character, the separators and the byte order mark make a file that is not read, and the characters next to them do not', async () => {
    const refused = [...Array(0x20).keys()].filter((code) => ![0x09, 0x0a, 0x0d].includes(code)).concat([0x7f, 0x2028, 0x2029, 0xfeff]);
    for (const code of refused) assert.deepEqual(await located({ '.github/CODEOWNERS': `${COVERS}# a${String.fromCharCode(code)}b\n` }), ['not-checked codeowners: .github/CODEOWNERS is not a small file of text'], `U+${code.toString(16)}`);
    for (const code of [0x09, 0x0a, 0x0d, 0x20, 0x7e, 0x80, 0x9f, 0xa0, 0xe9, 0x2027, 0x202a, 0xfffd]) assert.deepEqual(await located({ '.github/CODEOWNERS': `${COVERS}# a${String.fromCharCode(code)}b\n` }), [], `U+${code.toString(16)}`);
  });

  test('a file of exactly 1 MiB is read, and one byte more is not', async () => {
    const fill = (size) => `${COVERS}${'#'.repeat(size - COVERS.length - 1)}\n`;
    assert.deepEqual(await located({ '.github/CODEOWNERS': fill(1024 * 1024) }), []);
    assert.deepEqual(await located({ '.github/CODEOWNERS': fill(1024 * 1024 + 1) }), ['not-checked codeowners: .github/CODEOWNERS is not a small file of text']);
  });

  test('tabs, carriage returns, comments and blank lines are what a file has', async () => {
    assert.deepEqual(await located({ '.github/CODEOWNERS': `# who\r\n\r\n\t/.github/\t@alice\t# the kit\r\n` }), []);
  });

  test('a line that is not read is the first one that is said, with its number', async () => {
    assert.deepEqual(await located({ '.github/CODEOWNERS': `${COVERS}\n/a[bc] @alice\n!x @alice\n` }), ['not-checked codeowners: .github/CODEOWNERS line 3: a pattern with \\, [, ] or ?']);
  });

  test('which of the files of the kit are given an owner', async () => {
    assert.deepEqual(await located({ '.github/CODEOWNERS': '* @alice\n' }), []);
    assert.deepEqual(await located({ '.github/CODEOWNERS': '/.github/workflows/records-*.yml @alice\n/.github/record-keeper.yml @alice\n/.github/record-keeper/ @alice\n' }), []);
    assert.deepEqual(await located({ '.github/CODEOWNERS': '/.github/workflows/records-*.yml @alice\n/.github/record-keeper.yml @alice\n' }), ['codeowners-uncovered .github/record-keeper/settings.yml']);
    assert.deepEqual(await located({ '.github/CODEOWNERS': '/.github/ @alice\n/.github/workflows/records-updater.yml\n' }), ['codeowners-uncovered .github/workflows/records-updater.yml']);
  });
});

describe('the files that the release installed', () => {
  const differing = async (change, state) => (await (await repository(change, { state })).got()).found.filter((line) => line.startsWith('managed'));
  const RK = '.github/record-keeper/record-keeper.mjs';

  test('a file that differs by a byte, by a line ending, by a character at the end', async () => {
    assert.deepEqual(await differing({ [RK]: '// rules 2\n' }), [`managed-differs ${RK} (differs)`]);
    assert.deepEqual(await differing({ [RK]: '// rules 1\r\n' }), [`managed-differs ${RK} (differs)`]);
    assert.deepEqual(await differing({ [RK]: '// rules 1' }), [`managed-differs ${RK} (differs)`]);
    assert.deepEqual(await differing({ [RK]: '// rules 1\n\n' }), [`managed-differs ${RK} (differs)`]);
    assert.deepEqual(await differing({ [RK]: '' }), [`managed-differs ${RK} (differs)`]);
  });

  test('a file that is missing, and a folder or a link where it should be', async () => {
    assert.deepEqual(await differing({ [RK]: null }), [`managed-differs ${RK} (missing)`]);
    const folderCase = await repository({ [RK]: null });
    fs.mkdirSync(path.join(folderCase.dir, RK));
    assert.deepEqual((await folderCase.got()).found.filter((line) => line.startsWith('managed')), [`managed-differs ${RK} (not a file)`]);
    const linkCase = await repository({ [RK]: null });
    write(linkCase.dir, 'copy.mjs', FILES[RK]);
    fs.symlinkSync(path.join(linkCase.dir, 'copy.mjs'), path.join(linkCase.dir, RK));
    assert.deepEqual((await linkCase.got()).found.filter((line) => line.startsWith('managed')), [`managed-differs ${RK} (not a file)`], 'a link is not followed, even to a file that is right');
  });

  test('a file under a link, or under a file, is not a file either', async () => {
    const dir = tree({ ...installed(), '.github/record-keeper/record-keeper.mjs': null, '.github/record-keeper/setup-check.mjs': null });
    write(dir, 'elsewhere/record-keeper.mjs', FILES[RK]);
    fs.rmSync(path.join(dir, '.github/record-keeper'), { recursive: true });
    fs.symlinkSync(path.join(dir, 'elsewhere'), path.join(dir, '.github/record-keeper'));
    const state = healthy();
    await serve(state);
    const got = await check(state, dir);
    assert.ok(got.found.some((line) => line.startsWith('managed-differs') && line.includes(`${RK} (not a file)`)), got.found.join(' | '));
  });

  test('several files: the paths are in the order of their bytes, and only the first eight are listed', async () => {
    const state = healthy();
    const names = Array.from({ length: 11 }, (_, i) => `.github/record-keeper/p${String(i).padStart(2, '0')}.mjs`);
    state.releases = [releaseOf('v1.0.0', { ...FILES, ...Object.fromEntries(names.map((name) => [name, `// ${name}\n`])) })];
    const got = await differing({}, state);
    assert.deepEqual(got, [`managed-differs ${names.slice(0, 8).map((name) => `${name} (missing)`).join(', ')}, and 3 more`]);
  });

  test('a file of the tree that the release does not list is not looked for, and a template that differs is not compared', async () => {
    const state = healthy();
    state.releases = [releaseOf('v1.0.0', FILES, { mutate: (manifest) => manifest.files.push({ kind: 'template', path: SETTINGS, sha256: 'f'.repeat(64), size: 3, source: 'templates/settings.yml' }) })];
    assert.deepEqual(await differing({ '.github/record-keeper/extra.mjs': '// not in the release\n', '.github/workflows/records-other.yml': 'name: x\n' }, state), []);
  });

  test('the files of a release are the ones that are compared: the pinned one, and not the newest', async () => {
    const state = healthy();
    state.releases = [releaseOf('v1.1.0', { ...FILES, '.github/record-keeper/record-keeper.mjs': '// rules 2\n' }, { assetId: 701 }), ...state.releases];
    assert.deepEqual(await differing({}, state), []);
  });

  test('with no release that can be read, the files are not compared and nothing is said of them', async () => {
    const state = healthy();
    state.releases = [];
    assert.deepEqual(await differing({ [RK]: '// edited\n' }, state), []);
  });
});

describe('the audit workflow, and the repository of the kit', () => {
  test('the audit workflow is not a file: it is absent, a folder or a link', async () => {
    assert.deepEqual((await said({ [AUDIT]: null })).filter((line) => line.startsWith('audit-workflow')), ['audit-workflow-missing']);
    const folderCase = await repository({ [AUDIT]: null });
    fs.mkdirSync(path.join(folderCase.dir, AUDIT));
    assert.deepEqual((await folderCase.got()).found.filter((line) => line.startsWith('audit-workflow')), ['audit-workflow-missing not a file']);
    const linkCase = await repository({ [AUDIT]: null });
    write(linkCase.dir, 'a.yml', FILES[AUDIT]);
    fs.symlinkSync(path.join(linkCase.dir, 'a.yml'), path.join(linkCase.dir, AUDIT));
    assert.deepEqual((await linkCase.got()).found.filter((line) => line.startsWith('audit-workflow')), ['audit-workflow-missing not a file']);
  });

  test('install.json at the root makes it the repository of the kit: no pin is asked for, and no release is read', async () => {
    const { state, dir } = await repository({ [PIN]: null });
    write(dir, 'install.json', '{}\n');
    const got = await check(state, dir);
    assert.deepEqual(got.found, []);
    assert.deepEqual(got.report.notLookedAt.map(({ topic, why }) => ({ topic, why })), [{ topic: 'own', why: 'this is the repository of the kit: install.json is at its root' }]);
    assert.equal(state.requests.some((request) => request.path.includes('/example/kit/')), false);
    assert.deepEqual(got.report.passed.filter((topic) => ['pin', 'manifest', 'managed-files', 'secret'].includes(topic)), []);
  });

  test('the kit\'s own repository is not asked for the release of a pin that it has all the same', async () => {
    const { state, dir } = await repository();
    write(dir, 'install.json', '{}\n');
    const got = await check(state, dir);
    assert.deepEqual(got.found, []);
    assert.deepEqual(got.report.notLookedAt.map((item) => item.topic), ['own']);
    assert.equal(state.requests.some((request) => request.path.includes('/example/kit/')), false);
  });

  test('install.json that is a folder does not make it so', async () => {
    const { state, dir } = await repository({ [PIN]: null });
    fs.mkdirSync(path.join(dir, 'install.json'));
    assert.deepEqual((await check(state, dir)).found, ['pin-missing']);
  });

  test('the kit\'s own repository is still told what is wrong with its settings, its CODEOWNERS and the rules of its default branch', async () => {
    const { state, dir } = await repository({ [PIN]: null, '.github/CODEOWNERS': null, [SETTINGS]: 'owners: [alice/1001]\napprovals: 1\n' });
    write(dir, 'install.json', '{}\n');
    state.rules = [];
    const got = await check(state, dir);
    assert.equal(got.code, 1);
    assert.deepEqual(got.found, ['check-not-required main', 'codeowners-missing']);
    assert.deepEqual(got.report.notLookedAt.map((item) => item.topic), ['own']);
  });
});

describe('the environment that the workflow gives', () => {
  const secret = async (env, files = {}) => {
    const { got, state, dir } = await repository(files);
    void got;
    return (await check(state, dir, { env })).found;
  };

  test('the secret of the updater is judged when the release names it, from what the workflow says', async () => {
    assert.deepEqual(await secret({ HAS_RECORD_KEEPER_TOKEN: 'true' }), []);
    assert.deepEqual(await secret({ HAS_RECORD_KEEPER_TOKEN: 'false' }), ['secret-not-set']);
  });

  test('a variable that is missing, empty or not one of the two words says nothing: not checked', async () => {
    for (const value of [undefined, '', 'yes', 'TRUE', 'True', '1', ' true']) {
      assert.deepEqual(await secret({ HAS_RECORD_KEEPER_TOKEN: value }), ['not-checked secret: the workflow did not say whether it is set'], String(value));
    }
  });

  test('a run for a pull request is not judged, whatever the workflow says', async () => {
    for (const value of ['true', 'false']) assert.deepEqual(await secret({ GITHUB_EVENT_NAME: 'pull_request', HAS_RECORD_KEEPER_TOKEN: value }), ['not-checked secret: a run for a pull request is not given the secrets']);
    assert.deepEqual(await secret({ GITHUB_EVENT_NAME: 'workflow_dispatch', HAS_RECORD_KEEPER_TOKEN: 'false' }), ['secret-not-set']);
    assert.deepEqual(await secret({ GITHUB_EVENT_NAME: undefined, HAS_RECORD_KEEPER_TOKEN: 'false' }), ['secret-not-set']);
  });

  test('the release that does not name the secret asks nothing of the workflow', async () => {
    const state = healthy();
    state.releases = [releaseOf('v1.0.0', FILES, { requires: { ...REQUIRES, secrets: [] } })];
    await serve(state);
    const got = await check(state, tree(), { env: { HAS_RECORD_KEEPER_TOKEN: undefined } });
    assert.deepEqual(got.found, []);
  });

  test('the time of the run is the clock, or --now, and an hour is what it is', async () => {
    const state = healthy();
    state.lastRun = `${JSON.stringify({ at: '2020-01-01T00:00:00Z' })}\n`;
    await serve(state);
    const dir = tree();
    const real = await runCli(['--repo', state.repo, '--root', dir, '--json'], actions(state), { fetch: globalThis.fetch });
    assert.deepEqual(JSON.parse(real.stdout).findings.map((finding) => finding.code), ['audit-dead'], 'the clock of this machine is after the first days of 2020');
    const early = await runCli(['--repo', state.repo, '--root', dir, '--json', '--now', '2020-01-02T00:00:00Z'], actions(state), { fetch: globalThis.fetch });
    assert.deepEqual(JSON.parse(early.stdout).findings, []);
    assert.equal(JSON.parse(early.stdout).at, '2020-01-02T00:00:00Z');
    const late = await runCli(['--repo', state.repo, '--root', dir, '--json', '--now', '2020-01-03T00:00:01Z'], actions(state), { fetch: globalThis.fetch });
    assert.deepEqual(JSON.parse(late.stdout).findings.map((finding) => finding.code), ['audit-dead']);
  });
});

void folder;
