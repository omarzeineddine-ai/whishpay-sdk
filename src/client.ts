import { isCurrency, toAmount } from './amount';
import { createCallbacks, type Callbacks } from './callbacks';
import {
  WhishApiError,
  WhishConfigError,
  WhishIdempotencyError,
  WhishNetworkError,
  WhishPendingError,
  WhishResponseError,
  WhishTimeoutError,
  WhishValidationError,
  describeErrorCode,
} from './errors';
import {
  CURRENCIES,
  PAYMENT_STATUSES,
  type BalanceResult,
  type CreatePaymentInput,
  type CreatePaymentResult,
  type Currency,
  type Environment,
  type PaymentRef,
  type PaymentStatus,
  type PaymentStatusResult,
  type RefundInput,
  type RefundResult,
  type UserAgentInfo,
  type WaitForResultOptions,
  type WhishConfig,
  type WhishEnvelope,
} from './types';

export const BASE_URLS: Record<Environment, string> = {
  sandbox: 'https://partner.api.sbx.whish.money/itel-service/api',
  production: 'https://api.whish.money/itel-service/api',
};

const URL_FIELDS = [
  'successCallbackUrl',
  'failureCallbackUrl',
  'successRedirectUrl',
  'failureRedirectUrl',
] as const;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);

/** `read`: always safe to resend. `write`: resent with the same externalId. `none`: one attempt. */
type RetryMode = 'read' | 'write' | 'none';

interface RequestOptions {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
  retry: RetryMode;
  /** Added to the error when Whish answers with a non-JSON page. */
  nonJsonHint?: string;
}

interface Ok<T> {
  data: T | null;
  retrieved: boolean;
  envelope: WhishEnvelope<T>;
}

export interface Payments {
  /** Creates a payment link. Throws unless Whish returns one. */
  create(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** Current state of a payment. A `failed` or `pending` payment is a result, not an error. */
  status(ref: PaymentRef): Promise<PaymentStatusResult>;
  /**
   * Refunds a successful payment. Requires your server IP to be registered
   * with Whish. Experimental: never retried automatically.
   */
  refund(input: RefundInput): Promise<RefundResult>;
  /**
   * Polls `status` until the payment leaves `pending` or the timeout passes,
   * then returns the latest result. Intended for scripts and workers, not for
   * serverless request handlers with short time limits.
   */
  waitForResult(options: WaitForResultOptions): Promise<PaymentStatusResult>;
}

export interface Balance {
  get(currency: Currency): Promise<BalanceResult>;
}

function formatUserAgent(ua: string | UserAgentInfo): string {
  if (typeof ua === 'string') {
    if (!ua.trim()) throw new WhishConfigError('userAgent must not be empty');
    return ua.trim();
  }
  for (const key of ['name', 'version', 'website', 'email'] as const) {
    if (!ua?.[key]) throw new WhishConfigError(`userAgent.${key} is required`);
  }
  return `${ua.name.replace(/\s+/g, '')}/${ua.version} (${ua.website}; ${ua.email})`;
}

function requireRef(ref: PaymentRef): void {
  if (typeof ref?.externalId !== 'string' || !ref.externalId.trim()) {
    throw new WhishValidationError('externalId must be a non-empty string', 'externalId');
  }
  if (!isCurrency(ref.currency)) {
    throw new WhishValidationError(`currency must be one of ${CURRENCIES.join(', ')}`, 'currency');
  }
}

function requirePublicUrl(value: unknown, field: string): void {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new WhishValidationError(`${field} must be an absolute URL`, field);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new WhishValidationError(`${field} must be an http(s) URL`, field);
  }
  if (LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith('.localhost')) {
    throw new WhishValidationError(
      `${field} points at ${url.hostname}, which Whish cannot reach and rejects. ` +
        'Use a public URL; in development, a tunnel such as cloudflared or ngrok.',
      field,
    );
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });

/**
 * Client for the Whish Pay API.
 *
 * @example
 * const whish = new Whish({
 *   channel: process.env.WHISH_CHANNEL!,
 *   secret: process.env.WHISH_SECRET!,
 *   websiteUrl: process.env.WHISH_WEBSITE_URL!,
 *   environment: 'sandbox',
 *   userAgent: { name: 'AcmeStore', version: '1.0', website: 'https://acme.example', email: 'dev@acme.example' },
 * });
 */
export class Whish {
  readonly environment: Environment;
  readonly baseUrl: string;
  readonly payments: Payments;
  readonly balance: Balance;
  readonly callbacks: Callbacks;

  readonly #headers: Record<string, string>;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #retryDelayMs: number;

  constructor(config: WhishConfig) {
    for (const key of ['channel', 'secret', 'websiteUrl'] as const) {
      if (typeof config?.[key] !== 'string' || !config[key].trim()) {
        throw new WhishConfigError(`${key} is required`);
      }
    }
    if (config.environment !== 'sandbox' && config.environment !== 'production') {
      throw new WhishConfigError('environment must be "sandbox" or "production"');
    }
    const fetchImpl = config.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new WhishConfigError('No fetch available. Pass one in the `fetch` option.');
    }

    this.environment = config.environment;
    this.baseUrl = (config.baseUrl ?? BASE_URLS[config.environment]).replace(/\/+$/, '');
    this.#headers = {
      channel: config.channel.trim(),
      secret: config.secret.trim(),
      websiteUrl: config.websiteUrl.trim(),
      'User-Agent': formatUserAgent(config.userAgent),
      Accept: 'application/json',
    };
    this.#fetch = fetchImpl.bind(globalThis);
    this.#timeoutMs = config.timeoutMs ?? 30_000;
    this.#maxRetries = Math.max(0, config.maxRetries ?? 2);
    this.#retryDelayMs = Math.max(0, config.retryDelayMs ?? 500);

    this.payments = {
      create: (input) => this.#createPayment(input),
      status: (ref) => this.#paymentStatus(ref),
      refund: (input) => this.#refund(input),
      waitForResult: (options) => this.#waitForResult(options),
    };
    this.balance = { get: (currency) => this.#balance(currency) };
    this.callbacks = createCallbacks((ref) => this.#paymentStatus(ref));
  }

  /** Keeps the secret out of logs and serialised output. */
  toJSON(): Record<string, unknown> {
    return { environment: this.environment, baseUrl: this.baseUrl, channel: this.#headers.channel, secret: '[redacted]' };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `Whish ${JSON.stringify(this.toJSON())}`;
  }

  async #createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    requireRef(input);
    const amount = toAmount(input.amount, input.currency);
    for (const field of URL_FIELDS) requirePublicUrl(input[field], field);
    if (input.invoice !== undefined && typeof input.invoice !== 'string') {
      throw new WhishValidationError('invoice must be a string', 'invoice');
    }

    const body: Record<string, unknown> = {
      amount,
      currency: input.currency,
      externalId: input.externalId,
      successCallbackUrl: input.successCallbackUrl,
      failureCallbackUrl: input.failureCallbackUrl,
      successRedirectUrl: input.successRedirectUrl,
      failureRedirectUrl: input.failureRedirectUrl,
    };
    if (input.invoice) body.invoice = input.invoice;

    const { data, retrieved, envelope } = await this.#request<{ collectUrl?: string }>({
      method: 'POST',
      path: '/payment/whish',
      body,
      retry: 'write',
      nonJsonHint:
        'Whish rejects callback and redirect URLs it cannot reach from the internet. Check that all four are public.',
    });

    if (!data?.collectUrl) {
      // Observed in the sandbox: reusing an externalId with a different body
      // returns status:true, retrieved:true and no data.
      if (retrieved) throw new WhishIdempotencyError(input.externalId, envelope);
      throw new WhishApiError('no_collect_url', {
        envelope,
        message: 'Whish reported success but returned no payment link.',
      });
    }
    return { collectUrl: data.collectUrl, externalId: input.externalId, retrieved };
  }

  async #paymentStatus(ref: PaymentRef): Promise<PaymentStatusResult> {
    requireRef(ref);
    const { data } = await this.#request<{ collectStatus?: string; payerPhoneNumber?: string }>({
      method: 'POST',
      path: '/payment/collect/status',
      body: { currency: ref.currency, externalId: ref.externalId },
      retry: 'read',
    });
    const rawStatus = String(data?.collectStatus ?? 'unknown');
    const status = (PAYMENT_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as PaymentStatus)
      : 'unknown';
    return {
      externalId: ref.externalId,
      currency: ref.currency,
      status,
      rawStatus,
      ...(data?.payerPhoneNumber ? { payerPhoneNumber: data.payerPhoneNumber } : {}),
    };
  }

  async #refund(input: RefundInput): Promise<RefundResult> {
    requireRef(input);
    if (typeof input.reason !== 'string' || !input.reason.trim()) {
      throw new WhishValidationError('reason must be a non-empty string', 'reason');
    }
    const { retrieved } = await this.#request<null>({
      method: 'POST',
      path: '/payment/whish/refund',
      body: { currency: input.currency, externalId: input.externalId, refundReason: input.reason },
      retry: 'none',
    });
    return { externalId: input.externalId, retrieved };
  }

  async #balance(currency: Currency): Promise<BalanceResult> {
    if (!isCurrency(currency)) {
      throw new WhishValidationError(`currency must be one of ${CURRENCIES.join(', ')}`, 'currency');
    }
    const { data } = await this.#request<{ balance?: number }>({
      method: 'GET',
      path: `/payment/account/balance?currency=${currency}`,
      retry: 'read',
    });
    if (typeof data?.balance !== 'number') {
      throw new WhishApiError('no_balance', { message: 'Whish reported success but returned no balance.' });
    }
    return { currency, balance: data.balance };
  }

  async #waitForResult(options: WaitForResultOptions): Promise<PaymentStatusResult> {
    const deadline = Date.now() + (options.timeoutMs ?? 6 * 60_000);
    const interval = options.intervalMs ?? 3_000;
    for (;;) {
      const result = await this.#paymentStatus(options);
      if (result.status !== 'pending' || Date.now() + interval > deadline) return result;
      await sleep(interval, options.signal);
    }
  }

  async #request<T>(options: RequestOptions): Promise<Ok<T>> {
    const attempts = options.retry === 'none' ? 1 : this.#maxRetries + 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(this.#retryDelayMs * 2 ** (attempt - 1));
      try {
        return await this.#attempt<T>(options);
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof WhishNetworkError ||
          (error instanceof WhishApiError && error.retryable) ||
          (error instanceof WhishResponseError && error.httpStatus >= 500);
        if (!retryable) break;
      }
    }

    // A write that keeps answering 500 may still have gone through.
    if (lastError instanceof WhishApiError && lastError.code === '500' && options.retry !== 'read') {
      throw new WhishPendingError('500', {
        dialog: lastError.dialog,
        httpStatus: lastError.httpStatus,
        envelope: lastError.envelope,
      });
    }
    throw lastError;
  }

  async #attempt<T>(options: RequestOptions): Promise<Ok<T>> {
    let response: Response;
    let text: string;
    try {
      response = await this.#fetch(this.baseUrl + options.path, {
        method: options.method,
        headers: options.body ? { ...this.#headers, 'Content-Type': 'application/json' } : this.#headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      text = await response.text();
    } catch (error) {
      const name = (error as { name?: string } | null)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new WhishTimeoutError(`Whish did not respond within ${this.#timeoutMs} ms`, { cause: error });
      }
      throw new WhishNetworkError(`Could not reach Whish: ${(error as Error)?.message ?? error}`, { cause: error });
    }

    let envelope: WhishEnvelope<T> | undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && typeof (parsed as WhishEnvelope).status === 'boolean') {
        envelope = parsed as WhishEnvelope<T>;
      }
    } catch {
      // handled below
    }
    if (!envelope) {
      const hint = response.status === 403 && options.nonJsonHint ? ` ${options.nonJsonHint}` : '';
      throw new WhishResponseError(
        `Whish returned HTTP ${response.status} without a JSON result.${hint}`,
        response.status,
        text.slice(0, 200),
      );
    }

    if (envelope.status === true) {
      return { data: envelope.data ?? null, retrieved: envelope.retrieved === true, envelope };
    }
    const code = envelope.code == null ? 'unknown' : String(envelope.code);
    throw new WhishApiError(code, { dialog: envelope.dialog, httpStatus: response.status, envelope });
  }
}

export { describeErrorCode };
