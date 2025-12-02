import { ChatOpenAI } from "@langchain/openai";

export async function testLLMConnection() {
  try {
    const model = new ChatOpenAI({
      model: "gpt-4o-mini", // use cheaper faster model for test
      temperature: 0.3,
      apiKey: process.env.OPENAI_API_KEY,
    });

    const res = await model.invoke(
      "Hello! Please reply with LLM connection is working ✅ and also tell whats going on who are you and where do you work.",
    );

    return res.content;
  } catch (err: any) {
    console.error("LLM Test Error:", err);
    throw new Error("LLM test failed: " + err.message);
  }
}
