// The workflow `Records integrity` (docs/workflow.md): what the page says about the file is stated here as tests. The file is read line by line, with
// no YAML library; `lint` returns what is wrong with a text, and the tests check both the real file and damaged copies of it, so that the
// rules cannot silently stop saying anything.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const file = path.join(root, '.github/workflows/records-integrity.yml');
const workflow = fs.readFileSync(file, 'utf8');
const page = fs.readFileSync(path.join(root, 'docs/workflow.md'), 'utf8');

const FILTERS = ['paths', 'paths-ignore', 'branches', 'branches-ignore', 'tags', 'tags-ignore'];
const FROM_THE_PULL_REQUEST = ['pull_request.head', 'head.sha', 'head.ref', 'head_ref', 'head.repo', 'refs/pull', 'merge_commit', 'github.sha', 'github.ref', 'secrets.'];

const indentOf = (line) => line.length - line.trimStart().length;
/** The lines that are not comments or blank, without the comment at the end of a line. */
const codeOf = (text) => text.split('\n').filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#')).map((line) => line.replace(/\s+#.*$/, ''));

/** What is wrong with the text of a workflow file, by the rules of docs/workflow.md. Empty when nothing is. */
function lint(text) {
  const code = codeOf(text);
  const found = [];
  const under = (key, indent) => {
    const at = code.findIndex((line) => line === `${' '.repeat(indent)}${key}:` || line.startsWith(`${' '.repeat(indent)}${key}: `));
    if (at < 0) return [];
    const block = [];
    for (let i = at + 1; i < code.length && indentOf(code[i]) > indent; i++) block.push(code[i]);
    return block;
  };
  const events = code.filter((line) => /^ {2}[a-z_]+:/.test(line) && under('on', 0).includes(line)).map((line) => line.trim().split(':')[0]);
  if (events.length !== 1 || events[0] !== 'pull_request_target') found.push(`trigger: ${events.join(',') || 'none'}`);
  if (!code.includes('permissions: {}')) found.push('top-level permissions are not empty');
  const jobs = under('jobs', 0).filter((line) => indentOf(line) === 2).map((line) => line.trim().replace(/:$/, ''));
  if (jobs.length !== 1) found.push(`jobs: ${jobs.length}`);
  const job = under('jobs', 0);
  if (!job.includes('    name: Records integrity')) found.push('job name');
  const permissions = under('permissions', 4).map((line) => line.trim());
  if (JSON.stringify(permissions) !== JSON.stringify(['contents: read', 'pull-requests: read'])) found.push(`job permissions: ${permissions.join(',')}`);
  if (!code.some((line) => /^ {4}timeout-minutes: [1-9][0-9]*$/.test(line))) found.push('timeout');
  for (const line of code) {
    const key = line.trim().replace(/^- /, '').split(':')[0];
    if (FILTERS.includes(key)) found.push(`filter: ${key}`);
    if (key === 'if') found.push('condition: if');
    if (key === 'continue-on-error') found.push('continue-on-error');
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
  for (const line of code) for (const word of FROM_THE_PULL_REQUEST) if (line.includes(word)) found.push(`from the pull request: ${word}`);
  const runs = [];
  code.forEach((line, i) => {
    if (!/^\s*(- )?run:/.test(line)) return;
    const indent = indentOf(line.replace(/^(\s*)- /, '$1  '));
    const block = [line];
    for (let j = i + 1; j < code.length && indentOf(code[j]) > indent; j++) block.push(code[j]);
    runs.push(block.join('\n'));
  });
  if (runs.length !== 1) found.push(`run steps: ${runs.length}`);
  for (const run of runs) if (run.includes('${{')) found.push('expression in run');
  if (!runs.every((run) => run.includes('node check-pull-request.mjs --repo "$GITHUB_REPOSITORY" --pr "$PULL_REQUEST"'))) found.push('run does not call the program as the page says');
  if (!code.includes('          GITHUB_TOKEN: ${{ github.token }}')) found.push('token');
  if (!code.includes('          PULL_REQUEST: ${{ github.event.pull_request.number }}')) found.push('number');
  return found;
}

describe('the workflow file', () => {
  test('follows every rule of the page', () => {
    assert.deepEqual(lint(workflow), []);
  });

  test('is named Records integrity, in the file and in the job', () => {
    assert.match(workflow, /^name: Records integrity$/m);
    assert.match(workflow, /^ {4}name: Records integrity$/m);
  });

  test('runs for the events the page lists', () => {
    const types = /^ {4}types: \[(.*)\]$/m.exec(workflow)[1].split(', ');
    assert.deepEqual(types, ['opened', 'synchronize', 'reopened', 'ready_for_review', 'edited']);
    for (const type of types) assert.ok(page.includes(`\`${type}\``), type);
  });

  test('calls a program that is in the repository, at the path it names', () => {
    assert.ok(fs.existsSync(path.join(root, 'check-pull-request.mjs')));
    assert.ok(fs.existsSync(path.join(root, 'record-keeper.mjs')));
  });

  test('uses the same two actions at the same commits as the tests of the kit', () => {
    const used = (text) => [...text.matchAll(/uses: (\S+)/g)].map((m) => m[1]).sort();
    const tests = fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8');
    for (const action of used(workflow)) assert.ok(used(tests).includes(action), action);
  });
});

describe('the rules of the page, tried on damaged copies', () => {
  const damage = (from, to) => {
    assert.ok(workflow.includes(from), from);
    return workflow.replace(from, to);
  };
  const cases = [
    ['pull_request instead of pull_request_target', damage('pull_request_target:', 'pull_request:'), /trigger: pull_request$/],
    ['a second trigger', damage('\non:\n', '\non:\n  workflow_dispatch:\n'), /trigger: /],
    ['a trigger on a review', damage('  pull_request_target:\n    types: [opened, synchronize, reopened, ready_for_review, edited]', '  pull_request_target:\n    types: [opened]\n  pull_request_review:\n    types: [submitted]'), /trigger: /],
    ['a paths filter', damage('    types: [opened', '    paths: [docs/**]\n    types: [opened'), /filter: paths/],
    ['a paths-ignore filter', damage('    types: [opened', '    paths-ignore: [docs/**]\n    types: [opened'), /filter: paths-ignore/],
    ['a branches filter', damage('    types: [opened', '    branches: [main]\n    types: [opened'), /filter: branches/],
    ['a condition on the job', damage('    runs-on:', '    if: github.actor != \'bot\'\n    runs-on:'), /condition: if/],
    ['a condition on a step', damage('      - name: Judge', '      - if: always()\n        name: Judge'), /condition: if/],
    ['continue-on-error', damage('    runs-on:', '    continue-on-error: true\n    runs-on:'), /continue-on-error/],
    ['write permission on the job', damage('      contents: read', '      contents: write'), /job permissions/],
    ['an extra permission', damage('      pull-requests: read', '      pull-requests: read\n      checks: write'), /job permissions/],
    ['pull-requests: write', damage('      pull-requests: read', '      pull-requests: write'), /job permissions/],
    ['no permissions at the top', damage('permissions: {}\n', ''), /top-level permissions/],
    ['permissions at the top that write', damage('permissions: {}', 'permissions: write-all'), /top-level permissions/],
    ['a second job', `${workflow}  other:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n`, /jobs: 2/],
    ['another name of the job', damage('    name: Records integrity', '    name: Integrity'), /job name/],
    ['no timeout', damage('    timeout-minutes: 10\n', ''), /timeout/],
    ['an action by tag', damage('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 'actions/checkout@v4'), /not pinned/],
    ['an action by a short commit', damage('actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', 'actions/setup-node@949feb2'), /not pinned/],
    ['an action from a branch', damage('actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', 'actions/setup-node@main'), /not pinned/],
    ['the checkout of the head of the pull request', damage('ref: ${{ github.event.repository.default_branch }}', 'ref: ${{ github.event.pull_request.head.sha }}'), /checkout of something else|from the pull request/],
    ['the checkout of the merge ref', damage('ref: ${{ github.event.repository.default_branch }}', 'ref: refs/pull/${{ github.event.number }}/merge'), /checkout of something else|from the pull request/],
    ['a checkout without a ref', damage('          ref: ${{ github.event.repository.default_branch }}\n', ''), /checkout of something else/],
    ['a shallow checkout', damage('          fetch-depth: 0\n', ''), /whole history/],
    ['the head ref anywhere', damage('node check-pull-request.mjs', 'echo ${{ github.head_ref }}; node check-pull-request.mjs'), /from the pull request/],
    ['a secret', damage('GITHUB_TOKEN: ${{ github.token }}', 'GITHUB_TOKEN: ${{ secrets.PAT }}'), /from the pull request: secrets\.|token/],
    ['an expression in the command', damage('--pr "$PULL_REQUEST"', '--pr ${{ github.event.pull_request.number }}'), /expression in run|does not call/],
    ['a second command', damage('--pr "$PULL_REQUEST"', '--pr "$PULL_REQUEST"\n      - run: echo done'), /run steps: 2/],
    ['another command', damage('node check-pull-request.mjs', 'node record-keeper.mjs'), /does not call/],
    ['the number from elsewhere', damage('PULL_REQUEST: ${{ github.event.pull_request.number }}', 'PULL_REQUEST: ${{ github.event.number }}'), /number/],
    ['the token from elsewhere', damage('GITHUB_TOKEN: ${{ github.token }}', 'GITHUB_TOKEN: ${{ github.event.pull_request.title }}'), /token/],
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
