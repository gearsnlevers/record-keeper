// `validate`: the cases of test/fixtures/validate, the command line, and the kit's own records folder.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FORMAT_RULES, run, validate } from '../record-keeper.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = path.join(root, 'record-keeper.mjs');
const fixtures = path.join(root, 'test/fixtures/validate');
const { cases } = JSON.parse(fs.readFileSync(path.join(fixtures, 'cases.json'), 'utf8'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'record-keeper-validate-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const key = (problem) => `${problem.file ?? ''}|${problem.rule}|${problem.g1 ?? ''}`;
let counter = 0;

/** A copy of a case in a folder of its own, with the symbolic links the case declares. */
function materialize(c) {
  const work = path.join(scratch, `case-${counter++}`, 'folder');
  const source = path.join(fixtures, c.folder);
  if (fs.existsSync(source)) fs.cpSync(source, work, { recursive: true });
  for (const link of c.symlinks ?? []) fs.symlinkSync(link.target, path.join(work, link.name));
  return work;
}

/** A hash of every file under a folder, with its modification time. */
function snapshot(folder) {
  const hash = crypto.createHash('sha256');
  for (const entry of fs.readdirSync(folder, { recursive: true }).sort()) {
    const full = path.join(folder, entry);
    const stat = fs.lstatSync(full);
    hash.update(`${entry}|${stat.mtimeMs}|${stat.isFile() ? fs.readFileSync(full).toString('base64') : ''}\n`);
  }
  return hash.digest('hex');
}

describe('the fixtures of validate', () => {
  for (const c of cases) {
    test(`${c.id}: ${c.expect.length === 0 ? 'valid' : c.expect.map((e) => e.rule).join(' ')}`, () => {
      const got = validate(materialize(c), { extraKeys: c['extra-keys'] ?? [], sharedFolder: c['shared-folder'] ?? 'shared' }).map(key).sort();
      assert.deepEqual(got, c.expect.map(key).sort(), c.note);
    });
  }
});

describe('validate', () => {
  test('has a message for each of the 37 rules', () => {
    assert.deepEqual(Object.keys(FORMAT_RULES), Array.from({ length: 37 }, (_, i) => `V-${String(i + 1).padStart(2, '0')}`));
  });

  test('names the g1 rule of a record that g1 rejects', () => {
    const c = cases.find((x) => x.id === 'bad09a-g1-comment');
    const [problem] = validate(materialize(c));
    assert.equal(problem.rule, 'V-09');
    assert.equal(problem.g1, 'G1-06');
    assert.match(problem.detail, /^G1-06: /);
  });

  test('never writes anything in the folder it reads', () => {
    for (const c of cases.filter((x) => x.folder !== 'no-such-folder' && !x.symlinks)) {
      const work = materialize(c);
      const before = snapshot(work);
      validate(work);
      assert.equal(snapshot(work), before, c.id);
    }
  });

  test('finds no problem in the records folder of the kit itself', () => {
    assert.deepEqual(validate(path.join(root, 'docs/decisions')), []);
  });

  test('knows no repository that uses it', () => {
    const source = fs.readFileSync(script, 'utf8');
    assert.doesNotMatch(source, /concierge|frodo/i);
  });
});

describe('the validate command', () => {
  const caseNamed = (id) => cases.find((c) => c.id === id);

  test('says how many problems it found, on stdout, and exits 0 for none', () => {
    const folder = materialize(caseNamed('ok01-base'));
    assert.deepEqual(run(['validate', folder]), { code: 0, stdout: `${folder}: 0 problems\n`, stderr: '' });
  });

  test('prints a line for each problem on stderr, with the rule, and exits 1', () => {
    const folder = materialize(caseNamed('multi01-value-and-deprecated'));
    const result = run(['validate', folder]);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, [
      `${path.join(folder, '0002-second-decision.md')}: [V-14] ${FORMAT_RULES['V-14']} (decision-makers must be a list)`,
      `${path.join(folder, '0003-third-decision.md')}: [V-19] ${FORMAT_RULES['V-19']}`,
      `${folder}: 2 problems`,
    ].join('\n') + '\n');
  });

  test('writes "1 problem" in the singular, and names the folder for a problem of the folder itself', () => {
    const folder = materialize(caseNamed('bad08a-gap'));
    const result = run(['validate', folder]);
    assert.match(result.stderr, new RegExp(`^${folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: \\[V-08\\] `));
    assert.ok(result.stderr.endsWith(`${folder}: 1 problem\n`));
  });

  test('reports a folder that does not exist as a problem, not as a usage error', () => {
    const result = run(['validate', path.join(scratch, 'there-is-nothing-here')]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /\[V-01\] does not exist or is not a directory/);
  });

  test('takes the settings as options', () => {
    const extra = materialize(caseNamed('ok04-extra-key-allowed'));
    assert.equal(run(['validate', extra]).code, 1);
    assert.equal(run(['validate', extra, '--extra-key', 'repos']).code, 0);
    assert.equal(run(['validate', '--extra-key', 'window', '--extra-key', 'repos', extra]).code, 0);
    const shared = materialize(caseNamed('ok07-shared-folder-named-in-settings'));
    assert.equal(run(['validate', shared]).code, 1);
    assert.equal(run(['validate', shared, '--shared-folder', 'core']).code, 0);
  });

  test('exits 2 with the usage for anything it does not understand', () => {
    const wrong = [['validate', '--help'], ['validate', 'a', 'b'], ['validate', '--extra-key'], ['validate', '--extra-key', '--shared-folder'], ['validate', '--shared-folder'],
      ['validate', '--extra-key', ''], ['validate', '--other', 'a'], ['validate', '-'], ['validate', 'a', '--extra-key', 'k', 'b']];
    for (const argv of wrong) {
      const result = run(argv);
      assert.equal(result.code, 2, JSON.stringify(argv));
      assert.equal(result.stdout, '');
      assert.ok(result.stderr.startsWith('Usage:\n'), JSON.stringify(argv));
      assert.match(result.stderr, /validate \[folder\]/);
    }
  });

  test('checks docs/decisions when no folder is given, as a real process, also through a symbolic link', () => {
    const own = spawnSync(process.execPath, [script, 'validate'], { cwd: root, encoding: 'utf8' });
    assert.deepEqual([own.status, own.stdout, own.stderr], [0, 'docs/decisions: 0 problems\n', '']);
    const link = path.join(scratch, 'record-keeper-link');
    fs.symlinkSync(script, link);
    const bad = spawnSync(process.execPath, [link, 'validate', materialize(caseNamed('bad02-no-readme'))], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /README\.md: \[V-02\] is missing/);
  });
});
