// usage: node validate_compare_ref2.mjs <outdir>   (reads ref1.json for the list of folders and options, compares reference 2)
import fs from 'node:fs';
import path from 'node:path';
import { validate } from '../validate_ref2.mjs';
const dir = path.resolve(process.argv[2]);
const ref1 = JSON.parse(fs.readFileSync(path.join(dir, 'ref1.json'), 'utf8'));
let bad = 0;
for (const [name, r] of Object.entries(ref1)) {
  const got = validate(path.join(dir, name), { extraKeys: r.extra }).map((p) => `${p.file ?? ''}|${p.rule}|${p.g1 ?? ''}`).sort();
  if (JSON.stringify(got) !== JSON.stringify(r.problems)) {
    if (bad++ < 6) console.log('DIFF', name, '\n  ref1', r.problems, '\n  ref2', got);
  }
}
console.log(`${Object.keys(ref1).length} folders, ${bad} differences`);
