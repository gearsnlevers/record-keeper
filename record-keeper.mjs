// Record Keeper: reads a decision record, puts it into canonical form, seals it and verifies a seal, and checks the
// format of the records in a folder.
//
// One file, no dependencies, no network. It implements generation g1 exactly as docs/generation-g1.md
// describes it, and the format of a record and its folder as docs/record-format.md describes it; test/vectors/g1 and
// test/fixtures/validate hold the answers it must give. It never writes a file: `seal` and `validate` only print.
//
//   node record-keeper.mjs seal <file>             print the seal of a record
//   node record-keeper.mjs seal --verify <file>    check the `seal:` line of a record against its text
//   node record-keeper.mjs validate [folder]       check the format of the records in a folder (default docs/decisions)
//   node record-keeper.mjs validate --commit <rev> check the folder as it is in a commit (docs/reading-a-commit.md)
//
// Exit status: 0 success, 1 a record is rejected, a seal does not verify or a folder has problems, 2 wrong usage or
// unreadable file. Only `validate --commit` runs another program (git); nothing else does, and nothing writes a file.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GENERATION = 'g1';
export const SEAL_PREFIX = `sha256-${GENERATION}:`;

/** What each rule of docs/generation-g1.md rejects, as a clause that follows "rejected by G1-NN:". */
export const RULES = {
  'G1-01': 'the bytes are not valid UTF-8',
  'G1-02': 'the text contains U+FEFF (a byte order mark)',
  'G1-03': 'the text contains a control character other than tab, line feed and carriage return',
  'G1-04': 'the text contains a line or paragraph separator or a bidirectional control',
  'G1-05': 'a carriage return is not directly followed by a line feed',
  'G1-06': 'the text contains <!--',
  'G1-07': 'line 1 is not ---',
  'G1-08': 'the front matter is never closed by a line that is ---',
  'G1-09': 'a front matter line is neither a key line nor a continuation line',
  'G1-10': 'two front matter keys are the same apart from case',
  'G1-11': 'status, date or seal is written with a capital letter',
  'G1-12': 'status, date or seal has no value, or has continuation lines',
  'G1-13': 'a front matter value starts with &, *, !, | or >',
  'G1-14': 'a ~~~ fence or an indented ``` fence outside a code block',
  'G1-15': 'a code fence is never closed',
  'G1-16': 'a line starts a raw HTML block',
  'G1-17': 'a setext underline turns the line above it into a heading',
  'G1-18': 'a line looks like the heading of an excluded section but is not exactly that heading, or is in a code block',
  'G1-19': 'an excluded heading occurs twice, or Errata comes before Known deviations',
  'G1-20': 'the line before an excluded heading is not empty',
};

/** Thrown when a record breaks a rule: `rule` is the first rule it breaks, in the order of the numbers. */
export class Reject extends Error {
  constructor(rule) {
    super(`${rule}: ${RULES[rule]}`);
    this.name = 'Reject';
    this.rule = rule;
  }
}

const EXCLUDED_KEYS = ['status', 'date', 'seal'];
const EXCLUDED_SECTIONS = new Map([
  ['known deviations', '## Known deviations'],
  ['errata', '## Errata'],
]);
const EXCLUDED_HEADINGS = [...EXCLUDED_SECTIONS.values()];

// Characters by code unit; every one of them lies in the Basic Multilingual Plane.
const BOM = 0xfeff;
const CONTROLS = [[0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x9f]]; // not tab, line feed, carriage return
const SEPARATORS_AND_BIDI = [[0x061c, 0x061c], [0x200e, 0x200f], [0x2028, 0x2029], [0x202a, 0x202e], [0x2066, 0x2069]];
const inRanges = (code, ranges) => ranges.some(([from, to]) => code >= from && code <= to);

const KEY_LINE = /^([A-Za-z][A-Za-z0-9_-]*):(?: (.*))?$/;
const CONTINUATION_LINE = /^ +[^ \t]/;
const FENCE_OPEN = /^(`{3,})[^`]*$/;
const FENCE_CLOSE = /^(`+)$/;
const NOT_A_FENCE = [/^[ \t]*~{3,}/, /^[ \t]+`{3,}/]; // G1-14: fences that only some readers recognise
const HTML_START = /^ {0,3}<[A-Za-z/!?]/;
const AUTOLINK = /^ {0,3}<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^ \t<>]*>/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)$/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const SECTION_HEADING = /^ {0,3}#{1,2}(?:[ \t]|$)/; // the lines that end a section (level 1 and 2)

const asciiLower = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

function decode(bytes) {
  try {
    // ignoreBOM keeps a byte order mark in the text, so that G1-02 can see it.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Reject('G1-01');
  }
}

/** G1-02 to G1-06: the characters. Every rule is looked at before the first is reported, so the order holds. */
function checkCharacters(text) {
  let bom = false;
  let control = false;
  let separatorOrBidi = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === BOM) bom = true;
    else if (inRanges(code, CONTROLS)) control = true;
    else if (inRanges(code, SEPARATORS_AND_BIDI)) separatorOrBidi = true;
  }
  if (bom) throw new Reject('G1-02');
  if (control) throw new Reject('G1-03');
  if (separatorOrBidi) throw new Reject('G1-04');
  if (/\r(?!\n)/.test(text)) throw new Reject('G1-05');
  if (text.includes('<!--')) throw new Reject('G1-06');
}

/** Step 1 of the canonical form: CRLF becomes LF, and no line ends in a space or a tab. */
const normalizedLines = (text) => text.replace(/\r\n/g, '\n').split('\n').map((line) => line.replace(/[ \t]+$/, ''));

/** G1-07 to G1-09: the front matter. Returns the index of its closing line and its key lines with what they own. */
function parseFrontMatter(lines) {
  if (lines[0] !== '---') throw new Reject('G1-07');
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new Reject('G1-08');
  const entries = [];
  for (let at = 1; at < end; at++) {
    const key = KEY_LINE.exec(lines[at]);
    if (key) entries.push({ key: key[1], value: (key[2] ?? '').replace(/^ +/, ''), at, owned: [] });
    else if (entries.length && CONTINUATION_LINE.test(lines[at])) entries.at(-1).owned.push(lines[at]);
    else throw new Reject('G1-09');
  }
  return { end, entries };
}

/** G1-10 to G1-13: the keys. Each rule is a pass of its own, so that the lowest number is reported. */
function checkKeys(entries) {
  const seen = new Set();
  for (const { key } of entries) {
    const lower = asciiLower(key);
    if (seen.has(lower)) throw new Reject('G1-10');
    seen.add(lower);
  }
  for (const { key } of entries) {
    const lower = asciiLower(key);
    if (EXCLUDED_KEYS.includes(lower) && key !== lower) throw new Reject('G1-11');
  }
  for (const { key, value, owned } of entries) {
    if (EXCLUDED_KEYS.includes(key) && (value === '' || owned.length > 0)) throw new Reject('G1-12');
  }
  for (const { value, owned } of entries) {
    const starts = [value, ...owned.map((line) => line.replace(/^ +/, '').replace(/^- +/, ''))];
    if (starts.some((start) => start !== '' && '&*!|>'.includes(start[0]))) throw new Reject('G1-13');
  }
}

/** Which lines of the body are fenced, and whether a fence is of a kind this page does not know (G1-14) or unclosed (G1-15). */
function scanFences(body) {
  const fenced = [];
  let strange = false;
  let opening = 0; // the length of the backtick run that opened the fence we are in, or 0 outside a fence
  for (const line of body) {
    if (opening === 0) {
      if (NOT_A_FENCE.some((pattern) => pattern.test(line))) strange = true;
      opening = FENCE_OPEN.exec(line)?.[1].length ?? 0;
      fenced.push(opening > 0);
    } else {
      fenced.push(true);
      const closing = FENCE_CLOSE.exec(line);
      if (closing && closing[1].length >= opening) opening = 0;
    }
  }
  return { fenced, strange, unclosed: opening > 0 };
}

/** G1-16 and G1-17: what makes a reader see a different structure than the one this page cuts by. */
function checkStructure(body, fenced) {
  body.forEach((line, i) => {
    if (!fenced[i] && HTML_START.test(line) && !AUTOLINK.test(line)) throw new Reject('G1-16');
  });
  body.forEach((line, i) => {
    if (fenced[i] || i === 0 || !SETEXT_UNDERLINE.test(line)) return;
    const above = body[i - 1];
    if (above !== '' && !fenced[i - 1] && !HEADING.test(above)) throw new Reject('G1-17');
  });
}

/** G1-18 to G1-20: the excluded sections. Looks at every line of the record, front matter and code blocks included. */
function checkSections(lines, end, fenced) {
  const found = new Map(); // 'known deviations' | 'errata' to the indexes of its heading lines
  lines.forEach((line, i) => {
    const name = asciiLower(line.replace(/^[ \t#]+/, '').replace(/[ \t#]+$/, ''));
    const heading = EXCLUDED_SECTIONS.get(name);
    if (!heading) return;
    const inCodeBlock = i > end && fenced[i - end - 1];
    if (line !== heading || inCodeBlock) throw new Reject('G1-18');
    found.set(name, [...(found.get(name) ?? []), i]);
  });
  const deviations = found.get('known deviations');
  const errata = found.get('errata');
  if ([...found.values()].some((at) => at.length > 1)) throw new Reject('G1-19');
  if (deviations && errata && errata[0] < deviations[0]) throw new Reject('G1-19');
  for (const at of found.values()) {
    if (lines[at[0] - 1] !== '') throw new Reject('G1-20');
  }
}

/**
 * Applies the rules to the bytes of a record, in the order of their numbers.
 * Returns the record as the canonical form needs it, or throws Reject with the first rule it breaks.
 */
export function parse(bytes) {
  const text = decode(bytes);
  checkCharacters(text);
  const lines = normalizedLines(text);
  const { end, entries } = parseFrontMatter(lines);
  checkKeys(entries);
  const body = lines.slice(end + 1);
  const { fenced, strange, unclosed } = scanFences(body);
  if (strange) throw new Reject('G1-14');
  if (unclosed) throw new Reject('G1-15');
  checkStructure(body, fenced);
  checkSections(lines, end, fenced);
  return { lines, end, entries, fenced };
}

/** Steps 2 to 5 of the canonical form, for a record that parse() accepted. Returns the canonical text. */
export function canonicalize({ lines, end, entries, fenced }) {
  const cutKeys = new Set(entries.filter(({ key }) => EXCLUDED_KEYS.includes(key)).map(({ at }) => at));
  const head = lines.slice(0, end + 1).filter((_, i) => !cutKeys.has(i));
  const body = [];
  let cutting = false;
  let afterEmpty = false;
  lines.slice(end + 1).forEach((line, i) => {
    if (!fenced[i] && SECTION_HEADING.test(line)) cutting = EXCLUDED_HEADINGS.includes(line);
    if (cutting) return;
    const empty = line === '' && !fenced[i];
    if (empty && afterEmpty) return;
    afterEmpty = empty;
    body.push(line);
  });
  while (body.length > 0 && body.at(-1) === '') body.pop();
  return [...head, ...body].join('\n') + '\n';
}

/** The seal of a record under g1: `sha256-g1:` and the SHA-256 of its canonical text. Throws Reject. */
export function seal(bytes) {
  return SEAL_PREFIX + createHash('sha256').update(canonicalize(parse(bytes)), 'utf8').digest('hex');
}

/**
 * Checks the `seal:` line of a record against its text. Never throws for a bad record.
 * Returns { ok: true, seal } or { ok: false, reason, ... } where reason is one of
 * 'rejected' (with rule), 'not-sealed', 'malformed' (with stored), 'unknown-generation' (with generation)
 * and 'mismatch' (with stored and computed).
 */
export function verify(bytes) {
  let record;
  try {
    record = parse(bytes);
  } catch (error) {
    if (error instanceof Reject) return { ok: false, reason: 'rejected', rule: error.rule };
    throw error;
  }
  const entry = record.entries.find(({ key }) => key === 'seal');
  if (!entry) return { ok: false, reason: 'not-sealed' };
  const stored = entry.value;
  if (!/^sha256-g[0-9]+:[0-9a-f]{64}$/.test(stored)) return { ok: false, reason: 'malformed', stored };
  if (!stored.startsWith(SEAL_PREFIX)) return { ok: false, reason: 'unknown-generation', generation: stored.slice(7, stored.indexOf(':')) };
  const computed = SEAL_PREFIX + createHash('sha256').update(canonicalize(record), 'utf8').digest('hex');
  return stored === computed ? { ok: true, seal: computed } : { ok: false, reason: 'mismatch', stored, computed };
}

// ---- the format of a record and of its folder: docs/record-format.md ----------------------------------------------------

/** What each rule of docs/record-format.md says, as what is wrong with the file (or the folder) it is reported for. */
export const FORMAT_RULES = {
  'V-01': 'does not exist or is not a directory',
  'V-02': 'is missing',
  'V-03': 'is missing',
  'V-04': 'is a symbolic link, or is neither a regular file nor a directory',
  'V-05': 'is not README.md, template.md or a record file named NNNN-short-title.md in lower case with hyphens',
  'V-06': 'is a subfolder that is not the shared folder',
  'V-07': 'has the number of an earlier record',
  'V-08': 'has record numbers that are not 0001, 0002, 0003 and so on without a gap',
  'V-09': 'breaks a rule of generation g1',
  'V-10': 'is longer than 60 lines',
  'V-11': 'looks like it contains a credential',
  'V-12': 'contains an e-mail address; records are public',
  'V-13': 'has a key that is not a standard key and not an extra key',
  'V-14': 'has a key of the wrong kind',
  'V-15': 'has a key with no value',
  'V-16': 'has a key whose lines are neither one value nor a list of items',
  'V-17': 'is missing a required key',
  'V-18': 'has a status that is not proposed, accepted, rejected or "superseded by NNNN"',
  'V-19': 'has the status deprecated; a record ends only by a successor',
  'V-20': 'is superseded by a record that does not exist or does not have a higher number',
  'V-21': 'has a date that is not a real date written YYYY-MM-DD',
  'V-22': 'has a seal that is not sha256-gN: and 64 lower case hexadecimal digits',
  'V-23': 'has an issue that is not written owner/repo#N',
  'V-24': 'does not start with a "# Title" heading',
  'V-25': 'has a section that is not one of the six',
  'V-26': 'is missing a required section',
  'V-27': 'has its sections out of order, or one of them twice',
  'V-28': 'has a section with no content',
  'V-29': 'has no "## Index" section',
  'V-30': 'has no row in the index',
  'V-31': 'has more than one row in the index',
  'V-32': 'has an index row for a record that does not exist',
  'V-33': 'has an index row that does not show its status',
  'V-34': 'has an index row that does not show its title',
  'V-35': 'has a supersedes entry that is not a number of four digits',
  'V-36': 'supersedes a record that does not exist or does not have a lower number',
};

/** What each rule of docs/reading-a-commit.md reports, for the folder as it is in a commit. */
export const COMMIT_RULES = {
  'T-01': 'has the executable mode',
  'T-02': 'has a git attribute other than text and eol',
  'T-03': 'is not the only folder that holds records',
};

const STANDARD_KEYS = ['status', 'date', 'decision-makers', 'applies-to', 'issues', 'supersedes', 'seal'];
const LIST_KEYS = ['decision-makers', 'applies-to', 'issues', 'supersedes'];
const VALUE_KEYS = ['status', 'date', 'seal'];
const REQUIRED_KEYS = ['status', 'date', 'decision-makers'];
const SECTIONS = ['Context and problem statement', 'Decision', 'Consequences', 'Known deviations', 'Alternatives considered', 'Errata'];
const REQUIRED_SECTIONS = SECTIONS.slice(0, 3);
const MAX_LINES = 60;
const RECORD_FILE = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const CREDENTIAL = /ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const STATUS_FORM = /^(?:proposed|accepted|rejected|superseded by (\d{4}))$/;
const SEAL_FORM = /^sha256-g[0-9]+:[0-9a-f]{64}$/;
const ISSUE_FORM = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[0-9]+$/;
const NUMBER_FORM = /^\d{4}$/;
const ITEM = /^ +- +(\S.*)$/;
const TITLE = /^# \S/;
const INDEX_LINK = /\]\((\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md)\)/;

function isRealDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

/**
 * Where a records folder is read from: `exists()`, `list()` (the entries of the folder, each { name, type } with the type
 * 'file', 'directory', 'symlink' or 'other') and `read(name)` (the bytes of a file of the folder).
 */
function folderSource(folder) {
  return {
    exists() {
      try {
        return fs.statSync(folder).isDirectory();
      } catch {
        return false;
      }
    },
    list() {
      return fs.readdirSync(folder).map((name) => {
        const stat = fs.lstatSync(path.join(folder, name));
        return { name, type: stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other' };
      });
    },
    read: (name) => fs.readFileSync(path.join(folder, name)),
  };
}

/** V-01 to V-08. Returns the record files of the folder, in name order, with their numbers. */
function checkFolder(source, sharedFolder, report) {
  const records = [];
  let readme = false;
  let template = false;
  for (const { name, type } of source.list().filter((entry) => !entry.name.startsWith('.')).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (type === 'directory') {
      if (name !== sharedFolder) report(name, 'V-06');
    } else if (type !== 'file') report(name, 'V-04');
    else if (name === 'README.md') readme = true;
    else if (name === 'template.md') template = true;
    else if (RECORD_FILE.test(name)) records.push({ name, number: Number(name.slice(0, 4)) });
    else report(name, 'V-05');
  }
  if (!readme) report('README.md', 'V-02');
  if (!template) report('template.md', 'V-03');
  const seen = new Set();
  for (const { name, number } of records) {
    if (seen.has(number)) report(name, 'V-07');
    seen.add(number);
  }
  const gap = [...seen].sort((a, b) => a - b).findIndex((number, i) => number !== i + 1);
  if (gap >= 0) report(null, 'V-08');
  return { records, readme };
}

/** How the entry of a key is shaped: 'empty', 'single', 'list' (with its items) or 'mixed'. */
function shapeOf({ value, owned }) {
  const items = owned.map((line) => ITEM.exec(line));
  if (value === '' && owned.length === 0) return { shape: 'empty' };
  if (owned.length === 0) return { shape: 'single' };
  if (value === '' && items.every(Boolean)) return { shape: 'list', items: items.map((item) => item[1]) };
  return { shape: 'mixed' };
}

/** V-13 to V-23, V-35 and V-36. Returns the status as the index can judge it (undefined when it is missing or reported). */
function checkFrontMatter(name, number, entries, numbers, extraKeys, report) {
  const shaped = entries.map((entry) => ({ ...entry, ...shapeOf(entry) }));
  const byKey = new Map(shaped.map((entry) => [entry.key, entry]));
  for (const { key } of shaped) if (!STANDARD_KEYS.includes(key) && !extraKeys.includes(key)) report(name, 'V-13', key);
  for (const { key, shape } of shaped) {
    if ((LIST_KEYS.includes(key) && shape === 'single') || (VALUE_KEYS.includes(key) && shape === 'list')) report(name, 'V-14', `${key} must be ${LIST_KEYS.includes(key) ? 'a list' : 'a single value'}`);
  }
  for (const { key, shape } of shaped) if (shape === 'empty') report(name, 'V-15', key);
  for (const { key, shape } of shaped) if (shape === 'mixed') report(name, 'V-16', key);
  for (const key of REQUIRED_KEYS) if (!byKey.has(key)) report(name, 'V-17', key);
  const single = (key) => (byKey.get(key)?.shape === 'single' ? byKey.get(key).value : undefined);

  const status = single('status');
  let judged;
  if (status === 'deprecated') report(name, 'V-19');
  else if (status !== undefined) {
    const form = STATUS_FORM.exec(status);
    if (!form) report(name, 'V-18', status);
    else {
      judged = status;
      if (form[1] !== undefined && (!numbers.has(Number(form[1])) || Number(form[1]) <= number)) report(name, 'V-20', form[1]);
    }
  }
  const date = single('date');
  if (date !== undefined && !isRealDate(date)) report(name, 'V-21', date);
  const seal = single('seal');
  if (seal !== undefined && !SEAL_FORM.test(seal)) report(name, 'V-22', seal);
  const issues = byKey.get('issues');
  if (issues?.shape === 'list') for (const item of issues.items) if (!ISSUE_FORM.test(item)) report(name, 'V-23', item);
  const supersedes = byKey.get('supersedes');
  if (supersedes?.shape === 'list') {
    for (const item of supersedes.items) {
      if (!NUMBER_FORM.test(item)) report(name, 'V-35', item);
      else if (!numbers.has(Number(item)) || Number(item) >= number) report(name, 'V-36', item);
    }
  }
  return judged;
}

/** V-24 to V-28. Returns the title as the index can judge it (undefined when there is none). */
function checkBody(name, body, fenced, report) {
  const first = body.find((line) => line !== '');
  const titled = first !== undefined && TITLE.test(first);
  if (!titled) report(name, 'V-24');
  const headings = [];
  body.forEach((line, i) => {
    if (!fenced[i] && line.startsWith('## ')) headings.push({ at: i, name: line.slice(3) });
  });
  for (const heading of headings) if (!SECTIONS.includes(heading.name)) report(name, 'V-25', heading.name);
  for (const section of REQUIRED_SECTIONS) if (!headings.some((heading) => heading.name === section)) report(name, 'V-26', section);
  const order = headings.filter((heading) => SECTIONS.includes(heading.name)).map((heading) => SECTIONS.indexOf(heading.name));
  if (order.some((position, i) => i > 0 && position <= order[i - 1])) report(name, 'V-27');
  headings.forEach((heading, i) => {
    const until = i + 1 < headings.length ? headings[i + 1].at : body.length;
    if (body.slice(heading.at + 1, until).every((line) => line === '')) report(name, 'V-28', heading.name);
  });
  return titled ? first.slice(2) : undefined;
}

/** V-09 to V-28 for one record. Returns what the index can judge: { status, title }. */
function checkRecord(source, { name, number }, numbers, extraKeys, report) {
  let record;
  try {
    record = parse(source.read(name));
  } catch (error) {
    if (!(error instanceof Reject)) throw error;
    report(name, 'V-09', `${error.rule}: ${RULES[error.rule]}`, error.rule);
    return {};
  }
  const { lines, end, entries, fenced } = record;
  const text = lines.join('\n');
  if (lines.length - (lines.at(-1) === '' ? 1 : 0) > MAX_LINES) report(name, 'V-10');
  if (CREDENTIAL.test(text)) report(name, 'V-11');
  if (EMAIL.test(text)) report(name, 'V-12');
  const status = checkFrontMatter(name, number, entries, numbers, extraKeys, report);
  const title = checkBody(name, lines.slice(end + 1), fenced, report);
  return { status, title };
}

/** V-29 to V-34: README.md against the records. */
function checkIndex(source, records, facts, report) {
  const lines = source.read('README.md').toString('utf8').replace(/\r\n/g, '\n').split('\n').map((line) => line.replace(/[ \t]+$/, ''));
  const { fenced } = scanFences(lines);
  const start = lines.findIndex((line, i) => !fenced[i] && line === '## Index');
  if (start < 0) {
    report('README.md', 'V-29');
    return;
  }
  let stop = lines.findIndex((line, i) => i > start && !fenced[i] && (line.startsWith('# ') || line.startsWith('## ')));
  if (stop < 0) stop = lines.length;
  const rowsOf = new Map();
  for (const row of lines.slice(start + 1, stop).filter((line) => line.startsWith('|'))) {
    const link = INDEX_LINK.exec(row);
    if (link) rowsOf.set(link[1], [...(rowsOf.get(link[1]) ?? []), row]);
  }
  const known = new Set(records.map(({ name }) => name));
  for (const [target, rows] of rowsOf) if (!known.has(target)) rows.forEach(() => report('README.md', 'V-32', target));
  for (const { name } of records) {
    const rows = rowsOf.get(name) ?? [];
    if (rows.length === 0) {
      report(name, 'V-30');
      continue;
    }
    if (rows.length > 1) report(name, 'V-31');
    const pieces = rows[0].split('|').slice(1);
    if (pieces.length > 0 && pieces.at(-1).trim() === '') pieces.pop();
    const cells = pieces.map((cell) => cell.trim());
    const { status, title } = facts.get(name);
    if (status !== undefined && !cells.includes(status)) report(name, 'V-33');
    const linkTexts = [...rows[0].matchAll(/\[([^\]]*)\]\(/g)].map((match) => match[1]);
    if (title !== undefined && !cells.includes(title) && !linkTexts.includes(title)) report(name, 'V-34');
  }
}

/**
 * Checks the format of the records in a folder against docs/record-format.md.
 * Returns the problems as [{ file, rule, detail?, g1? }]; `file` is null for a problem of the folder as a whole.
 * Settings: `extraKeys`, the front matter keys beyond the standard ones, and `sharedFolder`, the subfolder not looked at.
 */
export function validate(folder, settings) {
  return validateSource(folderSource(folder), settings);
}

function validateSource(source, { extraKeys = [], sharedFolder = 'shared' } = {}) {
  const problems = [];
  const report = (file, rule, detail, g1) => problems.push({ file, rule, ...(detail ? { detail } : {}), ...(g1 ? { g1 } : {}) });
  if (!source.exists()) {
    report(null, 'V-01');
    return problems;
  }
  const { records, readme } = checkFolder(source, sharedFolder, report);
  const numbers = new Set(records.map(({ number }) => number));
  const facts = new Map(records.map((record) => [record.name, checkRecord(source, record, numbers, extraKeys, report)]));
  if (readme) checkIndex(source, records, facts, report);
  return problems;
}

/** Why a commit cannot be read: no git, not a repository, not a revision, not a folder of the tree. Wrong usage, not a problem of the records. */
export class Unreadable extends Error {}

const KINDS = { '100644': 'file', '100755': 'executable', '040000': 'directory', '120000': 'symlink', '160000': 'submodule' };
/** The folders where tools look for records by convention (docs/reading-a-commit.md). */
const CONVENTIONAL_FOLDERS = ['docs/decisions', 'docs/adr', 'docs/adrs', 'docs/architecture/decisions', 'doc/adr', 'doc/decisions', 'decisions', 'adr', 'adrs'];

/** Runs git with nothing of the caller's git environment, and returns what it printed. */
function runGit(args, { cwd, env = {}, input } = {}) {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
  const result = spawnSync('git', args, { cwd, input, env: { ...inherited, GIT_TERMINAL_PROMPT: '0', ...env }, maxBuffer: 1 << 30 });
  if (result.error) throw new Unreadable(`cannot run git: ${result.error.message}`);
  if (result.status !== 0) throw new Unreadable(`git ${args[args[0] === '-C' ? 2 : 0]} failed: ${result.stderr.toString('utf8').trim()}`);
  return result.stdout;
}

/** The contents of blobs, by id, in one call of git. */
function readBlobs(repo, ids) {
  const wanted = [...new Set(ids)];
  const blobs = new Map();
  if (wanted.length === 0) return blobs;
  const out = runGit(['-C', repo, 'cat-file', '--batch'], { input: `${wanted.join('\n')}\n` });
  let at = 0;
  for (const id of wanted) {
    const eol = out.indexOf(0x0a, at);
    const header = eol < 0 ? [] : out.toString('latin1', at, eol).split(' ');
    if (header.length !== 3 || header[0] !== id || header[1] !== 'blob') throw new Unreadable(`cannot read the object ${id}`);
    const size = Number(header[2]);
    blobs.set(id, out.subarray(eol + 1, eol + 1 + size));
    at = eol + 1 + size + 1;
  }
  return blobs;
}

/**
 * Opens a commit without checking it out: `commit` is its id, `kind(path)` the kind of an entry ('file', 'executable',
 * 'directory', 'symlink', 'submodule' or 'other'), `children(path)` the entries directly in a directory and `read(path)`
 * the bytes of a file, read from the object database.
 */
export function openCommit(repo, rev) {
  if (typeof rev !== 'string' || rev === '' || rev.startsWith('-')) throw new Unreadable(`not a revision: ${rev}`);
  const commit = runGit(['-C', repo, 'rev-parse', '--verify', `${rev}^{commit}`]).toString('utf8').trim();
  const entries = new Map();
  const byParent = new Map();
  let attributeFiles = false;
  for (const record of runGit(['-C', repo, 'ls-tree', '-r', '-t', '-z', '--full-tree', commit]).toString('latin1').split('\0')) {
    if (record === '') continue;
    const match = /^(\d{6}) \w+ ([0-9a-f]+)\t([^]*)$/.exec(record);
    if (!match) throw new Unreadable(`cannot read the tree of ${commit}`);
    const entryPath = Buffer.from(match[3], 'latin1').toString('utf8');
    const kind = KINDS[match[1]] ?? 'other';
    const slash = entryPath.lastIndexOf('/');
    const parent = slash < 0 ? '' : entryPath.slice(0, slash);
    const name = entryPath.slice(slash + 1);
    entries.set(entryPath, { kind, id: match[2] });
    byParent.set(parent, [...(byParent.get(parent) ?? []), { name, kind, id: match[2] }]);
    if (name === '.gitattributes') attributeFiles = true;
  }
  const cache = new Map();
  const fetch = (paths) => {
    const missing = paths.map((entryPath) => entries.get(entryPath)).filter((entry) => entry && !cache.has(entry.id)).map((entry) => entry.id);
    for (const [id, bytes] of readBlobs(repo, missing)) cache.set(id, bytes);
  };
  return {
    commit,
    attributeFiles,
    kind: (entryPath) => entries.get(entryPath)?.kind,
    children: (dir) => byParent.get(dir) ?? [],
    prefetch: fetch,
    read(entryPath) {
      const entry = entries.get(entryPath);
      if (!entry || !['file', 'executable', 'symlink'].includes(entry.kind)) throw new Unreadable(`${entryPath} is not a file of ${commit}`);
      fetch([entryPath]);
      return cache.get(entry.id);
    },
    /** The git attributes of some paths as the `.gitattributes` of this commit set them, and nothing of the machine: Map path -> [[name, value]]. */
    attributes(paths) {
      const result = new Map(paths.map((entryPath) => [entryPath, []]));
      if (!attributeFiles || paths.length === 0) return result;
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'record-keeper-attributes-'));
      try {
        const objects = path.resolve(repo, runGit(['-C', repo, 'rev-parse', '--git-path', 'objects']).toString('utf8').trim());
        const env = { GIT_DIR: scratch, GIT_ALTERNATE_OBJECT_DIRECTORIES: objects, GIT_ATTR_NOSYSTEM: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devnull, HOME: scratch, XDG_CONFIG_HOME: scratch };
        runGit(['init', '-q', '--bare', scratch], { cwd: scratch, env });
        runGit(['read-tree', commit], { cwd: scratch, env });
        const out = runGit(['check-attr', '--cached', '-a', '-z', '--stdin'], { cwd: scratch, env, input: `${paths.join('\0')}\0` }).toString('utf8').split('\0');
        for (let i = 0; i + 2 < out.length; i += 3) result.get(out[i])?.push([out[i + 1], out[i + 2]]);
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
      }
      return result;
    },
  };
}

function commitSource(commit, folder) {
  return {
    exists: () => commit.kind(folder) === 'directory',
    list: () => commit.children(folder).map(({ name, kind }) => ({ name, type: kind === 'executable' ? 'file' : kind === 'directory' || kind === 'file' ? kind : 'other' })),
    read: (name) => commit.read(`${folder}/${name}`),
  };
}

/**
 * Checks the records folder of a commit: the rules of docs/record-format.md on the files of the commit, and the rules of
 * docs/reading-a-commit.md. `folder` is a path of the tree. Returns the problems like `validate`; throws Unreadable.
 */
export function validateCommit(repo, rev, folder = 'docs/decisions', settings) {
  const parts = folder.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.length === 0 || parts.includes('..')) throw new Unreadable(`not a folder of the repository: ${folder}`);
  const where = parts.join('/');
  const commit = openCommit(repo, rev);
  const source = commitSource(commit, where);
  if (source.exists()) commit.prefetch(source.list().filter(({ name, type }) => type === 'file' && (name === 'README.md' || RECORD_FILE.test(name))).map(({ name }) => `${where}/${name}`));
  const problems = validateSource(source, settings);
  if (!source.exists()) return problems;
  const files = commit.children(where).filter(({ name, kind }) => !name.startsWith('.') && (kind === 'file' || kind === 'executable'));
  for (const { name, kind } of files) if (kind === 'executable') problems.push({ file: name, rule: 'T-01' });
  const attributes = commit.attributes(files.map(({ name }) => `${where}/${name}`));
  for (const { name } of files) {
    const set = attributes.get(`${where}/${name}`).filter(([attribute]) => attribute !== 'text' && attribute !== 'eol').sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (set.length > 0) problems.push({ file: name, rule: 'T-02', detail: set.map(([attribute, value]) => `${attribute}: ${value}`).join(', ') });
  }
  for (const other of CONVENTIONAL_FOLDERS) {
    if (other === where || other.startsWith(`${where}/`)) continue;
    if (commit.children(other).some(({ name, kind }) => (kind === 'file' || kind === 'executable') && (name === 'README.md' || RECORD_FILE.test(name)))) problems.push({ file: null, rule: 'T-03', detail: other });
  }
  return problems;
}

/** The settings file of a repository (docs/settings.md). */
export const SETTINGS_PATH = '.github/record-keeper/settings.yml';

export const SETTINGS_RULES = {
  'S-01': 'is not a regular file of the commit, or a link or a file stands in front of it',
  'S-02': 'is not text that the kit reads',
  'S-03': 'has a line that is not in the subset of YAML that the kit reads',
  'S-04': 'sets a key that another line also sets',
  'S-05': 'has a key that is not a setting',
  'S-06': 'gives a key a value of the wrong kind',
  'S-07': 'gives a key a value that it cannot take',
};

/** Every setting: the kind of its value, the form a value must have and the field it fills. A Map, so that `constructor` is not a setting. */
const SETTINGS = new Map([
  ['folder', { kind: 'single', form: 'folder', field: 'folder' }],
  ['shared-folder', { kind: 'single', form: 'part', field: 'sharedFolder' }],
  ['extra-keys', { kind: 'list', form: 'key', field: 'extraKeys' }],
]);

const defaultSettings = () => ({ folder: 'docs/decisions', sharedFolder: 'shared', extraKeys: [] });

const SETTING_KEY = /^([A-Za-z][A-Za-z0-9_-]*):/;
const SETTING_ENTRY = /^[A-Za-z][A-Za-z0-9_-]*:(?: +([^]*))?$/;
const PLAIN_SCALAR = /(?:[A-Za-z_]|\.[A-Za-z])[A-Za-z0-9_./-]*/y;
const RESERVED_WORD = /^(?:null|true|false|yes|no|on|off|y|n|\.inf|\.nan)$/i;
const KEY_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

const cutDetail = (text) => [...text].slice(0, 40).join('');
const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** S-02: the text of a settings file, or why it is not read: { text } or { reason, line }. */
function readText(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { reason: 'not UTF-8', line: null };
  }
  const first = (test) => {
    for (let i = 0; i < text.length; i++) if (test(text.charCodeAt(i), i)) return i;
    return -1;
  };
  const found = [
    ['byte order mark', first((code) => code === BOM)],
    ['control character', first((code) => inRanges(code, CONTROLS) || code === 0xfffe || code === 0xffff)],
    ['separator or direction control', first((code) => inRanges(code, SEPARATORS_AND_BIDI))],
    ['bare carriage return', first((code, i) => code === 0x0d && text.charCodeAt(i + 1) !== 0x0a)],
  ].find(([, index]) => index >= 0);
  return found ? { reason: found[0], line: lineAt(text, found[1]) } : { text };
}

/** A scalar of the subset at `pos`: { value, end }, or null. */
function readScalar(text, pos) {
  const quote = text[pos];
  if (quote === "'" || quote === '"') {
    let value = '';
    for (let i = pos + 1; ; ) {
      if (i >= text.length || text[i] === '\t') return null;
      if (text[i] === quote) {
        if (quote === "'" && text[i + 1] === "'") {
          value += "'";
          i += 2;
        } else return { value, end: i + 1 };
      } else if (quote === '"' && text[i] === '\\') {
        if (text[i + 1] !== '"' && text[i + 1] !== '\\') return null;
        value += text[i + 1];
        i += 2;
      } else value += text[i++];
    }
  }
  PLAIN_SCALAR.lastIndex = pos;
  const match = PLAIN_SCALAR.exec(text);
  return match && !RESERVED_WORD.test(match[0]) ? { value: match[0], end: pos + match[0].length } : null;
}

const skipSpaces = (text, pos) => {
  while (text[pos] === ' ') pos++;
  return pos;
};

/** One line that is not blank and not a comment: { key, kind, value }, or { key, broken: true } (key is null when the line has none). */
function readEntry(line) {
  const key = SETTING_KEY.exec(line)?.[1] ?? null;
  const entry = SETTING_ENTRY.exec(line);
  if (!entry) return { key, broken: true };
  const rest = entry[1] ?? '';
  if (rest === '' || rest.startsWith('#')) return { key, kind: 'none' };
  let kind = 'single';
  let value;
  let pos;
  if (rest[0] === '[') {
    kind = 'list';
    value = [];
    pos = skipSpaces(rest, 1);
    if (rest[pos] === ']') pos++;
    else {
      for (;;) {
        const item = readScalar(rest, pos);
        if (!item) return { key, broken: true };
        value.push(item.value);
        pos = skipSpaces(rest, item.end);
        if (rest[pos] === ',') pos = skipSpaces(rest, pos + 1);
        else if (rest[pos] === ']') {
          pos++;
          break;
        } else return { key, broken: true };
      }
    }
  } else {
    const scalar = readScalar(rest, 0);
    if (!scalar) return { key, broken: true };
    ({ value, end: pos } = scalar);
  }
  const tail = rest.slice(pos);
  return /^ *$/.test(tail) || /^ +#/.test(tail) ? { key, kind, value } : { key, broken: true };
}

const goodPart = (part) => part !== '' && part !== '.' && part !== '..' && !/^\.[gG][iI][tT]$/.test(part) && !part.includes('\\');
const FORMS = {
  folder: (value) => value.split('/').every(goodPart),
  part: (value) => !value.includes('/') && goodPart(value),
  key: (value) => KEY_NAME.test(value),
};

/**
 * Reads the bytes of a settings file. Returns { settings, problems }: `settings` is { folder, sharedFolder, extraKeys }, each
 * at its default when the file does not set it or has a problem with it, and `problems` are { line, rule, detail } in the
 * order of the lines (line is null when a problem has none).
 */
export function parseSettings(bytes) {
  const settings = defaultSettings();
  const { text, reason, line: where } = readText(bytes);
  if (text === undefined) return { settings, problems: [{ line: where, rule: 'S-02', detail: reason }] };
  const problems = [];
  const byKey = new Map();
  text.split('\n').forEach((raw, index) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (/^ *(?:#|$)/.test(line)) return;
    const entry = readEntry(line);
    const number = index + 1;
    if (entry.broken) problems.push({ line: number, rule: 'S-03', detail: cutDetail(line.replace(/ +$/, '')) });
    if (entry.key === null) return;
    if (!byKey.has(entry.key)) byKey.set(entry.key, []);
    byKey.get(entry.key).push({ number, ...entry });
  });
  for (const [key, occurrences] of byKey) {
    const setting = SETTINGS.get(key);
    const readable = occurrences.filter((entry) => !entry.broken);
    if (!setting) {
      for (const { number } of readable) problems.push({ line: number, rule: 'S-05', detail: cutDetail(key) });
    } else if (occurrences.length > 1) {
      for (const { number } of readable) problems.push({ line: number, rule: 'S-04', detail: cutDetail(key) });
    } else if (readable.length === 1) {
      const [{ number, kind, value }] = readable;
      const items = kind === 'list' ? value : [value];
      const bad = kind === setting.kind ? items.find((item) => !FORMS[setting.form](item)) : undefined;
      if (kind !== setting.kind) problems.push({ line: number, rule: 'S-06', detail: cutDetail(key) });
      else if (bad !== undefined) problems.push({ line: number, rule: 'S-07', detail: cutDetail(bad) });
      else settings[setting.field] = value;
    }
  }
  return { settings, problems: problems.sort((a, b) => a.line - b.line) };
}

/**
 * The settings of an opened commit (see `openCommit`): { settings, problems }, like `parseSettings`, with each problem
 * naming its file. A commit without the file has every default; a link or the wrong kind of entry on the way is S-01.
 */
export function readSettings(commit) {
  const parts = SETTINGS_PATH.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const where = parts.slice(0, i).join('/');
    const kind = commit.kind(where);
    if (kind === undefined) return { settings: defaultSettings(), problems: [] };
    const fine = i === parts.length ? kind === 'file' || kind === 'executable' : kind === 'directory';
    if (!fine) return { settings: defaultSettings(), problems: [{ file: SETTINGS_PATH, line: null, rule: 'S-01', detail: where }] };
  }
  const { settings, problems } = parseSettings(commit.read(SETTINGS_PATH));
  return { settings, problems: problems.map((problem) => ({ file: SETTINGS_PATH, ...problem })) };
}

const USAGE = `Usage:
  record-keeper.mjs seal <file>             print the ${GENERATION} seal of a record
  record-keeper.mjs seal --verify <file>    check the seal: line of a record against its text
  record-keeper.mjs validate [folder] [--extra-key <name>]... [--shared-folder <name>]
                                            check the format of the records in a folder (default docs/decisions)
  record-keeper.mjs validate --commit <revision> [--repo <path>] [folder] [--extra-key <name>]... [--shared-folder <name>]
                                            the same for the folder as it is in a commit of a git repository (default .),
                                            with the rules for what a commit can hold
  record-keeper.mjs validate --commit <revision> --settings-from <revision> [--repo <path>]
                                            the same, with the folder and the other settings taken from the settings file
                                            of the second commit (normally the base of a change)
  record-keeper.mjs config --commit <revision> [--repo <path>]
                                            print the settings of a commit and what is wrong with its settings file
`;

function describeFailure(file, result) {
  switch (result.reason) {
    case 'rejected':
      return `${file}: rejected by ${result.rule}: ${RULES[result.rule]}\n`;
    case 'not-sealed':
      return `${file}: not sealed (there is no seal: key)\n`;
    case 'malformed':
      return `${file}: the seal is malformed (expected sha256-g1: and 64 lowercase hexadecimal digits)\n`;
    case 'unknown-generation':
      return `${file}: unknown generation ${result.generation} (this version knows ${GENERATION})\n`;
    default:
      return `${file}: the seal does not verify\n  stored:   ${result.stored}\n  computed: ${result.computed}\n`;
  }
}

const usageError = { code: 2, stdout: '', stderr: USAGE };

function runSeal(args, readFile) {
  const verifying = args[0] === '--verify';
  if (verifying) args.shift();
  if (args.length !== 1 || args[0].startsWith('-')) return usageError;
  const [file] = args;
  let bytes;
  try {
    bytes = readFile(file);
  } catch (error) {
    return { code: 2, stdout: '', stderr: `record-keeper: cannot read ${file}: ${error.message}\n` };
  }
  if (verifying) {
    const result = verify(bytes);
    return result.ok
      ? { code: 0, stdout: `${file}: the seal verifies\n`, stderr: '' }
      : { code: 1, stdout: '', stderr: describeFailure(file, result) };
  }
  try {
    return { code: 0, stdout: `${seal(bytes)}\n`, stderr: '' };
  } catch (error) {
    if (!(error instanceof Reject)) throw error;
    return { code: 1, stdout: '', stderr: describeFailure(file, { reason: 'rejected', rule: error.rule }) };
  }
}

/** The options that take a value, read from `args`: { values: Map option -> [values], rest: arguments that are not options }, or null for wrong usage. */
function readOptions(args, names) {
  const values = new Map();
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (names.includes(args[i])) {
      const value = args[++i];
      if (value === undefined || value === '' || value.startsWith('-')) return null;
      values.set(args[i - 1], [...(values.get(args[i - 1]) ?? []), value]);
    } else if (args[i].startsWith('-')) return null;
    else rest.push(args[i]);
  }
  return { values, rest };
}

const problemWord = (count) => `${count} problem${count === 1 ? '' : 's'}`;
const settingLine = ({ file, line, rule, detail }) => `${file}${line === null ? '' : `:${line}`}: [${rule}] ${SETTINGS_RULES[rule]}${detail ? ` (${detail})` : ''}\n`;

function runValidate(args) {
  const options = readOptions(args, ['--extra-key', '--shared-folder', '--commit', '--repo', '--settings-from']);
  if (!options || options.rest.length > 1) return usageError;
  const only = (name) => options.values.get(name)?.at(-1);
  const commit = only('--commit');
  const repo = only('--repo');
  const settingsFrom = only('--settings-from');
  let folder = options.rest[0];
  let settings = { extraKeys: options.values.get('--extra-key') ?? [], sharedFolder: only('--shared-folder') };
  if (repo !== undefined && commit === undefined) return usageError;
  if (settingsFrom !== undefined && (commit === undefined || folder !== undefined || settings.extraKeys.length > 0 || settings.sharedFolder !== undefined)) return usageError;
  let problems;
  let settingProblems = [];
  try {
    if (settingsFrom !== undefined) {
      const read = readSettings(openCommit(repo ?? '.', settingsFrom));
      ({ folder, ...settings } = read.settings);
      settingProblems = read.problems;
    }
    folder ??= 'docs/decisions';
    problems = commit === undefined ? validate(folder, settings) : validateCommit(repo ?? '.', commit, folder, settings);
  } catch (error) {
    if (!(error instanceof Unreadable)) throw error;
    return { code: 2, stdout: '', stderr: `record-keeper: ${error.message}\n` };
  }
  const where = (file) => (file === null ? folder : path.join(folder, file));
  const lines = [...settingProblems.map(settingLine), ...problems.map(({ file, rule, detail }) => `${where(file)}: [${rule}] ${FORMAT_RULES[rule] ?? COMMIT_RULES[rule]}${detail ? ` (${detail})` : ''}\n`)];
  const count = `${folder}: ${problemWord(lines.length)}\n`;
  return lines.length === 0 ? { code: 0, stdout: count, stderr: '' } : { code: 1, stdout: '', stderr: lines.join('') + count };
}

function runConfig(args) {
  const options = readOptions(args, ['--commit', '--repo']);
  if (!options || options.rest.length > 0 || !options.values.has('--commit')) return usageError;
  let read;
  try {
    read = readSettings(openCommit(options.values.get('--repo')?.at(-1) ?? '.', options.values.get('--commit').at(-1)));
  } catch (error) {
    if (!(error instanceof Unreadable)) throw error;
    return { code: 2, stdout: '', stderr: `record-keeper: ${error.message}\n` };
  }
  const { folder, sharedFolder, extraKeys } = read.settings;
  const shown = `folder: ${folder}\nshared-folder: ${sharedFolder}\nextra-keys: [${extraKeys.join(', ')}]\n`;
  const count = `${SETTINGS_PATH}: ${problemWord(read.problems.length)}\n`;
  return read.problems.length === 0 ? { code: 0, stdout: shown + count, stderr: '' } : { code: 1, stdout: shown, stderr: read.problems.map(settingLine).join('') + count };
}

/** The command line, without the process around it. Returns { code, stdout, stderr }. */
export function run(argv, { readFile = fs.readFileSync } = {}) {
  const args = [...argv];
  if (args[0] === '--help' || args[0] === '-h') return { code: 0, stdout: USAGE, stderr: '' };
  const command = args.shift();
  if (command === 'seal') return runSeal(args, readFile);
  if (command === 'validate') return runValidate(args);
  if (command === 'config') return runConfig(args);
  return usageError;
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
