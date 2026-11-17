# Payload CMS

This recipe targets Payload 3, which runs inside a Next.js app. Orders live in
a Payload collection, and the Whish callback is a custom endpoint on it.

## A shared client

```ts
// lib/whish.ts
import { Whish } from 'whishpay-sdk';

let client: Whish | undefined;

export function getWhish(): Whish {
  client ??= new Whish({
    channel: process.env.WHISH_CHANNEL!,
    secret: process.env.WHISH_SECRET!,
    websiteUrl: process.env.WHISH_WEBSITE_URL!,
    environment: process.env.WHISH_ENV === 'production' ? 'production' : 'sandbox',
    userAgent: { name: 'AcmeStore', version: '1.0', website: 'https://acme.example', email: 'dev@acme.example' },
  });
  return client;
}
```

Two differences from the Next.js recipe, both because Payload's CLI
(`payload generate:types`, migrations) loads your collection files outside
Next.js:

- Do not `import 'server-only'` here. It throws under the CLI.
- Create the client on first use, so the CLI and builds work without Whish
  credentials.

## Orders collection

```ts
// collections/Orders.ts
import type { CollectionConfig } from 'payload';
import { getWhish } from '@/lib/whish';

export const Orders: CollectionConfig = {
  slug: 'orders',
  fields: [
    { name: 'externalId', type: 'text', required: true, unique: true, index: true },
    { name: 'currency', type: 'select', options: ['USD', 'LBP'], required: true },
    { name: 'total', type: 'text', required: true }, // decimal string, e.g. '25.00'
    {
      name: 'status',
      type: 'select',
      options: ['awaiting_payment', 'paid', 'failed', 'refunded'],
      defaultValue: 'awaiting_payment',
      required: true,
    },
  ],
  endpoints: [
    {
      // Served at /api/orders/whish-callback
      path: '/whish-callback',
      method: 'get',
      handler: async (req) => {
        const result = await getWhish().callbacks.verify(req.url ?? '', {
          lookup: async (externalId) => {
            const { docs } = await req.payload.find({
              collection: 'orders',
              where: { externalId: { equals: externalId } },
              limit: 1,
            });
            return docs[0];
          },
        });

        if (result.found && result.order.status === 'awaiting_payment') {
          const next = result.status === 'success' ? 'paid' : result.status === 'failed' ? 'failed' : null;
          if (next) {
            await req.payload.update({ collection: 'orders', id: result.order.id, data: { status: next } });
          }
        }
        return new Response('ok');
      },
    },
  ],
};
```

Only orders still `awaiting_payment` are updated, so a repeated callback does
nothing.

## Start a payment

Anywhere you have a Payload instance (a server action, a route handler, another
endpoint):

```ts
import { generateExternalId } from 'whishpay-sdk';
import { getWhish } from '@/lib/whish';

const whish = getWhish();
const externalId = generateExternalId();
const order = await payload.create({
  collection: 'orders',
  data: { externalId, currency: 'USD', total: '25.00', status: 'awaiting_payment' },
});

const callback = whish.callbacks.buildUrl(`${process.env.APP_URL}/api/orders/whish-callback`, externalId);
const { collectUrl } = await whish.payments.create({
  amount: order.total,
  currency: 'USD',
  externalId,
  invoice: `Order ${order.id}`,
  successCallbackUrl: callback,
  failureCallbackUrl: callback,
  successRedirectUrl: `${process.env.APP_URL}/orders/${order.id}`,
  failureRedirectUrl: `${process.env.APP_URL}/checkout?failed=1`,
});
```

Send the customer to `collectUrl`.

Run `payload generate:types` after adding the collection so `orders` is typed.
`status` is passed explicitly because the generated type marks it required.

## Access control

The callback endpoint must be reachable without a login, which custom
endpoints are by default. Keep the collection's own `read` and `update` access
restricted; the endpoint uses the local API, which bypasses access control.

## Sweep open orders

Whish sends each callback once and sends none when a link expires unpaid. Add
a scheduled job (a Payload job or a cron route) that looks up orders still
`awaiting_payment` after a few minutes and checks them with
`getWhish().payments.status`.

::: info Tested
This recipe was run end to end against the Whish sandbox on Payload 3.93 with
SQLite, including a repeated callback and a callback for an unpaid order.
:::
