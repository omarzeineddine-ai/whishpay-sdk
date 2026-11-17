import { isCurrency } from './amount';
import { WhishValidationError } from './errors';
import type { Currency, PaymentRef, PaymentStatusResult } from './types';

/** Query parameter `buildUrl` adds and `verify` reads. */
export const CALLBACK_REF_PARAM = 'ref';

/** What your `lookup` returns for an order you recognise. */
export interface CallbackOrder {
  currency: Currency;
}

export interface VerifyOptions<TOrder extends CallbackOrder> {
  /**
   * Finds the order for an `externalId` in your own database. Return `null`
   * for IDs you do not recognise. The currency is taken from your record,
   * never from the URL, because anyone can call a callback URL.
   */
  lookup: (externalId: string) => TOrder | null | undefined | Promise<TOrder | null | undefined>;
}

export type VerifyResult<TOrder extends CallbackOrder> =
  | { found: false; externalId: string | null }
  | (PaymentStatusResult & { found: true; order: TOrder });

export interface Callbacks {
  /**
   * Adds your payment reference to a callback or redirect URL. Whish keeps
   * query parameters intact when it calls the URL.
   */
  buildUrl(baseUrl: string, externalId: string, extraParams?: Record<string, string>): string;
  /**
   * Handles a callback request: reads the reference, looks the order up in
   * your database, then asks Whish for the real payment status. The callback
   * itself proves nothing, so act only on the returned `status`.
   *
   * Callbacks can arrive more than once and before the status has changed.
   * Make fulfilment idempotent and treat `pending` as "check again later".
   */
  verify<TOrder extends CallbackOrder>(
    request: Request | URL | string,
    options: VerifyOptions<TOrder>,
  ): Promise<VerifyResult<TOrder>>;
}

export function createCallbacks(getStatus: (ref: PaymentRef) => Promise<PaymentStatusResult>): Callbacks {
  return {
    buildUrl(baseUrl, externalId, extraParams = {}) {
      let url: URL;
      try {
        url = new URL(baseUrl);
      } catch {
        throw new WhishValidationError('baseUrl must be an absolute URL', 'baseUrl');
      }
      if (!externalId) throw new WhishValidationError('externalId is required', 'externalId');
      for (const [key, value] of Object.entries(extraParams)) url.searchParams.set(key, value);
      url.searchParams.set(CALLBACK_REF_PARAM, externalId);
      return url.toString();
    },

    async verify(request, { lookup }) {
      const raw = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
      let externalId: string | null = null;
      try {
        // Frameworks such as Express expose only the path and query.
        externalId = new URL(raw, 'http://callback.invalid').searchParams.get(CALLBACK_REF_PARAM);
      } catch {
        // falls through to "not found"
      }
      if (!externalId) return { found: false, externalId: null };

      const order = await lookup(externalId);
      if (!order) return { found: false, externalId };
      if (!isCurrency(order.currency)) {
        throw new WhishValidationError('lookup must return an order with currency "USD" or "LBP"', 'currency');
      }

      const status = await getStatus({ externalId, currency: order.currency });
      return { ...status, found: true, order };
    },
  };
}
