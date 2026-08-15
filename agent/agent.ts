import { defineAgent } from "eve";
import { AGENT_MODEL } from "../src/lib/groq";

export default defineAgent({
  description: "Isolated eve orchestration spike for GatherBite.",
  model: AGENT_MODEL,
  limits: {
    maxInputTokensPerSession: 120_000,
    maxOutputTokensPerSession: 12_000,
    sessionTimeoutMs: 24 * 60 * 60 * 1_000,
  },
});
