// Runs the core of the setup check on every input of a setup_fuzz.py file and compares the answer with the Python reference. Usage: setup_compare.mjs <in.jsonl>
import fs from 'node:fs';
import { decide, ownersOf, parseCodeowners, parseUtc } from '../../setup-check.mjs';

/** The value with its keys in order, and undefined as null: the form in which two answers are compared. */
function canonical(value) {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
let different = 0;
for (const [index, text] of lines.entries()) {
  const item = JSON.parse(text);
  let got;
  if (item.kind === 'decision') got = decide(item.input);
  else if (item.kind === 'utc') got = parseUtc(item.text);
  else {
    const parsed = parseCodeowners(item.text);
    got = { rules: parsed.rules, unreadable: parsed.unreadable, owners: Object.fromEntries(item.paths.map((file) => [file, ownersOf(parsed.rules, file)])) };
  }
  if (JSON.stringify(canonical(got)) !== JSON.stringify(canonical(item.expect)) && different++ < 10) console.log('DIFFERENT', index, text.slice(0, 700), '\n  library', JSON.stringify(canonical(got)).slice(0, 700));
}
console.log(lines.length, 'inputs,', different, 'differences');
process.exitCode = different ? 1 : 0;
