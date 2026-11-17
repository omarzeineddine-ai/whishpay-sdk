// Exercises the built SDK against the real Whish sandbox.
// Run: npm run build && npm run smoke   (reads credentials from .env)
import {
  Whish,
  WhishApiError,
  WhishIdempotencyError,
  WhishValidationError,
  generateExternalId,
} from '../dist/index.js';

const whish = new Whish({
  channel: process.env.WHISH_CHANNEL,
  secret: process.env.WHISH_SECRET,
  websiteUrl: process.env.WHISH_WEBSITE_URL,
  environment: 'sandbox',
  userAgent: process.env.WHISH_USER_AGENT ?? 'WhishpaySdkSmoke/0.1.0 (https://example.com; dev@example.com)',
});

let failed = 0;
async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(`ok    ${name}${detail ? `  ${detail}` : ''}`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}  ${error?.name}: ${error?.message}`);
  }
}
const expectThrow = async (promise, test) => {
  const error = await promise.then(
    () => null,
    (e) => e,
  );
  if (!error || !test(error)) throw new Error(`unexpected outcome: ${error?.name ?? 'resolved'} ${error?.code ?? ''}`);
  return `${error.name}${error.code ? ` (${error.code})` : ''}`;
};

const base = process.env.SMOKE_PUBLIC_URL ?? 'https://example.com';
const payment = (externalId, amount = '5.00', currency = 'USD') => ({
  amount,
  currency,
  externalId,
  invoice: 'SDK smoke test',
  successCallbackUrl: whish.callbacks.buildUrl(`${base}/whish/success`, externalId),
  failureCallbackUrl: whish.callbacks.buildUrl(`${base}/whish/failure`, externalId),
  successRedirectUrl: `${base}/thanks`,
  failureRedirectUrl: `${base}/retry`,
});

const id = generateExternalId();

await check('balance USD', async () => `balance=${(await whish.balance.get('USD')).balance}`);
await check('balance LBP', async () => `balance=${(await whish.balance.get('LBP')).balance}`);
await check('create (UUID externalId)', async () => {
  const r = await whish.payments.create(payment(id));
  if (r.retrieved) throw new Error('first create should not be a replay');
  return 'link created';
});
await check('create replay is retrieved', async () => {
  const r = await whish.payments.create(payment(id));
  if (!r.retrieved) throw new Error('expected retrieved: true');
});
await check('same externalId, different amount -> WhishIdempotencyError', () =>
  expectThrow(whish.payments.create(payment(id, '9.00')), (e) => e instanceof WhishIdempotencyError),
);
await check('create LBP', async () => {
  await whish.payments.create(payment(generateExternalId(), 150000, 'LBP'));
});
await check('status is pending', async () => {
  const s = await whish.payments.status({ externalId: id, currency: 'USD' });
  if (s.status !== 'pending') throw new Error(`got ${s.status}`);
});
await check('status of unknown id -> external_id.not_exists', () =>
  expectThrow(
    whish.payments.status({ externalId: generateExternalId(), currency: 'USD' }),
    (e) => e instanceof WhishApiError && e.code === 'external_id.not_exists',
  ),
);
await check('localhost callback rejected before sending', () =>
  expectThrow(
    whish.payments.create({ ...payment(generateExternalId()), successCallbackUrl: 'http://localhost:3000/cb' }),
    (e) => e instanceof WhishValidationError,
  ),
);
await check('refund of unpaid payment is refused', () =>
  expectThrow(
    whish.payments.refund({ externalId: id, currency: 'USD', reason: 'smoke test' }),
    (e) => e instanceof WhishApiError && ['auth.error', 'whishpay.tx.invalid_state'].includes(e.code),
  ),
);
await check('wrong secret -> auth.session_not_exist', () =>
  expectThrow(
    new Whish({
      channel: process.env.WHISH_CHANNEL,
      secret: 'wrong',
      websiteUrl: process.env.WHISH_WEBSITE_URL,
      environment: 'sandbox',
      userAgent: 'WhishpaySdkSmoke/0.1.0 (https://example.com; dev@example.com)',
    }).balance.get('USD'),
    (e) => e instanceof WhishApiError && e.code === 'auth.session_not_exist',
  ),
);

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
