# whishpay-sdk

[![npm version](https://img.shields.io/npm/v/whishpay-sdk)](https://www.npmjs.com/package/whishpay-sdk)
[![CI](https://github.com/omarzeineddine-ai/whishpay-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/omarzeineddine-ai/whishpay-sdk/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/whishpay-sdk)](LICENSE)

Unofficial TypeScript SDK for the Whish Pay API (v2).

**[Documentation](https://omarzeineddine-ai.github.io/whishpay-sdk/)** · [Next.js recipe](https://omarzeineddine-ai.github.io/whishpay-sdk/recipes/nextjs) · [Payload CMS recipe](https://omarzeineddine-ai.github.io/whishpay-sdk/recipes/payload)

> **Not affiliated with, endorsed by, or supported by Whish Money.** This is an
> independent, community project. You need your own Whish merchant credentials
> to use it.

- Zero dependencies. Runs on Node 20+, Bun, Deno and edge runtimes (anything with `fetch`).
- Typed end to end, ESM and CommonJS.
- Safe retries: a timed-out payment request is resent with the same reference, so it is never created twice.
- Amounts validated per currency and sent as exact decimal strings.
- Every Whish error code typed, with a flag telling you whether to retry and whether you need a new reference.
- A mock Whish (`whishpay-sdk/testing`) so your checkout tests run offline.

## Install

```bash
npm install whishpay-sdk
```

## Quick start

```ts
import { Whish, generateExternalId } from 'whishpay-sdk';

const whish = new Whish({
  channel: process.env.WHISH_CHANNEL!,
  secret: process.env.WHISH_SECRET!,
  websiteUrl: process.env.WHISH_WEBSITE_URL!,
  environment: 'sandbox', // or 'production'
  userAgent: {
    name: 'AcmeStore',
    version: '1.0',
    website: 'https://acme.example',
    email: 'dev@acme.example',
  },
});

// 1. Save the order with a fresh reference, then create the payment.
const externalId = generateExternalId();
const { collectUrl } = await whish.payments.create({
  amount: '25.00',
  currency: 'USD',
  externalId,
  invoice: 'Order #1042',
  successCallbackUrl: whish.callbacks.buildUrl('https://acme.example/api/whish/callback', externalId),
  failureCallbackUrl: whish.callbacks.buildUrl('https://acme.example/api/whish/callback', externalId),
  successRedirectUrl: 'https://acme.example/checkout/thanks',
  failureRedirectUrl: 'https://acme.example/checkout/failed',
});

// 2. Send the customer to collectUrl.
```

```ts
// 3. In your callback route, confirm with Whish before fulfilling.
export async function GET(request: Request) {
  const result = await whish.callbacks.verify(request, {
    lookup: (externalId) => db.orders.findByExternalId(externalId), // must include `currency`
  });

  if (result.found && result.status === 'success') {
    await markPaid(result.order); // must be safe to run twice
  }
  return new Response('ok');
}
```

Run this on your server only. The secret must never reach the browser.

## API

| Call | Returns |
|---|---|
| `whish.payments.create(input)` | `{ collectUrl, externalId, retrieved }` |
| `whish.payments.status({ externalId, currency })` | `{ status, payerPhoneNumber? }` where status is `pending`, `success`, `failed`, `refunded` or `unknown` |
| `whish.payments.refund({ externalId, currency, reason })` | `{ externalId, retrieved }` (experimental, see below) |
| `whish.payments.waitForResult({ externalId, currency })` | the status once it leaves `pending`, or at the timeout |
| `whish.balance.get(currency)` | `{ currency, balance }` |
| `whish.callbacks.buildUrl(base, externalId)` | a URL carrying your reference |
| `whish.callbacks.verify(request, { lookup })` | `{ found: false }` or the verified status plus your order |
| `toAmount(value, currency)` | the exact decimal string, or throws |
| `generateExternalId()` | a unique reference |

## Things worth knowing

**A link is not a payment.** `create` succeeding means a link exists. Only
`status: 'success'` from `payments.status` or `callbacks.verify` means money moved.

**One reference, one payment.** Reuse an `externalId` only to resend the exact same
request. If the cart changes, generate a new one; otherwise Whish replays the old
request and the SDK throws `WhishIdempotencyError`.

**Callback URLs must be public.** Whish rejects `localhost`. In development, use a
tunnel (cloudflared, ngrok) and pass its URL.

**Callbacks are a hint, not proof.** Anyone can request your callback URL. `verify`
looks the order up in your database and asks Whish for the real status. Whish sends
each callback once and does not resend it if your handler fails, and sends none when
a link expires. So re-check open orders on a schedule, and keep fulfilment safe to
run twice.

**Links are short-lived and single-attempt.** After a failed attempt the payment
stays `pending` until the link expires, then becomes `failed`. To let the customer
try again, create a new payment with a new `externalId`.

**Refunds are experimental.** Whish only accepts refunds from server IPs you have
registered with them, and this SDK's refund call has not yet been exercised
end to end. It is never retried automatically.

## Errors

A payment that is `failed` or `pending` is a normal return value. Only transport
and API problems throw.

| Error | Meaning |
|---|---|
| `WhishValidationError` | Bad input, caught before any request. Has `field`. |
| `WhishApiError` | Whish refused the request. Has `code`, `retryable`, `needsNewExternalId`. |
| `WhishPendingError` | A payment or refund kept returning Whish's "unknown outcome" code. It may have gone through: resend the same request later or check the status. |
| `WhishIdempotencyError` | The `externalId` was already used for a different request. |
| `WhishNetworkError`, `WhishTimeoutError` | Whish could not be reached. For `create`, resend with the same `externalId`. |
| `WhishResponseError` | Whish answered with something other than JSON. |

```ts
try {
  await whish.payments.create(input);
} catch (error) {
  if (error instanceof WhishApiError && error.code === 'sales.exceeded_daily_limit') {
    // ...
  }
}
```

## Testing

```ts
import { Whish } from 'whishpay-sdk';
import { createMockWhish } from 'whishpay-sdk/testing';

const mock = createMockWhish();
const whish = new Whish({ ...config, fetch: mock.fetch });

const { externalId } = await whish.payments.create(input);
mock.simulateSuccess(externalId);
expect((await whish.payments.status({ externalId, currency: 'USD' })).status).toBe('success');

mock.failNext({ code: '500' }, 2); // exercise your retry and error paths
```

## Development

```bash
npm install
npm test            # unit tests against the mock
npm run build
npm run smoke       # real sandbox; needs WHISH_* in .env
```

## Releasing

Releases are published to npm by GitHub Actions when a version tag is pushed.

```bash
npm version patch          # or minor / major: bumps package.json, commits, tags
git push --follow-tags     # the Release workflow publishes the tagged version
```

The workflow checks that the tag matches `package.json`, runs the full test
suite, and publishes through npm trusted publishing, so no npm token is stored
in the repository.

## License

MIT
