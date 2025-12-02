import { ChatOpenAI } from "@langchain/openai";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
import { SCRAPING_LIMITS } from "../../../../config/hiring.config.js";

/* ------------------------------------------------------------
 * ZOD SCHEMA — K-1 Ordinary Income (Modeled)
 * ------------------------------------------------------------ */
export const k1IncomeSchema = z.object({
  sourceUrl: z.string().url(),

  personName: z.string().min(1, "personName is required"),
  organizationName: z.string().min(1, "organizationName is required"),
  roleTitle: z.string().min(1, "roleTitle is required"),

  contacts: z.object({
    emails: z.array(z.string()).default([]),
    phones: z.array(z.string()).default([]),
  }),

  partnerType: z.enum([
    "equity-partner",
    "senior-partner",
    "managing-partner",
    "general-partner",
    "income-partner",
    "non-equity-partner",
    "unknown",
  ]),

  modeledK1Income: z.enum(["50k-150k", "150k-300k", "300k-750k", "750k-1.5m", "1.5m-5m", "5m+"]),

  industry: z.enum([
    "law",
    "private-equity",
    "venture-capital",
    "consulting",
    "accounting",
    "other",
  ]),

  insights: z.string().default(""),
  confidenceScore: z.number().min(0).max(1),
});

export type K1IncomeSignal = z.infer<typeof k1IncomeSchema>;

/* ------------------------------------------------------------
 * DEDUPE HELPER
 * ------------------------------------------------------------ */
function dedupeK1Signals(signals: K1IncomeSignal[]): K1IncomeSignal[] {
  const seen = new Set<string>();
  const out: K1IncomeSignal[] = [];

  for (const s of signals) {
    const person = (s.personName || "").trim().toLowerCase();
    const org = (s.organizationName || "").trim().toLowerCase();
    const role = (s.roleTitle || "").trim().toLowerCase();

    const key = `${person}|${org}|${role}`;
    if (!person) continue;

    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }

  return out;
}

/* ------------------------------------------------------------
 * MAIN EXTRACTION FUNCTION
 * ------------------------------------------------------------ */
export async function extractK1IncomeSignals(cleanText: string, url: string) {
  try {
    cleanText = (cleanText || "").slice(0, SCRAPING_LIMITS.MARKDOWN_MAX_LENGTH);
    cleanText = cleanText.replace(/{/g, "[OPEN_BRACE]").replace(/}/g, "[CLOSE_BRACE]");

    const parser = StructuredOutputParser.fromZodSchema(z.array(k1IncomeSchema));
    const formatInstructions = parser.getFormatInstructions();

    const model = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0,
      maxTokens: 1500,
    });

    /* ----------------- SYSTEM PROMPT ----------------- */
    const systemPrompt = `
You are an expert analyst extracting MODELED K-1 income signals.

JSON RULES:
- NEVER output null (use "" or [] instead)
- ALWAYS produce valid JSON array
- ALWAYS fill contacts.emails and contacts.phones as arrays
- ALWAYS set sourceUrl equal to the provided Source URL

EXTRACTION RULES:
- Identify real people linked with a partner-level role
- Required fields: personName, organizationName, roleTitle
- partnerType: infer conservatively
- modeledK1Income: pick best range based on seniority
- insight: short quote/paraphrase
- confidenceScore: 0–1
`;

    /* ----------------- USER PROMPT ----------------- */
    const userPrompt = `
Source URL: ${url}

PAGE TEXT:
${cleanText}

Return ONLY a JSON array:
${formatInstructions}
`;

    const result = await model.invoke(`${systemPrompt}\n\n${userPrompt}`);
    let raw: any = result?.content ?? "";

    raw = Array.isArray(raw) ? JSON.stringify(raw) : String(raw);

    /* ----------------- JSON FIXUPS ----------------- */
    raw = raw
      .replace(/^```json/i, "")
      .replace(/```$/i, "")
      .replace(/:\s*null/gi, ': ""')
      .replace(/“|”/g, '"')
      .replace(/‘|’/g, "'")
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]")
      .trim();

    const parsed = await parser.parse(raw);

    const filtered = (parsed as K1IncomeSignal[]).filter((item) => {
      const person = item.personName?.trim();
      const org = item.organizationName?.trim();
      const role = item.roleTitle?.toLowerCase();

      return person && org && role && role.includes("partner");
    });

    /* ------------------------------------------------------------
     * DEDUPE
     * ------------------------------------------------------------ */
    const unique = dedupeK1Signals(filtered);

    return unique;
  } catch (err: any) {
    console.error("GPT K1Income parse error:", err?.message);
    return [];
  }
}
