// Reference implementation 2 of generation g1 (Node), written from docs/generation-g1.md only.
import { createHash } from 'node:crypto';

export class Reject extends Error {
  constructor(rule) { super(rule); this.rule = rule; }
}

const EXCLUDED_KEYS = ['status', 'date', 'seal'];
const SECTION_HEADINGS = new Map([['known deviations', '## Known deviations'], ['errata', '## Errata']]);
const asciiLower = (s) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

function decode(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Reject('G1-01');
  }
}

function fenceMarks(lines) {
  // returns { fenced: boolean[], open: boolean } for the given body lines
  const fenced = [];
  let need = 0;
  for (const line of lines) {
    if (need === 0) {
      const m = /^(`{3,})[^`]*$/.exec(line);
      if (m) { need = m[1].length; fenced.push(true); } else fenced.push(false);
    } else {
      fenced.push(true);
      const m = /^(`+)$/.exec(line);
      if (m && m[1].length >= need) need = 0;
    }
  }
  return { fenced, open: need !== 0 };
}

function keyLine(line) {
  const m = /^([A-Za-z][A-Za-z0-9_-]*):(?: (.*))?$/.exec(line);
  return m ? { key: m[1], value: (m[2] ?? '').replace(/^ +/, '') } : null;
}

export function check(bytes) {
  const text = decode(bytes);
  if (text.includes('\ufeff')) throw new Reject('G1-02');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(text)) throw new Reject('G1-03');
  if (/[\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(text)) throw new Reject('G1-04');
  if (/\r(?!\n)/.test(text)) throw new Reject('G1-05');
  if (text.includes('<!--')) throw new Reject('G1-06');
  const lines = text.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, ''));
  if (lines[0] !== '---') throw new Reject('G1-07');
  const end = lines.indexOf('---', 1);
  if (end === -1) throw new Reject('G1-08');
  const fm = lines.slice(1, end);
  // key lines with the continuation lines they own
  const entries = [];
  for (const line of fm) {
    const k = keyLine(line);
    if (k) entries.push({ ...k, owned: [] });
    else if (/^ +[^ \t]/.test(line) && entries.length) entries[entries.length - 1].owned.push(line);
    else throw new Reject('G1-09');
  }
  const seen = new Set();
  for (const e of entries) {
    const low = asciiLower(e.key);
    if (seen.has(low)) throw new Reject('G1-10');
    seen.add(low);
  }
  for (const e of entries) {
    if (EXCLUDED_KEYS.includes(asciiLower(e.key)) && e.key !== asciiLower(e.key)) throw new Reject('G1-11');
  }
  for (const e of entries) {
    if (EXCLUDED_KEYS.includes(e.key) && (e.value === '' || e.owned.length > 0)) throw new Reject('G1-12');
  }
  for (const e of entries) {
    const starts = [e.value, ...e.owned.map((l) => l.replace(/^ +/, '').replace(/^- +/, ''))];
    if (starts.some((v) => v !== '' && '&*!|>'.includes(v[0]))) throw new Reject('G1-13');
  }
  const body = lines.slice(end + 1);
  // G1-14 and G1-15, with the fence state of the body
  let need = 0;
  for (const line of body) {
    if (need === 0) {
      if (/^[ \t]*~{3,}/.test(line) || /^[ \t]+`{3,}/.test(line)) throw new Reject('G1-14');
      const m = /^(`{3,})[^`]*$/.exec(line);
      if (m) need = m[1].length;
    } else {
      const m = /^(`+)$/.exec(line);
      if (m && m[1].length >= need) need = 0;
    }
  }
  if (need !== 0) throw new Reject('G1-15');
  const { fenced } = fenceMarks(body);
  const autolink = /^ {0,3}<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^ \t<>]*>/;
  body.forEach((line, i) => {
    if (!fenced[i] && /^ {0,3}<[A-Za-z/!?]/.test(line) && !autolink.test(line)) throw new Reject('G1-16');
  });
  body.forEach((line, i) => {
    if (fenced[i] || i === 0 || !/^ {0,3}(=+|-+)[ \t]*$/.test(line)) return;
    const prev = body[i - 1];
    if (prev !== '' && !fenced[i - 1] && !/^ {0,3}#{1,6}([ \t]|$)/.test(prev)) throw new Reject('G1-17');
  });
  const hits = new Map();
  lines.forEach((line, i) => {
    const norm = asciiLower(line.replace(/^[ \t#]+/, '').replace(/[ \t#]+$/, ''));
    if (!SECTION_HEADINGS.has(norm)) return;
    if (line !== SECTION_HEADINGS.get(norm) || fenced[i - end - 1]) throw new Reject('G1-18');
    hits.set(norm, [...(hits.get(norm) ?? []), i]);
  });
  for (const v of hits.values()) if (v.length > 1) throw new Reject('G1-19');
  if (hits.has('errata') && hits.has('known deviations') && hits.get('errata')[0] < hits.get('known deviations')[0]) throw new Reject('G1-19');
  for (const v of hits.values()) for (const i of v) if (lines[i - 1] !== '') throw new Reject('G1-20');
  return { lines, end };
}

export function canonical(bytes) {
  const { lines, end } = check(bytes);
  const head = lines.slice(0, end + 1).filter((l, i) => {
    if (i === 0 || i === end) return true;
    const k = keyLine(l);
    return !(k && EXCLUDED_KEYS.includes(k.key));
  });
  const body = lines.slice(end + 1);
  const { fenced } = fenceMarks(body);
  const kept = [];
  let cutting = false;
  body.forEach((line, i) => {
    if (!fenced[i] && /^ {0,3}#{1,2}([ \t]|$)/.test(line)) cutting = [...SECTION_HEADINGS.values()].includes(line);
    if (!cutting) kept.push({ line, fenced: fenced[i] });
  });
  const out = [];
  let lastEmpty = false;
  for (const { line, fenced: f } of kept) {
    const empty = line === '' && !f;
    if (empty && lastEmpty) continue;
    lastEmpty = empty;
    out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return [...head, ...out].join('\n') + '\n';
}

export const sealG1 = (bytes) => 'sha256-g1:' + createHash('sha256').update(canonical(bytes), 'utf8').digest('hex');
