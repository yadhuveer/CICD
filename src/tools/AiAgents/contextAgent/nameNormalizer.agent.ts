import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";

// ==========================================================
// ZOD SCHEMAS FOR STRUCTURED OUTPUT
// ==========================================================

/**
 * Schema for normalized person name
 */
const personNameSchema = z.object({
  originalName: z.string().describe("The original input name"),
  normalizedName: z.string().describe("The normalized name for ContactOut API"),
  firstName: z.string().nullable().describe("Extracted first name"),
  lastName: z.string().nullable().describe("Extracted last name"),
  middleName: z.string().nullable().optional().describe("Middle name or initial if present"),
  removedElements: z
    .array(z.string())
    .describe("Elements removed during normalization (Jr., II, Dr., etc.)"),
  reasoning: z.string().describe("Brief explanation of the normalization decision"),
});

/**
 * Schema for company name variations
 */
const companyVariationsSchema = z.object({
  originalName: z.string().describe("The original company name"),
  variations: z.array(z.string()).describe("Array of company name variations for ContactOut API"),
  primaryVariation: z.string().describe("The most likely correct variation to try first"),
  reasoning: z.string().describe("Brief explanation of variation generation logic"),
});

// Create parsers
const personNameParser = StructuredOutputParser.fromZodSchema(personNameSchema);
const companyVariationsParser = StructuredOutputParser.fromZodSchema(companyVariationsSchema);

// ==========================================================
// PERSON NAME NORMALIZATION AGENT
// ==========================================================

const personNamePrompt = ChatPromptTemplate.fromTemplate(`
You are a LinkedIn/Social Media Name Normalization Expert for ContactOut API.

ROLE:
Generate realistic name variations that people actually use on LinkedIn, Twitter, and professional platforms.

GOAL:
Create 1-2 realistic name variations that maximize ContactOut matching without hallucinating fake variations.

NORMALIZATION RULES:

1. **PRIMARY RULE: ALWAYS Keep First + Last Name**
   - NEVER return just a last name
   - NEVER return just initials
   - ALWAYS include both first and last name in normalizedName
   - Example: "Jonathan P Binstock" � "Jonathan Binstock" (NOT "Binstock")
   - Example: "J.P. Gallagher" � "J.P. Gallagher" (NOT "Gallagher")

2. **Remove Suffixes**
   - Remove: Jr., Jr, II, III, IV, Sr., Sr, 2nd, 3rd
   - Example: "Robert Engstrom, Jr." � "Robert Engstrom"
   - Example: "Mac Wesson, Jr." � "Mac Wesson"

3. **Remove Titles**
   - Remove: Dr., Mr., Mrs., Ms., Prof., Rev., Hon.
   - Example: "Dr. John Smith" � "John Smith"

4. **Handle Middle Names/Initials**
   - If name has First + Middle/Initial + Last � Remove middle for primary variation
   - Example: "Jonathan P Binstock" � "Jonathan Binstock"
   - Example: "Michael O. Ugwueke" � "Michael Ugwueke"
   - BUT: Keep full name if no clear middle initial (e.g., "Min Jung Kim" stays as is)

5. **Clean Punctuation**
   - Remove trailing commas and periods
   - Clean up extra spaces
   - Keep hyphens in hyphenated names (Mary-Jane)

6. **NO HALLUCINATIONS**
   - Do NOT create nickname variations (Robert � Bob)
   - Do NOT abbreviate first names
   - Do NOT return partial names
   - Do NOT guess at alternative spellings

EXAMPLES:

Input: "Min Jung Kim"
Output: {{
  "originalName": "Min Jung Kim",
  "normalizedName": "Min Jung Kim",
  "firstName": "Min Jung",
  "lastName": "Kim",
  "middleName": null,
  "removedElements": [],
  "reasoning": "Full name with no initials or suffixes - preserved as is"
}}

Input: "Jonathan P Binstock"
Output: {{
  "originalName": "Jonathan P Binstock",
  "normalizedName": "Jonathan Binstock",
  "firstName": "Jonathan",
  "lastName": "Binstock",
  "middleName": "P",
  "removedElements": ["P"],
  "reasoning": "Removed middle initial 'P' for better ContactOut matching - per rule 3"
}}

Input: "J.P. Gallagher"
Output: {{
  "originalName": "J.P. Gallagher",
  "normalizedName": "J.P. Gallagher",
  "firstName": "J.P.",
  "lastName": "Gallagher",
  "middleName": null,
  "removedElements": [],
  "reasoning": "Kept initials with last name - this is how they likely present professionally"
}}

Input: "Robert Engstrom, Jr."
Output: {{
  "originalName": "Robert Engstrom, Jr.",
  "normalizedName": "Robert Engstrom",
  "firstName": "Robert",
  "lastName": "Engstrom",
  "middleName": null,
  "removedElements": ["Jr."],
  "reasoning": "Removed suffix 'Jr.' from full name"
}}

Input: "Mac Wesson, Jr."
Output: {{
  "originalName": "Mac Wesson, Jr.",
  "normalizedName": "Mac Wesson",
  "firstName": "Mac",
  "lastName": "Wesson",
  "middleName": null,
  "removedElements": ["Jr."],
  "reasoning": "Removed suffix 'Jr.' from full name"
}}

Input: "Dr. Sarah Johnson"
Output: {{
  "originalName": "Dr. Sarah Johnson",
  "normalizedName": "Sarah Johnson",
  "firstName": "Sarah",
  "lastName": "Johnson",
  "middleName": null,
  "removedElements": ["Dr."],
  "reasoning": "Removed title 'Dr.' - professional titles not used in ContactOut searches"
}}

---

### INPUT NAME
{personName}

---

### OUTPUT FORMAT
{format_instructions}

CRITICAL RULES:
- normalizedName MUST contain both first and last name (NEVER just last name)
- Only remove clear suffixes, titles, and middle initials
- Do NOT hallucinate nicknames or variations
- Output valid JSON only
`);

// ==========================================================
// COMPANY NAME VARIATIONS AGENT
// ==========================================================

const companyVariationsPrompt = ChatPromptTemplate.fromTemplate(`
You are a Company Name Variation Generator for the ContactOut API.

ROLE:
Generate multiple variations of company names to maximize matching success in ContactOut API searches.

GOAL:
Create an array of company name variations that account for different formatting, punctuation, and naming conventions.

VARIATION GENERATION RULES:

1. **Punctuation Variations**
   - Original with punctuation
   - Without punctuation
   - With spaces instead of punctuation
   - Example: "P.P.O.W" � ["P.P.O.W", "PPOW", "P P O W"]

2. **Legal Entity Suffixes**
   - Add common suffixes: Inc., LLC, Corp., Corporation, Ltd.
   - Remove existing suffixes
   - Example: "Tech Solutions" � ["Tech Solutions", "Tech Solutions Inc.", "Tech Solutions LLC"]

3. **Descriptor Variations**
   - Include common business descriptors if applicable
   - Remove generic words if they might be optional
   - Example: "PPOW" � ["PPOW Gallery", "PPOW", "The PPOW Gallery"]

4. **Acronym Expansion**
   - If name appears to be acronym, provide spaced version
   - Provide concatenated version
   - Example: "I.B.M." � ["IBM", "I.B.M.", "I B M"]

5. **Full vs Short Forms**
   - Museum � Include "Museum of Art" variations
   - University � Include full university name patterns
   - Example: "Chazen Museum" � ["Chazen Museum of Art", "Chazen Museum", "University of Wisconsin Chazen Museum"]

6. **Ordering Strategy**
   - Place most likely correct variation FIRST
   - Order by likelihood of matching
   - Keep variations unique (no duplicates)

EXAMPLES:

Input: "P.P.O.W"
Output: {{
  "originalName": "P.P.O.W",
  "variations": [
    "PPOW Gallery",
    "P.P.O.W",
    "PPOW",
    "P P O W",
    "PPOW Gallery Inc."
  ],
  "primaryVariation": "PPOW Gallery",
  "reasoning": "Removed punctuation, added gallery descriptor, provided spacing variations. Primary is likely the full business name."
}}

Input: "Chazen Museum of Art, University of Wisconsin"
Output: {{
  "originalName": "Chazen Museum of Art, University of Wisconsin",
  "variations": [
    "Chazen Museum of Art",
    "Chazen Museum",
    "University of Wisconsin Chazen Museum of Art",
    "UW Chazen Museum",
    "Chazen Art Museum"
  ],
  "primaryVariation": "Chazen Museum of Art",
  "reasoning": "Separated university affiliation, created standalone museum names, added common abbreviations and descriptor variations."
}}

Input: "Tech Solutions, Inc."
Output: {{
  "originalName": "Tech Solutions, Inc.",
  "variations": [
    "Tech Solutions",
    "Tech Solutions Inc.",
    "Tech Solutions LLC",
    "Tech Solutions Corporation",
    "TechSolutions"
  ],
  "primaryVariation": "Tech Solutions",
  "reasoning": "Removed comma, provided alternative legal suffixes, created concatenated version."
}}

---

### INPUT COMPANY NAME
{companyName}

---

### OUTPUT FORMAT
{format_instructions}

CRITICAL:
- Generate 3-7 variations minimum
- Order by likelihood of match
- No duplicate variations
- Include reasoning for variation strategy
- Output valid JSON only
`);

// ==========================================================
// LLM CONFIGURATION
// ==========================================================

const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0, // Deterministic for name normalization
});

// ==========================================================
// PERSON NAME NORMALIZATION FUNCTION
// ==========================================================

/**
 * Normalizes a person name by removing suffixes, titles, and handling initials
 * @param personName - The person name to normalize
 * @returns Structured normalized name data
 */
export async function normalizePersonName(
  personName: string,
): Promise<z.infer<typeof personNameSchema>> {
  try {
    console.log(`=$ Normalizing person name: "${personName}"`);

    const prompt = await personNamePrompt.format({
      personName,
      format_instructions: personNameParser.getFormatInstructions(),
    });

    const response = await llm.invoke(prompt);
    const content =
      typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content.map((c) => (typeof c === "string" ? c : (c.text ?? ""))).join("\n")
          : "";

    const result = await personNameParser.parse(content);

    console.log(`    Normalized: "${result.normalizedName}"`);
    if (result.removedElements.length > 0) {
      console.log(`   =� Removed: ${result.removedElements.join(", ")}`);
    }

    return result;
  } catch (error: any) {
    console.error(`L Error normalizing person name:`, error.message);
    throw new Error(`Failed to normalize person name: ${error.message}`);
  }
}

// ==========================================================
// COMPANY NAME VARIATIONS FUNCTION
// ==========================================================

/**
 * Generates company name variations for ContactOut API
 * @param companyName - The company name to generate variations for
 * @returns Structured company variations data
 */
export async function generateCompanyVariations(
  companyName: string,
): Promise<z.infer<typeof companyVariationsSchema>> {
  try {
    console.log(`<� Generating variations for company: "${companyName}"`);

    const prompt = await companyVariationsPrompt.format({
      companyName,
      format_instructions: companyVariationsParser.getFormatInstructions(),
    });

    const response = await llm.invoke(prompt);
    const content =
      typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content.map((c) => (typeof c === "string" ? c : (c.text ?? ""))).join("\n")
          : "";

    const result = await companyVariationsParser.parse(content);

    // Ensure original company name is always in the variations array
    if (!result.variations.includes(companyName)) {
      result.variations.unshift(companyName);
    }

    console.log(`    Generated ${result.variations.length} variations`);
    console.log(`   <� Primary: "${result.primaryVariation}"`);

    return result;
  } catch (error: any) {
    console.error(`L Error generating company variations:`, error.message);
    throw new Error(`Failed to generate company variations: ${error.message}`);
  }
}

// ==========================================================
// BATCH PROCESSING FUNCTIONS
// ==========================================================

/**
 * Normalizes multiple person names in batch
 * @param personNames - Array of person names to normalize
 * @returns Array of normalized name results
 */
export async function normalizePersonNamesBatch(
  personNames: string[],
): Promise<z.infer<typeof personNameSchema>[]> {
  console.log(`=� Batch normalizing ${personNames.length} person names...`);

  const results = await Promise.all(personNames.map((name) => normalizePersonName(name)));

  console.log(` Batch normalization complete`);
  return results;
}

/**
 * Generates company variations for multiple companies in batch
 * @param companyNames - Array of company names
 * @returns Array of company variation results
 */
export async function generateCompanyVariationsBatch(
  companyNames: string[],
): Promise<z.infer<typeof companyVariationsSchema>[]> {
  console.log(`=� Batch generating variations for ${companyNames.length} companies...`);

  const results = await Promise.all(companyNames.map((name) => generateCompanyVariations(name)));

  console.log(` Batch generation complete`);
  return results;
}

// ==========================================================
// CONVENIENCE FUNCTIONS FOR CONTACTOUT API INTEGRATION
// ==========================================================

/**
 * Quick function to get just the normalized name string
 * @param personName - Person name to normalize
 * @returns Just the normalized name string
 */
export async function getNormalizedNameString(personName: string): Promise<string> {
  const result = await normalizePersonName(personName);
  return result.normalizedName;
}

/**
 * Quick function to get just the company variations array
 * @param companyName - Company name
 * @returns Array of company name variations
 */
export async function getCompanyVariationsArray(companyName: string): Promise<string[]> {
  const result = await generateCompanyVariations(companyName);
  return result.variations;
}

// ==========================================================
// TYPE EXPORTS
// ==========================================================

export type PersonNameResult = z.infer<typeof personNameSchema>;
export type CompanyVariationsResult = z.infer<typeof companyVariationsSchema>;
