// The release manifest of Record Keeper (docs/releases.md): which files a release installs, and the SHA-256 of each, so that a repository can check that
// what it downloaded for a release is what the release holds. It is built from `install.json` (docs/install.md) and `package.json`, and from nothing else.
//
// No dependencies, no network, no clock: the same files give the same bytes. The release workflow builds the manifest for the commit it tags and then
// verifies it; a repository verifies it again with the files it downloaded.
//
//   node tools/build-release-manifest.mjs --version 1.2.0 --tag v1.2.0 --commit <id> --out release-manifest.json [--root <folder>]
//   node tools/build-release-manifest.mjs --verify release-manifest.json [--root <folder>]
//
// Exit status: 0 when the manifest was written or verified, 1 when something is refused or does not verify, 2 for wrong usage.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 1;
export const KINDS = ['managed', 'template'];
/** Where a file of the install set may go in a repository that installs the kit. */
export const DESTINATIONS = ['.github/', 'docs/decisions/'];

const USAGE = `Usage:
  build-release-manifest.mjs --version <semver> --tag <tag> --commit <id> --out <file> [--root <folder>]
  build-release-manifest.mjs --verify <manifest> [--root <folder>]
`;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const GENERATION = /^g[1-9]\d{0,8}$/;

/** Why a manifest cannot be built or does not verify. The message says what to change. */
export class ManifestError extends Error {}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value !== '';
const byBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Why a path of the install set is refused, or null. A path is relative, written with `/`, and made of printable ASCII: no control character, no
 * backslash, no colon (a drive), no empty part, no `.` or `..`, no part that starts or ends with a space or ends with a dot, and no `.git`.
 */
export function pathProblem(value) {
  if (typeof value !== 'string' || value === '') return 'is not a path';
  if (!/^[\x20-\x7e]+$/.test(value)) return 'has a character other than printable ASCII';
  if (value.startsWith('/')) return 'is absolute';
  if (/[\\:]/.test(value)) return 'has a backslash or a colon';
  for (const part of value.split('/')) {
    if (part === '') return 'has an empty part';
    if (part === '.' || part === '..') return 'has a part that is . or ..';
    if (part.startsWith(' ') || part.endsWith(' ') || part.endsWith('.')) return 'has a part that starts with a space or ends with a space or a dot';
    if (part.toLowerCase() === '.git') return 'has a part that is .git';
  }
  return null;
}

/** Reads a regular file below `root`: a link, on the way or at the end, is refused, because the manifest must describe what is in the release. */
function readRegular(root, relative, what) {
  let at = root;
  const parts = relative.split('/');
  for (const [i, part] of parts.entries()) {
    at = path.join(at, part);
    let stat;
    try {
      stat = fs.lstatSync(at);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new ManifestError(`${what} ${relative}: no such file`);
      throw new ManifestError(`${what} ${relative}: cannot be read (${error.code ?? error.message})`);
    }
    if (stat.isSymbolicLink()) throw new ManifestError(`${what} ${relative}: ${i === parts.length - 1 ? 'is a symbolic link' : `${parts.slice(0, i + 1).join('/')} is a symbolic link`}`);
    if (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory()) throw new ManifestError(`${what} ${relative}: ${i === parts.length - 1 ? 'is not a regular file' : `${parts.slice(0, i + 1).join('/')} is not a folder`}`);
  }
  return fs.readFileSync(at);
}

function readJson(root, relative, what) {
  const bytes = readRegular(root, relative, what);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    throw new ManifestError(`${relative}: is not one JSON document in UTF-8 without a byte order mark`);
  }
}

function onlyKeys(object, keys, where) {
  const extra = Object.keys(object).filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !Object.hasOwn(object, key));
  if (extra.length > 0) throw new ManifestError(`${where}: unknown key ${extra[0]}`);
  if (missing.length > 0) throw new ManifestError(`${where}: missing key ${missing[0]}`);
}

function listOf(value, where) {
  if (!Array.isArray(value) || !value.every(isText)) throw new ManifestError(`${where}: must be a list of texts`);
  if (new Set(value).size !== value.length) throw new ManifestError(`${where}: names something twice`);
  return value;
}

/**
 * Reads and judges `install.json` of a folder. Returns { generations, files, requires }, with the files in the order of the file. A source and a
 * destination are paths of the form `pathProblem` allows, a destination is new, inside `.github/` or `docs/decisions/`, and not the folder of another.
 * Whether a source exists is for `buildManifest`.
 */
export function readInstall(root) {
  const install = readJson(root, 'install.json', 'file');
  if (!isObject(install)) throw new ManifestError('install.json: must be an object');
  onlyKeys(install, ['schema', 'generations', 'files', 'requires'], 'install.json');
  if (install.schema !== SCHEMA) throw new ManifestError(`install.json: schema must be ${SCHEMA}`);
  const generations = listOf(install.generations, 'install.json: generations');
  if (generations.length === 0 || !generations.every((name) => GENERATION.test(name))) throw new ManifestError('install.json: generations must name at least one generation, like g1');
  if (!Array.isArray(install.files) || install.files.length === 0) throw new ManifestError('install.json: files must be a list with at least one entry');
  const requires = install.requires;
  if (!isObject(requires)) throw new ManifestError('install.json: requires must be an object');
  onlyKeys(requires, ['secrets', 'settings', 'rulesets'], 'install.json: requires');
  listOf(requires.secrets, 'install.json: requires.secrets');
  listOf(requires.settings, 'install.json: requires.settings');
  if (!Array.isArray(requires.rulesets)) throw new ManifestError('install.json: requires.rulesets must be a list');
  for (const ruleset of requires.rulesets) {
    if (!isObject(ruleset)) throw new ManifestError('install.json: a ruleset must be an object');
    onlyKeys(ruleset, ['branch', 'checks', 'up-to-date'], 'install.json: a ruleset');
    if (!isText(ruleset.branch)) throw new ManifestError('install.json: a ruleset needs a branch');
    listOf(ruleset.checks, 'install.json: a ruleset: checks');
    if (typeof ruleset['up-to-date'] !== 'boolean') throw new ManifestError('install.json: a ruleset: up-to-date must be true or false');
  }
  const destinations = new Map();
  for (const [i, entry] of install.files.entries()) {
    const where = `install.json: entry ${i + 1}`;
    if (!isObject(entry)) throw new ManifestError(`${where}: must be an object`);
    onlyKeys(entry, ['source', 'path', 'kind'], where);
    if (!KINDS.includes(entry.kind)) throw new ManifestError(`${where}: kind must be ${KINDS.join(' or ')}`);
    for (const key of ['source', 'path']) {
      const problem = pathProblem(entry[key]);
      if (problem !== null) throw new ManifestError(`${where}: ${key} ${problem}`);
    }
    if (!DESTINATIONS.some((start) => entry.path.startsWith(start))) throw new ManifestError(`${where}: path ${entry.path} is outside ${DESTINATIONS.join(' and ')}`);
    const key = entry.path.toLowerCase();
    if (destinations.has(key)) throw new ManifestError(`${where}: path ${entry.path} is already the destination of ${destinations.get(key)}`);
    destinations.set(key, entry.path);
  }
  for (const [key, destination] of destinations) {
    for (const [other, name] of destinations) if (other.startsWith(`${key}/`)) throw new ManifestError(`install.json: ${destination} is a file and ${name} is below it`);
  }
  return { generations, files: install.files.map(({ source, path: destination, kind }) => ({ source, path: destination, kind })), requires };
}

/** The JSON of a manifest: keys in the order of their bytes at every depth, two spaces, line feeds, one line feed at the end. */
export function canonical(value) {
  const sorted = (item) => {
    if (Array.isArray(item)) return item.map(sorted);
    if (isObject(item)) return Object.fromEntries(Object.keys(item).sort(byBytes).map((key) => [key, sorted(item[key])]));
    return item;
  };
  return `${JSON.stringify(sorted(value), null, 2)}\n`;
}

/** Builds the manifest of the folder `root` for a version, its tag and the commit that is released. Throws ManifestError. */
export function buildManifest({ root, version, tag, commit }) {
  if (typeof version !== 'string' || !SEMVER.test(version)) throw new ManifestError(`version ${JSON.stringify(version)} is not a semantic version without build metadata`);
  if (tag !== `v${version}`) throw new ManifestError(`tag ${JSON.stringify(tag)} is not v${version}`);
  if (typeof commit !== 'string' || !COMMIT.test(commit)) throw new ManifestError(`commit ${JSON.stringify(commit)} is not a full commit id of 40 or 64 lower case hexadecimal digits`);
  const packaged = readJson(root, 'package.json', 'file');
  const node = isObject(packaged) && isObject(packaged.engines) ? packaged.engines.node : undefined;
  if (!isText(node)) throw new ManifestError('package.json: engines.node is missing');
  const install = readInstall(root);
  const files = install.files
    .map(({ source, path: destination, kind }) => {
      const bytes = readRegular(root, source, 'source');
      return { kind, path: destination, sha256: sha256(bytes), size: bytes.length, source };
    })
    .sort((a, b) => byBytes(a.path, b.path));
  return { commit, files, generations: install.generations, node, requires: install.requires, schema: SCHEMA, tag, version };
}

/**
 * Compares the text of a manifest with the files of `root`: the digest and size of every file, the files of install.json, the rest of the manifest, and
 * the form of the text. Returns the list of what differs; empty when the manifest is what the files give.
 */
export function verifyManifest(text, root) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    return ['the manifest is not one JSON document'];
  }
  if (!isObject(manifest)) return ['the manifest is not an object'];
  const problems = [];
  let expected;
  try {
    expected = buildManifest({ root, version: manifest.version, tag: manifest.tag, commit: manifest.commit });
  } catch (error) {
    if (!(error instanceof ManifestError)) throw error;
    return [error.message];
  }
  const listed = Array.isArray(manifest.files) ? manifest.files : [];
  const named = listed.filter((entry) => isObject(entry) && typeof entry.path === 'string');
  const have = new Map(named.map((entry) => [entry.path, entry]));
  for (const want of expected.files) {
    const entry = have.get(want.path);
    if (entry === undefined) problems.push(`missing from the manifest: ${want.path}`);
    else if (entry.sha256 !== want.sha256) problems.push(`digest mismatch: ${want.path}`);
    else if (entry.size !== want.size) problems.push(`size mismatch: ${want.path}`);
    else if (entry.kind !== want.kind || entry.source !== want.source) problems.push(`kind or source mismatch: ${want.path}`);
  }
  for (const entry of listed) {
    if (!isObject(entry) || !expected.files.some((want) => want.path === entry.path)) problems.push(`not in install.json: ${isObject(entry) ? entry.path : JSON.stringify(entry)}`);
  }
  if (named.length !== have.size) problems.push('the manifest lists a path twice');
  for (const key of ['schema', 'generations', 'node', 'requires']) {
    if (canonical(manifest[key] ?? null) !== canonical(expected[key])) problems.push(`${key} is not what install.json and package.json give`);
  }
  if (problems.length === 0 && text !== canonical(expected)) problems.push('the manifest is not in canonical form');
  return problems;
}

function parse(argv) {
  const wanted = new Set(['--version', '--tag', '--commit', '--out', '--root', '--verify']);
  const given = new Map();
  for (let at = 0; at < argv.length; at += 2) {
    if (!wanted.has(argv[at]) || given.has(argv[at]) || at + 1 >= argv.length) return null;
    given.set(argv[at], argv[at + 1]);
  }
  const keys = [...given.keys()].filter((key) => key !== '--root').sort();
  const verifying = keys.length === 1 && keys[0] === '--verify';
  const building = keys.join(' ') === '--commit --out --tag --version';
  return verifying || building ? given : null;
}

/** The command line, without the process around it. Returns { code, stdout, stderr }. */
export function run(argv, { cwd = process.cwd() } = {}) {
  const given = parse(argv);
  if (given === null) return { code: 2, stdout: '', stderr: USAGE };
  const root = path.resolve(cwd, given.get('--root') ?? '.');
  try {
    if (given.has('--verify')) {
      let text;
      try {
        text = fs.readFileSync(path.resolve(cwd, given.get('--verify')), 'utf8');
      } catch (error) {
        throw new ManifestError(`${given.get('--verify')}: cannot be read (${error.code ?? error.message})`);
      }
      const problems = verifyManifest(text, root);
      if (problems.length > 0) return { code: 1, stdout: '', stderr: `${problems.map((problem) => `build-release-manifest: ${problem}\n`).join('')}build-release-manifest: ${problems.length} ${problems.length === 1 ? 'problem' : 'problems'}\n` };
      return { code: 0, stdout: `verified ${JSON.parse(text).files.length} files\n`, stderr: '' };
    }
    const manifest = buildManifest({ root, version: given.get('--version'), tag: given.get('--tag'), commit: given.get('--commit') });
    fs.writeFileSync(path.resolve(cwd, given.get('--out')), canonical(manifest));
    return { code: 0, stdout: `wrote ${given.get('--out')}: ${manifest.files.length} files\n`, stderr: '' };
  } catch (error) {
    if (!(error instanceof ManifestError)) throw error;
    return { code: 1, stdout: '', stderr: `build-release-manifest: ${error.message}\n` };
  }
}

// Runs only when this file is the program, also when it is reached through a symbolic link.
function isMain() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const { code, stdout, stderr } = run(process.argv.slice(2));
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.exitCode = code;
}
