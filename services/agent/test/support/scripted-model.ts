/**
 * A scripted stand-in for the model server. The model is untrusted in Shucamoxa, so security tests
 * script it to behave badly on purpose and then check what the agent let through.
 *
 * Each turn is what the model "says" on one call: plain text, or one or more tool calls.
 */
import { MockLanguageModelV4 } from "ai/test";

export type ModelTurn =
  | { text: string }
  | { toolCalls: Array<{ tool: string; input: unknown }> }
  | { throws: Error }
  /** Never answers, and ignores the abort signal, like a model server that hangs. */
  | { hang: true }
  /** Answers with `then` after delayMs, ignoring the abort signal. */
  | { delayMs: number; then: ModelTurn };

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

let callCounter = 0;

export function scriptedModel(turns: ModelTurn[], options: { repeatLast?: boolean } = {}) {
  let i = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      let turn = turns[Math.min(i, turns.length - 1)];
      if (!options.repeatLast && i >= turns.length) {
        i++;
        return { content: [{ type: "text", text: "Done." }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] };
      }
      i++;
      if (!turn) throw new Error("scriptedModel needs at least one turn");
      while (turn && "delayMs" in turn) {
        const { delayMs } = turn;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        turn = turn.then;
      }
      if ("hang" in turn) return new Promise<never>(() => {});
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
    doStream: async (callOptions) => {
      let turn = turns[Math.min(i, turns.length - 1)];
      if (!options.repeatLast && i >= turns.length) {
        i++;
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] });
              controller.enqueue({ type: "text-start", id: "t0" });
              controller.enqueue({ type: "text-delta", id: "t0", delta: "Done." });
              controller.enqueue({ type: "text-end", id: "t0" });
              controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
              controller.close();
            },
          }),
        };
      }
      i++;
      if (!turn) throw new Error("scriptedModel needs at least one turn");
      while (turn && "delayMs" in turn) {
        const { delayMs } = turn;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delayMs);
          callOptions?.abortSignal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(callOptions.abortSignal?.reason ?? new Error("Aborted"));
            },
            { once: true },
          );
        });
        turn = turn.then;
      }
      if (callOptions?.abortSignal?.aborted) {
        throw callOptions.abortSignal.reason ?? new Error("Aborted");
      }
      if ("hang" in turn) return new Promise<never>(() => {});
      if ("throws" in turn) throw turn.throws;
      if ("text" in turn) {
        const text = turn.text;
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] });
              controller.enqueue({ type: "text-start", id: "t1" });
              controller.enqueue({ type: "text-delta", id: "t1", delta: text });
              controller.enqueue({ type: "text-end", id: "t1" });
              controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
              controller.close();
            },
          }),
        };
      }
      const toolCalls = turn.toolCalls;
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            for (const c of toolCalls) {
              controller.enqueue({
                type: "tool-call",
                toolCallId: `call_${++callCounter}`,
                toolName: c.tool,
                input: typeof c.input === "string" ? c.input : JSON.stringify(c.input),
              });
            }
            controller.enqueue({ type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage });
            controller.close();
          },
        }),
      };
    },
  });
  return {
    model,
    /** Every request the agent sent to the model, as the model server would receive it. */
    get calls() {
      return [...model.doGenerateCalls, ...model.doStreamCalls];
    },
    /** All prompt text the model was shown across every call, flattened. */
    get everythingTheModelSaw(): string {
      return JSON.stringify([...model.doGenerateCalls, ...model.doStreamCalls].map((c) => c.prompt));
    },
  };
}
