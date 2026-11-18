// The workflow `Records setup check` (docs/setup-check.md): what the page says about the file is stated here as tests. The file is read line by line, with no YAML
// library; `lint` returns what is wrong with a text, and the tests check both real files and damaged copies of them, so that the rules cannot silently stop saying
// anything.
//
// The rules are tried on two files: the workflow of the kit, which runs its program at the root, and the version that a repository gets when it installs the kit,
// which runs it in `.github/record-keeper/` (docs/install.md). The second is the first with the path of the program and the link to the page changed, and nothing
// else (test/install.test.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const page = fs.readFileSync(path.join(root, 'docs/setup-check.md'), 'utf8');

const FILTERS = ['branches', 'branches-ignore', 'paths-ignore', 'tags', 'tags-ignore', 'types'];
const FROM_THE_EVENT = ['pull_request_target', 'head.sha', 'head.ref', 'head_ref', 'refs/pull', 'merge_commit', 'github.sha', 'github.actor', 'github.event', 'github.head', 'github.base', 'inputs.', 'github.repository'];
const PATHS = [
  "- '.github/record-keeper.yml'", "- '.github/record-keeper/**'", "- '.github/workflows/records-*.yml'", "- '.github/CODEOWNERS'", "- 'CODEOWNERS'", "- 'docs/CODEOWNERS'", "- 'install.json'",
  "- 'record-keeper.mjs'", "- 'check-pull-request.mjs'", "- 'run-audit.mjs'", "- 'setup-check.mjs'", "- 'updater.mjs'",
];
const EXPRESSIONS = new Set([
  '  group: records-setup-check-${{ github.ref }}',
  '          GITHUB_TOKEN: ${{ github.token }}',
  "          HAS_RECORD_KEEPER_TOKEN: ${{ secrets.RECORD_KEEPER_TOKEN != '' }}",
]);

const VARIANTS = [
  { name: 'the kit', path: '.github/workflows/records-setup-check.yml', program: 'setup-check.mjs' },
  { name: 'a repository that installs the kit', path: 'templates/workflows/records-setup-check.yml', program: '.github/record-keeper/setup-check.mjs' },
];

const indentOf = (line) => line.length - line.trimStart().length;
/** The lines that are not comments or blank, without the comment at the end of a line. */
const codeOf = (text) => text.split('\n').filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#')).map((line) => line.replace(/\s+#.*$/, ''));

/** What is wrong with the text of a workflow file that runs `program`, by the rules of docs/setup-check.md. Empty when nothing is. */
function lint(text, program) {
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
  if (JSON.stringify(events) !== JSON.stringify(['schedule', 'workflow_dispatch', 'pull_request'])) found.push(`triggers: ${events.join(',') || 'none'}`);
  if (JSON.stringify(under('schedule', 2, on).map((line) => line.trim())) !== JSON.stringify(["- cron: '37 7 * * *'"])) found.push('schedule');
  if (JSON.stringify(under('paths', 4, on).map((line) => line.trim())) !== JSON.stringify(PATHS)) found.push('paths of the pull request');
  if (under('workflow_dispatch', 2, on).length > 0) found.push('inputs of the manual run');
  const pull = under('pull_request', 2, on).filter((line) => indentOf(line) === 4).map((line) => line.trim());
  if (JSON.stringify(pull) !== JSON.stringify(['paths:'])) found.push(`pull request: ${pull.join(',')}`);
  if (JSON.stringify(under('permissions', 0)) !== JSON.stringify(['  contents: read']) || code.filter((line) => /^\s*permissions:/.test(line)).length !== 1) found.push('permissions are not contents: read, at the top, once');
  if (JSON.stringify(under('concurrency', 0).map((line) => line.trim())) !== JSON.stringify(['group: records-setup-check-${{ github.ref }}', 'cancel-in-progress: true'])) found.push('concurrency');
  const jobs = under('jobs', 0).filter((line) => indentOf(line) === 2).map((line) => line.trim().replace(/:$/, ''));
  if (jobs.length !== 1) found.push(`jobs: ${jobs.length}`);
  if (!under('jobs', 0).includes('    name: Records setup check')) found.push('job name');
  if (!code.some((line) => /^ {4}timeout-minutes: [1-9][0-9]*$/.test(line))) found.push('timeout');
  if (!code.includes('    runs-on: ubuntu-latest')) found.push('runner');
  for (const line of code) {
    const key = line.trim().replace(/^- /, '').split(':')[0];
    if (FILTERS.includes(key)) found.push(`filter: ${key}`);
    if (key === 'if') found.push('condition: if');
    if (key === 'continue-on-error') found.push('continue-on-error');
    if (key === 'fetch-depth') found.push('fetch-depth is left alone');
    if (key === 'token') found.push('a token for the checkout');
    if (key === 'ref') found.push('a ref for the checkout');
    if (key === 'repository') found.push('a repository for the checkout');
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
    if (JSON.stringify(withs) !== JSON.stringify(['with:', 'persist-credentials: false'])) found.push('the checkout does not drop the credentials, or has more to say');
  }
  const node = code.findIndex((line) => line.includes('uses: actions/setup-node@'));
  if (node < 0 || code[node + 1].trim() !== 'with:' || code[node + 2].trim() !== "node-version: '24'") found.push('node 24');
  for (const line of code) for (const word of FROM_THE_EVENT) if (line.includes(word)) found.push(`from the event: ${word}`);
  for (const line of code.filter((l) => l.includes('${{'))) if (!EXPRESSIONS.has(line)) found.push(`an expression: ${line.trim()}`);
  // the secret is named once, to say whether it is set, and never given to the program
  const secrets = code.filter((line) => line.includes('secrets.'));
  if (secrets.length !== 1 || secrets[0] !== "          HAS_RECORD_KEEPER_TOKEN: ${{ secrets.RECORD_KEEPER_TOKEN != '' }}") found.push(`secrets: ${secrets.length}`);
  if (code.some((line) => /RECORD_KEEPER_TOKEN/.test(line) && !/HAS_RECORD_KEEPER_TOKEN/.test(line) && !/secrets\.RECORD_KEEPER_TOKEN != ''/.test(line))) found.push('the secret is passed on');
  if (code.some((line) => /secrets\.(?!RECORD_KEEPER_TOKEN != '')/.test(line))) found.push('another secret');
  if (code.some((line) => /\bGITHUB_TOKEN\b/.test(line) && line !== '          GITHUB_TOKEN: ${{ github.token }}')) found.push('the token of the workflow is used in another way');
  if (code.filter((line) => line.includes('github.token')).length !== 1) found.push('github.token');
  if (/secrets\./.test(codeOf(text.split('\n').slice(0, text.split('\n').findIndex((l) => l === 'jobs:')).join('\n')).join('\n'))) found.push('a secret above the job');
  const runs = code.filter((line) => /^\s*(- )?run:/.test(line));
  if (runs.length !== 1) found.push(`run steps: ${runs.length}`);
  if (code.some((line) => /^\s*run:/.test(line) && line.includes('${{'))) found.push('expression in run');
  if (!code.includes(`        run: node ${program} --repo "$GITHUB_REPOSITORY"`)) found.push('run does not call the program as the page says');
  const envs = under('env', 8).map((line) => line.trim().split(':')[0]);
  if (JSON.stringify(envs) !== JSON.stringify(['GITHUB_TOKEN', 'HAS_RECORD_KEEPER_TOKEN'])) found.push(`environment: ${envs.join(',')}`);
  return found;
}

for (const variant of VARIANTS) {
  const workflow = fs.readFileSync(path.join(root, variant.path), 'utf8');

  describe(`the workflow file of ${variant.name}`, () => {
    test('follows every rule of the page', () => {
      assert.deepEqual(lint(workflow, variant.program), []);
    });

    test('is named Records setup check, in the file and in the job', () => {
      assert.match(workflow, /^name: Records setup check$/m);
      assert.match(workflow, /^ {4}name: Records setup check$/m);
    });

    test('is the workflow file that the files of the check name, and calls a program that is in the repository', () => {
      const install = JSON.parse(fs.readFileSync(path.join(root, 'install.json'), 'utf8'));
      const source = variant.program.includes('/') ? install.files.find((entry) => entry.path === variant.program)?.source : variant.program;
      assert.equal(source, 'setup-check.mjs');
      assert.ok(fs.existsSync(path.join(root, source)));
      assert.ok(fs.existsSync(path.join(root, '.github/workflows/records-setup-check.yml')), 'the kit runs a copy of its own');
      if (variant.program.includes('/')) assert.deepEqual(install.files.find((entry) => entry.path === '.github/workflows/records-setup-check.yml'), { source: variant.path, path: '.github/workflows/records-setup-check.yml', kind: 'managed' });
      assert.match(fs.readFileSync(path.join(root, 'docs/protected-files.md'), 'utf8'), /\.github\/workflows\/records-setup-check\.yml/);
    });

    test('uses the same actions at the same commits as the other workflows of the kit', () => {
      const used = (text) => [...text.matchAll(/uses: (\S+)/g)].map((m) => m[1]).sort();
      for (const other of ['.github/workflows/test.yml', '.github/workflows/records-integrity.yml', '.github/workflows/records-audit.yml', 'templates/workflows/records-updater.yml']) {
        const text = fs.readFileSync(path.join(root, other), 'utf8');
        for (const action of used(workflow)) assert.ok(used(text).includes(action), `${other}: ${action}`);
      }
    });

    test('says what the page says: three triggers, the time, the permission, the secret, the name of the job and the paths', () => {
      for (const word of ['`Records setup check`', '`schedule`', '`workflow_dispatch`', '`pull_request`', '`pull_request_target`', '07:37 UTC', '`contents: read`', '`HAS_RECORD_KEEPER_TOKEN`', '`RECORD_KEEPER_TOKEN`', '`GITHUB_TOKEN`', '`persist-credentials: false`', '`actions: read`']) assert.ok(page.includes(word), word);
      for (const entry of PATHS) assert.ok(page.includes(`\`${entry.slice(3, -1)}\``), entry);
      const [minute, hour] = /- cron: '(\d+) (\d+) \* \* \*'/.exec(workflow).slice(1);
      assert.equal(`${hour.padStart(2, '0')}:${minute.padStart(2, '0')} UTC`, '07:37 UTC');
      assert.ok(!['17 3', '41 5'].includes(`${minute} ${hour}`), 'not the minute of the audit or of the updater');
    });

    test('has the permission that the page names and no other, and the page says that nothing else was asked for', () => {
      assert.match(workflow, /^permissions:\n {2}contents: read\n/m);
      assert.equal((workflow.match(/permissions:/g) ?? []).length, 1);
      assert.doesNotMatch(codeOf(workflow).join('\n'), /actions: read|checks: |issues: |pull-requests: |statuses: |write/);
      assert.match(page, /`contents: read` and nothing else/);
    });

    test('runs on a pull request, and never on pull_request_target, and no pull request can be skipped by it being required', () => {
      const code = codeOf(workflow).join('\n');
      assert.match(code, /^ {2}pull_request:$/m);
      assert.ok(!/pull_request_target/.test(code));
      for (const trigger of ['push', 'workflow_run', 'issue_comment', 'issues', 'repository_dispatch', 'workflow_call', 'pull_request_review']) assert.ok(!new RegExp(`^ {2}${trigger}:`, 'm').test(code), trigger);
      assert.match(page, /must not be made a required check/);
    });

    test('gives the secret to nobody: it is compared with nothing and the program is told yes or no', () => {
      const lines = workflow.split('\n');
      const at = lines.findIndex((line) => line.includes('secrets.'));
      assert.match(lines[at], /^ {10}HAS_RECORD_KEEPER_TOKEN: \$\{\{ secrets\.RECORD_KEEPER_TOKEN != '' \}\}$/);
      assert.ok(!/node [^\n]*RECORD_KEEPER_TOKEN/.test(workflow));
      assert.ok(!/with:\n[^\n]*secrets/.test(workflow));
    });

    test('does not name the pull request check: the one workflow that does is the check itself', () => {
      assert.doesNotMatch(workflow, /records[ _-]?integrity/i);
    });
  });

  describe(`the rules of the page, tried on damaged copies of the workflow of ${variant.name}`, () => {
    const damage = (from, to) => {
      assert.ok(workflow.includes(from), from);
      return workflow.replace(from, to);
    };
    const run = `node ${variant.program} --repo "$GITHUB_REPOSITORY"`;
    const cases = [
      ['a trigger on pull_request_target', damage('\non:\n', '\non:\n  pull_request_target:\n'), /triggers: pull_request_target|from the event: pull_request_target/],
      ['a trigger on a push', damage('  workflow_dispatch:', '  push:\n    branches: [main]\n  workflow_dispatch:'), /triggers: /],
      ['a trigger on a finished workflow', damage('  workflow_dispatch:', '  workflow_run:\n  workflow_dispatch:'), /triggers: /],
      ['a trigger on a comment', damage('  workflow_dispatch:', '  issue_comment:\n  workflow_dispatch:'), /triggers: /],
      ['a trigger on a review', damage('  workflow_dispatch:', '  pull_request_review:\n  workflow_dispatch:'), /triggers: /],
      ['no schedule', damage("  schedule:\n    - cron: '37 7 * * *'\n", ''), /triggers: /],
      ['no manual trigger', damage('  workflow_dispatch:\n', ''), /triggers: /],
      ['no pull request trigger', damage(/\n {2}pull_request:\n(?: {4,}[^\n]*\n)+/.exec(workflow)[0], '\n'), /triggers: |pull request: |paths of the pull request/],
      ['the minute of the audit', damage("'37 7 * * *'", "'17 3 * * *'"), /schedule/],
      ['the minute of the updater', damage("'37 7 * * *'", "'41 5 * * *'"), /schedule/],
      ['a second time', damage("    - cron: '37 7 * * *'\n", "    - cron: '37 7 * * *'\n    - cron: '0 * * * *'\n"), /schedule/],
      ['an input of the manual run', damage('  workflow_dispatch:\n', '  workflow_dispatch:\n    inputs:\n      x:\n        type: string\n'), /inputs of the manual run/],
      ['a path less', damage("      - 'CODEOWNERS'\n", ''), /paths of the pull request/],
      ['a path more', damage("      - 'CODEOWNERS'\n", "      - 'CODEOWNERS'\n      - 'README.md'\n"), /paths of the pull request/],
      ['no filter on the paths', damage(/ {4}paths:\n(?: {6}- [^\n]*\n)+/.exec(workflow)[0], ''), /paths of the pull request|pull request: /],
      ['a filter of the branches of the pull request', damage('    paths:\n', '    branches: [main]\n    paths:\n'), /filter: branches|pull request: /],
      ['a filter of the types of the pull request', damage('    paths:\n', '    types: [opened]\n    paths:\n'), /filter: types|pull request: /],
      ['write permission for contents', damage('  contents: read', '  contents: write'), /permissions/],
      ['the permission to read the runs of actions', damage('  contents: read', '  contents: read\n  actions: read'), /permissions/],
      ['write permission for pull requests', damage('  contents: read', '  contents: read\n  pull-requests: write'), /permissions/],
      ['no permissions at the top', damage('permissions:\n  contents: read\n', ''), /permissions/],
      ['permissions at the top that write', damage('permissions:\n  contents: read', 'permissions: write-all'), /permissions/],
      ['permissions on the job', damage('    timeout-minutes: 10\n', '    timeout-minutes: 10\n    permissions:\n      contents: write\n'), /permissions/],
      ['a run that is not cancelled', damage('cancel-in-progress: true', 'cancel-in-progress: false'), /concurrency/],
      ['another group', damage('group: records-setup-check-${{ github.ref }}', 'group: records-setup-check'), /concurrency/],
      ['a group made of the title of a pull request', damage('group: records-setup-check-${{ github.ref }}', 'group: ${{ github.event.pull_request.title }}'), /concurrency|from the event|an expression/],
      ['no concurrency', damage('concurrency:\n  group: records-setup-check-${{ github.ref }}\n  cancel-in-progress: true\n', ''), /concurrency/],
      ['a second job', `${workflow}  other:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n`, /jobs: 2/],
      ['another name of the job', damage('    name: Records setup check', '    name: Setup'), /job name/],
      ['no timeout', damage('    timeout-minutes: 10\n', ''), /timeout/],
      ['another runner', damage('ubuntu-latest', 'self-hosted'), /runner/],
      ['a condition on the job', damage('    runs-on:', "    if: github.actor != 'bot'\n    runs-on:"), /condition: if/],
      ['a condition on a step', damage('      - name: Check the setup', '      - if: always()\n        name: Check the setup'), /condition: if/],
      ['continue-on-error', damage('    runs-on:', '    continue-on-error: true\n    runs-on:'), /continue-on-error/],
      ['an action by tag', damage('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1', 'actions/checkout@v7'), /not pinned/],
      ['an action by a short commit', damage('actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', 'actions/setup-node@949feb2'), /not pinned/],
      ['an action by a branch', damage('actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', 'actions/setup-node@main'), /not pinned/],
      ['a commit without its version', damage('3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1', '3d3c42e5aac5ba805825da76410c181273ba90b1'), /no version in a comment/],
      ['a third action', damage('      # Nothing from the event', '      - uses: actions/cache@0000000000000000000000000000000000000000 # v1.0.0\n\n      # Nothing from the event'), /actions: /],
      ['no checkout', damage('      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          persist-credentials: false\n\n', ''), /no checkout|actions: /],
      ['a checkout that keeps the credentials', damage('        with:\n          persist-credentials: false\n\n      - uses: actions/setup-node', '\n      - uses: actions/setup-node'), /does not drop the credentials/],
      ['a checkout of the default branch', damage('          persist-credentials: false\n', '          persist-credentials: false\n          ref: ${{ github.event.repository.default_branch }}\n'), /a ref for the checkout|does not drop|from the event|an expression/],
      ['a checkout of the head of a pull request', damage('          persist-credentials: false\n', '          persist-credentials: false\n          ref: ${{ github.event.pull_request.head.sha }}\n'), /a ref for the checkout|from the event|does not drop/],
      ['a checkout with a token', damage('          persist-credentials: false\n', '          persist-credentials: false\n          token: ${{ secrets.RECORD_KEEPER_TOKEN }}\n'), /a token for the checkout|secrets: 2|an expression|does not drop/],
      ['a checkout of the whole history', damage('          persist-credentials: false\n', '          persist-credentials: false\n          fetch-depth: 0\n'), /fetch-depth|does not drop/],
      ['a checkout of another repository', damage('          persist-credentials: false\n', '          persist-credentials: false\n          repository: other/repo\n'), /a repository for the checkout|does not drop/],
      ['another Node.js', damage("node-version: '24'", "node-version: '20'"), /node 24/],
      ['the secret given to the program', damage("HAS_RECORD_KEEPER_TOKEN: ${{ secrets.RECORD_KEEPER_TOKEN != '' }}", 'RECORD_KEEPER_TOKEN: ${{ secrets.RECORD_KEEPER_TOKEN }}'), /secrets: 1|the secret is passed on|an expression|environment/],
      ['the secret given to the program as well', damage('          GITHUB_TOKEN: ${{ github.token }}\n', '          GITHUB_TOKEN: ${{ github.token }}\n          RECORD_KEEPER_TOKEN: ${{ secrets.RECORD_KEEPER_TOKEN }}\n'), /secrets: 2|the secret is passed on|an expression|environment/],
      ['the secret as the token of the workflow', damage('GITHUB_TOKEN: ${{ github.token }}', 'GITHUB_TOKEN: ${{ secrets.RECORD_KEEPER_TOKEN }}'), /secrets: 2|the secret is passed on|an expression|github\.token/],
      ['another secret', damage("secrets.RECORD_KEEPER_TOKEN != ''", "secrets.OTHER != ''"), /another secret|secrets: |an expression/],
      ['a secret on the command line', damage(run, `${run} --token \${{ secrets.RECORD_KEEPER_TOKEN }}`), /expression in run|secrets: 2|does not call/],
      ['a secret at the top', damage('\npermissions:\n', '\nenv:\n  T: ${{ secrets.RECORD_KEEPER_TOKEN }}\n\npermissions:\n'), /a secret above the job|secrets: 2|an expression/],
      ['the secret read as a value', damage("secrets.RECORD_KEEPER_TOKEN != ''", "secrets.RECORD_KEEPER_TOKEN == 'x'"), /secrets: 1|an expression/],
      ['the token of the workflow used as well somewhere else', damage('      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0\n        with:\n', '      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0\n        with:\n          token: ${{ github.token }}\n'), /github\.token|an expression/],
      ['the actor in the environment', damage("HAS_RECORD_KEEPER_TOKEN: ${{ secrets.RECORD_KEEPER_TOKEN != '' }}", 'HAS_RECORD_KEEPER_TOKEN: ${{ github.actor }}'), /from the event|an expression|secrets: 0/],
      ['the title of a pull request in the environment', damage('GITHUB_TOKEN: ${{ github.token }}', 'GITHUB_TOKEN: ${{ github.token }}\n          TITLE: ${{ github.event.pull_request.title }}'), /from the event|an expression|environment/],
      ['an expression in the command', damage(run, `node ${variant.program} --repo \${{ github.repository }}`), /expression in run|does not call|from the event/],
      ['the repository from the event in the environment', damage('GITHUB_TOKEN: ${{ github.token }}', 'GITHUB_TOKEN: ${{ github.token }}\n          R: ${{ github.repository }}'), /from the event: github\.repository|an expression|environment/],
      ['a second command', damage(run, `${run}\n      - run: echo done`), /run steps: 2/],
      ['another program', damage(`node ${variant.program}`, 'node updater.mjs'), /does not call/],
      ['a flag that is not the page\'s', damage(run, `${run} --local`), /does not call/],
      ['the repository not quoted', damage('"$GITHUB_REPOSITORY"', '$GITHUB_REPOSITORY'), /does not call/],
      ['an environment with another variable', damage('          GITHUB_TOKEN: ${{ github.token }}', '          GITHUB_TOKEN: ${{ github.token }}\n          GH_TOKEN: x'), /environment/],
      ['the environment in another order', damage("          GITHUB_TOKEN: ${{ github.token }}\n          HAS_RECORD_KEEPER_TOKEN: ${{ secrets.RECORD_KEEPER_TOKEN != '' }}", "          HAS_RECORD_KEEPER_TOKEN: ${{ secrets.RECORD_KEEPER_TOKEN != '' }}\n          GITHUB_TOKEN: ${{ github.token }}"), /environment/],
    ];
    for (const [name, text, expected] of cases) {
      test(`${name} is found`, () => {
        assert.notEqual(text, workflow);
        const found = lint(text, variant.program);
        assert.ok(found.length > 0, 'nothing found');
        assert.ok(found.some((message) => expected.test(message)), found.join(' | '));
      });
    }

    test('a comment does not count as a line of the file', () => {
      assert.deepEqual(lint(`# if: x\n# paths: y\n# secrets.OTHER\n${workflow}`, variant.program), []);
      assert.deepEqual(lint(workflow.replace('    runs-on:', '    # if: always()\n    runs-on:'), variant.program), []);
      assert.deepEqual(lint(workflow.replace('permissions:\n', '# permissions:\n#   contents: write\npermissions:\n'), variant.program), []);
    });

    test('every rule that the lint has is shown to say something by at least one damaged copy', () => {
      const said = new Set(cases.flatMap(([, text]) => lint(text, variant.program)).map((message) => message.replace(/:.*$/, '')));
      for (const rule of ['triggers', 'schedule', 'paths of the pull request', 'inputs of the manual run', 'pull request', 'concurrency', 'jobs', 'job name', 'timeout', 'runner', 'condition', 'continue-on-error', 'not pinned', 'no version in a comment', 'actions',
        'no checkout', 'the checkout does not drop the credentials, or has more to say', 'a ref for the checkout', 'a token for the checkout', 'a repository for the checkout', 'fetch-depth is left alone', 'filter', 'node 24', 'from the event', 'an expression', 'secrets', 'the secret is passed on',
        'another secret', 'github.token', 'run steps', 'expression in run', 'run does not call the program as the page says', 'environment', 'permissions are not contents', 'a secret above the job']) {
        assert.ok([...said].some((message) => message.startsWith(rule)), `no damaged copy shows the rule: ${rule}`);
      }
    });
  });
}
