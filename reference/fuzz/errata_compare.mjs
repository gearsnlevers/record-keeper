// Compares the library with the reference results for the errata scenarios. Usage: node errata_compare.mjs <dir> <ref.json>...
import fs from 'node:fs';
import path from 'node:path';
import { checkChange } from '../../record-keeper.mjs';

const [dir, ...refs] = process.argv.slice(2);
const scenarios = JSON.parse(fs.readFileSync(path.join(dir, 'scenarios.json'), 'utf8'));
const expected = Object.assign({}, ...refs.map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))));
const withDetail = (rule) => /^(?:P-0[2-7]|P-1[0-4]|T-0[23])$/.test(rule);
let different = 0;
let errors = 0;
const rules = {};
const acts = {};
const kinds = {};
const details = {};
for (const s of scenarios) {
  const want = expected[s.id];
  if (!want) continue;
  if (want.error) { errors++; console.log('REFERENCE ERROR', s.id, want.error); continue; }
  const got = checkChange(path.join(dir, 'repo.git'), s.base, s.head, { cases: s.cases ?? undefined, since: s.since ? Date.parse(s.since) : undefined, now: Date.parse(s.now) });
  const shown = {
    settings: got.settings.map((p) => [p.line, p.rule, p.detail ?? '']),
    problems: got.problems.map((p) => [p.file, p.rule, withDetail(p.rule) ? p.detail ?? '' : '']),
    acts: got.acts.map((a) => [a.kind, a.path]),
    needs: { cases: got.needs.cases.map((c) => [c.kind, c.number]), clock: got.needs.clock },
  };
  for (const p of got.problems) {
    rules[p.rule] = (rules[p.rule] ?? 0) + 1;
    if (/^P-1[0-4]$/.test(p.rule)) { const key = `${p.rule} ${(p.detail ?? '').replace(/sha256(?:-g1)?:[0-9a-f]{64}/g, 'H').replace(/\d+h of/, 'Nh of').replace(/entry \d+/, 'entry N')}`; details[key] = (details[key] ?? 0) + 1; }
  }
  for (const a of got.acts) acts[a.kind] = (acts[a.kind] ?? 0) + 1;
  kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
  if (JSON.stringify(shown) !== JSON.stringify(want)) {
    different++;
    if (different <= 8) console.log('DIFFERENT', s.id, s.kind, '\n  ref ', JSON.stringify(want), '\n  lib ', JSON.stringify(shown));
  }
}
console.log(`${Object.keys(expected).length} scenarios, ${different} differences, ${errors} reference errors`);
console.log('rules', JSON.stringify(Object.fromEntries(Object.entries(rules).sort())), '\nacts', JSON.stringify(acts), '\nkinds', JSON.stringify(kinds));
console.log('details', JSON.stringify(Object.fromEntries(Object.entries(details).sort()), null, 0));
process.exitCode = different || errors ? 1 : 0;
