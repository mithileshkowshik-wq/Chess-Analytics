/* eslint-disable @typescript-eslint/no-explicit-any -- check harness inspects loosely-typed JSON payloads */
/**
 * Offline checks for the agent loop, using a scripted fake transport.
 * No network, no API key.
 */
import assert from "node:assert";
import { runAgent, MAX_TOOL_ITERATIONS } from "../lib/agent/loop";
import { chatCompletion, LlmError } from "../lib/agent/openrouter";
import type { GameFactsResult } from "../lib/game-facts";
import type { GameType } from "../lib/data-processor";

process.env.OPENROUTER_API_KEY = "test-key";

const DAY = 86400;
const BASE = Math.floor(Date.UTC(2025, 0, 1) / 1000);

const games = Array.from({ length: 5 }, (_, i) => ({
  endTime: BASE + i * DAY,
  timeClass: "rapid" as GameType,
  color: "white" as const,
  myRating: 1500 + i,
  oppRating: 1490,
  oppUsername: "Rival",
  outcome: "win" as const,
  termination: "resignation" as const,
  terminationRaw: "resigned",
  eco: "B90",
  openingName: "Sicilian Defense",
  openingKey: "sicilian defense",
  openingFamily: "Sicilian Defense",
  timeControl: "600",
  durationSeconds: 600,
  url: `u${i}`,
}));

const facts: GameFactsResult = {
  username: "TestPlayer",
  generatedAt: 0,
  archiveCount: 1,
  firstGameTime: games[0].endTime,
  lastGameTime: games[4].endTime,
  games,
  byType: { bullet: [], blitz: [], rapid: [0, 1, 2, 3, 4] },
};

/** Builds a fake fetch that replays scripted assistant messages in order. */
function scriptedFetch(messages: unknown[]) {
  let i = 0;
  const seen: any[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    seen.push(JSON.parse(String(init.body)));
    const message = messages[Math.min(i, messages.length - 1)];
    i++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
    };
  }) as unknown as typeof fetch;
  return { impl, seen, calls: () => i };
}

const toolCallMsg = (name: string, args: string, id = "call_1") => ({
  role: "assistant",
  content: "",
  tool_calls: [{ id, type: "function", function: { name, arguments: args } }],
});

async function main() {
// ------------------------------------------------- happy path: tool → answer
{
  const { impl, seen } = scriptedFetch([
    toolCallMsg("get_rating_at_game_number", '{"time_class":"rapid","game_number":3}'),
    { role: "assistant", content: "Your rapid rating at game 3 was 1502." },
  ]);

  const res = await runAgent({ facts, history: [], question: "rating at game 3?", fetchImpl: impl });

  assert.strictEqual(res.answer, "Your rapid rating at game 3 was 1502.");
  assert.strictEqual(res.truncated, false);
  assert.strictEqual(res.iterations, 2);
  assert.deepStrictEqual(res.toolCalls.map((t) => [t.name, t.ok]), [
    ["get_rating_at_game_number", true],
  ]);

  // The second request must carry: system, user, assistant(tool_calls), tool.
  const second = seen[1].messages;
  const assistantIdx = second.findIndex((m: any) => m.tool_calls?.length);
  assert.ok(assistantIdx > -1, "assistant turn with tool_calls must be replayed");
  assert.strictEqual(second[assistantIdx + 1].role, "tool", "tool result must follow it immediately");
  assert.strictEqual(second[assistantIdx + 1].tool_call_id, "call_1", "tool_call_id must line up");
  const payload = JSON.parse(second[assistantIdx + 1].content);
  assert.strictEqual(payload.rating, 1502, "the real tool must have run");
  assert.strictEqual(seen[0].messages[0].role, "system");
  assert.ok(seen[0].tools?.length === 9, "tool defs must be sent");
  console.log("✓ tool→answer flow, message ordering, tool_call_id, real tool output");
}

// ------------------------------------------------------------ unknown tool
{
  const { impl, seen } = scriptedFetch([
    toolCallMsg("get_my_horoscope", "{}"),
    { role: "assistant", content: "I don't have that." },
  ]);
  const res = await runAgent({ facts, history: [], question: "?", fetchImpl: impl });
  assert.strictEqual(res.answer, "I don't have that.");
  assert.strictEqual(res.toolCalls[0].ok, false);
  const toolMsg = seen[1].messages.find((m: any) => m.role === "tool");
  assert.strictEqual(JSON.parse(toolMsg.content).error, "unknown_tool");
  assert.ok(JSON.parse(toolMsg.content).available.includes("get_player_overview"));
  console.log("✓ unknown tool name is fed back, loop continues");
}

// ------------------------------------------------------- malformed arguments
{
  for (const bad of ["{not json", "[1,2]", "null"]) {
    const { impl, seen } = scriptedFetch([
      toolCallMsg("get_player_overview", bad),
      { role: "assistant", content: "ok" },
    ]);
    const res = await runAgent({ facts, history: [], question: "?", fetchImpl: impl });
    assert.strictEqual(res.answer, "ok");
    const toolMsg = seen[1].messages.find((m: any) => m.role === "tool");
    assert.strictEqual(JSON.parse(toolMsg.content).error, "bad_arguments", `for ${bad}`);
  }
  // Empty string arguments are legitimate for a no-arg tool.
  const { impl, seen } = scriptedFetch([
    toolCallMsg("get_player_overview", ""),
    { role: "assistant", content: "ok" },
  ]);
  await runAgent({ facts, history: [], question: "?", fetchImpl: impl });
  const toolMsg = seen[1].messages.find((m: any) => m.role === "tool");
  assert.ok(JSON.parse(toolMsg.content).by_time_class, 'empty args => {} for a no-arg tool');
  console.log("✓ malformed arguments handled; empty args treated as {}");
}

// ------------------------------------------------- bad args reach the model
{
  const { impl, seen } = scriptedFetch([
    toolCallMsg("get_rating_on_date", '{"time_class":"rapid","date":"banana"}'),
    { role: "assistant", content: "I need a valid date." },
  ]);
  await runAgent({ facts, history: [], question: "?", fetchImpl: impl });
  const toolMsg = seen[1].messages.find((m: any) => m.role === "tool");
  const body = JSON.parse(toolMsg.content);
  assert.strictEqual(body.error, "invalid_arguments");
  assert.ok(body.hint, "hint must reach the model so it can retry");
  console.log("✓ invalid tool arguments surface as a correctable result");
}

// ----------------------------------------------------------- iteration cap
{
  const { impl, calls } = scriptedFetch([
    toolCallMsg("get_player_overview", "{}"), // repeated forever
  ]);
  const res = await runAgent({ facts, history: [], question: "?", fetchImpl: impl });
  assert.strictEqual(res.truncated, true);
  assert.strictEqual(res.iterations, MAX_TOOL_ITERATIONS);
  assert.ok(res.answer.length > 0, "must still produce an answer");
  assert.strictEqual(calls(), MAX_TOOL_ITERATIONS + 1, "one extra call with tool_choice:none");
  console.log("✓ iteration cap terminates with a final tool-free answer");
}

// ------------------------------------------------------------- deadline
{
  const { impl } = scriptedFetch([toolCallMsg("get_player_overview", "{}")]);
  const res = await runAgent({
    facts,
    history: [],
    question: "?",
    deadline: Date.now() - 1,
    fetchImpl: impl,
  });
  assert.strictEqual(res.truncated, true);
  assert.strictEqual(res.iterations, 1, "deadline must break after the first round");
  console.log("✓ deadline breaks the loop early");
}

// -------------------------------------------- 200 with a top-level error body
{
  const impl = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ error: { message: "upstream provider is down" } }),
  })) as unknown as typeof fetch;

  await assert.rejects(
    () => chatCompletion({ messages: [{ role: "user", content: "hi" }] }, { fetchImpl: impl }),
    (err: unknown) => err instanceof LlmError,
    "HTTP 200 with an error body must not be treated as success"
  );
  console.log("✓ 200-with-error-body is treated as a failure");
}

// ------------------------------------------------------------- auth failure
{
  const impl = (async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch;
  let calls = 0;
  const counting = (async (...a: Parameters<typeof fetch>) => {
    calls++;
    return impl(...a);
  }) as unknown as typeof fetch;

  await assert.rejects(
    () => chatCompletion({ messages: [{ role: "user", content: "hi" }] }, { fetchImpl: counting }),
    (err: unknown) => err instanceof LlmError
  );
  assert.strictEqual(calls, 1, "401 must not be retried");
  console.log("✓ 401 surfaces immediately without a retry");
}

// ------------------------------------------------------- history passthrough
{
  const { impl, seen } = scriptedFetch([{ role: "assistant", content: "sure" }]);
  await runAgent({
    facts,
    history: [
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
    ],
    question: "follow up",
    fetchImpl: impl,
  });
  const roles = seen[0].messages.map((m: any) => m.role);
  assert.deepStrictEqual(roles, ["system", "user", "assistant", "user"]);
  assert.strictEqual(seen[0].messages[3].content, "follow up");
  console.log("✓ prior turns replay in order, question last");
}

console.log("\nALL AGENT CHECKS PASSED");
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
