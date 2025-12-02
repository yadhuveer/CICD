import { z } from "zod";

export const jobPostingSchema = z.object({
  companyName: z.string().describe("Company name"),
  companyDomain: z.string().optional().describe("Company website domain"),
  companyLocation: z.string().optional().describe("Company headquarters (City, State)"),
  companyDescription: z.string().optional().describe("Brief company description"),

  jobTitle: z.string().describe("Job title (e.g., CFO, Controller, Financial Analyst)"),
  jobLevel: z
    .enum(["CFO", "Controller", "Director", "Manager", "Analyst", "Other"])
    .describe("Job level/seniority"),
  department: z.string().optional().describe("Department (e.g., Finance, Accounting)"),

  description: z.string().optional().describe("Full job description"),
  responsibilities: z.array(z.string()).optional().describe("Key responsibilities"),
  requirements: z.array(z.string()).optional().describe("Required qualifications"),

  salaryRange: z.string().optional().nullable().describe("Salary range (e.g., $120k-$180k)"),

  postingDate: z.string().optional().nullable().describe("Job posting date (YYYY-MM-DD)"),
  jobUrl: z.string().url().describe("Link to job posting"),

  familyOfficeIndicators: z
    .array(z.string())
    .optional()
    .describe(
      "Signals this is a Family Office: 'family office', 'private wealth', 'family investment office', 'single family office', etc.",
    ),

  hiringUrgency: z
    .enum(["low", "medium", "high", "urgent"])
    .optional()
    .describe("Hiring urgency based on posting language"),
  isNewRole: z.boolean().optional().describe("Is this a new/expansion role (vs replacement)"),
});

export type JobPosting = z.infer<typeof jobPostingSchema>;

export type HiringScrapingResult = {
  success: boolean;
  successful: number;
  alreadyExists: number;
  failed: number;
  signalIds: string[];
  error?: string;
};

export type HiringScraperType = "discovery" | "monitoring" | "custom" | "ats-search";

export type HiringScraperOptions = {
  type: HiringScraperType;
  limit?: number;
  domains?: string[];
  query?: string;
  atsPlatform?: "greenhouse" | "lever" | "workday" | "bamboo";
};

export type ParallelTaskRequest = {
  input: string;
  processor?: "base" | "ultra";
};

export type ParallelTaskResponse = {
  run_id: string;
  status?: string;
  output?: any;
  [key: string]: any;
};

export type FamilyOfficeCompany = {
  company: string;
  domain?: string;
  source?: string;
};

export type FirecrawlSearchResult = {
  url: string;
  title?: string;
};
