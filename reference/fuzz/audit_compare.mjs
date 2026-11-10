// Compares the library with the reference results for the audit scenarios. Usage: node audit_compare.mjs <dir> <ref.json>...
import fs from 'node:fs';
import path from 'node:path';
import { audit } from '../../record-keeper.mjs';

const [dir, ...refs] = process.argv.slice(2);
const scenarios = JSON.parse(fs.readFileSync(path.join(dir, 'scenarios.json'), 'utf8'));
const expected = Object.assign({}, ...refs.map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))));
const clean = (q) => ({ commit: q.commit, kind: q.kind, file: q.file, rule: q.rule, detail: q.rule.startsWith('V-') ? '' : q.detail, line: q.line ?? null, ...(q.note ? { note: q.note } : {}) });
let different = 0;
let errors = 0;
const rules = {};
const kinds = {};
let excusedTotal = 0;
for (const s of scenarios) {
  const want = expected[s.id];
  if (!want) continue;
  if (want.error) { errors++; console.log('REFERENCE ERROR', s.id, want.error); continue; }
  let got;
  try {
    got = audit(s.repo, s.head, { from: s.from ?? undefined, since: s.since ?? undefined });
  } catch (error) {
    got = { error: error.message };
  }
  const shown = got.error ? got : { judged: got.judged, violations: got.violations.map(clean), excused: got.excused.map(clean), acts: got.acts.map((a) => ({ commit: a.commit, kind: a.kind, path: a.path, pull: a.pull })), cases: got.cases.map((c) => ({ commit: c.commit, kind: c.kind, number: c.number })) };
  const ref = { judged: want.judged, violations: want.violations.map((q) => clean({ ...q, line: q.line ?? null })), excused: want.excused.map((q) => clean({ ...q, line: q.line ?? null })), acts: want.acts, cases: want.cases };
  for (const q of got.violations ?? []) { rules[q.rule] = (rules[q.rule] ?? 0) + 1; kinds[q.kind] = (kinds[q.kind] ?? 0) + 1; }
  excusedTotal += got.excused?.length ?? 0;
  if (JSON.stringify(shown) !== JSON.stringify(ref)) {
    different++;
    if (different <= 6) {
      console.log('DIFFERENT', s.id);
      for (const key of ['judged', 'violations', 'excused', 'acts', 'cases', 'error']) {
        const a = JSON.stringify(ref[key]); const b = JSON.stringify(shown[key]);
        if (a === b) continue;
        const onlyRef = (ref[key] ?? []).filter?.((x) => !(shown[key] ?? []).some((y) => JSON.stringify(y) === JSON.stringify(x)));
        const onlyLib = (shown[key] ?? []).filter?.((x) => !(ref[key] ?? []).some((y) => JSON.stringify(y) === JSON.stringify(x)));
        console.log('  ', key, 'only in the reference:', JSON.stringify(onlyRef ?? ref[key]).slice(0, 500), '\n     only in the library:', JSON.stringify(onlyLib ?? shown[key]).slice(0, 500), onlyRef?.length === 0 && onlyLib?.length === 0 ? '(same elements, other order)' : '');
      }
    }
  }
}
console.log(`${Object.keys(expected).length} scenarios, ${different} differences, ${errors} reference errors, ${excusedTotal} excused`);
console.log('rules', JSON.stringify(Object.fromEntries(Object.entries(rules).sort())), '\nkinds', JSON.stringify(kinds));
process.exitCode = different || errors ? 1 : 0;
