// Which lines of the block functions of the updater (from `STEMS` to the end of `blockChanged`) a fuzz run never ran. Usage: agent_coverage.mjs <coverage folder> [<updater.mjs>]
// The folder is the one that NODE_V8_COVERAGE names when agent_compare.mjs is run. A line that is listed has some code on it that no input reached.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [folder, file = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../updater.mjs')] = process.argv.slice(2);
const source = fs.readFileSync(file, 'utf8');
const url = `file://${fs.realpathSync(file)}`;
const counts = new Array(source.length).fill(null);
let found = false;
for (const name of fs.readdirSync(folder).filter((entry) => entry.endsWith('.json'))) {
  const { result } = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
  for (const script of result.filter((entry) => entry.url === url)) {
    found = true;
    const ranges = script.functions.flatMap((fn) => fn.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
    for (const range of ranges) for (let at = range.startOffset; at < range.endOffset; at++) counts[at] = range.count;
  }
}
if (!found) {
  console.log('no coverage of updater.mjs in that folder');
  process.exit(2);
}
const lines = source.split('\n');
const first = lines.findIndex((line) => line.startsWith('const STEMS'));
const last = lines.findIndex((line) => line.startsWith('// The plan'));
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
console.log(`${ran} lines of the block functions ran in full, ${never.length} have code that never ran`);
for (const line of never) console.log(`  never ran: ${line}`);
process.exitCode = never.length === 0 ? 0 : 1;
