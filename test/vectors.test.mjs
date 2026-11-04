// The test vectors of generation g1: the library must give the expected seal or the expected rule for every one,
// and the vector set itself must be consistent (see test/vectors/g1/README.md).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test, { describe } from 'node:test';
import { GENERATION, RULES, Reject, seal } from '../record-keeper.mjs';

const dir = new URL('./vectors/g1/', import.meta.url);
const { generation, vectors } = JSON.parse(fs.readFileSync(new URL('vectors.json', dir), 'utf8'));
const bytesOf = (vector) => fs.readFileSync(new URL(vector.file, dir));
const byId = new Map(vectors.map((vector) => [vector.id, vector]));

function outcome(vector) {
  try {
    return { seal: seal(bytesOf(vector)) };
  } catch (error) {
    if (error instanceof Reject) return { rule: error.rule };
    throw error;
  }
}

describe('the g1 vectors', () => {
  for (const vector of vectors) {
    test(`${vector.id}: ${vector.result === 'seal' ? 'sealed' : `rejected by ${vector.rule}`}`, () => {
      const got = outcome(vector);
      if (vector.result === 'seal') assert.deepEqual(got, { seal: vector.seal }, vector.note);
      else assert.deepEqual(got, { rule: vector.rule }, vector.note);
    });
  }
});

describe('the vector set', () => {
  test('is of the generation this library implements', () => {
    assert.equal(generation, GENERATION);
  });

  test('has unique ids and a note for each vector', () => {
    assert.equal(byId.size, vectors.length);
    for (const vector of vectors) assert.ok(vector.note, `${vector.id} has no note`);
  });

  test('lists every file under seal/ and reject/, and every file it lists exists', () => {
    const listed = new Set(vectors.map((vector) => vector.file));
    const onDisk = ['seal', 'reject'].flatMap((folder) =>
      fs.readdirSync(new URL(`${folder}/`, dir)).map((name) => `${folder}/${name}`));
    assert.deepEqual([...listed].sort(), onDisk.sort());
  });

  test('keeps a vector in the folder of its result', () => {
    for (const vector of vectors) assert.ok(vector.file.startsWith(`${vector.result}/`), vector.id);
  });

  test('gives a seal to a seal vector and a known rule to a reject vector', () => {
    for (const vector of vectors) {
      if (vector.result === 'seal') assert.match(vector.seal, /^sha256-g1:[0-9a-f]{64}$/, vector.id);
      else assert.ok(Object.hasOwn(RULES, vector.rule), `${vector.id}: unknown rule ${vector.rule}`);
    }
  });

  test('has every a-vector sealed like the base record', () => {
    const base = byId.get('a01-base').seal;
    for (const vector of vectors.filter(({ id }) => id.startsWith('a'))) assert.equal(vector.seal, base, vector.id);
  });

  test('has every vector that "differs from" another really differ in its seal', () => {
    for (const vector of vectors.filter((entry) => entry['differs-from'])) {
      const other = byId.get(vector['differs-from']);
      assert.ok(other, `${vector.id} differs from ${vector['differs-from']}, which is not a vector`);
      assert.equal(other.result, 'seal', vector.id);
      assert.notEqual(vector.seal, other.seal, vector.id);
    }
  });

  test('names the rule in the id of every r-vector', () => {
    for (const vector of vectors.filter(({ id }) => /^r\d\d/.test(id))) {
      assert.equal(vector.rule, `G1-${vector.id.slice(1, 3)}`, vector.id);
    }
  });

  test('rejects at least once for each of the twenty rules', () => {
    const rejected = new Set(vectors.filter(({ result }) => result === 'reject').map(({ rule }) => rule));
    assert.deepEqual([...rejected].sort(), Object.keys(RULES));
  });
});
