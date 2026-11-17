import { defineConfig } from 'vitepress';

// The package name lives here and in the root package.json only.
const PACKAGE = 'whishpay-sdk';

export default defineConfig({
  title: PACKAGE,
  description: 'Unofficial TypeScript SDK for the Whish Pay API. Not affiliated with Whish Money.',
  base: process.env.DOCS_BASE ?? `/${PACKAGE}/`,
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    search: { provider: 'local' },
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Recipes', link: '/recipes/nextjs' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Payments and callbacks', link: '/guide/payments-and-callbacks' },
          { text: 'Errors and retries', link: '/guide/errors-and-retries' },
          { text: 'Testing', link: '/guide/testing' },
        ],
      },
      {
        text: 'Recipes',
        items: [
          { text: 'Next.js', link: '/recipes/nextjs' },
          { text: 'Payload CMS', link: '/recipes/payload' },
        ],
      },
    ],
    footer: {
      message: 'Unofficial. Not affiliated with, endorsed by, or supported by Whish Money. MIT licensed.',
    },
  },
});
