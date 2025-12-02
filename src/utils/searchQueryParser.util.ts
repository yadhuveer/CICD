import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

export type ParsedSearchQuery = {
  jobTitle?: string | null;
  fullName?: string | null;
  location?: string | null;
  company?: string | null;
};

/**
 * Parse a natural language search query into structured fields using GPT-4o-mini
 * @param searchText - The search query text (e.g., "search for tax attorney in Connecticut")
 * @returns Parsed fields
 */
export async function parseSearchQuery(searchText: string): Promise<ParsedSearchQuery> {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a search query parser. Extract structured information from user search queries.

Extract these fields (all optional):
- jobTitle: Job title or profession (e.g., "tax attorney", "CFO", "software engineer")
- fullName: Full name of a person (e.g., "John Smith", "Jane Doe")
- location: Geographic location (e.g., "Connecticut", "New York", "San Francisco")
- company: Company name (e.g., "Goldman Sachs", "Google", "Microsoft")

Rules:
1. All fields are optional - only extract what's clearly present in the query
2. Return null for fields that aren't mentioned
3. Normalize locations to proper names (e.g., "CT" → "Connecticut", "NYC" → "New York")
4. Keep job titles in singular form (e.g., "tax attorney" not "tax attorneys")
5. Extract full company names, not abbreviations when possible

Return ONLY a valid JSON object with these exact field names. No explanation.`,
        },
        {
          role: "user",
          content: searchText,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    const parsed = JSON.parse(content) as ParsedSearchQuery;

    return {
      jobTitle: parsed.jobTitle || null,
      fullName: parsed.fullName || null,
      location: parsed.location || null,
      company: parsed.company || null,
    };
  } catch (error: any) {
    console.error("Error parsing search query:", error.message);

    return {
      jobTitle: null,
      fullName: null,
      location: null,
      company: null,
    };
  }
}

export async function parseSearchQueries(searchTexts: string[]): Promise<ParsedSearchQuery[]> {
  const results = await Promise.all(searchTexts.map((text) => parseSearchQuery(text)));
  return results;
}
