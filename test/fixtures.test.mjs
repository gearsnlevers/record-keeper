// The fixtures of `validate` (test/fixtures/validate) and the page that says what they mean (docs/record-format.md)
// must agree with each other. The implementation of `validate` runs the cases; this checks that the set is sound.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test, { describe } from 'node:test';
import { RULES as G1_RULES } from '../record-keeper.mjs';

const dir = new URL('./fixtures/validate/', import.meta.url);
const { cases } = JSON.parse(fs.readFileSync(new URL('cases.json', dir), 'utf8'));
const page = fs.readFileSync(new URL('../docs/record-format.md', import.meta.url), 'utf8');
const RULE_IDS = Array.from({ length: 34 }, (_, i) => `V-${String(i + 1).padStart(2, '0')}`);
const MISSING = 'no-such-folder';

function walk(url, base = '') {
  return fs.readdirSync(url, { withFileTypes: true }).flatMap((entry) => {
    const path = `${base}${entry.name}`;
    return entry.isDirectory() ? [{ path, dir: true }, ...walk(new URL(`${entry.name}/`, url), `${path}/`)] : [{ path, dir: false, link: entry.isSymbolicLink() }];
  });
}

describe('the fixture set', () => {
  test('has unique ids', () => {
    assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
  });

  test('has a folder for every case, and a case for every folder', () => {
    const folders = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    assert.deepEqual(folders, cases.filter((c) => c.folder !== MISSING).map((c) => c.folder).sort());
    for (const c of cases) assert.equal(c.folder === MISSING || c.folder === c.id, true, c.id);
    assert.ok(!fs.existsSync(new URL(`${MISSING}/`, dir)), 'the folder that must not exist exists');
  });

  test('gives every case a note and a list of expected problems of known rules', () => {
    for (const c of cases) {
      assert.ok(c.note, `${c.id} has no note`);
      assert.ok(Array.isArray(c.expect), c.id);
      for (const e of c.expect) {
        assert.ok(RULE_IDS.includes(e.rule), `${c.id}: unknown rule ${e.rule}`);
        assert.ok(e.file === null || typeof e.file === 'string', c.id);
        if (e.rule === 'V-09') assert.ok(Object.hasOwn(G1_RULES, e.g1), `${c.id}: V-09 needs the g1 rule it reports`);
        else assert.equal(e.g1, undefined, `${c.id}: only V-09 names a g1 rule`);
      }
    }
  });

  test('exercises each of the 34 rules at least once', () => {
    const hit = new Set(cases.flatMap((c) => c.expect.map((e) => e.rule)));
    assert.deepEqual(RULE_IDS.filter((r) => !hit.has(r)), []);
  });

  test('has valid cases as well as invalid ones', () => {
    assert.ok(cases.some((c) => c.expect.length === 0));
    assert.ok(cases.some((c) => c.expect.length > 0));
  });

  test('stores no symbolic link, and no two names in one folder that differ only in case', () => {
    for (const c of cases.filter((x) => x.folder !== MISSING)) {
      const entries = walk(new URL(`${c.folder}/`, dir));
      assert.deepEqual(entries.filter((e) => e.link), [], `${c.id} holds a symbolic link`);
      const byFolder = new Map();
      for (const { path } of entries) {
        const slash = path.lastIndexOf('/');
        const key = path.slice(0, slash + 1).toLowerCase();
        const name = path.slice(slash + 1).toLowerCase();
        byFolder.set(key, [...(byFolder.get(key) ?? []), name]);
      }
      for (const names of byFolder.values()) assert.equal(new Set(names).size, names.length, `${c.id} has names that differ only in case`);
    }
  });

  test('declares the symbolic links of a case, to files that are there', () => {
    for (const c of cases.filter((x) => x.symlinks)) {
      for (const s of c.symlinks) {
        assert.ok(fs.existsSync(new URL(`${c.folder}/${s.target}`, dir)), `${c.id}: ${s.target} is not in the folder`);
        assert.ok(!fs.existsSync(new URL(`${c.folder}/${s.name}`, dir)), `${c.id}: ${s.name} is stored`);
        assert.ok(c.expect.some((e) => e.file === s.name && e.rule === 'V-04'), `${c.id}: the link is not reported as V-04`);
      }
    }
  });
});

describe('the page and the fixtures', () => {
  test('list the same rules', () => {
    const inTable = [...page.matchAll(/^\| (V-\d\d) \|/gm)].map((m) => m[1]);
    assert.deepEqual(inTable, RULE_IDS);
  });

  test('link to each other', () => {
    assert.match(page, /\(\.\.\/test\/fixtures\/validate\/README\.md\)/);
    const readme = fs.readFileSync(new URL('README.md', dir), 'utf8');
    assert.match(readme, /\(\.\.\/\.\.\/\.\.\/docs\/record-format\.md\)/);
  });
});
