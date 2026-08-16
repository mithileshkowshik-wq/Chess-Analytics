import { GameFactsResult } from "../game-facts";
import { buildSystemPrompt } from "./prompt";
import { ToolContext } from "./stats";
import { TOOLS_BY_NAME, TOOL_DEFS } from "./tools";
import {
  ChatMessage,
  ChatUsage,
  chatCompletion,
  getModel,
} from "./openrouter";

export const MAX_TOOL_ITERATIONS = 6;

/** Guards against a tool result blowing up the context. Tools are already capped. */
const MAX_TOOL_RESULT_BYTES = 20_000;

export interface AgentTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AgentResult {
  answer: string;
  toolCalls: { name: string; args: unknown; ok: boolean }[];
  iterations: number;
  truncated: boolean;
  usage?: ChatUsage;
}

function runOneTool(
  name: string,
  rawArgs: string | undefined,
  ctx: ToolContext
): { result: unknown; args: unknown; ok: boolean } {
  const spec = TOOLS_BY_NAME.get(name);
  if (!spec) {
    return {
      ok: false,
      args: undefined,
      result: {
        error: "unknown_tool",
        message: `No tool named "${name}".`,
        available: [...TOOLS_BY_NAME.keys()],
      },
    };
  }

  let args: Record<string, unknown>;
  try {
    const text = (rawArgs ?? "").trim();
    args = text === "" ? {} : JSON.parse(text);
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("arguments must be a JSON object");
    }
  } catch (err) {
    return {
      ok: false,
      args: rawArgs,
      result: {
        error: "bad_arguments",
        message: err instanceof Error ? err.message : "could not parse arguments",
        hint: "Send arguments as a JSON object, e.g. {\"time_class\":\"rapid\",\"game_number\":800}.",
      },
    };
  }

  try {
    return { ok: true, args, result: spec.run(args, ctx) };
  } catch (err) {
    console.error(`[agent] tool ${name} threw`, err);
    return {
      ok: false,
      args,
      result: {
        error: "tool_failed",
        message: err instanceof Error ? err.message : "tool failed",
      },
    };
  }
}

/**
 * Drives the model until it answers without asking for more data.
 *
 * Tool problems are fed back as ordinary tool results rather than thrown, so a
 * malformed call costs one turn instead of the whole request.
 */
export async function runAgent(opts: {
  facts: GameFactsResult;
  history: AgentTurn[];
  question: string;
  now?: number;
  deadline?: number;
  fetchImpl?: typeof fetch;
}): Promise<AgentResult> {
  const now = opts.now ?? Date.now();
  const ctx: ToolContext = { facts: opts.facts, now };

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(opts.facts, now) },
    ...opts.history.map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: opts.question },
  ];

  const toolCalls: AgentResult["toolCalls"] = [];
  let usage: ChatUsage | undefined;
  /** Completed round trips, so a break mid-round still reports honestly. */
  let rounds = 0;

  while (rounds < MAX_TOOL_ITERATIONS) {
    rounds++;
    const res = await chatCompletion(
      { messages, tools: TOOL_DEFS, tool_choice: "auto" },
      { fetchImpl: opts.fetchImpl }
    );
    usage = res.usage ?? usage;

    const message = res.choices![0].message;
    // The assistant turn carrying tool_calls must precede its tool results.
    messages.push(message);

    if (!message.tool_calls?.length) {
      return {
        answer: (message.content ?? "").trim(),
        toolCalls,
        iterations: rounds,
        truncated: false,
        usage,
      };
    }

    for (const call of message.tool_calls) {
      const { result, args, ok } = runOneTool(
        call.function?.name ?? "",
        call.function?.arguments,
        ctx
      );
      toolCalls.push({ name: call.function?.name ?? "unknown", args, ok });

      let content = JSON.stringify(result);
      if (content.length > MAX_TOOL_RESULT_BYTES) {
        content = JSON.stringify({
          error: "result_too_large",
          hint: "Narrow the filters — add a time_class, a date window, or a lower limit.",
        });
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function?.name,
        content,
      });
    }

    if (opts.deadline && Date.now() > opts.deadline) break;
  }

  // Out of iterations or time: make it answer with what it already has.
  messages.push({
    role: "user",
    content:
      "Answer now using the data you already have. Do not request any more tools.",
  });

  const final = await chatCompletion(
    { messages, tool_choice: "none" },
    { fetchImpl: opts.fetchImpl }
  );
  usage = final.usage ?? usage;

  return {
    answer:
      (final.choices?.[0]?.message?.content ?? "").trim() ||
      "I could not finish working that out. Try asking something more specific.",
    toolCalls,
    iterations: rounds,
    truncated: true,
    usage,
  };
}

export { getModel };
