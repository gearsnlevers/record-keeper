// The kit's own decision records must pass the rules of g1 and, once sealed, verify.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parse, verify } from '../record-keeper.mjs';

const dir = new URL('../docs/decisions/', import.meta.url);
const records = fs.readdirSync(dir).filter((name) => /^\d{4}-.+\.md$/.test(name)).sort();

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
}
