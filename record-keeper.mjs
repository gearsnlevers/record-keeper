// Record Keeper: reads a decision record, puts it into canonical form, seals it and verifies a seal.
//
// One file, no dependencies, no network. It implements generation g1 exactly as docs/generation-g1.md
// describes it; test/vectors/g1 holds the answers it must give. It never writes a file: `seal` only prints.
//
//   node record-keeper.mjs seal <file>             print the seal of a record
//   node record-keeper.mjs seal --verify <file>    check the `seal:` line of a record against its text
//
// Exit status: 0 success, 1 the record is rejected or its seal does not verify, 2 wrong usage or unreadable file.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
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

const USAGE = `Usage:
  record-keeper.mjs seal <file>             print the ${GENERATION} seal of a record
  record-keeper.mjs seal --verify <file>    check the seal: line of a record against its text
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

/** The command line, without the process around it. Returns { code, stdout, stderr }. */
export function run(argv, { readFile = fs.readFileSync } = {}) {
  const args = [...argv];
  if (args[0] === '--help' || args[0] === '-h') return { code: 0, stdout: USAGE, stderr: '' };
  const command = args.shift();
  const verifying = args[0] === '--verify';
  if (verifying) args.shift();
  if (command !== 'seal' || args.length !== 1 || args[0].startsWith('-')) return { code: 2, stdout: '', stderr: USAGE };
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
