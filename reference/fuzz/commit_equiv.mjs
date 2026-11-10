// usage: node commit_equiv.mjs <fuzz outdir> <n>
// Runs the first n fuzzed folders as commits of one repository and compares with the Python reference (folder form) in ref1.json.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateCommit } from '../../record-keeper.mjs';
const dir = path.resolve(process.argv[2]);
const n = Number(process.argv[3]);
const ref1 = JSON.parse(fs.readFileSync(path.join(dir, 'ref1.json'), 'utf8'));
const names = Object.keys(ref1).slice(0, n);
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-equiv-')) + '/r.git';
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
spawnSync('git', ['init', '-q', '--bare', repo], { env });
const data = (b) => Buffer.concat([Buffer.from(`data ${b.length}\n`), b, Buffer.from('\n')]);
const parts = [];
for (const name of names) {
  parts.push(Buffer.from(`commit refs/heads/${name}\ncommitter T <t@example.com> 0 +0000\n`), data(Buffer.from('c')), Buffer.from('deleteall\nM 100644 inline placeholder\n'), data(Buffer.from('x')));
  for (const entry of fs.readdirSync(path.join(dir, name), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const rel = path.relative(path.join(dir, name), path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
    parts.push(Buffer.from(`M 100644 inline docs/decisions/${rel}\n`), data(fs.readFileSync(path.join(entry.parentPath, entry.name))));
  }
}
const fi = spawnSync('git', ['-C', repo, 'fast-import', '--quiet'], { input: Buffer.concat(parts), env, maxBuffer: 1 << 30 });
if (fi.status !== 0) { console.log(fi.stderr.toString()); process.exit(2); }
let bad = 0;
for (const name of names) {
  const r = ref1[name];
  const got = validateCommit(repo, name, 'docs/decisions', { extraKeys: r.extra }).map((p) => `${p.file ?? ''}|${p.rule}|${p.g1 ?? ''}`).sort();
  if (JSON.stringify(got) !== JSON.stringify(r.problems)) { if (bad++ < 6) console.log('DIFF', name, '\n  folder', r.problems, '\n  commit', got); }
}
console.log(`${names.length} folders as commits, ${bad} differences from the Python reference of the folder form`);
fs.rmSync(path.dirname(repo), { recursive: true, force: true });
