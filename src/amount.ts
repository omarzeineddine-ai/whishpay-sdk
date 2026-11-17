import { WhishValidationError } from './errors';
import { CURRENCIES, type Currency } from './types';

/** Decimal places each currency allows. */
export const CURRENCY_DECIMALS: Record<Currency, number> = { USD: 2, LBP: 0 };

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);
}

/**
 * Converts an amount to the exact decimal string Whish expects.
 *
 * Strings are checked, never rounded. Numbers are accepted only when they are
 * already exact at the currency's precision, so `0.1 + 0.2` is rejected
 * instead of silently becoming `0.30`.
 *
 * @example
 * toAmount('25', 'USD')    // '25.00'
 * toAmount(25.5, 'USD')    // '25.50'
 * toAmount('150000', 'LBP') // '150000'
 * toAmount('5.123', 'USD') // throws WhishValidationError
 */
export function toAmount(value: string | number, currency: Currency): string {
  if (!isCurrency(currency)) {
    throw new WhishValidationError(`currency must be one of ${CURRENCIES.join(', ')}`, 'currency');
  }
  const decimals = CURRENCY_DECIMALS[currency];
  const limit = decimals === 0 ? 'no decimals' : `at most ${decimals} decimals`;

  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER) {
      throw new WhishValidationError('amount must be a finite number', 'amount');
    }
    text = value.toFixed(decimals);
    if (Number(text) !== value) {
      throw new WhishValidationError(
        `amount ${value} is not exact for ${currency} (${limit}). Pass a decimal string instead.`,
        'amount',
      );
    }
  } else if (typeof value === 'string') {
    text = value.trim();
    if (!/^\d+(\.\d+)?$/.test(text)) {
      throw new WhishValidationError('amount must be a plain decimal such as "25.00"', 'amount');
    }
  } else {
    throw new WhishValidationError('amount must be a string or number', 'amount');
  }

  const [whole = '0', fraction = ''] = text.split('.');
  if (fraction.length > decimals) {
    throw new WhishValidationError(`${currency} amounts allow ${limit}; got "${text}"`, 'amount');
  }
  const normalised =
    whole.replace(/^0+(?=\d)/, '') + (decimals > 0 ? `.${fraction.padEnd(decimals, '0')}` : '');
  if (!/[1-9]/.test(normalised)) {
    throw new WhishValidationError('amount must be greater than zero', 'amount');
  }
  return normalised;
}
