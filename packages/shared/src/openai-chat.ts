import { z } from "zod";

/**
 * The OpenAI-compatible chat surface of the agent (M05): GET /v1/models and POST /v1/chat/completions,
 * so Open WebUI talks to the guarded agent instead of the raw model. Only the last user turn is used.
 */

/** The one model the agent offers. */
export const OPENAI_MODEL_ID = "payguard";

/** Longest owner turn the agent accepts, in characters. */
export const MAX_CHAT_TURN_CHARS = 2_000;

/** Most messages one request may carry. Only the last user turn is used; the rest are ignored. */
export const MAX_CHAT_MESSAGES = 200;

const TextPart = z.object({ type: z.literal("text"), text: z.string() });

/** Plain text only: a string, or an array of text parts. An image, file or audio part is refused. */
export const OpenAIMessageContent = z.union([z.string(), z.array(TextPart)]);

export const OpenAIChatMessage = z.object({
  role: z.enum(["system", "developer", "user", "assistant"]),
  content: OpenAIMessageContent,
});
export type OpenAIChatMessage = z.infer<typeof OpenAIChatMessage>;

/** Any value is refused: the agent's tools are its own, and a client cannot add or choose one. */
const Refused = z.never().optional();

/**
 * POST /v1/chat/completions body. Unknown OpenAI options (temperature, top_p, ...) are stripped, not
 * refused; tools, functions and tool choice are refused.
 */
export const OpenAIChatRequest = z.object({
  model: z.string().min(1).max(200),
  messages: z.array(OpenAIChatMessage).min(1).max(MAX_CHAT_MESSAGES),
  stream: z.boolean().optional(),
  tools: Refused,
  tool_choice: Refused,
  functions: Refused,
  function_call: Refused,
  parallel_tool_calls: Refused,
});
export type OpenAIChatRequest = z.infer<typeof OpenAIChatRequest>;

/** The text of the last message with role "user", or null if there is none. System and assistant turns are never read. */
export function lastUserTurn(messages: OpenAIChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== "user") continue;
    return typeof message.content === "string" ? message.content : message.content.map((p) => p.text).join("\n");
  }
  return null;
}

export const OpenAIModelList = z.strictObject({
  object: z.literal("list"),
  data: z.array(z.strictObject({ id: z.string(), object: z.literal("model"), owned_by: z.string() })),
});
export type OpenAIModelList = z.infer<typeof OpenAIModelList>;

const Usage = z.strictObject({ prompt_tokens: z.number().int(), completion_tokens: z.number().int(), total_tokens: z.number().int() });

/** stream: false answer. */
export const OpenAIChatCompletion = z.strictObject({
  id: z.string().startsWith("chatcmpl-"),
  object: z.literal("chat.completion"),
  created: z.number().int(),
  model: z.string(),
  choices: z
    .array(
      z.strictObject({
        index: z.literal(0),
        message: z.strictObject({ role: z.literal("assistant"), content: z.string() }),
        finish_reason: z.literal("stop"),
      }),
    )
    .length(1),
  usage: Usage,
});
export type OpenAIChatCompletion = z.infer<typeof OpenAIChatCompletion>;

/** One SSE `data:` line of a stream: true answer. */
export const OpenAIChatCompletionChunk = z.strictObject({
  id: z.string().startsWith("chatcmpl-"),
  object: z.literal("chat.completion.chunk"),
  created: z.number().int(),
  model: z.string(),
  choices: z
    .array(
      z.strictObject({
        index: z.literal(0),
        delta: z.strictObject({ role: z.literal("assistant").optional(), content: z.string().optional() }),
        finish_reason: z.literal("stop").nullable(),
      }),
    )
    .length(1),
});
export type OpenAIChatCompletionChunk = z.infer<typeof OpenAIChatCompletionChunk>;

export const OpenAIErrorCode = z.enum([
  "invalid_json",
  "invalid_request",
  "tools_not_supported",
  "unsupported_content",
  "no_user_turn",
  "turn_too_long",
  "internal_error",
]);
export type OpenAIErrorCode = z.infer<typeof OpenAIErrorCode>;

/** Every /v1 refusal, in OpenAI's error shape: a stable code and a short fixed message, never a stack or model text. */
export const OpenAIError = z.strictObject({
  error: z.strictObject({
    message: z.string().min(1).max(200),
    type: z.enum(["invalid_request_error", "server_error"]),
    param: z.string().nullable(),
    code: OpenAIErrorCode,
  }),
});
export type OpenAIError = z.infer<typeof OpenAIError>;
