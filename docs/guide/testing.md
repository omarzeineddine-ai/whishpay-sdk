# Testing

`whishpay-sdk/testing` provides an in-memory Whish that answers the way the
sandbox does. Pass its `fetch` to the client and no request leaves your machine.

```ts
import { Whish, generateExternalId } from 'whishpay-sdk';
import { createMockWhish } from 'whishpay-sdk/testing';

const mock = createMockWhish();
const whish = new Whish({
  channel: 'test',
  secret: 'test',
  websiteUrl: 'shop.example',
  environment: 'sandbox',
  userAgent: 'Tests/1.0 (https://shop.example; dev@shop.example)',
  fetch: mock.fetch,
  retryDelayMs: 0, // keep retry tests fast
});
```

## Drive a payment

```ts
const externalId = generateExternalId();
await whish.payments.create({ ...input, externalId });

mock.simulateSuccess(externalId);  // the customer paid
mock.simulateFailure(externalId);  // a failed attempt: stays pending
mock.expire(externalId);           // the link ran out: becomes failed
```

## Simulate trouble

```ts
mock.failNext({ code: '500' }, 2);                   // two "outcome unknown" answers
mock.failNext('network');                            // a dropped connection
mock.failNext({ http: 502 });                        // a non-JSON gateway page
mock.failNext({ code: 'sales.exceeded_daily_limit' });
```

## Inspect what was sent

```ts
mock.requests;  // every request: method, path, headers, body
mock.payments;  // Map of externalId -> payment
mock.reset();   // clear everything between tests
```

## Options

```ts
createMockWhish({
  credentials: { channel: 'test', secret: 'test' }, // others get auth.session_not_exist
  balances: { USD: 500 },
  refundsAllowed: false,                            // refunds answer auth.error
});
```

## What the mock reproduces

- Replaying an identical create returns the same link with `retrieved: true`.
- Reusing a reference with different details returns no link.
- Looking up a payment with the wrong currency gives `external_id.not_exists`.
- `localhost` callback URLs get a 403 page (the SDK rejects these earlier, so
  you will only see this if you bypass validation).
- Refunds require a `success` payment and are replayed on repeat.

## Testing against the real sandbox

For an end-to-end check, point the client at the sandbox with your sandbox
credentials. The sandbox payment page has buttons to simulate a successful or
failed payment. Callback URLs must be public, so run a tunnel.
