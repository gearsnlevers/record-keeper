// The workflow `Records updater` (docs/updater.md): what the page says about the file is stated here as tests. The file is read line by line, with no YAML
// library; `lint` returns what is wrong with a text, and the tests check both the real file and damaged copies of it, so that the rules cannot silently stop saying
// anything. The kit has one copy of this workflow, `templates/workflows/records-updater.yml`, which a repository that installs the kit gets at
// `.github/workflows/records-updater.yml`: the kit does not update itself, so it runs no copy of its own.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const page = fs.readFileSync(path.join(root, 'docs/updater.md'), 'utf8');
const workflow = fs.readFileSync(path.join(root, 'templates/workflows/records-updater.yml'), 'utf8');

const FILTERS = ['paths', 'paths-ignore', 'branches', 'branches-ignore', 'tags', 'tags-ignore'];
const FROM_THE_EVENT = ['pull_request', 'head.sha', 'head.ref', 'head_ref', 'refs/pull', 'merge_commit', 'github.sha', 'github.ref', 'github.event.comment', 'github.event.issue', 'github.actor', 'github.event.pull_request'];
const COMMAND = ['args=()', 'if [ -n "$TARGET" ]; then args+=(--target "$TARGET"); fi', 'if [ "$DRY_RUN" = "true" ]; then args+=(--dry-run); fi', 'node .github/record-keeper/updater.mjs "${args[@]}"'];
const EXPRESSIONS = new Set([
  '          ref: ${{ github.event.repository.default_branch }}',
  '          token: ${{ secrets.RECORD_KEEPER_TOKEN || github.token }}',
  '          RECORD_KEEPER_TOKEN: ${{ secrets.RECORD_KEEPER_TOKEN }}',
  '          TARGET: ${{ inputs.target }}',
  '          DRY_RUN: ${{ inputs.dry-run }}',
]);

const indentOf = (line) => line.length - line.trimStart().length;
/** The lines that are not comments or blank, without the comment at the end of a line. */
const codeOf = (text) => text.split('\n').filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#')).map((line) => line.replace(/\s+#.*$/, ''));

/** What is wrong with the text of the workflow file, by the rules of docs/updater.md. Empty when nothing is. */
function lint(text) {
  const code = codeOf(text);
  const found = [];
  const under = (key, indent, within = code) => {
    const at = within.findIndex((line) => line === `${' '.repeat(indent)}${key}:` || line.startsWith(`${' '.repeat(indent)}${key}: `));
    if (at < 0) return [];
    const block = [];
    for (let i = at + 1; i < within.length && indentOf(within[i]) > indent; i++) block.push(within[i]);
    return block;
  };
  const on = under('on', 0);
  const events = on.filter((line) => indentOf(line) === 2).map((line) => line.trim().split(':')[0]);
  if (JSON.stringify(events) !== JSON.stringify(['schedule', 'workflow_dispatch'])) found.push(`triggers: ${events.join(',') || 'none'}`);
  if (JSON.stringify(under('schedule', 2, on).map((line) => line.trim())) !== JSON.stringify(["- cron: '41 5 * * *'"])) found.push('schedule');
  const inputs = under('inputs', 4, on).map((line) => line.trim());
  const target = inputs.slice(inputs.indexOf('target:') + 1, inputs.indexOf('dry-run:'));
  if (!inputs.includes('target:') || !target.includes('type: string') || !target.includes('required: false') || target.some((line) => line.startsWith('default:'))) found.push('the input target');
  const dry = inputs.slice(inputs.indexOf('dry-run:') + 1);
  if (!inputs.includes('dry-run:') || !dry.includes('type: boolean') || !dry.includes('default: false')) found.push('the input dry-run');
  if (inputs.filter((line) => /^[a-z-]+:$/.test(line)).join() !== 'target:,dry-run:') found.push('inputs');
  if (JSON.stringify(under('permissions', 0)) !== JSON.stringify(['  contents: read']) || code.filter((line) => /^\s*permissions:/.test(line)).length !== 1) found.push('permissions are not contents: read, at the top, once');
  if (JSON.stringify(under('concurrency', 0).map((line) => line.trim())) !== JSON.stringify(['group: records-updater', 'cancel-in-progress: false'])) found.push('concurrency');
  const jobs = under('jobs', 0).filter((line) => indentOf(line) === 2).map((line) => line.trim().replace(/:$/, ''));
  if (jobs.length !== 1) found.push(`jobs: ${jobs.length}`);
  if (!under('jobs', 0).includes('    name: Records updater')) found.push('job name');
  if (!code.some((line) => /^ {4}timeout-minutes: [1-9][0-9]*$/.test(line))) found.push('timeout');
  if (!code.includes('    runs-on: ubuntu-latest')) found.push('runner');
  for (const line of code) {
    const key = line.trim().replace(/^- /, '').split(':')[0];
    if (FILTERS.includes(key)) found.push(`filter: ${key}`);
    if (key === 'if') found.push('condition: if');
    if (key === 'continue-on-error') found.push('continue-on-error');
    if (key === 'persist-credentials') found.push('the credentials of the checkout must stay');
    if (key === 'fetch-depth') found.push('fetch-depth is left alone');
    if (key === 'uses' && !/^uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40}$/.test(line.trim().replace(/^- /, ''))) found.push(`not pinned: ${line.trim()}`);
  }
  // the version of every pinned action is said, in a comment, so that a person can tell what the commit is
  for (const line of text.split('\n').filter((l) => l.includes('uses:') && !l.trimStart().startsWith('#'))) if (!/@[0-9a-f]{40} # v\d+\.\d+\.\d+$/.test(line)) found.push(`no version in a comment: ${line.trim()}`);
  const steps = under('steps', 4);
  const uses = steps.filter((line) => line.trim().startsWith('- uses:')).map((line) => line.trim().replace(/@.*$/, ''));
  if (JSON.stringify(uses) !== JSON.stringify(['- uses: actions/checkout', '- uses: actions/setup-node'])) found.push(`actions: ${uses.join(',')}`);
  const checkout = code.findIndex((line) => line.includes('uses: actions/checkout@'));
  if (checkout < 0) found.push('no checkout');
  else {
    const withs = [];
    for (let i = checkout + 1; i < code.length && !code[i].trim().startsWith('- '); i++) withs.push(code[i].trim());
    if (!withs.includes('ref: ${{ github.event.repository.default_branch }}')) found.push('checkout of something else than the default branch');
    if (!withs.includes('token: ${{ secrets.RECORD_KEEPER_TOKEN || github.token }}')) found.push('checkout without the token of the secret, or without the fallback');
  }
  const node = code.findIndex((line) => line.includes('uses: actions/setup-node@'));
  if (node < 0 || code[node + 1].trim() !== 'with:' || code[node + 2].trim() !== "node-version: '24'") found.push('node 24');
  for (const line of code) for (const word of FROM_THE_EVENT) if (line.includes(word)) found.push(`from the event: ${word}`);
  for (const line of code.filter((l) => l.includes('${{'))) if (!EXPRESSIONS.has(line)) found.push(`an expression: ${line.trim()}`);
  // the secret is in the two places that need it and in no other, and it is the only secret
  const secrets = code.filter((line) => line.includes('secrets.'));
  if (secrets.length !== 2 || !secrets.includes('          token: ${{ secrets.RECORD_KEEPER_TOKEN || github.token }}') || !secrets.includes('          RECORD_KEEPER_TOKEN: ${{ secrets.RECORD_KEEPER_TOKEN }}')) found.push(`secrets: ${secrets.length}`);
  if (secrets.some((line) => /secrets\.(?!RECORD_KEEPER_TOKEN\b)/.test(line))) found.push('another secret');
  if (code.filter((line) => line.includes('github.token')).length !== 1) found.push('github.token');
  if (/secrets\./.test(codeOf(text.split('\n').slice(0, text.split('\n').findIndex((l) => l === 'jobs:')).join('\n')).join('\n'))) found.push('a secret above the job');
  const runs = code.filter((line) => /^\s*(- )?run:/.test(line));
  if (runs.length !== 1) found.push(`run steps: ${runs.length}`);
  const run = under('run', 8).map((line) => line.trim());
  if (run.some((line) => line.includes('${{'))) found.push('expression in run');
  if (JSON.stringify(run) !== JSON.stringify(COMMAND)) found.push('run does not call the program as the page says');
  const envs = under('env', 8).map((line) => line.trim().split(':')[0]);
  if (JSON.stringify(envs) !== JSON.stringify(['RECORD_KEEPER_TOKEN', 'TARGET', 'DRY_RUN'])) found.push(`environment: ${envs.join(',')}`);
  return found;
}

describe('the workflow file of the updater', () => {
  test('follows every rule of the page', () => {
    assert.deepEqual(lint(workflow), []);
  });

  test('is named Records updater, in the file and in the job', () => {
    assert.match(workflow, /^name: Records updater$/m);
    assert.match(workflow, /^ {4}name: Records updater$/m);
  });

  test('is the file that install.json installs at the place of the workflow that the guard lists, and the kit has no copy of its own', () => {
    const install = JSON.parse(fs.readFileSync(path.join(root, 'install.json'), 'utf8'));
    assert.deepEqual(install.files.find((entry) => entry.source === 'templates/workflows/records-updater.yml'), { source: 'templates/workflows/records-updater.yml', path: '.github/workflows/records-updater.yml', kind: 'managed' });
    assert.ok(!fs.existsSync(path.join(root, '.github/workflows/records-updater.yml')));
    assert.match(fs.readFileSync(path.join(root, 'docs/protected-files.md'), 'utf8'), /\.github\/workflows\/records-updater\.yml/);
    assert.ok(fs.existsSync(path.join(root, 'updater.mjs')));
    assert.ok(install.files.some((entry) => entry.path === '.github/record-keeper/updater.mjs'), 'the program that it runs is installed with it');
  });

  test('runs the program at the place install.json puts it', () => {
    assert.ok(workflow.includes('node .github/record-keeper/updater.mjs "${args[@]}"'));
    assert.ok(!/node updater\.mjs/.test(workflow));
  });

  test('uses the same actions at the same commits as the other workflows of the kit', () => {
    const used = (text) => [...text.matchAll(/uses: (\S+)/g)].map((m) => m[1]).sort();
    for (const other of ['.github/workflows/test.yml', '.github/workflows/records-integrity.yml', '.github/workflows/records-audit.yml', 'templates/workflows/records-audit.yml']) {
      const text = fs.readFileSync(path.join(root, other), 'utf8');
      for (const action of used(workflow)) assert.ok(used(text).includes(action), `${other}: ${action}`);
    }
  });

  test('says what the page says: two triggers, the time, the two inputs, the permission, the secret and the name of the job', () => {
    for (const word of ['`Records updater`', '`RECORD_KEEPER_TOKEN`', '`workflow_dispatch`', '`target`', '`dry-run`', '05:41 UTC', 'Contents: write', 'Pull requests: write', 'Workflows: write', '`record-keeper/update`']) assert.ok(page.includes(word), word);
    const [minute, hour] = /- cron: '(\d+) (\d+) \* \* \*'/.exec(workflow).slice(1);
    assert.equal(`${hour.padStart(2, '0')}:${minute.padStart(2, '0')} UTC`, '05:41 UTC');
    assert.notEqual(`${minute} ${hour}`, '17 3', 'not the minute of the audit');
  });

  test('has no pull request trigger of any kind, and nothing that a pull request holds reaches it', () => {
    const code = codeOf(workflow).join('\n');
    for (const trigger of ['pull_request', 'pull_request_target', 'pull_request_review', 'push', 'workflow_run', 'issue_comment', 'issues', 'repository_dispatch', 'workflow_call']) assert.ok(!new RegExp(`^ {2}${trigger}:`, 'm').test(code), trigger);
    assert.ok(!/pull_request/.test(code));
  });

  test('gives the secret to no step but the checkout and the program, and never to a command line', () => {
    const lines = workflow.split('\n');
    const at = (needle) => lines.findIndex((line) => line.includes(needle));
    assert.ok(at('token: ${{ secrets.RECORD_KEEPER_TOKEN || github.token }}') < at('uses: actions/setup-node'), 'the checkout comes first');
    assert.ok(at('RECORD_KEEPER_TOKEN: ${{ secrets.RECORD_KEEPER_TOKEN }}') > at('uses: actions/setup-node'));
    assert.ok(!/node [^\n]*RECORD_KEEPER_TOKEN/.test(workflow));
  });
});

describe('the rules of the page, tried on damaged copies of the workflow of the updater', () => {
  const damage = (from, to) => {
    assert.ok(workflow.includes(from), from);
    return workflow.replace(from, to);
  };
  const cases = [
    ['a trigger on pull requests', damage('\non:\n', '\non:\n  pull_request:\n'), /triggers: pull_request/],
    ['a trigger on pull_request_target', damage('\non:\n', '\non:\n  pull_request_target:\n'), /triggers: pull_request_target/],
    ['a trigger on a push', damage('  workflow_dispatch:', '  push:\n    branches: [main]\n  workflow_dispatch:'), /triggers: /],
    ['a trigger on a finished workflow', damage('  workflow_dispatch:', '  workflow_run:\n  workflow_dispatch:'), /triggers: /],
    ['a trigger on a comment', damage('  workflow_dispatch:', '  issue_comment:\n  workflow_dispatch:'), /triggers: /],
    ['no schedule', damage("  schedule:\n    - cron: '41 5 * * *'\n", ''), /triggers: /],
    ['no manual trigger', damage('  workflow_dispatch:', '  workflow_call:'), /triggers: /],
    ['the minute of the audit', damage("'41 5 * * *'", "'17 3 * * *'"), /schedule/],
    ['another time', damage("'41 5 * * *'", "'41 6 * * *'"), /schedule/],
    ['a second time', damage("    - cron: '41 5 * * *'\n", "    - cron: '41 5 * * *'\n    - cron: '0 * * * *'\n"), /schedule/],
    ['a filter on the schedule', damage("    - cron: '41 5 * * *'\n", "    - cron: '41 5 * * *'\n  push:\n    paths: [x]\n"), /triggers|filter: paths/],
    ['no input target', damage("      target:\n        description: 'Release tag to go to (default: the newest release of the pinned channel)'\n        type: string\n        required: false\n", ''), /the input target/],
    ['an input target that is required', damage('        required: false', '        required: true'), /the input target/],
    ['an input target with a default', damage('        required: false', '        required: false\n        default: v1.0.0'), /the input target/],
    ['an input target that is a choice', damage('        type: string', '        type: choice'), /the input target/],
    ['no input dry-run', damage('        type: boolean\n', ''), /the input dry-run/],
    ['a dry run that is on by default', damage('        default: false', '        default: true'), /the input dry-run/],
    ['a third input', damage('        default: false', '        default: false\n      force:\n        type: boolean'), /inputs/],
    ['write permission for contents', damage('  contents: read', '  contents: write'), /permissions/],
    ['write permission for pull requests', damage('  contents: read', '  contents: read\n  pull-requests: write'), /permissions/],
    ['no permissions at the top', damage('permissions:\n  contents: read\n', ''), /permissions/],
    ['permissions at the top that write', damage('permissions:\n  contents: read', 'permissions: write-all'), /permissions/],
    ['permissions on the job', damage('    timeout-minutes: 15\n', '    timeout-minutes: 15\n    permissions:\n      contents: write\n'), /permissions/],
    ['a run that is cancelled', damage('cancel-in-progress: false', 'cancel-in-progress: true'), /concurrency/],
    ['another group', damage('group: records-updater', 'group: ${{ github.ref }}'), /concurrency|an expression/],
    ['no concurrency', damage('concurrency:\n  group: records-updater\n  cancel-in-progress: false\n', ''), /concurrency/],
    ['a second job', `${workflow}  other:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n`, /jobs: 2/],
    ['another name of the job', damage('    name: Records updater', '    name: Update'), /job name/],
    ['no timeout', damage('    timeout-minutes: 15\n', ''), /timeout/],
    ['another runner', damage('ubuntu-latest', 'self-hosted'), /runner/],
    ['a condition on the job', damage('    runs-on:', "    if: github.actor != 'bot'\n    runs-on:"), /condition: if/],
    ['a condition on a step', damage('      - name: Update Record Keeper', '      - if: always()\n        name: Update Record Keeper'), /condition: if/],
    ['a condition that skips the job on a fork', damage('    runs-on:', '    if: github.repository == github.event.repository.full_name\n    runs-on:'), /condition: if|from the event/],
    ['continue-on-error', damage('    runs-on:', '    continue-on-error: true\n    runs-on:'), /continue-on-error/],
    ['an action by tag', damage('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1', 'actions/checkout@v7'), /not pinned/],
    ['an action by a short commit', damage('actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', 'actions/setup-node@949feb2'), /not pinned/],
    ['an action by a branch', damage('actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', 'actions/setup-node@main'), /not pinned/],
    ['a commit without its version', damage('3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1', '3d3c42e5aac5ba805825da76410c181273ba90b1'), /no version in a comment/],
    ['a version that is not one', damage('# v7.1.0', '# latest'), /no version in a comment/],
    ['a third action', damage('      # Nothing from the event', '      - uses: actions/cache@0000000000000000000000000000000000000000 # v1.0.0\n\n      # Nothing from the event'), /actions: /],
    ['no checkout', damage('      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          ref: ${{ github.event.repository.default_branch }}\n          token: ${{ secrets.RECORD_KEEPER_TOKEN || github.token }}\n\n', ''), /no checkout|actions: /],
    ['a checkout of something else than the default branch', damage('ref: ${{ github.event.repository.default_branch }}', 'ref: main'), /checkout of something else/],
    ['a checkout of the head of a pull request', damage('ref: ${{ github.event.repository.default_branch }}', 'ref: ${{ github.event.pull_request.head.sha }}'), /checkout of something else|from the event/],
    ['a checkout with the token of the workflow only', damage('token: ${{ secrets.RECORD_KEEPER_TOKEN || github.token }}', 'token: ${{ github.token }}'), /checkout without the token|secrets: 1|github\.token|an expression/],
    ['a checkout with the secret and no fallback', damage('token: ${{ secrets.RECORD_KEEPER_TOKEN || github.token }}', 'token: ${{ secrets.RECORD_KEEPER_TOKEN }}'), /checkout without the token|an expression|secrets: /],
    ['a checkout with another secret', damage('token: ${{ secrets.RECORD_KEEPER_TOKEN || github.token }}', 'token: ${{ secrets.PAT }}'), /another secret|checkout without the token|an expression/],
    ['a checkout that drops the credentials', damage('          token: ${{ secrets.RECORD_KEEPER_TOKEN || github.token }}\n', '          token: ${{ secrets.RECORD_KEEPER_TOKEN || github.token }}\n          persist-credentials: false\n'), /credentials/],
    ['a checkout with another depth', damage('          token: ${{ secrets.RECORD_KEEPER_TOKEN || github.token }}\n', '          token: ${{ secrets.RECORD_KEEPER_TOKEN || github.token }}\n          fetch-depth: 0\n'), /fetch-depth/],
    ['another Node.js', damage("node-version: '24'", "node-version: '20'"), /node 24/],
    ['the secret in a third place', damage('          TARGET: ${{ inputs.target }}', '          TARGET: ${{ inputs.target }}\n          OTHER: ${{ secrets.RECORD_KEEPER_TOKEN }}'), /secrets: 3|environment|an expression/],
    ['another secret in the environment', damage('RECORD_KEEPER_TOKEN: ${{ secrets.RECORD_KEEPER_TOKEN }}', 'RECORD_KEEPER_TOKEN: ${{ secrets.OTHER_TOKEN }}'), /another secret|secrets: |an expression/],
    ['the token of the workflow for the program', damage('RECORD_KEEPER_TOKEN: ${{ secrets.RECORD_KEEPER_TOKEN }}', 'RECORD_KEEPER_TOKEN: ${{ github.token }}'), /secrets: 1|github\.token|an expression/],
    ['a secret on the command line', damage('node .github/record-keeper/updater.mjs "${args[@]}"', 'node .github/record-keeper/updater.mjs "${args[@]}" --token ${{ secrets.RECORD_KEEPER_TOKEN }}'), /expression in run|secrets: 3|does not call/],
    ['a secret at the top', damage('\npermissions:\n', '\nenv:\n  T: ${{ secrets.RECORD_KEEPER_TOKEN }}\n\npermissions:\n'), /a secret above the job|secrets: 3|an expression/],
    ['the actor in the environment', damage('DRY_RUN: ${{ inputs.dry-run }}', 'DRY_RUN: ${{ github.actor }}'), /from the event|an expression/],
    ['the title of a pull request in the environment', damage('TARGET: ${{ inputs.target }}', 'TARGET: ${{ github.event.pull_request.title }}'), /from the event|an expression/],
    ['an expression in the command', damage('args+=(--target "$TARGET")', 'args+=(--target ${{ inputs.target }})'), /expression in run|does not call/],
    ['the input in an if of the shell', damage('if [ "$DRY_RUN" = "true" ]', 'if [ "${{ inputs.dry-run }}" = "true" ]'), /expression in run|does not call/],
    ['a second command', damage('node .github/record-keeper/updater.mjs "${args[@]}"', 'node .github/record-keeper/updater.mjs "${args[@]}"\n      - run: echo done'), /run steps: 2/],
    ['another program', damage('node .github/record-keeper/updater.mjs', 'node updater.mjs'), /does not call/],
    ['the program with a flag that is not the page\'s', damage('node .github/record-keeper/updater.mjs "${args[@]}"', 'node .github/record-keeper/updater.mjs --local "${args[@]}"'), /does not call/],
    ['the arguments not quoted', damage('"${args[@]}"', '${args[@]}'), /does not call/],
    ['a target that is not quoted', damage('args+=(--target "$TARGET")', 'args+=(--target $TARGET)'), /does not call/],
    ['an environment with another variable', damage('          DRY_RUN: ${{ inputs.dry-run }}', '          DRY_RUN: ${{ inputs.dry-run }}\n          GH_TOKEN: x'), /environment/],
    ['the environment in another order', damage('          TARGET: ${{ inputs.target }}\n          DRY_RUN: ${{ inputs.dry-run }}', '          DRY_RUN: ${{ inputs.dry-run }}\n          TARGET: ${{ inputs.target }}'), /environment/],
  ];
  for (const [name, text, expected] of cases) {
    test(`${name} is found`, () => {
      assert.notEqual(text, workflow);
      const found = lint(text);
      assert.ok(found.length > 0, 'nothing found');
      assert.ok(found.some((message) => expected.test(message)), found.join(' | '));
    });
  }

  test('a comment does not count as a line of the file', () => {
    assert.deepEqual(lint(`# if: x\n# paths: y\n# secrets.OTHER\n${workflow}`), []);
    assert.deepEqual(lint(workflow.replace('    runs-on:', '    # if: always()\n    runs-on:')), []);
    assert.deepEqual(lint(workflow.replace('permissions:\n', '# permissions:\n#   contents: write\npermissions:\n')), []);
  });

  test('every rule that the lint has is shown to say something by at least one damaged copy', () => {
    const said = new Set(cases.flatMap(([, text]) => lint(text)).map((message) => message.replace(/:.*$/, '')));
    for (const rule of ['triggers', 'schedule', 'the input target', 'the input dry-run', 'inputs', 'concurrency', 'jobs', 'job name', 'timeout', 'runner', 'condition', 'continue-on-error', 'not pinned', 'no version in a comment', 'actions', 'no checkout',
      'checkout of something else than the default branch', 'checkout without the token of the secret, or without the fallback', 'node 24', 'from the event', 'an expression', 'secrets', 'another secret', 'run steps', 'expression in run', 'run does not call the program as the page says',
      'environment', 'permissions are not contents', 'the credentials of the checkout must stay', 'fetch-depth is left alone', 'a secret above the job']) {
      assert.ok([...said].some((message) => message.startsWith(rule.replace(/:.*$/, ''))), `no damaged copy shows the rule: ${rule}`);
    }
  });
});
