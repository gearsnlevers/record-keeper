// Runs `announce-plan` on every scenario of an announce_ref_run.py run and compares it with the Python reference.
// Usage: node announce_compare.mjs <dir> <ref.json>...
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../../record-keeper.mjs';

const [dir, ...refs] = process.argv.slice(2);
const scenarios = JSON.parse(fs.readFileSync(path.join(dir, 'scenarios.json'), 'utf8'));
const expected = Object.assign({}, ...refs.map((file) => JSON.parse(fs.readFileSync(file, 'utf8'))));
const NOW = '2026-11-10T03:00:00Z';
let different = 0;
let errors = 0;
let compared = 0;
let opened = 0;
let withLookups = 0;
let witnessed = 0;
const kinds = {};
const messages = {};
for (const scenario of scenarios) {
  const want = expected[String(scenario.id)];
  if (want === undefined) continue;
  if (want.error) { errors++; continue; }
  compared++;
  const folder = path.join(dir, `n${scenario.id}`);
  const files = (name) => path.join(folder, name);
  const evidence = want.kind === 'error' && !fs.existsSync(files('evidence.json')) ? files('missing.json') : files('evidence.json');
  const args = ['announce-plan', '--repo', scenario.repo, '--head', scenario.head, '--adopted', '--evidence', evidence, '--issues', files('issues.json'), '--logins', files('logins.json'), '--now', NOW];
  let got;
  if (want.kind === 'error' && !fs.existsSync(files('evidence.json'))) {
    // no adoption: the files do not exist, so write empty ones; the answer must still be the message about the adoption
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(files('evidence.json'), '{}');
    fs.writeFileSync(files('issues.json'), '[]');
    fs.writeFileSync(files('logins.json'), '{}');
    got = run(['announce-plan', '--repo', scenario.repo, '--head', scenario.head, '--adopted', '--evidence', files('evidence.json'), '--issues', files('issues.json'), '--logins', files('logins.json'), '--now', NOW]);
  } else got = run(args);
  let ok;
  if (want.kind === 'ok') {
    ok = got.code === 0 && got.stderr === '' && got.stdout === `${JSON.stringify(want.answer)}\n`;
    opened += want.answer.announcements.length;
    if (want.answer.lookups.length > 0) withLookups++;
    for (const item of want.answer.announcements) {
      kinds[item.title.replace(/ \(#\d+\)$/, '')] = (kinds[item.title.replace(/ \(#\d+\)$/, '')] ?? 0) + 1;
      if (item.body.includes('(witnesses)')) witnessed++;
    }
  } else {
    ok = got.code === 2 && got.stderr === `record-keeper: ${want.answer}\n`;
    const kind = want.answer.replace(/[0-9a-f]{40}/g, '<id>');
    messages[kind] = (messages[kind] ?? 0) + 1;
  }
  if (!ok) {
    different++;
    if (different <= 5) console.log(`DIFFERENT ${scenario.id} (${want.kind})`, '\n  ref', JSON.stringify(want.answer).slice(0, 900), '\n  lib', got.code, (got.stdout || got.stderr).slice(0, 900));
  }
}
console.log(`${compared + errors} scenarios, ${compared} compared, ${different} differences, ${errors} reference errors; ${opened} issues to open, ${withLookups} plans with lookups, ${witnessed} with witnesses; titles ${JSON.stringify(kinds)}; errors ${JSON.stringify(messages)}`);
process.exit(different ? 1 : 0);
