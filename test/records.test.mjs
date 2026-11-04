// The kit's own decision records must pass the rules of g1, verify once sealed, and say what they apply to truthfully.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse, verify } from '../record-keeper.mjs';

const dir = new URL('../docs/decisions/', import.meta.url);
const records = fs.readdirSync(dir).filter((name) => /^\d{4}-.+\.md$/.test(name)).sort();
const root = fileURLToPath(new URL('../', import.meta.url));
const files = fs.readdirSync(root, { recursive: true }).map((entry) => entry.split(path.sep).join('/')).filter((entry) => !entry.startsWith('.git/') && !entry.startsWith('node_modules/') && fs.statSync(path.join(root, entry)).isFile());

/** A glob as the records write it: `**` crosses folders, `*` does not. */
const globToRegExp = (glob) => new RegExp(`^${glob.split('**').map((part) => part.split('*').map((text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*')}$`);

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

  test(`${name} applies to paths that exist`, () => {
    const { entries } = parse(fs.readFileSync(new URL(name, dir)));
    const appliesTo = entries.find(({ key }) => key === 'applies-to');
    const globs = (appliesTo?.owned ?? []).map((line) => /^ +- +(.*)$/.exec(line)[1]);
    for (const glob of globs) {
      const pattern = globToRegExp(glob);
      assert.ok(files.some((file) => pattern.test(file)), `no file matches ${glob}`);
    }
  });
}
