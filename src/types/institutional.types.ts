/**
 * Type definitions for 13F institutional filing pipeline
 */

// ============================================================================
// Holdings Types
// ============================================================================

export type Holding = {
  cusip: string;
  issuerName: string;
  value: number;
  shares: number;
  titleOfClass?: string;
  shareType?: string;
  investmentDiscretion?: string;
  votingAuthority?: {
    sole?: number;
    shared?: number;
    none?: number;
  };
  ticker?: string;
  sector?: string;
};

export type DeduplicatedHolding = Holding & {
  duplicateCount: number;
  originalIndices: number[];
};

export type EnrichedHolding = {
  cusip: string;
  issuerName: string;
  ticker: string;
  sector: string;
  value: number;
  shares: number;
  percentOfPortfolio: number;
  titleOfClass?: string;
  shareType?: string;
  investmentDiscretion?: string;
  votingAuthority?: {
    sole?: number;
    shared?: number;
    none?: number;
  };
  changeType?: "NEW" | "INCREASED" | "DECREASED" | "UNCHANGED" | "EXITED";
  valueChange?: number;
  valueChangePct?: number;
  sharesChange?: number;
  sharesChangePct?: number;
};

// ============================================================================
// Filer & Filing Types
// ============================================================================

export type CompanyFiler = {
  cik: string;
  name: string;
};

export type Filing = {
  cik: string;
  companyName: string;
  accessionNumber: string;
  filingDate: string;
  periodOfReport: string;
  formType: string;
  filingUrl?: string;
  fileNumber?: string;
  filmNumber?: string;
};

export type FilerMetadata = {
  managerName: string;
  managerCik: string;
  managerAddress?: string;
  managerCity?: string;
  managerState?: string;
  managerZipCode?: string;
  reportContactName?: string;
  reportContactTitle?: string;
  reportContactPhone?: string;
  reportContactEmail?: string;
  formType: string;
  filingDate: string;
  periodOfReport: string;
  accessionNo: string;
  amendmentNumber?: string;
  tableEntryTotal?: string;
  tableValueTotal?: string;
};

export type ScrapedFilingData = {
  filing: Filing;
  metadata: FilerMetadata;
  holdings: DeduplicatedHolding[];
  duplicatesFound: number;
  totalHoldings: number;
};

export type Discovered13FFiler = {
  cik: string;
  name: string;
  latestFilingDate?: string;
  totalFilings?: number;
};

// ============================================================================
// Portfolio & Analysis Types
// ============================================================================

export type SectorBreakdown = {
  sector: string;
  totalValue: number;
  percentOfPortfolio: number;
  holdingsCount: number;
};

export type PortfolioChanges = {
  newPositions: number;
  increasedPositions: number;
  decreasedPositions: number;
  unchangedPositions: number;
  exitedPositions: number;
  totalValueChange: number;
  totalValueChangePct: number;
};

export type QuarterlyReport = {
  quarter: string;
  periodOfReport: string;
  filingDate: string;
  accessionNumber: string;
  summary: {
    totalHoldingsCount: number;
    totalMarketValue: number;
  };
  sectorBreakdown?: Array<{
    sector: string;
    value: number;
    percentage: number;
  }>;
  portfolioChanges?: {
    newPositions: number;
    increasedPositions: number;
    decreasedPositions: number;
    exitedPositions: number;
    unchangedPositions: number;
    valueChange: number;
    valueChangePct: number;
  };
  holdings: EnrichedHolding[];
};

// ============================================================================
// Pipeline Processing Types
// ============================================================================

export type ProcessingResult = {
  totalFilingsProcessed: number;
  totalFilingsFailed: number;
  companiesProcessed: number;
  totalHoldingsProcessed: number;
  discoveredCompaniesProcessed?: number;
  errors: Array<{ cik: string; accession: string; error: string }>;
};

// ============================================================================
// Sector Enrichment Types
// ============================================================================

export type SectorData = {
  ticker: string;
  sector?: string;
  industry?: string;
  marketCap?: number;
};

// ============================================================================
// OpenFIGI API Types
// ============================================================================

export type FigiResponse = {
  data?: Array<{
    ticker?: string;
    name?: string;
    exchCode?: string;
    marketSector?: string;
    securityType?: string;
  }>;
  error?: string;
};
