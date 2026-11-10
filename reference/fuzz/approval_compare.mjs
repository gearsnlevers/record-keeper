// Runs the library on every input of an approval_fuzz.py file and compares it with the Python reference. Usage: approval_compare.mjs <in.jsonl>
import fs from 'node:fs';
import { amendmentBar, countApprovals, readReviews, Unreadable } from '../../record-keeper.mjs';

const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
let different = 0;
for (const [index, text] of lines.entries()) {
  const input = JSON.parse(text);
  let got;
  if (input.kind === 'bar') {
    got = amendmentBar({ owners: input.owners, head: input.head, author: input.author, reviews: input.reviews, since: input.since === null ? undefined : input.since * 1000, now: input.now * 1000, waived: input.waived });
  } else if (input.kind === 'count') {
    got = countApprovals({ owners: input.owners, needed: input.needed, head: input.head, author: input.author, reviews: input.reviews });
  } else {
    try {
      got = { reviews: readReviews(Buffer.from(input.hex, 'hex')) };
    } catch (error) {
      if (!(error instanceof Unreadable)) throw error;
      got = { error: error.message };
    }
  }
  if (JSON.stringify(got) !== JSON.stringify(input.expect) && different++ < 10) console.log('DIFFERENT', index, text.slice(0, 400), '\n  library', JSON.stringify(got));
}
console.log(lines.length, 'inputs,', different, 'differences');
process.exitCode = different ? 1 : 0;
