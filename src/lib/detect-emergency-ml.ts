import { PROVIDERS, callProvider } from "./providerRegistry";
import { detectEmergency } from "./detect-emergency";
import { getNvidiaApiKey } from "./nvidia";

export type EmergencyMLResult = {
  isEmergency: boolean;
  triggers: string[];
};

/**
 * Async LLM-based Emergency Classifier (W46-followup).
 * Formulates a prompt instructing a fast LLM model to return a structured JSON response
 * identifying if the medical query represents an emergency and outlining the triggers.
 *
 * Seamlessly falls back to the existing local regex-based `detectEmergency` if:
 *  - No API keys are configured / passed
 *  - The API call fails or times out
 *  - The LLM returns a malformed or unparseable JSON response
 */
export async function detectEmergencyML(
  text: string,
  providerKeyConfig?: {
    providerId?: string;
    apiKey?: string;
    model?: string;
  }
): Promise<EmergencyMLResult> {
  // 1. Resolve API key and provider
  let providerId = providerKeyConfig?.providerId;
  let apiKey = providerKeyConfig?.apiKey;
  let model = providerKeyConfig?.model;

  // Fallback to environment variables if not provided
  if (!apiKey) {
    if (process.env.NVIDIA_API_KEY) {
      providerId = providerId || "nvidia";
      // NVIDIA_API_KEY is a comma-separated pool (see getNvidiaApiKey in
      // nvidia.ts) -- must pick one real key, not send the raw joined
      // string as a single Bearer token (that 403s with "Authorization
      // failed" since it's not a valid key).
      apiKey = getNvidiaApiKey("default");
    } else if (process.env.OPENAI_API_KEY) {
      providerId = providerId || "openai";
      apiKey = process.env.OPENAI_API_KEY;
    }
  }

  // If we still don't have keys, fall back immediately to regex-based classification
  if (!apiKey || !providerId) {
    return detectEmergency(text);
  }

  const provider = PROVIDERS[providerId];
  if (!provider) {
    return detectEmergency(text);
  }

  // Pick a fast model depending on the provider if model not specified
  if (!model) {
    if (providerId === "nvidia") {
      model = "meta/llama-3.3-70b-instruct";
    } else if (providerId === "openai") {
      model = "gpt-4o-mini";
    } else {
      model = provider.defaultModels[0];
    }
  }

  const systemPrompt = `You are a clinical emergency classifier. Analyze the user's query and identify if it represents an emergency medical condition requiring immediate/urgent clinical attention.
Return a structured JSON response matching the following TypeScript type:
{
  isEmergency: boolean;
  triggers: string[];
}
"triggers" should list specific clinical reasons/symptoms/markers indicating the emergency, using brief medical labels (e.g., "ACS presentation", "Cardiac emergency", "Stroke / TIA", "Airway emergency", "Sepsis", "Loss of consciousness", etc.).
Do not include any explanation, preamble, or markdown formatting in your response. Return ONLY a valid JSON object.`;

  try {
    const rawResponse = await callProvider(
      provider,
      apiKey,
      model,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      10_000 // 10s timeout to guarantee timing-safety
    );

    // Clean up code block markdown if present
    let jsonStr = rawResponse.trim();
    if (jsonStr.startsWith("```")) {
      const match = jsonStr.match(/^(?:```json)?([\s\S]+?)```$/i);
      if (match) jsonStr = match[1].trim();
    }

    const result = JSON.parse(jsonStr) as EmergencyMLResult;
    
    // Validate response shape
    if (typeof result.isEmergency === "boolean" && Array.isArray(result.triggers)) {
      return {
        isEmergency: result.isEmergency,
        triggers: result.triggers.map((t) => String(t)),
      };
    }
    
    throw new Error("Invalid response format from LLM");
  } catch (error) {
    // Log error locally and fallback seamlessly
    console.warn("[detectEmergencyML] LLM emergency classification failed, falling back to regex: ", error);
    return detectEmergency(text);
  }
}
