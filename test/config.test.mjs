// The settings file (docs/settings.md): the cases of test/fixtures/config as text and as the blob of a commit, and the commands
// `config` and `validate --settings-from`. The repositories are built with `git fast-import`, so nothing is checked out and
// links and submodules can be committed freely.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FORMAT_RULES, SETTINGS_PATH, SETTINGS_RULES, Unreadable, openCommit, parseSettings, readSettings, run } from '../record-keeper.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const formatFixtures = path.join(root, 'test/fixtures/validate');
const { texts, trees } = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/config/cases.json'), 'utf8'));
const page = fs.readFileSync(path.join(root, 'docs/settings.md'), 'utf8');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'record-keeper-config-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const CLEAN = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
const git = (cwd, args, input) => {
  const result = spawnSync('git', args, { cwd, input, env: { ...CLEAN, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
};

const GITLINK = '0123456789012345678901234567890123456789';
const data = (bytes) => Buffer.concat([Buffer.from(`data ${bytes.length}\n`), bytes, Buffer.from('\n')]);

/** A bare repository with one root commit for each tree, on refs/heads/<name>. A tree is a list of [path, mode, content]. */
function buildRepo(dir, commits) {
  git(scratch, ['init', '-q', '--bare', dir]);
  const stream = [];
  for (const [name, entries] of commits) {
    stream.push(Buffer.from(`commit refs/heads/${name}\ncommitter T <t@example.com> 0 +0000\n`), data(Buffer.from('case')), Buffer.from('deleteall\n'));
    for (const [entryPath, mode, content] of entries) {
      if (mode === '160000') stream.push(Buffer.from(`M 160000 ${content} ${entryPath}\n`));
      else stream.push(Buffer.from(`M ${mode} inline ${entryPath}\n`), data(Buffer.from(content)));
    }
  }
  git(dir, ['fast-import', '--quiet'], Buffer.concat(stream));
}

const bytesOf = (c) => (c.hex === undefined ? Buffer.from(c.text, 'utf8') : Buffer.from(c.hex, 'hex'));
const shown = (problems) => problems.map(({ line, rule, detail }) => ({ line: line ?? null, rule, detail }));

function entriesOf(c) {
  return c.files.map((f) => {
    if (f.link !== undefined) return [f.path, '120000', f.link];
    if (f.submodule) return [f.path, '160000', GITLINK];
    return [f.path, f.mode ?? '100644', f.hex === undefined ? f.content : Buffer.from(f.hex, 'hex')];
  });
}

describe('the cases of the settings page, as text', () => {
  for (const c of texts) {
    test(`${c.id}: ${c.expect.problems.length === 0 ? 'no problem' : c.expect.problems.map((p) => p.rule).join(' ')}`, () => {
      const got = parseSettings(bytesOf(c));
      assert.deepEqual(got.settings, c.expect.settings, c.note);
      assert.deepEqual(shown(got.problems), c.expect.problems, c.note);
    });
  }
});

let big;
before(() => {
  big = path.join(scratch, 'big.git');
  buildRepo(big, trees.map((c, i) => [`t${i}`, entriesOf(c)]));
});

describe('the cases of the settings page, as the blob of a commit', () => {
  trees.forEach((c, i) => {
    test(`${c.id}: ${c.expect.problems.length === 0 ? 'no problem' : c.expect.problems.map((p) => p.rule).join(' ')}`, () => {
      const got = readSettings(openCommit(big, `t${i}`));
      assert.deepEqual(got.settings, c.expect.settings, c.note);
      assert.deepEqual(shown(got.problems), c.expect.problems, c.note);
      for (const problem of got.problems) assert.equal(problem.file, SETTINGS_PATH);
    });
  });

  test('read a blob like the text of the same bytes', () => {
    const repo = path.join(scratch, 'blobs.git');
    const sample = texts.filter((c, i) => c.hex !== undefined || c.id.startsWith('s02') || /^ok(13|14|19)-/.test(c.id) || i % 8 === 0);
    buildRepo(repo, sample.map((c, i) => [`x${i}`, [[SETTINGS_PATH, '100644', bytesOf(c)]]]));
    sample.forEach((c, i) => {
      const got = readSettings(openCommit(repo, `x${i}`));
      assert.deepEqual(got.settings, parseSettings(bytesOf(c)).settings, c.id);
      assert.deepEqual(shown(got.problems), shown(parseSettings(bytesOf(c)).problems), c.id);
    });
  });
});

describe('a large settings file', () => {
  test('is read in time that grows with its size, whatever its lines repeat', () => {
    for (const line of ['folder: a\n', "folder: 'a\n", '# c\n']) {
      const start = process.hrtime.bigint();
      const { problems } = parseSettings(Buffer.from(line.repeat(100000)));
      assert.ok(Number(process.hrtime.bigint() - start) / 1e6 < 3000, line);
      assert.equal(problems.length, line.startsWith('#') ? 0 : 100000);
    }
  });
});

describe('the page and the rules', () => {
  test('list the same rules as the code, in order', () => {
    assert.deepEqual([...page.matchAll(/^\| (S-\d\d) \|/gm)].map((m) => m[1]), Object.keys(SETTINGS_RULES));
  });

  test('are all shown by the fixtures', () => {
    const hit = new Set([...texts, ...trees].flatMap((c) => c.expect.problems.map((p) => p.rule)));
    for (const rule of Object.keys(SETTINGS_RULES)) assert.ok(hit.has(rule), rule);
  });

  test('keep the cases apart and explained', () => {
    const ids = [...texts, ...trees].map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const c of [...texts, ...trees]) assert.ok(c.note, c.id);
  });

  test('name the settings that the code reads, with their defaults', () => {
    const defaults = parseSettings(Buffer.alloc(0)).settings;
    assert.deepEqual(defaults, { folder: 'docs/decisions', sharedFolder: 'shared', extraKeys: [], owners: [], approvals: 2 });
    assert.match(page, /\| `folder` \| single \| `docs\/decisions` \|/);
    assert.match(page, /\| `shared-folder` \| single \| `shared` \|/);
    assert.match(page, /\| `extra-keys` \| list \| `\[\]` \|/);
    assert.match(page, /\| `owners` \| list \| `\[\]` \|/);
    assert.match(page, /\| `approvals` \| single \| `2` \|/);
  });

  test('keep the path of the settings file', () => {
    assert.equal(SETTINGS_PATH, '.github/record-keeper/settings.yml');
    assert.ok(page.includes(`\`${SETTINGS_PATH}\``));
  });

  test('keep the template on the page readable by the code, with every key commented out', () => {
    const template = /```yaml\n([^]*?)```/.exec(page)[1];
    const got = parseSettings(Buffer.from(template));
    assert.deepEqual(got.problems, []);
    assert.deepEqual(got.settings, parseSettings(Buffer.alloc(0)).settings);
    const uncommented = parseSettings(Buffer.from(template.replace(/^# /gm, '')));
    assert.deepEqual(uncommented.problems, []);
    assert.deepEqual(uncommented.settings, { folder: 'docs/decisions', sharedFolder: 'shared', extraKeys: [], owners: [], approvals: 2 });
  });
});

describe('reading the settings of a commit', () => {
  const repo = path.join(scratch, 'real');
  const settings = (text) => (d) => {
    fs.mkdirSync(path.join(d, '.github/record-keeper'), { recursive: true });
    fs.writeFileSync(path.join(d, SETTINGS_PATH), text);
  };

  function commitReal(dir, extra = () => {}) {
    fs.rmSync(dir, { recursive: true, force: true });
    git(scratch, ['init', '-q', '-b', 'main', dir]);
    fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
    extra(dir);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'one']);
  }

  test('reads the commit and not the working tree or the index', () => {
    commitReal(repo, settings('folder: docs/adr\n'));
    fs.writeFileSync(path.join(repo, SETTINGS_PATH), 'folder: elsewhere\nwitnesses: [a]\n');
    assert.equal(readSettings(openCommit(repo, 'HEAD')).settings.folder, 'docs/adr');
    git(repo, ['add', '-A']);
    assert.equal(readSettings(openCommit(repo, 'HEAD')).settings.folder, 'docs/adr');
    fs.rmSync(path.join(repo, '.github'), { recursive: true });
    assert.deepEqual(readSettings(openCommit(repo, 'HEAD')).problems, []);
    assert.equal(readSettings(openCommit(repo, 'HEAD')).settings.folder, 'docs/adr');
  });

  test('reads each commit by itself', () => {
    commitReal(repo, settings('folder: docs/adr\n'));
    fs.writeFileSync(path.join(repo, SETTINGS_PATH), 'folder: records\n');
    git(repo, ['commit', '-q', '-am', 'two']);
    assert.equal(readSettings(openCommit(repo, 'HEAD~1')).settings.folder, 'docs/adr');
    assert.equal(readSettings(openCommit(repo, 'HEAD')).settings.folder, 'records');
  });

  test('is not changed by a filter or an attribute of the repository', () => {
    const odd = path.join(scratch, 'attributes.git');
    buildRepo(odd, [['main', [['.gitattributes', '100644', '* working-tree-encoding=UTF-16\n*.yml filter=nope\n'], [SETTINGS_PATH, '100644', 'folder: docs/adr\n']]]]);
    assert.deepEqual(readSettings(openCommit(odd, 'main')), { settings: { folder: 'docs/adr', sharedFolder: 'shared', extraKeys: [], owners: [], approvals: 2 }, problems: [] });
  });

  test('says "not a revision" as Unreadable', () => {
    commitReal(repo);
    assert.throws(() => readSettings(openCommit(repo, 'no-such-revision')), Unreadable);
  });
});

describe('the config command', () => {
  const commit = (name, files) => {
    const dir = path.join(scratch, `cli-${name}`);
    fs.rmSync(dir, { recursive: true, force: true });
    git(scratch, ['init', '-q', '-b', 'main', dir]);
    fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
    for (const [file, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), text);
    }
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'one']);
    return dir;
  };

  test('prints the defaults for a commit without a settings file, and exits 0', () => {
    const dir = commit('none', {});
    assert.deepEqual(run(['config', '--commit', 'HEAD', '--repo', dir]), {
      code: 0,
      stdout: `folder: docs/decisions\nshared-folder: shared\nextra-keys: []\nowners: []\napprovals: 2\n${SETTINGS_PATH}: 0 problems\n`,
      stderr: '',
    });
  });

  test('prints the settings it reads', () => {
    const dir = commit('set', { [SETTINGS_PATH]: 'folder: docs/adr\nshared-folder: core\nextra-keys: [repos, window]\n' });
    assert.deepEqual(run(['config', '--repo', dir, '--commit', 'HEAD']), {
      code: 0,
      stdout: `folder: docs/adr\nshared-folder: core\nextra-keys: [repos, window]\nowners: []\napprovals: 2\n${SETTINGS_PATH}: 0 problems\n`,
      stderr: '',
    });
  });

  test('prints the owners as login/id, in the order of the file, and the number of approvals', () => {
    const dir = commit('owners', { [SETTINGS_PATH]: 'owners: [bob/1002, "1a/7", alice/1001]\napprovals: 1\n' });
    assert.deepEqual(run(['config', '--repo', dir, '--commit', 'HEAD']), {
      code: 0,
      stdout: `folder: docs/decisions\nshared-folder: shared\nextra-keys: []\nowners: [bob/1002, 1a/7, alice/1001]\napprovals: 1\n${SETTINGS_PATH}: 0 problems\n`,
      stderr: '',
    });
  });

  test('prints the settings on stdout and the problems on stderr, and exits 1', () => {
    const dir = commit('bad', { [SETTINGS_PATH]: 'folder: docs/adr\nwitnesses: [a]\nextra-keys: [\'bad key\']\n  stray\n' });
    assert.deepEqual(run(['config', '--commit', 'HEAD', '--repo', dir]), {
      code: 1,
      stdout: 'folder: docs/adr\nshared-folder: shared\nextra-keys: []\nowners: []\napprovals: 2\n',
      stderr: [
        `${SETTINGS_PATH}:2: [S-05] ${SETTINGS_RULES['S-05']} (witnesses)`,
        `${SETTINGS_PATH}:3: [S-07] ${SETTINGS_RULES['S-07']} (bad key)`,
        `${SETTINGS_PATH}:4: [S-03] ${SETTINGS_RULES['S-03']} (  stray)`,
        `${SETTINGS_PATH}: 3 problems`,
      ].join('\n') + '\n',
    });
  });

  test('says S-01 without a line, and counts one problem in the singular', () => {
    const dir = commit('link', {});
    fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
    fs.symlinkSync('x', path.join(dir, '.github/record-keeper'));
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'link']);
    assert.deepEqual(run(['config', '--commit', 'HEAD', '--repo', dir]), {
      code: 1,
      stdout: `folder: docs/decisions\nshared-folder: shared\nextra-keys: []\nowners: []\napprovals: 2\n`,
      stderr: `${SETTINGS_PATH}: [S-01] ${SETTINGS_RULES['S-01']} (.github/record-keeper)\n${SETTINGS_PATH}: 1 problem\n`,
    });
  });

  test('uses the current folder as the repository by default', () => {
    const dir = commit('cwd', { [SETTINGS_PATH]: 'shared-folder: core\n' });
    const result = spawnSync(process.execPath, [path.join(root, 'record-keeper.mjs'), 'config', '--commit', 'HEAD'], { cwd: dir, encoding: 'utf8', env: CLEAN });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^folder: docs\/decisions\nshared-folder: core\n/);
  });

  test('exits 2 for a commit it cannot read, and for options it does not understand', () => {
    const dir = commit('usage', {});
    for (const argv of [['config', '--commit', 'nope', '--repo', dir], ['config', '--commit', 'HEAD', '--repo', path.join(scratch, 'no-repo')]]) {
      const result = run(argv);
      assert.equal(result.code, 2, JSON.stringify(argv));
      assert.match(result.stderr, /^record-keeper: /);
    }
    for (const argv of [['config'], ['config', '--repo', dir], ['config', '--commit'], ['config', '--commit', '--repo', dir], ['config', '--commit', 'HEAD', 'extra'], ['config', '--commit', 'HEAD', '--nope'], ['config', '--commit', '']]) {
      const result = run(argv);
      assert.equal(result.code, 2, JSON.stringify(argv));
      assert.ok(result.stderr.startsWith('Usage:\n'), JSON.stringify(argv));
    }
  });
});

describe('validate --settings-from', () => {
  const dir = path.join(scratch, 'settings-from');
  const copyFolder = (fixture, to) => {
    fs.mkdirSync(path.join(dir, to), { recursive: true });
    for (const name of fs.readdirSync(path.join(formatFixtures, fixture))) fs.copyFileSync(path.join(formatFixtures, fixture, name), path.join(dir, to, name));
  };
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  const commit = (message) => {
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', message]);
    return git(dir, ['rev-parse', 'HEAD']).toString().trim();
  };
  let base;
  let moved;
  let broken;
  before(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    git(scratch, ['init', '-q', '-b', 'main', dir]);
    copyFolder('ok04-extra-key-allowed', 'docs/adr');
    write(SETTINGS_PATH, 'folder: docs/adr\nextra-keys: [repos]\n');
    base = commit('base');
    write(SETTINGS_PATH, 'folder: docs/nowhere\n');
    moved = commit('the pull request moves the folder');
    write(SETTINGS_PATH, 'folder: docs/adr\nwitnesses: [a]\nextra-keys: [repos]\n');
    broken = commit('a settings file with a problem');
  });

  test('takes the folder and the extra keys from the settings of the other commit', () => {
    assert.deepEqual(run(['validate', '--commit', base, '--settings-from', base, '--repo', dir]), { code: 0, stdout: 'docs/adr: 0 problems\n', stderr: '' });
  });

  test('without the settings the same records are not valid, so the settings are what is used', () => {
    const without = run(['validate', '--commit', base, '--repo', dir, 'docs/adr']);
    assert.equal(without.code, 1);
    assert.match(without.stderr, /\[V-13\]/);
  });

  test('judges the first commit by the settings of the second: a head cannot move the folder', () => {
    assert.deepEqual(run(['validate', '--commit', moved, '--settings-from', base, '--repo', dir]), { code: 0, stdout: 'docs/adr: 0 problems\n', stderr: '' });
    const own = run(['validate', '--commit', moved, '--settings-from', moved, '--repo', dir]);
    assert.equal(own.code, 1);
    assert.equal(own.stderr, `docs/nowhere: [V-01] ${FORMAT_RULES['V-01']}\ndocs/nowhere: 1 problem\n`);
  });

  test('reports the problems of the settings first and counts them with the others', () => {
    const result = run(['validate', '--commit', broken, '--settings-from', broken, '--repo', dir]);
    assert.equal(result.code, 1);
    assert.equal(result.stderr, `${SETTINGS_PATH}:2: [S-05] ${SETTINGS_RULES['S-05']} (witnesses)\ndocs/adr: 1 problem\n`);
  });

  test('is wrong usage with a folder, an extra key or a shared folder, and without --commit', () => {
    for (const extra of [['docs/adr'], ['--extra-key', 'repos'], ['--shared-folder', 'core']]) {
      const result = run(['validate', '--commit', base, '--settings-from', base, '--repo', dir, ...extra]);
      assert.equal(result.code, 2, JSON.stringify(extra));
      assert.ok(result.stderr.startsWith('Usage:\n'));
    }
    for (const argv of [['validate', '--settings-from', base, '--repo', dir], ['validate', '--commit', base, '--settings-from'], ['validate', '--commit', base, '--settings-from', '-x']]) {
      const result = run(argv);
      assert.equal(result.code, 2, JSON.stringify(argv));
      assert.ok(result.stderr.startsWith('Usage:\n'));
    }
  });

  test('exits 2 for settings it cannot read from a revision that does not exist', () => {
    const result = run(['validate', '--commit', base, '--settings-from', 'no-such-revision', '--repo', dir]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /^record-keeper: git rev-parse failed/);
  });

  test('leaves the other options as they were: --extra-key adds up', () => {
    const result = run(['validate', '--commit', base, '--repo', dir, 'docs/adr', '--extra-key', 'repos', '--extra-key', 'window']);
    assert.deepEqual(result, { code: 0, stdout: 'docs/adr: 0 problems\n', stderr: '' });
    const without = run(['validate', '--commit', base, '--repo', dir, 'docs/adr', '--extra-key', 'window']);
    assert.equal(without.code, 1);
  });

  test('leaves the other options as they were: the last of a repeated option wins', () => {
    const result = run(['validate', '--commit', moved, '--commit', base, '--repo', dir, 'docs/adr', '--extra-key', 'repos', '--shared-folder', 'a', '--shared-folder', 'core']);
    assert.deepEqual(result, { code: 0, stdout: 'docs/adr: 0 problems\n', stderr: '' });
  });
});
