/**
 * LIVE smoke test for the assistant. Unlike the other check scripts this one
 * really calls OpenRouter, so it needs OPENROUTER_API_KEY. It does NOT touch
 * Chess.com — the game data is synthetic with known answers, so a wrong number
 * means the model is inventing rather than reading tool output.
 *
 * See README "Configuration" for how to run it.
 */
import { runAgent } from "../lib/agent/loop";
import { getModel } from "../lib/agent/openrouter";
import type { GameFactsResult } from "../lib/game-facts";
import type { GameType } from "../lib/data-processor";

const DAY = 86400;
const START = Math.floor(Date.UTC(2025, 0, 1) / 1000);

// Five rated rapid Sicilians: ratings 1500..1504, first four wins then a loss.
// So rapid game #3 is exactly 1502, and the win rate is exactly 80%.
const games = Array.from({ length: 5 }, (_, i) => ({
  endTime: START + i * DAY,
  timeClass: "rapid" as GameType,
  color: (i % 2 ? "black" : "white") as "white" | "black",
  myRating: 1500 + i,
  oppRating: 1490,
  oppUsername: "Rival",
  outcome: (i < 4 ? "win" : "loss") as "win" | "loss" | "draw",
  termination: "resignation" as const,
  terminationRaw: "resigned",
  eco: "B90",
  openingName: "Sicilian Defense Najdorf Variation",
  openingKey: "sicilian defense najdorf variation",
  openingFamily: "Sicilian Defense",
  timeControl: "600",
  durationSeconds: 600,
  url: `https://example.invalid/game/${i}`,
}));

const facts: GameFactsResult = {
  username: "SmokeTestPlayer",
  generatedAt: Math.floor(Date.now() / 1000),
  archiveCount: 1,
  firstGameTime: games[0].endTime,
  lastGameTime: games[4].endTime,
  games,
  byType: { bullet: [], blitz: [], rapid: [0, 1, 2, 3, 4] },
};

interface Probe {
  question: string;
  /** What a correct answer must contain. */
  expect?: RegExp;
  /** Tool the model ought to reach for. */
  expectTool?: string;
  /** True when the model is supposed to decline rather than answer. */
  shouldDecline?: boolean;
}

const PROBES: Probe[] = [
  {
    question: "What was my rapid rating after 3 games?",
    expect: /1502/,
    expectTool: "get_rating_at_game_number",
  },
  {
    question: "Do I have a good success rate with the Sicilian?",
    expect: /80|5\b/,
    expectTool: "get_opening_performance",
  },
  {
    question: "What was my rapid rating on 2025-01-03?",
    expect: /1502/,
    expectTool: "get_rating_on_date",
  },
  {
    // Nothing exposes puzzle ratings. It must say so, not invent one.
    question: "What is my puzzle rush score?",
    shouldDecline: true,
  },
];

async function main() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error(
      "OPENROUTER_API_KEY is not set.\n" +
        "Put it in .env.local and run this script with --env-file=.env.local."
    );
    process.exit(1);
  }

  console.log(`Model: ${getModel()}`);
  console.log(
    "Fixture: 5 rated rapid Sicilians, ratings 1500-1504, 4 wins + 1 loss.\n"
  );

  let passed = 0;
  let failed = 0;
  let promptTokens = 0;
  let completionTokens = 0;

  for (const probe of PROBES) {
    process.stdout.write(`Q: ${probe.question}\n`);
    try {
      const res = await runAgent({
        facts,
        history: [],
        question: probe.question,
        deadline: Date.now() + 45_000,
      });

      promptTokens += res.usage?.prompt_tokens ?? 0;
      completionTokens += res.usage?.completion_tokens ?? 0;

      const tools = res.toolCalls.map((t) => `${t.name}${t.ok ? "" : "(failed)"}`);
      console.log(`A: ${res.answer}`);
      console.log(
        `   tools: ${tools.length ? tools.join(", ") : "none"}` +
          `  rounds: ${res.iterations}${res.truncated ? " (truncated)" : ""}`
      );

      const problems: string[] = [];

      if (probe.expectTool && !res.toolCalls.some((t) => t.name === probe.expectTool)) {
        problems.push(`expected it to call ${probe.expectTool}`);
      }
      if (probe.expect && !probe.expect.test(res.answer)) {
        problems.push(`answer did not contain ${probe.expect}`);
      }
      if (probe.shouldDecline) {
        // Any four-digit number here would be fabricated.
        if (/\b\d{3,4}\b/.test(res.answer)) {
          problems.push("answer contains a number it cannot possibly know");
        }
        if (res.toolCalls.length > 3) {
          problems.push("thrashed through tools instead of declining");
        }
      }
      if (res.toolCalls.some((t) => !t.ok)) {
        problems.push("at least one tool call was malformed");
      }

      if (problems.length) {
        failed++;
        console.log(`   ✗ ${problems.join("; ")}\n`);
      } else {
        passed++;
        console.log("   ✓\n");
      }
    } catch (err) {
      failed++;
      console.log(`   ✗ ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  console.log(`${passed} passed, ${failed} failed`);
  if (promptTokens || completionTokens) {
    // Gemma 4 31B list price at time of writing.
    const cost = (promptTokens / 1e6) * 0.08 + (completionTokens / 1e6) * 0.35;
    console.log(
      `tokens: ${promptTokens} in / ${completionTokens} out  ≈ $${cost.toFixed(5)} for all ${PROBES.length} questions`
    );
  }

  if (failed) {
    console.log(
      "\nIf tool calls are the problem rather than the numbers, try a different\n" +
        "model via OPENROUTER_MODEL — the tools are model-agnostic."
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
