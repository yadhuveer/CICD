import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
import * as cheerio from "cheerio";

export const dafContributionSchema = z.object({
  sourceUrl: z.string(),
  entityType: z.enum(["person", "organization", "unknown"]).default("unknown"),
  organizationName: z.string().nullable().optional(),
  personName: z.string().nullable().optional(),
  contacts: z
    .object({
      emails: z.array(z.string()).nullable().optional(),
      phones: z.array(z.string()).nullable().optional(),
      websites: z.array(z.string()).nullable().optional(),
    })
    .nullable()
    .optional(),
  contributionType: z.enum([
    "recurring",
    "burst",
    "multi-year",
    "one-time-inferred",
    "unspecified",
  ]),
  indicators: z.array(z.string()).min(1),
  frequency: z.string().optional(),
  amount: z.string().optional(),
  contextSummary: z.string(),
  insights: z.string(),
  tags: z.array(z.string()).nullable().optional(),
  confidenceScore: z.number().min(0).max(1).nullable().optional(),
});

export type DafContributionItem = z.infer<typeof dafContributionSchema>;

// HTML -> lightweight Markdown converter
export function htmlToLightMarkdown(html: string): string {
  const $ = cheerio.load(html);

  // Remove scripts/styles and hidden elements
  $("script, style, noscript, iframe, svg, meta, link").remove();
  $("[hidden]").remove();
  $("[aria-hidden='true']").remove();

  const blocks: string[] = [];

  // Headings
  for (let i = 1; i <= 6; i++) {
    $(`h${i}`).each((_, el) => {
      const txt = $(el).text().trim();
      if (txt) blocks.push(`${"#".repeat(i)} ${txt}`);
    });
  }

  // Paragraphs
  $("p").each((_, el) => {
    const txt = $(el).text().trim();
    if (txt) blocks.push(txt);
  });

  // Lists
  $("ul, ol").each((_, el) => {
    const $el = $(el);
    $el.find("li").each((_, li) => {
      const liText = $(li).text().trim();
      if (liText) blocks.push(`- ${liText}`);
    });
  });

  // Tables -> simple pipe format
  $("table").each((_, table) => {
    const rows: string[] = [];
    $(table)
      .find("tr")
      .each((rowIndex, tr) => {
        const cells: string[] = [];
        $(tr)
          .find("th, td")
          .each((_, cell) => {
            const cellText = $(cell).text().replace(/\s+/g, " ").trim();
            cells.push(cellText);
          });
        if (cells.length > 0) rows.push(`| ${cells.join(" | ")} |`);
      });
    if (rows.length) {
      blocks.push(rows.join("\n"));
    }
  });

  // Links -> text (href)
  $("a").each((_, a) => {
    const href = $(a).attr("href") || "";
    const text = $(a).text().trim() || href;
    $(a).replaceWith(`${text}${href ? ` (${href})` : ""}`);
  });

  if (blocks.length === 0) {
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();
    if (bodyText) return bodyText;
    return "";
  }

  return blocks.join("\n\n").replace(/\s+\n/g, "\n").trim();
}

// Intelligent chunking
export function chunkContentIntelligently(
  markdown: string,
  maxChunkSize: number = 20000,
): string[] {
  if (!markdown) return [];
  if (markdown.length <= maxChunkSize) return [markdown];

  const chunks: string[] = [];
  const sections = markdown.split(/\n#{1,3}\s+/);

  let currentChunk = "";
  for (const section of sections) {
    if ((currentChunk + section).length > maxChunkSize) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = section;
    } else {
      currentChunk += (currentChunk ? "\n## " : "") + section;
    }
  }
  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

// GPT parsing using the schema
async function parseDAFContributionsWithGPT(
  markdown: string,
  sourceUrl: string,
): Promise<DafContributionItem[]> {
  try {
    const model = new ChatOpenAI({ modelName: "gpt-4o-mini", temperature: 0 });
    const parser = StructuredOutputParser.fromZodSchema(z.array(dafContributionSchema));

    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        `You are an expert at extracting donor-advised fund (DAF) contribution signals from documents.

Your task is to identify and extract information about entities (people or organizations) that show evidence of DAF-related giving patterns.

INCLUDE entities ONLY when there is explicit or strongly implied evidence of:
- Recurring DAF contributions or grants
- Sustained giving patterns (monthly, quarterly, annual)
- Grant bursts or concentrated giving periods
- Multi-year commitments or pledges
- Participation in donor recognition programs or giving societies
- Foundation or DAF sponsorship mentions

For each entity found:
1. Determine if it's a person or organization
2. Extract ALL available contact information (emails, phones, websites)
3. Identify the contribution type and patterns
4. Note specific indicators found in the text
5. Provide context about the relationship with DAFs
6. Add relevant tags (e.g., "major-donor", "recurring-giver", "foundation")
7. Assign a confidence score (0-1) based on the strength of evidence

Return comprehensive results in JSON format.`,
      ],
      [
        "user",
        `Source URL: {url}

Document Content:
{content}

Extract all DAF contribution signals. {format_instructions}`,
      ],
    ]);

    const chain = prompt.pipe(model);

    const chunks = chunkContentIntelligently(markdown);
    const allResults: DafContributionItem[] = [];

    for (const chunk of chunks) {
      const result = await chain.invoke({
        url: sourceUrl,
        content: chunk,
        format_instructions: parser.getFormatInstructions(),
      });

      let contentStr = result.content as string;
      contentStr = contentStr
        .replace(/^```json\s*/i, "")
        .replace(/\s*```\s*$/i, "")
        .trim();

      const parsed = await parser.parse(contentStr);
      allResults.push(...parsed);
    }

    // GPT-level dedupe by person/organization name
    const seen = new Set<string>();
    const unique = allResults.filter((item) => {
      const key = (item.organizationName || item.personName || "").toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return unique;
  } catch (err: any) {
    console.error("GPT parse error:", err?.message || err);
    return [];
  }
}

// Exported wrapper used by service: accepts raw HTML OR markdown
export async function parseDAFContributionsDirect(contentOrHtml: string, sourceUrl: string) {
  // detect if content is HTML (has angle brackets) — if so convert to markdown
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(contentOrHtml);
  const markdown = looksLikeHtml ? htmlToLightMarkdown(contentOrHtml) : contentOrHtml;

  if (!markdown || markdown.length < 50) return [];

  const results = await parseDAFContributionsWithGPT(markdown, sourceUrl);
  return results.map((r) => (r.sourceUrl ? r : { ...r, sourceUrl }));
}

export default {
  htmlToLightMarkdown,
  chunkContentIntelligently,
  parseDAFContributionsDirect,
};
