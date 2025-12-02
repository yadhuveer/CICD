import { DeduplicatedHolding } from "../../utils/institutional/holdings-deduplication.util.js";

export function calculateFinancials(
  currentHoldings: DeduplicatedHolding[],
  previousHoldings: any[] | null,
) {
  const totalValue = currentHoldings.reduce((sum, h) => sum + h.value, 0);

  // 1. Index Previous Holdings for fast lookup
  const prevMap = new Map<string, any>();
  if (previousHoldings) {
    previousHoldings.forEach((h) => prevMap.set(h.cusip, h));
  }

  let newPos = 0,
    increased = 0,
    decreased = 0,
    exited = 0,
    unchanged = 0;

  // 2. Compare Current vs Previous
  const enriched = currentHoldings.map((h) => {
    const prev = prevMap.get(h.cusip);
    const percentOfPortfolio = totalValue > 0 ? (h.value / totalValue) * 100 : 0;

    let changeType = "NEW";
    let valueChange = h.value;
    let sharesChange = h.shares;

    if (prev) {
      valueChange = h.value - prev.value;
      sharesChange = h.shares - prev.shares;

      // Detect Status based on SHARES
      if (h.shares > prev.shares) {
        changeType = "INCREASED";
        increased++;
      } else if (h.shares < prev.shares) {
        changeType = "DECREASED";
        decreased++;
      } else {
        changeType = "UNCHANGED";
        unchanged++;
      }

      // Remove from map -> Anything left in map later is EXITED
      prevMap.delete(h.cusip);
    } else {
      newPos++;
    }

    return {
      ...h,
      percentOfPortfolio,
      changeType,
      valueChange,
      valueChangePct: prev && prev.value > 0 ? (valueChange / prev.value) * 100 : null,
      sharesChange,
      sharesChangePct: prev && prev.shares > 0 ? (sharesChange / prev.shares) * 100 : null,
    };
  });

  // 3. Process Exited Positions (Leftovers in map)
  prevMap.forEach((prev) => {
    exited++;
    enriched.push({
      ...prev,
      value: 0,
      shares: 0,
      percentOfPortfolio: 0,
      changeType: "EXITED",
      valueChange: -prev.value,
      valueChangePct: -100,
      sharesChange: -prev.shares,
      sharesChangePct: -100,
    });
  });

  // 4. Global Stats
  const prevTotalValue = previousHoldings ? previousHoldings.reduce((s, h) => s + h.value, 0) : 0;

  return {
    enrichedHoldings: enriched,
    stats: {
      newPositions: newPos,
      increasedPositions: increased,
      decreasedPositions: decreased,
      unchangedPositions: unchanged,
      exitedPositions: exited,
      totalValueChange: totalValue - prevTotalValue,
      totalValueChangePct:
        prevTotalValue > 0 ? ((totalValue - prevTotalValue) / prevTotalValue) * 100 : 0,
    },
  };
}
