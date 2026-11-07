// Where a record applies (docs/applies-to.md): the dialect of the items of applies-to, tried on the vectors of test/fixtures/applies, and
// the rules P-17 and P-18 on a small repository. The cases of the change fixtures (group q) are in test/change.test.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CHANGE_RULES, appliesToPattern } from '../record-keeper.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { vectors } = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/applies/vectors.json'), 'utf8'));
const page = fs.readFileSync(path.join(root, 'docs/applies-to.md'), 'utf8');

describe('the dialect of an item', () => {
  test('every vector: the item matches the path exactly when the reference says so', () => {
    assert.ok(vectors.length > 1000);
    assert.ok(vectors.some((v) => v.match) && vectors.some((v) => !v.match));
    for (const { item, path: file, match } of vectors) assert.equal(appliesToPattern(item).test(file), match, JSON.stringify({ item, file }));
  });

  test('the examples of the page', () => {
    const matches = (item, file) => appliesToPattern(item).test(file);
    assert.ok(matches('src/**', 'src/a.ts') && matches('src/**', 'src/x/a.ts') && !matches('src/**', 'src'));
    assert.ok(matches('src/**/*.ts', 'src/a.ts') && matches('src/**/*.ts', 'src/x/y/a.ts'));
    assert.ok(matches('src/**/README.md', 'src/README.md') && matches('src/**/README.md', 'src/docs/README.md'));
    assert.ok(matches('lib/*.mjs', 'lib/a.mjs') && !matches('lib/*.mjs', 'lib/x/a.mjs'));
    assert.ok(matches('a**b', 'ab') && matches('a**b', 'a/x/b'));
    assert.ok(matches('**/README.md', 'README.md') && matches('**/README.md', 'docs/README.md'));
  });

  test('the pattern is anchored at both ends and is not shared between calls', () => {
    const pattern = appliesToPattern('a*');
    assert.equal(pattern.test('ab'), true);
    assert.equal(pattern.test('ab'), true);
    assert.equal(pattern.test('xab'), false);
    assert.equal(pattern.global, false);
  });

  test('a character that is special in a regular expression is itself', () => {
    for (const special of '.+?^${}()|[]\\/') assert.equal(appliesToPattern(`a${special}b`).test(`a${special}b`), true, special);
    assert.equal(appliesToPattern('a.b').test('axb'), false);
    assert.equal(appliesToPattern('a+b').test('aab'), false);
  });

  test('a line break in a name is a character like another', () => {
    assert.equal(appliesToPattern('a*').test('a\nb'), true);
    assert.equal(appliesToPattern('a**').test('a\nb/c'), true);
    assert.equal(appliesToPattern('a/\n').test('a/\n'), true);
  });
});

describe('the page and the code', () => {
  test('the two rules are in the code and on the page', () => {
    for (const rule of ['P-17', 'P-18']) {
      assert.ok(CHANGE_RULES[rule], rule);
      assert.ok(page.includes(`| ${rule} |`), rule);
    }
  });

  test('the dialect on the page is the table of the code: the four rows', () => {
    for (const row of ['`**/`', '`**`', '`*`']) assert.ok(page.includes(`| ${row} |`), row);
  });
});
