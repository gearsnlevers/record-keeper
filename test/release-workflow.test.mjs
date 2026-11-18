// The workflow `Release` (docs/releases.md): what the page says about the file is stated here as tests. The file is read line by line, with no YAML library;
// `lint` returns what is wrong with a text, and the tests check both the real file and damaged copies of it, so that the rules cannot silently stop saying
// anything. The workflow is run for real by the maintainer, so what cannot be tried here has to be written down here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
const page = fs.readFileSync(path.join(root, 'docs/releases.md'), 'utf8');

const GUARD = "env.DRY_RUN != 'true'";
const WRITES = /\bgit (?:push|commit|tag)\b|\bgh release (?:create|upload|edit|delete)\b/;
const ACTIONS = {
  'actions/checkout': '3d3c42e5aac5ba805825da76410c181273ba90b1',
  'actions/setup-node': '949feb2413d6458794dcd2491c4babbbce0c15c1',
};
const indentOf = (line) => line.length - line.trimStart().length;
/** The lines that are not comments or blank, without the comment at the end of a line. */
const codeOf = (text) => text.split('\n').filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#')).map((line) => line.replace(/\s+#.*$/, ''));

/** The steps of the one job: { name, if, uses, run, lines }. A step starts at `      - ` and runs to the next one. */
function stepsOf(text) {
  const code = codeOf(text);
  const at = code.findIndex((line) => line === '    steps:');
  if (at < 0) return [];
  const steps = [];
  for (let i = at + 1; i < code.length; i++) {
    if (code[i].startsWith('      - ')) steps.push({ lines: [] });
    if (steps.length === 0 || indentOf(code[i]) < 6) continue;
    steps.at(-1).lines.push(code[i]);
  }
  return steps.map(({ lines }) => {
    const field = (key) => {
      const own = lines.find((line) => line.replace(/^ {6}- /, '        ').startsWith(`        ${key}: `));
      return own === undefined ? undefined : own.replace(/^ {6}- /, '        ').slice(`        ${key}: `.length);
    };
    const run = lines.findIndex((line) => line.replace(/^ {6}- /, '        ').startsWith('        run:'));
    const body = run < 0 ? '' : [lines[run].replace(/^ {6}- /, '        ').replace(/^ {8}run:\s*\|?/, ''), ...lines.slice(run + 1).filter((_, j) => indentOf(lines[run + 1 + j]) > 8)].join('\n');
    return { name: field('name'), if: field('if'), uses: field('uses'), run: run < 0 ? undefined : body, lines };
  });
}

/** What is wrong with the text of the workflow file, by the rules of docs/releases.md. Empty when nothing is. */
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
  if (JSON.stringify(events) !== JSON.stringify(['workflow_dispatch'])) found.push(`triggers: ${events.join(',') || 'none'}`);
  const inputs = under('inputs', 4, on);
  const input = (name) => under(name, 6, inputs).map((line) => line.trim());
  const type = input('release-type');
  const options = under('options', 8, inputs).map((line) => line.trim());
  if (!type.includes('type: choice') || !type.includes("default: 'prerelease'") || JSON.stringify(options) !== JSON.stringify(['- prerelease', '- premajor', '- patch', '- minor', '- major'])) found.push('the input release-type');
  const dry = input('dry-run');
  if (!dry.includes('type: boolean') || !dry.includes('default: false')) found.push('the input dry-run');
  if (JSON.stringify(under('permissions', 0)) !== JSON.stringify(['  contents: write'])) found.push(`permissions: ${under('permissions', 0).map((line) => line.trim()).join(',') || 'none'}`);
  if (code.some((line) => /^ {4,}permissions:/.test(line))) found.push('permissions of a job');
  if (JSON.stringify(under('concurrency', 0).map((line) => line.trim())) !== JSON.stringify(['group: release', 'cancel-in-progress: false'])) found.push('concurrency');
  const jobs = under('jobs', 0).filter((line) => indentOf(line) === 2).map((line) => line.trim().replace(/:$/, ''));
  if (jobs.length !== 1) found.push(`jobs: ${jobs.length}`);
  if (!under('jobs', 0).includes('    name: Release')) found.push('job name');
  if (!code.some((line) => /^ {4}timeout-minutes: [1-9][0-9]*$/.test(line))) found.push('timeout');
  if (!code.includes('      DRY_RUN: ${{ inputs.dry-run }}')) found.push('the dry run is not in the environment');
  for (const line of code) {
    const key = line.trim().replace(/^- /, '').split(':')[0];
    if (key === 'continue-on-error') found.push('continue-on-error');
    if (key === 'persist-credentials') found.push('the credentials of the checkout must stay, the release pushes with them');
  }
  const raw = text.split('\n').filter((line) => /^\s*(- )?uses:/.test(line));
  for (const line of raw) {
    const used = /^\s*(?:- )?uses: ([\w.-]+\/[\w.-]+)@([0-9a-f]{40}) # v\d+\.\d+\.\d+$/.exec(line);
    if (used === null) found.push(`not pinned to a commit with the tag in a comment: ${line.trim()}`);
    else if (ACTIONS[used[1]] !== undefined && ACTIONS[used[1]] !== used[2]) found.push(`another commit than the other workflows use: ${used[1]}`);
  }
  const steps = stepsOf(text);
  const index = (name) => steps.findIndex((step) => step.name === name);
  const named = (name) => steps[index(name)];
  const order = ['Require the default branch for a real release', 'Tests', 'The records of the kit', 'Compute the next version', 'Release preflight checks', 'Update package.json', 'Check the install set',
    'Commit the changelog and the version', 'Build and verify the release manifest', 'Create and push the tag', 'Create the draft release', 'Upload the manifest to the draft release', 'Publish the release'];
  for (const name of order) if (index(name) < 0) found.push(`no step ${name}`);
  const at = order.map(index);
  if (at.every((i) => i >= 0) && at.some((i, k) => k > 0 && i <= at[k - 1])) found.push('the steps are not in the order of the page');
  if (at.every((i) => i >= 0) && !(index('Release notes and changelog (AI)') > at[5] && index('Release notes and changelog (GitHub generated)') > at[5] && index('Release notes and changelog (GitHub generated)') < at[6])) found.push('the notes are not between the version and the check of the install set');
  const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  if (checkout === undefined) found.push('no checkout');
  else {
    if (!checkout.lines.some((line) => line.trim() === 'fetch-depth: 0')) found.push('checkout without the whole history');
    if (!checkout.lines.some((line) => line.trim() === 'fetch-tags: true')) found.push('checkout without the tags');
  }
  for (const step of steps) {
    if (step.run !== undefined && WRITES.test(step.run) && !(step.if ?? '').includes(GUARD)) found.push(`a step that writes is not guarded by the dry run: ${step.name}`);
    if (step.run !== undefined && step.run.includes('${{')) found.push(`expression in run: ${step.name}`);
    if (step.run !== undefined && step.run.split('\n').some((line) => /\bgh release create\b/.test(line) && !line.includes('--draft'))) found.push('a release is created without being a draft');
  }
  const must = (name, pattern, message) => {
    const step = named(name);
    if (step !== undefined && !pattern.test(step.run ?? '')) found.push(message);
  };
  const guard = named('Require the default branch for a real release');
  if (guard !== undefined && guard.if !== "env.DRY_RUN != 'true' && github.ref_name != github.event.repository.default_branch") found.push('the default branch is not required for a real release');
  for (const name of ['Tests', 'The records of the kit', 'Compute the next version', 'Release preflight checks', 'Update package.json', 'Check the install set', 'Build and verify the release manifest']) {
    const step = named(name);
    if (step !== undefined && step.if !== undefined) found.push(`a step that must always run has a condition: ${name}`);
  }
  must('Check the install set', /build-release-manifest\.mjs --version "\$\{VERSION\}" --tag "\$\{TAG\}" --commit "\$\(git rev-parse HEAD\)" --out "\$\{RUNNER_TEMP\}\/install-set-check\.json"\n\s*node tools\/build-release-manifest\.mjs --verify/, 'the install set is not checked before the commit');
  must('Tests', /^\s*npm test$/, 'the tests are not npm test');
  must('The records of the kit', /^\s*node record-keeper\.mjs validate docs\/decisions$/, 'the records are not validated');
  must('Build and verify the release manifest', /build-release-manifest\.mjs --version "\$\{VERSION\}" --tag "\$\{TAG\}" --commit "\$\(git rev-parse HEAD\)" --out release-manifest\.json/, 'the manifest is not built for the commit that is released');
  must('Build and verify the release manifest', /build-release-manifest\.mjs --verify release-manifest\.json/, 'the manifest is not verified by the Node program');
  must('Build and verify the release manifest', /python3 reference\/verify_manifest\.py --verify release-manifest\.json/, 'the manifest is not verified by the second implementation');
  must('Create and push the tag', /git tag -a "\$\{TAG\}"/, 'the tag is not annotated');
  must('Create and push the tag', /already exists on the current commit; skipping/, 'the tag is not idempotent for the same commit');
  must('Create and push the tag', /already exists on a different commit"\n\s*exit 1/, 'a tag on another commit is not refused');
  must('Create the draft release', /gh release create "\$\{TAG\}" --draft --verify-tag --prerelease[^\n]*\n\s*else\n\s*gh release create "\$\{TAG\}" --draft --verify-tag --title/, 'the release is not created as a draft');
  must('Upload the manifest to the draft release', /gh release upload "\$\{TAG\}" release-manifest\.json/, 'the manifest is not uploaded');
  must('Upload the manifest to the draft release', /grep -xF "\$\{size\}"/, 'the upload is not checked');
  must('Publish the release', /gh release edit "\$\{TAG\}" --draft=false/, 'the release is not published by editing the draft');
  const published = steps.flatMap((step, i) => (step.run !== undefined && /--draft=false/.test(step.run) ? [i] : []));
  const uploaded = steps.flatMap((step, i) => (step.run !== undefined && /gh release upload/.test(step.run) ? [i] : []));
  if (published.length !== 1 || uploaded.length !== 1 || published[0] <= uploaded[0]) found.push('the release is published before the manifest is uploaded');
  const artifact = steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
  if (artifact === undefined || artifact.if !== "env.DRY_RUN == 'true'" || !artifact.lines.some((line) => line.trim() === 'release-manifest.json') || !artifact.lines.some((line) => line.trim() === 'RELEASE_NOTES.md')) found.push('the dry run does not upload the manifest and the notes');
  const summary = named('Summary');
  if (summary === undefined || summary.if !== 'always()' || !summary.run.includes('GITHUB_STEP_SUMMARY')) found.push('no summary that always runs');
  const ai = named('Release notes and changelog (AI)');
  if (ai !== undefined && ai.if !== "env.HAS_LLM_KEY == 'true'") found.push('the AI changelog does not wait for its key');
  const plain = named('Release notes and changelog (GitHub generated)');
  if (plain !== undefined && (plain.if !== "env.HAS_LLM_KEY != 'true'" || !/node tools\/update-changelog\.mjs --tag "\$\{TAG\}" --notes RELEASE_NOTES\.md/.test(plain.run))) found.push('the generated notes do not make the changelog');
  const commit = named('Commit the changelog and the version');
  if (commit !== undefined && !/git add CHANGELOG\.md package\.json/.test(commit.run)) found.push('the commit is not of the changelog and the version');
  return found;
}

describe('the workflow file', () => {
  test('follows every rule of the page', () => {
    assert.deepEqual(lint(workflow), []);
  });

  test('is named Release, in the file and in the job', () => {
    assert.match(workflow, /^name: Release$/m);
    assert.match(workflow, /^ {4}name: Release$/m);
  });

  test('runs by hand only: no push, no pull request, no schedule', () => {
    const triggers = workflow.slice(workflow.indexOf('\non:\n'), workflow.indexOf('\npermissions:\n'));
    assert.doesNotMatch(triggers, /^ {2}(?:push|pull_request|pull_request_target|schedule|workflow_run|release|issues|issue_comment):/m);
    assert.match(workflow, /^on:\n {2}workflow_dispatch:\n/m);
  });

  test('has the same release types as the page lists', () => {
    for (const kind of ['prerelease', 'premajor', 'patch', 'minor', 'major']) assert.ok(page.includes(`\`${kind}\``), kind);
  });

  test('pins the four release actions of the organisation and the three of GitHub, each to a commit with its version in a comment', () => {
    const used = [...workflow.matchAll(/uses: ([\w./-]+)@([0-9a-f]{40}) # (v\d+\.\d+\.\d+)/g)].map((m) => m[1]);
    assert.deepEqual(used.sort(), ['actions/checkout', 'actions/setup-node', 'actions/upload-artifact', 'gearsnlevers/ai-changelog-action', 'gearsnlevers/manifest-version-update-action',
      'gearsnlevers/release-preflight-action', 'gearsnlevers/version-bump-action']);
  });

  test('uses the checkout and the setup of the other workflows at the same commits', () => {
    const used = (text) => [...text.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    for (const other of ['test.yml', 'records-integrity.yml', 'records-audit.yml']) {
      const text = fs.readFileSync(path.join(root, '.github/workflows', other), 'utf8');
      for (const action of used(workflow).filter((name) => name.startsWith('actions/checkout') || name.startsWith('actions/setup-node'))) assert.ok(used(text).includes(action), `${other}: ${action}`);
    }
  });

  test('calls programs that are in the repository, and does not name the check', () => {
    for (const file of ['tools/build-release-manifest.mjs', 'tools/update-changelog.mjs', 'reference/verify_manifest.py', 'record-keeper.mjs', 'install.json', 'CHANGELOG.md']) assert.ok(fs.existsSync(path.join(root, file)), file);
    assert.doesNotMatch(workflow, /records[ _-]?integrity/i);
  });

  test('says what the page says: the dry run, the draft, the manifest and the order', () => {
    for (const word of ['`dry-run`', '`release-manifest.json`', '`contents: write`', 'draft', 'immutable']) assert.ok(page.includes(word), word);
  });

  test('the steps that write are exactly those after the manifest is built and the commit and tag steps before it', () => {
    const writes = stepsOf(workflow).filter((step) => step.run !== undefined && WRITES.test(step.run)).map((step) => step.name);
    assert.deepEqual(writes, ['Commit the changelog and the version', 'Create and push the tag', 'Create the draft release', 'Upload the manifest to the draft release', 'Publish the release']);
  });
});

describe('the rules of the page, tried on damaged copies', () => {
  const damage = (from, to) => {
    assert.ok(workflow.includes(from), from);
    return workflow.replace(from, to);
  };
  const withoutStep = (name) => {
    const start = workflow.indexOf(`      - name: ${name}\n`);
    assert.ok(start >= 0, name);
    const next = workflow.indexOf('\n      - ', start + 1);
    const comment = workflow.indexOf('\n      #', start + 1);
    const end = [next, comment, workflow.length - 1].filter((i) => i >= 0).reduce((a, b) => Math.min(a, b));
    return workflow.slice(0, start) + workflow.slice(end + 1);
  };
  const cases = [
    ['a trigger on push', damage('\non:\n  workflow_dispatch:', '\non:\n  push:\n    branches: [main]\n  workflow_dispatch:'), /triggers: /],
    ['a schedule', damage('\non:\n  workflow_dispatch:', '\non:\n  schedule:\n    - cron: "0 0 * * 0"\n  workflow_dispatch:'), /triggers: /],
    ['a release type that is not one', damage('          - premajor\n', ''), /release-type/],
    ['a release type by default that is major', damage("default: 'prerelease'", "default: 'major'"), /release-type/],
    ['no dry run input', damage('        type: boolean\n', ''), /dry-run/],
    ['a dry run that is on by default', damage('        default: false', '        default: true'), /dry-run/],
    ['no permissions', damage('permissions:\n  contents: write\n\n', ''), /permissions: none/],
    ['more permissions', damage('  contents: write\n', '  contents: write\n  pull-requests: write\n'), /permissions: /],
    ['read permission only', damage('  contents: write', '  contents: read'), /permissions: /],
    ['write-all', damage('  contents: write', '  actions: write\n  contents: write'), /permissions: /],
    ['permissions of the job', damage('    timeout-minutes: 20\n', '    timeout-minutes: 20\n    permissions:\n      contents: write\n'), /permissions of a job/],
    ['a release that is cancelled', damage('cancel-in-progress: false', 'cancel-in-progress: true'), /concurrency/],
    ['another group', damage('group: release', 'group: ${{ github.ref }}'), /concurrency/],
    ['no concurrency', damage('concurrency:\n  group: release\n  cancel-in-progress: false\n', ''), /concurrency/],
    ['a second job', `${workflow}  other:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n`, /jobs: 2/],
    ['another name of the job', damage('    name: Release\n', '    name: Cut\n'), /job name/],
    ['no timeout', damage('    timeout-minutes: 20\n', ''), /timeout/],
    ['no dry run in the environment', damage('      DRY_RUN: ${{ inputs.dry-run }}\n', ''), /dry run is not in the environment/],
    ['continue-on-error', damage('    runs-on:', '    continue-on-error: true\n    runs-on:'), /continue-on-error/],
    ['an action by tag', damage('gearsnlevers/version-bump-action@0ee6d19f6b0da78996bf17da9a3fc9cfd6078d09 # v1.1.0', 'gearsnlevers/version-bump-action@v1'), /not pinned/],
    ['an action by a short commit', damage('gearsnlevers/release-preflight-action@c5b6bf27adcd3b0da9088841b22aecba47a3fa17', 'gearsnlevers/release-preflight-action@c5b6bf2'), /not pinned/],
    ['an action by a branch', damage('actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2', 'actions/upload-artifact@main'), /not pinned/],
    ['an action without its version in a comment', damage('actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0', 'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1'), /not pinned/],
    ['a checkout at another commit than the other workflows', damage('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 'actions/checkout@' + 'a'.repeat(40)), /another commit/],
    ['a shallow checkout', damage('          fetch-depth: 0\n', ''), /whole history/],
    ['a checkout without the tags', damage('          fetch-tags: true\n', ''), /without the tags/],
    ['a checkout that drops the credentials', damage('          fetch-tags: true\n', '          fetch-tags: true\n          persist-credentials: false\n'), /credentials/],
    ['a real release from any branch', damage("if: env.DRY_RUN != 'true' && github.ref_name != github.event.repository.default_branch", "if: github.ref_name != github.event.repository.default_branch"), /default branch is not required/],
    ['a default branch that is not required', withoutStep('Require the default branch for a real release'), /no step Require the default branch/],
    ['no tests', withoutStep('Tests'), /no step Tests/],
    ['tests that are skipped in a dry run', damage('      - name: Tests\n', "      - name: Tests\n        if: env.DRY_RUN != 'true'\n"), /must always run has a condition: Tests/],
    ['another test command', damage('run: npm test', 'run: npm run lint'), /not npm test/],
    ['no validation of the records', damage('node record-keeper.mjs validate docs/decisions', 'echo skipped'), /records are not validated/],
    ['a version that is skipped in a dry run', damage('      - name: Compute the next version\n', "      - name: Compute the next version\n        if: env.DRY_RUN != 'true'\n"), /must always run has a condition: Compute/],
    ['no preflight', withoutStep('Release preflight checks'), /no step Release preflight/],
    ['no check of the install set before the commit', withoutStep('Check the install set'), /no step Check the install set/],
    ['a check of the install set that is skipped in a dry run', damage('      - name: Check the install set\n', "      - name: Check the install set\n        if: env.DRY_RUN != 'true'\n"), /must always run has a condition: Check the install set/],
    ['a check of the install set that checks nothing', damage('--out "${RUNNER_TEMP}/install-set-check.json"\n          node tools/build-release-manifest.mjs --verify "${RUNNER_TEMP}/install-set-check.json"', '--out "${RUNNER_TEMP}/install-set-check.json"\n          true'), /install set is not checked before the commit/],
    ['a commit that is not guarded', damage("      - name: Commit the changelog and the version\n        if: env.DRY_RUN != 'true'\n", '      - name: Commit the changelog and the version\n'), /not guarded by the dry run: Commit/],
    ['a commit guarded by the other value', damage("        if: env.DRY_RUN != 'true'\n        env:\n          TAG: ${{ steps.version.outputs.newTag }}\n        run: |\n          set -euo pipefail\n          git config", "        if: env.DRY_RUN == 'true'\n        env:\n          TAG: ${{ steps.version.outputs.newTag }}\n        run: |\n          set -euo pipefail\n          git config"), /not guarded by the dry run: Commit/],
    ['a tag that is not guarded', damage("      - name: Create and push the tag\n        if: env.DRY_RUN != 'true'\n", '      - name: Create and push the tag\n'), /not guarded by the dry run: Create and push the tag/],
    ['a draft that is not guarded', damage("      - name: Create the draft release\n        if: env.DRY_RUN != 'true'\n", '      - name: Create the draft release\n'), /not guarded by the dry run: Create the draft/],
    ['an upload that is not guarded', damage("      - name: Upload the manifest to the draft release\n        if: env.DRY_RUN != 'true'\n", '      - name: Upload the manifest to the draft release\n'), /not guarded by the dry run: Upload the manifest/],
    ['a publication that is not guarded', damage("      - name: Publish the release\n        if: env.DRY_RUN != 'true'\n", '      - name: Publish the release\n'), /not guarded by the dry run: Publish/],
    ['a release that is created in the publish step', damage('gh release edit "${TAG}" --draft=false', 'gh release create "${TAG}" --notes-file RELEASE_NOTES.md'), /without being a draft|not published by editing/],
    ['a release that is not a draft', damage('gh release create "${TAG}" --draft --verify-tag --prerelease', 'gh release create "${TAG}" --verify-tag --prerelease'), /without being a draft|not created as a draft/],
    ['a stable release that is not a draft', damage('gh release create "${TAG}" --draft --verify-tag --title', 'gh release create "${TAG}" --verify-tag --title'), /without being a draft|not created as a draft/],
    ['no upload of the manifest', damage('gh release upload "${TAG}" release-manifest.json', 'echo skipped'), /manifest is not uploaded|published before/],
    ['an upload that is not checked', damage('| grep -xF "${size}"', '| cat'), /upload is not checked/],
    ['a publication before the upload', damage('gh release upload "${TAG}" release-manifest.json', 'gh release edit "${TAG}" --draft=false'), /published before the manifest is uploaded|manifest is not uploaded/],
    ['the steps in another order', damage('      - name: Create the draft release\n', '      - name: Publish the release\n        if: env.DRY_RUN != \'true\'\n        run: gh release edit "${TAG}" --draft=false\n\n      - name: Create the draft release\n'), /order of the page|published before/],
    ['a manifest built for another commit', damage('--commit "$(git rev-parse HEAD)" --out release-manifest.json', '--commit "${GITHUB_SHA}" --out release-manifest.json'), /not built for the commit/],
    ['a manifest that is not verified', damage('node tools/build-release-manifest.mjs --verify release-manifest.json', 'true'), /not verified by the Node program/],
    ['a manifest that the second implementation does not verify', damage('python3 reference/verify_manifest.py --verify release-manifest.json', 'true'), /second implementation/],
    ['a tag that is not annotated', damage('git tag -a "${TAG}" -m "Release ${TAG}"', 'git tag "${TAG}"'), /not annotated/],
    ['a tag that moves', damage('echo "::error::Tag ${TAG} already exists on a different commit"\n            exit 1', 'echo "::error::Tag ${TAG} already exists on a different commit"'), /another commit is not refused/],
    ['a tag that is not idempotent', damage('already exists on the current commit; skipping', 'already exists'), /not idempotent/],
    ['a dry run that uploads nothing', damage("        if: env.DRY_RUN == 'true'\n        uses: actions/upload-artifact", "        if: env.DRY_RUN != 'true'\n        uses: actions/upload-artifact"), /dry run does not upload/],
    ['a dry run that loses the notes', damage('            RELEASE_NOTES.md\n', ''), /dry run does not upload/],
    ['no summary', withoutStep('Summary'), /no summary/],
    ['a summary that waits for success', damage('      - name: Summary\n        if: always()', '      - name: Summary'), /no summary/],
    ['an AI changelog without its key', damage("        if: env.HAS_LLM_KEY == 'true'\n", ''), /AI changelog does not wait/],
    ['generated notes that make no changelog', damage('node tools/update-changelog.mjs --tag "${TAG}" --notes RELEASE_NOTES.md', 'true'), /generated notes do not make/],
    ['a commit of other files', damage('git add CHANGELOG.md package.json', 'git add -A'), /not of the changelog and the version/],
    ['an expression in a command', damage('git push origin "${TAG}"', 'git push origin ${{ steps.version.outputs.newTag }}'), /expression in run/],
    ['the type of the release in a command', damage('echo "| Release type | ${RELEASE_TYPE} |"', 'echo "| Release type | ${{ inputs.release-type }} |"'), /expression in run: Summary/],
  ];
  for (const [name, text, expected] of cases) {
    test(`${name} is found`, () => {
      const found = lint(text);
      assert.ok(found.length > 0, 'nothing found');
      assert.ok(found.some((message) => expected.test(message)), found.join(' | '));
    });
  }

  test('a comment does not count as a line of the file', () => {
    assert.deepEqual(lint(`# if: x\n# push:\n${workflow}`), []);
    assert.deepEqual(lint(workflow.replace('    runs-on:', '    # continue-on-error: true\n    runs-on:')), []);
  });
});
