// Runs the core of the updater on every input of an update_fuzz.py file and compares the answer with the Python reference. Usage: update_compare.mjs <in.jsonl>
import fs from 'node:fs';
import { plan } from '../../updater.mjs';

/** The value with its keys in order, and undefined as null: the form in which two answers are compared. */
function canonical(value) {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
const bytesOf = (value) => (value !== null && typeof value === 'object' ? Buffer.from(value.hex, 'hex') : value);
/** The input as the core takes it: the bytes of AGENTS.md in its tree entry, and the texts of the blocks as bytes. */
const prepared = (input) => ({
  ...input,
  manifest: bytesOf(input.manifest),
  previous: bytesOf(input.previous),
  tree: Object.fromEntries(Object.entries(input.tree).map(([name, state]) => [name, state.hex === undefined ? state : { ...state, bytes: Buffer.from(state.hex, 'hex') }])),
  blocks: Object.fromEntries(Object.entries(input.blocks ?? {}).map(([source, text]) => [source, Buffer.from(text.hex, 'hex')])),
});

const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
let different = 0;
for (const [index, text] of lines.entries()) {
  const { input, expect } = JSON.parse(text);
  const got = plan(prepared(input));
  if (JSON.stringify(canonical(got)) !== JSON.stringify(canonical(expect)) && different++ < 10) console.log('DIFFERENT', index, text.slice(0, 600), '\n  library', JSON.stringify(canonical(got)).slice(0, 600));
}
console.log(lines.length, 'inputs,', different, 'differences');
process.exitCode = different ? 1 : 0;
