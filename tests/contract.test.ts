/**
 * Contract tests: replay requests recorded from the real Whish sandbox and
 * check that (1) the mock answers the same way and (2) the SDK interprets the
 * recorded answers correctly.
 *
 * Fixtures are produced by `node --env-file=.env scripts/scrub-fixtures.mjs`
 * and are git-ignored, so these tests skip when they are absent.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Whish, WhishApiError, WhishIdempotencyError, WhishResponseError } from '../src/index';
import { createMockWhish } from '../src/testing/index';

interface Fixture {
  label: string;
  request: { method: string; path: string; body?: Record<string, unknown> };
  response: { http?: number; contentType?: string; body?: unknown; error?: string };
}

const dir = new URL('./fixtures/', import.meta.url);
const fixtures: Fixture[] = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as Fixture)
  : [];
const byLabel = (label: string) => {
  const fixture = fixtures.find((f) => f.label === label);
  if (!fixture) throw new Error(`missing fixture ${label}`);
  return fixture;
};

const BASE = 'https://partner.api.sbx.whish.money/itel-service/api';

/** The parts of a response the SDK depends on. */
function shape(http: number, body: unknown) {
  if (!body || typeof body !== 'object') return { http, json: false };
  const e = body as Record<string, unknown>;
  const data = e.data as Record<string, unknown> | null | undefined;
  return {
    http,
    json: true,
    status: e.status,
    code: e.code ?? null,
    retrieved: e.retrieved === true,
    data: data
      ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, k === 'collectUrl' ? 'URL' : v]))
      : null,
  };
}

const client = (fetchImpl: typeof fetch) =>
  new Whish({
    channel: 'c',
    secret: 's',
    websiteUrl: 'w',
    environment: 'sandbox',
    userAgent: 'Contract/1.0 (https://example.com; dev@example.com)',
    fetch: fetchImpl,
    maxRetries: 0,
  });

/** A fetch that answers with one recorded response. */
const replay = (fixture: Fixture) =>
  (async () =>
    new Response(
      typeof fixture.response.body === 'string' ? fixture.response.body : JSON.stringify(fixture.response.body),
      { status: fixture.response.http, headers: { 'content-type': fixture.response.contentType ?? 'text/plain' } },
    )) as unknown as typeof fetch;

describe.skipIf(fixtures.length === 0)('contract with the recorded sandbox', () => {
  // Not reproducible by replaying the request alone: one depends on the
  // credentials sent, the other is a DNS failure on the earlier host.
  const SKIP = new Set(['balance-wrong-secret', 'old-host-balance']);

  it('the mock answers the recorded request sequence like the sandbox did', async () => {
    const mock = createMockWhish({ balances: { USD: 1_000_000, LBP: 0 }, refundsAllowed: false });
    for (const fixture of fixtures) {
      if (SKIP.has(fixture.label)) continue;
      const { method, path, body } = fixture.request;
      const response = await mock.fetch(BASE + path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // non-JSON page
      }
      expect(shape(response.status, parsed), fixture.label).toEqual(
        shape(fixture.response.http!, fixture.response.body),
      );
    }
  });

  it('reads a created payment', async () => {
    const f = byLabel('create-numeric-string-id');
    const result = await client(replay(f)).payments.create(f.request.body as never);
    expect(result).toMatchObject({ retrieved: false, collectUrl: expect.stringContaining('/pay/') });
  });

  it('reads a replayed payment', async () => {
    const f = byLabel('create-resend-identical');
    expect((await client(replay(f)).payments.create(f.request.body as never)).retrieved).toBe(true);
  });

  it('turns a replay with different details into WhishIdempotencyError', async () => {
    const f = byLabel('create-same-id-different-amount');
    await expect(client(replay(f)).payments.create(f.request.body as never)).rejects.toThrow(WhishIdempotencyError);
  });

  it('reads a pending status with an empty payer number', async () => {
    const f = byLabel('status-after-create');
    const result = await client(replay(f)).payments.status(f.request.body as never);
    expect(result.status).toBe('pending');
    expect(result.payerPhoneNumber).toBeUndefined();
  });

  it.each([
    ['status-unknown-id', 'external_id.not_exists'],
    ['status-wrong-currency', 'external_id.not_exists'],
  ])('reports %s as %s', async (label, code) => {
    const f = byLabel(label);
    await expect(client(replay(f)).payments.status(f.request.body as never)).rejects.toMatchObject({ code });
  });

  it('reads balances', async () => {
    expect(await client(replay(byLabel('balance-usd'))).balance.get('USD')).toEqual({
      currency: 'USD',
      balance: 1_000_000,
    });
  });

  it('reports wrong credentials', async () => {
    const error = await client(replay(byLabel('balance-wrong-secret')))
      .balance.get('USD')
      .catch((e) => e);
    expect(error).toBeInstanceOf(WhishApiError);
    expect(error.code).toBe('auth.session_not_exist');
    expect(error.dialog?.message).toBeTruthy();
  });

  it('reports a refund from an unregistered IP', async () => {
    const f = byLabel('refund-pending-payment');
    await expect(
      client(replay(f)).payments.refund({ externalId: 'x', currency: 'USD', reason: 'r' }),
    ).rejects.toMatchObject({ code: 'auth.error' });
  });

  it('explains the 403 page for unreachable URLs', async () => {
    const f = byLabel('create-localhost-callback');
    // Public URLs, so client-side validation passes and the recorded 403 is what gets interpreted.
    const body = { ...byLabel('create-numeric-string-id').request.body } as never;
    const error = await client(replay(f)).payments.create(body).catch((e) => e);
    expect(error).toBeInstanceOf(WhishResponseError);
    expect(error.httpStatus).toBe(403);
    expect(error.message).toContain('public');
  });
});
