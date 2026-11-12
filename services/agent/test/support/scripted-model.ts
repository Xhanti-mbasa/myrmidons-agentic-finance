/**
 * A scripted stand-in for the model server. The model is untrusted in PayGuard, so security tests
 * script it to behave badly on purpose and then check what the agent let through.
 *
 * Each turn is what the model "says" on one call: plain text, or one or more tool calls.
 */
import { MockLanguageModelV4 } from "ai/test";

export type ModelTurn =
  | { text: string }
  | { toolCalls: Array<{ tool: string; input: unknown }> }
  | { throws: Error };

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

let callCounter = 0;

export function scriptedModel(turns: ModelTurn[], options: { repeatLast?: boolean } = {}) {
  let i = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      const turn = turns[Math.min(i, turns.length - 1)];
      if (!options.repeatLast && i >= turns.length) {
        i++;
        return { content: [{ type: "text", text: "Done." }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] };
      }
      i++;
      if (!turn) throw new Error("scriptedModel needs at least one turn");
      if ("throws" in turn) throw turn.throws;
      if ("text" in turn) {
        return { content: [{ type: "text", text: turn.text }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] };
      }
      return {
        content: turn.toolCalls.map((c) => ({
          type: "tool-call" as const,
          toolCallId: `call_${++callCounter}`,
          toolName: c.tool,
          input: typeof c.input === "string" ? c.input : JSON.stringify(c.input),
        })),
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage,
        warnings: [],
      };
    },
  });
  return {
    model,
    /** Every request the agent sent to the model, as the model server would receive it. */
    get calls() {
      return model.doGenerateCalls;
    },
    /** All prompt text the model was shown across every call, flattened. */
    get everythingTheModelSaw(): string {
      return JSON.stringify(model.doGenerateCalls.map((c) => c.prompt));
    },
  };
}
