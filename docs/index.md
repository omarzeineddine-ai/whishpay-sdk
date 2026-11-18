---
layout: home
hero:
  name: Whish Pay SDK
  text: for TypeScript
  tagline: Take Whish payments in a few lines. Safe retries, exact amounts, verified callbacks, and a mock for your tests.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Next.js recipe
      link: /recipes/nextjs
    - theme: alt
      text: Payload CMS recipe
      link: /recipes/payload
features:
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20a15 15 0 0 1 0-20"/></svg>'
    title: Runs anywhere
    details: Zero dependencies. Node 20+, Bun, Deno and edge runtimes.
    link: /guide/getting-started
    linkText: Install
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3l-8 3v7c0 6 8 10 8 10"/><path d="m9 12l2 2l4-4"/></svg>'
    title: Safe by default
    details: A retried payment is never created twice, and no order is fulfilled on an unverified callback.
    link: /guide/payments-and-callbacks
    linkText: How payments flow
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 18l6-6l-6-6"/><path d="m8 6l-6 6l6 6"/></svg>'
    title: Typed errors
    details: Every error code tells you whether to retry and whether you need a new reference.
    link: /guide/errors-and-retries
    linkText: Errors and retries
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6"/><path d="M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21.5h11.6a2 2 0 0 0 1.7-3L14 9V3"/><path d="M7.5 15h9"/></svg>'
    title: Testable offline
    details: A built-in mock Whish covers success, failure, expiry, refunds and outages.
    link: /guide/testing
    linkText: Testing
---

## Install

::: code-group

```bash [npm]
npm install whishpay-sdk
```

```bash [pnpm]
pnpm add whishpay-sdk
```

```bash [bun]
bun add whishpay-sdk
```

:::

## Set up once

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

Then [take your first payment](/guide/payments-and-callbacks).
