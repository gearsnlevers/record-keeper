// The workflow `Release` (docs/releases.md): what the page says about the file is stated here as tests. The file is read line by line, with no YAML library;
// `lint` returns what is wrong with a text, and the tests check both the real file and damaged copies of it, so that the rules cannot silently stop saying
// anything. The workflow is run for real by the maintainer, so what cannot be tried here has to be written down here.
//
// The decision of the maintainer of 2026-11-22 is the centre of it: the workflow writes NOTHING to the default branch. The ruleset there requires a pull
// request and the token of the workflow has no bypass, so a commit of the changelog and the version would be refused at the first release. What the workflow
// may write to the repository is the tag, and then the release; every rule below that says "no commit" is that decision, and the damaged copies show that
// each way back to a commit is found.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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
/** The only actions the release uses. An action that commits, opens a pull request or edits a file is not among them. */
const USED = ['actions/checkout', 'actions/setup-node', 'actions/upload-artifact', 'gearsnlevers/ai-changelog-action', 'gearsnlevers/release-preflight-action', 'gearsnlevers/version-bump-action'];
const TAG_PUSH = 'git push origin "refs/tags/${TAG}"';
const TAG_COMMAND = 'git tag -a "${TAG}" -m "Release ${TAG}" "${current}"';
const indentOf = (line) => line.length - line.trimStart().length;
/** The lines that are not comments or blank, without the comment at the end of a line. */
const codeOf = (text) => text.split('\n').filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#')).map((line) => line.replace(/\s+#.*$/, ''));
/** The commands of a script, one to a line: a line that ends with a backslash goes on in the next one. */
const commandsOf = (run) => run.replace(/\\\n\s*/g, ' ').split('\n').map((line) => line.trim()).filter((line) => line !== '');

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

/**
 * What a script does that a release that writes nothing to the default branch does not do. A step may read the repository, make the tag and push the tag:
 * `git` is held to a list of subcommands and the three that write are held to one form each; `gh` may list, create, upload to, edit and delete a release,
 * ask the API for the list of releases, and ask it for the notes that GitHub generates (a POST that writes nothing); nothing else reaches the API.
 */
function writesOf(run, name) {
  const found = [];
  const of = (message) => found.push(`${message}: ${name}`);
  for (const line of commandsOf(run)) {
    for (const call of line.matchAll(/(?<![\w./-])git\s+((?:-c\s+\S+\s+|-C\s+\S+\s+|--[\w-]+(?:=\S+)?\s+)*)([a-z][\w-]*)([^;|&)\n]*)/g)) {
      const [, , sub, rest] = call;
      if (!['rev-parse', 'rev-list', 'diff', 'status', 'fetch', 'tag', 'push', 'config'].includes(sub)) of(`a step runs git ${sub}, which a release does not`);
      else if (sub === 'push' && `git push${rest}`.trim() !== TAG_PUSH) of(`a step pushes something that is not the tag (${`git push${rest}`.trim()})`);
      else if (sub === 'tag' && `git tag${rest}`.trim() !== TAG_COMMAND) of(`a step makes a tag that is not the tag of the release (${`git tag${rest}`.trim()})`);
      else if (sub === 'config' && !/^ user\.(?:name|email) "[^"]+"$/.test(rest)) of(`a step sets git configuration that is not the name or the e-mail of the tagger (${`git config${rest}`.trim()})`);
    }
    for (const call of line.matchAll(/(?<![\w./-])gh\s+(\w+)(?:\s+(\w+))?/g)) {
      if (call[1] === 'release' && !['list', 'create', 'upload', 'edit', 'delete'].includes(call[2])) of(`a step runs gh release ${call[2]}`);
      else if (call[1] !== 'release' && call[1] !== 'api') of(`a step runs gh ${call[1]}, which a release does not`);
    }
    const api = line.indexOf('gh api');
    if (api >= 0) {
      const call = line.slice(api);
      const endpoint = /^gh api\s+"?(repos\/\$\{GITHUB_REPOSITORY\}\/releases(?:\/generate-notes)?)"?(?=\s|$)/.exec(call)?.[1];
      if (endpoint === undefined) of(`an API call that is not one of the two the release makes, the list of releases and the notes (${call})`);
      else if (endpoint.endsWith('/releases') && /\s(?:-X|--method|-f|-F|--field|--raw-field|--input)(?=\s|=)/.test(call)) of(`a write through the API (${call})`);
    }
    if (/(?<![\w./-])(?:curl|wget)\s/.test(line)) of('a step calls the network with something that is not gh, so that no write can be read from it');
    if (/(?<![\w./-])(?:sed|perl)\s+(?:-\S+\s+)*-[a-zA-Z]*i/.test(line)) of('a step edits a file in place');
    for (const program of line.matchAll(/(?<![\w./-])node\s+(?:-\S+\s+)*(\S+)/g)) {
      if (!['tools/build-release-manifest.mjs', 'record-keeper.mjs'].includes(program[1])) of(`a step runs a program that is not one of the release: node ${program[1]}`);
    }
    for (const program of line.matchAll(/(?<![\w./-])python3\s+(\S+)/g)) if (program[1] !== 'reference/verify_manifest.py') of(`a step runs a program that is not one of the release: python3 ${program[1]}`);
    for (const program of line.matchAll(/(?<![\w./-])npm\s+(\S+)/g)) if (program[1] !== 'test') of(`a step runs npm ${program[1]}`);
    for (const target of line.matchAll(/(?<![\d&<>-])>{1,2}(?!&)\s*"?([^\s"&;|)]+)/g)) {
      if (!['RELEASE_NOTES.md', '/dev/null', '$GITHUB_STEP_SUMMARY'].includes(target[1])) of(`a step writes to a file that is not the notes or the summary (${target[1]})`);
    }
  }
  return found;
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
    if (key === 'persist-credentials') found.push('the credentials of the checkout must stay, the release pushes the tag with them');
    // An input that makes an action commit, push or open a pull request.
    if (/^(?:commit|push|auto-commit|create-pull-request|force|force-push)$/.test(key) && /:\s*['"]?true['"]?$/.test(line)) found.push(`an action is told to write to the repository: ${line.trim()}`);
    // The decision of 2026-11-22: nothing commits, so nothing changes the version or the changelog of the repository.
    for (const name of line.matchAll(/\bpackage(?:-lock)?\.json\b|\bCHANGELOG\.md\b|update-changelog|manifest-version-update/g)) found.push(`a step names ${name[0]}, and a release changes neither the version nor the changelog of the repository: ${line.trim()}`);
  }
  const raw = text.split('\n').filter((line) => /^\s*(- )?uses:/.test(line));
  for (const line of raw) {
    const used = /^\s*(?:- )?uses: ([\w.-]+\/[\w.-]+)@([0-9a-f]{40}) # v\d+\.\d+\.\d+$/.exec(line);
    if (used === null) found.push(`not pinned to a commit with the tag in a comment: ${line.trim()}`);
    else {
      if (ACTIONS[used[1]] !== undefined && ACTIONS[used[1]] !== used[2]) found.push(`another commit than the other workflows use: ${used[1]}`);
      if (!USED.includes(used[1])) found.push(`an action that is not one of the release: ${used[1]}`);
    }
  }
  const steps = stepsOf(text);
  const index = (name) => steps.findIndex((step) => step.name === name);
  const named = (name) => steps[index(name)];
  const order = ['Require the default branch for a real release', 'Tests', 'The records of the kit', 'Compute the next version', 'Release preflight checks', 'The files are the files of the commit',
    'Build and verify the release manifest', 'Create and push the tag', 'Create the draft release', 'Upload the manifest to the draft release', 'Publish the release'];
  for (const name of order) if (index(name) < 0) found.push(`no step ${name}`);
  const at = order.map(index);
  if (at.every((i) => i >= 0) && at.some((i, k) => k > 0 && i <= at[k - 1])) found.push('the steps are not in the order of the page');
  const between = (name) => index(name) > index('Release preflight checks') && index(name) < index('The files are the files of the commit');
  if (at.every((i) => i >= 0) && !(between('Release notes (AI)') && between('Release notes (GitHub generated)'))) found.push('the notes are not between the preflight and the check of the files');
  const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  if (checkout === undefined) found.push('no checkout');
  else {
    if (!checkout.lines.some((line) => line.trim() === 'fetch-depth: 0')) found.push('checkout without the whole history');
    if (!checkout.lines.some((line) => line.trim() === 'fetch-tags: true')) found.push('checkout without the tags');
  }
  for (const step of steps) {
    if (step.run !== undefined && WRITES.test(step.run) && step.if !== GUARD) found.push(`a step that writes is not guarded by the dry run: ${step.name}`);
    if (step.run !== undefined && step.run.includes('${{')) found.push(`expression in run: ${step.name}`);
    if (step.run !== undefined && step.run.split('\n').some((line) => /\bgh release create\b/.test(line) && !line.includes('--draft'))) found.push('a release is created without being a draft');
    if (step.run !== undefined) found.push(...writesOf(step.run, step.name ?? '(a step without a name)'));
  }
  const must = (name, pattern, message) => {
    const step = named(name);
    if (step !== undefined && !pattern.test(step.run ?? '')) found.push(message);
  };
  const guard = named('Require the default branch for a real release');
  if (guard !== undefined && guard.if !== "env.DRY_RUN != 'true' && github.ref_name != github.event.repository.default_branch") found.push('the default branch is not required for a real release');
  for (const name of ['Tests', 'The records of the kit', 'Compute the next version', 'Release preflight checks', 'The files are the files of the commit', 'Build and verify the release manifest']) {
    const step = named(name);
    if (step !== undefined && step.if !== undefined) found.push(`a step that must always run has a condition: ${name}`);
  }
  must('The files are the files of the commit', /^\s*if ! git diff --quiet HEAD; then$/m, 'the files are not checked against the commit');
  // The install set is checked by the step that builds the manifest, once: a second step that built it again with the same arguments would stop for nothing that this one does not (docs/releases.md, choice 14).
  if (steps.filter((step) => /build-release-manifest\.mjs/.test(step.run ?? '')).length !== 1) found.push('the manifest is not built by one step, which is also the check of the install set');
  must('Tests', /^\s*npm test$/, 'the tests are not npm test');
  must('The records of the kit', /^\s*node record-keeper\.mjs validate docs\/decisions$/, 'the records are not validated');
  must('Build and verify the release manifest', /build-release-manifest\.mjs --version "\$\{VERSION\}" --tag "\$\{TAG\}" --commit "\$\(git rev-parse HEAD\)" --out release-manifest\.json/, 'the manifest is not built for the commit that is released');
  must('Build and verify the release manifest', /build-release-manifest\.mjs --verify release-manifest\.json/, 'the manifest is not verified by the Node program');
  must('Build and verify the release manifest', /python3 reference\/verify_manifest\.py --verify release-manifest\.json/, 'the manifest is not verified by the second implementation');
  must('Create and push the tag', /^\s*current="\$\(git rev-parse HEAD\)"$/m, 'the tag is not of the commit that the run started from');
  must('Create and push the tag', /grep -qxF "  \\"commit\\": \\"\$\{current\}\\"," release-manifest\.json/, 'the manifest is not checked for the commit that is tagged');
  must('Create and push the tag', /git config user\.name "github-actions\[bot\]"\n\s*git config user\.email "[^"]+"\n(?:.*\n)*?\s*git tag -a/, 'the tagger has no name before the tag is made');
  must('Create and push the tag', /git tag -a "\$\{TAG\}"/, 'the tag is not annotated');
  must('Create and push the tag', /^\s*git tag -a "\$\{TAG\}" -m "Release \$\{TAG\}" "\$\{current\}"$/m, 'the tag is not put on the commit that is released');
  must('Create and push the tag', /^\s*git push origin "refs\/tags\/\$\{TAG\}"$/m, 'the tag is not pushed by its full name');
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
  const preflight = named('Release preflight checks');
  if (preflight !== undefined) {
    if (!preflight.lines.some((line) => line.trim() === 'check-remote-tag: true')) found.push('the preflight does not check that the tag is new');
    if (!preflight.lines.some((line) => line.trim() === 'check-npm-version: false')) found.push('the preflight asks npm, and the kit is not on npm');
    if (preflight.lines.some((line) => /^\s*(?:check-version-drift|current-version|package-name):/.test(line))) found.push('the preflight checks the version of package.json for drift, and nothing writes it');
  }
  const ai = named('Release notes (AI)');
  if (ai !== undefined) {
    if (ai.if !== "env.HAS_LLM_KEY == 'true'") found.push('the AI changelog does not wait for its key');
    if (!ai.lines.some((line) => line.trim() === 'commit: false')) found.push('the AI changelog does not say that it does not commit');
    if (!ai.lines.some((line) => line.trim() === 'changelog-path: release-changelog-work.md')) found.push('the AI changelog does not work on a file of its own');
    if (!ai.lines.some((line) => line.trim() === 'release-notes-path: RELEASE_NOTES.md')) found.push('the AI changelog does not write the notes of the release');
  }
  const plain = named('Release notes (GitHub generated)');
  if (plain !== undefined && (plain.if !== "env.HAS_LLM_KEY != 'true'" || !/--jq \.body > RELEASE_NOTES\.md$/m.test(plain.run))) found.push('the generated notes are not the notes of the release');
  return found;
}

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
/** The text with a step taken from where it is and put in front of another one. */
const moved = (name, ahead) => {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, name);
  const next = workflow.indexOf('\n      - ', start + 1);
  const comment = workflow.indexOf('\n      #', start + 1);
  const end = [next, comment, workflow.length - 1].filter((i) => i >= 0).reduce((a, b) => Math.min(a, b));
  const text = workflow.slice(start, end + 1);
  const rest = workflow.slice(0, start) + workflow.slice(end + 1);
  assert.ok(rest.includes(`      - name: ${ahead}\n`), ahead);
  return rest.replace(`      - name: ${ahead}\n`, `${text}\n      - name: ${ahead}\n`);
};
/** A step put in front of the manifest, with the guard that a writing step has. */
const before = (step) => damage('      - name: Build and verify the release manifest\n', `${step}\n      - name: Build and verify the release manifest\n`);
const commitStep = [
  '      - name: Commit the changelog and the version',
  "        if: env.DRY_RUN != 'true'",
  '        run: |',
  '          set -euo pipefail',
  '          git add CHANGELOG.md package.json',
  '          git commit -m "chore: release ${TAG}"',
  '          git push origin "HEAD:${GITHUB_REF_NAME}"',
  '',
].join('\n');
/** The script of a step, as it is run. */
const scriptOf = (name) => stepsOf(workflow).find((step) => step.name === name).run;

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

  test('pins the three release actions of the organisation and the three of GitHub, each to a commit with its version in a comment', () => {
    const used = [...workflow.matchAll(/uses: ([\w./-]+)@([0-9a-f]{40}) # (v\d+\.\d+\.\d+)/g)].map((m) => m[1]);
    assert.deepEqual(used.sort(), USED);
  });

  test('keeps the commits of the actions that it keeps', () => {
    const pinned = Object.fromEntries([...workflow.matchAll(/uses: ([\w./-]+)@([0-9a-f]{40}) # (v\d+\.\d+\.\d+)/g)].map((m) => [m[1], `${m[2]} ${m[3]}`]));
    assert.deepEqual(pinned, {
      'actions/checkout': '3d3c42e5aac5ba805825da76410c181273ba90b1 v7.0.1',
      'actions/setup-node': '949feb2413d6458794dcd2491c4babbbce0c15c1 v7.1.0',
      'actions/upload-artifact': 'cf430e030ddbb5b0abf93d22962f4752f3646cd9 v7.0.2',
      'gearsnlevers/ai-changelog-action': '088269a817c890a026e6fdf4826e24130607a59e v1.1.13',
      'gearsnlevers/release-preflight-action': 'c5b6bf27adcd3b0da9088841b22aecba47a3fa17 v1.0.4',
      'gearsnlevers/version-bump-action': '0ee6d19f6b0da78996bf17da9a3fc9cfd6078d09 v1.1.0',
    });
  });

  test('uses the checkout and the setup of the other workflows at the same commits', () => {
    const used = (text) => [...text.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    for (const other of ['test.yml', 'records-integrity.yml', 'records-audit.yml']) {
      const text = fs.readFileSync(path.join(root, '.github/workflows', other), 'utf8');
      for (const action of used(workflow).filter((name) => name.startsWith('actions/checkout') || name.startsWith('actions/setup-node'))) assert.ok(used(text).includes(action), `${other}: ${action}`);
    }
  });

  test('calls programs that are in the repository, and does not name the check', () => {
    for (const file of ['tools/build-release-manifest.mjs', 'reference/verify_manifest.py', 'record-keeper.mjs', 'install.json']) assert.ok(fs.existsSync(path.join(root, file)), file);
    assert.doesNotMatch(workflow, /records[ _-]?integrity/i);
  });

  test('says what the page says: the dry run, the draft, the manifest and the order', () => {
    for (const word of ['`dry-run`', '`release-manifest.json`', '`contents: write`', 'draft', 'immutable']) assert.ok(page.includes(word), word);
  });

  test('the steps that write are exactly the tag, the draft, the upload and the publication, and each is guarded by the dry run', () => {
    const writes = stepsOf(workflow).filter((step) => step.run !== undefined && WRITES.test(step.run));
    assert.deepEqual(writes.map((step) => step.name), ['Create and push the tag', 'Create the draft release', 'Upload the manifest to the draft release', 'Publish the release']);
    for (const step of writes) assert.equal(step.if, GUARD, step.name);
  });

  test('every script is valid bash', () => {
    for (const step of stepsOf(workflow).filter((one) => one.run !== undefined)) {
      const got = spawnSync('bash', ['-n'], { input: step.run, encoding: 'utf8' });
      assert.equal(got.status, 0, `${step.name}: ${got.stderr}`);
    }
  });
});

describe('the workflow writes nothing to the default branch', () => {
  test('no step commits, and none pushes anything but the tag', () => {
    const calls = stepsOf(workflow).flatMap((step) => commandsOf(step.run ?? '').flatMap((line) => [...line.matchAll(/(?<![\w./-])git\s+([a-z][\w-]*)([^;|&)\n]*)/g)].map((m) => `${m[1]}${m[2]}`.trim())));
    assert.ok(calls.length > 0);
    assert.deepEqual(calls.filter((call) => /^(?:commit|add|merge|rebase|cherry-pick|am|apply|mv|rm|restore|checkout|switch|branch|reset|stash|update-ref|commit-tree|write-tree|revert|pull)\b/.test(call)), []);
    assert.deepEqual(calls.filter((call) => call.startsWith('push')), ['push origin "refs/tags/${TAG}"']);
  });

  test('no API call writes a file or a reference: the only calls are the list of releases and the notes that GitHub generates', () => {
    const calls = stepsOf(workflow).flatMap((step) => commandsOf(step.run ?? '').filter((line) => line.includes('gh api')).map((line) => line.slice(line.indexOf('gh api'))));
    assert.equal(calls.length, 2);
    assert.match(calls[0], /^gh api "repos\/\$\{GITHUB_REPOSITORY\}\/releases\/generate-notes" /);
    assert.match(calls[1], /^gh api "repos\/\$\{GITHUB_REPOSITORY\}\/releases" --paginate /);
    assert.doesNotMatch(workflow, /\/contents\/|\/git\/(?:refs|commits|trees|blobs|tags)|\/merges|\/branches|\/pulls/);
  });

  test('no step changes the version or the changelog: the files are not named, and what the steps run is a short list', () => {
    const code = codeOf(workflow).join('\n');
    assert.doesNotMatch(code, /package(?:-lock)?\.json|CHANGELOG\.md|update-changelog|manifest-version-update|chore: release|npm version|npm pkg/);
    const programs = stepsOf(workflow).flatMap((step) => commandsOf(step.run ?? '').flatMap((line) => [...line.matchAll(/(?<![\w./-])(?:node|python3|npm)\s+(\S+)/g)].map((m) => m[1])));
    assert.deepEqual([...new Set(programs)].sort(), ['record-keeper.mjs', 'reference/verify_manifest.py', 'test', 'tools/build-release-manifest.mjs']);
  });

  test('the files of the commit are checked after the notes and before the manifest, and the tag is the only thing the permission is for', () => {
    const steps = stepsOf(workflow);
    const at = (name) => steps.findIndex((step) => step.name === name);
    assert.ok(at('Release notes (AI)') < at('The files are the files of the commit'));
    assert.ok(at('Release notes (GitHub generated)') < at('The files are the files of the commit'));
    assert.ok(at('The files are the files of the commit') < at('Build and verify the release manifest'));
    assert.ok(at('Build and verify the release manifest') < at('Create and push the tag'));
  });

  test('the page says the same, and the changelog of the repository is the releases', () => {
    assert.match(page, /\*\*It writes nothing to the default branch\.\*\*/);
    // The choices at the end of the page say what an earlier draft did, and so name it; what the page says the workflow does does not.
    assert.doesNotMatch(page.slice(0, page.indexOf('## Choices in this draft')), /chore: release|update-changelog|manifest-version-update|Update package\.json|Commit the changelog|check-version-drift/);
    const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    assert.match(changelog, /^# Changelog\n\nThe changelog of this kit is the notes of its releases: https:\/\/github\.com\/gearsnlevers\/record-keeper\/releases\./);
    assert.doesNotMatch(changelog, /^## /m, 'no release writes a section to CHANGELOG.md');
    assert.equal(fs.existsSync(path.join(root, 'tools/update-changelog.mjs')), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, '0.0.0');
  });
});

describe('the rules of the page, tried on damaged copies', () => {
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
    ['another test command', damage('run: npm test', 'run: npm run lint'), [/not npm test/, /runs npm run/]],
    ['no validation of the records', damage('node record-keeper.mjs validate docs/decisions', 'echo skipped'), /records are not validated/],
    ['a version that is skipped in a dry run', damage('      - name: Compute the next version\n', "      - name: Compute the next version\n        if: env.DRY_RUN != 'true'\n"), /must always run has a condition: Compute/],
    ['no preflight', withoutStep('Release preflight checks'), /no step Release preflight/],
    ['a preflight that does not look for the tag', damage('          check-remote-tag: true\n', ''), /does not check that the tag is new/],
    ['a preflight that asks npm', damage('          check-npm-version: false\n', '          check-npm-version: true\n'), /asks npm/],
    ['a preflight that checks the version for drift', damage('          check-npm-version: false\n', '          check-npm-version: false\n          check-version-drift: true\n'), /for drift/],
    ['a preflight that is given the current version', damage('          check-npm-version: false\n', '          check-npm-version: false\n          current-version: ${{ steps.version.outputs.base }}\n'), /for drift/],
    ['no step that builds the manifest', withoutStep('Build and verify the release manifest'), /no step Build and verify the release manifest/],
    ['a manifest that is skipped in a dry run', damage('      - name: Build and verify the release manifest\n', "      - name: Build and verify the release manifest\n        if: env.DRY_RUN != 'true'\n"), /must always run has a condition: Build and verify/],
    ['a second step that checks the install set', before('      - name: Check the install set\n        run: node tools/build-release-manifest.mjs --verify release-manifest.json\n'), /not built by one step/],
    ['a second step that builds the manifest', before('      - name: Check the install set\n        run: node tools/build-release-manifest.mjs --version 1.2.3 --tag v1.2.3 --commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --out "${RUNNER_TEMP}/install-set-check.json"\n'), /not built by one step/],
    ['no check that the files are the files of the commit', withoutStep('The files are the files of the commit'), /no step The files are the files of the commit/],
    ['a check of the files that is skipped in a dry run', damage('      - name: The files are the files of the commit\n', "      - name: The files are the files of the commit\n        if: env.DRY_RUN != 'true'\n"), /must always run has a condition: The files/],
    ['a check of the files that checks nothing', damage('if ! git diff --quiet HEAD; then', 'if false; then'), /files are not checked against the commit/],
    ['a check of the files after the manifest', moved('The files are the files of the commit', 'Create and push the tag'), /order of the page/],
    ['a tag that is not guarded', damage("      - name: Create and push the tag\n        if: env.DRY_RUN != 'true'\n", '      - name: Create and push the tag\n'), /not guarded by the dry run: Create and push the tag/],
    ['a tag that is guarded by the other value', damage("      - name: Create and push the tag\n        if: env.DRY_RUN != 'true'\n", "      - name: Create and push the tag\n        if: env.DRY_RUN == 'true'\n"), /not guarded by the dry run: Create and push the tag/],
    ['a tag that is guarded by more than the dry run', damage("      - name: Create and push the tag\n        if: env.DRY_RUN != 'true'\n", "      - name: Create and push the tag\n        if: env.DRY_RUN != 'true' || always()\n"), /not guarded by the dry run: Create and push the tag/],
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
    ['a tag that is not annotated', damage('git tag -a "${TAG}" -m "Release ${TAG}" "${current}"', 'git tag "${TAG}" "${current}"'), [/not annotated/, /not the tag of the release/]],
    ['a tag on the commit that is checked out, not named', damage('git tag -a "${TAG}" -m "Release ${TAG}" "${current}"', 'git tag -a "${TAG}" -m "Release ${TAG}"'), [/not put on the commit that is released/, /not the tag of the release/]],
    ['a tag on the commit of the event, not of the manifest', damage('git tag -a "${TAG}" -m "Release ${TAG}" "${current}"', 'git tag -a "${TAG}" -m "Release ${TAG}" "${GITHUB_SHA}"'), [/not put on the commit that is released/, /not the tag of the release/]],
    ['a tag on the default branch, not on the commit', damage('git tag -a "${TAG}" -m "Release ${TAG}" "${current}"', 'git tag -a "${TAG}" -m "Release ${TAG}" origin/main'), [/not put on the commit that is released/, /not the tag of the release/]],
    ['a tag of a commit that is not the one that the run started from', damage('current="$(git rev-parse HEAD)"\n          if ! grep', 'current="$(git rev-parse origin/main)"\n          if ! grep'), /not of the commit that the run started from/],
    ['a tag that does not check the manifest', damage('if ! grep -qxF', 'if ! true'), /manifest is not checked for the commit that is tagged/],
    ['a tag with no name for the tagger', damage('          git config user.name "github-actions[bot]"\n          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"\n          git fetch --tags', '          git fetch --tags'), /tagger has no name/],
    ['a tag with a name for the tagger after the tag', damage('          git config user.name "github-actions[bot]"\n          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"\n          git fetch --tags', '          git fetch --tags').replace('          git push origin "refs/tags/${TAG}"', '          git config user.name "github-actions[bot]"\n          git config user.email "x@y.z"\n          git push origin "refs/tags/${TAG}"'), /tagger has no name/],
    ['a tag with a configuration that is not the tagger', damage('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"', 'git config user.email "41898282+github-actions[bot]@users.noreply.github.com"\n          git config push.default current'), /not the name or the e-mail of the tagger/],
    ['a tag that moves', damage('echo "::error::Tag ${TAG} already exists on a different commit"\n            exit 1', 'echo "::error::Tag ${TAG} already exists on a different commit"'), /another commit is not refused/],
    ['a tag that is not idempotent', damage('already exists on the current commit; skipping', 'already exists'), /not idempotent/],
    ['a dry run that uploads nothing', damage("        if: env.DRY_RUN == 'true'\n        uses: actions/upload-artifact", "        if: env.DRY_RUN != 'true'\n        uses: actions/upload-artifact"), /dry run does not upload/],
    ['a dry run that loses the notes', damage('            RELEASE_NOTES.md\n', ''), /dry run does not upload/],
    ['no summary', withoutStep('Summary'), /no summary/],
    ['a summary that waits for success', damage('      - name: Summary\n        if: always()', '      - name: Summary'), /no summary/],
    ['an AI changelog without its key', damage("        if: env.HAS_LLM_KEY == 'true'\n", ''), /AI changelog does not wait/],
    ['generated notes that are not the notes', damage('--jq .body > RELEASE_NOTES.md', '--jq .body > notes.md'), [/not the notes of the release/, /not the notes or the summary/]],
    ['an expression in a command', damage('git push origin "refs/tags/${TAG}"', 'git push origin "refs/tags/${{ steps.version.outputs.newTag }}"'), /expression in run/],
    ['the type of the release in a command', damage('echo "| Release type | ${RELEASE_TYPE} |"', 'echo "| Release type | ${{ inputs.release-type }} |"'), /expression in run: Summary/],

    // The decision of 2026-11-22: no commit on the default branch, whatever the way.
    ['the commit of the changelog and the version put back', before(commitStep), [/runs git add/, /runs git commit/, /pushes something that is not the tag/, /names package\.json/, /names CHANGELOG\.md/]],
    ['the same commit with no guard of the dry run', before(commitStep.replace("        if: env.DRY_RUN != 'true'\n", '')), [/not guarded by the dry run: Commit/, /runs git commit/]],
    ['a commit with no changes in the tag step', damage('          git fetch --tags\n', '          git commit --allow-empty -m "release"\n          git fetch --tags\n'), /runs git commit/],
    ['a commit that is made by another form of the command', damage('          git fetch --tags\n', '          git -c user.name=x -c user.email=y commit -m "release"\n          git fetch --tags\n'), /runs git commit/],
    ['a push of the branch in place of the tag', damage('git push origin "refs/tags/${TAG}"', 'git push origin "HEAD:${GITHUB_REF_NAME}"'), [/pushes something that is not the tag/, /not pushed by its full name/]],
    ['a push of the tag and the branch', damage('git push origin "refs/tags/${TAG}"', 'git push origin "refs/tags/${TAG}" "HEAD:main"'), /pushes something that is not the tag/],
    ['a force push of the tag', damage('git push origin "refs/tags/${TAG}"', 'git push --force origin "refs/tags/${TAG}"'), /pushes something that is not the tag/],
    ['a push of everything', damage('git push origin "refs/tags/${TAG}"', 'git push origin --all'), /pushes something that is not the tag/],
    ['a push of the tag by its short name, which may be a branch', damage('git push origin "refs/tags/${TAG}"', 'git push origin "${TAG}"'), [/pushes something that is not the tag/, /not pushed by its full name/]],
    ['a push by a second line', damage('          git fetch --tags\n', '          git push origin HEAD:main\n          git fetch --tags\n'), /pushes something that is not the tag/],
    ['a merge', damage('          git fetch --tags\n', '          git merge origin/main\n          git fetch --tags\n'), /runs git merge/],
    ['a file that is staged', damage('          git fetch --tags\n', '          git add -A\n          git fetch --tags\n'), /runs git add/],
    ['a reference that is updated by hand', damage('          git fetch --tags\n', '          git update-ref refs/heads/main HEAD\n          git fetch --tags\n'), /runs git update-ref/],
    ['a file that is created through the contents API', before('      - name: Put the changelog\n        if: env.DRY_RUN != \'true\'\n        run: gh api -X PUT "repos/${GITHUB_REPOSITORY}/contents/CHANGELOG.md" -f message=release -f content=eA==\n'), [/not one of the two the release makes/, /names CHANGELOG\.md/]],
    ['a file that is created through the contents API, with the method last', before('      - name: Put a file\n        run: gh api "repos/${GITHUB_REPOSITORY}/contents/notes.md" --method PUT -f message=release -f content=eA==\n'), /not one of the two the release makes/],
    ['a reference that is created through the API', before('      - name: Make a reference\n        run: gh api "repos/${GITHUB_REPOSITORY}/git/refs" -f ref=refs/heads/release -f sha=0000000000000000000000000000000000000000\n'), /not one of the two the release makes/],
    ['a release that is created through the API list endpoint', before('      - name: Make a release\n        run: gh api "repos/${GITHUB_REPOSITORY}/releases" -f tag_name=v1.0.0\n'), /a write through the API/],
    ['a release that is created through the API with a method', before('      - name: Make a release\n        run: gh api "repos/${GITHUB_REPOSITORY}/releases" --method POST\n'), /a write through the API/],
    ['a pull request', before('      - name: Open a pull request\n        run: gh pr create --fill\n'), /runs gh pr/],
    ['a write by curl', before('      - name: Write\n        run: curl -X PUT -H "Authorization: Bearer ${GH_TOKEN}" "https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/x"\n'), /not gh/],
    ['an action that commits for the workflow', before('      - uses: stefanzweifel/git-auto-commit-action@' + 'b'.repeat(40) + ' # v5.0.0\n'), /not one of the release/],
    ['an action that opens a pull request', before('      - uses: peter-evans/create-pull-request@' + 'c'.repeat(40) + ' # v7.0.0\n'), /not one of the release/],
    ['the step that updates package.json put back', before('      - name: Update package.json\n        uses: gearsnlevers/manifest-version-update-action@b12e72175cf5af138e466c11fe5148277c137cec # v1.0.5\n        with:\n          version: ${{ steps.version.outputs.newVersion }}\n          update-package-lock: false\n'), [/not one of the release/, /names package\.json/, /names manifest-version-update/]],
    ['npm version', before('      - name: Version\n        run: npm version "${VERSION}" --no-git-tag-version\n'), /runs npm version/],
    ['a version written by sed', before('      - name: Version\n        run: sed -i "s/0.0.0/1.0.0/" package.json\n'), [/edits a file in place/, /names package\.json/]],
    ['a file written by a redirect', before('      - name: Write a file\n        run: echo "x" > install.json\n'), /writes to a file that is not the notes/],
    ['a file appended by a redirect', before('      - name: Write a file\n        run: echo "x" >> docs/releases.md\n'), /writes to a file that is not the notes/],
    ['the tool that wrote the changelog put back', damage('          if ! grep -q \'[^[:space:]]\' RELEASE_NOTES.md; then printf \'Release %s.\\n\' "${TAG}" > RELEASE_NOTES.md; fi\n', '          if ! grep -q \'[^[:space:]]\' RELEASE_NOTES.md; then printf \'Release %s.\\n\' "${TAG}" > RELEASE_NOTES.md; fi\n          node tools/update-changelog.mjs --tag "${TAG}" --notes RELEASE_NOTES.md\n'), [/not one of the release: node tools\/update-changelog/, /names update-changelog/]],
    ['the dry run that uploads the changelog', damage('            RELEASE_NOTES.md\n', '            RELEASE_NOTES.md\n            CHANGELOG.md\n'), /names CHANGELOG\.md/],
    ['an AI changelog that commits', damage('          commit: false\n', '          commit: true\n'), [/told to write to the repository/, /does not say that it does not commit/]],
    ['an AI changelog that is not told whether it commits', damage('          commit: false\n', ''), /does not say that it does not commit/],
    ['an AI changelog on the changelog of the repository', damage('          changelog-path: release-changelog-work.md\n', ''), /does not work on a file of its own/],
    ['an AI changelog on CHANGELOG.md by name', damage('changelog-path: release-changelog-work.md', 'changelog-path: CHANGELOG.md'), [/names CHANGELOG\.md/, /does not work on a file of its own/]],
    ['an AI changelog that does not write the notes of the release', damage('          release-notes-path: RELEASE_NOTES.md\n', ''), /does not write the notes of the release/],
    ['notes after the check of the files', moved('Release notes (AI)', 'Build and verify the release manifest'), /notes are not between/],
    ['notes before the preflight', moved('Release notes (GitHub generated)', 'Release preflight checks'), /notes are not between/],
  ];
  for (const [name, text, expected] of cases) {
    test(`${name} is found`, () => {
      const found = lint(text);
      assert.ok(found.length > 0, 'nothing found');
      for (const pattern of [expected].flat()) assert.ok(found.some((message) => pattern.test(message)), `${pattern}: ${found.join(' | ')}`);
    });
  }

  test('a comment does not count as a line of the file', () => {
    assert.deepEqual(lint(`# if: x\n# push:\n${workflow}`), []);
    assert.deepEqual(lint(workflow.replace('    runs-on:', '    # continue-on-error: true\n    runs-on:')), []);
    assert.deepEqual(lint(workflow.replace('    runs-on:', '    # git commit -m x; package.json; CHANGELOG.md\n    runs-on:')), []);
  });
});

describe('the two steps that the decision changed, run in a repository of their own', () => {
  // A repository with an origin of its own and no identity for git, so that what the steps need is what they set. The kit's builder makes the manifest, so
  // that the line the tag step looks for is the line that the builder writes.
  const git = (cwd, env, ...args) => {
    const got = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    assert.equal(got.status, 0, `git ${args.join(' ')}: ${got.stderr}`);
    return got.stdout.trim();
  };
  function world() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-release-'));
    const home = path.join(base, 'home');
    fs.mkdirSync(home);
    const env = {
      PATH: process.env.PATH,
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: path.join(home, 'none'),
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'user.useConfigOnly',
      GIT_CONFIG_VALUE_0: 'true',
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
    };
    const origin = path.join(base, 'origin.git');
    const work = path.join(base, 'work');
    fs.mkdirSync(work);
    git(base, env, 'init', '-q', '--bare', origin);
    git(work, env, 'init', '-q', '-b', 'main');
    git(work, env, 'remote', 'add', 'origin', origin);
    const commit = (file, text) => {
      fs.writeFileSync(path.join(work, file), text);
      git(work, env, 'add', file);
      git(work, env, '-c', 'user.name=someone', '-c', 'user.email=someone@example.com', 'commit', '-q', '-m', `change ${file}`);
      return git(work, env, 'rev-parse', 'HEAD');
    };
    const manifestFor = (sha, tag = 'v1.0.0') => {
      const built = spawnSync(process.execPath, [path.join(root, 'tools/build-release-manifest.mjs'), '--version', tag.slice(1), '--tag', tag, '--commit', sha, '--out', path.join(work, 'release-manifest.json'), '--root', root], { encoding: 'utf8' });
      assert.equal(built.status, 0, built.stderr);
    };
    const first = commit('a.txt', 'one\n');
    git(work, env, 'push', '-q', 'origin', 'main');
    const run = (name, extra = {}) => spawnSync('bash', ['-e', '-c', scriptOf(name)], { cwd: work, env: { ...env, TAG: 'v1.0.0', ...extra }, encoding: 'utf8' });
    return { base, env, origin, work, first, commit, manifestFor, run, git: (...args) => git(work, env, ...args), remote: (...args) => git(origin, env, ...args) };
  }

  test('the tag is annotated, is on the commit of the manifest, is made by the bot, and is the only thing pushed', () => {
    const w = world();
    try {
      w.manifestFor(w.first);
      const before = w.remote('for-each-ref', '--format=%(refname) %(objectname)');
      const got = w.run('Create and push the tag');
      assert.equal(got.status, 0, got.stderr + got.stdout);
      assert.equal(w.remote('cat-file', '-t', 'refs/tags/v1.0.0'), 'tag');
      assert.equal(w.remote('rev-parse', 'refs/tags/v1.0.0^{commit}'), w.first);
      assert.equal(w.remote('for-each-ref', '--format=%(taggername)', 'refs/tags/v1.0.0'), 'github-actions[bot]');
      assert.match(w.remote('for-each-ref', '--format=%(contents:subject)', 'refs/tags/v1.0.0'), /^Release v1\.0\.0$/);
      const after = w.remote('for-each-ref', '--format=%(refname) %(objectname)').split('\n').filter((line) => !line.startsWith('refs/tags/v1.0.0 '));
      assert.deepEqual(after, before.split('\n'), 'no branch moved, and no other reference was made');
      assert.equal(w.remote('rev-list', '--all', '--count'), '1', 'no commit was made');
    } finally {
      fs.rmSync(w.base, { recursive: true, force: true });
    }
  });

  test('a run again for the same commit leaves the tag alone, and a tag on another commit stops the run', () => {
    const w = world();
    try {
      w.manifestFor(w.first);
      assert.equal(w.run('Create and push the tag').status, 0);
      const again = w.run('Create and push the tag');
      assert.equal(again.status, 0, again.stderr);
      assert.match(again.stdout, /already exists on the current commit; skipping/);
      const second = w.commit('b.txt', 'two\n');
      w.manifestFor(second);
      const other = w.run('Create and push the tag');
      assert.equal(other.status, 1);
      assert.match(other.stdout, /already exists on a different commit/);
      assert.equal(w.remote('rev-parse', 'refs/tags/v1.0.0^{commit}'), w.first, 'the tag did not move');
    } finally {
      fs.rmSync(w.base, { recursive: true, force: true });
    }
  });

  test('a manifest of another commit stops the run before anything is made', () => {
    const w = world();
    try {
      w.manifestFor('a'.repeat(40));
      const got = w.run('Create and push the tag');
      assert.equal(got.status, 1);
      assert.match(got.stdout, /The manifest does not name the commit that is to be tagged/);
      assert.equal(w.remote('for-each-ref', 'refs/tags'), '');
      assert.equal(w.git('tag', '--list'), '');
    } finally {
      fs.rmSync(w.base, { recursive: true, force: true });
    }
  });

  test('the check of the files passes on a clean tree and on files that are not tracked, and stops on a tracked file that a step changed', () => {
    const w = world();
    try {
      assert.equal(w.run('The files are the files of the commit').status, 0);
      fs.writeFileSync(path.join(w.work, 'RELEASE_NOTES.md'), 'notes\n');
      fs.writeFileSync(path.join(w.work, 'release-changelog-work.md'), 'work\n');
      assert.equal(w.run('The files are the files of the commit').status, 0, 'files that are not tracked are not the commit');
      fs.writeFileSync(path.join(w.work, 'a.txt'), 'changed by a step\n');
      const got = w.run('The files are the files of the commit');
      assert.equal(got.status, 1);
      assert.match(got.stdout, /a\.txt/);
      assert.match(got.stdout, /::error::A step has changed a file of the commit that is released/);
      w.git('checkout', '-q', '--', 'a.txt');
      fs.appendFileSync(path.join(w.work, 'a.txt'), 'staged\n');
      w.git('add', 'a.txt');
      assert.equal(w.run('The files are the files of the commit').status, 1, 'a staged change is not the commit either');
    } finally {
      fs.rmSync(w.base, { recursive: true, force: true });
    }
  });
});
