// The kit's own decision records must pass the rules of g1, verify once sealed, and say what they apply to truthfully.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { appliesToPattern, openCommit, parse, protocolRecords, verify } from '../record-keeper.mjs';

const dir = new URL('../docs/decisions/', import.meta.url);
const records = fs.readdirSync(dir).filter((name) => /^\d{4}-.+\.md$/.test(name)).sort();
const root = fileURLToPath(new URL('../', import.meta.url));
const files = fs.readdirSync(root, { recursive: true }).map((entry) => entry.split(path.sep).join('/')).filter((entry) => !entry.startsWith('.git/') && !entry.startsWith('node_modules/') && fs.statSync(path.join(root, entry)).isFile());


test('the kit has records to check', () => {
  assert.ok(records.length > 0);
});

for (const name of records) {
  test(`${name} passes the rules of g1`, () => {
    parse(fs.readFileSync(new URL(name, dir)));
  });

  test(`${name} verifies if it is sealed`, () => {
    const result = verify(fs.readFileSync(new URL(name, dir)));
    assert.ok(result.ok || result.reason === 'not-sealed', JSON.stringify(result));
  });

  // A record without applies-to binds the whole repository and has nothing to match.
  test(`${name} names only paths that exist in its applies-to, if it has one`, () => {
    const { entries } = parse(fs.readFileSync(new URL(name, dir)));
    const appliesTo = entries.find(({ key }) => key === 'applies-to');
    const globs = (appliesTo?.owned ?? []).map((line) => /^ +- +(.*)$/.exec(line)[1]);
    for (const glob of globs) {
      const pattern = appliesToPattern(glob);
      assert.ok(files.some((file) => pattern.test(file)), `no file matches ${glob}`);
    }
  });
}

test('the README of the kit\'s records names record 0001 as the protocol, in the table the bar reads', () => {
  const text = fs.readFileSync(new URL('README.md', dir), 'utf8');
  const rows = text.split('\n').filter((line) => /^\| g[0-9]+ \|/.test(line));
  assert.ok(rows.length >= 1);
  assert.match(rows[0], /^\| g1 \| \[0001\]\(0001-[a-z0-9-]+\.md\) \| /);
  assert.ok(fs.existsSync(new URL(/\]\(([^)]+)\)/.exec(rows[0])[1], dir)));
  // the same as the bar reads it from a commit of this repository (not in a checkout without a git folder)
  if (fs.existsSync(path.join(root, '.git'))) assert.deepEqual([...protocolRecords(openCommit(root, 'HEAD'), 'docs/decisions')], [1]);
});
