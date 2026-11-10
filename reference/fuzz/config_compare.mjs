// Runs the library on every input of a config_fuzz.py file and compares it with the Python reference. Usage: config_compare.mjs <in.jsonl>
import fs from 'node:fs';
import { parseSettings } from '../../record-keeper.mjs';

const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
let different = 0;
for (const [index, text] of lines.entries()) {
  const expected = JSON.parse(text);
  const got = parseSettings(Buffer.from(expected.hex, 'hex'));
  const same = JSON.stringify(got.settings) === JSON.stringify(expected.settings) &&
    JSON.stringify(got.problems.map((p) => [p.line, p.rule, p.detail])) === JSON.stringify(expected.problems);
  if (!same && different++ < 10) console.log('DIFFERENT', index, expected.hex, JSON.stringify(expected.settings), JSON.stringify(expected.problems), '\n  library', JSON.stringify(got));
}
console.log(lines.length, 'inputs,', different, 'differences');
process.exitCode = different ? 1 : 0;
