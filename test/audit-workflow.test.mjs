// The workflow `Records audit` (docs/audit-run.md): what the page says about the file is stated here as tests. The file is read line by line, with no
// YAML library; `lint` returns what is wrong with a text, and the tests check both the real file and damaged copies of it, so that the rules cannot
// silently stop saying anything.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const workflow = fs.readFileSync(path.join(root, '.github/workflows/records-audit.yml'), 'utf8');
const page = fs.readFileSync(path.join(root, 'docs/audit-run.md'), 'utf8');

const FILTERS = ['paths', 'paths-ignore', 'branches-ignore', 'tags', 'tags-ignore'];
const FROM_THE_EVENT = ['pull_request', 'head.sha', 'head.ref', 'head_ref', 'refs/pull', 'merge_commit', 'github.sha', 'github.ref', 'secrets.', 'github.event.comment', 'github.event.issue', 'github.actor'];

const indentOf = (line) => line.length - line.trimStart().length;
/** The lines that are not comments or blank, without the comment at the end of a line. */
const codeOf = (text) => text.split('\n').filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#')).map((line) => line.replace(/\s+#.*$/, ''));

/** What is wrong with the text of a workflow file, by the rules of docs/audit-run.md. Empty when nothing is. */
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
  if (JSON.stringify(events) !== JSON.stringify(['schedule', 'push', 'workflow_dispatch'])) found.push(`triggers: ${events.join(',') || 'none'}`);
  if (JSON.stringify(under('schedule', 2, on).map((line) => line.trim())) !== JSON.stringify(["- cron: '17 3 * * *'"])) found.push('schedule');
  if (JSON.stringify(under('push', 2, on).map((line) => line.trim())) !== JSON.stringify(['branches: [main]'])) found.push('push');
  const input = under('inputs', 4, on).map((line) => line.trim());
  if (!input.includes('dry-run:') || !input.includes('type: boolean') || !input.includes('default: false')) found.push('the input dry-run');
  if (!code.includes('permissions: {}')) found.push('top-level permissions are not empty');
  if (JSON.stringify(under('concurrency', 0).map((line) => line.trim())) !== JSON.stringify(['group: records-audit', 'cancel-in-progress: false'])) found.push('concurrency');
  const jobs = under('jobs', 0).filter((line) => indentOf(line) === 2).map((line) => line.trim().replace(/:$/, ''));
  if (jobs.length !== 1) found.push(`jobs: ${jobs.length}`);
  if (!under('jobs', 0).includes('    name: Records audit')) found.push('job name');
  const permissions = under('permissions', 4).map((line) => line.trim());
  if (JSON.stringify(permissions) !== JSON.stringify(['checks: read', 'contents: write', 'issues: write', 'pull-requests: read'])) found.push(`job permissions: ${permissions.join(',')}`);
  if (!code.some((line) => /^ {4}timeout-minutes: [1-9][0-9]*$/.test(line))) found.push('timeout');
  for (const line of code) {
    const key = line.trim().replace(/^- /, '').split(':')[0];
    if (FILTERS.includes(key)) found.push(`filter: ${key}`);
    if (key === 'if') found.push('condition: if');
    if (key === 'continue-on-error') found.push('continue-on-error');
    if (key === 'persist-credentials') found.push('the credentials of the checkout must stay');
    if (key === 'uses' && !/^uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40}$/.test(line.trim().replace(/^- /, ''))) found.push(`not pinned: ${line.trim()}`);
  }
  const checkout = code.findIndex((line) => line.includes('uses: actions/checkout@'));
  if (checkout < 0) found.push('no checkout');
  else {
    const withs = [];
    for (let i = checkout + 1; i < code.length && !code[i].trim().startsWith('- '); i++) withs.push(code[i].trim());
    if (!withs.includes('ref: ${{ github.event.repository.default_branch }}')) found.push('checkout of something else than the default branch');
    if (!withs.includes('fetch-depth: 0')) found.push('checkout without the whole history');
  }
  for (const line of code) for (const word of FROM_THE_EVENT) if (line.includes(word)) found.push(`from the event: ${word}`);
  const expressions = code.filter((line) => line.includes('${{'));
  const allowed = new Set(['          ref: ${{ github.event.repository.default_branch }}', '          GITHUB_TOKEN: ${{ github.token }}', '          DRY_RUN: ${{ inputs.dry-run }}']);
  for (const line of expressions) if (!allowed.has(line)) found.push(`an expression: ${line.trim()}`);
  const run = under('run', 8);
  const steps = code.filter((line) => /^\s*(- )?run:/.test(line));
  if (steps.length !== 1) found.push(`run steps: ${steps.length}`);
  if (run.some((line) => line.includes('${{'))) found.push('expression in run');
  const script = run.map((line) => line.trim());
  const expected = ['if [ "$DRY_RUN" = "true" ]; then', 'node run-audit.mjs --repo "$GITHUB_REPOSITORY" --dry-run', 'else', 'node run-audit.mjs --repo "$GITHUB_REPOSITORY"', 'fi'];
  if (JSON.stringify(script) !== JSON.stringify(expected)) found.push('run does not call the program as the page says');
  return found;
}

describe('the workflow file', () => {
  test('follows every rule of the page', () => {
    assert.deepEqual(lint(workflow), []);
  });

  test('is named Records audit, in the file and in the job', () => {
    assert.match(workflow, /^name: Records audit$/m);
    assert.match(workflow, /^ {4}name: Records audit$/m);
  });

  test('is the workflow file that the files of the check name, and calls a program that is in the repository', () => {
    assert.ok(fs.existsSync(path.join(root, '.github/workflows/records-audit.yml')));
    assert.ok(fs.existsSync(path.join(root, 'run-audit.mjs')));
    assert.ok(fs.existsSync(path.join(root, 'record-keeper.mjs')));
    assert.match(fs.readFileSync(path.join(root, 'docs/protected-files.md'), 'utf8'), /\.github\/workflows\/records-audit\.yml/);
  });

  test('uses the same two actions at the same commits as the tests of the kit and the pull request check', () => {
    const used = (text) => [...text.matchAll(/uses: (\S+)/g)].map((m) => m[1]).sort();
    for (const other of ['test.yml', 'records-integrity.yml']) {
      const text = fs.readFileSync(path.join(root, '.github/workflows', other), 'utf8');
      for (const action of used(workflow)) assert.ok(used(text).includes(action), `${other}: ${action}`);
    }
  });

  test('says what the page says: three triggers, the schedule, the four permissions and the name of the job', () => {
    for (const word of ['`schedule`', '`push`', '`workflow_dispatch`', '03:17 UTC', '`contents: write`', '`issues: write`', '`pull-requests: read`', '`checks: read`', '`Records audit`', '`dry-run`']) assert.ok(page.includes(word), word);
  });

  test('does not name the pull request check: the one workflow that does is the check itself', () => {
    const named = fs.readdirSync(path.join(root, '.github/workflows')).filter((name) => /records[ _-]?integrity/i.test(fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8')));
    assert.deepEqual(named, ['records-integrity.yml']);
  });
});

describe('the rules of the page, tried on damaged copies', () => {
  const damage = (from, to) => {
    assert.ok(workflow.includes(from), from);
    return workflow.replace(from, to);
  };
  const cases = [
    ['a trigger on pull requests', damage('\non:\n', '\non:\n  pull_request:\n'), /triggers: pull_request/],
    ['a trigger on pull_request_target', damage('\non:\n', '\non:\n  pull_request_target:\n'), /triggers: pull_request_target/],
    ['a trigger on a finished workflow', damage('  workflow_dispatch:', '  workflow_run:\n  workflow_dispatch:'), /triggers: /],
    ['a trigger on a comment', damage('  workflow_dispatch:', '  issue_comment:\n  workflow_dispatch:'), /triggers: /],
    ['no schedule', damage("  schedule:\n    - cron: '17 3 * * *'\n", ''), /triggers: /],
    ['another time', damage("'17 3 * * *'", "'17 4 * * *'"), /schedule/],
    ['a second time', damage("    - cron: '17 3 * * *'\n", "    - cron: '17 3 * * *'\n    - cron: '0 * * * *'\n"), /schedule/],
    ['a push to every branch', damage('    branches: [main]', '    branches: [main, "*"]'), /push/],
    ['a push to a tag', damage('    branches: [main]', '    branches: [main]\n    tags: [v1]'), /push|filter: tags/],
    ['a paths filter on the push', damage('    branches: [main]', '    branches: [main]\n    paths: [docs/**]'), /push|filter: paths/],
    ['no input', damage('        type: boolean\n', ''), /the input dry-run/],
    ['an input that is true by default', damage('        default: false', '        default: true'), /the input dry-run/],
    ['write permission for pull requests', damage('      pull-requests: read', '      pull-requests: write'), /job permissions/],
    ['write permission for checks', damage('      checks: read', '      checks: write'), /job permissions/],
    ['no permission for issues', damage('      issues: write\n', ''), /job permissions/],
    ['an extra permission', damage('      pull-requests: read', '      pull-requests: read\n      actions: write'), /job permissions/],
    ['read for contents', damage('      contents: write', '      contents: read'), /job permissions/],
    ['no permissions at the top', damage('permissions: {}\n', ''), /top-level permissions/],
    ['permissions at the top that write', damage('permissions: {}', 'permissions: write-all'), /top-level permissions/],
    ['a run that is cancelled', damage('cancel-in-progress: false', 'cancel-in-progress: true'), /concurrency/],
    ['another group', damage('group: records-audit', 'group: ${{ github.ref }}'), /concurrency|an expression/],
    ['no concurrency', damage('concurrency:\n  group: records-audit\n  cancel-in-progress: false\n', ''), /concurrency/],
    ['a second job', `${workflow}  other:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n`, /jobs: 2/],
    ['another name of the job', damage('    name: Records audit', '    name: Audit'), /job name/],
    ['no timeout', damage('    timeout-minutes: 30\n', ''), /timeout/],
    ['a condition on the job', damage('    runs-on:', "    if: github.actor != 'bot'\n    runs-on:"), /condition: if/],
    ['a condition on a step', damage('      - name: Audit the records', '      - if: always()\n        name: Audit the records'), /condition: if/],
    ['continue-on-error', damage('    runs-on:', '    continue-on-error: true\n    runs-on:'), /continue-on-error/],
    ['an action by tag', damage('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 'actions/checkout@v4'), /not pinned/],
    ['an action by a short commit', damage('actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', 'actions/setup-node@949feb2'), /not pinned/],
    ['a checkout of something else', damage('ref: ${{ github.event.repository.default_branch }}', 'ref: main'), /checkout of something else/],
    ['a checkout of the head of a pull request', damage('ref: ${{ github.event.repository.default_branch }}', 'ref: ${{ github.event.pull_request.head.sha }}'), /checkout of something else|from the event/],
    ['a shallow checkout', damage('          fetch-depth: 0\n', ''), /whole history/],
    ['a checkout that drops the credentials', damage('          fetch-depth: 0\n', '          fetch-depth: 0\n          persist-credentials: false\n'), /credentials/],
    ['a secret as the token', damage('GITHUB_TOKEN: ${{ github.token }}', 'GITHUB_TOKEN: ${{ secrets.PAT }}'), /from the event: secrets|an expression/],
    ['the actor in the environment', damage('DRY_RUN: ${{ inputs.dry-run }}', 'DRY_RUN: ${{ github.actor }}'), /from the event|an expression/],
    ['an expression in the command', damage('node run-audit.mjs --repo "$GITHUB_REPOSITORY" --dry-run', 'node run-audit.mjs --repo ${{ github.repository }} --dry-run'), /expression/],
    ['a second command', damage('\n            node run-audit.mjs --repo "$GITHUB_REPOSITORY"\n          fi\n', '\n            node run-audit.mjs --repo "$GITHUB_REPOSITORY"\n          fi\n      - run: echo done\n'), /run steps: 2/],
    ['another program', damage('node run-audit.mjs --repo "$GITHUB_REPOSITORY" --dry-run', 'node check-pull-request.mjs --repo "$GITHUB_REPOSITORY" --dry-run'), /does not call/],
    ['the input anywhere in the command', damage('if [ "$DRY_RUN" = "true" ]; then', 'if [ "${{ inputs.dry-run }}" = "true" ]; then'), /expression/],
  ];
  for (const [name, text, expected] of cases) {
    test(`${name} is found`, () => {
      const found = lint(text);
      assert.ok(found.length > 0, 'nothing found');
      assert.ok(found.some((message) => expected.test(message)), found.join(' | '));
    });
  }

  test('a comment does not count as a line of the file', () => {
    assert.deepEqual(lint(`# if: x\n# paths: y\n${workflow}`), []);
    assert.deepEqual(lint(workflow.replace('    runs-on:', '    # if: always()\n    runs-on:')), []);
  });
});
