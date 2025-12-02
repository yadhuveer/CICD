import type { Holding, DeduplicatedHolding } from "../../types/institutional.types.js";

export type { DeduplicatedHolding } from "../../types/institutional.types.js";

export function deduplicateHoldings(holdings: Holding[]): DeduplicatedHolding[] {
  const cusipMap = new Map<string, DeduplicatedHolding>();

  holdings.forEach((holding, index) => {
    const cusip = holding.cusip.trim().toUpperCase();

    if (!cusipMap.has(cusip)) {
      cusipMap.set(cusip, { ...holding, cusip, duplicateCount: 1, originalIndices: [index] });
    } else {
      const existing = cusipMap.get(cusip)!;
      existing.value += holding.value;
      existing.shares += holding.shares;
      existing.duplicateCount++;
      existing.originalIndices.push(index);

      if (holding.votingAuthority && existing.votingAuthority) {
        existing.votingAuthority.sole =
          (existing.votingAuthority.sole || 0) + (holding.votingAuthority.sole || 0);
        existing.votingAuthority.shared =
          (existing.votingAuthority.shared || 0) + (holding.votingAuthority.shared || 0);
        existing.votingAuthority.none =
          (existing.votingAuthority.none || 0) + (holding.votingAuthority.none || 0);
      }
    }
  });

  return Array.from(cusipMap.values());
}

export function getUniqueTickers(holdings: Holding[]): string[] {
  const tickers = new Set<string>();
  holdings.forEach((h) => {
    if (h.ticker) tickers.add(h.ticker.trim().toUpperCase());
  });
  return Array.from(tickers);
}

export function isValidCusip(cusip: string): boolean {
  if (!cusip) return false;
  return /^[A-Z0-9]{9}$/.test(cusip.trim());
}
