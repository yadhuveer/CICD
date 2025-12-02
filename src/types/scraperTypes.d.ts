/**
 * Interface for date range parameters
 */
export type DateRangeParams = {
  fromDate: string; // Format: YYYY-MM-DD
  toDate: string; // Format: YYYY-MM-DD
  ticker?: string; // Optional company ticker
  cik?: string; // Optional company CIK
  maxResults?: number; // Maximum number of results to fetch
};

/**
 * Interface for scraping result
 */
export type HistoricalScrapingResult = {
  success: boolean;
  dateRange: {
    from: string;
    to: string;
  };
  total: number;
  saved: number;
  alreadyExists: number;
  failed: number;
  details: any[];
  message?: string;
  error?: string;
};
