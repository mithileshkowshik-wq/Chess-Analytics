export const DEFAULT_MODEL = "google/gemma-4-31b-it";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const REQUEST_TIMEOUT_MS = 30_000;

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatCompletion {
  choices?: { message: ChatMessage; finish_reason?: string }[];
  usage?: ChatUsage;
  error?: { message?: string; code?: number };
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: unknown[];
  tool_choice?: "auto" | "none";
  temperature?: number;
  max_tokens?: number;
}

export class LlmNotConfiguredError extends Error {
  constructor() {
    super("The assistant is not configured.");
    this.name = "LlmNotConfiguredError";
  }
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

export function getModel(): string {
  return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
}

export function isConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

function buildHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  // Optional OpenRouter attribution; harmless when unset.
  const site = process.env.OPENROUTER_SITE_URL?.trim();
  const name = process.env.OPENROUTER_SITE_NAME?.trim();
  if (site) headers["HTTP-Referer"] = site;
  if (name) headers["X-Title"] = name;
  return headers;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One call to the OpenAI-compatible chat completions endpoint.
 *
 * `fetchImpl` exists so the agent loop can be exercised without a network.
 * Env is read here rather than at module scope so a missing key cannot break
 * the production build.
 */
export async function chatCompletion(
  req: ChatRequest,
  opts: { fetchImpl?: typeof fetch } = {}
): Promise<ChatCompletion> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new LlmNotConfiguredError();

  const baseUrl = process.env.OPENROUTER_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const doFetch = opts.fetchImpl ?? fetch;

  const body = JSON.stringify({
    model: getModel(),
    temperature: req.temperature ?? 0.2,
    max_tokens: req.max_tokens ?? 800,
    messages: req.messages,
    ...(req.tools ? { tools: req.tools } : {}),
    ...(req.tool_choice ? { tool_choice: req.tool_choice } : {}),
  });

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: buildHeaders(apiKey),
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : "network error";
      if (attempt === 0) {
        await sleep(1000);
        continue;
      }
      throw new LlmError(`Could not reach the model provider: ${lastError}`);
    }

    // Auth problems are never worth retrying.
    if (res.status === 401 || res.status === 403) {
      throw new LlmError("The model provider rejected the API key.");
    }

    if (!res.ok) {
      lastError = `provider returned ${res.status}`;
      if ((res.status === 429 || res.status >= 500) && attempt === 0) {
        await sleep(1000);
        continue;
      }
      throw new LlmError(`The model provider failed (${res.status}).`);
    }

    const json = (await res.json().catch(() => null)) as ChatCompletion | null;

    // OpenRouter can answer 200 with a top-level error when an upstream
    // provider fails, so res.ok alone is not enough.
    if (!json || json.error || !json.choices?.length) {
      lastError = json?.error?.message ?? "empty response";
      if (attempt === 0) {
        await sleep(1000);
        continue;
      }
      throw new LlmError(`The model provider failed: ${lastError}`);
    }

    return json;
  }

  throw new LlmError(`The model provider failed: ${lastError}`);
}
