import type { WhishDialog, WhishEnvelope } from './types';

interface CodeInfo {
  /** Resending the identical request (same `externalId`) may succeed. */
  retryable: boolean;
  /** A new attempt must use a fresh `externalId`. */
  needsNewExternalId: boolean;
  hint: string;
}

const info = (hint: string, retryable = false, needsNewExternalId = false): CodeInfo => ({
  hint,
  retryable,
  needsNewExternalId,
});

/** What this SDK knows about each error code Whish can return. */
export const ERROR_CODES = {
  // Transient
  '500': info('Whish could not finish the request; the outcome is unknown. Resend the identical request.', true),
  'itel.unknown_error': info('Unexpected error at Whish. Resend once with the same externalId.', true),
  fatal: info('Whish failed to register the externalId. Resend with the same externalId.', true),
  'refresh.denominations': info('Service temporarily unavailable at Whish. Try again later.', true),
  'whish_pay.code_generation_failed': info('Whish could not generate the payment link. Try again.', true),

  // Credentials and request shape
  'auth.session_not_exist': info('Credentials missing or wrong. Check channel, secret and websiteUrl, and the environment.'),
  'auth.session_expired': info('Credentials expired. Ask Whish for new ones.'),
  'auth.error': info('The calling IP is not registered with Whish. Send Whish your public egress IPs.'),
  '400': info('Missing or invalid field or header. Fix the request before sending again.'),
  'bad.request': info('A required field is missing or blank.'),
  'timestamp.invalid': info('Server clock is out of sync. Sync it (NTP) and try again.'),
  'request.invalid': info('Whish rejected the request headers. Verify them.'),
  'device.invalid_os': info('Whish rejected the request headers. Verify them.'),
  'emoji.not_supported': info('The request contains characters Whish cannot store. Remove them.'),
  deprecation: info('This endpoint version is deprecated. Upgrade the SDK.'),

  // Payments
  'currency.not_supported': info('Use USD or LBP.'),
  invalid_currency: info('Use USD or LBP.'),
  'collect.wrong_denomination': info('The account is not set up for Whish Pay. Contact Whish.'),
  'collect.wrong_phone_format': info('Phone number must be in E.164 format.'),
  'collect.wrong_email_format': info('Email is invalid. Fix or omit it.'),
  'credit_card_payment.account_verification_required': info('The merchant account is not verified. Complete verification with Whish.'),
  'whish_pay.missing_pricing_id': info('No pricing is configured for this account. Contact Whish.'),
  'purchase.confirm': info('The quoted price changed. Re-quote and submit again.', false, true),
  fail: info('Whish could not compute the amount. Check amount and currency.'),

  // Status and refunds
  'external_id.not_exists': info('No payment exists for this externalId and currency.'),
  'collect.not_exists': info('No payment exists for this externalId.'),
  'whishpay.tx.invalid_source': info('This payment is not refundable. Contact Whish.'),
  'whishpay.tx.invalid_state': info('Only a payment with status "success" can be refunded.'),
  'whish_refund.transaction_not_found': info('Transaction not found. Contact Whish.'),
  'whish_refund.reverse_unsupported_type': info('This transaction cannot be reversed. Contact Whish.'),

  // Account and limits
  'sales.account_balance_insufficient': info('Balance too low. Top up, then retry with a new externalId.', false, true),
  'sales.account_balance_insufficient_no_balance': info('Balance too low. Top up, then retry with a new externalId.', false, true),
  'account.terminated': info('The account is terminated. Contact Whish.'),
  'account.dealer.terminated': info('The parent account is terminated. Contact Whish.'),
  'sales.denomination_not_active': info('The service is disabled for this account. Contact Whish.'),
  'sales.schema_not_active': info('Pricing is not active for this account. Contact Whish.'),
  'sales.exceeded_daily_limit': info('Daily limit reached. Wait or ask Whish for an increase.', false, true),
  'sales.exceeded_monthly_limit': info('Monthly limit reached. Wait or ask Whish for an increase.', false, true),
  'sales.lost_transactions_exist': info('Earlier results were not acknowledged. Check the status of earlier externalIds first.'),
} as const satisfies Record<string, CodeInfo>;

export type KnownWhishErrorCode = keyof typeof ERROR_CODES;
/** Known codes autocomplete; unknown ones are still allowed. */
export type WhishErrorCode = KnownWhishErrorCode | (string & {});

const UNKNOWN_CODE: CodeInfo = info('Unrecognised Whish error code.');

export function describeErrorCode(code: string): CodeInfo {
  return Object.hasOwn(ERROR_CODES, code) ? ERROR_CODES[code as KnownWhishErrorCode] : UNKNOWN_CODE;
}

/** Base class for everything this SDK throws. */
export class WhishError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The client was constructed with missing or invalid options. */
export class WhishConfigError extends WhishError {}

/** Input rejected before any request was sent. */
export class WhishValidationError extends WhishError {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
  }
}

/**
 * The request never produced a usable response. For `payments.create` and
 * `payments.refund` the outcome is unknown: resend the identical request with
 * the same `externalId`.
 */
export class WhishNetworkError extends WhishError {}

/** The request did not complete within `timeoutMs`. */
export class WhishTimeoutError extends WhishNetworkError {}

/** Whish answered with something other than its JSON envelope. */
export class WhishResponseError extends WhishError {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly bodyPreview: string,
  ) {
    super(message);
  }
}

/** Whish answered `status: false`. Branch on `code`, never on `message`. */
export class WhishApiError extends WhishError {
  readonly code: WhishErrorCode;
  readonly dialog: WhishDialog | null;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly needsNewExternalId: boolean;
  readonly envelope: WhishEnvelope | null;

  constructor(
    code: string,
    options: { dialog?: WhishDialog | null; httpStatus?: number; envelope?: WhishEnvelope | null; message?: string } = {},
  ) {
    const known = describeErrorCode(code);
    super(options.message ?? `Whish error "${code}": ${options.dialog?.message ?? known.hint}`);
    this.code = code;
    this.dialog = options.dialog ?? null;
    this.httpStatus = options.httpStatus ?? 200;
    this.retryable = known.retryable;
    this.needsNewExternalId = known.needsNewExternalId;
    this.envelope = options.envelope ?? null;
  }
}

/**
 * A payment or refund request kept returning code `500`. It may or may not
 * have gone through. Do not treat it as failed: resend the identical request
 * later with the same `externalId`, or check `payments.status`.
 */
export class WhishPendingError extends WhishApiError {}

/**
 * The `externalId` was already used for a different request. Whish replayed
 * the earlier one and returned no payment link. Use a new `externalId`
 * whenever the amount or any other field changes.
 */
export class WhishIdempotencyError extends WhishApiError {
  constructor(externalId: string, envelope: WhishEnvelope | null) {
    super('idempotency.conflict', {
      envelope,
      message:
        `externalId "${externalId}" was already used for a request with different details, ` +
        'so Whish returned no payment link. Use a new externalId when anything about the payment changes.',
    });
  }
}
