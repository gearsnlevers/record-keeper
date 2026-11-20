// Runs the block functions of the updater on every line of an agent_fuzz.py file and compares the answer with the Python reference, and checks on the library's own answers
// what the updater counts on: the block that was put in is found and is the block, a second splice changes nothing, and not a byte outside the markers changes.
// Usage: agent_compare.mjs <in.jsonl>
import fs from 'node:fs';
import { blockChanged, blockOf, readBlock, spliceBlock } from '../../updater.mjs';

const bytes = (hex) => (hex === null ? null : Buffer.from(hex, 'hex'));
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
let different = 0;
let broken = 0;
const say = (kind, index, text, extra) => {
  if (kind === 'differ' ? different++ < 10 : broken++ < 10) console.log(kind === 'differ' ? 'DIFFERENT' : 'BROKEN', index, text.slice(0, 400), extra ?? '');
};
for (const [index, text] of lines.entries()) {
  const line = JSON.parse(text);
  if (line.k === 'read') {
    const got = readBlock(bytes(line.in));
    if (JSON.stringify(Object.entries(got).sort()) !== JSON.stringify(Object.entries(line.expect).sort())) say('differ', index, text, JSON.stringify(got));
    // the text of the block, which the setup check and the plan read: the bytes between the markers, or nothing
    const found = blockOf(bytes(line.in));
    if (line.expect.state === 'one' ? found === null || !found.equals(bytes(line.in).subarray(line.expect.start, line.expect.end)) : found !== null) say('differ', index, text, 'blockOf');
  } else if (line.k === 'splice') {
    const current = bytes(line.cur);
    const block = bytes(line.block);
    const got = spliceBlock(current, block);
    const shown = got.ok ? { ok: true, action: got.action, output: got.output.toString('hex') } : got;
    if (JSON.stringify(Object.entries(shown).sort()) !== JSON.stringify(Object.entries(line.expect).sort())) say('differ', index, text, JSON.stringify(shown).slice(0, 300));
    if (got.ok) {
      const found = readBlock(got.output);
      const old = current === null ? null : readBlock(current);
      const fine = found.state === 'one' && got.output.subarray(found.start, found.end).equals(block)
        && spliceBlock(got.output, block).action === 'current' && spliceBlock(got.output, block).output.equals(got.output)
        && (got.action !== 'replace' || (got.output.subarray(0, found.start).equals(current.subarray(0, old.start)) && got.output.subarray(found.end).equals(current.subarray(old.end)) && found.start === old.start))
        && (got.action !== 'append' || got.output.subarray(0, current.length).equals(current))
        && (got.action !== 'current' || got.output.equals(current));
      if (!fine) say('broken', index, text);
    }
  } else {
    const got = blockChanged(bytes(line.a), bytes(line.b));
    if (got !== line.expect) say('differ', index, text, String(got));
    if (blockChanged(bytes(line.b), bytes(line.a)) !== got) say('broken', index, text, 'not symmetric');
  }
}
console.log(lines.length, 'inputs,', different, 'differences,', broken, 'broken');
process.exitCode = different || broken ? 1 : 0;
