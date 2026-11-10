import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(path.resolve(process.env.YAML_DIR) + '/');
const YAML = require('yaml');
for (const line of fs.readFileSync(0, 'utf8').split('\n').filter(Boolean)) {
  const text = Buffer.from(JSON.parse(line).hex, 'hex').toString('utf8');
  try {
    const value = YAML.parse(text, { version: '1.2', strict: true, uniqueKeys: false });
    console.log(JSON.stringify({ ok: value }));
  } catch (error) {
    console.log(JSON.stringify({ err: error.name }));
  }
}
