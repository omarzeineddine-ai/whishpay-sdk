export const CURRENCIES = ['USD', 'LBP'] as const;
export type Currency = (typeof CURRENCIES)[number];

export type Environment = 'sandbox' | 'production';

export const PAYMENT_STATUSES = ['pending', 'success', 'failed', 'refunded', 'unknown'] as const;
/**
 * - `pending`: not paid yet (also the state after a failed attempt, until the link expires)
 * - `success`: paid
 * - `failed`: the link expired unpaid
 * - `refunded`: a successful payment was refunded
 * - `unknown`: Whish could not determine the final state
 */
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Identifies your application to Whish. Sent as the `User-Agent` header. */
export interface UserAgentInfo {
  /** Your app's name, for example `AcmeStore`. */
  name: string;
  version: string;
  /** Your site, for example `https://acme.example`. */
  website: string;
  /** A contact address Whish can reach your developers at. */
  email: string;
}

export interface WhishConfig {
  /** Channel ID issued by Whish. */
  channel: string;
  /** Secret issued by Whish. Server-side only. */
  secret: string;
  /** The website URL exactly as Whish registered it with your keys. */
  websiteUrl: string;
  /** Required. Never inferred from `NODE_ENV`. */
  environment: Environment;
  /** Either a ready-made header value or its parts. */
  userAgent: string | UserAgentInfo;
  /** Per-attempt timeout. Default 30 000 ms. */
  timeoutMs?: number;
  /** Extra attempts after the first for retryable failures. Default 2. */
  maxRetries?: number;
  /** Base delay between retries; doubles each attempt. Default 500 ms. */
  retryDelayMs?: number;
  /** Custom `fetch`, for example the mock from `whishpay-sdk/testing`. */
  fetch?: typeof fetch;
  /** Override the API base URL. Rarely needed. */
  baseUrl?: string;
}

export interface CreatePaymentInput {
  /**
   * A decimal string is safest (`'25.00'`). A number is accepted only when it
   * needs no more decimals than the currency allows.
   */
  amount: string | number;
  currency: Currency;
  /**
   * Your unique reference for this payment. Reuse it only to resend the
   * identical request; a changed cart needs a new one.
   */
  externalId: string;
  /** Description shown to the payer. */
  invoice?: string;
  /** Whish calls this (GET, server to server) after a successful payment. */
  successCallbackUrl: string;
  /** Whish calls this (GET, server to server) after a failed attempt. */
  failureCallbackUrl: string;
  /** The payer's browser lands here after paying. */
  successRedirectUrl: string;
  /** The payer's browser lands here after a failed attempt. */
  failureRedirectUrl: string;
}

export interface CreatePaymentResult {
  /** Send the payer here. The link allows one attempt and expires after a few minutes. */
  collectUrl: string;
  externalId: string;
  /** `true` when Whish replayed an earlier identical request instead of creating a new link. */
  retrieved: boolean;
}

export interface PaymentRef {
  externalId: string;
  currency: Currency;
}

export interface PaymentStatusResult {
  externalId: string;
  currency: Currency;
  status: PaymentStatus;
  /** The value Whish sent, in case it is one this SDK version does not know. */
  rawStatus: string;
  payerPhoneNumber?: string;
}

export interface RefundInput extends PaymentRef {
  reason: string;
}

export interface RefundResult {
  externalId: string;
  /** `true` when this refund had already been processed by an earlier request. */
  retrieved: boolean;
}

export interface BalanceResult {
  currency: Currency;
  balance: number;
}

export interface WaitForResultOptions extends PaymentRef {
  /** Give up after this long. Default 6 minutes (links expire after about 5). */
  timeoutMs?: number;
  /** Delay between status checks. Default 3 000 ms. */
  intervalMs?: number;
  signal?: AbortSignal;
}

export interface WhishDialog {
  title?: string | null;
  message?: string | null;
}

/** The wrapper every Whish response arrives in. */
export interface WhishEnvelope<T = unknown> {
  status: boolean;
  code: string | number | null;
  dialog: WhishDialog | null;
  data?: T | null;
  extra?: unknown;
  actions?: unknown;
  retrieved?: boolean;
}
