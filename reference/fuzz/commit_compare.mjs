// usage: node commit_compare.mjs <outdir>   (compares the library with expected.json written by commit_fuzz.py)
import fs from 'node:fs';
import path from 'node:path';
import { validateCommit } from '../../record-keeper.mjs';
const dir = path.resolve(process.argv[2]);
const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
let bad = 0;
for (const [name, e] of Object.entries(expected)) {
  const got = validateCommit(path.join(dir, 'r.git'), name, e.folder).map((p) => `${p.file ?? ''}|${p.rule}|${p.g1 ?? ''}|${p.rule === 'T-02' || p.rule === 'T-03' ? p.detail : ''}`).sort();
  if (JSON.stringify(got) !== JSON.stringify(e.problems)) { if (bad++ < 6) console.log('DIFF', name, e.folder, '\n  ref', e.problems, '\n  lib', got); }
}
console.log(`${Object.keys(expected).length} trees, ${bad} differences between the library and the Python reference`);
