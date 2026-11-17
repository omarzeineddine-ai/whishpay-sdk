// Callback spike. Run: npm run build && node --env-file=.env spike/callbacks.mjs
// Opens a cloudflared quick tunnel to a local listener, creates three sandbox
// payments, prints their links, and logs every callback Whish sends.
// Raw log: spike/raw/callbacks.log (git-ignored).
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { Whish, generateExternalId } from '../dist/index.js';

const PORT = 8787;
const WATCH_MS = Number(process.env.SPIKE_WATCH_MS ?? 7 * 60_000);
mkdirSync(new URL('./raw/', import.meta.url), { recursive: true });
const logFile = new URL('./raw/callbacks.log', import.meta.url);
const t0 = Date.now();
const log = (line) => {
  const text = `[+${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s] ${line}`;
  console.log(text);
  appendFileSync(logFile, text + '\n');
};

createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  const code = url.pathname.includes('reply500') ? 500 : 200;
  log(
    `CALLBACK ${req.method} ${req.url} -> replied ${code} | ip=${req.headers['cf-connecting-ip'] ?? '?'} ` +
      `ua=${req.headers['user-agent'] ?? '?'}`,
  );
  res.writeHead(code, { 'content-type': 'text/plain' }).end(code === 200 ? 'ok' : 'error');
}).listen(PORT);

const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
const publicUrl = await new Promise((resolve, reject) => {
  const onData = (chunk) => {
    const match = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) resolve(match[0]);
  };
  tunnel.stdout.on('data', onData);
  tunnel.stderr.on('data', onData);
  tunnel.on('exit', (code) => reject(new Error(`cloudflared exited (${code})`)));
  setTimeout(() => reject(new Error('no tunnel URL after 30s')), 30_000);
});
log(`tunnel ${publicUrl}`);
// Quick tunnels take a few seconds before they route.
for (let i = 0; i < 20; i++) {
  const ok = await fetch(`${publicUrl}/warmup`).then((r) => r.ok, () => false);
  if (ok) break;
  await new Promise((r) => setTimeout(r, 1500));
}

const whish = new Whish({
  channel: process.env.WHISH_CHANNEL,
  secret: process.env.WHISH_SECRET,
  websiteUrl: process.env.WHISH_WEBSITE_URL,
  environment: 'sandbox',
  userAgent: 'WhishpaySdkSpike/0.1.0 (https://example.com; dev@example.com)',
});

const scenarios = [
  { name: 'A', action: 'click "Simulate Success"', path: 'cb' },
  { name: 'B', action: 'click "Simulate Failure"', path: 'cb' },
  { name: 'C', action: 'click "Simulate Success" (our handler replies 500)', path: 'reply500' },
];
for (const s of scenarios) {
  s.externalId = generateExternalId();
  const { collectUrl } = await whish.payments.create({
    amount: '5.00',
    currency: 'USD',
    externalId: s.externalId,
    invoice: `Callback spike ${s.name}`,
    successCallbackUrl: whish.callbacks.buildUrl(`${publicUrl}/${s.path}/success`, s.externalId, { scenario: s.name }),
    failureCallbackUrl: whish.callbacks.buildUrl(`${publicUrl}/${s.path}/failure`, s.externalId, { scenario: s.name }),
    successRedirectUrl: `${publicUrl}/redirect/success?scenario=${s.name}`,
    failureRedirectUrl: `${publicUrl}/redirect/failure?scenario=${s.name}`,
  });
  log(`LINK ${s.name}: ${collectUrl}   <- open and ${s.action}`);
}
log(`Links expire in about 5 minutes. Watching for ${Math.round(WATCH_MS / 60000)} minutes.`);

const last = {};
const deadline = Date.now() + WATCH_MS;
while (Date.now() < deadline) {
  for (const s of scenarios) {
    const r = await whish.payments.status({ externalId: s.externalId, currency: 'USD' }).catch((e) => ({
      status: `error:${e.code ?? e.name}`,
    }));
    const text = `${r.status}${r.payerPhoneNumber ? ` payer=${r.payerPhoneNumber.slice(0, 4)}…` : ''}`;
    if (last[s.name] !== text) log(`STATUS ${s.name}: ${text}`);
    last[s.name] = text;
  }
  await new Promise((r) => setTimeout(r, 5000));
}
log('done');
tunnel.kill();
process.exit(0);
