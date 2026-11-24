// The core of the setup check (docs/setup-check.md): the fixtures of test/fixtures/setup, the parts of the decision one by one, the text of every finding, and
// what is written for GitHub to show. Nothing here reads or writes anything, and nothing reaches the network. What a run does with the files and with GitHub is in
// setup-check-run*.test.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { WORKFLOW_FILES } from '../record-keeper.mjs';
import {
  AUDIT_WORKFLOW, BOUNDS, CHECK, CODEOWNERS_PLACES, CODES, COVERED, MAX_AGE_MS, NOT_LOOKED_AT, SECRET, SEVERITY, SKEW_MS, TOPICS,
  annotation, decide, describe as say, describeLooked, escapeData, escapeProperty, markdown, matches, ownersOf, parseArgs, parseCodeowners, parseUtc, summary, tally,
} from '../setup-check.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { decisions, codeowners, times } = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/setup/cases.json'), 'utf8'));
const page = fs.readFileSync(path.join(root, 'docs/setup-check.md'), 'utf8');

const GOLDEN = [
  ["audit-dead", "<DETAIL>", "the audit is not running: <DETAIL>. Open the runs of the workflow \"Records audit\", run it by hand and read its log, and make sure the workflow is enabled."],
  ["check-not-required", "<DETAIL>", "the check \"Records integrity\" is not required on the default branch (<DETAIL>): no rule that applies to it requires the check, so a pull request can be merged without it. Add the check to the ruleset of the default branch (Settings, Rules, Rulesets) and require branches to be up to date."],
  ["check-not-strict", "<DETAIL>", "the check \"Records integrity\" is required on <DETAIL>, but no rule that requires it also requires branches to be up to date. Turn on \"Require branches to be up to date before merging\" in that rule."],
  ["bypass-always", "<DETAIL>", "an actor may skip the rule that requires \"Records integrity\" and push to the default branch directly (<DETAIL>). Set its bypass mode to \"For pull requests only\", or remove it."],
  ["codeowners-missing", "<DETAIL>", "there is no CODEOWNERS file (.github/CODEOWNERS, CODEOWNERS or docs/CODEOWNERS). Add one that gives an owner to the settings file, the pin and the workflow files of the kit."],
  ["codeowners-uncovered", "<DETAIL>", "CODEOWNERS gives no owner to <DETAIL>. Add an entry for them (for example \"/.github/\" and the owners) so that a ruleset can require the review of a code owner."],
  ["owners-few", "<DETAIL>", "the settings list fewer owners than approvals needs (<DETAIL>), so an act cannot be approved. List more owners in .github/record-keeper/settings.yml."],
  ["owner-mismatch", "<DETAIL>", "an owner of the settings is not the account that GitHub knows (<DETAIL>). Correct the entry in .github/record-keeper/settings.yml: the ID decides and the login must be the current one."],
  ["managed-differs", "<DETAIL>", "files that the kit installed differ from the pinned release: <DETAIL>. Run the updater with --target set to the pinned version to bring them back, or restore them."],
  ["block-unusable", "doubled", "the Record Keeper block in AGENTS.md cannot be used (there is more than one begin marker or more than one end marker), so the updater leaves the file alone and the agents may read old rules, or none. Repair or take out the two marker lines and the text between them by hand, and run the updater with --target set to the pinned version (docs/agent-files.md of the kit)."],
  ["manifest-unreadable", "<DETAIL>", "the pinned release has no manifest that can be read (<DETAIL>), so the installed files cannot be compared with it. Check the pin, and that the release still exists."],
  ["pin-missing", "<DETAIL>", "there is no pin (.github/record-keeper.yml), so the updater has no release to keep this repository on. Adopt a release with the updater (docs/updater.md of the kit)."],
  ["pin-unusable", "<DETAIL>", "the pin cannot be used (<DETAIL>), so the updater will not update this repository. Fix .github/record-keeper.yml in a pull request (docs/updater.md of the kit)."],
  ["settings-missing", "<DETAIL>", "there is no settings file (.github/record-keeper/settings.yml), so no owner is known and no act can be approved. Create it with the owners (docs/settings.md of the kit)."],
  ["settings-unusable", "<DETAIL>", "the settings file cannot be used (<DETAIL>), and the kit reads the default for what it cannot read. Fix .github/record-keeper/settings.yml (docs/settings.md of the kit)."],
  ["secret-not-set", "<DETAIL>", "the secret RECORD_KEEPER_TOKEN is not set, so the updater cannot open pull requests. Create it as docs/updater.md of the kit says."],
  ["audit-workflow-missing", "<DETAIL>", "the audit workflow .github/workflows/records-audit.yml is not a file, so nothing runs the nightly audit. Restore it with the updater."],
  ["audit-record-unreadable", "<DETAIL>", "last-run.json on the branch record-keeper/log cannot be read (<DETAIL>), so the age of the last audit run is not known. Run the workflow \"Records audit\" by hand: it replaces the file."],
  ["audit-record-future", "<DETAIL>", "last-run.json on the branch record-keeper/log says the audit ran at <DETAIL>, which is in the future. Look at the file and at the clock of the runner."],
  ["single-owner", "<DETAIL>", "this pull request puts the single-owner mode on, or changes who the owners are while it is on (approvals: 1). The owner is the whole authority: the checks keep the records in order and stop contributors, agents and forgetfulness, but not the owner, nor whoever holds the owner's token. The delays and the audit still apply."],
  ["audit-not-yet", "<DETAIL>", "<DETAIL>. The audit writes its record on every push to the default branch and every night, so this goes away by itself; look at the workflow \"Records audit\" if it does not."],
  ["not-checked", "github: <WHY>", "not checked: what GitHub holds: the rules of the default branch, the accounts of the owners, the pinned release and the last run of the audit (<WHY>). Run it without --local, in the workflow or with a token that can read the repository."],
  ["not-checked", "repository: <WHY>", "not checked: the default branch, its rules and the last run of the audit (<WHY>). Check that the token of the workflow can read the repository (the workflow asks for contents: read), and run it again."],
  ["not-checked", "rules: <WHY>", "not checked: the rules that apply to the default branch (<WHY>). Read them under Settings, Rules, Rulesets: a ruleset on the default branch must require the check \"Records integrity\". Run the check again later if GitHub was busy."],
  ["not-checked", "branch protection: <WHY>", "not checked: whether branch protection requires the check, which no ruleset does (<WHY>). Read it under Settings, Branches, or put the rule into a ruleset (Settings, Rules, Rulesets), which the check reads. Run the check again later if GitHub was busy."],
  ["not-checked", "strict: <WHY>", "not checked: whether the check must be up to date (<WHY>). Branch protection does not tell the token of the workflow. Move the rule into a ruleset, which the check reads, or read the setting under Settings, Branches."],
  ["not-checked", "bypass: <WHY>", "not checked: who may bypass the ruleset (<WHY>). The ruleset could not be read. Run the check again later, and read it under Settings, Rules, Rulesets if it keeps failing: no actor may bypass except for pull requests."],
  ["not-checked", "accounts: <WHY>", "not checked: the accounts of the owners (<WHY>). Read https://api.github.com/user/<id> for each owner and compare the login, or run the check again later."],
  ["not-checked", "codeowners: <WHY>", "not checked: who CODEOWNERS gives the files of the kit to (<WHY>). Write CODEOWNERS with the patterns that docs/setup-check.md says are read, or read the file by hand."],
  ["not-checked", "release: <WHY>", "not checked: the manifest of the pinned release (<WHY>). Run the check again later. The release is read from the repository named in the pin."],
  ["not-checked", "secret: <WHY>", "not checked: whether RECORD_KEEPER_TOKEN is set (<WHY>). Run the workflow on its schedule or by hand: it says whether the secret is set (HAS_RECORD_KEEPER_TOKEN)."],
  ["not-checked", "audit: <WHY>", "not checked: the last run of the audit (<WHY>). Run the check again later, and look at the branch record-keeper/log by hand."],
  ["not-checked", "age: <WHY>", "not checked: how long the audit workflow has been in the repository (<WHY>). Run the check again later, and look at the history of .github/workflows/records-audit.yml by hand."],
];

const GOLDEN_LOOKED = [
  ["bypass", "<WHY>", "not looked at: who may bypass the ruleset (<WHY>). The token of a workflow is not shown the bypass list of a ruleset, whoever the repository is. The audit finds the effect (a change to a guarded file that came in without a pull request is a violation, A-03), and run by hand with the token of a person who may administer the repository the program says bypass-always."],
  ["own", "<WHY>", "not looked at: the pin, the pinned release and the installed files (<WHY>). The kit does not install itself."],
  ["secret", "<WHY>", "not looked at: whether RECORD_KEEPER_TOKEN is set (<WHY>). The run of a pull request from a fork is given no secret, so what it would say is not what the repository has. The scheduled run and a manual run of the workflow say it when the secret is not set."],
];

describe('the fixtures of the decision', () => {
  for (const c of decisions) {
    test(`${c.id}: ${c.note}`, () => {
      assert.deepEqual(decide(c.input), c.expect);
    });
  }

  test('the decision does not change what it is given', () => {
    for (const c of decisions) {
      const copy = structuredClone(c.input);
      decide(c.input);
      assert.deepEqual(c.input, copy, c.id);
    }
  });

  test('the ids of the cases are unique, and every case says what it shows', () => {
    const ids = [...decisions, ...codeowners].map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const c of [...decisions, ...codeowners]) assert.ok(c.note.length > 0, c.id);
  });

  test('every finding that the check can make is shown by a case, with the severity that the page gives it', () => {
    const shown = new Set(decisions.flatMap((c) => c.expect.findings.map((f) => f.code)));
    assert.deepEqual(CODES.filter((code) => !shown.has(code)), []);
    // one finding has a second severity: `check-not-required` is a notice on the pull request that installs the kit, and in no other case (the next test)
    for (const c of decisions) for (const f of c.expect.findings) assert.equal(f.severity, f.code === 'check-not-required' && c.input.basePin?.state === 'absent' && c.input.event === 'pull_request' && c.input.pin.state !== 'absent' ? 'notice' : SEVERITY[f.code], `${c.id}: ${f.code}`);
    assert.deepEqual(Object.entries(SEVERITY).filter(([, severity]) => severity === 'error').map(([code]) => code), ['audit-dead', 'check-not-required']);
  });

  test('check-not-required is a notice on the pull request that installs the kit and an error in every other case, and the cases show both', () => {
    const missing = decisions.filter((c) => c.expect.findings.some((f) => f.code === 'check-not-required'));
    const notices = missing.filter((c) => c.expect.findings.some((f) => f.code === 'check-not-required' && f.severity === 'notice'));
    assert.ok(notices.length >= 3 && missing.length - notices.length >= 10, `${notices.length} notices, ${missing.length - notices.length} errors`);
    for (const c of missing) {
      const installing = c.input.event === 'pull_request' && c.input.pin.state !== 'absent' && c.input.basePin?.state === 'absent';
      assert.equal(c.expect.findings.find((f) => f.code === 'check-not-required').severity, installing ? 'notice' : 'error', c.id);
    }
    // every other state of the pin of the base, and of the event, which is not the pull request that installs the kit, is shown as an error
    assert.deepEqual([...new Set(missing.filter((c) => !notices.includes(c)).map((c) => c.input.basePin?.state ?? 'left out'))].sort(), ['absent', 'left out', 'not-read', 'present']);
    assert.deepEqual([...new Set(missing.filter((c) => c.input.basePin?.state === 'absent' && !notices.includes(c)).map((c) => `${c.input.event} ${c.input.pin.state}`))].sort(), ['null read', 'push read', 'schedule read', 'workflow_dispatch read', 'pull_request absent'].sort());
  });

  test('every topic that can be checked is found fine by a case, and every topic that can be not checked is shown not checked', () => {
    const fine = new Set(decisions.flatMap((c) => c.expect.passed));
    assert.deepEqual(['settings', 'owners', 'owner-accounts', 'codeowners', 'check-required', 'check-strict', 'bypass', 'pin', 'manifest', 'managed-files', 'secret', 'audit-workflow', 'audit'].filter((topic) => !fine.has(topic)), []);
    const not = new Set(decisions.flatMap((c) => c.expect.findings).filter((f) => f.code === 'not-checked').map((f) => f.detail.split(': ')[0]));
    assert.deepEqual(Object.keys(TOPICS).filter((topic) => !not.has(topic)), []);
    for (const topic of not) assert.ok(Object.hasOwn(TOPICS, topic), topic);
  });

  test('the findings come errors first, then warnings, then notices', () => {
    const rank = { error: 0, warning: 1, notice: 2 };
    for (const c of decisions) assert.deepEqual(c.expect.findings.map((f) => rank[f.severity]), c.expect.findings.map((f) => rank[f.severity]).sort(), c.id);
  });

  test('only an audit that is dead or a check that is not required makes an error, and an error is what fails the run', () => {
    const errors = decisions.filter((c) => c.expect.findings.some((f) => f.severity === 'error')).map((c) => c.id);
    assert.ok(errors.length > 5);
    for (const c of decisions.filter((item) => !errors.includes(item.id))) assert.ok(c.expect.findings.every((f) => f.severity !== 'error'), c.id);
  });

  test('a decision is the same from one run to the next', () => {
    for (const c of decisions.slice(0, 30)) assert.deepEqual(decide(c.input), decide(structuredClone(c.input)));
  });
});

describe('what the decision does with its limits', () => {
  const base = () => structuredClone(decisions.find((c) => c.id === 'h-0').input);
  const at = (state, ms) => {
    state.github.lastRun = { ok: true, state: 'record', at: new Date(state.now - ms).toISOString().replace('.000Z', 'Z') };
    return decide(state);
  };

  test('the age of the last run: dead when it is older than 48 hours, alive up to the second', () => {
    assert.equal(MAX_AGE_MS, 48 * 3600 * 1000);
    assert.deepEqual(at(base(), MAX_AGE_MS).findings, []);
    assert.deepEqual(at(base(), MAX_AGE_MS + 1000).findings.map((f) => f.code), ['audit-dead']);
    assert.deepEqual(at(base(), 0).findings, []);
  });

  test('a time in the future: up to five minutes is the clock of another runner, more is a warning', () => {
    assert.equal(SKEW_MS, 5 * 60 * 1000);
    assert.deepEqual(at(base(), -SKEW_MS).findings, []);
    assert.deepEqual(at(base(), -SKEW_MS - 1000).findings.map((f) => f.code), ['audit-record-future']);
  });

  test('the number of owners that are asked about, and the number of paths that are listed', () => {
    assert.equal(BOUNDS.accounts, 30);
    assert.equal(BOUNDS.list, 8);
  });

  test('the files that CODEOWNERS must give an owner are the settings, the pin and the four workflows of the kit', () => {
    assert.deepEqual(COVERED, ['.github/record-keeper/settings.yml', '.github/record-keeper.yml', ...WORKFLOW_FILES]);
    assert.equal(WORKFLOW_FILES.length, 4);
    assert.ok(COVERED.includes(AUDIT_WORKFLOW));
    assert.deepEqual(CODEOWNERS_PLACES, ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']);
    assert.equal(CHECK, 'Records integrity');
    assert.equal(SECRET, 'RECORD_KEEPER_TOKEN');
  });

  test('the check that is required is the one that the integrity workflow is named after', () => {
    assert.match(fs.readFileSync(path.join(root, '.github/workflows/records-integrity.yml'), 'utf8'), /^ {4}name: Records integrity$/m);
  });

  test('a missing reading is not checked, and never a pass: no age, no account, no bypass list', () => {
    const state = base();
    state.github.lastRun = { ok: true, state: 'absent' };
    delete state.github.accounts['1001'];
    delete state.github.bypass['11'];
    assert.deepEqual(decide(state).findings.map((f) => f.detail), ['accounts: alice/1001: not read', 'bypass: ruleset 11: not read', 'age: not read']);
  });
});

describe('times', () => {
  for (const c of times) {
    test(`${JSON.stringify(c.text)}: ${c.note}`, () => {
      assert.equal(parseUtc(c.text), c.expect);
    });
  }

  test('a time that is read is a time that is written the same way back', () => {
    for (const c of times.filter((item) => item.expect !== null)) assert.equal(new Date(c.expect).toISOString(), `${c.text.slice(0, -1)}.000Z`);
  });
});

describe('CODEOWNERS', () => {
  for (const c of codeowners) {
    test(`${c.id}: ${c.note}`, () => {
      const parsed = parseCodeowners(c.text);
      assert.deepEqual(parsed.unreadable, c.unreadable);
      for (const [file, owners] of Object.entries(c.owners)) assert.deepEqual(ownersOf(parsed.rules, file), owners, file);
    });
  }

  test('a rule has its line, its pattern and its owners', () => {
    assert.deepEqual(parseCodeowners('\n# c\n/a/ @x @y\n').rules, [{ line: 3, pattern: '/a/', owners: ['@x', '@y'] }]);
    assert.deepEqual(parseCodeowners('/a/\n').rules, [{ line: 1, pattern: '/a/', owners: [] }]);
  });

  test('matches says what a pattern matches', () => {
    assert.equal(matches('/a/', 'a/b'), true);
    assert.equal(matches('/a/', 'a'), false);
    assert.equal(matches('a', 'x/a/b'), true);
    assert.equal(matches('/a', 'x/a'), false);
    assert.equal(matches('a/b', 'x/a/b'), false);
    assert.equal(matches('*.md', 'x/y/z.md'), true);
    assert.equal(matches('/*.md', 'x/z.md'), false);
  });

  test('a long run of ** is no trouble', () => {
    const pattern = `/${Array(12).fill('**').join('/')}/z`;
    assert.equal(matches(pattern, 'a/b/c/d/e/f/g/h/z'), true);
    assert.equal(matches(pattern, 'a/b/c/d/e/f/g/h/y'), false);
  });

  test('the owners of a path are those of the last pattern that matches it', () => {
    const { rules } = parseCodeowners('* @a\n/x/ @b\n/x/y @c\n/x/y/z\n');
    assert.deepEqual(['q', 'x/f', 'x/y', 'x/y/z/w'].map((file) => ownersOf(rules, file)), [['@a'], ['@b'], ['@c'], []]);
  });

  test('the page says which of it is read, and lists the reasons that a pattern is not', () => {
    for (const reason of [...new Set(codeowners.flatMap((c) => c.unreadable.map((u) => u.reason)))]) assert.ok(page.includes(reason.replace(/^an? /, '')) || page.includes(reason), reason);
  });
});

describe('the text of a finding', () => {
  for (const [code, detail, text] of GOLDEN) {
    test(`${code} ${detail}`, () => {
      assert.equal(say({ code, detail }), text);
    });
  }

  for (const [topic, why, text] of GOLDEN_LOOKED) {
    test(`not looked at: ${topic}`, () => {
      assert.equal(describeLooked({ topic, why }), text);
    });
  }

  test('what is not looked at has a text for every topic that a case shows, and no more', () => {
    assert.deepEqual(GOLDEN_LOOKED.map(([topic]) => topic), Object.keys(NOT_LOOKED_AT));
    const shown = new Set(decisions.flatMap((c) => c.expect.notLookedAt.map((item) => item.topic)));
    assert.deepEqual(Object.keys(NOT_LOOKED_AT).filter((topic) => !shown.has(topic)), []);
    for (const topic of shown) assert.ok(Object.hasOwn(NOT_LOOKED_AT, topic), topic);
    assert.ok(!Object.hasOwn(TOPICS, 'own'), 'the kit that does not install itself is not a check that was not made');
    assert.ok(Object.hasOwn(TOPICS, 'secret') && Object.hasOwn(NOT_LOOKED_AT, 'secret'), 'the secret is not checked when the workflow does not say, and not looked at in a run for a pull request');
    assert.doesNotMatch(TOPICS.secret.fix, /pull request/);
    for (const topic of Object.keys(NOT_LOOKED_AT)) assert.ok(page.includes(`\`${topic}\``), topic);
    assert.match(describeLooked({ topic: 'bypass', why: 'a\nb::c' }), /\(a\\u\{a\}b::c\)/);
  });

  test('check-not-required says that it is expected on the pull request of a first adoption, when it is a notice, and is the text above in every other case', () => {
    const notice = say({ code: 'check-not-required', severity: 'notice', detail: 'main' });
    assert.equal(notice, 'the check "Records integrity" is not required on the default branch (main), and that is expected on the pull request of a first adoption: this pull request installs the kit, and the ruleset that requires the check is set after it is merged, because a required check that the base branch cannot run would hold the pull request for ever. After the merge, add the check to the ruleset of the default branch (Settings, Rules, Rulesets) and require branches to be up to date (docs/install.md of the kit, first adoption).');
    const error = GOLDEN.find(([code]) => code === 'check-not-required')[2].replace('<DETAIL>', 'main');
    for (const severity of ['error', 'warning', undefined]) assert.equal(say({ code: 'check-not-required', severity, detail: 'main' }), error, String(severity));
    assert.notEqual(notice, error);
    assert.match(annotation({ code: 'check-not-required', severity: 'notice', detail: 'main' }), /^::notice title=check-not-required::the check "Records integrity" is not required on the default branch \(main\), and that is expected on the pull request of a first adoption: /);
    assert.match(say({ code: 'check-not-required', severity: 'notice', detail: 'a\nb' }), /\(a\\u\{a\}b\)/, 'a detail is written as text in the notice too');
  });

  test('every code has a text, and a text for every topic of a check that was not made', () => {
    assert.deepEqual(GOLDEN.filter(([code]) => code !== 'not-checked').map(([code]) => code), CODES.filter((code) => code !== 'not-checked'));
    assert.deepEqual(GOLDEN.filter(([code]) => code === 'not-checked').map(([, detail]) => detail.split(':')[0]), Object.keys(TOPICS));
  });

  test('a finding that names a step: the text says what is wrong and what to do about it', () => {
    for (const code of CODES.filter((item) => SEVERITY[item] !== 'notice' || item === 'not-checked')) {
      const text = say({ code, detail: code === 'not-checked' ? 'rules: why' : 'x' });
      assert.ok(text.length > 40 && /[.]$/.test(text), code);
      assert.ok(!/[\u0000-\u001f]/.test(text), code);
    }
  });

  test('a text that came from a remote place has no control character in it', () => {
    const hostile = 'a\nb\rc\u0000d\u001be\u202ef\u2028g\ufeffh';
    for (const code of CODES) {
      const text = say({ code, detail: code === 'not-checked' ? `accounts: ${hostile}` : hostile });
      assert.doesNotMatch(text, /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2028\u2029\ufeff]/, code);
    }
    assert.match(say({ code: 'audit-dead', detail: 'a\nb' }), /a\\u\{a\}b/);
  });

  test('the codes of the page, and no other, are the codes of the program', () => {
    for (const code of CODES) assert.ok(page.includes(`\`${code}\``), `the page does not list ${code}`);
    const named = [...page.matchAll(/^\| `([a-z]+(?:-[a-z]+)+)` \| (error|warning|notice) \|/gm)];
    assert.deepEqual(named.map((m) => m[1]).sort(), [...CODES].sort());
    for (const [, code, severity] of named) assert.equal(severity, SEVERITY[code], code);
  });

  test('the topics of the page are the topics of the program', () => {
    for (const topic of Object.keys(TOPICS)) assert.ok(page.includes(`\`${topic}\``), `the page does not list the topic ${topic}`);
  });
});

describe('what is written for GitHub', () => {
  test('a message and a property are escaped as GitHub documents, and a control character is written as text', () => {
    assert.equal(escapeData('100% a\nb\r\nc'), '100%25 a%0Ab%0D%0Ac'.replace('%0Ab', '\\u{a}b').replace('%0D%0A', '\\u{d}\\u{a}'));
    assert.equal(escapeData('%0A'), '%250A');
    assert.equal(escapeProperty('a:b,c%'), 'a%3Ab%2Cc%25');
    assert.equal(escapeData('a:b,c'), 'a:b,c');
  });

  test('an annotation is one line, whatever the detail is', () => {
    const lines = [
      'x\n::error::injected', 'x\r::set-output name=a::b', '::stop-commands::token', '%0A::error::x', 'a::b::c', '\u202e::error::x', 'x\u2028::warning::y', '::add-mask::secret', '\n\n\n', '%', '::',
    ];
    for (const detail of lines) {
      for (const code of CODES) {
        const finding = { code, severity: SEVERITY[code], detail: code === 'not-checked' ? `rules: ${detail}` : detail };
        const line = annotation(finding);
        assert.ok(!/[\n\r\u2028\u2029]/.test(line), `${code}: ${JSON.stringify(line)}`);
        assert.match(line, new RegExp(`^::${SEVERITY[code]} title=${code}::[^\\n]*$`));
        assert.equal(line.indexOf('::', 2), line.indexOf(`title=${code}::`) + `title=${code}`.length, 'the only :: after the start ends the properties');
      }
    }
  });

  test('a message may hold :: because it can no longer start a line', () => {
    const line = annotation({ code: 'audit-dead', severity: 'error', detail: 'x::error::y' });
    assert.ok(line.startsWith('::error title=audit-dead::the audit is not running: x::error::y.'));
  });

  test('the tally says how many of each there are', () => {
    const of = (...severities) => severities.map((severity) => ({ severity }));
    assert.equal(tally([]), 'setup check: 0 errors, 0 warnings, 0 notices');
    assert.equal(tally(of('error', 'warning', 'notice')), 'setup check: 1 error, 1 warning, 1 notice');
    assert.equal(tally(of('error', 'error', 'warning', 'warning', 'notice', 'notice')), 'setup check: 2 errors, 2 warnings, 2 notices');
  });

  test('Markdown made from a text makes no link, no image, no mention, no table and no HTML', () => {
    const text = markdown('[a](http://x) ![b](y) @mention <b>x</b> | a | `c` *d* _e_ # f\n- g');
    for (const bad of ['[a](', '![', ' @mention', '<b>', ' | ', '`c`']) assert.ok(!text.includes(bad), bad);
    assert.ok(!text.includes('\n'));
    for (const character of ['\\', '`', '*', '_', '{', '}', '[', ']', '(', ')', '#', '+', '-', '.', '!', '|', '<', '>', '&', '@', '~', ':']) assert.equal(markdown(character), `\\${character}`, character);
    assert.equal(markdown('plain words'), 'plain words');
    assert.equal(markdown('a\\b'), 'a\\\\b');
  });

  test('the summary has a row for each finding, and says what was found fine', () => {
    const result = decide(decisions.find((c) => c.id === 'z-1').input);
    const text = summary(result, { repo: 'example/repo', at: '2026-11-18T12:00:00Z' });
    assert.match(text, /^## Records setup check\n\n`example\/repo` at 2026-11-18T12:00:00Z: \*\*2 errors, 4 warnings, 1 notice\*\*\n\n\| Severity \| Code \| What \|\n\| -------- \| ---- \| ---- \|\n\| error \| `check-not-required` \|/);
    assert.equal(text.split('\n').filter((line) => line.startsWith('| error ') || line.startsWith('| warning ') || line.startsWith('| notice ')).length, 7);
    assert.match(text, /Checked, and fine: `settings`, `owners`\.\n$/);
    assert.match(summary({ findings: [], passed: [], notLookedAt: [] }, { repo: null, at: '2026-11-18T12:00:00Z' }), /^## Records setup check\n\nThe working tree at 2026-11-18T12:00:00Z: \*\*0 errors, 0 warnings, 0 notices\*\*\n\nNo finding\.\n\nChecked, and fine: nothing\.\n$/);
  });

  test('what is not looked at is a list in the summary, and no row of the table', () => {
    const result = decide(decisions.find((c) => c.id === 'r-18').input);
    assert.equal(result.notLookedAt.length, 1);
    const text = summary(result, { repo: 'example/repo', at: '2026-11-18T12:00:00Z' });
    assert.match(text, /\n\nNot looked at, and nothing that this repository can do about it:\n\n- `bypass`: not looked at\\: who may bypass the ruleset \\\(ruleset 20\\: the token cannot see the bypass list\\\)\\\. The token of a workflow/);
    assert.equal(text.split('\n').filter((line) => /^\| (error|warning|notice) /.test(line)).length, 1, 'one finding, and the bypass list is not one');
    assert.ok(!/^\| notice .*not looked at/m.test(text));
    assert.ok(text.endsWith('.\n') && !text.endsWith('\n\n'));
  });

  test('a hostile text does not break out of its row of the summary', () => {
    const result = { findings: [{ code: 'owner-mismatch', severity: 'warning', detail: 'a|b\n| error | `x` | y |\n[x](http://evil)' }], passed: [] };
    const rows = summary({ ...result, notLookedAt: [] }, { repo: null, at: 'x' }).split('\n').filter((line) => line.startsWith('|'));
    assert.equal(rows.length, 3);
    assert.ok(!rows[2].includes('](http'));
  });
});

describe('the command line', () => {
  const ok = (argv) => parseArgs(argv);

  test('the options, each once', () => {
    assert.deepEqual(ok([]), { root: '.', repo: null, local: false, now: null, json: false });
    assert.deepEqual(ok(['--repo', 'o/r', '--root', '/x', '--now', '2026-11-18T12:00:00Z', '--json']), { root: '/x', repo: 'o/r', local: false, now: '2026-11-18T12:00:00Z', json: true });
    assert.equal(ok(['--local']).local, true);
    assert.equal(ok(['--repo', 'o/r', '--repo', 'o/r']), null);
    assert.equal(ok(['--local', '--local']), null);
    assert.equal(ok(['--json', '--json']), null);
  });

  test('what is not an option, a value that is missing, and a value that is not one', () => {
    for (const argv of [['--nope'], ['x'], ['--repo'], ['--repo', 'nope'], ['--repo', '../x'], ['--repo', 'a/..'], ['--root'], ['--root', ''], ['--root', '--local'], ['--now'], ['--now', 'yesterday'], ['--now', '2026-11-18T12:00:00+00:00'], ['--local', 'x'], ['--dry-run'], ['--token', 'x']]) {
      assert.equal(ok(argv), null, argv.join(' '));
    }
  });
});
