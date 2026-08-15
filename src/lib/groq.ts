import { createGroq } from "@ai-sdk/groq";

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
});

// gpt-oss-120b on Groq: reliable tool calling, fast enough for a live demo.
export const PLANNER_MODEL = groq("openai/gpt-oss-120b");

// Server-only model selection. A faster verifier may be evaluated later, but
// production defaults to the same proven model until reliability is equal.
export const VERIFIER_MODEL = groq(
  process.env.GATHERBITE_VERIFIER_MODEL ?? "openai/gpt-oss-120b",
);

// Preserve the existing Little Caesars agent import while making the final
// GatherBite responsibilities explicit.
export const AGENT_MODEL = PLANNER_MODEL;
