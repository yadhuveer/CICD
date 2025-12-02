export type FeedEntry = {
  title: string;
  link: string;
  updated: string;
  category: string;
  accession: string;
};

export type ScrapingResult = {
  scraped: number;
  saved: number;
  errors: number;
  data: any[];
  metadata?: FeedEntry[]; // Optional: RSS feed entry metadata corresponding to each XML in data array
};
export type Form4Data = {
  accession: string;
  filingLink: string;
  rawXml: string;
  companyName: string;
  companyTicker: string;
  insiderName: string;
  filingDate: Date;
};

export type DEF14AData = {
  accession: string;
  filingLink: string;
  rawContent: string;
  companyName: string;
  companyTicker: string;
  filingDate: Date;
  meetingDate?: Date;
};

export type Form10KData = {
  accession: string;
  filingLink: string;
  rawContent: string;
  companyName: string;
  companyTicker: string;
  companyCik: string;
  filingDate: Date;
  fiscalYearEnd: string;
  _id?: any;
};

export type Form10QData = {
  accession: string;
  filingLink: string;
  rawContent: string;
  companyName: string;
  companyTicker: string;
  companyCik: string;
  filingDate: Date;
  fiscalYearEnd: string;
  fiscalPeriodEnd: string;
  _id?: any;
};

export type Form13FData = {
  accession: string;
  primaryXml: string;
  infoTableXml: string;
};
