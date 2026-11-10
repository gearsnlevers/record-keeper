import fs from 'node:fs';
import { openCommit, readSettings } from '../../record-keeper.mjs';
const [repo, file] = process.argv.slice(2);
const expected = JSON.parse(fs.readFileSync(file, 'utf8'));
let different = 0;
for (const e of expected) {
  const got = readSettings(openCommit(repo, e.name));
  const same = JSON.stringify(got.settings) === JSON.stringify(e.settings) && JSON.stringify(got.problems.map((p) => [p.line, p.rule, p.detail])) === JSON.stringify(e.problems);
  if (!same && different++ < 5) console.log('DIFFERENT', e.name, JSON.stringify(e), JSON.stringify(got));
}
console.log(expected.length, 'trees,', different, 'differences');
process.exitCode = different ? 1 : 0;
