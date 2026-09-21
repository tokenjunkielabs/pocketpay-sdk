# Balance display normaliser

Issue #447 adds one shared display boundary for wallet, payment, and vault consumers.

## Why this exists

Stellar amounts are exact decimal values with at most seven fractional digits. UI code must not
parse a spendable balance through JavaScript floating point and then round it upward. The SDK now
normalises display values through the existing bigint-backed SafeAmount model and truncates only
at the requested display precision.

## Public API

```ts
import {
  normalizeBalanceDisplay,
  formatBalanceDisplay,
  normalizeAssetBalanceItemForDisplay,
} from 'stellar-pocketpay-sdk';
```

`normalizeBalanceDisplay()` returns a typed object containing:

- `state`: `valid`, `missing`, or `invalid`
- `canonicalAmount`: exact seven-decimal Stellar amount when valid
- `displayAmount`: presentation-only amount, truncated to the requested precision
- `assetCode`, `issuer`, and shortened `issuerDisplay`
- `text`: a ready-to-render label

The helper does not throw for consumer balance data. Missing and malformed balances become explicit
states and use `--` by default.

## Native XLM

```ts
normalizeBalanceDisplay({
  amount: '9.9999999',
  asset: { type: 'native' },
});
// displayAmount: "9.99"
// text: "9.99 XLM"
```

The result deliberately shows `9.99`, never `10.00`.

## Issued assets

Issued assets require both a code and a valid Stellar issuer. Because asset codes are not globally
unique, list/detail UIs can request issuer identity in the label:

```ts
normalizeBalanceDisplay(
  {
    amount: '1234.5678901',
    asset: { type: 'issued', code: 'USDC', issuer },
  },
  { includeIssuer: true },
);
// text: "1,234.56 USDC (GA5Z...EM2C)"
```

When `includeIssuer` is false, the result still contains both `issuer` and `issuerDisplay` so
the consumer can render identity in a separate field.

## Formatting assumptions

- Default display precision: 2 decimals.
- Requested precision is clamped to Stellar's 0..7 decimal range.
- Display precision truncates; it never rounds a spendable amount upward.
- Grouping separators are enabled by default and can be disabled with `useGrouping: false`.
- Null, undefined, and empty-string amounts are `missing`.
- Malformed decimals, negative values, scientific notation, values beyond protocol limits, and
  issued assets with invalid code/issuer identity are `invalid`.
- Canonical/network values remain exact and unchanged; display formatting is presentation-only.
- Existing `formatAssetBalanceDisplay()` is routed through this normaliser so wallet-facing
  formatting uses the same policy.
