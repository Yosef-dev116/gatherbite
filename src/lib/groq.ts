import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

// Provider switch: GATHERBITE_MODEL_PROVIDER=openrouter opts into OpenRouter's
// OpenAI-compatible API instead of Groq. Defaults to the existing Groq path
// unchanged. Same PLANNER_MODEL/VERIFIER_MODEL/AGENT_MODEL exports either way,
// so Planner/Verifier separation and every consumer are untouched.
const provider = process.env.GATHERBITE_MODEL_PROVIDER ?? "groq";

function resolveModel(groqModelId: string, openrouterModelId: string): LanguageModel {
  if (provider === "openrouter") {
    const openrouter = createOpenAICompatible({
      name: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
    });
    return openrouter(openrouterModelId);
  }
  const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
  return groq(groqModelId);
}

const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "openrouter/free";

// gpt-oss-120b on Groq: reliable tool calling, fast enough for a live demo.
export const PLANNER_MODEL = resolveModel("openai/gpt-oss-120b", OPENROUTER_MODEL);

// Server-only model selection. A faster verifier may be evaluated later, but
// production defaults to the same proven model until reliability is equal.
export const VERIFIER_MODEL = resolveModel(
  process.env.GATHERBITE_VERIFIER_MODEL ?? "openai/gpt-oss-120b",
  OPENROUTER_MODEL,
);

// Preserve the existing Little Caesars agent import while making the final
// GatherBite responsibilities explicit.
export const AGENT_MODEL = PLANNER_MODEL;
