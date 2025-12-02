// import { z } from "zod";
// import { createAgent, providerStrategy } from "langchain";
// import { ChatAnthropic } from "@langchain/anthropic";

// // ----------------------------------------------------
// // 1. Define your strict structured output schema (Zod)
// // ----------------------------------------------------

// export const SearchQuerySchema = z.object({
//   jobTitle: z.string().nullable(),
//   fullName: z.string().nullable(),
//   city: z.string().nullable(),
//   state: z.string().nullable(),
//   company: z.string().nullable(),
//   location: z.string().nullable(),
//   pageNo: z.number().default(1),
// });

// export type SearchQueryType = z.infer<typeof SearchQuerySchema>;

// // ----------------------------------------------------
// // 2. SYSTEM PROMPT – Your full SOP logic
// // ----------------------------------------------------

// const SYSTEM_PROMPT = `
// You are a Search Query Generator Agent.

// Your task is to parse a user's natural language search request and convert it into a
// standardized JSON object with these exact fields:

// {
//   "jobTitle": string | null,
//   "fullName": string | null,
//   "city": string | null,
//   "state": string | null,
//   "company": string | null,
//   "location": string | null,
//   "pageNo": number
// }

// ======================== RULES ========================

// 1. Extract only what is explicitly stated.
// 2. Normalize job titles to clean singular form:
//    - "tax consultants" → "Tax Consultant"
//    - "tax advicers" → "Tax Advisor"
//    - "CFOs" → "Chief Financial Officer"
//    - "software engineers" → "Software Engineer"
//    - "lawyers" → "Lawyer"

// 3. fullName is only for real person names (e.g. "John Smith").

// 4. Company normalization:
//    - GS → Goldman Sachs
//    - MS → Morgan Stanley
//    - FB → Meta
//    - AMZN → Amazon
//    - Deloitte → Deloitte

// 5. City/State extraction rules:
//    - If city + state given → extract both.
//    - If city only (US) → infer most common state:
//      * Dallas → Texas
//      * New York → New York
//      * San Francisco → California
//      * Seattle → Washington
//    - If state only → city = null.

// 6. LOCATION FORMAT (ContactOut Standard):
//    Always format final "location" as:
//      "City, State, Country"
//    Examples:
//      "Dallas, Texas, United States"
//      "New York, New York, United States"
//      "California, United States"
//    If non-US and country unsure → location = null.

// 7. pageNo:
//    If user mentions a page number → parse it.
//    Otherwise default: pageNo = 1

// 8. ALWAYS return valid structured JSON and nothing else.

// ======================== EXAMPLES ========================

// Input: "Find tax consultants in Dallas"
// Output: {
//   "jobTitle": "Tax Consultant",
//   "fullName": null,
//   "city": "Dallas",
//   "state": "Texas",
//   "company": null,
//   "location": "Dallas, Texas, United States",
//   "pageNo": 1
// }

// Input: "Show me CFOs at Goldman Sachs page 2"
// Output: {
//   "jobTitle": "Chief Financial Officer",
//   "fullName": null,
//   "city": null,
//   "state": null,
//   "company": "Goldman Sachs",
//   "location": null,
//   "pageNo": 2
// }

// Input: "software engineers in California"
// Output: {
//   "jobTitle": "Software Engineer",
//   "fullName": null,
//   "city": null,
//   "state": "California",
//   "company": null,
//   "location": "California, United States",
//   "pageNo": 1
// }

// Input: "give me all the tax advicers working in in california"
// Output: {
//   "jobTitle": "Tax Advisor",
//   "fullName": null,
//   "city": null,
//   "state": "California",
//   "company": null,
//   "location": "California, United States",
//   "pageNo": 1
// }

// ========================================================
// `;

// // ----------------------------------------------------
// // 3. Create the agent using Claude Haiku
// // ----------------------------------------------------

// export const searchQueryAgent = createAgent({
//   model: new ChatAnthropic({
//     model: "claude-haiku-4-5-20251001", // Latest Claude Haiku 4.5
//     temperature: 0,
//     apiKey: process.env.ANTHROPIC_API_KEY, // Make sure to set this
//   }),

//   tools: [],

//   responseFormat: providerStrategy(SearchQuerySchema),

//   system: SYSTEM_PROMPT,
// });

// // ----------------------------------------------------
// // 4. Helper function to run the agent
// // ----------------------------------------------------

// export async function generateSearchQuery(query: string): Promise<SearchQueryType> {
//   try {
//     const result = await searchQueryAgent.invoke({
//       messages: [{ role: "user", content: query }],
//     });

//     // Validate the structured response
//     const parsed = SearchQuerySchema.parse(result.structuredResponse);
//     return parsed;
//   } catch (error) {
//     console.error("Search query generation failed:", error);
//     throw new Error(
//       `Failed to generate search query: ${error instanceof Error ? error.message : "Unknown error"}`,
//     );
//   }
// }

import { z } from "zod";
import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

// ----------------------------------------------------
// Schema Definition
// ----------------------------------------------------

export const SearchQuerySchema = z.object({
  jobTitle: z.array(z.string()).nullable(),
  fullName: z.string().nullable(),
  city: z.array(z.string()).nullable(),
  state: z.array(z.string()).nullable(),
  company: z.array(z.string()).nullable(),
  location: z.array(z.string()).nullable(),
  pageNo: z.number().default(1),
});

export type SearchQueryType = z.infer<typeof SearchQuerySchema>;

// ----------------------------------------------------
// System Prompt (use the one above)
// ----------------------------------------------------

const SYSTEM_PROMPT = `You are a Search Query Generator Agent.

Parse the user's search request into this JSON structure:
{
  "jobTitle": string[] | null,
  "fullName": string | null,
  "city": string[] | null,
  "state": string[] | null,
  "company": string[] | null,
  "location": string[] | null,
  "pageNo": number
}

RULES:
1. Extract only explicitly stated information
2. Normalize job titles to singular form (ALWAYS return as array):
   - "tax consultants" → ["Tax Consultant"]
   - "tax consultant and software engineer" → ["Tax Consultant", "Software Engineer"]
   - "CFOs" → ["Chief Financial Officer"]

3. Company shortcuts:
   - GS → ['Goldman Sachs']
   - MS →[' Morgan Stanley']
   - FB → Meta
   - AMZN → Amazon

4. City/State rules (ALWAYS return as arrays):
   - Multiple cities: ["San Diego", "New York"]
   - If only city mentioned → infer state:
     * Dallas → Texas
     * New York → New York
     * San Francisco → California
     * San Diego → California
     * Seattle → Washington
   - If only state mentioned → city = null

5. Location format (ALWAYS return as array): ["City, State, Country", ...]
   Examples:
   - Single: ["Dallas, Texas, United States"]
   - Multiple: ["San Diego, California, United States", "New York, New York, United States"]
   - State only: ["California, United States"]

6. pageNo defaults to 1 unless specified

CRITICAL: Respond ONLY with valid JSON. No markdown, no explanation`; // Paste the updated prompt from above

// ----------------------------------------------------
// Model Instance
// ----------------------------------------------------

const model = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  temperature: 0,
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ----------------------------------------------------
// Main Function
// ----------------------------------------------------

export async function generateSearchQuery(query: string): Promise<SearchQueryType> {
  try {
    const response = await model.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(query),
    ]);

    let content = response.content.toString().trim();
    content = content
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const parsed = JSON.parse(content);
    const validated = SearchQuerySchema.parse(parsed);

    return validated;
  } catch (error) {
    console.error("Search query generation failed:", error);
    throw new Error(
      `Failed to generate search query: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
