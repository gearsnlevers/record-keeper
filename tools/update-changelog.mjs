// Prepends a release section to CHANGELOG.md. The release workflow runs it when no key for the AI changelog is set and the notes are the ones that
// GitHub generates (docs/releases.md). It is the only thing that writes the changelog in that case, and it never removes anything from it.
//
//   node tools/update-changelog.mjs --tag v1.2.0 --notes RELEASE_NOTES.md [--file CHANGELOG.md] [--date 2026-11-17]
//
// Exit status: 0 when the section was added, 1 when it was refused (the tag has a section already, or the file cannot be read or written), 2 for wrong usage.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HEADER = '# Changelog\n';
const USAGE = 'Usage:\n  update-changelog.mjs --tag <tag> --notes <file> [--file <changelog>] [--date <YYYY-MM-DD>]\n';
const TAG = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Moves every heading in the notes one level down: GitHub's generated notes start with `## What's Changed`, which would sit at the level of the release
 * heading that it belongs under. A heading inside a fenced code block is left alone, and so is one that is already at the fifth level.
 */
export function demoteHeadings(notes) {
  let fenced = false;
  return String(notes)
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      return !fenced && /^#{1,5}\s/.test(line) ? `#${line}` : line;
    })
    .join('\n');
}

/** The changelog with a new section for `tag` below the title and above the older sections. Throws if the tag has a section already. */
export function addRelease(existing, { tag, date, notes }) {
  const heading = `## [${tag}] - ${date}`;
  const text = existing && existing.trim() ? existing : HEADER;
  if (text.split('\n').some((line) => line.startsWith(`## [${tag}]`))) throw new Error(`CHANGELOG already has a section for ${tag}`);
  const section = `${heading}\n\n${demoteHeadings(String(notes).trim())}\n`;
  const lines = text.split('\n');
  const titleIdx = lines.findIndex((l) => /^# /.test(l));
  if (titleIdx === -1) return `${HEADER}\n${section}\n${text}`;
  // Before the first older section, or at the end of the text that comes before it. What is there is kept as it is: only the empty lines between the new
  // section and what comes before it are made one, and the file ends with one line feed.
  let at = lines.findIndex((l, i) => i > titleIdx && /^## /.test(l));
  if (at === -1) at = lines.length;
  const before = lines.slice(0, at).join('\n').replace(/\n*$/, '\n');
  const after = lines.slice(at).join('\n');
  return `${before}\n${section}${after === '' ? '' : `\n${after}`}`.replace(/\n*$/, '\n');
}

/** The command line, without the process around it. Returns { code, stdout, stderr }. */
export function run(argv, { cwd = process.cwd(), today = () => new Date().toISOString().slice(0, 10) } = {}) {
  const wanted = new Set(['--tag', '--notes', '--file', '--date']);
  const given = new Map();
  for (let at = 0; at < argv.length; at += 2) {
    if (!wanted.has(argv[at]) || given.has(argv[at]) || at + 1 >= argv.length) return { code: 2, stdout: '', stderr: USAGE };
    given.set(argv[at], argv[at + 1]);
  }
  if (!given.has('--tag') || !given.has('--notes')) return { code: 2, stdout: '', stderr: USAGE };
  const tag = given.get('--tag');
  const date = given.get('--date') ?? today();
  const refuse = (message) => ({ code: 1, stdout: '', stderr: `update-changelog: ${message}\n` });
  if (!TAG.test(tag)) return refuse(`${JSON.stringify(tag)} is not a tag like v1.2.3`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return refuse(`${JSON.stringify(date)} is not a date like 2026-11-17`);
  const file = path.resolve(cwd, given.get('--file') ?? 'CHANGELOG.md');
  let notes;
  try {
    notes = fs.readFileSync(path.resolve(cwd, given.get('--notes')), 'utf8');
  } catch (error) {
    return refuse(`${given.get('--notes')}: cannot be read (${error.code ?? error.message})`);
  }
  if (notes.trim() === '') return refuse(`${given.get('--notes')}: has no notes`);
  try {
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    fs.writeFileSync(file, addRelease(existing, { tag, date, notes }));
  } catch (error) {
    return refuse(error.message);
  }
  return { code: 0, stdout: `added ${tag} to ${given.get('--file') ?? 'CHANGELOG.md'}\n`, stderr: '' };
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
