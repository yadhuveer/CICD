import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";

// ==========================================================
// USER DATA (Replace with DB later)
// ==========================================================
//export const USER_DATA = {
// firstName: "Lakhan",
//  email: "luck.dev@gmail.com",
//  annualIncome: "$120,000",
//  futureIncomeEvent: "None",
//  netWorth: "$20,000",
//};

// ==========================================================
// SENDER PROFILE
// ==========================================================
export const SENDER_PROFILE = {
  name: "John Mitchell",
  position: "Senior Portfolio Strategist",
  company: "LongWall Capital",
  email: "john@longwall.com",
  phone: "+1 (212) 555-9034",
};

// ==========================================================
// CLEANERS (remove markdown formatting)
// ==========================================================
function cleanSubject(subject: string) {
  return subject
    .replace(/\*/g, "")
    .replace(/Subject Line:/i, "")
    .replace(/Subject:/i, "")
    .trim();
}

function cleanBody(body: string) {
  return body.replace(/^---+/gm, "").replace(/\*/g, "").trim();
}

function normalizeContent(content: any): string {
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === "string" ? c : (c.text ?? ""))).join("\n");
  }
  return content || "";
}

//
// ==========================================================
// ZOD SCHEMA — 7 EMAIL TYPES
// ==========================================================
const campaignStrategySchema = z.object({
  campaignName: z.string(),

  emails: z.array(
    z.object({
      emailType: z.enum([
        "introduction",
        "follow_up",
        "value_delivery",
        "case_study",
        "social_proof",
        "urgency",
        "break_up",
      ]),

      day: z.number(),
      delay_hours: z.number(),

      purpose: z.string(),
      subjectDirection: z.string(),
      angle: z.string(),
      keyPoints: z.array(z.string()),
      tone: z.string(),
      cta: z.string(),
      notes: z.string(),
    }),
  ),
});

// Parser
const strategistParser = StructuredOutputParser.fromZodSchema(campaignStrategySchema);

// ==========================================================
// STRICT + PERSONALIZED UHNW STRATEGIST PROMPT
// ==========================================================
const strategistPrompt = ChatPromptTemplate.fromTemplate(`
You are a Cold Email Campaign Strategist.

ROLE:
Cold Email Campaign Strategist

GOAL:
Create highly effective, deeply personalized 7-email campaigns for tax professionals, CPAs, RIAs, UHNW prospects, and founders.

BACKSTORY:
You are an expert cold email strategist with 10+ years of experience reaching out to high-net-worth professionals, tax attorneys, and CPAs.
You understand:
- the psychology of financially sophisticated buyers  
- their responsibilities, time constraints, and motivations  
- what makes advisors & UHNW clients respond  
- how to position tax & wealth strategies as value multipliers  
- how to avoid sounding salesy while building trust  

CAPABILITIES:
- Contact analysis (role, company size, industry)
- Industry research for tax, wealth, finance, legal sectors
- B2B financial communication expertise
- Insight generation (job title, geography, firm size)
- Optimal campaign timing (day 1, 3, 5, 7, 10, 14, 18)

---

### USER PROFILE
First Name: {firstName}
Email: {email}
Net Worth: {netWorth}
Annual Income: {annualIncome}
Future Liquidity Event: {futureIncomeEvent}

Analyze:
- wealth tier & tax exposure  
- role-based pain points  
- geographic market dynamics  
- company size & industry  
- expected sophistication level  
- urgency triggers (deadlines, market cycles, tax law changes)  

---

### 7 EMAIL TYPES (MANDATORY ORDER)
1. introduction  
2. follow_up  
3. value_delivery  
4. case_study  
5. social_proof  
6. urgency  
7. break_up  

### TIMING RULES
Email 1 → day 1 → delay 0h  
Email 2 → day 3 → delay 48h  
Email 3 → day 5 → delay 48h  
Email 4 → day 7 → delay 48h  
Email 5 → day 10 → delay 72h  
Email 6 → day 14 → delay 72h  
Email 7 → day 18 → delay 96h  

---

### CAMPAIGN OUTPUT REQUIREMENTS
For each email, generate:
- emailType  
- day  
- delay_hours  
- purpose  
- subjectDirection  
- angle  
- keyPoints  
- tone  
- cta  
- notes  

STRICT RULES:
- JSON only  
- No markdown  
- No **  
- No "---" separators  
- No commentary  

{format_instructions}
`);

// ==========================================================
// STRATEGIST FUNCTION
// ==========================================================
async function generateStrategy(campaignName: string, user: any) {
  const model = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0.2,
  });

  const prompt = await strategistPrompt.format({
    campaignName,
    firstName: user?.firstName || user?.fullName,
    email: user.email,
    netWorth: user?.totalNetWorth ? `$${user.totalNetWorth.toLocaleString()}` : "Not Provided",
    annualIncome: user?.annualEarnedIncome
      ? `$${user.annualEarnedIncome.toLocaleString()}`
      : "Not Provided",
    futureIncomeEvent: user?.futureIncomeEvent || "None",
    format_instructions: strategistParser.getFormatInstructions(),
  });

  const response = await model.invoke(prompt);
  return strategistParser.parse(normalizeContent(response.content));
}

// ==========================================================
// EMAIL WRITER PROMPT
// ==========================================================
const emailWriterPrompt = ChatPromptTemplate.fromTemplate(`
You are an Email Copywriter.

ROLE:
Email Copywriter specializing in B2B outreach for tax professionals, wealth advisors, CPAs, and high-net-worth service providers.

GOAL:
Write compelling, personalized, trust-building emails that feel handcrafted and get replies.

BACKSTORY:
You are a master copywriter with deep experience writing for:
- tax advisory firms  
- wealth management firms  
- RIAs / CPAs / family offices  
- B2B financial services  

You know how to:
- speak to professionals who manage wealthy clients  
- demonstrate value through insight, not hype  
- write clean, credible messaging  
- use personalization intelligently (role, company, industry)  
- structure emails that lead naturally to a soft CTA  

CAPABILITIES (converted from CrewAI tools):
- Personalization engine (role, company, location insights)
- Subject line optimization  
- CTA generation for professional audiences  
- AI-powered insight insertion  

---

### USER PROFILE
First Name: {firstName}
Net Worth: {netWorth}
Annual Income: {annualIncome}
Future Liquidity Event: {futureIncomeEvent}
+The email must include at least one reference to the user’s financial context.
+ Use the provided data (Net Worth, Annual Income, or Future Liquidity Event)
+ to personalize the message meaningfully (e.g., “Given your upcoming IPO”,
+ “Considering your current net worth”, etc.).

### SENDER PROFILE
Sender Name: ${SENDER_PROFILE.name}
Sender Position: ${SENDER_PROFILE.position}
Sender Company: ${SENDER_PROFILE.company}
Sender Email: ${SENDER_PROFILE.email}
Sender Phone: ${SENDER_PROFILE.phone}

Replace ALL placeholders (e.g., [Your Name], [Your Contact Information]) automatically.

---

### EMAIL STRATEGY INPUT
Email Type: {emailType}
Purpose: {purpose}
Subject Direction: {subjectDirection}
Angle: {angle}
Key Points: {keyPoints}
Tone: {tone}
CTA: {cta}
Notes: {notes}

---

### REQUIREMENTS
- Include a subject line  
- Use the correct tone for tax professionals  
- Use personalization elements from the strategy  
- 120–180 words  
- No JSON  
- No placeholders  
- No markdown  
- No **  
- No ---  
- Sign with sender info  
- Soft, professional CTA  
`);
// ==========================================================
// EMAIL WRITER FUNCTION
// ==========================================================
export async function writeEmail(step: any, campaignName: string, user?: any) {
  const model = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0.4,
  });

  const userData = {
    firstName: user?.firstName || user?.fullName,
    email: user.email,
    netWorth: user?.netWorth
      ? `$${user.netWorth.toLocaleString()}`
      : user?.totalNetWorth
        ? `$${user.totalNetWorth.toLocaleString()}`
        : "Not Provided",
    annualIncome: user?.annualIncome
      ? `$${user.annualIncome.toLocaleString()}`
      : user?.annualEarnedIncome
        ? `$${user.annualEarnedIncome.toLocaleString()}`
        : "Not Provided",
    futureIncomeEvent: user?.futureIncomeEvent || "None",
  };

  const formatted = await emailWriterPrompt.format({
    firstName: userData.firstName,
    emailType: step.emailType,
    campaignName,
    purpose: step.purpose,
    subjectDirection: step.subjectDirection,
    angle: step.angle,
    keyPoints: step.keyPoints.join(", "),
    tone: step.tone,
    cta: step.cta,
    notes: step.notes,
    netWorth: userData.netWorth,
    annualIncome: userData.annualIncome,
    futureIncomeEvent: userData.futureIncomeEvent,
  });

  const raw = normalizeContent((await model.invoke(formatted)).content);

  const [subjectLine, ...bodyParts] = raw.split("\n");
  const cleaned = {
    type: step.emailType,
    subject: cleanSubject(subjectLine),
    body: cleanBody(bodyParts.join("\n")),
    day: step.day,
    delay_hours: step.delay_hours,
  };

  return cleaned;
}

// ==========================================================
// MAIN PIPELINE — Now it supports user input
// ==========================================================
export async function generateCampaign(campaignName: string, user: any) {
  // Optionally accept user data for personalization
  const strategy = await generateStrategy(campaignName, user);

  const structuredEmails: Record<string, any> = {};

  for (const step of strategy.emails) {
    const personalizedStep = {
      ...step,
      firstName: user?.firstName || "Client",
      email: user?.email,
      netWorth: user?.netWorth || "N/A",
      annualIncome: user?.annualIncome || "N/A",
      futureIncomeEvent: user?.futureIncomeEvent || "None",
    };

    const email = await writeEmail(personalizedStep, campaignName, user);
    structuredEmails[email.type] = email;
  }

  return {
    success: true,
    campaignName,
    user: user ? { firstName: user.firstName, email: user.email } : null,
    emails: structuredEmails,
  };
}
