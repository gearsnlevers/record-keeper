// usage: node run_cases.mjs <fixtures dir> [impl.mjs]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const fixtures = path.resolve(process.argv[2]);
const impl = await import(pathToFileURL(path.resolve(process.argv[3] ?? './validate_ref2.mjs')).href);
const { cases } = JSON.parse(fs.readFileSync(path.join(fixtures, 'cases.json'), 'utf8'));
const key = (p) => `${p.file ?? ''}|${p.rule}|${p.g1 ?? ''}`;
let bad = 0;
for (const c of cases) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vcase-'));
  const work = path.join(tmp, 'f');
  const src = path.join(fixtures, c.folder);
  if (fs.existsSync(src)) fs.cpSync(src, work, { recursive: true });
  for (const s of c.symlinks ?? []) fs.symlinkSync(s.target, path.join(work, s.name));
  const got = impl.validate(work, { extraKeys: c['extra-keys'] ?? [], sharedFolder: c['shared-folder'] ?? 'shared' }).map(key).sort();
  const want = c.expect.map(key).sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.log('MISMATCH', c.id, '\n  want', want, '\n  got ', got); }
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`${cases.length} cases, ${bad} mismatches`);
process.exit(bad ? 1 : 0);
