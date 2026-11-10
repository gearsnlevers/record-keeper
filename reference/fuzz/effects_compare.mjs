// Runs `audit-plan` on every scenario of an effects_ref_run.py run and compares it with the Python reference.
// Usage: node effects_compare.mjs <dir> <ref.json>...
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../record-keeper.mjs';

const [dir, ...refs] = process.argv.slice(2);
const scenarios = JSON.parse(fs.readFileSync(path.join(dir, 'scenarios.json'), 'utf8'));
const expected = Object.assign({}, ...refs.map((file) => JSON.parse(fs.readFileSync(file, 'utf8'))));
const NOW = '2026-11-10T03:00:00Z';
let different = 0;
let errors = 0;
let compared = 0;
const actions = {};
const messages = {};
for (const scenario of scenarios) {
  const want = expected[String(scenario.id)];
  if (want === undefined) continue;
  if (want.error) { errors++; continue; }
  compared++;
  const folder = path.join(dir, `e${scenario.id}`);
  const args = ['audit-plan', '--repo', scenario.repo, '--head', scenario.head, '--issues', path.join(folder, 'issues.json'), '--now', NOW];
  if (want.args.adopted) args.push('--adopted');
  else if (want.args.from) args.push('--from', want.args.from);
  if (want.args.since) args.push('--since', want.args.since);
  if (want.evidence) args.push('--evidence', path.join(folder, 'evidence.json'));
  const got = run(args);
  let ok;
  if (want.kind === 'ok') {
    ok = got.code === 0 && got.stderr === '' && JSON.stringify(JSON.parse(got.stdout)) === JSON.stringify(want.answer) && got.stdout === `${JSON.stringify(want.answer)}\n`;
    for (const issue of want.answer.issues) actions[issue.action] = (actions[issue.action] ?? 0) + 1;
  } else {
    ok = got.code === 2 && got.stderr === `record-keeper: ${want.answer}\n`;
    const kind = want.answer.replace(/[0-9a-f]{40}/g, '<id>');
    messages[kind] = (messages[kind] ?? 0) + 1;
  }
  if (!ok) {
    different++;
    if (different <= 5) console.log(`DIFFERENT ${scenario.id} (${want.kind})`, '\n  ref', JSON.stringify(want.answer).slice(0, 700), '\n  lib', got.code, (got.stdout || got.stderr).slice(0, 700));
  }
}
console.log(`${compared + errors} scenarios, ${compared} compared, ${different} differences, ${errors} reference errors; actions ${JSON.stringify(actions)}; errors ${JSON.stringify(messages)}`);
process.exit(different ? 1 : 0);
