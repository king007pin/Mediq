import { mapUnstableModel } from "./nvidia";

export type ProviderFormat = "openai" | "anthropic" | "gemini";

export type Provider = {
  id: string;
  name: string;
  format: ProviderFormat;
  baseUrl: string;
  docsUrl?: string;
  defaultModels: string[];
  modelsEndpoint?: string;
  requiresBaseUrl?: boolean;
};

export const PROVIDERS: Record<string, Provider> = {
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    format: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    docsUrl: "https://openrouter.ai/keys",
    defaultModels: [
      "openai/gpt-4o",
      "anthropic/claude-3.5-sonnet",
      "meta-llama/llama-3.3-70b-instruct",
      "google/gemini-2.0-flash-001",
    ],
    modelsEndpoint: "/models",
  },
  nvidia: {
    id: "nvidia",
    name: "NVIDIA NIM",
    format: "openai",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    docsUrl: "https://build.nvidia.com/explore/discover",
    defaultModels: [
      "meta/llama-3.3-70b-instruct",
      "openai/gpt-oss-120b",
      "nvidia/nemotron-3-super-120b-a12b",
      "meta/llama-4-maverick-17b-128e-instruct",
      "qwen/qwen3-next-80b-a3b-instruct",
      "mistralai/ministral-14b-instruct-2512",
      "nvidia/nemotron-nano-12b-v2-vl",
    ],
    modelsEndpoint: "/models",
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    format: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModels: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1-preview", "o1-mini"],
    modelsEndpoint: "/models",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    format: "anthropic",
    baseUrl: "https://api.anthropic.com",
    defaultModels: [
      "claude-opus-4-5-20251101",
      "claude-sonnet-4-5-20251022",
      "claude-haiku-4-5-20251001",
    ],
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    format: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    defaultModels: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
  },
  mistral: {
    id: "mistral",
    name: "Mistral AI",
    format: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModels: ["mistral-large-latest", "mistral-medium-latest", "open-mistral-nemo"],
    modelsEndpoint: "/models",
  },
  groq: {
    id: "groq",
    name: "Groq",
    format: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModels: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768", "gemma2-9b-it"],
    modelsEndpoint: "/models",
  },
  together: {
    id: "together",
    name: "Together AI",
    format: "openai",
    baseUrl: "https://api.together.xyz/v1",
    defaultModels: [
      "meta-llama/Llama-3-70b-chat-hf",
      "mistralai/Mixtral-8x7B-Instruct-v0.1",
      "Qwen/Qwen2.5-72B-Instruct-Turbo",
    ],
    modelsEndpoint: "/models",
  },
  fireworks: {
    id: "fireworks",
    name: "Fireworks AI",
    format: "openai",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    defaultModels: [
      "accounts/fireworks/models/llama-v3p3-70b-instruct",
      "accounts/fireworks/models/mixtral-8x7b-instruct",
    ],
    modelsEndpoint: "/models",
  },
  cerebras: {
    id: "cerebras",
    name: "Cerebras",
    format: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    defaultModels: ["llama3.1-70b", "llama3.1-8b"],
    modelsEndpoint: "/models",
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    format: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModels: ["deepseek-chat", "deepseek-reasoner"],
    modelsEndpoint: "/models",
  },
  custom: {
    id: "custom",
    name: "Custom OpenAI-Compatible",
    format: "openai",
    baseUrl: "",
    requiresBaseUrl: true,
    defaultModels: [],
  },
};

/**
 * Defense-in-depth helper: only honor a stored `customBaseUrl` when the
 * provider explicitly requires one (currently only `custom`). For every
 * known provider — openai, anthropic, gemini, nvidia, etc. — the baseUrl
 * is hard-coded in PROVIDERS and must NOT be overridable by DB state.
 *
 * Without this guard, an authed user could overwrite a known provider's
 * customBaseUrl to a host they control and trigger a "test" or swarm call
 * that forwards the legitimate decrypted API key to their host
 * (credential exfiltration). The save route already blocks new writes,
 * but read sites also strip stray legacy data so already-corrupted DB
 * rows can't be weaponized.
 */
export function resolveProvider(provider: Provider, customBaseUrl: string | null | undefined): Provider {
  if (!customBaseUrl) return provider;
  if (!provider.requiresBaseUrl) return provider; // ignore stray override
  return { ...provider, baseUrl: customBaseUrl };
}

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

export async function callProvider(
  provider: Provider,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  timeoutMs = 30_000,
  abortSignal?: AbortSignal,
): Promise<string> {
  const targetModel = provider.id === "nvidia" ? mapUnstableModel(model) : model;
  const baseUrl = provider.baseUrl;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (abortSignal) {
    if (abortSignal.aborted) ctrl.abort();
    else abortSignal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }

  try {
    if (provider.format === "openai") {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: targetModel, messages, max_tokens: 1024, temperature: 0.4 }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const err = await res.text().catch(() => res.statusText);
        throw Object.assign(new Error(err), { status: res.status });
      }
      const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
      const content = data.choices[0]?.message?.content;
      if (!content) throw new Error(`${provider.id} returned an empty or malformed response`);
      return content;

    } else if (provider.format === "anthropic") {
      const system = messages.find((m) => m.role === "system")?.content;
      const human = messages.filter((m) => m.role !== "system");
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: targetModel,
          max_tokens: 1024,
          ...(system ? { system } : {}),
          messages: human,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const err = await res.text().catch(() => res.statusText);
        throw Object.assign(new Error(err), { status: res.status });
      }
      const data = (await res.json()) as { content: Array<{ text: string }> };
      const content = data.content[0]?.text;
      if (!content) throw new Error(`${provider.id} returned an empty or malformed response`);
      return content;

    } else {
      // gemini
      const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
      const res = await fetch(
        `${baseUrl}/v1beta/models/${targetModel}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          signal: ctrl.signal,
        },
      );
      if (!res.ok) {
        const err = await res.text().catch(() => res.statusText);
        throw Object.assign(new Error(err), { status: res.status });
      }
      const data = (await res.json()) as {
        candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      };
      const content = data.candidates[0]?.content?.parts[0]?.text;
      if (!content) throw new Error(`${provider.id} returned an empty or malformed response`);
      return content;
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function listProviderModels(
  provider: Provider,
  apiKey: string,
): Promise<string[]> {
  if (!provider.modelsEndpoint) return provider.defaultModels;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(`${provider.baseUrl}${provider.modelsEndpoint}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return provider.defaultModels;
    const data = (await res.json()) as { data?: Array<{ id: string }>; models?: Array<{ id: string }> };
    const list = data.data ?? data.models ?? [];
    const ids = list
      .map((m) => m.id)
      .filter((id) => !/(embed|rerank|ocr|asr|whisper|tts|dall-e|moderat)/i.test(id));
    return ids.length > 0 ? ids : provider.defaultModels;
  } catch {
    return provider.defaultModels;
  }
}
