# Errors and retries

## What throws

A payment being `failed`, `pending` or `unknown` is a normal return value. The
SDK throws only when a request could not be completed or Whish refused it.

| Error | When | What to do |
|---|---|---|
| `WhishValidationError` | Bad input, caught before any request. `field` names it. | Fix the input. |
| `WhishApiError` | Whish refused the request. | Branch on `code`. |
| `WhishPendingError` | A payment or refund kept returning Whish's "outcome unknown" code. | Do not mark it failed. Resend the same request later, or check the status. |
| `WhishIdempotencyError` | The `externalId` was already used with different details. | Use a new `externalId`. |
| `WhishTimeoutError`, `WhishNetworkError` | Whish could not be reached. | For `create`, resend with the same `externalId`. |
| `WhishResponseError` | Whish answered with something other than JSON. | See `httpStatus` and `bodyPreview`. |
| `WhishConfigError` | The client was constructed incorrectly. | Fix the options. |

All of them extend `WhishError`.

```ts
import { WhishApiError, WhishPendingError } from 'whishpay-sdk';

try {
  await whish.payments.create(input);
} catch (error) {
  if (error instanceof WhishPendingError) {
    // Unknown outcome: keep the order open and try the same request again later.
  } else if (error instanceof WhishApiError) {
    console.error(error.code, error.retryable, error.needsNewExternalId);
  } else {
    throw error;
  }
}
```

## Error codes

Whish answers with HTTP 200 even for failures and puts the reason in a `code`.
The SDK reads the code for you. Each `WhishApiError` carries:

- `code`: match on this, never on the message text.
- `retryable`: resending the identical request may work.
- `needsNewExternalId`: a new attempt must use a new reference.
- `dialog`: the title and message Whish sent, if any.

`ERROR_CODES` lists every code the SDK knows, and `describeErrorCode(code)`
returns its details. Common ones:

| Code | Meaning |
|---|---|
| `auth.session_not_exist` | Credentials are wrong for this environment. |
| `auth.error` | Your server's IP is not registered with Whish (refunds). |
| `currency.not_supported` | Use USD or LBP. |
| `external_id.not_exists` | No payment with that reference and currency. |
| `whishpay.tx.invalid_state` | Only a successful payment can be refunded. |
| `sales.exceeded_daily_limit` | Daily limit reached. |
| `sales.account_balance_insufficient` | Balance too low. |

## Automatic retries

| Call | Retried automatically? |
|---|---|
| `payments.status`, `balance.get` | Yes. Reading is always safe to repeat. |
| `payments.create` | Yes, with the identical body and the same `externalId`, so Whish never creates it twice. |
| `payments.refund` | No. |

A retry happens after a timeout, a network failure, or one of Whish's transient
codes. Refusals such as a limit being reached or bad credentials are never
retried. Tune with `maxRetries` and `retryDelayMs`, or set `maxRetries: 0` to
turn retries off.
