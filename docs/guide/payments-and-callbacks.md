# Payments and callbacks

## How a payment flows

1. Your server creates a payment and gets a link (`collectUrl`).
2. You send the customer to that link. They pay on Whish's page.
3. Whish calls your **callback URL** from its servers, and sends the customer's
   browser to your **redirect URL**.
4. Your server asks Whish for the payment's status and fulfils the order only
   if it is `success`.

## Create a payment

```ts
import { generateExternalId } from 'whishpay-sdk';

const externalId = generateExternalId();
await saveOrder({ externalId, currency: 'USD', total: '25.00' }); // before calling Whish

const { collectUrl } = await whish.payments.create({
  amount: '25.00',
  currency: 'USD',
  externalId,
  invoice: 'Order #1042',
  successCallbackUrl: whish.callbacks.buildUrl('https://acme.example/api/whish/callback', externalId),
  failureCallbackUrl: whish.callbacks.buildUrl('https://acme.example/api/whish/callback', externalId),
  successRedirectUrl: `https://acme.example/orders/${orderId}`,
  failureRedirectUrl: `https://acme.example/checkout?failed=1`,
});
```

### Amounts

Pass a decimal string. USD allows up to two decimals; LBP allows none.

```ts
toAmount('25', 'USD');      // '25.00'
toAmount('150000', 'LBP');  // '150000'
toAmount('5.123', 'USD');   // throws
toAmount(0.1 + 0.2, 'USD'); // throws: not exact
```

Numbers are accepted only when they are already exact at the currency's
precision. Whish's own minimum amounts are enforced by Whish.

### The reference (`externalId`)

`externalId` is your unique name for one payment.

- Save it with the order **before** creating the payment, so a crash between the
  two cannot leave a payment you cannot find.
- Resending the **identical** request with the same reference is safe: Whish
  returns the same link and `retrieved` is `true`.
- If anything changes (a different amount, say), use a **new** reference.
  Reusing one with different details returns no link, and the SDK throws
  `WhishIdempotencyError`.

### URLs must be public

Whish rejects callback and redirect URLs it cannot reach, including `localhost`.
The SDK catches the obvious cases before sending. In development, run a tunnel
and use its address:

```bash
cloudflared tunnel --url http://localhost:3000
```

## Handle the callback

A callback is a plain GET request with no body and no signature. Anyone who
knows the URL can send one, so it is only a signal to go and check.

```ts
const result = await whish.callbacks.verify(request, {
  lookup: (externalId) => db.orders.findByExternalId(externalId),
});

if (!result.found) return new Response('ok'); // not one of ours

switch (result.status) {
  case 'success':
    await markPaid(result.order);
    break;
  case 'failed':
    await markFailed(result.order);
    break;
  // 'pending' and 'unknown': leave the order open and check again later
}
return new Response('ok');
```

`verify` does three things:

1. Reads the reference that `buildUrl` put in the URL.
2. Calls your `lookup`. Unknown references stop here, with no request to Whish.
   The currency comes from your record, not from the URL.
3. Asks Whish for the status and returns it with your order.

`request` can be a `Request`, a `URL`, or a string such as Express's
`req.originalUrl`.

::: tip Do not rely on the callback alone
In sandbox testing, Whish sent each callback once and did not send it again
when the handler answered with an error. A callback that your server misses or
fails on is gone, so also [re-check open orders](#when-no-callback-arrives) on
a schedule. Keep `markPaid` safe to run twice in case the callback and the
re-check both fire.
:::

Whish adds nothing of its own to callback or redirect URLs. Whatever reference
you need on arrival, you must put there yourself: `buildUrl` does it for
callbacks, and redirect URLs should include your order ID.

## Statuses

| Status | Meaning |
|---|---|
| `pending` | Not paid yet. Also the state after a failed attempt, until the link expires. |
| `success` | Paid. |
| `failed` | The link expired without payment. |
| `refunded` | A successful payment was refunded. |
| `unknown` | Whish could not determine the outcome. Check again later. |

A link allows one attempt and expires after a few minutes. To let the customer
try again, create a new payment with a new reference.

## When no callback arrives

Callbacks can be lost. Re-check orders that are still open:

```ts
const { status } = await whish.payments.status({ externalId, currency: 'USD' });
```

In a long-running script or worker you can wait instead:

```ts
const result = await whish.payments.waitForResult({ externalId, currency: 'USD' });
```

`waitForResult` can run for several minutes, so do not call it inside a
serverless request handler.

## Refunds

::: warning Experimental
Whish accepts refunds only from server IP addresses you have registered with
them. This call has not yet been exercised end to end by this project and is
never retried automatically.
:::

```ts
await whish.payments.refund({ externalId, currency: 'USD', reason: 'Customer request' });
```

Only a payment whose status is `success` can be refunded.

## Balance

```ts
const { balance } = await whish.balance.get('USD');
```
