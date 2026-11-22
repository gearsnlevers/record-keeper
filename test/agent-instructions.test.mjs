// The files that a release installs for the agents (docs/agent-files.md): the skill, the block of AGENTS.md and CLAUDE.md. A text that an agent obeys and that names a command,
// a path or a page that is gone is worse than none, so the tests read the files as files: the shape of a skill, the size of both texts, that nothing sensitive is in them, and
// that every command, path and link they name exists. They do not judge whether the advice is right: that is for the owners who read the diff of a release.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AGENTS_PATH, BLOCK_BEGIN, BLOCK_END, SKILL_PATH, blockOf, readBlock } from '../updater.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const install = JSON.parse(read('install.json'));
const sourceOf = (destination) => install.files.find((file) => file.path === destination).source;

const SKILL = read(sourceOf(SKILL_PATH));
const BLOCK = read(sourceOf(AGENTS_PATH));
const PAGES = 'https://github.com/gearsnlevers/record-keeper/blob/main/';

// Where a path that a text names stands in the kit: the files of a repository that installs the kit come from `templates/` and from the programs at the root.
const IN_THE_KIT = new Map([
  ['.github/record-keeper/settings.yml', 'templates/settings.yml'],
  ['.github/record-keeper/record-keeper.mjs', 'record-keeper.mjs'],
  ['docs/decisions', 'templates/decisions'],
  ['docs/decisions/README.md', 'templates/decisions/README.md'],
  ['docs/decisions/template.md', 'templates/decisions/template.md'],
  [SKILL_PATH, sourceOf(SKILL_PATH)],
]);
const SENSITIVE = [
  [/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i, 'an e-mail address'],
  [/\b(ghp_|github_pat_|ghs_)\w+/, 'a GitHub token'],
  [/PRIVATE KEY/, 'a private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'a cloud key'],
  [/https?:\/\/[^\s)]*(?:token|secret|password)=/i, 'a credential in an address'],
];
const NO_DEPLOYMENT = new RegExp([['concier', 'ge'], ['fro', 'do'], ['rock', 'carver'], ['ping', 'identity'], ['vscheu', 'ber']].map((parts) => parts.join('')).join('|'), 'i');

/** The front matter of a skill, in the small subset that skills use (single-line `key: value`), and the body. */
function parseSkill(text) {
  const found = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.notEqual(found, null, 'no front matter');
  const data = {};
  for (const line of found[1].split('\n')) {
    const pair = /^([a-z-]+):\s*(.*)$/.exec(line);
    assert.notEqual(pair, null, `cannot read the front matter line: ${line}`);
    data[pair[1]] = pair[2];
  }
  return { data, body: found[2] };
}

/** The anchors of a page of the kit, as GitHub makes them from its headings. */
function anchors(file) {
  return new Set([...read(file).matchAll(/^#{1,6} (.+)$/gm)].map((m) => m[1].toLowerCase().replace(/[`*_]/g, '').replace(/[^a-z0-9 -]/g, '').trim().replace(/ /g, '-')));
}

/** Everything outside fenced code blocks, so that an example with made-up names is not read as a name. */
const outsideFences = (text) => text.replace(/^```[\s\S]*?^```/gm, '');

const help = spawnSync(process.execPath, [path.join(root, 'record-keeper.mjs'), '--help'], { encoding: 'utf8' });
const commands = new Set([...(help.stdout + help.stderr).matchAll(/^\s+record-keeper\.mjs ([a-z-]+)\b/gm)].map((m) => m[1]));
test('the commands of the program are read from its help', () => assert.ok(['seal', 'validate', 'check-pr', 'audit'].every((command) => commands.has(command)) && !commands.has('resolve')));

describe('the block of AGENTS.md', () => {
  test('is one begin marker, text and one end marker, with no line feed after the end marker, in ASCII with line feeds only', () => {
    assert.deepEqual(readBlock(Buffer.from(BLOCK)), { state: 'one', start: 0, end: BLOCK.length });
    assert.ok(BLOCK.startsWith(`${BLOCK_BEGIN}\n`) && BLOCK.endsWith(`\n${BLOCK_END}`));
    assert.equal(blockOf(Buffer.from(BLOCK)).length, Buffer.byteLength(BLOCK));
    assert.match(BLOCK, /^[\n\x20-\x7e]+$/, 'ASCII, line feeds and no tab: it is added to a file of any encoding that has the ASCII letters');
    assert.doesNotMatch(BLOCK, /\n\n\n|[ \t]\n/, 'no run of blank lines and no trailing white space');
  });

  test('is about fifteen to twenty-five lines of plain text', () => {
    const lines = BLOCK.split('\n').length;
    assert.ok(lines >= 12 && lines <= 25, `${lines} lines`);
  });

  test('says what the page says it says', () => {
    for (const phrase of ['`folder`', '.github/record-keeper/settings.yml', 'Never edit one', 'supersedes', 'erratum', 'deviations', 'owners approve', 'stop and say so', 'record-a-decision', 'proposed', 'Never accept or seal',
      'never reused', 'record-keeper.mjs validate', 'Keep secrets']) assert.ok(BLOCK.includes(phrase), phrase);
  });

  test('names a command that exists, a path that exists and no deployment, secret or address', () => {
    for (const [, command] of BLOCK.matchAll(/node [^\s`]*record-keeper\.mjs ([a-z-]+)/g)) assert.ok(commands.has(command), `${command} is not a command in --help`);
    assert.doesNotMatch(BLOCK, /record-keeper\.mjs resolve/, 'there is no resolve command yet');
    for (const [, file] of BLOCK.matchAll(/`([^`\n]+)`/g)) if (IN_THE_KIT.has(file) || file.startsWith('.claude/') || file.startsWith('.github/')) assert.ok(fs.existsSync(path.join(root, IN_THE_KIT.get(file) ?? file)), file);
    assert.deepEqual(SENSITIVE.filter(([pattern]) => pattern.test(BLOCK)).map(([, what]) => what), []);
    assert.doesNotMatch(BLOCK, NO_DEPLOYMENT);
  });
});

describe('the skill', () => {
  const { data, body } = parseSkill(SKILL);
  const folder = path.posix.basename(path.posix.dirname(SKILL_PATH));

  test('has a front matter with a name that is the name of its folder and a description, and no other key', () => {
    assert.deepEqual(Object.keys(data).sort(), ['description', 'name']);
    assert.equal(data.name, folder);
    assert.match(data.name, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    assert.ok(data.name.length <= 64);
    assert.equal(data['allowed-tools'], undefined, 'a skill never pre-approves a command');
  });

  test('has a description of fewer than 1,000 characters that is a valid plain YAML scalar', () => {
    const { description } = data;
    assert.ok(description.trim() !== '' && description.length < 1000, String(description.length));
    assert.doesNotMatch(description, /: | #/, '": " and " #" end a plain scalar early');
    assert.doesNotMatch(description, /^["'>|&*!%@`[\]{}]|\s$/, 'a leading indicator changes what a scalar means');
  });

  test('has a body of fewer than 500 lines that starts with a heading', () => {
    assert.ok(body.split('\n').length < 500);
    assert.match(body, /^\n# Record a decision\n/);
  });

  test('holds nothing sensitive, no deployment, and no character that is not ASCII', () => {
    assert.deepEqual(SENSITIVE.filter(([pattern]) => pattern.test(SKILL)).map(([, what]) => what), []);
    assert.doesNotMatch(SKILL, NO_DEPLOYMENT);
    assert.match(SKILL, /^[\n\x20-\x7e]+$/);
  });

  test('names only commands that exist, and no command that does not', () => {
    const named = [...SKILL.matchAll(/node [^\s`]*record-keeper\.mjs ([a-z-]+)/g)].map((m) => m[1]);
    assert.ok(named.includes('validate'));
    for (const command of named) assert.ok(commands.has(command), `${command} is not a command in --help`);
    assert.doesNotMatch(SKILL, /record-keeper\.mjs resolve|npm run|npx /);
  });

  test('names only paths that exist in a repository that installs the kit', () => {
    const spans = [...outsideFences(body).matchAll(/`([^`\n]+)`/g)].map((m) => m[1]).filter((span) => !/[\s<>*{}$|]|NNNN/.test(span) && /^(\.github|\.claude|docs)\//.test(span));
    assert.ok(spans.length >= 3);
    for (const span of spans) assert.ok(IN_THE_KIT.has(span), `${span} is not a path that the kit knows how to find`);
    for (const [from, to] of IN_THE_KIT) assert.ok(fs.existsSync(path.join(root, to)), `${from} stands for ${to}, which is missing`);
  });

  test('links only to pages and records of the kit that exist, with anchors that exist, by their full address', () => {
    const links = [...body.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
    assert.ok(links.length >= 4);
    for (const link of links) {
      assert.ok(link.startsWith(PAGES), `${link} is not an address of the kit's pages: a repository that installs the kit has none of them`);
      const [file, anchor] = link.slice(PAGES.length).split('#');
      assert.ok(fs.existsSync(path.join(root, file)) && fs.statSync(path.join(root, file)).isFile(), `${file} is not a file of the kit`);
      if (anchor !== undefined) assert.ok(anchors(file).has(anchor), `${file} has no heading for #${anchor}`);
    }
    assert.doesNotMatch(body, /\]\((?!https:)/, 'no relative link: it would point into the repository that has the skill');
  });

  test('says what the page says it says: the folder of the settings, the template, the validator, proposed only, supersession, an erratum, a deviation, the screen and when to stop', () => {
    for (const phrase of ['`folder` in `.github/record-keeper/settings.yml`', 'template.md', 'record-keeper.mjs validate', 'The status is `proposed`', 'You never write `accepted`', 'never write a `seal:`', 'supersedes:', 'superseded by NNNN',
      'no bare `deprecated`', 'erratum', '48 hours', 'Known deviations', 'never edited', 'No secrets', 'stop and ask', 'never reused', 'Stop and ask when']) assert.ok(SKILL.includes(phrase), phrase);
  });
});

describe('CLAUDE.md', () => {
  test('is the one line that makes Claude Code read AGENTS.md', () => {
    assert.equal(read('templates/CLAUDE.md'), '@AGENTS.md\n');
    assert.deepEqual(install.files.find((file) => file.path === 'CLAUDE.md'), { source: 'templates/CLAUDE.md', path: 'CLAUDE.md', kind: 'template' });
  });
});

describe('the pages of the kit that the files name', () => {
  test('are in the kit, and the page of the files of the agents says what the kit installs', () => {
    const page = read('docs/agent-files.md');
    for (const file of [SKILL_PATH, AGENTS_PATH, 'CLAUDE.md']) assert.ok(page.includes(`\`${file}\``), file);
    assert.ok(page.includes(BLOCK_BEGIN) && page.includes(BLOCK_END));
    assert.ok(page.includes('## Choices in this draft for you to decide'));
  });
});
