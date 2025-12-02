import { ChatOpenAI } from "@langchain/openai";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
import { SCRAPING_LIMITS } from "../../../../config/hiring.config.js";

/* ------------------------------------------------------------
 * ZOD SCHEMA — Art/Collectibles Market Activity
 * ------------------------------------------------------------ */
export const artCollectiblesMarketSchema = z.object({
  sourceUrl: z.string().url(),

  artworkName: z.string().min(1),
  artistName: z.string().min(1),
  auctionHouse: z.string().min(1),

  saleType: z.enum([
    "auction",
    "private-sale",
    "gallery-announcement",
    "museum-acquisition",
    "corporate-acquisition",
    "unknown",
  ]),

  salePrice: z.string().min(1),
  buyer: z.string().min(1),
  seller: z.string().min(1),

  estimate: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  dateOfSale: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  insights: z.string().nullable().optional(),
  evidence: z.string().nullable().optional(),
  confidenceScore: z.number().min(0).max(1).nullable().optional(),
});
export type ArtCollectibleItem = z.infer<typeof artCollectiblesMarketSchema>;

/* ------------------------------------------------------------
 * MAIN EXTRACTION FUNCTION
 * ------------------------------------------------------------ */
export async function extractArtCollectibleSignals(cleanText: string, url: string) {
  try {
    cleanText = (cleanText || "").slice(0, SCRAPING_LIMITS.MARKDOWN_MAX_LENGTH);

    cleanText = cleanText.replace(/{/g, "[OPEN_BRACE]").replace(/}/g, "[CLOSE_BRACE]");

    const parser = StructuredOutputParser.fromZodSchema(z.array(artCollectiblesMarketSchema));
    const formatInstructions = parser.getFormatInstructions();

    const model = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0,
      maxTokens: 1600,
    });

    /* ------------------------------------------------------------
     * SYSTEM PROMPT
     * ------------------------------------------------------------ */
    const systemPrompt = `
You are an expert analyst extracting ART & COLLECTIBLES MARKET ACTIVITY signals.

VALID EVENTS (extract these):
1. Artwork sale at a major auction house.
2. Private sale of an artwork or collectible.
3. Gallery-announced major sales.
4. Museum acquisitions.
5. **Corporate acquisitions involving the art market**:
   - Auction houses being bought/sold.
   - Galleries being acquired.
   - Art fairs being purchased.
   - Large M&A deals inside the art ecosystem.

If the text contains NONE of these, return [].

------------------------------------------------------------
SALEPRICE / BUYER / SELLER — STRICT REQUIREMENTS:
------------------------------------------------------------
These MUST ALWAYS contain meaningful non-empty values:
- salePrice → explicit OR inferred from the article.
- buyer → entity, person, collector, bidder, firm, or “anonymous investor”.
- seller → prior owner, consignor, shareholders, private collection, or inferred.

NEVER use "unknown". NEVER leave blank. NEVER skip.

------------------------------------------------------------
CORPORATE ACQUISITION LOGIC (Option B):
------------------------------------------------------------
When an auction house or gallery is bought:
- artworkName = the company name (e.g., “Sotheby’s”)
- artistName = the buyer’s name (person or company)
- auctionHouse = the company involved (e.g., “Sotheby’s”)
- saleType = "corporate-acquisition"
- salePrice = transaction value (e.g., "$3.7 billion")
- buyer = acquirer (e.g., “Patrick Drahi”)
- seller = selling party (“public shareholders”, “previous owners”, etc.)

------------------------------------------------------------
Evidence:
Use short quotes from the page.

Confidence:
0.0 to 1.0.

Return ONLY a JSON array.
`;

    /* ------------------------------------------------------------
     * USER PROMPT
     * ------------------------------------------------------------ */
    const userPrompt = `
Source URL: ${url}

PAGE CONTENT:
${cleanText}

Use this JSON schema exactly:
${formatInstructions}

Rules:
- buyer, seller, and salePrice MUST ALWAYS be present and meaningful.
- No "unknown".
- Infer intelligently when needed.
- Corporate transactions ARE VALID signals.
`;

    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
    const result = await model.invoke(fullPrompt);

    let raw: any = (result as any).content ?? "";
    if (Array.isArray(raw)) raw = JSON.stringify(raw);
    else if (typeof raw !== "string") raw = String(raw);

    raw = raw
      .replace(/^```json/i, "")
      .replace(/```$/, "")
      .trim();

    return await parser.parse(raw);
  } catch (err: any) {
    console.error("GPT ArtCollectible parse error:", err?.message ?? err);
    return [];
  }
}
