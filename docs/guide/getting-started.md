# Getting started

::: warning Unofficial
This SDK is an independent project. It is not affiliated with, endorsed by, or
supported by Whish Money. You need your own Whish merchant credentials.
:::

## Install

```bash
npm install whishpay-sdk
```

Requires Node 20 or newer, or any runtime with a global `fetch`.

## Credentials

Whish issues three values per environment: a **channel**, a **secret**, and the
**website URL** they registered for you. Keep them in environment variables and
on the server only.

```bash
WHISH_CHANNEL=...
WHISH_SECRET=...
WHISH_WEBSITE_URL=...
```

## Create the client

```ts
import { Whish } from 'whishpay-sdk';

export const whish = new Whish({
  channel: process.env.WHISH_CHANNEL!,
  secret: process.env.WHISH_SECRET!,
  websiteUrl: process.env.WHISH_WEBSITE_URL!,
  environment: 'sandbox',
  userAgent: {
    name: 'AcmeStore',
    version: '1.0',
    website: 'https://acme.example',
    email: 'dev@acme.example',
  },
});
```

`environment` is required and is never guessed from `NODE_ENV`, so a staging
server cannot reach production Whish by accident. Sandbox and production use
different credentials.

`userAgent` identifies your application to Whish. Use your own app's details.

| Option | Default | Purpose |
|---|---|---|
| `timeoutMs` | `30000` | Time limit per attempt |
| `maxRetries` | `2` | Extra attempts for retryable failures |
| `retryDelayMs` | `500` | First retry delay; doubles each time |
| `fetch` | global `fetch` | Custom fetch, for example the [mock](/guide/testing) |

## Check it works

```ts
const { balance } = await whish.balance.get('USD');
console.log(balance);
```

If this throws `WhishApiError` with code `auth.session_not_exist`, the
credentials do not match the environment.

Next: [take a payment](/guide/payments-and-callbacks).
