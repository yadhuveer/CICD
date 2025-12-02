import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import dotenv from "dotenv";

// YOUR SPECIFIC IMPORT
import { IContact } from "../types/contacts.js";

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GROK_API_KEY = process.env.XAI_API_KEY || "";

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({
  model: "gemini-1.5-flash-latest",
});

const grokClient = new OpenAI({
  apiKey: GROK_API_KEY,
  baseURL: "https://api.x.ai/v1",
});

// Helper to ensure AI response matches IContact structure
interface AIEnrichmentResult {
  allAssets: string[];
  allLiabilities: string[];
  assetLocations: string[];
  otherProperties: string[];
  luxuryAssets: string[];
  currentAdvisors: string[];
  custodiansPlatforms: string[];
  legalEntities: string[];
  childrenDependents: { name: string; age?: number; notes?: string }[];
}

interface ServiceResult {
  data: Partial<IContact>;
  signalNote: string;
}

export const EnrichmentService = {
  generateResearchPrompt(contact: IContact): string {
    return `
        I need deep background research on this individual for a diligence report.
        Target: ${contact.fullName}
        Role: ${contact.occupationTitle} at ${contact.companyName}
        Location: ${contact.primaryAddress}
        LinkedIn: ${contact.linkedinUrl}

        SEARCH THE WEB. Look for public filings, news articles, and bios.
        
        Return a valid JSON object ONLY (no markdown). 
        If data is unknown, return an empty array [].
        
        Required JSON Structure:
        {
            "allAssets": ["List known assets, stocks, significant holdings"],
            "allLiabilities": ["Public debts, liens, lawsuits"],
            "assetLocations": ["Cities/Countries of assets"],
            "otherProperties": ["Real estate beyond primary residence"],
            "luxuryAssets": ["Vehicles, planes, art, horses"],
            "currentAdvisors": ["Lawyers, wealth managers, agents"],
            "custodiansPlatforms": ["Banks, investment platforms"],
            "legalEntities": ["LLCs, Foundations, Trusts"],
            "childrenDependents": [
                { "name": "Name of child", "notes": "Any public details found" }
            ]
        }
        `;
  },

  async enrichUser(contact: IContact): Promise<ServiceResult> {
    let enrichedData: Partial<AIEnrichmentResult> = {};
    let signalNotes = "";

    // --- STAGE 1: GEMINI ---
    try {
      console.log(`[Gemini] Researching: ${contact.fullName}...`);
      const prompt = this.generateResearchPrompt(contact);

      const result = await geminiModel.generateContent(prompt);
      const response = await result.response;
      let text = response.text();

      // Clean JSON formatting
      text = text
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();
      enrichedData = JSON.parse(text);
    } catch (error) {
      console.error("[Gemini] Error:", error);
    }

    // --- STAGE 2: GROK ---
    try {
      console.log(`[Grok] Checking signals...`);
      const grokResponse = await grokClient.chat.completions.create({
        model: "grok-3",
        messages: [
          { role: "system", content: "You are a risk analyst." },
          {
            role: "user",
            content: `Review: ${contact.fullName} (${contact.companyName}). Found entities: ${JSON.stringify(enrichedData.legalEntities)}. Any controversies or crypto associations? 1 sentence.`,
          },
        ],
      });
      signalNotes = grokResponse.choices[0].message.content || "";
    } catch (error) {
      console.warn("[Grok] Skipped:", error);
    }

    // Map the AI result strictly to IContact fields
    const finalData: Partial<IContact> = {
      allAssets: enrichedData.allAssets || [],
      allLiabilities: enrichedData.allLiabilities || [],
      assetLocations: enrichedData.assetLocations || [],
      otherProperties: enrichedData.otherProperties || [],
      luxuryAssets: enrichedData.luxuryAssets || [],
      currentAdvisors: enrichedData.currentAdvisors || [],
      custodiansPlatforms: enrichedData.custodiansPlatforms || [],
      legalEntities: enrichedData.legalEntities || [],
      childrenDependents: enrichedData.childrenDependents || [],
    };

    return {
      data: finalData,
      signalNote: signalNotes,
    };
  },
};
