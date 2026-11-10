// usage: node validate_compare.mjs <outdir>   (compares the library with reference 1 in ref1.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { validate } = await import(pathToFileURL(fileURLToPath(new URL('../../record-keeper.mjs', import.meta.url))).href);
const dir = path.resolve(process.argv[2]);
const ref1 = JSON.parse(fs.readFileSync(path.join(dir, 'ref1.json'), 'utf8'));
let bad = 0;
const hit = new Set();
for (const [name, r] of Object.entries(ref1)) {
  const got = validate(path.join(dir, name), { extraKeys: r.extra }).map((p) => `${p.file ?? ''}|${p.rule}|${p.g1 ?? ''}`).sort();
  got.forEach((g) => hit.add(g.split('|')[1]));
  if (JSON.stringify(got) !== JSON.stringify(r.problems)) { if (bad++ < 6) console.log('DIFF', name, '\n  ref1', r.problems, '\n  lib ', got); }
}
console.log(`${Object.keys(ref1).length} folders, ${bad} differences between the library and reference 1; ${hit.size} rules hit`);
