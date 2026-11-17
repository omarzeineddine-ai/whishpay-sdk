// Turns raw sandbox recordings (spike/raw, git-ignored) into scrubbed fixtures
// for the contract tests. Run: node scripts/scrub-fixtures.mjs
// tests/fixtures/ stays git-ignored until Whish approves publishing them.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const rawDir = new URL('../spike/raw/', import.meta.url);
const outDir = new URL('../tests/fixtures/', import.meta.url);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const SENSITIVE = [process.env.WHISH_CHANNEL, process.env.WHISH_SECRET, process.env.WHISH_WEBSITE_URL].filter(Boolean);

let count = 0;
for (const name of readdirSync(rawDir).filter((f) => f.endsWith('.json')).sort()) {
  const { request, response } = JSON.parse(readFileSync(new URL(name, rawDir), 'utf8'));
  delete response.ms;
  let text = JSON.stringify({ label: name.replace(/^\d+-|\.json$/g, ''), request, response }, null, 2);
  text = text
    .replace(/(\/pay\/)[A-Za-z0-9]+/g, '$1TOKEN') // payment link tokens
    .replace(/"payerPhoneNumber": "\+?\d+"/g, '"payerPhoneNumber": "96170000000"');
  for (const value of SENSITIVE) text = text.split(value).join('REDACTED');
  if (/"(secret|channel|websiteurl)"\s*:/i.test(text)) throw new Error(`${name}: looks like it contains credentials or headers`);
  writeFileSync(new URL(name, outDir), text + '\n');
  count++;
}
console.log(`wrote ${count} fixtures to tests/fixtures/`);
