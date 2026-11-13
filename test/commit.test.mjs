// `validate --commit`: the records folder as it is in a commit (docs/reading-a-commit.md). Every case of the format page is
// also run as a commit, and must give the answer it gives for a folder; the cases of test/fixtures/commit add what only a
// commit can hold. The repositories are built with `git fast-import`, so no file is checked out and modes, links and
// submodules can be set freely.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMMIT_RULES, FORMAT_RULES, Unreadable, openCommit, run, validateCommit } from '../record-keeper.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const formatFixtures = path.join(root, 'test/fixtures/validate');
const { cases: formatCases } = JSON.parse(fs.readFileSync(path.join(formatFixtures, 'cases.json'), 'utf8'));
const { cases: commitCases } = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/commit/cases.json'), 'utf8'));
const page = fs.readFileSync(path.join(root, 'docs/reading-a-commit.md'), 'utf8');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'record-keeper-commit-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const CLEAN = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
const git = (cwd, args, input) => {
  const result = spawnSync('git', args, { cwd, input, env: { ...CLEAN, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
};

const GITLINK = '0123456789012345678901234567890123456789';
const data = (bytes) => Buffer.concat([Buffer.from(`data ${bytes.length}\n`), bytes, Buffer.from('\n')]);

/** A bare repository with one root commit for each tree, on refs/heads/<name>. A tree is a list of [path (Buffer), mode, content]. */
function buildRepo(dir, trees) {
  git(scratch, ['init', '-q', '--bare', dir]);
  const stream = [];
  for (const [name, entries] of trees) {
    stream.push(Buffer.from(`commit refs/heads/${name}\ncommitter T <t@example.com> 0 +0000\n`), data(Buffer.from('case')), Buffer.from('deleteall\n'));
    for (const [entryPath, mode, content] of entries) {
      if (mode === '160000') stream.push(Buffer.concat([Buffer.from(`M 160000 ${content} `), entryPath, Buffer.from('\n')]));
      else stream.push(Buffer.from(`M ${mode} inline `), entryPath, Buffer.from('\n'), data(Buffer.from(content)));
    }
  }
  git(dir, ['fast-import', '--quiet'], Buffer.concat(stream));
}

const listing = (names) => names.map(([p, ...rest]) => [Buffer.from(p), ...rest]);

/** The files of a fixture folder, as { 'relative/path': Buffer }. */
function filesOf(dir) {
  const out = {};
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) out[path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')] = fs.readFileSync(path.join(entry.parentPath, entry.name));
  }
  return out;
}

/** The tree of a case of test/fixtures/commit. */
function treeOf(c) {
  const folder = c.place ?? c.folder;
  const tree = new Map();
  if (c.base !== null) for (const [name, bytes] of Object.entries(filesOf(path.join(formatFixtures, c.base)))) tree.set(`${folder}/${name}`, ['100644', bytes]);
  for (const op of c.changes ?? []) {
    if ('root' in op) {
      if ('target' in op) tree.set(op.root, ['120000', op.target]);
      else if (op.submodule) tree.set(op.root, ['160000', GITLINK]);
      else tree.set(op.root, [op.mode ?? '100644', op.content]);
    } else if ('write' in op) tree.set(`${folder}/${op.write}`, [op.mode ?? '100644', op.content]);
    else if ('symlink' in op) tree.set(`${folder}/${op.symlink}`, ['120000', op.target]);
    else if ('submodule' in op) tree.set(`${folder}/${op.submodule}`, ['160000', GITLINK]);
    else if ('remove' in op) tree.delete(`${folder}/${op.remove}`);
    else tree.set(`${folder}/${op.mode}`, [op.to, tree.get(`${folder}/${op.mode}`)[1]]);
  }
  return listing([...tree].map(([p, [mode, content]]) => [p, mode, content]));
}

const key = (problem) => `${problem.file ?? ''}|${problem.rule}|${problem.g1 ?? ''}|${problem.rule === 'T-02' || problem.rule === 'T-03' ? problem.detail : ''}`;

let big;   // one repository for all the cases
before(() => {
  const trees = [];
  formatCases.forEach((c, i) => {
    const entries = new Map();
    const source = path.join(formatFixtures, c.folder);
    if (fs.existsSync(source)) for (const [name, bytes] of Object.entries(filesOf(source))) entries.set(`${c.id}/${name}`, ['100644', bytes]);
    for (const link of c.symlinks ?? []) entries.set(`${c.id}/${link.name}`, ['120000', link.target]);
    if (entries.size === 0) entries.set('placeholder', ['100644', 'x\n']);
    trees.push([`f${i}`, listing([...entries].map(([p, [mode, content]]) => [p, mode, content]))]);
  });
  commitCases.forEach((c, i) => trees.push([`c${i}`, treeOf(c)]));
  big = path.join(scratch, 'big.git');
  buildRepo(big, trees);
});

describe('a case of the format page, run as a commit', () => {
  formatCases.forEach((c, i) => {
    test(`${c.id}: gives the answer it gives for a folder`, () => {
      const folder = c.folder === 'no-such-folder' ? 'there/is/nothing' : c.id;
      const got = validateCommit(big, `f${i}`, folder, { extraKeys: c['extra-keys'] ?? [], sharedFolder: c['shared-folder'] ?? 'shared' });
      assert.deepEqual(got.map(key).sort(), c.expect.map(key).sort(), c.note);
    });
  });
});

describe('the fixtures of validate --commit', () => {
  commitCases.forEach((c, i) => {
    test(`${c.id}: ${c.expect.length === 0 ? 'valid' : c.expect.map((e) => e.rule).join(' ')}`, () => {
      assert.deepEqual(validateCommit(big, `c${i}`, c.folder).map(key).sort(), c.expect.map(key).sort(), c.note);
    });
  });

  test('exercise each of the three rules of a commit', () => {
    const hit = new Set(commitCases.flatMap((c) => c.expect.map((e) => e.rule)));
    for (const rule of Object.keys(COMMIT_RULES)) assert.ok(hit.has(rule), rule);
  });

  test('have a folder-free id and a note each', () => {
    assert.equal(new Set(commitCases.map((c) => c.id)).size, commitCases.length);
    for (const c of commitCases) assert.ok(c.note, c.id);
  });
});

describe('the page and the rules', () => {
  test('list the same rules of a commit', () => {
    assert.deepEqual([...page.matchAll(/^\| (T-\d\d) \|/gm)].map((m) => m[1]), Object.keys(COMMIT_RULES));
  });

  test('keep the numbers of the rules of the format apart from the rules of a commit', () => {
    for (const rule of Object.keys(COMMIT_RULES)) assert.ok(!(rule in FORMAT_RULES));
  });

  test('list the conventional folders that the code looks at', () => {
    const named = /`docs\/decisions`, `docs\/adr`, `docs\/adrs`, `docs\/architecture\/decisions`, `doc\/adr`, `doc\/decisions`, `decisions`, `adr` and `adrs`/;
    assert.match(page, named);
  });
});

describe('reading a commit', () => {
  const real = path.join(scratch, 'real');
  const folder = 'docs/decisions';
  const ok = { ...filesOf(path.join(formatFixtures, 'ok01-base')) };

  /** A repository made the ordinary way, with a working tree. */
  function commitReal(dir, extra = (d) => {}) {
    fs.rmSync(dir, { recursive: true, force: true });
    git(scratch, ['init', '-q', '-b', 'main', dir]);
    for (const [name, bytes] of Object.entries(ok)) {
      fs.mkdirSync(path.dirname(path.join(dir, folder, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, folder, name), bytes);
    }
    extra(dir);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'one']);
  }

  test('sees the modes and the links of an ordinary commit', () => {
    commitReal(real, (d) => {
      fs.chmodSync(path.join(d, folder, '0002-second-decision.md'), 0o755);
      fs.symlinkSync('README.md', path.join(d, folder, '0004-late.md'));
    });
    assert.deepEqual(validateCommit(real, 'HEAD', folder).map(key).sort(), ['0002-second-decision.md|T-01||', '0004-late.md|V-04||']);
  });

  test('reads the commit and not the working tree or the index', () => {
    commitReal(real);
    const before = validateCommit(real, 'HEAD', folder).map(key);
    assert.deepEqual(before, []);
    fs.writeFileSync(path.join(real, folder, '0002-second-decision.md'), 'not a record\n');
    fs.rmSync(path.join(real, folder, 'README.md'));
    fs.writeFileSync(path.join(real, '.gitattributes'), '*.md filter=x\n');
    git(real, ['add', '-A']);
    fs.mkdirSync(path.join(real, 'adr'), { recursive: true });
    fs.writeFileSync(path.join(real, 'adr/README.md'), 'x\n');
    assert.deepEqual(validateCommit(real, 'HEAD', folder).map(key), before);
  });

  test('takes no attribute from the machine: not info/attributes, not the global attributes file', () => {
    commitReal(real);
    fs.mkdirSync(path.join(real, '.git/info'), { recursive: true });
    fs.writeFileSync(path.join(real, '.git/info/attributes'), `${folder}/*.md linguist-generated\n`);
    fs.writeFileSync(path.join(scratch, 'global-attributes'), `${folder}/*.md diff\n`);
    git(real, ['config', 'core.attributesFile', path.join(scratch, 'global-attributes')]);
    git(real, ['config', 'core.fileMode', 'false']);
    assert.deepEqual(validateCommit(real, 'HEAD', folder), []);
    commitReal(real, (d) => fs.writeFileSync(path.join(d, '.gitattributes'), `${folder}/0001-first-decision.md ident\n`));
    assert.deepEqual(validateCommit(real, 'HEAD', folder).map(key), ['0001-first-decision.md|T-02||ident: set']);
  });

  test('ignores the git environment of the caller', () => {
    commitReal(real);
    const other = path.join(scratch, 'other.git');
    buildRepo(other, [['main', listing([['x', '100644', 'x\n']])]]);
    const saved = { ...process.env };
    Object.assign(process.env, { GIT_DIR: other, GIT_INDEX_FILE: path.join(scratch, 'no-index'), GIT_WORK_TREE: scratch });
    try {
      assert.deepEqual(validateCommit(real, 'HEAD', folder), []);
    } finally {
      for (const name of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) delete process.env[name];
      Object.assign(process.env, saved);
    }
  });

  test('writes nothing in the repository and leaves nothing in the temporary folder', () => {
    commitReal(real, (d) => fs.writeFileSync(path.join(d, '.gitattributes'), '*.md ident\n'));
    const snapshot = () => {
      const hash = crypto.createHash('sha256');
      for (const entry of fs.readdirSync(real, { recursive: true }).sort()) {
        const full = path.join(real, entry);
        const stat = fs.lstatSync(full);
        hash.update(`${entry}|${stat.mtimeMs}|${stat.isFile() ? fs.readFileSync(full).toString('base64') : ''}\n`);
      }
      return hash.digest('hex');
    };
    // The other test files run at the same time and make such a folder too, in the shared temporary folder: this test looks in a folder of its own.
    const own = fs.mkdtempSync(path.join(os.tmpdir(), 'record-keeper-own-tmp-'));
    const savedTmp = process.env.TMPDIR;
    process.env.TMPDIR = own;
    try {
      const leftovers = () => fs.readdirSync(own).sort();
      const before = [snapshot(), leftovers()];
      assert.deepEqual(before[1], []);
      assert.ok(validateCommit(real, 'HEAD', folder).length > 0);
      assert.deepEqual([snapshot(), leftovers()], before);
    } finally {
      if (savedTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = savedTmp;
      fs.rmSync(own, { recursive: true, force: true });
    }
  });

  test('accepts the revisions git accepts, and a folder written in other ways', () => {
    commitReal(real);
    git(real, ['tag', 'v1']);
    for (const rev of ['HEAD', 'main', 'v1', git(real, ['rev-parse', 'HEAD']).toString().trim(), 'HEAD~0', 'main^{commit}']) assert.deepEqual(validateCommit(real, rev, folder), [], rev);
    for (const spelling of ['docs/decisions/', './docs/decisions', 'docs//decisions', '/docs/decisions']) assert.deepEqual(validateCommit(real, 'HEAD', spelling), [], spelling);
    assert.deepEqual(validateCommit(real, 'HEAD').length, 0);
  });

  test('reads a commit of a bare repository, of a linked work tree and of a repository that borrows its objects', () => {
    commitReal(real, (d) => fs.writeFileSync(path.join(d, '.gitattributes'), '*.md ident\n'));
    const expected = validateCommit(real, 'HEAD', folder).map(key).sort();
    assert.equal(expected.length, 5);
    const bare = path.join(scratch, 'copy.git');
    git(scratch, ['clone', '-q', '--bare', real, bare]);
    assert.deepEqual(validateCommit(bare, 'HEAD', folder).map(key).sort(), expected);
    const tree = path.join(scratch, 'linked');
    fs.rmSync(tree, { recursive: true, force: true });
    git(real, ['worktree', 'add', '-q', '--detach', tree, 'HEAD']);
    assert.deepEqual(validateCommit(tree, 'HEAD', folder).map(key).sort(), expected);
    const borrowing = path.join(scratch, 'borrowing');
    fs.rmSync(borrowing, { recursive: true, force: true });
    git(scratch, ['clone', '-q', '--shared', real, borrowing]);
    assert.deepEqual(validateCommit(borrowing, 'HEAD', folder).map(key).sort(), expected);
  });

  test('names that are not valid UTF-8 are not record names', () => {
    const repo = path.join(scratch, 'odd.git');
    buildRepo(repo, [['main', [...listing([[`${folder}/README.md`, '100644', '# Decision records\n\n## Index\n\n| # | Title | Status |\n| - | - | - |\n'], [`${folder}/template.md`, '100644', ok['template.md']]]), [Buffer.concat([Buffer.from(`${folder}/0001-`), Buffer.from([0xff, 0xfe]), Buffer.from('.md')]), '100644', 'x\n']]]]);
    const problems = validateCommit(repo, 'main', folder);
    assert.deepEqual(problems.map((p) => p.rule), ['V-05']);
  });

  test('says "not a revision" and "not a folder" as Unreadable, which is wrong usage and not a problem of the records', () => {
    commitReal(real);
    for (const call of [() => validateCommit(real, 'no-such-revision', folder), () => validateCommit(real, '-x', folder), () => validateCommit(real, '', folder), () => validateCommit(real, 'HEAD', '..'),
      () => validateCommit(real, 'HEAD', 'docs/../..'), () => validateCommit(real, 'HEAD', ''), () => validateCommit(real, 'HEAD', '.'), () => validateCommit(path.join(scratch, 'nothing-here'), 'HEAD', folder),
      () => validateCommit(scratch, 'HEAD', folder), () => openCommit(real, 'HEAD').read('docs'), () => openCommit(real, 'HEAD').read('no/such/file')]) {
      assert.throws(call, Unreadable);
    }
    assert.throws(() => validateCommit(scratch, 'HEAD', folder), { message: /^git rev-parse failed: fatal: not a git repository/ });
    assert.throws(() => validateCommit(real, 'no-such-revision', folder), { message: /^git rev-parse failed: fatal: / });
  });

  test('can read a file of a commit for the callers that come after', () => {
    commitReal(real);
    const commit = openCommit(real, 'HEAD');
    assert.equal(commit.kind(folder), 'directory');
    assert.equal(commit.kind(`${folder}/README.md`), 'file');
    assert.equal(commit.kind('nothing'), undefined);
    assert.deepEqual(commit.read(`${folder}/README.md`), ok['README.md']);
    assert.deepEqual(commit.children(folder).map(({ name }) => name).sort(), Object.keys(ok).sort());
    for (const { name, id } of commit.children(folder)) assert.equal(id, git(real, ['rev-parse', `HEAD:${folder}/${name}`]).toString().trim(), name);
  });
});

describe('the validate command, for a commit', () => {
  const repo = path.join(scratch, 'cli');
  before(() => {
    git(scratch, ['init', '-q', '-b', 'main', repo]);
    for (const [name, bytes] of Object.entries(filesOf(path.join(formatFixtures, 'ok01-base')))) {
      fs.mkdirSync(path.dirname(path.join(repo, 'docs/decisions', name)), { recursive: true });
      fs.writeFileSync(path.join(repo, 'docs/decisions', name), bytes);
    }
    fs.mkdirSync(path.join(repo, 'adr'));
    fs.writeFileSync(path.join(repo, 'adr/README.md'), 'x\n');
    fs.chmodSync(path.join(repo, 'docs/decisions/0002-second-decision.md'), 0o755);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'one']);
  });

  test('prints the rules of a commit like the others, and exits 1', () => {
    const result = run(['validate', '--commit', 'HEAD', '--repo', repo]);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, [
      `docs/decisions/0002-second-decision.md: [T-01] ${COMMIT_RULES['T-01']}`,
      `docs/decisions: [T-03] ${COMMIT_RULES['T-03']} (adr)`,
      'docs/decisions: 2 problems',
    ].join('\n') + '\n');
  });

  test('says how many problems it found on stdout and exits 0 for none', () => {
    const at = (id) => `f${formatCases.findIndex((c) => c.id === id)}`;
    assert.deepEqual(run(['validate', '--commit', at('ok01-base'), '--repo', big, 'ok01-base']), { code: 0, stdout: 'ok01-base: 0 problems\n', stderr: '' });
    const one = run(['validate', '--commit', at('bad02-no-readme'), '--repo', big, 'bad02-no-readme']);
    assert.equal(one.code, 1);
    assert.equal(one.stderr, `bad02-no-readme/README.md: [V-02] ${FORMAT_RULES['V-02']}\nbad02-no-readme: 1 problem\n`);
  });

  test('takes the other options in any order', () => {
    const settings = run(['validate', '--commit', 'HEAD', 'docs/decisions', '--repo', repo, '--extra-key', 'repos', '--shared-folder', 'core']);
    assert.equal(settings.code, 1);
    assert.match(settings.stderr, /\[T-01\]/);
  });

  test('uses the current folder as the repository by default', () => {
    const result = spawnSync(process.execPath, [path.join(root, 'record-keeper.mjs'), 'validate', '--commit', 'HEAD'], { cwd: repo, encoding: 'utf8', env: CLEAN });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[T-01\]/);
  });

  test('exits 2 for a commit it cannot read, and for options it does not understand', () => {
    for (const argv of [['validate', '--commit', 'nope', '--repo', repo], ['validate', '--commit', 'HEAD', '--repo', path.join(scratch, 'no-repo')], ['validate', '--commit', 'HEAD', '--repo', repo, '..']]) {
      const result = run(argv);
      assert.equal(result.code, 2, JSON.stringify(argv));
      assert.match(result.stderr, /^record-keeper: /);
    }
    for (const argv of [['validate', '--repo', repo], ['validate', '--commit'], ['validate', '--commit', '--repo'], ['validate', '--commit', 'HEAD', '--repo'], ['validate', '--commit', ''], ['validate', '--commit', '-x']]) {
      const result = run(argv);
      assert.equal(result.code, 2, JSON.stringify(argv));
      assert.ok(result.stderr.startsWith('Usage:\n'), JSON.stringify(argv));
    }
  });

  test('a folder on disk never reports a rule of a commit', () => {
    const result = run(['validate', path.join(repo, 'docs/decisions')]);
    assert.equal(result.code, 0);
  });
});
