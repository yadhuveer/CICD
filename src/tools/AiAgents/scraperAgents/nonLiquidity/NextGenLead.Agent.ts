import { ChatOpenAI } from "@langchain/openai";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
import { SCRAPING_LIMITS } from "../../../../config/hiring.config.js";

export const nextGenLeadershipSchema = z.object({
  sourceUrl: z.string().url(),
  entityType: z.enum(["person", "organization", "unknown"]).default("unknown"),
  organizationName: z.string(),
  personName: z.string(),
  roleNew: z.string(),
  roleOld: z.string().optional(),
  eventType: z
    .enum([
      "leadership-change",
      "appointment",
      "succession",
      "promotion",
      "retirement",
      "board-change",
      "restructuring",
      "general-news",
      "unknown",
    ])
    .default("unknown"),
  insights: z.string().nullable().optional(),
  evidence: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  emails: z.array(z.string()).nullable().optional(),
  confidenceScore: z.number().min(0).max(1).nullable().optional(),
});

export type NextGenLeadershipItem = z.infer<typeof nextGenLeadershipSchema>;

export async function extractNextGenSignals(cleanText: string, url: string) {
  try {
    cleanText = (cleanText || "").slice(0, SCRAPING_LIMITS.MARKDOWN_MAX_LENGTH);

    cleanText = cleanText.replace(/{/g, "[OPEN_BRACE]").replace(/}/g, "[CLOSE_BRACE]");

    const parser = StructuredOutputParser.fromZodSchema(z.array(nextGenLeadershipSchema));
    const formatInstructions = parser.getFormatInstructions();

    const model = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0,
      maxTokens: 1200,
    });

    const systemPrompt = `
You are an analyst extracting NEXT-GEN FAMILY OFFICE leadership events.
Return ONLY a JSON array matching the provided schema. No narration, no commentary.
Be conservative: return items only when a PERSON-level leadership appointment/promotion/retirement/board change is explicitly stated or reasonably inferred from bios/team lists. If the page contains only trends or surveys, return [].
Evidence: 1-2 short sentences quoting/paraphrasing the supporting text.
ConfidenceScore: 0.0 - 1.0.
`;

    const userPrompt = `
Source URL: ${url}

ADDITIONAL PAGE TEXT (first ${SCRAPING_LIMITS.MARKDOWN_MAX_LENGTH} chars):
${cleanText}

Return JSON ONLY and exactly follow the schema below:
${formatInstructions}

Notes:
- personName and organizationName MUST be provided (not null).
- roleNew MUST be provided if this is an appointment/promotion (if unknown, write "unknown").
- Keep insights short (one short sentence) and may be nullable.
- Include any emails found (array) if available.
`;

    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

    const result = await model.invoke(fullPrompt);

    let raw: any = (result as any).content ?? "";

    if (Array.isArray(raw)) {
      raw = JSON.stringify(raw);
    } else if (typeof raw !== "string") {
      raw = String(raw);
    }

    // strip fences
    raw = raw
      .replace(/^```json\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = await parser.parse(raw);
    return parsed as NextGenLeadershipItem[];
  } catch (err: any) {
    console.error("❌ GPT NextGen parse error:", err?.message ?? err);
    return [];
  }
}
