// Reference implementation 2 of `validate`, written from docs/record-format.md only (g1 comes from g1.mjs).
// validate(dir, { extraKeys, sharedFolder }) -> [{ file, rule, g1? }]
import fs from 'node:fs';
import path from 'node:path';
import { check, Reject } from './g1.mjs';

const SIX = ['Context and problem statement', 'Decision', 'Consequences', 'Known deviations', 'Alternatives considered', 'Errata'];
const REQUIRED = SIX.slice(0, 3);
const LIST_KEYS = new Set(['decision-makers', 'applies-to', 'issues', 'supersedes']);
const VALUE_KEYS = new Set(['status', 'date', 'seal', 'emergency']);
const STANDARD = new Set([...LIST_KEYS, ...VALUE_KEYS]);
const CREDENTIAL = /ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const RECORD_NAME = /^(\d{4})-[a-z0-9]+(-[a-z0-9]+)*\.md$/;

function fencedLines(lines) {
  const flags = [];
  let run = 0;
  for (const line of lines) {
    if (run === 0) {
      const open = /^(`{3,})[^`]*$/.exec(line);
      run = open ? open[1].length : 0;
      flags.push(run > 0);
    } else {
      flags.push(true);
      const close = /^(`+)$/.exec(line);
      if (close && close[1].length >= run) run = 0;
    }
  }
  return flags;
}

function realDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dim = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= dim[mo - 1];
}

export function validate(dir, { extraKeys = [], sharedFolder = 'shared' } = {}) {
  const problems = [];
  const report = (file, rule, g1) => problems.push(g1 ? { file, rule, g1 } : { file, rule });
  let stat;
  try { stat = fs.statSync(dir); } catch { stat = null; }
  if (!stat || !stat.isDirectory()) { report(null, 'V-01'); return problems; }

  // the folder
  const names = fs.readdirSync(dir).filter((n) => !n.startsWith('.')).sort();
  const records = [];
  let readme = false;
  let template = false;
  for (const name of names) {
    const st = fs.lstatSync(path.join(dir, name));
    if (st.isSymbolicLink() || !(st.isFile() || st.isDirectory())) { report(name, 'V-04'); continue; }
    if (st.isDirectory()) { if (name !== sharedFolder) report(name, 'V-06'); continue; }
    if (name === 'README.md') readme = true;
    else if (name === 'template.md') template = true;
    else if (RECORD_NAME.test(name)) records.push({ name, number: Number(name.slice(0, 4)) });
    else report(name, 'V-05');
  }
  if (!readme) report('README.md', 'V-02');
  if (!template) report('template.md', 'V-03');
  const seen = new Set();
  for (const r of records) {
    if (seen.has(r.number)) report(r.name, 'V-07');
    seen.add(r.number);
  }
  const distinct = [...seen].sort((a, b) => a - b);
  const gap = distinct.findIndex((n, i) => n !== i + 1);
  if (gap >= 0) report(null, 'V-08');
  const exists = new Set(records.map((r) => r.number));

  // each record
  const facts = new Map(); // name -> { status, title } as far as they can be judged against the index
  for (const { name, number } of records) {
    let parsed;
    try { parsed = check(fs.readFileSync(path.join(dir, name))); } catch (e) {
      if (!(e instanceof Reject)) throw e;
      report(name, 'V-09', e.rule);
      facts.set(name, { status: null, title: null });
      continue;
    }
    const { lines, end } = parsed;
    const text = lines.join('\n');
    const count = lines.length - (lines.at(-1) === '' ? 1 : 0);
    if (count > 60) report(name, 'V-10');
    if (CREDENTIAL.test(text)) report(name, 'V-11');
    if (EMAIL.test(text)) report(name, 'V-12');

    // the entries of the front matter
    const entries = [];
    for (const line of lines.slice(1, end)) {
      const key = /^([A-Za-z][A-Za-z0-9_-]*):(?: (.*))?$/.exec(line);
      if (key) entries.push({ key: key[1], value: (key[2] ?? '').replace(/^ +/, ''), rest: [] });
      else entries.at(-1).rest.push(line);
    }
    for (const e of entries) {
      const items = e.rest.map((l) => /^ +- +(\S.*)$/.exec(l));
      if (e.value === '' && e.rest.length === 0) e.shape = 'empty';
      else if (e.rest.length === 0) e.shape = 'single';
      else if (e.value === '' && items.every(Boolean)) { e.shape = 'list'; e.items = items.map((m) => m[1]); }
      else e.shape = 'mixed';
    }
    const byKey = new Map(entries.map((e) => [e.key, e]));
    for (const e of entries) if (!STANDARD.has(e.key) && !extraKeys.includes(e.key)) report(name, 'V-13');
    for (const e of entries) {
      if ((LIST_KEYS.has(e.key) && e.shape === 'single') || (VALUE_KEYS.has(e.key) && e.shape === 'list')) report(name, 'V-14');
    }
    for (const e of entries) if (e.shape === 'empty') report(name, 'V-15');
    for (const e of entries) if (e.shape === 'mixed') report(name, 'V-16');
    for (const k of ['status', 'date', 'decision-makers']) if (!byKey.has(k)) report(name, 'V-17');

    const single = (k) => (byKey.get(k)?.shape === 'single' ? byKey.get(k).value : null);
    const status = single('status');
    let judgeable = null;
    if (status !== null) {
      const sup = /^superseded by (\d{4})$/.exec(status);
      if (status === 'deprecated') report(name, 'V-19');
      else if (!(status === 'proposed' || status === 'accepted' || status === 'rejected' || sup)) report(name, 'V-18');
      else {
        judgeable = status;
        if (sup && (!exists.has(Number(sup[1])) || Number(sup[1]) <= number)) report(name, 'V-20');
      }
    }
    const date = single('date');
    if (date !== null && !realDate(date)) report(name, 'V-21');
    const seal = single('seal');
    if (seal !== null && !/^sha256-g[0-9]+:[0-9a-f]{64}$/.test(seal)) report(name, 'V-22');
    const emergency = single('emergency');
    if (emergency !== null && [...emergency].length > 500) report(name, 'V-37');
    const issues = byKey.get('issues');
    if (issues?.shape === 'list') for (const item of issues.items) if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[0-9]+$/.test(item)) report(name, 'V-23');
    const sup2 = byKey.get('supersedes');
    if (sup2?.shape === 'list') {
      for (const item of sup2.items) {
        if (!/^[0-9]{4}$/.test(item)) report(name, 'V-35');
        else if (!exists.has(parseInt(item, 10)) || parseInt(item, 10) >= number) report(name, 'V-36');
      }
    }

    // the body
    const body = lines.slice(end + 1);
    const fenced = fencedLines(body);
    const firstLine = body.find((l) => l !== '');
    let title = null;
    if (firstLine === undefined || !/^# \S/.test(firstLine)) report(name, 'V-24');
    else title = firstLine.slice(2);
    const headings = [];
    body.forEach((l, i) => { if (!fenced[i] && l.startsWith('## ')) headings.push({ at: i, name: l.slice(3) }); });
    for (const h of headings) if (!SIX.includes(h.name)) report(name, 'V-25');
    for (const s of REQUIRED) if (!headings.some((h) => h.name === s)) report(name, 'V-26');
    const positions = headings.filter((h) => SIX.includes(h.name)).map((h) => SIX.indexOf(h.name));
    if (positions.some((p, i) => i > 0 && p <= positions[i - 1])) report(name, 'V-27');
    headings.forEach((h, i) => {
      const until = i + 1 < headings.length ? headings[i + 1].at : body.length;
      if (body.slice(h.at + 1, until).every((l) => l === '')) report(name, 'V-28');
    });
    facts.set(name, { status: judgeable, title });
  }

  // the index
  if (readme) {
    const lines = fs.readFileSync(path.join(dir, 'README.md'), 'utf8').replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, ''));
    const fenced = fencedLines(lines);
    const start = lines.findIndex((l, i) => !fenced[i] && l === '## Index');
    if (start < 0) { report('README.md', 'V-29'); return problems; }
    let stop = lines.length;
    for (let i = start + 1; i < lines.length; i++) if (!fenced[i] && (lines[i].startsWith('# ') || lines[i].startsWith('## '))) { stop = i; break; }
    const rows = lines.slice(start + 1, stop).filter((l) => l.startsWith('|'));
    const linksOf = new Map();
    for (const row of rows) {
      const link = /\]\((\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md)\)/.exec(row);
      if (!link) continue;
      if (!linksOf.has(link[1])) linksOf.set(link[1], []);
      linksOf.get(link[1]).push(row);
    }
    const known = new Set(records.map((r) => r.name));
    for (const [target, rs] of linksOf) if (!known.has(target)) for (let i = 0; i < rs.length; i++) report('README.md', 'V-32');
    for (const { name } of records) {
      const rs = linksOf.get(name) ?? [];
      if (rs.length === 0) { report(name, 'V-30'); continue; }
      if (rs.length > 1) report(name, 'V-31');
      const pieces = rs[0].split('|').slice(1);
      if (pieces.length > 0 && pieces.at(-1).trim() === '') pieces.pop();
      const cells = pieces.map((c) => c.trim());
      const { status, title } = facts.get(name);
      if (status !== null && !cells.includes(status)) report(name, 'V-33');
      const linkTexts = [...rs[0].matchAll(/\[([^\]]*)\]\(/g)].map((m) => m[1]);
      if (title !== null && !cells.includes(title) && !linkTexts.includes(title)) report(name, 'V-34');
    }
  }
  return problems;
}
