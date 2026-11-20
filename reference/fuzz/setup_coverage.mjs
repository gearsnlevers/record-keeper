// Which lines of the core of the setup check a fuzz run never ran. Usage: setup_coverage.mjs <coverage folder> [<setup-check.mjs>]
// The folder is the one that NODE_V8_COVERAGE names when setup_compare.mjs is run: V8 counts every block, and a block that was never entered has the count 0.
// The core is the part of setup-check.mjs that decides (from `parseUtc` to the part that prints); the text, what is printed and the runner are not run by the fuzz,
// and the tests run them. A line that is listed has some code on it that no input reached.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [folder, file = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../setup-check.mjs')] = process.argv.slice(2);
const source = fs.readFileSync(file, 'utf8');
const url = `file://${fs.realpathSync(file)}`;
const counts = new Array(source.length).fill(null);
let found = false;
for (const name of fs.readdirSync(folder).filter((entry) => entry.endsWith('.json'))) {
  const { result } = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
  for (const script of result.filter((entry) => entry.url === url)) {
    found = true;
    // An outer range first, then the ranges inside it: the innermost range has the last word, as V8 means it.
    const ranges = script.functions.flatMap((fn) => fn.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
    for (const range of ranges) for (let at = range.startOffset; at < range.endOffset; at++) counts[at] = range.count;
  }
}
if (!found) {
  console.log('no coverage of setup-check.mjs in that folder');
  process.exit(2);
}
const lines = source.split('\n');
const first = lines.findIndex((line) => line.startsWith('export function parseUtc'));
const last = lines.findIndex((line) => line.startsWith('// What is printed'));
let offset = 0;
const never = [];
let ran = 0;
for (const [index, line] of lines.entries()) {
  if (index >= first && index < last) {
    const code = line.trimStart();
    const comment = code.startsWith('//') || code.startsWith('*') || code.startsWith('/**') || code === '' || code === '}' || code === '});' || code === '};';
    if (!comment) {
      const dead = [...line].some((character, at) => counts[offset + at] === 0 && character.trim() !== '');
      if (dead) never.push(`${index + 1}: ${code.slice(0, 150)}`);
      else ran += 1;
    }
  }
  offset += line.length + 1;
}
console.log(`${ran} lines of the core ran in full, ${never.length} have code that never ran`);
for (const line of never) console.log(`  never ran: ${line}`);
process.exitCode = never.length === 0 ? 0 : 1;
