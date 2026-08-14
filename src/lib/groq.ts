import { createGroq } from "@ai-sdk/groq";

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
});

// gpt-oss-120b on Groq: reliable tool calling, fast enough for a live demo.
export const AGENT_MODEL = groq("openai/gpt-oss-120b");
