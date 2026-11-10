// usage: node g1_run_node.mjs <impl.mjs> <mutants.json> <out.json>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const impl = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const sealFn = impl.sealG1 ?? impl.seal;
const items = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const res = items.map((s) => {
  try { return 'S:' + sealFn(Buffer.from(s, 'base64')); } catch (e) { if (e.rule) return 'R:' + e.rule; throw e; }
});
fs.writeFileSync(process.argv[4], JSON.stringify(res));
