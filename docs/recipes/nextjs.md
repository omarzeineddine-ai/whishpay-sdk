# Next.js (App Router)

Everything here runs on the server. Never import the client into a Client
Component.

## 1. A shared client

```ts
// lib/whish.ts
import 'server-only';
import { Whish } from 'whishpay-sdk';

export const whish = new Whish({
  channel: process.env.WHISH_CHANNEL!,
  secret: process.env.WHISH_SECRET!,
  websiteUrl: process.env.WHISH_WEBSITE_URL!,
  environment: process.env.WHISH_ENV === 'production' ? 'production' : 'sandbox',
  userAgent: { name: 'AcmeStore', version: '1.0', website: 'https://acme.example', email: 'dev@acme.example' },
});
```

`APP_URL` below is your site's public address. In development, set it to your
tunnel URL.

## 2. Start checkout

```ts
// app/checkout/actions.ts
'use server';
import { redirect } from 'next/navigation';
import { generateExternalId } from 'whishpay-sdk';
import { whish } from '@/lib/whish';

export async function payWithWhish(cartId: string) {
  const cart = await getCart(cartId);
  const externalId = generateExternalId();
  const order = await createOrder({ cart, externalId, currency: 'USD', status: 'awaiting_payment' });

  const callback = whish.callbacks.buildUrl(`${process.env.APP_URL}/api/whish/callback`, externalId);
  const { collectUrl } = await whish.payments.create({
    amount: order.total, // a string such as '25.00'
    currency: 'USD',
    externalId,
    invoice: `Order ${order.number}`,
    successCallbackUrl: callback,
    failureCallbackUrl: callback,
    successRedirectUrl: `${process.env.APP_URL}/orders/${order.id}`,
    failureRedirectUrl: `${process.env.APP_URL}/checkout?failed=1`,
  });

  redirect(collectUrl);
}
```

## 3. The callback route

```ts
// app/api/whish/callback/route.ts
import { whish } from '@/lib/whish';

export async function GET(request: Request) {
  const result = await whish.callbacks.verify(request, {
    lookup: (externalId) => findOrderByExternalId(externalId),
  });

  if (result.found && result.status === 'success') {
    await markOrderPaid(result.order.id); // no-op if already paid
  } else if (result.found && result.status === 'failed') {
    await markOrderFailed(result.order.id);
  }
  return new Response('ok');
}
```

## 4. The order page

The customer may land on the redirect page before the callback has been
processed, so check there too. The status check sits inside `<Suspense>`:
Next.js 16 apps with Cache Components enabled (the default for new projects)
refuse to render live data outside one.

```tsx
// app/orders/[id]/page.tsx
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { whish } from '@/lib/whish';

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p>Checking your payment…</p>}>
      <Order params={params} />
    </Suspense>
  );
}

async function Order({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let order = await getOrder(id);
  if (!order) notFound();

  if (order.status === 'awaiting_payment') {
    const { status } = await whish.payments.status({ externalId: order.externalId, currency: order.currency });
    if (status === 'success') order = await markOrderPaid(order.id);
  }
  return <OrderSummary order={order} />;
}
```

## 5. Sweep open orders

Callbacks can be lost. A scheduled job (for example a Vercel Cron route) should
re-check orders that have been `awaiting_payment` for more than a few minutes,
using `whish.payments.status`. This job is also what marks abandoned orders
`failed`: Whish sends no callback when a link simply expires.

::: info Tested
This recipe was run end to end against the Whish sandbox on Next.js 16.4,
including a repeated callback and a callback for an unpaid order.
:::
