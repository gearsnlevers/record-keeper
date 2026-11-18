// The setup check at work, what it says (docs/setup-check.md): the options, the exit status, the three forms of the output, the job summary, and what happens to a
// text that a remote place wrote, to the token and to the secret that the program is never given. Against a local server that plays GitHub.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CODES, SEVERITY } from '../setup-check.mjs';
import { runCli } from '../setup-check.mjs';
import {
  NOW, SECRET, TOKEN, actions, check, cleanUp, commitOf, folder, guardedFetch, healthy, hoursAgo, installed, lastRunText, others, requiring, ruleset, serve, tree, write,
} from './setup-check-world.mjs';

after(cleanUp);

const root = fileURLToPath(new URL('..', import.meta.url));
const program = path.join(root, 'setup-check.mjs');

async function world(change) {
  const state = healthy();
  if (change) change(state);
  await serve(state);
  return { state, dir: tree() };
}
/** A run with the output as it is written (not as JSON). */
const say = async (state, dir, { env = {}, argv = ['--repo', state.repo], ...options } = {}) => runCli([...argv, '--root', dir], actions(state, env), { fetch: guardedFetch([]), sleep: async () => {}, now: () => NOW, ...options });
/** A world in which something of every severity is wrong. */
const troubled = (s) => {
  s.rules = [...others(4101), requiring(4101, { strict: false })];
  s.rulesets.set(4101, ruleset(4101, { actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }] }));
  s.lastRun = lastRunText(hoursAgo(80));
};

describe('the options and the failures of the run', () => {
  test('an option that is not one, twice, or without its value: the usage, and the status 2', async () => {
    const usage = 'Usage:\n  setup-check.mjs --repo <owner/name> [--root <dir>] [--now <time>] [--json]\n  setup-check.mjs --local [--root <dir>] [--now <time>] [--json]\n';
    for (const argv of [['--nope'], ['x'], ['--repo'], ['--repo', 'a/b', '--repo', 'a/b'], ['--local', '--local'], ['--repo', 'a/b/c'], ['--root'], ['--now', 'noon'], ['--json', 'x'], ['--dry-run']]) {
      assert.deepEqual(await runCli(argv, {}), { code: 2, stdout: '', stderr: usage }, argv.join(' '));
    }
  });

  test('a repository that is not given, or is not owner/name: a failure of the run, said in a line', async () => {
    const dir = tree();
    for (const env of [{}, { GITHUB_REPOSITORY: '' }, { GITHUB_REPOSITORY: 'a' }, { GITHUB_REPOSITORY: 'a/b/c' }, { GITHUB_REPOSITORY: '../x' }, { GITHUB_REPOSITORY: 'a/..' }]) {
      assert.deepEqual(await runCli(['--root', dir], env), { code: 2, stdout: '', stderr: 'setup-check: failed: the repository must be owner/name (--repo, or GITHUB_REPOSITORY)\n' }, JSON.stringify(env));
    }
  });

  test('--repo is read before the environment, and --local needs neither', async () => {
    const { state, dir } = await world();
    const got = await runCli(['--repo', 'example/repo', '--root', dir, '--json'], actions(state, { GITHUB_REPOSITORY: 'other/other' }), { fetch: guardedFetch([]), now: () => NOW });
    assert.equal(JSON.parse(got.stdout).repository, 'example/repo');
    assert.ok(state.requests.every((request) => !request.path.startsWith('/repos/other/')));
  });

  test('an address of the API that is not an https address, or has credentials, a query or a fragment', async () => {
    const dir = tree();
    for (const url of ['not a url', 'ftp://example.com', 'http://example.com', 'https://user:pass@example.com', 'https://example.com/?x=1', 'https://example.com/#x', 'http://127.0.0.1.example.com']) {
      const got = await runCli(['--repo', 'a/b', '--root', dir], { GITHUB_TOKEN: TOKEN, GITHUB_API_URL: url }, { now: () => NOW });
      assert.equal(got.code, 2, url);
      assert.match(got.stderr, /^setup-check: failed: GITHUB_API_URL (is not an address|must be an https address without credentials, query or fragment)\n$/, url);
    }
  });

  test('a mistake of the program itself is a failure of the run, with the status 2 and not the status of an error that was found', async () => {
    const dir = tree();
    const got = await runCli(['--local', '--root', dir], { GITHUB_TOKEN: TOKEN }, { now: () => { throw new TypeError(`broken ${TOKEN}\nsecond line`); } });
    assert.deepEqual(got, { code: 2, stdout: '', stderr: 'setup-check: failed: unexpected TypeError: broken ***\\u{a}second line\n' });
    const empty = await runCli(['--local', '--root', dir], {}, { now: () => { throw null; } });
    assert.deepEqual(empty, { code: 2, stdout: '', stderr: 'setup-check: failed: unexpected error: undefined\n' });
  });

  test('a token with white space in it is not a token, and is not printed', async () => {
    const dir = tree();
    const got = await runCli(['--repo', 'a/b', '--root', dir], { GITHUB_TOKEN: 'a b' }, { now: () => NOW });
    assert.deepEqual(got, { code: 2, stdout: '', stderr: 'setup-check: failed: GITHUB_TOKEN is not a token\n' });
  });

  test('an address with a trailing slash, and a server that stands behind a path, are read', async () => {
    const { state, dir } = await world();
    const got = await runCli(['--repo', state.repo, '--root', dir, '--json'], actions(state, { GITHUB_API_URL: `${state.url}/` }), { fetch: guardedFetch([]), now: () => NOW });
    assert.deepEqual(JSON.parse(got.stdout).findings, []);
  });
});

describe('the exit status', () => {
  test('0 when nothing is wrong, with warnings and with notices, and 1 only for an error', async () => {
    const fine = await world();
    assert.equal((await say(fine.state, fine.dir)).code, 0);
    const warned = await world((s) => { s.rules = [...others(4101), requiring(4101, { strict: false })]; });
    const got = await say(warned.state, warned.dir);
    assert.equal(got.code, 0);
    assert.match(got.stdout, /^::warning title=check-not-strict::/m);
    const noticed = await world();
    write(noticed.dir, '.github/record-keeper/settings.yml', 'owners: [alice/1001]\napprovals: 1\n');
    assert.equal((await say(noticed.state, noticed.dir)).code, 0);
    const dead = await world((s) => { s.lastRun = lastRunText(hoursAgo(49)); });
    assert.equal((await say(dead.state, dead.dir)).code, 1);
    const open = await world((s) => { s.rules = []; });
    assert.equal((await say(open.state, open.dir)).code, 1);
  });

  test('a program that is run: the status is the status of the process, 1 for a dead audit, and 0 and 2 as they are', async () => {
    const dead = await world((s) => { s.lastRun = lastRunText(hoursAgo(100)); });
    const env = { PATH: process.env.PATH, ...actions(dead.state), HAS_RECORD_KEEPER_TOKEN: 'true' };
    const run = (args, extra = {}) => new Promise((resolve) => {
      const child = spawn(process.execPath, [program, ...args], { env: { ...env, ...extra }, cwd: dead.dir });
      const out = [];
      const err = [];
      child.stdout.on('data', (chunk) => out.push(chunk));
      child.stderr.on('data', (chunk) => err.push(chunk));
      child.on('close', (code) => resolve({ code, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() }));
    });
    const failed = await run(['--repo', 'example/repo']);
    assert.equal(failed.code, 1, failed.stderr);
    assert.match(failed.stdout, /^::error title=audit-dead::the audit is not running: the last run was at /m);
    assert.match(failed.stdout, /setup check: 1 error, 0 warnings, 0 notices\n$/);
    const used = await run(['--nope']);
    assert.equal(used.code, 2);
    assert.match(used.stderr, /^Usage:/);
    const local = await run(['--local'], { GITHUB_ACTIONS: '' });
    assert.equal(local.code, 0);
    assert.match(local.stdout, /^notice: \[not-checked\] not checked: what GitHub holds/m);
  });

  test('a link to the program is the program', async () => {
    const dir = folder('link');
    fs.symlinkSync(program, path.join(dir, 'check.mjs'));
    const run = await new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(dir, 'check.mjs'), '--local', '--root', tree()], { env: { PATH: process.env.PATH } });
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.on('close', (code) => resolve({ code, out }));
    });
    assert.equal(run.code, 0);
    assert.match(run.out, /setup check: 0 errors, 0 warnings, 1 notice\n$/);
  });
});

describe('what is printed', () => {
  test('in Actions: one workflow command for each finding, errors first, the code as its title, and a line that counts', async () => {
    const { state, dir } = await world(troubled);
    const got = await say(state, dir);
    const lines = got.stdout.split('\n');
    assert.equal(lines.pop(), '');
    assert.deepEqual(lines.map((line) => /^::(error|warning|notice) title=([a-z-]+)::/.exec(line)?.slice(1).join(' ') ?? line), ['error audit-dead', 'warning check-not-strict', 'warning bypass-always', 'setup check: 1 error, 2 warnings, 0 notices']);
    assert.match(lines[0], /^::error title=audit-dead::the audit is not running: the last run was at 2026-11-15T04:00:00Z, more than two days ago\. Open the runs/);
    assert.equal(got.stderr, '');
  });

  test('outside Actions: one line for each finding, with its severity and its code, and the line that counts', async () => {
    const { state, dir } = await world(troubled);
    const got = await say(state, dir, { env: { GITHUB_ACTIONS: undefined } });
    assert.deepEqual(got.stdout.split('\n').map((line) => line.replace(/^(error|warning|notice): \[([a-z-]+)\].*$/, '$1 $2')), ['error audit-dead', 'warning check-not-strict', 'warning bypass-always', 'setup check: 1 error, 2 warnings, 0 notices', '']);
  });

  test('a run that finds nothing says only that, in every form', async () => {
    const { state, dir } = await world();
    assert.equal((await say(state, dir)).stdout, 'setup check: 0 errors, 0 warnings, 0 notices\n');
    assert.equal((await say(state, dir, { env: { GITHUB_ACTIONS: undefined } })).stdout, 'setup check: 0 errors, 0 warnings, 0 notices\n');
    const json = JSON.parse((await say(state, dir, { argv: ['--repo', state.repo, '--json'] })).stdout);
    assert.deepEqual(json, { repository: 'example/repo', at: '2026-11-18T12:00:00Z', findings: [], passed: json.passed });
    assert.equal(json.passed.length, 13);
  });

  test('--json: one document with the finding, its severity, its detail and its text, in Actions too, and no annotation', async () => {
    const { state, dir } = await world(troubled);
    const got = await say(state, dir, { argv: ['--repo', state.repo, '--json'] });
    assert.equal(got.stdout.split('\n').length, 2);
    const report = JSON.parse(got.stdout);
    assert.deepEqual(Object.keys(report), ['repository', 'at', 'findings', 'passed']);
    assert.deepEqual(report.findings.map((finding) => Object.keys(finding).join()), ['code,severity,detail,text', 'code,severity,detail,text', 'code,severity,detail,text']);
    assert.deepEqual(report.findings.map((finding) => finding.severity), ['error', 'warning', 'warning']);
    assert.ok(!got.stdout.includes('::error'));
    assert.equal(got.code, 1);
  });

  test('the time of the run is said as the run took it, to the second', async () => {
    const { state, dir } = await world();
    const got = await runCli(['--repo', state.repo, '--root', dir, '--json'], actions(state), { fetch: guardedFetch([]), now: () => NOW + 987 });
    assert.equal(JSON.parse(got.stdout).at, '2026-11-18T12:00:00Z');
  });

  test('every code that the page lists is a title that the output can have', () => {
    for (const code of CODES) assert.match(code, /^[a-z]+(-[a-z]+)+$/);
    assert.equal(CODES.length, Object.keys(SEVERITY).length);
  });
});

describe('the job summary', () => {
  const file = () => path.join(folder('summary'), 'summary.md');

  test('a table of the findings and what was found fine, added to what the file holds', async () => {
    const { state, dir } = await world(troubled);
    const summary = file();
    fs.writeFileSync(summary, '### Another step\n\nIt said this.\n');
    const got = await say(state, dir, { env: { GITHUB_STEP_SUMMARY: summary } });
    assert.equal(got.code, 1);
    const text = fs.readFileSync(summary, 'utf8');
    assert.ok(text.startsWith('### Another step\n\nIt said this.\n## Records setup check\n\n`example/repo` at 2026-11-18T12:00:00Z: **1 error, 2 warnings, 0 notices**\n\n| Severity | Code | What |\n'));
    assert.equal(text.split('\n').filter((line) => /^\| (error|warning|notice) \|/.test(line)).length, 3);
    assert.match(text, /\| error \| `audit-dead` \| the audit is not running/);
    assert.match(text, /Checked, and fine: `settings`, `owners`, `owner-accounts`, `codeowners`, `check-required`, `pin`, `manifest`, `managed-files`, `secret`, `audit-workflow`\.\n\n$/);
  });

  test('a file that does not exist yet is made, and a run with no variable writes none', async () => {
    const { state, dir } = await world();
    const summary = file();
    await say(state, dir, { env: { GITHUB_STEP_SUMMARY: summary } });
    assert.match(fs.readFileSync(summary, 'utf8'), /^## Records setup check\n\n`example\/repo` at .*\*\*0 errors, 0 warnings, 0 notices\*\*\n\nNo finding\.\n\n/);
    await say(state, dir, { env: { GITHUB_STEP_SUMMARY: '' } });
    assert.equal(fs.readdirSync(path.dirname(summary)).length, 1);
  });

  test('a file that cannot be written is said, and is no failure and no change of the status', async () => {
    const { state, dir } = await world(troubled);
    const got = await say(state, dir, { env: { GITHUB_STEP_SUMMARY: path.join(folder('nowhere'), 'a', 'b', 'summary.md') } });
    assert.equal(got.code, 1);
    assert.equal(got.stderr, 'setup-check: the job summary could not be written: ENOENT\n');
    assert.match(got.stdout, /setup check: 1 error, 2 warnings, 0 notices\n$/);
    const clean = await world();
    const ok = await say(clean.state, clean.dir, { env: { GITHUB_STEP_SUMMARY: folder('is-a-folder') } });
    assert.equal(ok.code, 0);
    assert.match(ok.stderr, /^setup-check: the job summary could not be written: EISDIR\n$/);
  });
});

describe('a text that came from a remote place', () => {
  const HOSTILE = 'x\n::error title=pwned::injected\r::set-output name=a::b %0A::stop-commands::t \u202e\u2028::warning::y\u0000\u001b[31m';
  const hostileWorld = () => world((s) => {
    s.rulesets.set(4101, ruleset(4101, { name: HOSTILE, actors: [{ actor_id: 5, actor_type: HOSTILE, bypass_mode: HOSTILE }] }));
    s.fault = (entry) => (entry.path === '/user/1002' ? { status: 500, body: { message: HOSTILE } } : undefined);
  });

  test('in Actions every line is a command of the check or its last line, and the text is one line of it', async () => {
    const { state, dir } = await hostileWorld();
    const got = await say(state, dir);
    const lines = got.stdout.split('\n');
    assert.equal(lines.pop(), '');
    assert.equal(lines.length, 3, got.stdout);
    for (const line of lines.slice(0, -1)) {
      assert.match(line, /^::(warning|notice) title=(bypass-always|not-checked)::[^\n\r\u2028\u2029\u202e\u0000\u001b]*$/);
      assert.ok(!line.slice(2).replace(/^(warning|notice) title=[a-z-]+::/, '').match(/^::/), 'the message does not start with a command');
    }
    assert.match(lines.at(-1), /^setup check: 0 errors, 1 warning, 1 notice$/);
    assert.ok(got.stdout.includes('x\\u{a}::error title=pwned::injected\\u{d}::set-output name=a::b %250A::stop-commands::t \\u{202e}\\u{2028}::warning::y\\u{0}\\u{1b}[31m'.slice(0, 20)));
    assert.ok(!/[\u0000-\u0009\u000b-\u001f\u202e\u2028\u2029]/.test(got.stdout));
  });

  test('in a plain run, in JSON and in the summary: no line of it starts as anything but the check wrote it', async () => {
    const { state, dir } = await hostileWorld();
    const summary = path.join(folder('hostile'), 's.md');
    const plain = await say(state, dir, { env: { GITHUB_ACTIONS: undefined, GITHUB_STEP_SUMMARY: summary } });
    for (const line of plain.stdout.split('\n').filter(Boolean)) assert.match(line, /^(warning|notice): \[[a-z-]+\] |^setup check: /);
    const text = fs.readFileSync(summary, 'utf8');
    assert.equal(text.split('\n').filter((line) => line.startsWith('|')).length, 4, 'a header, a rule and a row for each finding');
    assert.ok(!/[\u0000-\u0009\u000b-\u001f\u202e\u2028\u2029]/.test(text));
    for (const line of text.split('\n').filter((item) => item.startsWith('| warning') || item.startsWith('| notice'))) assert.ok(!/\]\(|<|!\[/.test(line.replace(/\\./g, '')), line);
    const json = await say(state, dir, { argv: ['--repo', state.repo, '--json'] });
    assert.equal(json.stdout.split('\n').length, 2);
    assert.ok(JSON.parse(json.stdout).findings.every((finding) => !/[\n\r\u2028\u202e\u0000]/.test(finding.text)));
  });

  test('a message of an answer is cut to 200 characters, and a name that is a hundred characters long is cut to eighty', async () => {
    const { state, dir } = await world();
    state.fault = (entry) => (entry.path === '/user/1002' ? { status: 403, body: { message: 'm'.repeat(500) } } : undefined);
    const got = await check(state, dir);
    const said = got.report.findings[0].detail;
    assert.ok(said.length < 300);
    assert.ok(said.includes('m'.repeat(150)) && !said.includes('m'.repeat(250)));
  });

  test('the asks of the check are one finding each: a list is one, and the titles are the codes of the page', async () => {
    const { state, dir } = await hostileWorld();
    const got = await say(state, dir);
    for (const [, code] of got.stdout.matchAll(/^::[a-z]+ title=([^:]*)::/gm)) assert.ok(CODES.includes(code), code);
  });
});

describe('the token, and the secret that the program is never given', () => {
  test('a token that an answer says again is taken out of every form of the output, and out of the summary', async () => {
    const { state, dir } = await world();
    state.fault = (entry) => (entry.path === '/user/1002' ? { status: 403, body: { message: `Bad credentials: ${TOKEN} and ${SECRET}` } } : undefined);
    const summary = path.join(folder('token'), 's.md');
    for (const env of [{}, { GITHUB_ACTIONS: undefined }]) {
      const got = await say(state, dir, { env: { ...env, RECORD_KEEPER_TOKEN: SECRET, GITHUB_STEP_SUMMARY: summary } });
      assert.ok(!got.stdout.includes(TOKEN) && !got.stderr.includes(TOKEN) && !got.stdout.includes(SECRET), JSON.stringify(env));
      assert.ok(got.stdout.includes('***'), 'something was there to take out');
    }
    const json = await say(state, dir, { argv: ['--repo', state.repo, '--json'], env: { RECORD_KEEPER_TOKEN: SECRET } });
    assert.ok(!json.stdout.includes(TOKEN) && !json.stdout.includes(SECRET));
    const text = fs.readFileSync(summary, 'utf8');
    assert.ok(!text.includes(TOKEN) && !text.includes(SECRET) && !text.replace(/\\/g, '').includes(TOKEN.replace(/\\/g, '')), 'the summary has neither, also not as Markdown makes it');
    assert.ok(text.includes('\\*\\*\\*'));
  });

  test('a failure of the run does not say the token either', async () => {
    const dir = tree();
    const got = await runCli(['--repo', 'a/b', '--root', dir], { GITHUB_TOKEN: TOKEN, RECORD_KEEPER_TOKEN: SECRET, GITHUB_API_URL: `ftp://${TOKEN}.example.com` }, { now: () => NOW });
    assert.equal(got.code, 2);
    assert.ok(!got.stderr.includes(TOKEN));
  });

  test('the secret is not in any request, whatever the environment says', async () => {
    const { state, dir } = await world();
    await say(state, dir, { env: { RECORD_KEEPER_TOKEN: SECRET, GH_TOKEN: SECRET, GITHUB_TOKEN: TOKEN } });
    for (const request of state.requests) assert.ok(!JSON.stringify(request).includes(SECRET));
    assert.equal(state.requests.every((request) => request.authorization === `Bearer ${TOKEN}`), true);
  });

  test('the check is given nothing of the secret but a word: an environment that has the word and no secret is judged the same', async () => {
    const { state, dir } = await world();
    const got = await check(state, dir, { env: { RECORD_KEEPER_TOKEN: undefined, HAS_RECORD_KEEPER_TOKEN: 'false' } });
    assert.deepEqual(got.found, ['secret-not-set']);
  });
});

void commitOf;
void installed;
