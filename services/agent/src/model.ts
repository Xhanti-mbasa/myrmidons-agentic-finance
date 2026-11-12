import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AgentConfig } from "./config";

/** The one place that picks the model: the teammate's laptop over Tailscale, or the named hosted fallback. */
export function modelFromConfig(config: AgentConfig) {
  const provider = createOpenAICompatible({
    name: "payguard-model",
    baseURL: config.modelBaseUrl,
    apiKey: config.modelApiKey,
    supportsStructuredOutputs: true,
  });
  return provider(config.modelName);
}
