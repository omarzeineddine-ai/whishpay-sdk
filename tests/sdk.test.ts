import { inspect } from 'node:util';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  Whish,
  WhishApiError,
  WhishConfigError,
  WhishIdempotencyError,
  WhishNetworkError,
  WhishPendingError,
  WhishResponseError,
  WhishValidationError,
  generateExternalId,
  toAmount,
  type WhishConfig,
} from '../src/index';
import { createMockWhish } from '../src/testing/index';

const SECRET = 'test-secret-value';
const mock = createMockWhish({ credentials: { channel: '123', secret: SECRET } });

const config = (overrides: Partial<WhishConfig> = {}): WhishConfig => ({
  channel: '123',
  secret: SECRET,
  websiteUrl: 'shop.example',
  environment: 'sandbox',
  userAgent: { name: 'Test Shop', version: '1.0', website: 'https://shop.example', email: 'dev@shop.example' },
  fetch: mock.fetch,
  retryDelayMs: 0,
  ...overrides,
});

const payment = (overrides: Record<string, unknown> = {}) => ({
  amount: '25.00',
  currency: 'USD' as const,
  externalId: generateExternalId(),
  invoice: 'Order 1',
  successCallbackUrl: 'https://shop.example/api/whish/success',
  failureCallbackUrl: 'https://shop.example/api/whish/failure',
  successRedirectUrl: 'https://shop.example/thanks',
  failureRedirectUrl: 'https://shop.example/retry',
  ...overrides,
});

beforeEach(() => mock.reset());

describe('toAmount', () => {
  it('normalises valid amounts', () => {
    expect(toAmount('25', 'USD')).toBe('25.00');
    expect(toAmount('25.5', 'USD')).toBe('25.50');
    expect(toAmount(25.5, 'USD')).toBe('25.50');
    expect(toAmount('007.10', 'USD')).toBe('7.10');
    expect(toAmount('0.50', 'USD')).toBe('0.50');
    expect(toAmount('150000', 'LBP')).toBe('150000');
    expect(toAmount(150000, 'LBP')).toBe('150000');
  });

  it.each([
    ['5.123', 'USD'],
    [0.1 + 0.2, 'USD'],
    ['1500.5', 'LBP'],
    [1500.5, 'LBP'],
    ['0', 'USD'],
    ['0.00', 'USD'],
    ['-5', 'USD'],
    ['1e3', 'USD'],
    ['', 'USD'],
    [Number.NaN, 'USD'],
    ['5', 'AED'],
  ] as const)('rejects %s %s', (value, currency) => {
    expect(() => toAmount(value, currency as 'USD')).toThrow(WhishValidationError);
  });
});

describe('configuration', () => {
  it('requires credentials, environment and user agent', () => {
    expect(() => new Whish(config({ secret: '' }))).toThrow(WhishConfigError);
    expect(() => new Whish(config({ environment: undefined as never }))).toThrow(WhishConfigError);
    expect(() => new Whish(config({ userAgent: { name: 'x' } as never }))).toThrow(WhishConfigError);
  });

  it('picks the base URL from the environment', () => {
    expect(new Whish(config()).baseUrl).toBe('https://partner.api.sbx.whish.money/itel-service/api');
    expect(new Whish(config({ environment: 'production' })).baseUrl).toBe('https://api.whish.money/itel-service/api');
  });

  it('sends credentials and a formatted User-Agent', async () => {
    await new Whish(config()).balance.get('USD');
    const { headers } = mock.requests[0]!;
    expect(headers.channel).toBe('123');
    expect(headers.websiteurl).toBe('shop.example');
    expect(headers['user-agent']).toBe('TestShop/1.0 (https://shop.example; dev@shop.example)');
  });

  it('never exposes the secret', () => {
    const whish = new Whish(config());
    expect(JSON.stringify(whish)).not.toContain(SECRET);
    expect(inspect(whish)).not.toContain(SECRET);
    expect(Object.values(whish).join()).not.toContain(SECRET);
  });
});

describe('payments.create', () => {
  it('returns a payment link and sends the amount as a string', async () => {
    const whish = new Whish(config());
    const input = payment({ amount: 25 });
    const result = await whish.payments.create(input);
    expect(result).toEqual({ collectUrl: expect.stringContaining('/pay/'), externalId: input.externalId, retrieved: false });
    expect(mock.requests[0]!.body).toMatchObject({ amount: '25.00', externalId: input.externalId });
  });

  it('replays an identical request', async () => {
    const whish = new Whish(config());
    const input = payment();
    const first = await whish.payments.create(input);
    const second = await whish.payments.create(input);
    expect(second).toEqual({ ...first, retrieved: true });
  });

  it('throws when an externalId is reused with a different amount', async () => {
    const whish = new Whish(config());
    const input = payment();
    await whish.payments.create(input);
    await expect(whish.payments.create({ ...input, amount: '99.00' })).rejects.toThrow(WhishIdempotencyError);
  });

  it('validates before sending', async () => {
    const whish = new Whish(config());
    await expect(whish.payments.create(payment({ amount: '5.123' }))).rejects.toMatchObject({ field: 'amount' });
    await expect(whish.payments.create(payment({ currency: 'AED' }))).rejects.toMatchObject({ field: 'currency' });
    await expect(whish.payments.create(payment({ externalId: '' }))).rejects.toMatchObject({ field: 'externalId' });
    await expect(
      whish.payments.create(payment({ successCallbackUrl: 'http://localhost:3000/cb' })),
    ).rejects.toMatchObject({ field: 'successCallbackUrl' });
    expect(mock.requests).toHaveLength(0);
  });

  it('explains a 403 page from Whish', async () => {
    const whish = new Whish(config());
    mock.failNext({ http: 403 });
    const error = await whish.payments.create(payment()).catch((e) => e);
    expect(error).toBeInstanceOf(WhishResponseError);
    expect(error.message).toContain('public');
    expect(mock.requests).toHaveLength(1);
  });

  it('retries a 500 with the identical body, then succeeds', async () => {
    const whish = new Whish(config());
    mock.failNext({ code: '500' }, 2);
    const result = await whish.payments.create(payment());
    expect(result.collectUrl).toBeTruthy();
    expect(mock.requests).toHaveLength(3);
    expect(mock.requests[2]!.body).toEqual(mock.requests[0]!.body);
  });

  it('throws WhishPendingError when 500 persists', async () => {
    const whish = new Whish(config());
    mock.failNext({ code: '500' }, 3);
    await expect(whish.payments.create(payment())).rejects.toThrow(WhishPendingError);
    expect(mock.requests).toHaveLength(3);
  });

  it('retries network failures and reports them when they persist', async () => {
    const whish = new Whish(config({ maxRetries: 1 }));
    mock.failNext('network', 2);
    await expect(whish.payments.create(payment())).rejects.toThrow(WhishNetworkError);
    expect(mock.requests).toHaveLength(2);
  });

  it('does not retry final errors', async () => {
    const whish = new Whish(config());
    mock.failNext({ code: 'sales.exceeded_daily_limit' });
    const error = await whish.payments.create(payment()).catch((e) => e);
    expect(error).toBeInstanceOf(WhishApiError);
    expect(error).toMatchObject({ code: 'sales.exceeded_daily_limit', retryable: false, needsNewExternalId: true });
    expect(mock.requests).toHaveLength(1);
  });

  it('reports wrong credentials', async () => {
    const whish = new Whish(config({ secret: 'wrong' }));
    await expect(whish.payments.create(payment())).rejects.toMatchObject({ code: 'auth.session_not_exist' });
  });
});

describe('payments.status', () => {
  it('returns each state as a value', async () => {
    const whish = new Whish(config());
    const input = payment();
    await whish.payments.create(input);
    const ref = { externalId: input.externalId, currency: input.currency };

    expect(await whish.payments.status(ref)).toEqual({ ...ref, status: 'pending', rawStatus: 'pending' });
    mock.simulateFailure(input.externalId);
    expect((await whish.payments.status(ref)).status).toBe('pending');
    mock.simulateSuccess(input.externalId, '96171111111');
    expect(await whish.payments.status(ref)).toMatchObject({ status: 'success', payerPhoneNumber: '96171111111' });
  });

  it('reports failed after expiry without throwing', async () => {
    const whish = new Whish(config());
    const input = payment();
    await whish.payments.create(input);
    mock.expire(input.externalId);
    expect((await whish.payments.status(input)).status).toBe('failed');
  });

  it('throws for an unknown payment or the wrong currency', async () => {
    const whish = new Whish(config());
    const input = payment();
    await whish.payments.create(input);
    await expect(whish.payments.status({ externalId: 'nope', currency: 'USD' })).rejects.toMatchObject({
      code: 'external_id.not_exists',
    });
    await expect(whish.payments.status({ externalId: input.externalId, currency: 'LBP' })).rejects.toMatchObject({
      code: 'external_id.not_exists',
    });
  });

  it('treats a persistent 500 on a read as an ordinary API error', async () => {
    const whish = new Whish(config());
    mock.failNext({ code: '500' }, 3);
    const error = await whish.payments.status({ externalId: 'x', currency: 'USD' }).catch((e) => e);
    expect(error).toBeInstanceOf(WhishApiError);
    expect(error).not.toBeInstanceOf(WhishPendingError);
    expect(mock.requests).toHaveLength(3);
  });

  it('waitForResult returns once the payment settles', async () => {
    const whish = new Whish(config());
    const input = payment();
    await whish.payments.create(input);
    setTimeout(() => mock.simulateSuccess(input.externalId), 20);
    const result = await whish.payments.waitForResult({ ...input, intervalMs: 10, timeoutMs: 2000 });
    expect(result.status).toBe('success');
  });

  it('waitForResult returns pending at the timeout', async () => {
    const whish = new Whish(config());
    const input = payment();
    await whish.payments.create(input);
    const result = await whish.payments.waitForResult({ ...input, intervalMs: 10, timeoutMs: 40 });
    expect(result.status).toBe('pending');
  });
});

describe('payments.refund', () => {
  it('refunds a successful payment and replays a repeat', async () => {
    const whish = new Whish(config());
    const input = payment();
    await whish.payments.create(input);
    mock.simulateSuccess(input.externalId);
    const ref = { externalId: input.externalId, currency: input.currency, reason: 'Customer request' };

    expect(await whish.payments.refund(ref)).toEqual({ externalId: input.externalId, retrieved: false });
    expect((await whish.payments.status(ref)).status).toBe('refunded');
    expect((await whish.payments.refund(ref)).retrieved).toBe(true);
  });

  it('rejects refunding an unpaid payment', async () => {
    const whish = new Whish(config());
    const input = payment();
    await whish.payments.create(input);
    await expect(whish.payments.refund({ ...input, reason: 'x' })).rejects.toMatchObject({
      code: 'whishpay.tx.invalid_state',
    });
  });

  it('never retries automatically', async () => {
    const whish = new Whish(config());
    mock.failNext({ code: '500' }, 3);
    await expect(whish.payments.refund({ externalId: 'a', currency: 'USD', reason: 'x' })).rejects.toThrow(
      WhishPendingError,
    );
    expect(mock.requests).toHaveLength(1);
  });
});

describe('balance.get', () => {
  it('returns the balance for a currency', async () => {
    const whish = new Whish(config());
    expect(await whish.balance.get('USD')).toEqual({ currency: 'USD', balance: 1000 });
    expect(mock.requests[0]!.path).toBe('/payment/account/balance?currency=USD');
    await expect(whish.balance.get('AED' as never)).rejects.toThrow(WhishValidationError);
  });
});

describe('callbacks', () => {
  const orders = new Map<string, { currency: 'USD' | 'LBP'; total: string }>();
  const lookup = (id: string) => orders.get(id);

  it('builds a URL that keeps existing parameters', () => {
    const whish = new Whish(config());
    expect(whish.callbacks.buildUrl('https://shop.example/cb?x=1', 'abc', { kind: 'success' })).toBe(
      'https://shop.example/cb?x=1&kind=success&ref=abc',
    );
  });

  it('verifies a callback against the real status', async () => {
    const whish = new Whish(config());
    const input = payment();
    orders.set(input.externalId, { currency: 'USD', total: '25.00' });
    await whish.payments.create(input);
    const url = whish.callbacks.buildUrl(input.successCallbackUrl, input.externalId);

    // A success callback before the payment has actually succeeded is not trusted.
    expect(await whish.callbacks.verify(url, { lookup })).toMatchObject({ found: true, status: 'pending' });

    mock.simulateSuccess(input.externalId);
    const result = await whish.callbacks.verify(new Request(url), { lookup });
    expect(result).toMatchObject({ found: true, status: 'success', order: { total: '25.00' } });
  });

  it('accepts a path-only URL, as Express provides', async () => {
    const whish = new Whish(config());
    const input = payment();
    orders.set(input.externalId, { currency: 'USD', total: '1.00' });
    await whish.payments.create(input);
    const result = await whish.callbacks.verify(`/api/whish/success?ref=${input.externalId}`, { lookup });
    expect(result.found).toBe(true);
  });

  it('ignores unknown references without calling Whish', async () => {
    const whish = new Whish(config());
    expect(await whish.callbacks.verify('https://shop.example/cb?ref=stranger', { lookup })).toEqual({
      found: false,
      externalId: 'stranger',
    });
    expect(await whish.callbacks.verify('https://shop.example/cb', { lookup })).toEqual({
      found: false,
      externalId: null,
    });
    expect(mock.requests).toHaveLength(0);
  });
});
