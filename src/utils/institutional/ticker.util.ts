export function cleanTickerSymbol(ticker: string): string | null {
  if (!ticker) return null;

  let cleaned = ticker.trim().toUpperCase();

  cleaned = cleaned.replace(/^TICKER:?\s*/i, "");
  cleaned = cleaned.replace(/\s*(INC|CORP|LTD|LLC|LP|CLASS\s+[A-Z])$/i, "");

  const tickerRegex = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

  if (!tickerRegex.test(cleaned)) {
    return null;
  }

  return cleaned;
}

export function isValidTicker(ticker: string): boolean {
  if (!ticker) return false;
  const cleaned = ticker.trim().toUpperCase();
  return /^[A-Z]{1,5}(\.[A-Z])?$/.test(cleaned);
}
