// Throwaway sandbox spike. Run: node --env-file=.env spike/spike.mjs
// Raw responses are written to spike/raw/ (git-ignored, unscrubbed).
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BASE = 'https://partner.api.sbx.whish.money/itel-service/api';
const OLD_BASE = 'https://lb.sandbox.whish.money/itel-service/api';
const UA = 'WhishpaySdkSpike/0.0.1 (https://example.com; dev@example.com)';
const PUBLIC = process.env.SPIKE_PUBLIC_URL ?? 'https://example.com';

const { WHISH_CHANNEL, WHISH_SECRET, WHISH_WEBSITE_URL } = process.env;
if (!WHISH_CHANNEL || !WHISH_SECRET || !WHISH_WEBSITE_URL) throw new Error('missing env');

mkdirSync(new URL('./raw/', import.meta.url), { recursive: true });
let n = 0;

async function call(label, { base = BASE, method = 'POST', path, body, headers = {}, secret = WHISH_SECRET }) {
  const h = {
    channel: WHISH_CHANNEL,
    secret,
    websiteUrl: WHISH_WEBSITE_URL,
    'User-Agent': UA,
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...headers,
  };
  for (const k of Object.keys(h)) if (h[k] === null) delete h[k];
  const started = Date.now();
  let out;
  try {
    const res = await fetch(base + path, {
      method,
      headers: h,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    out = {
      http: res.status,
      contentType: res.headers.get('content-type'),
      ms: Date.now() - started,
      body: json ?? text.slice(0, 400),
    };
  } catch (e) {
    out = { error: `${e.name}: ${e.message}`, cause: e.cause?.code, ms: Date.now() - started };
  }
  const file = `${String(++n).padStart(2, '0')}-${label}.json`;
  writeFileSync(new URL(`./raw/${file}`, import.meta.url), JSON.stringify({ request: { method, path, body }, response: out }, null, 2));
  console.log(`\n### ${label}\n${method} ${path} ${body ? JSON.stringify(body) : ''}\n${JSON.stringify(out, null, 1)}`);
  await new Promise((r) => setTimeout(r, 400));
  return out;
}

const urls = (id) => ({
  successCallbackUrl: `${PUBLIC}/cb/success?ref=${id}`,
  failureCallbackUrl: `${PUBLIC}/cb/failure?ref=${id}`,
  successRedirectUrl: `${PUBLIC}/done/success?ref=${id}`,
  failureRedirectUrl: `${PUBLIC}/done/failure?ref=${id}`,
});
const create = (label, body, extra) => call(label, { path: '/payment/whish', body, ...extra });

const numId = String(Date.now());
const uuid = randomUUID();

// Balance
await call('balance-usd', { method: 'GET', path: '/payment/account/balance?currency=USD' });
await call('balance-lbp', { method: 'GET', path: '/payment/account/balance?currency=LBP' });
await call('balance-no-currency', { method: 'GET', path: '/payment/account/balance' });

// Create + idempotency
const base1 = { amount: '5.00', currency: 'USD', invoice: 'Spike order', externalId: numId, ...urls(numId) };
await create('create-numeric-string-id', base1);
await create('create-resend-identical', base1);
await create('create-same-id-different-amount', { ...base1, amount: '9.00' });
await call('status-after-create', { path: '/payment/collect/status', body: { currency: 'USD', externalId: numId } });
await call('status-wrong-currency', { path: '/payment/collect/status', body: { currency: 'LBP', externalId: numId } });
await call('status-unknown-id', { path: '/payment/collect/status', body: { currency: 'USD', externalId: '1' + numId } });

// externalId and amount formats
await create('create-uuid-id', { ...base1, externalId: uuid, ...urls(uuid) });
const id3 = String(Date.now() + 1);
await create('create-number-types', { ...base1, amount: 5, externalId: Number(id3), ...urls(id3) });
const id4 = String(Date.now() + 2);
await create('create-lbp', { ...base1, amount: '150000', currency: 'LBP', externalId: id4, ...urls(id4) });
const id5 = String(Date.now() + 3);
await create('create-usd-3-decimals', { ...base1, amount: '5.123', externalId: id5, ...urls(id5) });
const id6 = String(Date.now() + 4);
await create('create-usd-below-min', { ...base1, amount: '0.50', externalId: id6, ...urls(id6) });
const id7 = String(Date.now() + 5);
await create('create-no-invoice', { ...base1, invoice: undefined, externalId: id7, ...urls(id7) });

// Validation / header behaviour
const id8 = String(Date.now() + 6);
await create('create-aed', { ...base1, currency: 'AED', externalId: id8, ...urls(id8) });
const id9 = String(Date.now() + 7);
await create('create-localhost-callback', { ...base1, externalId: id9, successCallbackUrl: 'http://localhost:3000/cb' });
const id10 = String(Date.now() + 8);
await create('create-ua-node-default', { ...base1, externalId: id10, ...urls(id10) }, { headers: { 'User-Agent': null } });
const id11 = String(Date.now() + 9);
await create('create-ua-garbage', { ...base1, externalId: id11, ...urls(id11) }, { headers: { 'User-Agent': 'x' } });
await call('balance-wrong-secret', { method: 'GET', path: '/payment/account/balance?currency=USD', secret: 'not-the-secret' });

// Refund (expected: auth.error or invalid_state)
await call('refund-pending-payment', { path: '/payment/whish/refund', body: { currency: 'USD', externalId: numId, refundReason: 'spike test' } });

// Earlier sandbox host
await call('old-host-balance', { base: OLD_BASE, method: 'GET', path: '/payment/account/balance' });

console.log(`\nIDs: numeric=${numId} uuid=${uuid}`);
