/**
 * An in-memory stand-in for the Whish Pay API, for tests and local development.
 * Its responses mirror what the Whish sandbox returns.
 *
 * @example
 * import { Whish } from 'whishpay-sdk';
 * import { createMockWhish } from 'whishpay-sdk/testing';
 *
 * const mock = createMockWhish();
 * const whish = new Whish({ ...config, fetch: mock.fetch });
 * const { externalId } = await whish.payments.create({ ... });
 * mock.simulateSuccess(externalId);
 */

type MockStatus = 'pending' | 'success' | 'failed' | 'refunded' | 'unknown';

export interface MockPayment {
  externalId: string;
  currency: string;
  amount: string;
  status: MockStatus;
  collectUrl: string;
  /** The create request exactly as received. */
  request: Record<string, unknown>;
  payerPhoneNumber: string;
}

export interface MockRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

export type MockFault =
  /** Reject the fetch call, as a dropped connection would. */
  | 'network'
  /** Answer `status: false` with this code, for example `'500'`. */
  | { code: string; message?: string }
  /** Answer with a non-JSON page and this HTTP status. */
  | { http: number };

export interface MockWhishOptions {
  /** When set, requests with other credentials get `auth.session_not_exist`. */
  credentials?: { channel: string; secret: string };
  /** Starting balances. Default `{ USD: 1000, LBP: 0 }`. */
  balances?: Partial<Record<'USD' | 'LBP', number>>;
  /** Whether the caller's IP counts as registered for refunds. Default `true`. */
  refundsAllowed?: boolean;
}

export interface MockWhish {
  /** Pass as the `fetch` option of `new Whish(...)`. */
  fetch: typeof fetch;
  /** Every payment created so far, by `externalId`. */
  payments: Map<string, MockPayment>;
  /** Every request received, oldest first. */
  requests: MockRequest[];
  /** Marks a payment paid, as the sandbox "Simulate Success" button does. */
  simulateSuccess(externalId: string, payerPhoneNumber?: string): void;
  /** A failed attempt. The payment stays `pending` until it expires. */
  simulateFailure(externalId: string): void;
  /** The link ran out unpaid: status becomes `failed`. */
  expire(externalId: string): void;
  /** Makes the next `times` requests fail in the given way. */
  failNext(fault: MockFault, times?: number): void;
  reset(): void;
}

const LOCAL = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/;
const URL_FIELDS = ['successCallbackUrl', 'failureCallbackUrl', 'successRedirectUrl', 'failureRedirectUrl'];

const envelope = (status: boolean, code: string | null, data: unknown, extra: Record<string, unknown> = {}) => ({
  status,
  code,
  dialog: code
    ? { title: 'Error', message: (extra.message as string) ?? 'An error has occurred.', yesButton: null, noButton: null }
    : null,
  actions: null,
  extra: null,
  ...(extra.retrieved ? { retrieved: true } : {}),
  data,
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const fail = (code: string, message?: string) => json(envelope(false, code, null, { message }));

export function createMockWhish(options: MockWhishOptions = {}): MockWhish {
  const payments = new Map<string, MockPayment>();
  const refunded = new Set<string>();
  const requests: MockRequest[] = [];
  const faults: MockFault[] = [];
  let balances = { USD: 1000, LBP: 0, ...options.balances };
  let counter = 0;

  const get = (externalId: string) => {
    const payment = payments.get(externalId);
    if (!payment) throw new Error(`mock Whish: no payment with externalId "${externalId}"`);
    return payment;
  };

  const handle = (method: string, url: URL, headers: Headers, body: Record<string, unknown> | null): Response => {
    if (
      options.credentials &&
      (headers.get('channel') !== options.credentials.channel || headers.get('secret') !== options.credentials.secret)
    ) {
      return fail('auth.session_not_exist', 'Please sign in again. You have been signed out.');
    }
    const path = url.pathname.replace(/^.*\/itel-service\/api/, '');

    if (method === 'GET' && path === '/payment/account/balance') {
      const currency = url.searchParams.get('currency') ?? 'LBP';
      if (currency !== 'USD' && currency !== 'LBP') return fail('currency.not_supported');
      return json(envelope(true, null, { balance: balances[currency] }));
    }

    if (method !== 'POST' || !body) return new Response('Not Found', { status: 404 });
    const externalId = String(body.externalId ?? '');
    const currency = String(body.currency ?? '');

    if (path === '/payment/whish') {
      for (const field of URL_FIELDS) {
        let host = '';
        try {
          host = new URL(String(body[field])).hostname;
        } catch {
          return fail('400');
        }
        if (LOCAL.test(host)) {
          return new Response('<html><body><h1>403 Forbidden</h1></body></html>', {
            status: 403,
            headers: { 'content-type': 'text/html' },
          });
        }
      }
      if (currency !== 'USD' && currency !== 'LBP') {
        return fail('currency.not_supported', `${currency} currency is not supported`);
      }
      if (!externalId || body.amount == null) return fail('400');

      const existing = payments.get(externalId);
      if (existing) {
        const same = JSON.stringify(existing.request) === JSON.stringify(body);
        return json(envelope(true, null, same ? { collectUrl: existing.collectUrl } : null, { retrieved: true }));
      }
      const payment: MockPayment = {
        externalId,
        currency,
        amount: String(body.amount),
        status: 'pending',
        collectUrl: `https://mock.whish.invalid/pay/${(++counter).toString(36).padStart(7, '0')}`,
        request: body,
        payerPhoneNumber: '',
      };
      payments.set(externalId, payment);
      return json(envelope(true, null, { collectUrl: payment.collectUrl }));
    }

    if (path === '/payment/collect/status') {
      const payment = payments.get(externalId);
      if (!payment || payment.currency !== currency) return fail('external_id.not_exists');
      return json(
        envelope(true, null, { collectStatus: payment.status, payerPhoneNumber: payment.payerPhoneNumber }),
      );
    }

    if (path === '/payment/whish/refund') {
      if (options.refundsAllowed === false) return fail('auth.error');
      if (!externalId || !currency || !String(body.refundReason ?? '').trim()) return fail('bad.request');
      const payment = payments.get(externalId);
      if (!payment || payment.currency !== currency) return fail('external_id.not_exists');
      if (refunded.has(externalId)) return json(envelope(true, null, null, { retrieved: true }));
      if (payment.status !== 'success') return fail('whishpay.tx.invalid_state');
      payment.status = 'refunded';
      refunded.add(externalId);
      return json(envelope(true, null, null));
    }

    return new Response('Not Found', { status: 404 });
  };

  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const text = request.method === 'GET' ? '' : await request.text();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    requests.push({
      method: request.method,
      path: url.pathname.replace(/^.*\/itel-service\/api/, '') + url.search,
      headers: Object.fromEntries(request.headers),
      body,
    });

    const fault = faults.shift();
    if (fault === 'network') throw new TypeError('fetch failed');
    if (fault && 'http' in fault) return new Response('<html>error</html>', { status: fault.http });
    if (fault) return fail(fault.code, fault.message);

    return handle(request.method, url, request.headers, body);
  };

  return {
    fetch: mockFetch as typeof fetch,
    payments,
    requests,
    simulateSuccess(externalId, payerPhoneNumber = '96170000000') {
      Object.assign(get(externalId), { status: 'success', payerPhoneNumber });
    },
    simulateFailure(externalId) {
      get(externalId);
    },
    expire(externalId) {
      const payment = get(externalId);
      if (payment.status === 'pending') payment.status = 'failed';
    },
    failNext(fault, times = 1) {
      for (let i = 0; i < times; i++) faults.push(fault);
    },
    reset() {
      payments.clear();
      refunded.clear();
      requests.length = 0;
      faults.length = 0;
      counter = 0;
      balances = { USD: 1000, LBP: 0, ...options.balances };
    },
  };
}
