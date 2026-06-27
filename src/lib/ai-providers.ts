export type AiProvider = "openai" | "anthropic" | "gemini" | "deepseek";

export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
}

export const PROVIDER_MODELS: Record<AiProvider, { label: string; models: string[]; defaultModel: string }> = {
  openai: {
    label: "OpenAI (ChatGPT)",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
    defaultModel: "gpt-4o-mini",
  },
  anthropic: {
    label: "Anthropic (Claude)",
    models: ["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest", "claude-sonnet-4-5"],
    defaultModel: "claude-3-5-haiku-latest",
  },
  gemini: {
    label: "Google Gemini",
    models: ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"],
    defaultModel: "gemini-2.0-flash",
  },
  deepseek: {
    label: "DeepSeek",
    models: ["deepseek-chat", "deepseek-reasoner"],
    defaultModel: "deepseek-chat",
  },
};

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AskAiOpts {
  config: AiConfig;
  system: string;
  messages: ChatMessage[];
  /** Ask the provider for strict JSON output where supported. */
  responseFormat?: "json" | "text";
  maxTokens?: number;
  temperature?: number;
}

export async function askAi(opts: AskAiOpts): Promise<string> {
  const { config } = opts;
  switch (config.provider) {
    case "openai":
      return callOpenAiCompat("https://api.openai.com/v1/chat/completions", opts);
    case "deepseek":
      return callOpenAiCompat("https://api.deepseek.com/v1/chat/completions", opts);
    case "anthropic":
      return callAnthropic(opts);
    case "gemini":
      return callGemini(opts);
  }
}

function friendlyError(provider: AiProvider, status: number, body: string): Error {
  let msg = `${provider}: HTTP ${status}`;
  if (status === 401 || status === 403) msg = `${provider}: API key invalid or unauthorized`;
  else if (status === 402) msg = `${provider}: insufficient credits`;
  else if (status === 429) msg = `${provider}: rate limit hit — wait and retry`;
  else if (status >= 500) msg = `${provider}: provider error (${status}) — try again`;
  // include short body excerpt
  const short = body.slice(0, 200).replace(/\s+/g, " ").trim();
  if (short) msg += ` · ${short}`;
  return new Error(msg);
}

async function callOpenAiCompat(url: string, opts: AskAiOpts): Promise<string> {
  const { config, system, messages, responseFormat, temperature, maxTokens } = opts;
  const body: Record<string, unknown> = {
    model: config.model,
    messages: [{ role: "system", content: system }, ...messages],
    temperature: temperature ?? 0.4,
  };
  if (maxTokens) body.max_tokens = maxTokens;
  if (responseFormat === "json") body.response_format = { type: "json_object" };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw friendlyError(config.provider, res.status, await res.text());
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "(empty response)";
}

async function callAnthropic(opts: AskAiOpts): Promise<string> {
  const { config, system, messages, responseFormat, temperature, maxTokens } = opts;
  const sys = responseFormat === "json"
    ? `${system}\n\nIMPORTANT: Respond with a single valid JSON object only. No prose, no markdown fences.`
    : system;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: config.model,
      system: sys,
      max_tokens: maxTokens ?? 4096,
      temperature: temperature ?? 0.4,
      messages,
    }),
  });
  if (!res.ok) throw friendlyError(config.provider, res.status, await res.text());
  const json = await res.json();
  return json.content?.[0]?.text ?? "(empty response)";
}

async function callGemini(opts: AskAiOpts): Promise<string> {
  const { config, system, messages, responseFormat, temperature, maxTokens } = opts;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
  const genConfig: Record<string, unknown> = {};
  if (responseFormat === "json") genConfig.responseMimeType = "application/json";
  if (temperature !== undefined) genConfig.temperature = temperature;
  if (maxTokens) genConfig.maxOutputTokens = maxTokens;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      ...(Object.keys(genConfig).length ? { generationConfig: genConfig } : {}),
    }),
  });
  if (!res.ok) throw friendlyError(config.provider, res.status, await res.text());
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "(empty response)";
}

/** Pull a JSON object from a model response, tolerating ```json fences and prose. */
export function extractJson<T = unknown>(text: string): T {
  let s = text.trim();
  // strip ```json ... ``` fences
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // first { ... last }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) s = s.slice(first, last + 1);
  return JSON.parse(s) as T;
}

const STORAGE_KEY = "brain:ai-config";

export function loadAiConfig(): AiConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.provider || !parsed.apiKey || !parsed.model) return null;
    return parsed as AiConfig;
  } catch {
    return null;
  }
}

export function saveAiConfig(c: AiConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
}

export function clearAiConfig() {
  localStorage.removeItem(STORAGE_KEY);
}
