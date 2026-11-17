export { Whish, BASE_URLS } from './client';
export type { Payments, Balance } from './client';
export { CALLBACK_REF_PARAM } from './callbacks';
export type { Callbacks, CallbackOrder, VerifyOptions, VerifyResult } from './callbacks';
export { toAmount, isCurrency, CURRENCY_DECIMALS } from './amount';
export {
  WhishError,
  WhishConfigError,
  WhishValidationError,
  WhishNetworkError,
  WhishTimeoutError,
  WhishResponseError,
  WhishApiError,
  WhishPendingError,
  WhishIdempotencyError,
  ERROR_CODES,
  describeErrorCode,
} from './errors';
export type { KnownWhishErrorCode, WhishErrorCode } from './errors';
export { CURRENCIES, PAYMENT_STATUSES } from './types';
export type {
  BalanceResult,
  CreatePaymentInput,
  CreatePaymentResult,
  Currency,
  Environment,
  PaymentRef,
  PaymentStatus,
  PaymentStatusResult,
  RefundInput,
  RefundResult,
  UserAgentInfo,
  WaitForResultOptions,
  WhishConfig,
  WhishDialog,
  WhishEnvelope,
} from './types';

/** A fresh, unique payment reference. Store it with your order before creating the payment. */
export function generateExternalId(): string {
  return globalThis.crypto.randomUUID();
}
