import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sealG1, Reject } from './g1.mjs';
// usage: node run_vectors.mjs <vectors dir> [<folder of records> ...]
// Checks g1.mjs against the vectors, and then against g1.py on the records in the folders, if any are given.
const dir = process.argv[2];
const { vectors } = JSON.parse(fs.readFileSync(path.join(dir, 'vectors.json'), 'utf8'));
let bad = 0;
for (const v of vectors) {
  const bytes = fs.readFileSync(path.join(dir, v.file));
  let got;
  try { got = { seal: sealG1(bytes) }; } catch (e) { if (!(e instanceof Reject)) throw e; got = { rule: e.rule }; }
  const ok = v.result === 'seal' ? got.seal === v.seal : got.rule === v.rule;
  if (!ok) { bad++; console.log('MISMATCH', v.id, 'expected', v.seal ?? v.rule, 'got', got.seal ?? got.rule); }
}
console.log(`${vectors.length} vectors, ${bad} mismatches`);
// corpus: compare with the python implementation (the folders are the arguments after the vectors folder)
const dirs = process.argv.slice(3);
let n = 0, diff = 0;
for (const d of dirs) for (const f of fs.readdirSync(d).filter((x) => /^\d{4}-.*\.md$/.test(x)).sort()) {
  const file = path.join(d, f); n++;
  const js = sealG1(fs.readFileSync(file));
  const py = execFileSync('python3', ['-c', `import sys;sys.path.insert(0,${JSON.stringify(path.dirname(new URL(import.meta.url).pathname))});import g1;print(g1.seal_g1(open(sys.argv[1],'rb').read()))`, file], { encoding: 'utf8' }).trim();
  if (js !== py) { diff++; console.log('CORPUS DIFF', file, js, py); }
}
console.log(`${n} corpus records, ${diff} differences between the two implementations`);
process.exit(bad || diff ? 1 : 0);
