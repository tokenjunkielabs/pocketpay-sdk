/**
 * Exact balance display normalisation for SDK consumers.
 *
 * Stellar amounts carry at most seven decimal places. Display formatting must
 * never round a spendable balance upward, so this module parses through the
 * SDK's bigint-backed SafeAmount model and truncates only at the presentation
 * boundary.
 */

import type { AssetBalanceItem } from '../types/balance';
import type { Asset } from '../types/asset';
import { validateAsset } from '../types/asset';
import { AMOUNT_DECIMALS, safeParseAmount } from './amount';

export type BalanceDisplayState = 'valid' | 'missing' | 'invalid';

export type BalanceDisplayAssetInput =
  | { type: 'native'; code?: string }
  | { type: 'issued'; code?: string; issuer?: string }
  | null
  | undefined;

export interface BalanceDisplayInput {
  amount?: string | null;
  asset?: BalanceDisplayAssetInput;
}

export interface BalanceDisplayOptions {
  /** Decimal places shown to consumers. Clamped to Stellar's 0..7 range. */
  decimals?: number;
  /** Add comma thousands separators. Defaults to true. */
  useGrouping?: boolean;
  /** Include the shortened issuer in the rendered text for issued assets. */
  includeIssuer?: boolean;
  /** Placeholder for null/undefined/empty amounts. Defaults to "--". */
  missingLabel?: string;
  /** Placeholder for malformed amounts or assets. Defaults to "--". */
  invalidLabel?: string;
}

export interface NormalizedBalanceDisplay {
  state: BalanceDisplayState;
  assetType: 'native' | 'issued' | 'unknown';
  assetCode: string;
  issuer?: string;
  issuerDisplay?: string;
  rawAmount?: string;
  canonicalAmount?: string;
  displayAmount: string;
  text: string;
  reason?: string;
}

const DEFAULT_DECIMALS = 2;

function resolveDecimals(value: number | undefined): number {
  if (!Number.isInteger(value)) return DEFAULT_DECIMALS;
  return Math.min(AMOUNT_DECIMALS, Math.max(0, value as number));
}

function groupWhole(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function shortenIssuer(issuer: string): string {
  return issuer.length <= 12 ? issuer : issuer.slice(0, 4) + '...' + issuer.slice(-4);
}

function describeAsset(input: BalanceDisplayAssetInput): {
  asset?: Asset;
  assetType: 'native' | 'issued' | 'unknown';
  assetCode: string;
  issuer?: string;
  reason?: string;
} {
  if (!input || typeof input !== 'object') {
    return { assetType: 'unknown', assetCode: 'UNKNOWN', reason: 'Asset is missing' };
  }

  if (input.type === 'native') {
    if (input.code !== undefined && input.code !== 'XLM') {
      return {
        assetType: 'unknown',
        assetCode: String(input.code || 'UNKNOWN'),
        reason: 'Native asset code must be XLM',
      };
    }
    return {
      asset: { type: 'native', code: 'XLM' },
      assetType: 'native',
      assetCode: 'XLM',
    };
  }

  if (input.type === 'issued') {
    const asset: Asset = {
      type: 'issued',
      code: typeof input.code === 'string' ? input.code : '',
      issuer: typeof input.issuer === 'string' ? input.issuer : '',
    };
    const validation = validateAsset(asset);
    if (!validation.valid) {
      return {
        assetType: 'issued',
        assetCode: asset.code || 'UNKNOWN',
        issuer: asset.issuer || undefined,
        reason: validation.error || 'Issued asset is invalid',
      };
    }
    return {
      asset,
      assetType: 'issued',
      assetCode: asset.code,
      issuer: asset.issuer,
    };
  }

  return { assetType: 'unknown', assetCode: 'UNKNOWN', reason: 'Unsupported asset type' };
}

function formatStroopsForDisplay(
  stroops: bigint,
  decimals: number,
  useGrouping: boolean,
): string {
  const scale = 10n ** BigInt(AMOUNT_DECIMALS);
  const wholeValue = stroops / scale;
  const fractionalValue = stroops % scale;

  let whole = wholeValue.toString();
  if (useGrouping) whole = groupWhole(whole);
  if (decimals === 0) return whole;

  const fraction = fractionalValue
    .toString()
    .padStart(AMOUNT_DECIMALS, '0')
    .slice(0, decimals);

  return whole + '.' + fraction;
}

/**
 * Normalise a raw balance amount and asset identity into a deterministic,
 * display-ready shape. This function never throws for consumer data.
 */
export function normalizeBalanceDisplay(
  input: BalanceDisplayInput,
  options: BalanceDisplayOptions = {},
): NormalizedBalanceDisplay {
  const decimals = resolveDecimals(options.decimals);
  const useGrouping = options.useGrouping !== false;
  const includeIssuer = options.includeIssuer === true;
  const missingLabel = options.missingLabel ?? '--';
  const invalidLabel = options.invalidLabel ?? '--';
  const asset = describeAsset(input.asset);
  const issuerDisplay = asset.issuer ? shortenIssuer(asset.issuer) : undefined;

  const suffix = asset.assetCode === 'UNKNOWN' ? '' : ' ' + asset.assetCode;
  const issuerSuffix =
    includeIssuer && issuerDisplay && asset.assetType === 'issued'
      ? ' (' + issuerDisplay + ')'
      : '';

  if (asset.reason) {
    return {
      state: 'invalid',
      assetType: asset.assetType,
      assetCode: asset.assetCode,
      issuer: asset.issuer,
      issuerDisplay,
      displayAmount: invalidLabel,
      text: invalidLabel + suffix + issuerSuffix,
      reason: asset.reason,
    };
  }

  const rawAmount = input.amount;
  if (rawAmount === undefined || rawAmount === null || rawAmount === '') {
    return {
      state: 'missing',
      assetType: asset.assetType,
      assetCode: asset.assetCode,
      issuer: asset.issuer,
      issuerDisplay,
      displayAmount: missingLabel,
      text: missingLabel + suffix + issuerSuffix,
      reason: 'Balance amount is missing',
    };
  }

  if (typeof rawAmount !== 'string') {
    return {
      state: 'invalid',
      assetType: asset.assetType,
      assetCode: asset.assetCode,
      issuer: asset.issuer,
      issuerDisplay,
      displayAmount: invalidLabel,
      text: invalidLabel + suffix + issuerSuffix,
      reason: 'Balance amount must be a decimal string',
    };
  }

  const parsed = safeParseAmount(rawAmount);
  if (!parsed.valid) {
    return {
      state: 'invalid',
      assetType: asset.assetType,
      assetCode: asset.assetCode,
      issuer: asset.issuer,
      issuerDisplay,
      rawAmount,
      displayAmount: invalidLabel,
      text: invalidLabel + suffix + issuerSuffix,
      reason: parsed.error.message,
    };
  }

  const displayAmount = formatStroopsForDisplay(parsed.amount.stroops, decimals, useGrouping);
  return {
    state: 'valid',
    assetType: asset.assetType,
    assetCode: asset.assetCode,
    issuer: asset.issuer,
    issuerDisplay,
    rawAmount,
    canonicalAmount: parsed.amount.toDecimal(),
    displayAmount,
    text: displayAmount + suffix + issuerSuffix,
  };
}

/** Return only the consumer-facing text from normalizeBalanceDisplay(). */
export function formatBalanceDisplay(
  input: BalanceDisplayInput,
  options: BalanceDisplayOptions = {},
): string {
  return normalizeBalanceDisplay(input, options).text;
}

/**
 * Adapt an existing MultiAssetBalance item to the shared display normaliser.
 */
export function normalizeAssetBalanceItemForDisplay(
  item: AssetBalanceItem,
  options: BalanceDisplayOptions = {},
): NormalizedBalanceDisplay {
  if (item.type === 'native') {
    return normalizeBalanceDisplay(
      { amount: item.availableBalance, asset: { type: 'native', code: 'XLM' } },
      options,
    );
  }

  if (item.type === 'issued') {
    const normalized = normalizeBalanceDisplay(
      {
        amount: item.availableBalance,
        asset: { type: 'issued', code: item.assetCode, issuer: item.issuer },
      },
      options,
    );
    if (!item.isAuthorized || item.state === 'unauthorized') {
      return {
        ...normalized,
        text: normalized.text + ' (Unauthorized)',
      };
    }
    return normalized;
  }

  const amount = safeParseAmount(item.totalBalance);
  const decimals = resolveDecimals(options.decimals);
  const displayAmount = amount.valid
    ? formatStroopsForDisplay(
        amount.amount.stroops,
        decimals,
        options.useGrouping !== false,
      )
    : (options.invalidLabel ?? '--');

  return {
    state: 'invalid',
    assetType: 'unknown',
    assetCode: item.assetCode || 'UNKNOWN',
    issuer: item.issuer,
    issuerDisplay: item.issuer ? shortenIssuer(item.issuer) : undefined,
    rawAmount: item.totalBalance,
    canonicalAmount: amount.valid ? amount.amount.toDecimal() : undefined,
    displayAmount,
    text: displayAmount + ' ' + (item.assetCode || 'UNKNOWN') + ' (Unknown)',
    reason: 'Unknown or unsupported asset balance',
  };
}
