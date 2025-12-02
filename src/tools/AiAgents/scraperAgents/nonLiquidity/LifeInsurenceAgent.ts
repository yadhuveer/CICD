// agents/LifeInsuranceLiquidity.agent.ts

import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { StructuredOutputParser } from "@langchain/core/output_parsers";

export const LifeInsuranceZ = z.object({
  signalSource: z.string().nullable().optional(),

  personName: z.string().nullable().optional(),

  ownerDesignation: z.string().nullable().optional(),
  ownerCompany: z.string().nullable().optional(),

  actionType: z.enum(["Surrender", "Policy Loan"]).nullable().optional(),

  policyType: z.string().nullable().optional(),
  insuranceCompany: z.string().nullable().optional(),
  policyNumber: z.string().nullable().optional(),

  surrenderAmount: z.union([z.string(), z.number()]).nullable().optional(),
  loanAmount: z.union([z.string(), z.number()]).nullable().optional(),

  eventDate: z.string().nullable().optional(),

  liquidityReason: z.string().nullable().optional(),
  estatePlanningShift: z.boolean().nullable().optional(),
  taxStrategyIndicator: z.boolean().nullable().optional(),

  insights: z.string().nullable().optional(),
  aiModelUsed: z.string().nullable().optional(),
  confidenceScore: z.number().nullable().optional(),
});

export type ILifeInsuranceExtraction = z.infer<typeof LifeInsuranceZ>;

const parser = StructuredOutputParser.fromZodSchema(LifeInsuranceZ);

const TEMPLATE = `
You are a strict extractor for LIFE INSURANCE LIQUIDITY EVENTS.
GOAL: Extract ONLY factual, explicitly-stated policyholder events where a named person
has surrendered a policy or taken a policy loan.

MANDATES (follow strictly):
- personName MUST be the actual policyholder (the individual who surrendered a policy or took a policy loan).
  - Examples that DO NOT qualify: article author, reviewer, quoted industry experts, advisory firms.
  - Only extract personName when the page explicitly states that person X surrendered / took a loan / cashed out their policy.
- actionType must be exactly "Surrender" or "Policy Loan" and only when the page explicitly describes that action for the named person.
- Do NOT guess: if a field is not clearly present, return null.
- Numeric amounts: extract only explicit numbers. Remove $ and commas; if number is not explicit, return null.
- Dates: extract only explicit dates (e.g., "October 3, 2024", "2024-10-03"). If not explicit, return null.
- insuranceCompany must be explicitly stated as the insurer.
- Output STRICT JSON ONLY, matching the schema; do not write prose.

SCHEMA:
{schema}

FEW-SHOT (must follow exactly):

# Example — real event:
Page text:
"On 2023-10-01, Jane Doe surrendered her whole life policy with Acme Life and received $4,600 to cover medical bills."
OUTPUT (JSON only):
{
  "signalSource": "Example",
  "personName": "Jane Doe",
  "ownerDesignation": null,
  "ownerCompany": null,
  "actionType": "Surrender",
  "policyType": "Whole Life",
  "insuranceCompany": "Acme Life",
  "policyNumber": null,
  "surrenderAmount": 4600,
  "loanAmount": null,
  "eventDate": "2023-10-01",
  "liquidityReason": "medical bills",
  "estatePlanningShift": null,
  "taxStrategyIndicator": null,
  "insights": "Policy surrendered to cover medical bills.",
  "aiModelUsed": "gpt-4o-mini",
  "confidenceScore": 0.90
}

# Example — NOT a real event:
Page text:
"This article explains policy loans and cash value. No individual is named who took a loan."
OUTPUT:
{
  "signalSource": "Example",
  "personName": null,
  "ownerDesignation": null,
  "ownerCompany": null,
  "actionType": null,
  "policyType": null,
  "insuranceCompany": null,
  "policyNumber": null,
  "surrenderAmount": null,
  "loanAmount": null,
  "eventDate": null,
  "liquidityReason": null,
  "estatePlanningShift": null,
  "taxStrategyIndicator": null,
  "insights": "General article; no specific policyholder event found.",
  "aiModelUsed": "gpt-4o-mini",
  "confidenceScore": 0.50
}

PAGE TEXT:
{page_text}

Return STRICT JSON only.
`;

const llm = new ChatOpenAI({
  modelName: process.env.OPENAI_MODEL || "gpt-4o-mini",
  temperature: 0,
});

export async function parseLifeInsuranceFromText(input: {
  url?: string;
  text: string;
  title?: string | null;
}): Promise<ILifeInsuranceExtraction | null> {
  const content = TEMPLATE.replace(
    "{page_text}",
    `${input.title ? input.title + "\n\n" : ""}${input.text}`,
  ).replace("{schema}", await parser.getFormatInstructions());

  try {
    const resp = await llm.invoke([
      { role: "system", content: "Extract only explicit policyholder liquidity events." },
      { role: "user", content },
    ]);

    const raw = typeof resp.content === "string" ? resp.content : JSON.stringify(resp.content);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;

    let parsed: any;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }

    // Validate shape
    const validated = LifeInsuranceZ.parse(parsed);
    const post: any = { ...validated };

    // Numeric normalization (strict)
    const toNumber = (v: any) => {
      if (v === null || v === undefined) return null;
      const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
      return Number.isFinite(n) ? n : null;
    };
    post.surrenderAmount = toNumber(post.surrenderAmount);
    post.loanAmount = toNumber(post.loanAmount);

    // Ensure insights and aiModelUsed
    post.insights =
      post.insights ||
      (post.actionType ? `Detected ${post.actionType} event.` : "No specific event found.");
    post.aiModelUsed = process.env.OPENAI_MODEL || "gpt-4o-mini";
    post.confidenceScore = typeof post.confidenceScore === "number" ? post.confidenceScore : 0.85;

    return post;
  } catch (err) {
    console.error("LifeInsurance Agent Error");
    return null;
  }
}
