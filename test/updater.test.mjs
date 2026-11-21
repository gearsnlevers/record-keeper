// The core of the updater (docs/updater.md): the fixtures of test/fixtures/update, the parts of the plan one by one, and the text that goes into a pull request.
// Nothing here reads or writes outside the folders the tests make, and nothing reaches the network. What a run does with the answers is in updater-run.test.mjs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AGENTS_PATH, BLOCK_WHY, BRANCH, CLAUDE_PATH, CODES, KINDS, LIMITS, PIN_PATH, SKILL_PATH, Failed, Refused, checkManifest, checkNode, compareTags, fenceNotes, inspect, isKitPath, mayFollow, mayInstall, parseArgs, parseManifest, parsePin, parseRange, parseTag,
  plan, planUpdate, printable, pushBranch, redact, renderBody, renderMessage, renderPin, renderTitle, satisfies, selectRelease, usableReleases,
} from '../updater.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { plans, pins, tags, ranges } = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/update/cases.json'), 'utf8'));
const page = fs.readFileSync(path.join(root, 'docs/updater.md'), 'utf8');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'record-keeper-updater-core-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const bytesOf = (value) => (value !== null && typeof value === 'object' ? Buffer.from(value.hex, 'hex') : value);
/** The input of a case as the core takes it: the manifests as bytes or text, the file AGENTS.md as bytes, and the text of a block as bytes. */
const prepared = (input) => ({
  ...input,
  manifest: bytesOf(input.manifest),
  previous: bytesOf(input.previous),
  tree: Object.fromEntries(Object.entries(input.tree ?? {}).map(([name, state]) => [name, state.hex === undefined ? state : { ...state, bytes: Buffer.from(state.hex, 'hex') }])),
  blocks: Object.fromEntries(Object.entries(input.blocks ?? {}).map(([source, text]) => [source, Buffer.from(typeof text === 'string' ? text : text.hex, typeof text === 'string' ? 'utf8' : 'hex')])),
});
/** The refusal that a function throws, as { code, detail }; null when it does not throw. */
const refusal = (fn) => {
  try {
    fn();
    return null;
  } catch (error) {
    assert.ok(error instanceof Refused, `not a Refused: ${error.stack}`);
    return { code: error.code, detail: error.detail };
  }
};

// The codes that only the runner meets: what it reads from the working tree and from GitHub is not an input of the core.
const RUNNER_ONLY = ['pin-text', 'manifest-large', 'manifest-missing', 'tag-target'];

describe('the fixtures of the plan', () => {
  for (const c of plans) {
    test(`${c.id}: ${c.expect.status}${c.expect.code ? ` ${c.expect.code}` : ''}`, () => {
      assert.deepEqual(plan(prepared(c.input)), c.expect, c.note);
    });
  }

  test('the plan does not change what it is given', () => {
    for (const c of plans.slice(0, 40)) {
      const copy = structuredClone(c.input);
      plan(prepared(c.input));
      assert.deepEqual(c.input, copy, c.id);
    }
  });

  test('the ids of the cases are unique, and each says what it shows', () => {
    const ids = [...plans, ...pins, ...tags, ...ranges].map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const c of [...plans, ...pins]) assert.ok(c.note.length > 0, c.id);
  });

  test('every refusal that the core can make is shown by a case, and the page lists every refusal', () => {
    const shown = new Set([...plans.filter((c) => c.expect.status === 'refused').map((c) => c.expect.code), ...pins.filter((c) => c.expect.refused).map((c) => c.expect.refused.code),
      ...plans.flatMap((c) => (c.expect.warnings ?? []).map((w) => `${w.code}:${w.detail}`))]);
    assert.deepEqual(CODES.filter((code) => !RUNNER_ONLY.includes(code) && !shown.has(code)), []);
    for (const code of CODES) assert.ok(page.includes(`\`${code}\``), `the page does not list ${code}`);
    const named = [...page.matchAll(/`((?:pin|manifest|release|source|older|node|download|size|digest|path|tag)-[a-z-]+)`/g)].map((m) => m[1]);
    assert.deepEqual(named.filter((code) => !CODES.includes(code)), []);
  });

  test('every part of the plan is shown by a case, with a list that has something in it and one that has not', () => {
    const answers = plans.filter((c) => c.expect.status === 'update' || c.expect.status === 'unchanged').map((c) => c.expect);
    for (const key of ['added', 'changed', 'unchanged', 'templates', 'kept', 'remove', 'overwritten', 'warnings']) {
      assert.ok(answers.some((a) => a[key].length > 0), `${key} is never full`);
      assert.ok(answers.some((a) => a[key].length === 0), `${key} is never empty`);
    }
    assert.ok(answers.some((a) => a.block === null));
    assert.deepEqual([...new Set(answers.filter((a) => a.block !== null).map((a) => a.block.action))].sort(), ['append', 'create', 'current', 'refused', 'replace']);
    assert.deepEqual([...new Set(answers.filter((a) => a.block?.action === 'refused').map((a) => a.block.why))].sort(), Object.keys(BLOCK_WHY).sort());
    assert.deepEqual([...new Set(plans.map((c) => c.expect.status))].sort(), ['current', 'refused', 'unchanged', 'update']);
    assert.ok(answers.some((a) => a.from === null) && answers.some((a) => a.from !== null && a.from === a.to) && answers.some((a) => a.from !== a.to && a.from !== null));
    assert.ok(answers.some((a) => a.pinChanged) && answers.some((a) => !a.pinChanged));
    assert.deepEqual([...new Set(answers.flatMap((a) => a.warnings.map((w) => w.code)))].sort(), ['block-refused', 'previous-missing', 'previous-unusable']);
    assert.deepEqual([...new Set(answers.map((a) => a.channel))].sort(), ['prerelease', 'stable']);
  });

  test('a list of the plan is in the order of the bytes of its paths', () => {
    for (const a of plans.map((c) => c.expect).filter((e) => e.status === 'update' || e.status === 'unchanged')) {
      for (const key of ['added', 'changed', 'unchanged', 'templates', 'kept', 'remove', 'overwritten']) assert.deepEqual(a[key], [...a[key]].sort((x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y))), key);
    }
  });
});

describe('the pin', () => {
  for (const c of pins) {
    test(`${c.id}: ${c.note}`, () => {
      if (c.expect.pin) assert.deepEqual(parsePin(c.text), c.expect.pin);
      else assert.deepEqual(refusal(() => parsePin(c.text)), c.expect.refused);
    });
  }

  test('renderPin writes what parsePin reads, and what the page shows', () => {
    const pin = { source: 'gearsnlevers/record-keeper', version: 'v1.0.0', commit: '5bec31d90a04d7045bb2849799f4934fe52d6351', channel: 'stable' };
    assert.deepEqual(parsePin(renderPin(pin)), pin);
    const shown = /```yaml\n([^`]*)```/.exec(page.slice(page.indexOf('## The pin')))[1];
    assert.equal(renderPin(pin), shown);
    assert.equal(renderPin({ ...pin, channel: 'prerelease' }).split('\n').length, 6);
  });

  test('the first line of a pin is a comment, and the pin has no other comment', () => {
    assert.match(renderPin({ source: 'o/k', version: 'v1.0.0', commit: 'a'.repeat(40), channel: 'stable' }), /^# [^\n]+\nsource: [^\n]+\nversion: [^\n]+\ncommit: [^\n]+\nchannel: [^\n]+\n$/);
  });
});

describe('tags and their order', () => {
  for (const c of tags) {
    test(`${c.id}: ${c.a} and ${c.b}`, () => {
      assert.equal(compareTags(c.a, c.b), c.expect);
      assert.equal(compareTags(c.b, c.a), -c.expect || 0);
    });
  }

  test('what a tag may be: v and a semantic version without build metadata, at most 80 characters', () => {
    for (const good of ['v0.0.0', 'v1.2.3', 'v10.20.30', 'v1.0.0-1', 'v1.0.0-rc.1', 'v1.0.0-a-b', 'v1.0.0-0.0.0', 'v1.0.0-1a', `v1.0.0-${'a'.repeat(73)}`]) assert.notEqual(parseTag(good), null, good);
    for (const bad of ['1.0.0', 'v1', 'v1.0', 'v1.0.0.0', 'v01.0.0', 'v1.00.0', 'v1.0.00', 'v1.0.0+b', 'v1.0.0-', 'v1.0.0-01', 'v1.0.0-a..b', 'v1.0.0-.a', 'v1.0.0-a.', 'v1.0.0-a_b', 'V1.0.0', ' v1.0.0', 'v1.0.0 ', 'v1.0.0\n',
      `v1.0.0-${'a'.repeat(74)}`, '', 'v', null, undefined, 5, ['v1.0.0'], 'v\u0661.0.0']) assert.equal(parseTag(bad), null, String(bad));
  });

  test('sorting a shuffled list gives the order of the page: prereleases first, numbers as numbers, names as bytes', () => {
    const order = ['v0.9.0', 'v1.0.0-1', 'v1.0.0-2', 'v1.0.0-10', 'v1.0.0-alpha', 'v1.0.0-alpha.1', 'v1.0.0-alpha.beta', 'v1.0.0-beta', 'v1.0.0-beta.2', 'v1.0.0-beta.11', 'v1.0.0-rc.1', 'v1.0.0', 'v1.0.1', 'v1.9.0', 'v1.10.0', 'v2.0.0'];
    for (let seed = 1; seed <= 20; seed++) {
      const shuffled = [...order].sort((a, b) => ((a + seed).length * 7919 + a.charCodeAt(3) * seed) % 13 - ((b + seed).length * 7919 + b.charCodeAt(3) * seed) % 13);
      assert.deepEqual(shuffled.sort(compareTags), order);
    }
  });
});

describe('the choice of a release', () => {
  const entry = (tag, over = {}) => ({ tag_name: tag, draft: false, prerelease: tag.includes('-'), ...over });
  const pin = { source: 'o/k', version: 'v1.0.0', commit: 'a'.repeat(40), channel: 'stable' };

  test('the usable entries are the published ones with a tag of the kit, and two with one tag are refused', () => {
    const list = [entry('v1.0.0'), entry('v1.1.0', { draft: true }), null, 5, 'x', entry('nightly'), entry('v1.2.0', { prerelease: 'no' }), { tag_name: 'v1.3.0', prerelease: false }, entry('v1.4.0')];
    assert.deepEqual(usableReleases(list).map((r) => r.tag_name), ['v1.0.0', 'v1.4.0']);
    assert.deepEqual(refusal(() => usableReleases([entry('v1.0.0'), entry('v1.0.0')])), { code: 'release-duplicate', detail: 'v1.0.0' });
    assert.deepEqual(usableReleases([entry('v1.0.0'), entry('v1.0.0', { draft: true })]).length, 1);
  });

  test('the answer is the entry itself, or the newest tag of the channel', () => {
    const list = [entry('v1.0.0'), entry('v1.1.0'), entry('v1.2.0-1')];
    assert.equal(selectRelease({ pin, channel: 'stable', target: null, releases: list }).release, list[1]);
    assert.equal(selectRelease({ pin, channel: 'prerelease', target: null, releases: list }).release, list[2]);
    assert.deepEqual(selectRelease({ pin: { ...pin, version: 'v1.1.0' }, channel: 'stable', target: null, releases: list }), { status: 'current', latest: 'v1.1.0' });
    assert.equal(selectRelease({ pin: null, channel: 'stable', target: null, releases: list }).release, list[1]);
    assert.equal(selectRelease({ pin, channel: 'stable', target: 'v1.2.0-1', releases: list }).release, list[2]);
    assert.equal(selectRelease({ pin, channel: 'stable', target: undefined, releases: list }).release, list[1]);
    assert.equal(selectRelease({ pin, channel: 'stable', target: null, releases: list }).status, 'chosen');
    assert.equal(selectRelease({ pin, channel: 'stable', target: 'v1.1.0', releases: list }).status, 'chosen');
  });
});

describe('the manifest as untrusted data', () => {
  const good = () => JSON.parse(plans.find((c) => c.id === 'p001-update').input.manifest);
  const tag = 'v1.1.0';
  const commit = 'b2'.repeat(20);

  test('the manifest of the fixtures passes, and the check names the first thing wrong', () => {
    assert.equal(checkManifest(good(), { tag, commit }), undefined);
    const damaged = good();
    damaged.files[0].size = -1;
    damaged.tag = 'v9.9.9';
    assert.equal(refusal(() => checkManifest(damaged, { tag, commit })).code, 'manifest-tag');
  });

  test('the text of a manifest: UTF-8 without a byte order mark, one document', () => {
    assert.deepEqual(parseManifest('{"a":1}'), { a: 1 });
    assert.deepEqual(parseManifest(Buffer.from('{"a":"é"}', 'utf8')), { a: 'é' });
    for (const bad of [Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), Buffer.from([0x7b, 0xff, 0x7d]), Buffer.alloc(0), '', '{', '{} {}', 'NaN', 'undefined', Buffer.from('{"a": 1,}')]) {
      assert.equal(refusal(() => parseManifest(bad)).code, 'manifest-json', String(bad));
    }
  });

  test('a path is installed only where the page says, and every path that is installed is a path of the kit', () => {
    for (const ok of ['.github/record-keeper/record-keeper.mjs', '.github/record-keeper/x.mjs', '.github/record-keeper/a-b-c1.mjs', '.github/workflows/records-integrity.yml', '.github/workflows/records-a1-b.yml']) {
      assert.equal(mayInstall('managed', ok), true, ok);
      assert.equal(isKitPath(ok), true, ok);
    }
    for (const template of ['.github/record-keeper/settings.yml', 'docs/decisions/README.md', 'docs/decisions/template.md', 'CLAUDE.md']) {
      assert.equal(mayInstall('template', template), true, template);
      assert.equal(mayInstall('managed', template), false, template);
      assert.equal(isKitPath(template), true, template);
    }
    for (const bad of ['', '/etc/passwd', '../x', '.github/record-keeper/../x.mjs', '.github/record-keeper/sub/x.mjs', '.github/record-keeper/X.mjs', '.github/record-keeper/-x.mjs', '.github/record-keeper/x-.mjs', '.github/record-keeper/x--y.mjs',
      '.github/record-keeper/1x.mjs', '.github/record-keeper/x.mjs ', '.github/record-keeper/x.js', '.github/record-keeper/.mjs', '.github/record-keeper.mjs', '.github/workflows/test.yml', '.github/workflows/records-.yml', '.github/workflows/records-a.yaml',
      '.github/workflows/records-a.yml/b', '.github/workflows/Records-a.yml', '.github/workflows/sub/records-a.yml', '.github/record-keeper.yml', 'docs/decisions/0001-a.md', 'docs/decisions/README.md ', 'docs/decisions/sub/README.md',
      '.github\\record-keeper\\x.mjs', 'x.mjs', '.github/record-keeper/x.mjs\n', '.github/record-keeper/x.mjs\u0000', 5, null, undefined, ['a']]) {
      assert.equal(mayInstall('managed', bad), false, String(bad));
      assert.equal(mayInstall('template', bad), false, String(bad));
    }
    assert.equal(mayInstall('other', '.github/record-keeper/x.mjs'), false);
  });

  test('the files of the agents: the skill is one managed path, the block is only for AGENTS.md, and CLAUDE.md is a template', () => {
    assert.equal(SKILL_PATH, '.claude/skills/record-a-decision/SKILL.md');
    assert.equal(mayInstall('managed', SKILL_PATH), true);
    assert.equal(isKitPath(SKILL_PATH), true);
    assert.equal(mayInstall('template', SKILL_PATH), false);
    assert.equal(mayInstall('block', SKILL_PATH), false);
    assert.equal(mayInstall('block', AGENTS_PATH), true);
    assert.equal(mayInstall('managed', AGENTS_PATH), false, 'a managed AGENTS.md would be replaced whole');
    assert.equal(mayInstall('template', AGENTS_PATH), false);
    assert.equal(mayInstall('template', CLAUDE_PATH), true);
    assert.equal(mayInstall('managed', CLAUDE_PATH), false);
    assert.equal(mayInstall('block', CLAUDE_PATH), false);
    assert.deepEqual(KINDS, ['managed', 'template', 'block']);
    // Exactly one path is added: not a folder of the agents, not another skill, not another file of this skill, not anything else below .claude.
    for (const bad of ['.claude', '.claude/', '.claude/settings.json', '.claude/settings.local.json', '.claude/CLAUDE.md', '.claude/skills', '.claude/skills/record-a-decision', '.claude/skills/record-a-decision/', '.claude/skills/record-a-decision/other.md',
      '.claude/skills/record-a-decision/SKILL.md/x', '.claude/skills/record-a-decision/skill.md', '.claude/skills/Record-a-decision/SKILL.md', '.claude/skills/other/SKILL.md', '.claude/skills/record-a-decision/../x/SKILL.md', '.claude/commands/x.md',
      '.claude/skills/record-a-decision/SKILL.md ', 'claude/skills/record-a-decision/SKILL.md', '.claude/hooks/x.sh', '.github/copilot-instructions.md', '.github/instructions/x.instructions.md', 'AGENTS.md ', 'agents.md', 'docs/AGENTS.md', 'sub/AGENTS.md', 'CLAUDE.md ', 'claude.md', 'CLAUDE.local.md', '.claude/CLAUDE.local.md']) {
      for (const kind of ['managed', 'block', 'template']) assert.equal(mayInstall(kind, bad), false, `${kind} ${bad}`);
    }
  });

  test('a path of the kit: printable ASCII, relative, with no part that is empty, . or .., that starts or ends with a space, ends with a dot or is .git', () => {
    for (const ok of ['a', 'a/b', 'a b/c d', 'templates/workflows/records-audit.yml', '.github/x', 'a.b/c', 'a/.gitignore', 'a/.github/x', '~', 'a/b%c', '..a', 'a..b', '.a']) assert.equal(isKitPath(ok), true, ok);
    for (const bad of ['', '/a', 'a//b', 'a/', './a', 'a/./b', '../a', 'a/..', 'a/../b', 'a\\b', 'a:b', ' a', 'a ', 'a/ b', 'a /b', 'a.', 'a./b', 'a/b.', '.git', 'a/.git/b', '.GIT', '.Git/x', 'café', 'a\tb', 'a\nb', 'a\u0000b', 'a\u007fb', '\u202e', 7, null, undefined, {}]) {
      assert.equal(isKitPath(bad), false, JSON.stringify(bad));
    }
  });

  test('the range of Node.js: comparators of >= and <, a version of one to three numbers, single spaces', () => {
    assert.deepEqual(parseRange('>=22'), [['>=', ['22', '0', '0']]]);
    assert.deepEqual(parseRange('>=22.6 <25.1.2'), [['>=', ['22', '6', '0']], ['<', ['25', '1', '2']]]);
    for (const bad of ['', ' ', '>=', '22', '>22', '<=22', '=22', '^22', '~22', '22.x', '>=22.x', '>=22.', '>=.1', '>=1.2.3.4', '>=01', '>=1.02', '>=22 ', ' >=22', '>=22  <25', '>=22\t<25', '>= 22', '>=22,<25', '>=22||<25', '>=22 - <25',
      '>=v22', '>=-1', '>=1e2', '*', 'x', '>=22 *', null, undefined, 22, ['>=22']]) assert.equal(parseRange(bad), null, JSON.stringify(bad));
    assert.equal(satisfies('22.6.0', parseRange('>=22')), true);
    assert.equal(satisfies('21.99.99', parseRange('>=22')), false);
    assert.equal(satisfies('22.0.0', parseRange('<22')), false);
    assert.equal(satisfies('9.0.0', parseRange('>=10')), false, 'numbers, not text');
    assert.equal(satisfies('100.0.0', parseRange('>=22 <101')), true);
  });

  for (const c of ranges) {
    test(`the range ${JSON.stringify(c.range)} for ${c.node}`, () => {
      const parsed = parseRange(c.range);
      assert.deepEqual(parsed, c.expect.parsed);
      if (parsed !== null) assert.equal(satisfies(c.node, parsed), c.expect.satisfied);
    });
  }

  test('the Node.js that runs the program is asked, and a refusal names the range', () => {
    assert.deepEqual(refusal(() => checkNode({ node: '>=22' }, '21.0.0')), { code: 'node-version', detail: '>=22' });
    assert.equal(checkNode({ node: '>=22' }, '22.0.0'), undefined);
    assert.equal(checkNode({ node: '>=22' }, process.versions.node), undefined, 'the Node.js of this test run is one the kit takes');
  });
});

describe('the plan of an update, part by part', () => {
  const base = plans.find((c) => c.id === 'p001-update').input;
  const run = (over = {}) => plan(prepared({ ...structuredClone(base), ...over }));

  test('planUpdate takes the pin and the choice that plan has made, and plan takes the text of the pin', () => {
    const pin = parsePin(base.pinText);
    const direct = planUpdate({ pin, source: pin.source, channel: pin.channel, tag: 'v1.1.0', tagCommit: base.tagCommit, manifest: Buffer.from(base.manifest), previous: Buffer.from(base.previous), node: base.node, downloaded: base.downloaded, tree: base.tree, pinText: base.pinText });
    assert.deepEqual(direct, run());
  });

  test('without a previous manifest there is no removal, no local change and no template, and a warning', () => {
    const answer = run({ previous: null });
    assert.deepEqual([answer.remove, answer.overwritten, answer.templates, answer.warnings], [[], [], [], [{ code: 'previous-missing', detail: 'v1.0.0' }]]);
    assert.equal(plan(prepared({ ...structuredClone(base), previous: undefined })).warnings[0].code, 'previous-missing', 'a previous manifest that is left out is one that is missing');
  });

  test('a download is looked up by its own name: a source named like a property of Object is no download', () => {
    const answer = run({ downloaded: Object.fromEntries(Object.entries(base.downloaded).filter(([name]) => name !== 'updater.mjs')) });
    assert.equal(answer.status, 'refused');
    assert.deepEqual([answer.code, answer.detail], ['download-missing', 'updater.mjs']);
    const odd = structuredClone(base);
    const manifest = JSON.parse(odd.manifest);
    manifest.files[0].source = '__proto__';
    manifest.files[1].source = 'constructor';
    odd.manifest = JSON.stringify(manifest);
    odd.downloaded = Object.create(null);
    assert.equal(plan(prepared(odd)).code, 'download-missing');
    odd.downloaded.__proto__ = { sha256: manifest.files[0].sha256, size: manifest.files[0].size };
    odd.downloaded.constructor = { sha256: manifest.files[1].sha256, size: manifest.files[1].size };
    Object.assign(odd.downloaded, Object.fromEntries(manifest.files.slice(2).map((f) => [f.source, { sha256: f.sha256, size: f.size }])));
    assert.equal(plan(prepared(odd)).status, 'update');
  });

  test('a tree that has nothing for a path says that nothing is there', () => {
    const answer = run({ tree: Object.create(null) });
    assert.equal(answer.status, 'update');
    assert.deepEqual(answer.added, ['.github/record-keeper/record-keeper.mjs', '.github/record-keeper/updater.mjs', '.github/workflows/records-integrity.yml', '.github/workflows/records-updater.yml']);
  });

  test('the new pin is what renderPin writes of the release', () => {
    const answer = run();
    assert.equal(answer.pin, renderPin({ source: 'gearsnlevers/record-keeper', version: 'v1.1.0', commit: 'b2'.repeat(20), channel: 'stable' }));
    assert.equal(answer.pinChanged, true);
    assert.equal(run({ pinText: answer.pin, target: 'v1.1.0', previous: base.manifest }).pinChanged, false, 'a pin that is what the updater writes is not rewritten');
  });
});

describe('what goes into a pull request', () => {
  const answer = plans.find((c) => c.id === 'p001-update').expect;
  const REQUIRES = answer.requires;

  test('the title says the two tags, or a repair of one', () => {
    assert.equal(renderTitle('v1.0.0', 'v1.1.0'), 'chore: update Record Keeper v1.0.0 to v1.1.0');
    assert.equal(renderTitle('v1.1.0', 'v1.1.0'), 'chore: repair Record Keeper v1.1.0');
    assert.match(renderTitle('v1.0.0-1', 'v2.0.0-rc.1'), /^chore: update Record Keeper v1\.0\.0-1 to v2\.0\.0-rc\.1$/);
    assert.ok(/^[\x20-\x7e]+$/.test(renderTitle('v1.0.0', 'v1.1.0')), 'ASCII');
  });

  test('the message of the commit starts with the title and says the release', () => {
    assert.equal(renderMessage(answer), `chore: update Record Keeper v1.0.0 to v1.1.0\n\nsource: gearsnlevers/record-keeper\nversion: v1.1.0\ncommit: ${'b2'.repeat(20)}\n`);
  });

  test('the body has the sections of the page, in order, and each file once', () => {
    const body = renderBody(answer, 'Fixed a thing.');
    const headings = [...body.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(headings, ['Release notes', 'Changes in this repository', 'What this release requires', 'Approval']);
    assert.match(body, /^Updates Record Keeper from \*\*v1\.0\.0\*\* to \*\*v1\.1\.0\*\* \(`gearsnlevers\/record-keeper`, channel `stable`\)\.\n/);
    for (const [title, list] of [['Added', answer.added], ['Changed', answer.changed], ['Removed', answer.remove], ['Templates installed', answer.templates]]) {
      assert.ok(body.includes(`**${title}** (${list.length})\n\n${list.map((item) => `- \`${item}\``).join('\n')}\n`), title);
    }
    assert.ok(body.includes('Fixed a thing.'));
    assert.ok(body.includes('- the repository secret `RECORD_KEEPER_TOKEN`'));
    assert.ok(body.includes('- the setting `owners` in the settings file'));
    assert.ok(body.includes('- a ruleset on `default` that requires the check `Records integrity` and branches to be up to date'));
    assert.match(body, /needs the approval of the owners/);
    assert.ok(body.endsWith(`\`${BRANCH}\`; merge it or close it.`));
    assert.doesNotMatch(body, /Local changes this update overwrites|## Warnings/, 'sections that have nothing in them are left out');
    for (const item of [...answer.added, ...answer.changed, ...answer.remove, ...answer.templates]) assert.equal(body.split(`\`${item}\``).length, 2, item);
  });

  test('the block of AGENTS.md in the body: what happens to the file, in these words, under a heading of its own, and a refused block as a problem under Warnings', () => {
    const bare = { ...answer, added: [], changed: [], remove: [], templates: [], pinChanged: false, from: 'v1.1.0' };
    const section = (block, extra = {}) => renderBody({ ...bare, block, ...extra }, '').split('## Changes in this repository\n\n')[1].split('\n## ')[0];
    assert.equal(section({ path: 'AGENTS.md', action: 'create', why: null }), '**Block**\n\n- AGENTS.md is created, with the Record Keeper block in it\n');
    assert.equal(section({ path: 'AGENTS.md', action: 'append', why: null }), '**Block**\n\n- the Record Keeper block is added at the end of AGENTS.md, and nothing else in the file changes\n');
    assert.equal(section({ path: 'AGENTS.md', action: 'replace', why: null }), '**Block**\n\n- the Record Keeper block in AGENTS.md is replaced, and nothing outside the two markers changes\n');
    for (const block of [null, { path: 'AGENTS.md', action: 'current', why: null }, { path: 'AGENTS.md', action: 'refused', why: 'doubled' }]) assert.equal(section(block), 'Only the pin changes.\n', JSON.stringify(block));
    const listed = renderBody({ ...bare, block: { path: 'AGENTS.md', action: 'replace', why: null }, overwritten: ['.github/record-keeper/run-audit.mjs', 'AGENTS.md'] }, '');
    assert.ok(listed.includes('- `.github/record-keeper/run-audit.mjs`\n- `AGENTS.md` (the text between the two markers)\n'));
    const refused = renderBody({ ...bare, block: { path: 'AGENTS.md', action: 'refused', why: 'doubled' }, warnings: [{ code: 'block-refused', detail: 'doubled' }] }, '');
    assert.ok(refused.includes('## Warnings\n\n- **Problem: the block in AGENTS.md was not written** (there is more than one begin marker or more than one end marker). The rest of this update is not affected. Until AGENTS.md is repaired by hand and the updater has run again, the agents read the block of the older release, or none (docs/agent-files.md of the kit).\n\n## Approval'));
  });

  test('the reasons that a block is not written, in these words, and a reason for each that the page lists', () => {
    assert.deepEqual(BLOCK_WHY, {
      'partial-line': 'a line holds the text of a marker and more',
      'begin-without-end': 'a begin marker has no end marker',
      'end-without-begin': 'an end marker has no begin marker',
      reversed: 'the end marker comes before the begin marker',
      doubled: 'there is more than one begin marker or more than one end marker',
      'not-text': 'the file holds a zero byte, so it is not text that the updater can add to',
      fence: 'the file ends inside a code fence, where the block would be taken for an example',
      'invalid-block': 'the block of the release is not one begin marker, text and one end marker',
      'not-a-file': 'AGENTS.md is not a regular file',
      'too-large': 'AGENTS.md is larger than the updater reads (1 MiB)',
    });
    const agents = fs.readFileSync(path.join(root, 'docs/agent-files.md'), 'utf8').replaceAll('`', '');
    for (const [why, words] of Object.entries(BLOCK_WHY)) assert.ok(agents.includes(`| ${why} | ${words} |`), why);
  });

  test('the body of a pull request, whole: with every part, and with the fewest', () => {
    const full = [
      'Updates Record Keeper from **v1.0.0** to **v1.1.0** (`gearsnlevers/record-keeper`, channel `stable`).', '',
      '## Release notes', '', '```', 'Fixed a thing.', '```', '',
      '## Changes in this repository', '',
      '**Added** (1)', '', '- `.github/workflows/records-updater.yml`', '',
      '**Changed** (2)', '', '- `.github/record-keeper/record-keeper.mjs`', '- `.github/record-keeper/updater.mjs`', '',
      '**Removed** (1)', '', '- `.github/record-keeper/check-pull-request.mjs`', '',
      '**Templates installed** (1)', '', '- `docs/decisions/template.md`', '',
      `The pin \`.github/record-keeper.yml\` is rewritten: version \`v1.1.0\`, commit \`${'b2'.repeat(20)}\`.`, '',
      '## What this release requires', '', 'The updater cannot see secrets, settings or rulesets. Check that these are in place:', '',
      '- the repository secret `RECORD_KEEPER_TOKEN`', '- the setting `owners` in the settings file', '- a ruleset on `default` that requires the check `Records integrity` and branches to be up to date', '',
      '## Approval', '',
      'This pull request changes the pin, the workflows and the programs that judge every later pull request, so merging it needs the approval of the owners, like any change of those files. Read the diff of every file in it.', '',
      '---', 'This pull request is rebuilt from scratch on every run of the updater. Do not push to `record-keeper/update`; merge it or close it.',
    ];
    assert.equal(renderBody(answer, 'Fixed a thing.'), full.join('\n'));
    const most = renderBody({ ...answer, from: 'v1.1.0', pinChanged: false, added: [], changed: [], remove: [], templates: [], overwritten: ['.github/record-keeper/run-audit.mjs', '.github/workflows/records-audit.yml'],
      warnings: [{ code: 'previous-missing', detail: 'v1.0.0' }, { code: 'previous-unusable', detail: 'manifest-json' }],
      requires: { rulesets: [{ branch: 'default', checks: ['Records integrity', 'Records setup check', 'Test (Node 22)'], 'up-to-date': true }, { branch: 'release', checks: ['A'], 'up-to-date': false }, { branch: 'main', checks: [], 'up-to-date': true }, { branch: 'dev', checks: [], 'up-to-date': false }],
        secrets: ['RECORD_KEEPER_TOKEN', 'OTHER'], settings: ['owners', 'approvals'] } }, '');
    const expected = [
      'Updates Record Keeper again to **v1.1.0** (`gearsnlevers/record-keeper`, channel `stable`).', '',
      '## Release notes', '', '```', '', '```', '',
      '## Changes in this repository', '', 'Only the pin changes.', '',
      '## Local changes this update overwrites', '',
      'These managed files differ from what the pinned release installed, or were not installed by it. Merging replaces or removes them. A change that should stay belongs in the settings file, which an update never touches, or in a release of the kit:', '',
      '- `.github/record-keeper/run-audit.mjs`', '- `.github/workflows/records-audit.yml`', '',
      '## What this release requires', '', 'The updater cannot see secrets, settings or rulesets. Check that these are in place:', '',
      '- the repository secret `RECORD_KEEPER_TOKEN`', '- the repository secret `OTHER`', '- the setting `owners` in the settings file', '- the setting `approvals` in the settings file',
      '- a ruleset on `default` that requires the checks `Records integrity`, `Records setup check` and `Test (Node 22)` and branches to be up to date', '- a ruleset on `release` that requires the check `A`',
      '- a ruleset on `main` that requires branches to be up to date', '- a ruleset on `dev`', '',
      '## Warnings', '',
      '- The pinned release v1.0.0 has no manifest that the updater could read, so the local changes this update overwrites, and the files it removes, are not listed.',
      '- The manifest of the pinned release is not one the updater reads (manifest-json), so the local changes this update overwrites, and the files it removes, are not listed.', '',
      '## Approval', '',
      'This pull request changes the pin, the workflows and the programs that judge every later pull request, so merging it needs the approval of the owners, like any change of those files. Read the diff of every file in it.', '',
      '---', 'This pull request is rebuilt from scratch on every run of the updater. Do not push to `record-keeper/update`; merge it or close it.',
    ];
    assert.equal(most, expected.join('\n'));
  });

  test('the body says what it overwrites, and what it could not compare', () => {
    const body = renderBody({ ...answer, overwritten: ['.github/record-keeper/run-audit.mjs'], warnings: [{ code: 'previous-missing', detail: 'v1.0.0' }, { code: 'previous-unusable', detail: 'manifest-json' }] }, '');
    assert.match(body, /## Local changes this update overwrites\n\n[^\n]+\n\n- `\.github\/record-keeper\/run-audit\.mjs`\n/);
    assert.match(body, /## Warnings\n\n- The pinned release v1\.0\.0 has no manifest/);
    assert.match(body, /\n- The manifest of the pinned release is not one the updater reads \(manifest-json\)/);
  });

  test('a body of an update that changes only the pin, and one that has nothing required, say so', () => {
    const body = renderBody({ ...answer, added: [], changed: [], remove: [], templates: [], requires: { rulesets: [], secrets: [], settings: [] } }, '');
    assert.ok(body.includes('Only the pin changes.'));
    assert.ok(body.includes('The pin `.github/record-keeper.yml` is rewritten: version `v1.1.0`'));
    assert.ok(body.includes('- nothing\n'));
    assert.ok(!renderBody({ ...answer, pinChanged: false }, '').includes('is rewritten'));
    assert.ok(renderBody({ ...answer, from: null }, '').startsWith('Updates Record Keeper to **v1.1.0**'));
    assert.ok(renderBody({ ...answer, from: 'v1.1.0' }, '').startsWith('Updates Record Keeper again to **v1.1.0**'));
    assert.equal(REQUIRES.secrets.length, 1);
  });

  test('the notes of a release that is hostile make no mention, no link, no tag and nothing that closes the fence', () => {
    const hostile = [
      'Thanks @alice and @org/team! cc @bob', '```\n</details>\n![x](http://evil.example/p.png)\n[click](javascript:alert(1))\n```\n@carol', '````\n```\n`````\n@x', 'x\u202e\u2066y\u200bz\ufeff', 'a\u0000b\u0007c\u007fd\u0085e\u2028f\u2029g',
      '\r\nline\rline\r\n', '#123 and owner/repo#456 and fixes #7', '<script>alert(1)</script> <!-- c --> &commat; &#64;', 'x'.repeat(10000), '@'.repeat(20), '`'.repeat(40), '', null, undefined,
      '~~~\n@a\n~~~', 'a\n'.repeat(5000), '\u{1F600}'.repeat(7000),
    ];
    for (const notes of hostile) {
      const body = renderBody(answer, notes);
      assert.ok(!body.includes('@'), 'no mention');
      assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\r]/.test(body), 'no control or direction character');
      const fenced = fenceNotes(notes);
      const lines = fenced.split('\n');
      const fence = lines[0];
      assert.match(fence, /^`{3,}$/);
      assert.equal(lines.at(-1), fence);
      assert.equal(lines.slice(1, -1).filter((line) => line.startsWith(fence)).length, 0, 'nothing inside can close the fence');
      assert.ok(Array.from(fenced).length <= LIMITS.notes + 200, 'bounded');
      assert.ok(body.length < 20000);
    }
  });

  test('the fence is longer than any run of backticks in the notes, and the text is cut at the limit with a note', () => {
    assert.equal(fenceNotes('a ``` b').split('\n')[0], '````');
    assert.equal(fenceNotes('a `` b').split('\n')[0], '```');
    assert.equal(fenceNotes('a ````` b `` c').split('\n')[0], '``````');
    assert.equal(fenceNotes('plain'), '```\nplain\n```');
    assert.equal(fenceNotes('plain\n\n\n'), '```\nplain\n```');
    assert.equal(fenceNotes('a @b c'), '```\na (at)b c\n```');
    assert.equal(fenceNotes('a\r\nb\rc'), '```\na\nb\nc\n```');
    assert.equal(fenceNotes('a\tb'), '```\na\tb\n```');
    assert.equal(fenceNotes('a\u0007b\u202ec'), '```\na?b?c\n```');
    assert.equal(fenceNotes('x'.repeat(LIMITS.notes)), `\`\`\`\n${'x'.repeat(LIMITS.notes)}\n\`\`\``);
    assert.equal(fenceNotes('x'.repeat(LIMITS.notes + 1)), `\`\`\`\n${'x'.repeat(LIMITS.notes)}\n[cut after ${LIMITS.notes} characters: the whole text is on the page of the release]\n\`\`\``);
    assert.equal(fenceNotes('\u{1F600}'.repeat(6001), 6000).split('\n')[1], '\u{1F600}'.repeat(6000), 'cut by characters, not by halves of a pair');
    assert.equal(fenceNotes(null), '```\n\n```');
    assert.equal(fenceNotes('abcdef', 3), '```\nabc\n[cut after 3 characters: the whole text is on the page of the release]\n```');
  });
});

describe('the text that is printed', () => {
  test('printable writes what can hide a line or the end of a name as \\u{hex}', () => {
    assert.equal(printable('plain text, 123'), 'plain text, 123');
    assert.equal(printable('a\nb\rc\td'), 'a\\u{a}b\\u{d}c\\u{9}d');
    assert.equal(printable('a\u202eb\u200bc\ufeffd\u2028e\u00adf\u0085g\u007fh\u0000i'), 'a\\u{202e}b\\u{200b}c\\u{feff}d\\u{2028}e\\u{ad}f\\u{85}g\\u{7f}h\\u{0}i');
    assert.equal(printable('café \u{1F600}'), 'café \u{1F600}');
    assert.equal(printable(null), 'null');
    assert.equal(printable(['a']), 'a');
  });

  test('a refusal says its reason in one line with nothing in it that hides, whatever the detail is', () => {
    for (const code of CODES) {
      for (const detail of [null, 'a\nb', '\u202e\u2066', 5, 'x'.repeat(5)]) {
        const { message } = new Refused(code, detail);
        assert.equal(message.includes('\n'), false, code);
        assert.equal(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(message), false, code);
        assert.ok(message.length > 10, code);
      }
    }
    assert.equal(new Refused('manifest-path', '../x').message, 'the manifest installs a path that the updater does not install: ../x');
    assert.equal(new Refused('pin-line', 3).message, 'the pin has a line that is no comment, no blank line and no "key: value" (line 3)');
  });

  test('the characters that hide are these ranges, at both ends of each and not beside them, for what is printed and for the notes', () => {
    const hidden = [[0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x61c, 0x61c], [0x180e, 0x180e], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff], [0xfff9, 0xfffb], [0xfffe, 0xffff]];
    const isHidden = (code) => hidden.some(([from, to]) => code >= from && code <= to);
    const edges = new Set(hidden.flatMap(([from, to]) => [from - 1, from, to, to + 1]).filter((code) => code >= 0 && code <= 0x10000 && !(code >= 0xd800 && code <= 0xdfff)));
    for (const code of edges) {
      const character = String.fromCodePoint(code);
      assert.equal(printable(character), isHidden(code) ? `\\u{${code.toString(16)}}` : character, `printable ${code.toString(16)}`);
      const notes = fenceNotes(`a${character}b`).split('\n')[1];
      assert.equal(notes, isHidden(code) ? 'a?b' : `a${character}b`, `notes ${code.toString(16)}`);
    }
  });

  test('every refusal says its reason in these words, with the detail where the page says it is', () => {
    const words = [
    ['pin-text', "the pin is not a regular file of text in UTF-8"],
    ['pin-line', "the pin has a line that is no comment, no blank line and no \"key: value\" (line D)"],
    ['pin-key', "the pin has a key that is not one of source, version, commit and channel: D"],
    ['pin-duplicate', "the pin names D twice"],
    ['pin-missing', "the pin has no D"],
    ['pin-value', "the pin has a D that is not what it may be"],
    ['source-missing', "there is no pin and no --source: the first adoption names the source repository"],
    ['source-mismatch', "the pin names another source repository than --source (D)"],
    ['release-none', "there is no usable release of D"],
    ['release-duplicate', "two releases name the tag D"],
    ['release-missing', "there is no release D"],
    ['older-than-pin', "D is older than the pinned release: an update never goes back (revert the update pull request instead)"],
    ['release-moved', "the release D was made from another commit than the pin recorded"],
    ['tag-target', "the tag D does not point at a commit"],
    ['manifest-missing', "the release D has no release-manifest.json"],
    ['manifest-json', "the manifest is not one JSON document in UTF-8 without a byte order mark"],
    ['manifest-large', "the manifest is larger than the updater takes"],
    ['manifest-shape', "the manifest is not an object"],
    ['manifest-schema', "the manifest is not of schema 1"],
    ['manifest-keys', "the manifest has a key that it may not have, or lacks one: D"],
    ['manifest-tag', "the manifest is not the manifest of this release: its tag differs"],
    ['manifest-version', "the version of the manifest is not the version of its tag"],
    ['manifest-commit', "the commit of the manifest is not a full commit id"],
    ['manifest-commit-moved', "the commit of the manifest is not the commit that the tag points at"],
    ['manifest-generations', "the generations of the manifest are not a list of generations"],
    ['manifest-node', "the range of Node.js versions of the manifest is one that the updater cannot read: D"],
    ['manifest-requires', "the requirements of the manifest are not what the updater reads"],
    ['manifest-files', "the list of files of the manifest is empty, too long or not a list"],
    ['manifest-entry', "entry D of the manifest is not an object with the five keys of a file"],
    ['manifest-kind', "entry D of the manifest has a kind that is not managed, template or block"],
    ['manifest-path', "the manifest installs a path that the updater does not install: D"],
    ['manifest-source', "the manifest names a source that is not a path: D"],
    ['manifest-digest', "entry D of the manifest has a digest that is not 64 hexadecimal digits"],
    ['manifest-size', "entry D of the manifest has a size that is not a number of bytes within the limit"],
    ['manifest-duplicate', "the manifest installs one path twice: D"],
    ['manifest-too-large', "the files of the manifest are together larger than the updater takes"],
    ['node-version', "this Node.js does not satisfy the range that the release names: D"],
    ['download-missing', "the file D of the release was not downloaded"],
    ['size-mismatch', "size mismatch: D"],
    ['digest-mismatch', "digest mismatch: D"],
    ['path-blocked', "something other than a file is in the way of D"],
    ];
    assert.deepEqual(words.map(([code]) => code), CODES, 'the same codes, in the same order');
    for (const [code, message] of words) assert.equal(new Refused(code, 'D').message, message, code);
  });

  test('redact takes every secret out, every time, and nothing else', () => {
    assert.equal(redact('a TOKEN b TOKEN', ['TOKEN']), 'a *** b ***');
    assert.equal(redact('a TOKEN b', [undefined, '', 'TOKEN']), 'a *** b');
    assert.equal(redact('nothing', ['TOKEN']), 'nothing');
    assert.equal(redact('A.B', ['A.B']), '***');
    assert.equal(redact('AxB', ['A.B']), 'AxB', 'a text and not a pattern');
    assert.equal(redact('abc', []), 'abc');
  });
});

describe('the command line', () => {
  const fresh = { dryRun: false, local: false, target: null, source: null, channel: null };

  test('the options of the page', () => {
    assert.deepEqual(parseArgs([]), fresh);
    assert.deepEqual(parseArgs(['--dry-run']), { ...fresh, dryRun: true });
    assert.deepEqual(parseArgs(['--local', '--source', 'o/k', '--target', 'v1.0.0', '--channel', 'prerelease']), { ...fresh, local: true, source: 'o/k', target: 'v1.0.0', channel: 'prerelease' });
    assert.deepEqual(parseArgs(['--target', 'v1.2.3-rc.1', '--dry-run', '--local']), { ...fresh, dryRun: true, local: true, target: 'v1.2.3-rc.1' });
    assert.deepEqual(parseArgs(['--channel', 'stable']), { ...fresh, channel: 'stable' });
  });

  test('anything else is wrong usage: a missing value, a value that is not one, an option twice, an option that is not one, a word that is not an option', () => {
    for (const bad of [['--target'], ['--target', '1.0.0'], ['--target', 'v1.0'], ['--target', '--dry-run'], ['--source'], ['--source', 'o'], ['--source', 'a/b/c'], ['--source', 'o/k '], ['--source', '/k'], ['--channel', 'next'], ['--channel', ''],
      ['--channel'], ['--dry-run', '--dry-run'], ['--local', '--local'], ['--target', 'v1.0.0', '--target', 'v1.0.1'], ['--source', 'a/b', '--source', 'a/b'], ['--help'], ['-n'], ['x'], ['--local', 'x'], ['--dry-run=1'], ['--target=v1.0.0'],
      ['--dryrun'], ['--DRY-RUN'], ['--target', 'v1.0.0', 'x'], [''], ['--source', 'a/b\n'], ['--source', '../x']]) {
      assert.equal(parseArgs(bad), null, JSON.stringify(bad));
    }
  });
});

describe('the places a download may be sent on to', () => {
  const GITHUB = 'https://api.github.com';
  const from = `${GITHUB}/repos/o/k/releases/assets/5`;

  test('the API itself, and for GitHub the hosts that hold its assets, and nothing else', () => {
    for (const ok of [`${GITHUB}/other`, 'https://objects.githubusercontent.com/x?y=1', 'https://release-assets.githubusercontent.com/github-production-release-asset/1', 'https://githubusercontent.com/x', '/repos/o/k/releases/assets/6']) {
      assert.equal(mayFollow(GITHUB, ok, from), true, ok);
    }
    for (const bad of ['https://user@objects.githubusercontent.com/x', 'https://:pw@objects.githubusercontent.com/x', 'https://user@api.github.com/x', 'https://:pw@api.github.com/x', 'http://objects.githubusercontent.com/x', 'https://evil.example/x', 'https://githubusercontent.com.evil.example/x', 'https://evilgithubusercontent.com/x', 'https://objects.githubusercontent.com.evil.example/x',
      'https://user:pw@objects.githubusercontent.com/x', 'https://github.com/x', 'http://api.github.com/x', 'https://api.github.com:8443/x', '//evil.example/x', 'ftp://objects.githubusercontent.com/x', 'https://objects.githubusercontent.com@evil.example/x']) {
      assert.equal(mayFollow(GITHUB, bad, from), false, bad);
    }
    assert.equal(mayFollow(GITHUB, 'http://[::', from), false);
  });

  test('another API (a local server, an enterprise server) is followed to itself only', () => {
    const base = 'http://127.0.0.1:5555';
    assert.equal(mayFollow(base, `${base}/download/5`, `${base}/x`), true);
    assert.equal(mayFollow(base, 'http://127.0.0.1:5556/x', `${base}/x`), false);
    assert.equal(mayFollow(base, 'https://objects.githubusercontent.com/x', `${base}/x`), false);
    assert.equal(mayFollow('https://ghe.example/api/v3', 'https://objects.githubusercontent.com/x', 'https://ghe.example/api/v3/x'), false);
  });
});

describe('the working tree', () => {
  const dir = () => fs.mkdtempSync(path.join(scratch, 'tree-'));
  const write = (base, relative, content = 'x') => {
    fs.mkdirSync(path.dirname(path.join(base, relative)), { recursive: true });
    fs.writeFileSync(path.join(base, relative), content);
  };

  test('a path is absent, a file with its digest, a folder, a link, or blocked by what is on the way', () => {
    const base = dir();
    write(base, 'a/file.txt', 'hello');
    fs.mkdirSync(path.join(base, 'a/folder'));
    fs.symlinkSync('file.txt', path.join(base, 'a/link'));
    fs.symlinkSync('a', path.join(base, 'linked'));
    assert.deepEqual(inspect(base, 'a/file.txt'), { kind: 'file', sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824' });
    assert.deepEqual(inspect(base, 'a/missing'), { kind: 'absent' });
    assert.deepEqual(inspect(base, 'missing/deeper/file'), { kind: 'absent' });
    assert.deepEqual(inspect(base, 'a/folder'), { kind: 'dir' });
    assert.deepEqual(inspect(base, 'a/link'), { kind: 'link' });
    assert.deepEqual(inspect(base, 'linked'), { kind: 'link' });
    assert.deepEqual(inspect(base, 'linked/file.txt'), { kind: 'blocked' }, 'a link on the way is never followed');
    assert.deepEqual(inspect(base, 'a/file.txt/under'), { kind: 'blocked' }, 'a file on the way');
    const fifo = spawnSync('mkfifo', [path.join(base, 'pipe')]);
    if (fifo.status === 0) assert.deepEqual(inspect(base, 'pipe'), { kind: 'other' }, 'something that is no file, no folder and no link');
    fs.symlinkSync('nowhere', path.join(base, 'dangling'));
    assert.deepEqual(inspect(base, 'dangling'), { kind: 'link' });
    assert.deepEqual(inspect(base, 'dangling/x'), { kind: 'blocked' });
  });

  test('a file larger than 64 MiB is a file that cannot be said to be anything: it has no digest', () => {
    const base = dir();
    const limit = 64 * 1024 * 1024;
    for (const [name, size, digest] of [['big', limit + 1, null], ['exact', limit, '3b6a07d0d404fab4e23b6d34bc6696a6a312dd92821332385e5af7c01c421351']]) {
      fs.writeFileSync(path.join(base, name), '');
      fs.truncateSync(path.join(base, name), size);
      assert.deepEqual(inspect(base, name), { kind: 'file', sha256: digest }, name);
    }
  });

  test('a file is read as it is: bytes that are not text, an empty file, carriage returns', () => {
    const base = dir();
    write(base, 'empty', '');
    write(base, 'crlf', 'a\r\nb\r\n');
    fs.writeFileSync(path.join(base, 'binary'), Buffer.from([0, 255, 128]));
    assert.equal(inspect(base, 'empty').sha256, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(inspect(base, 'crlf').sha256, '58055bdcc73787eb88c78d36f0b4939e9c5dc1c3ad17e25cc85a6833cf1a0cab');
    assert.notEqual(inspect(base, 'crlf').sha256, inspect(base, 'binary').sha256);
    assert.equal(inspect(base, 'binary').kind, 'file');
  });

  test('the pin is read from where the page says', () => {
    assert.equal(PIN_PATH, '.github/record-keeper.yml');
    assert.ok(page.includes('`.github/record-keeper.yml`'));
  });
});

describe('what the program may push', () => {
  test('the update branch and no other: the name is checked before git is asked, and what is pushed is a commit id', () => {
    const context = { root: scratch, gitEnv: {} };
    for (const name of ['main', 'master', 'record-keeper/log', 'record-keeper/update2', 'record-keeper/updat', 'Record-Keeper/update', 'refs/heads/record-keeper/update', 'HEAD', '', 'record-keeper/update ', 'record-keeper/update\n', undefined, null]) {
      assert.throws(() => pushBranch(context, name, 'a'.repeat(40)), (error) => error instanceof Failed && /pushes record-keeper\/update and no other branch/.test(error.message), String(name));
    }
    for (const commit of ['HEAD', 'main', 'a'.repeat(39), 'A'.repeat(40), '--delete', '', 'a'.repeat(40) + ':refs/heads/main', 'a'.repeat(65)]) {
      assert.throws(() => pushBranch(context, BRANCH, commit), (error) => error instanceof Failed && /pushes a commit id/.test(error.message), commit);
    }
    assert.equal(BRANCH, 'record-keeper/update');
  });
});

describe('what the page says in numbers', () => {
  test('the limits of the program are the limits of the page', () => {
    assert.deepEqual(LIMITS, { files: 100, file: 4 * 1024 * 1024, total: 16 * 1024 * 1024, manifest: 1024 * 1024, pin: 64 * 1024, page: 8 * 1024 * 1024, pages: 50, notes: 6000, tag: 80, agents: 1024 * 1024 });
    for (const sentence of ['1 to 100 entries', 'larger than 1 MiB', 'from 0 to 4 MiB', 'more than 16 MiB', 'at most 50 pages of 30', 'cut after 6,000 characters', 'at most 80 characters', 'larger than 64 KiB', 'is `.git` in any case', 'at most twice more', 'larger than 1 MiB', 'of more than 1 MiB is not read']) {
      assert.ok(page.includes(sentence), sentence);
    }
  });

  test('the program never imports another file of the kit, so that it runs when it is the only file there', () => {
    const text = fs.readFileSync(path.join(root, 'updater.mjs'), 'utf8');
    const imports = [...text.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    assert.deepEqual(imports.filter((name) => !name.startsWith('node:')), []);
    assert.ok(imports.length >= 5);
  });
});
